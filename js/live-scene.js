'use strict';
/* 3D-Fortschritt, Teil Szene (aus js/live-ui.js): Zustand lv, Hell-/Dunkelmodus, Renderer, Kamera und Licht, Zeichnen und
   Größe der Ansicht, Bahnen als Raupen bzw. Linien (lvBuild), Kamera einpassen, Schleifen anstoßen, Grafikspeicher freigeben. */

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
  lvRefit(); lvRender(); lvKick();   // wieder sichtbar (auch eingebettet ohne Tabwechsel): Schleifen weiter
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
  if (lv.raf) { cancelAnimationFrame(lv.raf); lv.raf = 0; }   // schon gezeichnet: vorgemerktes Bild entfällt
  lv.renderer.render(lv.scene, lv.camera);
  lv.dirty = null;
}
function lvRender() {
  if (lv.raf || !lv.renderer) return;
  lv.raf = requestAnimationFrame(() => { lv.raf = 0; lvDraw(); });
}
/* Grafikspeicher freigeben (Neuaufbau, lvHeadInit): Geometrien, Materialien und Texturen eines Teilbaums – außer den geteilten,
   die über alle Aufbauten bleiben (lvPulleyKit, Grundtexturen von Riemen/Luft/Fluss, Kopfschlauch-Fluss lv.filFlow) */
const LV_SHARED = new WeakSet();
function lvDisposeMat(m, seen) {
  if (!m || seen.has(m) || LV_SHARED.has(m)) return;
  seen.add(m);
  for (const k of ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap']) { const t = m[k]; if (t && !seen.has(t) && !LV_SHARED.has(t)) { seen.add(t); t.dispose(); } }
  m.dispose();
}
function lvDispose(obj, extra) {
  const seen = new Set();
  if (obj) obj.traverse(o => {
    if (o.geometry && !seen.has(o.geometry) && !LV_SHARED.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) lvDisposeMat(m, seen);
  });
  for (const m of extra || []) lvDisposeMat(m, seen);
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
  lv.grid = new THREE.GridHelper(span, span / 10, 0xffffff, 0xffffff);   // Farbe setzt lvTheme
  lv.grid.rotation.x = Math.PI / 2; lv.grid.position.z = 0.01; lv.scene.add(lv.grid);
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

// Kamera so weit zurück, dass alles Sichtbare (Bett, Mechanik, Gehäuse, ACE) ins Bild passt – frontal von vorn
// Neu einpassen, solange nicht selbst gedreht/gezoomt wurde (Größe der Ansicht, ACE-Einheiten oder Schalter geändert)
function lvRefit() { if (lv.autoFit) { lv.fitPending = true; lvTryFit(); } }
// erst einpassen, wenn Kopf und Mechanik stehen und die Ansicht eine Größe hat (in HA ist sie beim Laden oft noch verdeckt)
function lvTryFit() {
  const el = $('wbLiveStage');
  if (!lv.fitPending || !lv.head || !lv.head.visible || !el || !el.clientWidth || !el.clientHeight) return;
  lv.fitPending = false;
  if (lv.follow) lvFollowView(); else lvFitAll();
  lvRender();
}
/* „Kopf folgen“: Blickpunkt auf der Düsenspitze, Kamera LV_FOLLOW_DIST mm davor (von vorn, leicht von oben). Danach fährt
   die Kamera mit dem Kopf mit (lvFollow aus lvPlaceHead) – Drehen und Zoomen gehen weiter und bleiben relativ zum Kopf. */
const LV_FOLLOW_DIST = 190;
function lvFollowView() {
  if (!lv.controls || !lv.head || !lv.head.visible) return;
  const p = lv.head.position, dir = new THREE.Vector3(0, -1, 0.3).normalize();   // flach: unter den Kopf auf die Düse sehen
  lv.controls.target.copy(p); lv.camera.position.copy(p).add(dir.multiplyScalar(LV_FOLLOW_DIST)); lv.controls.update();
}
function lvFollow(p) {
  if (!lv.follow || !lv.controls || lv.fitPending) return;
  const tgt = lv.controls.target, dx = p.x - tgt.x, dy = p.y - tgt.y, dz = p.z - tgt.z;
  if (!dx && !dy && !dz) return;
  tgt.set(p.x, p.y, p.z); lv.camera.position.x += dx; lv.camera.position.y += dy; lv.camera.position.z += dz; lv.controls.update();
}
function lvFollowSet(on) {
  lv.follow = on;
  if (!lv.controls) return;
  if (on) { lv.autoFit = false; lv.fitPending = false; lvFollowView(); }
  else { lv.autoFit = true; lv.fitPending = true; lvTryFit(); }   // wieder alles im Bild
  lvRender();
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

// 3D-Ansicht zu sehen? (Ansicht „3D“, Tab ④ offen oder eingebettet ?ansicht=3d, Seite im Vordergrund) – sonst stehen Kopf- und Effekt-Schleife
function lvOnScreen() { const el = $('wbLiveStage'); return lv.mode === 'live' && !document.hidden && !!el && el.clientWidth > 0; }
// beide Schleifen wieder anstoßen (Tab wieder offen, Ansicht wieder sichtbar/größer, Seite wieder im Vordergrund)
function lvKick() {
  if (lv.hs && lv.head && lv.head.visible && !lv.anim && lvOnScreen()) lv.anim = requestAnimationFrame(lvHeadTick);
  lvAceAnimate();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) lvKick(); });
