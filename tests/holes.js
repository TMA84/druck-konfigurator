'use strict';
/* Prüft die Loch-Erkennung (js/holes.js): Durchgangsloch, waagerechtes Loch, Zapfen (kein Loch),
   Halbkreis-Schlitz (kein Loch), Modifikator-Zylinder. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'stl', 'orient', 'holes'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({findHoles, holeModifierMesh, makeGeom, rotatePositions, rotateAxis})', ctx);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log('FEHLER ' + name + (detail !== undefined ? ': ' + detail : '')); } }
const r2 = v => Math.round(v * 100) / 100;

/* Platte (size × size × h) mit rundem Loch (Radius r, Mitte cx/cy, n Segmente); geschlossenes Netz:
   Außenkontur als n-Eck auf dem Quadratrand (gleiche Winkel), Ringstreifen oben/unten, Wände. */
function plateWithHole(size, h, r, cx, cy, n = 32) {
  const tris = [], half = size / 2;
  const sq = a => { const c = Math.cos(a), s = Math.sin(a), k = half / Math.max(Math.abs(c), Math.abs(s)); return [cx + k * c, cy + k * s]; };
  const ci = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n, b = 2 * Math.PI * (i + 1) / n;
    const [oa, ob, ia, ib] = [sq(a), sq(b), ci(a), ci(b)];
    tris.push([[...ia, h], [...oa, h], [...ob, h]], [[...ia, h], [...ob, h], [...ib, h]]);   // oben, Normale +z
    tris.push([[...ia, 0], [...ob, 0], [...oa, 0]], [[...ia, 0], [...ib, 0], [...ob, 0]]);   // unten, −z
    tris.push([[...oa, 0], [...ob, 0], [...ob, h]], [[...oa, 0], [...ob, h], [...oa, h]]);   // Außenwand
    tris.push([[...ia, 0], [...ib, h], [...ib, 0]], [[...ia, 0], [...ia, h], [...ib, h]]);   // Lochwand, Normale zur Mitte
  }
  return Float32Array.from(tris.flat(2));
}

// 1) Senkrechtes Durchgangsloch Ø 5 in 40×40×6
let g = K.makeGeom('platte', plateWithHole(40, 6, 2.5, 20, 20));
let h = K.findHoles(g);
check('Durchgangsloch gefunden', h.length === 1, h.length);
if (h[0]) check('Achse z, Ø ≈ 5, Mitte 20/20, Tiefe 6', h[0].axis === 'z' && Math.abs(2 * h[0].r - 5) < 0.2 && r2(h[0].c[0]) === 20 && r2(h[0].c[1]) === 20 && r2(h[0].depth) === 6, JSON.stringify(h[0]));

// 2) Gleiche Platte hochkant (90° um X) → waagerechtes Loch entlang y
g = K.makeGeom('hochkant', K.rotatePositions(plateWithHole(40, 6, 2.5, 20, 20), K.rotateAxis('x', 90)));
h = K.findHoles(g);
check('Waagerechtes Loch (Achse y)', h.length === 1 && h[0].axis === 'y' && Math.abs(2 * h[0].r - 5) < 0.2, JSON.stringify(h));

// 3) Zapfen (runder Stift, Normalen nach außen) ist kein Loch
const pin = [];
for (let i = 0; i < 32; i++) {
  const a = 2 * Math.PI * i / 32, b = 2 * Math.PI * (i + 1) / 32, P = (t, z) => [3 * Math.cos(t), 3 * Math.sin(t), z];
  pin.push([P(a, 0), P(b, 0), P(b, 10)], [P(a, 0), P(b, 10), P(a, 10)], [[0, 0, 10], P(a, 10), P(b, 10)], [[0, 0, 0], P(b, 0), P(a, 0)]);
}
h = K.findHoles(K.makeGeom('stift', Float32Array.from(pin.flat(2))));
check('Zapfen wird nicht als Loch erkannt', h.length === 0, h.length);

// 4) Mehrere Löcher, unterschiedliche Größen; Ø 30 (r 15) noch drin, Ø 40 nicht
const multi = [...plateWithHole(40, 5, 1.6, 20, 20), ...plateWithHole(40, 5, 4, 70, 20), ...plateWithHole(80, 5, 20, 140, 20)];
h = K.findHoles(K.makeGeom('mehrere', Float32Array.from(multi)));
check('Zwei Löcher (Ø 3,2 und Ø 8), großer Ausschnitt Ø 40 nicht', h.length === 2 && h.map(x => r2(2 * x.r)).every(d => d > 3 && d < 8.2), h.map(x => r2(2 * x.r)).join('/'));

// 5) Modifikator: Zylinder um das Loch, Radius r + 3, gleiche Tiefe, nach außen gerichtet
g = K.makeGeom('platte', plateWithHole(40, 6, 2.5, 20, 20));
h = K.findHoles(g);
const mg = K.makeGeom('mod', K.holeModifierMesh(h[0]));
check('Modifikator Ø ≈ 11, Höhe 6, Mitte 20/20', Math.abs(mg.x - 2 * (h[0].r + 3)) < 0.05 && r2(mg.z) === 6 && r2((mg.mn[0] + mg.mx[0]) / 2) === 20, [mg.x, mg.z].join());
check('Modifikator geschlossen und nach außen gerichtet (Volumen > 0)', Math.abs(mg.vol - Math.PI * Math.pow(h[0].r + 3, 2) * 6) / mg.vol < 0.02, mg.vol);

// 6) Befund der Prüfung: Lochwand durch zwei Stege unterbrochen (zwei Teilbögen ohne gemeinsame Ecken)
{
  const full = plateWithHole(40, 6, 2.5, 20, 20), keep = [];
  // je Segment 8 Dreiecke; die Lochwand sind die letzten zwei → Segmente 0,1 und 16,17 ohne Wand
  for (let i = 0; i < 32; i++) for (let t = 0; t < 8; t++) if (!(t >= 6 && [0, 1, 16, 17].includes(i))) keep.push(...full.subarray((i * 8 + t) * 9, (i * 8 + t + 1) * 9));
  h = K.findHoles(K.makeGeom('steg', Float32Array.from(keep)));
  check('Unterbrochene Lochwand: Teilbögen zusammengefasst', h.length === 1 && Math.abs(2 * h[0].r - 5) < 0.2, JSON.stringify(h.map(x => r2(2 * x.r))));
}
// 7) Um 2° gekipptes Teil: Loch wird noch erkannt (stärker gekippte Löcher bewusst nicht – der Ring säße schief)
h = K.findHoles(K.makeGeom('gekippt', K.rotatePositions(plateWithHole(40, 6, 2.5, 20, 20), K.rotateAxis('x', 2))));
check('2° gekipptes Loch erkannt', h.length === 1, h.length);

console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
