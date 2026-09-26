'use strict';
/* Bedienung des 3MF-Exports: Menüpunkt freischalten, Belegung live vom Drucker laden,
   Slot wählen, Änderungen zeigen, speichern. Dazu der Dialog „Drucker-Verbindung“. */

// Menüpunkt nach jeder Neuberechnung aktualisieren (aufgerufen aus update()).
function updateExportMenu(r){
  const btn=$('export3mf'),note=$('export3mfNote');
  const tpl=exportTemplate(r.printer.id,r.dSel);
  let reason='';
  if(!tpl)reason='nur mit 0,4-mm-Düse (keine Vorlage für '+de(+r.dSel,r.dSel==='0.25'?2:1)+' mm)';
  else if(!project)reason='zuerst ein Modell laden';
  btn.disabled=!!reason;
  note.textContent=reason||'Slot wählen und speichern';
}

const printerHost=id=>((store.settings.printerHosts||{})[id]||'').trim();
function slotKey(printerId){return 'exportSlot_'+printerId}
function chosenSlot(){const c=document.querySelector('input[name="slot"]:checked');return c?+c.value:0}

// Aktuelle Belegung für den Dialog: live vom Drucker oder aus der Vorlage
let slotState={printer:null,live:null,note:''};
let slotPicked=false; // Slot im offenen Dialog von Hand gewählt
function dialogSlots(tpl){
  if(slotState.live)return slotState.live.slots.slice(0,tpl.slots.length).map((s,i)=>({type:s.type,colour:s.colour,name:s.name,present:s.present,idx:i}));
  return tpl.slots.map((s,i)=>({type:s.type,colour:s.colour,name:s.name,present:true,idx:i}));
}

function renderSlotList(tpl,preselect){
  const slots=dialogSlots(tpl);
  $('slotList').innerHTML=slots.map(s=>
    '<label class="slot'+(s.present?'':' absent')+'" title="'+esc(s.name)+'"><input type="radio" name="slot" value="'+s.idx+'"'+(s.idx===preselect?' checked':'')+'>'+
    '<span class="swatch" style="background:'+esc(/^#[0-9a-f]{6}$/i.test(s.colour)?s.colour:'#888888')+'"></span>'+
    '<span class="slot-text"><b>Slot '+(s.idx+1)+'</b> · '+esc(s.type||'leer')+'<small>'+esc(s.present?s.name:'kein Filament erkannt')+'</small></span></label>').join('');
  const src=document.querySelector('.slot-source');
  src.classList.toggle('live',!!slotState.live);src.classList.toggle('fallback',!slotState.live&&!!slotState.note);
  $('slotSource').textContent=slotState.live
    ?'Live vom Drucker ('+slotState.live.host+') · Stand '+slotState.live.time.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})
    :(slotState.note?slotState.note+' – Belegung aus der Vorlage':'Belegung aus der Vorlage (Stand beim Speichern in Orca)');
}

// Vorauswahl: passender Filamenttyp (live), sonst zuletzt genutzter Slot
function preferredSlot(tpl,r){
  const slots=dialogSlots(tpl);
  if(slotState.live){const m=slots.find(s=>s.present&&slotMatchesKind(s.type,r.m.kind));if(m)return m.idx}
  return Math.min(+(store.last[slotKey(r.printer.id)]||0),slots.length-1);
}

function renderExportDialog(){
  const tpl=exportTemplate(lastResult.printer.id,lastResult.dSel);
  const plan=exportPlan(chosenSlot()),r=plan.r,slot=plan.slot;
  const live=slotState.live?slotState.live.slots:null;
  const {extra,notes,partSlot}=slotPlan(plan.jobs,r,slot);
  const {settings,changes}=buildProjectSettings(tpl,r,slot,live,extra);
  renderPartPlan(tpl,plan,partSlot,notes,settings);
  const kind=ORCA_KIND[r.m.kind]||'PLA',s=dialogSlots(tpl)[slot];
  const warn=$('slotWarn');
  const where=slotState.live?'laut Drucker':'in deiner Vorlage';
  if(plan.jobs.length>1)warn.classList.add('hidden');
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
  const multi=plan.jobs.length>1;
  $('partPlan').classList.toggle('hidden',!multi);
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
        '<td title="'+esc(own.map(c=>c.label+': '+c.value).join('\n'))+'">'+(own.length?own.length+' Werte':'–')+'</td></tr>';
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

async function loadLiveSlots(){
  const r=lastResult,tpl=exportTemplate(r.printer.id,r.dSel),host=printerHost(r.printer.id);
  if(!host){slotState={printer:r.printer.id,live:null,note:'Keine Drucker-IP eingetragen (Profile → Drucker-Verbindung)'};renderSlotList(tpl,chosenSlot());renderExportDialog();return}
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
}

function openExportDialog(){
  const r=lastResult,tpl=exportTemplate(r.printer.id,r.dSel);
  if(!tpl||!project)return;
  if(slotState.printer!==r.printer.id)slotState={printer:r.printer.id,live:null,note:''};
  $('exportSub').textContent=project.name+(project.parts.length>1?' ('+project.parts.length+' Teile)':'')+' · '+r.m.name+' · Vorlage: '+tpl.printerPreset+' (OrcaSlicer '+tpl.orcaVersion+')';
  const {oversize}=arrangeParts(project.parts.map(p=>p.geom),tpl),[bw,bd]=bedSize(tpl);
  $('sizeWarn').textContent=oversize.length?'Größer als das Bett ('+de(bw,0)+' × '+de(bd,0)+' mm): '+oversize.map(i=>project.parts[i].name).join(', ')+'. Bitte drehen oder in Orca skalieren/teilen.':'';
  $('sizeWarn').classList.toggle('hidden',!oversize.length);
  renderSlotList(tpl,preferredSlot(tpl,r));
  slotPicked=false;
  $('slotList').onchange=()=>{slotPicked=true;renderExportDialog()};
  renderExportDialog();
  $('exportDlg').showModal();
  loadLiveSlots();
}

function save3mf(){
  const tpl=exportTemplate(lastResult.printer.id,lastResult.dSel);
  const plan=exportPlan(chosenSlot()),r=plan.r,slot=plan.slot;
  try{
    const {bytes}=build3mf(tpl,r,plan.jobs,slot,fflate,slotState.live?slotState.live.slots:null);
    const slotsUsed=new Set(plan.jobs.map(j=>j.slot===null?slot:j.slot));
    const base=project.name.replace(/\.(stl|3mf|zip)$/i,'').replace(/[^\w.-]+/g,'_');
    const short=r.printer.id==='snapmaker_u1'?'U1':'KobraS1';
    const blob=new Blob([bytes],{type:'model/3mf'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=base+'_'+short+(slotsUsed.size===1?'_Slot'+(slot+1):'_'+slotsUsed.size+'Slots')+'.3mf';
    document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
    if(plan.usesDefault){store.last[slotKey(r.printer.id)]=slot;persist()}
    $('exportDlg').close();
    toast('3MF gespeichert: '+a.download);
  }catch(e){
    toast('3MF konnte nicht erstellt werden: '+e.message);
  }
}

$('export3mf').addEventListener('click',openExportDialog);
$('export3mfSave').addEventListener('click',save3mf);
$('slotReload').addEventListener('click',loadLiveSlots);
$('exportDlg').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});

/* ================= Drucker-Verbindung ================= */
const IP_PATTERN=/^[A-Za-z0-9.-]+(:\d+)?$/;
const LINK_PRINTERS=['kobra_s1','snapmaker_u1'];
function openLinkDialog(){
  LINK_PRINTERS.forEach(id=>{$('host_'+id).value=printerHost(id);const res=$('linkRes_'+id);res.textContent='';res.className='muted small link-result'});
  $('linkDlg').showModal();
}
async function testLink(id){
  const host=$('host_'+id).value.trim(),res=$('linkRes_'+id);
  res.className='muted small link-result';res.textContent='Frage '+host+' ab …';
  try{
    if(!IP_PATTERN.test(host))throw Error('Bitte eine IP-Adresse wie 192.168.1.50 eintragen');
    const live=await fetchLiveSlots(id,host);
    res.classList.add('good');
    res.textContent='Verbunden: '+live.slots.map((s,i)=>'Slot '+(i+1)+' '+(s.present?s.type||'?':'leer')).join(' · ');
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
  store.settings.printerHosts=hosts;persist();slotState={printer:null,live:null,note:''};
  $('linkDlg').close();toast('Drucker-Verbindung gespeichert');
});
$('linkDlg').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
ACTIONS.link=openLinkDialog;

if(lastResult)updateExportMenu(lastResult);
