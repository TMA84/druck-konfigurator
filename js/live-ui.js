'use strict';
/* Live-Ansicht im Tab ④ Drucker: der geslicte G-Code des laufenden Drucks in 3D, bis zur Schicht, die der Drucker
   meldet – fertige Schichten in Filamentfarbe, die aktuelle orange, die kommenden blass. Umschalter in der
   Kamera-Karte (Kamera | 3D-Fortschritt). Die Vorschau hebt der Server beim Start auf (api/printing/preview,
   tools/serve.py remember_print) – deshalb nur für Drucke, die aus dem Tool gestartet wurden.
   Datenformat und Farben wie in ③ (js/preview-ui.js: parsePreview, hexToRgb01, toolColour). */

const lv = { name: null, data: null, missing: false, renderer: null, scene: null, camera: null, controls: null, mesh: null, grid: null,
  layerOf: null, shown: -2, raf: 0, mode: null, loading: false };
const LV_DONE_DIM = [0.23, 0.24, 0.27], LV_NOW = [0.95, 0.48, 0.2];

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
  if (lv.mesh) { lv.scene.remove(lv.mesh); lv.mesh.geometry.dispose(); lv.mesh.material.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  lv.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
  lv.scene.add(lv.mesh);
  if (lv.grid) { lv.scene.remove(lv.grid); lv.grid.geometry.dispose(); lv.grid.material.dispose(); }
  const size = Math.max(bx1 - bx0, by1 - by0, 20), span = Math.ceil(size * 1.4 / 10) * 10;
  lv.grid = new THREE.GridHelper(span, span / 10, 0x444444, 0x2c2c2c); lv.grid.rotation.x = Math.PI / 2; lv.scene.add(lv.grid);
  const top = d.bbox[5] || 1;
  lv.camera.position.set(size * 0.9, -size * 1.1, size * 0.8 + top);
  lv.controls.target.set(0, 0, top / 3); lv.controls.update();
  lv.shown = -2;
}

// Farben bis Schicht cur (0-basiert): fertig = Filamentfarbe, aktuell = orange, später = blass
function lvColour(cur) {
  const d = lv.data, col = lv.mesh.geometry.attributes.color.array, cache = {};
  for (let i = 0; i < d.count; i++) {
    const li = lv.layerOf[i];
    let c;
    if (li < cur) { const k = d.a[2 * i + 1]; c = cache[k] || (cache[k] = hexToRgb01(toolColour(k))); }
    else c = li === cur ? LV_NOW : LV_DONE_DIM;
    for (let v = 0; v < 2; v++) { const o = (i * 2 + v) * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; }
  }
  lv.mesh.geometry.attributes.color.needsUpdate = true;
  lv.shown = cur; lvRender();
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
    lv.name = null; lv.data = null;
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
  const z = lv.data.layers[cur] ? lv.data.layers[cur][0] : 0;
  $('wbLiveInfo').textContent = t('Schicht {l} von {n} · Z {z} mm', { l: L || cur + 1, n: T || n, z: de(z, 2) });
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
liveMode(store.settings.wbView === 'cam' ? 'cam' : 'live');
