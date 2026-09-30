'use strict';
/* Farbbemalung je Dreieck (Bambu Studio / OrcaSlicer: paint_color, PrusaSlicer: slic3rpe:mmu_segmentation). Aufbau wie
   TriangleSelector::serialize: Hex-Ziffern, von hinten gelesen. Je Knoten eine Ziffer: untere 2 Bit = Zahl der geteilten
   Seiten (0 = Blatt), obere 2 Bit = Filament (1–2; 3 = „erweitert“, dann folgt eine Ziffer + 3) bzw. bei geteilten
   Dreiecken die besondere Seite; danach die Kinder (geteilte Seiten + 1) in derselben Reihenfolge.
   Filament 0 = keins (Slot des Teils), sonst Filamentnummer des Designers (1-basiert).
   Nur Lesen der Farben und Umschreiben der Filamentnummern – die Unterteilung bleibt unverändert. */

// Baum als flache Liste lesen: [{split, side, state}] in Lesereihenfolge (Tiefe zuerst)
function paintNodes(str) {
  const out = [];
  let pos = str.length;
  const next = () => { if (pos <= 0) throw Error('paint_color zu kurz'); return parseInt(str[--pos], 16); };
  const node = () => {
    const code = next(), split = code & 3;
    if (!split) { let st = code >> 2; if (st === 3) st = next() + 3; out.push({ split: 0, state: st }); return; }
    out.push({ split, side: code >> 2 });
    for (let k = 0; k <= split; k++) node();
  };
  while (pos > 0) node();      // üblich: genau ein Baum je Dreieck
  return out;
}
// Überwiegendes Filament eines Dreiecks (Flächenanteil: jedes Kind ≈ gleicher Teil seines Elternteils)
function paintMain(str) {
  if (!str) return 0;
  if (str.length === 1) { const c = parseInt(str, 16); return (c & 3) ? paintMainTree(str) : c >> 2; }
  if (str.length === 2 && (parseInt(str[1], 16) & 3) === 0 && parseInt(str[1], 16) >> 2 === 3) return parseInt(str[0], 16) + 3;
  return paintMainTree(str);
}
function paintMainTree(str) {
  let nodes;
  try { nodes = paintNodes(str); } catch (e) { return 0; }
  const w = new Map();
  let i = 0;
  const walk = share => {
    const n = nodes[i++];
    if (!n) return;
    if (!n.split) { w.set(n.state, (w.get(n.state) || 0) + share); return; }
    for (let k = 0; k <= n.split; k++) walk(share / (n.split + 1));
  };
  while (i < nodes.length) walk(1);
  let best = 0, bw = -1;
  for (const [s, v] of w) if (v > bw) { best = s; bw = v; }
  return best;
}
// Alle vorkommenden Filamente eines Codes
function paintStates(str) {
  try { return [...new Set(paintNodes(str).filter(n => !n.split).map(n => n.state))]; } catch (e) { return []; }
}
// Filamentnummern umschreiben (map: alte Nummer → neue, 1-basiert; 0 bleibt 0); Ergebnis wieder als Hex-Code
function paintRemap(str, map) {
  const nodes = paintNodes(str), nib = [];
  for (const n of nodes) {
    if (n.split) { nib.push((n.side << 2) | n.split); continue; }
    const st = n.state ? (map(n.state) ?? n.state) : 0;
    if (st < 3) nib.push(st << 2); else { nib.push(3 << 2); nib.push(st - 3); }
  }
  // von hinten gelesen → in umgekehrter Reihenfolge schreiben
  let s = '';
  for (let k = nib.length - 1; k >= 0; k--) s += nib[k].toString(16).toUpperCase();
  return s;
}

/* ---------- Bemalen (js/paint-ui.js) ----------
   Baum je Dreieck: Blatt {s} (Filament, 0 = Slot des Teils) oder {split, side, c: [Kinder]} mit den Kindern in der
   Reihenfolge von OrcaSlicer (TriangleSelector). Im Code stehen die Kinder rückwärts (c[split] zuerst gelesen).
   Lage der Kinder: Ecken ab der besonderen Seite gedreht (v0 = Ecke[side]); gemessen mit der Orca-CLI (2026-09-30,
   Platte mit einem bemalten Kind je Fall, Mitte der Farbe im G-Code der obersten Schicht):
     1 Seite:  m = Mitte(v1,v2):                         c0 = (v0,v1,m)      c1 = (m,v2,v0)
     2 Seiten: m01 = Mitte(v0,v1), m20 = Mitte(v2,v0):  c0 = (v0,m01,m20)   c1 = (m01,v1,m20)   c2 = (v1,v2,m20)
     3 Seiten: dazu m12:                                 c0 = (v0,m01,m20)   c1 = (m01,v1,m12)   c2 = (m12,v2,m20)   c3 = (m01,m12,m20) */
function paintTree(str) {
  if (!str) return { s: 0 };
  let pos = str.length;
  const next = () => { if (pos <= 0) throw Error('paint_color zu kurz'); return parseInt(str[--pos], 16); };
  const node = () => {
    const code = next(), split = code & 3;
    if (!split) { let s = code >> 2; if (s === 3) s = next() + 3; return { s }; }
    const c = [];
    for (let k = 0; k <= split; k++) c.unshift(node());   // gelesen: c[split] … c[0]
    return { split, side: code >> 2, c };
  };
  return node();
}
function paintCode(tree) {
  const nib = [];
  const walk = n => {
    if (!n.c) { if (n.s < 3) nib.push(n.s << 2); else { nib.push(12); nib.push(n.s - 3); } return; }
    nib.push((n.side << 2) | n.split);
    for (let k = n.split; k >= 0; k--) walk(n.c[k]);
  };
  walk(tree);
  let s = '';
  for (let k = nib.length - 1; k >= 0; k--) s += nib[k].toString(16).toUpperCase();
  return s;
}
const pMid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
function paintKids(a, b, c, split, side) {
  const v = [a, b, c], v0 = v[side % 3], v1 = v[(side + 1) % 3], v2 = v[(side + 2) % 3];
  if (split === 1) { const m = pMid(v1, v2); return [[v0, v1, m], [m, v2, v0]]; }
  const m01 = pMid(v0, v1), m20 = pMid(v2, v0);
  if (split === 2) return [[v0, m01, m20], [m01, v1, m20], [v1, v2, m20]];
  const m12 = pMid(v1, v2);
  return [[v0, m01, m20], [m01, v1, m12], [m12, v2, m20], [m01, m12, m20]];
}
// Blätter mit ihren Ecken: fn(a, b, c, s)
function paintLeaves(tree, a, b, c, fn) {
  if (!tree.c) { fn(a, b, c, tree.s); return; }
  const k = paintKids(a, b, c, tree.split, tree.side);
  tree.c.forEach((ch, i) => paintLeaves(ch, k[i][0], k[i][1], k[i][2], fn));
}
function paintTreeStates(tree, out = new Set()) { if (!tree.c) out.add(tree.s); else tree.c.forEach(ch => paintTreeStates(ch, out)); return out; }
// Filamentnummern im Baum umschreiben (neuer Baum)
const paintTreeMap = (tree, fn) => tree.c ? { split: tree.split, side: tree.side, c: tree.c.map(ch => paintTreeMap(ch, fn)) } : { s: tree.s ? fn(tree.s) : 0 };

/* Pinsel auf ein Dreieck anwenden. brush.tri(a,b,c) → 0 außerhalb, 1 ganz innen, 2 teilweise; brush.pt(p) → innen?
   Teilweise getroffene Dreiecke werden geteilt (3 Seiten, wie Orca), bis die längste Kante ≤ minEdge ist; gleiche
   Geschwister werden wieder zusammengefasst. Ergebnis: neuer Baum (oder derselbe, wenn nichts passiert). */
const PAINT_MAX_DEPTH = 12;
function paintApply(tree, a, b, c, brush, state, minEdge, depth = 0) {
  const hit = brush.tri(a, b, c);
  if (!hit) return tree;
  const d2 = Math.max((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2, (b[0] - c[0]) ** 2 + (b[1] - c[1]) ** 2 + (b[2] - c[2]) ** 2, (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 + (c[2] - a[2]) ** 2);
  if (hit === 1 || depth >= PAINT_MAX_DEPTH || d2 <= minEdge * minEdge) {
    if (hit === 2 && !brush.pt([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3])) return tree;
    return !tree.c && tree.s === state ? tree : { s: state };
  }
  const t = tree.c ? tree : { split: 3, side: 0, c: [0, 1, 2, 3].map(() => ({ s: tree.s })) };
  const k = paintKids(a, b, c, t.split, t.side);
  let changed = !tree.c;
  const kids = t.c.map((ch, i) => { const n = paintApply(ch, k[i][0], k[i][1], k[i][2], brush, state, minEdge, depth + 1); if (n !== ch) changed = true; return n; });
  if (!changed) return tree;
  if (kids.every(x => !x.c && x.s === kids[0].s)) return { s: kids[0].s };
  return { split: t.split, side: t.side, c: kids };
}

/* ---------- Bemalung eines Teils (Anzeige und Export) ----------
   part.paintUser = {rev, codes: {Dreieck: Code}, slots: [Slots]} – eigene Bemalung in Slot-Nummern (Slot + 1, 0 = Farbe
   des Teils/Körpers); unveränderlich, jeder Pinselstrich legt ein neues Objekt an (Rückgängig, Kopien teilen es).
   Bemalung des Designers: part.paintState (überwiegendes Filament je Dreieck) und part.paintCodes (geteilte Dreiecke),
   Filamente des Designers, umgelegt über designMap. Eigene Bemalung eines Dreiecks ersetzt die des Designers. */
/* Drei Ebenen wie in OrcaSlicer (je Dreieck eigenes Attribut): Farbe (paint_color, Filament), Stützen (paint_supports,
   1 = erzwingen, 2 = verhindern) und Naht (paint_seam, 1 = hier, 2 = nicht hier). Je Ebene: eigene Bemalung am Teil (key)
   und die des Designers (designer: Index → Code; bei der Farbe paintState/paintCodes). Stützen-Verhalten gemessen mit der
   Orca-CLI (2026-09-30): Erzwingen wirkt nur mit enable_support = 1; support_type „tree(manual)“ stützt nur die gemalten
   Stellen, „tree(auto)“ zusätzlich alles andere; Verhindern hebt Stützen auch bei „auto“ auf. Naht: ohne weitere Einstellung. */
const PAINT_LAYERS = {
  color: { key: 'paintUser', attr: 'paint_color', designer: null },
  support: { key: 'paintSup', attr: 'paint_supports', designer: 'supCodes' },
  seam: { key: 'paintSeam', attr: 'paint_seam', designer: 'seamCodes' }
};
const paintUserCodes = (p, layer = 'color') => { const u = p && p[PAINT_LAYERS[layer].key]; return (u && u.codes) || null; };
const paintUserSlots = p => (p && p.paintUser && p.paintUser.slots) || [];
function paintDesignerCode(part, i) {
  const c = part.paintCodes && part.paintCodes[i];
  if (c) return c;
  const s = part.paintState ? part.paintState[i] : 0;
  return s ? paintCode({ s }) : '';
}
// Code eines Dreiecks in Slot-Nummern ('' = unbemalt)
function paintSlotCode(part, i, dmap) {
  const u = paintUserCodes(part);
  if (u && u[i] != null) return u[i];
  const c = paintDesignerCode(part, i);
  return c ? paintRemap(c, d => (dmap[d - 1] ?? d - 1) + 1) : '';
}
const paintHas = p => !!p && (!!p.paintState || Object.keys(PAINT_LAYERS).some(l => { const u = paintUserCodes(p, l), d = PAINT_LAYERS[l].designer && p[PAINT_LAYERS[l].designer];
  return (u && Object.keys(u).length) || (d && Object.keys(d).length); }));
// Code eines Dreiecks in einer Ebene ('' = unbemalt); Farbe in Slot-Nummern
function paintLayerCode(part, i, layer, dmap) {
  if (layer === 'color') return paintSlotCode(part, i, dmap || {});
  const u = paintUserCodes(part, layer);
  if (u && u[i] != null) return u[i];
  const d = part[PAINT_LAYERS[layer].designer];
  return (d && d[i]) || '';
}
// Stützen erzwungen (irgendwo Zustand 1)? – dann braucht das Objekt enable_support (js/export3mf.js supportPaintOverrides)
function paintHasEnforcers(part) {
  const all = { ...(part.supCodes || {}), ...(paintUserCodes(part, 'support') || {}) };
  for (const k in all) { const c = all[k]; if (c && c !== '0' && paintStates(c).includes(1)) return true; }
  return false;
}
// Export eigener Netze: Dreieck → Attribute aller Ebenen (' paint_color="…" paint_supports="…"') oder null ohne Bemalung
function paintAttrsFn(part, dmap, nFil) {
  if (!paintHas(part)) return null;
  const col = paintExportFn(part, dmap, nFil) || (() => '');
  const other = ['support', 'seam'].filter(l => { const u = paintUserCodes(part, l), d = part[PAINT_LAYERS[l].designer]; return (u && Object.keys(u).length) || (d && Object.keys(d).length); });
  return i => {
    let s = '';
    const c = col(i); if (c) s += ' paint_color="' + c + '"';
    for (const l of other) { const x = paintLayerCode(part, i, l); if (x && x !== '0') s += ' ' + PAINT_LAYERS[l].attr + '="' + x + '"'; }
    return s;
  };
}
// Für den Export eigener Netze: Dreieck → Code mit Filamentnummern der 3MF (1..nFil) oder '' – null ohne Bemalung
function paintExportFn(part, dmap, nFil) {
  if (!part.paintState && !(paintUserCodes(part) && Object.keys(part.paintUser.codes).length)) return null;
  const fil = s => Math.min(s - 1, nFil - 1) + 1;
  return i => { const c = paintSlotCode(part, i, dmap || {}); return !c || c === '0' ? '' : paintRemap(c, fil); };
}

/* ---------- Pinselformen (Koordinaten wie part.geom) ----------
   Wie in OrcaSlicer wächst ein Pinselstrich vom getroffenen Dreieck über die Nachbarn (paintCollect) – verdeckte,
   nicht verbundene Flächen bleiben unberührt. Ein Strich zwischen zwei Mauspunkten deckt die Strecke dazwischen ab. */
const pSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], pDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const pCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Abstand Punkt–Strecke
function pSegDist(p, a, b) {
  const ab = pSub(b, a), l = pDot(ab, ab), t = l ? Math.max(0, Math.min(1, pDot(pSub(p, a), ab) / l)) : 0;
  const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
// Abstand Punkt–Dreieck (nächster Punkt nach Ericson, „Real-Time Collision Detection“ 5.1.5)
function pTriDist(p, a, b, c) {
  const ab = pSub(b, a), ac = pSub(c, a), ap = pSub(p, a), d1 = pDot(ab, ap), d2 = pDot(ac, ap);
  const at = q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = pSub(p, b), d3 = pDot(ab, bp), d4 = pDot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at([a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]); }
  const cp = pSub(p, c), d5 = pDot(ab, cp), d6 = pDot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at([a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return at([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}
// Stützpunkte entlang der Strecke (für den Abstand Dreieck–Strecke)
function pSamples(p0, p1, r) {
  const n = Math.min(32, Math.max(1, Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / Math.max(r * 0.5, 1e-3))));
  return Array.from({ length: n + 1 }, (_, k) => [p0[0] + (p1[0] - p0[0]) * k / n, p0[1] + (p1[1] - p0[1]) * k / n, p0[2] + (p1[2] - p0[2]) * k / n]);
}
// Kugel (bzw. Kapsel von p0 nach p1) mit Radius r
function paintBrushSphere(p0, p1, r) {
  const S = pSamples(p0, p1, r), inside = p => pSegDist(p, p0, p1) <= r;
  return { pt: inside, tri: (a, b, c) => {
    if (inside(a) && inside(b) && inside(c)) return 1;
    for (const s of S) if (pTriDist(s, a, b, c) <= r) return 2;
    return 0;
  } };
}
// Kreis: Zylinder entlang der Blickrichtung dir (Einheitsvektor) – nur Flächen, die zur Kamera zeigen
function paintBrushCircle(p0, p1, r, dir) {
  const flat = p => { const k = pDot(p, dir); return [p[0] - dir[0] * k, p[1] - dir[1] * k, p[2] - dir[2] * k]; };
  const q0 = flat(p0), q1 = flat(p1), S = pSamples(q0, q1, r), inside = p => pSegDist(flat(p), q0, q1) <= r;
  return { facing: dir, pt: inside, tri: (a, b, c) => {
    if (pDot(pCross(pSub(b, a), pSub(c, a)), dir) >= 0) return 0;   // Rückseite
    if (inside(a) && inside(b) && inside(c)) return 1;
    const fa = flat(a), fb = flat(b), fc = flat(c);
    for (const s of S) if (pTriDist(s, fa, fb, fc) <= r) return 2;
    return 0;
  } };
}
// Höhenbereich z0 … z1 (ganzes Teil, nicht nur die verbundene Fläche)
function paintBrushHeight(z0, z1) {
  return { all: true, pt: p => p[2] >= z0 && p[2] <= z1, tri: (a, b, c) => {
    const lo = Math.min(a[2], b[2], c[2]), hi = Math.max(a[2], b[2], c[2]);
    return hi < z0 || lo > z1 ? 0 : lo >= z0 && hi <= z1 ? 1 : 2;
  } };
}

// Nachbarn über gemeinsame Kanten (Ecken nach Lage zusammengefasst): {start, list} wie CSR
function paintAdjacency(pos) {
  const n = pos.length / 9, vid = new Map(), ids = new Uint32Array(n * 3);
  const q = v => Math.round(v * 1e4);
  for (let i = 0; i < n * 3; i++) {
    const k = q(pos[i * 3]) + ',' + q(pos[i * 3 + 1]) + ',' + q(pos[i * 3 + 2]);
    let id = vid.get(k); if (id === undefined) { id = vid.size; vid.set(k, id); } ids[i] = id;
  }
  const nv = vid.size, edges = new Map();
  for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) {
    const a = ids[t * 3 + e], b = ids[t * 3 + (e + 1) % 3], key = Math.min(a, b) * nv + Math.max(a, b);
    const l = edges.get(key); if (l) l.push(t); else edges.set(key, [t]);
  }
  const cnt = new Uint32Array(n + 1);
  for (const l of edges.values()) if (l.length > 1) for (const t of l) cnt[t + 1] += l.length - 1;
  for (let t = 0; t < n; t++) cnt[t + 1] += cnt[t];
  const list = new Uint32Array(cnt[n]), fill = cnt.slice(0, n);
  for (const l of edges.values()) if (l.length > 1) for (const t of l) for (const u of l) if (u !== t) list[fill[t]++] = u;
  return { start: cnt, list };
}
const pTri = (pos, t) => { const o = t * 9; return [[pos[o], pos[o + 1], pos[o + 2]], [pos[o + 3], pos[o + 4], pos[o + 5]], [pos[o + 6], pos[o + 7], pos[o + 8]]]; };
const pNormal = (pos, t) => { const [a, b, c] = pTri(pos, t), n = pCross(pSub(b, a), pSub(c, a)), l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };
// Dreiecke, die der Pinsel erreicht: vom Start über Nachbarn, solange brush.tri ≠ 0 (Höhenbereich: alle)
function paintCollect(pos, adj, start, brush) {
  const n = pos.length / 9, out = [];
  if (brush.all) { for (let t = 0; t < n; t++) { const [a, b, c] = pTri(pos, t); if (brush.tri(a, b, c)) out.push(t); } return out; }
  const seen = new Uint8Array(n), stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const t = stack.pop(), [a, b, c] = pTri(pos, t);
    if (!brush.tri(a, b, c) && t !== start) continue;
    out.push(t);
    for (let k = adj.start[t]; k < adj.start[t + 1]; k++) { const u = adj.list[k]; if (!seen[u]) { seen[u] = 1; stack.push(u); } }
  }
  return out;
}
// Füllen: zusammenhängende Fläche, deren Nachbarn höchstens angle° voneinander abweichen
function paintFill(pos, adj, start, angle) {
  const n = pos.length / 9, cos = Math.cos(Math.min(180, Math.max(0, angle)) * Math.PI / 180), seen = new Uint8Array(n), out = [], stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const t = stack.pop(), nt = pNormal(pos, t);
    out.push(t);
    for (let k = adj.start[t]; k < adj.start[t + 1]; k++) {
      const u = adj.list[k];
      if (!seen[u] && pDot(nt, pNormal(pos, u)) >= cos - 1e-9) { seen[u] = 1; stack.push(u); }
    }
  }
  return out;
}
// Überwiegendes Filament eines Baums (Flächenanteile der Kinder wie bei Orca: 3 Seiten je ¼, 2 Seiten ¼ ¼ ½, 1 Seite ½ ½)
const PAINT_SHARE = { 1: [0.5, 0.5], 2: [0.25, 0.25, 0.5], 3: [0.25, 0.25, 0.25, 0.25] };
function paintTreeMain(tree) {
  if (!tree.c) return tree.s;
  const w = new Map();
  const walk = (n, f) => { if (!n.c) { w.set(n.s, (w.get(n.s) || 0) + f); return; } n.c.forEach((ch, i) => walk(ch, f * PAINT_SHARE[n.split][i])); };
  walk(tree, 1);
  let best = 0, bw = -1;
  for (const [s, v] of w) if (v > bw) { best = s; bw = v; }
  return best;
}

/* ---------- Lücken füllen (wie „Gap fill“ in OrcaSlicer) ----------
   Unbemalte Stellen (Zustand 0, auch Teilstücke geteilter Dreiecke), die zusammen kleiner als maxArea mm² sind, bekommen die
   Farbe ihrer Umgebung (überwiegender Zustand ringsum). Zusammenhang über Nachbardreiecke mit unbemaltem Anteil; ganz
   unbemalte Inseln ohne bemalte Nachbarn bleiben. treeAt(t) → Baum des Dreiecks. Ergebnis: Map Dreieck → neuer Baum. */
const pArea = (a, b, c) => { const n = pCross(pSub(b, a), pSub(c, a)); return Math.hypot(n[0], n[1], n[2]) / 2; };
function paintTreeAreas(tree, a, b, c, out = new Map()) {
  paintLeaves(tree, a, b, c, (p, q, r, s) => out.set(s, (out.get(s) || 0) + pArea(p, q, r)));
  return out;
}
function paintFillZero(tree, state) {
  if (!tree.c) return tree.s ? tree : { s: state };
  const c = tree.c.map(ch => paintFillZero(ch, state));
  return c.every(x => !x.c && x.s === c[0].s) ? { s: c[0].s } : { split: tree.split, side: tree.side, c };
}
// Kanten des Dreiecks (0: a–b, 1: b–c, 2: c–a), an die ein unbemaltes Teilstück grenzt
function paintZeroEdges(tree, a, b, c) {
  if (!tree.c) return tree.s ? [false, false, false] : [true, true, true];
  const E = [[a, b], [b, c], [c, a]], on = (p, e) => { const d = pSub(e[1], e[0]), l = pDot(d, d), t = pDot(pSub(p, e[0]), d) / l;
    if (t < -1e-6 || t > 1 + 1e-6) return false; const q = [e[0][0] + d[0] * t, e[0][1] + d[1] * t, e[0][2] + d[2] * t]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-5 * Math.sqrt(l) + 1e-7; };
  const out = [false, false, false];
  paintLeaves(tree, a, b, c, (p, q, r, s) => { if (s) return; for (const [u, v] of [[p, q], [q, r], [r, p]]) for (let k = 0; k < 3; k++) if (!out[k] && on(u, E[k]) && on(v, E[k])) out[k] = true; });
  return out;
}
// gemeinsame Kante von t mit u (Index 0–2 in t) oder -1
function paintSharedEdge(pos, t, u) {
  const same = (i, j) => pos[i] === pos[j] && pos[i + 1] === pos[j + 1] && pos[i + 2] === pos[j + 2];
  const hit = [0, 1, 2].map(k => [0, 1, 2].some(m => same(t * 9 + k * 3, u * 9 + m * 3)));
  return hit[0] && hit[1] ? 0 : hit[1] && hit[2] ? 1 : hit[2] && hit[0] ? 2 : -1;
}
function paintGaps(pos, adj, treeAt, maxArea) {
  const n = pos.length / 9, zero = new Float64Array(n), areas = new Array(n), edges = new Array(n), done = new Uint8Array(n), out = new Map();
  for (let t = 0; t < n; t++) {
    const tr = treeAt(t), [a, b, c] = pTri(pos, t);
    if (!tr.c) { zero[t] = tr.s ? 0 : pArea(a, b, c); if (tr.s) areas[t] = new Map([[tr.s, pArea(a, b, c)]]); continue; }
    const m = paintTreeAreas(tr, a, b, c); areas[t] = m; zero[t] = m.get(0) || 0;
    if (zero[t]) edges[t] = paintZeroEdges(tr, a, b, c);
  }
  // unbemalt über die gemeinsame Kante verbunden? (ganz unbemalte Dreiecke: alle Kanten)
  const open = (t, u) => { const e = edges[t]; if (!e) return true; const k = paintSharedEdge(pos, t, u); return k < 0 || e[k]; };
  for (let s = 0; s < n; s++) {
    if (!zero[s] || done[s]) continue;
    const comp = [], stack = [s]; let sum = 0;
    done[s] = 1;
    while (stack.length) {
      const t = stack.pop(); comp.push(t); sum += zero[t];
      for (let k = adj.start[t]; k < adj.start[t + 1]; k++) { const u = adj.list[k]; if (!done[u] && zero[u] && open(t, u) && open(u, t)) { done[u] = 1; stack.push(u); } }
    }
    if (sum >= maxArea) continue;
    // Stimmen: bemalte Anteile in der Lücke und ringsum (Fläche)
    const votes = new Map(), inComp = new Set(comp);
    const vote = t => { const m = areas[t]; if (m) for (const [st, v] of m) if (st) votes.set(st, (votes.get(st) || 0) + v); };
    for (const t of comp) { vote(t); for (let k = adj.start[t]; k < adj.start[t + 1]; k++) if (!inComp.has(adj.list[k])) vote(adj.list[k]); }
    let best = 0, bv = 0;
    for (const [st, v] of votes) if (v > bv) { best = st; bv = v; }
    if (!best) continue;
    for (const t of comp) out.set(t, paintFillZero(treeAt(t), best));
  }
  return out;
}
