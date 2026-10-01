'use strict';
/* Start und Bedienrahmen: Datei laden, Menüs, Tabs, Druckerumschaltung, Viewer-Bedienung. */

/* ================= DATEI LADEN (aus v4) ================= */
const input=$('file');
let dragDepth=0;
['dragenter','dragover','dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();e.stopPropagation()}));
document.addEventListener('dragenter',()=>{dragDepth++;document.body.classList.add('dragging')});
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('dragging')}});
document.addEventListener('drop',e=>{
  dragDepth=0;document.body.classList.remove('dragging');
  const files=e.dataTransfer&&e.dataTransfer.files;if(files&&files.length)loadFiles([...files]);
});
input.addEventListener('change',()=>{if(input.files.length)loadFiles([...input.files])});
$('clear').addEventListener('click',()=>{input.value='';project=null;if(typeof setPrintSequence==='function')setPrintSequence(false);geom=null;$('fileinfo').textContent=t('Noch keine Datei geladen.');clearModel();update()});

const readBytes=file=>new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(new Uint8Array(r.result));r.onerror=()=>fail(r.error||Error(t('Lesefehler')));r.readAsArrayBuffer(file)});

// Eine oder mehrere Dateien (STL, 3MF, ZIP) → Projekt mit Teileliste
async function loadFiles(files){
  $('fileinfo').textContent=files.length===1?t('Lese {name} …',{name:files[0].name}):t('Lese {n} Dateien …',{n:files.length});
  try{
    const entries=await Promise.all(files.map(async f=>({name:f.name,bytes:await readBytes(f)})));
    const imp=importModels(entries,fflate);
    if(addMode&&project){addMode=false;return addParts(imp)}
    addMode=false;
    showProject({name:imp.name,parts:partsFromImport(imp),threemf:imp.threemf,notes:imp.notes});
    // mehr Farben des Designers als Slots: überzählige auf ähnliche Slots legen (js/design-ui.js)
    const moved=typeof autoMapDesignColours==='function'?autoMapDesignColours():0;
    // Filament in den Druckwerten passend zum Slot jedes Teils (Slot aus der 3MF bzw. Standard-Slot)
    if(typeof adoptSlotMaterialFor==='function'&&adoptSlotMaterialFor(project.parts)&&!moved)update();
    if(moved){update();toast(t('{n} Farben des Designers auf ähnliche Slots gelegt – unter „Farben des Designers“ anpassen',{n:moved}))}
  }catch(e){
    addMode=false;
    $('fileinfo').textContent=t('Modell konnte nicht gelesen werden: {msg}. Bitte die Datei prüfen oder erneut exportieren.',{msg:t(e.message)});
  }
}
// slot: 0-basiert oder null (= Slot aus dem Export-Dialog); 3MF-Teile behalten den Slot des Designers
// Jede Datei-Auswahl (Laden oder Hinzufügen) ist eine Quelle – so lässt sich ein hinzugefügtes Modell wieder ganz entfernen
let srcSeq=0;
function partsFromImport(imp){
    const src='s'+Date.now().toString(36)+(srcSeq++),srcName=imp.name;
    const parts=imp.parts.map((p,i)=>({id:i,src,srcName,name:p.name,origPos:p.pos,R:IDENTITY3,geom:makeGeom(p.name,p.pos),slot:p.extruder?p.extruder-1:null,plate:p.plate||1,objectId:p.objectId||null,instance:p.instance||0,input:null,bodies:importedBodies(p),painted:!!p.painted,
      // Farben des Designers (0-basiert): Slot des Objekts, der Körper und der Farb-Modifikatoren – für „Farben des Designers → Slot“ (js/design-ui.js)
      dSlot:p.extruder?p.extruder-1:null,modSlots:(p.modifiers||[]).map(e=>e-1),paintTris:!!p.paintTris,
      // Geometrie der Farb-Modifikatoren (nur Anzeige; Slot des Designers, umgelegt über designMap)
      modVols:(p.modVols||[]).map(m=>({dSlot:m.extruder-1,pos:m.pos})),
      // Bemalung je Dreieck (Filament des Designers, 1-basiert) – Anzeige und Zuordnung zu Slots (designMap)
      paintState:p.paintState||null,paintSlots:(p.paintSlots||[]).map(e=>e-1),
      // geteilte Dreiecke des Designers (Index → Code) und Herkunft der Dreiecke in der 3MF (eigene Bemalung, js/paint-ui.js)
      paintCodes:p.paintCodes||null,paintSrc:p.paintSrc||null,
      // gemalte Stützen und Naht des Designers (Index → Code)
      supCodes:p.supCodes||null,seamCodes:p.seamCodes||null,
      // sehr kleine STL: vielleicht in Zoll (js/import.js) – Knopf „In Zoll umrechnen“ unter dem Modell
      inchHint:!!p.inchHint}));
    parts.forEach((q,i)=>{if(q.bodies)q.bodies.forEach((b,j)=>{const e=imp.parts[i].bodies[j].extruder;b.dSlot=e?e-1:q.dSlot})});
    if(imp.threemf)imp.threemf.designMap={};
    return parts;
}

/* Modell hinzufügen: weitere Dateien ins bestehende Projekt (verschiedene Modelle kombiniert drucken; mehrfach
   über „Anzahl“ in den Platten). Ist das Projekt eine Makerworld-/Orca-3MF, bleibt sie erhalten (Modifikatoren,
   Bemalung, Einstellungen des Designers): die neuen Teile kommen als einfache Teile dazu (part.extra, objectId null),
   build3mfFromProject hängt sie als eigene Objekte an und platziert sie selbst – ohne Anordnen auf eigenen Platten
   hinter denen des Designers. Aus einer weiteren 3MF wird dabei nur die Geometrie übernommen. */
let addMode=false;
function addParts(imp){
  const tm=project.threemf,lost=!!imp.threemf&&imp.parts.some(p=>p.painted||(p.modifiers&&p.modifiers.length));
  const notes=[...(project.notes||[])];
  if(tm)notes.push(t('Hinzugefügt: {name} – die 3MF des Designers bleibt mit Farben, Modifikatoren und Bemalung erhalten, die neuen Teile kommen als eigene Objekte dazu.',{name:imp.name})+
    (lost?' '+t('Farb-Modifikatoren und Bemalung von {name} gehen dabei verloren.',{name:imp.name}):''));
  else if(imp.threemf)notes.push(t('Kombiniert: Die 3MF wird neu aufgebaut – Platten und Körper-Slots bleiben, die übrigen Einstellungen des Designers entfallen.')+(lost?' '+t('Farb-Modifikatoren und Bemalung des Designers gehen dabei verloren.'):''));
  const add=partsFromImport(imp),tpl=typeof plTpl==='function'?plTpl():null;
  initPartInputs(add);
  if(tm){
    // einfache Teile: kein Objekt der 3MF, Farben/Bemalung der Quelldatei gelten nicht
    add.forEach(p=>{Object.assign(p,{extra:true,objectId:null,instance:0,painted:false,paintTris:false,modSlots:[],modVols:[],dSlot:null,paintState:null,paintSlots:[],paintCodes:null,paintSrc:null,supCodes:null,seamCodes:null});(p.bodies||[]).forEach(b=>{b.dSlot=null;b.partId=null})});
    if(tm.layout!=='auto'){
      if(tpl)normalizePlates(tpl);   // Plattennummern wie in der Übersicht
      const last=Math.max(1,...project.parts.map(p=>p.plate||1)),next=tm.layout==='plates'?last:last+1;
      add.forEach(p=>{p.plate=imp.threemf?next+(p.plate||1)-1:next});
    }
  }else{
    // bisher automatisch verteilte Teile behalten ihre Platte, wenn ab jetzt eine feste Zuordnung gilt
    if(imp.threemf&&!project.platesFixed&&tpl)fixPlates(tpl);
    if(imp.threemf)project.platesFixed=true;
    if(project.platesFixed){
      // neue Teile hinter die bisherigen Platten (bzw. auf die Platten ihrer eigenen 3MF)
      const last=Math.max(1,...project.parts.map(p=>p.plate||1));
      add.forEach(p=>{p.plate=imp.threemf?last+(p.plate||1):last});
    }
  }
  const first=project.parts.length;
  project.parts.push(...add);
  project.parts.forEach((p,i)=>{p.id=i});
  project.name=/ \+ /.test(project.name)?project.name:project.name.replace(/\.(stl|3mf|zip)$/i,'')+' + '+imp.name.replace(/\.(stl|3mf|zip)$/i,'');
  project.notes=notes.concat(imp.notes||[]);
  if(typeof normalizePlates==='function'&&tpl)normalizePlates(tpl);
  renderFileinfo();
  renderImportNotes(project.notes);
  $('partList').classList.remove('hidden');
  toast(t('{n} Teil(e) hinzugefügt – jetzt {total} Teile',{n:add.length,total:project.parts.length}));
  selectPart(first);
}

// Kopf der Modellkarte: Name, Dreiecke, Platten, Herkunft – die Anzahl der Teile steht schon in der Teileliste
/* Teile, die vielleicht in Zoll gespeichert sind (sehr kleine STL): Angebot unter dem Modell. Umrechnen = Größe ×25,4
   (wie ① Größe, mit Rückgängig); „Passt so“ blendet es aus. */
function renderInchHint(){
  const box=$('inchHint'),parts=project?project.parts.filter(p=>p.inchHint&&!p.scale):[];
  box.classList.toggle('hidden',!parts.length);
  if(!parts.length){box.innerHTML='';return}
  const g=parts[0].geom,dims=[g.x,g.y,g.z].map(v=>de(v,1)).join(' × ');
  box.innerHTML='<span>'+esc(parts.length>1?t('{n} Teile sind sehr klein – vielleicht ist die Datei in Zoll gespeichert.',{n:parts.length}):t('{name} ist nur {dims} mm groß – vielleicht ist die Datei in Zoll gespeichert.',{name:parts[0].name,dims}))+'</span>'+
    '<button type="button" class="btn sec small" id="inchApply">'+esc(t('In Zoll umrechnen (×25,4)'))+'</button><button type="button" class="linkbtn" id="inchKeep">'+esc(t('Passt so'))+'</button>';
}
document.addEventListener('click',e=>{
  if(!project)return;
  if(e.target.id==='inchApply'){const ps=project.parts.filter(p=>p.inchHint&&!p.scale);ps.forEach(p=>{if(!p.scale)setPartScale(p,[25.4,25.4,25.4]);p.inchHint=false});
    renderInchHint();update();toast(t('{n} Teil(e) von Zoll in mm umgerechnet – Strg/⌘+Z nimmt es zurück',{n:ps.length}))}
  else if(e.target.id==='inchKeep'){project.parts.forEach(p=>{p.inchHint=false});renderInchHint();update()}
});
// Hinweise vom Import: eine Zeile (ℹ), Klick zeigt alles
function renderImportNotes(notes){
  const el=$('importNotes');notes=notes||[];
  el.classList.toggle('hidden',!notes.length);el.classList.remove('open');
  el.innerHTML=notes.length?'<button type="button" class="in-toggle" aria-expanded="false" title="'+esc(t('Alle Hinweise zeigen'))+'">ℹ '+esc(notes.length>1?t('{n} Hinweise zum Import',{n:notes.length})+': ':'')+'</button><span>'+notes.map(esc).join(' ')+'</span>':'';
}
$('importNotes').addEventListener('click',()=>{const el=$('importNotes'),o=!el.classList.contains('open');el.classList.toggle('open',o);const b=el.querySelector('.in-toggle');if(b)b.setAttribute('aria-expanded',String(o))});
function renderFileinfo(){
  renderInchHint();
  const p=project,n=p.parts.reduce((s,x)=>s+x.geom.n,0),plates=p.threemf&&p.threemf.plates.length>1?' · '+t('{n} Platten',{n:p.threemf.plates.length}):'';
  $('fileinfo').innerHTML='<b>'+esc(p.name)+'</b><br>'+t('{n} Dreiecke',{n:n.toLocaleString(LOCALE())})+plates+
    (p.threemf&&p.threemf.settings&&p.threemf.settings.printer_settings_id?'<br><small>'+t('Ursprünglich für: {name}',{name:esc(p.threemf.settings.printer_settings_id)})+'</small>':'');
}
function showProject(p){
  project=p;
  if(typeof setPrintSequence==='function')setPrintSequence(p.printSeq==='object');   // Druckreihenfolge des Projekts
  initPartInputs(p.parts);
  renderFileinfo();
  renderImportNotes(p.notes);
  $('partList').classList.remove('hidden');
  $('modelCard').classList.add('loaded');$('modelBadge').classList.remove('hidden');$('removeModelWrap').classList.remove('hidden');
  selectPart(0);
}

// Gewähltes Teil bestimmt Datenblatt, Überhanganalyse und 3D-Ansicht
function selectPart(i){
  project.selected=i;
  loadPartIntoForm(project.parts[i]);
  showModel(project.parts[i].geom);
}

/* Farben innerhalb eines Teils (wie die Unterobjekte in OrcaSlicer): Körper, Farb-Modifikatoren des Designers (z. B. ein
   Schriftzug in der 3MF – gelten projektweit über designMap) und erhabene Beschriftung. eff = Slot, der tatsächlich gilt. */
// Höchster Punkt eines Dreiecksbereichs über der Unterkante des Teils – Farben nur in den ersten Schichten sieht man nur von unten
const lowCache=new WeakMap();
function zTop(pos,from,to,base){let m=-Infinity;for(let i=from*9+2;i<to*9;i+=3)if(pos[i]>m)m=pos[i];return m-base}
function lowColours(p){
  let c=lowCache.get(p.geom);if(c)return c;
  const g=p.geom,low=h=>h<=1.0;
  c={bodies:(p.bodies||[]).map(b=>low(zTop(g.pos,b.start,b.start+b.count,g.mn[2]))),mods:{}};
  (p.modVols||[]).forEach(m=>{const h=zTop(m.pos,0,m.pos.length/9,g.mn[2]);c.mods[m.dSlot]=(c.mods[m.dSlot]??true)&&low(h)});
  lowCache.set(p.geom,c);return c;
}
function partColours(p){
  const st=(project.threemf&&project.threemf.settings)||{},dcol=d=>{const c=(st.filament_colour||[])[d];return /^#[0-9a-f]{6}$/i.test(c||'')?c:null};
  const own=p.slot??(typeof defaultSlot==='function'?defaultSlot():0),map=(project.threemf&&project.threemf.designMap)||{},out=[],lc=lowColours(p);
  const lowTxt=t('in den ersten Schichten – von unten sichtbar');
  const base0=out.length;
  (p.bodies||[]).forEach((b,j)=>out.push({kind:'body',key:j,slot:b.slot??null,eff:b.slot??own,label:t(b.name),sub:lc.bodies[j]&&b.count<p.geom.n/2?lowTxt:''}));
  // Bemalung je Dreieck: jede Farbe des Designers (Zuordnung gilt projektweit wie bei Modifikatoren)
  // Bemalung je Dreieck: Zuordnung oben unter „Filamente des Modells“ (wie in OrcaSlicer) – hier nur die Farbpunkte
  if((p.paintSlots||[]).length)out.push({kind:'info',key:0,label:t('bemalt mit {n} Farben',{n:p.paintSlots.length}),sub:t('Zuordnung oben unter Filamente'),effs:p.paintSlots.map(d=>map[d]??d)});
  // eigene Bemalung (Werkzeugleiste „Bemalen“, js/paint-ui.js): Slots direkt
  const ownPaint=typeof paintUserSlots==='function'?paintUserSlots(p):[];
  if(ownPaint.length)out.push({kind:'info',key:1,label:t('selbst bemalt ({n} Farben)',{n:ownPaint.length}),sub:t('Bemalen in der Werkzeugleiste'),effs:ownPaint});
  // Teil ohne eigene Körper, aber mit Modifikator, Beschriftung oder eigener Bemalung: der Grundkörper ist die erste Farbe (Slot des Teils)
  if(!p.bodies&&!(p.paintSlots||[]).length&&((p.modSlots||[]).length||ownPaint.length||(p.texts||[]).some(x=>x.mode!=='engraved')))out.push({kind:'base',key:0,slot:p.slot??null,eff:own,label:t('Grundkörper'),sub:t('Slot des Teils')});
  if(out.length&&out[out.length-1].kind==='base')out.unshift(out.pop());
  [...new Set(p.modSlots||[])].forEach(d=>out.push({kind:'mod',key:d,dcol:dcol(d),slot:map[d]??d,eff:map[d]??d,label:t('Farbe {n} des Designers',{n:d+1}),sub:(lc.mods[d]?lowTxt+' · ':'')+t('Modifikator, gilt für alle Teile mit dieser Farbe')}));
  (p.texts||[]).filter(x=>x.mode!=='engraved').forEach(x=>out.push({kind:'text',key:x.id,slot:x.slot??null,eff:x.slot??own,label:'„'+x.text+'“',sub:t('Beschriftung')}));
  return out;
}
/* Teileliste wie in OrcaSlicer: je Teil ein farbiger Slot-Chip (Klick → Slot wählen), Name, Maße, Stützenbedarf, ✕.
   Die gewählte Zeile zeigt darunter Platte und Anzahl (Kopien) – ohne Umweg über die Plattenübersicht. */
function renderPartList(){
  const list=$('partList');
  if(!project){list.innerHTML='';return}
  const th=+$('thresh').value,label={none:t('ohne Stützen'),few:t('wenig Stützen'),needed:t('Stützen')};
  const def=typeof defaultSlot==='function'?defaultSlot():0,many=project.parts.length>1;
  const tpl=typeof plTpl==='function'?plTpl():null,lay=tpl&&typeof projectLayout==='function'?projectLayout(tpl):null;
  /* Kopien als eine Zeile (×n), Teile eines Modells (gleiche Datei) unter einer Kopfzeile mit gemeinsamer Anzahl – so sind
     z. B. 20 Sätze eines Modells aus zwei Teilen eine Eingabe (vorher je Teil einzeln, 40 Zeilen). */
  const groupOf=p=>p.copyGroup?project.parts.filter(x=>x.copyGroup===p.copyGroup):[p];
  const isBase=(p,i)=>!p.copyGroup||project.parts.findIndex(x=>x.copyGroup===p.copyGroup)===i;
  const bases=project.parts.map((p,i)=>i).filter(i=>isBase(project.parts[i],i));
  const bySrc=new Map();bases.forEach(i=>{const k=project.parts[i].src||'';(bySrc.get(k)||bySrc.set(k,[]).get(k)).push(i)});
  const curBase=(()=>{const p=project.parts[project.selected];return p?project.parts.indexOf(groupOf(p)[0]):-1})();
  const shown=new Set(),srcHead=i=>{const p=project.parts[i],k=p.src||'',grp=bySrc.get(k)||[];
    if(!k||grp.length<2||shown.has(k))return '';shown.add(k);
    const counts=grp.map(j=>groupOf(project.parts[j]).length),same=counts.every(c=>c===counts[0]);
    return '<li class="src-head"><span class="src-name" title="'+esc(p.srcName||'')+'">'+esc(p.srcName||t('Modell'))+'<small>'+esc(t('{n} Teile',{n:grp.length}))+'</small></span>'+
      '<span class="pcount">'+t('Anzahl')+' <span class="stepper"><button type="button" data-src-copies="-1" data-src="'+esc(k)+'" aria-label="'+esc(t('Ein Satz weniger'))+'">−</button>'+
      '<input data-src-copies-n data-src="'+esc(k)+'" type="number" min="1" max="50" step="1" inputmode="numeric" value="'+(same?counts[0]:'')+'" placeholder="–" aria-label="'+esc(t('Anzahl für alle Teile des Modells'))+'">'+
      '<button type="button" data-src-copies="1" data-src="'+esc(k)+'" aria-label="'+esc(t('Ein Satz mehr'))+'">+</button></span></span></li>'};
  list.innerHTML=project.parts.map((p,i)=>{
    if(!isBase(p,i))return '';
    const g=p.geom,lv=analyze(g,th).level,sel=i===curBase,nCopies=groupOf(p).length,inSrc=(bySrc.get(p.src||'')||[]).length>1&&!!p.src;
    const pl=lay&&lay.count>1?[...new Set(groupOf(p).map(x=>lay.plateOf[project.parts.indexOf(x)]))].sort((a,b)=>a-b):[];
    const plate=pl.length?(pl.length>1?t('Platten {list}',{list:pl.join(', ')}):t('Platte {n}',{n:pl[0]}))+' · ':'';
    const head=srcHead(i),shortName=inSrc&&p.srcName&&p.name.startsWith(p.srcName+' · ')?p.name.slice(p.srcName.length+3):p.name.replace(/ \(\d+\)$/,'');
    let tools='';
    const cols=partColours(p),dots=[...new Set(cols.flatMap(c=>c.effs||[c.eff]))].filter(s=>s!=null&&s!==(p.slot??def));
    const slots=typeof slotChoices==='function'?slotChoices():[],dot=s=>'<span class="pdot" style="background:'+(slots[s]&&/^#[0-9a-f]{6}$/i.test(slots[s].colour)?slots[s].colour:'#c7ccd4')+'" title="Slot '+(s+1)+'"></span>';
    if(sel&&cols.length)tools+='<ul class="pcols" aria-label="'+esc(t('Farben im Teil'))+'">'+cols.map(c=>c.kind==='info'?'<li><span class="pdots">'+[...new Set(c.effs)].map(dot).join('')+'</span><span class="pcol-name">'+esc(c.label)+'<small>'+esc(c.sub)+'</small></span></li>':'<li data-pcol-row="'+c.kind+':'+c.key+'">'+
      (c.dcol?'<span class="dsw" style="background:'+esc(c.dcol)+'" title="'+esc(t('Farbe des Designers: {c}',{c:c.dcol}))+'"></span><span class="dc-arrow">→</span>':'')+
      slotChipHTML(c.slot,c.kind==='mod'?c.key:c.kind==='base'?def:(p.slot??def),'data-pcol="'+c.kind+':'+c.key+'"',c.label)+'<span class="pcol-name">'+esc(c.label)+(c.sub?'<small>'+esc(c.sub)+'</small>':c.slot==null?'<small>'+t('wie Teil')+'</small>':'')+'</span></li>').join('')+
      (p.paintTris&&!p.paintState?'<li class="muted small">'+t('Bemalung des Designers bleibt wie in der 3MF')+'</li>':'')+'</ul>';
    if(sel&&lay){
      const n=typeof copyGroupOf==='function'?copyGroupOf(p).length:1,cur=lay.plateOf[i];
      const opts=Array.from({length:lay.count},(_,k)=>'<option value="'+(k+1)+'"'+(k+1===cur?' selected':'')+'>'+t('Platte {n}',{n:k+1})+'</option>').join('')+'<option value="'+(lay.count+1)+'">'+t('Neue Platte')+'</option>';
      tools+='<div class="ptools">'+(lay.fixed3mf?'':'<label>'+t('Platte')+' <select data-part-move="'+i+'" aria-label="'+esc(t('Auf Platte verschieben'))+'">'+opts+'</select></label>')+
        '<span class="pcount">'+t('Anzahl')+' <span class="stepper"><button type="button" data-copies="-1" aria-label="'+esc(t('Eine Kopie weniger'))+'">−</button>'+
        '<input data-copies-n type="number" min="1" max="50" step="1" inputmode="numeric" value="'+n+'" aria-label="'+esc(t('Anzahl des gewählten Teils'))+'">'+
        '<button type="button" data-copies="1" aria-label="'+esc(t('Eine Kopie mehr'))+'">+</button></span></span></div>';
    }
    return head+'<li class="'+(sel?'sel':'')+(inSrc?' in-src':'')+'">'+slotChipHTML(p.slot??null,def,'data-part-slot="'+i+'"',p.name)+
      '<button type="button" data-part="'+i+'"'+(sel?' aria-current="true"':'')+' title="'+esc(p.name)+'"><span class="pname">'+esc(shortName)+(nCopies>1?' <span class="pcopies">×'+nCopies+'</span>':'')+'</span>'+
      '<span class="pmeta">'+(dots.length?'<span class="pdots">'+dots.map(dot).join('')+'</span>':'')+plate+(p.bodies?t('{n} Körper',{n:p.bodies.length})+' · ':'')+de(g.x,0)+'×'+de(g.y,0)+'×'+de(g.z,0)+' mm</span><span class="plevel '+lv+(sel?'':' dot')+'" title="'+esc(label[lv])+'">'+(sel?label[lv]:'')+'</span></button>'+
      (many&&project.parts.length>nCopies?'<button type="button" class="pdel" data-del-part="'+i+'" title="'+esc(nCopies>1?t('Teil mit allen {n} Kopien entfernen',{n:nCopies}):t('Teil entfernen'))+'" aria-label="'+esc(t('„{name}“ entfernen',{name:p.name}))+'">✕</button>':'')+tools+'</li>';
  }).join('');
  if(typeof renderFilamentBar==='function')renderFilamentBar();
}
$('partList').addEventListener('click',e=>{
  const d=e.target.closest('[data-del-part]');if(d){const p=project.parts[+d.dataset.delPart];removeParts(p.copyGroup?project.parts.map((x,k)=>x.copyGroup===p.copyGroup?k:-1).filter(k=>k>=0):[+d.dataset.delPart]);return}
  const sc=e.target.closest('[data-src-copies]');if(sc){setSourceCopies(sc.dataset.src,null,+sc.dataset.srcCopies);return}
  const c=e.target.closest('[data-part-slot]');
  if(c){const p=project.parts[+c.dataset.partSlot],def=defaultSlot();
    openSlotPicker(c,p.slot??null,{title:t('Slot für {name}',{name:p.name}),std:t('Standard (Slot aus dem Export-Dialog)'),stdSlot:def},v=>setPartSlot(p,v));return}
  const pc=e.target.closest('[data-pcol]');
  if(pc){const p=project.parts[project.selected],[kind,key]=pc.dataset.pcol.split(':'),k=+key,def=defaultSlot();
    if(kind==='base'){openSlotPicker(pc,p.slot??null,{title:t('Slot für {name}',{name:p.name}),std:t('Standard (Slot aus dem Export-Dialog)'),stdSlot:def},v=>setPartSlot(p,v))}
    else if(kind==='body'){const b=p.bodies[k];openSlotPicker(pc,b.slot??null,{title:t('Slot für {name}',{name:t(b.name)}),std:t('wie Teil'),stdSlot:p.slot??def},v=>{samePlacements(p).forEach(x=>{if(x.bodies&&x.bodies[k])x.bodies[k].slot=v});update()})}
    else if(kind==='mod'){const map=project.threemf.designMap;openSlotPicker(pc,map[k]??k,{title:t('Slot für Farbe {n} des Designers',{n:k+1}),std:t('wie vom Designer (Slot {n})',{n:k+1}),stdSlot:k},v=>setDesignSlot(k,v??k))}
    else if(kind==='text'){const x=(p.texts||[]).find(y=>String(y.id)===key);if(x)openSlotPicker(pc,x.slot??null,{title:t('Slot für {name}',{name:x.text}),std:t('wie Teil'),stdSlot:p.slot??def},v=>{x.slot=v;update()})}
    return}
  const k=e.target.closest('[data-copies]');if(k){const p=project.parts[project.selected];setCopies(p,copyGroupOf(p).length+ +k.dataset.copies);return}
  const b=e.target.closest('[data-part]');if(b&&+b.dataset.part!==project.selected){selectPart(+b.dataset.part);const nb=$('partList').querySelector('[data-part="'+b.dataset.part+'"]');if(nb)nb.focus()}});
$('partList').addEventListener('change',e=>{
  const m=e.target.closest('[data-part-move]');if(m){movePart(+m.dataset.partMove,+m.value);return}
  const n=e.target.closest('[data-copies-n]');if(n)setCopies(project.parts[project.selected],num(n.value)||1);
  const sn=e.target.closest('[data-src-copies-n]');if(sn&&num(sn.value)>0)setSourceCopies(sn.dataset.src,num(sn.value),0);
});
// Anzahl für alle Teile eines Modells (Kopfzeile): jedes Teil der Datei bekommt n Exemplare (bzw. eins mehr/weniger)
function setSourceCopies(src,n,delta){
  if(!project)return;
  const bases=project.parts.filter((p,i)=>p.src===src&&(!p.copyGroup||project.parts.findIndex(x=>x.copyGroup===p.copyGroup)===i));
  const sel=project.parts[project.selected];
  for(const b of bases){const cur=copyGroupOf(b).length,want=Math.max(1,Math.min(50,n!=null?Math.round(n):cur+delta));if(want!==cur)setCopies(b,want)}
  const k=project.parts.indexOf(sel);if(k>=0&&k!==project.selected)selectPart(k);
  toast(t('{name}: {n} Sätze',{name:bases[0]?bases[0].srcName||'':'',n:copyGroupOf(bases[0]).length}));
}
// Körper beim Überfahren in der 3D-Ansicht hervorheben (wie bisher in „Mehrfarbig“)
$('partList').addEventListener('mouseover',e=>{const r=e.target.closest('[data-pcol-row^="body:"]');if(r&&typeof paintBodies==='function')paintBodies(project.parts[project.selected],+r.dataset.pcolRow.split(':')[1])});
$('partList').addEventListener('mouseout',e=>{if(e.target.closest('[data-pcol-row^="body:"]')&&!e.relatedTarget?.closest?.('[data-pcol-row^="body:"]')&&typeof paintBodies==='function')paintBodies(project.parts[project.selected])});
// Entf in der Teileliste: gewähltes Teil entfernen
$('partList').addEventListener('keydown',e=>{const b=e.target.closest('[data-part]');if(b&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();removePart(+b.dataset.part)}});

/* Einzelnes Teil aus dem Projekt entfernen (mindestens eins bleibt). Teile aus einer 3MF fehlen danach im Export:
   threemf.removed erzwingt neu geschriebene Build-Items; Platten ohne eigene Teile behalten die Lage des Designers.
   „Rückgängig“ in der Meldung stellt den Stand davor wieder her. */
function removePart(i){removeParts([i])}
// mehrere Teile auf einmal (✕ an einer Zeile mit Kopien: das Teil mit allen Kopien)
function removeParts(idxs){
  idxs=[...new Set(idxs)].filter(i=>project&&project.parts[i]).sort((a,b)=>b-a);
  if(!project||!idxs.length||project.parts.length-idxs.length<1)return;
  const before={parts:project.parts.slice(),selected:project.selected,removed:project.threemf&&project.threemf.removed,groups:project.parts.map(p=>p.copyGroup)};
  const p=project.parts[idxs[idxs.length-1]],tpl=lastResult&&exportTemplate(lastResult.printer.id,lastResult.dSel),first=idxs[idxs.length-1];
  for(const i of idxs){const q=project.parts[i];if(project.threemf&&q.objectId!=null&&!q.extra)project.threemf.removed=true;project.parts.splice(i,1)}
  const groups=new Set(idxs.map(i=>before.parts[i].copyGroup).filter(Boolean));
  for(const g of groups){const rest=project.parts.filter(x=>x.copyGroup===g);if(rest.length===1)rest[0].copyGroup=null}
  project.parts.forEach((x,k)=>{x.id=k});
  if(tpl&&typeof normalizePlates==='function')normalizePlates(tpl);
  const below=idxs.filter(i=>i<project.selected).length,sel=idxs.includes(project.selected)?Math.min(first,project.parts.length-1):project.selected-below;
  afterPartsChanged(sel);
  toast(idxs.length>1?t('„{name}“ mit {n} Kopien entfernt',{name:p.name.replace(/ \(\d+\)$/,''),n:idxs.length}):t('„{name}“ entfernt',{name:p.name}),{label:t('Rückgängig'),fn:()=>{
    project.parts=before.parts;project.parts.forEach((x,k)=>{x.id=k;x.copyGroup=before.groups[k]});
    if(project.threemf)project.threemf.removed=before.removed;
    afterPartsChanged(before.selected);
  }});
}
function afterPartsChanged(sel){
  renderFileinfo();
  $('partList').classList.remove('hidden');
  selectPart(Math.max(0,Math.min(sel,project.parts.length-1)));
  const f=$('partList').querySelector('[data-part="'+project.selected+'"]');if(f&&$('partList').contains(document.activeElement))f.focus();
}

/* „Ganze Platte“: alle Teile der Platte des gewählten Teils so, wie sie auf dem Bett stehen (Anordnung wie in der
   Plattenübersicht, js/plates-ui.js projectLayout). Nur Ansicht – Auswahl, Datenblatt und Überhangwerte bleiben beim
   gewählten Teil; zum Anklicken von Flächen (Lage, Beschriftung) schaltet die Ansicht zurück aufs Teil. */
let plateView=false,shownPlate=null;
function plateGeom(){
  const tpl=typeof plTpl==='function'&&plTpl(),lay=tpl&&projectLayout(tpl);
  if(!lay||!project)return null;
  const k=lay.plateOf[project.selected],idx=project.parts.map((p,i)=>i).filter(i=>lay.plateOf[i]===k);
  let n=0;idx.forEach(i=>{n+=project.parts[i].geom.pos.length});
  // 3MF in Designer-Lage: die Platten liegen nebeneinander – wie beim Export (plateShifts) auf die Bettmitte rücken
  let sx=0,sy=0;
  if(!lay.places){const G=idx.map(i=>project.parts[i].geom),[bx,by]=tpl.bedCenter;
    sx=bx-(Math.min(...G.map(g=>g.mn[0]))+Math.max(...G.map(g=>g.mx[0])))/2;sy=by-(Math.min(...G.map(g=>g.mn[1]))+Math.max(...G.map(g=>g.mx[1])))/2}
  const pos=new Float32Array(n),ranges=[];let o=0;
  for(const i of idx){
    const g=project.parts[i].geom,pl=lay.places&&lay.places[i],cx=(g.mn[0]+g.mx[0])/2,cy=(g.mn[1]+g.mx[1])/2,P=g.pos,z0=g.mn[2];
    // dieselbe Umrechnung auch für Farb-Modifikatoren (js/bodies-ui.js modOverlayFor)
    const xf=pl?(x,y,z)=>{const [u,v]=placeXY(pl,x-cx,y-cy);return[u+pl.lx,v+pl.ly,z-z0]}:(x,y,z)=>[x+sx,y+sy,z-z0];
    ranges.push({i,start:o/9,count:P.length/9,xf});
    for(let v=0;v<P.length;v+=3){
      if(pl){const [u,w]=placeXY(pl,P[v]-cx,P[v+1]-cy);pos[o]=u+pl.lx;pos[o+1]=w+pl.ly}   // wie placeTransform (Drehung um Z in 90°-Schritten)
      else{pos[o]=P[v]+sx;pos[o+1]=P[v+1]+sy}                                                     // 3MF: Lage des Designers
      pos[o+2]=P[v+2]-g.mn[2];o+=3;
    }
  }
  const pg=makeGeom(t('Platte {n}',{n:k}),pos),c=tpl.bedCenter;
  // Kamera auf die Teile (um die Bettmitte, damit der Bauraum passt), nicht aufs ganze Bett
  const frame=2.1*Math.max(...[0,1].map(a=>Math.max(Math.abs(pg.mn[a]-c[a]),Math.abs(pg.mx[a]-c[a]))));
  return{geom:pg,plate:k,count:idx.length,center:c,frame,ranges};
}
function showModel(g){
  geom=g;
  const n=g.n;
  $('sx').textContent=de(g.x,1)+' mm';$('sy').textContent=de(g.y,1)+' mm';$('sz').textContent=de(g.z,1)+' mm';$('sv').textContent=de(g.vol/1000,1)+' cm³';
  // Kopf der 3D-Ansicht: Name fett, darunter Maße, Dreiecke und – falls geändert – die Größe
  const part=project&&project.parts[project.selected],sc=part&&part.scale;
  const info=(title,meta)=>{$('info').innerHTML='<b class="i-name" title="'+esc(title)+'">'+esc(title)+'</b><span class="i-meta">'+meta.map(esc).join('<span class="i-dot">·</span>')+'</span>'};
  info(g.name,[t('{n} Dreiecke',{n:n.toLocaleString(LOCALE())})].concat(sc?[t('Größe {p}',{p:sc[0]===sc[1]&&sc[1]===sc[2]?de(sc[0]*100,0)+' %':sc.map(v=>de(v*100,0)).join(' / ')+' %'})]:[]));
  $('ohBar').classList.remove('hidden');
  // Ohne Renderer bleibt der Hinweis „3D-Ansicht nicht verfügbar“ sichtbar (wie in v4).
  const pg=plateView&&project&&project.parts.length>1?plateGeom():null;
  shownPlate=pg;
  if(pg?Viewer.show(pg.geom,{center:pg.center,frame:pg.frame}):Viewer.show(g))$('viewerEmpty').classList.add('hidden');
  if(pg)info(t('Platte {n}',{n:pg.plate}),[t('{n} Teile',{n:pg.count}),t('gewählt: {name}',{name:g.name})]);
  Viewer.colorize(+$('thresh').value);
  showVolume();
  if(miniReady){$('miniView').classList.remove('hidden');MiniView.show(g);MiniView.colorize(+$('thresh').value)}
  update();
}
// Bauraum des gewählten Druckers in der 3D-Ansicht; Warnung, wenn das gewählte Teil nicht hineinpasst
function showVolume(){
  const tpl=lastResult&&exportTemplate(lastResult.printer.id,lastResult.dSel),g=geom;
  const vol=tpl?buildVolume(tpl):null,ex=vol&&g?volumeExcess(g,vol):[];
  Viewer.setVolume(vol,ex.length>0);
  const w=$('volWarn');
  w.textContent=ex.length?t('Passt nicht in den Bauraum ({size} mm): {over}. Teil drehen (Lage auf dem Bett) oder in OrcaSlicer skalieren/teilen.',{size:de(vol[0],0)+' × '+de(vol[1],0)+(isFinite(vol[2])?' × '+de(vol[2],0):''),over:ex.join(', ')}):'';
  w.classList.toggle('hidden',!ex.length);
}
function clearModel(){
  Viewer.clear();Viewer.setVolume(null);$('volWarn').classList.add('hidden');
  if(miniReady){MiniView.clear();$('miniView').classList.add('hidden')}
  $('ohBar').classList.add('hidden');$('info').textContent='';
  document.querySelectorAll('.oh-info').forEach(el=>{el.textContent=''});
  $('modelCard').classList.remove('loaded');$('modelBadge').classList.add('hidden');$('removeModelWrap').classList.add('hidden');
  $('partList').classList.add('hidden');$('partList').innerHTML='';$('importNotes').classList.add('hidden');
  $('viewerEmpty').classList.remove('hidden');
}

$('thresh').addEventListener('input',()=>{$('threshVal').textContent=$('thresh').value+'°';Viewer.colorize(+$('thresh').value);if(miniReady)MiniView.colorize(+$('thresh').value);update()});

/* ================= DRUCKER-UMSCHALTUNG ================= */
const printerButtons=[...document.querySelectorAll('.printer-switch [data-printer]')];
function syncPrinterSwitch(){
  printerButtons.forEach(b=>b.setAttribute('aria-checked',String(b.dataset.printer===$('printer').value)));
}
printerButtons.forEach(b=>b.addEventListener('click',()=>{
  // „Anderer Drucker“ öffnet immer die Auswahl (auch zum Wechseln des Modells)
  if(b.dataset.printer==='orca'){openPrinterPicker();return}
  if($('printer').value===b.dataset.printer)return;
  $('printer').value=b.dataset.printer;
  $('printer').dispatchEvent(new Event('change'));
  syncPrinterSwitch();
}));
// Pfeiltasten wechseln innerhalb der Radiogruppe
document.querySelector('.printer-switch').addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
  const i=printerButtons.findIndex(b=>b.getAttribute('aria-checked')==='true');
  const next=printerButtons[(i+(e.key==='ArrowRight'?1:printerButtons.length-1))%printerButtons.length];
  next.click();next.focus();
});

/* ================= MENÜS ================= */
const menus=[...document.querySelectorAll('.menu')];
function closeMenus(except){
  menus.forEach(m=>{if(m===except)return;m.querySelector('.menu-list').classList.remove('open');m.querySelector('.menu-btn').setAttribute('aria-expanded','false')});
}
menus.forEach(m=>{
  const btn=m.querySelector('.menu-btn'),list=m.querySelector('.menu-list');
  btn.addEventListener('click',()=>{
    const open=!list.classList.contains('open');
    closeMenus(m);list.classList.toggle('open',open);btn.setAttribute('aria-expanded',String(open));
    if(open){const first=list.querySelector('button:not(:disabled)');if(first)first.focus()}
  });
  list.addEventListener('keydown',e=>{
    const items=[...list.querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();items[(i+1)%items.length].focus()}
    if(e.key==='ArrowUp'){e.preventDefault();items[(i+items.length-1)%items.length].focus()}
  });
  // Nach der Aktion schließen; die Aktion selbst hängt an der ID bzw. data-action.
  list.addEventListener('click',e=>{
    const item=e.target.closest('button');if(!item||item.disabled)return;
    closeMenus();btn.focus({preventScroll:true});
    if(item.dataset.toast)toast(t(item.dataset.toast));
    else if(item.id==='copyBtn')setTimeout(()=>toast(item.textContent),120);
  });
});
document.addEventListener('click',e=>{if(!e.target.closest('.menu'))closeMenus()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus()});

/* data-action: gemeinsame Aktionen für Menü, Modellkarte und leere 3D-Ansicht */
const ACTIONS={
  open:()=>{addMode=false;input.click()},
  add:()=>{addMode=!!project;input.click()},
  profiles:()=>{renderMyList();$('profilesDlg').showModal()},
  help:()=>$('helpDlg').showModal(),
  disclaimer:()=>{if($('helpDlg').open)$('helpDlg').close();$('disclaimerDlg').showModal()}
};
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-action]');if(a&&ACTIONS[a.dataset.action])ACTIONS[a.dataset.action]();
  const c=e.target.closest('[data-click]');if(c)$(c.dataset.click).click();
  const x=e.target.closest('[data-close]');if(x)x.closest('dialog').close();
});
['profilesDlg','helpDlg'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()}));

/* Erklärungen (?): per Maus, Tastatur und Tippen erreichbar. Der Text steht im title-Attribut
   (so erzeugt vom Rechenkern); er wandert nach data-tip, damit kein doppelter Browser-Tooltip erscheint. */
function enhanceHelp(){
  document.querySelectorAll('.help[title]').forEach(el=>{
    el.dataset.tip=el.title;el.removeAttribute('title');
    el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',t('Erklärung: {tip}',{tip:el.dataset.tip}));
  });
}
let tipOwner=null;
function showTip(el){
  const tip=$('tip');tipOwner=el;tip.textContent=el.dataset.tip;tip.hidden=false;
  el.setAttribute('aria-expanded','true');
  const r=el.getBoundingClientRect(),w=Math.min(320,window.innerWidth-16);
  tip.style.left=Math.max(8,Math.min(r.left-12,window.innerWidth-w-8))+'px';
  const below=r.bottom+8,h=tip.offsetHeight;
  tip.style.top=(below+h>window.innerHeight?r.top-h-8:below)+'px';
}
function hideTip(){if(!tipOwner)return;tipOwner.setAttribute('aria-expanded','false');tipOwner=null;$('tip').hidden=true}
document.addEventListener('mouseover',e=>{const h=e.target.closest('.help[data-tip]');if(h)showTip(h);else if(tipOwner&&!tipOwner.contains(document.activeElement)&&document.activeElement!==tipOwner)hideTip()});
document.addEventListener('focusin',e=>{const h=e.target.closest('.help[data-tip]');if(h)showTip(h);else hideTip()});
document.addEventListener('click',e=>{const h=e.target.closest('.help[data-tip]');if(h){e.preventDefault();tipOwner===h?hideTip():showTip(h)}});
document.addEventListener('keydown',e=>{
  const h=e.target.closest&&e.target.closest('.help[data-tip]');
  if(h&&(e.key==='Enter'||e.key===' ')){e.preventDefault();tipOwner===h?hideTip():showTip(h)}
  if(e.key==='Escape')hideTip();
});
document.addEventListener('scroll',hideTip,true);

let toastTimer=0;
// action: {label, fn} – Knopf in der Meldung (z. B. „Rückgängig“), dann bleibt sie länger stehen
function toast(text,action){
  const el=$('toast');el.textContent=text;el.classList.add('show');el.classList.toggle('has-action',!!action);
  if(action){const b=document.createElement('button');b.type='button';b.textContent=action.label;
    b.addEventListener('click',()=>{el.classList.remove('show');clearTimeout(toastTimer);action.fn()});el.appendChild(b)}
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),action?6000:2200);
}

/* Drucken: alle Aufklappbereiche öffnen, danach Zustand wiederherstellen */
let foldState=[];
window.addEventListener('beforeprint',()=>{
  const folds=[...document.querySelectorAll('details.fold')];
  foldState=folds.map(d=>d.open);folds.forEach(d=>{d.open=true});
});
window.addEventListener('afterprint',()=>{document.querySelectorAll('details.fold').forEach((d,i)=>{d.open=foldState[i]??d.open})});

/* ================= TABS ================= */
const TAB_KEY='druckKonfigurator.tab';
// Reihenfolge = Arbeitsschritte (Pfeiltasten gehen sie der Reihe nach durch)
const tabs={'3d':[$('tab3d'),$('view3d')],settings:[$('tabSettings'),$('viewSettings')],slice:[$('tabSlice'),$('viewSlice')],printer:[$('tabPrinter'),$('viewPrinter')]};
function setTab(name){
  Object.entries(tabs).forEach(([k,[btn,view]])=>{const on=k===name;btn.setAttribute('aria-selected',String(on));view.hidden=!on});
  document.body.dataset.tab=name;
  // schmale Reiterleiste (Handy): gewählten Reiter ganz ins Bild holen, ohne die Seite zu verschieben
  {const bar=document.querySelector('.tabs'),b=tabs[name]&&tabs[name][0];if(bar&&b&&bar.scrollWidth>bar.clientWidth){const r=b.getBoundingClientRect(),q=bar.getBoundingClientRect();if(r.left<q.left||r.right>q.right)bar.scrollBy({left:r.left-q.left-(q.width-r.width)/2,behavior:'smooth'})}}
  try{localStorage.setItem(TAB_KEY,name)}catch(e){/* nur Komfort */}
  if(typeof onWorkbenchTab==='function')onWorkbenchTab(name==='printer');
  if(name==='slice'&&typeof refreshSlicePreview==='function')refreshSlicePreview();
}
Object.entries(tabs).forEach(([k,[btn]])=>btn.addEventListener('click',()=>setTab(k)));
document.querySelector('.tabs').addEventListener('keydown',e=>{
  if(['ArrowLeft','ArrowRight'].includes(e.key)){const order=Object.keys(tabs),i=order.indexOf(document.body.dataset.tab),next=order[(i+(e.key==='ArrowRight'?1:order.length-1))%order.length];setTab(next);tabs[next][0].focus()}
});

/* ================= VIEWER-BEDIENUNG (aus 3dView) ================= */
function toggleButton(id,onChange){
  const b=$(id);
  b.addEventListener('click',()=>{const on=!b.classList.contains('active');b.classList.toggle('active',on);onChange(on)});
}
toggleButton('btnWireframe',on=>Viewer.setWireframe(on));
toggleButton('btnAxes',on=>Viewer.setAxes(on));
toggleButton('btnClip',on=>{Viewer.setClip(on);$('clipPanel').classList.toggle('hidden',!on)});
toggleButton('btnMeasure',on=>Viewer.setMeasure(on,text=>{$('measureLabel').textContent=text}));
toggleButton('btnPlate',on=>{plateView=on;if(geom)showModel(geom)});
// Flächen anklicken (Lage aufs Bett, Beschriftung) braucht die Dreiecke des Teils – dafür zurück zur Teilansicht
{const setPick=Viewer.setPick;Viewer.setPick=(on,...a)=>{if(on&&plateView){plateView=false;$('btnPlate').classList.remove('active');if(geom)showModel(geom)}return setPick(on,...a)}}
['x','y','z'].forEach(axis=>{
  $('clipAxis'+axis.toUpperCase()).addEventListener('click',()=>{
    ['X','Y','Z'].forEach(k=>$('clipAxis'+k).classList.toggle('active',k===axis.toUpperCase()));
    $('clipSlider').value=0;Viewer.setClipAxis(axis);
  });
});
$('clipSlider').addEventListener('input',()=>Viewer.setClipFraction(Number($('clipSlider').value)/100));

/* ================= START (aus v4) ================= */
// Kleine 3D-Vorschau in der Modell-Spalte (fällt ohne WebGL einfach weg)
let miniReady=false;
if(MiniView.available()){try{MiniView.init($('miniView'));miniReady=true}catch(e){/* ohne Vorschau weiter */}}
if(Viewer.available()){
  try{Viewer.init($('stage'))}catch(e){$('viewerEmpty').textContent=t('3D-Ansicht konnte nicht gestartet werden. Die Analyse funktioniert trotzdem.')}
}else $('viewerEmpty').textContent=t('3D-Ansicht nicht verfügbar (three.js fehlt im Ordner vendor/). Die Analyse und alle Empfehlungen funktionieren trotzdem.');
loadStore();
if(store.last.printer&&PRINTERS[store.last.printer])$('printer').value=store.last.printer;
fillNozzleMaterialSelect();
fillMaterialSelect(store.last.material||'pla_hs');
if(store.last.nozD&&NOZ[nkey(store.last.nozD)])$('nozD').value=store.last.nozD;
if(store.last.nozM&&NOZZLE_MATERIALS[store.last.nozM]&&currentPrinter().nozzleOptions.includes(store.last.nozM))$('nozM').value=store.last.nozM;
if(!storageOK)persist();
syncPrinterSwitch();
// Start: zuletzt genutzter Schritt, beim ersten Mal „Modell“
try{const t=localStorage.getItem(TAB_KEY);setTab(tabs[t]?t:'3d')}catch(e){setTab('3d')}

/* Haftungsausschluss: beim ersten Start (und nach inhaltlicher Änderung, neue Versionsnummer) einmal bestätigen.
   Ist kein Speichern möglich, erscheint er bei jedem Start – lieber einmal zu oft als gar nicht. */
const DISCLAIMER_KEY='druckKonfigurator.disclaimer',DISCLAIMER_VERSION='2';
$('disclaimerOk').addEventListener('click',()=>{try{localStorage.setItem(DISCLAIMER_KEY,DISCLAIMER_VERSION)}catch(e){/* nicht speicherbar */}$('disclaimerDlg').close()});
{let seen=null;try{seen=localStorage.getItem(DISCLAIMER_KEY)}catch(e){/* nicht lesbar */}
 if(seen!==DISCLAIMER_VERSION)$('disclaimerDlg').showModal()}
update();

/* Modell entfernen (Knopf in der Modellkarte): alles – oder, wenn mehrere Modelle hinzugefügt wurden, nur eines davon
   (alle Teile dieser Datei-Auswahl samt Kopien). „Rückgängig“ in der Meldung holt es zurück. */
function projectSources(){
  const m=new Map();
  (project?project.parts:[]).forEach(p=>{const k=p.src||'-';if(!m.has(k))m.set(k,{src:k,name:p.srcName||project.name,count:0});m.get(k).count++});
  return[...m.values()];
}
function clearProjectWithUndo(){
  const before=project;
  $('clear').click();
  if(before)toast(t('Modell entfernt'),{label:t('Rückgängig'),fn:()=>{showProject(before);update()}});
}
function removeSource(src){
  const keep=project.parts.filter(p=>(p.src||'-')!==src);
  if(!keep.length){clearProjectWithUndo();return}
  const before={parts:project.parts.slice(),selected:project.selected,removed:project.threemf&&project.threemf.removed,name:project.name};
  const gone=project.parts.find(p=>(p.src||'-')===src),tpl=lastResult&&exportTemplate(lastResult.printer.id,lastResult.dSel);
  // war es die 3MF selbst, bleibt nur noch das Hinzugefügte – als einfache Teile
  if(project.threemf&&project.parts.some(p=>(p.src||'-')===src&&p.objectId!=null&&!p.extra))project.threemf.removed=true;
  project.parts=keep;project.parts.forEach((x,k)=>{x.id=k});
  if(tpl&&typeof normalizePlates==='function')normalizePlates(tpl);
  afterPartsChanged(0);
  toast(t('„{name}“ entfernt',{name:gone.srcName||gone.name}),{label:t('Rückgängig'),fn:()=>{
    project.parts=before.parts;project.parts.forEach((x,k)=>{x.id=k});if(project.threemf)project.threemf.removed=before.removed;afterPartsChanged(before.selected)}});
}
$('removeModelBtn').addEventListener('click',e=>{
  if(!project)return;
  const srcs=projectSources();
  if(srcs.length<2){clearProjectWithUndo();return}
  // Auswahl wie beim Slot-Chip: alles oder ein einzelnes Modell
  const el=slotPop.el||(slotPop.el=document.createElement('div'));
  closeSlotPicker();
  el.className='slot-pop';el.setAttribute('role','menu');el.setAttribute('aria-label',t('Modell entfernen'));
  el.innerHTML='<button type="button" data-rm="*"><span class="sp-main">'+t('Alles entfernen')+'</span><span class="sp-sub">'+t('{n} Teile',{n:project.parts.length})+'</span></button>'+
    srcs.map(s=>'<button type="button" data-rm="'+esc(s.src)+'"><span class="sp-main">'+esc(t('Nur „{name}“',{name:s.name}))+'</span><span class="sp-sub">'+t(s.count>1?'{n} Teile':'{n} Teil',{n:s.count})+'</span></button>').join('');
  el.querySelectorAll('button').forEach(b=>{b.style.gridTemplateColumns='1fr'});
  document.body.appendChild(el);
  const r=e.currentTarget.getBoundingClientRect();el.style.left=Math.max(8,Math.min(innerWidth-el.offsetWidth-8,r.right-el.offsetWidth))+'px';el.style.top=(r.bottom+6)+'px';
  slotPop.anchor=e.currentTarget;slotPop.onPick=null;
  el.onclick=ev=>{const b=ev.target.closest('[data-rm]');if(!b)return;ev.stopPropagation();closeSlotPicker();el.onclick=null;b.dataset.rm==='*'?clearProjectWithUndo():removeSource(b.dataset.rm)};
});
