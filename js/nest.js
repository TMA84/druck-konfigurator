'use strict';
/* Teile nach ihrer echten Grundfläche aufs Bett legen (2026-10-08). Das Rechteck-Verfahren (js/export3mf.js packGroup)
   rechnet mit dem Hüllrechteck – dünne Rahmen, Winkel und Dreiecke (Rack-Teile: 18–28 % des Rechtecks belegt) bekamen
   so je eine eigene Platte, obwohl zwei ineinander gedreht passen. Hier: Grundfläche als Raster (NEST_RES mm, Projektion
   aller Dreiecke von oben), je Teil 0/90/180/270°, Abstand = Rasterabstand um die schon gelegten Teile (gap + 1 Zelle
   für Rasterfehler), Lage „unten links zuerst“. packPlates nimmt das nur, wenn es weniger Platten braucht.
   Ergebnis wie packGroup: Platten [{used: [{i, x, y, w, h, rot, ang}]}], x/y/w/h = Hüllrechteck (gedreht) + gap. */
const NEST_RES = 1;            // Rasterweite in mm
const NEST_MAX_PARTS = 40;     // mehr Teile: Rechteck-Verfahren (Rechenzeit)
const NEST_LOOKAHEAD = 8;      // neue Platte: so viele folgende Teile probeweise dazulegen
const NEST_SPARSE = 0.6;       // nur, wenn ein Teil höchstens so viel seines Hüllrechtecks belegt
const nestCache = new WeakMap();

// Grundfläche eines Teils, um ang (0/90/180/270) gedreht wie placeXY: {w, h, bits (Uint8Array, Zeile = y), area}
function footprintMask(geom, ang) {
  if (!geom || !geom.pos || !geom.pos.length) return null;
  let per = nestCache.get(geom);
  if (!per) { per = {}; nestCache.set(geom, per); }
  if (per[ang]) return per[ang];
  const P = geom.pos, cx = (geom.mn[0] + geom.mx[0]) / 2, cy = (geom.mn[1] + geom.mx[1]) / 2;
  const side = ang === 90 || ang === 270, fw = side ? geom.y : geom.x, fd = side ? geom.x : geom.y;
  const w = Math.max(1, Math.ceil(fw / NEST_RES - 1e-6)), h = Math.max(1, Math.ceil(fd / NEST_RES - 1e-6)), bits = new Uint8Array(w * h);
  const rot = (x, y) => ang === 90 ? [-y, x] : ang === 180 ? [-x, -y] : ang === 270 ? [y, -x] : [x, y];
  const mark = (c, r) => { if (c >= 0 && c < w && r >= 0 && r < h) bits[r * w + c] = 1; };
  for (let v = 0; v < P.length; v += 9) {
    const a = rot(P[v] - cx, P[v + 1] - cy), b = rot(P[v + 3] - cx, P[v + 4] - cy), c = rot(P[v + 6] - cx, P[v + 7] - cy);
    const ax = (a[0] + fw / 2) / NEST_RES, ay = (a[1] + fd / 2) / NEST_RES, bx = (b[0] + fw / 2) / NEST_RES, by = (b[1] + fd / 2) / NEST_RES, qx = (c[0] + fw / 2) / NEST_RES, qy = (c[1] + fd / 2) / NEST_RES;
    mark(Math.floor(ax), Math.floor(ay)); mark(Math.floor(bx), Math.floor(by)); mark(Math.floor(qx), Math.floor(qy));
    const d = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
    if (Math.abs(d) < 1e-9) continue;   // senkrechte Wand: Fläche kommt von Ober-/Unterseite
    const c0 = Math.max(0, Math.floor(Math.min(ax, bx, qx))), c1 = Math.min(w - 1, Math.floor(Math.max(ax, bx, qx)));
    const r0 = Math.max(0, Math.floor(Math.min(ay, by, qy))), r1 = Math.min(h - 1, Math.floor(Math.max(ay, by, qy)));
    for (let r = r0; r <= r1; r++) for (let k = c0; k <= c1; k++) {
      const px = k + 0.5, py = r + 0.5;
      const s = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / d, t2 = ((px - ax) * (qy - ay) - (py - ay) * (qx - ax)) / d;
      if (s >= 0 && t2 >= 0 && s + t2 <= 1) bits[r * w + k] = 1;
    }
  }
  let area = 0; for (let k = 0; k < bits.length; k++) area += bits[k];
  return (per[ang] = { w, h, fw, fd, bits, area });
}
// Zeilen als Bitfelder (32 Zellen je Wort) für schnelle Überlappungsprüfung
function nestRows(m) {
  const words = (m.w >> 5) + 1, rows = new Uint32Array(m.h * words);
  const cnt = new Array(m.h).fill(0);
  for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) if (m.bits[r * m.w + c]) { rows[r * words + (c >> 5)] |= 1 << (c & 31); cnt[r]++; }
  // volle Zeilen zuerst prüfen: Überlappungen fallen dann meist nach wenigen Zeilen auf
  const order = cnt.map((n, r) => [n, r]).filter(([n]) => n).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, r]) => r);
  return { words, rows, order };
}
// Grundfläche um rad Zellen (Kreis) erweitert, mit Rand: {w, h, bits}
function nestDilate(m, rad) {
  const w = m.w + 2 * rad, h = m.h + 2 * rad, bits = new Uint8Array(w * h), span = [];
  for (let dy = -rad; dy <= rad; dy++) span.push(Math.floor(Math.sqrt(rad * rad - dy * dy)));
  for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) {
    if (!m.bits[r * m.w + c]) continue;
    for (let dy = -rad; dy <= rad; dy++) { const s = span[dy + rad], row = (r + rad + dy) * w; for (let dx = -s; dx <= s; dx++) bits[row + c + rad + dx] = 1; }
  }
  return { w, h, bits };
}
function nestBin(W, H) {
  const words = (W >> 5) + 1;
  return { W, H, words, occ: new Uint32Array(H * words), used: [], free: W * H };
}
// Überlappt die Grundfläche (Zeilen-Bitfelder) an Zelle (x, y) etwas Belegtes?
function nestHit(bin, fr, h, x, y) {
  const o = x >> 5, s = x & 31;
  for (const r of fr.order) {
    const ob = (y + r) * bin.words, pb = r * fr.words;
    for (let k = 0; k < fr.words; k++) {
      const p = fr.rows[pb + k];
      if (!p) continue;
      if (bin.occ[ob + o + k] & (p << s)) return true;
      if (s && o + k + 1 < bin.words && (bin.occ[ob + o + k + 1] & (p >>> (32 - s)))) return true;
    }
  }
  return false;
}
// erste freie Lage (unten links zuerst) einer Grundfläche → {x, y} oder null
function nestFind(bin, m, fr) {
  if (m.area > bin.free) return null;
  for (let y = 0; y + m.h <= bin.H; y++) for (let x = 0; x + m.w <= bin.W; x++) if (!nestHit(bin, fr, m.h, x, y)) return { x, y };
  return null;
}
function nestPlace(bin, dil, rad, x, y) {
  for (let r = 0; r < dil.h; r++) {
    const yy = y - rad + r; if (yy < 0 || yy >= bin.H) continue;
    for (let c = 0; c < dil.w; c++) {
      const xx = x - rad + c; if (xx < 0 || xx >= bin.W || !dil.bits[r * dil.w + c]) continue;
      const k = yy * bin.words + (xx >> 5), bit = 1 << (xx & 31);
      if (!(bin.occ[k] & bit)) { bin.occ[k] |= bit; bin.free--; }
    }
  }
}
// Lohnt sich das? Höchstens NEST_MAX_PARTS Teile, mindestens eines mit viel Luft im Hüllrechteck, alle mit Netz
function nestWorthIt(geoms, idx) {
  if (idx.length < 2 || idx.length > NEST_MAX_PARTS) return false;
  let sparse = false;
  for (const i of idx) { const m = footprintMask(geoms[i], 0); if (!m) return false; if (m.area <= NEST_SPARSE * m.w * m.h) sparse = true; }
  return sparse;
}
function nestGroup(geoms, idx, W, H, gap) {
  if (!nestWorthIt(geoms, idx)) return null;
  const BW = Math.floor(W / NEST_RES + 1e-6), BH = Math.floor(H / NEST_RES + 1e-6), rad = Math.ceil(gap / NEST_RES) + 1;
  const variants = i => [0, 90, 180, 270].map(ang => { const m = footprintMask(geoms[i], ang); return m && m.w <= BW && m.h <= BH ? { ang, m } : null; }).filter(Boolean);
  const orders = [(a, b) => footprintMask(geoms[b], 0).area - footprintMask(geoms[a], 0).area, (a, b) => geoms[b].x * geoms[b].y - geoms[a].x * geoms[a].y];
  // beste Lage in einer Platte: je Drehung die erste freie (unten links), davon kleinste Oberkante, dann rechte Kante
  // Platten füllen sich nur: passt ein Teil (gleiche Geometrie, z. B. Kopien) einmal nicht, dann auch später nicht
  const spotIn = (bin, vs, g) => {
    if (bin.fail && bin.fail.has(g)) return null;
    let pick = null;
    for (const v of vs) {
      v.fr = v.fr || nestRows(v.m);
      const at = nestFind(bin, v.m, v.fr);
      if (at && (!pick || lexLess([at.y + v.m.h, at.x + v.m.w], [pick.at.y + pick.v.m.h, pick.at.x + pick.v.m.w]))) pick = { v, at };
    }
    if (!pick) (bin.fail || (bin.fail = new Set())).add(g);
    return pick;
  };
  const put = (bin, i, pick) => {
    const { v, at } = pick;
    nestPlace(bin, v.dil || (v.dil = nestDilate(v.m, rad)), rad, at.x, at.y);
    bin.used.push({ i, x: at.x * NEST_RES, y: at.y * NEST_RES, w: v.m.fw + gap, h: v.m.fd + gap, rot: v.ang === 90 || v.ang === 270, ang: v.ang, nested: true });
  };
  const V = new Map(idx.map(i => [i, variants(i)]));
  if (idx.some(i => !V.get(i).length)) return null;   // größer als das Bett: Rechteck-Verfahren entscheidet
  let best = null;
  for (const order of orders) {
    const seq = idx.slice().sort((a, b) => order(a, b) || a - b), bins = [], done = new Set();
    for (const [k, i] of seq.entries()) {
      if (done.has(i)) continue;
      let pick = null, bin = null;
      for (const b of bins) { pick = spotIn(b, V.get(i), geoms[i]); if (pick) { bin = b; break; } }
      if (!pick) {
        /* neue Platte: die Drehung des ersten Teils entscheidet, was danach noch passt (zwei Dreiecke nur, wenn das
           erste mit dem rechten Winkel unten links liegt) – je Drehung ausprobieren, wie viel Fläche der übrigen dazukommt */
        let bestArea = -1;
        for (const v of V.get(i)) {
          const sim = nestBin(BW, BH);
          put(sim, i, { v, at: { x: 0, y: 0 } });
          let area = 0;
          for (const j of seq.slice(k + 1).filter(j => !done.has(j)).slice(0, NEST_LOOKAHEAD)) { const p = spotIn(sim, V.get(j), geoms[j]); if (p) { put(sim, j, p); area += p.v.m.area; } }
          if (area > bestArea) { bestArea = area; pick = { v, at: { x: 0, y: 0 } }; }
        }
        bin = nestBin(BW, BH); bins.push(bin);
      }
      put(bin, i, pick); done.add(i);
    }
    if (!best || bins.length < best.length) best = bins;
  }
  return best.map(b => ({ used: b.used }));
}
// Umriss für die Draufsicht: SVG-Pfad (Zeilenstücke) im Hüllrechteck, y nach unten; null ohne Netz
function footprintPath(geom, ang) {
  const m = footprintMask(geom, ang || 0);
  if (!m) return null;
  if (m.svg) return m.svg;
  let d = '';
  for (let r = 0; r < m.h; r++) {
    const y = m.fd - (r + 1) * NEST_RES;
    for (let c = 0; c < m.w;) {
      if (!m.bits[r * m.w + c]) { c++; continue; }
      let e = c; while (e < m.w && m.bits[r * m.w + e]) e++;
      d += 'M' + (c * NEST_RES).toFixed(1) + ' ' + y.toFixed(1) + 'h' + ((e - c) * NEST_RES) + 'v' + (NEST_RES + 0.05).toFixed(2) + 'h-' + ((e - c) * NEST_RES) + 'z';
      c = e;
    }
  }
  return (m.svg = d);
}
