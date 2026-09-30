'use strict';
/* Filamente der Hersteller (js/filaments.js): vollständig und stimmig – eindeutige Ids, Marke, Quelle, Produktseite,
   Temperaturen im genannten Bereich, gültige Farbcodes, Faser-Filamente als schleifend markiert; der Rechenkern liefert
   für jedes Profil Werte. Aufruf: node tests/filaments.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'filaments', 'stl', 'store', 'engine'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({ BUILTIN, VENDOR_FILAMENTS, compute, getMat, store, makeGeom })', ctx);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; console.log('FEHL ' + name + (detail !== undefined ? ': ' + JSON.stringify(detail) : '')); } };

const V = K.VENDOR_FILAMENTS, ids = K.BUILTIN.map(b => b.id);
check('Ids eindeutig', new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i));
check('Anycubic und SUNLU vorhanden', V.filter(v => v.brand === 'Anycubic').length >= 15 && V.filter(v => v.brand === 'SUNLU').length >= 18);
const geom = K.makeGeom('w.stl', Float32Array.from([0, 0, 0, 20, 0, 0, 0, 20, 0, 0, 0, 0, 0, 20, 0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 20, 0, 0, 0, 0, 10]));
for (const m of V.concat(K.BUILTIN.filter(b => b.id === 'pla_hs'))) {
  const n = m.name;
  check(n + ': Marke, Quelle, Produktseite', !!m.brand && m.src.length > 20 && /^https:\/\/store\.(anycubic|sunlu)\.com\/products\//.test(m.url));
  const r = (String(m.range).match(/\d{3}/g) || []).map(Number);
  check(n + ': Düse [Q,A,S] steigt und liegt im Bereich ' + m.range, m.nozzle.length === 3 && m.nozzle[0] <= m.nozzle[1] && m.nozzle[1] <= m.nozzle[2] && r.length === 2 && m.nozzle[0] >= r[0] && m.nozzle[2] <= r[1], m.nozzle);
  check(n + ': Bett, Volumenstrom, Fluss plausibel', m.bed >= 35 && m.bed <= 110 && m.maxVol > 0 && m.maxVol <= 30 && m.flow >= 0.9 && m.flow <= 1.05);
  check(n + ': Geschwindigkeiten aus dem Bezugsprofil', [m.outer, m.inner, m.fill].every(a => Array.isArray(a) && a.length === 3) && m.first > 0);
  check(n + ': Farben mit gültigem Code', Array.isArray(m.colours) && m.colours.length > 0 && m.colours.every(c => typeof c[0] === 'string' && /^#[0-9A-F]{6}$/.test(c[1])), (m.colours || []).find(c => !/^#[0-9A-F]{6}$/.test(c[1])));
  check(n + ': Faser-Filament schleifend', !/CF/.test(n) || m.abrasive === true);
  if (m.brand === 'SUNLU') check(n + ': SUNLU-Farben als ungefähr markiert (SUNLU nennt keine Codes)', m.colours.every(c => c[2] === 1));
  const res = K.compute({ printer: 'kobra_s1', material: m.id, nozD: '0.4', nozM: 'steel_hardened', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' }, geom, { getMat: K.getMat, settings: K.store.settings });
  check(n + ': Rechenkern liefert Werte (Status Herstellerwerte)', res.m.id === m.id && res.nozzle >= m.nozzle[0] - 5 && (m.id === 'pla_hs' || res.effectiveStatus === 'vendor'), [res.nozzle, res.effectiveStatus]);
}
// Anycubic nennt zu fast allen Farben einen Code (ohne: z. B. PLA Glow, Clear) – mindestens 85 % offiziell
{ const all = V.filter(v => v.brand === 'Anycubic').flatMap(v => v.colours), official = all.filter(c => !c[2]).length;
  check('Anycubic: ' + official + ' von ' + all.length + ' Farben mit Code vom Hersteller', official >= all.length * 0.85); }
// Stichproben der Herstellerangaben
const g = id => K.BUILTIN.find(b => b.id === id);
check('Anycubic PETG: 250 °C, Bett 70 °C (Kobra-S1-Profil)', g('ac_petg').nozzle[1] === 250 && g('ac_petg').bed === 70);
check('Anycubic PLA Basic: Weiß #EFF0F1', g('ac_pla').colours.some(c => c[0] === 'White' && c[1] === '#EFF0F1'));
check('SUNLU PLA+ 2.0: max. 22 mm³/s (SUNLU-Profil)', g('sl_pla_plus2').maxVol === 22);
check('SUNLU ASA: Bett 100 °C (90–110 °C)', g('sl_asa').bed === 100);
console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exitCode = fail ? 1 : 0;
