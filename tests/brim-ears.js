// Brim, der Löcher und Schriften freilässt (js/brim-ears.js): Ohren nur am Außenumriss, nie nahe an Löchern.
// Aufruf: node tests/brim-ears.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'brim-ears.js'), 'utf8'), ctx);
const { brimEarPoints, brimEarFile } = vm.runInContext('({brimEarPoints, brimEarFile})', ctx);
let passed = 0, failed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else { failed++; console.log('FEHLER', name, detail ?? ''); } };
const box = (x0, y0, x1, y1, h = 3) => { const v = [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]];
  return [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].flatMap(t => t.flatMap(i => v[i])); };
const vol = (...tris) => ({ pos: Float32Array.from(tris.flat()) });
const C = [20, 20, 1.5];

check('Platte ohne Löcher: normaler Brim (null)', brimEarPoints([vol(box(0, 0, 40, 40))], [], C, 0, 5) === null);
// Rahmen 40×40 mit 10-mm-Durchbruch und Insel (wie das Innere eines Buchstabens)
const frame = vol(box(0, 0, 40, 15), box(0, 25, 40, 40), box(0, 15, 15, 25), box(25, 15, 40, 25)), island = vol(box(18.5, 18.5, 21.5, 21.5));
const pts = brimEarPoints([frame, island], [], C, 0, 5);
check('Rahmen mit Insel: Ohren gesetzt', Array.isArray(pts) && pts.length >= 4, pts);
check('alle Ohren am Außenrand (|x| oder |y| ≈ 20)', pts.every(p => Math.abs(Math.abs(p[0]) - 20) < 0.6 || Math.abs(Math.abs(p[1]) - 20) < 0.6), pts);
check('alle vier Außenecken', [[-20, -20], [20, -20], [20, 20], [-20, 20]].every(([x, y]) => pts.some(p => Math.hypot(p[0] - x, p[1] - y) < 0.6)));
check('kein Ohr näher als 5 mm am Loch', pts.every(p => Math.max(Math.abs(p[0]), Math.abs(p[1])) - 5 > 5));
check('z knapp unter der Unterseite (Orca verwirft Ohren über dem Bett)', pts.every(p => Math.abs(p[2] - (-1.55)) < 1e-9));
// Loch nahe am Rand: Ecken dort entfallen
const near = brimEarPoints([vol(box(0, 0, 40, 2), box(0, 6, 40, 40), box(0, 2, 15, 6), box(25, 2, 40, 6))], [], C, 0, 5);
check('Loch 2 mm vom Rand: keine Ohren in Lochnähe', near.every(p => !(p[1] < -10 && Math.abs(p[0]) < 12)), near);
// vertiefte Beschriftung (negatives Teil) durch die Platte = Loch
const neg = brimEarPoints([vol(box(0, 0, 40, 40))], [vol(box(15, 15, 25, 25, 4))], C, 0, 5);
check('durchgehende Gravur zählt als Loch', Array.isArray(neg) && neg.length >= 4, neg);
// innerer Brim nur in großen Löchern: 20-mm-Loch bekommt Ohren (Radius innen), 4-mm-Loch keine
const two = [vol(box(0, 0, 60, 10), box(0, 30, 60, 40), box(0, 10, 5, 30), box(25, 10, 40, 30), box(44, 10, 60, 30), box(40, 10, 44, 18), box(40, 22, 44, 30))];
const C2 = [30, 20, 1.5], inn = brimEarPoints(two, [], C2, 0, 5, 3), inR = (inn || []).filter(p => p[3] === 3);
check('innen: Ohren an den Ecken des großen Lochs', inR.length >= 4 && inR.every(p => p[0] + 30 >= 4.5 && p[0] + 30 <= 25.5 && p[1] + 20 >= 9.5 && p[1] + 20 <= 30.5), inR);
check('innen: nichts am kleinen Loch', !(inn || []).some(p => Math.abs(p[0] + 30 - 42) < 4 && Math.abs(p[1] + 20 - 20) < 4));
check('außen weiter mit Brim-Breite', (inn || []).some(p => p[3] === 5));
check('ohne Innenbreite: kein innerer Brim', !(brimEarPoints(two, [], C2, 0, 5, 0) || []).some(p => p[3] !== 5));
check('Insel im Loch: dort kein innerer Brim', !(brimEarPoints([frame, island], [], C, 0, 5, 1.5) || []).some(p => p[3] === 1.5));
const only = brimEarPoints(two, [], C2, 0, 0, 3);
check('nur innen: Ohren nur im großen Loch', only && only.length >= 3 && only.every(p => p[3] === 3 && p[0] + 30 > 4 && p[0] + 30 < 26), only);
const f = brimEarFile([{ id: 1, pts: [[-20, -20, -1.5]], r: 5 }]);
check('Datei im Orca-Format 0', f === 'brim_points_format_version=0\nobject_id=1|-20.0000 -20.0000 -1.5000 5.0000\n', JSON.stringify(f));
console.log(passed + '/' + (passed + failed) + ' bestanden');
process.exit(failed ? 1 : 0);
