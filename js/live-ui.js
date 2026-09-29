'use strict';
/* Live-Ansicht im Tab ④ Drucker: der geslicte G-Code des laufenden Drucks in 3D, bis zur Schicht, die der Drucker
   meldet – fertige Schichten in Filamentfarbe, die aktuelle orange, die kommenden blass. Umschalter in der
   Kamera-Karte (Kamera | 3D-Fortschritt). Die Vorschau hebt der Server beim Start auf (api/printing/preview,
   tools/serve.py remember_print) – deshalb nur für Drucke, die aus dem Tool gestartet wurden.
   Datenformat und Farben wie in ③ (js/preview-ui.js: parsePreview, hexToRgb01, toolColour).
   Druckkopf: geschätzt auf der aktuellen Schicht (fährt ihre Bahnen in der erwarteten Schichtzeit ab); mit dem Schalter
   „Echte Kopfposition“ fragt der Server die Position auch während des Drucks ab (api/anycubic/status?pos=1) –
   frische Werte (< 10 s) ersetzen dann die Schätzung. Am Kobra S1 (Firmware 2.7.2.7) geprüft am 2026-09-29;
   standardmäßig aus, weil es zusätzliche Abfragen an den Drucker sind. */

const lv = { name: null, data: null, missing: false, renderer: null, scene: null, camera: null, controls: null, mesh: null, grid: null,
  layerOf: null, shown: -2, raf: 0, mode: null, loading: false, pos: null, cx: 0, cy: 0, head: null, layerAt: -1, layerSince: 0 };
const LV_POS_FRESH_S = 10;
const livePosWanted = () => !!store.settings.livePos && lv.mode === 'live';
const LV_NOW = [0.95, 0.48, 0.2];
// Kommende Schichten: durchsichtig (Standard), ausgeblendet oder voll (wie früher, dunkelgrau)
const LV_GHOST = { ghost: 0.02, off: 0, full: 1 };
const lvGhostMode = () => (store.settings.liveGhost in LV_GHOST ? store.settings.liveGhost : 'ghost');

function lvInit() {
  if (lv.renderer || typeof THREE === 'undefined') return !!lv.renderer;
  lv.renderer = new THREE.WebGLRenderer({ antialias: true });
  lv.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  $('wbLiveStage').appendChild(lv.renderer.domElement);
  lv.scene = new THREE.Scene(); lv.scene.background = new THREE.Color(0x14161a);
  lv.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000); lv.camera.up.set(0, 0, 1);
  lv.controls = new THREE.OrbitControls(lv.camera, lv.renderer.domElement);
  lv.controls.addEventListener('change', lvRender);
  new ResizeObserver(lvResize).observe($('wbLiveStage'));
  return true;
}
function lvResize() {
  if (!lv.renderer) return;
  const el = $('wbLiveStage'), w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  lv.renderer.setSize(w, h, false); lv.camera.aspect = w / h; lv.camera.updateProjectionMatrix(); lvRender();
}
function lvRender() {
  if (lv.raf || !lv.renderer) return;
  lv.raf = requestAnimationFrame(() => { lv.raf = 0; if (lv.renderer) lv.renderer.render(lv.scene, lv.camera); });
}

function lvBuild() {
  const d = lv.data, n = d.count, [bx0, by0, , bx1, by1] = d.bbox, sx = (bx1 - bx0) / 65535, sy = (by1 - by0) / 65535;
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, pos = new Float32Array(n * 6);
  lv.cx = cx; lv.cy = cy; lv.pos = pos;
  lv.layerOf = new Uint32Array(n);
  d.layers.forEach(([z, start], li) => {
    const end = li + 1 < d.layers.length ? d.layers[li + 1][1] : n;
    for (let i = start; i < end; i++) {
      const o = i * 6, q = i * 4;
      pos[o] = bx0 + d.q[q] * sx - cx; pos[o + 1] = by0 + d.q[q + 1] * sy - cy; pos[o + 2] = z;
      pos[o + 3] = bx0 + d.q[q + 2] * sx - cx; pos[o + 4] = by0 + d.q[q + 3] * sy - cy; pos[o + 5] = z;
      lv.layerOf[i] = li;
    }
  });
  for (const k of ['mesh', 'ghost']) if (lv[k]) { lv.scene.remove(lv[k]); lv[k].geometry.dispose(); lv[k].material.dispose(); }
  // zwei Geometrien auf denselben Punkten: gedruckt + aktuelle Schicht (Farbe) und kommende Schichten (eigene Deckkraft);
  // die Bahnen liegen nach Schichten sortiert, deshalb reicht je ein Bereich (drawRange)
  const posAttr = new THREE.BufferAttribute(pos, 3), g = new THREE.BufferGeometry(), gg = new THREE.BufferGeometry();
  g.setAttribute('position', posAttr); gg.setAttribute('position', posAttr);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  lv.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
  lv.ghost = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.07, depthWrite: false }));
  lv.ghost.renderOrder = 1;
  lv.scene.add(lv.mesh, lv.ghost);
  if (lv.grid) { lv.scene.remove(lv.grid); lv.grid.geometry.dispose(); lv.grid.material.dispose(); }
  const size = Math.max(bx1 - bx0, by1 - by0, 20), span = Math.ceil(size * 1.4 / 10) * 10;
  lv.grid = new THREE.GridHelper(span, span / 10, 0x444444, 0x2c2c2c); lv.grid.rotation.x = Math.PI / 2; lv.scene.add(lv.grid);
  const top = d.bbox[5] || 1;
  lv.camera.position.set(size * 0.9, -size * 1.1, size * 0.8 + top);
  lv.controls.target.set(0, 0, top / 3); lv.controls.update();
  lv.shown = -2;
  lvHeadInit();
}

// Druckkopf: Düse (Kegel, Spitze = Position) und Heizblock darüber, halbdurchsichtig
function lvHeadInit() {
  if (lv.head) return;
  // etwa in Originalgröße (Kobra S1: Kopf ≈ 45 × 45 mm), damit er auf dem ganzen Bett auffällt
  const mat = new THREE.MeshBasicMaterial({ color: 0xe6e8ec, transparent: true, opacity: 0.18, depthWrite: false });
  const edge = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
  const tip = new THREE.Mesh(new THREE.ConeGeometry(3.5, 8, 20), new THREE.MeshBasicMaterial({ color: 0xf27a33 }));
  tip.rotation.x = -Math.PI / 2; tip.position.z = 4;
  const boxG = new THREE.BoxGeometry(44, 44, 30), block = new THREE.Mesh(boxG, mat); block.position.z = 8 + 15;
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(boxG), edge); lines.position.copy(block.position);
  lv.head = new THREE.Group(); lv.head.add(tip, block, lines); lv.head.visible = false;
  lv.scene.add(lv.head);
}
/* Wo steht der Kopf? Echte Position (frisch, Schalter an) oder Schätzung: Anteil der erwarteten Schichtzeit
   (Restzeit / restliche Schichten) → Bahn innerhalb der Schicht. Ergebnis {x, y, z, real} in Ansichtskoordinaten. */
function lvHeadAt(st, cur, L, T) {
  const p = st.position, age = st.position_age_s;
  if (store.settings.livePos && p && age != null && age < LV_POS_FRESH_S && Number.isFinite(+p.x))
    return { x: +p.x - lv.cx, y: +p.y - lv.cy, z: +p.z, real: true };
  if (!(L > 0)) return null;
  const d = lv.data, start = d.layers[cur][1], end = cur + 1 < d.layers.length ? d.layers[cur + 1][1] : d.count;
  if (end <= start) return null;
  if (cur !== lv.layerAt) { lv.layerAt = cur; lv.layerSince = Date.now(); }
  const rest = +(st.job && st.job.remaining_min) || 0, left = Math.max(1, (T || d.layers.length) - L + 1);
  const dur = rest > 0 ? rest * 60 / left : 60, frac = Math.min(1, (Date.now() - lv.layerSince) / 1000 / dur);
  const o = (start + Math.min(end - start - 1, Math.floor(frac * (end - start)))) * 6;
  return { x: lv.pos[o + 3], y: lv.pos[o + 4], z: lv.pos[o + 5], real: false };
}

// Bis Schicht cur (0-basiert): fertig = Filamentfarbe, aktuell = orange; danach die kommenden Schichten je nach Wahl
function lvColour(cur) {
  const d = lv.data, col = lv.mesh.geometry.attributes.color.array, cache = {};
  const end = cur + 1 < d.layers.length ? d.layers[cur + 1][1] : d.count;
  for (let i = 0; i < end; i++) {
    let c;
    if (lv.layerOf[i] < cur) { const k = d.a[2 * i + 1]; c = cache[k] || (cache[k] = hexToRgb01(toolColour(k))); }
    else c = LV_NOW;
    for (let v = 0; v < 2; v++) { const o = (i * 2 + v) * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; }
  }
  lv.mesh.geometry.attributes.color.needsUpdate = true;
  lv.mesh.geometry.setDrawRange(0, end * 2);
  lv.ghost.geometry.setDrawRange(end * 2, (d.count - end) * 2);
  lvGhostApply();
  lv.shown = cur;
}
function lvGhostApply() {
  if (!lv.ghost) return;
  const m = lvGhostMode(), mat = lv.ghost.material;
  lv.ghost.visible = m !== 'off';
  mat.opacity = LV_GHOST[m]; mat.transparent = m !== 'full'; mat.depthWrite = m === 'full';
  mat.color.setHex(m === 'full' ? 0x3b3d45 : 0x9aa0a8); mat.needsUpdate = true;
  lvRender();
}

async function lvLoad(name) {
  lv.name = name; lv.data = null; lv.missing = false; lv.loading = true;
  $('wbLiveNote').textContent = t('Lade 3D-Ansicht …'); $('wbLiveNote').classList.remove('hidden');
  try {
    const r = await fetch('api/printing/preview?name=' + encodeURIComponent(name));
    if (lv.name !== name) return;
    if (!r.ok) { lv.missing = true; return; }
    lv.data = parsePreview(await r.arrayBuffer());
    if (!lvInit()) { lv.missing = true; return; }
    lvResize(); lvBuild();
  } catch (e) { lv.missing = true; }
  finally { lv.loading = false; if (wb.st) liveUpdate(wb.st); }
}

// Aus der Werkbank bei jedem Stand (alle 3 s): passende Vorschau laden, Schicht nachführen
function liveUpdate(st) {
  const job = st && st.job, card = $('wbLiveStage');
  if (!card) return;
  if (!job || !job.name) {
    lv.name = null; lv.data = null; if (lv.head) lv.head.visible = false;
    $('wbLiveNote').textContent = t('Kein Druck aktiv.'); $('wbLiveNote').classList.remove('hidden');
    $('wbLiveInfo').textContent = '';
    return;
  }
  if (job.name !== lv.name && !lv.loading) { lvLoad(job.name); return; }
  if (lv.loading) return;
  if (lv.missing || !lv.data) {
    $('wbLiveNote').textContent = t('Für diesen Druck gibt es keine 3D-Ansicht – sie steht nur für Drucke bereit, die aus dem Tool gestartet wurden.');
    $('wbLiveNote').classList.remove('hidden'); $('wbLiveInfo').textContent = '';
    return;
  }
  $('wbLiveNote').classList.add('hidden');
  // Schicht des Druckers (1-basiert, eigene Zählung) auf die Schichten der Vorschau abbilden
  const n = lv.data.layers.length, L = +job.layer || 0, T = +job.layers || 0;
  const cur = T > 0 ? Math.min(n - 1, Math.max(0, Math.round(L / T * n) - 1)) : Math.min(n - 1, Math.max(0, L - 1));
  if (cur !== lv.shown) lvColour(cur);
  const z = lv.data.layers[cur] ? lv.data.layers[cur][0] : 0, head = lv.head && lvHeadAt(st, cur, L, T);
  if (lv.head) { lv.head.visible = !!head; if (head) lv.head.position.set(head.x, head.y, head.z); lvRender(); }
  $('wbLiveInfo').textContent = t('Schicht {l} von {n} · Z {z} mm', { l: L || cur + 1, n: T || n, z: de(z, 2) }) +
    (head ? ' · ' + (head.real ? t('Kopf: echte Position') : t('Kopf: geschätzt')) : '');
}

// Umschalter Kamera | 3D-Fortschritt (Wahl bleibt gespeichert)
function liveMode(mode) {
  lv.mode = mode;
  store.settings.wbView = mode; persist();
  const live = mode === 'live';
  $('wbLiveStage').classList.toggle('hidden', !live);
  document.querySelector('.wb-video').classList.toggle('hidden', live);
  document.querySelectorAll('[data-wb-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.wbView === mode)));
  if (live) { if (lv.renderer) setTimeout(lvResize); if (wb.st) liveUpdate(wb.st); }
}
document.querySelectorAll('[data-wb-view]').forEach(b => b.addEventListener('click', () => liveMode(b.dataset.wbView)));
$('wbLiveGhost').value = lvGhostMode();
$('wbLiveGhost').addEventListener('change', e => { store.settings.liveGhost = e.currentTarget.value; persist(); lvGhostApply(); });
$('wbLivePos').checked = !!store.settings.livePos;
$('wbLivePos').addEventListener('change', e => {
  store.settings.livePos = e.currentTarget.checked; persist();
  if (e.currentTarget.checked) toast(t('Kopfposition wird auch während des Drucks abgefragt (alle 5 s)'));
});
liveMode(store.settings.wbView === 'cam' ? 'cam' : 'live');
