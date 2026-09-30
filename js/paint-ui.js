'use strict';
/* Bemalen wie in OrcaSlicer (Werkzeugleiste „Bemalen“): auf das gewählte Teil malen – Farbe (paint_color), Stützen
   erzwingen/verhindern (paint_supports) oder Naht (paint_seam). Werkzeuge: Kreis, Kugel, Dreieck, Füllen (nach
   Flächenwinkel, mit Vorschau), Höhenbereich, Lücken füllen; Radierer; alles entfernen. Kreis und Kugel teilen Dreiecke am
   Rand des Pinsels (bis PT_MIN_EDGE_MM, wie Orca), Daten im Orca-Format (js/paint.js). Die Bemalung gehört zum Teil
   (part.paintUser / paintSup / paintSeam) und gilt für alle Platzierungen desselben Objekts; Makerworld-Bemalung wird
   beim ersten Strich auf einem Dreieck übernommen (Farbe: designMap zu diesem Zeitpunkt).
   Anzeige: paintView (Farbe) bzw. paintMarkView (Stützen, Naht) für Viewer.setPaint und Viewer.setPaintLayer; während
   eines Strichs zeigt nur eine eigene Schicht die geänderten Dreiecke (schnell auch bei großen bemalten Flächen). */
const PT_MIN_EDGE_MM = 0.25, PT_MAX_RADIUS_MM = 50;
const PT = { on: false, mode: 'color', tool: 'circle', slot: 1, mark: 1, erase: false, radius: 2, angle: 30, gap: 1, stroke: null, rev: 0 };
// Farben für Stützen/Naht: erzwingen grün, verhindern violett (Überhänge bleiben in ihren Farben sichtbar)
const PT_MARK_RGB = { 1: [0.18, 0.8, 0.44], 2: [0.66, 0.33, 0.97] }, PT_SEAM_BASE = [0.55, 0.58, 0.62];
const ptAdjCache = new WeakMap(), ptTreeCache = new Map();

function ptTree(code) {
  let t = ptTreeCache.get(code);
  if (!t) { if (ptTreeCache.size > 20000) ptTreeCache.clear(); t = paintTree(code); ptTreeCache.set(code, t); }
  return t;
}
function ptAdj(geom) { let a = ptAdjCache.get(geom); if (!a) { a = paintAdjacency(geom.pos); ptAdjCache.set(geom, a); } return a; }

/* ---------- Anzeige ---------- */
// Slot eines unbemalten Dreiecks: Körper oder Teil
function ptBaseSlot(part, i) {
  if (part.bodies) for (const b of part.bodies) if (i >= b.start && i < b.start + b.count) return { s: bodySlot(part, b), d: b.dSlot };
  return { s: part.slot ?? defaultSlot(), d: part.dSlot };
}
const ptViewCache = new WeakMap();
// {runs, pos, col} oder null (keine Bemalung); offset/xf für die ganze Platte
function paintView(part, slots, offset = 0, xf = null) {
  const user = paintUserCodes(part) || {}, dc = part.paintCodes || null, uk = Object.keys(user);
  if (!uk.length && !dc) return null;
  const map = (project.threemf && project.threemf.designMap) || {};
  const key = JSON.stringify([map, dView(), slots.map(s => s.colour), part.slot ?? null, (part.bodies || []).map(b => b.slot), defaultSlot()]);
  let c = ptViewCache.get(part.geom);
  if (!c || c.key !== key) { c = { key, tris: new Map(), rgb: new Map() }; ptViewCache.set(part.geom, c); }
  const rgb = (s, d) => { const k = s + '/' + d; let v = c.rgb.get(k); if (!v) { v = viewRgb(showHex(s, d, slots)); c.rgb.set(k, v); } return v; };
  const P = part.geom.pos;
  // je Dreieck zwischengespeichert: Farbe (überwiegend) und Teilstücke, solange der Code gleich bleibt
  const entry = (i, code, own) => {
    const k = (own ? 'u' : 'd') + i, hit = c.tris.get(k);
    if (hit && hit.code === code) return hit;
    const tree = ptTree(code), base = ptBaseSlot(part, i);
    const colOf = s => !s ? rgb(base.s, base.d) : own ? rgb(s - 1, null) : rgb(map[s - 1] ?? s - 1, s - 1);
    const e = { code, main: colOf(paintTreeMain(tree)), pos: null, col: null };
    if (tree.c) {
      const lp = [], lc = [], [a, b, cc] = pTri(P, i);
      paintLeaves(tree, a, b, cc, (p, q, r, s) => { lp.push(...p, ...q, ...r); const x = colOf(s); lc.push(...x, ...x, ...x); });
      e.pos = lp; e.col = lc;
    }
    c.tris.set(k, e);
    return e;
  };
  const list = [];
  if (dc) for (const k in dc) if (user[k] == null) list.push([+k, entry(+k, dc[k], false)]);
  for (const k of uk) list.push([+k, entry(+k, user[k], true)]);
  list.sort((a, b) => a[0] - b[0]);
  const runs = [];
  let n = 0;
  for (const [i, e] of list) {
    const last = runs[runs.length - 1];
    if (last && last.rgb === e.main && last.start + last.count === offset + i) last.count++;
    else runs.push({ start: offset + i, count: 1, rgb: e.main });
    if (e.pos) n += e.pos.length;
  }
  const pos = new Float32Array(n), col = new Float32Array(n);
  let o = 0;
  for (const [, e] of list) if (e.pos) {
    if (xf) for (let v = 0; v < e.pos.length; v += 3) { const q = xf(e.pos[v], e.pos[v + 1], e.pos[v + 2]); pos[o + v] = q[0]; pos[o + v + 1] = q[1]; pos[o + v + 2] = q[2]; }
    else pos.set(e.pos, o);
    col.set(e.col, o); o += e.pos.length;
  }
  return { runs, pos, col };
}

// Stützen/Naht: nur die markierten Stellen als Schicht (unbemalte Teilstücke bleiben frei, darunter das Teil)
const ptMarkCache = new WeakMap();
function paintMarkView(part, layer, offset = 0, xf = null) {
  const L = PAINT_LAYERS[layer], user = paintUserCodes(part, layer) || {}, dc = part[L.designer] || null;
  let c = ptMarkCache.get(part.geom);
  if (!c) { c = new Map(); ptMarkCache.set(part.geom, c); }
  const P = part.geom.pos, list = [];
  const entry = (i, code) => {
    const k = layer + i, hit = c.get(k);
    if (hit && hit.code === code) return hit;
    const lp = [], lc = [], [a, b, cc] = pTri(P, i);
    paintLeaves(ptTree(code), a, b, cc, (p, q, r, s) => { if (!s) return; lp.push(...p, ...q, ...r); const x = PT_MARK_RGB[s] || PT_MARK_RGB[1]; lc.push(...x, ...x, ...x); });
    const e = { code, pos: lp, col: lc }; c.set(k, e); return e;
  };
  if (dc) for (const k in dc) if (user[k] == null) list.push(entry(+k, dc[k]));
  for (const k in user) list.push(entry(+k, user[k]));
  let n = 0; for (const e of list) n += e.pos.length;
  const pos = new Float32Array(n), col = new Float32Array(n);
  let o = 0;
  for (const e of list) {
    if (xf) for (let v = 0; v < e.pos.length; v += 3) { const q = xf(e.pos[v], e.pos[v + 1], e.pos[v + 2]); pos[o + v] = q[0]; pos[o + v + 1] = q[1]; pos[o + v + 2] = q[2]; }
    else pos.set(e.pos, o);
    col.set(e.col, o); o += e.pos.length;
  }
  return { runs: [], pos, col };
}
// Anzeige im Malen von Stützen/Naht (aus paintBodies): true = erledigt
function ptMarkDisplay(part) {
  if (!PT.on || PT.mode === 'color' || !part) return false;
  const mv = paintMarkView(part, PT.mode);
  // Stützen: Überhangfarben wie sonst (Viewer ohne Farbbereiche); Naht: Teil einfarbig grau
  Viewer.setPaint(PT.mode === 'seam' ? [{ start: 0, count: part.geom.n, rgb: PT_SEAM_BASE }] : null);
  if (Viewer.setOverlay) Viewer.setOverlay([]);
  Viewer.setPaintLayer(mv.pos, mv.col);
  if (!PT.stroke) ptRender();
  return true;
}

/* ---------- Malen ---------- */
const ptPart = () => project && project.parts[project.selected];
// Baum eines Dreiecks in Slot-Nummern (eigene Bemalung, sonst die des Designers umgelegt)
function ptTreeAt(part, i, layer = 'color') {
  const u = paintUserCodes(part, layer);
  if (u && u[i] != null) return ptTree(u[i]);
  if (layer !== 'color') { const d = part[PAINT_LAYERS[layer].designer]; return d && d[i] ? ptTree(d[i]) : { s: 0 }; }
  const d = paintDesignerCode(part, i);
  if (!d) return { s: 0 };
  const map = (project.threemf && project.threemf.designMap) || {};
  return paintTreeMap(ptTree(d), s => (map[s - 1] ?? s - 1) + 1);
}
const ptDesignerHas = (part, i, layer = 'color') => layer === 'color' ? !!((part.paintCodes && part.paintCodes[i]) || (part.paintState && part.paintState[i]))
  : !!(part[PAINT_LAYERS[layer].designer] && part[PAINT_LAYERS[layer].designer][i]);

function ptCanPaint(part) {
  if (!part) return t('zuerst ein Modell laden');
  if (part.objectId != null && !part.extra && !part.paintSrc) return t('Modell bitte neu laden (ältere Sitzung)');
  return '';
}

function ptDab(hit, prev) {
  const st = PT.stroke, part = st.part, g = part.geom, P = g.pos, state = st.state;
  const p0 = prev ? prev.point : hit.point, p1 = hit.point, r = PT.radius;
  let tris, brush = null, whole = false;
  if (PT.tool === 'gap') return;
  if (PT.tool === 'fill') { if (prev) return; tris = paintFill(P, ptAdj(g), hit.tri, PT.angle); whole = true; }
  else if (PT.tool === 'height') { brush = paintBrushHeight(p1[2] - r, p1[2] + r); tris = paintCollect(P, null, hit.tri, brush); }
  else {
    brush = PT.tool === 'circle' ? paintBrushCircle(p0, p1, r, hit.dir) : paintBrushSphere(p0, p1, r);
    tris = paintCollect(P, ptAdj(g), hit.tri, brush);
    whole = PT.tool === 'triangle';
  }
  for (const i of tris) {
    const old = st.work.get(i) || ptTreeAt(part, i, st.layer);
    let nt;
    if (whole) nt = !old.c && old.s === state ? old : { s: state };
    else { const [a, b, c] = pTri(P, i); nt = paintApply(old, a, b, c, brush, state, Math.max(PT_MIN_EDGE_MM, r / 6)); }
    if (nt !== old) st.work.set(i, nt);
  }
  ptShowWork();
}
// Zwischenstand des Strichs anzeigen (einmal je Bild): nur die geänderten Dreiecke als eigene Schicht über allem – ganze
// Dreiecke, damit sie ihre bisherige Darstellung verdecken
let ptShowQueued = false;
function ptStrokeColour(part, layer, slots) {
  if (layer === 'color') {
    const cache = new Map(), rgb = s => { let v = cache.get(s); if (!v) { v = viewRgb(slotColour(s, slots)); cache.set(s, v); } return v; };
    const map = (project.threemf && project.threemf.designMap) || {};
    return (s, i) => { if (s) return rgb(s - 1); const b = ptBaseSlot(part, i); return viewRgb(showHex(b.s, b.d, slots)); };
  }
  return (s, i) => s ? PT_MARK_RGB[s] || PT_MARK_RGB[1] : layer === 'seam' ? PT_SEAM_BASE : Viewer.triColor(i);
}
function ptShowWork() {
  if (ptShowQueued) return;
  ptShowQueued = true;
  requestAnimationFrame(() => {
    ptShowQueued = false;
    const st = PT.stroke; if (!st) return;
    const P = st.part.geom.pos, colOf = ptStrokeColour(st.part, st.layer, slotChoices()), lp = [], lc = [];
    for (const [i, tr] of st.work) { const [a, b, c] = pTri(P, i); paintLeaves(tr, a, b, c, (p, q, r, s) => { lp.push(...p, ...q, ...r); const x = colOf(s, i); lc.push(...x, ...x, ...x); }); }
    Viewer.setPaintLayer(Float32Array.from(lp), Float32Array.from(lc), 'stroke');
  });
}
// Strich übernehmen: neues paintUser für das Teil und alle Platzierungen desselben Objekts
function ptCommit(part, changes, label, layer = 'color') {
  const codes = { ...(paintUserCodes(part, layer) || {}) };
  let changed = false;
  for (const [i, tr] of changes) {
    const code = paintCode(tr), before = codes[i];
    if (code === '0' && !ptDesignerHas(part, i, layer)) { if (before != null) { delete codes[i]; changed = true; } continue; }
    if (before !== code) { codes[i] = code; changed = true; }
  }
  Viewer.setPaintLayer(null, null, 'stroke');
  if (!changed) { paintBodies(part); return false; }
  const slots = new Set();
  if (layer === 'color') for (const k in codes) for (const s of paintTreeStates(ptTree(codes[k]))) if (s) slots.add(s - 1);
  const pu = Object.keys(codes).length ? { rev: Date.now() * 1000 + (++PT.rev % 1000), codes, slots: [...slots].sort((a, b) => a - b) } : null;
  for (const p of samePlacements(part)) p[PAINT_LAYERS[layer].key] = pu;
  if (label) toast(label);
  update();
  return true;
}
function ptStroke(phase, hit, ev) {
  const part = ptPart();
  if (phase === 'start') {
    if (!part || ptCanPaint(part)) return;
    PT.stroke = { part, layer: PT.mode, work: new Map(), last: null, state: PT.erase || (ev && ev.shiftKey) ? 0 : PT.mode === 'color' ? PT.slot + 1 : PT.mark };
  }
  const st = PT.stroke;
  if (!st) return;
  if (phase === 'end') { PT.stroke = null; ptCommit(st.part, st.work, '', st.layer); return; }
  if (hit) { ptDab(hit, st.last); st.last = hit; }
}

function ptClearAll() {
  const part = ptPart(); if (!part || ptCanPaint(part)) return;
  const changes = new Map(), n = part.geom.n, u = paintUserCodes(part, PT.mode) || {};
  for (let i = 0; i < n; i++) if (ptDesignerHas(part, i, PT.mode) || u[i] != null) changes.set(i, { s: 0 });
  if (!changes.size) { toast(t('Teil ist nicht bemalt')); return; }
  ptCommit(part, changes, t('Bemalung entfernt – Strg/⌘+Z nimmt es zurück'), PT.mode);
}
// Lücken füllen: kleine unbemalte Stellen bekommen die Farbe ringsum (js/paint.js paintGaps)
function ptGapFill() {
  const part = ptPart(); if (!part || ptCanPaint(part)) return;
  const layer = PT.mode, changes = paintGaps(part.geom.pos, ptAdj(part.geom), i => ptTreeAt(part, i, layer), PT.gap);
  if (!changes.size || !ptCommit(part, changes, '', layer)) { toast(t('Keine Lücken unter {a} mm² gefunden', { a: de(PT.gap, 1) })); return; }
  toast(t('{n} Dreiecke mit Lücken gefüllt', { n: changes.size }));
}
// Vorschau beim Füllen: Fläche unter der Maus hervorheben (Viewer.setPreview)
let ptPrevKey = '';
function ptHover(hit) {
  if (!PT.on || PT.tool !== 'fill' || !hit) { if (ptPrevKey) { ptPrevKey = ''; Viewer.setPreview(null); } return; }
  const part = ptPart(); if (!part) return;
  const key = hit.tri + '/' + PT.angle;
  if (key === ptPrevKey) return;
  ptPrevKey = key;
  const P = part.geom.pos, tris = paintFill(P, ptAdj(part.geom), hit.tri, PT.angle), pos = new Float32Array(tris.length * 9);
  tris.forEach((t, k) => pos.set(P.subarray(t * 9, t * 9 + 9), k * 9));
  Viewer.setPreview(pos);
}

/* ---------- Bedienfeld ---------- */
const PT_TOOLS = [
  ['circle', t('Kreis'), t('Kreis: malt, was unter dem Kreis zur Kamera zeigt')],
  ['sphere', t('Kugel'), t('Kugel: malt alles innerhalb der Kugel')],
  ['triangle', t('Dreieck'), t('Dreieck: ganze Dreiecke unter dem Pinsel, ohne Teilen')],
  ['fill', t('Füllen'), t('Füllen: zusammenhängende Fläche bis zu Kanten über dem Winkel')],
  ['height', t('Höhe'), t('Höhenbereich: alles in dieser Höhe (Pinselgröße = halbe Dicke)')],
  ['gap', t('Lücken'), t('Lücken füllen: kleine unbemalte Stellen bekommen die Farbe ringsum')]
];
const PT_MODES = [['color', t('Farbe')], ['support', t('Stützen')], ['seam', t('Naht')]];
const PT_MARKS = { support: [[1, t('Erzwingen'), t('Hier Stützen drucken')], [2, t('Verhindern'), t('Hier keine Stützen')]],
  seam: [[1, t('Naht hier'), t('Naht bevorzugt hierhin legen')], [2, t('Keine Naht'), t('Naht hier vermeiden')]] };
function ptRender() {
  const box = $('paintPanel');
  if (!PT.on) { box.classList.add('hidden'); return; }
  const slots = slotChoices(), part = ptPart();
  box.classList.remove('hidden');
  $('ptModes').innerHTML = PT_MODES.map(([k, label]) => '<button type="button" data-pt-mode="' + k + '" class="' + (PT.mode === k ? 'active' : '') + '" aria-pressed="' + (PT.mode === k) + '">' + esc(label) + '</button>').join('');
  $('ptTools').innerHTML = PT_TOOLS.map(([k, label, title]) => '<button type="button" data-pt-tool="' + k + '" class="' + (PT.tool === k ? 'active' : '') + '" title="' + esc(title) + '" aria-pressed="' + (PT.tool === k) + '">' + esc(label) + '</button>').join('');
  const eraseBtn = '<button type="button" class="pt-erase' + (PT.erase ? ' active' : '') + '" data-pt-erase title="' + esc(t('Radierer (E) – oder Umschalt beim Malen')) + '" aria-pressed="' + PT.erase + '">' + esc(t('Radierer')) + '</button>';
  $('ptLabel').textContent = PT.mode === 'color' ? t('Farbe (Slot) – anklicken oder Taste 1–9') : PT.mode === 'support' ? t('Stützen – Taste 1 oder 2') : t('Naht – Taste 1 oder 2');
  if (PT.mode !== 'color') {
    const marks = PT_MARKS[PT.mode], hex = s => rgbHex(PT_MARK_RGB[s]);
    $('ptSlots').innerHTML = marks.map(([k, label, title]) => '<button type="button" class="pt-mark' + (!PT.erase && PT.mark === k ? ' active' : '') + '" data-pt-mark="' + k + '" title="' + esc(title + ' (' + k + ')') + '" aria-pressed="' + (!PT.erase && PT.mark === k) + '"><i style="background:' + hex(k) + '"></i>' + esc(label) + '</button>').join('') + eraseBtn;
    const cur = marks.find(m => m[0] === PT.mark);
    $('ptCurrent').innerHTML = PT.erase ? esc(t('Radierer – Markierung entfernen')) : '<i style="background:' + hex(PT.mark) + '"></i>' + esc(cur[2]) +
      (PT.mode === 'support' && PT.mark === 1 ? ' <small>' + esc(t('(ohne Stützen stützt der Export nur die gemalten Stellen)')) + '</small>' : '');
  } else {
  // Farbe = Slot; angezeigt wie in der 3D-Ansicht (Slot ohne Farbe: Ersatzfarbe, js/bodies-ui.js slotColour)
  if (PT.slot >= slots.length) PT.slot = 0;
  const cur = slots[PT.slot] || {}, curHex = slotColour(PT.slot, slots);
  $('ptCurrent').innerHTML = PT.erase ? esc(t('Radierer – zurück zur Farbe des Teils')) :
    '<i style="background:' + curHex + '"></i>' + esc(t('Malt mit Slot {n}', { n: PT.slot + 1 })) + (cur.type ? ' · ' + esc(cur.type) : '') + (validSlotHex(cur.colour) ? '' : ' <small>' + esc(t('(Slot ohne Farbe – Ersatzfarbe)')) + '</small>');
  $('ptSlots').innerHTML = slots.map((s, i) => {
    const bg = slotColour(i, slots), on = !PT.erase && PT.slot === i;
    return '<button type="button" class="slot-chip' + (on ? ' active' : '') + '" data-pt-slot="' + i + '" style="--chip:' + bg + ';--chip-ink:' + slotInk(bg) + '" title="' + esc('Slot ' + (i + 1) + (s.type ? ' · ' + s.type : '') + (i < 9 ? ' (' + (i + 1) + ')' : '')) + '" aria-pressed="' + on + '">' + (i + 1) + '</button>';
  }).join('') + eraseBtn;
  }
  const max = Math.min(PT_MAX_RADIUS_MM, Math.max(2, part ? Math.max(part.geom.x, part.geom.y, part.geom.z) / 2 : 20));
  $('ptSize').max = String(max); $('ptSize').value = String(PT.radius); $('ptSizeVal').textContent = de(PT.radius, PT.radius < 10 ? 1 : 0) + ' mm';
  $('ptSizeRow').classList.toggle('hidden', PT.tool === 'fill' || PT.tool === 'gap');
  $('ptAngleRow').classList.toggle('hidden', PT.tool !== 'fill');
  $('ptGapRow').classList.toggle('hidden', PT.tool !== 'gap');
  $('ptGap').value = String(PT.gap); $('ptGapVal').textContent = de(PT.gap, 1) + ' mm²';
  $('ptAngle').value = String(PT.angle); $('ptAngleVal').textContent = de(PT.angle, 0) + '°';
  const why = ptCanPaint(part);
  $('ptNote').textContent = why;
  $('ptNote').classList.toggle('hidden', !why);
  if (PT.tool !== 'fill' && ptPrevKey) { ptPrevKey = ''; Viewer.setPreview(null); }
  if (Viewer.setBrush && PT.on) Viewer.setBrush(PT.tool === 'gap' ? null : { cursor: PT.tool === 'sphere' ? 'sphere' : PT.tool === 'height' ? 'height' : PT.tool === 'fill' ? 'none' : 'circle', radius: PT.radius, onStroke: ptStroke, onHover: ptHover });
}
function paintMode(on) {
  on = !!on && !!ptPart();
  if (PT.on === on) { ptRender(); return; }
  PT.on = on;
  $('tbPaint').classList.toggle('active', on);
  if (on) {
    // malen geht auf dem einzelnen Teil (die ganze Platte zeigt nur an), Farben einblenden
    if (typeof plateView !== 'undefined' && plateView) { plateView = false; $('btnPlate').classList.remove('active'); if (geom) showModel(geom); }
    if (!$('bodyShow').checked) { $('bodyShow').checked = true; PT.showWasOff = true; }
    const p = ptPart();
    // Nachbarn schon jetzt berechnen (großes Netz: einige Hundert ms), damit der erste Strich nicht hakt
    if (p) setTimeout(() => { if (PT.on && ptPart()) ptAdj(ptPart().geom); }, 50);
    if (p && !PT.radiusSet) PT.radius = Math.max(0.5, Math.min(10, Math.round(Math.max(p.geom.x, p.geom.y, p.geom.z) / 25 * 2) / 2));
  } else {
    Viewer.setBrush(null); Viewer.setPreview(null); Viewer.setPaintLayer(null, null, 'stroke'); ptPrevKey = '';
    if (PT.showWasOff) { $('bodyShow').checked = false; PT.showWasOff = false; }
  }
  ptRender();
  paintBodies(ptPart());
}

$('tbPaint').addEventListener('click', () => paintMode(!PT.on));
// ganze Platte zeigt nur an – dann endet das Malen
$('btnPlate').addEventListener('click', () => { if (PT.on && plateView) paintMode(false); });
$('ptDone').addEventListener('click', () => paintMode(false));
$('ptClear').addEventListener('click', ptClearAll);
$('ptGapRun').addEventListener('click', ptGapFill);
$('ptGap').addEventListener('input', () => { PT.gap = +$('ptGap').value; $('ptGapVal').textContent = de(PT.gap, 1) + ' mm²'; });
$('paintPanel').addEventListener('click', e => {
  const tool = e.target.closest('[data-pt-tool]'), slot = e.target.closest('[data-pt-slot]'), er = e.target.closest('[data-pt-erase]');
  const mode = e.target.closest('[data-pt-mode]'), mark = e.target.closest('[data-pt-mark]');
  if (mode) { PT.mode = mode.dataset.ptMode; PT.erase = false; ptRender(); paintBodies(ptPart()); return; }
  if (mark) { PT.mark = +mark.dataset.ptMark; PT.erase = false; ptRender(); return; }
  if (tool) PT.tool = tool.dataset.ptTool;
  else if (slot) { PT.slot = +slot.dataset.ptSlot; PT.erase = false; }
  else if (er) PT.erase = !PT.erase;
  else return;
  ptRender();
});
$('ptSize').addEventListener('input', () => { PT.radius = +$('ptSize').value; PT.radiusSet = true; $('ptSizeVal').textContent = de(PT.radius, PT.radius < 10 ? 1 : 0) + ' mm'; Viewer.setBrushRadius(PT.radius); });
$('ptAngle').addEventListener('input', () => { PT.angle = +$('ptAngle').value; $('ptAngleVal').textContent = de(PT.angle, 0) + '°'; });
// Alt + Mausrad: Pinselgröße (wie OrcaSlicer)
$('stage').addEventListener('wheel', e => {
  if (!PT.on || !e.altKey) return;
  e.preventDefault(); e.stopPropagation();
  const max = +$('ptSize').max || PT_MAX_RADIUS_MM;
  PT.radius = Math.round(Math.max(0.2, Math.min(max, PT.radius * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) * 10) / 10; PT.radiusSet = true;
  ptRender(); Viewer.setBrushRadius(PT.radius);
}, { capture: true, passive: false });
// Tasten: 1–9 Slot, E Radierer, Esc beendet
document.addEventListener('keydown', e => {
  if (!PT.on || e.ctrlKey || e.metaKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(range|checkbox|radio|button)$/i.test(el.type || ''))) return;
  if (PT.mode !== 'color' && (e.key === '1' || e.key === '2')) { PT.mark = +e.key; PT.erase = false; ptRender(); e.preventDefault(); }
  else if (PT.mode === 'color' && /^[1-9]$/.test(e.key) && +e.key <= slotChoices().length) { PT.slot = +e.key - 1; PT.erase = false; ptRender(); e.preventDefault(); }
  else if (e.key.toLowerCase() === 'e') { PT.erase = !PT.erase; ptRender(); e.preventDefault(); }
  else if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { paintMode(false); e.preventDefault(); }
});
