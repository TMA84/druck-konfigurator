'use strict';
/* Bedienung des 3MF-Exports: Menüpunkt freischalten, Slot wählen, Änderungen zeigen, speichern. */

// Menüpunkt nach jeder Neuberechnung aktualisieren (aufgerufen aus update()).
function updateExportMenu(r){
  const btn=$('export3mf'),note=$('export3mfNote');
  const tpl=exportTemplate(r.printer.id,r.dSel);
  let reason='';
  if(!tpl)reason='nur mit 0,4-mm-Düse (keine Vorlage für '+de(+r.dSel,r.dSel==='0.25'?2:1)+' mm)';
  else if(!geom)reason='zuerst eine STL laden';
  btn.disabled=!!reason;
  note.textContent=reason||'Slot wählen und speichern';
}

function slotKey(printerId){return 'exportSlot_'+printerId}
function chosenSlot(){const c=document.querySelector('input[name="slot"]:checked');return c?+c.value:0}

function renderExportDialog(){
  const r=lastResult,tpl=exportTemplate(r.printer.id,r.dSel),slot=chosenSlot();
  const {changes}=buildProjectSettings(tpl,r,slot);
  const kind=ORCA_KIND[r.m.kind]||'PLA',slotType=tpl.slots[slot].type;
  const warn=$('slotWarn');
  if(slotType&&slotType!==kind){
    warn.innerHTML='<b>Hinweis:</b> Slot '+(slot+1)+' ist in deiner Vorlage als <b>'+esc(slotType)+'</b> eingerichtet, gewählt ist <b>'+esc(r.m.name)+'</b> ('+kind+'). Die Werte werden trotzdem geschrieben – in OrcaSlicer bleibt der Presetname „'+esc(tpl.slots[slot].name)+'“ stehen. Prüfe, ob im Drucker wirklich '+kind+' in diesem Slot steckt.';
    warn.classList.remove('hidden');
  }else warn.classList.add('hidden');
  $('changesTitle').textContent='Was geändert wird ('+changes.length+' Werte)';
  $('changesList').innerHTML='<table class="changes"><thead><tr><th>Einstellung</th><th>Vorlage</th><th>Neu</th></tr></thead><tbody>'+
    changes.map(c=>'<tr><td>'+esc(c.label)+'<small>'+esc(c.key)+'</small></td><td>'+esc(c.before??'–')+'</td><td><b>'+esc(c.after)+'</b></td></tr>').join('')+'</tbody></table>';
}

function openExportDialog(){
  const r=lastResult,tpl=exportTemplate(r.printer.id,r.dSel);
  if(!tpl||!geom)return;
  const saved=+(store.last[slotKey(r.printer.id)]||0);
  $('exportSub').textContent=geom.name+' · '+r.m.name+' · Vorlage: '+tpl.printerPreset+' (OrcaSlicer '+tpl.orcaVersion+')';
  $('slotList').innerHTML=tpl.slots.map((s,i)=>
    '<label class="slot"><input type="radio" name="slot" value="'+i+'"'+(i===Math.min(saved,tpl.slots.length-1)?' checked':'')+'>'+
    '<span class="swatch" style="background:'+esc(/^#[0-9a-f]{6}$/i.test(s.colour)?s.colour:'#888888')+'"></span>'+
    '<span class="slot-text"><b>Slot '+(i+1)+'</b> · '+esc(s.type||'?')+'<small>'+esc(s.name)+'</small></span></label>').join('');
  $('slotList').onchange=renderExportDialog;
  renderExportDialog();
  $('exportDlg').showModal();
}

function save3mf(){
  const r=lastResult,tpl=exportTemplate(r.printer.id,r.dSel),slot=chosenSlot();
  try{
    const {bytes}=build3mf(tpl,r,geom,slot,fflate);
    const base=geom.name.replace(/\.stl$/i,'').replace(/[^\w.-]+/g,'_');
    const short=r.printer.id==='snapmaker_u1'?'U1':'KobraS1';
    const blob=new Blob([bytes],{type:'model/3mf'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=base+'_'+short+'_Slot'+(slot+1)+'.3mf';
    document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
    store.last[slotKey(r.printer.id)]=slot;persist();
    $('exportDlg').close();
    toast('3MF gespeichert: '+a.download);
  }catch(e){
    toast('3MF konnte nicht erstellt werden: '+e.message);
  }
}

$('export3mf').addEventListener('click',openExportDialog);
$('export3mfSave').addEventListener('click',save3mf);
$('exportDlg').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
if(lastResult)updateExportMenu(lastResult);
