'use strict';
/* Anordnen nach echter Grundfläche (js/nest.js) statt Hüllrechteck: Dreiecke ineinander, Abstand, Bettgrenzen,
   Rechteck-Teile unverändert, „Objekt für Objekt“ ohne Nesting. Aufruf: node tests/nest.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, TextDecoder, Date });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'brim-ears', 'nest', 'export3mf'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({makeGeom, arrangeParts, exportTemplate, placeXY, footprintMask, footprintPath, setPrintSequence, nestGroup})', ctx);
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) pass++; else { fail++; console.log('FEHLER ' + n + (d !== undefined ? ': ' + JSON.stringify(d) : '')); } };

// Prisma über einem Polygon (gegen den Uhrzeigersinn), Höhe h – Dreiecke als Fächer, Seitenwände
function prism(name, poly, h) {
  const t = [];
  for (let k = 1; k + 1 < poly.length; k++) {
    t.push(...poly[0], 0, ...poly[k + 1], 0, ...poly[k], 0);
    t.push(...poly[0], h, ...poly[k], h, ...poly[k + 1], h);
  }
  poly.forEach((a, k) => { const b = poly[(k + 1) % poly.length]; t.push(...a, 0, ...b, 0, ...b, h, ...a, 0, ...b, h, ...a, h); });
  return K.makeGeom(name, new Float32Array(t));
}
const tpl = K.exportTemplate('kobra_s1', '0.4');   // Bett 250 × 250
// Welt-Ecken eines platzierten Polygons (wie placeTransform: um die Mitte des Hüllrechtecks gedreht, dann verschoben)
const placed = (g, poly, pl) => { const cx = (g.mn[0] + g.mx[0]) / 2, cy = (g.mn[1] + g.mx[1]) / 2; return poly.map(([x, y]) => { const [u, v] = K.placeXY(pl, x - cx, y - cy); return [u + pl.lx, v + pl.ly]; }); };
const segDist = (p, q, a, b) => { // Abstand Punkt p zu Strecke ab (q ungenutzt)
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, s = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy);
};
const inside = (p, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > p[1]) !== (P[j][1] > p[1]) && p[0] < (P[j][0] - P[i][0]) * (p[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const polyDist = (A, B) => { // Abstand zweier konvexer Polygone (0 bei Überlappung)
  if (A.some(p => inside(p, B)) || B.some(p => inside(p, A))) return 0;
  let d = Infinity;
  for (const p of A) B.forEach((a, k) => { d = Math.min(d, segDist(p, null, a, B[(k + 1) % B.length])); });
  for (const p of B) A.forEach((a, k) => { d = Math.min(d, segDist(p, null, a, A[(k + 1) % A.length])); });
  return d;
};
const inBed = P => P.every(([x, y]) => x >= -0.01 && y >= -0.01 && x <= 250.01 && y <= 250.01);

// 1) Zwei rechtwinklige Dreiecke 220 × 220 mm: Hüllrechtecke passen nicht zu zweit aufs Bett, die Dreiecke schon
const tri = [[0, 0], [220, 0], [0, 220]];
const T = prism('Dreieck', tri, 5);
const m = K.footprintMask(T, 0);
check('Grundfläche ≈ halbes Hüllrechteck', Math.abs(m.area / (m.w * m.h) - 0.5) < 0.03, m.area / (m.w * m.h));
let r = K.arrangeParts([T, T], tpl);
check('zwei Dreiecke auf einer Platte', r.plateCount === 1, r.plateCount);
const P0 = placed(T, tri, r.places[0]), P1 = placed(T, tri, r.places[1]);
check('beide im Bett', inBed(P0) && inBed(P1), [P0, P1]);
check('Abstand ≥ 8 mm (Standard)', polyDist(P0, P1) >= 8 - 0.01, polyDist(P0, P1));
check('gegeneinander gedreht (180°)', Math.abs(r.places[0].ang - r.places[1].ang) === 180, r.places.map(p => p.ang));
check('Draufsicht-Pfad vorhanden', /^M[\d.]+ [\d.]+h\d+v/.test(K.footprintPath(T, r.places[1].ang) || ''));

// 2) Drei Dreiecke: das dritte passt nicht mehr → 2 Platten (Rechteck-Verfahren bräuchte 3)
r = K.arrangeParts([T, T, T], tpl);
check('drei Dreiecke → 2 Platten', r.plateCount === 2, r.plateCount);

// 3) Volle Quader: Nesting lohnt nicht, Ergebnis wie bisher (nestGroup gibt null)
const B = prism('Quader', [[0, 0], [150, 0], [150, 150], [0, 150]], 10);
check('Quader: kein Nesting', K.nestGroup([B, B], [0, 1], 250, 250, 8) === null);
check('zwei Quader 150 mm → 2 Platten', K.arrangeParts([B, B], tpl).plateCount === 2);

// 4) Objekt für Objekt: rechteckiger Kopf-Freiraum, kein Nesting
K.setPrintSequence(true);
check('Objekt für Objekt: Dreiecke je eine Platte', K.arrangeParts([T, T], tpl).plateCount === 2);
K.setPrintSequence(false);

// 5) Größer als das Bett: Rechteck-Verfahren entscheidet (null)
const Big = prism('Groß', [[0, 0], [300, 0], [0, 300]], 5);
check('zu groß: kein Nesting', K.nestGroup([Big, T], [0, 1], 250, 250, 8) === null);

// 6) Größerer Abstand (15 mm) wird eingehalten
vm.runInContext('setPackGap(15)', ctx);
r = K.arrangeParts([T, T], tpl);
{ const A = placed(T, tri, r.places[0]), C = placed(T, tri, r.places[1]); check('Abstand 15 mm eingehalten', r.plateCount === 1 && polyDist(A, C) >= 15 - 0.01, [r.plateCount, polyDist(A, C)]); }
vm.runInContext('setPackGap(PART_GAP_MM)', ctx);
// 7) Brim zählt mit: je 5 mm Brim → Abstand der Teile ≥ 8 + 5 + 5 mm; Brim bleibt auf dem Bett
r = K.arrangeParts([T, T], tpl, null, [5, 5]);
{ const A = placed(T, tri, r.places[0]), C = placed(T, tri, r.places[1]), grow = P => P;
  check('Brim 5 mm: Abstand ≥ 18 mm', r.plateCount === 1 && polyDist(A, C) >= 18 - 0.01, [r.plateCount, polyDist(A, C)]);
  const inBed5 = P => P.every(([x, y]) => x >= 5 - 0.01 && y >= 5 - 0.01 && x <= 245.01 && y <= 245.01);
  check('Brim 5 mm bleibt auf dem Bett', inBed5(A) && inBed5(C), [A, C]); }
// Rechteck-Verfahren mit Brim: zwei Quader 115 mm passen ohne Brim nebeneinander, mit 5 mm Brim nicht mehr
const Q = prism('Q', [[0, 0], [115, 0], [115, 115], [0, 115]], 5);
check('Quader 115 mm ohne Brim: 4 auf einer Platte', K.arrangeParts([Q, Q, Q, Q], tpl).plateCount === 1);
check('Quader 115 mm mit 5 mm Brim: mehr Platten', K.arrangeParts([Q, Q, Q, Q], tpl, null, [5, 5, 5, 5]).plateCount > 1);

// 8) Leiste 300 × 20 mm passt nur schräg (45°) aufs 250er-Bett
const Bar = prism('Leiste', [[0, 0], [300, 0], [300, 20], [0, 20]], 5);
r = K.arrangeParts([Bar], tpl);
{ const P = placed(Bar, [[0, 0], [300, 0], [300, 20], [0, 20]], r.places[0]);
  check('Leiste 300 mm: schräg gelegt, nicht „zu groß“', r.places[0].ang % 90 !== 0 && r.oversize.length === 0, [r.places[0].ang, r.oversize]);
  check('Leiste liegt ganz auf dem Bett', inBed(P), P); }
const tr45 = vm.runInContext("placeTransform({ang:45,x:10,y:20}, 1)", ctx).split(' ').map(Number);
check('3MF-Matrix 45°: cos/sin', Math.abs(tr45[0] - Math.SQRT1_2) < 1e-6 && Math.abs(tr45[1] - Math.SQRT1_2) < 1e-6 && Math.abs(tr45[3] + Math.SQRT1_2) < 1e-6 && tr45[9] === 10, tr45);

console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
