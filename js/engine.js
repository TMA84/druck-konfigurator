'use strict';
/* Rechenkern – aus v4 übernommen. Einziger Unterschied: Eingaben kommen als
   Parameter statt aus dem DOM, damit tests/compare-v4.js ihn gegen v4 prüfen kann. */

// Objektart „Wasserdicht / Behälter“
const WATERTIGHT_TEMP_BOOST=5, WATERTIGHT_OUTER_FACTOR=0.7;
function supportProfile(level,tpu){
  const p={
    safe:{angle:45,xy:tpu?'0,40 mm':'0,35 mm',iface:tpu?3:2,gap:'0,50 mm',density:tpu?'15 %':'20 %',branch:tpu?'1,5–2,0 mm':'1,0–1,5 mm',small:'Ein'},
    balanced:{angle:45,xy:tpu?'0,40 mm':'0,35 mm',iface:2,gap:'0,50 mm',density:'20 %',branch:'1,0–1,5 mm',small:'Ein'},
    reduced:{angle:50,xy:tpu?'0,45 mm':'0,40 mm',iface:1,gap:'0,60 mm',density:'15 %',branch:'1,5–2,0 mm',small:'Ein'},
    minimal:{angle:55,xy:tpu?'0,50 mm':'0,45 mm',iface:1,gap:'0,60 mm',density:'10 %',branch:'2,0 mm',small:'Aus'}
  };return p[level]||p.balanced;
}
/* Z-Abstand Stütze↔Teil: eine Schichthöhe – so halten die Stützen sicher (abfallende Stützen gab es schon).
   PETG haftet stärker am Teil → eine Stufe (0,05 mm) mehr. Unten bei TPU mindestens 0,25 mm wie in v4. */
function supportZGap(layer,kind,tpu){
  const top=Math.round((layer+(kind==='petg'?0.05:0))*100)/100;
  return {top,bottom:tpu?Math.max(0.25,top):top};
}
// Untere Grenze einer Angabe wie "1,0–1,5 mm" oder "20 %" als Zahl
const lowerNum=s=>{const m=/(\d+(?:[.,]\d+)?)/.exec(String(s));return m?Number(m[1].replace(',','.')):null};
// kind = Filamenttyp des aktuell gewählten Filaments (v4 las ihn aus dem DOM)
function helpFor(label,kind){
  const keys=Object.keys(explanations);
  const key=keys.find(k=>label===k)||keys.find(k=>label.startsWith(k))||keys.find(k=>label.includes(k));
  if(!key)return '';
  let extra='';
  if(kind==='tpu'&&['Düse','Lüfter','Rückzug','Maximale Volumengeschwindigkeit','Außenwand','Innere Wand','Füllung','Travel','Beschleunigung'].includes(key))extra=' '+t('TPU reagiert deutlich empfindlicher auf hohe Geschwindigkeit als PLA.');
  return explanations[key]+extra;
}
function rowHTML(r,kind){const h=helpFor(r[0],kind);return '<div class="setting'+(r[3]?' ov':'')+'"><b>'+esc(t(r[0]))+(h?'<span class="help" title="'+esc(h)+'">?</span>':'')+'</b><span class="value">'+r[1]+(r[2]?'<small>'+r[2]+'</small>':'')+'</span></div>'}

function orcaFilamentInherits(printerId,kindUpper){
  return (ORCA_FILAMENT_BASE[printerId]||{})[kindUpper]||ORCA_SYSTEM_FILAMENT[kindUpper]||'Generic PLA @System';
}
function orcaProcessInherits(printerId,nozD){
  return (ORCA_PROCESS_BASE[printerId]||{})[nozD]||null;
}
function buildOrcaFilamentJSON(r){
  const kindUpper=r.m.kind.toUpperCase();
  const temp=String(r.nozzle),bed=String(r.m.bed),fan=String(r.m.fan);
  const name='Druck-Konfigurator '+r.m.name;
  return JSON.stringify({
    type:'filament',
    name:name,
    version:'1.0.0.0',
    from:'User',
    instantiation:'true',
    inherits:orcaFilamentInherits(r.printer.id,kindUpper),
    filament_settings_id:[name],
    nozzle_temperature:[temp],
    nozzle_temperature_initial_layer:[temp],
    hot_plate_temp:[bed],hot_plate_temp_initial_layer:[bed],
    cool_plate_temp:[bed],cool_plate_temp_initial_layer:[bed],
    eng_plate_temp:[bed],eng_plate_temp_initial_layer:[bed],
    textured_plate_temp:[bed],textured_plate_temp_initial_layer:[bed],
    fan_min_speed:[fan],fan_max_speed:[fan]
  },null,2);
}
function buildOrcaProcessJSON(r){
  const inherits=orcaProcessInherits(r.printer.id,r.dSel);
  const name='Druck-Konfigurator '+r.m.name+' - '+r.ob.label;
  // Gyroid ist in beiden Pattern-Vorschlägen ("Gyroid" / "Gyroid oder Kubisch") die Primärempfehlung.
  const orcaPattern = r.pattern.indexOf('Gyroid')===0 ? 'gyroid' : 'crosshatch';
  return JSON.stringify({
    type:'process',
    name:name,
    version:'1.0.0.0',
    from:'User',
    instantiation:'true',
    inherits: inherits||'fdm_process_common',
    print_settings_id:[name],
    layer_height:String(r.layer),
    wall_loops:String(r.w),
    sparse_infill_density:r.inf+'%',
    sparse_infill_pattern:orcaPattern,
    top_shell_layers:String(r.t),
    bottom_shell_layers:String(r.b),
    outer_wall_speed:String(r.sp_outer),
    inner_wall_speed:String(r.sp_inner),
    sparse_infill_speed:String(r.sp_fill),
    internal_solid_infill_speed:String(r.sp_fill),
    top_surface_speed:String(r.top),
    gap_infill_speed:String(r.m.gap),
    initial_layer_speed:String(r.m.first),
    travel_speed:String(r.m.travel)
  },null,2);
}
function orcaWarningText(r){
  const parts=[];
  const kindUpper=r.m.kind.toUpperCase();
  if(!(ORCA_FILAMENT_BASE[r.printer.id]||{})[kindUpper]){
    parts.push(t('Kein {printer}-eigenes Preset für {kind} bekannt – Filament-JSON erbt stattdessen von „{base}“. Das klappt nur, wenn diese generische Bibliothek in deiner OrcaSlicer-Installation mit installiert ist.',{printer:esc(r.printer.label),kind:kindUpper,base:esc(ORCA_SYSTEM_FILAMENT[kindUpper]||'Generic PLA @System')}));
  }
  if(!orcaProcessInherits(r.printer.id,r.dSel)){
    parts.push(t('Process-JSON: für {d} mm Düse ist am {printer} kein Preset verifiziert (nur {checked} geprüft) – Import kann fehlschlagen, Werte notfalls manuell eintragen.',{d:de(+r.dSel,r.dSel==='0.25'?2:1),printer:esc(r.printer.label),checked:(r.printer.id==='snapmaker_u1'?[0.4,0.6,0.8]:[0.4]).map(x=>de(x,1)+' mm').join('/')}));
  }
  return parts.join('<br><br>');
}

/* ================= ENGINE ================= */
// I = {printer,material,nozD,nozM,object,goal,load,support,supportLevel,thresh}
// ctx = {getMat, settings}; geom = Ergebnis von parseSTL oder null
function compute(I,geom,ctx){
  const printer=PRINTERS[I.printer]||PRINTERS.kobra_s1;
  const mk=I.material,o=I.object,g=I.goal,l=I.load,s=I.support,sl=I.supportLevel;
  // Beliebiger Orca-Drucker: Geschwindigkeiten, Beschleunigung und Volumenstrom höchstens so hoch wie in seinem Orca-Profil
  let m=printer.orca&&typeof orcaLimitMaterial==='function'?orcaLimitMaterial(ctx.getMat(mk),printer.orca):ctx.getMat(mk);
  const ob=OBJ[o],tpu=m.kind==='tpu',sp=supportProfile(sl,tpu);
  /* Anpassungen für diesen Auftrag (I.overrides, je Teil): ersetzen den berechneten Vorschlag an der Stelle,
     an der er entsteht – Datenblatt, 3MF, Slicen und Kosten nutzen dann dieselben Werte. sugg = Vorschlag. */
  const ov=I.overrides||{},sugg={},has=k=>ov[k]!==undefined&&ov[k]!==null&&ov[k]!=='';
  const take=(k,v)=>{sugg[k]=v;return has(k)?ov[k]:v};
  /* Kobra S1 (geschlossen, mit Hilfs- und Abluftlüfter): Vorgaben je Filamentart (2026-10-04) – ABS/ASA warm halten
     (Hilfslüfter aus, Abluft fast zu, Bett 100 °C, 10 min vorwärmen, immer Brim), PETG weniger Luft. Das Orca-Profil
     hat für beide Lüfter 60 %. Alles lässt sich unter „Werte für diesen Auftrag“ überschreiben. */
  const s1=printer.id==='kobra_s1',S1P={pla:{aux:60,box:60},petg:{aux:30,box:40},abs:{aux:0,box:10,bed:100,preheat:10,brim:true},
    asa:{aux:0,box:10,bed:100,preheat:10,brim:true},tpu:{aux:30,box:60}}[m.kind]||{aux:60,box:60};
  m=Object.assign({},m);
  m.bed=take('bed',s1&&S1P.bed?Math.max(m.bed,S1P.bed):m.bed);m.fan=take('fan',m.fan);
  const fans2=s1,fanAux=s1?take('fan_aux',S1P.aux):null,fanBox=s1?take('fan_box',S1P.box):null;
  // Kobra S1: Hilfs- und Gehäuselüfter immer schreiben (Vorgabe je Filament oder dein Wert)
  const fans2Set=s1?{aux:+fanAux,box:+fanBox}:null;
  const preheatMin=s1&&S1P.preheat?S1P.preheat:0;
  const effectiveStatus=(m.status==='tested'&&!printer.testedOK)?'generic':m.status;
  const short=m.name;
  const base=Object.assign({},tpu?ob.tpu:ob.pla);
  const pi=g==='quality'?0:g==='fast'?2:1;
  const warn=[],danger=[];

  // Düse: Umrechnung vom Referenzprofil auf die gewählte Düse
  const dSel=nkey(I.nozD),mSel=I.nozM;
  const N=NOZ[dSel]||NOZ['0.4'],refKey=nkey(m.refD||0.4),R=NOZ[refKey]||NOZ['0.4'],refMat=m.refMat||'steel_hardened';
  const S=ctx.settings;
  const refFamily=(NOZZLE_MATERIALS[refMat]||NOZZLE_MATERIALS.steel_hardened).thermalFamily;
  const selFamily=(NOZZLE_MATERIALS[mSel]||NOZZLE_MATERIALS.steel_hardened).thermalFamily;
  let volF=N.v/R.v,tOff=0;
  if(selFamily!==refFamily){if(selFamily==='steel'){tOff=+S.steelOffset;volF*=+S.steelVol}else{tOff=-S.steelOffset;volF/=+S.steelVol}}
  const maxVol=take('max_vol',Math.round(m.maxVol*volF*10)/10);
  // Filament-Werte: Vorschlag = Profil (alles unter „Werte für diesen Auftrag“ einstellbar, 2026-10-04)
  m.flow=take('flow',m.flow);m.zhop=take('zhop',m.zhop);m.gap=take('sp_gap',m.gap);m.fanFirst=take('fan_first',+m.fanFirst||0);
  if(m.pa!=null&&m.pa!==''||has('pa'))m.pa=take('pa',m.pa);
  // Wasserdicht: etwas heißer für besser verschmelzende Schichten, langsamere Außenwand
  const wtBoost=o==='watertight'?WATERTIGHT_TEMP_BOOST:0;
  const nozzle=take('nozzle',Math.round(m.nozzle[pi]+tOff+wtBoost));
  const nozzleFirst=take('nozzle_first',nozzle),firstLayer=take('first_layer',N.fl);
  const nozLabel=de(+dSel,dSel==='0.25'?2:1)+' mm '+NOZZLE_MATERIALS[mSel].label;

  // Schichthöhe
  let layer=tpu?N.lh[1]:N.lh[pi];
  if(!tpu&&o==='precision'&&g!=='fast')layer=Math.min(layer,N.lh[0]);
  if(geom&&geom.z<4)layer=N.lh[0];
  layer=take('layer',layer);

  // Struktur
  let w=base.w,tt=base.t,b=base.b,inf=base.i,pattern='Gyroid';
  const soft=!!ob.soft&&tpu;
  if(!soft){
    if(l==='medium'){w+=1;inf+=5}
    if(l==='high'){w+=2;inf=Math.max(inf,30);pattern='Gyroid oder Kubisch'}
    if(g==='strong'){w+=1;inf+=10;pattern='Gyroid oder Kubisch'}
    tt=Math.max(tt,Math.ceil(0.8/layer-1e-9));b=Math.max(b,Math.ceil(0.6/layer-1e-9));
  }else if(o==='tire'&&l==='high'){inf=25}
  w=take('w',w);tt=take('t',tt);b=take('b',b);inf=take('inf',inf);pattern=take('pattern',pattern);
  if(ob.tpuOnly&&!tpu)warn.push(t('<b>Hinweis:</b> „{obj}“ ist ein TPU-Objekt. Mit {mat} wird es steif; die Werte sind allgemeine Startwerte.',{obj:t(ob.label),mat:esc(short)}));

  // Geschwindigkeiten (Slicer-Wert + effektive Grenze durch Volumenstrom)
  let top=m.top;if(o==='multicolor'||o==='precision'||g==='quality')top=Math.min(top,tpu?20:40);
  top=take('sp_top',top);
  const capNote=(v,lw)=>{const c=Math.floor(maxVol/(layer*lw));return v>c?t('effektiv ca. {v} mm/s (Grenze {max} mm³/s)',{v:c,max:de(maxVol,1)}):''};
  const sp_outer=take('sp_outer',o==='watertight'?Math.round(m.outer[pi]*WATERTIGHT_OUTER_FACTOR):m.outer[pi]),sp_inner=take('sp_inner',m.inner[pi]),sp_fill=take('sp_fill',m.fill[pi]);
  const nOuter=capNote(sp_outer,N.lwo),nInner=capNote(sp_inner,N.lw),nFill=capNote(sp_fill,N.lw);
  const sp_travel=take('sp_travel',m.travel),sp_first=take('sp_first',m.first),accel=take('accel',+m.accel||0);
  const accelTxt=accel>0?de(accel,0)+' mm/s²':t('Werksprofil beibehalten');
  const accelNote=accel>0?'':t('bei Ringing reduzieren');
  /* Rückzug bleibt beim Orca-Standard (Filament- bzw. Druckerprofil des Slots) – außer du setzt ihn unter „Werte für
     diesen Auftrag“ (2026-10-03); der Wert aus den S1-Tests ist sonst nur Richtwert */
  sugg.retr_len=m.retrLen;sugg.retr_speed=m.retrSpeed;
  const retrSet=has('retr_len')||has('retr_speed');
  const retr=retrSet?{len:+(has('retr_len')?ov.retr_len:m.retrLen),speed:+(has('retr_speed')?ov.retr_speed:m.retrSpeed)}:null;
  const retrTxt=de(m.retrLen,1)+' mm / '+de(m.retrSpeed,0)+' mm/s';
  const retrRow=retr?['Rückzug',de(retr.len,1)+' mm / '+de(retr.speed,0)+' mm/s',t('von dir gesetzt – sonst Orca-Standard'),true]
    :['Rückzug',t('Orca-Standard'),t('Richtwert {v} (am S1 getestet)',{v:retrTxt})];
  const enclosed=m.kind==='abs'||m.kind==='asa';

  // Stützen
  const a=geom?analyze(geom,+I.thresh):null;
  let supOn=false,sup,supNeed;
  if(o==='dumpling'&&tpu){
    sup='Geometrie prüfen';supNeed=t('Vor dem Druck die Schichtvorschau prüfen: Die Oberseite darf keine freien Bahnen oder Löcher zeigen.');
  }else if(!a){
    sup=s==='avoid'?'Nur bei zwingender Geometrie':'Nach Überhang prüfen';
    supNeed=t('Noch keine STL geladen. In der Slicer-Vorschau die Überhangfarbe prüfen.');
    supOn=o==='overhang'&&s!=='avoid';
  }else if(a.level==='none'){
    sup='Nicht nötig';supNeed=t('Keine relevanten Überhänge über {th}°. Flächen, die auf dem Druckbett liegen, werden nicht mitgezählt. Kleine Fasen und Bohrungen druckt der Slicer ohne Stütze.',{th:a.th});
  }else if(a.level==='few'){
    if(s==='allow'){supOn=true;sup='Ja – wenige Baumstützen';}
    else{sup='Meist nicht nötig – Vorschau prüfen';}
    supNeed=t('Einzelne Überhänge (ca. {area} mm², {pct} % der Oberfläche). Meist druckbar; nur stützen, wenn die Vorschau frei hängende Bahnen zeigt.',{area:de(a.flagged,0),pct:de(a.ratio*100,1)});
  }else{
    if(s==='avoid'){sup='Vermeiden: zuerst Modell drehen';supNeed=t('Deutliche Überhänge (ca. {area} mm²). Vor dem Aktivieren von Stützen das Modell im Slicer drehen oder um 10–20° kippen – das reduziert Stützen oft mehr als jede Einstellung. Nur wenn das nicht reicht, Baumstützen aktivieren.',{area:de(a.flagged,0)})}
    else{supOn=true;sup='Ja – Baumstützen';supNeed=a.ceiling>50?t('Deutliche Überhänge erkannt (ca. {area} mm², {pct} % der Oberfläche, davon ca. {flat} mm² fast waagerecht). Baumstützen ab Druckbett.',{area:de(a.flagged,0),pct:de(a.ratio*100,1),flat:de(a.ceiling,0)})
      :t('Deutliche Überhänge erkannt (ca. {area} mm², {pct} % der Oberfläche). Baumstützen ab Druckbett.',{area:de(a.flagged,0),pct:de(a.ratio*100,1)})}
  }

  sugg.support=supOn?'on':'off';
  if(has('support')){supOn=ov.support==='on';sup=supOn?'Ja – Baumstützen (angepasst)':'Aus (angepasst)'}
  // „Nur kritische Bereiche“ (Orca: Stützen nur für Spitzen und Auskragungen, normale Überhänge nicht) –
  // Vorschlag an wie in v4, je Auftrag umschaltbar (Werte anpassen). Geprüft 2026-09-29: ACE-Guide mit an 0, mit aus 110 Stützbahnen.
  sugg.critical='on';
  const supCritical=has('critical')?ov.critical==='on':true;

  // Haftung
  let brim='Nicht nötig',brimNote='';
  if(geom){
    const foot=Math.max(1,geom.bedArea),slender=geom.z/Math.sqrt(foot),big=Math.max(geom.x,geom.y);
    if(foot<150||slender>4){brim='5–8 mm';brimNote=t('kleine Aufstandsfläche erkannt ({area} mm²)',{area:de(foot,0)})}
    else if(enclosed&&(big>80||(s1&&S1P.brim))){brim='5 mm';brimNote=t('ABS/ASA neigt zum Verziehen – ohne Spalt am Teil')}
    else if(big>110&&!tpu){brimNote=t('großes flaches Teil: wenn Ecken abheben, 3–5 mm Brim oder Mausohren')}
  }
  if(o==='tire'&&tpu&&brim==='Nicht nötig'){brim='0–5 mm';brimNote=t('bei Haftungsproblemen')}
  sugg.brim=brim;
  // Abstand Brim ↔ Teil: ABS/ASA ohne Spalt (sonst reißt der Brim ab), sonst 0,1 mm wie im Orca-Profil
  const brimGap=take('brim_gap',enclosed?0:0.1);
  if(has('brim')){brim=ov.brim;brimNote=''}

  // Naht
  const round=['tire','dumpling','case','decor','overhang'].includes(o);
  const seam=take('seam',round?'Ausgerichtet':'Hinten');
  const fanNote=tpu?'30–45 %':enclosed?t('niedrig halten'):'';

  // Übersicht; angepasste Werte bekommen den Vorschlag als Hinweis und eine Markierung (4. Feld)
  const changed=Object.keys(sugg).filter(k=>has(k)&&String(ov[k])!==String(sugg[k]));
  const fmtS=k=>{const v=sugg[k];return k==='layer'?de(v,2)+' mm':k==='nozzle'||k==='bed'?v+' °C':k==='inf'||k==='fan'||k==='fan_aux'||k==='fan_box'?v+' %':/^sp_/.test(k)||k==='retr_speed'?v+' mm/s':k==='accel'?(v>0?v+' mm/s²':t('Werksprofil')):k==='retr_len'||k==='zhop'?de(v,1)+' mm':k==='first_layer'||k==='brim_gap'?de(v,2)+' mm':k==='max_vol'?de(v,1)+' mm³/s':k==='nozzle_first'?v+' °C':k==='flow'?de(v,2):k==='pa'?de(v,3):k==='fan_first'?v+' %':k==='support'||k==='critical'?(v==='on'?t('an'):t('aus')):t(String(v))};
  const mark=(keys,row)=>{const c=keys.filter(k=>changed.includes(k));return c.length?[row[0],row[1],[t('angepasst – Vorschlag {v}',{v:c.map(fmtS).join(' / ')}),row[2]].filter(Boolean).join(' · '),true]:row};
  const rows=[
    mark(['nozzle'],['Düse',nozzle+' °C',[tOff?t('{d} °C für {mat}',{d:(tOff>0?'+':'−')+Math.abs(tOff),mat:NOZZLE_MATERIALS[mSel].label}):'',wtBoost?t('+{d} °C für dichte Schichten',{d:wtBoost}):''].filter(Boolean).join(' · ')]),mark(['bed'],['Heizbett',m.bed+' °C',esc(t(m.bedNote))]),
    mark(['layer','first_layer'],['Schichthöhe / erste Schicht',de(layer,2)+' / '+de(firstLayer,2)+' mm']),
    mark(['sp_outer','sp_inner'],['Außenwand / Innenwand',sp_outer+' / '+sp_inner+' mm/s',nOuter||nInner]),mark(['sp_fill','sp_travel'],['Füllung / Travel',sp_fill+' / '+sp_travel+' mm/s',nFill]),
    mark(['w'],['Wandlinien',base.wr&&soft&&!has('w')?base.wr:w]),mark(['t','b'],['Obere / untere Schichten',tt+' / '+b]),
    mark(['inf','pattern'],['Fülldichte / Muster',(base.ir&&soft&&!has('inf')?base.ir:inf+' %')+' / '+t(pattern)]),
    mark(['fan'],['Lüfter',m.fan+' %',fanNote]),
    ...(fans2?[mark(['fan_aux','fan_box'],['Hilfs- / Gehäuselüfter',fanAux+' % / '+fanBox+' %',S1P.box<=20?t('Gehäuse warm halten ({kind})',{kind:KIND_LABEL[m.kind]||m.kind}):''])]:[]),['Max. Volumenstrom',de(maxVol,1)+' mm³/s',volF!==1?t('umgerechnet für {noz}',{noz:nozLabel}):''],
    mark(['accel'],['Beschleunigung',accelTxt,accelNote]),retrRow,mark(['support'],['Support',t(sup)]),mark(['brim'],['Brim',t(brim),brimNote])
  ];

  const supZ=supportZGap(layer,m.kind,tpu);
  const ordered=[
    ['Qualität',[
      ['Schichthöhe',de(layer,2)+' mm'],mark(['first_layer'],['Höhe der ersten Schicht',de(firstLayer,2)+' mm']),['Linienbreite Standard',de(N.lw,2)+' mm'],['Linienbreite erste Schicht',de(N.lwf,2)+' mm'],
      ['Linienbreite Außenwand',de(N.lwo,2)+' mm'],['Linienbreite Innenwand',de(N.lw,2)+' mm'],['Elefantenfußkompensation',enclosed?de(0.15,2)+' mm':de(0.1,1)+' mm'],
      mark(['seam'],['Nahtposition',t(seam)]),['Glätten',t('Keine'),o==='decor'?t('nur bei großen flachen Oberseiten „Obere Oberfläche“'):'']]],
    ['Struktur',[
      ['Wandlinien',base.wr&&soft?base.wr:w],['Obere Schichten',tt],['Untere Schichten',b],
      ['Fülldichte',base.ir&&soft?base.ir:inf+' %'],['Füllmuster',t(pattern)],['Lückenfüllung',t('Überall')]]],
    ['Geschwindigkeit',[
      mark(['sp_first'],['Erste Schicht',sp_first+' mm/s']),['Füllung erste Schicht',Math.max(sp_first,tpu?20:sp_first)+' mm/s'],['Außenwand',sp_outer+' mm/s',nOuter],['Innere Wand',sp_inner+' mm/s',nInner],
      ['Füllung',sp_fill+' mm/s',nFill],mark(['sp_top'],['Obere Fläche',top+' mm/s']),mark(['sp_gap'],['Lückenfüllung',m.gap+' mm/s']),mark(['sp_travel'],['Travel',sp_travel+' mm/s']),
      mark(['accel'],['Beschleunigung',accelTxt,accelNote]),retrRow].concat(tpu?[['Überhänge','15 / 12 / 10 mm/s'],['Brücken extern / intern','15 / 20 mm/s']]:[])],
    ['Stützen',supOn?[
      ['Stützstrukturen',t('Aktivieren')],['Typ',t('Baum (automatisch)')],['Schwellenwinkel',sp.angle+'°'],mark(['critical'],['Nur kritische Bereiche',t(supCritical?'Ein':'Aus')]),
      ['Nur auf Druckplatte',t('Ein, zuerst testen')],['Kleine Überhänge entfernen',t(sp.small)],['Raft',t('0 Schichten')],
      ['Oberer Z-Abstand',de(supZ.top,2)+' mm'],['Unterer Z-Abstand',de(supZ.bottom,2)+' mm'],['Stützen/Objekt XY-Abstand',sp.xy],
      ['Obere Schnittstellenschichten',sp.iface],['Untere Schnittstellenschichten','1'],['Schnittstellenabstand',sp.gap],
      // bisher im eigenen Abschnitt „Stützparameter“ – jetzt alles an einer Stelle
      ['Wände um Stützstrukturen','0'],['Abstand Grundmuster',tpu?de(3,1)+' mm':de(2.5,1)+'–'+de(3,1)+' mm'],
      ['Stützen/Objekt Abstand erste Schicht',tpu?de(0.25,2)+' mm':de(0.2,2)+' mm'],['Stützspitze',de(0.8,1)+' mm'],
      ['Ast-Dichte',sp.density],['Astabstand',sp.branch],['Stützast-Durchmesser',de(2,1)+' mm']
    ]:[['Stützstrukturen',t('Nicht aktivieren'),sup==='Nicht nötig'?'':t(sup)],['Raft',t('0 Schichten')]]],
  ];
  if(o==='multicolor'){
    if(printer.multicolorSystem==='ace'){
      ordered.push(['Multimaterial',[
        ['Reinigungsturm',t('Ein, Breite 30–35 mm'),t('kostet weniger Material als der Standardturm')],
        ['In Füllung spülen',t('Ein'),t('„In dieses Objekt spülen“ aus lassen')],
        ['Reinigungsvolumen',t('Multiplikator {f}',{f:de(0.8,1)}),t('Wechsel zu Weiß bei Verfärbung wieder erhöhen')],
        ['Filament-Zuordnung',t('Slicer-Farbe = ACE-Fach'),t('vor „Druck starten“ im Dialog prüfen')]]]);
    }else{
      ordered.push(['Mehrfarbig (Werkzeugwechsler)',[
        ['Werkzeugwechsel',t('Automatisch pro Farbe/Material'),t('kein Reinigungsturm nötig – jeder Kopf bleibt vorgeheizt')],
        ['Werkzeug-Zuordnung',t('Slicer-Farbe = Toolhead-Slot'),t('vor Druckstart in OrcaSlicer prüfen')],
        ['Rüstzeit pro Wechsel',t('ca. 5 s laut Hersteller'),t('wirkt sich kaum auf die Gesamtdruckzeit aus')]]]);
    }
  }
  const dryNeed=tpu||m.kind==='petg'||m.abrasive;
  ordered.push(['Material / Filament',[
    ['Profilname',esc(m.name)],['Düse',nozzle+' °C',t('erste und weitere Schichten')],['Herstellerbereich',esc(m.range)||t('Angabe auf der Rolle')],
    ['Heizbett',m.bed+' °C',esc(t(m.bedNote))],mark(['fan_first'],['Lüfter erste Schicht',m.fanFirst+' %']),['Lüfter Folgeschichten',m.fan+' %',fanNote],
    mark(['max_vol'],['Maximale Volumengeschwindigkeit',de(maxVol,1)+' mm³/s']),mark(['flow'],['Durchflussverhältnis',de(m.flow,2)])]
    .concat(m.pa!=null&&m.pa!==''?[mark(['pa'],['Pressure Advance',de(m.pa,3)])]:[]).concat([retrRow,['Filament trocken',dryNeed?t('Ja, unbedingt'):t('Ja'),esc(t(m.dry))]])]);
  ordered.push(['Sonstiges',[['Düsendurchmesser',nozLabel],mark(['brim','brim_gap'],['Brim',t(brim)+(brim!=='Nicht nötig'?' · '+t('Abstand {g} mm',{g:de(brimGap,2)}):''),brimNote]),mark(['zhop'],['Z-Hop',de(m.zhop,1)+' mm']),['Erste Schicht beobachten',t('Ja')]]]);
  // Für diesen Auftrag angepasste Werte auch in der Slicer-Reihenfolge markieren (wie in der Übersicht)
  const ORDER_KEYS={'Schichthöhe':['layer'],'Wandlinien':['w'],'Obere Schichten':['t'],'Untere Schichten':['b'],'Fülldichte':['inf'],'Füllmuster':['pattern'],
    'Außenwand':['sp_outer'],'Innere Wand':['sp_inner'],'Füllung':['sp_fill'],'Düse':['nozzle'],'Heizbett':['bed'],'Lüfter Folgeschichten':['fan'],'Brim':['brim'],'Stützstrukturen':['support']};
  ordered.forEach(g=>{g[1]=g[1].map(row=>row[3]||!ORDER_KEYS[row[0]]?row:mark(ORDER_KEYS[row[0]],row))});

  // Warnungen / Hinweise
  if(m.abrasive&&!NOZZLE_MATERIALS[mSel].hardened)danger.push(t('Faserverstärktes Filament schleift nicht gehärtete Düsen ({mat}) schnell aus. Nur mit gehärteter Stahldüse drucken.',{mat:esc(NOZZLE_MATERIALS[mSel].label)}));
  if(m.abrasive&&dSel==='0.25')danger.push(t('Faserverstärkte Filamente verstopfen 0,25-mm-Düsen leicht – mindestens 0,4 mm, besser 0,6 mm verwenden.'));
  if(tpu&&o==='multicolor'&&printer.multicolorSystem==='ace')danger.push(t('TPU in der Regel nicht über die ACE-Pro-Station zuführen, sondern über den externen Spulenhalter (Herstellerangabe prüfen).'));
  if(printer.orca&&printer.orca.fixedStartTemp&&printer.orca.fixedStartTemp!==nozzle)danger.push(t('Der Start-G-Code im OrcaSlicer-Profil von {printer} heizt fest auf {fixed} °C – Orca setzt dann keine eigene Düsentemperatur, gedruckt wird mit {fixed} statt {nozzle} °C. Im Druckerprofil den Start-G-Code auf „M109 S[nozzle_temperature_initial_layer]“ ändern.',{printer:esc(printer.label),fixed:printer.orca.fixedStartTemp,nozzle}));
  if(printer.orca)warn.push(t('<b>{printer}:</b> Temperaturen und Materialwerte stammen aus Tests am Kobra S1 und sind hier allgemeine Startwerte. Geschwindigkeiten, Beschleunigung und Volumenstrom sind auf das OrcaSlicer-Profil dieses Druckers begrenzt. Ersten Druck beobachten und über „Werte anpassen“ nachjustieren.',{printer:esc(printer.label)}));
  if(printer.id==='snapmaker_u1')warn.push(t('<b>Snapmaker U1:</b> Temperatur- und Geschwindigkeitswerte sind von Anycubic-Tests übernommen, nicht auf dem U1 gegengetestet. Der U1 kann mechanisch deutlich mehr (CoreXY, laut Hersteller bis 500 mm/s) – vorsichtig steigern und die ersten Schichten sowie die Schichtvorschau genau beobachten.'));

  if(m.notes)warn.push(t('<b>Deine Notizen:</b>')+' '+esc(m.notes).replace(/\n/g,'<br>'));
  if(dSel!==refKey||mSel!==refMat)warn.push(t('<b>Umgerechnet:</b> Das Profil gilt für {ref}, gewählt ist {sel}. Temperatur {temp}, Volumenstrom ×{vol}, Schichthöhe und Linienbreite angepasst. Das ist eine Näherung – nach dem ersten Druck prüfen und über „Werte anpassen“ speichern.',
    {ref:de(+refKey,refKey==='0.25'?2:1)+' mm '+(NOZZLE_MATERIALS[refMat]||NOZZLE_MATERIALS.steel_hardened).label,sel:nozLabel,temp:tOff?(tOff>0?'+':'−')+Math.abs(tOff)+' °C':t('unverändert'),vol:de(volF,2)}));
  if(dSel==='0.25')warn.push(t('<b>Feine Düse:</b> Nur für sehr kleine Details sinnvoll; die Druckzeit steigt stark.')+(printer.brassNozzleNote?' '+t('Anycubic bietet die 0,25-mm-Düse für den S1 als Messingdüse an.'):''));
  if(o==='dumpling'&&tpu)warn.push(t('<b>Quetschbares Teil:</b> Richtwert 2 Wände, 3 obere und 3 untere Schichten, 5 % Gyroid. Sehr dünne Schalen (1 Wand, 0 % Füllung) geben der Deckschicht keine Auflage. Für weicheres Ergebnis nur die Fülldichte senken und in der Vorschau prüfen. Bei Kinderspielzeug auf lose Fäden, scharfe Kanten und verschluckbare Kleinteile achten.'));
  if(tpu)warn.push(t('<b>TPU:</b> Bewusst langsam. Schnelle Werksprozessprofile sind für TPU ungeeignet – im Slicer ein eigenes, langsames Prozessprofil speichern und auswählen.'));
  if(m.kind==='petg')warn.push(t('<b>PETG:</b> Haftet auf glatter PEI-Platte sehr stark – Klebestift als Trennschicht verwenden, sonst kann die Beschichtung ausreißen. Neigt zu Fäden: bei Bedarf Rückzug leicht erhöhen.'));
  if(enclosed){
    if(printer.enclosureBuiltin)warn.push(t('<b>{kind}:</b> Haube und Tür geschlossen lassen, Lüfter niedrig halten, Bett vor dem Start einige Minuten vorheizen. Beim Drucken entstehen Styrol-Dämpfe und ultrafeine Partikel – Raum gut lüften, nicht in Wohn- oder Schlafräumen drucken.',{kind:KIND_LABEL[m.kind]}));
    else warn.push(t('<b>{kind}:</b> Der {printer} hat serienmäßig kein Gehäuse. Für ABS/ASA möglichst die optionale Top Cover verwenden oder zumindest für eine zugluftfreie, gut belüftete Umgebung sorgen; Bett vor dem Start einige Minuten vorheizen. Beim Drucken entstehen Styrol-Dämpfe und ultrafeine Partikel – Raum gut lüften, nicht in Wohn- oder Schlafräumen drucken.',{kind:KIND_LABEL[m.kind],printer:esc(printer.label)}));
  }
  if(m.kind==='pla'&&printer.enclosureBuiltin)warn.push(t('<b>PLA im geschlossenen Drucker:</b> Bei langen Drucken den Deckel etwas öffnen – zu warme Luft im Bauraum kann Hitzestau im Hotend verursachen.'));
  if(effectiveStatus==='generic')warn.push(t('<b>{mat}:</b> Allgemeine Startwerte. Nach dem ersten Druck anpassen und über „Werte anpassen“ als eigene Werte speichern. Bei matter oder lückiger Oberfläche die maximale Volumengeschwindigkeit um 2–3 mm³/s senken.',{mat:esc(short)}));
  if(o==='precision')warn.push(t('<b>Präzisionsteil:</b> Vorher einen kleinen Testkörper mit dem kritischen Maß drucken und nachmessen. Weichen die Maße systematisch ab, das Durchflussverhältnis oder die X-Y-Konturkompensation anpassen.'));
  if(o==='multicolor')warn.push(t('<b>Mehrfarbig:</b> Jeder Farbwechsel kostet Zeit und Spülmaterial. Kleine Details in einer eigenen Farbe verursachen viele zusätzliche Wechsel. Eine größere Schichthöhe reduziert die Zahl der Wechsel.'));
  if(o==='overhang'&&!a)warn.push(t('<b>Freiform:</b> Zuerst die Ausrichtung prüfen. Das Modell um 10–20° zu kippen reduziert Stützen oft deutlicher als jede Parameteränderung.'));
  if(o==='watertight')warn.push(t('<b>Wasserdicht:</b> Dicht wird ein Teil über die Wand: {w} Wandlinien, {t} / {b} Deck-/Bodenschichten, +{boost} °C und eine langsamere Außenwand sind gesetzt; im Slicer „Lückenfüllung überall“. Lüfter eher niedrig halten. PETG und ASA werden dichter als PLA. Einfache Gefäße ohne Deckel: Vasenmodus mit breiter Linie (0,6–0,8 mm) ist oft dichter. Für dauerhaften Wasserkontakt oder Druck innen mit Epoxidharz beschichten. Nicht für Trinkwasser oder Lebensmittel geeignet – nach dem Druck mit Wasser testen.',{w,t:tt,b,boost:WATERTIGHT_TEMP_BOOST}));
  if(o==='thin')warn.push(t('<b>Dünnwandig:</b> In der Vorschau prüfen, ob schmale Wände wirklich Bahnen bekommen. Bei zu dünnen Stellen im Slicer „Dünne Wände erkennen“ aktivieren.'));

  return {m,ob,o,g,tpu,layer,sp,rows,ordered,sup,supOn,supCritical,supNeed,warn,danger,a,nozLabel,dryNeed,printer,effectiveStatus,
    nozzle,w,t:tt,b,inf,sp_outer,sp_inner,sp_fill,sp_travel,sp_first,accel,retr,fans2:fans2Set,preheatMin,dSel,top,pattern,
    // Neu seit v5 (für den 3MF-Export); tests/compare-v4.js blendet diese Felder aus.
    maxVol,firstLayer,nozzleFirst,brimGap,brim,seam,supZ,
    // Anpassungen: Vorschlag je Wert und welche tatsächlich abweichen (Dialog „Werte für diesen Auftrag“)
    suggested:sugg,changed};
}
