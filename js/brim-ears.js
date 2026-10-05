'use strict';
/* Brim, der Löcher und Schriften freilässt (2026-10-05): Orca zieht einen äußeren Brim auch um jede Insel in einem
   Durchbruch (das Innere von Buchstaben, Stege in Öffnungen) – die Öffnung läuft zu und lässt sich nicht mehr freilegen
   (mit der Orca-CLI geprüft: 10-mm-Loch mit Insel, Brim 5 mm → 167 Brim-Bahnpunkte im Loch).
   Abhilfe: Brim-Art „painted“ mit gesetzten Mausohren (Metadata/brim_ear_points.txt, Format 0: „object_id=k|x y z r …“
   in Objektkoordinaten) auf den Ecken des Außenumrisses der ersten Schicht (bei runden Umrissen fast durchgehend);
   Ecken, die näher als der Ohrradius an einem Loch liegen, entfallen (geprüft: 0 Brim-Bahnen im Loch).
   Erste Schicht: Schnitt 0,1 mm über der Unterseite, gerastert (0,25 mm); Löcher = leere Flächen, die nicht nach außen
   offen sind. Vertiefte Beschriftung (negative Teile) wird abgezogen. */
const EAR_CELL_MM = 0.25;

// Schnitt der Dreiecke (pos: 9 Werte je Dreieck) mit der Ebene z → Strecken [x1,y1,x2,y2]
function sectionSegments(pos, z) {
  const segs = [];
  for (let i = 0; i < pos.length; i += 9) {
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const a = i + e * 3, b = i + ((e + 1) % 3) * 3, za = pos[a + 2], zb = pos[b + 2];
      if ((za <= z) === (zb <= z)) continue;
      const f = (z - za) / (zb - za);
      pts.push(pos[a] + f * (pos[b] - pos[a]), pos[a + 1] + f * (pos[b + 1] - pos[a + 1]));
    }
    if (pts.length === 4) segs.push(pts);
  }
  return segs;
}

// Strecken (geschlossene Umrisse) gerade-ungerade in das Raster füllen; val 1 = setzen, 0 = löschen
function rasterFill(grid, segs, val) {
  const { w, h, x0, y0, c } = grid;
  for (let j = 0; j < h; j++) {
    const y = y0 + (j + 0.5) * c, xs = [];
    for (const [ax, ay, bx, by] of segs) if ((ay <= y) !== (by <= y)) xs.push(ax + (y - ay) / (by - ay) * (bx - ax));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / c - 0.5)), i1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / c - 0.5));
      for (let i = i0; i <= i1; i++) grid.m[j * w + i] = val;
    }
  }
}

/* vols: [{pos}] (positive Körper), negs: [{pos}] (abgezogene Teile), center: Objektmitte (wie meshModelXML), mnZ: Unterseite,
   r: Ohrradius = Brim-Breite. Ergebnis: [[x,y,z], …] in Objektkoordinaten, oder null, wenn die erste Schicht keine Löcher hat
   (dann genügt der normale äußere Brim). */
function brimEarPoints(vols, negs, center, mnZ, r) {
  const z = mnZ + 0.1, c = EAR_CELL_MM;
  const pos = vols.map(v => sectionSegments(v.pos, z)), neg = (negs || []).map(v => sectionSegments(v.pos, z));
  const all = pos.flat();
  if (!all.length || !(r > 0)) return null;
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const [ax, ay, bx, by] of all) { mnx = Math.min(mnx, ax, bx); mny = Math.min(mny, ay, by); mxx = Math.max(mxx, ax, bx); mxy = Math.max(mxy, ay, by); }
  const pad = 2 * c, x0 = mnx - pad, y0 = mny - pad, w = Math.ceil((mxx - mnx + 2 * pad) / c), h = Math.ceil((mxy - mny + 2 * pad) / c);
  if (w * h > 4e6) return null;   // sehr große Grundfläche: normaler Brim
  const grid = { w, h, x0, y0, c, m: new Uint8Array(w * h) };
  for (const s of pos) { const g = { ...grid, m: new Uint8Array(w * h) }; rasterFill(g, s, 1); for (let i = 0; i < w * h; i++) grid.m[i] |= g.m[i]; }
  for (const s of neg) rasterFill(grid, s, 0);
  const m = grid.m, N = w * h;
  // außen: leere Zellen, vom Rand aus erreichbar; Löcher: übrige leere Zellen
  const out = new Uint8Array(N), st = [];
  for (let i = 0; i < w; i++) st.push(i, (h - 1) * w + i);
  for (let j = 0; j < h; j++) st.push(j * w, j * w + w - 1);
  while (st.length) {
    const p = st.pop(); if (out[p] || m[p]) continue; out[p] = 1;
    const i = p % w, j = (p - i) / w;
    if (i > 0) st.push(p - 1); if (i < w - 1) st.push(p + 1); if (j > 0) st.push(p - w); if (j < h - 1) st.push(p + w);
  }
  let holes = 0;
  for (let p = 0; p < N; p++) if (!m[p] && !out[p]) holes++;
  if (holes * c * c < 0.05) return null;   // keine (nennenswerten) Löcher
  // Abstand jeder Zelle zum nächsten Loch (Mehrquellen-Breitensuche, 8er-Nachbarschaft ≈ Euklid)
  const lim = Math.ceil((r + 0.6) / c), dist = new Uint16Array(N).fill(65535), q = [];
  for (let p = 0; p < N; p++) if (!m[p] && !out[p]) { dist[p] = 0; q.push(p); }
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi], d = dist[p]; if (d >= lim) continue;
    const i = p % w, j = (p - i) / w;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
      const pp = jj * w + ii; if (dist[pp] > d + 1) { dist[pp] = d + 1; q.push(pp); }
    }
  }
  // Ohren nur auf Ecken des Außenumrisses: Orca 2.4.2 setzt ein Ohr auf die nächstgelegene Umrissecke (geprüft: ein Punkt
  // mitten auf einer Kante landete an der Ecke eines Lochs). Ecken = Endpunkte der Schnittstrecken; schärfste zuerst,
  // dann im Abstand r/2 ausgedünnt (auf Rundungen eine fast durchgehende Kette); Ecken näher als r an einem Loch entfallen.
  const corners = new Map(), vk = (x, y) => Math.round(x * 100) + ',' + Math.round(y * 100);
  for (const [ax, ay, bx, by] of all) {
    const d = [bx - ax, by - ay], l = Math.hypot(d[0], d[1]) || 1;
    for (const [x, y, dx, dy] of [[ax, ay, d[0] / l, d[1] / l], [bx, by, -d[0] / l, -d[1] / l]]) {
      const k = vk(x, y); if (!corners.has(k)) corners.set(k, { x, y, dirs: [] }); corners.get(k).dirs.push([dx, dy]);
    }
  }
  const cell = (x, y) => { const i = Math.floor((x - x0) / c), j = Math.floor((y - y0) / c); return i < 0 || j < 0 || i >= w || j >= h ? -1 : j * w + i; };
  const cand = [];
  for (const v of corners.values()) {
    const p = cell(v.x, v.y); if (p < 0) continue;
    const i = p % w, j = (p - i) / w;
    let outside = false, nearHole = false;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < w && jj < h && out[jj * w + ii]) outside = true; }
    if (!outside) continue;
    if (dist[p] * c < r + 0.5) nearHole = true;
    if (nearHole) continue;
    // Schärfe: 1 − cos des Winkels zwischen den beiden Kanten (gerade Fortsetzung = 0, Spitze = 2)
    const [d1, d2] = v.dirs; const sharp = d1 && d2 ? 1 + (d1[0] * d2[0] + d1[1] * d2[1]) : 0;
    cand.push([v.x, v.y, sharp]);
  }
  cand.sort((a, b) => b[2] - a[2]);
  const step = Math.max(c, r / 2), pts = [];
  for (const [x, y] of cand) if (!pts.some(q => Math.hypot(q[0] - x, q[1] - y) < step)) pts.push([x, y]);
  return pts.length ? pts.map(([x, y]) => [x - center[0], y - center[1], mnZ - center[2]]) : null;
}

// Inhalt von Metadata/brim_ear_points.txt: [{id: Objektindex 1-basiert, pts, r}]
function brimEarFile(list) {
  const f = v => (Math.round(v * 1e4) / 1e4).toFixed(4);
  const rows = list.filter(o => o.pts && o.pts.length).map(o => 'object_id=' + o.id + '|' + o.pts.map(p => f(p[0]) + ' ' + f(p[1]) + ' ' + f(p[2]) + ' ' + f(o.r)).join(' '));
  return rows.length ? 'brim_points_format_version=0\n' + rows.join('\n') + '\n' : '';
}
