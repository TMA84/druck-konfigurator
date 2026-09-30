'use strict';
/* Beschriftung: Text erhaben oder vertieft auf eine Fläche eines Teils (vgl. docs/vorschlaege.md Nr. 15). Kein DOM –
   tests/engrave.js prüft das in Node und slict mit der Orca-CLI.
   Schrift: Hershey Simplex (js/font-hershey.js, Strichschrift). Jeder Strichabschnitt wird zu einer Kapsel (Rechteck mit
   runden Enden, Breite = Strichstärke) und senkrecht zur Fläche extrudiert. Die Kapseln überlappen sich; Orca vereinigt
   überlappende Hüllen eines Bauteils beim Slicen (per CLI geprüft), eine eigene Boolesche Operation ist nicht nötig.
   Export (js/export3mf.js textVolumes): erhaben = weiteres Orca-Bauteil (normal_part) mit eigenem Slot, vertieft =
   negative_part (Orca zieht es beim Slicen vom Teil ab).
   part.texts = [{id, text, height, depth, stroke, mode:'raised'|'engraved', slot, rot, anchor:{p, n, u}}]
   anchor in Koordinaten von part.origPos (vor der Drehung part.R) – so bleibt der Text beim Drehen des Teils an seiner
   Stelle. p = Mittelpunkt auf der Fläche, n = Flächennormale (nach außen), u = Leserichtung (Grundlinie). */

const TEXT_DEFAULTS = { height: 8, depth: 1, stroke: 0.12, mode: 'raised', rot: 0 };
const TEXT_EMBED_MM = 0.02;     // erhabene Schrift reicht so weit ins Teil (kein Spalt zwischen Teil und Schrift)
const TEXT_PROTRUDE_MM = 0.3;   // vertiefte Schrift (Abzugskörper) ragt so weit aus der Fläche – saubere Kante oben
const TEXT_CAP_SEG = 4;         // Segmente je Halbkreis an den Strichenden
const TEXT_MIN_STROKE_MM = 0.8; // darunter druckt eine 0,4-mm-Düse den Strich kaum sauber (zwei Bahnen)
const TEXT_LETTER_GAP = 0;      // zusätzlicher Buchstabenabstand in Schrifteinheiten

const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
};
// R (Zeilen-Matrix wie rotatePositions) auf einen Vektor bzw. transponiert (zurück in origPos-Koordinaten)
const matVec = (R, a) => [R[0] * a[0] + R[1] * a[1] + R[2] * a[2], R[3] * a[0] + R[4] * a[1] + R[5] * a[2], R[6] * a[0] + R[7] * a[1] + R[8] * a[2]];
const matTVec = (R, a) => [R[0] * a[0] + R[3] * a[1] + R[6] * a[2], R[1] * a[0] + R[4] * a[1] + R[7] * a[2], R[2] * a[0] + R[5] * a[1] + R[8] * a[2]];
const TEXT_ID3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/* ---------- Schrift → Striche ---------- */
const fontCode = c => c.charCodeAt(0) - 82;   // 'R' = 0
function glyphStrokes(ch) {
  const d = HERSHEY_SIMPLEX.glyphs[ch];
  if (!d) return null;
  const strokes = [];
  let cur = null;
  for (let k = 2; k < d.length; k += 2) {
    if (d[k] === ' ' && d[k + 1] === 'R') { cur = null; continue; }
    if (!cur) strokes.push(cur = []);
    cur.push([fontCode(d[k]), fontCode(d[k + 1])]);
  }
  return { left: fontCode(d[0]), right: fontCode(d[1]), strokes };
}
// Zeichen, die die Schrift nicht kennt (werden als „?“ gesetzt)
const unknownChars = text => [...new Set([...String(text)].filter(c => !HERSHEY_SIMPLEX.glyphs[c]))];

/* Text → Striche in mm, zentriert um (0, 0); x = Leserichtung, y = oben. height = Versalhöhe.
   Ergebnis {strokes:[[[x,y],…]], w, h} – w/h = Maße der Striche inkl. Strichstärke. */
function textStrokes(text, height, stroke) {
  const s = height / HERSHEY_SIMPLEX.cap, base = HERSHEY_SIMPLEX.base, out = [];
  let pen = 0;
  for (const ch of String(text)) {
    const g = glyphStrokes(ch) || glyphStrokes('?');
    for (const st of g.strokes) out.push(st.map(([x, y]) => [(pen + x - g.left) * s, (base - y) * s]));
    pen += g.right - g.left + TEXT_LETTER_GAP;
  }
  const pts = out.flat();
  if (!pts.length) return { strokes: [], w: 0, h: 0 };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, sw = stroke * height;
  return { strokes: out.map(st => st.map(([x, y]) => [x - cx, y - cy])), w: Math.max(...xs) - Math.min(...xs) + sw, h: Math.max(...ys) - Math.min(...ys) + sw };
}

// Konvexes Polygon (gegen den Uhrzeigersinn) → Prisma z0…z1, Dreiecke nach außen gerichtet
function pushPrism(out, poly, z0, z1) {
  const n = poly.length;
  for (let i = 1; i < n - 1; i++) {
    out.push(poly[0][0], poly[0][1], z1, poly[i][0], poly[i][1], z1, poly[i + 1][0], poly[i + 1][1], z1);
    out.push(poly[0][0], poly[0][1], z0, poly[i + 1][0], poly[i + 1][1], z0, poly[i][0], poly[i][1], z0);
  }
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    out.push(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1, a[0], a[1], z0, b[0], b[1], z1, a[0], a[1], z1);
  }
}
// Kapsel um den Abschnitt a–b (Radius r), gegen den Uhrzeigersinn; a = b → Kreis
function capsule(a, b, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  const ang = len > 1e-9 ? Math.atan2(dy, dx) : 0, poly = [];
  const arc = (c, from) => { for (let k = 0; k <= TEXT_CAP_SEG; k++) { const t = from + Math.PI * k / TEXT_CAP_SEG; poly.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); } };
  if (len <= 1e-9) { for (let k = 0; k < 2 * TEXT_CAP_SEG; k++) { const t = Math.PI * k / TEXT_CAP_SEG; poly.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]); } return poly; }
  arc(b, ang - Math.PI / 2);   // vorderes Ende: von rechts über vorn nach links
  arc(a, ang + Math.PI / 2);   // hinteres Ende
  return poly;
}

/* Text als Netz in Textkoordinaten (x Leserichtung, y oben, z aus der Fläche heraus): Float32Array wie geom.pos.
   opts {height, stroke (Anteil der Höhe), z0, z1} */
function textSolid(text, opts) {
  const o = { ...TEXT_DEFAULTS, ...opts }, r = o.stroke * o.height / 2, out = [];
  const { strokes } = textStrokes(text, o.height, o.stroke);
  for (const st of strokes) {
    if (st.length === 1) { pushPrism(out, capsule(st[0], st[0], r), o.z0, o.z1); continue; }
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i], b = st[i + 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9 && st.length > 2) continue;
      pushPrism(out, capsule(a, b, r), o.z0, o.z1);
    }
  }
  return Float32Array.from(out);
}

/* ---------- Flächen ---------- */
function triNormal(pos, t) {
  const o = t * 9, e1 = [pos[o + 3] - pos[o], pos[o + 4] - pos[o + 1], pos[o + 5] - pos[o + 2]], e2 = [pos[o + 6] - pos[o], pos[o + 7] - pos[o + 1], pos[o + 8] - pos[o + 2]];
  const n = v3.cross(e1, e2), l = Math.hypot(n[0], n[1], n[2]);
  return { n: l ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0], area: l / 2 };
}
const triCentroid = (pos, t) => { const o = t * 9; return [0, 1, 2].map(k => (pos[o + k] + pos[o + 3 + k] + pos[o + 6 + k]) / 3); };

// Eckpunkt → Dreiecke (je Netz einmal)
const adjCache = new WeakMap();
function vertexAdjacency(geom) {
  let a = adjCache.get(geom);
  if (a) return a;
  const pos = geom.pos, key = new Map(), triKeys = new Int32Array(geom.n * 3);
  for (let t = 0; t < geom.n; t++) for (let v = 0; v < 3; v++) {
    const o = t * 9 + v * 3, k = Math.round(pos[o] * 1e3) + ',' + Math.round(pos[o + 1] * 1e3) + ',' + Math.round(pos[o + 2] * 1e3);
    let id = key.get(k);
    if (id === undefined) { id = key.size; key.set(k, id); }
    triKeys[t * 3 + v] = id;
  }
  const tris = Array.from({ length: key.size }, () => []);
  for (let t = 0; t < geom.n; t++) for (let v = 0; v < 3; v++) tris[triKeys[t * 3 + v]].push(t);
  a = { triKeys, tris };
  adjCache.set(geom, a);
  return a;
}

/* Ebene Fläche um Dreieck seed: zusammenhängende Dreiecke mit (fast) gleicher Normale in derselben Ebene.
   Ergebnis {tris:[…], n, area, centroid} */
function coplanarRegion(geom, seed, tolDeg = 3, tolMm = 0.05) {
  const pos = geom.pos, { n } = triNormal(pos, seed), p0 = triCentroid(pos, seed), d0 = v3.dot(n, p0), cos = Math.cos(tolDeg * Math.PI / 180);
  const adj = vertexAdjacency(geom), seen = new Uint8Array(geom.n), stack = [seed], tris = [];
  seen[seed] = 1;
  let area = 0, c = [0, 0, 0];
  while (stack.length) {
    const t = stack.pop(), tn = triNormal(pos, t);
    tris.push(t); area += tn.area; c = v3.add(c, v3.mul(triCentroid(pos, t), tn.area));
    for (let v = 0; v < 3; v++) for (const u of adj.tris[adj.triKeys[t * 3 + v]]) {
      if (seen[u]) continue;
      seen[u] = 1;
      const un = triNormal(pos, u);
      if (un.area > 0 && v3.dot(un.n, n) >= cos && Math.abs(v3.dot(n, triCentroid(pos, u)) - d0) < tolMm) stack.push(u);
    }
  }
  return { tris, n, area, centroid: area ? v3.mul(c, 1 / area) : p0 };
}

// Liegt der Punkt (in der Ebene) auf einem der Dreiecke? Projektion entlang n.
function regionContains(geom, region, p, frame) {
  const pos = geom.pos, [u, v] = frame, P = [v3.dot(p, u), v3.dot(p, v)];
  for (const t of region.tris) {
    const o = t * 9, q = [0, 1, 2].map(k => { const x = [pos[o + k * 3], pos[o + k * 3 + 1], pos[o + k * 3 + 2]]; return [v3.dot(x, u), v3.dot(x, v)]; });
    const s = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = s(q[0], q[1], P), d2 = s(q[1], q[2], P), d3 = s(q[2], q[0], P), eps = 1e-6;
    if ((d1 >= -eps && d2 >= -eps && d3 >= -eps) || (d1 <= eps && d2 <= eps && d3 <= eps)) return true;
  }
  return false;
}

/* Oberseite: höchste ebene, nach oben (+Z) zeigende Fläche mit nennenswerter Größe (≥ 20 % der größten).
   Ergebnis {tri, point, region} (geom-Koordinaten) oder null. */
function topFace(geom) {
  const pos = geom.pos, levels = new Map();
  for (let t = 0; t < geom.n; t++) {
    const { n, area } = triNormal(pos, t);
    if (n[2] < 0.999 || !area) continue;
    const z = Math.round(triCentroid(pos, t)[2] * 100) / 100, l = levels.get(z) || levels.set(z, { z, area: 0, tris: [] }).get(z);
    l.area += area; l.tris.push(t);
  }
  if (!levels.size) return null;
  const list = [...levels.values()], maxA = Math.max(...list.map(l => l.area));
  const level = list.filter(l => l.area >= 0.2 * maxA).sort((a, b) => b.z - a.z)[0];
  // größte zusammenhängende Fläche dieser Höhe
  const done = new Set();
  let best = null;
  for (const t of level.tris) {
    if (done.has(t)) continue;
    const reg = coplanarRegion(geom, t);
    reg.tris.forEach(x => done.add(x));
    if (!best || reg.area > best.area) best = reg;
  }
  return faceAnchor(geom, best.tris[0], null, best);
}

/* Anker auf einer Fläche (geom-Koordinaten): Mittelpunkt, Normale, Leserichtung.
   point null = Mitte der Fläche. Leserichtung: waagerechte Fläche → entlang der längeren Seite der Fläche (X bei
   Gleichstand), sonst waagerecht mit „oben“ Richtung +Z. */
function faceAnchor(geom, tri, point, region) {
  const reg = region || coplanarRegion(geom, tri), n = reg.n;
  let u;
  if (Math.abs(n[2]) > 0.9) {
    const xs = [], ys = [];
    for (const t of reg.tris) for (let v = 0; v < 3; v++) { xs.push(geom.pos[t * 9 + v * 3]); ys.push(geom.pos[t * 9 + v * 3 + 1]); }
    const ex = Math.max(...xs) - Math.min(...xs), ey = Math.max(...ys) - Math.min(...ys);
    u = ey > ex * 1.2 ? [0, 1, 0] : [1, 0, 0];
    u = v3.norm(v3.sub(u, v3.mul(n, v3.dot(u, n))));
  } else {
    const up = v3.norm(v3.sub([0, 0, 1], v3.mul(n, n[2])));
    u = v3.norm(v3.cross(up, n));
  }
  let p = point || reg.centroid;
  if (!point) {
    const v = v3.cross(n, u);
    if (!regionContains(geom, reg, p, [u, v])) {   // Mitte liegt nicht auf der Fläche (z. B. Ring): größtes Dreieck
      let big = reg.tris[0], ba = 0;
      for (const t of reg.tris) { const a = triNormal(geom.pos, t).area; if (a > ba) { ba = a; big = t; } }
      p = triCentroid(geom.pos, big);
    }
  }
  // Punkt genau in die Ebene legen
  p = v3.sub(p, v3.mul(n, v3.dot(v3.sub(p, triCentroid(geom.pos, reg.tris[0])), n)));
  return { p, n, u, region: reg };
}

// Anker (geom) → Anker in origPos-Koordinaten des Teils
function anchorToOrig(a, R) { R = R || TEXT_ID3; return { p: matTVec(R, a.p), n: matTVec(R, a.n), u: matTVec(R, a.u) }; }

/* Skaliertes Teil (part.scale, js/orient.js): der Anker wandert mit der Oberfläche mit (Mitte der Grundfläche als Bezug),
   die Schrift behält ihre Höhe. textScaled: gespeicherter Text → für das aktuelle (skalierte) Netz; anchorUnscaled: auf dem
   skalierten Netz gewählter Punkt → wie ohne Skalierung (so wird er gespeichert). */
const txPivot = g => [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, g.mn[2]];
const txIsScaled = part => !!(part && part.scale && (part.scale[0] !== 1 || part.scale[1] !== 1 || part.scale[2] !== 1));
function textScaled(tx, part) {
  if (!txIsScaled(part) || !tx || !tx.anchor) return tx;
  const R = part.R || TEXT_ID3, pv = txPivot(part.geom), s = part.scale, pr = matVec(R, tx.anchor.p);
  return { ...tx, anchor: { ...tx.anchor, p: matTVec(R, [0, 1, 2].map(k => pv[k] + (pr[k] - pv[k]) * s[k])) } };
}
function anchorUnscaled(a, part) {
  if (!txIsScaled(part) || !a) return a;
  const pv = txPivot(part.geom), s = part.scale;
  return { ...a, p: [0, 1, 2].map(k => pv[k] + (a.p[k] - pv[k]) / s[k]) };
}

/* Rahmen des Textes in geom-Koordinaten: {o, u, v, n} (Drehung tx.rot in 90°-Schritten eingerechnet) */
function textFrame(tx, R) {
  R = R || TEXT_ID3;
  const n = v3.norm(matVec(R, tx.anchor.n)), u0 = v3.norm(matVec(R, tx.anchor.u)), a = (tx.rot || 0) * Math.PI / 180;
  const c = Math.round(Math.cos(a) * 1e12) / 1e12, s = Math.round(Math.sin(a) * 1e12) / 1e12, v0 = v3.cross(n, u0);
  const u = v3.add(v3.mul(u0, c), v3.mul(v0, s));
  return { o: matVec(R, tx.anchor.p), u, v: v3.cross(n, u), n };
}

// Netz des Textes in geom-Koordinaten (wie geom.pos). Erhaben: aus der Fläche heraus; vertieft: Abzugskörper ins Teil.
function textMesh(tx, R) {
  const o = { ...TEXT_DEFAULTS, ...tx }, f = textFrame(o, R);
  const [z0, z1] = o.mode === 'engraved' ? [-o.depth, TEXT_PROTRUDE_MM] : [-TEXT_EMBED_MM, o.depth];
  const loc = textSolid(o.text, { height: o.height, stroke: o.stroke, z0, z1 }), out = new Float32Array(loc.length);
  for (let i = 0; i < loc.length; i += 3) {
    const x = loc[i], y = loc[i + 1], z = loc[i + 2];
    for (let k = 0; k < 3; k++) out[i + k] = f.o[k] + x * f.u[k] + y * f.v[k] + z * f.n[k];
  }
  return out;
}

/* Hinweise zur Lage: ragt über die Fläche / über das Teil, Strich zu fein, erhabene Schrift auf der Unterseite.
   region (optional) = ebene Fläche in geom-Koordinaten, auf der der Text liegt. Ergebnis: Liste deutscher Texte (t()). */
function textWarnings(geom, tx, R, region) {
  const o = { ...TEXT_DEFAULTS, ...tx }, out = [], f = textFrame(o, R);
  if (!String(o.text).trim()) return out;
  const miss = unknownChars(o.text);
  if (miss.length) out.push(t('Diese Zeichen kennt die Schrift nicht (werden „?“): {chars}', { chars: miss.join(' ') }));
  if (o.stroke * o.height < TEXT_MIN_STROKE_MM) out.push(t('Strich nur {w} mm breit – mit einer 0,4-mm-Düse unter {min} mm kaum sauber. Text größer oder Strichstärke höher.', { w: de(o.stroke * o.height, 2), min: de(TEXT_MIN_STROKE_MM, 1) }));
  if (o.mode === 'raised' && f.n[2] < -0.5) out.push(t('Erhabene Schrift auf der Unterseite liegt unter dem Teil – besser vertieft oder eine andere Fläche.'));
  // über die Fläche: Umriss der Striche (Mitte ± halbe Strichstärke) auf der Fläche?
  if (region) {
    const { strokes } = textStrokes(o.text, o.height, o.stroke), r = o.stroke * o.height / 2, frame = [f.u, f.v];
    let off = 0, all = 0;
    const at = (x, y) => v3.add(f.o, v3.add(v3.mul(f.u, x), v3.mul(f.v, y)));
    for (const st of strokes) for (const [x, y] of st) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) { all++; if (!regionContains(geom, region, at(x + dx, y + dy), frame)) off++; }
    if (off) out.push(t('Text ragt über die gewählte Fläche hinaus ({pct} % der Punkte) – kleiner, drehen oder eine größere Fläche.', { pct: de(100 * off / all, 0) }));
  }
  // über das Teil: Maße quer zur Normalen gegen den Hüllquader des Teils
  const m = textMesh(o, R), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.length; i++) { const k = i % 3; if (m[i] < mn[k]) mn[k] = m[i]; if (m[i] > mx[k]) mx[k] = m[i]; }
  const slack = k => (o.depth + TEXT_PROTRUDE_MM) * Math.abs(f.n[k]) + 0.05;
  if ([0, 1, 2].some(k => mn[k] < geom.mn[k] - slack(k) || mx[k] > geom.mx[k] + slack(k))) out.push(t('Text ragt über das Teil hinaus.'));
  return out;
}
