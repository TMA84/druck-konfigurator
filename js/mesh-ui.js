'use strict';
/* Werkbank, Karte „Nivellierung“: Bettnetz des Druckers als 3D-Fläche (api/anycubic/mesh, tools/mesh.py).
   Nur mit Rinkhals (Moonraker auf dem Drucker) – Werksfirmware gibt das Netz nicht heraus, dann ein Hinweis statt Fehler.
   Abgefragt einmal je Drucker, sobald er verbunden ist (js/workbench-ui.js wbPoll → meshOnStatus), nach jedem Druckende
   (vor dem Druck vermisst der Drucker das Bett neu) und mit „Aktualisieren“ – kein Dauerabfragen.
   Klipper: probed_matrix[y][x], Zeile 0 = vorn (mesh_min Y). Positiv = Bett an dieser Stelle höher.
   Zeichnen nur bei Änderungen (wie js/miniview.js), Farben hell/dunkel wie js/live-scene.js. */

const mh = { host: null, data: null, err: null, kind: '', busy: false, printing: null, at: 0, seq: 0, nums: false,
  renderer: null, scene: null, camera: null, controls: null, group: null, lines: [], outline: null };
const MH_RETRY_MS = 60000;   // nach „nicht erreichbar“ höchstens einmal je Minute erneut (nicht bei „nur mit Rinkhals“)
// Blau – Weiß – Rot (niedrig → hoch), dieselben Stufen wie der Verlauf in css/app.css .wb-mesh-scale
const MH_STOPS = [[0x21, 0x66, 0xac], [0x67, 0xa9, 0xcf], [0xf7, 0xf7, 0xf7], [0xef, 0x8a, 0x62], [0xb2, 0x18, 0x2b]];
function meshColour(f) {
  const x = Math.min(1, Math.max(0, f)) * (MH_STOPS.length - 1), i = Math.min(MH_STOPS.length - 2, Math.floor(x)), k = x - i;
  return MH_STOPS[i].map((c, j) => (c + (MH_STOPS[i + 1][j] - c) * k) / 255);
}
const meshDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
const meshMm = v => de(v, 3) + ' mm';

// Kennzahlen aus den gemessenen Punkten (nicht aus dem interpolierten Netz)
function meshStats(m) {
  const all = m.flat(), lo = Math.min(...all), hi = Math.max(...all);
  return { lo, hi, span: hi - lo, mean: all.reduce((a, b) => a + b, 0) / all.length };
}
// Überhöhung: Spanne ≈ ¼ der Bettbreite, auf 1-2-5 abgerundet
function meshFactor(span, width) {
  if (!(span > 1e-6)) return 100;
  const raw = Math.min(1000, width * 0.25 / span), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return Math.max(1, (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p);
}

function meshOnStatus(st) {
  if (document.documentElement.classList.contains('embed-3d')) return;   // eingebettet nur 3D-Fortschritt
  const host = wbHost();
  if (!host || !st || st.connected === false) return;
  const printing = !!st.printing, ended = mh.printing === true && !printing;
  mh.printing = printing;
  if (mh.busy) return;
  const retry = mh.err && !['unsupported', 'empty'].includes(mh.kind) && Date.now() - mh.at > MH_RETRY_MS;
  if (mh.host !== host || ended || retry) meshLoad();
}

async function meshLoad() {
  const host = wbHost();
  if (!host) return;
  const seq = ++mh.seq;
  mh.host = host; mh.busy = true; mh.at = Date.now();
  $('wbMeshLoad').disabled = true;
  if (!mh.data) $('wbMeshNote').textContent = t('Lade …');
  try {
    const d = await lanApi('api/anycubic/mesh?host=' + encodeURIComponent(host));
    if (seq !== mh.seq) return;
    mh.data = d; mh.err = null; mh.kind = ''; mh.time = new Date().toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    if (seq !== mh.seq) return;
    mh.err = e.message; mh.kind = e.kind || '';
    if (mh.kind === 'unsupported' || mh.kind === 'empty') mh.data = null;   // sonst den letzten Stand weiter zeigen
  } finally {
    if (seq === mh.seq) { mh.busy = false; $('wbMeshLoad').disabled = false; mh.at = Date.now(); }
  }
  meshRender();
}
$('wbMeshLoad').addEventListener('click', meshLoad);
$('wbMeshNums').addEventListener('click', () => {
  mh.nums = !mh.nums; $('wbMeshNums').setAttribute('aria-pressed', String(mh.nums));
  $('wbMeshTable').classList.toggle('hidden', !mh.nums);
});

function meshRender() {
  const d = mh.data, note = $('wbMeshNote');
  $('wbMeshBody').classList.toggle('hidden', !d);
  $('wbMeshNums').classList.toggle('hidden', !d);
  if (!d) {
    $('wbMeshSum').textContent = '';
    note.textContent = mh.kind === 'unsupported' ? t('Nivellierungsdaten gibt es nur mit Rinkhals (Moonraker) – Werksfirmware gibt sie nicht heraus.')
      : mh.err ? t('Nicht abgefragt: {msg}', { msg: mh.err }) : t('Noch nicht abgefragt.');
    note.classList.remove('hidden');
    return;
  }
  note.textContent = mh.err ? t('Stand von {time} – jetzt nicht abgefragt: {msg}', { time: mh.time || '?', msg: mh.err }) : '';
  note.classList.toggle('hidden', !mh.err);
  const s = meshStats(d.probed), rows = d.probed.length, cols = d.probed[0].length;
  const fac = meshFactor(s.span, Math.max(d.max[0] - d.min[0], d.max[1] - d.min[1]));
  $('wbMeshSum').textContent = t('Spanne {span}', { span: meshMm(s.span) }) + ' · ' + t('{cols} × {rows} Punkte', { cols, rows })
    + (d.profile ? ' · ' + t('Profil „{name}“', { name: d.profile }) : '') + ' · ' + mh.time;
  $('wbMeshHi').textContent = meshMm(s.hi); $('wbMeshMid').textContent = meshMm((s.hi + s.lo) / 2); $('wbMeshLo').textContent = meshMm(s.lo);
  $('wbMeshStats').innerHTML = [[t('Max'), meshMm(s.hi)], [t('Min'), meshMm(s.lo)], [t('Spanne (Distanz)'), meshMm(s.span)], [t('Mittelwert'), meshMm(s.mean)],
    [t('Höhe überhöht'), '× ' + de(fac, 0)]].map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('');
  meshTable(d, s);
  meshScene(d, s, fac);
}

// Messpunkte als Tabelle von oben, vor dem Drucker stehend: vorn (Zeile 0, mesh_min Y) unten, hinten oben; gefärbt wie die Fläche
function meshTable(d, s) {
  const m = d.probed, rows = m.length, cols = m[0].length;
  const at = (lo, hi, i, n) => lo + (hi - lo) * i / (n - 1);
  let h = '<table><thead><tr><th>' + esc(t('Y \\ X (mm)')) + '</th>';
  for (let x = 0; x < cols; x++) h += '<th>' + esc(de(at(d.min[0], d.max[0], x, cols), 0)) + '</th>';
  h += '</tr></thead><tbody>';
  for (let y = rows - 1; y >= 0; y--) {
    h += '<tr><th>' + esc(de(at(d.min[1], d.max[1], y, rows), 0)) + '</th>';
    for (let x = 0; x < cols; x++) {
      const v = m[y][x], c = meshColour(s.span > 0 ? (v - s.lo) / s.span : 0.5), lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      h += '<td style="background:rgb(' + c.map(q => Math.round(q * 255)).join(',') + ');color:' + (lum < 0.55 ? '#fff' : '#1b1f24') + '">' + esc(de(v, 3)) + '</td>';
    }
    h += '</tr>';
  }
  $('wbMeshTable').innerHTML = h + '</tbody><caption>' + esc(t('Blick von oben, vorne = unten')) + ' · ' + esc(t('Werte in mm; X links → rechts, Y vorne → hinten')) + '</caption></table>';
}

// ---------- 3D ----------
/* Beschriftung am Bettrand (Sprite, immer zur Kamera gedreht): weiße Schrift mit dunklem Rand – lesbar hell wie dunkel */
function meshLabel(text, x, y) {
  const cv = document.createElement('canvas'), c = cv.getContext('2d'), fs = 40, font = '600 ' + fs + 'px system-ui, sans-serif';
  c.font = font;
  cv.width = Math.ceil(c.measureText(text).width) + 16; cv.height = fs + 16;
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 7; c.strokeStyle = 'rgba(20,26,30,.9)'; c.strokeText(text, cv.width / 2, cv.height / 2);
  c.fillStyle = '#fff'; c.fillText(text, cv.width / 2, cv.height / 2);
  // feste Größe auf dem Bildschirm (sizeAttenuation aus): lesbar auch auf dem Telefon
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true, sizeAttenuation: false }));
  const h = 0.05; sp.scale.set(h * cv.width / cv.height, h, 1); sp.position.set(x, y, 0); sp.renderOrder = 2;
  return sp;
}
function meshDraw() { if (mh.renderer) mh.renderer.render(mh.scene, mh.camera); }
function meshInit() {
  if (mh.renderer) return true;
  if (typeof THREE === 'undefined' || !THREE.OrbitControls) return false;
  const stage = $('wbMeshStage');
  try { mh.renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch (e) { console.warn('Nivellierung: kein WebGL', e); return false; }
  mh.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.appendChild(mh.renderer.domElement);
  mh.scene = new THREE.Scene();
  mh.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a949a, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.35); sun.position.set(0.4, -1, 1.2); mh.scene.add(sun);
  mh.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000); mh.camera.up.set(0, 0, 1);
  mh.controls = new THREE.OrbitControls(mh.camera, mh.renderer.domElement);
  mh.controls.addEventListener('change', meshDraw);
  mh.controls.addEventListener('start', () => { mh.userView = true; });   // selbst gedreht/gezoomt: nicht mehr einpassen
  new ResizeObserver(meshResize).observe(stage);
  new MutationObserver(meshTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  meshTheme();
  return true;
}
function meshResize() {
  if (!mh.renderer) return;
  const el = $('wbMeshStage'), w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  mh.renderer.setSize(w, h, false); mh.camera.aspect = w / h; mh.camera.updateProjectionMatrix();
  meshFit();
  meshDraw();
}
function meshTheme() {
  if (!mh.scene) return;
  const dark = meshDark();
  mh.scene.background = new THREE.Color(dark ? 0x2a343a : 0xe9eff1);
  for (const l of mh.lines) l.material.color.setHex(dark ? 0x10161a : 0x26343b);
  if (mh.outline) mh.outline.material.color.setHex(dark ? 0xd0d6da : 0x3a454b);
  meshDraw();
}
function meshDispose() {
  if (!mh.group) return;
  mh.scene.remove(mh.group);
  mh.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  mh.group = null; mh.lines = []; mh.outline = null;
}
/* Fläche aus mesh_matrix (interpoliert, wenn feiner als die Messung), sonst probed_matrix. Bett: 0 … mesh_max + mesh_min
   (Rand wie vorn/links auch hinten/rechts), Mitte im Ursprung; z = Abweichung × Überhöhung. */
function meshScene(d, s, fac) {
  if (!meshInit()) { if (!mh.nums) $('wbMeshNums').click(); $('wbMeshStage').classList.add('hidden'); return; }
  meshDispose();
  const m = d.mesh.length * d.mesh[0].length > d.probed.length * d.probed[0].length ? d.mesh : d.probed;
  const rows = m.length, cols = m[0].length, bx = d.max[0] + d.min[0], by = d.max[1] + d.min[1], cx = bx / 2, cy = by / 2;
  const px = i => d.min[0] + (d.max[0] - d.min[0]) * i / (cols - 1) - cx, py = j => d.min[1] + (d.max[1] - d.min[1]) * j / (rows - 1) - cy;
  const g = mh.group = new THREE.Group();
  const pos = new Float32Array(rows * cols * 3), col = new Float32Array(rows * cols * 3), idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = (j * cols + i) * 3, v = m[j][i], c = meshColour(s.span > 0 ? (v - s.lo) / s.span : 0.5);
    pos[k] = px(i); pos[k + 1] = py(j); pos[k + 2] = v * fac;
    col[k] = c[0]; col[k + 1] = c[1]; col[k + 2] = c[2];
    if (i < cols - 1 && j < rows - 1) { const a = j * cols + i, b = a + 1, e = a + cols, f = e + 1; idx.push(a, b, f, a, f, e); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
  // Gitterlinien über der Fläche: je Zeile und Spalte eine Linie
  const lineMat = () => new THREE.LineBasicMaterial({ color: 0x26343b, transparent: true, opacity: 0.55 });
  const line = pts => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat()); mh.lines.push(l); g.add(l); };
  for (let j = 0; j < rows; j++) line(Array.from({ length: cols }, (_, i) => new THREE.Vector3(px(i), py(j), m[j][i] * fac)));
  for (let i = 0; i < cols; i++) line(Array.from({ length: rows }, (_, j) => new THREE.Vector3(px(i), py(j), m[j][i] * fac)));
  // Nullebene (durchsichtig) und Umriss des Betts
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(bx, by), new THREE.MeshBasicMaterial({ color: 0x8a949a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  g.add(plane);
  mh.outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * cx, b * cy, 0))),
    new THREE.LineBasicMaterial({ color: 0x3a454b }));
  g.add(mh.outline);
  // Ausrichtung wie Klipper/Orca: X links → rechts, Y vorn → hinten, Ursprung vorn links (Zeile 0 = vorderer Rand)
  const off = 16;
  for (const [txt, x, y] of [[t('vorne'), 0, -cy - off], [t('hinten'), 0, cy + off], [t('links'), -cx - off * 1.6, 0], [t('rechts'), cx + off * 1.7, 0],
    ['X →', cx * 0.55, -cy - off], ['Y →', -cx - off * 1.6, cy * 0.55], ['0,0', -cx - off * 0.6, -cy - off * 0.6]]) g.add(meshLabel(txt, x, y));
  mh.scene.add(g);
  mh.fit = { x: cx + off * 2.4, y: cy + off * 1.5, lo: s.lo * fac, hi: s.hi * fac };
  meshTheme(); meshResize();
}
/* Kamera: von vorn, etwas erhöht (wie man vor dem Drucker steht), Bett samt Beschriftung passend zur Größe der Ansicht –
   bis man selbst dreht oder zoomt, danach bleibt die eigene Ansicht */
function meshFit() {
  if (!mh.fit || mh.userView) return;
  const f = mh.fit, z = (f.lo + f.hi) / 2, dir = new THREE.Vector3(0, -1.1, 0.6).normalize(), cam = mh.camera;
  const pts = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const pz of [Math.min(0, f.lo), Math.max(0, f.hi)]) pts.push(new THREE.Vector3(sx * f.x, sy * f.y, pz));
  const fits = d => {
    cam.position.copy(dir).multiplyScalar(d).add(new THREE.Vector3(0, 0, z)); cam.lookAt(0, 0, z);
    cam.near = d / 100; cam.far = d * 20; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    return pts.every(p => { const q = p.clone().project(cam); return Math.abs(q.x) < 0.94 && Math.abs(q.y) < 0.9 && Math.abs(q.z) < 1; });
  };
  // kleinster Abstand, bei dem Bett und Beschriftung ganz zu sehen sind (Halbierung)
  let lo = 10, hi = 20000;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
  fits(hi);
  mh.controls.target.set(0, 0, z); mh.controls.update();
}
