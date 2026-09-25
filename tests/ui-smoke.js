'use strict';
/* Bedientest wie ein Nutzer: klickt sich durch alle Funktionen der laufenden Seite.
   In die Seite laden (Konsole oder Testwerkzeug):
     await new Promise(r=>{const s=document.createElement('script');s.src='tests/ui-smoke.js?'+Date.now();s.onload=r;document.head.appendChild(s)});
     await runSmoke()
   Downloads werden abgefangen und inhaltlich geprüft; confirm/alert/print sind Attrappen. */
async function runSmoke(){
  const log=[],fail=[];
  const ok=(cond,msg)=>{(cond?log:fail).push((cond?'ok   ':'FEHL ')+msg)};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const sel=(id,v)=>{$(id).value=v;$(id).dispatchEvent(new Event('change',{bubbles:true}))};
  const errors=[];window.addEventListener('error',e=>errors.push(e.message));

  // Attrappen
  const downloads=[];const origClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(this.download){downloads.push({name:this.download,href:this.href});return}return origClick.call(this)};
  const origRevoke=URL.revokeObjectURL;URL.revokeObjectURL=()=>{}; // Downloads bleiben lesbar
  const alerts=[];window.alert=m=>alerts.push(m);window.confirm=()=>true;
  let printed=0;window.print=()=>{window.dispatchEvent(new Event('beforeprint'));printed++;window.dispatchEvent(new Event('afterprint'))};
  const blobText=async d=>(await fetch(d.href)).text();
  const blobBytes=async d=>new Uint8Array(await (await fetch(d.href)).arrayBuffer());
  const menuClick=id=>{const b=$(id);b.closest('.menu').querySelector('.menu-btn').click();b.click()};

  // Testmodell als echte Datei über Drag&Drop
  function stlFile(name,boxes){
    const tris=[];for(const [x0,y0,z0,x1,y1,z1] of boxes){const v=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].forEach(t=>tris.push(t.map(i=>v[i])))}
    const buf=new ArrayBuffer(84+tris.length*50),dv=new DataView(buf);dv.setUint32(80,tris.length,true);
    tris.forEach((t,i)=>t.flat().forEach((c,j)=>dv.setFloat32(84+i*50+12+j*4,c,true)));
    return new File([buf],name);
  }
  async function dropFile(file){const dt=new DataTransfer();dt.items.add(file);document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));await wait(150)}

  /* 1) Startzustand */
  ok(document.body.dataset.printer==='kobra_s1','Start: Kobra S1 aktiv');
  ok($('title').textContent.includes('Anycubic PLA High Speed'),'Start: PLA High Speed gewählt');
  ok($('matBadge').textContent==='Getestet','Start: Badge „Getestet“');
  ok($('export3mf').disabled&&$('export3mfNote').textContent.includes('STL'),'3MF-Menüpunkt ohne Modell gesperrt mit Grund');

  /* 2) Druckerwechsel */
  document.querySelector('.printer-switch [data-printer="snapmaker_u1"]').click();await wait(50);
  ok(document.body.dataset.printer==='snapmaker_u1','Umschalten auf U1 färbt um');
  ok([...$('nozM').options].map(o=>o.value).join()==='steel_stainless,steel_hardened','U1: Düsenmaterialien Edelstahl/gehärtet');
  ok($('matBadge').textContent==='Allgemeiner Startwert','U1: getestetes Profil gilt als allgemein');
  ok($('warning').innerHTML.includes('Snapmaker U1'),'U1: Warnhinweis „nicht gegengetestet“');
  ok($('orderedTitle').textContent.includes('Snapmaker Orca'),'U1: Slicer-Reihenfolge Snapmaker Orca');
  const sw=document.querySelector('.printer-switch');sw.querySelector('[aria-checked="true"]').focus();
  sw.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await wait(30);
  ok(document.body.dataset.printer==='kobra_s1','Pfeiltaste wechselt Drucker zurück');

  /* 3) Alle Auswahloptionen durchspielen */
  let combos=0;
  for(const m of [...$('material').options].map(o=>o.value))for(const o of [...$('object').options].map(o=>o.value)){sel('material',m);sel('object',o);combos++}
  for(const id of ['goal','load','support','supportLevel'])for(const v of [...$(id).options].map(o=>o.value)){sel(id,v);combos++}
  ok(errors.length===0,combos+' Auswahlkombinationen ohne Fehler');
  sel('material','pla_hs');sel('object','general');sel('goal','balanced');sel('load','medium');sel('support','auto');sel('supportLevel','balanced');
  sel('supportLevel','minimal');ok($('thresh').value==='55','Stützreduzierung „Minimal“ setzt Überhangwinkel 55°');sel('supportLevel','balanced');
  sel('material','pla_cf');ok($('danger').textContent==='' ,'PLA-CF mit gehärteter Düse: keine Gefahrenwarnung');
  sel('nozM','brass');ok($('danger').textContent.includes('schleift'),'PLA-CF mit Messing: Gefahrenwarnung');
  sel('nozM','steel_hardened');sel('material','pla_hs');

  /* 4) Düsengrößen */
  for(const d of ['0.25','0.6','0.8']){sel('nozD',d);ok($('warning').innerHTML.includes('Umgerechnet'),'Düse '+d+': Umrechnungshinweis')}
  sel('nozD','0.4');

  /* 5) Modell laden */
  await dropFile(new File(['x'],'test.obj'));ok($('fileinfo').textContent.includes('STL-Datei'),'Falsches Format wird abgelehnt');
  await dropFile(new File(['x'],'teil.3mf'));ok($('fileinfo').textContent.includes('3MF-Dateien'),'3MF-Datei: Hinweis zum STL-Export');
  await dropFile(stlFile('pilz.stl',[[15,15,0,25,25,20],[0,0,20,40,40,25]]));
  ok($('fileinfo').textContent.includes('pilz.stl')&&$('modelCard').classList.contains('loaded'),'STL per Drag&Drop geladen');
  ok(!$('modelBadge').classList.contains('hidden'),'Tab-Badge „Modell“ sichtbar');
  ok($('supportGuide').textContent.includes('Baumstützen'),'Überhang erkannt → Baumstützen');
  ok(!$('export3mf').disabled,'3MF-Menüpunkt mit Modell und 0,4-mm-Düse frei');
  sel('nozD','0.6');ok($('export3mf').disabled&&$('export3mfNote').textContent.includes('0,4'),'3MF bei 0,6-mm-Düse gesperrt mit Grund');sel('nozD','0.4');

  /* 6) 3D-Ansicht */
  $('tab3d').click();await wait(80);
  ok(!$('view3d').hidden&&$('viewSettings').hidden,'Tab 3D-Ansicht zeigt Viewer');
  ok($('info').textContent.includes('40,0 × 40,0 × 25,0'),'Viewer-Info mit Maßen');
  ['btnWireframe','btnAxes','btnClip','btnMeasure'].forEach(id=>$(id).click());
  ok(!$('clipPanel').classList.contains('hidden'),'Schnitt-Panel sichtbar');
  $('clipAxisZ').click();$('clipSlider').value=40;$('clipSlider').dispatchEvent(new Event('input'));
  ok($('measureLabel').textContent.includes('Punkt'),'Messen aktiv mit Anleitung');
  $('thresh').value=60;$('thresh').dispatchEvent(new Event('input'));ok($('threshVal').textContent==='60°','Überhangwinkel-Regler');
  $('thresh').value=45;$('thresh').dispatchEvent(new Event('input'));
  ['btnWireframe','btnAxes','btnClip','btnMeasure'].forEach(id=>$(id).click());
  $('tabSettings').click();

  /* 7) Hilfe und Erklärungen */
  const help=document.querySelector('.spec .help');help.click();
  ok(!$('tip').hidden&&$('tip').textContent.length>20,'Erklärung per Klick');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));ok($('tip').hidden,'Escape schließt Erklärung');
  document.querySelector('[data-action="help"]').click();ok($('helpDlg').open,'Hilfe-Dialog');$('helpDlg').close();

  /* 8) Profile: Werte anpassen */
  menuClick('editMat');ok($('editor').open,'Editor „Werte anpassen“ öffnet');
  $('ed_nozzle_1').value='219';$('edSave').click();
  ok($('matBadge').textContent==='Eigene Werte'&&$('material').selectedOptions[0].textContent.startsWith('★'),'Eigene Werte gespeichert (★, Badge)');
  ok(document.querySelector('.spec-cell .v').textContent==='219 °C','Kennwert zeigt 219 °C');
  menuClick('editMat');$('ed_maxVol').value='abc';$('edSave').click();
  ok(alerts.some(a=>a.includes('Volumengeschwindigkeit'))&&$('editor').open,'Ungültige Eingabe wird abgelehnt');
  $('edCancel').click();
  document.querySelector('[data-action="profiles"]').click();
  ok($('profilesDlg').open&&$('myList').textContent.includes('Anycubic PLA High Speed'),'Meine Profile listet Überschreibung');$('profilesDlg').close();

  /* 9) Neues Filament */
  menuClick('newMat');$('ed_kind').value='petg';$('ed_kind').dispatchEvent(new Event('change'));
  ok($('ed_bed').value==='75','Neues Filament übernimmt PETG-Vorlage');
  $('ed_name').value='Test-PETG Blau';$('edSave').click();
  ok($('title').textContent.includes('Test-PETG Blau'),'Neues Filament angelegt und gewählt');
  const newId=$('material').value;

  /* 10) Profile exportieren / importieren */
  menuClick('exportBtn');await wait(50);
  const prof=downloads.find(d=>d.name.includes('meine-profile'));
  const profJson=prof&&JSON.parse(await blobText(prof));
  ok(profJson&&profJson.profiles[newId]&&profJson.profiles.pla_hs.nozzle[1]===219,'Profil-Export enthält beide eigenen Profile');
  ok($('toast').textContent.includes('Profile'),'Toast nach Export');
  $('editMat').click();$('edDelete').click();
  ok(!$('material').querySelector('option[value="'+newId+'"]'),'Eigenes Filament gelöscht');
  const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(profJson)],'p.json',{type:'application/json'}));
  $('importFile').files=dt.files;$('importFile').dispatchEvent(new Event('change'));await wait(200);
  ok(!!$('material').querySelector('option[value="'+newId+'"]'),'Import stellt gelöschtes Filament wieder her');
  sel('material','pla_hs');$('editMat').click();$('edReset').click();
  ok($('matBadge').textContent==='Getestet','Zurücksetzen auf Standard');

  /* 11) Düsen-Umrechnung */
  menuClick('settingsBtn');$('st_off').value='99';$('edSave').click();
  ok(alerts.some(a=>a.includes('gültige Werte')),'Düsen-Umrechnung: ungültiger Wert abgelehnt');
  $('st_off').value='6';$('edSave').click();sel('nozM','brass');
  ok($('warning').innerHTML.includes('6 °C'),'Düsen-Umrechnung wirkt (−6 °C bei Messing)');
  menuClick('settingsBtn');$('stReset').click();$('edSave').click();sel('nozM','steel_hardened');

  /* 12) Export-Menü: JSON, Text, Drucken */
  menuClick('orcaFilBtn');menuClick('orcaProcBtn');await wait(50);
  const fil=downloads.find(d=>d.name.endsWith('filament.json')),proc=downloads.find(d=>d.name.endsWith('process.json'));
  const filJ=fil&&JSON.parse(await blobText(fil)),procJ=proc&&JSON.parse(await blobText(proc));
  ok(filJ&&filJ.nozzle_temperature[0]==='215','Filament-JSON: 215 °C');
  ok(procJ&&procJ.inherits.includes('Kobra S1'),'Process-JSON erbt vom Kobra-S1-Preset');
  menuClick('copyBtn');await wait(300);ok(/Kopier/.test($('toast').textContent),'Als Text kopieren meldet Ergebnis ('+$('toast').textContent+')');
  document.querySelectorAll('details.fold').forEach(d=>{d.open=false});
  let openDuringPrint=0;window.addEventListener('beforeprint',()=>{setTimeout(()=>{},0)},{once:true});
  const origPrint=window.print;window.print=()=>{window.dispatchEvent(new Event('beforeprint'));openDuringPrint=[...document.querySelectorAll('details.fold')].filter(d=>d.open).length;window.dispatchEvent(new Event('afterprint'))};
  menuClick('printBtn');
  ok(openDuringPrint===document.querySelectorAll('details.fold').length,'Drucken öffnet alle Bereiche');
  ok([...document.querySelectorAll('details.fold')].every(d=>!d.open),'… und stellt sie danach wieder her');
  window.print=origPrint;

  /* 13) 3MF-Export */
  menuClick('export3mf');ok($('exportDlg').open,'3MF-Dialog öffnet');
  ok(document.querySelectorAll('input[name="slot"]').length===4,'4 Slots aus der Vorlage');
  document.querySelector('input[name="slot"][value="2"]').click();await wait(30);
  ok($('changesTitle').textContent.match(/\d+ Werte/),'Änderungsliste: '+$('changesTitle').textContent);
  ok($('slotWarn').classList.contains('hidden'),'Slot 3 (PLA) passt zu PLA: kein Hinweis');
  $('export3mfSave').click();await wait(100);
  const f3=downloads.find(d=>d.name.endsWith('.3mf'));
  ok(f3&&f3.name==='pilz_KobraS1_Slot3.3mf','Dateiname '+(f3&&f3.name));
  if(f3){const z=fflate.unzipSync(await blobBytes(f3));const ps=JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config']));
    ok(ps.nozzle_temperature[2]==='215'&&ps.nozzle_temperature[0]==='205','3MF: Temperatur nur in Slot 3');
    ok(fflate.strFromU8(z['Metadata/model_settings.config']).includes('key="extruder" value="3"'),'3MF: Modell auf Slot 3');
    ok(ps.enable_support==='1','3MF: Stützen aktiviert (Pilz)')}
  ok($('toast').textContent.includes('3MF gespeichert'),'Toast nach 3MF-Export');
  document.querySelector('.printer-switch [data-printer="snapmaker_u1"]').click();sel('material','pla_hs');
  menuClick('export3mf');document.querySelector('input[name="slot"][value="3"]').click();await wait(30);
  ok(!$('slotWarn').classList.contains('hidden')&&$('slotWarn').textContent.includes('PETG'),'U1 Slot 4 (PETG) bei PLA: Hinweis');
  $('exportDlg').close();
  menuClick('export3mf');ok(document.querySelector('input[name="slot"]:checked').value==='0','U1: zuletzt gespeicherter Slot noch nicht gesetzt → Slot 1');$('exportDlg').close();

  /* 14) Modell entfernen */
  menuClick('clear');ok(!$('modelCard').classList.contains('loaded')&&$('export3mf').disabled,'Modell entfernen setzt alles zurück');

  HTMLAnchorElement.prototype.click=origClick;URL.revokeObjectURL=origRevoke;
  ok(errors.length===0,'keine JavaScript-Fehler ('+errors.join(' | ')+')');
  return {ok:log.length,fail,log};
}
