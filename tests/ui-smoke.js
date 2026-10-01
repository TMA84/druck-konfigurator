'use strict';
/* Bedientest wie ein Nutzer: klickt sich durch alle Funktionen der laufenden Seite.
   In die Seite laden (Konsole oder Testwerkzeug):
     await new Promise(r=>{const s=document.createElement('script');s.src='tests/ui-smoke.js?'+Date.now();s.onload=r;document.head.appendChild(s)});
     await runSmoke()
   Downloads werden abgefangen und inhaltlich geprüft; confirm/alert/print sind Attrappen. */
async function runSmoke(opts={}){
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
  async function dropFile(...files){const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));await wait(150)}

  // Ohne Live-Abfrage beginnen: die Prüfungen bis Abschnitt 13 erwarten die Slots der Vorlage
  const savedHosts=store.settings.printerHosts;store.settings.printerHosts={};slotState={printer:null,live:null,note:''};

  /* 0) Haftungsausschluss beim ersten Start (Test lädt mit leerem Speicher) */
  ok($('disclaimerDlg').open,'Haftungsausschluss beim ersten Start sichtbar');
  $('disclaimerOk').click();
  ok(!$('disclaimerDlg').open&&localStorage.getItem('druckKonfigurator.disclaimer')===DISCLAIMER_VERSION,'„Verstanden“ schließt und merkt es sich');
  document.querySelector('.footnote [data-action="disclaimer"]').click();
  ok($('disclaimerDlg').open,'Haftungsausschluss über die Fußzeile erreichbar');$('disclaimerDlg').close();

  /* 1) Startzustand */
  ok(document.body.dataset.printer==='kobra_s1','Start: Kobra S1 aktiv');
  ok($('title').textContent.includes('Anycubic PLA High Speed'),'Start: PLA High Speed gewählt');
  ok($('matBadge').textContent==='Getestet','Start: Badge „Getestet“');
  ok($('export3mf').disabled&&$('export3mfNote').textContent.includes('Modell'),'3MF-Menüpunkt ohne Modell gesperrt mit Grund');

  /* 2) Druckerwechsel */
  document.querySelector('.printer-switch [data-printer="snapmaker_u1"]').click();await wait(50);
  ok(document.body.dataset.printer==='snapmaker_u1','Umschalten auf U1 färbt um');
  ok([...$('nozM').options].map(o=>o.value).join()==='steel_stainless,steel_hardened','U1: Düsenmaterialien Edelstahl/gehärtet');
  ok($('matBadge').textContent==='Allgemeiner Startwert','U1: getestetes Profil gilt als allgemein');
  ok($('warning').innerHTML.includes('Snapmaker U1'),'U1: Warnhinweis „nicht gegengetestet“');
  ok($('orderedTitle').textContent.includes('OrcaSlicer'),'U1: Slicer-Reihenfolge OrcaSlicer');
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
  await dropFile(new File(['x'],'test.obj'));ok($('fileinfo').textContent.includes('nur STL, 3MF oder ZIP'),'Falsches Format wird abgelehnt');
  await dropFile(new File(['x'],'teil.3mf'));ok($('fileinfo').textContent.includes('konnte nicht gelesen'),'Kaputte 3MF: verständliche Fehlermeldung');
  // Mehrere Teile: zwei STLs plus ZIP mit einer STL mit zwei getrennten Körpern
  const zipBytes=fflate.zipSync({'set/doppel.stl':new Uint8Array(await stlFile('d.stl',[[0,0,0,10,10,10],[30,0,0,40,10,4]]).arrayBuffer())});
  await dropFile(stlFile('a.stl',[[0,0,0,20,20,20]]),stlFile('b.stl',[[0,0,0,5,5,30]]),new File([zipBytes],'paket.zip'));await wait(150);
  const items=[...$('partList').querySelectorAll('[data-part]')];
  ok(!$('partList').classList.contains('hidden')&&items.length===4,'Mehrere Dateien + ZIP: Teileliste mit '+items.length+' Teilen');
  ok(items[2]&&items[2].textContent.includes('doppel.stl · Teil 1'),'Körper einer STL als eigene Teile');
  ok(items[0].getAttribute('aria-current')==='true'&&geom.name==='a.stl','Erstes Teil ist gewählt');
  items[1].click();await wait(50);
  ok(geom.name==='b.stl'&&$('partList').querySelector('[data-part="1"]').getAttribute('aria-current')==='true','Klick wählt Teil 2');
  ok($('summary').textContent.includes('30'),'Datenblatt zeigt Maße von Teil 2');
  // Werte je Teil: Teil 2 bekommt PETG, Halterung und Slot 2 – Teil 1 behält seine Auswahl
  ok(!$('partScope').classList.contains('hidden')&&$('partScopeName').textContent==='b.stl','Formular zeigt, für welches Teil es gilt');
  sel('material','petg');sel('object','holder');
  $('partSlot').value='1';$('partSlot').dispatchEvent(new Event('change'));
  $('partList').querySelector('[data-part="0"]').click();await wait(50);
  ok($('material').value==='pla_hs'&&$('object').value==='general','Teil 1 behält eigene Auswahl ('+$('material').value+'/'+$('object').value+')');
  $('partList').querySelector('[data-part="1"]').click();await wait(50);
  ok($('material').value==='petg'&&$('object').value==='holder'&&$('partSlot').value==='1','Teil 2: PETG, Halterung, Slot 2 gemerkt');
  { const c=$('partList').querySelector('[data-part-slot="1"]');ok(c&&c.textContent==='2'&&!c.classList.contains('std'),'Teileliste zeigt Slot von Teil 2 als Chip'); }
  const lastBefore=JSON.parse(JSON.stringify(store.last));
  menuClick('export3mf');await wait(50);
  ok(!$('partPlan').classList.contains('hidden')&&$('partPlanTable').querySelectorAll('tbody tr').length===4,'Export-Dialog: Tabelle mit 4 Teilen');
  ok(/PETG/.test($('partPlanTable').textContent)&&$('slotLegend').textContent.includes('Standard'),'Tabelle zeigt PETG-Teil, Standard-Slot beschriftet');
  $('export3mfSave').click();await wait(100);
  store.last=lastBefore;persist(); // gemerkten Slot nicht verstellen, spätere Prüfungen hängen daran
  const fm=downloads.filter(d=>d.name.endsWith('.3mf')).pop();
  {const z=fflate.unzipSync(await blobBytes(fm));const msx=fflate.strFromU8(z['Metadata/model_settings.config']);
   ok((msx.match(/<object id=/g)||[]).length===4&&Object.keys(z).filter(k=>k.startsWith('3D/Objects/')).length===4,'3MF mit 4 Objekten ('+fm.name+')');
   ok((msx.match(/key="extruder" value="2"/g)||[]).length===1&&/_2Slots\.3mf$/.test(fm.name),'Teil 2 auf Slot 2, Dateiname nennt 2 Slots');
   const ps=JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config']));
   ok(ps.filament_type[1]==='PETG'&&/key="wall_loops"/.test(msx),'Slot 2 = PETG, eigene Werte als Objekt-Einstellung')}
  $('clear').click();await wait(50);
  ok($('partList').classList.contains('hidden')&&!project,'Leeren entfernt die Teileliste');
  /* Makerworld-3MF: zwei Objekte auf zwei Platten, für Bambu eingestellt → S1-Einstellungen, Platten bleiben */
  { const u8=s=>fflate.strToU8(s);
    const cubeXml=(id,s)=>{const b=[[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];const f=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
      return '<object id="'+id+'" type="model"><mesh><vertices>'+b.map(v=>'<vertex x="'+v[0]+'" y="'+v[1]+'" z="'+v[2]+'"/>').join('')+'</vertices><triangles>'+f.map(t=>'<triangle v1="'+t[0]+'" v2="'+t[1]+'" v3="'+t[2]+'"/>').join('')+'</triangles></mesh></object>'};
    const zipBytes2=fflate.zipSync({'_rels/.rels':u8('<Relationships><Relationship Target="/3D/3dmodel.model" Id="rel-1"/></Relationships>'),
      '3D/3dmodel.model':u8('<?xml version="1.0"?><model unit="millimeter" xmlns:p="x"><resources>'+cubeXml(1,20)+cubeXml(2,10)+'</resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 435.2 128 0"/></build></model>'),
      'Metadata/model_settings.config':u8('<?xml version="1.0"?><config><object id="1"><metadata key="name" value="Gross"/><metadata key="extruder" value="2"/><metadata key="enable_support" value="1"/><part id="1" subtype="normal_part"></part></object><object id="2"><metadata key="name" value="Klein"/><metadata key="extruder" value="1"/><part id="2" subtype="normal_part"></part></object>'+
        '<plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/></model_instance></plate><plate><metadata key="plater_id" value="2"/><model_instance><metadata key="object_id" value="2"/></model_instance></plate></config>'),
      'Metadata/project_settings.config':u8('{"printer_settings_id":"Bambu Lab X1 Carbon 0.4 nozzle"}'),'Metadata/plate_1.gcode':u8('; alt')});
    await dropFile(new File([zipBytes2],'makerworld.3mf'));await wait(300);
    ok(project&&project.threemf&&project.parts.length===2&&project.parts[0].slot===1,'Makerworld-3MF geladen: 2 Teile, Slot des Designers übernommen');
    // seit 10.6: auch 3MF-Teile lassen sich drehen (Transformation des Objekts); ohne Zutun bleibt die Lage des Designers
    { const p0=project.parts[0],R0=p0.R;ok(!document.querySelector('.orient-tools [data-orient="x"]').disabled&&R0.every((v,i)=>v===IDENTITY3[i]),'3MF: Lage des Designers bleibt, Drehen möglich');
      document.querySelector('.orient-tools [data-orient="x"]').click();await wait(100);
      const z=fflate.strFromU8(fflate.unzipSync(exportBytes(0).bytes)['3D/3dmodel.model']);
      ok(!p0.R.every((v,i)=>v===IDENTITY3[i])&&/<item [^>]*transform="1 0 0 0 0 1 0 -1 0 /.test(z),'3MF gedreht: Drehung in der Transformation des Objekts');
      document.querySelector('.orient-tools [data-orient="reset"]').click();await wait(100); }
    menuClick('export3mf');await wait(50);
    ok($('exportSub').textContent.includes('Bambu Lab X1 Carbon')&&document.querySelector('#exportDlg fieldset.slots').classList.contains('hidden'),'Dialog: Bambu-Einstellungen werden ersetzt, kein Standard-Slot nötig');
    $('export3mfSave').click();await wait(150);
    const fz=downloads.filter(d=>d.name.endsWith('.3mf')).pop(),z=fflate.unzipSync(await blobBytes(fz));
    const ps=JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config'])),msx=fflate.strFromU8(z['Metadata/model_settings.config']),root=fflate.strFromU8(z['3D/3dmodel.model']);
    ok(ps.printer_settings_id===exportTemplate('kobra_s1','0.4').printerPreset&&!z['Metadata/plate_1.gcode'],'Export: S1-Druckerprofil, alter G-Code entfernt');
    ok(/<object id="1">[\s\S]*?key="extruder" value="2"/.test(msx)&&!/key="enable_support" value="1"/.test(msx),'Export: Slot bleibt, Stützen-Vorgabe des Designers durch eigene Analyse ersetzt');
    ok(/transform="1 0 0 0 1 0 0 0 1 115 115 0"/.test(root)&&/transform="1 0 0 0 1 0 0 0 1 420 120 0"/.test(root),'Export: beide Platten auf die S1-Bettmitte gerückt');
    $('clear').click();await wait(50);}
  /* Bohrlöcher: Platte mit Loch Ø 5 → Vorschlag mit Häkchen, angehakt → Modifikator in der 3MF */
  { const tris=[],h=6,r=2.5,n=32,sq=a=>{const c=Math.cos(a),s=Math.sin(a),k=20/Math.max(Math.abs(c),Math.abs(s));return [20+k*c,20+k*s]},ci=a=>[20+r*Math.cos(a),20+r*Math.sin(a)];
    for(let i=0;i<n;i++){const a=2*Math.PI*i/n,b=2*Math.PI*(i+1)/n,[oa,ob,ia,ib]=[sq(a),sq(b),ci(a),ci(b)];
      tris.push([[...ia,h],[...oa,h],[...ob,h]],[[...ia,h],[...ob,h],[...ib,h]],[[...ia,0],[...ob,0],[...oa,0]],[[...ia,0],[...ib,0],[...ob,0]],[[...oa,0],[...ob,0],[...ob,h]],[[...oa,0],[...ob,h],[...oa,h]],[[...ia,0],[...ib,h],[...ib,0]],[[...ia,0],[...ia,h],[...ib,h]])}
    const buf=new ArrayBuffer(84+tris.length*50),dv=new DataView(buf);dv.setUint32(80,tris.length,true);tris.forEach((t,i)=>t.flat().forEach((c,j)=>dv.setFloat32(84+i*50+12+j*4,c,true)));
    await dropFile(new File([buf],'lochplatte.stl'));await wait(300);
    const cbs=[...$('holeList').querySelectorAll('[data-hole]')];
    ok(!$('holeBox').classList.contains('hidden')&&cbs.length===1&&!cbs[0].checked&&/Ø 5,0 mm/.test($('holeList').textContent),'Bohrloch vorgeschlagen, Häkchen nicht gesetzt ('+$('holeList').textContent.trim().slice(0,40)+')');
    menuClick('export3mf');await wait(50);$('export3mfSave').click();await wait(100);
    let z=fflate.unzipSync(await blobBytes(downloads.filter(d=>d.name.endsWith('.3mf')).pop()));
    ok(!/modifier_part/.test(fflate.strFromU8(z['Metadata/model_settings.config'])),'Ohne Häkchen: kein Modifikator');
    cbs[0].click();await wait(30);
    menuClick('export3mf');await wait(50);$('export3mfSave').click();await wait(100);
    z=fflate.unzipSync(await blobBytes(downloads.filter(d=>d.name.endsWith('.3mf')).pop()));
    const msh=fflate.strFromU8(z['Metadata/model_settings.config']);
    ok(/modifier_part/.test(msh)&&/sparse_infill_density" value="100%"/.test(msh),'Mit Häkchen: Modifikator mit 100 % Füllung');
    // gewähltes Loch bleibt bei Größe und Drehung gewählt (wird im neuen Netz wiedergefunden)
    { const p=project.parts[project.selected];setPartScale(p,[1.5,1.5,1.5]);await wait(80);
      ok(p.holes.length===1&&Math.abs(p.holes[0].r-3.75)<0.1,'Größe 150 %: Bohrloch bleibt gewählt (Ø '+(p.holes[0]?de(2*p.holes[0].r,1):'–')+' mm)');
      document.querySelector('.orient-tools [data-orient="x"]').click();await wait(120);
      ok(p.holes.length===1&&p.holes[0].axis!=='z','Gedreht: Bohrloch bleibt gewählt (jetzt Achse '+(p.holes[0]&&p.holes[0].axis)+')');
      setPartScale(p,[1,1,1]);document.querySelector('.orient-tools [data-orient="reset"]').click();await wait(80); }
    document.querySelector('.orient-tools [data-orient="x"]').click();await wait(80);
    ok(project.parts[0].holes.length===1&&$('holeList').querySelectorAll('[data-hole]:checked').length===1,'Nach Drehung neu erkannt, gewähltes Loch bleibt angehakt');
    $('clear').click();await wait(50);}
  sel('material','pla_hs');sel('object','general'); // Ausgangslage für die folgenden Prüfungen

  /* Ausrichtung: Pilz steht auf dem Stiel → Vorschlag Hut aufs Bett */
  await dropFile(stlFile('pilz.stl',[[15,15,0,25,25,20],[0,0,20,40,40,25]]));await wait(300);
  ok(!$('orientBox').classList.contains('hidden')&&/Stützen/.test($('orientInfo').textContent),'Ausrichtung: aktuelle Lage bewertet ('+$('orientInfo').textContent+')');
  ok(!$('orientSuggest').classList.contains('hidden'),'Ausrichtung: Vorschlag angezeigt');
  { const was=document.body.dataset.tab; setTab('settings'); // die kleine Vorschau steht im Tab „Druckwerte“ (seit der Aufteilung in Arbeitsschritte)
    ok(!$('miniView').classList.contains('hidden')&&$('miniView').querySelector('canvas')&&$('miniView').clientHeight>100,'Kleine 3D-Vorschau im Tab Druckwerte sichtbar');
    setTab(was); }
  $('orientSuggest').querySelector('[data-orient="apply"]').click();await wait(300);
  ok(Math.abs(geom.z-25)<1e-3&&analyze(geom,45).level==='none'&&$('orientSuggest').classList.contains('hidden'),'Vorschlag übernommen: keine Stützen mehr ('+$('orientInfo').textContent+')');
  document.querySelector('.orient-tools [data-orient="x"]').click();await wait(50);
  ok(Math.abs(geom.z-40)<1e-3,'↻ X: 90° gedreht (Höhe '+de(geom.z,1)+')');
  document.querySelector('.orient-tools [data-orient="reset"]').click();await wait(50);
  ok(Math.abs(geom.z-25)<1e-3&&Math.abs(geom.bedArea-100)<1,'Original: Lage aus der Datei');
  { let cb=null;const orig=Viewer.setPick;Viewer.setPick=(on,f)=>{cb=f};
    document.querySelector('.orient-tools [data-orient="pick"]').click();await wait(30);
    ok(document.body.dataset.tab==='3d'&&typeof cb==='function','Fläche aufs Bett: 3D-Ansicht mit Auswahlmodus');
    // oberste Fläche des Huts (z = 25, Normale nach oben) anklicken
    const top=[...Array(geom.n).keys()].find(i=>geom.ang[i]<-80&&geom.pos[i*9+2]>24.9);cb(top);await wait(50);
    Viewer.setPick=orig;
    ok(Math.abs(geom.bedArea-1600)<1,'Angeklickte Fläche liegt auf dem Bett (Auflage '+de(geom.bedArea,0)+' mm²)');
    setTab('settings');}
  $('clear').click();await wait(50);
  await dropFile(stlFile('pilz.stl',[[15,15,0,25,25,20],[0,0,20,40,40,25]]));
  ok($('fileinfo').textContent.includes('pilz.stl')&&$('modelCard').classList.contains('loaded'),'STL per Drag&Drop geladen');
  ok(!$('modelBadge').classList.contains('hidden'),'Tab-Badge „Modell“ sichtbar');
  ok($('supportGuide').textContent.includes('Baumstützen'),'Überhang erkannt → Baumstützen');
  ok(!$('export3mf').disabled,'3MF-Menüpunkt mit Modell und 0,4-mm-Düse frei');
  sel('nozD','0.6');ok($('export3mf').disabled&&$('export3mfNote').textContent.includes('0,4'),'3MF bei 0,6-mm-Düse gesperrt mit Grund');sel('nozD','0.4');

  /* 6) 3D-Ansicht */
  $('tab3d').click();await wait(80);
  ok(!$('view3d').hidden&&$('viewSettings').hidden,'Tab 3D-Ansicht zeigt Viewer');
  ok($('info').textContent.includes('pilz.stl')&&$('sx').textContent==='40,0 mm'&&$('sz').textContent==='25,0 mm','Untere Leiste: Name und Maße');
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
  const nAlerts=alerts.length;
  $('importFile').files=dt.files;$('importFile').dispatchEvent(new Event('change'));
  for(let i=0;i<30&&!$('material').querySelector('option[value="'+newId+'"]');i++)await wait(100); // Datei lesen dauert auf langsamen Rechnern länger
  ok(!!$('material').querySelector('option[value="'+newId+'"]'),'Import stellt gelöschtes Filament wieder her'+(alerts.length>nAlerts?' ('+alerts.slice(nAlerts).join(' | ')+')':''));
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
  ok(/Slot, in dem dein PLA steckt/.test($('slotHint').textContent),'Hinweis nennt das gewählte Filament ('+$('slotHint').textContent.slice(0,45)+')');
  document.querySelector('input[name="slot"][value="2"]').click();await wait(30);
  ok($('changesTitle').textContent.match(/\d+ Werte/),'Änderungsliste: '+$('changesTitle').textContent);
  ok($('slotWarn').classList.contains('hidden'),'Slot 3 (PLA) passt zu PLA: kein Hinweis');
  $('export3mfSave').click();await wait(100);
  const f3=downloads.filter(d=>d.name.endsWith('.3mf')).pop();
  ok(f3&&f3.name==='pilz_KobraS1_Slot3.3mf','Dateiname '+(f3&&f3.name));
  if(f3){const z=fflate.unzipSync(await blobBytes(f3));const ps=JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config']));
    ok(ps.nozzle_temperature[2]==='215'&&ps.nozzle_temperature[0]==='205','3MF: Temperatur nur in Slot 3');
    ok(fflate.strFromU8(z['Metadata/model_settings.config']).includes('key="extruder" value="3"'),'3MF: Modell auf Slot 3');
    ok(ps.enable_support==='1','3MF: Stützen aktiviert (Pilz)')}
  ok($('toast').textContent.includes('3MF gespeichert'),'Toast nach 3MF-Export');
  document.querySelector('.printer-switch [data-printer="snapmaker_u1"]').click();sel('material','pla_hs');
  menuClick('export3mf');document.querySelector('input[name="slot"][value="3"]').click();await wait(30);
  // Die Vorlage sagt nichts über die echte Belegung → kein Hinweis und kein Filamenttyp in der Liste
  ok($('slotWarn').classList.contains('hidden')&&!/PLA|PETG/.test($('slotList').textContent),'U1 ohne bekannte Belegung: kein Vorlagen-Typ, kein Hinweis');
  $('exportDlg').close();
  menuClick('export3mf');ok(document.querySelector('input[name="slot"]:checked').value==='0','U1: zuletzt gespeicherter Slot noch nicht gesetzt → Slot 1');$('exportDlg').close();

  /* 13b) Drucker-Verbindung und Live-Belegung (nur lesende Abfragen); Hosts via runSmoke({hosts}) */
  /* Belegung von Hand eintragen (Originalfirmware): Slot 2 = PETG schwarz → Dialog, 3MF, Teileliste */
  { if(!geom)await dropFile(stlFile('pilz.stl',[[15,15,0,25,25,20],[0,0,20,40,40,25]]));
    menuClick('export3mf');await wait(50);
    $('slotEditBtn').click();
    ok($('slotDlg').open&&document.querySelectorAll('[data-slot-type]').length===4,'Eintragen: 4 Slots zum Ausfüllen');
    const t=document.querySelector('[data-slot-type="1"]');t.value='PETG';document.querySelector('[data-slot-colour="1"]').value='#101010';
    document.querySelector('[data-slot-type="3"]').value='';
    $('slotEditSave').click();await wait(50);
    ok(/Von Hand eingetragen/.test($('slotSource').textContent)&&/Slot 2 · PETG/.test($('slotList').textContent)&&/Slot 4 · leer/.test($('slotList').textContent),'Eintragen: Dialog zeigt die eigene Belegung');
    document.querySelector('input[name="slot"][value="0"]').click();await wait(30);
    $('export3mfSave').click();await wait(100);
    const zz=fflate.unzipSync(await blobBytes(downloads.filter(d=>d.name.endsWith('.3mf')).pop()));
    const pz=JSON.parse(fflate.strFromU8(zz['Metadata/project_settings.config']));
    ok(pz.filament_type[1]==='PETG'&&pz.filament_colour[1]==='#101010'&&/PETG/.test(pz.filament_settings_id[1]),'Eintragen: 3MF hat Slot 2 = PETG schwarz mit PETG-Preset');
    loadStore();ok(store.settings.manualSlots&&store.settings.manualSlots[$('printer').value][1].type==='PETG','Eintragen: bleibt gespeichert');
    menuClick('export3mf');await wait(50);$('slotEditBtn').click();$('slotEditReset').click();await wait(50);
    ok(/unbekannt/.test($('slotSource').textContent)&&!(store.settings.manualSlots||{})[$('printer').value]&&!/PLA|PETG/.test($('slotList').textContent),'Eingabe löschen: Belegung wieder unbekannt, keine Typen aus der Vorlage');
    /* Zweite ACE von Hand (Kobra S1): 8 Slots, Slot 6 = PETG → 3MF mit 8 Filamenten; der S1 bietet höchstens 2 Einheiten an */
    const prevPrinter=document.body.dataset.printer;
    $('exportDlg').close();document.querySelector('.printer-switch [data-printer="kobra_s1"]').click();await wait(120);
    menuClick('export3mf');await wait(50);
    $('slotEditBtn').click();
    ok(!$('slotAceRow').classList.contains('hidden')&&$('slotAceCount').options.length===2,'Zwei ACE: Auswahl 1–2 Einheiten beim S1');
    $('slotAceCount').value='2';$('slotAceCount').dispatchEvent(new Event('change'));await wait(50);
    ok(document.querySelectorAll('[data-slot-type]').length===8&&/Slot 5 · ACE 2/.test($('slotEditRows').textContent),'Zwei ACE: 8 Slots, Slot 5 = ACE 2');
    if(document.querySelectorAll('[data-slot-type]').length===8){
    document.querySelector('[data-slot-type="5"]').value='PETG';document.querySelector('[data-slot-colour="5"]').value='#00aa00';
    $('slotEditSave').click();await wait(50);
    ok(document.querySelectorAll('#slotList input[name="slot"]').length===8&&/Slot 6 · ACE 2 · PETG/.test($('slotList').textContent),'Zwei ACE: Export-Dialog zeigt 8 Slots');
    document.querySelector('input[name="slot"][value="5"]').click();await wait(30);
    $('export3mfSave').click();await wait(100);
    { const z2=fflate.unzipSync(await blobBytes(downloads.filter(d=>d.name.endsWith('.3mf')).pop()));
      const p2=JSON.parse(fflate.strFromU8(z2['Metadata/project_settings.config'])),m2=fflate.strFromU8(z2['Metadata/model_settings.config']);
      ok(p2.filament_settings_id.length===8&&p2.filament_colour[5]==='#00AA00'&&/key="extruder" value="6"/.test(m2),'Zwei ACE: 3MF mit 8 Filamenten, Teil druckt aus Slot 6 (Farbe aus der Belegung)'); }
    menuClick('export3mf');await wait(50);$('slotEditBtn').click();
    $('slotAceCount').value='1';$('slotAceCount').dispatchEvent(new Event('change'));await wait(30);
    ok(document.querySelectorAll('[data-slot-type]').length===4,'Zurück auf eine ACE: 4 Slots');
    $('slotEditReset').click();await wait(50);}
    /* Werkstatt mit zwei Einheiten: Reiter je ACE, Slot-Nummern laufen weiter */
    { const saved=wb.st,box=(id,t)=>({id,auto_feed:0,loaded_slot:-1,temp:24,drying:{status:id,target_temp:45,duration:240,remain_time:100},slots:[0,1,2,3].map(i=>({index:i,type:t,colour:'#336699',present:true,loaded:false,rfid:false}))});
      try{ wb.st={connected:true,state:'free',printing:false,temps:{},fans:{},lights:[],ace:[box(0,'PLA'),box(1,'PETG')],has_ace:1};wb.box=0;wbRender();
        ok($('wbAceTabs').querySelectorAll('button').length===2&&/trocknet/.test($('wbAceTabs').textContent),'Werkstatt: Reiter ACE 1/ACE 2, ACE 2 trocknet');
        $('wbAceTabs').querySelectorAll('button')[1].click();
        ok([...$('wbAceSlots').querySelectorAll('.wb-swatch span')].map(x=>x.textContent).join()==='5,6,7,8'&&/PETG/.test($('wbAceSlots').textContent),'Werkstatt: ACE 2 zeigt Slot 5–8');
      }catch(e){ok(false,'Werkstatt mit zwei ACE: '+e.message)}
      finally{wb.st=saved;wb.box=0;if(saved)wbRender()} }
    $('exportDlg').close();
    if(prevPrinter!=='kobra_s1'){document.querySelector('.printer-switch [data-printer="'+prevPrinter+'"]').click();await wait(120);}}

  /* Anderer Drucker aus den Orca-Profilen: Auswahl, Datenblatt, Export mit dessen Profil, zurück zum S1 */
  { document.querySelector('.printer-switch [data-printer="orca"]').click();
    ok($('pickerDlg').open&&$('pickVendor').options.length>50,'Druckerauswahl öffnet ('+$('pickVendor').options.length+' Hersteller)');
    $('pickVendor').value='Creality';$('pickVendor').dispatchEvent(new Event('change'));
    $('pickSearch').value='Ender-3 V3 SE';$('pickSearch').dispatchEvent(new Event('input'));
    const pick=$('pickList').querySelector('[data-pick="Creality Ender-3 V3 SE 0.4 nozzle"]');
    ok(!!pick,'Suche findet den Ender-3 V3 SE mit 0,4-mm-Düse');
    pick.click();for(let i=0;i<50&&document.body.dataset.printer!=='orca';i++)await wait(100);
    ok(document.body.dataset.printer==='orca'&&$('printerOrcaLabel').textContent.includes('Ender-3 V3 SE')&&!$('pickerDlg').open,'Ender-3 V3 SE aktiv, Kopfzeile zeigt ihn');
    ok(/allgemeine Startwerte/.test($('warning').textContent)&&lastResult.sp_outer<=60,'Datenblatt: Hinweis + Außenwand auf Orca-Profil begrenzt ('+lastResult.sp_outer+' mm/s)');
    if(!geom)await dropFile(stlFile('pilz.stl',[[15,15,0,25,25,20],[0,0,20,40,40,25]]));
    menuClick('export3mf');await wait(60);$('export3mfSave').click();await wait(150);
    const fo=downloads.filter(d=>d.name.endsWith('.3mf')).pop(),zo=fflate.unzipSync(await blobBytes(fo)),po=JSON.parse(fflate.strFromU8(zo['Metadata/project_settings.config']));
    ok(po.printer_settings_id==='Creality Ender-3 V3 SE 0.4 nozzle'&&/Ender3V3SE/.test(po.print_settings_id)&&JSON.stringify(po.printable_area).includes('220x220'),'3MF mit Ender-Druckerprofil, Prozessprofil und 220er Bett ('+fo.name+')');
    document.querySelector('.printer-switch [data-printer="kobra_s1"]').click();await wait(80);
    ok(document.body.dataset.printer==='kobra_s1','Zurück zum Kobra S1');}

  if(opts.hosts){
    sel('material','petg');
    document.querySelector('[data-action="link"]').click();ok($('linkDlg').open,'Dialog Drucker-Verbindung');
    $('host_kobra_s1').value='kein host!';$('linkSave').click();ok($('linkDlg').open&&$('linkRes_kobra_s1').textContent.includes('Ungültig'),'Ungültige Adresse abgelehnt');
    $('host_kobra_s1').value=opts.hosts.kobra_s1;$('host_snapmaker_u1').value=opts.hosts.snapmaker_u1;
    await testLink('kobra_s1');await testLink('snapmaker_u1');
    ok($('linkRes_kobra_s1').classList.contains('good'),'Test S1: '+$('linkRes_kobra_s1').textContent);
    ok($('linkRes_snapmaker_u1').classList.contains('good'),'Test U1: '+$('linkRes_snapmaker_u1').textContent);
    $('linkSave').click();ok(store.settings.printerHosts.kobra_s1===opts.hosts.kobra_s1,'IPs gespeichert');
    for(const pid of ['kobra_s1','snapmaker_u1']){
      document.querySelector('.printer-switch [data-printer="'+pid+'"]').click();
      if(!geom)await dropFile(stlFile('pilz.stl',[[15,15,0,25,25,20],[0,0,20,40,40,25]]));
      menuClick('export3mf');for(let i=0;i<180&&!document.querySelector('.slot-source.live, .slot-source.fallback');i++)await wait(100);
      ok(document.querySelector('.slot-source.live'),pid+': '+$('slotSource').textContent);
      const checked=document.querySelector('input[name="slot"]:checked').closest('.slot').textContent;
      ok(/PETG/.test(checked),pid+': PETG-Slot vorausgewählt ('+checked.replace(/\s+/g,' ').trim()+')');
      $('export3mfSave').click();await wait(100);
      const f=downloads.filter(d=>d.name.endsWith('.3mf')).pop();
      const z=fflate.unzipSync(await blobBytes(f)),ps=JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config']));
      ok(ps.filament_type.some(t=>t!=='PLA'),pid+': echte Slot-Typen in der 3MF ('+ps.filament_type.join(',')+')');
    }
    document.querySelector('.printer-switch [data-printer="kobra_s1"]').click(); // S1 bekommt eine Adresse, die nie antwortet
    store.settings.printerHosts={kobra_s1:'10.255.255.1',snapmaker_u1:''};slotState={printer:null,live:null,note:''};
    menuClick('export3mf');for(let i=0;i<180&&!document.querySelector('.slot-source.fallback');i++)await wait(100);
    ok(document.querySelector('.slot-source.fallback')&&/antwortet nicht|nicht erreichbar/.test($('slotSource').textContent),'Drucker nicht erreichbar → Vorlage mit Hinweis ('+$('slotSource').textContent+')');
    $('exportDlg').close();store.settings.printerHosts=opts.hosts;persist();
  }

  /* 13b) Seit 8.3/9.x: Platten, Kopien, Modell hinzufügen, Slot-Wahl, Werte je Auftrag, Spulen, Sprache/Darstellung */
  {
    const mk=(n,x,y,z)=>stlFile(n,[[0,0,0,x,y,z]]);
    await dropFile(mk('gross.stl',150,120,20),mk('klein.stl',60,60,30));await wait(300);
    ok(project.parts.length===2&&!$('plateBox').classList.contains('hidden'),'Platten-Übersicht bei zwei Teilen');
    ok(projectLayout(plTpl()).count===1&&document.querySelectorAll('#plateList .plate-svg rect[data-pick]').length===2,'beide Teile auf einer Platte mit Draufsicht');
    selectPart(1);$('partList').querySelector('[data-copies="1"]').click();await wait(100);
    ok(project.parts.length===3&&samePlacements(project.parts[1]).length===2,'Anzahl + legt eine Kopie an (gleiche Einstellungen)');
    selectPart(0);await wait(50);const mv=document.querySelector('#partList [data-part-move="0"]');mv.value=String(projectLayout(plTpl()).count+1);mv.dispatchEvent(new Event('change',{bubbles:true}));await wait(100);
    ok(projectLayout(plTpl()).count===2&&!$('plateAuto').classList.contains('hidden'),'Teil auf neue Platte verschoben, „Platzsparend anordnen“ erscheint');
    $('plateAuto').click();await wait(100);
    ok(projectLayout(plTpl()).count===1,'Platzsparend anordnen: wieder eine Platte');
    // Größe (① Modell → Größe / Werkzeugleiste) und Werkzeugleiste
    { selectPart(0);await wait(50);const x0=project.parts[0].geom.x;
      document.querySelector('[data-sz="50"]').click();await wait(80);
      ok(Math.abs(project.parts[0].geom.x-x0/2)<0.01&&/50 %/.test(document.querySelector('[data-sec-tab="size"] .sec-sum').textContent),'Größe 50 %: Teil halb so breit');
      $('szX').value=String(x0*1.5);$('szX').dispatchEvent(new Event('change'));await wait(80);
      ok(Math.abs(project.parts[0].geom.x-x0*1.5)<0.05&&Math.abs(project.parts[0].scale[1]-1.5)<1e-3,'Zielmaß X: gleichmäßig auf 150 %');
      $('szReset').click();await wait(80);ok(!project.parts[0].scale&&Math.abs(project.parts[0].geom.x-x0)<0.01,'Original stellt die Größe wieder her');
      const n=project.parts.length;await wait(450);$('tbCopyPlus').click();await wait(450);ok(project.parts.length===n+1&&!$('tbCopyMinus').disabled,'Werkzeugleiste: Kopie +');
      $('tbCopyMinus').click();await wait(450);ok(project.parts.length===n,'Werkzeugleiste: Kopie −');
      // Rückgängig/Wiederholen (Strg+Z / Knöpfe): Kopie − zurücknehmen und wiederholen
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));await wait(500);
      ok(project.parts.length===n+1,'Strg+Z nimmt „Kopie −“ zurück');
      $('tbRedo').click();await wait(500);ok(project.parts.length===n&&!$('tbUndo').disabled,'Wiederholen stellt es wieder her'); }
    // Projekt übersteht Neuladen (js/project-store.js): Slot, Größe, Drehung speichern, Projekt im Speicher verwerfen, wiederherstellen
    { const p=project.parts[0];setPartSlot(p,2);setPartScale(p,[1.25,1.25,1.25]);setPartRotation(p,rotateAxis('x',90));update();await wait(1600);
      const want=JSON.stringify(project.parts.map(q=>[q.name,q.slot,q.scale,q.R,+q.geom.x.toFixed(2),+q.geom.z.toFixed(2)]));
      project=null;const okR=await restoreProject();await wait(200);
      const got=project&&JSON.stringify(project.parts.map(q=>[q.name,q.slot,q.scale,q.R,+q.geom.x.toFixed(2),+q.geom.z.toFixed(2)]));
      ok(okR&&got===want,'Projekt wiederhergestellt: Teile, Slot, Größe, Drehung wie vorher',got);
      setPartScale(project.parts[0],[1,1,1]);setPartRotation(project.parts[0],IDENTITY3);update();await wait(100); }
    // Filamente der Hersteller (Tab ②): Gruppen je Marke, Farben, Klick trägt die Farbe für den Slot ein
    { const groups=[...$('material').querySelectorAll('optgroup')].map(g=>g.label);
      ok(groups.some(g=>/^Anycubic/.test(g))&&groups.some(g=>/^SUNLU/.test(g)),'Filament: Gruppen Anycubic und SUNLU');
      const before=$('material').value;$('material').value='sl_pla_plus2';$('material').dispatchEvent(new Event('change',{bubbles:true}));await wait(200);
      ok(/Herstellerwerte/.test($('matBadge').textContent)&&$('matColours').querySelectorAll('[data-mat-colour]').length>20,'SUNLU PLA+ 2.0: Herstellerwerte und Farben');
      const saved=JSON.stringify(store.settings.manualSlots||null);
      $('matColours').querySelector('[data-mat-colour="5"]').click();await wait(200);
      const tpl=exportTemplate(lastResult.printer.id,lastResult.dSel),sl=dialogSlots(tpl)[project.parts[project.selected].slot??defaultSlot()];
      ok(sl&&sl.colour==='#002FA7'&&sl.type==='PLA','Farbe angeklickt: Slot bekommt PLA Klein Blue');
      store.settings.manualSlots=JSON.parse(saved)||undefined;if(!store.settings.manualSlots)delete store.settings.manualSlots;persist();
      // Spule per RFID erkannt (Drucker-Verbindung nachgestellt): statt der Farbauswahl nur ein Hinweis; ohne RFID wieder die Farben
      { const s0=project.parts[project.selected].slot??defaultSlot(),n=exportTemplate(lastResult.printer.id,lastResult.dSel).slots.length,old=slotState;
        const mk=rfid=>Array.from({length:n},(_,i)=>({type:'PLA',colour:'#3366CC',name:'PLA',present:true,rfid:rfid&&i===s0}));
        slotState={printer:lastResult.printer.id,live:{slots:mk(true),via:'lan',time:new Date()},note:''};update();await wait(150);
        ok(/RFID/.test($('matColours').textContent)&&!$('matColours').querySelector('[data-mat-colour]'),'RFID-Spule im Slot: keine Farbauswahl, nur Hinweis');
        slotState={printer:lastResult.printer.id,live:{slots:mk(false),via:'lan',time:new Date()},note:''};update();await wait(150);
        ok($('matColours').querySelectorAll('[data-mat-colour]').length>20,'ohne RFID: Farben des Herstellers wieder da');
        slotState=old;update();await wait(100); }
      $('material').value=before;$('material').dispatchEvent(new Event('change',{bubbles:true}));await wait(150); }
    // STL vielleicht in Zoll: Angebot, Umrechnen ×25,4 (wie Größe), Strg+Z nimmt es zurück
    { const b=new ArrayBuffer(84+50*12),d=new DataView(b);d.setUint32(80,12,true);const v=[[0,0,0],[4,0,0],[4,2,0],[0,2,0],[0,0,1],[4,0,1],[4,2,1],[0,2,1]];
      [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].forEach((tr,i)=>tr.forEach((q,j)=>v[q].forEach((c,k)=>d.setFloat32(84+50*i+12+j*12+k*4,c,true))));
      const keep=project;await loadFiles([new File([b],'zoll.stl')]);await wait(300);
      ok(!$('inchHint').classList.contains('hidden')&&/Zoll/.test($('inchHint').textContent),'sehr kleine STL: Angebot „In Zoll umrechnen“');
      await wait(450);$('inchApply').click();await wait(500);
      ok(Math.abs(project.parts[0].geom.x-101.6)<0.05&&$('inchHint').classList.contains('hidden'),'Zoll umgerechnet: 4 → 101,6 mm');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));await wait(600);
      ok(Math.abs(project.parts[0].geom.x-4)<0.01&&!$('inchHint').classList.contains('hidden'),'Strg+Z: wieder 4 mm, Angebot wieder da');
      $('inchKeep').click();await wait(100);ok($('inchHint').classList.contains('hidden'),'„Passt so“ blendet das Angebot aus');
      showProject(keep);await wait(500); }
    // Modell aus zwei Teilen (eine STL, zwei getrennte Körper): Kopfzeile mit gemeinsamer Anzahl, Kopien als eine Zeile
    { const box=(x0,y0,x1,y1,h)=>{const v=[[x0,y0,0],[x1,y0,0],[x1,y1,0],[x0,y1,0],[x0,y0,h],[x1,y0,h],[x1,y1,h],[x0,y1,h]];return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].map(t=>t.map(i=>v[i]))};
      const tr=box(0,0,20,20,5).concat(box(40,0,55,15,2)),b=new ArrayBuffer(84+50*tr.length),d=new DataView(b);d.setUint32(80,tr.length,true);
      tr.forEach((t,i)=>t.forEach((q,j)=>q.forEach((c,k)=>d.setFloat32(84+50*i+12+j*12+k*4,c,true))));
      const keep=project;await loadFiles([new File([b],'satz.stl')]);setTab('model');await wait(300);
      const inp=$('partList').querySelector('[data-src-copies-n]');
      ok(project.parts.length===2&&!!inp,'Modell aus zwei Teilen: Kopfzeile mit Anzahl');
      inp.value='3';inp.dispatchEvent(new Event('change',{bubbles:true}));await wait(600);
      const rows=[...$('partList').querySelectorAll('[data-part]')];
      ok(project.parts.length===6&&rows.length===2&&rows.every(r=>/×3/.test(r.textContent)),'Anzahl 3 für das Modell: je Teil 3, zwei Zeilen „×3“');
      showProject(keep);await wait(500); }
    // Objekte überspringen (Tab ④): Liste aus dem G-Code, Befehl skip/start mit der Nummer (Drucker nachgestellt)
    { const objs=[{id:0,name:'a.stl_id_0_copy_0',polygon:[[0,0],[10,0],[10,10]]},{id:1,name:'a.stl_id_0_copy_1',polygon:[[20,0],[30,0],[30,10]]},{id:2,name:'b.stl_id_1_copy_0',polygon:[[40,0],[50,0],[50,10]]}];
      const of=window.fetch,sent=[],oc=window.confirm,hosts=store.settings.printerHosts;
      window.fetch=(u,o)=>{u=String(u);if(u.startsWith('api/printing/objects'))return Promise.resolve(new Response(JSON.stringify(objs),{status:200}));
        if(u.startsWith('api/anycubic/command')){sent.push(JSON.parse(o.body));return Promise.resolve(new Response('{"ok":true,"state":"sent"}',{status:200,headers:{'Content-Type':'application/json'}}))}
        if(u.startsWith('api/anycubic/status'))return new Promise(()=>{});return of(u,o)};
      window.confirm=()=>true;store.settings.printerHosts={...(hosts||{}),[WB_PRINTER]:'10.0.0.9'};
      const st={connected:true,printing:true,job:{name:'Smoke_Platte1',progress:10,skipped:[2],skipped_confirmed:false},temps:{},fans:{},lights:[],ace:[]};
      skRender(st);await wait(300);
      const rows=[...$('wbObjects').querySelectorAll('[data-sk-row]')];
      ok(rows.length===3&&/Kopie 2/.test(rows[1].textContent)&&/übersprungen/.test(rows[2].textContent),'Objekte: Liste mit Kopien, übersprungenes markiert');
      $('wbObjects').querySelector('[data-sk-skip="1"]').click();await wait(400);
      ok(sent.length===1&&sent[0].type==='skip'&&sent[0].action==='start'&&JSON.stringify(sent[0].data)==='{"parts":[1]}','Überspringen: skip/start mit Objekt 1');
      window.fetch=of;window.confirm=oc;store.settings.printerHosts=hosts;skRender(null); }
    // Bemalen (Werkzeugleiste): Strich mit der Maus auf dem Teil, Umschalt radiert, Rückgängig, Export mit paint_color, übersteht Neuladen
    { selectPart(0);setTab('3d');await wait(300);const p=project.parts[0];p.paintUser=null;
      ok(!$('tbPaint').disabled,'Werkzeugleiste: Bemalen verfügbar');
      $('tbPaint').click();await wait(150);
      ok(!$('paintPanel').classList.contains('hidden')&&$('ptTools').children.length===6&&$('ptSlots').querySelectorAll('[data-pt-slot]').length>1,'Bemalen: Feld mit 6 Werkzeugen und Slots');
      $('ptSlots').querySelector('[data-pt-slot="1"]').click();await wait(30);
      const cv=document.querySelector('#stage canvas'),r=cv.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
      const pe=(type,x,y,extra={})=>cv.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1,pointerId:7,pointerType:'mouse',isPrimary:true,...extra}));
      pe('pointerdown',cx,cy);for(let k=1;k<=6;k++){pe('pointermove',cx+k*5,cy);await wait(16)}pe('pointerup',cx+30,cy);await wait(500);
      const pu=p.paintUser;
      ok(!!pu&&Object.keys(pu.codes).length>0&&JSON.stringify(pu.slots)==='[1]','Strich auf dem Teil: bemalt mit Slot 2 ('+(pu?Object.keys(pu.codes).length:0)+' Dreiecke)');
      menuClick('export3mf');await wait(50);$('export3mfSave').click();await wait(150);
      const z=fflate.unzipSync(await blobBytes(downloads.filter(d=>d.name.endsWith('.3mf')).pop())),mesh=Object.keys(z).filter(k=>/3D\/Objects\/.*\.model$/.test(k)).map(k=>fflate.strFromU8(z[k])).join('');
      ok(/paint_color="[0-9A-F]+"/.test(mesh),'Export: Bemalung als paint_color im Netz');
      pe('pointerdown',cx+15,cy,{shiftKey:true});pe('pointerup',cx+15,cy,{shiftKey:true});await wait(500);
      ok(p.paintUser!==pu,'Umschalt + Klick radiert');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));await wait(600);
      ok(project.parts[0].paintUser&&project.parts[0].paintUser.rev===pu.rev,'Strg+Z stellt die Bemalung vor dem Radieren wieder her');
      update();await wait(1600);project=null;await restoreProject();await wait(300);
      ok(project&&project.parts[0].paintUser&&JSON.stringify(project.parts[0].paintUser.codes)===JSON.stringify(pu.codes),'Bemalung übersteht Neuladen');
      paintMode(false);await wait(50);ok($('paintPanel').classList.contains('hidden')&&!$('tbPaint').classList.contains('active'),'Fertig schließt das Feld');
      project.parts[0].paintUser=null;update();await wait(100); }
    // Modell hinzufügen statt ersetzen
    addMode=true;await dropFile(mk('deckel.stl',50,30,4));await wait(300);
    ok(project.parts.length===4&&/ \+ /.test(project.name),'Modell hinzufügen erweitert das Projekt ('+project.name+')');
    // Einzelnes Teil entfernen (✕ in der Teileliste) und rückgängig machen
    setTab('model');await wait(50);
    { const name=project.parts[3].name;
      $('partList').querySelector('[data-del-part="3"]').click();await wait(80);
      ok(project.parts.length===3&&!project.parts.some(p=>p.name===name)&&$('partList').querySelectorAll('[data-part]').length===new Set(project.parts.map((p,i)=>p.copyGroup||'#'+i)).size&&/entfernt/.test($('toast').textContent),'✕ entfernt „'+name+'“');
      $('toast').querySelector('button').click();await wait(80);
      ok(project.parts.length===4&&project.parts[3].name===name&&project.parts.every((p,i)=>p.id===i),'Rückgängig stellt das Teil wieder her'); }
    // Slot für alle Teile
    setTab('settings');await wait(50);
    ok(!$('partScope').classList.contains('hidden')&&!$('partSlotAll').classList.contains('hidden'),'Slot-Auswahl mit „Für alle Teile übernehmen“');
    sel('partSlot','2');$('partSlotAll').click();await wait(100);
    ok(project.parts.every(p=>p.slot===2),'Slot 3 für alle Teile übernommen');
    setTab('slice');await wait(100);
    const li=document.querySelector('#slotPanelList [data-slot-pick="1"]');ok(!!li,'Filament-Slots anklickbar');
    // Werte je Auftrag: nur kritische Bereiche
    setTab('settings');$('ovOpen').click();await wait(50);
    const crit=$('ovRows').querySelector('[data-ov="critical"]');ok($('ovDlg').open&&!!crit,'„Nur kritische Bereiche“ in Werte anpassen');
    crit.value='off';crit.dispatchEvent(new Event('input',{bubbles:true}));$('ovSave').click();await wait(80);
    ok(lastResult.supCritical===false&&(project.parts[project.selected].overrides||{}).critical==='off','nur kritische Bereiche je Auftrag aus');
    // Spulen-Dialog (braucht den Server; ohne Server nur der Hinweis)
    ACTIONS.spools();await wait(400);ok($('spoolDlg').open&&$('spoolBody').textContent.length>20,'Dialog Spulen & Restmengen');$('spoolDlg').close();
    // Darstellung: dunkel/hell (Sprache nicht umschalten – das lädt die Seite neu)
    const th=document.documentElement.dataset.theme;document.querySelector('[data-theme-set="dark"]').click();await wait(30);
    ok(document.documentElement.dataset.theme==='dark','Dunkelmodus schaltet um');
    document.querySelector('[data-theme-set="auto"]').click();await wait(30);ok(!!document.documentElement.dataset.theme,'zurück auf automatisch ('+th+')');
    ok(typeof t==='function'&&I18N.dict['Datei']==='File','englisches Wörterbuch geladen');
  }

  /* 14) Modell entfernen */
  menuClick('clear');ok(!$('modelCard').classList.contains('loaded')&&$('export3mf').disabled,'Modell entfernen setzt alles zurück');

  HTMLAnchorElement.prototype.click=origClick;URL.revokeObjectURL=origRevoke;
  ok(errors.length===0,'keine JavaScript-Fehler ('+errors.join(' | ')+')');
  if(!opts.hosts){store.settings.printerHosts=savedHosts;persist()}
  return {ok:log.length,fail,log};
}
