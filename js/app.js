'use strict';
/* Start: Datei laden, Viewer-Bedienung, Panel ein-/ausblenden. */

/* ================= FILE LOADING (aus v4) ================= */
const drop=$('drop'), input=$('file'), stage=$('stage');
function stop(e){e.preventDefault();e.stopPropagation()}
['dragenter','dragover','dragleave','drop'].forEach(ev=>document.addEventListener(ev,stop));
[[drop,'hover'],[stage,'dragover']].forEach(([el,cls])=>{
  ['dragenter','dragover'].forEach(ev=>el.addEventListener(ev,e=>{stop(e);el.classList.add(cls)}));
  ['dragleave','drop'].forEach(ev=>el.addEventListener(ev,e=>{stop(e);el.classList.remove(cls)}));
  el.addEventListener('drop',e=>{const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f)loadFile(f)});
});
drop.addEventListener('click',()=>input.click());
drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}});
$('viewerEmpty').addEventListener('click',()=>input.click());
input.addEventListener('change',()=>{if(input.files[0])loadFile(input.files[0])});
$('clear').addEventListener('click',()=>{input.value='';geom=null;$('fileinfo').textContent='Noch keine Datei geladen.';clearModel();update()});

function loadFile(file){
  const ext=file.name.toLowerCase().split('.').pop();
  if(ext==='3mf'){$('fileinfo').innerHTML='<b>'+esc(file.name)+'</b><br>3MF-Dateien kann dieses Programm nicht auswerten. Bitte im Slicer als STL exportieren (Rechtsklick auf das Objekt → „Exportieren als eine STL…“).';return}
  if(ext!=='stl'){$('fileinfo').textContent='Bitte eine STL-Datei verwenden.';return}
  $('fileinfo').textContent='Lese '+file.name+' …';
  const r=new FileReader();
  r.onload=()=>{try{showModel(parseSTL(file.name,r.result))}catch(e){$('fileinfo').textContent='STL konnte nicht gelesen werden: '+e.message+'. Bitte die Datei erneut exportieren.'}};
  r.readAsArrayBuffer(file);
}

function showModel(g){
  geom=g;
  const n=g.n;
  $('fileinfo').innerHTML='<b>'+esc(g.name)+'</b><br>'+de(g.x,2)+' × '+de(g.y,2)+' × '+de(g.z,2)+' mm · '+n.toLocaleString('de-DE')+' Dreiecke';
  $('sx').textContent=de(g.x,1)+' mm';$('sy').textContent=de(g.y,1)+' mm';$('sz').textContent=de(g.z,1)+' mm';$('sv').textContent=de(g.vol/1000,1)+' cm³';
  $('info').textContent=g.name+'  —  '+de(g.x,1)+' × '+de(g.y,1)+' × '+de(g.z,1)+' mm  —  '+n.toLocaleString('de-DE')+' Dreiecke';
  $('ohBar').classList.remove('hidden');
  // Ohne Renderer bleibt der Hinweis „3D-Ansicht nicht verfügbar“ sichtbar (wie in v4).
  if(Viewer.show(g))$('viewerEmpty').classList.add('hidden');
  Viewer.colorize(+$('thresh').value);
  update();
}
function clearModel(){
  Viewer.clear();
  $('ohBar').classList.add('hidden');$('ohInfo').textContent='';$('info').textContent='';
  $('viewerEmpty').classList.remove('hidden');
}

$('thresh').addEventListener('input',()=>{$('threshVal').textContent=$('thresh').value+'°';Viewer.colorize(+$('thresh').value);update()});

/* ================= VIEWER-BEDIENUNG (aus 3dView) ================= */
function toggleButton(id,onChange){
  const b=$(id);
  b.addEventListener('click',()=>{const on=!b.classList.contains('active');b.classList.toggle('active',on);onChange(on)});
}
toggleButton('btnWireframe',on=>Viewer.setWireframe(on));
toggleButton('btnAxes',on=>Viewer.setAxes(on));
toggleButton('btnClip',on=>{Viewer.setClip(on);$('clipPanel').classList.toggle('hidden',!on)});
toggleButton('btnMeasure',on=>Viewer.setMeasure(on,text=>{$('measureLabel').textContent=text}));
['x','y','z'].forEach(axis=>{
  const b=$('clipAxis'+axis.toUpperCase());
  b.addEventListener('click',()=>{
    ['X','Y','Z'].forEach(k=>$('clipAxis'+k).classList.toggle('active',k===axis.toUpperCase()));
    $('clipSlider').value=0;Viewer.setClipAxis(axis);
  });
});
$('clipSlider').addEventListener('input',()=>Viewer.setClipFraction(Number($('clipSlider').value)/100));

/* Panel ein-/ausblenden */
const PANEL_KEY='druckKonfigurator.panelCollapsed';
function setPanel(collapsed){
  $('app').classList.toggle('panel-collapsed',collapsed);
  $('panelToggle').setAttribute('aria-expanded',String(!collapsed));
  try{localStorage.setItem(PANEL_KEY,collapsed?'1':'0')}catch(e){/* nur Komfort */}
}
$('panelToggle').addEventListener('click',()=>setPanel(!$('app').classList.contains('panel-collapsed')));
try{if(localStorage.getItem(PANEL_KEY)==='1')setPanel(true)}catch(e){/* nur Komfort */}

/* ================= START (aus v4) ================= */
if(Viewer.available()){
  try{Viewer.init(stage)}catch(e){$('viewerEmpty').textContent='3D-Ansicht konnte nicht gestartet werden. Die Analyse funktioniert trotzdem.'}
}else $('viewerEmpty').textContent='3D-Ansicht nicht verfügbar (three.js fehlt im Ordner vendor/). Die Analyse und alle Empfehlungen funktionieren trotzdem.';
loadStore();
if(store.last.printer&&PRINTERS[store.last.printer])$('printer').value=store.last.printer;
fillNozzleMaterialSelect();
fillMaterialSelect(store.last.material||'pla_hs');
if(store.last.nozD&&NOZ[nkey(store.last.nozD)])$('nozD').value=store.last.nozD;
if(store.last.nozM&&NOZZLE_MATERIALS[store.last.nozM]&&currentPrinter().nozzleOptions.includes(store.last.nozM))$('nozM').value=store.last.nozM;
if(!storageOK)persist();
update();
