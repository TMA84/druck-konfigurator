'use strict';
/* Live-Ansicht im Tab ④ Drucker: der geslicte G-Code des laufenden Drucks in 3D, bis zur Schicht, die der Drucker
   meldet – fertige Schichten in Filamentfarbe, die aktuelle orange, die kommenden blass. Umschalter in der
   Kamera-Karte (Kamera | 3D-Fortschritt). Die Vorschau hebt der Server beim Start auf (api/printing/preview,
   tools/serve.py remember_print) – deshalb nur für Drucke, die aus dem Tool gestartet wurden.
   Datenformat und Farben wie in ③ (js/preview-ui.js: parsePreview, hexToRgb01, toolColour).
   Druckkopf (Abschnitt „Druckkopf“ unten): immer an der echten Kopfposition (der Server fragt sie bei offener 3D-Ansicht auch
   während des Drucks ab, api/anycubic/status?pos=1 – am Kobra S1 mit Firmware 2.7.2.7 geprüft am 2026-09-29; der Schalter
   „Echte Kopfposition“ entfiel 2026-10-09) auf der gemeldeten Bahn; fehlt eine frische Position, geschätzt über die Schichtzeit. */

const lv = { prep: { job: null, s: null }, name: null, data: null, missing: false, renderer: null, scene: null, camera: null, controls: null, mesh: null, grid: null,
  layerOf: null, shown: -2, shownDone: null, track: null, raf: 0, mode: null, loading: false, pos: null, cx: 0, cy: 0, head: null, layerAt: -1, layerSince: 0,
  hs: null, anim: 0, dirty: null, disp: null, lastTick: 0 };   // hs: Zustand der Kopfbewegung (lvHeadSet/lvHeadTick)
const LV_POS_FRESH_S = 10;
const livePosWanted = () => lv.mode === 'live';   // echte Kopfposition immer (Schalter entfernt 2026-10-09)
/* Darstellung (2026-10-07): Bahnen als beleuchtete Raupen (je Bahn ein Quader mit Linienbreite × Schichthöhe, ein
   InstancedMesh) statt 1-Pixel-Linien; über LV_FAT_MAX Bahnen die schnellen Linien wie bisher. */
const LV_FAT_MAX = 600000, LV_LINE_W = 0.44;
const lvCss = (v, f) => { const s = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); return s || f; };
// Hintergrund, Raster und Druckplatte passend zum Hell-/Dunkelmodus
// Hintergrund dunkles Design: Schiefergrau statt fast Schwarz (2026-10-08) – Mechanik und Rahmen heben sich besser ab
const LV_BG_DARK = 0x2a343a;
function lvTheme() {
  if (!lv.scene) return;
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  lv.scene.background = new THREE.Color(dark ? LV_BG_DARK : 0xe9eff1);
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
  lv.scene = new THREE.Scene(); lv.scene.background = new THREE.Color(LV_BG_DARK);
  lv.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a363d, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.65); sun.position.set(0.6, -1, 1.4); lv.scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.18); fill.position.set(-1, 0.8, 0.6); lv.scene.add(fill);
  new MutationObserver(lvTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  lv.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000); lv.camera.up.set(0, 0, 1);
  lv.controls = new THREE.OrbitControls(lv.camera, lv.renderer.domElement);
  lv.controls.addEventListener('change', lvRender);
  lv.controls.addEventListener('start', () => { lv.autoFit = false; });   // selbst gedreht/gezoomt: nicht mehr automatisch einpassen
  new ResizeObserver(lvResize).observe($('wbLiveStage'));
  return true;
}
function lvResize() {
  if (!lv.renderer) return;
  const el = $('wbLiveStage'), w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  lv.renderer.setSize(w, h, false); lv.camera.aspect = w / h; lv.camera.updateProjectionMatrix();
  lvRefit(); lvRender();
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
  lv.camera.position.set(0, -frame * 1.6, frame * 0.55 + top);   // frontal von vorn
  lv.controls.target.set(0, 0, top / 3); lv.controls.update();
  lv.shown = -2; lv.shownDone = null; lv.track = null; lv.hs = null; lv.dirty = null; lv.disp = null; lv.skip = null; lv.skipKey = null;
  lvHeadInit();
  lv.autoFit = true; lv.fitPending = true;   // Zoom auf alles, sobald Kopf und Mechanik stehen (lvPlaceHead) – bis selbst gedreht/gezoomt wird
  lvTheme();
}

/* Drucker-Mechanik ungefähr wie beim Kobra S1 (CoreXY, das Bett fährt nach unten): Kopf ≈ 56 × 48 × 70 mm (geschätzt, keine
   offiziellen Maße), darüber die X-Traverse über die ganze Breite und links/rechts die Y-Schienen – beide auf Höhe des
   Kopfes, sie fahren mit der Düse mit. Dazu der Umriss des Druckbetts. Maße in mm, Koordinaten wie die Bahnen. */
const LV_HEAD = { w: 56, d: 48, h: 100, tip: 8 },   // h: bis über die Riemen (sie enden im Kopf)
      LV_GANTRY_Z = 52, LV_RAIL = 10, LV_FRAME_H = 330, LV_ROD_R = 4;
// Riemenebenen (über den X-Stangen): wie im Kobra S1 rechter Motor (A) oben, linker (B) unten
/* nach dem Foto des Kobra S1 (2026-10-08): an der Traverse zwei X-Stangen – oben knapp unter der Kopfoberkante, unten etwa
   auf halber Kopfhöhe – und dazwischen die zwei Riemen übereinander in derselben Ebene; Y-Stangen auf Höhe der oberen X-Stange.
   z relativ zur Traverse (= Düse + LV_GANTRY_Z) */
const LV_BELT_Z = { A: 23, B: 12 }, LV_ROD_Z = [0, 35];
// Stangen und Riemen sitzen im hinteren Viertel bis Drittel des Kopfes (Foto): Traverse liegt so weit hinter der Düse
const LV_BEAM_DY = 13;
const LV_BELT_GAP = 8, LV_BELT_SPAN = 12;   // Strangabstand je Seite (Umkehrrolle vorn: Durchmesser 12 mm)   // Abstand der beiden Riemenstränge je Seite (Motor ↔ Umlenkung)
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
  for (const k of ['head', 'gantry', 'bed', 'frameFixed', 'mechG', 'zArms']) if (lv[k]) { lv.scene.remove(lv[k]); lv[k] = null; }
  lv.motorCaps = []; lv.zScrews = []; lv.zDrive = null;
  /* Druckkopf und Mechanik (2026-10-07, vorher Glaskästen): beleuchtete Teile, leicht durchscheinend, damit das Teil
     sichtbar bleibt. Graphit-Gehäuse (der Petrol-Streifen verdeckte das Teil – entfernt), Lüfterring vorn, Alu-Heizblock, Messingdüse; X-Traverse als
     Alu-Profil mit Nut und Laufwagen, Y-Schienen als Stahlstangen. */
  const H = LV_HEAD, mat = (c, o) => new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.55, metalness: o.m ?? 0.1, transparent: (o.op ?? 1) < 1, opacity: o.op ?? 1, depthWrite: (o.op ?? 1) >= 1, flatShading: !!o.flat });
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
  // undurchsichtig und 2 mm über dem Gehäuse – durchscheinend verschwand er von der Seite hinter dem Gehäuse (2026-10-08)
  const ringSh = rounded(H.w + 4, H.d + 4, 12); ringSh.holes.push(rounded(H.w - 2, H.d - 2, 9.5));
  const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(ringSh, { depth: 12, bevelEnabled: false, curveSegments: 8 }), mat(0xf26a21, { r: 0.45 })); ring.position.z = bodyZ - 2; ring.renderOrder = 1;
  // Lüfter vorn (−Y): dunkler Ring, schwarze Scheibe, Nabe
  const fanR = Math.min(H.w, H.h) * 0.24, fan = new THREE.Group(), fanZ = bodyZ + bodyH * 0.64;   // Bauteillüfter, oberes Drittel der Front (Foto)
  fan.add(new THREE.Mesh(new THREE.TorusGeometry(fanR, 1.8, 10, 40), mat(0x2a2f33, { r: 0.6 })), new THREE.Mesh(new THREE.CircleGeometry(fanR - 0.5, 40), mat(0x0f1215, { r: 0.8 })),
    new THREE.Mesh(new THREE.CircleGeometry(fanR * 0.32, 24), mat(0x2a2f33, { r: 0.6 })));
  fan.children[2].position.z = 0.2;
  fan.rotation.x = Math.PI / 2; fan.position.set(0, -(H.d / 2) - 2.2, fanZ); lv.headFan = fan; lv.rotors = [];
  lv.head = new THREE.Group(); lv.head.add(tip, heat, body, ring, fan); lv.head.visible = false;
  lv.hotM = [heat.material, tip.material];   // glühen nach Düsentemperatur (lvFx)
  // Mechanik (Koordinaten relativ zur Traverse, die mit dem Kopf in Z fährt)
  const bed = lvBed(), bx0 = bed.x0 - lv.cx, bx1 = bed.x1 - lv.cx, by0 = bed.y0 - lv.cy, by1 = bed.y1 - lv.cy, R = LV_RAIL;
  const md = lvModel(); lv.kin = md.kin;
  /* CoreXY in den Maßen des Kobra S1 (2026-10-08): Gehäuse ≈ Bauraum + 150 × 160 mm (S1: 400 × 410), Höhe Bauraum + 180,
     Y-Stangen 32 mm innen am Rahmen, Stangen Ø 8 mm, NEMA-17-Motoren 42 × 42 × 40 mm */
  const halfW = md.size[0] / 2 + 75, halfD = md.size[1] / 2 + 80, cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const m = md.kin === 'bed' ? 22 : halfW - 32 - (bx1 - bx0) / 2;
  const len = bx1 - bx0 + 2 * m, ylen = md.kin === 'bed' ? by1 - by0 + 2 * m : 2 * halfD - 40;
  // Stangen silbern (beim Kobra S1 Stahl – auf dem Produktbild nur orange angeleuchtet)
  const rodM = mat(0xd9dee1, { m: 0.55, r: 0.25 });
  const black = mat(0x1d2124, { r: 0.6 }), steel = mat(0xd5dbde, { m: 0.5, r: 0.3 }), frameM = mat(0x2a3034, { r: 0.7, op: 0.45 });   // rauchig wie im Produktbild, versperrt die Sicht nicht
  // X: zwei Stangen (der Kopf hängt daran), Eckwagen an den Enden; fährt in Y (lvPlaceHead: beam.position.y)
  const beam = new THREE.Group(), rodX = new THREE.CylinderGeometry(LV_ROD_R, LV_ROD_R, len, 20);
  // zwei X-Stangen übereinander (wie am Kobra S1), der Kopf gleitet darauf
  for (const dz of LV_ROD_Z) { const r = new THREE.Mesh(rodX, rodM); r.rotation.z = Math.PI / 2; r.position.set(0, 0, dz); beam.add(r); }
  /* Eckwagen an den Y-Schienen (nach Foto): offenes Gehäuse – Führung um die Y-Stange, Boden- und Deckplatte, Außenwand;
     darin die beiden Umlenkrollen der Riemen (lvMechInit, bei x = Schiene ± LV_BELT_GAP), zur Mitte hin offen und sichtbar.
     Koordinaten der Traverse: Riemen bei y = −9 − LV_BEAM_DY */
  const by_ = -9 - LV_BEAM_DY, cy0 = by_ - 12, cy1 = 16, cd = cy1 - cy0, cmid = (cy0 + cy1) / 2;
  for (const sx of [-1, 1]) {
    const car = new THREE.Group(), xr = sx * len / 2, inner = -sx, box = (w, d, h, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), black); o.position.set(x, y, z); car.add(o); };
    box(16, cd, 16, xr, cmid, LV_ROD_Z[1]);                                                  // Führung um die Y-Stange
    box(34, cd, 3, xr + inner * 9, cmid, LV_BELT_Z.B - LV_BELT_H / 2 - 4);                    // Bodenplatte unter den Rollen
    box(34, cd, 3, xr + inner * 9, cmid, LV_BELT_Z.A + LV_BELT_H / 2 + 6);                    // Deckplatte über den Rollen
    box(3, cd, LV_BELT_Z.A - LV_BELT_Z.B + LV_BELT_H + 10, xr - inner * 7, cmid, (LV_BELT_Z.A + LV_BELT_Z.B) / 2 + 1);   // Außenwand
    box(24, 22, LV_ROD_Z[1] + 2 * LV_ROD_R + 10, xr + inner * 6, 0, LV_ROD_Z[1] / 2);        // umfasst die Enden beider X-Stangen
    beam.add(car); }
  beam.position.x = cx;
  // Y: je Seite eine Stange durch die Eckwagen
  const rodY = new THREE.CylinderGeometry(LV_ROD_R, LV_ROD_R, ylen, 20), rails = [bx0 - m, bx1 + m].map(x => { const r = new THREE.Mesh(rodY, rodM); r.position.set(x, cy, md.kin === 'bed' ? -R * 0.6 : LV_ROD_Z[1]); return r; });
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
    for (const x of [bx0 - m + 14, bx1 + m - 14]) { const sc = lvLeadScrew(4, fh - 30); sc.rotation.x = Math.PI / 2; sc.position.set(x, 16, top - fh / 2); frame.add(sc); }   // Z-Spindeln
    const mo = new THREE.Mesh(slab(30, 30, 34, 3, 1), mat(0x30373c, { r: 0.5 })); mo.position.set(bx0 - m - 4, 0, -14); beam.add(mo);   // X-Motor (fährt mit der X-Achse)
    lv.frameFixed = frame; frame = new THREE.Group();
  } else {
    lv.frameFixed = null;
  // Rahmen: oben und unten ein Rechteck aus 20er-Profilen, vier Säulen; oben auf Höhe der Riemen
  const fx0 = cx - halfW, fx1 = cx + halfW, fy0 = cy - halfD, fy1 = cy + halfD, fw = 20, fh = md.size[2] + 180, top = LV_ROD_Z[1] + 18;
  const bar = (x0, y0, z0, x1, y1, z1) => { const g = new THREE.Mesh(new THREE.BoxGeometry(Math.max(fw, x1 - x0), Math.max(fw, y1 - y0), Math.max(fw, z1 - z0)), frameM); g.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); frame.add(g); };
  for (const z of [top, top - fh]) { bar(fx0, fy0, z, fx1, fy0, z); bar(fx0, fy1, z, fx1, fy1, z); bar(fx0, fy0, z, fx0, fy1, z); bar(fx1, fy0, z, fx1, fy1, z); }
  for (const x of [fx0, fx1]) for (const y of [fy0, fy1]) bar(x, y, top - fh, x, y, top);
  // blaue NEMA-17-Motoren in den hinteren Ecken, Riemenscheibe je auf der Höhe ihres Riemens (links B unten, rechts A oben)
  const motor = mat(0x3d9fe0, { r: 0.35, m: 0.2 }); motor.emissive = new THREE.Color(0x0c3a5c);
  // Motoren und seitliche Riemenstränge außerhalb des Kopfwegs: innerer Strang ≥ 5 mm neben dem Kopf am Bettrand
  // (Kopf ±LV_HEAD.w/2 um die Düse); die Riemen laufen unter den Y-Stangen, dürfen sie also in x überdecken
  /* Riemenlauf nach der Anycubic-Skizze (2026-10-08): je Seite außen und innen ein Strang (innen = Wagenrolle), hinten zwei
     Rollen nebeneinander mit dem Motor dazwischen davor („Omega“), vorn eine Umkehrrolle. Die Motoren sitzen UNTER den Riemen,
     Welle nach oben – so weit hinten, dass der Kopf auch hinten in der Ecke frei bleibt. Innere Stränge außerhalb des Kopfwegs. */
  const G = LV_BELT_SPAN, xLi = bx0 - LV_HEAD.w / 2 - 16, xLo = xLi - G, xRi = bx1 + LV_HEAD.w / 2 + 16, xRo = xRi + G;   // Wagenrollen (Mitte 5 mm innen) bleiben neben Kopf und Hotend-Lüfter
  const yb = fy1 - 22, yF = fy0 + 34, mL = [xLo + 34, yb - 10], mR = [xRo - 34, yb - 10];
  for (const [[x, y], bz] of [[mL, LV_BELT_Z.B], [mR, LV_BELT_Z.A]]) {
    // unter dem Riemen, Welle nach oben zum Ritzel; Halteblech auf dem Motor zum hinteren Rahmen
    const zMot = bz - LV_BELT_H / 2 - 14 - 40, mo = new THREE.Mesh(slab(42, 42, 40, 4, 1), motor); mo.position.set(x, y, zMot); frame.add(mo);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(48, fy1 - y + 21, 3), black); plate.position.set(x, (y - 21 + fy1) / 2, zMot + 41.5); frame.add(plate);   // ab der Motorkante – nicht in den Kopfweg
    const cap = lvMotorPulley(); cap.rotation.x = Math.PI / 2; cap.position.set(x, y, bz); frame.add(cap);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 14, 12), steel); shaft.rotation.x = Math.PI / 2; shaft.position.set(x, y, bz - LV_BELT_H / 2 - 7); frame.add(shaft);
    lv.motorCaps.push(cap); }
  lv.xy = { xLi, xLo, xRi, xRo, yb, yF, mL, mR, fx0, fx1, fy0, fy1, top }; lv.frameH = fh;
  // Y-Stangen mit Endblöcken an den Rahmenecken (vorn/hinten oben)
  for (const x of [bx0 - m, bx1 + m]) for (const [y0, y1] of [[fy0, cy - ylen / 2 + 10], [cy + ylen / 2 - 10, fy1]]) {
    const blk = new THREE.Mesh(new THREE.BoxGeometry(20, y1 - y0, top - LV_ROD_Z[1] + 16), black); blk.position.set(x, (y0 + y1) / 2, (LV_ROD_Z[1] - 8 + top + 8) / 2); frame.add(blk); }
  // drei Z-Spindeln wie am Kobra S1: hinten in der Mitte, vorne links und vorne rechts
  // direkt am Druckbett: das Bett hängt mit Haltern und Spindelmuttern daran (lv.zArms, bleiben beim Bett)
  // außerhalb des Kopfwegs (Kopf ±LV_HEAD.w/2 bzw. ±LV_HEAD.d/2 um die Düse, + 6 mm), damit sie bis übers Bett reichen dürfen
  const zx = LV_HEAD.w / 2 + 18, zy = LV_HEAD.d / 2 + 18;   // inkl. Lagerböcke (16 mm) und Hotend-Lüfter außen am Kopf
  const zs = [[cx, by1 + zy], [bx0 - zx, by0 + 30], [bx1 + zx, by0 + 30]];
  for (const [x, y] of zs) {
    // reichen bis 12 mm über die Düsenspitze: auch beim höchsten Bettstand (erste Schicht) geht die Spindel durch die Mutter
    const zTop = -LV_GANTRY_Z + 12, zBot = top - fh + 15, sc = lvLeadScrew(4, zTop - zBot);
    sc.rotation.x = Math.PI / 2; sc.position.set(x, y, (zTop + zBot) / 2); frame.add(sc);
    // Lagerböcke oben und unten mit Strebe zur nächsten Rahmenwand (links/rechts bzw. hinten)
    const toX = Math.abs(x - cx) > 40, wall = toX ? (x < cx ? fx0 : fx1) : fy1;
    for (const z of [zTop + 3, zBot - 3]) {
      const brg = new THREE.Mesh(new THREE.BoxGeometry(16, 16, 10), black); brg.position.set(x, y, z); frame.add(brg);
      const L = Math.abs(wall - (toX ? x : y)), st = new THREE.Mesh(new THREE.BoxGeometry(toX ? L : 10, toX ? 10 : L, 6), black);
      st.position.set(toX ? (x + wall) / 2 : x, toX ? y : (y + wall) / 2, z); frame.add(st); }
  }
  // Z-Antrieb unten im Gehäuse: Motor hinten rechts, geschlossener Zahnriemen über die Ritzel der drei Spindeln und des Motors
  lv.zDrive = lvZDrive(frame, zs.concat([[cx + 95, by1 + zy - 6]]), top - fh + 30, () => new THREE.Mesh(slab(42, 42, 40, 4, 1), motor));   // gleiche Form wie die XY-Motoren
  lv.zArms = new THREE.Group();
  const armM = mat(0x3a4146, { r: 0.55 }), nutM = mat(0xc9a14a, { m: 0.5, r: 0.35 });
  for (const [x, y] of zs) {
    // Halter vom Bettrand zur Spindel, Messingmutter um die Spindel – auf Höhe des Betts, fest mit dem Teil
    const ex = Math.max(bx0, Math.min(bx1, x)), ey = Math.max(by0, Math.min(by1, y)), dx = x - ex, dy = y - ey, L = Math.hypot(dx, dy);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(L + 14, 16, 8), armM); arm.position.set((x + ex) / 2, (y + ey) / 2, -8); arm.rotation.z = Math.atan2(dy, dx); lv.zArms.add(arm);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 14, 16), nutM); nut.rotation.x = Math.PI / 2; nut.position.set(x, y, -8); lv.zArms.add(nut);
  }
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
  lvMechInit(md, { bx0, bx1, by0, by1, m, cx, cy, beam });
  lv.scene.add(lv.head, lv.gantry, lv.bed, lv.plate, lv.mechG);
  if (lv.zArms) lv.scene.add(lv.zArms);
  lvTheme();
}
/* Z-Spindel (Trapezgewinde Tr8, 2026-10-08): Kern und erhabene Gänge als Schraubenlinie (echte Geometrie, kein Bild) –
   4 Gänge mit je LV_SCREW_LEAD mm Steigung (= 2 mm Teilung wie beim Tr8x8). Dreht sich mit der Höhe (lvMechUpdate):
   eine Umdrehung je LV_SCREW_LEAD mm Hub, läuft so sichtbar durch die Mutter am Bett. */
const LV_SCREW_LEAD = 8, LV_SCREW_STARTS = 4;
class LvHelix extends THREE.Curve {
  constructor(r, len, turns, phase) { super(); this.r = r; this.len = len; this.turns = turns; this.phase = phase; }
  getPoint(t, out = new THREE.Vector3()) {
    const a = this.phase + t * this.turns * Math.PI * 2;
    return out.set(this.r * Math.cos(a), (t - 0.5) * this.len, this.r * Math.sin(a));
  }
}
function lvLeadScrew(r, len) {
  const g = new THREE.Group(), steelM = new THREE.MeshStandardMaterial({ color: 0xc3cacf, metalness: 0.6, roughness: 0.32 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r - 0.9, r - 0.9, len, 18), new THREE.MeshStandardMaterial({ color: 0x8e979c, metalness: 0.6, roughness: 0.4 })));
  const turns = len / LV_SCREW_LEAD;
  for (let k = 0; k < LV_SCREW_STARTS; k++)
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new LvHelix(r - 0.75, len, turns, k / LV_SCREW_STARTS * Math.PI * 2), Math.ceil(turns * 14), 0.62, 5), steelM));
  lv.zScrews.push(g);
  return g;
}
/* Z-Antrieb (2026-10-08): geschlossener Riemen unten im Gehäuse um die Ritzel (Achse z) an pts (Spindeln + Motor, letzter
   Punkt = Motor). Der Riemen läuft außen um die konvexe Hülle: gerade Stücke tangential, Bögen um die Ritzel. Dreht mit der
   Höhe (lvZDriveSet): eine Spindel-Umdrehung je LV_SCREW_LEAD mm, Riemenweg = Winkel × Ritzelradius. */
function lvZDrive(parent, pts, z, mkMotor) {
  const r = LV_MOTOR_R, cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const ring = pts.map((p, i) => ({ p, i, a: Math.atan2(p[1] - cy, p[0] - cx) })).sort((u, v) => u.a - v.a);   // gegen den Uhrzeigersinn
  const pulleys = [], segs = [], box = new THREE.BoxGeometry(1, 1, 1);
  for (const { p, i } of ring) {
    const pu = lvMotorPulley(); pu.rotation.x = Math.PI / 2; pu.position.set(p[0], p[1], z); parent.add(pu); pulleys.push(pu);
    if (i === pts.length - 1) {   // Motor unter seinem Ritzel
      const mo = mkMotor(); mo.position.set(p[0], p[1], z - LV_BELT_H / 2 - 8 - 40); parent.add(mo);   // abgerundet, Oberseite unter dem Ritzel
    }
  }
  // Weg: je Kante gerade (außen tangential, Normale nach außen), je Ecke Bogen um das Ritzel
  const n = ring.length, pieces = [];
  const norm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };   // rechts der Laufrichtung = außen (CCW)
  for (let k = 0; k < n; k++) {
    const A = ring[k].p, B = ring[(k + 1) % n].p, nn = norm(A, B);
    pieces.push({ line: [[A[0] + nn[0] * r, A[1] + nn[1] * r], [B[0] + nn[0] * r, B[1] + nn[1] * r]] });
    const C = ring[(k + 2) % n].p, n2 = norm(B, C), a0 = Math.atan2(nn[1], nn[0]);
    let sw = Math.atan2(n2[1], n2[0]) - a0; while (sw > 0) sw -= 2 * Math.PI; while (sw <= -2 * Math.PI) sw += 2 * Math.PI;
    if (sw < -Math.PI) sw += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 16)));
    for (let s2 = 0; s2 < steps; s2++) {
      const t0 = a0 + sw * s2 / steps, t1 = a0 + sw * (s2 + 1) / steps;
      pieces.push({ line: [[B[0] + Math.cos(t0) * r, B[1] + Math.sin(t0) * r], [B[0] + Math.cos(t1) * r, B[1] + Math.sin(t1) * r]] });
    }
  }
  let mat = 0;
  for (const pc of pieces) {
    const [p, q] = pc.line, len = Math.max(0.01, Math.hypot(q[0] - p[0], q[1] - p[1]));
    const tex = lvBeltTexture().clone(); tex.needsUpdate = true; tex.repeat.set(len / LV_BELT_PITCH, 1);
    const mesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    mesh.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, z); mesh.rotation.z = Math.atan2(q[1] - p[1], q[0] - p[0]); mesh.scale.set(len + 0.4, LV_BELT_T, LV_BELT_H);
    parent.add(mesh); segs.push({ mesh, at: mat }); mat += len;
  }
  return { pulleys, segs, r };
}
function lvZDriveSet(d, z) {
  if (!d) return;
  const ang = -(z / LV_SCREW_LEAD) * Math.PI * 2, travel = ang * d.r;
  for (const pu of d.pulleys) pu.rotation.y = ang;
  for (const s2 of d.segs) s2.mesh.material.map.offset.x = (s2.at + travel) / LV_BELT_PITCH;
}
/* Riemen, Schleppkette und Filamentschlauch (2026-10-08, Spielerei): CoreXY mit zwei Riemen übereinander – Motoren hinten,
   Umlenkrollen vorn und an den Eckwagen, beide Enden am Kopf; Riemen A läuft mit x + y, B mit x − y (CoreXY), die Zähne
   wandern mit. Bettschubser: X-Riemen an der Traverse (läuft mit x), Y-Riemen unter dem Bett (läuft mit y). Schleppkette
   vom Rahmen hinten oben zum Kopf, daneben der PTFE-Schlauch mit dem Filament in der Farbe der gerade gedruckten Bahn. */
const LV_BELT_PITCH = 4, LV_BELT_H = 6, LV_BELT_T = 1.4, LV_CHAIN_LINKS = 26, LV_ROLL_R = 5, LV_MOTOR_R = 6.5;
let lvBeltTex = null;
function lvBeltTexture() {
  if (lvBeltTex) return lvBeltTex;
  const c = document.createElement('canvas'); c.width = 32; c.height = 8;
  const g = c.getContext('2d'); g.fillStyle = '#16191b'; g.fillRect(0, 0, 32, 8); g.fillStyle = '#4a5156'; g.fillRect(0, 0, 12, 8);
  lvBeltTex = new THREE.CanvasTexture(c); lvBeltTex.wrapS = THREE.RepeatWrapping;
  return lvBeltTex;
}
/* Umlenkrolle und Motorritzel (2026-10-08): Achse y (wie CylinderGeometry), gedreht wird um y.
   Rolle: Bordscheiben oben/unten, glatte Lauffläche, Lagerscheibe mit drei Löchern (Drehung sichtbar), Achse mit Sechskantkopf.
   Ritzel: GT2-Zahnscheibe (20 Zähne) mit Bordscheibe unten und Nabe mit Madenschraube oben. Geometrien einmal, geteilt. */
let lvPulleyParts = null;
function lvPulleyKit() {
  if (lvPulleyParts) return lvPulleyParts;
  const h = LV_BELT_H, R = LV_ROLL_R, M = LV_MOTOR_R;
  const alu = new THREE.MeshStandardMaterial({ color: 0xd8dde0, metalness: 0.3, roughness: 0.38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b3135, metalness: 0.3, roughness: 0.5 });
  const steelM = new THREE.MeshStandardMaterial({ color: 0xe1e5e8, metalness: 0.7, roughness: 0.25 });
  // Zahnscheibe: Umriss mit 20 Zähnen, extrudiert und auf die y-Achse gelegt
  // Zahnkranz (GT2): Umriss mit N Zähnen, extrudiert und auf die y-Achse gelegt – für Ritzel (20 Zähne) und Umlenkrollen (16)
  const gearGeo = (N, ro, rr, depth) => {
    const sh = new THREE.Shape();
    for (let i = 0; i < N * 4; i++) { const a = i / (N * 4) * Math.PI * 2, rad = (i % 4 === 1 || i % 4 === 2) ? ro : rr; const x = Math.cos(a) * rad, y = Math.sin(a) * rad; i ? sh.lineTo(x, y) : sh.moveTo(x, y); }
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -depth / 2, 0); return g;
  };
  const gearG = gearGeo(20, M, M - 0.9, h + 0.4), idlerG = gearGeo(16, R, R - 0.8, h);
  lvPulleyParts = {
    alu, dark, steelM, gearG, idlerG,
    flange: new THREE.CylinderGeometry(R + 1.8, R + 1.8, 0.9, 24), body: new THREE.CylinderGeometry(R, R, h, 24),
    bearing: new THREE.CylinderGeometry(R * 0.62, R * 0.62, 0.4, 20), hole: new THREE.CylinderGeometry(0.7, 0.7, 0.5, 8),
    axle: new THREE.CylinderGeometry(1.2, 1.2, h + 6, 10), bolt: new THREE.CylinderGeometry(2.4, 2.4, 1.6, 6),
    mflange: new THREE.CylinderGeometry(M + 1.6, M + 1.6, 0.9, 28), hub: new THREE.CylinderGeometry(M * 0.85, M * 0.85, 5, 24),
    screw: new THREE.CylinderGeometry(0.9, 0.9, 1.4, 8), shaft: new THREE.CylinderGeometry(1.25, 1.25, h + 7, 12)
  };
  return lvPulleyParts;
}
function lvIdler() {
  const P = lvPulleyKit(), h = LV_BELT_H, g = new THREE.Group(), add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; g.add(o); return o; };
  add(P.idlerG, P.alu, 0); add(P.flange, P.alu, h / 2 + 0.45); add(P.flange, P.alu, -h / 2 - 0.45);   // Zahnkranz zwischen den Bordscheiben
  add(P.bearing, P.dark, h / 2 + 1.1);
  for (let k = 0; k < 3; k++) { const o = add(P.hole, P.alu, h / 2 + 1.2), a = k / 3 * Math.PI * 2; o.position.x = Math.cos(a) * LV_ROLL_R * 0.4; o.position.z = Math.sin(a) * LV_ROLL_R * 0.4; }
  add(P.axle, P.steelM, 1.5); add(P.bolt, P.steelM, h / 2 + 3.6);
  return g;
}
function lvMotorPulley() {
  const P = lvPulleyKit(), h = LV_BELT_H, g = new THREE.Group(), add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; g.add(o); return o; };
  add(P.gearG, P.alu, 0); add(P.mflange, P.alu, -h / 2 - 0.45);
  add(P.hub, P.alu, h / 2 + 2.5);
  const set = add(P.screw, P.dark, h / 2 + 2.5); set.rotation.z = Math.PI / 2; set.position.x = LV_MOTOR_R * 0.85;   // Madenschraube in der Nabe
  add(P.shaft, P.steelM, 0);
  return g;
}
/* Riemen: Linienzüge (2D, Höhe z), in Laufrichtung des Riemens hintereinander, beginnend an einer Klemme (Kopf bzw. Bett).
   Ein Zahn sitzt immer gleich weit (entlang des Riemens) von der Klemme – die Zahnlage ergibt sich so aus der Geometrie:
   fährt der Kopf, ändern sich die Längen der Abschnitte und die Zähne wandern richtig, ohne zu rutschen; die Rollen drehen
   sich um den Weg, der über sie gelaufen ist. */
function lvBelt(parent, z, paths) {
  const belt = { z, segs: [], rolls: [], paths, parent, box: new THREE.BoxGeometry(1, 1, 1) };
  for (const n of paths(0, 0)) for (let k = 1; k < n.length - 1; k++) { const r = lvIdler(); r.rotation.x = Math.PI / 2; parent.add(r); belt.rolls.push(r); }
  return belt;
}
// Riemenstück (Quader mit wandernden Zähnen); fehlende werden bei Bedarf angelegt, überzählige ausgeblendet
function lvBeltSeg(b, i) {
  if (!b.segs[i]) {
    const tex = lvBeltTexture().clone(); tex.needsUpdate = true;
    const mesh = new THREE.Mesh(b.box, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    b.parent.add(mesh); b.segs[i] = mesh;
  }
  return b.segs[i];
}
/* Riemen um die Rollen: Linienzüge (in Laufrichtung, ab der Klemme) → je Ecke eine Rolle, an der der Riemen tangential
   anliegt; zwischen den Berührpunkten folgt er dem Kreisbogen (Sehnen à ≤ 11,25°). Zwei Ecken mit kurzem Stück in dieselbe
   Richtung = Umkehr (Halbkreis, eine Rolle, Durchmesser = Strangabstand). Zwischen zwei Linienzügen (CoreXY: am Motor) läuft
   der Riemen im Bogen ums Ritzel (Radius joinR). Zahnlage = Riemenweg ab der Klemme. Ergebnis: Riemenweg am Motor. */
function lvBeltSet(b, px, py, joinR) {
  const paths = b.paths(px, py), R = LV_ROLL_R, P = [], kind = [];
  paths.forEach((n, pi) => n.forEach((q, k) => { if (pi && !k) return; P.push(q); kind.push(k === 0 && !pi ? 'end' : (k === n.length - 1 && pi < paths.length - 1 ? 'join' : (k === n.length - 1 ? 'end' : 'roll'))); }));
  const dir = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l, l]; };
  const corners = [];
  let ri = 0;
  for (let k = 1; k < P.length - 1; k++) {
    const a = dir(P[k - 1], P[k]), c = dir(P[k], P[k + 1]), turn = Math.sign(a[0] * c[1] - a[1] * c[0]) || 1;
    if (kind[k] === 'roll' && kind[k + 1] === 'roll' && k + 2 < P.length) {
      const e = dir(P[k + 1], P[k + 2]);
      if (c[2] < 2 * R * 1.6 + 6 && turn === (Math.sign(c[0] * e[1] - c[1] * e[0]) || 1)) {
        const half = c[2] / 2, nx = -c[1] * turn, ny = c[0] * turn;
        // Halbkreis: Mitte zwischen den Strängen, Berührpunkte auf beiden Strängen auf Höhe der Mitte
        corners.push({ cx: (P[k][0] + P[k + 1][0]) / 2 + nx * half, cy: (P[k][1] + P[k + 1][1]) / 2 + ny * half, r: half,
          tin: [P[k][0] + nx * half, P[k][1] + ny * half], tout: [P[k + 1][0] + nx * half, P[k + 1][1] + ny * half], sweep: Math.PI * turn, roll: ri, hide: ri + 1 });
        ri += 2; k++; continue;
      }
    }
    const r = kind[k] === 'join' ? (joinR || R) : R, phi = Math.acos(Math.max(-1, Math.min(1, a[0] * c[0] + a[1] * c[1]))), d = r * Math.tan(phi / 2);
    const bx = c[0] - a[0], by = c[1] - a[1], bl = Math.hypot(bx, by) || 1, off = r / Math.max(0.2, Math.cos(phi / 2));
    corners.push({ cx: P[k][0] + bx / bl * off, cy: P[k][1] + by / bl * off, r, tin: [P[k][0] - a[0] * d, P[k][1] - a[1] * d], tout: [P[k][0] + c[0] * d, P[k][1] + c[1] * d],
      sweep: phi * turn, roll: kind[k] === 'roll' ? ri++ : null });
  }
  let si = 0, mat = 0, motorAt = 0, cur = P[0];
  const line = (p, q) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.max(0.01, Math.hypot(dx, dy)), mesh = lvBeltSeg(b, si++);
    mesh.visible = true; mesh.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, b.z); mesh.rotation.z = Math.atan2(dy, dx); mesh.scale.set(len + 0.4, LV_BELT_T, LV_BELT_H);
    const t = mesh.material.map; t.repeat.set(len / LV_BELT_PITCH, 1); t.offset.x = mat / LV_BELT_PITCH;
    mat += len;
  };
  for (const c of corners) {
    line(cur, c.tin);
    if (c.roll != null) { const r = b.rolls[c.roll]; r.visible = true; r.position.set(c.cx, c.cy, b.z); r.scale.set(c.r / R, 1, c.r / R); r.rotation.y = -mat / c.r; }
    if (c.hide != null) b.rolls[c.hide].visible = false;
    if (c.roll == null) motorAt = mat;
    // Bogen um die Rolle (Riemenmitte auf dem Umfang – wie die geraden Stücke, die die Rolle tangential berühren)
    const rr = c.r, a0 = Math.atan2(c.tin[1] - c.cy, c.tin[0] - c.cx), steps = Math.max(2, Math.ceil(Math.abs(c.sweep) / (Math.PI / 16)));
    let prev = [c.cx + Math.cos(a0) * rr, c.cy + Math.sin(a0) * rr];
    for (let s2 = 1; s2 <= steps; s2++) { const an = a0 + c.sweep * s2 / steps, q = [c.cx + Math.cos(an) * rr, c.cy + Math.sin(an) * rr]; line(prev, q); prev = q; }
    cur = c.tout;
  }
  line(cur, P[P.length - 1]);
  for (let k = si; k < b.segs.length; k++) b.segs[k].visible = false;
  return [motorAt];
}
/* Gehäuse für die festen Eckrollen (2026-10-08): Rollen, die bei zwei Kopfstellungen am selben Ort bleiben, liegen in den
   Ecken; nahe beieinander liegende (hinten die beiden am Motor) teilen sich eines. Je Gehäuse Boden- und Deckplatte über beide
   Riemenebenen und ein Pfosten an der äußeren Ecke – wie die Eckwagen schwarz und zur Mitte hin offen. */
function lvCornerHousings() {
  const pos = q => { const out = []; for (const { b, go } of lv.belts) { const [px, py] = go(q); lvBeltSet(b, px, py, LV_MOTOR_R); b.rolls.forEach(r => out.push(r.visible ? [r.position.x, r.position.y, r.scale.x * LV_ROLL_R] : null)); } return out; };
  const a = pos({ x: -60, y: -50, z: 0 }), b2 = pos({ x: 70, y: 60, z: 0 });
  const fixed = a.filter((p, i) => p && b2[i] && Math.hypot(p[0] - b2[i][0], p[1] - b2[i][1]) < 0.01);
  const clusters = [];
  for (const p of fixed) {
    const c = clusters.find(c => c.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 60));
    c ? c.push(p) : clusters.push([p]);
  }
  const black = new THREE.MeshStandardMaterial({ color: 0x1d2124, roughness: 0.6 }), m = 4;
  const z0 = LV_BELT_Z.B - LV_BELT_H / 2 - 4, z1 = LV_BELT_Z.A + LV_BELT_H / 2 + 3;
  for (const c of clusters) {
    const x0 = Math.min(...c.map(p => p[0] - p[2])) - m, x1 = Math.max(...c.map(p => p[0] + p[2])) + m;
    const y0 = Math.min(...c.map(p => p[1] - p[2])) - m, y1 = Math.max(...c.map(p => p[1] + p[2])) + m, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const z of [z0, z1]) { const pl = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 3), black); pl.position.set(cx, cy, z); lv.gantry.add(pl); }
    // Pfosten an der äußeren Ecke (weg von der Mitte)
    const px = cx < 0 ? x0 + 4 : x1 - 4, py = cy < 0 ? y0 + 4 : y1 - 4;
    const post = new THREE.Mesh(new THREE.BoxGeometry(8, 8, z1 - z0), black); post.position.set(px, py, (z0 + z1) / 2); lv.gantry.add(post);
  }
}
/* Gehäuse und ACE (2026-10-08, zuschaltbar, Standard an – Schalter unten links): Gehäuse aus Seiten- und Rückwand,
   Glastür vorn und Glasdeckel oben (durchscheinend, die Mechanik bleibt sichtbar). Daneben die ACE-Pro-Einheiten
   (370 × 290 × 240 mm, klare Haube, je 4 Spulen in den Farben der Slots aus dem Druckerstand), von jedem Slot ein PTFE-Schlauch mit
   Filament zum Verteiler hinten oben am Drucker. Beides hängt am Rahmen (fährt relativ zum Teil in Z mit). */
const LV_ACE = { w: 370, d: 290, h: 240, spoolR: 98, spoolW: 64, gap: 150 }, LV_SPOOL_CORE = 30;
// Kamera so weit zurück, dass alles Sichtbare (Bett, Mechanik, Gehäuse, ACE) ins Bild passt – frontal von vorn
// Neu einpassen, solange nicht selbst gedreht/gezoomt wurde (Größe der Ansicht, ACE-Einheiten oder Schalter geändert)
function lvRefit() { if (lv.autoFit) { lv.fitPending = true; lvTryFit(); } }
// erst einpassen, wenn Kopf und Mechanik stehen und die Ansicht eine Größe hat (in HA ist sie beim Laden oft noch verdeckt)
function lvTryFit() {
  const el = $('wbLiveStage');
  if (!lv.fitPending || !lv.head || !lv.head.visible || !el || !el.clientWidth || !el.clientHeight) return;
  lv.fitPending = false; lvFitAll(); lvRender();
}
function lvFitAll() {
  if (!lv.gantry) return;
  lv.scene.updateMatrixWorld(true);
  const bb = new THREE.Box3(), tmp = new THREE.Box3();
  lv.scene.traverseVisible(o => { if ((o.isMesh || o.isLineSegments) && !o.isPoints && o.geometry) {
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); if (isFinite(tmp.min.x)) bb.union(tmp); } });
  if (bb.isEmpty()) return;
  const c = bb.getCenter(new THREE.Vector3()), cam = lv.camera, dir = new THREE.Vector3(0, -1, 0.35).normalize();   // frontal von vorn, leicht von oben
  // Abstand so, dass jede Ecke der Hülle in den Bildausschnitt fällt (10 % Rand)
  const tv = Math.tan(cam.fov * Math.PI / 360) * 0.9, th = tv * (cam.aspect || 1), right = new THREE.Vector3().crossVectors(dir, cam.up).normalize(), up = new THREE.Vector3().crossVectors(right, dir);
  let dist = 0;
  for (let k = 0; k < 8; k++) {
    const q = new THREE.Vector3(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).sub(c);
    const zf = q.dot(dir);   // Richtung Kamera positiv
    dist = Math.max(dist, zf + Math.abs(q.dot(right)) / th, zf + Math.abs(q.dot(up)) / tv);
  }
  lv.controls.target.copy(c); cam.position.copy(c).add(dir.multiplyScalar(dist)); cam.far = Math.max(cam.far, dist * 4); cam.updateProjectionMatrix(); lv.controls.update();
}
function lvEnclosureInit(g) {
  const { fx0, fx1, fy0, fy1, top } = lv.xy, fh = lv.frameH, bot = top - fh, cx = (fx0 + fx1) / 2, cy = (fy0 + fy1) / 2;
  const x0 = fx0 - 12, x1 = fx1 + 12, y0 = fy0 - 12, y1 = fy1 + 12, z0 = bot - 40, z1 = top + 40;
  const panel = new THREE.MeshStandardMaterial({ color: 0x3c4348, roughness: 0.55, metalness: 0.3, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb4be, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  const rim = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.5 });
  const enc = new THREE.Group(), box = (w, d, h, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), m); o.position.set(x, y, z); o.renderOrder = 6; enc.add(o); return o; };
  box(4, y1 - y0, z1 - z0, x0, cy, (z0 + z1) / 2, panel); box(4, y1 - y0, z1 - z0, x1, cy, (z0 + z1) / 2, panel);   // Seitenwände
  box(x1 - x0, 4, z1 - z0, cx, y1, (z0 + z1) / 2, panel);                                                              // Rückwand
  box(x1 - x0, y1 - y0, 30, cx, cy, z0 + 15, rim);                                                                     // Sockel
  box(x1 - x0 - 30, 3, z1 - z0 - 60, cx, y0, (z0 + z1) / 2 + 15, glass);                                               // Glastür
  for (const [w, h, x, z] of [[x1 - x0, 15, cx, z1 - 7], [15, z1 - z0 - 30, x0 + 7, (z0 + z1) / 2 + 15], [15, z1 - z0 - 30, x1 - 7, (z0 + z1) / 2 + 15]]) box(w, 6, h, x, y0, z, rim);   // Türrahmen
  box(x1 - x0, y1 - y0, 3, cx, cy, z1, glass);                                                                         // Glasdeckel
  box(x1 - x0, 12, 6, cx, y0 + 6, z1, rim); box(x1 - x0, 12, 6, cx, y1 - 6, z1, rim);
  enc.visible = store.settings.liveEnclosure !== false; lv.gantry.add(enc); lv.enclosureG = enc;
  // Gehäuselicht (lights vom Drucker): warmes Licht oben im Bauraum und eine Leuchtleiste vorn unter dem Deckel (lvFx)
  { const light = new THREE.PointLight(0xffe7c2, 0, Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 0.75, 1); light.position.set(cx, cy, z1 - 40);   // reicht nur über den Bauraum
    const strip = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 60, 6, 3), new THREE.MeshBasicMaterial({ color: 0x3a3f43 })); strip.position.set(cx, y0 + 24, z1 - 6);
    lv.gantry.add(light, strip); lv.encLight = { light, strip }; }
  // Statusrahmen um das Gehäuse: gelb bei Pause, rot bei Fehler/Abbruch, grün bei Druckende (lvFx), sonst unsichtbar
  { const ol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(x1 - x0 + 8, y1 - y0 + 8, z1 - z0 + 8)), new THREE.LineBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0, depthWrite: false }));
    ol.position.set(cx, cy, (z0 + z1) / 2); ol.visible = false; ol.renderOrder = 10; lv.gantry.add(ol); lv.statusLine = ol; }
  // Display oben rechts vorn auf einem Fuß (wie am S1), leicht nach hinten geneigt; zeigt Fortschritt, Schicht, Restzeit (lvDisplay)
  { const dg = new THREE.Group(), dark = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.4, metalness: 0.3 });
    const foot = new THREE.Mesh(new THREE.BoxGeometry(70, 26, 16), new THREE.MeshStandardMaterial({ color: 0xb9c0c4, roughness: 0.35, metalness: 0.6 })); foot.position.z = 8; dg.add(foot);
    const scr = new THREE.Group(); scr.position.set(0, 4, 16 + 44); scr.rotation.x = -0.28; dg.add(scr);
    const bez = new THREE.Mesh(new THREE.BoxGeometry(136, 8, 88), dark); scr.add(bez);
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(128, 80), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
    face.rotation.x = Math.PI / 2; face.position.y = -4.2; scr.add(face);
    dg.position.set(x1 - 78, y0 + 50, z1 + 2); lv.gantry.add(dg);
    lv.display = { g: dg, cv, tex: face.material.map, key: null }; lvDisplay(typeof wb !== 'undefined' && wb.st); }
  // ACE-Einheiten oben auf dem Deckel, Spulen in Slotfarbe, Schläuche zum Verteiler hinten oben
  /* neben dem Drucker (rechts, LV_ACE.gap Abstand), auf derselben Standfläche, übereinander; klare, gerundete Haube */
  const ace = new THREE.Group(), A = LV_ACE, hub = new THREE.Vector3(cx + 100, y1 + 14, z0 + (z1 - z0) * 0.75), ax = x1 + A.gap + A.w / 2;
  const body = new THREE.MeshStandardMaterial({ color: 0x2d3236, roughness: 0.5 });
  const lid = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 });
  const spokeM = new THREE.MeshStandardMaterial({ color: 0xb8c0c5, roughness: 0.4 });
  const hood = (() => {   // Profil (y, z): Rechteck mit großen Radien oben, entlang x extrudiert
    const sh = new THREE.Shape(), d = A.d / 2, h = A.h - 90, r = 55;
    sh.moveTo(-d, 0); sh.lineTo(d, 0); sh.lineTo(d, h - r); sh.quadraticCurveTo(d, h, d - r, h); sh.lineTo(-d + r, h); sh.quadraticCurveTo(-d, h, -d, h - r); sh.lineTo(-d, 0);
    const g2 = new THREE.ExtrudeGeometry(sh, { depth: A.w, bevelEnabled: false, curveSegments: 12 });
    // Profil-x → Welt-y, Profil-y → Welt-z, Extrusion → Welt-x; dann mittig auf die Einheit, Unterkante z = 0
    g2.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    g2.computeBoundingBox(); const bb = g2.boundingBox; g2.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
    // Bodenfläche der Haube weglassen: sie läge genau auf dem Unterteil und flimmerte (Z-Fighting)
    const ps = g2.getAttribute('position'), nm = g2.getAttribute('normal'), keep = [], keepN = [];
    for (let t = 0; t < ps.count; t += 3) {
      if (ps.getZ(t) < 0.01 && ps.getZ(t + 1) < 0.01 && ps.getZ(t + 2) < 0.01) continue;
      for (let v = t; v < t + 3; v++) { keep.push(ps.getX(v), ps.getY(v), ps.getZ(v)); keepN.push(nm.getX(v), nm.getY(v), nm.getZ(v)); }
    }
    const g3 = new THREE.BufferGeometry(); g3.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3)); g3.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
    g2.dispose(); return g3; })();
  lv.aceSpools = []; lv.aceUnitsFx = [];
  for (let u = 0; u < 2; u++) {
    const uz = z0 + u * (A.h + 6), unit = new THREE.Group(); unit.position.set(ax, cy, uz); ace.add(unit);
    // Unterteil als Wanne: Boden, Front, Rückteil mit den Einzügen, Seiten – die Spulen liegen darin, der Einzug unten bleibt sichtbar
    for (const [w, d, h, x, y, z] of [[A.w, A.d, 18, 0, 0, 9], [A.w, A.d / 2 - 100, 90, 0, -(A.d / 2 + 100) / 2, 45], [A.w, A.d / 2 - 100, 90, 0, (A.d / 2 + 100) / 2, 45],
      [12, 200, 90, -A.w / 2 + 6, 0, 45], [12, 200, 90, A.w / 2 - 6, 0, 45]]) { const b1 = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), body); b1.position.set(x, y, z); unit.add(b1); }
    const uLid = lid.clone(); uLid.emissive = new THREE.Color(0xff7a1a); uLid.emissiveIntensity = 0;   // je Einheit: glüht beim Trocknen
    const b2 = new THREE.Mesh(hood, uLid); b2.position.z = 90.5; b2.renderOrder = 7; unit.add(b2);   // klare Haube
    // Schild „Trocknet 55 °C“ links vorn über der Front (nur beim Trocknen)
    const dcv = document.createElement('canvas'); dcv.width = 256; dcv.height = 48;
    const dl = new THREE.Mesh(new THREE.PlaneGeometry(130, 24), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(dcv), transparent: true }));
    dl.rotation.x = Math.PI / 2; dl.position.set(0, -A.d / 2 - 2.5, 104); dl.visible = false; unit.add(dl);
    (lv.aceUnitsFx = lv.aceUnitsFx || [])[u] = { lid: uLid, lbl: dl, cv: dcv, txt: null, dry: false };
    const he = new THREE.LineSegments(new THREE.EdgesGeometry(hood, 25), new THREE.LineBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.9 })); he.position.z = 90.5; unit.add(he);   // Kanten der Haube
    const front = new THREE.Mesh(new THREE.BoxGeometry(A.w * 0.5, 4, 22), new THREE.MeshStandardMaterial({ color: 0x15181a })); front.position.set(0, -A.d / 2 - 1, 28); unit.add(front);
    // helle Leiste oben auf der Front (trägt die Einlässe)
    { const st2 = new THREE.Mesh(new THREE.BoxGeometry(A.w - 16, 42, 3), new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.4, metalness: 0.2 })); st2.position.set(0, -A.d / 2 + 22, 91.5); unit.add(st2); }
    // zwei Tragrollen quer unter allen Spulen (die Spulen liegen mit den Flanschen darauf)
    for (const ry of [-55, 55]) { const ro = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, A.w - 26, 20), new THREE.MeshStandardMaterial({ color: 0x8d969c, metalness: 0.6, roughness: 0.35 }));
      ro.rotation.z = Math.PI / 2; ro.position.set(0, ry, 20 + A.spoolR - Math.sqrt((A.spoolR + 8) ** 2 - ry * ry)); unit.add(ro); }
    for (let k = 0; k < 4; k++) {
      const sx = (k - 1.5) * (A.w - 40) / 4, sp = new THREE.Group(); sp.position.set(sx, 0, 20 + A.spoolR); unit.add(sp);
      const fil = new THREE.Mesh(new THREE.CylinderGeometry(A.spoolR - 14, A.spoolR - 14, A.spoolW - 8, 32), new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6 }));
      fil.rotation.z = Math.PI / 2; sp.add(fil);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(LV_SPOOL_CORE, LV_SPOOL_CORE, A.spoolW - 6, 24), new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.5 }));
      core.rotation.z = Math.PI / 2; sp.add(core);
      // Restmenge als Schild (Text wird bei Änderung neu gezeichnet)
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48;
      // vorn auf der ACE-Front unter der Spule (Fläche zeigt nach vorn, −y)
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(72, 27), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
      lbl.rotation.x = Math.PI / 2; lbl.position.set(sx, -A.d / 2 - 2.5, 70); unit.add(lbl);
      for (const s2 of [-1, 1]) { const fl = new THREE.Mesh(new THREE.CylinderGeometry(A.spoolR, A.spoolR, 2, 32), new THREE.MeshStandardMaterial({ color: 0x1b1e20, roughness: 0.5, transparent: true, opacity: 0.85 })); fl.rotation.z = Math.PI / 2; fl.position.x = s2 * A.spoolW / 2; sp.add(fl);
        // drei helle Speichen außen auf dem Flansch – sonst sähe man das Drehen der runden Spule nicht
        for (let q = 0; q < 3; q++) { const a = q * Math.PI * 2 / 3, spk = new THREE.Mesh(new THREE.BoxGeometry(1, 8, A.spoolR - LV_SPOOL_CORE - 6), spokeM);
          spk.position.set(s2 * (A.spoolW / 2 + 1.2), Math.sin(a) * (A.spoolR + LV_SPOOL_CORE) / 2, Math.cos(a) * (A.spoolR + LV_SPOOL_CORE) / 2); spk.rotation.x = -a; sp.add(spk); } }
      // Schlauch vom Slot (hinten am ACE) zum Verteiler, Filament darin in Slotfarbe
      // hinten aus dem ACE, hinter dem Drucker entlang und von unten in die Zusammenführung (8 Eingänge unten nebeneinander)
      const out = new THREE.Vector3(ax + sx, cy + A.d / 2 + 2, uz + 30), port = hub.clone().add(new THREE.Vector3((u * 4 + k - 3.5) * 5, 0, -22));
      // ein gleichmäßiger Bogen: waagerecht hinten aus dem ACE, senkrecht von unten in den Sammler (Bézier mit Tangenten in beiden Richtungen)
      // Hebel nach Abstand: weite Bögen auch beim oberen ACE, das kaum tiefer liegt als der Sammler
      const lift = port.z - out.z, run = Math.hypot(port.x - out.x, port.y - out.y), L = Math.max(lift, run);
      const curve = new THREE.CubicBezierCurve3(out, new THREE.Vector3(out.x, out.y + 60 + run * 0.12 + k * 5, out.z),
        new THREE.Vector3(port.x, port.y + 4 + k * 2, port.z - L * 0.55), port);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 2.3, 10), new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.3, transparent: true, opacity: 0.35, depthWrite: false }));
      const fm = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 }), fline = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 0.9, 6), fm);
      tube.renderOrder = 8; ace.add(fline, tube);
      // Einzug vorn (wie beim ACE Pro): oranger Einlass in der hellen Leiste direkt vor der Spule, das Filament läuft vorn vom Wickel schräg hinein (lvAceColours)
      const funnel = new THREE.Mesh(new THREE.CylinderGeometry(6, 3, 4, 16), new THREE.MeshStandardMaterial({ color: 0xe8552b, roughness: 0.45 }));
      funnel.position.set(sx, -102, 94); funnel.rotation.x = Math.PI / 2; unit.add(funnel);
      const strand = new THREE.Mesh(new THREE.BufferGeometry(), fm); unit.add(strand);
      // fließendes Filament (nur aktiver Slot): eigenes Material mit wanderndem Leuchtstreifen, Schlauch und Strang zur Spule
      const flow = lvFlowMat(curve.getLength()), flowS = lvFlowMat(150);
      // weicher Leuchtschein um den fließenden Faden (additiv, dieselbe wandernde Textur)
      const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 2.2, 8), lvGlowMat(flow)), glowS = new THREE.Mesh(new THREE.BufferGeometry(), lvGlowMat(flowS));
      glow.renderOrder = glowS.renderOrder = 9; glow.visible = glowS.visible = false; ace.add(glow); unit.add(glowS);
      lv.aceSpools.push({ unit: u, slot: k, fil: fil.material, filMesh: fil, line: fm, group: sp, tubes: [tube, fline], lbl, cv, txt: null,
        strand, spoolC: new THREE.Vector3(sx, 0, 20 + A.spoolR), inlet: new THREE.Vector3(sx, -102, 95), k: null,
        funnel: funnel.material, flow, flowS, glow, glowS, loaded: false, active: false });
    }
  }
  const hubM = new THREE.Mesh(new THREE.BoxGeometry(48, 18, 44), body); hubM.position.copy(hub); ace.add(hubM);   // Zusammenführung hinten an der Rückwand, von hinten gesehen links, Mitte der oberen Hälfte
  // Zusammenführung oben raus: lvMechUpdate führt den Kopfschlauch von hier (Rahmen-Koordinaten) hoch, im 90°-Bogen nach vorn durch die Rückwand zur Kette
  lv.hubTop = hub.clone().add(new THREE.Vector3(0, 0, 22));
  ace.visible = store.settings.liveAce !== false; lv.gantry.add(ace); lv.aceG = ace;
  lvAceColours(typeof wb !== 'undefined' && wb.st);
}
// Display am Drucker: Fortschritt in % mit Balken, Schicht und Restzeit; ohne Auftrag „Bereit“ (zeichnet nur bei Änderung neu)
function lvDisplay(st) {
  const D = lv.display; if (!D) return;
  const job = st && st.job, pct = job ? Math.max(0, Math.min(100, Math.round(+job.progress || 0))) : null;
  const own = job && typeof lvRemaining === 'function' && !job.paused ? lvRemaining(st) : null, rem = own ? Math.round(own.s / 60) : job && job.remaining_min;
  const fin = !job && lv.fx && lv.fx.endAt && Date.now() - lv.fx.endAt < LV_END_MS ? lv.fx.end : null;   // gerade fertig/abgebrochen (lvFx)
  const line1 = job ? (job.paused ? t('Pausiert') : t('Druckt')) : fin ? (fin === 'ok' ? t('Fertig') + ' ✓' : t('Abgebrochen')) : st && st.connected === false ? t('Nicht verbunden') : t('Bereit');
  const why = job && job.paused && st.pause_reason ? String(st.pause_reason) : '';
  const line2 = job ? (why ? (why.length > 30 ? why.slice(0, 29) + '…' : why) : t('Schicht {l} von {n}', { l: +job.layer || 0, n: +job.layers || '–' })) : '';
  const line3 = job && rem != null ? (typeof wbMin === 'function' ? wbMin(rem) : rem + ' min') : '';
  const key = [line1, pct, line2, line3].join('|');
  if (key + (fin || '') === D.key) return; D.key = key + (fin || '');
  const g = D.cv.getContext('2d'), W = 320, H = 200;
  g.fillStyle = '#0d1114'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#8fd3c7'; g.font = '600 22px system-ui, sans-serif'; g.textBaseline = 'top'; g.fillText(line1, 16, 14);
  if (job) {
    g.fillStyle = '#ffffff'; g.font = 'bold 64px system-ui, sans-serif'; g.fillText(pct + ' %', 16, 44);
    g.fillStyle = '#2a3338'; g.beginPath(); g.roundRect(16, 120, W - 32, 14, 7); g.fill();
    g.fillStyle = job.paused ? '#f0b44c' : '#2bc4a8'; g.beginPath(); g.roundRect(16, 120, Math.max(14, (W - 32) * pct / 100), 14, 7); g.fill();
    g.fillStyle = '#c9d2d6'; g.font = '20px system-ui, sans-serif'; g.fillText(line2, 16, 148);
    if (line3) { g.textAlign = 'right'; g.fillText(line3, W - 16, 148); g.textAlign = 'left'; }
  } else if (fin) { g.fillStyle = fin === 'ok' ? '#7be0a0' : '#ff7a6b'; g.font = 'bold 40px system-ui, sans-serif'; g.fillText(fin === 'ok' ? '✓' : '✕', 16, 60);
    g.fillStyle = '#c9d2d6'; g.font = '20px system-ui, sans-serif'; const nm = String((st.last_job && st.last_job.name) || ''); g.fillText(nm.length > 26 ? nm.slice(0, 25) + '…' : nm, 16, 150);
  } else { g.fillStyle = '#56636a'; g.font = '20px system-ui, sans-serif'; g.fillText('Kobra S1', 16, 150); }
  D.tex.needsUpdate = true; lvRender();
}
// Spulenfarben aus dem Druckerstand (st.ace: Einheiten mit Slots), fehlende Spulen ausgeblendet, zweite Einheit nur, wenn gemeldet
function lvAceColours(st) {
  if (!lv.aceSpools) return;
  const boxes = (st && st.ace) || [], printing = !!(st && st.job && st.job.name && !st.job.paused);
  for (const sp of lv.aceSpools) {
    const box = boxes[sp.unit], s = box && (box.slots || [])[sp.slot], on = !!(s && s.present && s.colour);
    sp.group.visible = on; sp.tubes[1].visible = on; sp.tubes[0].visible = !!box;   // Schlauch nur, wenn die Einheit da ist
    if (on) { sp.fil.color.set(s.colour); sp.line.color.set(s.colour); }
    // geladener Slot: Einlass leuchtet in Filamentfarbe; beim Drucken dreht die Spule und Pulse laufen im Schlauch (lvAceTick)
    sp.loaded = on && !!s.loaded; sp.active = sp.loaded && printing;
    if (sp.loaded) { sp.funnel.color.set(s.colour); sp.funnel.emissive.set(s.colour); sp.funnel.emissiveIntensity = 0.8; }
    else { sp.funnel.color.set(0xe8552b); sp.funnel.emissiveIntensity = 0; }
    sp.lbl.material.opacity = boxes.some(b => (b.slots || []).some(x => x.loaded)) && !sp.loaded ? 0.45 : 1;   // andere Slots gedimmt
    if (sp.active) for (const m of [sp.flow, sp.flowS]) { m.color.set(s.colour); m.emissive.set(s.colour).lerp(new THREE.Color(0xffffff), 0.5); }
    if (sp.active) for (const o of [sp.glow, sp.glowS]) o.material.color.set(s.colour).lerp(new THREE.Color(0xffffff), 0.3);
    sp.glow.visible = sp.glowS.visible = sp.active;
    sp.tubes[1].material = sp.active ? sp.flow : sp.line; sp.strand.material = sp.active ? sp.flowS : sp.line;
    // Restmenge (Filamentverwaltung, js/spools-ui.js): Wickel so dick wie der Rest, Schild mit Gramm (rot unter 200 g)
    const rec = on && typeof spoolInSlot === 'function' ? spoolInSlot(sp.unit * 4 + sp.slot) : null;
    const pct = rec && rec.net_g > 0 ? Math.max(0, Math.min(1, rec.remaining_g / rec.net_g)) : (on ? 1 : 0);
    const full = LV_ACE.spoolR - 14, k = (LV_SPOOL_CORE + 2 + (full - LV_SPOOL_CORE - 2) * pct) / full;
    sp.filMesh.scale.set(k, 1, k);
    sp.strand.visible = on;
    if (on && k !== sp.k) {   // Strang läuft oben vom Wickel ab, im Viertelbogen vorn um die Spule und senkrecht von oben in den Einlass
      sp.k = k;
      const rw = full * k, C = sp.spoolC, I = sp.inlet, ry = C.y - I.y, pts = [];
      for (let q = 0; q <= 12; q++) { const t = q / 12 * Math.PI / 2; pts.push(new THREE.Vector3(C.x, C.y - ry * Math.sin(t), C.z + rw * Math.cos(t))); }
      for (let q = 1; q <= 3; q++) pts.push(new THREE.Vector3(C.x, I.y, C.z + (I.z - C.z) * q / 3));
      const sc = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      sp.strand.geometry.dispose(); sp.strand.geometry = new THREE.TubeGeometry(sc, 40, 0.9, 6);
      sp.glowS.geometry.dispose(); sp.glowS.geometry = new THREE.TubeGeometry(sc, 40, 2.2, 8);
      sp.flowS.emissiveMap.repeat.x = sc.getLength() / LV_FLOW_MM;
    }
    const txt = on ? (rec ? Math.round(rec.remaining_g) + ' g' : '') : '';
    sp.lbl.visible = !!txt;
    if (txt !== sp.txt) {
      sp.txt = txt;
      const g = sp.cv.getContext('2d'); g.clearRect(0, 0, 128, 48);
      if (txt) { g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect(4, 6, 120, 36, 10); g.fill();
        g.font = 'bold 24px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = rec && rec.remaining_g < 200 ? '#ff6b5e' : '#ffffff'; g.fillText(txt, 64, 25); }
      sp.lbl.material.map.needsUpdate = true;
    }
  }
  if (lv.aceG) lv.aceG.children.forEach(c => { if (c.isGroup && c.position.z > (lv.aceG.children[0].position.z + 10)) c.visible = boxes.length > 1; });
  if (lv.aceUnits !== boxes.length) { lv.aceUnits = boxes.length; lvRefit(); }   // zweite Einheit kam dazu/fiel weg
  // Trocknen je Einheit (drying_status: status 1 = an, target_temp): Haube glüht, Schild mit Temperatur
  (lv.aceUnitsFx || []).forEach((fx, u) => {
    const b = boxes[u], d = b && b.drying, dry = !!(d && +d.status === 1);
    fx.dry = dry; fx.lbl.visible = dry; if (!dry) fx.lid.emissiveIntensity = 0;
    const cur = b && b.temp != null && +b.temp > 0 ? Math.round(+b.temp) : null;
    const txt = dry ? t('Trocknet') + ' ' + (cur != null ? cur + ' °C' : '') + (+d.target_temp > 0 ? ' → ' + Math.round(+d.target_temp) + ' °C' : '') : '';
    if (txt !== fx.txt) {
      fx.txt = txt;
      const g = fx.cv.getContext('2d'); g.clearRect(0, 0, 256, 48);
      if (txt) { g.fillStyle = 'rgba(120,40,0,.75)'; g.beginPath(); g.roundRect(4, 6, 248, 36, 10); g.fill();
        g.font = 'bold 22px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffd2a8'; g.fillText(txt, 128, 25); }
      fx.lbl.material.map.needsUpdate = true;
    }
  });
  if (lv.filGlow) lv.filGlow.visible = lvAceFlowing();   // Fluss zum Kopf endet mit dem Druck
  // Farbwechsel: anderer Slot geladen, während gedruckt wird → altes Filament zurück, neues vor, Spülmenge (lvAceAnimate)
  const now = lv.aceSpools.find(sp => sp.loaded) || null;
  if (printing && lv.aceLast && now && now !== lv.aceLast && !lv.swap)
    lv.swap = { from: lv.aceLast, to: now, t0: performance.now(), c0: lv.aceLast.fil.color.clone(), c1: now.fil.color.clone(), drops: [] };
  if (now) lv.aceLast = now;
  lvAceAnimate();
  lvRender();
}
// Bewegung der ACE: aktive Spule dreht ab, Pulse im Schlauch, Einlass pulsiert, Haube glüht beim Trocknen (~30 Bilder/s, nur wenn nötig)
const LV_ACE_SPIN = 0.9, LV_FLOW_MM = 70, LV_FLOW_V = 80;   // Abstand der Leuchtstreifen und ihr Tempo (mm, mm/s)
// Leuchtstreifen als Textur entlang des Fadens (u = Länge): weicher Kopf, langer Schweif dahinter, dazwischen dunkel
let lvFlowTexBase = null;
function lvFlowMat(len) {
  if (!lvFlowTexBase) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 4;
    const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, '#000'); gr.addColorStop(0.35, '#000'); gr.addColorStop(0.82, '#8a8a8a'); gr.addColorStop(0.9, '#fff'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 4);
    lvFlowTexBase = new THREE.CanvasTexture(cv);
  }
  const tex = lvFlowTexBase.clone(); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(Math.max(1, len / LV_FLOW_MM), 1); tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 1.6, emissiveMap: tex });
}
function lvGlowMat(flow) {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, map: flow.emissiveMap, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
}
function lvAceAnimate() {
  if (lv.aceAnim) return;
  const busy = () => lv.mode === 'live' && !document.hidden && (lvFxBusy() || lv.aceSpools && lv.aceG && lv.aceG.visible)
    && ((lv.aceSpools || []).some(sp => sp.active) || (lv.aceUnitsFx || []).some(fx => fx.dry) || lvFxBusy());   // nur wenn sich etwas tut (Akku am Handy)
  if (!busy()) return;
  let last = 0;
  const tick = (now) => {
    lv.aceAnim = 0;
    if (!busy()) return;
    if (now - last >= 33) {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0, ph = now / 1000;
      last = now;
      for (const sp of lv.aceSpools || []) {
        if (sp.active) sp.funnel.emissiveIntensity = 0.9 + 0.6 * Math.sin(ph * 3);
        if (!sp.active) continue;
        if (lv.swap && sp === lv.swap.to && (now - lv.swap.t0) / 1000 < LV_SWAP_BACK_S) continue;   // neuer Slot wartet, bis das alte Filament zurück ist
        sp.group.rotation.x += LV_ACE_SPIN * dt;   // oben läuft das Filament nach vorn (−y) ab
        // Streifen laufen von der Spule zum Drucker (u wächst Richtung Drucker); Strang und Schlauch gleich schnell
        for (const m of [sp.flow, sp.flowS]) m.emissiveMap.offset.x -= LV_FLOW_V / LV_FLOW_MM * dt;
      }
      if (lv.filFlow) lv.filFlow.emissiveMap.offset.x -= LV_FLOW_V / LV_FLOW_MM * dt;   // Kopfschlauch (lvMechUpdate)
      for (const fx of lv.aceUnitsFx || []) if (fx.dry) fx.lid.emissiveIntensity = 0.35 + 0.25 * Math.sin(ph * 1.6);
      lvSwapTick(now, dt); lvFxTick(ph);
      lvRender();
    }
    lv.aceAnim = requestAnimationFrame(tick);
  };
  lv.aceAnim = requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) lvAceAnimate(); });

/* Farbwechsel (lv.swap aus lvAceColours): 0–2,5 s läuft das alte Filament rückwärts zur ACE (Spule spult auf),
   2,5–5 s das neue schnell vor, ab 3,5 s fallen Tropfen der Spülmenge (alte → neue Farbe) unter der Düse heraus */
const LV_SWAP_BACK_S = 2.5, LV_SWAP_FEED_S = 5, LV_SWAP_END_S = 7;
function lvSwapTick(now, dt) {
  const w = lv.swap; if (!w) return;
  const a = (now - w.t0) / 1000, back = a < LV_SWAP_BACK_S, feed = !back && a < LV_SWAP_FEED_S;
  const show = (sp, on) => { sp.tubes[1].material = on ? sp.flow : sp.line; sp.strand.material = on ? sp.flowS : sp.line; sp.glow.visible = sp.glowS.visible = on; };
  if (back) {
    show(w.from, true); show(w.to, false);
    for (const m of [w.from.flow, w.from.flowS]) { m.color.copy(w.c0); m.emissive.copy(w.c0).lerp(new THREE.Color(0xffffff), 0.5); m.emissiveMap.offset.x += 3 * LV_FLOW_V / LV_FLOW_MM * dt; }
    for (const o of [w.from.glow, w.from.glowS]) o.material.color.copy(w.c0).lerp(new THREE.Color(0xffffff), 0.3);
    w.from.group.rotation.x -= LV_ACE_SPIN * 3 * dt;
    if (lv.filFlow) lv.filFlow.emissiveMap.offset.x += 4 * LV_FLOW_V / LV_FLOW_MM * dt;   // auch im Kopfschlauch rückwärts
  } else if (feed) {
    show(w.from, false); show(w.to, true);
    for (const m of [w.to.flow, w.to.flowS]) m.emissiveMap.offset.x -= 2 * LV_FLOW_V / LV_FLOW_MM * dt;   // zusätzlich zum normalen Fluss
    if (lv.filFlow) lv.filFlow.emissiveMap.offset.x -= 3 * LV_FLOW_V / LV_FLOW_MM * dt;
  }
  if (a >= 3.5 && a < LV_SWAP_END_S - 1 && lv.head && lv.head.visible && w.drops.length < 7 && a - (w.lastDrop || 0) > 0.45) {
    w.lastDrop = a;
    const k = Math.min(1, w.drops.length / 6), m = new THREE.Mesh(new THREE.SphereGeometry(4.5, 10, 8), new THREE.MeshStandardMaterial({ color: w.c0.clone().lerp(w.c1, k), roughness: 0.5, transparent: true }));
    m.position.copy(lv.head.position).add(new THREE.Vector3(0, 0, -2)); lv.scene.add(m); w.drops.push({ m, v: 0, t: a });
  }
  for (const d of w.drops) { d.v += 600 * dt; d.m.position.z -= d.v * dt; d.m.material.opacity = Math.max(0, 1 - (a - d.t) / 1.4); d.m.visible = d.m.material.opacity > 0; }
  if (a >= LV_SWAP_END_S) {
    for (const d of w.drops) { lv.scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); }
    lv.swap = null; lvAceColours(typeof wb !== 'undefined' && wb.st);
  }
}

/* Hitze, Gehäuselicht, Status (aus jedem Druckerstand, liveUpdate): Heizblock/Düse glühen nach Temperatur, die Platte
   schimmert warm, beim Aufheizen pulsiert es; Licht wie am Drucker; Rahmen gelb (Pause), rot (Fehler/Abbruch), grün (fertig) */
const LV_END_MS = 60000, LV_HOT = new THREE.Color(0xff5a14);
function lvFx(st) {
  const fx = lv.fx = lv.fx || {}, T = (st && st.temps) || {}, num = v => (v == null || v === '' || isNaN(+v) ? 0 : +v);
  fx.noz = num(T.curr_nozzle_temp); fx.nozT = num(T.target_nozzle_temp); fx.bed = num(T.curr_hotbed_temp); fx.bedT = num(T.target_hotbed_temp);
  fx.heating = (fx.nozT > 0 && fx.nozT - fx.noz > 5) || (fx.bedT > 0 && fx.bedT - fx.bed > 3);
  const job = st && st.job, lj = st && st.last_job;
  // Druckende: vorher lief ein Auftrag, jetzt keiner – Ergebnis aus last_job (fertig / abgebrochen)
  if (fx.hadJob && !job && lj) { fx.end = lj.status === 'fertig' ? 'ok' : lj.status === 'abgebrochen' ? 'abort' : null; fx.endAt = fx.end ? Date.now() : 0; }
  if (job) { fx.end = null; fx.endAt = 0; }
  // Fehler: Verbindung zum Drucker mitten im Druck verloren (Druckerfehler selbst meldet die Firmware hier nicht)
  fx.err = !!(st && st.connected === false && (fx.hadJob || fx.err));
  fx.hadJob = !!(job && job.name) || (fx.err && fx.hadJob);
  fx.paused = !!(job && job.paused);
  const L = (st && st.lights) || [], on = L.find(l => l && +l.status === 1);
  fx.light = on ? Math.max(0.15, Math.min(1, (+on.brightness || 100) / 100)) : 0;
  lvFxApply(0); lvAceAnimate();
}
function lvFxBusy() {
  const fx = lv.fx; if (!fx) return !!lv.swap;
  return !!lv.swap || fx.heating || fx.paused || fx.err || (fx.endAt && Date.now() - fx.endAt < LV_END_MS);
}
function lvFxApply(ph) {
  const fx = lv.fx; if (!fx) return;
  const pulse = fx.heating ? 0.8 + 0.2 * Math.sin(ph * 4) : 1;
  const kn = Math.max(0, Math.min(1, (fx.noz - 60) / 220)), kb = Math.max(0, Math.min(1, (fx.bed - 35) / 65));
  (lv.hotM || []).forEach((m, i) => { m.emissive.copy(LV_HOT); m.emissiveIntensity = kn * (i ? 0.7 : 1.1) * pulse; });
  if (lv.plate && lv.plate.material.emissive) { lv.plate.material.emissive.copy(LV_HOT); lv.plate.material.emissiveIntensity = kb * 0.28 * pulse; }
  if (lv.encLight) { lv.encLight.light.intensity = fx.light * 2.4; lv.encLight.strip.material.color.set(fx.light ? 0xfff3dd : 0x3a3f43); }
  const ol = lv.statusLine;
  if (ol) {
    const ended = fx.endAt && Date.now() - fx.endAt < LV_END_MS;
    const col = fx.err || (ended && fx.end === 'abort') ? 0xff4a3d : fx.paused ? 0xffc23d : ended ? 0x4fe08a : null;
    ol.visible = col != null;
    if (col != null) { ol.material.color.set(col); ol.material.opacity = 0.55 + 0.4 * Math.sin(ph * (fx.err ? 5 : 2.5)); }
  }
}
function lvFxTick(ph) { lvFxApply(ph); if (lv.display && lv.fx && lv.fx.endAt && typeof wb !== 'undefined') lvDisplay(wb.st); }
function lvMechInit(md, g) {
  const { bx0, bx1, by0, by1, m, cx, beam } = g;
  lv.mechG = new THREE.Group(); lv.mechG.visible = false;
  lv.belts = [];
  if (md.kin === 'bed') {
    // X-Riemen hinter den Stangen der Traverse (Motor links), beide Enden am Kopf
    const xl = bx0 - m - 4 - cx, xr = bx1 + m - 6 - cx;   // Koordinaten der Traverse (beam.position.x = cx)
    lv.belts.push({ b: lvBelt(beam, 0, (px) => [[[px - 14, 12], [xl, 12], [xl, 18], [xr, 18], [xr, 12], [px + 14, 12]]]), go: p => [p.x - cx, 0] });
    // Y-Riemen unter dem Bett (im festen Rahmen, der relativ zum Bett in Y fährt): beide Enden am Bett (lokal y = −py)
    if (lv.frameFixed) {
      const yl = (by1 - by0) * 0.55, zb = -45 + 22;
      lv.belts.push({ b: lvBelt(lv.frameFixed, zb, (px, py) => [[[cx, -py - 6], [cx, -yl], [cx + 6, -yl], [cx + 6, yl], [cx, yl], [cx, -py + 6]]]), go: p => [0, p.y] });
    }
  } else {
    /* CoreXY: zwei Riemen übereinander. A (oben): rechter Motor → vorn rechts → Eckwagen rechts → Kopf; vom Kopf → Eckwagen links
       → hinten links → rechter Motor. B (unten) gespiegelt mit dem linken Motor. Linienzüge ab der Klemme am Kopf. */
    const { xLi, xLo, xRi, xRo, yb, yF, mL, mR } = lv.xy, M = LV_MOTOR_R;
    /* Eckpunkt am Motor so, dass die Ritzelmitte genau auf dem Motor liegt (Riemen läuft unten herum, Omega) */
    const motorCorner = (c, a, b) => {
      let q = c.slice();
      for (let it = 0; it < 3; it++) {
        const d1 = [q[0] - a[0], q[1] - a[1]], d2 = [b[0] - q[0], b[1] - q[1]], l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
        const u = [d1[0] / l1, d1[1] / l1], v = [d2[0] / l2, d2[1] / l2], bx = v[0] - u[0], by = v[1] - u[1], bl = Math.hypot(bx, by) || 1;
        const cosH = Math.sqrt(Math.max(0.04, (1 + u[0] * v[0] + u[1] * v[1]) / 2)), off = M / cosH;
        q = [c[0] - bx / bl * off, c[1] - by / bl * off];
      }
      return q;
    };
    // Riemen B (Motor links, unten): linke Klemme → Wagen links innen → vorn Umkehr → außen nach hinten → Omega um den Motor → hinten nach rechts → rechts innen zum Wagen → rechte Klemme
    const qL = motorCorner(mL, [xLo, yb], [xLo + 50, yb]), qR = motorCorner(mR, [xRo, yb], [xRo - 50, yb]);
    lv.belts.push({ b: lvBelt(lv.gantry, LV_BELT_Z.B, (px, py) => [[[px - 12, py - 9], [xLi, py - 9], [xLi, yF], [xLo, yF], [xLo, yb], qL], [qL, [xLo + 50, yb], [xRi, yb], [xRi, py - 9], [px + 12, py - 9]]]), go: p => [p.x, p.y + LV_BEAM_DY], motor: 0 });
    // Riemen A (Motor rechts, oben): gespiegelt
    lv.belts.push({ b: lvBelt(lv.gantry, LV_BELT_Z.A, (px, py) => [[[px + 12, py - 9], [xRi, py - 9], [xRi, yF], [xRo, yF], [xRo, yb], qR], [qR, [xRo - 50, yb], [xLi, yb], [xLi, py - 9], [px - 12, py - 9]]]), go: p => [p.x, p.y + LV_BEAM_DY], motor: 1 });
  }
  // Schleppkette: Glieder entlang einer Kurve vom Rahmen hinten oben zum Kopf
  const link = new THREE.BoxGeometry(9, 7, 13),   // lange Seite entlang z: lookAt richtet z auf die Kurve
     linkM = new THREE.MeshStandardMaterial({ color: 0x24292d, roughness: 0.65 });
  lv.chain = [];
  for (let k = 0; k < LV_CHAIN_LINKS; k++) { const l = new THREE.Mesh(link, linkM); lv.mechG.add(l); lv.chain.push(l); }
  lv.tubeM = new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.3, transparent: true, opacity: 0.35, depthWrite: false });
  lv.filM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  lv.tube = null; lv.fil = null;
  // Kette: CoreXY vom Rahmen hinten links (großer Bogen über die linke Seite), Bettschubser vom oberen Querholm
  lv.mechAnchor = md.kin === 'bed' ? { x: cx, y: 0, z: md.size[2] + 70 + 14, fixed: true, xmin: bx0 - m }
    : { x: (lv.xy.mL[0] + lv.xy.mR[0]) / 2 - 40, y: lv.xy.fy1 - 30, z: LV_ROD_Z[1] + 30, fixed: false, xmin: lv.xy.fx0 + 25 };   // hinten zwischen den Motoren
  if (md.kin !== 'bed') { lvCornerHousings(); lvEnclosureInit(g); }
  lvFansInit(md, g);
}
/* Lüfter mit Luftstrom (2026-10-08): Bauteillüfter am Kopf (bläst von beiden Seiten zur Düse), Seitenlüfter rechts an der
   Gehäusewand (flacher Fächer übers Bett) und Gehäuselüfter hinten (nach außen) – Stärke und Tempo des Luftstroms nach den gemeldeten
   Werten (st.fans: fan_speed_pct, aux_fan_speed_pct, box_fan_level, je 0–100). Teilchen wandern vom Lüfter weg und verblassen. */
const LV_AIR_N = 110;
let lvAirTex = null;
// weiche runde Flocke für die Luftteilchen
function lvAirSprite() {
  if (lvAirTex) return lvAirTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return (lvAirTex = new THREE.CanvasTexture(c));
}
function lvAirStream(parent, from, dir, len, spread, key, size) {
  const pos = new Float32Array(LV_AIR_N * 3), col = new Float32Array(LV_AIR_N * 3), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: size || 11, map: lvAirSprite(), vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  pts.renderOrder = 4; parent.add(pts);
  const d = new THREE.Vector3(...dir).normalize(), a = Math.abs(d.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(d, a).normalize(), v = new THREE.Vector3().crossVectors(d, u).normalize();
  const t = new Float32Array(LV_AIR_N), r = new Float32Array(LV_AIR_N * 2);
  for (let k = 0; k < LV_AIR_N; k++) { t[k] = Math.random(); const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()); r[2 * k] = Math.cos(ang) * rr; r[2 * k + 1] = Math.sin(ang) * rr; }
  // spread: Radius oder [quer, hoch] (flacher Fächer)
  const [su, sv] = Array.isArray(spread) ? spread : [spread, spread];
  return { pts, from: new THREE.Vector3(...from), d, u, v, len, su, sv, t, r, key };
}
// Lüfterrad: n schräge Flügel um die Nabe (Ebene xy, dreht um z)
function lvRotor(r, n, color) {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: color || 0x3b4247, roughness: 0.5, side: THREE.DoubleSide });
  for (let k = 0; k < n; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(r * 0.32, r * 0.78, 0.8), m); const a = k / n * Math.PI * 2;
    b.position.set(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0); b.rotation.z = a - Math.PI / 2 + 0.5; g.add(b); }
  const hub = new THREE.Mesh(new THREE.CircleGeometry(r * 0.28, 20), new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.6 })); hub.position.z = 0.6; g.add(hub);
  return g;
}
function lvFansInit(md, g) {
  lv.air = [];
  /* Lüfterräder drehen mit (lvAirTick): Kopf vorn = Bauteillüfter (fan_speed_pct), klein links am Kopf = Hotend-Lüfter (läuft
     beim Drucken immer, key null), Seitenlüfter rechts nach aux_fan_speed_pct */
  if (lv.headFan) { const ro = lvRotor(LV_HEAD.w * 0.2, 9, 0x2c3236); ro.position.z = 0.4; lv.headFan.add(ro); lv.rotors.push({ obj: ro, key: 'fan_speed_pct' }); }
  { const H = LV_HEAD, hf = new THREE.Group(), r = 9;
    hf.add(new THREE.Mesh(new THREE.TorusGeometry(r, 1.2, 8, 28), new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.6 })),
      new THREE.Mesh(new THREE.CircleGeometry(r - 0.4, 28), new THREE.MeshStandardMaterial({ color: 0x0f1215, roughness: 0.8 })));
    const ro = lvRotor(r, 7, 0x3b4247); ro.position.z = 0.3; hf.add(ro); lv.rotors.push({ obj: ro, key: null });
    hf.rotation.y = -Math.PI / 2; hf.position.set(-(H.w / 2) - 1.4, -H.d / 2 + r + 8, H.tip + 8 + 12 + r + 2); lv.head.add(hf); }   // vorn unten, knapp über dem orangen Ring
  // Bauteillüfter: Auslässe links und rechts unten am Kopf, Luft zur Düsenspitze
  const H = LV_HEAD;
  for (const sx of [-1, 1]) lv.air.push(lvAirStream(lv.head, [sx * (H.w / 2 - 4), 0, H.tip + 6], [-sx, 0, -0.55], H.w / 2 + 6, 5, 'fan_speed_pct', 4));
  if (md.kin === 'bed' || !lv.xy || !lv.xy.fx0) return;
  if (md.fans && md.fans.aux === false) return;
  /* nach dem Foto des Kobra S1 (2026-10-08): großer Seitenlüfter rechts an der Wand, oben die flache, waagerechte Düse – bläst einen
     flachen Fächer quer übers Bett; Gehäuselüfter hinten links der Mitte (Gitter), etwa auf halber Bauraumhöhe */
  const { fx1, fy1, top } = lv.xy, cx = g.cx, cy = g.cy || 0, zAux = 5 - LV_GANTRY_Z, zBox = top - 200;   // seitliche Düse etwa auf Höhe der Druckkopf-Düse (5 mm darüber): bläst über die aktuelle Schicht
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2023, roughness: 0.6 }), side = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(30, 110, 110), dark); housing.position.set(fx1 - 25, cy, zAux - 150); side.add(housing);
  // Kanal vom tiefer sitzenden Lüfter hoch zur Düse (Düse bleibt auf Kopfhöhe)
  const duct = new THREE.Mesh(new THREE.BoxGeometry(26, 70, 102), dark); duct.position.set(fx1 - 30, cy, zAux - 45); side.add(duct);
  const wheel = new THREE.Mesh(new THREE.CircleGeometry(38, 32), new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.8 })); wheel.rotation.y = -Math.PI / 2; wheel.position.set(fx1 - 40.5, cy, zAux - 155); side.add(wheel);
  { const ro = lvRotor(36, 11), hold = new THREE.Group(); hold.rotation.y = -Math.PI / 2; hold.position.set(fx1 - 41.5, cy, zAux - 155); hold.add(ro); side.add(hold); lv.rotors.push({ obj: ro, key: 'aux_fan_speed_pct' }); }
  const slot = new THREE.Mesh(new THREE.BoxGeometry(34, 92, 12), dark); slot.position.set(fx1 - 26, cy, zAux);   // nah an der Wand: außerhalb des Kopfwegs side.add(slot);   // flache Düse
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(6, 84),   // nach der Drehung um y: 6 mm hoch, 84 mm breit (waagerechter Schlitz)
    new THREE.MeshBasicMaterial({ color: 0x050607 })); mouth.rotation.y = -Math.PI / 2; mouth.position.set(fx1 - 43.2, cy, zAux); side.add(mouth);
  lv.gantry.add(side);
  lv.air.push(lvAirStream(lv.gantry, [fx1 - 46, cy, zAux], [-1, 0, -0.04], 250, [40, 3], 'aux_fan_speed_pct'));
  // Ansaugung: Luft aus dem Bauraum strömt als Kegel auf das Lüfterrad zu
  lv.air.push(Object.assign(lvAirStream(lv.gantry, [fx1 - 190, cy, zAux - 155], [1, 0, 0], 145, [48, 48], 'aux_fan_speed_pct'), { funnel: 1 }));
  /* Gehäuselüfter in der Rückwand: Rahmen mit Lüfterrad (dreht nach box_fan_level), davor ein dünnes Gitter. Abluft: innen
     ein Kegel, der auf den Lüfter zuläuft (angesaugt), hinter der Wand ein schmaler Strahl nach draußen */
  const bxx = cx - 70, byy = fy1 - 12, fan = new THREE.Group(), fr = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.6 });
  for (const [w, h, x, z] of [[78, 8, 0, 35], [78, 8, 0, -35], [8, 78, -35, 0], [8, 78, 35, 0]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 12, h), fr); b.position.set(x, 0, z); fan.add(b); }
  const back = new THREE.Mesh(new THREE.CircleGeometry(33, 32), new THREE.MeshStandardMaterial({ color: 0x0b0d0f, roughness: 0.9, side: THREE.DoubleSide })); back.rotation.x = Math.PI / 2; back.position.y = 4; fan.add(back);
  { const ro = lvRotor(31, 7, 0x4a5258), hold = new THREE.Group(); hold.rotation.x = Math.PI / 2; hold.position.y = -1; hold.add(ro); fan.add(hold); lv.rotors.push({ obj: ro, key: 'box_fan_level' }); }
  for (let k = -3; k <= 3; k++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(70, 1.6, 1.6), fr); bar.position.set(0, -8, k * 10); fan.add(bar); }   // dünnes Gitter davor
  fan.position.set(bxx, byy, zBox); lv.gantry.add(fan);
  lv.air.push(Object.assign(lvAirStream(lv.gantry, [bxx, byy - 140, zBox], [0, 1, 0], 210, [44, 36], 'box_fan_level'), { funnel: 140 / 210 }));
}
function lvAirTick(dt) {
  const st = typeof wb !== 'undefined' && wb.st, fans = (st && st.fans) || {};
  for (const ro of lv.rotors || []) { const pct = ro.key ? Math.max(0, Math.min(100, +fans[ro.key] || 0)) : 100; ro.obj.rotation.z -= dt * 30 * pct / 100; }
  if (!lv.air || !lv.air.length) return;
  for (const a of lv.air) {
    const pct = Math.max(0, Math.min(100, +fans[a.key] || 0));
    a.pts.visible = pct > 0 && lv.head.visible;
    if (!a.pts.visible) continue;
    const pos = a.pts.geometry.attributes.position.array, col = a.pts.geometry.attributes.color.array, speed = 0.15 + 0.85 * pct / 100;
    const live = Math.round(LV_AIR_N * (0.25 + 0.75 * pct / 100));   // mehr Leistung = dichterer Strom
    a.pts.geometry.setDrawRange(0, live);
    for (let k = 0; k < live; k++) {
      let t = a.t[k] + dt * speed * 0.9; if (t >= 1) t -= 1; a.t[k] = t;
      // Abluft (funnel): innen Kegel zum Lüfter hin enger, danach schmaler Strahl; sonst Fächer, der sich aufweitet
      const g = a.funnel ? (t < a.funnel ? 1.25 - 1.0 * t / a.funnel : 0.25 + 0.35 * (t - a.funnel) / (1 - a.funnel)) : 0.4 + t, l = t * a.len, x = a.r[2 * k] * a.su * g, y = a.r[2 * k + 1] * a.sv * g;
      pos[3 * k] = a.from.x + a.d.x * l + a.u.x * x + a.v.x * y; pos[3 * k + 1] = a.from.y + a.d.y * l + a.u.y * x + a.v.y * y; pos[3 * k + 2] = a.from.z + a.d.z * l + a.u.z * x + a.v.z * y;
      const f = (1 - t) * (0.35 + 0.65 * pct / 100);   // verblasst mit dem Weg, stärker bei mehr Leistung
      col[3 * k] = 0.45 * f; col[3 * k + 1] = 0.75 * f; col[3 * k + 2] = 1.0 * f;
    }
    a.pts.geometry.attributes.position.needsUpdate = true; a.pts.geometry.attributes.color.needsUpdate = true;
  }
}
// Kurve der Kette: hinten oben → Bogen → senkrecht von oben auf den Kopf
// liegender Bogen (waagerecht, knapp über dem Kopf): vom Anker nach links, links herum nach vorn zum Kopf
function lvChainCurve(a, h, xmin) {
  const z = h.z, lx = Math.max(xmin ?? -Infinity, Math.min(a.x, h.x) - 80);
  return new THREE.CubicBezierCurve3(new THREE.Vector3(a.x, a.y, z), new THREE.Vector3(lx, a.y, z),
    new THREE.Vector3(lx, h.y, z), new THREE.Vector3(h.x, h.y, z));
}
function lvMechUpdate(p) {
  if (!lv.mechG) return;
  lv.mechG.visible = lv.head.visible;
  // Z-Spindeln drehen mit der Höhe (rotation.y = um die eigene Achse, wie die Rollen)
  for (const sc of lv.zScrews || []) sc.rotation.y = -(p.z / LV_SCREW_LEAD) * Math.PI * 2;
  lvZDriveSet(lv.zDrive, p.z);   // Z-Riemen unten läuft mit
  { const now = performance.now(), dt = lv.airT ? Math.min(0.1, (now - lv.airT) / 1000) : 0; lv.airT = now; lvAirTick(dt); }
  if (!lv.head.visible) return;
  for (const { b, go, motor } of lv.belts) {
    const [px, py] = go(p), ends = lvBeltSet(b, px, py, motor != null ? LV_MOTOR_R : 0);
    // Motorscheibe dreht um den Riemenweg, der bis zu ihr gelaufen ist (CoreXY: ergibt x + y bzw. x − y)
    if (motor != null && lv.motorCaps[motor]) lv.motorCaps[motor].rotation.y = -ends[0] / LV_MOTOR_R;
  }
  // Anker in Weltkoordinaten: CoreXY am Rahmen (fährt in Z mit der Traverse), Bettschubser am oberen Querholm (fährt in Y)
  const A = lv.mechAnchor, a = A.fixed ? { x: A.x, y: A.y + p.y, z: A.z } : { x: A.x, y: A.y, z: p.z + LV_GANTRY_Z + A.z };
  const top = { x: p.x, y: p.y + 4, z: p.z + LV_HEAD.h + 14 }, c = lvChainCurve(a, top, A.xmin), q = new THREE.Vector3();
  lv.chain.forEach((l, k) => {
    const t = (k + 0.5) / LV_CHAIN_LINKS; c.getPoint(t, l.position); c.getTangent(t, q);
    l.lookAt(l.position.x + q.x, l.position.y + q.y, l.position.z + q.z);
  });
  /* Schlauch hängt außen (im Bogen links) an der Kette – fester seitlicher Abstand, Seite bleibt über den ganzen Bogen gleich,
     kann sie nicht kreuzen; am Kopf taucht er von oben hinein, das Filament läuft weiter senkrecht bis zur Düsenspitze */
  const pts = [], T = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1), side = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k <= 36; k++) {
    const t = k / 36 * 0.92, P = c.getPoint(t); c.getTangent(t, T);
    const sd = new THREE.Vector3().crossVectors(T, up);
    if (sd.lengthSq() > 1e-4) { sd.normalize(); if (sd.dot(side) < 0) sd.negate(); side.copy(sd); }
    pts.push(P.add(side.clone().multiplyScalar(9)));
  }
  if (lv.hubTop && lv.aceG && lv.aceG.visible && !A.fixed) {
    /* mit ACE: Schlauch beginnt oben an der Zusammenführung, steigt senkrecht, biegt im 90°-Bogen nach vorn, geht waagerecht durch die
       Rückwand und trifft die Kette dort, wo sie hinten an der Zusammenführung vorbeiläuft (der Teil der Kette davor bleibt ohne Schlauch) */
    const H = lv.hubTop, gz = lv.gantry.position.z, zc = pts[0].z, R = 25;
    const yc = H.y - R, z0c = zc - R, arc = [new THREE.Vector3(H.x, H.y, H.z + gz)];
    for (let k = 0; k <= 6; k++) { const t = k / 6 * Math.PI / 2; arc.push(new THREE.Vector3(H.x, yc + Math.cos(t) * R, z0c + Math.sin(t) * R)); }
    if (H.x - 12 > pts[0].x) {   // Zusammenführung rechts vom Kettenanfang (von vorn): waagerecht im Bogen nach links in den Anfang der Kette
      const R2 = Math.max(8, yc - pts[0].y);
      for (let k = 1; k <= 5; k++) { const t = k / 5 * Math.PI / 2; arc.push(new THREE.Vector3(H.x - R2 + Math.cos(t) * R2, yc - Math.sin(t) * R2, zc)); }
      if (H.x - R2 - 20 > pts[0].x) arc.push(new THREE.Vector3((H.x - R2 + pts[0].x) / 2, pts[0].y, zc));
    } else {                     // links davon: trifft die Kette dort, wo sie hinten vorbeiläuft
      while (pts.length > 2 && pts[0].x > H.x - 12) pts.shift();
      arc.push(new THREE.Vector3(H.x - 4, (yc + pts[0].y) / 2, zc));
    }
    pts.unshift(...arc);
  }
  const inHead = new THREE.Vector3(p.x, p.y, p.z + LV_HEAD.h - 8);
  pts.push(new THREE.Vector3(p.x, p.y, p.z + LV_HEAD.h + 8), inHead);
  const ct = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const cf = new THREE.CurvePath(); cf.add(ct); cf.add(new THREE.LineCurve3(inHead.clone(), new THREE.Vector3(p.x, p.y, p.z + 1)));
  for (const k of ['tube', 'fil']) if (lv[k]) { lv.mechG.remove(lv[k]); lv[k].geometry.dispose(); }
  lv.tube = new THREE.Mesh(new THREE.TubeGeometry(ct, 60, 2.4, 10), lv.tubeM);
  lv.fil = new THREE.Mesh(new THREE.TubeGeometry(cf, 80, 0.9, 6), lv.filM);
  lv.tube.renderOrder = 3;
  lv.mechG.add(lv.fil, lv.tube);
  // fließendes Filament bis in den Kopf (wie in den ACE-Schläuchen, lvAceAnimate), nur solange ein Slot aktiv druckt
  if (lv.filGlow) { lv.mechG.remove(lv.filGlow); lv.filGlow.geometry.dispose(); lv.filGlow = null; }
  if (lvAceFlowing()) {
    if (!lv.filFlow) { lv.filFlow = lvFlowMat(300); lv.filGlowM = lvGlowMat(lv.filFlow); }
    lv.filFlow.emissiveMap.repeat.x = Math.max(1, cf.getLength() / LV_FLOW_MM);
    lv.filGlowM.color.copy(lv.filM.color).lerp(new THREE.Color(0xffffff), 0.3);
    lv.filGlow = new THREE.Mesh(new THREE.TubeGeometry(cf, 80, 2.0, 8), lv.filGlowM); lv.filGlow.renderOrder = 4; lv.mechG.add(lv.filGlow);
  }
}
function lvAceFlowing() { return !!(lv.aceSpools && lv.aceG && lv.aceG.visible && lv.aceSpools.some(sp => sp.active)); }
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
  else { lv.gantry.position.y = 0; lv.gantry.userData.beam.position.y = p.y + LV_BEAM_DY; }
  lvMechUpdate(p);
  lvTryFit();
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
  const real = p && age != null && age < LV_POS_FRESH_S && Number.isFinite(+p.x);
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
// gerade gedruckt: in der Filamentfarbe der Bahn (2026-10-08, vorher Petrol) – noch nicht gedruckt: blass
function lvFilRgb(i) {
  const k = lv.data.a[2 * i + 1], c = lv.filRgb || (lv.filRgb = {});
  return c[k] || (c[k] = lvVisible(hexToRgb01(toolColour(k))));
}
function lvCurColour(i, split, withHead) { return lv.skip && lv.skip[i] ? LV_SKIP : !withHead || i < split ? lvFilRgb(i) : LV_PENDING; }
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
/* Leerlauf (kein Druckauftrag): Szene einmal mit leerer Vorschau aufbauen (Bettmitte), Kopf an die gemeldete Position (falls frisch)
   oder geparkt über der Bettmitte. Rückgabe: true = echte Position, false = geparkt, null = kein WebGL */
function lvIdle(st) {
  if (!lv.idle || !lv.data) {
    if (!lvInit()) return null;
    const b = lvBed(), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    lv.data = { count: 0, bbox: [cx - 1, cy - 1, 0, cx + 1, cy + 1, 1], layers: [], q: new Uint16Array(0), a: new Uint8Array(0), v: null, types: [] };
    lv.idle = true; lv.missing = false; lv.hs = null; lv.disp = null;
    lvResize(); lvBuild();
  }
  const p = st && st.position, real = !!(p && st.position_age_s != null && st.position_age_s < LV_POS_FRESH_S && Number.isFinite(+p.x));
  lv.hs = null; lv.head.visible = true;
  lvPlaceHead(real ? { x: +p.x - lv.cx, y: +p.y - lv.cy, z: +p.z } : { x: 0, y: 0, z: 40 });
  lvRender();
  return real;
}
async function lvLoad(name) {
  lv.name = name; lv.data = null; lv.missing = false; lv.loading = true; lv.idle = false;
  $('wbLiveNote').textContent = t('Lade 3D-Ansicht …'); $('wbLiveNote').classList.remove('hidden');
  try {
    const r = await fetch('api/printing/preview?name=' + encodeURIComponent(name));
    if (lv.name !== name) return;
    if (!r.ok) { lv.missing = true; lv.missingAt = Date.now(); return; }
    lv.data = parsePreview(await r.arrayBuffer()); lv.filRgb = null;
    if (!lvInit()) { lv.missing = true; return; }
    lvResize(); lvBuild();
    if (typeof skDrawLines === 'function' && wb.st && wb.st.job) skDrawLines(new Set(wb.st.job.skipped || []));
  } catch (e) { lv.missing = true; lv.missingAt = Date.now(); }
  finally { lv.loading = false; if (wb.st) liveUpdate(wb.st); }
}

// Aus der Werkbank bei jedem Stand (alle 3 s): passende Vorschau laden, Schicht nachführen
function liveUpdate(st) {
  lvFx(st); lvAceColours(st); lvDisplay(st);
  const job = st && st.job, card = $('wbLiveStage');
  if (!card) return;
  if (!job || !job.name) {
    // ohne Druckauftrag: Drucker, Gehäuse und ACE trotzdem zeigen (leeres Bett, Kopf an der gemeldeten Stelle oder geparkt)
    lv.at = null; lv.name = null;
    const real = lvIdle(st);
    if (real == null) { $('wbLiveNote').textContent = t('Kein Druck aktiv.'); $('wbLiveNote').classList.remove('hidden'); $('wbLiveInfo').textContent = ''; return; }
    $('wbLiveNote').classList.add('hidden');
    $('wbLiveInfo').textContent = t('Kein Druck aktiv');   // ohne Kopf-/Z-Angabe (2026-10-09)
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
  // Statuszeile nur mit Schicht (und wie weit sie ist) – Z-Höhe und Art der Kopfposition entfielen 2026-10-09
  $('wbLiveInfo').textContent = !(L >= 1) ? t('Vorbereitung vor der ersten Schicht') + (job.status ? ' (' + t(job.status) + ')' : '')
    : onPath ? t('Schicht {l} von {n} ({p} %)', { l: li + 1, n, p: Math.round(head.frac * 100) })
    : t('Schicht {l} von {n}', { l: L || cur + 1, n: T || n });
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
for (const [id, key, grp] of [['wbLiveEnc', 'liveEnclosure', 'enclosureG'], ['wbLiveAce', 'liveAce', 'aceG']]) {
  $(id).checked = store.settings[key] !== false;
  $(id).addEventListener('change', e => { store.settings[key] = e.currentTarget.checked; persist(); if (lv[grp]) { lv[grp].visible = e.currentTarget.checked; if (lv.head && lv.head.visible) lvMechUpdate(lv.head.position); lvRefit(); lvRender(); } });
}
liveMode(!EMBED_3D && store.settings.wbView === 'cam' ? 'cam' : 'live');
