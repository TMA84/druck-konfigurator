'use strict';
/* Slice-Vorschau (Tab „Slicen & Kosten“, eingebettet): zeigt den von OrcaSlicer (Server, /api/slice) erzeugten
   G-Code als Schichtansicht – ohne Orca zu öffnen. Lädt nach jedem Slicen neu, sobald der Tab sichtbar ist. Der Server liefert je Platte eine kompakte Vorschau (tools/gcode_preview.py, Format GCPV2):
   Extrusionsbahnen mit Linienart und Werkzeug. Schieberegler = bis zu welcher Schicht; Legende blendet aus. */

const PV_TYPE_COLOURS = {
  'Outer wall': '#FF8C1A', 'Inner wall': '#FFD24D', 'Overhang wall': '#3F8AE0', 'Sparse infill': '#C0504D',
  'Internal solid infill': '#A04DD1', 'Solid infill': '#A04DD1', 'Top surface': '#FF5C8A', 'Bottom surface': '#9C9C9C',
  'Bridge': '#4DA6FF', 'Internal Bridge': '#6C94C8', 'Gap infill': '#F2F2F2', 'Support': '#44B36B',
  'Support interface': '#2E8B57', 'Support transition': '#6FCF97', 'Prime tower': '#B8B8B8', 'Brim': '#26C6DA',
  'Skirt': '#26C6DA', 'Ironing': '#FF99CC', 'Custom': '#777777', 'Other': '#777777'
};
const PV_TYPE_LABELS = {
  'Outer wall': t('Außenwand'), 'Inner wall': t('Innenwand'), 'Overhang wall': t('Überhangwand'), 'Sparse infill': t('Füllung'),
  'Internal solid infill': t('Massive Füllung innen'), 'Solid infill': t('Massive Füllung'), 'Top surface': t('Obere Fläche'),
  'Bottom surface': t('Untere Fläche'), 'Bridge': t('Brücke'), 'Internal Bridge': t('Brücke innen'), 'Gap infill': t('Lückenfüllung'),
  'Support': t('Stützen'), 'Support interface': t('Stützen-Schnittstelle'), 'Support transition': t('Stützen-Übergang'),
  'Prime tower': t('Reinigungsturm'), 'Brim': t('Brim'), 'Skirt': t('Skirt'), 'Ironing': t('Glätten'), 'Custom': t('Start/Ende'), 'Other': t('Sonstiges')
};

const pv = { job: null, plates: [], data: null, hidden: new Set(), renderer: null, scene: null, camera: null, controls: null, mesh: null, grid: null, idx: null, layerEnd: [], layerStart: [], raf: 0 };

// GCPV3: dazu Vorschub je Bahn (v, in speed_unit mm/s); GCPV2 (bis 10.4, z. B. ältere gespeicherte Drucke) ohne
function parsePreview(buf) {
  const u8 = new Uint8Array(buf), magic = String.fromCharCode(...u8.subarray(0, 5));
  if (magic !== 'GCPV2' && magic !== 'GCPV3') throw Error(t('unbekanntes Vorschauformat'));
  const len = new DataView(buf).getUint32(5, true), head = JSON.parse(new TextDecoder().decode(u8.subarray(9, 9 + len)));
  const off = 9 + len + ((4 - (9 + len) % 4) % 4), n = head.count;
  return { ...head, q: new Uint16Array(buf, off, 4 * n), a: new Uint8Array(buf, off + 8 * n, 2 * n),
    v: magic === 'GCPV3' ? new Uint8Array(buf, off + 10 * n, n) : null };
}

// Sehr dunkle Filamente (schwarzes ASA …) wären auf dem dunklen Hintergrund unsichtbar – auf Dunkelgrau anheben
const hexToRgb01 = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255), l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return l < 0.18 ? c.map(v => v + (0.3 - l)) : c; };
function toolColour(t) {
  const s = typeof slotChoices === 'function' ? slotChoices()[t] : null;
  return s && /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : BODY_PALETTE[t % BODY_PALETTE.length];
}
const pvKey = i => $('pvColour').value === 'tool' ? 'k' + pv.data.a[2 * i + 1] : 't' + pv.data.a[2 * i];

function pvInitRenderer() {
  if (pv.renderer) return true;
  if (typeof THREE === 'undefined') return false;
  pv.renderer = new THREE.WebGLRenderer({ antialias: true });
  pv.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  $('pvStage').appendChild(pv.renderer.domElement);
  pv.scene = new THREE.Scene();
  pv.scene.background = new THREE.Color(0x1e1e1e);
  pv.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
  pv.camera.up.set(0, 0, 1);
  pv.controls = new THREE.OrbitControls(pv.camera, pv.renderer.domElement);
  pv.controls.addEventListener('change', pvRender);
  new ResizeObserver(pvResize).observe($('pvStage'));
  return true;
}
function pvResize() {
  if (!pv.renderer) return;
  const el = $('pvStage'), w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  pv.renderer.setSize(w, h, false);
  pv.camera.aspect = w / h; pv.camera.updateProjectionMatrix();
  pvRender();
}
function pvRender() {
  if (pv.raf || !pv.renderer) return;
  pv.raf = requestAnimationFrame(() => { pv.raf = 0; if (pv.renderer) pv.renderer.render(pv.scene, pv.camera); });
}

// Geometrie einer Platte: je Bahn zwei Punkte, Farbe je nach Modus; sichtbar über den Index (Legende, Schicht)
function pvBuild() {
  const d = pv.data, n = d.count, [bx0, by0, , bx1, by1] = d.bbox, sx = (bx1 - bx0) / 65535, sy = (by1 - by0) / 65535;
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, pos = new Float32Array(n * 6);
  d.layers.forEach(([z, start], li) => {
    const end = li + 1 < d.layers.length ? d.layers[li + 1][1] : n;
    for (let i = start; i < end; i++) {
      const o = i * 6, q = i * 4;
      pos[o] = bx0 + d.q[q] * sx - cx; pos[o + 1] = by0 + d.q[q + 1] * sy - cy; pos[o + 2] = z;
      pos[o + 3] = bx0 + d.q[q + 2] * sx - cx; pos[o + 4] = by0 + d.q[q + 3] * sy - cy; pos[o + 5] = z;
    }
  });
  if (pv.mesh) { pv.scene.remove(pv.mesh); pv.mesh.geometry.dispose(); pv.mesh.material.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  pv.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
  pv.scene.add(pv.mesh);
  if (pv.grid) { pv.scene.remove(pv.grid); pv.grid.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  const size = Math.max(bx1 - bx0, by1 - by0, 20);
  // Druckbett des Druckers (G-Code-Koordinaten = Bettkoordinaten) mit Rand; ohne Vorlage ein Raster ums Teil
  const tpl = typeof plTpl === 'function' ? plTpl() : null;
  if (tpl) {
    const [bw, bd] = bedSize(tpl), [bcx, bcy] = tpl.bedCenter, span = Math.ceil(Math.max(bw, bd) / 10) * 10;
    pv.grid = new THREE.Group();
    const gh = new THREE.GridHelper(span, span / 10, 0x4a4a4a, 0x333333);
    gh.rotation.x = Math.PI / 2;
    const e = [[-bw / 2, -bd / 2], [bw / 2, -bd / 2], [bw / 2, bd / 2], [-bw / 2, bd / 2], [-bw / 2, -bd / 2]];
    const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(e.map(([x, y]) => new THREE.Vector3(x, y, 0))), new THREE.LineBasicMaterial({ color: 0x7f9bb8 }));
    pv.grid.add(gh, edge);
    pv.grid.position.set(bcx - cx, bcy - cy, 0);
  } else {
    const span = Math.ceil(size * 1.3 / 10) * 10;
    pv.grid = new THREE.GridHelper(span, span / 10, 0x555555, 0x333333);
    pv.grid.rotation.x = Math.PI / 2;
  }
  pv.scene.add(pv.grid);
  const top = d.bbox[5] || 1;
  pv.camera.position.set(size * 0.9, -size * 1.1, size * 0.9 + top);
  pv.controls.target.set(0, 0, top / 3); pv.controls.update();
  pvColours(); pvIndex();
}
function pvColours() {
  const d = pv.data, col = pv.mesh.geometry.attributes.color.array, byTool = $('pvColour').value === 'tool', cache = {};
  for (let i = 0; i < d.count; i++) {
    const key = byTool ? d.a[2 * i + 1] : d.a[2 * i];
    const c = cache[key] || (cache[key] = hexToRgb01(byTool ? toolColour(key) : PV_TYPE_COLOURS[d.types[key]] || '#777777'));
    for (let v = 0; v < 2; v++) { const o = (i * 2 + v) * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; }
  }
  pv.mesh.geometry.attributes.color.needsUpdate = true;
  pvLegend();
}
// Index der sichtbaren Bahnen (Legende) und je Schicht, wo sie im Index anfängt/endet
function pvIndex() {
  const d = pv.data, idx = new Uint32Array(d.count * 2);
  let c = 0;
  pv.layerStart = []; pv.layerEnd = [];
  d.layers.forEach(([, start], li) => {
    const end = li + 1 < d.layers.length ? d.layers[li + 1][1] : d.count;
    pv.layerStart[li] = c;
    for (let i = start; i < end; i++) if (!pv.hidden.has(pvKey(i))) { idx[c++] = 2 * i; idx[c++] = 2 * i + 1; }
    pv.layerEnd[li] = c;
  });
  pv.mesh.geometry.setIndex(new THREE.BufferAttribute(idx.subarray(0, c), 1));
  pvLayer();
}
function pvLayer() {
  const li = +$('pvLayer').value, d = pv.data;
  if (!d || !d.layers.length) return;
  const start = $('pvOnly').checked ? pv.layerStart[li] : 0;
  pv.mesh.geometry.setDrawRange(start, pv.layerEnd[li] - start);
  $('pvLayerLabel').textContent = t('Schicht {n} / {total} · Z {z} mm', { n: li + 1, total: d.layers.length, z: de(d.layers[li][0], 2) });
  pvRender();
}
function pvLegend() {
  const d = pv.data, byTool = $('pvColour').value === 'tool', counts = new Map();
  for (let i = 0; i < d.count; i++) { const k = pvKey(i); counts.set(k, (counts.get(k) || 0) + 1); }
  $('pvLegend').innerHTML = [...counts.keys()].sort().map(k => {
    const id = +k.slice(1), name = byTool ? 'Slot ' + (id + 1) : PV_TYPE_LABELS[d.types[id]] || d.types[id];
    const colour = byTool ? toolColour(id) : PV_TYPE_COLOURS[d.types[id]] || '#777777';
    return '<li data-pv-key="' + k + '" class="' + (pv.hidden.has(k) ? 'off' : '') + '" title="' + t('Anklicken: ein-/ausblenden') + '"><i style="background:' + colour + '"></i>' + esc(name) + '</li>';
  }).join('');
}

async function pvLoad(plate) {
  $('pvStatus').textContent = t('Lade Vorschau von Platte {n} …', { n: plate }); $('pvStatus').classList.remove('hidden');
  $('pvDownload').href = 'api/slice/' + pv.job + '/plate_' + plate + '.gcode';
  $('pvDownload').download = (project ? project.name.replace(/\.(stl|3mf|zip)$/i, '').replace(/[^\w.-]+/g, '_') : t('druck')) + t('_Platte') + plate + '.gcode';
  const p = pv.plates.find(x => x.plate === plate);
  $('pvStats').textContent = p ? t('Druckzeit {time} · {g} g · {n} Farbwechsel · G-Code {mb} MB', { time: duration(p.time_s), g: de(p.total_g, 1), n: p.changes, mb: de(p.gcode_mb || 0, 1) }) : '';
  try {
    const res = await fetch('api/slice/' + pv.job + '/plate_' + plate + '.preview');
    if (!res.ok) throw Error((await res.json().catch(() => ({}))).error || 'HTTP ' + res.status);
    pv.data = parsePreview(await res.arrayBuffer());
    pv.hidden = new Set();
    $('pvLayer').max = Math.max(0, pv.data.layers.length - 1); $('pvLayer').value = $('pvLayer').max;
    pvBuild();
    $('pvStatus').classList.add('hidden');
    if (typeof sliceBar === 'function' && sb.phase === 'preview') sliceBar('done');
  } catch (e) { $('pvStatus').textContent = t('Vorschau nicht verfügbar: {msg}', { msg: t(e.message) }); if (typeof sliceBar === 'function' && sb.phase === 'preview') sliceBar('done'); }
}

// Zum aktuellen Slice-Auftrag laden (nur wenn der Tab sichtbar ist und der Auftrag neu ist)
// Vorschau leeren (neues Modell, Slicen fehlgeschlagen): nichts Altes mehr zeigen
function clearSlicePreview(text) {
  if (pv.mesh) { pv.scene.remove(pv.mesh); pv.mesh.geometry.dispose(); pv.mesh.material.dispose(); pv.mesh = null; }
  pv.job = null; pv.data = null; pv.plates = [];
  $('pvPlate').innerHTML = ''; $('pvLegend').innerHTML = ''; $('pvStats').textContent = ''; $('pvDownload').removeAttribute('href');
  $('pvStatus').textContent = text || t('Die Vorschau erscheint nach dem Slicen.'); $('pvStatus').classList.remove('hidden');
  pvStale(false);
  pvRender();
}
// Hinweis, wenn die Vorschau einen älteren Stand zeigt als das Projekt (wird gerade neu geslict o. Ä.)
function pvStale(on) { $('pvStale').classList.toggle('hidden', !on); }

function refreshSlicePreview(force) {
  const s = costState && costState.slice;
  if (!s || !s.job) { if (pv.job || pv.mesh) clearSlicePreview(costState && costState.busy ? t('Wird geslict …') : ''); return; }
  pvStale(costState.sig !== costSignature());
  if (document.body.dataset.tab !== 'slice') return;
  if (!force && pv.job === s.job && pv.data) return;
  const keep = pv.job === s.job ? +$('pvPlate').value : null;
  pv.job = s.job; pv.plates = s.plates;
  $('pvPlate').innerHTML = s.plates.map(p => '<option value="' + p.plate + '">' + p.plate + ' (' + duration(p.time_s) + ')</option>').join('');
  if (keep && s.plates.some(p => p.plate === keep)) $('pvPlate').value = String(keep);
  if (!pvInitRenderer()) { $('pvStatus').textContent = t('3D-Ansicht nicht verfügbar (WebGL/three.js fehlt).'); return; }
  pvResize();
  pvLoad(+$('pvPlate').value || s.plates[0].plate);
}
const openSlicePreview = () => { setTab('slice'); refreshSlicePreview(true); };
$('previewOpen').addEventListener('click', openSlicePreview);
$('pvPlate').addEventListener('change', () => pvLoad(+$('pvPlate').value));
$('pvLayer').addEventListener('input', pvLayer);
$('pvOnly').addEventListener('change', pvLayer);
$('pvColour').addEventListener('change', () => { if (!pv.data) return; pv.hidden = new Set(); pvColours(); pvIndex(); });
$('pvLegend').addEventListener('click', e => {
  const li = e.target.closest('[data-pv-key]'); if (!li || !pv.data) return;
  const k = li.dataset.pvKey;
  if (pv.hidden.has(k)) pv.hidden.delete(k); else pv.hidden.add(k);
  pvLegend(); pvIndex();
});
// Pfeiltasten: Schicht hoch/runter, auch wenn der Regler nicht im Fokus ist
$('previewDlg').addEventListener('keydown', e => {
  if (!pv.data || !['ArrowUp', 'ArrowDown'].includes(e.key) || e.target.matches('select')) return;
  e.preventDefault();
  const s = $('pvLayer'); s.value = Math.max(0, Math.min(+s.max, +s.value + (e.key === 'ArrowUp' ? 1 : -1))); pvLayer();
});
// Pfeiltasten wirken nur, wenn die Vorschau den Fokus hat: Klick in die Ansicht fokussiert sie
$('pvStage').tabIndex = 0;
