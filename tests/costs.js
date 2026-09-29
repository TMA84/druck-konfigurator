'use strict';
/* Prüft die Kostenkalkulation (js/costs.js) mit einem Slice-Ergebnis wie aus tests/slice.py. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'costs.js'), 'utf8'), ctx, { filename: 'costs.js' });
const K = vm.runInContext('({computeCosts, COST_DEFAULTS})', ctx);
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) pass++; else { fail++; console.log('FEHLER ' + n + (d !== undefined ? ': ' + JSON.stringify(d) : '')); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// Pilz: Slot 1 7,88 g PLA zu 20 €/kg, Slot 3 5,30 g PETG zu 30 €/kg, 1 h, 1 Wechsel
const slice = { total: { grams: [7.88, 0, 5.3, 0], time_s: 3600, changes: 1 } };
const slots = [{ name: 'PLA', pricePerKg: 20 }, {}, { name: 'PETG', pricePerKg: 30 }, {}];
const cfg = { powerW: 150, kwhPrice: 0.4, wearPerHour: 0.5, markupPct: 10, vatPct: 19 };
const r = K.computeCosts(slice, slots, { gramsPerChange: 0.775 }, cfg);
const by = k => r.lines.filter(l => l.key === k);
check('zwei Filament-Posten', by('filament').length === 2 && near(by('filament')[0].eur, 0.1576) && near(by('filament')[1].eur, 0.159), by('filament'));
const mean = (0.1576 + 0.159) / 13.18 * 1000;
check('Spülabfall zum mittleren Preis', near(by('purge')[0].grams, 0.775) && near(by('purge')[0].pricePerKg, mean) && near(by('purge')[0].eur, 0.775 / 1000 * mean), by('purge'));
check('Strom 0,15 kWh × 0,40 €', near(by('power')[0].kwh, 0.15) && near(by('power')[0].eur, 0.06));
check('Verschleiß 1 h × 0,50 €', near(by('wear')[0].eur, 0.5));
const sub = 0.1576 + 0.159 + 0.775 / 1000 * mean + 0.06 + 0.5;
check('Summe, Aufschlag, MwSt', near(r.subtotal, sub) && near(r.markup, sub * 0.1) && near(r.vat, sub * 1.1 * 0.19) && near(r.total, sub * 1.1 * 1.19), r);
check('Standardpreis für Slot ohne Preis', near(K.computeCosts({ total: { grams: [10], time_s: 0, changes: 0 } }, [], null, {}).lines[0].eur, 10 / 1000 * K.COST_DEFAULTS.pricePerKg));
check('ohne Spülabfall-Angabe kein Spülposten', !K.computeCosts(slice, slots, null, cfg).lines.some(l => l.key === 'purge'));
check('Strom/Verschleiß 0 → kein Posten', K.computeCosts(slice, slots, null, { powerW: 0, wearPerHour: 0 }).lines.every(l => l.key === 'filament'));
console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
