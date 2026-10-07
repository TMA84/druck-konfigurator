'use strict';
/* Konfigurator-Panel: Auswahl, Ergebnisanzeige, Editor, Import/Export – aus v4. */
let project=null;    // geladenes Modell: {name, parts:[{name, geom, extruder, plate}], selected, threemf, notes}
let geom=null;       // Analyse des gewählten Teils (makeGeom)
let lastOrdered=[];
let lastResult=null;  // letztes compute()-Ergebnis, für den 3MF-Export
let orcaFilamentJson='',orcaProcessJson='';

function currentPrinter(){return PRINTERS[$('printer').value]||PRINTERS.kobra_s1}
function fillNozzleMaterialSelect(){
  const p=currentPrinter(),sel=$('nozM'),cur=sel.value;
  sel.innerHTML=p.nozzleOptions.map(k=>'<option value="'+k+'"'+(k===p.nozzleDefault?' selected':'')+'>'+esc(NOZZLE_MATERIALS[k].label)+'</option>').join('');
  if(p.nozzleOptions.includes(cur))sel.value=cur;
}

$('supportLevel').addEventListener('change',()=>{const a=supportProfile($('supportLevel').value).angle;$('thresh').value=a;$('threshVal').textContent=a+'°';Viewer.colorize(+$('thresh').value)});
['material','nozD','nozM'].forEach(id=>$(id).addEventListener('change',()=>{store.last[id]=$(id).value;persist();update()}));
['object','goal','load','support','supportLevel'].forEach(id=>$(id).addEventListener('change',update));
$('printer').addEventListener('change',()=>{store.last.printer=$('printer').value;persist();fillNozzleMaterialSelect();store.last.nozM=$('nozM').value;persist();update()});

// Speichert und zeigt einen Hinweis, wenn der Browser kein dauerhaftes Speichern erlaubt.
function persist(){
  const ok=saveStore(),w=$('storeWarn');
  if(!ok){w.innerHTML=t('<b>Hinweis:</b> Dieser Browser erlaubt hier kein dauerhaftes Speichern. Deine Werte gelten nur bis zum Schließen – bitte über <b>Exportieren</b> sichern.');w.classList.remove('hidden')}
  else w.classList.add('hidden');
  return ok;
}
function currentInput(){
  const I={};
  ['printer','material','nozD','nozM','object','goal','load','support','supportLevel','thresh'].forEach(id=>{I[id]=$(id).value});
  // Anpassungen des gewählten Teils (js/overrides-ui.js)
  const part=project&&project.parts[project.selected];
  if(part&&part.overrides)I.overrides=part.overrides;
  return I;
}

// Kennwert-Kachel für die Übersicht; die ersten Zeilen (Temperaturen, Schichthöhe) sind hervorgehoben.
const KEY_ROWS=['Düse','Heizbett','Schichthöhe / erste Schicht'];
/* Druckwerte als Kacheln nach Thema (2026-10-07): alle Werte sichtbar – Orca-Liste (r.ordered), Lüfter, weitere
   Orca-Einstellungen (js/orca-extra.js); nichts eingeklappt. Angepasste Werte hervorgehoben, Kachel anklicken öffnet den
   Dialog bei dem Wert, „✎ anpassen“ den Reiter des Themas. */
const ROW_OV={'Düse':'nozzle','Heizbett':'bed','Lüfter':'fan','Lüfter Folgeschichten':'fan','Lüfter erste Schicht':'fan_first','Hilfs- / Gehäuselüfter':'fan_aux',
  'Schichthöhe / erste Schicht':'layer','Schichthöhe':'layer','Höhe der ersten Schicht':'first_layer','Nahtposition':'seam',
  'Wandlinien':'w','Obere / untere Schichten':'t','Obere Schichten':'t','Untere Schichten':'b','Fülldichte / Muster':'inf','Fülldichte':'inf','Füllmuster':'pattern',
  'Außenwand / Innenwand':'sp_outer','Außenwand':'sp_outer','Innere Wand':'sp_inner','Füllung / Travel':'sp_fill','Füllung':'sp_fill','Travel':'sp_travel',
  'Erste Schicht':'sp_first','Obere Fläche':'sp_top','Lückenfüllung':'sp_gap','Beschleunigung':'accel','Rückzug':'retr_len',
  'Max. Volumenstrom':'max_vol','Maximale Volumengeschwindigkeit':'max_vol','Durchflussverhältnis':'flow','Pressure Advance':'pa','Z-Hop':'zhop',
  'Support':'support','Stützstrukturen':'support','Nur kritische Bereiche':'critical','Brim':'brim',
  'Lüfter erste Schicht':'fan_first','Hilfs- / Gehäuselüfter':'fan_aux','Maximale Volumengeschwindigkeit':'max_vol'};
const ROW_OV_T=Object.fromEntries(Object.entries(ROW_OV).map(([k,v])=>[t(k),v]));
const ORDER_THEME={'Qualität':'Qualität','Struktur':'Struktur','Geschwindigkeit':'Tempo','Stützen':'Stützen','Material / Filament':'Filament','Sonstiges':'Sonstiges'};
const ROW_THEME={'Düse':'Temperatur','Heizbett':'Temperatur','Herstellerbereich':'Temperatur','Lüfter erste Schicht':'Kühlung','Lüfter Folgeschichten':'Kühlung',
  'Hilfs- / Gehäuselüfter':'Kühlung','Maximale Volumengeschwindigkeit':'Tempo','Brim':'Brim & Haftung','Düsendurchmesser':'Sonstiges','Profilname':'Filament','Rückzug':'Filament'};
// Zeilen der Orca-Liste, die als weitere Orca-Einstellung (mit eigenem Wert und Anpassung) gezeigt werden
const ROW_AS_EXTRA={'Linienbreite Standard':'line_width','Linienbreite erste Schicht':'initial_layer_line_width','Linienbreite Außenwand':'outer_wall_line_width',
  'Elefantenfußkompensation':'elefant_foot_compensation','Raft':'raft_layers','Glätten':'ironing_type'};
const EXTRA_THEME={'Stützen':'Stützen','Qualität':'Qualität','Oberflächen':'Oberflächen','Brim & Haftung':'Brim & Haftung','Sonstiges':'Sonstiges'};
// Werte der weiteren Orca-Einstellungen: deine Anpassung, sonst Rechnung des Tools, sonst Druckerprofil (einmal je update)
function extraValues(r){
  const set=r.extraOv||{},out={};if(typeof ORCA_EXTRA==='undefined')return out;
  let pc=[],tpl=null;try{pc=plannedChanges({...r,extraOv:{}},0,null)}catch(e){}try{tpl=exportTemplate(r.printer.id,r.dSel)}catch(e){}
  for(const f of ORCA_EXTRA){const k=f[0];if(k in set){out[k]=set[k];continue}
    const c=pc.filter(c=>c.key===k&&!c.perSlot).pop();let v=c?c.value:tpl&&tpl.settings?tpl.settings[k]:undefined;if(Array.isArray(v))v=v[0];if(v!==undefined&&v!=='')out[k]=v}
  return out;
}
function themeCards(r){
  const by=Object.fromEntries(VALUE_THEMES.map(th=>[th,[]])),seen=new Set();
  const add=(th,x,key)=>{const id=th+'|'+x[0];if(seen.has(id))return;seen.add(id);(by[th]||by.Sonstiges).push([x,key])};
  for(const [g,rows] of r.ordered){if(!ORDER_THEME[g])continue;
    for(const x of rows){if(ROW_AS_EXTRA[x[0]])continue;add(ROW_THEME[x[0]]||ORDER_THEME[g],x,ROW_OV_T[t(x[0])]||null)}}
  const aux=r.rows.find(x=>x[0]==='Hilfs- / Gehäuselüfter');if(aux)add('Kühlung',aux,'fan_aux');
  const xv=extraValues(r),set=r.extraOv||{};
  for(const f of (typeof ORCA_EXTRA==='undefined'?[]:ORCA_EXTRA)){const k=f[0];if(!(k in xv))continue;
    if(/^(support_|tree_support)/.test(k)&&!r.supOn&&!(k in set))continue;   // Stützen-Details nur, wenn gestützt wird
    add(EXTRA_THEME[f[2]]||'Sonstiges',[f[1],esc(extraLabel(k,xv[k])),'',k in set],'x:'+k)}
  return VALUE_THEMES.filter(th=>by[th].length).map(th=>{const n=by[th].filter(([x])=>x[3]).length;
    return '<section class="spec-group th-card"><h3 class="spec-title">'+esc(t(th))+(n?' <span class="ov-count">'+t('{n} angepasst',{n})+'</span>':'')+
      (project?' <button type="button" class="linkbtn small spec-edit" data-ov-group="'+esc(t(th))+'">'+esc(t('✎ anpassen'))+'</button>':'')+'</h3>'+
      '<div class="vl">'+by[th].map(([x,key])=>valueRow(x,key)).join('')+'</div></section>'}).join('');
}
// Zeile einer Themenkarte: Bezeichnung … Wert (rechtsbündig), Notiz klein darunter; angepasst = Petrol-Markierung
function valueRow(x,key){
  const h=helpFor(x[0],getMat($('material').value).kind);
  return '<div class="vl-row'+(x[3]?' ov':'')+'"'+(key?' data-ovk="'+esc(key)+'"':'')+'><span class="vl-k">'+esc(t(x[0]))+(h?'<span class="help" title="'+esc(h)+'">?</span>':'')+'</span>'+
    '<span class="vl-v">'+x[1]+'</span>'+(x[2]?'<span class="vl-n">'+x[2]+'</span>':'')+'</div>';
}
// Kennzahlen oben: die wichtigsten Werte auf einen Blick (anklickbar wie die Zeilen)
const KEY_STRIP=[['Düse','nozzle'],['Heizbett','bed'],['Schichthöhe','layer'],['Wandlinien','w'],['Fülldichte','inf'],['Stützstrukturen','support'],['Brim','brim']];
function keyStrip(r){
  const rows=Object.fromEntries(r.ordered.flatMap(g=>g[1]).map(x=>[x[0],x]));
  return '<div class="key-strip">'+KEY_STRIP.filter(([l])=>rows[l]).map(([l,k])=>{const x=rows[l];
    return '<div class="ks'+(x[3]?' ov':'')+'" data-ovk="'+k+'"><span class="ks-k">'+esc(t(l==='Stützstrukturen'?'Stützen':l))+'</span><span class="ks-v">'+String(x[1]).split(' · ')[0]+'</span></div>'}).join('')+'</div>';
}
function specCell(x,key){
  const h=helpFor(x[0],getMat($('material').value).kind);
  return '<div class="spec-cell'+(KEY_ROWS.includes(x[0])||x[0]==='Schichthöhe'?' key':'')+(x[3]?' ov':'')+'"'+(key?' data-ovk="'+esc(key)+'"':'')+'><span class="k">'+esc(t(x[0]))+(h?'<span class="help" title="'+esc(h)+'">?</span>':'')+'</span>'+
    '<span class="v">'+x[1]+'</span>'+(x[2]?'<span class="n">'+x[2]+'</span>':'')+'</div>';
}

$('hintsFold').addEventListener('toggle',e=>{if(e.isTrusted)$('hintsFold').dataset.touched='1'});
function update(){
  if(typeof savePartFromForm==='function')savePartFromForm();
  const r=compute(currentInput(),geom,{getMat,settings:store.settings});lastOrdered=r.ordered;
  const row=x=>rowHTML(x,r.m.kind);
  $('mainTitle').textContent=t('{printer} – Druck-Konfigurator',{printer:r.printer.label});
  document.title=t('{printer} – Druck-Konfigurator',{printer:r.printer.label});
  const st=STATUS[r.effectiveStatus]||STATUS.generic;
  $('matBadge').innerHTML='<span class="badge '+st[0]+'">'+st[1]+'</span>';
  renderMatColours(r.m);
  if(typeof renderSlotKindWarn==='function')renderSlotKindWarn();
  document.body.dataset.printer=r.printer.id;
  document.querySelectorAll('.printer-switch [data-printer]').forEach(b=>{const on=b.dataset.printer===r.printer.id;b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1});
  $('resultPrinter').textContent=t('Startprofil · {printer}',{printer:r.printer.label});
  // alle Werte als Kacheln nach Thema
  // oben die Kennzahlen; alle Werte stehen in der Tafel darunter (js/overrides-ui.js ovPanelSync)
  $('settings').innerHTML=keyStrip(r);
  $('title').textContent=r.m.name+' – '+t(r.ob.label)+' · '+GOAL_LABEL[r.g];
  $('summary').innerHTML=(geom?de(geom.x,1)+' × '+de(geom.y,1)+' × '+de(geom.z,1)+' mm · ':'')+'<span class="badge '+st[0]+'" style="margin-left:0">'+st[1]+'</span> '+
    esc(r.m.overridden?t('Standardprofil mit deinen eigenen Werten.'):t(r.m.src));
  orcaFilamentJson=buildOrcaFilamentJSON(r);
  orcaProcessJson=buildOrcaProcessJSON(r);
  $('orcaNote').innerHTML=orcaWarningText(r);
  $('danger').innerHTML=r.danger.length?t('<b>Achtung:</b>')+'<br>'+r.danger.map(esc).join('<br>'):'';
  $('warning').innerHTML=r.warn.join('<br><br>');
  // Hinweise: Anzahl im Titel; offen, solange es etwas zu beachten gibt (Warnungen), sonst zu
  { const n=r.warn.length,s=$('hintsFold').querySelector('summary'); s.textContent=n?t('Hinweise ({n})',{n}):t('Hinweise');
    if(!$('hintsFold').dataset.touched)$('hintsFold').open=n>0; }
  $('checks').innerHTML=t('<b>Vor dem Druck:</b> Filamentprofil prüfen · Düse {noz} · Bett reinigen · erste Schicht beobachten',{noz:esc(r.nozLabel)})+(r.dryNeed&&r.m.dry?' · '+esc(t(r.m.dry)):'');
  // Die Anleitung für den Slicer braucht nur, wer von Hand einstellt – der 3MF-Export trägt die Werte selbst ein
  $('supportGuide').innerHTML='<h3>'+t('Stützen-Empfehlung')+'</h3><b>'+esc(t(r.sup))+'</b><br>'+esc(r.supNeed)+
    '<details class="sup-howto"><summary>'+t('In {slicer} von Hand einstellen',{slicer:esc(r.printer.slicer)})+'</summary><p>'+
    (r.supOn?t('<b>So stellst du es in {slicer} ein:</b><br>1. <i>Stützstrukturen aktivieren</i> einschalten.<br>2. <i>Typ: Baum (automatisch)</i>; {crit}<br>3. <i>Schwellenwinkel: {angle}°</i>.<br>4. <i>Nur auf Druckplatte</i> zuerst testen; bei unerreichbaren Innenflächen deaktivieren.<br>5. Raft aus. Immer die Schichtvorschau prüfen.',{slicer:esc(r.printer.slicer),angle:r.sp.angle,
      crit:r.supCritical?t('<i>nur kritische Bereiche</i> einschalten – stützt nur Spitzen und Auskragungen. Fehlen in der Vorschau Stützen unter normalen Überhängen, unter <b>Werte für diesen Auftrag anpassen</b> ausschalten.')
        :t('<i>nur kritische Bereiche</i> ausgeschaltet lassen – so stützt der Slicer auch normale Überhänge.')}):t('Im Slicer <i>Stützstrukturen aktivieren</i> ausgeschaltet lassen und in der Vorschau kurz kontrollieren, ob keine Bahnen frei in der Luft hängen.'))+
    '</p><p class="muted small">'+t('Beim 3MF-Export und beim Slicen im Tool sind diese Werte schon eingetragen.')+'</p></details>';
  // keine Überhänge: die Zeile „Support“ in der Karte Aufbau genügt
  $('supportGuide').classList.toggle('hidden',r.sup==='Nicht nötig');
  if(r.a){const txt=r.a.level==='none'?t('Keine relevanten Überhänge über {th}° (Bodenfläche ausgenommen).',{th:r.a.th}):t('Über {th}°: ca. {area} mm² ({pct} % der Oberfläche, Bodenfläche ausgenommen).',{th:r.a.th,area:de(r.a.flagged,0),pct:de(r.a.ratio*100,1)});document.querySelectorAll('.oh-info').forEach(el=>{el.textContent=txt})}
  lastResult=r;
  if(typeof renderPartList==='function')renderPartList();
  if(typeof scheduleProjectSave==='function')scheduleProjectSave();
  if(typeof undoRecord==='function')undoRecord();   // Rückgängig/Wiederholen (js/undo.js)   // Projekt übersteht Neuladen (js/project-store.js)
  if(typeof renderOrient==='function')renderOrient();
  if(typeof renderSize==='function')renderSize();
  if(typeof updateToolbar==='function')updateToolbar();
  if(typeof renderPartScope==='function')renderPartScope();
  if(typeof renderHoles==='function')renderHoles();
  if(typeof renderBodies==='function')renderBodies();
  if(typeof updateExportMenu==='function')updateExportMenu(r);
  if(typeof renderSidePanels==='function')renderSidePanels();
  if(typeof renderOverrideBar==='function')renderOverrideBar();
  if(typeof renderPlates==='function')renderPlates();
  if(typeof renderEngrave==='function')renderEngrave();
  if(geom&&typeof showVolume==='function')showVolume();
  if(typeof renderCostPanel==='function')renderCostPanel();
  if(typeof enhanceHelp==='function')enhanceHelp();
}

/* ================= AUSWAHLLISTE & MEINE WERTE ================= */
// Gruppen: eigene Filamente, je Hersteller (js/filaments.js – Anycubic, SUNLU, ELEGOO), allgemeine Profile
const MAT_BRANDS=['Anycubic','SUNLU','ELEGOO'];
function fillMaterialSelect(sel){
  const list=allMats(),cur=sel||$('material').value;
  const std=list.filter(m=>m.builtin),own=list.filter(m=>!m.builtin);
  const opt=m=>'<option value="'+esc(m.id)+'">'+(m.overridden?'★ ':'')+esc(m.name)+'</option>';
  const grp=(label,ms)=>ms.length?'<optgroup label="'+esc(label)+'">'+ms.map(opt).join('')+'</optgroup>':'';
  $('material').innerHTML=grp(t('Eigene Filamente'),own)+
    MAT_BRANDS.map(b=>grp(t('{brand} (Herstellerwerte)',{brand:b}),std.filter(m=>m.brand===b))).join('')+
    grp(t('Allgemeine Profile (★ = mit eigenen Werten)'),std.filter(m=>!m.brand));
  $('material').value=list.some(m=>m.id===cur)?cur:'pla_hs';
  renderMyList();
}
/* Farben des Herstellers unter der Filament-Auswahl: Klick trägt Typ und Farbe für den Slot des gewählten Teils ein (wie
   im Dialog Filament-Slots; mit Drucker-Verbindung als „überschrieben“). Anycubic: Farbcodes aus dem Shop, SUNLU: nach
   dem Farbnamen (≈). */
function matSlotTarget(){
  const p=project&&project.parts[project.selected];
  return p&&p.slot!=null?p.slot:(typeof defaultSlot==='function'?defaultSlot():0);
}
function renderMatColours(m){
  const box=$('matColours'),c=m&&m.colours;
  box.classList.toggle('hidden',!c||!c.length);
  if(!c||!c.length){box.innerHTML='';return}
  const approx=c.some(x=>x[2]),slot=matSlotTarget();
  // Hat die ACE die Spule per RFID gelesen, ist die Farbe bekannt – dann nur ein Hinweis statt der Farbauswahl
  const tpl=lastResult&&typeof exportTemplate==='function'&&exportTemplate(lastResult.printer.id,lastResult.dSel),live=tpl&&typeof dialogSlots==='function'?dialogSlots(tpl)[slot]:null;
  if(live&&live.rfid&&live.present){
    box.innerHTML='<div class="mc-rfid"><i style="background:'+esc(/^#[0-9a-f]{6}$/i.test(live.colour||'')?live.colour:'#888888')+'"></i>'+esc(t('Slot {slot}: {type} – Farbe per RFID von der ACE gelesen',{slot:slot+1,type:live.type||''}))+'</div>';
    return;
  }
  box.innerHTML='<div class="mc-head"><b>'+esc(t('Farben von {brand}',{brand:m.brand||''}))+'</b> <span class="muted">'+esc(t('{n} Farben – Klick trägt sie für Slot {slot} ein',{n:c.length,slot:slot+1}))+'</span></div>'+
    '<div class="mc-list">'+c.map((x,i)=>'<button type="button" class="mc-swatch" data-mat-colour="'+i+'" style="--sw:'+esc(x[1])+'" title="'+esc(x[0]+' · '+x[1]+(x[2]?' ('+t('ungefähr')+')':''))+'" aria-label="'+esc(x[0])+'"></button>').join('')+'</div>'+
    '<div class="mc-foot muted">'+(approx?esc(t('≈ Einige Farben stehen ohne Code auf der Herstellerseite – sie sind ungefähr (im Tooltip markiert).'))+' ':'')+(m.url?'<a href="'+esc(m.url)+'" target="_blank" rel="noopener">'+esc(t('Produktseite'))+'</a>':'')+'</div>';
}
$('matColours').addEventListener('click',e=>{
  const b=e.target.closest('[data-mat-colour]');if(!b||!lastResult)return;
  const m=getMat($('material').value),c=m.colours&&m.colours[+b.dataset.matColour];if(!c)return;
  const id=lastResult.printer.id,slot=matSlotTarget(),rows=((store.settings.manualSlots||{})[id]||[]).slice();
  const live=typeof slotState!=='undefined'&&slotState.live&&slotState.printer===id;
  rows[slot]={type:KIND_LABEL[m.kind]&&m.kind!=='tpu'?KIND_LABEL[m.kind]:'TPU',colour:c[1].toUpperCase(),override:!!live};
  for(let i=0;i<rows.length;i++)if(!rows[i])rows[i]=null;
  store.settings.manualSlots={...(store.settings.manualSlots||{}),[id]:rows};persist();
  toast(t('Slot {n}: {name} {colour}',{n:slot+1,name:m.name,colour:c[0]})+(live?' '+t('(überschreibt die Angabe des Druckers)'):''));
  update();
});
function renderMyList(){
  const list=allMats().filter(m=>m.overridden||!m.builtin);
  $('myList').innerHTML=list.length?list.map(m=>'<div class="mylist-item"><span>'+esc(m.name)+'<br><span class="muted" style="font-size:12px">'+(m.builtin?t('Standardprofil, eigene Werte'):t('Eigenes Filament'))+' · '+de(m.refD,m.refD===0.25?2:1)+' mm '+(NOZZLE_MATERIALS[m.refMat||'steel_hardened']||NOZZLE_MATERIALS.steel_hardened).label+'</span></span><button class="linkbtn" data-sel="'+esc(m.id)+'" type="button">'+t('Auswählen')+'</button></div>').join('')
    :t('Noch keine eigenen Werte gespeichert.');
  $('myList').querySelectorAll('[data-sel]').forEach(b=>b.addEventListener('click',()=>{$('material').value=b.dataset.sel;store.last.material=b.dataset.sel;persist();update()}));
}

/* ================= EDITOR ================= */
const FIELDS=[
 [t('Allgemein'),[
  ['name',t('Profilname'),'text'],['kind',t('Filamenttyp'),'kind'],['abrasive',t('Faserverstärkt (Carbon/Glas)'),'bool'],
  ['refD',t('Werte ermittelt mit Düse'),'refD'],['refMat',t('Düsenmaterial dabei'),'refMat']]],
 [t('Temperaturen'),[
  ['nozzle',t('Düsentemperatur'),'tri','°C'],['range',t('Herstellerbereich (Rolle)'),'text'],['bed',t('Heizbett'),'num','°C'],['bedNote',t('Platte / Hinweis'),'text']]],
 [t('Filamentprofil'),[
  ['maxVol',t('Max. Volumengeschwindigkeit'),'num','mm³/s'],['flow',t('Durchflussverhältnis'),'num',''],['pa',t('Pressure Advance (leer = weglassen)'),'numopt',''],
  ['fanFirst',t('Lüfter erste Schicht'),'num','%'],['fan',t('Lüfter Folgeschichten'),'num','%'],
  ['retrLen',t('Rückzug Länge'),'num','mm'],['retrSpeed',t('Rückzug Geschwindigkeit'),'num','mm/s'],['zhop',t('Z-Hop'),'num','mm']]],
 [t('Geschwindigkeiten'),[
  ['first',t('Erste Schicht'),'num','mm/s'],['outer',t('Außenwand'),'tri','mm/s'],['inner',t('Innenwand'),'tri','mm/s'],['fill',t('Füllung'),'tri','mm/s'],
  ['top',t('Obere Fläche'),'num','mm/s'],['gap',t('Lückenfüllung'),'num','mm/s'],['travel',t('Travel'),'num','mm/s'],['accel',t('Beschleunigung (0 = Werksprofil)'),'num','mm/s²']]],
 [t('Notizen'),[['dry',t('Trocknung'),'text'],['notes',t('Meine Erfahrungen'),'area']]]
];
const EDIT_KEYS=FIELDS.flatMap(g=>g[1].map(f=>f[0]));
const dlg=$('editor');
function openDialog(){if(dlg.showModal)dlg.showModal();else dlg.setAttribute('open','')}
function closeDialog(){if(dlg.close)dlg.close();else dlg.removeAttribute('open')}
dlg.addEventListener('click',e=>{if(e.target===dlg)closeDialog()});

function inputFor(f,v){
  const [k,,type,unit]=f;const id='ed_'+k;
  const u=unit?'<span class="u">'+unit+'</span>':'';
  if(type==='text')return '<div class="ed-in"><input id="'+id+'" value="'+esc(v??'')+'"></div>';
  if(type==='area')return '<div class="ed-in"><textarea id="'+id+'" rows="3" placeholder="'+t('z. B. ab 225 °C weniger Fäden, Brim bei kleinen Teilen nötig …')+'">'+esc(v??'')+'</textarea></div>';
  if(type==='num'||type==='numopt')return '<div class="ed-in"><input id="'+id+'" inputmode="decimal" value="'+(v===null||v===undefined||v===''?'':String(v).replace('.',','))+'">'+u+'</div>';
  if(type==='bool')return '<div class="ed-in"><input type="checkbox" id="'+id+'"'+(v?' checked':'')+'> <span class="muted" style="font-size:13px">'+t('nur mit gehärteter Düse')+'</span></div>';
  if(type==='kind')return '<div class="ed-in"><select id="'+id+'">'+Object.keys(KIND_LABEL).map(x=>'<option value="'+x+'"'+(x===v?' selected':'')+'>'+KIND_LABEL[x]+'</option>').join('')+'</select></div>';
  if(type==='refD')return '<div class="ed-in"><select id="'+id+'">'+Object.keys(NOZ).map(x=>'<option value="'+x+'"'+(nkey(v)===x?' selected':'')+'>'+de(+x,x==='0.25'?2:1)+' mm</option>').join('')+'</select></div>';
  if(type==='refMat')return '<div class="ed-in"><select id="'+id+'">'+['steel_hardened','steel_stainless','brass'].map(x=>'<option value="'+x+'"'+(x===(v||'steel_hardened')?' selected':'')+'>'+NOZZLE_MATERIALS[x].label+'</option>').join('')+'</select></div>';
  if(type==='tri')return '<div class="ed-in"><div class="tri">'+[0,1,2].map(i=>'<div><input id="'+id+'_'+i+'" inputmode="decimal" value="'+String((v||[])[i]??'').replace('.',',')+'"><small>'+t(['Qualität','Ausgewogen','Schnell'][i])+'</small></div>').join('')+'</div>'+u+'</div>';
  return '';
}
function readForm(){
  const out={},errs=[];
  FIELDS.forEach(g=>g[1].forEach(f=>{
    const [k,label,type]=f,id='ed_'+k;
    if(type==='text'||type==='area'){out[k]=$(id).value.trim()}
    else if(type==='bool'){out[k]=$(id).checked}
    else if(type==='kind'||type==='refMat'){out[k]=$(id).value}
    else if(type==='refD'){out[k]=+$(id).value}
    else if(type==='numopt'){const s=$(id).value.trim();if(!s)out[k]=null;else{const n=num(s);if(isNaN(n))errs.push(label);else out[k]=n}}
    else if(type==='num'){const n=num($(id).value);if(isNaN(n))errs.push(label);else out[k]=n}
    else if(type==='tri'){const a=[0,1,2].map(i=>num($(id+'_'+i).value));if(a.some(isNaN))errs.push(label);else out[k]=a}
  }));
  if(!out.name)errs.push(t('Profilname'));
  if(out.maxVol<=0)errs.push(t('Max. Volumengeschwindigkeit muss größer 0 sein'));
  return {out,errs};
}
function openEditor(mode){
  // mode: 'edit' (aktuelles Filament) oder 'new'
  let src,title,sub,isBuiltin=false,isOwn=false,overridden=false;
  if(mode==='edit'){
    src=getMat($('material').value);isBuiltin=!!src.builtin;isOwn=!src.builtin;overridden=!!src.overridden;
    title=t('Werte anpassen: {name}',{name:src.name});
    sub=isBuiltin?t('Deine Werte ersetzen das Standardprofil. „Auf Standard zurücksetzen“ stellt es wieder her.'):t('Eigenes Filament bearbeiten.');
  }else{
    src=Object.assign({},builtinOf('pla'),{name:t('Neues Filament'),notes:'',status:'user'});
    title=t('Neues Filament anlegen');
    sub=t('Startwerte werden vom gewählten Filamenttyp übernommen – danach deine eigenen Werte eintragen.');
  }
  $('edTitle').textContent=title;$('edSub').textContent=sub;
  const renderBody=vals=>{
    $('edBody').innerHTML=FIELDS.map(g=>'<div class="ed-group"><h4>'+g[0]+'</h4>'+g[1].map(f=>'<div class="ed-row"><label for="ed_'+f[0]+'">'+f[1]+'</label>'+inputFor(f,vals[f[0]])+'</div>').join('')+'</div>').join('');
    if(mode==='new')$('ed_kind').addEventListener('change',()=>{
      const k=$('ed_kind').value;
      renderBody(Object.assign({},builtinOf(KIND_TEMPLATE[k]),{name:$('ed_name').value,notes:$('ed_notes').value,kind:k}));
    });
  };
  renderBody(src);
  let foot='<button class="btn sec" type="button" id="edCancel">'+t('Abbrechen')+'</button>';
  if(isBuiltin&&overridden)foot+='<button class="btn danger" type="button" id="edReset">'+t('Auf Standard zurücksetzen')+'</button>';
  if(isOwn)foot+='<button class="btn danger" type="button" id="edDelete">'+t('Löschen')+'</button>';
  if(mode==='edit')foot+='<button class="btn sec" type="button" id="edCopy">'+t('Als neues Filament speichern')+'</button>';
  foot+='<button class="btn" type="button" id="edSave">'+t('Speichern')+'</button>';
  $('edFoot').innerHTML=foot;
  $('edCancel').onclick=closeDialog;
  if($('edReset'))$('edReset').onclick=()=>{if(!confirm(t('Eigene Werte für „{name}“ löschen und Standardwerte wiederherstellen?',{name:src.name})))return;delete store.profiles[src.id];persist();closeDialog();fillMaterialSelect(src.id);update()};
  if($('edDelete'))$('edDelete').onclick=()=>{if(!confirm(t('Filament „{name}“ endgültig löschen?',{name:src.name})))return;delete store.profiles[src.id];persist();closeDialog();fillMaterialSelect('pla_hs');update()};
  const save=asNew=>{
    const {out,errs}=readForm();
    if(errs.length){alert(t('Bitte prüfen: {list}',{list:errs.join(', ')}));return}
    let id;
    if(asNew||mode==='new'){id='u'+Date.now().toString(36);if(asNew&&out.name===src.name)out.name+=' '+t('(Kopie)')}
    else id=src.id;
    store.profiles[id]=out;
    persist();closeDialog();fillMaterialSelect(id);store.last.material=id;persist();update();
  };
  $('edSave').onclick=()=>save(false);
  if($('edCopy'))$('edCopy').onclick=()=>save(true);
  openDialog();
}
$('editMat').addEventListener('click',()=>openEditor('edit'));
$('newMat').addEventListener('click',()=>openEditor('new'));

/* Düsen-Umrechnung */
$('settingsBtn').addEventListener('click',()=>{
  const S=store.settings;
  const cp=currentPrinter();
  $('edTitle').textContent=t('Düsen-Umrechnung');
  $('edSub').textContent=t('Gilt, wenn deine Düse eine andere Metallfamilie hat als die Düse, mit der ein Profil ermittelt wurde. Die Standardprofile beziehen sich auf eine Stahldüse ({mat} beim {printer}); gehärteter und ungehärteter Stahl gelten hier als gleichwertig, nur Messing weicht ab.',{mat:esc(NOZZLE_MATERIALS[cp.nozzleDefault].label),printer:esc(cp.label)});
  $('edBody').innerHTML='<div class="ed-group"><h4>'+t('Stahl (gehärtet oder Edelstahl) im Vergleich zu Messing')+'</h4>'+
    '<div class="ed-row"><label for="st_off">'+t('Temperaturaufschlag Stahl')+'</label><div class="ed-in"><input id="st_off" inputmode="decimal" value="'+String(S.steelOffset).replace('.',',')+'"><span class="u">°C</span></div></div>'+
    '<div class="ed-row"><label for="st_vol">'+t('Volumenstrom-Faktor Stahl')+'</label><div class="ed-in"><input id="st_vol" inputmode="decimal" value="'+String(S.steelVol).replace('.',',')+'"><span class="u">'+t('× Messing')+'</span></div></div>'+
    '<p class="muted" style="font-size:13px">'+t('Stahl leitet Wärme schlechter als Messing. Üblich sind 5–10 °C mehr und etwas weniger Durchsatz. Beispiel: Profil mit Stahl ermittelt, du druckst mit Messing → Temperatur −5 °C, Volumenstrom ÷ 0,9.')+'</p></div>';
  $('edFoot').innerHTML='<button class="btn sec" type="button" id="edCancel">'+t('Abbrechen')+'</button><button class="btn sec" type="button" id="stReset">'+t('Standard (5 °C / {f})',{f:de(0.9,1)})+'</button><button class="btn" type="button" id="edSave">'+t('Speichern')+'</button>';
  $('edCancel').onclick=closeDialog;
  $('stReset').onclick=()=>{$('st_off').value='5';$('st_vol').value='0,9'};
  $('edSave').onclick=()=>{
    const o=num($('st_off').value),v=num($('st_vol').value);
    if(isNaN(o)||o<0||o>30||isNaN(v)||v<=0.3||v>1.5){alert(t('Bitte gültige Werte eingeben (Aufschlag 0–30 °C, Faktor 0,3–1,5).'));return}
    store.settings.steelOffset=o;store.settings.steelVol=v;persist();closeDialog();update();
  };
  openDialog();
});

/* Export / Import */
$('exportBtn').addEventListener('click',()=>{
  const data={format:'druck-konfigurator',version:4,exported:new Date().toISOString(),profiles:store.profiles,settings:store.settings,last:store.last};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='druck-konfigurator-meine-profile.json';
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
});
$('importBtn').addEventListener('click',()=>$('importFile').click());
$('importFile').addEventListener('change',()=>{
  const f=$('importFile').files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const d=JSON.parse(r.result);
      if(!d||(d.format!=='druck-konfigurator'&&d.format!=='kobra-s1-konfigurator')||typeof d.profiles!=='object')throw Error(t('Keine Profildatei dieses Programms'));
      const ids=Object.keys(d.profiles).filter(id=>{const p=d.profiles[id];return p&&typeof p==='object'&&p.name&&Array.isArray(p.nozzle)});
      const hasLast=d.last&&typeof d.last==='object'&&Object.keys(d.last).length>0;
      if(!ids.length&&!hasLast)throw Error(t('Die Datei enthält weder eigene Profile noch eine gespeicherte Auswahl'));
      const parts=[];
      if(ids.length){const clash=ids.filter(id=>store.profiles[id]).length;parts.push(clash?t('{n} Profil(e) ({c} werden überschrieben)',{n:ids.length,c:clash}):t('{n} Profil(e)',{n:ids.length}))}
      if(hasLast)parts.push(t('die zuletzt gespeicherte Auswahl (Drucker, Filament, Düse, Objekt, Ziel)'));
      if(!confirm(t('Importieren: {list}?',{list:parts.join(' '+t('und')+' ')})))return;
      if(ids.length)ids.forEach(id=>{store.profiles[id]=Object.assign({},P({}),d.profiles[id])});
      if(hasLast)Object.assign(store.last,d.last);
      if(d.settings&&confirm(t('Auch die Düsen-Umrechnung aus der Datei übernehmen?')))Object.assign(store.settings,d.settings);
      persist();
      if(hasLast){
        if(store.last.printer&&PRINTERS[store.last.printer])$('printer').value=store.last.printer;
        fillNozzleMaterialSelect();
        if(store.last.nozD&&NOZ[nkey(store.last.nozD)])$('nozD').value=store.last.nozD;
        if(store.last.nozM&&NOZZLE_MATERIALS[store.last.nozM]&&currentPrinter().nozzleOptions.includes(store.last.nozM))$('nozM').value=store.last.nozM;
        ['object','goal','load','support','supportLevel'].forEach(id=>{if(store.last[id]!==undefined)$(id).value=store.last[id]});
      }
      fillMaterialSelect(store.last.material);update();
    }catch(e){alert(t('Import fehlgeschlagen: {msg}',{msg:e.message}))}
    $('importFile').value='';
  };
  r.readAsText(f);
});

/* ================= BUTTONS ================= */
$('printBtn').addEventListener('click',()=>window.print());
$('copyBtn').addEventListener('click',()=>{
  const strip=s=>String(s).replace(/<[^>]+>/g,'');
  const lines=[t('DRUCK-KONFIGURATOR')+' – '+$('title').textContent];
  if(geom)lines.push(t('Modell: {name} ({size} mm)',{name:geom.name,size:de(geom.x,1)+' × '+de(geom.y,1)+' × '+de(geom.z,1)}));
  lastOrdered.forEach(g=>{lines.push('');lines.push(t(g[0]));g[1].forEach(r=>lines.push('  '+t(r[0])+': '+strip(r[1])+(r[2]?' ('+strip(r[2])+')':'')))});
  const dz=$('danger').innerText.trim();if(dz){lines.push('');lines.push(dz)}
  const w=$('warning').innerText.trim();if(w){lines.push('');lines.push(t('Hinweise:'));lines.push(w)}
  const text=lines.join('\n'),btn=$('copyBtn');
  const done=ok=>{btn.textContent=ok?t('Kopiert'):t('Kopieren nicht möglich');setTimeout(()=>btn.textContent=t('Als Text kopieren'),1800)};
  const fallback=()=>{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy')}catch(e){}ta.remove();done(ok)};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(()=>done(true),fallback);else fallback();
});
function downloadJSON(text,filename,btn,label){
  const blob=new Blob([text],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
  if(btn){btn.textContent=t('Gespeichert ✓');setTimeout(()=>btn.textContent=label,1800)}
}
$('orcaFilBtn').addEventListener('click',()=>{
  const label=t('Filament-JSON speichern');
  downloadJSON(orcaFilamentJson,'druck-konfigurator-'+currentPrinter().id+'-filament.json',$('orcaFilBtn'),label);
});
$('orcaProcBtn').addEventListener('click',()=>{
  const label=t('Process-JSON speichern');
  downloadJSON(orcaProcessJson,'druck-konfigurator-'+currentPrinter().id+'-process.json',$('orcaProcBtn'),label);
});

$('settings').addEventListener('click',e=>{const b=e.target.closest('[data-ov-group]');if(b&&typeof openOverrideDialog==='function')openOverrideDialog(b.dataset.ovGroup)});

/* Datenblatt und Orca-Reihenfolge: Zeile anklicken → „Werte für diesen Auftrag“ bei diesem Wert (2026-10-04) */
['settings'].forEach(id=>$(id).addEventListener('click',e=>{
  if(e.target.closest('[data-ov-group],.help,a,button'))return;
  const xc=e.target.closest('[data-ovk]');if(xc&&project&&typeof openOverrideDialog==='function'){openOverrideDialog({key:xc.dataset.ovk});return;}
  const row=e.target.closest('.setting'),b=row&&row.querySelector('b');if(!b||typeof openOverrideDialog!=='function'||!project)return;
  const key=ROW_OV_T[b.firstChild?b.firstChild.textContent.trim():''];if(key)openOverrideDialog({key});
}));
