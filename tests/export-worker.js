'use strict';
/* 3MF im Hintergrund (js/export-worker.js): Der Worker lädt nur EXPORT_WORKER_SCRIPTS und bekommt die Teile als reine
   Daten (exportArgsPlain, per structuredClone wie postMessage). Geprüft wird, dass er dieselbe 3MF baut wie das Fenster
   (build3mfFor) – gleiche Dateien mit gleichem Inhalt, gleiche Hinweise: einfache Teile mit Kopie, Beschriftung und eigener
   Bemalung, Druck Objekt für Objekt, Makerworld-3MF mit Bemalung, Drehung, Größe und neu angeordnet. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const fflate = require('../vendor/fflate.min.js');
const ROOT = path.join(__dirname, '..');

// Fenster: Ladeliste wie index.html (ohne DOM-Dateien)
const M = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'orient', 'holes', 'font-hershey', 'engrave', 'paint', 'orca-extra', 'brim-ears', 'nest',
  'export3mf-settings', 'export3mf-mesh', 'export3mf-pack', 'export3mf-relayout', 'export3mf', 'import'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), M, { filename: f + '.js' });
const K = vm.runInContext(`({ importModels, makeGeom, compute, getMat, store, exportTemplate, build3mfFor, exportArgsPlain, partGeom, rotateAxis, topFace,
  anchorToOrig, setPrintSequence, setPackGap, IDENTITY3 })`, M);

// Worker: nur seine eigene Ladeliste (importScripts gibt es in Node nicht – die Datei lädt dann nichts)
const W = vm.createContext({ console, TextDecoder });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/export-worker.js'), 'utf8'), W, { filename: 'export-worker.js' });
const scripts = vm.runInContext('EXPORT_WORKER_SCRIPTS', W);
for (const f of scripts) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), W, { filename: f });
vm.runInContext('nestSync = true', W);
const WK = vm.runInContext('({ build3mfPlain, zip: typeof fflate !== "undefined" && typeof fflate.zipSync === "function" })', W);

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; console.log('FEHLER ' + name + (detail !== undefined ? ': ' + detail : '')); } };

const BASE = { printer: 'kobra_s1', nozD: '0.4', nozM: 'steel_hardened', material: 'pla_hs', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
const tpl = K.exportTemplate('kobra_s1', '0.4');
const compute = (g, inp) => K.compute({ ...BASE, ...(inp || {}) }, g, { getMat: K.getMat, settings: K.store.settings });
function boxPos(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return Float32Array.from([[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].flatMap(t => t.flatMap(i => v[i])));
}

// a wie exportArgs im Fenster; Vergleich Fenster ↔ Worker
function same(label, a) {
  const main = K.build3mfFor(a, fflate);
  const plain = structuredClone(K.exportArgsPlain(a));   // wie postMessage – scheitert bei Funktionen/THREE-Objekten
  check(label + ': keine Analyse-Felder an den Worker', plain.jobs.every(j => !('ang' in j.geom) && !('hidden' in j.geom)));
  // fflate von außen: structuredClone liefert Arrays dieses Realms (im Browser-Worker sind es die des Workers)
  const work = WK.build3mfPlain(plain, fflate);
  const zm = fflate.unzipSync(main.bytes), zw = fflate.unzipSync(work.bytes);
  const names = Object.keys(zm).sort();
  check(label + ': gleiche Dateien', JSON.stringify(names) === JSON.stringify(Object.keys(zw).sort()), Object.keys(zw).sort().join());
  const diff = names.filter(n => !zw[n] || Buffer.compare(Buffer.from(zm[n]), Buffer.from(zw[n])) !== 0);
  check(label + ': gleicher Inhalt', !diff.length, diff.join());
  check(label + ': gleiche Hinweise', JSON.stringify(main.notes) === JSON.stringify(work.notes), JSON.stringify([main.notes, work.notes]));
  return zm;
}

check('Worker lädt fflate', WK.zip);

/* 1) Einfache Teile: Quader mit erhabener Beschriftung und eigener Bemalung, dazu eine Kopie (teilt die Geometrie) */
{ const g = K.makeGeom('quader.stl', boxPos(0, 0, 0, 60, 30, 10)), g2 = K.makeGeom('klein.stl', boxPos(0, 0, 0, 20, 20, 20));
  const a0 = K.topFace(g);
  const p1 = { name: g.name, origPos: g.pos, R: K.IDENTITY3, geom: g, slot: null, plate: 1, texts: [{ id: 1, text: 'AB', height: 8, depth: 1, stroke: 0.12, rot: 0, mode: 'raised', slot: 1, anchor: K.anchorToOrig(a0, null) }],
    paintUser: { rev: 1, codes: { 4: '8' }, slots: [1] } };
  const p2 = { name: g2.name, origPos: g2.pos, R: K.IDENTITY3, geom: g2, slot: 2, plate: 1 }, p3 = { ...p2 };
  const r1 = compute(g), r2 = compute(g2, { material: 'petg' });
  const jobs = [{ geom: g, slot: null, bodies: null, part: p1, holes: [], r: r1 }, { geom: g2, slot: 2, bodies: null, part: p2, holes: [], r: r2 }, { geom: g2, slot: 2, bodies: null, part: p3, holes: [], r: r2 }];
  const a = { tpl, r: r1, jobs, slot: 0, live: null, threemf: null, machine: [] };
  const z = same('STL', a);
  check('STL: Beschriftung im Export', /Schrift „AB“/.test(fflate.strFromU8(z['Metadata/model_settings.config'])));
  K.setPrintSequence(true); K.setPackGap(15);
  same('STL Objekt für Objekt, Abstand 15 mm', a);
  K.setPrintSequence(false); K.setPackGap(8);
}

/* 2) Makerworld-3MF: bemaltes Objekt (Filament 5 → Slot 2), gedreht und vergrößert, dann neu angeordnet */
const u8 = s => fflate.strToU8(s);
function cubeXml(id, s, paint) {
  const b = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return '<object id="' + id + '" type="model"><mesh><vertices>' + b.map(v => '<vertex x="' + v[0] + '" y="' + v[1] + '" z="' + v[2] + '"/>').join('') +
    '</vertices><triangles>' + f.map((t, i) => '<triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"' + (paint && paint[i] ? ' paint_color="' + paint[i] + '"' : '') + '/>').join('') + '</triangles></mesh></object>';
}
{ const zip = fflate.zipSync({
    '_rels/.rels': u8('<Relationships><Relationship Target="/3D/3dmodel.model" Id="rel-1"/></Relationships>'),
    '3D/3dmodel.model': u8('<?xml version="1.0"?><model unit="millimeter" xmlns:p="x"><metadata name="Application">BambuStudio-01.10.02.76</metadata><resources>' + cubeXml(1, 20, { 2: '8', 3: '2C' }) + cubeXml(2, 10) + '</resources><build>' +
      '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 435.2 128 0"/></build></model>'),
    'Metadata/model_settings.config': u8('<?xml version="1.0"?><config><object id="1"><metadata key="name" value="Gross"/><metadata key="extruder" value="2"/><part id="1" subtype="normal_part"></part></object>' +
      '<object id="2"><metadata key="name" value="Klein"/><metadata key="extruder" value="1"/><part id="2" subtype="normal_part"></part></object>' +
      '<plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="0"/></model_instance></plate>' +
      '<plate><metadata key="plater_id" value="2"/><model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="0"/></model_instance></plate></config>'),
    'Metadata/plate_1.gcode': u8('; alt')
  });
  const imp = K.importModels([{ name: 'mw.3mf', bytes: zip }], fflate);
  const parts = imp.parts.map(p => ({ name: p.name, origPos: p.pos, R: K.IDENTITY3, geom: K.makeGeom(p.name, p.pos), slot: p.extruder ? p.extruder - 1 : null, plate: p.plate || 1,
    objectId: p.objectId, instance: p.instance || 0, painted: !!p.painted, paintState: p.paintState || null, paintSlots: (p.paintSlots || []).map(e => e - 1), paintCodes: p.paintCodes || null, paintSrc: p.paintSrc || null, modSlots: [] }));
  const tm = imp.threemf;
  tm.designMap = { 4: 1 };
  const args = () => { const jobs = parts.map(p => ({ geom: p.geom, slot: p.slot, bodies: null, part: p, holes: [], r: compute(p.geom) }));
    return { tpl, r: jobs[0].r, jobs, slot: jobs[0].slot ?? 0, live: null, threemf: tm, machine: [] }; };
  same('3MF', args());
  parts[1].R = K.rotateAxis('x', 90); parts[1].geom = K.partGeom(parts[1]);
  parts[0].scale = [1.5, 1.5, 1.5]; parts[0].geom = K.partGeom(parts[0]);
  parts[0].paintUser = { rev: 1, codes: { 5: '8' }, slots: [1] };
  same('3MF gedreht, vergrößert, eigene Bemalung', args());
  tm.layout = 'auto';
  same('3MF neu angeordnet', args());
}

console.log(pass + '/' + (pass + fail) + ' bestanden');
process.exit(fail ? 1 : 0);
