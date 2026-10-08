'use strict';
/* Schreibt ein kleines Export-3MF auf stdout (Kobra S1, zweifarbiger Pilz: Stiel Slot 1, Hut Slot 3) – für tests/slice.py.
   Mit Argument „platten“: Pilz auf Platte 1, Würfel auf Platte 2 (Slicen einzelner Platten).
   Mit „kosten“: Kostenwerte wie aus den Preis-Einstellungen (time_cost 0,35 €/h, filament_cost je Slot).
   Mit „stuetzen“: umgedrehter Pyramidenstumpf (Überhang ≈ 53°, keine Auskragung) – das Tool empfiehlt Stützen;
   „stuetzen an“ / „stuetzen aus“: dazu „Nur kritische Bereiche“ je Auftrag ein- bzw. ausgeschaltet (Vorschlag: aus). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), fflate = require('../vendor/fflate.min.js');
const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'orient', 'holes', 'brim-ears', 'export3mf'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({compute,getMat,store,makeGeom,exportTemplate,build3mf})', ctx);
const box = (x0, y0, z0, x1, y1, z1) => { const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].flatMap(t => t.flatMap(i => v[i])); };
const geom = K.makeGeom('pilz.stl', Float32Array.from([...box(15, 15, 0, 25, 25, 20), ...box(0, 0, 20, 40, 40, 25)]));
const r = K.compute({ printer: 'kobra_s1', material: 'pla_hs', nozD: '0.4', nozM: 'steel_hardened', object: 'multicolor', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' }, geom, { getMat: K.getMat, settings: K.store.settings });
if (process.argv[2] === 'stuetzen') {
  const b = [[15, 15, 0], [25, 15, 0], [25, 25, 0], [15, 25, 0]], tp = [[0, 0, 20], [40, 0, 20], [40, 40, 20], [0, 40, 20]], v = [...b, ...tp];
  const faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6], [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4]];
  const g = K.makeGeom('trichter.stl', Float32Array.from(faces.flatMap(f => f.flatMap(i => v[i]))));
  const rs = K.compute({ printer: 'kobra_s1', material: 'pla_hs', nozD: '0.4', nozM: 'steel_hardened', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45', overrides: process.argv[3] === 'an' ? { critical: 'on' } : process.argv[3] === 'aus' ? { critical: 'off' } : null }, g, { getMat: K.getMat, settings: K.store.settings });
  if (!rs.supOn) throw Error('Trichter: Tool empfiehlt keine Stützen (' + rs.sup + ')');
  process.stdout.write(Buffer.from(K.build3mf(K.exportTemplate('kobra_s1', '0.4'), rs, [{ geom: g, r: rs }], 0, fflate).bytes));
  process.exit(0);
}
const parts = [{ geom, r, plate: 1, bodies: [{ name: 'Stiel', start: 0, count: 12, slot: null }, { name: 'Hut', start: 12, count: 12, slot: 2 }] }];
if (process.argv[2] === 'platten') parts.push({ geom: K.makeGeom('wuerfel.stl', Float32Array.from(box(0, 0, 0, 20, 20, 10))), r, plate: 2 });
else delete parts[0].plate;
const machine = process.argv[2] === 'kosten' ? [{ label: 'Maschine', key: 'time_cost', value: '0.35' },
  ...['25', '30', '27.5', '40'].map((value, index) => ({ label: 'Slot', key: 'filament_cost', index, value }))] : undefined;
const { bytes } = K.build3mf(K.exportTemplate('kobra_s1', '0.4'), r, parts, 0, fflate, undefined, machine);
process.stdout.write(Buffer.from(bytes));
