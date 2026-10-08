'use strict';
// Höchstwerte je Drucker (js/data.js printerLimits): Orca-Maschinenprofil. Aufruf: node tests/printer-limits.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console });
for (const f of ['util', 'data', 'orca-templates']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({machineLimits, printerLimits, PRINTERS})', ctx);
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) pass++; else { fail++; console.log('FEHLER ' + n + (d !== undefined ? ': ' + JSON.stringify(d) : '')); } };
const s1 = K.printerLimits(K.PRINTERS.kobra_s1);
check('Kobra S1: 600 mm/s, 20 000 mm/s² (Orca-Profil)', s1.speed === 600 && s1.accel === 20000, s1);
const u1 = K.printerLimits(K.PRINTERS.snapmaker_u1);
check('Snapmaker U1: normaler Modus (500, nicht leise 200)', u1.speed === 500, u1);
check('kleinere Achse zählt', K.machineLimits({ machine_max_speed_x: ['500'], machine_max_speed_y: ['300'] }).speed === 300);
check('Beschleunigung beim Drucken vor Achse', K.machineLimits({ machine_max_acceleration_x: ['10000'], machine_max_acceleration_extruding: ['5000'] }).accel === 5000);
check('ohne Angabe: kein Maximum', K.machineLimits({}).speed === null && K.machineLimits(null).accel === null);
const orca = { id: 'orca', label: 'X', orca: { name: 'Foo 0.4 nozzle', machine: { machine_max_speed_x: ['250'], machine_max_speed_y: ['250'], machine_max_acceleration_extruding: ['3000'] } } };
check('Orca-Drucker aus machine', K.printerLimits(orca).speed === 250 && K.printerLimits(orca).accel === 3000);
console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
