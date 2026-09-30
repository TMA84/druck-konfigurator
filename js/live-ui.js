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
  hs: null, anim: 0, dirty: null, disp: null, lastTick: 0 };   // hs: Zustand der Kopfbewegung (lvHeadSet/lvHeadTick)
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
/* Geänderte Farben (Bahn-Bereich lo…hi) bis zum nächsten Zeichnen sammeln: three.js überträgt nur einen Bereich je Bild –
   setzt man ihn zweimal, bevor gezeichnet wird, geht der erste verloren (die Bahnen blieben schwarz). */
function lvColourDirty(lo, hi) {
  const d = lv.dirty = lv.dirty ? [Math.min(lv.dirty[0], lo), Math.max(lv.dirty[1], hi)] : [lo, hi];
  const attr = lv.mesh.geometry.attributes.color;
  attr.updateRange.offset = d[0] * 6; attr.updateRange.count = (d[1] - d[0]) * 6; attr.needsUpdate = true;
}
function lvDraw() {
  if (!lv.renderer) return;
  lv.renderer.render(lv.scene, lv.camera);
  lv.dirty = null;
}
function lvRender() {
  if (lv.raf || !lv.renderer) return;
  lv.raf = requestAnimationFrame(() => { lv.raf = 0; lvDraw(); });
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
  // Bett und Mechanik möglichst im Bild – bei kleinen Teilen höchstens 2,2 × Modellgröße, sonst wäre das Teil winzig
  const bed = lvBed(), frame = Math.max(size, Math.min(Math.max(bed.x1 - bed.x0, bed.y1 - bed.y0), size * 2.2));
  lv.camera.position.set(frame * 0.9, -frame * 1.1, frame * 0.8 + top);
  lv.controls.target.set(0, 0, top / 3); lv.controls.update();
  lv.shown = -2; lv.shownDone = null; lv.track = null; lv.hs = null; lv.dirty = null; lv.disp = null;
  lvHeadInit();
}

/* Drucker-Mechanik ungefähr wie beim Kobra S1 (CoreXY, das Bett fährt nach unten): Kopf ≈ 56 × 48 × 70 mm (geschätzt, keine
   offiziellen Maße), darüber die X-Traverse über die ganze Breite und links/rechts die Y-Schienen – beide auf Höhe des
   Kopfes, sie fahren mit der Düse mit. Dazu der Umriss des Druckbetts. Maße in mm, Koordinaten wie die Bahnen. */
const LV_HEAD = { w: 56, d: 48, h: 70, tip: 8 }, LV_GANTRY_Z = 52, LV_RAIL = 10;
function lvBed() {
  const tpl = typeof exportTemplate === 'function' ? exportTemplate(typeof WB_PRINTER !== 'undefined' ? WB_PRINTER : 'kobra_s1', '0.4') : null;
  const pts = tpl ? (tpl.settings.printable_area || []).map(p => p.split('x').map(Number)) : [];
  if (!pts.length) return { x0: 0, y0: 0, x1: 250, y1: 250 };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
function lvHeadInit() {
  for (const k of ['head', 'gantry', 'bed']) if (lv[k]) { lv.scene.remove(lv[k]); lv[k] = null; }
  const H = LV_HEAD, glass = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.16, depthWrite: false });
  const edges = (geo, op) => new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: op }));
  // Kopf: Düse (Spitze = Position) und Gehäuse darüber
  const tip = new THREE.Mesh(new THREE.ConeGeometry(3.5, H.tip, 20), new THREE.MeshBasicMaterial({ color: 0xf27a33 }));
  tip.rotation.x = -Math.PI / 2; tip.position.z = H.tip / 2;
  const boxG = new THREE.BoxGeometry(H.w, H.d, H.h), block = new THREE.Mesh(boxG, glass(0xe6e8ec)); block.position.z = H.tip + H.h / 2;
  const blockE = edges(boxG, 0.75); blockE.position.copy(block.position);
  lv.head = new THREE.Group(); lv.head.add(tip, block, blockE); lv.head.visible = false;
  // Mechanik: X-Traverse (fährt in Y und Z mit), Y-Schienen (fahren in Z mit)
  const bed = lvBed(), bx0 = bed.x0 - lv.cx, bx1 = bed.x1 - lv.cx, by0 = bed.y0 - lv.cy, by1 = bed.y1 - lv.cy, m = 22;
  const beamG = new THREE.BoxGeometry(bx1 - bx0 + 2 * m, LV_RAIL, LV_RAIL), beam = new THREE.Group();
  beam.add(new THREE.Mesh(beamG, glass(0xb8bec8)), edges(beamG, 0.35)); beam.position.x = (bx0 + bx1) / 2;
  const railG = new THREE.BoxGeometry(LV_RAIL, by1 - by0 + 2 * m, LV_RAIL), rails = [bx0 - m, bx1 + m].map(x => {
    const r = new THREE.Group(); r.add(new THREE.Mesh(railG, glass(0xb8bec8)), edges(railG, 0.3)); r.position.set(x, (by0 + by1) / 2, 0); return r; });
  lv.gantry = new THREE.Group(); lv.gantry.add(beam, ...rails); lv.gantry.userData.beam = beam; lv.gantry.visible = false;
  // Bett: Umriss auf Höhe 0
  const bedPts = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]].map(([x, y]) => new THREE.Vector3(x, y, 0));
  lv.bed = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(bedPts), new THREE.LineBasicMaterial({ color: 0x6b7280 }));
  lv.scene.add(lv.head, lv.gantry, lv.bed);
}
// Kopf und Mechanik an die Stelle p (Düsenspitze)
function lvPlaceHead(p) {
  lv.head.position.set(p.x, p.y, p.z);
  lv.gantry.visible = lv.head.visible;
  lv.gantry.position.z = p.z + LV_GANTRY_Z;
  lv.gantry.userData.beam.position.y = p.y;
}
// Sehr dunkle Filamentfarben (schwarz, anthrazit) für die Ansicht aufhellen – sonst verschwinden sie auf dem dunklen Grund
function lvVisible(rgb) {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], min = 0.28;
  if (l >= min) return rgb;
  const k = (min - l) / (1 - l);
  return rgb.map(c => c + (1 - c) * k);
}

/* ---------- Druckkopf ----------
   Der Kopf fährt die Bahnen der Schicht entlang, gemessen in Druckzeit t (s ab Schichtbeginn): je Bahn Länge durch
   Vorschub – aus dem G-Code (Vorschau GCPV3) oder, bei älteren Vorschauen, aus den Druckereinstellungen je Linienart
   (lvSpeeds) – plus Beschleunigen/Bremsen (Trapez mit der Druckbeschleunigung). Leerfahrten zählen mit der
   Fahrgeschwindigkeit und werden sichtbar abgefahren – kein Sprung zwischen Teilen.
   - Echte Position (Schalter an, Meldung < 10 s alt): Schicht aus der gemeldeten Höhe, Stelle = nächste Bahn (≤ 8 mm,
     zuerst in der Nähe der erwarteten Stelle); die Meldung ist position_age_s alt – so weit wird vorgerechnet. Zwischen
     zwei Meldungen läuft die Druckzeit mit dem gemessenen Verhältnis zur Uhr (rate, ≈ 1) weiter, Abweichungen gleichen
     sich über LV_BLEND_MS aus. Weit weg von jeder Bahn (Parken, Reinigen): gleitet er gerade zur gemeldeten Stelle.
   - Geschätzt: Anteil der erwarteten Schichtzeit (Restzeit / restliche Schichten) → Stelle in der Schicht.
   Zuletzt glättet ein Filter die gezeigte Stelle (Zeitkonstante LV_SMOOTH_S) – Restsprünge werden zu kurzem Gleiten.
   Ansichtskoordinaten: G-Code minus Mitte (lv.cx/cy). Die Schleife läuft nur, solange der Kopf sichtbar ist. */
const LV_SNAP_MM = 8, LV_BLEND_MS = 1500, LV_SMOOTH_S = 0.2, LV_MAX_CORR_S = 4, LV_NEAR_S = 6;
const livePosOn = () => store.settings.livePos !== false;     // Standard: an (am Kobra S1 geprüft)

/* Geschwindigkeiten (mm/s) und Beschleunigungen (mm/s²) je Linienart aus den Druckereinstellungen (Orca-Vorlage des
   Druckers) – Geschwindigkeit nur für Vorschauen ohne Vorschub je Bahn, Beschleunigung immer (steht nicht in der Vorschau).
   Prozent bei Geschwindigkeiten: von der Innenwand; bei Beschleunigungen: von der Standardbeschleunigung (Brücke: von der
   Außenwand, wie Orca). */
const LV_TYPE_SPEED = { 'Outer wall': 'outer_wall_speed', 'Inner wall': 'inner_wall_speed', 'Overhang wall': 'overhang_2_4_speed',
  'Sparse infill': 'sparse_infill_speed', 'Internal solid infill': 'internal_solid_infill_speed', 'Solid infill': 'internal_solid_infill_speed',
  'Top surface': 'top_surface_speed', 'Bottom surface': 'initial_layer_speed', 'Bridge': 'bridge_speed', 'Internal Bridge': 'bridge_speed',
  'Gap infill': 'gap_infill_speed', 'Support': 'support_speed', 'Support interface': 'support_interface_speed',
  'Support transition': 'support_speed', 'Prime tower': 'inner_wall_speed', 'Brim': 'skirt_speed', 'Skirt': 'skirt_speed',
  'Ironing': 'ironing_speed' };
const LV_TYPE_ACCEL = { 'Outer wall': 'outer_wall_acceleration', 'Inner wall': 'inner_wall_acceleration', 'Overhang wall': 'outer_wall_acceleration',
  'Sparse infill': 'sparse_infill_acceleration', 'Internal solid infill': 'internal_solid_infill_acceleration',
  'Solid infill': 'internal_solid_infill_acceleration', 'Top surface': 'top_surface_acceleration', 'Bridge': 'bridge_acceleration',
  'Internal Bridge': 'bridge_acceleration' };
function lvSpeeds() {
  if (lv.speeds) return lv.speeds;
  const tpl = typeof exportTemplate === 'function' ? exportTemplate(WB_PRINTER, '0.4') : null, st = (tpl && tpl.settings) || {};
  const raw = k => { const v = st[k]; return Array.isArray(v) ? v[0] : v; };
  const num = (k, def, base) => { const v = String(raw(k) ?? ''), f = parseFloat(v); return !(f > 0) ? def : /%$/.test(v) ? base * f / 100 : f; };
  const inner = num('inner_wall_speed', 150), acc = num('default_acceleration', 5000), outerAcc = num('outer_wall_acceleration', acc, acc);
  const types = {}, accels = {};
  for (const [ty, key] of Object.entries(LV_TYPE_SPEED)) types[ty] = num(key, inner, inner);
  for (const [ty, key] of Object.entries(LV_TYPE_ACCEL)) accels[ty] = num(key, acc, /Bridge/.test(ty) ? outerAcc : acc);
  const travelAcc = num('travel_acceleration', acc, acc);
  // Rückzug + Z-Hop je Leerfahrt (hin und zurück), nur ab der Mindeststrecke
  const retr = num('retraction_length', 0.8, 1), rs = num('retraction_speed', 40, 1), hop = num('z_hop', 0.4, 1), zs = num('machine_max_speed_z', 15, 1);
  return (lv.speeds = { types, accels, other: inner, accel: acc, first: num('initial_layer_speed', 50, inner),
    firstAccel: num('initial_layer_acceleration', 500, acc), travel: num('travel_speed', 300, inner), travelAcc,
    scv: num('machine_max_jerk_x', 5, 1), travelExtra: 2 * retr / rs + 2 * hop / zs, minTravel: num('retraction_minimum_travel', 1, 1) });
}
// Zeit für eine Strecke L mit Anfangs-/Endgeschwindigkeit v0/v1, Höchstgeschwindigkeit vm und Beschleunigung acc (Trapez)
function lvMoveTime(L, v0, v1, vm, acc) {
  if (!(L > 0)) return 0;
  const da = (vm * vm - v0 * v0) / (2 * acc), dd = (vm * vm - v1 * v1) / (2 * acc);
  if (da + dd <= L) return (vm - v0) / acc + (vm - v1) / acc + (L - da - dd) / vm;
  const vp = Math.sqrt(Math.max(v0 * v0, v1 * v1, (2 * acc * L + v0 * v0 + v1 * v1) / 2));
  return Math.max(0, (vp - v0) / acc) + Math.max(0, (vp - v1) / acc);
}
/* Zeit-Tabelle einer Schicht (zwischengespeichert): a[k]/b[k] = Druckzeit bei Anfang/Ende von Bahn start+k, dazwischen die
   Leerfahrt. Vereinfachter Bewegungsplaner wie Klipper: Kurvengeschwindigkeit aus dem Winkel (square_corner_velocity ≈
   Ruck-Einstellung), Vor- und Rückschau für die Rampen, Beschleunigung je Linienart. */
function lvTrack(li) {
  if (lv.track && lv.track.li === li) return lv.track;
  const d = lv.data, start = d.layers[li][1], end = li + 1 < d.layers.length ? d.layers[li + 1][1] : d.count, P = lv.pos, n = end - start;
  const sp = lvSpeeds(), unit = d.speed_unit || 2, first = li === 0, travel = d.travel > 0 ? d.travel : sp.travel;
  // Bewegungen: [Länge, Höchstgeschw., Beschl., dx, dy, Bahn k oder −1 = Fahrt]
  const M = [];
  for (let k = 0; k < n; k++) {
    const i = start + k, o = i * 6;
    if (k) { const q = o - 6, dx = P[o] - P[q + 3], dy = P[o + 1] - P[q + 4], L = Math.hypot(dx, dy);
      if (L > 1e-3) M.push([L, travel, first ? Math.min(sp.firstAccel * 2, sp.travelAcc) : sp.travelAcc, dx / L, dy / L, -1]); }
    const dx = P[o + 3] - P[o], dy = P[o + 4] - P[o + 1], L = Math.hypot(dx, dy), ty = d.types[d.a[2 * i]];
    const v = d.v && d.v[i] ? d.v[i] * unit : first ? sp.first : (sp.types[ty] || sp.other);
    M.push([L, v, first ? sp.firstAccel : (sp.accels[ty] || sp.accel), L ? dx / L : 1, L ? dy / L : 0, k]);
  }
  // Kurvengeschwindigkeit zwischen zwei Bewegungen (Klipper: junction deviation aus square_corner_velocity)
  const m = M.length, vj = new Float64Array(m + 1);   // vj[i] = Geschwindigkeit am Anfang von Bewegung i
  for (let i = 1; i < m; i++) {
    const A = M[i - 1], B = M[i], acc = Math.min(A[2], B[2]), jd = sp.scv * sp.scv * (Math.SQRT2 - 1) / acc;
    const cos = -(A[3] * B[3] + A[4] * B[4]);
    let v;
    if (cos > 0.999999) v = 0; else if (cos < -0.999999) v = Infinity;
    else { const sh = Math.sqrt(0.5 * (1 - cos)); v = Math.sqrt(acc * jd * sh / (1 - sh)); }
    // Rückzug/Z-Hop vor und nach einer längeren Fahrt: dort steht der Kopf kurz
    if ((A[5] < 0 && A[0] >= sp.minTravel) || (B[5] < 0 && B[0] >= sp.minTravel)) v = 0;
    vj[i] = Math.min(v, A[1], B[1]);
  }
  // Rückschau: rechtzeitig bremsen; Vorschau: nur so schnell, wie beschleunigt werden kann
  for (let i = m - 1; i >= 1; i--) vj[i] = Math.min(vj[i], Math.sqrt(vj[i + 1] * vj[i + 1] + 2 * M[i][2] * M[i][0]));
  for (let i = 1; i <= m; i++) vj[i] = Math.min(vj[i], Math.sqrt(vj[i - 1] * vj[i - 1] + 2 * M[i - 1][2] * M[i - 1][0]));
  const a = new Float64Array(n), b = new Float64Array(n);
  let t = 0;
  for (let i = 0; i < m; i++) {
    const [L, vm, acc, , , k] = M[i];
    if (k < 0 && L >= sp.minTravel) t += sp.travelExtra;
    if (k >= 0) a[k] = t;
    t += lvMoveTime(L, vj[i], vj[i + 1], vm, acc);
    if (k >= 0) b[k] = t;
  }
  return (lv.track = { li, start, end, a, b, len: t });
}
function lvPointAt(tr, s) {
  const n = tr.end - tr.start, P = lv.pos;
  if (!n) return null;
  s = Math.max(0, Math.min(tr.len, s));
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tr.a[m] <= s) lo = m; else hi = m - 1; }
  const o = (tr.start + lo) * 6;
  if (s <= tr.b[lo]) {                      // auf der Bahn
    const seg = tr.b[lo] - tr.a[lo], k = seg > 0 ? (s - tr.a[lo]) / seg : 0;
    return { x: P[o] + (P[o + 3] - P[o]) * k, y: P[o + 1] + (P[o + 4] - P[o + 1]) * k, z: P[o + 5], seg: tr.start + lo };
  }
  // Leerfahrt zur nächsten Bahn
  const q = o + 6, gap = lo + 1 < n ? tr.a[lo + 1] - tr.b[lo] : 0, k = gap > 0 ? (s - tr.b[lo]) / gap : 1;
  if (lo + 1 >= n) return { x: P[o + 3], y: P[o + 4], z: P[o + 5], seg: tr.start + lo + 1 };
  return { x: P[o + 3] + (P[q] - P[o + 3]) * k, y: P[o + 4] + (P[q + 1] - P[o + 4]) * k, z: P[o + 5], seg: tr.start + lo + 1 };
}
// nächste Stelle auf einer Bahn der Schicht → {s (Druckzeit), dist}. near = erwartete Druckzeit: dann zuerst ±LV_NEAR_S davon
// suchen – bei dichter Füllung liegen Nachbarlinien 0,4 mm auseinander, da wäre die nächste Linie oft die falsche
function lvSegAt(tr, s) { let lo = 0, hi = tr.end - tr.start - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tr.a[m] <= s) lo = m; else hi = m - 1; } return lo; }
function lvSnap(tr, x, y, near) {
  if (near != null) {
    const r = lvSnapRange(tr, x, y, tr.start + lvSegAt(tr, near - LV_NEAR_S), tr.start + lvSegAt(tr, near + LV_NEAR_S) + 1);
    if (r.dist <= LV_SNAP_MM) return r;
  }
  return lvSnapRange(tr, x, y, tr.start, tr.end);
}
function lvSnapRange(tr, x, y, from, to) {
  const P = lv.pos; let best = Infinity, bs = 0;
  for (let i = from; i < to; i++) {
    const o = i * 6, ax = P[o], ay = P[o + 1], dx = P[o + 3] - ax, dy = P[o + 4] - ay, l2 = dx * dx + dy * dy;
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const qx = ax + dx * k - x, qy = ay + dy * k - y, d2 = qx * qx + qy * qy;
    if (d2 < best) { best = d2; bs = tr.a[i - tr.start] + k * (tr.b[i - tr.start] - tr.a[i - tr.start]); }
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
    const t0 = now - Math.min(8, Math.max(0, +age || 0)) * 1000;   // Zeitpunkt der Messung
    const tr = li >= 0 ? lvTrack(li) : null, same = h && h.snapped && h.li === li;
    const sn = tr && tr.len > 0 ? lvSnap(tr, x, y, same ? h.s0 + h.v * Math.min(10, (t0 - h.t0) / 1000) : null) : null;
    let hs;
    if (sn && sn.dist <= LV_SNAP_MM) {
      // Verhältnis Druckzeit zu Uhrzeit aus zwei Meldungen auf derselben Schicht (geglättet; ≈ 1, wenn die Zeiten passen)
      let v = h && h.v || 1;
      if (same && sn.s > h.s0 && t0 - h.t0 > 1500) { const vm = (sn.s - h.s0) / ((t0 - h.t0) / 1000); v = Math.max(0.3, Math.min(2.5, 0.7 * v + 0.3 * vm)); }
      // wo der Kopf gerade gezeigt wird → Abweichung weich ausgleichen statt springen
      let corr = 0;
      const shownS = same ? lvHeadS(h, now) : lv.disp && h && h.li === li ? (at => at.dist <= LV_SNAP_MM ? at.s : null)(lvSnap(tr, lv.disp.x, lv.disp.y, sn.s)) : null;
      if (shownS != null) corr = shownS - (sn.s + v * (now - t0) / 1000);
      hs = { real: true, snapped: true, li, s0: sn.s, t0, tc: now, v, corr: Math.max(-LV_MAX_CORR_S, Math.min(LV_MAX_CORR_S, corr)), key };
      hs.info = { real: true, snapped: true, li, frac: tr.len ? sn.s / tr.len : 0 };
    } else {
      hs = { real: true, snapped: false, from: lv.disp || { x, y, z }, to: { x, y, z }, t0: now, dur: h && h.real ? Math.min(6000, Math.max(800, now - (h.tc || h.t0))) : 1, tc: now, key, v: h && h.v, li };
      hs.info = { real: true, snapped: false, li };
    }
    lv.hs = hs;
  } else {
    if (!(L > 0)) { lv.hs = null; lv.disp = null; if (lv.head) { lv.head.visible = false; lv.gantry.visible = false; } lvRender(); return null; }
    if (cur !== lv.layerAt) { lv.layerAt = cur; lv.layerSince = Date.now(); }
    const rest = +(st.job && st.job.remaining_min) || 0, left = Math.max(1, (T || lv.data.layers.length) - L + 1);
    lv.hs = { real: false, li: cur, dur: rest > 0 ? rest * 60 / left : 60, info: { real: false, li: cur } };
  }
  lv.head.visible = true;
  if (!lv.anim) lv.anim = requestAnimationFrame(lvHeadTick);
  return lv.hs.info;
}
// Druckzeit in der Schicht jetzt (echt, auf der Bahn): Messung + rate × Zeit seit der Messung, Abweichung blendet aus
function lvHeadS(h, now) {
  const dt = Math.min(10, (now - h.t0) / 1000), k = Math.min(1, (now - h.tc) / LV_BLEND_MS), e = k * k * (3 - 2 * k);
  return h.s0 + h.v * dt + h.corr * (1 - e);
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
  if (!h || !lv.head || !lv.head.visible || lv.mode !== 'live' || document.hidden) { lv.lastTick = 0; return; }
  const p = lvHeadPos(h, now);
  if (p) {
    // Glätten: gezeigte Stelle folgt dem Ziel mit kurzer Verzögerung; sehr weite Wege (Schichtwechsel, Start) direkt
    const dt = lv.lastTick ? Math.min(0.1, (now - lv.lastTick) / 1000) : 1, d = lv.disp;
    if (!d || Math.hypot(p.x - d.x, p.y - d.y) > 120) lv.disp = { x: p.x, y: p.y, z: p.z };
    else { const a = 1 - Math.exp(-dt / LV_SMOOTH_S); d.x += (p.x - d.x) * a; d.y += (p.y - d.y) * a; d.z += (p.z - d.z) * a; }
    lvPlaceHead(lv.disp);
    if (p.seg != null && h.li === lv.shown) lvColourTo(p.seg);   // abgefahrene Bahnen orange (die aktuelle erst danach)
    lvDraw();
  }
  lv.lastTick = now;
  if (h.snapped || !h.real || now - h.t0 < h.dur + 1000) lv.anim = requestAnimationFrame(lvHeadTick);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && lv.hs && !lv.anim) lv.anim = requestAnimationFrame(lvHeadTick); });

// Bis Schicht cur (0-basiert): fertig = Filamentfarbe, aktuell = orange; danach die kommenden Schichten je nach Wahl
/* Farben bis Schicht cur: frühere Schichten in Filamentfarbe. Aktuelle Schicht ohne Kopfposition (done = null) ganz orange;
   mit Kopf: was er schon abgefahren hat orange („gerade gedruckt“), der Rest der Schicht blass – so sieht man das Einfärben
   auch bei dunklem Filament. Danach die kommenden Schichten je nach Wahl (lvGhostApply). */
const LV_PENDING = [0.42, 0.44, 0.48];
function lvCurColour(i, split, withHead) { return !withHead || i < split ? LV_NOW : LV_PENDING; }
function lvColour(cur, done) {
  const d = lv.data, col = lv.mesh.geometry.attributes.color.array, cache = {};
  const start = d.layers[cur][1], end = cur + 1 < d.layers.length ? d.layers[cur + 1][1] : d.count, withHead = done != null;
  for (let i = 0; i < end; i++) {
    let c;
    if (i < start) { const k = d.a[2 * i + 1]; c = cache[k] || (cache[k] = lvVisible(hexToRgb01(toolColour(k)))); }
    else c = lvCurColour(i, done, withHead);
    for (let v = 0; v < 2; v++) { const o = (i * 2 + v) * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; }
  }
  lvColourDirty(0, end);
  lv.mesh.geometry.setDrawRange(0, end * 2);
  lv.ghost.geometry.setDrawRange(end * 2, (d.count - end) * 2);
  lvGhostApply();
  lv.shown = cur; lv.shownDone = done;
}
/* Während der Kopf fährt: abgefahrene Bahnen der aktuellen Schicht orange; läuft er zurück (Korrektur nach einer Meldung),
   wieder blass. Nur der geänderte Bereich wird neu übertragen. */
function lvColourTo(split) {
  if (lv.shownDone == null) return;          // aktuelle Schicht ohne Kopf gezeichnet (ganz orange)
  const d = lv.data, cur = lv.shown, start = d.layers[cur][1], end = cur + 1 < d.layers.length ? d.layers[cur + 1][1] : d.count;
  split = Math.max(start, Math.min(end, split));
  const was = lv.shownDone;
  if (split === was) return;
  const col = lv.mesh.geometry.attributes.color.array, [a, b] = split > was ? [was, split] : [split, was];
  for (let i = a; i < b; i++) {
    const c = lvCurColour(i, split, true);
    for (let v = 0; v < 2; v++) { const o = (i * 2 + v) * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; }
  }
  lvColourDirty(a, b);
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
    if (typeof skDrawLines === 'function' && wb.st && wb.st.job) skDrawLines(new Set(wb.st.job.skipped || []));
  } catch (e) { lv.missing = true; }
  finally { lv.loading = false; if (wb.st) liveUpdate(wb.st); }
}

// Aus der Werkbank bei jedem Stand (alle 3 s): passende Vorschau laden, Schicht nachführen
function liveUpdate(st) {
  const job = st && st.job, card = $('wbLiveStage');
  if (!card) return;
  if (!job || !job.name) {
    lv.name = null; lv.data = null; lv.hs = null; lv.disp = null; if (lv.head) { lv.head.visible = false; lv.gantry.visible = false; }
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
  // neue Schicht: blass; was der Kopf abfährt, färbt lvHeadTick nach und nach orange (ohne Kopf: ganz orange)
  if (li !== lv.shown || !!head !== (lv.shownDone != null)) lvColour(li, head ? lv.data.layers[li][1] : null);
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
