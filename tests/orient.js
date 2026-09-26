'use strict';
/* Prüft die Ausrichtung (js/orient.js): Drehmatrizen, Bewertung Stützen Bett/Teil, Vorschlag. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'stl', 'orient'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({rotationToDown, rotateAxis, mulMat3, rotatePositions, scoreOrientation, evaluateOrientations, makeGeom, analyze, IDENTITY3})', ctx);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log('FEHLER ' + name + (detail !== undefined ? ': ' + detail : '')); } }
const r1 = v => Math.round(v * 10) / 10;

function boxTris(x0, y0, z0, x1, y1, z1) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].map(t => t.map(i => v[i]));
}
const flat = tris => Float32Array.from(tris.flat(2));
const apply = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

// 1) Drehmatrix bringt jede Richtung nach unten und ist orthonormal
let worst = 0;
for (let i = 0; i < 200; i++) {
  const d = i < 6 ? [[0,0,-1],[0,0,1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]][i] : [Math.sin(i), Math.cos(i * 1.7), Math.sin(i * 2.3)];
  const l = Math.hypot(...d), R = K.rotationToDown(d), v = apply(R, d.map(x => x / l));
  const RtR = K.mulMat3([R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]], R);
  const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
  worst = Math.max(worst, Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2] + 1), ...RtR.map((x, k) => Math.abs(x - K.IDENTITY3[k])), Math.abs(det - 1));
}
check('rotationToDown: d → (0,0,-1), orthonormal, det 1', worst < 1e-9, worst);
const rx = K.rotateAxis('x', 90);
check('rotateAxis x 90°: y → z', apply(rx, [0, 1, 0]).map(Math.round).join() === '0,0,1', apply(rx, [0, 1, 0]).join());

// 2) Pilz (Stiel unten, Hut oben): Stützen unter dem Hut stehen auf dem Bett
const pilz = flat([...boxTris(15, 15, 0, 25, 25, 20), ...boxTris(0, 0, 20, 40, 40, 25)]);
let s = K.scoreOrientation(pilz, 45);
check('Pilz stehend: Stützen vom Bett (1500 mm² ± 10 %, Abtastung)', Math.abs(s.onBed - 1500) < 150 && s.onPart === 0, r1(s.onBed) + '/' + r1(s.onPart));
check('Pilz stehend: Auflage 100 mm²', r1(s.contact) === 100, s.contact);
// … Vorschlag: Hut nach unten → keine Stützen
let e = K.evaluateOrientations(pilz, K.IDENTITY3, 45);
check('Pilz: Vorschlag vorhanden', !!e.suggestion);
if (e.suggestion) {
  const g = K.makeGeom('p', K.rotatePositions(pilz, e.suggestion.R));
  check('Pilz: Vorschlag = Hut aufs Bett, keine Stützen', e.suggestion.onBed + e.suggestion.onPart < 1 && r1(e.suggestion.contact) === 1600 && K.analyze(g, 45).level === 'none', JSON.stringify({ b: e.suggestion.onBed, p: e.suggestion.onPart, c: e.suggestion.contact, lv: K.analyze(g, 45).level }));
}

// 3) Ausleger über einer Stufe: Stütze landet auf dem Teil (zählt dreifach)
const stufe = flat([...boxTris(0, 0, 0, 40, 20, 5), ...boxTris(0, 0, 5, 10, 20, 30), ...boxTris(10, 0, 25, 40, 20, 30)]);
s = K.scoreOrientation(stufe, 45);
check('Ausleger über Stufe: Stütze auf dem Teil', r1(s.onPart) === 600 && r1(s.onBed) === 0, r1(s.onBed) + '/' + r1(s.onPart));
check('Ausleger: Teil-Stützen zählen dreifach', Math.abs(s.score - (3 * 600 + 0.5 * 30)) < 1, s.score);

// 4) Würfel: schon optimal → kein Vorschlag
const cube = flat(boxTris(0, 0, 0, 20, 20, 20));
e = K.evaluateOrientations(cube, K.IDENTITY3, 45);
check('Würfel: kein Vorschlag', e.suggestion === null && e.current.onBed === 0, JSON.stringify(e.current));

// 5) Liegender Stab ist besser als stehender (gleiche Stützen, flacher) – aber kein Vorschlag unter der Schwelle
const stab = flat(boxTris(0, 0, 0, 5, 5, 60));
e = K.evaluateOrientations(stab, K.IDENTITY3, 45);
check('Stab stehend: bestes Ergebnis liegt', r1(e.best.height) === 5, e.best.height);
check('Stab 5×5×60 stehend (Kippgefahr): Vorschlag hinlegen', !!e.suggestion && r1(e.suggestion.height) === 5, e.suggestion && e.suggestion.height);

// 6) Bereits gedrehtes Teil: aktuelle Lage wird mit R0 bewertet
const pilzKopf = K.rotateAxis('x', 180);
e = K.evaluateOrientations(pilz, pilzKopf, 45);
check('Pilz kopfüber (R0): aktuelle Lage ohne Stützen, kein Vorschlag', e.current.onBed + e.current.onPart < 1 && e.suggestion === null, JSON.stringify(e.current));

// 7) Laufzeit mit vielen Dreiecken
const many = [];
for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) many.push(...boxTris(i * 3, j * 3, 0, i * 3 + 2, j * 3 + 2, 2 + ((i * j) % 7)));
const big = flat(many), t0 = Date.now();
K.evaluateOrientations(big, K.IDENTITY3, 45);
const ms = Date.now() - t0;
check('Laufzeit ' + (big.length / 9) + ' Dreiecke < 3 s', ms < 3000, ms + ' ms');
console.log('Laufzeit ' + (big.length / 9) + ' Dreiecke: ' + ms + ' ms');

console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
