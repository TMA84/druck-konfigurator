'use strict';
/* Ausrichtung: welche Seite gehört aufs Bett? Kein DOM – tests/orient.js prüft das in Node.
   Bewertet werden die größten ebenen Flächen als Auflage. Maßstab ist die Stützfläche, wobei
   Stützen, die auf dem Teil selbst stehen (auch in Löchern), stärker zählen als Stützen vom Bett:
   Sie gehen schwerer ab und hinterlassen Spuren auf dem Teil. */

const ORIENT_MAX_CANDIDATES = 24;   // größte Flächenrichtungen, die geprüft werden
const ORIENT_NORMAL_STEP = 60;      // Normalen auf ~1° runden, um Flächen zu gruppieren
const ORIENT_BED_TOL = 0.2;         // wie makeGeom: alles in der ersten Schicht liegt auf
const WEIGHT_ON_PART = 3;           // Stütze auf dem Teil zählt dreifach
const MIN_CONTACT_MM2 = 30;         // weniger Auflage → Haftung/Kippen kritisch
const CONTACT_PENALTY = 400;        // Strafpunkte (≈ mm² Stützen) für zu wenig Auflage
const HEIGHT_WEIGHT = 0.5;          // leichte Vorliebe für flachere Lagen (Stabilität, Druckzeit)
const SUGGEST_MIN_GAIN = 0.2;       // Vorschlag nur bei ≥ 20 % …
const SUGGEST_MIN_ABS = 50;         // … und ≥ 50 Punkten Verbesserung

// Drehmatrix (3×3, zeilenweise), die Richtung d auf (0,0,-1) dreht – d zeigt danach aufs Bett.
function rotationToDown(d) {
  const len = Math.hypot(d[0], d[1], d[2]), x = d[0] / len, y = d[1] / len, z = d[2] / len;
  const c = -z;                                        // cos = d·(0,0,-1)
  if (c > 1 - 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (c < -1 + 1e-9) return [1, 0, 0, 0, -1, 0, 0, 0, -1];   // 180° um X
  // Achse = d × (0,0,-1) = (-y, x, 0), normiert; Rodrigues
  const s = Math.hypot(x, y), ax = -y / s, ay = x / s, sn = Math.sqrt(1 - c * c), t = 1 - c;
  return [
    c + ax * ax * t, ax * ay * t, ay * sn,
    ax * ay * t, c + ay * ay * t, -ax * sn,
    -ay * sn, ax * sn, c
  ];
}
const mulMat3 = (a, b) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function rotateAxis(axis, deg) {
  const a = deg * Math.PI / 180, c = Math.round(Math.cos(a) * 1e12) / 1e12, s = Math.round(Math.sin(a) * 1e12) / 1e12;
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function rotatePositions(pos, R) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = R[0] * x + R[1] * y + R[2] * z;
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z;
    out[i + 2] = R[6] * x + R[7] * y + R[8] * z;
  }
  return out;
}

/* Größe: part.scale = [sx, sy, sz] (1 = Originalgröße), angewandt nach der Drehung um die Mitte der Grundfläche
   (Mitte in X/Y, Unterkante in Z) – das Teil bleibt so auf dem Bett stehen und an seinem Platz. */
const isScaled = s => !!s && (s[0] !== 1 || s[1] !== 1 || s[2] !== 1);
function scalePivot(pos) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < mn[k]) mn[k] = pos[i]; if (pos[i] > mx[k]) mx[k] = pos[i]; }
  return [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]];
}
function scalePositions(pos, s, pivot) {
  if (!isScaled(s)) return pos;
  const pv = pivot || scalePivot(pos), out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = pv[k] + (pos[i + k] - pv[k]) * s[k];
  return out;
}
// Netz eines Teils aus Originalpunkten, Drehung und Größe – überall, wo part.geom neu entsteht
function partPositions(part) {
  const R = part.R, rotated = R && R.some((v, i) => v !== IDENTITY3[i]) ? rotatePositions(part.origPos, R) : part.origPos;
  return scalePositions(rotated, part.scale);
}
const partGeom = part => makeGeom(part.name, partPositions(part));

// Flächenrichtungen nach Gesamtfläche; dazu die sechs Achsrichtungen (für Teile ohne große Ebenen).
function candidateDirections(pos) {
  const n = pos.length / 9, groups = new Map();
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const wx = pos[o + 6] - pos[o], wy = pos[o + 7] - pos[o + 1], wz = pos[o + 8] - pos[o + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, len = Math.hypot(nx, ny, nz);
    if (!len) continue;
    const key = Math.round(nx / len * ORIENT_NORMAL_STEP) + ',' + Math.round(ny / len * ORIENT_NORMAL_STEP) + ',' + Math.round(nz / len * ORIENT_NORMAL_STEP);
    const g = groups.get(key) || { area: 0, n: [0, 0, 0] };
    g.area += len / 2; g.n[0] += nx / 2; g.n[1] += ny / 2; g.n[2] += nz / 2; // flächengewichtete Normale
    groups.set(key, g);
  }
  const dirs = [...groups.values()].sort((a, b) => b.area - a.area).slice(0, ORIENT_MAX_CANDIDATES).map(g => ({ d: g.n, area: g.area }));
  for (const d of [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]])
    if (!dirs.some(x => { const l = Math.hypot(...x.d); return (x.d[0] * d[0] + x.d[1] * d[1] + x.d[2] * d[2]) / l > 0.9998; })) dirs.push({ d, area: 0 });
  return dirs;
}

/* Bewertet eine Lage (bereits gedrehte Positionen). Je Überhangdreieck entscheidet der Blick
   senkrecht nach unten (makeDownProbe), ob die Stütze auf dem Teil oder dem Bett steht. */
function scoreOrientation(pos, th) {
  const probe = makeDownProbe(pos), n = pos.length / 9;
  let onBed = 0, onPart = 0, contact = 0;
  const sinTh = Math.sin(th * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const wx = pos[o + 6] - pos[o], wy = pos[o + 7] - pos[o + 1], wz = pos[o + 8] - pos[o + 2];
    const nz = ux * wy - uy * wx, len = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, nz);
    if (!len) continue;
    const area = len / 2, zmax = Math.max(pos[o + 2], pos[o + 5], pos[o + 8]);
    const down = -nz / len;                 // 1 = Decke, 0 = Wand
    if (zmax <= probe.mnz + ORIENT_BED_TOL) { if (down > 0.98) contact += area; continue; }
    // Überhangwinkel wie makeGeom: ang = 90 − acos(down) > th  ⇔  down > sin(th)
    if (down <= sinTh) continue;
    probe.sample(i, area, (r, w) => { if (r === 'part') onPart += w; else if (r === 'bed') onBed += w; });
  }
  const height = probe.mxz - probe.mnz;
  const score = onBed + WEIGHT_ON_PART * onPart + (contact < MIN_CONTACT_MM2 ? CONTACT_PENALTY : 0) + HEIGHT_WEIGHT * height;
  return { onBed, onPart, contact, height, score };
}

/* Große Netze für die Bewertung vereinfachen (Eckpunkte auf ein Raster ziehen, entartete Dreiecke
   verwerfen). Die Rangfolge der Lagen bleibt erhalten; bei 200.000 Dreiecken dauerte die Bewertung
   sonst ~25 s (Prüfung 2026-09-26). Gedreht wird immer das Originalnetz. */
const ORIENT_TARGET_TRIS = 20000;
function simplifyForScoring(pos) {
  const n = pos.length / 9;
  if (n <= ORIENT_TARGET_TRIS) return pos;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
  let cell = diag / 400, out = pos;
  for (let round = 0; round < 8 && out.length / 9 > ORIENT_TARGET_TRIS; round++, cell *= 1.6) {
    const q = v => Math.round(v / cell) * cell, keep = [];
    for (let t = 0; t < n; t++) {
      const o = t * 9, v = [];
      for (let k = 0; k < 9; k++) v.push(q(pos[o + k]));
      const same = (a, b) => v[a] === v[b] && v[a + 1] === v[b + 1] && v[a + 2] === v[b + 2];
      if (!same(0, 3) && !same(3, 6) && !same(0, 6)) keep.push(...v);
    }
    out = Float32Array.from(keep);
  }
  return out;
}

/* Alle Kandidaten bewerten. R0 = aktuelle Drehung des Teils gegenüber der Datei; die Kandidaten
   werden auf die Originalpositionen angewandt. Ergebnis sortiert, bestes zuerst; current = aktuelle Lage. */
function evaluateOrientations(origPos, R0, th) {
  origPos = simplifyForScoring(origPos);
  const current = { R: R0, ...scoreOrientation(rotatePositions(origPos, R0), th) };
  const seen = [];
  const results = [];
  for (const c of candidateDirections(origPos)) {
    const R = rotationToDown(c.d);
    if (seen.some(S => S.every((v, i) => Math.abs(v - R[i]) < 1e-6))) continue;
    seen.push(R);
    results.push({ R, faceArea: c.area, ...scoreOrientation(rotatePositions(origPos, R), th) });
  }
  results.sort((a, b) => a.score - b.score);
  const best = results[0];
  const worthIt = best && current.score - best.score >= Math.max(SUGGEST_MIN_ABS, SUGGEST_MIN_GAIN * current.score);
  return { current, best, suggestion: worthIt ? best : null, results };
}
