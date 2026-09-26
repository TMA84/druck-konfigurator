'use strict';
/* Prüft build3mfFromProject ohne Orca: Plattenverschiebung je Instanz, Slot/Objektwerte in
   model_settings, Hinweis bei fehlenden Objekt-Einstellungen. Die Orca-Prüfung mit einer echten
   Makerworld-Datei macht tests/verify-3mf.js (MW3MF=<Pfad>). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fflate = require('../vendor/fflate.min.js');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'export3mf', 'import'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({importModels, makeGeom, compute, getMat, store, exportTemplate, build3mfFromProject})', ctx);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log('FEHLER ' + name + (detail !== undefined ? ': ' + detail : '')); } }

const u8 = s => fflate.strToU8(s);
function cubeXml(id, s) {
  const b = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return '<object id="' + id + '" type="model"><mesh><vertices>' + b.map(v => '<vertex x="' + v[0] + '" y="' + v[1] + '" z="' + v[2] + '"/>').join('') +
    '</vertices><triangles>' + f.map(t => '<triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"/>').join('') + '</triangles></mesh></object>';
}
function project(items, settingsXml) {
  return fflate.zipSync({
    '_rels/.rels': u8('<Relationships><Relationship Target="/3D/3dmodel.model" Id="rel-1"/></Relationships>'),
    '3D/3dmodel.model': u8('<?xml version="1.0"?><model unit="millimeter" xmlns:p="x"><resources>' + cubeXml(1, 20) + cubeXml(2, 10) + '</resources><build>' + items + '</build></model>'),
    'Metadata/model_settings.config': u8(settingsXml),
    'Metadata/plate_1.gcode': u8('; alt')
  });
}
function run(zip, printer = 'kobra_s1') {
  const imp = K.importModels([{ name: 'p.3mf', bytes: zip }], fflate);
  const base = { printer, nozD: '0.4', nozM: 'steel_hardened', material: 'pla_hs', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
  const jobs = imp.parts.map(p => { const g = K.makeGeom(p.name, p.pos);
    return { geom: g, slot: p.extruder ? p.extruder - 1 : null, part: { objectId: p.objectId, instance: p.instance, plate: p.plate }, r: K.compute(base, g, { getMat: K.getMat, settings: K.store.settings }) }; });
  const res = K.build3mfFromProject(K.exportTemplate(printer, '0.4'), jobs[0].r, jobs, jobs[0].slot ?? 0, fflate, null, imp.threemf);
  const z = fflate.unzipSync(res.bytes);
  return { imp, res, z, root: fflate.strFromU8(z['3D/3dmodel.model']), ms: fflate.strFromU8(z['Metadata/model_settings.config']) };
}

// 1) Zwei Objekte auf zwei Platten → je Platte auf die S1-Bettmitte (125/125, Platte 2 um 300 mm versetzt)
let t = run(project('<item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 435.2 128 0"/>',
  '<?xml version="1.0"?><config><object id="1"><metadata key="name" value="Gross"/><metadata key="extruder" value="2"/><metadata key="enable_support" value="1"/><part id="1" subtype="normal_part"></part></object>' +
  '<object id="2"><metadata key="name" value="Klein"/><metadata key="extruder" value="1"/><part id="2" subtype="normal_part"></part></object>' +
  '<plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="0"/></model_instance></plate>' +
  '<plate><metadata key="plater_id" value="2"/><model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="0"/></model_instance></plate></config>'));
const items = t.root.match(/<item[^>]*>/g);
check('Platte 1 mittig (Würfel 20: Ursprung 115/115)', /1 0 0 0 1 0 0 0 1 115 115 0/.test(items[0]), items[0]);
check('Platte 2 mittig (Würfel 10: Ursprung 420/120)', /1 0 0 0 1 0 0 0 1 420 120 0/.test(items[1]), items[1]);
check('Slot des Designers bleibt, Stützen-Vorgabe ersetzt', /<object id="1">[\s\S]*?key="extruder" value="2"/.test(t.ms) && !/key="enable_support" value="1"/.test(t.ms));
check('alter G-Code entfernt', !t.z['Metadata/plate_1.gcode']);

// 2) Befund der Prüfung: dasselbe Objekt als zwei Instanzen auf zwei Platten → jede Instanz ihre eigene Verschiebung
t = run(project('<item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 100 0"/><item objectid="1" transform="1 0 0 0 1 0 0 0 1 400 100 0"/>',
  '<?xml version="1.0"?><config><object id="1"><metadata key="name" value="Schraube"/><metadata key="extruder" value="1"/><part id="1" subtype="normal_part"></part></object>' +
  '<plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="0"/></model_instance></plate>' +
  '<plate><metadata key="plater_id" value="2"/><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="1"/></model_instance></plate></config>'));
check('Instanzen: Platten erkannt', t.imp.parts.map(p => p.plate).join() === '1,2', t.imp.parts.map(p => p.plate).join());
const it2 = t.root.match(/<item[^>]*>/g);
check('Instanz 1 → Platte 1 mittig (115/115)', /1 0 0 0 1 0 0 0 1 115 115 0/.test(it2[0]), it2[0]);
check('Instanz 2 → Platte 2 mittig (415/115)', /1 0 0 0 1 0 0 0 1 415 115 0/.test(it2[1]), it2[1]);

// 3) Befund der Prüfung: Objekt fehlt in model_settings → Hinweis statt stillem Verlust
t = run(project('<item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/>', '<?xml version="1.0"?><config></config>'));
check('Fehlende Objekt-Einstellungen → Hinweis', t.res.notes.some(n => /keine Objekt-Einstellungen/.test(n)), t.res.notes.join('|'));

console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
