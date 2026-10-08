'use strict';
/* Prüft Anpassungen je Auftrag (I.overrides in compute): Datenblatt zeigt den neuen Wert mit Vorschlag,
   die 3MF-Werte (plannedChanges) übernehmen ihn; ohne Anpassung bleibt alles wie vorher. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'brim-ears', 'export3mf'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({compute, getMat, store, plannedChanges, supportChanges, orcaInfillPattern})', ctx);
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) pass++; else { fail++; console.log('FEHLER ' + n + (d !== undefined ? ': ' + JSON.stringify(d) : '')); } };
const I = { printer: 'kobra_s1', material: 'pla_hs', nozD: '0.4', nozM: 'steel_hardened', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
const c = { getMat: K.getMat, settings: K.store.settings };
const plain = K.compute(I, null, c);
const r = K.compute({ ...I, overrides: { nozzle: 225, bed: 65, layer: 0.28, w: 5, inf: 40, pattern: 'Kubisch', sp_outer: 150, fan: 60, support: 'on', brim: '8 mm' } }, null, c);
const val = (rr, k) => (K.plannedChanges(rr, 0, null).find(x => x.key === k) || {}).value;
check('Düse 225 in der 3MF', val(r, 'nozzle_temperature') === '225');
check('Bett 65 in der 3MF', val(r, 'hot_plate_temp') === '65');
check('Schichthöhe 0,28', val(r, 'layer_height') === '0.28');
check('5 Wände, 40 %, kubisch', val(r, 'wall_loops') === '5' && val(r, 'sparse_infill_density') === '40%' && val(r, 'sparse_infill_pattern') === 'cubic');
check('Außenwand 150 mm/s, Lüfter 60 %', val(r, 'outer_wall_speed') === '150' && val(r, 'fan_max_speed') === '60');
check('Stützen an, Brim 8 mm', val(r, 'enable_support') === '1' && val(r, 'brim_width') === '8' && val(r, 'brim_type') === 'outer_only');
const row = n => r.rows.find(x => x[0] === n) || [];
check('Datenblatt markiert Düse mit Vorschlag', row('Düse')[1] === '225 °C' && row('Düse')[3] === true && /Vorschlag \d+ °C/.test(row('Düse')[2]), row('Düse'));
check('changed enthält die Abweichungen', ['nozzle', 'bed', 'layer', 'w', 'inf', 'pattern', 'sp_outer', 'fan', 'support', 'brim'].every(k => r.changed.includes(k)), r.changed);
check('Vorschlag bleibt erhalten', r.suggested.nozzle === plain.nozzle && r.suggested.layer === plain.layer && r.suggested.w === plain.w, r.suggested);
check('ohne Anpassung keine Markierung', plain.rows.every(x => x[3] !== true) && plain.changed.length === 0);
check('gleicher Wert wie Vorschlag zählt nicht als Abweichung', K.compute({ ...I, overrides: { nozzle: plain.nozzle } }, null, c).changed.length === 0);
const off = K.compute({ ...I, object: 'overhang', overrides: { support: 'off' } }, null, c);
check('Stützen aus trotz Freiform', val(off, 'enable_support') === '0' && off.sup.startsWith('Aus'), off.sup);
check('Nur kritische Bereiche: Vorschlag aus (sonst keine Stützen an schrägen Überhängen)', val(r, 'support_critical_regions_only') === '0' && r.supCritical === false, val(r, 'support_critical_regions_only'));
const crit = K.compute({ ...I, overrides: { support: 'on', critical: 'on' } }, null, c);
check('Nur kritische Bereiche je Auftrag an', val(crit, 'support_critical_regions_only') === '1' && crit.changed.includes('critical'), crit.changed);
check('Füllmuster-Zuordnung', K.orcaInfillPattern('Waben') === 'honeycomb' && K.orcaInfillPattern('Gyroid oder Kubisch') === 'gyroid' && K.orcaInfillPattern('Blitz') === 'lightning');
console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
