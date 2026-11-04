'use strict';
/* Teil schneiden (2026-11-04): Netz an einer achsparallelen Ebene in zwei geschlossene Netze teilen. Dreiecke, die die
   Ebene kreuzen, werden geteilt; die Schnittkanten werden zu Umrissen verbunden und als Deckel (mit Löchern, earcut)
   auf beide Seiten gesetzt. cutMesh(pos, axis 0|1|2, value) → { lo, hi, loops, open } – lo = Seite unter value. */

const CUT_KEY = 1e5;   // Schnittpunkte auf 10 nm gerundet verbinden

function cutMesh(pos, axis, value) {
  const k = axis, ia = (k + 1) % 3, ib = (k + 2) % 3;   // (a, b, k) rechtshändig
  // Keine Ecke genau auf der Ebene (sonst entarten Dreiecke und Umrisse verzweigen)
  for (let tries = 0; tries < 20; tries++) {
    let hit = false;
    for (let i = k; i < pos.length; i += 3) if (Math.abs(pos[i] - value) < 1e-6) { hit = true; break; }
    if (!hit) break;
    value += 1.37e-4;
  }
  const lo = [], hi = [], seg = [];
  const V = i => [pos[i], pos[i + 1], pos[i + 2]];
  const push = (arr, ...ps) => { for (const p of ps) arr.push(p[0], p[1], p[2]); };
  // Schnittpunkt einer Kante – immer in derselben Richtung gerechnet, damit Nachbardreiecke denselben Punkt bekommen
  const inter = (p, q) => {
    if (p[0] > q[0] || (p[0] === q[0] && (p[1] > q[1] || (p[1] === q[1] && p[2] > q[2])))) [p, q] = [q, p];
    const s = (value - p[k]) / (q[k] - p[k]), r = [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, p[2] + (q[2] - p[2]) * s];
    r[k] = value;
    return r;
  };
  for (let o = 0; o < pos.length; o += 9) {
    const P = [V(o), V(o + 3), V(o + 6)], up = P.map(p => p[k] > value), n = up.filter(Boolean).length;
    if (n === 0) { push(lo, ...P); continue; }
    if (n === 3) { push(hi, ...P); continue; }
    // A = die einzelne Ecke auf ihrer Seite, B und C folgen in der Reihenfolge des Dreiecks
    const ai = n === 1 ? up.indexOf(true) : up.indexOf(false), A = P[ai], B = P[(ai + 1) % 3], C = P[(ai + 2) % 3];
    const pab = inter(A, B), pca = inter(C, A), aSide = up[ai] ? hi : lo, bSide = up[ai] ? lo : hi;
    push(aSide, A, pab, pca);
    push(bSide, pab, B, C, pab, C, pca);
    seg.push([pab, pca]);
  }
  // Schnittkanten zu Umrissen verbinden (in der Ebene: Koordinaten a, b)
  const key = p => Math.round(p[ia] * CUT_KEY) + ',' + Math.round(p[ib] * CUT_KEY);
  const adj = new Map(), pt = new Map();
  for (const [p, q] of seg) {
    const kp = key(p), kq = key(q);
    if (kp === kq) continue;
    pt.set(kp, [p[ia], p[ib]]); pt.set(kq, [q[ia], q[ib]]);
    (adj.get(kp) || adj.set(kp, []).get(kp)).push(kq);
    (adj.get(kq) || adj.set(kq, []).get(kq)).push(kp);
  }
  // Winziges festes Zittern (≤ 0,1 µm) der Schnittpunkte: liegen Umrisse genau auf einer Linie (CAD-Teile), zöge earcut
  // sonst Deckelkanten durch fremde Ecken. Dieselben Punkte werden in den Seitendreiecken ersetzt (Netz bleibt dicht).
  let seed = 7;
  const jit = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2e-4; };
  for (const [kk, p] of pt) pt.set(kk, [p[0] + jit(), p[1] + jit()]);
  for (const arr of [lo, hi]) for (let i = 0; i < arr.length; i += 3) {
    if (arr[i + k] !== value) continue;
    const q = pt.get(Math.round(arr[i + ia] * CUT_KEY) + ',' + Math.round(arr[i + ib] * CUT_KEY));
    if (q) { arr[i + ia] = q[0]; arr[i + ib] = q[1]; }
  }
  const loops = [];
  let open = 0;
  const used = new Set(), ek = (x, y) => (x < y ? x + '|' + y : y + '|' + x);
  for (const start of adj.keys()) {
    for (const first of adj.get(start)) {
      if (used.has(ek(start, first))) continue;
      const loop = [start];
      let prev = start, cur = first;
      used.add(ek(start, first));
      while (cur !== start) {
        loop.push(cur);
        const nx = (adj.get(cur) || []).find(x => x !== prev && !used.has(ek(cur, x)));
        if (nx === undefined) { open++; loop.length = 0; break; }
        used.add(ek(cur, nx)); prev = cur; cur = nx;
      }
      if (loop.length >= 3) loops.push(loop.map(x => pt.get(x)));
    }
  }
  // Verschachtelung: gerade Tiefe = Außenumriss, ungerade = Loch im nächstäußeren
  const info = loops.map(l => ({ l, area: Math.abs(polyArea(l)), depth: 0, parent: null, holes: [] }));
  info.sort((x, y) => y.area - x.area);
  for (let i = 0; i < info.length; i++) for (let j = 0; j < i; j++) {
    if (info[j].area > info[i].area && pointInPoly(info[i].l[0], info[j].l)) { info[i].depth++; if (!info[i].parent || info[j].area < info[i].parent.area) info[i].parent = info[j]; }
  }
  for (const r of info) if (r.depth % 2 && r.parent) r.parent.holes.push(r.l);
  const capLo = [], capHi = [];
  const to3 = (x, y) => { const p = [0, 0, 0]; p[ia] = x; p[ib] = y; p[k] = value; return p; };
  for (const r of info) {
    if (r.depth % 2) continue;
    const tmp = [];
    extrudePoly(tmp, r.l, r.holes, 0, 0);   // nur die Deckfläche wird gebraucht: erste Hälfte je Dreieckspaar
    // extrudePoly schreibt je Flächendreieck oben (Normale +k) und unten (−k), danach die (hier flachen) Wände
    const faces = tmp.length / 18 - r.l.length - r.holes.reduce((s, h) => s + h.length, 0);
    for (let f = 0; f < faces; f++) {
      const o = f * 18, a = to3(tmp[o], tmp[o + 1]), b = to3(tmp[o + 3], tmp[o + 4]), c = to3(tmp[o + 6], tmp[o + 7]);
      push(capLo, a, b, c);   // Unterseite des oberen Stücks zeigt nach −k, Deckel des unteren nach +k
      push(capHi, a, c, b);
    }
  }
  return { lo: Float32Array.from(lo.concat(capLo)), hi: Float32Array.from(hi.concat(capHi)), loops: info.filter(r => !(r.depth % 2)).length, open, value };
}
