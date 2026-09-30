'use strict';
/* Prüft js/paint.js (Bemalung je Dreieck, Bambu/Orca paint_color) und das Einlesen in js/import.js:
   Filament je Code lesen, überwiegende Farbe geteilter Dreiecke, Umschreiben auf andere Filamente ohne die Unterteilung
   zu ändern, und eine kleine bemalte 3MF (Filament je Dreieck, vorkommende Filamente).
   Die Codes stammen aus einem echten Makerworld-Modell (Mario, 7 Farben). Aufruf: node tests/paint.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const fflate = require('../vendor/fflate.min.js');
const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'stl', 'store', 'paint', 'import']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const P = vm.runInContext('({ paintNodes, paintMain, paintStates, paintRemap, importModels })', ctx);

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; console.log('FEHL ' + name + (detail !== undefined ? ': ' + JSON.stringify(detail) : '')); } };

// 1) einfache Codes: eine Ziffer (Filament 1–2), „erweitert“ mit zweiter Ziffer (+3)
const single = { '4': 1, '8': 2, '0C': 3, '1C': 4, '2C': 5, '3C': 6, '4C': 7 };
for (const [code, st] of Object.entries(single)) {
  check('Code ' + code + ' = Filament ' + st, P.paintMain(code) === st && JSON.stringify(P.paintStates(code)) === JSON.stringify([st]), [P.paintMain(code), P.paintStates(code)]);
}
check('leerer Code = unbemalt', P.paintMain('') === 0);

// 2) geteilte Dreiecke: alle Blätter, überwiegende Farbe, unverändert zurückschreiben
const split = ['1C88838883', '880C83', '82C2C2C32C2C2C3', '80C883', '0C000300030003', '0C8828883888388838883',
  '0C0C0C8A80C0C868380C0C860C0C0C38880C0CA8330C0C3', '88882C883883883883', '882C8838832C82C2C82C32C2C82C382C8883332C2C88832C2C82C33', '1C1C1C81C11C1C31C3'];
for (const c of split) {
  let ok = true; try { P.paintNodes(c); } catch (e) { ok = false; }
  check('geteilt lesbar: ' + c, ok);
  check('unverändert zurückgeschrieben: ' + c, P.paintRemap(c, x => x) === c, P.paintRemap(c, x => x));
  const m = P.paintMain(c);
  check('überwiegende Farbe kommt im Code vor: ' + c, P.paintStates(c).includes(m), [m, P.paintStates(c)]);
}
check('1C88838883 enthält Filament 2 und 4', JSON.stringify(P.paintStates('1C88838883').sort()) === '[2,4]', P.paintStates('1C88838883'));

// 3) Umschreiben: Länge des Codes ändert sich, wenn ein Filament die „erweiterte“ Schreibweise braucht oder verliert
check('5 → 2: 2C wird 8', P.paintRemap('2C', x => x === 5 ? 2 : x) === '8');
check('2 → 5: 8 wird 2C', P.paintRemap('8', x => x === 2 ? 5 : x) === '2C');
check('4 → 7 im geteilten Dreieck, Unterteilung bleibt', P.paintRemap('1C88838883', x => x === 4 ? 7 : x) === '4C88838883');
{ const r = P.paintRemap('82C2C2C32C2C2C3', x => x === 5 ? 1 : x);
  check('5 → 1 im geteilten Dreieck: nur noch 1 und 2', JSON.stringify(P.paintStates(r).sort()) === '[1,2]' && P.paintNodes(r).length === P.paintNodes('82C2C2C32C2C2C3').length, [r, P.paintStates(r)]); }
check('unbemalte Teilstücke (0) bleiben unbemalt', P.paintStates(P.paintRemap('0C000300030003', x => 1)).includes(0));
{ let threw = false; try { P.paintNodes('3'); } catch (e) { threw = true; }
  check('kaputter Code wird erkannt (geteilt, aber ohne Kinder)', threw && P.paintMain('3') === 0); }

// 4) Einlesen: kleine 3MF, drei Dreiecke – Filament 2, Filament 5, unbemalt
{
  const v = '<vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="10" y="10" z="0"/><vertex x="0" y="0" z="5"/>';
  const tris = '<triangle v1="0" v2="1" v3="2" paint_color="8"/><triangle v1="1" v2="3" v3="2" paint_color="2C"/><triangle v1="0" v2="1" v3="4"/>';
  const model = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>' +
    '<object id="1" type="model"><mesh><vertices>' + v + '</vertices><triangles>' + tris + '</triangles></mesh></object></resources><build><item objectid="1"/></build></model>';
  const zip = fflate.zipSync({ '3D/3dmodel.model': fflate.strToU8(model), '_rels/.rels': fflate.strToU8('<Relationships><Relationship Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') });
  const imp = P.importModels([{ name: 'bemalt.3mf', bytes: zip }], fflate), p = imp.parts[0];
  check('3MF: Filament je Dreieck', p && p.paintState && Array.from(p.paintState).join() === '2,5,0', p && p.paintState && Array.from(p.paintState));
  check('3MF: vorkommende Filamente 2 und 5', p && JSON.stringify(p.paintSlots) === '[2,5]', p && p.paintSlots);
  check('3MF: als bemalt erkannt', p && p.painted && p.paintTris);
}

console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exitCode = fail ? 1 : 0;
