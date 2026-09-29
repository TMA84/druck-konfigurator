'use strict';
/* Prüft die Schätzung von Farbwechseln und Spülabfall (js/purge.js). Die Wechselzahlen wurden am
   2026-09-28 mit der OrcaSlicer-CLI verglichen (tests/verify-3mf.js prüft das bei jedem Lauf nach). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'stl', 'purge'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({makeGeom, estimateColourChanges, acePurgeEstimate, aceChangeSeconds})', ctx);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log('FEHLER ' + name + (detail !== undefined ? ': ' + detail : '')); } }

function box(x0, y0, z0, x1, y1, z1) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].flatMap(t => t.flatMap(i => v[i]));
}
function part(boxes, slots, slot = null, plate = 1) {
  const geom = K.makeGeom('t', Float32Array.from(boxes.flatMap(b => box(...b))));
  return { geom, slot, plate, bodies: boxes.length > 1 ? boxes.map((b, j) => ({ name: 'K' + j, start: j * 12, count: 12, slot: slots[j] })) : null };
}
const est = (items, def = 0) => K.estimateColourChanges(items, def, 0.2, 0.2);

// Werte wie Orca (Vergleich per CLI): nebeneinander 50, Schrift oben 1, gestuft 11, zwei Teile 20
check('Zwei Farben nebeneinander, 10 mm: 1 Wechsel je Schicht', est([part([[0,0,0,20,30,10],[20,0,0,40,30,10]], [null, 1])]) === 50);
check('Schrift oben auf dem Schild: 1 Wechsel', est([part([[0,0,0,40,30,3],[5,5,3,35,10,4]], [null, 2])]) === 1);
check('Drei Farben gestuft: 11 Wechsel', est([part([[0,0,0,40,30,4],[0,0,4,20,30,8],[20,0,4,40,30,6]], [null, 1, 2])]) === 11);
check('Zwei Teile mit eigenem Slot teilen sich die Schichten: 20', est([part([[0,0,0,20,20,6]], [], null), part([[0,0,0,20,20,4]], [], 1)]) === 20);
check('Alles im selben Slot: 0 Wechsel', est([part([[0,0,0,20,30,10],[20,0,0,40,30,10]], [null, null])]) === 0);
check('Körper im Standard-Slot zählt als dieser Slot', est([part([[0,0,0,20,30,10],[20,0,0,40,30,10]], [null, 1])], 1) === 0);
check('Getrennte Platten zählen einzeln', est([part([[0,0,0,20,20,4]], [], null, 1), part([[0,0,0,20,20,4]], [], 1, 2)]) === 0);

// Abfall und Zeit wie gemessen (100 Wechsel): 1,5 → 108 g / 126,4 s, 1,0 → 77,5 g, 0,5 → 45 g
const e = f => K.acePurgeEstimate(100, f);
check('1,5: ≈ 108 g', Math.abs(e(1.5).grams - 108.3) < 1, e(1.5).grams);
check('1,0: ≈ 77,5 g', Math.abs(e(1.0).grams - 77.5) < 1.5, e(1.0).grams);
check('0,5: ≈ 45 g', Math.abs(e(0.5).grams - 45.1) < 1, e(0.5).grams);
check('Wechselzeit 1,5 = Vorlage, 1,0 ≈ 107,2 s', K.aceChangeSeconds(1.5) === 126.423 && Math.abs(K.aceChangeSeconds(1.0) - 107.2) < 0.5, K.aceChangeSeconds(1.0));

console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
