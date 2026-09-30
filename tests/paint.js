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
const P = vm.runInContext(`({ paintNodes, paintMain, paintStates, paintRemap, importModels, paintTree, paintCode, paintKids, paintLeaves, paintApply, paintTreeMain,
  paintBrushSphere, paintBrushCircle, paintBrushHeight, paintAdjacency, paintCollect, paintFill, paintSlotCode, paintExportFn, paintGaps, paintAttrsFn, paintHasEnforcers })`, ctx);

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

// 5) Baum lesen/schreiben: alle Codes von oben unverändert, Kinder in Orca-Reihenfolge (rückwärts im Code)
for (const c of split.concat(Object.keys(single))) check('Baum hin und zurück: ' + c, P.paintCode(P.paintTree(c)) === c, P.paintCode(P.paintTree(c)));
{ const tr = P.paintTree('00083');   // 3 Seiten, zuerst gelesenes Kind = c[3] (Mitte) bemalt
  check('zuerst gelesenes Kind ist c[3]', tr.split === 3 && tr.c[3].s === 2 && tr.c[0].s === 0, tr); }

// 6) Lage der Teilstücke (gemessen mit der Orca-CLI, siehe js/paint.js): Mittelpunkte der Kinder im Dreieck (0,0) (60,0) (60,60)
{ const A = [0, 0, 0], B = [60, 0, 0], C = [60, 60, 0], mid = t => [0, 1].map(k => +((t[0][k] + t[1][k] + t[2][k]) / 3).toFixed(1));
  const want = { '3/0': [[20, 10], [50, 10], [50, 40], [40, 20]], '1/0': [[40, 10], [40, 30]], '1/1': [[50, 30], [30, 10]], '1/2': [[30, 20], [50, 20]],
    '2/0': [[20, 10], [40, 10], [50, 30]], '2/1': [[50, 10], [50, 30], [30, 20]], '2/2': [[50, 40], [30, 20], [40, 10]] };
  for (const [k, w] of Object.entries(want)) { const [sp, sd] = k.split('/').map(Number), got = P.paintKids(A, B, C, sp, sd).map(mid);
    check('Kinder bei ' + sp + ' Seiten, Seite ' + sd, JSON.stringify(got) === JSON.stringify(w), got); } }

// 7) Pinsel: Kugel um die Mitte eines großen Dreiecks teilt am Rand, innen Filament 2, Fläche passt zum Kreis
{ const A = [0, 0, 0], B = [60, 0, 0], C = [60, 60, 0], br = P.paintBrushSphere([40, 20, 0], [40, 20, 0], 8);
  const tr = P.paintApply({ s: 0 }, A, B, C, br, 2, 0.25);
  let area = 0, outside = 0;
  P.paintLeaves(tr, A, B, C, (a, b, c, s) => { if (s !== 2) return; const w = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2; area += w;
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; if (Math.hypot(m[0] - 40, m[1] - 20) > 8.3) outside++; });
  check('Kugel r = 8: Fläche ≈ π·64 (' + area.toFixed(0) + ' mm²)', Math.abs(area - Math.PI * 64) < 12, area);
  check('keine Teilstücke außerhalb', outside === 0, outside);
  check('Code bleibt lesbar und gleich', P.paintCode(P.paintTree(P.paintCode(tr))) === P.paintCode(tr));
  check('Überwiegend unbemalt', P.paintTreeMain(tr) === 0);
  const er = P.paintApply(tr, A, B, C, br, 0, 0.25);
  check('Radieren an derselben Stelle: wieder ein Blatt', !er.c && er.s === 0, P.paintCode(er));
  const all = P.paintApply({ s: 0 }, A, B, C, P.paintBrushSphere([30, 30, 0], [30, 30, 0], 100), 3, 0.25);
  check('ganz im Pinsel: ein Blatt, kein Teilen', !all.c && all.s === 3); }

// 8) Nachbarn, Füllen, Kreis nur auf zugewandten Flächen, Höhenbereich
{ const v = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 10], [20, 0, 10], [20, 20, 10], [0, 20, 10]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const pos = Float32Array.from(f.flatMap(t => t.flatMap(i => v[i]))), adj = P.paintAdjacency(pos);
  check('Würfel: jedes Dreieck hat 3 Nachbarn', Array.from({ length: 12 }, (_, t) => adj.start[t + 1] - adj.start[t]).every(n => n === 3));
  check('Füllen 30°: nur die Deckfläche (2 Dreiecke)', JSON.stringify(P.paintFill(pos, adj, 2, 30).sort((a, b) => a - b)) === '[2,3]');
  check('Füllen 90°: ganzer Würfel', P.paintFill(pos, adj, 2, 90).length === 12);
  const circ = P.paintBrushCircle([10, 10, 10], [10, 10, 10], 30, [0, 0, -1]), got = P.paintCollect(pos, adj, 2, circ).filter(t => { const o = t * 9; return circ.tri([pos[o], pos[o + 1], pos[o + 2]], [pos[o + 3], pos[o + 4], pos[o + 5]], [pos[o + 6], pos[o + 7], pos[o + 8]]); });
  check('Kreis von oben: Boden (Rückseite) bleibt frei', !got.includes(0) && !got.includes(1) && got.includes(2) && got.includes(3), got);
  const h = P.paintBrushHeight(4, 6), hc = P.paintCollect(pos, null, 0, h);
  check('Höhenbereich 4–6 mm: nur die Seiten (8 Dreiecke)', hc.length === 8 && hc.every(t => t >= 4), hc); }

// 9) Slot-Code eines Teils: eigene Bemalung vor der des Designers, Designer über designMap, Export auf nFil begrenzt
{ const part = { paintState: Uint8Array.from([2, 0, 5]), paintCodes: null, paintUser: { rev: 1, codes: { 1: '8' }, slots: [1] } };
  check('Designer-Farbe 2 → Slot 3 (designMap 1 → 2)', P.paintSlotCode(part, 0, { 1: 2 }) === '0C', P.paintSlotCode(part, 0, { 1: 2 }));
  check('eigene Bemalung gewinnt', P.paintSlotCode(part, 1, {}) === '8');
  const ex = P.paintExportFn(part, {}, 4);
  check('Export: Filament 5 bei 4 Slots → 4', ex(2) === '1C', ex(2));
  check('ohne Bemalung: kein Export', P.paintExportFn({}, {}, 4) === null); }

// 10) Lücken füllen: geschlossenes Loch wird gefüllt, offene Fläche zur unbemalten Umgebung nicht
{ const v = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 10], [20, 0, 10], [20, 20, 10], [0, 20, 10]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const pos = Float32Array.from(f.flatMap(t => t.flatMap(i => v[i]))), adj = P.paintAdjacency(pos);
  const tri = t => [0, 1, 2].map(k => Array.from(pos.slice(t * 9 + k * 3, t * 9 + k * 3 + 3))), [a, b, c] = tri(2);
  const trees = { 2: P.paintApply({ s: 2 }, a, b, c, P.paintBrushSphere([14, 6, 10], [14, 6, 10], 0.5), 0, 0.25), 3: { s: 2 } }, at = t => trees[t] || { s: 0 };
  let r = P.paintGaps(pos, adj, at, 2);
  check('Loch (≈0,8 mm²) bei Grenze 2 mm² gefüllt', r.size === 1 && P.paintCode(r.get(2)) === '8', [...r.keys()]);
  check('Loch bleibt bei Grenze 0,3 mm²', P.paintGaps(pos, adj, at, 0.3).size === 0);
  trees[2] = P.paintApply({ s: 0 }, a, b, c, P.paintBrushSphere([10, 10, 10], [10, 10, 10], 6), 2, 0.25);
  check('offene Fläche zur unbemalten Seite bleibt', P.paintGaps(pos, adj, at, 2).size === 0); }

// 11) Stützen und Naht im Export: eigene Attribute, Erzwingen erkannt
{ const part = { paintSup: { rev: 1, codes: { 0: '4', 1: '8' } }, paintSeam: { rev: 1, codes: { 2: '4' } }, supCodes: { 3: '8' } }, at = P.paintAttrsFn(part, {}, 4);
  check('Attribute: Stützen erzwingen', at(0) === ' paint_supports="4"', at(0));
  check('Attribute: Naht', at(2) === ' paint_seam="4"', at(2));
  check('Attribute: Stützen des Designers bleiben', at(3) === ' paint_supports="8"', at(3));
  check('Erzwingen erkannt', P.paintHasEnforcers(part) && !P.paintHasEnforcers({ paintSup: { codes: { 0: '8' } } })); }

console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exitCode = fail ? 1 : 0;
