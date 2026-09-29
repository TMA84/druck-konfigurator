'use strict';
/* Live-Ansicht im Tab ④ Drucker: der geslicte G-Code des laufenden Drucks in 3D, bis zur Schicht, die der Drucker
   meldet – fertige Schichten in Filamentfarbe, die aktuelle orange, die kommenden blass. Umschalter in der
   Kamera-Karte (Kamera | 3D-Fortschritt). Die Vorschau hebt der Server beim Start auf (api/printing/preview,
   tools/serve.py remember_print) – deshalb nur für Drucke, die aus dem Tool gestartet wurden.
   Datenformat und Farben wie in ③ (js/preview-ui.js: parsePreview, hexToRgb01, toolColour).
   Druckkopf (Abschnitt „Druckkopf“ unten): mit „Echte Kopfposition“ (Standard an; der Server fragt die Position dann auch
   während des Drucks ab, api/anycubic/status?pos=1 – am Kobra S1 mit Firmware 2.7.2.7 geprüft am 2026-09-29) auf der
   gemeldeten Bahn, sonst geschätzt über die erwartete Schichtzeit. */

const lv = { name: null, data: null, missing: false, renderer: null, scene: null, camera: null, controls: null, mesh: null, grid: null,
  layerOf: null, shown: -2, shownDone: null, track: null, raf: 0, mode: null, loading: false, pos: null, cx: 0, cy: 0, head: null, layerAt: -1, layerSince: 0,
  hs: null, anim: 0 };   // hs: Zustand der Kopfbewegung (lvHeadSet/lvHeadTick)
const LV_POS_FRESH_S = 10;
const livePosWanted = () => store.settings.livePos !== false && lv.mode === 'live';
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
  lv.shown = -2; lv.shownDone = null; lv.track = null; lv.hs = null;
  lvHeadInit();
  lv.head.scale.setScalar(Math.max(0.3, Math.min(1, size / 150)));   // bei kleinen Teilen kleiner, sonst verdeckt er alles
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
/* ---------- Druckkopf ----------
   Der Kopf fährt die Bahnen der Schicht entlang (Weg s in mm ab Schichtbeginn, Fahrten zwischen Bahnen zählen nicht).
   - Echte Position (Schalter an, Meldung < 10 s alt): Schicht aus der gemeldeten Höhe, Stelle = nächste Bahn (≤ 8 mm);
     zwischen zwei Meldungen fährt er mit der gemessenen Geschwindigkeit weiter, Abweichungen gleichen sich weich aus.
     Weit weg von jeder Bahn (Fahrt, Parken, Reinigen): gleitet er gerade zur gemeldeten Stelle.
   - Geschätzt: Anteil der erwarteten Schichtzeit (Restzeit / restliche Schichten) → Weg in der Schicht.
   Ansichtskoordinaten: G-Code minus Mitte (lv.cx/cy). Die Schleife läuft nur, solange der Kopf sichtbar ist. */
const LV_SNAP_MM = 8, LV_BLEND_MS = 700;
const livePosOn = () => store.settings.livePos !== false;     // Standard: an (am Kobra S1 geprüft)

// Weg-Tabelle einer Schicht (zwischengespeichert): cum[k] = Weg bis zum Anfang von Bahn start+k
function lvTrack(li) {
  if (lv.track && lv.track.li === li) return lv.track;
  const d = lv.data, start = d.layers[li][1], end = li + 1 < d.layers.length ? d.layers[li + 1][1] : d.count, P = lv.pos;
  const cum = new Float64Array(end - start + 1);
  for (let i = start; i < end; i++) { const o = i * 6; cum[i - start + 1] = cum[i - start] + Math.hypot(P[o + 3] - P[o], P[o + 4] - P[o + 1]); }
  return (lv.track = { li, start, end, cum, len: cum[end - start] });
}
function lvPointAt(tr, s) {
  const c = tr.cum, n = tr.end - tr.start;
  if (!n) return null;
  s = Math.max(0, Math.min(tr.len, s));
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m] <= s) lo = m; else hi = m - 1; }
  const o = (tr.start + lo) * 6, seg = c[lo + 1] - c[lo], k = seg > 0 ? (s - c[lo]) / seg : 0, P = lv.pos;
  return { x: P[o] + (P[o + 3] - P[o]) * k, y: P[o + 1] + (P[o + 4] - P[o + 1]) * k, z: P[o + 5], seg: tr.start + lo };
}
// nächste Stelle auf einer Bahn der Schicht → {s, dist}
function lvSnap(tr, x, y) {
  const P = lv.pos; let best = Infinity, bs = 0;
  for (let i = tr.start; i < tr.end; i++) {
    const o = i * 6, ax = P[o], ay = P[o + 1], dx = P[o + 3] - ax, dy = P[o + 4] - ay, l2 = dx * dx + dy * dy;
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const qx = ax + dx * k - x, qy = ay + dy * k - y, d2 = qx * qx + qy * qy;
    if (d2 < best) { best = d2; bs = tr.cum[i - tr.start] + k * Math.sqrt(l2); }
  }
  return { s: bs, dist: Math.sqrt(best) };
}
// Schicht zur gemeldeten Höhe: die höchste Schicht, die nicht über der Düse liegt (Z-Hop hebt die Düse kurz an)
function lvLayerByZ(z) {
  const L = lv.data.layers; let lo = 0, hi = L.length - 1;
  if (z < L[0][0] - 0.05) return -1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m][0] <= z + 0.05) lo = m; else hi = m - 1; }
  return lo;
}

/* Neuer Stand vom Drucker → Zustand der Kopfbewegung (lv.hs). Rückgabe {real, snapped, li, frac} für Anzeige und Farben. */
function lvHeadSet(st, cur, L, T) {
  const p = st.position, age = st.position_age_s, now = performance.now(), h = lv.hs;
  const real = livePosOn() && p && age != null && age < LV_POS_FRESH_S && Number.isFinite(+p.x);
  if (real) {
    const x = +p.x - lv.cx, y = +p.y - lv.cy, z = +p.z, key = x + ',' + y + ',' + z, li = lvLayerByZ(z);
    if (h && h.real && h.key === key) return h.info;              // nichts Neues – weiterfahren wie bisher
    const shown = h ? lvHeadPos(h, now) : null;
    const tr = li >= 0 ? lvTrack(li) : null, sn = tr && tr.len > 0 ? lvSnap(tr, x, y) : null;
    let hs;
    if (sn && sn.dist <= LV_SNAP_MM) {
      // Geschwindigkeit aus zwei Meldungen auf derselben Schicht (geglättet); sonst die bisherige
      let v = h && h.v || 0;
      if (h && h.snapped && h.li === li && sn.s > h.s0) { const vm = (sn.s - h.s0) / Math.max(0.5, (now - h.t0) / 1000); v = v ? 0.5 * v + 0.5 * vm : vm; }
      const corr = h && h.snapped && h.li === li && shown ? Math.max(-30, Math.min(30, lvHeadS(h, now) - sn.s)) : 0;
      hs = { real: true, snapped: true, li, s0: sn.s, t0: now, v: Math.min(v, 400), corr, key };
      hs.info = { real: true, snapped: true, li, frac: tr.len ? sn.s / tr.len : 0, seg: lvPointAt(tr, sn.s).seg };
    } else {
      hs = { real: true, snapped: false, from: shown || { x, y, z }, to: { x, y, z }, t0: now, dur: h && h.real ? Math.min(6000, Math.max(800, now - h.t0)) : 1, key, v: h && h.v, li };
      hs.info = { real: true, snapped: false, li };
    }
    lv.hs = hs;
  } else {
    if (!(L > 0)) { lv.hs = null; if (lv.head) lv.head.visible = false; lvRender(); return null; }
    if (cur !== lv.layerAt) { lv.layerAt = cur; lv.layerSince = Date.now(); }
    const rest = +(st.job && st.job.remaining_min) || 0, left = Math.max(1, (T || lv.data.layers.length) - L + 1);
    lv.hs = { real: false, li: cur, dur: rest > 0 ? rest * 60 / left : 60, info: { real: false, li: cur } };
  }
  lv.head.visible = true;
  if (!lv.anim) lv.anim = requestAnimationFrame(lvHeadTick);
  return lv.hs.info;
}
// Weg in der Schicht jetzt (echt, auf der Bahn): letzte Meldung + Geschwindigkeit × Zeit, Abweichung blendet aus
function lvHeadS(h, now) {
  const dt = (now - h.t0) / 1000, k = Math.min(1, (now - h.t0) / LV_BLEND_MS), e = k * k * (3 - 2 * k);
  return h.s0 + h.v * Math.min(dt, 8) + h.corr * (1 - e);
}
function lvHeadPos(h, now) {
  if (!h.real) {
    const tr = lvTrack(h.li), frac = Math.min(1, (Date.now() - lv.layerSince) / 1000 / h.dur);
    return lvPointAt(tr, frac * tr.len);
  }
  if (h.snapped) return lvPointAt(lvTrack(h.li), lvHeadS(h, now));
  const k = Math.min(1, (now - h.t0) / h.dur), e = k * k * (3 - 2 * k);   // weich an- und auslaufen
  return { x: h.from.x + (h.to.x - h.from.x) * e, y: h.from.y + (h.to.y - h.from.y) * e, z: h.from.z + (h.to.z - h.from.z) * e };
}
function lvHeadTick(now) {
  lv.anim = 0;
  const h = lv.hs;
  if (!h || !lv.head || !lv.head.visible || lv.mode !== 'live' || document.hidden) return;
  const p = lvHeadPos(h, now);
  if (p) {
    lv.head.position.set(p.x, p.y, p.z);
    if (p.seg != null && h.li === lv.shown) lvColourTo(p.seg);   // abgefahrene Bahnen einfärben (die aktuelle erst danach)
    if (lv.renderer) lv.renderer.render(lv.scene, lv.camera);
  }
  if (h.snapped || !h.real || now - h.t0 < h.dur) lv.anim = requestAnimationFrame(lvHeadTick);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && lv.hs && !lv.anim) lv.anim = requestAnimationFrame(lvHeadTick); });

// Bis Schicht cur (0-basiert): fertig = Filamentfarbe, aktuell = orange; danach die kommenden Schichten je nach Wahl
// done: erste Bahn der aktuellen Schicht, die noch nicht gedruckt ist (echte Kopfposition) – davor schon in Filamentfarbe
function lvColour(cur, done) {
  const d = lv.data, col = lv.mesh.geometry.attributes.color.array, cache = {};
  const end = cur + 1 < d.layers.length ? d.layers[cur + 1][1] : d.count, split = done == null ? d.layers[cur][1] : done;
  for (let i = 0; i < end; i++) {
    let c;
    if (i < split) { const k = d.a[2 * i + 1]; c = cache[k] || (cache[k] = hexToRgb01(toolColour(k))); }
    else c = LV_NOW;
    for (let v = 0; v < 2; v++) { const o = (i * 2 + v) * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; }
  }
  const attr = lv.mesh.geometry.attributes.color;
  attr.updateRange.offset = 0; attr.updateRange.count = -1; attr.needsUpdate = true;
  lv.mesh.geometry.setDrawRange(0, end * 2);
  lv.ghost.geometry.setDrawRange(end * 2, (d.count - end) * 2);
  lvGhostApply();
  lv.shown = cur; lv.shownDone = done;
}
/* Während der Kopf fährt: Bahnen der aktuellen Schicht, die er schon abgefahren hat, in Filamentfarbe; läuft er zurück
   (Korrektur nach einer Meldung), wieder orange. Nur der geänderte Bereich wird neu übertragen. */
function lvColourTo(split) {
  const d = lv.data, cur = lv.shown, start = d.layers[cur][1], end = cur + 1 < d.layers.length ? d.layers[cur + 1][1] : d.count;
  split = Math.max(start, Math.min(end, split));
  const was = lv.shownDone == null ? start : lv.shownDone;
  if (split === was) return;
  const attr = lv.mesh.geometry.attributes.color, col = attr.array, cache = {};
  const [a, b] = split > was ? [was, split] : [split, was];
  for (let i = a; i < b; i++) {
    let c;
    if (i < split) { const k = d.a[2 * i + 1]; c = cache[k] || (cache[k] = hexToRgb01(toolColour(k))); } else c = LV_NOW;
    for (let v = 0; v < 2; v++) { const o = (i * 2 + v) * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; }
  }
  attr.updateRange.offset = a * 6; attr.updateRange.count = (b - a) * 6; attr.needsUpdate = true;
  lv.shownDone = split;
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
    lv.name = null; lv.data = null; lv.hs = null; if (lv.head) lv.head.visible = false;
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
  // Mit echter Kopfposition: Schicht aus der gemeldeten Höhe und wie weit sie ist (genauer als die Schichtzahl des Druckers)
  const head = lv.head ? lvHeadSet(st, cur, L, T) : null, onPath = head && head.snapped;
  const li = onPath ? head.li : cur;
  // neue Schicht: ganz orange; was der Kopf abfährt, färbt lvHeadTick nach und nach ein (ohne Kopf: bleibt orange)
  if (li !== lv.shown) lvColour(li, head ? lv.data.layers[li][1] : null);
  const z = lv.data.layers[li] ? lv.data.layers[li][0] : 0;
  $('wbLiveInfo').textContent = (onPath ? t('Schicht {l} von {n} ({p} %) · Z {z} mm', { l: li + 1, n, p: Math.round(head.frac * 100), z: de(z, 2) })
    : t('Schicht {l} von {n} · Z {z} mm', { l: L || cur + 1, n: T || n, z: de(z, 2) })) +
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
$('wbLivePos').checked = livePosOn();
$('wbLivePos').addEventListener('change', e => {
  store.settings.livePos = e.currentTarget.checked; persist();
  if (e.currentTarget.checked) toast(t('Kopfposition wird auch während des Drucks abgefragt (alle 5 s)'));
});
liveMode(store.settings.wbView === 'cam' ? 'cam' : 'live');
