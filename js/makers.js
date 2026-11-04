'use strict';
/* Modelle selbst erstellen (2026-11-04): Schild, Schlüsselanhänger, QR-Schild, Lithophane, Bild-Relief / Logo.
   Reine Geometrie (kein DOM) – Ergebnis wie ein Import: { name, parts: [{ name, pos, extruder, bodies }], notes }.
   Zweifarbiges besteht aus einem Teil mit zwei Körpern (Platte, Motiv) – jeder Körper bekommt seinen Slot
   (js/bodies-ui.js), so bleiben beide beim Anordnen zusammen. Flächen-Dreiecke: earcut (vendor/earcut.min.js).
   Koordinaten in mm, z = 0 liegt auf dem Bett. */

const MK_EMBED = 0.02;        // Motiv reicht so weit in die Platte (kein Spalt zwischen den Körpern)
const MK_SEG = 10;            // Segmente je Viertelkreis (Ecken)
const MK_HOLE_SEG = 32;       // Segmente eines Lochs
const MK_LITHO_MAX_PX = 260000, MK_RELIEF_MAX_PX = 900000;

/* ---------- Polygone ---------- */
const polyArea = p => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]); return a / 2; };
const ccw = p => (polyArea(p) < 0 ? p.slice().reverse() : p);
const cw = p => (polyArea(p) > 0 ? p.slice().reverse() : p);
function roundRect(w, h, r, cx = 0, cy = 0) {
  r = Math.max(0, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3));
  if (r < 0.05) return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
  const out = [], c = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 1], [-w / 2 + r, -h / 2 + r, 2], [w / 2 - r, -h / 2 + r, 3]];
  for (const [x, y, q] of c) for (let k = 0; k <= MK_SEG; k++) { const a = (q + k / MK_SEG) * Math.PI / 2; out.push([cx + x + r * Math.cos(a), cy + y + r * Math.sin(a)]); }
  return out;
}
function circlePoly(cx, cy, r, seg = MK_HOLE_SEG) {
  const out = [];
  for (let k = 0; k < seg; k++) { const a = 2 * Math.PI * k / seg; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
function pointInPoly(pt, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* Fläche (außen + Löcher) → Prisma z0…z1, Dreiecke nach außen. out: Array, wird erweitert */
function extrudePoly(out, outer, holes, z0, z1) {
  const rings = [ccw(outer), ...(holes || []).map(cw)], flat = [], holeIdx = [];
  rings.forEach((r, i) => { if (i) holeIdx.push(flat.length / 2); r.forEach(p => flat.push(p[0], p[1])); });
  const tri = earcut(flat, holeIdx.length ? holeIdx : null), P = i => [flat[2 * i], flat[2 * i + 1]];
  for (let i = 0; i < tri.length; i += 3) {
    let a = P(tri[i]), b = P(tri[i + 1]), c = P(tri[i + 2]);
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b];
    out.push(a[0], a[1], z1, b[0], b[1], z1, c[0], c[1], z1, a[0], a[1], z0, c[0], c[1], z0, b[0], b[1], z0);
  }
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    out.push(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1, a[0], a[1], z0, b[0], b[1], z1, a[0], a[1], z1);
  }
  return out;
}
const shiftPos = (arr, dx, dy, dz = 0) => { for (let i = 0; i < arr.length; i += 3) { arr[i] += dx; arr[i + 1] += dy; arr[i + 2] += dz; } return arr; };

/* Pixelmaske → Umrisse (Pixelkanten, Material links), y nach oben. inside(x, y) mit y = Bildzeile von oben.
   Ergebnis [{outer, holes}] in Pixeln; gerade Stücke zusammengefasst. An Diagonal-Berührungen werden die Pixel getrennt. */
function maskRegions(w, h, inside) {
  const IN = (x, y) => x >= 0 && y >= 0 && x < w && y < h && inside(x, y);
  // gerichtete Kanten (Material links) in Gitterpunkten; Gitter-y nach oben: Y = h - Zeile
  const next = new Map(), key = (x, y) => x * (h + 3) + y;
  const add = (x0, y0, x1, y1) => { const k = key(x0, y0); const l = next.get(k); const e = [x1, y1]; if (l) l.push(e); else next.set(k, [e]); };
  for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) {
    if (!IN(x, r)) continue;
    const Y0 = h - r - 1, Y1 = h - r;   // Pixel von (x, Y0) bis (x+1, Y1)
    if (!IN(x, r + 1)) add(x, Y0, x + 1, Y0);        // unten: nach rechts
    if (!IN(x + 1, r)) add(x + 1, Y0, x + 1, Y1);    // rechts: nach oben
    if (!IN(x, r - 1)) add(x + 1, Y1, x, Y1);        // oben: nach links
    if (!IN(x - 1, r)) add(x, Y1, x, Y0);            // links: nach unten
  }
  const loops = [];
  for (const [k0, list0] of next) {
    while (list0.length) {
      const sx = Math.floor(k0 / (h + 3)), sy = k0 % (h + 3), loop = [[sx, sy]];
      let px = sx, py = sy, dir = null, guard = 0;
      for (;;) {
        const l = next.get(key(px, py));
        if (!l || !l.length) break;
        let pick = 0;
        if (l.length > 1 && dir) {   // Sattelpunkt: links abbiegen (trennt diagonal berührende Pixel)
          const left = [-dir[1], dir[0]];
          const i = l.findIndex(e => Math.sign(e[0] - px) === left[0] && Math.sign(e[1] - py) === left[1]);
          if (i >= 0) pick = i;
        }
        const [nx, ny] = l.splice(pick, 1)[0];
        dir = [Math.sign(nx - px), Math.sign(ny - py)]; px = nx; py = ny;
        if (px === sx && py === sy) break;
        loop.push([px, py]);
        if (++guard > 4 * w * h + 8) break;
      }
      // gerade Stücke zusammenfassen
      const s = loop.filter((p, i) => { const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0; });
      if (s.length >= 3) loops.push(s);
    }
  }
  // Diagonal berührende Pixel: derselbe Gitterpunkt kommt mehrfach vor (sich berührende Umrisse mag earcut nicht) –
  // jede dieser Ecken ein Stück ins eigene Material schieben (Material liegt links der Kante)
  const seen = new Map();
  for (const l of loops) for (const p of l) { const k = key(p[0], p[1]); seen.set(k, (seen.get(k) || 0) + 1); }
  for (const l of loops) l.forEach((p, i) => {
    if (seen.get(key(p[0], p[1])) < 2) return;
    const a = l[(i + l.length - 1) % l.length], b = l[(i + 1) % l.length];
    const d1 = [Math.sign(p[0] - a[0]), Math.sign(p[1] - a[1])], d2 = [Math.sign(b[0] - p[0]), Math.sign(b[1] - p[1])];
    l[i] = [p[0] + 0.02 * (-d1[1] - d2[1]), p[1] + 0.02 * (d1[0] + d2[0])];
  });
  // Pixelkanten liegen oft genau auf einer Linie (Loch neben Außenkante) – earcut zieht dann Kanten durch fremde Ecken
  // (offene Kanten im Netz). Ein winziges, festes Zittern (≤ 0,001 Pixel) macht die Lage allgemein.
  let seed = 1;
  const jit = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2e-3; };
  for (const l of loops) for (let i = 0; i < l.length; i++) l[i] = [l[i][0] + jit(), l[i][1] + jit()];
  const outers = [], holes = [];
  for (const l of loops) (polyArea(l) > 0 ? outers : holes).push(l);
  const bb = p => { let a = [Infinity, Infinity, -Infinity, -Infinity]; for (const [x, y] of p) a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; return a; };
  const regs = outers.map(o => ({ outer: o, holes: [], bb: bb(o), area: polyArea(o) }));
  for (const hl of holes) {
    // Punkt rechts der ersten Kante liegt im Loch – dasjenige kleinste Außen, das ihn enthält
    const a = hl[0], b = hl[1], m = [(a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.25 / Math.hypot(b[0] - a[0], b[1] - a[1]), (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.25 / Math.hypot(b[0] - a[0], b[1] - a[1])];
    let best = null;
    for (const r of regs) if (m[0] > r.bb[0] && m[0] < r.bb[2] && m[1] > r.bb[1] && m[1] < r.bb[3] && (!best || r.area < best.area) && pointInPoly(m, r.outer)) best = r;
    if (best) best.holes.push(hl);
  }
  return regs.map(r => ({ outer: r.outer, holes: r.holes }));
}

/* ---------- Teile mit zwei Körpern ---------- */
function twoBodyPart(name, base, top, baseName, topName) {
  const a = Float32Array.from(base), b = Float32Array.from(top), pos = new Float32Array(a.length + b.length);
  pos.set(a); pos.set(b, a.length);
  if (!b.length) return { name, pos: a, extruder: 1 };
  return { name, pos, extruder: 1, bodies: [{ name: baseName, count: a.length / 9, extruder: 1 }, { name: topName, count: b.length / 9, extruder: 2 }] };
}
// Text (eine oder mehrere Zeilen) als Netz z0…z1, zentriert um (cx, cy)
function textLines(out, lines, height, stroke, cx, cy, z0, z1) {
  const gap = height * 0.6, total = lines.length * height + (lines.length - 1) * gap;
  lines.forEach((ln, i) => {
    const m = textSolid(ln, { height, stroke, z0, z1 }), y = cy + total / 2 - height / 2 - i * (height + gap);
    for (let k = 0; k < m.length; k += 3) out.push(m[k] + cx, m[k + 1] + y, m[k + 2]);
  });
}
const lineWidth = (ln, height, stroke) => textStrokes(ln, height, stroke).w;

/* Schild / Schlüsselanhänger. o: { lines[], textH, stroke, plateT, textT, margin, radius, hole ('none'|'left'|'top'|'corners'),
   holeD, border, keychain } – Platte = Körper 1, Schrift (+ Rand) = Körper 2 */
const SIGN_DEFAULTS = { lines: ['Name'], textH: 10, stroke: 0.14, plateT: 3, textT: 1, margin: 5, radius: 3, hole: 'none', holeD: 4, border: false, borderW: 1.2, inset: false };
const KEYCHAIN_DEFAULTS = { ...SIGN_DEFAULTS, textH: 7, plateT: 2.5, textT: 0.8, margin: 3, radius: 3, hole: 'left', holeD: 4.5 };
function signModel(opts) {
  const o = { ...SIGN_DEFAULTS, ...opts }, lines = (o.lines || []).map(s => String(s).trim()).filter(Boolean);
  if (!lines.length) throw Error(t('Bitte einen Text eingeben.'));
  const tw = Math.max(...lines.map(l => lineWidth(l, o.textH, o.stroke))), th = lines.length * o.textH + (lines.length - 1) * o.textH * 0.6;
  const bw = o.border ? o.borderW + 1.5 : 0, holeR = o.holeD / 2, tab = o.hole === 'left' ? o.holeD + 2 * Math.max(2, o.margin * 0.6) : 0;
  const top = o.hole === 'top' ? o.holeD + 2 * Math.max(2, o.margin * 0.6) : 0, corner = o.hole === 'corners' ? o.holeD + 3 : 0;
  const W = Math.max(tw + 2 * (o.margin + bw + corner) + tab, 20), H = Math.max(th + 2 * (o.margin + bw) + top, 12);
  const holes = [];
  if (o.hole === 'left') holes.push(circlePoly(-W / 2 + tab / 2 + 0.5, 0, holeR));
  if (o.hole === 'top') holes.push(circlePoly(0, H / 2 - top / 2, holeR));
  if (o.hole === 'corners') { const dx = W / 2 - corner / 2 - 1, dy = H / 2 - corner / 2 - 1; holes.push(circlePoly(-dx, dy, holeR), circlePoly(dx, dy, holeR), circlePoly(-dx, -dy, holeR), circlePoly(dx, -dy, holeR)); }
  const base = extrudePoly([], roundRect(W, H, o.radius), holes, 0, o.plateT), deco = [];
  const z0 = o.plateT - MK_EMBED, z1 = o.plateT + o.textT;
  textLines(deco, lines, o.textH, o.stroke, tab / 2, -top / 2, z0, z1);
  if (o.border) {
    const ins = 1.5, ow = W - 2 * ins - tab, oh = H - 2 * ins - top, r = Math.max(0.5, o.radius - ins);
    extrudePoly(deco, roundRect(ow, oh, r, tab / 2, -top / 2), [roundRect(ow - 2 * o.borderW, oh - 2 * o.borderW, Math.max(0.3, r - o.borderW), tab / 2, -top / 2)], z0, z1);
  }
  const label = lines.join(' ').slice(0, 30);
  return { name: (o.keychain ? t('Anhänger') : t('Schild')) + ' „' + label + '“',
    parts: [twoBodyPart(label, base, deco, t('Platte'), t('Schrift'))], size: [W, H, z1], notes: [] };
}

/* QR-Schild: dunkle Module erhaben (Körper 2) auf heller Platte (Körper 1); darunter optional eine Zeile Text.
   o: { text, ecl, module (mm), plateT, qrT, quiet (Module), caption, captionH, hole, holeD, radius } */
const QR_SIGN_DEFAULTS = { text: '', ecl: 'M', module: 2, plateT: 2.5, qrT: 1, quiet: 2, caption: '', captionH: 6, stroke: 0.14, hole: 'none', holeD: 4, radius: 3 };
function qrSignModel(opts) {
  const o = { ...QR_SIGN_DEFAULTS, ...opts };
  if (!String(o.text).length) throw Error(t('Bitte Inhalt für den QR-Code eingeben.'));
  const q = qrMatrix(o.text, o.ecl), m = o.module, qs = q.size * m, pad = Math.max(o.quiet * m, 3);
  const cap = String(o.caption || '').trim(), capH = cap ? o.captionH : 0, capGap = cap ? Math.max(pad * 0.6, 2) : 0;
  const capW = cap ? lineWidth(cap, capH, o.stroke) : 0;
  const top = o.hole === 'top' ? o.holeD + 4 : 0;
  const W = Math.max(qs, capW) + 2 * pad, H = qs + 2 * pad + capH + capGap + top;
  const holes = o.hole === 'top' ? [circlePoly(0, H / 2 - top / 2, o.holeD / 2)] : [];
  const base = extrudePoly([], roundRect(W, H, o.radius), holes, 0, o.plateT), deco = [];
  const z0 = o.plateT - MK_EMBED, z1 = o.plateT + o.qrT;
  const qx = -qs / 2, qy = H / 2 - top - pad - qs;   // unten links des Codes
  for (const r of maskRegions(q.size, q.size, (x, y) => q.dark(x, y))) {
    const P = p => [qx + p[0] * m, qy + p[1] * m];
    extrudePoly(deco, r.outer.map(P), r.holes.map(h => h.map(P)), z0, z1);
  }
  if (cap) textLines(deco, [cap], capH, o.stroke, 0, -H / 2 + pad + capH / 2, z0, z1);
  return { name: t('QR-Schild'), parts: [twoBodyPart(t('QR-Schild'), base, deco, t('Platte'), t('QR-Code'))], size: [W, H, z1],
    qr: { version: q.version, modules: q.size }, notes: m < 1.2 ? [t('Module unter 1,2 mm sind schwer sauber zu drucken – größer stellen, wenn der Code nicht lesbar ist.')] : [] };
}

/* ---------- Bilder ---------- */
// gray: Float32Array (0 = schwarz … 1 = weiß), w × h, Zeile 0 oben; mm je Pixel ergibt sich aus der Breite

/* Lithophane: dunkel = dick. o: { width, minT, maxT, frame, shape ('flat'|'curved'), angle (Grad), standing } */
const LITHO_DEFAULTS = { width: 100, minT: 0.8, maxT: 3, frame: 3, shape: 'flat', angle: 120, standing: true };
function lithophaneModel(gray, w, h, opts) {
  const o = { ...LITHO_DEFAULTS, ...opts };
  if (w < 2 || h < 2) throw Error(t('Bild zu klein'));
  const W = o.width, px = W / (w - 1), H = px * (h - 1), fr = Math.max(0, o.frame);
  const thick = (i, j) => {   // i Spalte, j Zeile von oben
    const u = i * px, v = (h - 1 - j) * px;
    if (u < fr || v < fr || u > W - fr || v > H - fr) return o.maxT;
    return o.maxT - gray[j * w + i] * (o.maxT - o.minT);
  };
  // Abbildung (u, v, w) → mm; erhält die Orientierung (Determinante > 0)
  let map;
  if (o.shape === 'curved') {
    const A = Math.max(10, Math.min(360, o.angle)) * Math.PI / 180, R = W / A;
    map = (u, v, d) => { const th = (u / W - 0.5) * A, r = R + d; return [r * Math.sin(th), -r * Math.cos(th), v]; };
  } else if (o.standing) map = (u, v, d) => [u, -d, v];
  else map = (u, v, d) => [u, v, d];
  const out = [], U = i => i * px, V = j => (h - 1 - j) * px;
  const push = (a, b, c) => { for (const p of [a, b, c]) { const q = map(p[0], p[1], p[2]); out.push(q[0], q[1], q[2]); } };
  // Vorderseite (Relief, Normale +d): Dreiecke im (u, v) gegen den Uhrzeigersinn
  const T = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) T[j * w + i] = thick(i, j);
  const F = (i, j) => [U(i), V(j), T[j * w + i]];
  for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
    const a = F(i, j + 1), b = F(i + 1, j + 1), c = F(i + 1, j), d = F(i, j);   // a unten links … d oben links
    push(a, b, c); push(a, c, d);
  }
  // Rand: Ring gegen den Uhrzeigersinn (unten → rechts → oben → links), Seitenwände wie extrudePoly
  const ring = [];
  for (let i = 0; i < w; i++) ring.push([i, h - 1]);
  for (let j = h - 2; j >= 0; j--) ring.push([w - 1, j]);
  for (let i = w - 2; i >= 0; i--) ring.push([i, 0]);
  for (let j = 1; j < h - 1; j++) ring.push([0, j]);
  for (let k = 0; k < ring.length; k++) {
    const [ai, aj] = ring[k], [bi, bj] = ring[(k + 1) % ring.length];
    const a0 = [U(ai), V(aj), 0], b0 = [U(bi), V(bj), 0], a1 = F(ai, aj), b1 = F(bi, bj);
    push(a0, b0, b1); push(a0, b1, a1);
  }
  // Rückseite (Normale −d, im (u, v) im Uhrzeigersinn): Streifen je Spalte; die beiden Randspalten als Fächer über alle
  // Randpunkte, damit sie genau an die Seitenwände anschließen
  const back = (a, b, c) => { if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0) [b, c] = [c, b]; push(a, b, c); };
  const B = (u, v) => [u, v, 0];
  for (let i = 1; i + 2 < w; i++) { back(B(U(i), 0), B(U(i + 1), 0), B(U(i + 1), H)); back(B(U(i), 0), B(U(i + 1), H), B(U(i), H)); }
  for (const [edge, inner] of [[0, 1], [w - 1, w - 2]]) {
    const c = B(U(inner), 0), ue = U(edge);
    for (let j = h - 1; j > 0; j--) back(c, B(ue, V(j)), B(ue, V(j - 1)));
    back(c, B(ue, H), B(U(inner), H));
  }
  const pos = Float32Array.from(out);
  // aufs Bett (z ≥ 0) und in die Mitte
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  shiftPos(pos, -(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]);
  return { name: t('Lithophane'), parts: [{ name: t('Lithophane'), pos, extruder: 1 }], size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]],
    notes: [t('Lithophane: mit 100 % Füllung und weißem Filament drucken, stehend mit Brim. Gegen Licht halten – dunkle Stellen sind dicker.')] };
}

/* Bild-Relief / Logo: dunkle (oder mit invert helle) Flächen. o: { width, threshold, invert, mode ('plate'|'cutout'),
   plateT, reliefT, margin, radius, hole, holeD } – plate: Platte (Körper 1) + erhabenes Motiv (Körper 2); cutout: nur das Motiv */
const RELIEF_DEFAULTS = { width: 80, threshold: 0.5, invert: false, mode: 'plate', plateT: 2, reliefT: 1.2, margin: 4, radius: 3, hole: 'none', holeD: 4 };
function reliefModel(gray, w, h, opts) {
  const o = { ...RELIEF_DEFAULTS, ...opts }, px = o.width / w;
  const ink = (x, y) => (gray[y * w + x] < o.threshold) !== !!o.invert;
  const regs = maskRegions(w, h, ink);
  if (!regs.length) throw Error(t('Im Bild ist nichts zu sehen – Schwelle oder „Umkehren“ ändern.'));
  // Motiv auf seine Fläche zuschneiden und mittig legen
  let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
  for (const r of regs) for (const [x, y] of r.outer) { mn = [Math.min(mn[0], x), Math.min(mn[1], y)]; mx = [Math.max(mx[0], x), Math.max(mx[1], y)]; }
  const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2, mw = (mx[0] - mn[0]) * px, mh = (mx[1] - mn[1]) * px;
  const P = p => [(p[0] - cx) * px, (p[1] - cy) * px];
  const cutout = o.mode === 'cutout';
  const top = !cutout && o.hole === 'top' ? o.holeD + 4 : 0;
  const z0 = cutout ? 0 : o.plateT - MK_EMBED, z1 = cutout ? o.reliefT + o.plateT : o.plateT + o.reliefT, deco = [];
  for (const r of regs) extrudePoly(deco, r.outer.map(P), r.holes.map(hl => hl.map(P)), z0, z1);
  if (cutout) {
    const pos = Float32Array.from(deco);
    return { name: t('Logo'), parts: [{ name: t('Logo'), pos, extruder: 1 }], size: [mw, mh, z1], notes: regs.length > 1 ? [t('Das Motiv besteht aus {n} getrennten Stücken – sie werden einzeln gedruckt.', { n: regs.length })] : [] };
  }
  const W = mw + 2 * o.margin, H = mh + 2 * o.margin + top;
  shiftPos(deco, 0, -top / 2);
  const holes = o.hole === 'top' ? [circlePoly(0, H / 2 - top / 2, o.holeD / 2)] : [];
  const base = extrudePoly([], roundRect(W, H, o.radius), holes, 0, o.plateT);
  return { name: t('Bild-Relief'), parts: [twoBodyPart(t('Bild-Relief'), base, deco, t('Platte'), t('Motiv'))], size: [W, H, z1], notes: [] };
}

/* Bildpunkte (RGBA, Zeile 0 oben) → Helligkeit 0…1; durchsichtig zählt als weiß */
function rgbaToGray(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[4 * i + 3] / 255, l = (0.2126 * data[4 * i] + 0.7152 * data[4 * i + 1] + 0.0722 * data[4 * i + 2]) / 255;
    g[i] = l * a + (1 - a);
  }
  return g;
}
// Zielauflösung: Lithophane ≈ 0,2 mm je Punkt, Relief ≈ 0,12 mm – begrenzt auf MK_*_MAX_PX Punkte
function imageGrid(kind, widthMm, aspect) {
  const step = kind === 'litho' ? 0.2 : 0.12, max = kind === 'litho' ? MK_LITHO_MAX_PX : MK_RELIEF_MAX_PX;
  let w = Math.max(8, Math.round(widthMm / step)), h = Math.max(8, Math.round(w * aspect));
  if (w * h > max) { const f = Math.sqrt(max / (w * h)); w = Math.max(8, Math.floor(w * f)); h = Math.max(8, Math.floor(h * f)); }
  return { w, h };
}
