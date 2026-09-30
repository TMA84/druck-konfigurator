'use strict';
/* Farb-Modifikatoren des Designers in der 3D-Ansicht (z. B. ein Schriftzug auf dem Deckel einer Makerworld-3MF):
   OrcaSlicer druckt alles, was innerhalb des Modifikators liegt, mit dessen Filament. Das Tool zeigt das so: Die
   Oberfläche des Teils wird im Bereich des Modifikators fein unterteilt (≤ MP_EDGE mm), jedes Stück, dessen Mitte im
   Modifikator liegt, kommt als farbige Schicht auf das Teil (Viewer.setOverlay). Innen/außen: Strahl nach oben durch den
   Modifikator, ungerade Zahl von Schnitten = innen (Gitter in XY beschleunigt die Suche).
   part.modVols = [{dSlot, pos}] aus js/import.js (gleiche Koordinaten wie part.geom, 3MF-Teile werden nicht gedreht).
   Ergebnis je Teil zwischengespeichert: [{dSlot, pos}] – die Farbe (Slot nach designMap) setzt der Aufrufer. */
const MP_EDGE = 0.6, MP_MAX_TRIS = 250000, MP_GRID = 96;
const mpCache = new WeakMap();

function mpGrid(pos) {
  const n = pos.length / 9, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < mn[k]) mn[k] = pos[i]; if (pos[i] > mx[k]) mx[k] = pos[i]; }
  const cs = Math.max((mx[0] - mn[0]) / MP_GRID, (mx[1] - mn[1]) / MP_GRID, 0.2), nx = Math.ceil((mx[0] - mn[0]) / cs) + 1, ny = Math.ceil((mx[1] - mn[1]) / cs) + 1;
  const cells = Array.from({ length: nx * ny }, () => []);
  for (let t = 0; t < n; t++) {
    const o = t * 9, x0 = Math.min(pos[o], pos[o + 3], pos[o + 6]), x1 = Math.max(pos[o], pos[o + 3], pos[o + 6]);
    const y0 = Math.min(pos[o + 1], pos[o + 4], pos[o + 7]), y1 = Math.max(pos[o + 1], pos[o + 4], pos[o + 7]);
    for (let cx = Math.floor((x0 - mn[0]) / cs); cx <= Math.floor((x1 - mn[0]) / cs); cx++)
      for (let cy = Math.floor((y0 - mn[1]) / cs); cy <= Math.floor((y1 - mn[1]) / cs); cy++) cells[cy * nx + cx].push(t);
  }
  return { pos, mn, mx, cs, nx, ny, cells };
}
// Liegt (x, y, z) im geschlossenen Netz? Senkrechter Strahl nach oben, Schnitte zählen
function mpInside(G, x, y, z) {
  if (x < G.mn[0] || x > G.mx[0] || y < G.mn[1] || y > G.mx[1] || z < G.mn[2] || z > G.mx[2]) return false;
  const cell = G.cells[Math.floor((y - G.mn[1]) / G.cs) * G.nx + Math.floor((x - G.mn[0]) / G.cs)], P = G.pos;
  let hits = 0;
  for (const t of cell || []) {
    const o = t * 9, ax = P[o], ay = P[o + 1], bx = P[o + 3], by = P[o + 4], cx = P[o + 6], cy = P[o + 7];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w = 1 - u - v;
    if (u < 0 || v < 0 || w < 0) continue;
    if (u * P[o + 2] + v * P[o + 5] + w * P[o + 8] > z) hits++;
  }
  return hits % 2 === 1;
}

function modifierOverlay(part) {
  if (!part.modVols || !part.modVols.length) return [];
  const hit = mpCache.get(part.geom);
  if (hit && hit.src === part.modVols && hit.R === part.R) return hit.out;
  const P = part.geom.pos, out = [];
  // skaliertes Teil: Modifikatoren mit derselben Mitte der Grundfläche skalieren (3MF-Teile werden nicht gedreht)
  // gedrehtes/skaliertes Teil: Modifikatoren genauso drehen (Weltachsen) und um die Mitte der Grundfläche skalieren
  const R = part.R, rot = R && R.some((v, i) => v !== IDENTITY3[i]), pv = isScaled(part.scale) ? scalePivot(P) : null;
  const place = pos => { const r = rot ? rotatePositions(pos, R) : pos; return pv ? scalePositions(r, part.scale, pv) : r; };
  for (const mv of part.modVols) {
    const G = mpGrid(place(mv.pos)), res = [], pad = MP_EDGE;
    let budget = MP_MAX_TRIS;
    // Dreieck rekursiv halbieren (längste Kante), bis es klein genug ist; Stücke im Modifikator behalten
    const outside = (a, b, c) => Math.max(a[0], b[0], c[0]) < G.mn[0] || Math.min(a[0], b[0], c[0]) > G.mx[0] ||
      Math.max(a[1], b[1], c[1]) < G.mn[1] || Math.min(a[1], b[1], c[1]) > G.mx[1] || Math.max(a[2], b[2], c[2]) < G.mn[2] - pad || Math.min(a[2], b[2], c[2]) > G.mx[2] + pad;
    const split = (a, b, c, depth) => {
      if (outside(a, b, c)) return;              // nur dort unterteilen, wo der Modifikator liegt (große Flächen: nur ihr Ausschnitt)
      const lab = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2, lbc = (b[0] - c[0]) ** 2 + (b[1] - c[1]) ** 2 + (b[2] - c[2]) ** 2, lca = (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 + (c[2] - a[2]) ** 2;
      const lmax = Math.max(lab, lbc, lca);
      if (budget <= 0) return;                   // Grenze erreicht: lieber weglassen als zu große Stücke einfärben
      if (lmax <= MP_EDGE * MP_EDGE || depth > 40) {
        budget--;
        if (mpInside(G, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3)) res.push(...a, ...b, ...c);
        return;
      }
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      if (lmax === lab) { const m = mid(a, b); split(a, m, c, depth + 1); split(m, b, c, depth + 1); }
      else if (lmax === lbc) { const m = mid(b, c); split(a, b, m, depth + 1); split(a, m, c, depth + 1); }
      else { const m = mid(c, a); split(a, b, m, depth + 1); split(m, b, c, depth + 1); }
    };
    for (let o = 0; o < P.length; o += 9) {
      // nur Dreiecke, die den Modifikator überhaupt berühren können
      if (Math.max(P[o], P[o + 3], P[o + 6]) < G.mn[0] - pad || Math.min(P[o], P[o + 3], P[o + 6]) > G.mx[0] + pad ||
          Math.max(P[o + 1], P[o + 4], P[o + 7]) < G.mn[1] - pad || Math.min(P[o + 1], P[o + 4], P[o + 7]) > G.mx[1] + pad ||
          Math.max(P[o + 2], P[o + 5], P[o + 8]) < G.mn[2] - pad || Math.min(P[o + 2], P[o + 5], P[o + 8]) > G.mx[2] + pad) continue;
      split([P[o], P[o + 1], P[o + 2]], [P[o + 3], P[o + 4], P[o + 5]], [P[o + 6], P[o + 7], P[o + 8]], 0);
    }
    if (res.length) out.push({ dSlot: mv.dSlot, pos: Float32Array.from(res) });
  }
  mpCache.set(part.geom, { src: part.modVols, R: part.R, out });
  return out;
}
