'use strict';
/* Prüft js/plates.js (geänderte Platten, Filamentbedarf, Reihenfolge, Warteschlange) und die Plattenzuordnung
   je Teil in js/export3mf.js (arrangeByPlate). Aufruf: node tests/plates.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, TextDecoder, Date });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'brim-ears', 'nest', 'export3mf', 'plates'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({placeTransform, footprint, changedPlates, plateNeeds, orderPlates, queueTick, queueNext, queueRemaining, arrangeParts, arrangeByPlate, exportTemplate, buildVolume, volumeExcess, patchModifierExtruders})', ctx);
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
// Platzsparend packen (freie Rechtecke) und Drehen um 90°, nur wenn es eine Platte spart
const bars = K.arrangeParts([g('a', 55, 230), g('b', 55, 230), g('c', 55, 230), g('d', 230, 55)], tpl);
check('4 Leisten auf einer Platte, die liegende gedreht', bars.plateCount === 1 && bars.places[3].rot && !bars.places[0].rot, bars.places);
check('gedrehte Grundfläche', JSON.stringify(K.footprint({ x: 230, y: 55 }, bars.places[3])) === '[55,230]');
check('3MF-Transformation gedreht', K.placeTransform({ x: 10, y: 20, rot: true }, '5') === '0 1 0 -1 0 0 0 0 1 10 20 5' && K.placeTransform({ x: 10, y: 20 }, '5').startsWith('1 0 0 0 1 0'));
const tall = K.arrangeParts([g('t', 100, 230), ...Array.from({ length: 6 }, (_, k) => g('s' + k, 60, 60))], tpl);
check('hohes Teil + 6 Kleinteile auf einer Platte (Zeilenverfahren: 2)', tall.plateCount === 1, tall.plateCount);
const none = K.arrangeParts(Array.from({ length: 8 }, (_, k) => g('l' + k, 110, 50)), tpl);
check('ohne Not nichts gedreht', none.plateCount === 1 && none.places.every(p => !p.rot));
// keine Überlappung, alles im Bett
const [bw0, bd0] = [250, 250], within = r => r.places.every((p, i) => { const [w, d] = K.footprint(r.geoms[i], p); return p.lx - w / 2 >= -0.01 && p.ly - d / 2 >= -0.01 && p.lx + w / 2 <= bw0 + 0.01 && p.ly + d / 2 <= bd0 + 0.01; });
const overlap = r => r.places.some((p, i) => r.places.some((q, j) => { if (j <= i || p.plate !== q.plate) return false; const [w1, d1] = K.footprint(r.geoms[i], p), [w2, d2] = K.footprint(r.geoms[j], q);
  return Math.abs(p.lx - q.lx) < (w1 + w2) / 2 - 0.01 && Math.abs(p.ly - q.ly) < (d1 + d2) / 2 - 0.01; }));
for (const [name, geoms] of [['Leisten', [g('a', 55, 230), g('b', 55, 230), g('c', 55, 230), g('d', 230, 55)]], ['hoch + klein', [g('t', 100, 230), ...Array.from({ length: 6 }, (_, k) => g('s' + k, 60, 60))]],
  ['gemischt', [g('a', 140, 90), g('b', 90, 140), g('c', 70, 70), g('d', 50, 120), g('e', 120, 40), g('f', 40, 40), g('h', 40, 40), g('i', 80, 30), g('j', 30, 80), g('k', 60, 60)]]]) {
  const r = Object.assign(K.arrangeParts(geoms, tpl), { geoms });
  check(name + ': im Bett und ohne Überlappung', within(r) && !overlap(r), r.places);
}
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

// Zwischenspeicher der Platzierung (js/plates-ui.js projectLayout): gleiches Ergebnis, bei Änderungen neu gerechnet
ctx.document = { getElementById: () => ({ addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} } }) };
vm.runInContext('var lastResult = null; var project = null;', ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'plates-ui.js'), 'utf8'), ctx, { filename: 'plates-ui.js' });
ctx.tplT = tpl;
const L = code => vm.runInContext(code, ctx);
L("project = { parts: Array.from({ length: 50 }, (_, k) => ({ name: 'p' + k, geom: k < 30 ? { name: 'a', x: 40, y: 40, z: 10 } : { name: 'b', x: 50, y: 30, z: 4 } })) }; globalThis.arrCalls = 0; " +
  "const arrOrig = arrangeParts; arrangeParts = function (...a) { arrCalls++; return arrOrig.apply(this, a); };");
const l1 = L('projectLayout(tplT)'), l2 = L('projectLayout(tplT)');
check('Zwischenspeicher: zweiter Aufruf ohne neues Packen', l1 === l2 && L('arrCalls') === 1, L('arrCalls'));
check('Zwischenspeicher: gleiches Ergebnis wie direkt gepackt', JSON.stringify(l1.places) === JSON.stringify(K.arrangeParts(L('project.parts.map(p => p.geom)'), tpl).places));
L("project.parts[0].geom = { name: 'a', x: 40, y: 10, z: 40 }");   // gedreht: neue Geometrie
check('Drehen → neu gepackt', L('projectLayout(tplT)') !== l1 && L('arrCalls') === 2);
L('project.parts.splice(49, 1)');
check('Löschen → neu gepackt', L('projectLayout(tplT).plateOf.length') === 49 && L('arrCalls') === 3);
L('project.parts.push({ ...project.parts[0], name: "k" })');
check('Kopie → neu gepackt', L('projectLayout(tplT).plateOf.length') === 50 && L('arrCalls') === 4);
L('project.platesFixed = true; project.parts.forEach((p, i) => { p.plate = i < 25 ? 1 : 2; })');
const f1 = L('projectLayout(tplT)');
L('project.parts[0].plate = 3');
const f2 = L('projectLayout(tplT)');
check('Verschieben → neue Zuordnung', f1 !== f2 && f2.count === 3 && f2.plateOf[0] === 3, f2.count);
L("project = { parts: project.parts.slice(0, 3) }");
check('anderes Projekt → neu gepackt', L('projectLayout(tplT).plateOf.length') === 3);

console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
