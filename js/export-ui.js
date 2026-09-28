'use strict';
/* Bedienung des 3MF-Exports: Menüpunkt freischalten, Belegung live vom Drucker laden,
   Slot wählen, Änderungen zeigen, speichern. Dazu der Dialog „Drucker-Verbindung“. */

// Menüpunkt nach jeder Neuberechnung aktualisieren (aufgerufen aus update()).
function updateExportMenu(r){
  const btn=$('export3mf'),note=$('export3mfNote'),cta=$('export3mfCta'),ctaNote=$('export3mfCtaNote');
  const tpl=exportTemplate(r.printer.id,r.dSel);
  let reason='';
  if(!tpl&&r.printer.orca)reason='Düse passt nicht zum Orca-Profil ('+de(+r.printer.orca.nozzle,2)+' mm) – unter „Drucker …“ das Profil mit '+de(+r.dSel,2)+' mm wählen';
  else if(!tpl)reason='nur mit 0,4-mm-Düse (keine Vorlage für '+de(+r.dSel,r.dSel==='0.25'?2:1)+' mm)';
  else if(!project)reason='zuerst ein Modell laden';
  btn.disabled=!!reason;
  note.textContent=reason||'Slot wählen und speichern';
  cta.disabled=!!reason;
  ctaNote.textContent=reason||'öffnet den Dialog zur Slot-Wahl';
}
$('export3mfCta').addEventListener('click',openExportDialog);

const printerHost=id=>((store.settings.printerHosts||{})[id]||'').trim();
function slotKey(printerId){return 'exportSlot_'+printerId}
function chosenSlot(){const c=document.querySelector('input[name="slot"]:checked');return c?+c.value:0}

/* Aktuelle Belegung je Slot: live vom Drucker (ACE über Werksfirmware oder Moonraker), sonst deine Angabe
   (bleibt gespeichert, bis du sie änderst), sonst unbekannt. Slots mit „Überschreiben“ nehmen immer deine
   Angabe – auch wenn der Drucker etwas anderes meldet (z. B. Rolle ohne RFID, falsch erkannt).
   store.settings.manualSlots[drucker] = [{type, colour, override}] */
let slotState={printer:null,live:null,note:''};
let slotPicked=false; // Slot im offenen Dialog von Hand gewählt
const manualSlots=printerId=>((store.settings.manualSlots||{})[printerId])||null;
const ownSlot=s=>({type:s.type,colour:s.colour,present:!!s.type,name:s.type?'eigene Angabe':'leer',own:true});
function slotSource(tpl){
  const n=tpl.slots.length,m=(lastResult&&manualSlots(lastResult.printer.id))||[];
  if(slotState.live&&slotState.printer===(lastResult&&lastResult.printer.id)){
    const slots=Array.from({length:n},(_,i)=>m[i]&&m[i].override?{...ownSlot(m[i]),name:'überschrieben'}:slotState.live.slots[i]||{type:'',colour:'',name:'',present:true});
    return {kind:'live',slots,overridden:m.slice(0,n).filter(s=>s&&s.override).length};
  }
  if(m.length)return {kind:'manual',slots:Array.from({length:n},(_,i)=>m[i]?ownSlot(m[i]):{type:'',colour:'',name:'',present:true})};
  // Die Vorlage kennt nur den Stand beim Speichern in Orca – Typ und Farbe daraus wären irreführend.
  return {kind:'template',slots:tpl.slots.map(()=>({type:'',colour:'',name:'',present:true}))};
}
function dialogSlots(tpl){return slotSource(tpl).slots.map((s,i)=>({type:s.type,colour:s.colour,name:s.name,present:s.present,idx:i}))}
// Belegung, die in die 3MF geschrieben wird (Typ und Farbe je Slot); Vorlage = unverändert lassen
function exportSlots(tpl){const s=slotSource(tpl);return s.kind==='template'?null:s.slots}

function renderSlotList(tpl,preselect){
  const slots=dialogSlots(tpl);
  $('slotList').innerHTML=slots.map(s=>
    '<label class="slot'+(s.present?'':' absent')+'" title="'+esc(s.name)+'"><input type="radio" name="slot" value="'+s.idx+'"'+(s.idx===preselect?' checked':'')+'>'+
    '<span class="swatch" style="background:'+esc(/^#[0-9a-f]{6}$/i.test(s.colour)?s.colour:'#888888')+'"></span>'+
    '<span class="slot-text"><b>Slot '+(s.idx+1)+'</b>'+(s.type?' · '+esc(s.type):s.present?'':' · leer')+'<small>'+esc(!s.present?'kein Filament':s.name||'unbekannt')+'</small></span></label>').join('');
  const src=document.querySelector('.slot-source'),kind=slotSource(tpl).kind;
  src.classList.toggle('live',kind!=='template');src.classList.toggle('fallback',kind==='template'&&!!slotState.note);
  $('slotSource').textContent=kind==='live'
    ?'Live vom Drucker ('+(slotState.live.via==='lan'?'Werksfirmware, ':'')+slotState.live.host+') · Stand '+slotState.live.time.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+
      (slotSource(tpl).overridden?' · '+slotSource(tpl).overridden+' Slot(s) von dir überschrieben':'')
    :kind==='manual'?'Von Hand eingetragen – gilt, bis du es änderst'
    :(slotState.note?slotState.note+' – ':'')+'Belegung unbekannt – wähle den Slot, in dem dein Filament steckt';
}

// Vorauswahl: passender Filamenttyp (live oder eingetragen), sonst zuletzt genutzter Slot
function preferredSlot(tpl,r){
  const slots=dialogSlots(tpl);
  if(slotSource(tpl).kind!=='template'){const m=slots.find(s=>s.present&&slotMatchesKind(s.type,r.m.kind));if(m)return m.idx}
  return Math.min(+(store.last[slotKey(r.printer.id)]||0),slots.length-1);
}

function renderExportDialog(){
  const tpl=exportTemplate(lastResult.printer.id,lastResult.dSel);
  const plan=exportPlan(chosenSlot()),r=plan.r,slot=plan.slot;
  const live=exportSlots(tpl);
  const {extra,notes,partSlot}=slotPlan(plan.jobs,r,slot);
  const {settings,changes}=buildProjectSettings(tpl,r,slot,live,extra,purgeMachine(tpl));
  renderPartPlan(tpl,plan,partSlot,notes,settings);
  renderPurge(tpl,plan,slot);
  // Das Tool weiß ohne Belegung nicht, was im Drucker steckt: den Nutzer den passenden Slot wählen lassen
  const kinds=[...new Set(plan.jobs.filter(j=>j.slot===null).map(j=>ORCA_KIND[j.r.m.kind]||j.r.m.name))];
  $('slotHint').innerHTML=kinds.length>1?'<b>Wähle den Slot, in dem das Filament der Teile ohne eigenen Slot steckt</b> – siehe Tabelle unten.'
    :'<b>Wähle den Slot, in dem dein '+esc(kinds[0]||ORCA_KIND[r.m.kind]||r.m.name)+' steckt</b> – die Werte in der Datei gelten für '+esc(kinds[0]||ORCA_KIND[r.m.kind]||r.m.name)+'.';
  const kind=ORCA_KIND[r.m.kind]||'PLA',s=dialogSlots(tpl)[slot];
  const warn=$('slotWarn');
  const where={live:'laut Drucker',manual:'laut deiner Eingabe',template:'in deiner Vorlage'}[slotSource(tpl).kind];
  if(plan.jobs.length>1||plan.jobs.some(j=>(j.bodies||[]).some(b=>b.slot!=null)))warn.classList.add('hidden');
  else if(s&&!s.present){
    warn.innerHTML='<b>Hinweis:</b> In Slot '+(slot+1)+' hat der Drucker kein Filament erkannt.';warn.classList.remove('hidden');
  }else if(s&&s.type&&!slotMatchesKind(s.type,r.m.kind)){
    warn.innerHTML='<b>Hinweis:</b> In Slot '+(slot+1)+' steckt '+where+' <b>'+esc(s.type)+'</b>, gewählt ist <b>'+esc(r.m.name)+'</b> ('+kind+'). Die Werte werden trotzdem für '+kind+' geschrieben.';
    warn.classList.remove('hidden');
  }else warn.classList.add('hidden');
  const objCount=plan.jobs.reduce((n,j)=>n+objectOverrides(settings,j.r).length,0)*(plan.jobs.length>1?1:0);
  $('changesTitle').textContent='Was geändert wird ('+changes.length+' Werte'+(objCount?' + '+objCount+' je Teil':'')+')';
  $('changesList').innerHTML='<table class="changes"><thead><tr><th>Einstellung</th><th>Vorlage</th><th>Neu</th></tr></thead><tbody>'+
    changes.map(c=>'<tr><td>'+esc(c.label)+'<small>'+esc(c.key)+'</small></td><td>'+esc(c.before??'–')+'</td><td><b>'+esc(c.after)+'</b></td></tr>').join('')+'</tbody></table>';
}

/* Mehrere Teile: Tabelle Teil · Slot · Filament · abweichende Werte, mit Hinweis, wenn der Slot laut
   Belegung ein anderes Filament hat. „Passend wählen“ stellt das Filament der Teile auf die Belegung um. */
function renderPartPlan(tpl,plan,partSlot,notes,settings){
  const ownBodies=j=>(j.bodies||[]).filter(b=>b.slot!=null);
  const multi=plan.jobs.length>1||plan.jobs.some(j=>ownBodies(j).length);
  $('partPlan').classList.toggle('hidden',!multi);
  document.querySelector('#exportDlg fieldset.slots').classList.toggle('hidden',!plan.usesDefault); // alle Teile haben eigene Slots
  $('slotLegend').textContent=multi?'Standard-Slot (für Teile ohne eigenen Slot)':'Filament-Slot';
  if(!multi)return;
  const slots=dialogSlots(tpl);let mismatch=0;
  $('partPlanTable').innerHTML='<table class="changes"><thead><tr><th>Teil</th><th>Slot</th><th>Filament</th><th>Eigene Werte</th></tr></thead><tbody>'+
    plan.jobs.map(j=>{
      const si=partSlot(j),s=slots[si],bad=s&&s.type&&!slotMatchesKind(s.type,j.r.m.kind);
      if(bad)mismatch++;
      const own=objectOverrides(settings,j.r);
      return '<tr><td>'+esc(j.geom.name)+'</td><td>'+(si+1)+(j.slot===null?' <small>Standard</small>':'')+(s&&s.type?'<small>'+esc(s.type)+'</small>':'')+'</td>'+
        '<td'+(bad?' class="bad"':'')+'>'+esc(j.r.m.name)+(bad?'<small>passt nicht zu '+esc(s.type)+'</small>':'')+'</td>'+
        '<td title="'+esc(own.map(c=>c.label+': '+c.value).join('\n'))+'">'+(own.length?own.length+' Werte':'–')+'</td></tr>'+
        ownBodies(j).map(b=>{const t=slots[b.slot],bb=t&&t.type&&!slotMatchesKind(t.type,j.r.m.kind);if(bb)mismatch++;
          return '<tr class="body-row"><td>↳ '+esc(b.name)+'</td><td>'+(b.slot+1)+(t&&t.type?'<small>'+esc(t.type)+'</small>':'')+'</td><td'+(bb?' class="bad"':'')+'>'+esc(j.r.m.name)+'<small>'+(bb?'Slot hat '+esc(t.type)+' – Körper druckt mit den Werten des Teils':'Farbwechsel, gleiche Werte')+'</small></td><td>–</td></tr>'}).join('');
    }).join('')+'</tbody></table>';
  $('partPlanNotes').innerHTML=notes.map(n=>'<li>'+esc(n)+'</li>').join('');
  $('matchLive').classList.toggle('hidden',!mismatch);
  $('matchLive').textContent='Filament von '+mismatch+' Teil'+(mismatch>1?'en':'')+' passend zur Belegung wählen';
}
$('matchLive').addEventListener('click',()=>{
  const tpl=exportTemplate(lastResult.printer.id,lastResult.dSel),slots=dialogSlots(tpl),def=chosenSlot();
  let n=0;
  for(const p of project.parts){
    const s=slots[p.slot==null?def:p.slot];if(!s||!s.type)continue;
    const m=materialForSlotType(s.type,p.input.material);if(m!==p.input.material){p.input.material=m;n++}
  }
  loadPartIntoForm(project.parts[project.selected]);update();renderExportDialog();
  toast(n?n+' Teil'+(n>1?'e':'')+' auf das Filament im Slot umgestellt':'Nichts umzustellen');
});

/* Kobra S1: Die Firmware spült bei jedem Farbwechsel selbst in den Schacht (js/purge.js). Das Tool
   schätzt Wechsel und Abfall; die Spülmenge stellt man am Drucker ein, die Datei bekommt die passende
   Wechselzeit (machine_load_filament_time), damit Orca die Druckzeit richtig schätzt. */
const aceFlush=()=>+(store.settings.aceFlush??ACE_FLUSH_DEFAULT);
const acePurgeOwn=()=>store.settings.acePurgeOwn||null; // eigene Messung {grams, seconds} je Wechsel (Profile → Farbwechsel & Spülmenge)
const flushOptions=f=>ACE_FLUSH_CHOICES.map(x=>'<option value="'+x+'"'+(x===f?' selected':'')+'>'+de(x,1)+(x===ACE_FLUSH_DEFAULT?' (Werkseinstellung)':x===ACE_FLUSH_RECOMMENDED?' (empfohlen)':'')+'</option>').join('');
const duration=s=>s<3600?Math.max(1,Math.round(s/60))+' min':Math.floor(s/3600)+' h '+Math.round(s%3600/60)+' min';
function purgeItems(tpl,plan){
  const places=project.threemf?null:arrangeParts(plan.jobs.map(j=>j.geom),tpl).places;
  return plan.jobs.map((j,i)=>({geom:j.geom,slot:j.slot,bodies:j.bodies,plate:project.threemf?(j.part.plate||1):places[i].plate+1}));
}
function purgeMachine(tpl){
  const base=+tpl.settings.machine_load_filament_time,f=aceFlush(),own=acePurgeOwn();
  if(lastResult.printer.id!=='kobra_s1'||!(base>0))return [];
  const secs=own&&own.seconds>0?own.seconds:f===ACE_FLUSH_DEFAULT?null:aceChangeSeconds(f,base);
  if(secs===null)return [];
  return [{label:'Filamentwechsel-Zeit ('+(own&&own.seconds>0?'eigene Messung':'Spülmenge '+de(f,1))+')',key:'machine_load_filament_time',value:String(Math.round(secs*1000)/1000)}];
}
function renderPurge(tpl,plan,slot){
  const s1=lastResult.printer.id==='kobra_s1';
  const n=s1?estimateColourChanges(purgeItems(tpl,plan),slot,plan.r.layer,plan.r.firstLayer):0;
  $('purgeBox').classList.toggle('hidden',!n);
  if(!n)return;
  const f=aceFlush(),e=acePurgeEstimate(n,f,acePurgeOwn()),rec=acePurgeEstimate(n,ACE_FLUSH_RECOMMENDED);
  $('purgeInfo').innerHTML='≈ <b>'+n+' Farbwechsel</b> · Abfall im Schacht ≈ <b>'+de(e.grams,0)+' g</b> · die Wechsel dauern ≈ <b>'+duration(e.seconds)+'</b>'+(e.own?' (eigene Messung)':'')+
    (f>ACE_FLUSH_RECOMMENDED&&!e.own?'. Mit Spülmenge 1,0: ≈ '+de(rec.grams,0)+' g und '+duration(rec.seconds)+'.':'.');
  $('aceFlush').innerHTML=flushOptions(f);
  const hint=['Die Spülmenge stellst du <b>am Touchscreen</b> ein (ACE-Menü, während eines Drucks) – der Slicer kann sie nicht setzen. Wähle hier, was am Drucker eingestellt ist: Die Schätzung und die Druckzeit in Orca passen sich an.'];
  hint.push(f<0.8?'<b>Unter 0,8</b> mischen sich die Farben sichtbar (im Test wurde Weiß nach Rot rosa), und kleine Kleckse fallen teils aufs Bett statt in den Schacht.'
    :'1,0 sah im Test (PLA Rot/Weiß) genauso sauber aus wie 1,5 und spart rund 30 % Abfall. Bei Schwarz → Weiß oder Silk-Filament eher 1,2–1,5.');
  if(n>=20)hint.push('Weniger Wechsel: mehrere Teile gleichzeitig drucken (sie teilen sich die Wechsel je Schicht), Farbe nur in wenigen Schichten (z. B. Schrift oben auf der Fläche statt durch die ganze Höhe).');
  $('purgeHint').innerHTML=hint.join(' ');
}
$('aceFlush').addEventListener('change',()=>{
  const f=+$('aceFlush').value;
  // eigene Messung gehört zur alten Spülmenge – beim Wechsel nicht still weiterverwenden
  if(acePurgeOwn()&&f!==aceFlush()){store.settings.acePurgeOwn=null;toast('Eigene Messung verworfen (galt für Spülmenge '+de(aceFlush(),1)+')')}
  store.settings.aceFlush=f;persist();renderExportDialog();renderSidePanels();
});

/* Profile → Farbwechsel & Spülmenge: dieselbe Einstellung wie im Export-Dialog, dazu eigene Messwerte */
function renderPurgeModel(){
  const f=+$('pgFlush').value;
  $('pgModel').textContent='Referenzmessung bei '+de(f,1)+': ≈ '+de(acePurgeGrams(f),2)+' g und '+de(aceChangeSeconds(f),0)+' s je Wechsel. '+
    (f<0.8?'Unter 0,8 mischen sich die Farben sichtbar, Kleckse fallen teils aufs Bett.':f<=1.0?'1,0 sah im Test genauso sauber aus wie 1,5.':f<ACE_FLUSH_DEFAULT?'Für Schwarz → Weiß oder Silk-Filament.':f===ACE_FLUSH_DEFAULT?'Werkseinstellung – sicher, aber rund 30 % mehr Abfall als 1,0.':'Mehr als ab Werk – nur bei hartnäckigen Farbresten.');
  $('pgGrams').placeholder=de(acePurgeGrams(f),2);$('pgSeconds').placeholder=de(aceChangeSeconds(f),0);
}
function openPurgeSettings(){
  const own=acePurgeOwn()||{};
  $('pgFlush').innerHTML=flushOptions(aceFlush());
  $('pgGrams').value=own.grams>0?String(own.grams).replace('.',','):'';
  $('pgSeconds').value=own.seconds>0?String(own.seconds).replace('.',','):'';
  renderPurgeModel();
  $('purgeDlg').showModal();
}
$('pgFlush').addEventListener('change',renderPurgeModel);
$('pgSave').addEventListener('click',()=>{
  const g=$('pgGrams').value.trim(),s=$('pgSeconds').value.trim(),gn=g?num(g):0,sn=s?num(s):0;
  if(isNaN(gn)||gn<0||gn>20||isNaN(sn)||sn<0||sn>900){alert('Bitte gültige Werte eingeben (Abfall 0–20 g, Zeit 0–900 s je Wechsel) oder leer lassen.');return}
  store.settings.aceFlush=+$('pgFlush').value;
  store.settings.acePurgeOwn=gn>0||sn>0?{grams:gn,seconds:sn}:null;
  persist();$('purgeDlg').close();
  if($('exportDlg').open)renderExportDialog();
  renderSidePanels();
  toast('Farbwechsel-Einstellungen gespeichert');
});
$('pgReset').addEventListener('click',()=>{$('pgFlush').innerHTML=flushOptions(ACE_FLUSH_DEFAULT);$('pgGrams').value='';$('pgSeconds').value='';renderPurgeModel()});
$('purgeDlg').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
ACTIONS.purge=openPurgeSettings;

async function loadLiveSlots(){
  const r=lastResult,tpl=exportTemplate(r.printer.id,r.dSel),host=printerHost(r.printer.id);
  if(!host){slotState={printer:r.printer.id,live:null,note:''};renderSlotList(tpl,chosenSlot());renderExportDialog();return}
  $('slotSource').textContent='Frage '+host+' ab … (bis zu 16 s)';$('slotReload').disabled=true;
  try{
    const live=await fetchLiveSlots(r.printer.id,host);
    if(slotState.printer!==r.printer.id&&slotState.printer!==null)return; // Drucker inzwischen gewechselt
    slotState={printer:r.printer.id,live,note:''};
    // Hat der Nutzer schon selbst gewählt, bleibt seine Wahl – die Antwort kann Sekunden später kommen.
    renderSlotList(tpl,slotPicked?chosenSlot():preferredSlot(tpl,r));
  }catch(e){
    slotState={printer:r.printer.id,live:null,note:e.message};
    renderSlotList(tpl,chosenSlot());
  }finally{$('slotReload').disabled=false}
  renderExportDialog();
  renderSidePanels();
}

function openExportDialog(){
  const r=lastResult,tpl=exportTemplate(r.printer.id,r.dSel);
  if(!tpl||!project)return;
  if(slotState.printer!==r.printer.id)slotState={printer:r.printer.id,live:null,note:''};
  $('exportSub').textContent=project.name+(project.parts.length>1&&!/Teile$/.test(project.name)?' ('+project.parts.length+' Teile)':'')+' · '+r.m.name+' · Vorlage: '+tpl.printerPreset+' (OrcaSlicer '+tpl.orcaVersion+')';
  const [bw,bd]=bedSize(tpl);
  let tooBig=[];
  if(project.threemf){
    // Makerworld-3MF: Platten bleiben, geprüft wird je Platte
    const {oversize}=plateShifts(project.parts.map(p=>({geom:p.geom,plate:p.plate})),tpl);
    tooBig=oversize.map(id=>'Platte '+id);
    $('exportSub').textContent+=' · Einstellungen von „'+((project.threemf.settings||{}).printer_settings_id||'?')+'“ werden ersetzt, Platten und Farben bleiben';
  }else tooBig=arrangeParts(project.parts.map(p=>p.geom),tpl).oversize.map(i=>project.parts[i].name);
  $('sizeWarn').textContent=tooBig.length?'Größer als das Bett ('+de(bw,0)+' × '+de(bd,0)+' mm): '+tooBig.join(', ')+'. Bitte drehen oder in Orca skalieren/teilen.':'';
  $('sizeWarn').classList.toggle('hidden',!tooBig.length);
  renderSlotList(tpl,preferredSlot(tpl,r));
  slotPicked=false;
  $('slotList').onchange=()=>{slotPicked=true;renderExportDialog()};
  renderExportDialog();
  $('exportDlg').showModal();
  loadLiveSlots();
}

// Die 3MF genau wie beim Speichern – auch für das exakte Slicen der Kostenkalkulation
function exportBytes(defaultSlot){
  const tpl=exportTemplate(lastResult.printer.id,lastResult.dSel),plan=exportPlan(defaultSlot),live=exportSlots(tpl);
  const {bytes,notes}=project.threemf
    ?build3mfFromProject(tpl,plan.r,plan.jobs,plan.slot,fflate,live,project.threemf,purgeMachine(tpl))
    :build3mf(tpl,plan.r,plan.jobs,plan.slot,fflate,live,purgeMachine(tpl));
  return {bytes,plan,tpl,notes:(notes||[]).filter(n=>/Reinigungsturm/.test(n))};
}
function save3mf(){
  const plan=exportPlan(chosenSlot()),r=plan.r,slot=plan.slot;
  try{
    const {bytes,notes:towerNotes}=exportBytes(chosenSlot());
    const slotsUsed=new Set(plan.jobs.flatMap(j=>[j.slot===null?slot:j.slot,...(j.bodies||[]).filter(b=>b.slot!=null).map(b=>b.slot)]));
    const base=project.name.replace(/\.(stl|3mf|zip)$/i,'').replace(/[^\w.-]+/g,'_');
    const short=r.printer.id==='snapmaker_u1'?'U1':r.printer.id==='orca'?r.printer.label.replace(/[^w.-]+/g,''):'KobraS1';
    const blob=new Blob([bytes],{type:'model/3mf'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=base+'_'+short+(slotsUsed.size===1?'_Slot'+(slot+1):'_'+slotsUsed.size+'Slots')+'.3mf';
    document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
    if(plan.usesDefault){store.last[slotKey(r.printer.id)]=slot;persist()}
    $('exportDlg').close();
    toast('3MF gespeichert: '+a.download+(towerNotes.length?' · '+towerNotes.join(' '):''));
  }catch(e){
    toast('3MF konnte nicht erstellt werden: '+e.message);
  }
}

$('export3mf').addEventListener('click',openExportDialog);
$('export3mfSave').addEventListener('click',save3mf);
$('slotReload').addEventListener('click',loadLiveSlots);

/* Filament-Slots (Profile → Filament-Slots … oder „Belegung eintragen“ im Export-Dialog): je Slot Material
   und Farbe. Mit Verbindung zeigt jede Zeile, was die ACE meldet; „Überschreiben“ nimmt stattdessen deine
   Angabe. Werksfirmware: überschriebene Slots lassen sich auch in die ACE schreiben. */
const SLOT_TYPES=['PLA','PETG','ABS','ASA','TPU','PLA-CF','PETG-CF','PA','PC'];
const validHex=c=>/^#[0-9a-f]{6}$/i.test(c||'');
function slotDialogTemplate(){return lastResult&&exportTemplate(lastResult.printer.id,lastResult.dSel)}
function renderSlotDialog(){
  const tpl=slotDialogTemplate(),id=lastResult.printer.id,n=tpl.slots.length;
  const live=slotState.live&&slotState.printer===id?slotState.live:null,m=manualSlots(id)||[];
  const types=[...new Set(SLOT_TYPES.concat(Object.keys(tpl.filamentPresets||{})))];
  $('slotDlgSource').textContent=live?'Vom Drucker gelesen ('+(live.via==='lan'?'Werksfirmware':'Moonraker')+', '+live.time.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+')'
    :slotState.note&&slotState.printer===id?slotState.note:printerHost(id)?'Noch nicht vom Drucker gelesen':'Keine Drucker-Verbindung eingerichtet – deine Angaben gelten';
  $('slotEditRows').innerHTML=Array.from({length:n},(_,i)=>{
    const l=live&&live.slots[i],own=m[i],ovr=!!(live&&own&&own.override);
    const cur=live&&!ovr?(l||{}):(own||{}),t=String(cur.present===false?'':cur.type||'').toUpperCase(),col=validHex(cur.colour)?cur.colour:'#888888';
    const liveTxt=live?'<span class="slot-live" title="Meldet der Drucker">'+(l&&l.present?'<i style="background:'+esc(validHex(l.colour)?l.colour:'#888888')+'"></i>'+esc(l.type||'?'):'leer')+'</span>'+
      '<label class="slot-ovr"><input type="checkbox" data-slot-ovr="'+i+'"'+(ovr?' checked':'')+'> Überschreiben</label>':'<span></span><span></span>';
    return '<div class="slot-edit-row'+(live&&!ovr?' inherit':'')+'" data-slot-row="'+i+'"><b>Slot '+(i+1)+'</b>'+liveTxt+
      '<select data-slot-type="'+i+'" aria-label="Material in Slot '+(i+1)+'"><option value="">leer</option>'+types.map(x=>'<option'+(x===t?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select>'+
      '<input type="color" data-slot-colour="'+i+'" value="'+col+'" aria-label="Farbe Slot '+(i+1)+'"></div>';
  }).join('');
  $('slotEditPrinterRow').classList.toggle('hidden',!(live&&live.via==='lan'));
  $('slotEditPrinter').checked=false;
}
// Ändern von Material oder Farbe bei einer Live-Zeile heißt: überschreiben
$('slotEditRows').addEventListener('input',e=>{
  const row=e.target.closest('[data-slot-row]');if(!row)return;
  const cb=row.querySelector('[data-slot-ovr]');
  if(cb&&!e.target.matches('[data-slot-ovr]'))cb.checked=true;
  row.classList.toggle('inherit',!!cb&&!cb.checked);
});
async function refreshSlotsFromPrinter(){
  const id=lastResult.printer.id,host=printerHost(id);
  if(!host){toast('Erst unter ⚙ Einstellungen → Drucker-Verbindung die IP-Adresse eintragen');return}
  $('slotDlgSource').textContent='Frage '+host+' ab …';
  try{slotState={printer:id,live:await fetchLiveSlots(id,host),note:''}}
  catch(e){slotState={printer:id,live:null,note:e.message}}
  if($('slotDlg').open)renderSlotDialog();
  if($('exportDlg').open){const tpl=slotDialogTemplate();renderSlotList(tpl,chosenSlot());renderExportDialog()}
  renderSidePanels();
}
function openSlotDialog(){
  if(!lastResult||!slotDialogTemplate()){toast('Für diesen Drucker gibt es keine Slot-Vorlage');return}
  $('slotDlgTitle').textContent='Filament-Slots · '+lastResult.printer.label;
  renderSlotDialog();$('slotDlg').showModal();
  // einmal frisch vom Drucker lesen, wenn eine Verbindung eingerichtet ist
  if(printerHost(lastResult.printer.id)&&!(slotState.live&&slotState.printer===lastResult.printer.id))refreshSlotsFromPrinter();
}
$('slotEditBtn').addEventListener('click',openSlotDialog);
$('slotDlgReload').addEventListener('click',refreshSlotsFromPrinter);
$('slotEditSave').addEventListener('click',async()=>{
  const id=lastResult.printer.id,live=slotState.live&&slotState.printer===id?slotState.live:null;
  let rows=[...document.querySelectorAll('[data-slot-row]')].map(r=>{const i=+r.dataset.slotRow,cb=r.querySelector('[data-slot-ovr]');
    return {type:r.querySelector('[data-slot-type]').value,colour:r.querySelector('[data-slot-colour]').value.toUpperCase(),override:live?!!(cb&&cb.checked):false,i}});
  if(live&&live.via==='lan'&&$('slotEditPrinter').checked){
    // überschriebene, belegte Slots in die ACE schreiben – danach meldet der Drucker sie selbst
    const w=rows.filter(r=>r.override&&r.type&&live.slots[r.i]&&live.slots[r.i].box!==undefined).map(r=>({...r,box:live.slots[r.i].box,index:live.slots[r.i].index}));
    if(w.length){
      $('slotEditSave').disabled=true;$('slotDlgSource').textContent='Schreibe '+w.length+' Slot(s) in die ACE …';
      try{await writeLanSlots(live.host,w);rows=rows.map(r=>w.some(x=>x.i===r.i)?{...r,override:false}:r);toast(w.length+' Slot(s) in die ACE geschrieben')}
      catch(e){toast('Nicht in die ACE geschrieben: '+e.message+' – bleibt als eigene Angabe');}
      finally{$('slotEditSave').disabled=false}
    }
  }
  store.settings.manualSlots={...(store.settings.manualSlots||{}),[id]:rows.map(({i,...r})=>r)};persist();
  $('slotDlg').close();
  if(live&&live.via==='lan'&&$('slotEditPrinter').checked)await refreshSlotsFromPrinter();
  const tpl=slotDialogTemplate();
  if($('exportDlg').open){renderSlotList(tpl,preferredSlot(tpl,lastResult));renderExportDialog()}
  update();
  toast('Filament-Slots gespeichert');
});
$('slotEditReset').addEventListener('click',()=>{
  const id=lastResult.printer.id,m={...(store.settings.manualSlots||{})};
  delete m[id];store.settings.manualSlots=m;persist();
  $('slotDlg').close();
  const tpl=slotDialogTemplate();
  if($('exportDlg').open){renderSlotList(tpl,chosenSlot());renderExportDialog()}
  update();
  toast('Eigene Slot-Angaben gelöscht');
});
$('slotDlg').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
ACTIONS.slots=openSlotDialog;

/* Einstellungen-Tab (linke Spalte): Slots und Spülmenge direkt sichtbar, aufgerufen aus update() */
function renderSidePanels(){
  const r=lastResult,tpl=r&&exportTemplate(r.printer.id,r.dSel);
  $('slotPanel').classList.toggle('hidden',!tpl);
  if(tpl){
    const src=slotSource(tpl);
    $('slotPanelList').innerHTML=src.slots.map((s,i)=>{
      const how=s.own?(src.kind==='live'?'überschrieben':'eigene Angabe'):src.kind==='live'?(s.present?'vom Drucker':'leer'):'unbekannt';
      return '<li class="'+(s.own&&src.kind==='live'?'ovr':'')+'"><span class="pslot" style="background:'+esc(validHex(s.colour)?s.colour:'#dddddd')+'"></span><b>Slot '+(i+1)+'</b><span>'+(s.present&&s.type?esc(s.type):'<span class="muted">–</span>')+' <small>'+how+'</small></span></li>';
    }).join('');
    const live=slotState.live&&slotState.printer===r.printer.id?slotState.live:null;
    $('slotPanelSource').textContent=live?'Gelesen '+live.time.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' ('+(live.via==='lan'?'Werksfirmware':'Moonraker')+')'
      :slotState.note&&slotState.printer===r.printer.id?slotState.note:printerHost(r.printer.id)?'':'Keine Drucker-Verbindung – ⚙ Einstellungen → Drucker-Verbindung';
    $('slotPanelReload').classList.toggle('hidden',!printerHost(r.printer.id));
    // Ohne Verbindung direkt hier verbinden können (nur Drucker mit Live-Abfrage)
    $('slotPanelConnect').classList.toggle('hidden',!!printerHost(r.printer.id)||!LINK_PRINTERS.includes(r.printer.id));
  }
  const s1=!!r&&r.printer.id==='kobra_s1';
  $('purgePanel').classList.toggle('hidden',!s1);
  if(!s1)return;
  const f=aceFlush();
  $('purgePanelFlush').innerHTML=flushOptions(f);
  let info='';
  if(project&&tpl){
    const plan=exportPlan(+(store.last[slotKey(r.printer.id)]||0));
    const n=estimateColourChanges(purgeItems(tpl,plan),plan.slot,plan.r.layer,plan.r.firstLayer),e=acePurgeEstimate(n,f,acePurgeOwn());
    info=n?'Aktuelles Projekt: ≈ '+n+' Farbwechsel · ≈ '+de(e.grams,0)+' g Abfall · '+duration(e.seconds)+(e.own?' (eigene Messung)':'')+'.':'Aktuelles Projekt: keine Farbwechsel.';
  }else info='Je Wechsel ≈ '+de(acePurgeEstimate(1,f,acePurgeOwn()).grams,2)+' g und '+Math.round(acePurgeEstimate(1,f,acePurgeOwn()).seconds)+' s'+(acePurgeOwn()?' (eigene Messung)':'')+'.';
  $('purgePanelInfo').textContent=info+(f>ACE_FLUSH_RECOMMENDED?' Empfehlung: 1,0 (rund 30 % weniger Abfall).':'');
}
$('purgePanelFlush').addEventListener('change',()=>{
  const f=+$('purgePanelFlush').value;
  if(acePurgeOwn()&&f!==aceFlush()){store.settings.acePurgeOwn=null;toast('Eigene Messung verworfen (galt für Spülmenge '+de(aceFlush(),1)+')')}
  store.settings.aceFlush=f;persist();renderSidePanels();
});
$('slotPanelReload').addEventListener('click',async()=>{await refreshSlotsFromPrinter();update()});
function saveLink(id,host,mode){
  store.settings.printerHosts={...(store.settings.printerHosts||{}),[id]:host};
  if(mode)store.settings.printerLinkMode={...(store.settings.printerLinkMode||{}),[id]:mode};
  persist();
}
$('slotPanelConnectBtn').addEventListener('click',async()=>{
  const id=lastResult.printer.id,host=$('slotPanelHost').value.trim();
  if(!IP_PATTERN.test(host)){toast('Bitte eine IP-Adresse wie 192.168.1.50 eintragen');return}
  $('slotPanelConnectBtn').disabled=true;$('slotPanelSource').textContent='Verbinde mit '+host+' …';
  try{
    const live=await fetchLiveSlots(id,host);
    saveLink(id,host,live.via==='lan'?'lan':'moonraker');
    slotState={printer:id,live,note:''};
    toast('Verbunden ('+(live.via==='lan'?'Werksfirmware':'Moonraker')+') – Verbindung gespeichert');
  }catch(e){$('slotPanelSource').textContent='Nicht verbunden: '+e.message}
  finally{$('slotPanelConnectBtn').disabled=false}
  update();
});
$('slotPanelHost').addEventListener('keydown',e=>{if(e.key==='Enter')$('slotPanelConnectBtn').click()});
// Beim Start einmal die ACE lesen, wenn eine Verbindung eingerichtet ist (nur lesend)

$('exportDlg').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});

/* ================= Drucker-Verbindung ================= */
const IP_PATTERN=/^[A-Za-z0-9.-]+(:\d+)?$/;
const LINK_PRINTERS=['kobra_s1','snapmaker_u1'].filter(id=>PRINTERS[id]); // ausgeblendete Drucker: js/config.js
function openLinkDialog(){
  LINK_PRINTERS.forEach(id=>{$('host_'+id).value=printerHost(id);const res=$('linkRes_'+id);res.textContent='';res.className='muted small link-result'});
  if($('mode_kobra_s1'))$('mode_kobra_s1').value=linkMode('kobra_s1');
  $('aceBox').classList.add('hidden');
  $('linkDlg').showModal();
}
// Werksfirmware: ACE-Einstellungen und Rohdaten nach erfolgreichem Test zeigen
let aceLink=null;
function showAceBox(live){
  const st=live.status,box=(st.ace||[])[0];
  aceLink=box?{host:live.host,boxes:st.ace.map(b=>b.id)}:null;
  $('aceBox').classList.toggle('hidden',!box);
  if(!box)return;
  $('aceAutoFeed').checked=box.auto_feed===1;
  $('aceRaw').textContent=JSON.stringify({firmware:st.firmware,model:st.model,state:st.state,raw:st.raw},null,1);
}
$('aceAutoFeed').addEventListener('change',async()=>{
  if(!aceLink)return;
  const on=$('aceAutoFeed').checked?1:0,cb=$('aceAutoFeed');cb.disabled=true;
  try{
    const r=await lanCommand(aceLink.host,'multiColorBox','setAutoFeed',{multi_color_box:aceLink.boxes.map(id=>({id,auto_feed:on}))});
    if(!r.ok)throw Error(r.msg||'abgelehnt');
    toast('Nachfüllen '+(on?'ein':'aus')+'geschaltet');
  }catch(e){cb.checked=!on;toast('Nicht geändert: '+e.message)}
  finally{cb.disabled=false}
});
async function testLink(id){
  const host=$('host_'+id).value.trim(),res=$('linkRes_'+id);
  res.className='muted small link-result';res.textContent='Frage '+host+' ab …';
  try{
    if(!IP_PATTERN.test(host))throw Error('Bitte eine IP-Adresse wie 192.168.1.50 eintragen');
    // Test mit der gewählten Verbindungsart, auch wenn noch nicht gespeichert
    const modes={...(store.settings.printerLinkMode||{})},prev=modes[id];
    if($('mode_'+id))store.settings.printerLinkMode={...modes,[id]:$('mode_'+id).value};
    let live;
    try{live=await fetchLiveSlots(id,host)}finally{store.settings.printerLinkMode={...modes,[id]:prev}}
    res.classList.add('good');
    res.textContent='Verbunden'+(live.via==='lan'?' (Werksfirmware'+(live.status.firmware?' '+live.status.firmware:'')+')':' (Moonraker)')+': '+live.slots.map((s,i)=>'Slot '+(i+1)+' '+(s.present?s.type||'?':'leer')).join(' · ');
    if(live.via==='lan')showAceBox(live);
    // erfolgreicher Test = Verbindung übernehmen (vorher ging sie ohne „Speichern“ verloren)
    saveLink(id,host,$('mode_'+id)?$('mode_'+id).value:null);
    slotState={printer:id,live,note:''};
    res.textContent+=' · gespeichert';
    update();
  }catch(e){res.classList.add('bad');res.textContent=e.message}
}
document.querySelectorAll('#linkDlg [data-test]').forEach(b=>b.addEventListener('click',()=>testLink(b.dataset.test)));
$('linkSave').addEventListener('click',()=>{
  const hosts={};
  for(const id of LINK_PRINTERS){
    const v=$('host_'+id).value.trim();
    if(v&&!IP_PATTERN.test(v)){const res=$('linkRes_'+id);res.className='small link-result bad';res.textContent='Ungültige Adresse';return}
    hosts[id]=v;
  }
  store.settings.printerHosts=hosts;
  const modes={...(store.settings.printerLinkMode||{})};
  LINK_PRINTERS.forEach(id=>{if($('mode_'+id))modes[id]=$('mode_'+id).value});
  store.settings.printerLinkMode=modes;
  persist();slotState={printer:null,live:null,note:''};
  $('linkDlg').close();toast('Drucker-Verbindung gespeichert');
});
$('linkDlg').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
ACTIONS.link=openLinkDialog;

if(lastResult)updateExportMenu(lastResult);
// Beim Start: Seitenleiste zeigen und einmal die ACE lesen, wenn eine Verbindung eingerichtet ist (nur lesend)
if(lastResult)renderSidePanels();
if(lastResult&&printerHost(lastResult.printer.id))refreshSlotsFromPrinter().then(update);
