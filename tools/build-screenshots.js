'use strict';
/* Bilder für README/Handbuch neu erzeugen (docs/img/*.png) – Chrome ohne Fenster über tools/headless.js,
   eigenes leeres Profil, Deutsch, helle Darstellung. Der Server muss laufen (für Slicen: mit OrcaSlicer).
   Aufruf: node tools/build-screenshots.js [name …]   (ohne Namen: alle)
   Drucker-Daten sind nachgestellt (keine echte Verbindung, keine IP-Adressen im Bild). */
const fs = require('fs'), path = require('path');
const { open } = require('./headless');
const OUT = path.join(__dirname, '..', 'docs', 'img');
const BASE = 'http://127.0.0.1:' + (process.env.KONFIGURATOR_PORT || 8765) + '/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// gemeinsame Vorbereitung in der Seite: Modelle als STL erzeugen (Quader und ein Pilz mit Überhang)
const PREP = `
  window.__box=(x0,y0,z0,x1,y1,z1)=>{const v=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].map(t=>t.map(i=>v[i]))};
  window.__stl=(name,tris)=>{const b=new ArrayBuffer(84+50*tris.length),d=new DataView(b);d.setUint32(80,tris.length,true);tris.forEach((t,i)=>{const o=84+50*i;t.forEach((p,j)=>p.forEach((c,k)=>d.setFloat32(o+12+j*12+k*4,c,true)))});return new File([b],name)};
  window.__pilz=()=>__stl('pilz.stl',[...__box(15,15,0,25,25,20),...__box(0,0,20,40,40,25)]);
  if ($('disclaimerDlg').open) $('disclaimerDlg').close();
  store.settings.costAuto = false;
  // nachgestellter Drucker (ACE-Belegung, laufender Druck) – ohne echte Verbindung
  window.__fakeSlots = [{type:'PLA',colour:'#2E7D32',present:true,name:'PLA'},{type:'PLA',colour:'#F2F2F2',present:true,name:'PLA'},{type:'PLA',colour:'#1565C0',present:true,name:'PLA'},{type:'PETG',colour:'#212121',present:true,name:'PETG'}];
  // Belegung wie „von Hand eingetragen“, damit Slots und Farben ohne Drucker stimmen
  store.settings.manualSlots = { kobra_s1: __fakeSlots.map(s => ({ type: s.type, colour: s.colour, override: false })) };
  if (typeof update === 'function' && lastResult) update();
`;
const SHOTS = {
  // Bemalen (Werkzeugleiste → Pinsel): Strich mit Slot 3 auf der Oberseite des Pilzes, Feld links
  bemalen: `await loadFiles([__pilz()]); setTab('3d'); await new Promise(r=>setTimeout(r,500));
    paintMode(true); PT.slot=2; PT.radius=4; ptRender();
    const g=project.parts[0].geom,P=g.pos; let top=-1; for(let t=0;t<g.n;t++){if([2,5,8].every(k=>Math.abs(P[t*9+k]-g.mx[2])<1e-4)){top=t;break}}
    const cx=(g.mn[0]+g.mx[0])/2,cy=(g.mn[1]+g.mx[1])/2;
    ptStroke('start',{tri:top,point:[cx-12,cy-6,g.mx[2]],normal:[0,0,1],dir:[0,0,-1]},{});
    for(let k=1;k<=12;k++)ptStroke('move',{tri:top,point:[cx-12+k*2,cy-6+Math.sin(k/2)*6,g.mx[2]],normal:[0,0,1],dir:[0,0,-1]},{});
    ptStroke('end',null,{}); await new Promise(r=>setTimeout(r,800));`,
  // Filamente der Hersteller (② Druckwerte): SUNLU PLA+ 2.0 mit Farben
  filamente: `await loadFiles([__pilz()]); setTab('settings'); $('material').value='sl_pla_plus2'; $('material').dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,800));`,
  uebersicht: `await loadFiles([__pilz()]); setTab('settings'); await new Promise(r=>setTimeout(r,800));`,
  modell: `await loadFiles([__pilz(), __stl('deckel.stl',__box(0,0,0,50,30,4)), __stl('halter.stl',__box(0,0,0,60,40,25))]); setTab('3d');
           selectPart(1); setCopies(project.parts[1], 2); await new Promise(r=>setTimeout(r,800));`,
  ansicht3d: `await loadFiles([__pilz()]); setTab('3d'); document.getElementById('btnMeasure').click(); await new Promise(r=>setTimeout(r,800));`,
  export: `await loadFiles([__pilz(), __stl('deckel.stl',__box(0,0,0,50,30,4))]); setTab('slice'); openExportDialog(); await new Promise(r=>setTimeout(r,1000));`,
  menue: `await loadFiles([__pilz()]); setTab('settings'); document.querySelectorAll('.menu-btn')[1].click(); await new Promise(r=>setTimeout(r,400));`,
  slicen: `await loadFiles([__pilz(), __stl('deckel.stl',__box(0,0,0,50,30,4)), __stl('platte.stl',__box(0,0,0,200,180,3))]);
           setTab('slice'); await runCosts(); await new Promise(r=>setTimeout(r,2500)); refreshSlicePreview(true); await new Promise(r=>setTimeout(r,2500));`,
  drucker: `await loadFiles([__pilz()]); setTab('slice'); await runCosts(); setTab('printer');
           $('wbNoLink').classList.add('hidden'); $('wbGrid').classList.remove('hidden');
           const st = {model:'Anycubic Kobra S1', firmware:'2.7.2.7', ip:'', state:'busy', printing:true, connected:true,
             job:{name:'pilz_Platte1', status:'druckt', progress:62, layer:78, layers:126, remaining_min:14, elapsed_min:22, paused:false, filament_mm:2100},
             temps:{curr_nozzle_temp:220, target_nozzle_temp:220, curr_hotbed_temp:60, target_hotbed_temp:60}, fans:{fan_speed_pct:100, aux_fan_speed_pct:0, box_fan_level:0},
             lights:[{type:2,status:1,brightness:80}], position:null, camera:true, has_ace:1,
             ace:[{id:0, loaded_slot:0, temp:28, drying:{status:0}, auto_feed:0, slots:__fakeSlots.map((s,i)=>({index:i,type:s.type,colour:s.colour,present:true,loaded:i===0,rfid:true,sku:''}))},
                  {id:1, loaded_slot:-1, temp:41, drying:{status:1, target_temp:45, duration:240, remain_time:150}, auto_feed:0, slots:['ASA','PETG','PLA',''].map((ty,i)=>({index:i,type:ty,colour:['#B71C1C','#F9A825','#6A1B9A',''][i],present:!!ty,loaded:false,rfid:false,sku:''}))}]};
           // Vorschau des geslicten Auftrags als „laufenden Druck“ zeigen
           window.fetch = (orig => (u, o) => String(u).startsWith('api/printing/preview') ? orig('api/slice/' + costState.slice.job + '/plate_1.preview') : orig(u, o))(window.fetch);
           spoolData = {host:'', flush:1.5, low_g:100, history:[], track:{}, spools:__fakeSlots.map((s,i)=>({id:'s'+i, slot:i, type:s.type, colour:s.colour, sku:'', rfid:true, name:'', brand:'Anycubic', net_g:1000, used_g:[180,620,90,860][i], purge_g:0, adjust_g:0, remaining_g:[820,380,910,140][i]}))};
           wb.st = st; wb.err = ''; clearTimeout(wb.timer); wbRender(); liveMode('live'); liveUpdate(st);
           for (let i = 0; i < 100 && !(lv.data && lv.pos); i++) { await new Promise(r=>setTimeout(r,100)); liveUpdate(st); }
           // echte Kopfposition: 60 % der Schicht, die zur gemeldeten Schicht passt
           const li = Math.round(78 / 126 * lv.data.layers.length) - 1, tr = lvTrack(li), hp = lvPointAt(tr, tr.len * 0.6);
           st.position = {x: hp.x + lv.cx, y: hp.y + lv.cy, z: hp.z}; st.position_age_s = 1;
           liveUpdate(st); wbRender(); await new Promise(r=>setTimeout(r,1500));`,
  beschriftung: `await loadFiles([__stl('schild.stl',__box(0,0,0,80,40,6))]); setTab('3d'); await new Promise(r=>setTimeout(r,500));
           $('txText').value='Werkstatt'; $('txText').dispatchEvent(new Event('input',{bubbles:true}));
           if ($('txSlot')) { $('txSlot').value='1'; $('txSlot').dispatchEvent(new Event('change',{bubbles:true})); }
           await new Promise(r=>setTimeout(r,300)); $('txAdd').disabled=false; $('txAdd').click(); await new Promise(r=>setTimeout(r,800));`,
  historie: `await loadFiles([__pilz()]);
           const now = Date.now() / 1000, day = 86400, types = ['PLA','PLA','PETG','PLA','ASA'], hist = [];
           for (let k = 0; k < 60; k++) { const end = now - k * 5.5 * day - (k % 3) * 3600, g = 20 + ((k * 37) % 140), ty = types[k % 5];
             hist.push({ job: ['halter','deckel','haken','schild','kasten'][k % 5] + '_Platte' + (1 + k % 2) + '.gcode', start: end - g * 90, end, duration_s: g * 90,
               used: { s0: g }, grams_total: g, types: { [ty]: g }, cost_eur: g / 1000 * 25, changes: k % 4,
               estimate: k % 2 ? null : { total_g: g * (0.94 + (k % 5) * 0.03), time_s: g * 88, cost_eur: g / 1000 * 25 * (0.95 + (k % 4) * 0.03) } }); }
           const data = { format:'druck-konfigurator-spools', version:1, spools:[], history: hist.reverse(), price_default:25 };
           window.fetch = (orig => (u, o) => String(u).startsWith('api/spools/export') ? Promise.resolve(new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json'}})) : orig(u, o))(window.fetch);
           openHistoryDialog(); await new Promise(r=>setTimeout(r,1200));`,
  spulen: `await loadFiles([__pilz()]); clearTimeout(spoolTimer);
           spoolData = {host:'', flush:1.5, low_g:100, track:{}, history:[{job:'halter_Platte1.gcode', end:Date.now()/1000-3600, used:{s0:42.5, s3:3.1}, changes:3}],
             spools:__fakeSlots.map((s,i)=>({id:'s'+i, slot:i, type:s.type, colour:s.colour, sku:['AHPLCG-107','AHPLBW-107','AHPLBL-107','HPETBK-103'][i], rfid:true, name:'', brand:'Anycubic', net_g:1000, used_g:[180,620,90,860][i], purge_g:[4,6,2,9][i], adjust_g:0, remaining_g:[816,374,908,131][i], last_seen:Date.now()/1000, added:Date.now()/1000}))
               .concat([{id:'s9', slot:null, type:'ASA', colour:'#B71C1C', sku:'', rfid:false, name:'Rot matt', brand:'Sunlu', net_g:1000, used_g:420, purge_g:0, adjust_g:0, remaining_g:580, last_seen:Date.now()/1000-86400*3, added:Date.now()/1000-86400*30}])};
           $('spoolDlg').showModal(); renderSpoolDialog(); await new Promise(r=>setTimeout(r,500));`
};

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
  const b = await open();
  try {
    await b.go(BASE);
    await b.evaluate("localStorage.clear(); localStorage.setItem('druckKonfigurator.lang','de'); localStorage.setItem('druckKonfigurator.theme','light'); localStorage.setItem('druckKonfigurator.disclaimer','2'); true");
    for (const name of want) {
      await b.go(BASE);
      for (let i = 0; i < 100 && await b.evaluate("typeof loadFiles === 'function' && typeof liveUpdate === 'function' && typeof exportTemplate === 'function' && typeof renderSpoolDialog === 'function' && typeof restoreProject === 'function' && document.readyState === 'complete'") !== true; i++) await sleep(100);
      await b.evaluate('(async()=>{' + PREP + SHOTS[name] + '})()');
      await sleep(900);
      const png = await b.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(png.data, 'base64'));
      console.log('docs/img/' + name + '.png');
    }
  } finally { b.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 2; });
