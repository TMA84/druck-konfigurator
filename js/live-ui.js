'use strict';
/* Live-Ansicht im Tab ④ Drucker: der geslicte G-Code des laufenden Drucks in 3D, bis zur Schicht, die der Drucker
   meldet – fertige Schichten in Filamentfarbe, die aktuelle orange, die kommenden blass. Umschalter in der
   Kamera-Karte (Kamera | 3D-Fortschritt). Die Vorschau hebt der Server beim Start auf (api/printing/preview,
   tools/serve.py remember_print) – deshalb nur für Drucke, die aus dem Tool gestartet wurden.
   Datenformat und Farben wie in ③ (js/preview-ui.js: parsePreview, hexToRgb01, toolColour).
   Druckkopf (Abschnitt „Druckkopf“ unten): mit „Echte Kopfposition“ (Standard an; der Server fragt die Position dann auch
   während des Drucks ab, api/anycubic/status?pos=1 – am Kobra S1 mit Firmware 2.7.2.7 geprüft am 2026-09-29) auf der
   gemeldeten Bahn, sonst geschätzt über die erwartete Schichtzeit. */

const lv = { prep: { job: null, s: null }, name: null, data: null, missing: false, renderer: null, scene: null, camera: null, controls: null, mesh: null, grid: null,
  layerOf: null, shown: -2, shownDone: null, track: null, raf: 0, mode: null, loading: false, pos: null, cx: 0, cy: 0, head: null, layerAt: -1, layerSince: 0,
  hs: null, anim: 0, dirty: null, disp: null, lastTick: 0 };   // hs: Zustand der Kopfbewegung (lvHeadSet/lvHeadTick)
const LV_POS_FRESH_S = 10;
const livePosWanted = () => store.settings.livePos !== false && lv.mode === 'live';
const LV_NOW = [0.18, 0.77, 0.71];   // aktuelle Schicht: Petrol (Farbschema)
/* Darstellung (2026-10-07): Bahnen als beleuchtete Raupen (je Bahn ein Quader mit Linienbreite × Schichthöhe, ein
   InstancedMesh) statt 1-Pixel-Linien; über LV_FAT_MAX Bahnen die schnellen Linien wie bisher. */
const LV_FAT_MAX = 600000, LV_LINE_W = 0.44;
const lvCss = (v, f) => { const s = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); return s || f; };
// Hintergrund, Raster und Druckplatte passend zum Hell-/Dunkelmodus
function lvTheme() {
  if (!lv.scene) return;
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  lv.scene.background = new THREE.Color(dark ? 0x0c1114 : 0xe9eff1);
  if (lv.plate) lv.plate.material.color.setHex(dark ? 0x171b1e : 0x23282c);   // PEI-Platte: dunkel wie beim Drucker
  if (lv.grid) lv.grid.material.color.setHex(dark ? 0x2c393f : 0x3a454b);
  // Kanten von Kopf und Mechanik: hell auf dunklem, dunkel auf hellem Grund
  for (const g of [lv.head, lv.gantry]) if (g) g.traverse(o => { if (o.isLineSegments) o.material.color.setHex(dark ? 0xffffff : 0x26343b); });
  lvRender();
}
// Kommende Schichten: durchsichtig (Standard), ausgeblendet oder voll (wie früher, dunkelgrau)
const LV_GHOST = { ghost: 0.02, off: 0, full: 1 };
const lvGhostMode = () => (store.settings.liveGhost in LV_GHOST ? store.settings.liveGhost : 'ghost');

function lvInit() {
  if (lv.renderer || typeof THREE === 'undefined') return !!lv.renderer;
  lv.renderer = new THREE.WebGLRenderer({ antialias: true });
  lv.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  $('wbLiveStage').appendChild(lv.renderer.domElement);
  lv.scene = new THREE.Scene(); lv.scene.background = new THREE.Color(0x0c1114);
  lv.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a363d, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.65); sun.position.set(0.6, -1, 1.4); lv.scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.18); fill.position.set(-1, 0.8, 0.6); lv.scene.add(fill);
  new MutationObserver(lvTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
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
  const attr = lv.fat ? lv.mesh.instanceColor : lv.mesh.geometry.attributes.color, k = lv.fat ? 3 : 6;
  attr.updateRange.offset = d[0] * k; attr.updateRange.count = (d[1] - d[0]) * k; attr.needsUpdate = true;
}
// Farbe einer Bahn setzen (Raupe: eine Farbe je Instanz, Linie: zwei Endpunkte)
function lvPaint(i, c) {
  if (lv.fat) { const a = lv.mesh.instanceColor.array, o = i * 3; a[o] = c[0]; a[o + 1] = c[1]; a[o + 2] = c[2]; return; }
  const col = lv.mesh.geometry.attributes.color.array;
  for (let v = 0; v < 2; v++) { const o = (i * 2 + v) * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; }
}
// gedruckt bis Bahn end sichtbar, danach die blassen kommenden Schichten
function lvRange(end) {
  const n = lv.data.count;
  if (lv.fat) lv.mesh.count = end; else lv.mesh.geometry.setDrawRange(0, end * 2);
  lv.ghost.geometry.setDrawRange(end * 2, (n - end) * 2);
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
  lv.fat = n <= LV_FAT_MAX && typeof THREE.InstancedMesh === 'function';
  if (lv.fat) {
    // je Bahn ein Quader: Länge der Bahn (+ etwas, damit Ecken schließen) × Linienbreite × Schichthöhe, Oberkante auf z
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0, -0.5);
    lv.mesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 }), n);
    const m = lv.mesh.instanceMatrix.array, w = LV_LINE_W;
    d.layers.forEach(([z, start], li) => {
      const end = li + 1 < d.layers.length ? d.layers[li + 1][1] : n, h = Math.max(0.05, Math.min(0.6, li ? z - d.layers[li - 1][0] : z));
      for (let i = start; i < end; i++) {
        const o = i * 6, dx = pos[o + 3] - pos[o], dy = pos[o + 4] - pos[o + 1], L = Math.hypot(dx, dy), c = L ? dx / L : 1, s = L ? dy / L : 0, sx = L + w * 0.5, q = i * 16;
        m[q] = c * sx; m[q + 1] = s * sx; m[q + 2] = 0; m[q + 3] = 0;
        m[q + 4] = -s * w; m[q + 5] = c * w; m[q + 6] = 0; m[q + 7] = 0;
        m[q + 8] = 0; m[q + 9] = 0; m[q + 10] = h; m[q + 11] = 0;
        m[q + 12] = (pos[o] + pos[o + 3]) / 2; m[q + 13] = (pos[o + 1] + pos[o + 4]) / 2; m[q + 14] = z; m[q + 15] = 1;
      }
    });
    lv.mesh.instanceMatrix.needsUpdate = true;
    lv.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    lv.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    lv.mesh.frustumCulled = false; lv.mesh.count = 0;
  } else {
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    lv.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
  }
  lv.ghost = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.07, depthWrite: false }));
  lv.ghost.renderOrder = 1;
  lv.scene.add(lv.mesh, lv.ghost);
  if (lv.grid) { lv.scene.remove(lv.grid); lv.grid.geometry.dispose(); lv.grid.material.dispose(); }
  const size = Math.max(bx1 - bx0, by1 - by0, 20), span = Math.ceil(size * 1.4 / 10) * 10;
  lv.grid = new THREE.GridHelper(span, span / 10, 0xffffff, 0xffffff);   // Farbe setzt lvTheme lv.grid.rotation.x = Math.PI / 2; lv.grid.position.z = 0.01; lv.scene.add(lv.grid);
  const top = d.bbox[5] || 1;
  // Bett und Mechanik möglichst im Bild – bei kleinen Teilen höchstens 2,2 × Modellgröße, sonst wäre das Teil winzig
  // mindestens ~230 mm Bildausschnitt: sonst füllt der Druckkopf (≈ 56 × 48 × 70 mm) bei kleinen Teilen das Bild
  const bed = lvBed(), frame = Math.max(size, Math.min(Math.max(bed.x1 - bed.x0, bed.y1 - bed.y0), Math.max(size * 2.2, 230)));
  lv.camera.position.set(frame * 0.9, -frame * 1.1, frame * 0.8 + top);
  lv.controls.target.set(0, 0, top / 3); lv.controls.update();
  lv.shown = -2; lv.shownDone = null; lv.track = null; lv.hs = null; lv.dirty = null; lv.disp = null; lv.skip = null; lv.skipKey = null;
  lvHeadInit();
  lvTheme();
}

/* Drucker-Mechanik ungefähr wie beim Kobra S1 (CoreXY, das Bett fährt nach unten): Kopf ≈ 56 × 48 × 70 mm (geschätzt, keine
   offiziellen Maße), darüber die X-Traverse über die ganze Breite und links/rechts die Y-Schienen – beide auf Höhe des
   Kopfes, sie fahren mit der Düse mit. Dazu der Umriss des Druckbetts. Maße in mm, Koordinaten wie die Bahnen. */
const LV_HEAD = { w: 56, d: 48, h: 70, tip: 8 }, LV_GANTRY_Z = 52, LV_RAIL = 10, LV_FRAME_H = 330;
// Modell des Druckers für die Nachbildung: gemeldetes Modell, sonst gewählter Drucker, sonst Kobra S1 (js/anycubic-models.js)
function lvModel() {
  const st = typeof wb !== 'undefined' && wb.st;
  return (typeof anycubicLanModel === 'function' && st && anycubicLanModel(st.model)) || (typeof lanModelOf === 'function' && lastResult && lanModelOf(lastResult.printer)) ||
    { key: 'kobra_s1', kin: 'corexy', size: [250, 250, 250] };
}
function lvBed() {
  const md = lvModel();
  if (md.key !== 'kobra_s1') return { x0: 0, y0: 0, x1: md.size[0], y1: md.size[1] };   // andere Anycubic: Bauraum aus der Modelltabelle
  const tpl = typeof exportTemplate === 'function' ? exportTemplate(typeof WB_PRINTER !== 'undefined' ? WB_PRINTER : 'kobra_s1', '0.4') : null;
  const pts = tpl ? (tpl.settings.printable_area || []).map(p => p.split('x').map(Number)) : [];
  if (!pts.length) return { x0: 0, y0: 0, x1: 250, y1: 250 };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
function lvHeadInit() {
  for (const k of ['head', 'gantry', 'bed', 'frameFixed', 'mechG']) if (lv[k]) { lv.scene.remove(lv[k]); lv[k] = null; }
  lv.motorCaps = [];
  /* Druckkopf und Mechanik (2026-10-07, vorher Glaskästen): beleuchtete Teile, leicht durchscheinend, damit das Teil
     sichtbar bleibt. Graphit-Gehäuse (der Petrol-Streifen verdeckte das Teil – entfernt), Lüfterring vorn, Alu-Heizblock, Messingdüse; X-Traverse als
     Alu-Profil mit Nut und Laufwagen, Y-Schienen als Stahlstangen. */
  const H = LV_HEAD, mat = (c, o) => new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.55, metalness: o.m ?? 0.1, transparent: (o.op ?? 1) < 1, opacity: o.op ?? 1, depthWrite: (o.op ?? 1) >= 1 });
  const edges = (geo, op) => new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: op }));
  const rounded = (w, d, r) => { const sh = new THREE.Shape(), x = -w / 2, y = -d / 2;
    sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r); sh.lineTo(x + w, y + d - r); sh.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    sh.lineTo(x + r, y + d); sh.quadraticCurveTo(x, y + d, x, y + d - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y); return sh; };
  const slab = (w, d, h, r, bevel) => new THREE.ExtrudeGeometry(rounded(w, d, r), { depth: h, bevelEnabled: !!bevel, bevelThickness: bevel || 0, bevelSize: bevel || 0, bevelSegments: 2, curveSegments: 8 });
  /* Aussehen wie das Kobra-S1-Innenleben (2026-10-07, Vorlage: Anycubic-Produktbild): weißer Kopf mit orangem Streifen
     unten und schwarzem Lüfter, zwei X-Stangen übereinander und die Y-Stangen in Silber, schwarze Eckwagen, blaue Motoren hinten,
     dunkler Rahmen mit Z-Spindeln. Rahmen und Mechanik hängen zusammen – wie beim Drucker fährt relativ dazu das Bett. */
  const tip = new THREE.Mesh(new THREE.ConeGeometry(3.2, H.tip, 24), mat(0xd4a93f, { m: 0.45, r: 0.35 }));
  tip.rotation.x = -Math.PI / 2; tip.position.z = H.tip / 2;
  const heat = new THREE.Mesh(new THREE.BoxGeometry(16, 14, 6), mat(0xb4bdc2, { m: 0.35, r: 0.4 })); heat.position.z = H.tip + 3;
  const bodyH = H.h - 12, bodyZ = H.tip + 8;
  // leicht durchsichtig, damit die Druckstelle zu sehen bleibt (2026-10-08)
  const body = new THREE.Mesh(slab(H.w - 4, H.d - 4, bodyH, 9, 2), mat(0xeceff1, { r: 0.45, op: 0.72 })); body.position.z = bodyZ; body.renderOrder = 2;
  // oranger Streifen unten: nur die Außenhaut (Ring), kein Querschnitt
  const ringSh = rounded(H.w + 1, H.d + 1, 11); ringSh.holes.push(rounded(H.w - 5, H.d - 5, 8.5));
  const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(ringSh, { depth: 10, bevelEnabled: false, curveSegments: 8 }), mat(0xf26a21, { r: 0.45, op: 0.85 })); ring.position.z = bodyZ - 2; ring.renderOrder = 2;
  // Lüfter vorn (−Y): dunkler Ring, schwarze Scheibe, Nabe
  const fanR = Math.min(H.w, H.h) * 0.24, fan = new THREE.Group(), fanZ = bodyZ + bodyH * 0.55;
  fan.add(new THREE.Mesh(new THREE.TorusGeometry(fanR, 1.8, 10, 40), mat(0x2a2f33, { r: 0.6 })), new THREE.Mesh(new THREE.CircleGeometry(fanR - 0.5, 40), mat(0x0f1215, { r: 0.8 })),
    new THREE.Mesh(new THREE.CircleGeometry(fanR * 0.32, 24), mat(0x2a2f33, { r: 0.6 })));
  fan.children[2].position.z = 0.2;
  fan.rotation.x = Math.PI / 2; fan.position.set(0, -(H.d / 2) - 2.2, fanZ);
  lv.head = new THREE.Group(); lv.head.add(tip, heat, body, ring, fan); lv.head.visible = false;
  // Mechanik (Koordinaten relativ zur Traverse, die mit dem Kopf in Z fährt)
  const bed = lvBed(), bx0 = bed.x0 - lv.cx, bx1 = bed.x1 - lv.cx, by0 = bed.y0 - lv.cy, by1 = bed.y1 - lv.cy, m = 22, R = LV_RAIL;
  const len = bx1 - bx0 + 2 * m, cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, ylen = by1 - by0 + 2 * m;
  // Stangen silbern (beim Kobra S1 Stahl – auf dem Produktbild nur orange angeleuchtet)
  const rodM = mat(0xd9dee1, { m: 0.55, r: 0.25 });
  const black = mat(0x1d2124, { r: 0.6 }), steel = mat(0xd5dbde, { m: 0.5, r: 0.3 }), frameM = mat(0x2a3034, { r: 0.7, op: 0.45 });   // rauchig wie im Produktbild, versperrt die Sicht nicht
  // X: zwei Stangen (der Kopf hängt daran), Eckwagen an den Enden; fährt in Y (lvPlaceHead: beam.position.y)
  const beam = new THREE.Group(), rodX = new THREE.CylinderGeometry(2.4, 2.4, len, 20);
  // zwei X-Stangen übereinander (wie am Kobra S1), der Kopf gleitet darauf
  for (const dz of [-8, 8]) { const r = new THREE.Mesh(rodX, rodM); r.rotation.z = Math.PI / 2; r.position.set(0, 0, dz); beam.add(r); }
  for (const sx of [-1, 1]) { const car = new THREE.Mesh(slab(R * 2.6, R * 3.4, R * 3.2, 3, 0.6), black); car.position.set(sx * len / 2, 0, -R * 2); beam.add(car); }
  beam.position.x = cx;
  // Y: je Seite eine Stange durch die Eckwagen
  const rodY = new THREE.CylinderGeometry(2.4, 2.4, ylen, 20), rails = [bx0 - m, bx1 + m].map(x => { const r = new THREE.Mesh(rodY, rodM); r.position.set(x, cy, -R * 0.6); return r; });
  const md = lvModel(); lv.kin = md.kin;
  let frame = new THREE.Group();
  if (md.kin === 'bed') {
    /* Bettschubser (Kobra 3, 3 Max, X): zwei Z-Türme links/rechts der X-Achse, oben eine Querstrebe, unten Y-Schienen unter dem
       Bett und ein Fuß; der ganze Aufbau fährt relativ zum Teil in Y (lvPlaceHead), das Bett mit dem Teil steht still */
    // fester Rahmen in Bett-Koordinaten (z absolut: Fuß unter dem Bett, Türme bis über den Bauraum); fährt nur in Y mit
    const z0 = -45, top = md.size[2] + 70, fh = top - z0, tw = 22, ylen = (by1 - by0) * 2 + 60;
    const bar = (x0, y0, z0, x1, y1, z1, mm) => { const g = new THREE.Mesh(new THREE.BoxGeometry(Math.max(tw, x1 - x0), Math.max(tw, y1 - y0), Math.max(tw, z1 - z0)), mm || mat(0x2a3034, { r: 0.6 })); g.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); frame.add(g); };
    for (const x of [bx0 - m, bx1 + m]) bar(x, 0, top - fh, x, 0, top);                       // Türme
    bar(bx0 - m, 0, top, bx1 + m, 0, top);                                                       // Querstrebe oben
    for (const x of [cx - (bx1 - bx0) * 0.3, cx + (bx1 - bx0) * 0.3]) bar(x, -ylen / 2, top - fh, x, ylen / 2, top - fh + 12);   // Y-Schienen
    bar(bx0 - m, -ylen / 2, top - fh - 8, bx1 + m, ylen / 2, top - fh);                          // Fuß
    for (const x of [bx0 - m + 14, bx1 + m - 14]) { const sc = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, fh - 30, 16), steel); sc.rotation.x = Math.PI / 2; sc.position.set(x, 16, top - fh / 2); frame.add(sc); }   // Z-Spindeln
    const mo = new THREE.Mesh(slab(30, 30, 34, 3, 1), mat(0x30373c, { r: 0.5 })); mo.position.set(bx0 - m - 4, 0, -14); beam.add(mo);   // X-Motor (fährt mit der X-Achse)
    lv.frameFixed = frame; frame = new THREE.Group();
  } else {
    lv.frameFixed = null;
  // Rahmen: oben ein Rechteck aus Profilen mit Eckblöcken, vier Säulen, unten ein Rechteck; Z-Spindeln links/rechts
  const fx0 = bx0 - m - 16, fx1 = bx1 + m + 16, fy0 = by0 - m - 16, fy1 = by1 + m + 16, fw = 13, fh = Math.max(LV_FRAME_H, md.size[2] + 80), top = 12;
  const bar = (x0, y0, z0, x1, y1, z1) => { const g = new THREE.Mesh(new THREE.BoxGeometry(Math.max(fw, x1 - x0), Math.max(fw, y1 - y0), Math.max(fw, z1 - z0)), frameM); g.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); frame.add(g); };
  for (const z of [top, top - fh]) { bar(fx0, fy0, z, fx1, fy0, z); bar(fx0, fy1, z, fx1, fy1, z); bar(fx0, fy0, z, fx0, fy1, z); bar(fx1, fy0, z, fx1, fy1, z); }
  for (const x of [fx0, fx1]) for (const y of [fy0, fy1]) bar(x, y, top - fh, x, y, top);
  // blaue Motoren an den hinteren Ecken (oben)
  const motor = mat(0x3d9fe0, { r: 0.35, m: 0.2 }); motor.emissive = new THREE.Color(0x0c3a5c);
  // je Motor die Riemenscheibe auf der Höhe seines Riemens (links Riemen B unten, rechts Riemen A oben – lvMechInit)
  for (const [x, bz] of [[fx0 + 26, LV_BELT_Z.B], [fx1 - 26, LV_BELT_Z.A]]) { const mo = new THREE.Mesh(slab(30, 30, 34, 3, 1), motor); mo.position.set(x, fy1 - 24, bz - LV_BELT_H / 2 - 3 - 34); frame.add(mo);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, LV_BELT_H + 2, 20), steel); cap.rotation.x = Math.PI / 2; cap.position.set(x, fy1 - 24, bz); frame.add(cap);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 6, 12), steel); shaft.rotation.x = Math.PI / 2; shaft.position.set(x, fy1 - 24, bz - LV_BELT_H / 2 - 2); frame.add(shaft);
    (lv.motorCaps || (lv.motorCaps = [])).push(cap); }
  // drei Z-Spindeln wie am Kobra S1: hinten in der Mitte, vorne links und vorne rechts
  for (const [x, y] of [[cx, by1 + 10], [bx0 - 10, by0 + 25], [bx1 + 10, by0 + 25]]) {
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, fh - 20, 16), steel); sc.rotation.x = Math.PI / 2; sc.position.set(x, y, top - fh / 2); frame.add(sc); }
  }
  lv.gantry = new THREE.Group(); lv.gantry.add(beam, ...(md.kin === 'bed' ? [] : rails), frame);
  if (lv.frameFixed) { lv.frameFixed.visible = false; lv.scene.add(lv.frameFixed); } lv.gantry.userData.beam = beam; lv.gantry.visible = false;
  // Bett: Umriss auf Höhe 0
  const bedPts = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]].map(([x, y]) => new THREE.Vector3(x, y, 0));
  lv.bed = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(bedPts), new THREE.LineBasicMaterial({ color: 0x5b6b73 }));
  // gefüllte Druckplatte knapp unter den Bahnen
  if (lv.plate) { lv.scene.remove(lv.plate); lv.plate.geometry.dispose(); lv.plate.material.dispose(); }
  lv.plate = new THREE.Mesh(new THREE.PlaneGeometry(bx1 - bx0, by1 - by0), new THREE.MeshLambertMaterial({ color: 0x1d272d }));
  lv.plate.position.set((bx0 + bx1) / 2, (by0 + by1) / 2, -0.03);
  lvMechInit(md, { bx0, bx1, by0, by1, m, cx, beam });
  lv.scene.add(lv.head, lv.gantry, lv.bed, lv.plate, lv.mechG);
  lvTheme();
}
/* Riemen, Schleppkette und Filamentschlauch (2026-10-08, Spielerei): CoreXY mit zwei Riemen übereinander – Motoren hinten,
   Umlenkrollen vorn und an den Eckwagen, beide Enden am Kopf; Riemen A läuft mit x + y, B mit x − y (CoreXY), die Zähne
   wandern mit. Bettschubser: X-Riemen an der Traverse (läuft mit x), Y-Riemen unter dem Bett (läuft mit y). Schleppkette
   vom Rahmen hinten oben zum Kopf, daneben der PTFE-Schlauch mit dem Filament in der Farbe der gerade gedruckten Bahn. */
const LV_BELT_PITCH = 4, LV_BELT_H = 6, LV_BELT_T = 1.4, LV_CHAIN_LINKS = 26, LV_BELT_Z = { A: 21, B: 12 };   // wie im Kobra S1: rechter Motor (A) oben, linker (B) unten
let lvBeltTex = null;
function lvBeltTexture() {
  if (lvBeltTex) return lvBeltTex;
  const c = document.createElement('canvas'); c.width = 32; c.height = 8;
  const g = c.getContext('2d'); g.fillStyle = '#16191b'; g.fillRect(0, 0, 32, 8); g.fillStyle = '#4a5156'; g.fillRect(0, 0, 12, 8);
  lvBeltTex = new THREE.CanvasTexture(c); lvBeltTex.wrapS = THREE.RepeatWrapping;
  return lvBeltTex;
}
// Riemen: offene Linienzüge (2D, Höhe z) aus Quadern mit wandernden Zähnen, Rollen an den Ecken
function lvBelt(parent, z, paths) {
  const box = new THREE.BoxGeometry(1, 1, 1), belt = { z, segs: [], rolls: [] };
  const roll = new THREE.CylinderGeometry(4.2, 4.2, LV_BELT_H + 2, 14), rollM = new THREE.MeshStandardMaterial({ color: 0xb9c1c6, metalness: 0.5, roughness: 0.35, flatShading: true });
  for (const n of paths(0, 0)) for (let k = 0; k < n.length - 1; k++) {
    const tex = lvBeltTexture().clone(); tex.needsUpdate = true;
    const mesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    parent.add(mesh); belt.segs.push(mesh);
  }
  for (const n of paths(0, 0)) for (let k = 1; k < n.length - 1; k++) { const r = new THREE.Mesh(roll, rollM); r.rotation.x = Math.PI / 2; parent.add(r); belt.rolls.push(r); }
  belt.paths = paths;
  return belt;
}
function lvBeltSet(b, px, py, travel) {
  let si = 0, ri = 0;
  for (const n of b.paths(px, py)) {
    let acc = 0;
    for (let k = 0; k < n.length - 1; k++) {
      const [x0, y0] = n[k], [x1, y1] = n[k + 1], len = Math.max(0.01, Math.hypot(x1 - x0, y1 - y0)), mesh = b.segs[si++];
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, b.z); mesh.rotation.z = Math.atan2(y1 - y0, x1 - x0); mesh.scale.set(len, LV_BELT_T, LV_BELT_H);
      const t = mesh.material.map; t.repeat.set(len / LV_BELT_PITCH, 1); t.offset.x = (acc - travel) / LV_BELT_PITCH;
      acc += len;
    }
    for (let k = 1; k < n.length - 1; k++) { const r = b.rolls[ri++]; r.position.set(n[k][0], n[k][1], b.z); r.rotation.y = -travel / 4.2; }
  }
}
function lvMechInit(md, g) {
  const { bx0, bx1, by0, by1, m, cx, beam } = g;
  lv.mechG = new THREE.Group(); lv.mechG.visible = false;
  lv.belts = [];
  if (md.kin === 'bed') {
    // X-Riemen hinter den Stangen der Traverse (Motor links), Y-Riemen unter dem Bett (im festen Rahmen)
    const xl = bx0 - m - 4 - cx, xr = bx1 + m - 6 - cx;   // Koordinaten der Traverse (beam.position.x = cx)
    lv.belts.push({ b: lvBelt(beam, 0, (px) => [[[px - 14, 12], [xl, 12], [xl, 18], [xr, 18], [xr, 12], [px + 14, 12]]]), go: p => [p.x - cx, 0, p.x] });
    if (lv.frameFixed) {
      const yl = (by1 - by0) * 0.55, zb = -45 + 22;
      lv.belts.push({ b: lvBelt(lv.frameFixed, zb, () => [[[0, -6], [0, -yl], [6, -yl], [6, yl], [0, yl], [0, 6]]].map(n => n.map(([x, y]) => [x + cx, y]))), go: p => [0, 0, p.y] });
    }
  } else {
    const xL = bx0 - m, xR = bx1 + m, yB = by1 + m - 8, yF = by0 - m + 4;
    lv.belts.push({ b: lvBelt(lv.gantry, LV_BELT_Z.A, (px, py) => [[[xR - 10, yB], [xR - 10, yF], [xR - 18, yF], [xR - 18, py + 5], [px + 12, py + 5]], [[px - 12, py + 5], [xL + 18, py + 5], [xL + 18, yB], [xR - 10, yB]]]), go: p => [p.x, p.y, p.x + p.y] });
    lv.belts.push({ b: lvBelt(lv.gantry, LV_BELT_Z.B, (px, py) => [[[xL + 10, yB], [xL + 10, yF], [xL + 18, yF], [xL + 18, py - 5], [px - 12, py - 5]], [[px + 12, py - 5], [xR - 18, py - 5], [xR - 18, yB], [xL + 10, yB]]]), go: p => [p.x, p.y, p.x - p.y] });
  }
  // Schleppkette: Glieder entlang einer Kurve vom Rahmen hinten oben zum Kopf
  const link = new THREE.BoxGeometry(9, 7, 13),   // lange Seite entlang z: lookAt richtet z auf die Kurve
     linkM = new THREE.MeshStandardMaterial({ color: 0x24292d, roughness: 0.65 });
  lv.chain = [];
  for (let k = 0; k < LV_CHAIN_LINKS; k++) { const l = new THREE.Mesh(link, linkM); lv.mechG.add(l); lv.chain.push(l); }
  lv.tubeM = new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.3, transparent: true, opacity: 0.35, depthWrite: false });
  lv.filM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  lv.tube = null; lv.fil = null;
  lv.mechAnchor = md.kin === 'bed' ? { x: cx, y: 0, z: md.size[2] + 70 + 14, fixed: true } : { x: cx, y: by1 + m + 4, z: 46, fixed: false };
}
// Kurve der Kette: hinten oben → Bogen → senkrecht von oben auf den Kopf
function lvChainCurve(a, h) {
  const up = Math.max(40, (a.z - h.z) * 0.5 + 40);
  return new THREE.CubicBezierCurve3(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(a.x, a.y - 70, a.z + 30),
    new THREE.Vector3(h.x, h.y + 10, h.z + up), new THREE.Vector3(h.x, h.y + 6, h.z));
}
function lvMechUpdate(p) {
  if (!lv.mechG) return;
  lv.mechG.visible = lv.head.visible;
  if (!lv.head.visible) return;
  for (const { b, go } of lv.belts) { const [px, py, tr] = go(p); lvBeltSet(b, px, py, tr); }
  // Motorscheiben drehen mit (rechts Riemen A: x + y, links Riemen B: x − y)
  if (lv.kin !== 'bed' && lv.motorCaps && lv.motorCaps.length === 2) { lv.motorCaps[0].rotation.y = -(p.x - p.y) / 6; lv.motorCaps[1].rotation.y = -(p.x + p.y) / 6; }
  // Anker in Weltkoordinaten: CoreXY am Rahmen (fährt in Z mit der Traverse), Bettschubser am oberen Querholm (fährt in Y)
  const A = lv.mechAnchor, a = A.fixed ? { x: A.x, y: A.y + p.y, z: A.z } : { x: A.x, y: A.y, z: p.z + LV_GANTRY_Z + A.z };
  const top = { x: p.x, y: p.y + 4, z: p.z + LV_HEAD.h + 2 }, c = lvChainCurve(a, top), q = new THREE.Vector3();
  lv.chain.forEach((l, k) => {
    const t = (k + 0.5) / LV_CHAIN_LINKS; c.getPoint(t, l.position); c.getTangent(t, q);
    l.lookAt(l.position.x + q.x, l.position.y + q.y, l.position.z + q.z);
  });
  // Schlauch mit Filament neben der Kette (seitlich versetzt), endet oben im Kopf
  const off = new THREE.Vector3(9, 0, 0), ct = new THREE.CubicBezierCurve3(c.v0.clone().add(off), c.v1.clone().add(off), c.v2.clone().add(off), c.v3.clone().add(new THREE.Vector3(4, 0, -6)));
  for (const k of ['tube', 'fil']) if (lv[k]) { lv.mechG.remove(lv[k]); lv[k].geometry.dispose(); }
  lv.tube = new THREE.Mesh(new THREE.TubeGeometry(ct, 40, 2.4, 10), lv.tubeM);
  lv.fil = new THREE.Mesh(new THREE.TubeGeometry(ct, 40, 0.9, 6), lv.filM);
  lv.tube.renderOrder = 3;
  lv.mechG.add(lv.fil, lv.tube);
}
// Filamentfarbe im Schlauch: Werkzeug der gerade gedruckten Bahn
function lvFilamentAt(seg) {
  if (!lv.filM || seg == null || !lv.data || !lv.data.a) return;
  const k = lv.data.a[2 * seg + 1];
  if (k === lv.filTool) return;
  lv.filTool = k;
  const c = typeof toolColour === 'function' ? toolColour(k) : null;
  if (c) lv.filM.color.set(c);
}
// Kopf und Mechanik an die Stelle p (Düsenspitze)
function lvPlaceHead(p) {
  lv.head.position.set(p.x, p.y, p.z);
  lv.gantry.visible = lv.head.visible;
  lv.gantry.position.z = p.z + LV_GANTRY_Z;
  // CoreXY: Traverse fährt in Y; Bettschubser: der ganze Aufbau steht relativ zum Kopf, das Bett (mit dem Teil) fährt
  if (lv.kin === 'bed') { lv.gantry.position.y = p.y; lv.gantry.userData.beam.position.y = 0; if (lv.frameFixed) { lv.frameFixed.position.y = p.y; lv.frameFixed.visible = lv.head.visible; } }
  else { lv.gantry.position.y = 0; lv.gantry.userData.beam.position.y = p.y; }
  lvMechUpdate(p);
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
  const M = [], skip = lv.skip;
  let prev = -1;    // letzte gedruckte Bahn (übersprungene Objekte zählen nicht – der Drucker fährt direkt weiter)
  for (let k = 0; k < n; k++) {
    const i = start + k, o = i * 6;
    if (skip && skip[i]) continue;
    if (prev >= 0) { const q = prev * 6, dx = P[o] - P[q + 3], dy = P[o + 1] - P[q + 4], L = Math.hypot(dx, dy);
      if (L > 1e-3) M.push([L, travel, first ? Math.min(sp.firstAccel * 2, sp.travelAcc) : sp.travelAcc, dx / L, dy / L, -1]); }
    prev = i;
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
  // übersprungene Bahnen: ohne eigene Zeit (Beginn = Ende = Zeitpunkt der nächsten gedruckten Bahn)
  if (skip) for (let k = n - 1, next = t; k >= 0; k--) { if (skip[start + k]) { a[k] = b[k] = next; } else next = a[k]; }
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
    /* Schicht aus der Kopfhöhe nur, wenn wirklich gedruckt wird (ab Schicht 1) und die Höhe zum Modell passt – beim Bett
       vermessen/Aufheizen steht der Kopf mitten über dem Bett (S1: Z ≈ 380 mm); das rastete auf der obersten Schicht
       ein, der 3D-Fortschritt zeigte das Modell fertig (2026-10-03). Sonst: Schicht laut Drucker, Kopf trotzdem echt. */
    const x = +p.x - lv.cx, y = +p.y - lv.cy, z = +p.z, key = x + ',' + y + ',' + z;
    const topZ = lv.data.layers[lv.data.layers.length - 1][0], plausible = L >= 1 && z <= topZ + 2;
    const li = plausible ? lvLayerByZ(z) : cur;
    if (h && h.real && h.key === key) return h.info;              // nichts Neues – weiterfahren wie bisher
    const t0 = now - Math.min(8, Math.max(0, +age || 0)) * 1000;   // Zeitpunkt der Messung
    const tr = plausible && li >= 0 ? lvTrack(li) : null, same = h && h.snapped && h.li === li;
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
    if (!(L > 0)) { lv.hs = null; lv.disp = null; if (lv.head) { lv.head.visible = false; lv.gantry.visible = false; if (lv.frameFixed) lv.frameFixed.visible = false; if (lv.mechG) lv.mechG.visible = false; } lvRender(); return null; }
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
    if (p.seg != null && h.li === lv.shown) lvColourTo(p.seg);
    lvFilamentAt(p.seg);   // abgefahrene Bahnen orange (die aktuelle erst danach)
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
/* Übersprungene Objekte (js/skip-ui.js): Bahnen ab der Schicht des Überspringens, deren Mitte im Umriss des Objekts
   liegt, dunkel; der Kopf lässt sie aus (lvTrack) und fährt wie der Drucker gleich zum nächsten Objekt. */
const LV_SKIP = [0.32, 0.2, 0.2];
function lvSkipSet(objs) {
  // objs: [{polygon: [[x,y]…], from: Schicht der Vorschau}] – gleiche Eingabe → nichts tun
  const key = JSON.stringify(objs.map(o => [o.from, o.polygon.length, o.polygon[0]]));
  if (!lv.data || key === lv.skipKey) return;
  lv.skipKey = key;
  const d = lv.data, n = d.count, P = lv.pos, mask = objs.length ? new Uint8Array(n) : null;
  const inside = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  for (const o of objs) {
    const poly = o.polygon.map(([x, y]) => [x - lv.cx, y - lv.cy]), xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const from = d.layers[Math.max(0, Math.min(d.layers.length - 1, o.from))][1];
    for (let i = from; i < n; i++) {
      const q = i * 6, mx = (P[q] + P[q + 3]) / 2, my = (P[q + 1] + P[q + 4]) / 2;
      if (mx >= x0 && mx <= x1 && my >= y0 && my <= y1 && inside(mx, my, poly)) mask[i] = 1;
    }
  }
  lv.skip = mask; lv.track = null;
  if (lv.shown >= 0) lvColour(lv.shown, lv.shownDone);
}
function lvCurColour(i, split, withHead) { return lv.skip && lv.skip[i] ? LV_SKIP : !withHead || i < split ? LV_NOW : LV_PENDING; }
function lvColour(cur, done) {
  const d = lv.data, cache = {};
  const start = d.layers[cur][1], end = cur + 1 < d.layers.length ? d.layers[cur + 1][1] : d.count, withHead = done != null;
  for (let i = 0; i < end; i++) {
    let c;
    if (i < start) { const k = d.a[2 * i + 1]; c = lv.skip && lv.skip[i] ? LV_SKIP : cache[k] || (cache[k] = lvVisible(hexToRgb01(toolColour(k)))); }
    else c = lvCurColour(i, done, withHead);
    lvPaint(i, c);
  }
  lvColourDirty(0, end);
  lvRange(end);
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
  const [a, b] = split > was ? [was, split] : [split, was];
  for (let i = a; i < b; i++) lvPaint(i, lvCurColour(i, split, true));
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

const LV_RETRY_MS = 20000;
async function lvLoad(name) {
  lv.name = name; lv.data = null; lv.missing = false; lv.loading = true;
  $('wbLiveNote').textContent = t('Lade 3D-Ansicht …'); $('wbLiveNote').classList.remove('hidden');
  try {
    const r = await fetch('api/printing/preview?name=' + encodeURIComponent(name));
    if (lv.name !== name) return;
    if (!r.ok) { lv.missing = true; lv.missingAt = Date.now(); return; }
    lv.data = parsePreview(await r.arrayBuffer());
    if (!lvInit()) { lv.missing = true; return; }
    lvResize(); lvBuild();
    if (typeof skDrawLines === 'function' && wb.st && wb.st.job) skDrawLines(new Set(wb.st.job.skipped || []));
  } catch (e) { lv.missing = true; lv.missingAt = Date.now(); }
  finally { lv.loading = false; if (wb.st) liveUpdate(wb.st); }
}

// Aus der Werkbank bei jedem Stand (alle 3 s): passende Vorschau laden, Schicht nachführen
function liveUpdate(st) {
  const job = st && st.job, card = $('wbLiveStage');
  if (!card) return;
  if (!job || !job.name) {
    lv.at = null;
    lv.name = null; lv.data = null; lv.hs = null; lv.disp = null; if (lv.head) { lv.head.visible = false; lv.gantry.visible = false; if (lv.frameFixed) lv.frameFixed.visible = false; if (lv.mechG) lv.mechG.visible = false; }
    $('wbLiveNote').textContent = t('Kein Druck aktiv.'); $('wbLiveNote').classList.remove('hidden');
    $('wbLiveInfo').textContent = '';
    return;
  }
  // fehlte die Vorschau, alle 20 s erneut fragen (der Server legt sie beim Start ab – ein früher Abruf kam zu früh)
  if (!lv.loading && (job.name !== lv.name || (lv.missing && Date.now() - (lv.missingAt || 0) > LV_RETRY_MS))) { lvLoad(job.name); return; }
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
  lv.at = { li, frac: onPath ? head.frac : 0.5 };   // für die eigene Restzeit (lvRemaining)
  const z = lv.data.layers[li] ? lv.data.layers[li][0] : 0;
  $('wbLiveInfo').textContent = (!(L >= 1) ? t('Vorbereitung vor der ersten Schicht') + (job.status ? ' (' + t(job.status) + ')' : '')
    : onPath ? t('Schicht {l} von {n} ({p} %) · Z {z} mm', { l: li + 1, n, p: Math.round(head.frac * 100), z: de(z, 2) })
    : t('Schicht {l} von {n} · Z {z} mm', { l: L || cur + 1, n: T || n, z: de(z, 2) })) +
    (head ? ' · ' + (head.real ? t('Kopf: echte Position') : t('Kopf: geschätzt')) : '');
}

/* Eigene Restzeit (Tab ④ „Verbleibend“, „Fertig um“): Orcas Gesamtzeit (orca_s) verteilt nach dem Anteil jeder Schicht
   (layer_s: Weg/Vorschub aller Bewegungen plus Farbwechsel mit der Wechselzeit des Profils, tools/gcode_preview.py); ab der
   aktuellen Schicht aufsummiert. Läuft der Druck schneller oder langsamer als geschätzt, gleicht das gemessene Tempo
   (gedruckte Zeit des Druckers gegen die geschätzte bis hier) es nach und nach aus. null = keine Daten (ältere Vorschau). */
const LV_PACE_MIN = 0.75, LV_PACE_MAX = 1.5, LV_PACE_FULL_S = 3600, LV_PACE_FROM_S = 900;
const LV_PREP_DEFAULT_S = 420, LV_PREP_MIN_S = 60, LV_PREP_MAX_S = 1800;
function lvRemaining(st) {
  const d = lv.data, job = st && st.job;
  if (!d || !job || !Array.isArray(d.layer_s) || !d.orca_s || !lv.at || d.layer_s.length !== d.layers.length) return null;
  const ls = d.layer_s, tot = ls.reduce((s, v) => s + v, 0);
  if (!(tot > 0)) return null;
  const k = d.orca_s / tot, li = Math.min(ls.length - 1, Math.max(0, lv.at.li));
  let before = 0; for (let i = 0; i < li; i++) before += ls[i];
  const done = k * (before + lv.at.frac * ls[li]), rest = Math.max(0, d.orca_s - done);
  const el = (+job.elapsed_min || 0) * 60;
  /* Vorbereitung vor der ersten Schicht (Bett vermessen, Aufheizen) rechnet Orca nicht mit – am S1 gemessen ~7 min
     (2026-10-01: 99,7 min echt, Orca 92,6 min). Das Tool merkt sich die Dauer je Druck (store.settings.prepS) und
     zählt sie getrennt: vorher kommt sie auf die Restzeit, danach nicht mehr ins Tempo. */
  const prepEst = +store.settings.prepS > 0 ? +store.settings.prepS : LV_PREP_DEFAULT_S;
  if (lv.prep.job !== job.name) lv.prep = { job: job.name, s: null };
  if (!(+job.layer >= 1)) return { s: d.orca_s + Math.max(LV_PREP_MIN_S, prepEst - el), pace: 1, prep: true };
  if (lv.prep.s == null) {
    // erste Schicht gerade begonnen: bis hierher war Vorbereitung (nur wenn der Druck von Anfang an zu sehen war)
    lv.prep.s = el > 0 && el < LV_PREP_MAX_S && done < 120 ? el : prepEst;
    if (el > 0 && el < LV_PREP_MAX_S && done < 120) { store.settings.prepS = Math.round(+store.settings.prepS > 0 ? (+store.settings.prepS + el) / 2 : el); persist(); }
  }
  // Tempo: gedruckte Zeit laut Drucker (ohne Vorbereitung) gegen die geschätzte – erst ab ¼ h, voll ab 1 h
  const run = Math.max(0, el - lv.prep.s);
  let pace = 1;
  if (done > LV_PACE_FROM_S && run > 0) {
    const w = Math.min(1, done / LV_PACE_FULL_S);
    pace = 1 + w * (Math.min(LV_PACE_MAX, Math.max(LV_PACE_MIN, run / done)) - 1);
  }
  return { s: rest * pace, pace };
}

// Umschalter Kamera | 3D-Fortschritt (Wahl bleibt gespeichert)
function liveMode(mode) {
  lv.mode = mode;
  if (!EMBED_3D) { store.settings.wbView = mode; persist(); }
  const live = mode === 'live';
  $('wbLiveStage').classList.toggle('hidden', !live);
  document.querySelector('.wb-video').classList.toggle('hidden', live);
  document.querySelectorAll('[data-wb-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.wbView === mode)));
  if (live) { if (lv.renderer) setTimeout(lvResize); if (wb.st) liveUpdate(wb.st); }
  // Kamera nur, wenn sie zu sehen ist (js/workbench-ui.js wbCamAuto)
  if (live) { if (wb.player) wbCamOff(); } else if (typeof wbCamAuto === 'function') wbCamAuto();
}
document.querySelectorAll('[data-wb-view]').forEach(b => b.addEventListener('click', () => liveMode(b.dataset.wbView)));
$('wbLiveGhost').value = lvGhostMode();
$('wbLiveGhost').addEventListener('change', e => { store.settings.liveGhost = e.currentTarget.value; persist(); lvGhostApply(); });
$('wbLivePos').checked = livePosOn();
$('wbLivePos').addEventListener('change', e => {
  store.settings.livePos = e.currentTarget.checked; persist();
  if (e.currentTarget.checked) toast(t('Kopfposition wird auch während des Drucks abgefragt (alle 5 s)'));
});
liveMode(!EMBED_3D && store.settings.wbView === 'cam' ? 'cam' : 'live');
