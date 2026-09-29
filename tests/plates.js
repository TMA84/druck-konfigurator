'use strict';
/* Prüft js/plates.js (geänderte Platten, Filamentbedarf, Reihenfolge, Warteschlange) und die Plattenzuordnung
   je Teil in js/export3mf.js (arrangeByPlate). Aufruf: node tests/plates.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, TextDecoder, Date });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'export3mf', 'plates'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({changedPlates, plateNeeds, orderPlates, queueTick, queueNext, queueRemaining, arrangeParts, arrangeByPlate, exportTemplate, buildVolume, volumeExcess, patchModifierExtruders})', ctx);
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) pass++; else { fail++; console.log('FEHLER ' + n + (d !== undefined ? ': ' + JSON.stringify(d) : '')); } };

// Geänderte Platten
check('gleich → keine', JSON.stringify(K.changedPlates({ global: 'a', plates: ['x', 'y'] }, { global: 'a', plates: ['x', 'y'] })) === '[]');
check('Platte 2 geändert', JSON.stringify(K.changedPlates({ global: 'a', plates: ['x', 'y', 'z'] }, { global: 'a', plates: ['x', 'Y', 'z'] })) === '[2]');
check('global anders → alles', K.changedPlates({ global: 'a', plates: ['x'] }, { global: 'b', plates: ['x'] }) === null);
check('andere Plattenzahl → alles', K.changedPlates({ global: 'a', plates: ['x'] }, { global: 'a', plates: ['x', 'y'] }) === null);
check('kein früherer Stand → alles', K.changedPlates(null, { global: 'a', plates: ['x'] }) === null);

// Bedarf und Reihenfolge
const match = (type, kind) => String(type).toLowerCase().startsWith(kind);
const mats = { 0: { kind: 'pla', name: 'PLA' }, 1: { kind: 'petg', name: 'PETG' }, 2: { kind: 'pla', name: 'PLA' } };
const ace = [{ present: true, type: 'PLA' }, { present: true, type: 'PLA' }, { present: true, type: 'PLA' }, { present: false }];
const plates = [{ plate: 1, grams: [5, 3, 0, 0] }, { plate: 2, grams: [4, 0, 2, 0] }, { plate: 3, grams: [0, 6, 0, 0] }, { plate: 4, grams: [9, 0, 0, 0] }];
const n1 = K.plateNeeds(plates[0], mats, ace, match);
check('Platte 1 nutzt Slot 1 und 2', JSON.stringify(n1.tools) === '[0,1]');
check('Platte 1: Slot 2 braucht PETG', n1.missing.length === 1 && n1.missing[0].slot === 1 && n1.missing[0].want === 'PETG' && n1.missing[0].have === 'PLA', n1.missing);
check('ohne ACE-Stand keine Warnung', K.plateNeeds(plates[0], mats, null, match).missing.length === 0);
const o = K.orderPlates(plates, mats, ace, match);
check('passende Platten zuerst, PETG-Platten danach', o.list.map(n => n.plate).join() === '2,4,1,3', o.list.map(n => n.plate));
check('ein Spulentausch', o.swaps === 1 && o.changed);
check('alles passt → Reihenfolge bleibt', !K.orderPlates(plates, mats, [{ present: true, type: 'PLA' }, { present: true, type: 'PETG' }, { present: true, type: 'PLA' }], match).changed);
const empty = K.plateNeeds({ plate: 1, grams: [0, 0, 0, 7] }, {}, ace, match);
check('leerer Slot fehlt', empty.missing.length === 1 && empty.missing[0].have === '');

// Warteschlange
const q = { items: [{ plate: 2, time_s: 3600, state: 'printing', started: Date.now() }, { plate: 1, time_s: 1800, state: 'wait' }] };
check('kurz nach dem Start: noch nicht fertig', K.queueTick(q, { printing: false }) === null && q.items[0].state === 'printing');
check('druckt → gesehen', K.queueTick(q, { printing: true, job: { status: 'druckt', remaining_min: 30 } }) === null && q.items[0].seen);
check('Restzeit: laufend + wartend', K.queueRemaining(q, { printing: true, job: { remaining_min: 30 } }) === 1800 + 1800);
const done = K.queueTick(q, { printing: false, job: null });
check('fertig erkannt', done && done.plate === 2 && q.items[0].state === 'done');
check('nächste Platte', K.queueNext(q).plate === 1);
q.items[1].state = 'printing'; q.items[1].seen = true;
check('abgebrochen → wieder wartend', K.queueTick(q, { printing: true, job: { status: 'abgebrochen' } }).aborted && q.items[1].state === 'wait');

// Plattenzuordnung je Teil
const tpl = K.exportTemplate('kobra_s1', '0.4');
const g = (name, x, y) => ({ name, x, y, z: 10 });
const parts = [{ geom: g('a', 50, 50), plate: 2 }, { geom: g('b', 50, 50), plate: 1 }, { geom: g('c', 50, 50), plate: 2 }];
const r = K.arrangeByPlate(parts, tpl);
check('zwei Platten nach Zuordnung', r.plateCount === 2 && r.places[1].plate === 0 && r.places[0].plate === 1 && r.places[2].plate === 1, r.places);
check('Lücke in der Nummerierung fällt weg', K.arrangeByPlate([{ geom: g('a', 50, 50), plate: 3 }], tpl).plateCount === 1);
const big = K.arrangeByPlate([{ geom: g('a', 200, 200), plate: 1 }, { geom: g('b', 200, 200), plate: 1 }], tpl);
check('zu voll → zusätzliche Platte', big.plateCount === 2 && big.overflow);
check('automatisch: alles auf eine Platte', K.arrangeParts(parts.map(p => p.geom), tpl).plateCount === 1);

// Bauraum
const vol = K.buildVolume(tpl);
check('Bauraum Kobra S1 250 × 250 × 250', vol.join() === '250,250,250', vol);
check('zu hoch erkannt', K.volumeExcess({ x: 40, y: 40, z: 280 }, vol).length === 1 && K.volumeExcess({ x: 40, y: 40, z: 250 }, vol).length === 0);
check('zu hohes Teil gilt als zu groß', K.arrangeParts([g('a', 40, 40), { name: 'b', x: 40, y: 40, z: 280 }], tpl).oversize.join() === '1');

// Farb-Modifikator des Designers auf einen anderen Slot legen
const ms = '<config>\n  <object id="10">\n    <metadata key="extruder" value="1"/>\n    <part id="4" subtype="normal_part">\n      <metadata key="name" value="x"/>\n    </part>\n    <part id="5" subtype="modifier_part">\n      <metadata key="name" value="text_shape"/>\n      <metadata key="extruder" value="2"/>\n    </part>\n  </object>\n  <object id="11">\n    <part id="6" subtype="modifier_part">\n      <metadata key="extruder" value="2"/>\n    </part>\n  </object>\n</config>';
const out = K.patchModifierExtruders(ms, '10', { 1: 3 }, 4);
check('Modifikator Farbe 2 → Slot 4', /<part id="5"[\s\S]*?extruder" value="4"/.test(out), out);
check('Objekt-Slot unverändert', /<object id="10">\n    <metadata key="extruder" value="1"/.test(out));
check('anderes Objekt unverändert', /<part id="6"[\s\S]*?extruder" value="2"/.test(out));
check('ohne Zuordnung unverändert', K.patchModifierExtruders(ms, '10', {}, 4) === ms);

console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
