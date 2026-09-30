'use strict';
/* Makerworld-/Bambu-3MF ohne echte Datei: erzeugt eine kleine 3MF im Aufbau von Bambu Studio (Objekte in 3D/Objects,
   model_settings mit Bauteilen und Platten, 5 Filamente des Designers) – ein bemaltes Teil auf Platte 1, ein Turm mit
   Farb-Modifikator auf Platte 2 – und prüft, was 10.6 damit tut:
     Import (Bemalung je Dreieck, Modifikator), Bemalung auf die eigenen Slots umschreiben, Drehen und Größe eines Objekts
     des Designers (Transformation), Beschriftung als weiteres Bauteil des Objekts, Druck Objekt für Objekt.
   Mit OrcaSlicer (ORCA=… oder Standardpfad) wird das Ergebnis zusätzlich geslict. Aufruf: node tests/designer-3mf.js */
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const fflate = require('../vendor/fflate.min.js');
const ROOT = path.join(__dirname, '..');
const ORCA = process.env.ORCA || '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'designer3mf-'));

const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'orient', 'holes', 'font-hershey', 'engrave', 'paint', 'export3mf', 'import'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext(`({ importModels, makeGeom, compute, getMat, store, exportTemplate, build3mfFromProject, partGeom, rotateAxis,
  topFace, anchorToOrig, anchorUnscaled, paintStates, setPrintSequence, clearanceOf, IDENTITY3, paintTree, paintCode, paintApply, paintBrushSphere, paintTreeStates })`, ctx);

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FEHL ' + name + (detail !== undefined ? ': ' + JSON.stringify(detail) : '')); } };

/* ---------- Test-3MF im Bambu-Aufbau ---------- */
function boxMesh(x0, y0, z0, x1, y1, z1, paint) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const t = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return '<mesh><vertices>' + v.map(p => '<vertex x="' + p[0] + '" y="' + p[1] + '" z="' + p[2] + '"/>').join('') + '</vertices><triangles>' +
    t.map((f, i) => '<triangle v1="' + f[0] + '" v2="' + f[1] + '" v3="' + f[2] + '"' + (paint && paint[i] ? ' paint_color="' + paint[i] + '"' : '') + '/>').join('') + '</triangles></mesh>';
}
const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';
const U = n => 'p:UUID="' + ('0000000' + n).slice(-8) + '-0000-4000-8000-000000000000"';
function designer3mf() {
  // Deckfläche (Dreiecke 2 und 3) bemalt: Filament 2 und 5 des Designers
  const obj1 = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" ' + NS + '><resources><object id="1" ' + U(1) + ' type="model">' + boxMesh(-15, -15, 0, 15, 15, 10, { 2: '8', 3: '2C' }) + '</object></resources></model>';
  const obj3 = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" ' + NS + '><resources><object id="3" ' + U(3) + ' type="model">' + boxMesh(-10, -10, 0, 10, 10, 40) + '</object>' +
    '<object id="5" ' + U(5) + ' type="model">' + boxMesh(-11, -11, 18, 11, 11, 24) + '</object></resources></model>';
  const root = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ' + NS + '>\n <metadata name="Application">BambuStudio-01.10.02.76</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n' +
    '  <object id="2" ' + U(2) + ' type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" ' + U(11) + ' transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>\n' +
    '  <object id="4" ' + U(4) + ' type="model"><components><component p:path="/3D/Objects/object_3.model" objectid="3" ' + U(13) + ' transform="1 0 0 0 1 0 0 0 1 0 0 0"/>' +
    '<component p:path="/3D/Objects/object_3.model" objectid="5" ' + U(15) + ' transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>\n </resources>\n' +
    ' <build ' + U(99) + '>\n  <item objectid="2" ' + U(21) + ' transform="1 0 0 0 1 0 0 0 1 128 128 0" printable="1"/>\n  <item objectid="4" ' + U(22) + ' transform="1 0 0 0 1 0 0 0 1 435.6 128 0" printable="1"/>\n </build>\n</model>\n';
  const part = (id, sub, name, ext) => '    <part id="' + id + '" subtype="' + sub + '">\n      <metadata key="name" value="' + name + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' + (ext ? '      <metadata key="extruder" value="' + ext + '"/>\n' : '') + '    </part>\n';
  const plate = (k, obj) => '  <plate>\n    <metadata key="plater_id" value="' + k + '"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n    <model_instance>\n      <metadata key="object_id" value="' + obj + '"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="' + (100 + k) + '"/>\n    </model_instance>\n  </plate>\n';
  const ms = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="2">\n    <metadata key="name" value="bemalt.stl"/>\n    <metadata key="extruder" value="1"/>\n' + part(1, 'normal_part', 'bemalt.stl') + '  </object>\n' +
    '  <object id="4">\n    <metadata key="name" value="turm.stl"/>\n    <metadata key="extruder" value="1"/>\n' + part(3, 'normal_part', 'turm.stl') + part(5, 'modifier_part', 'band', 3) + '  </object>\n' +
    plate(1, 2) + plate(2, 4) + '  <assemble>\n   <assemble_item object_id="2" instance_id="0" transform="1 0 0 0 1 0 0 0 1 128 128 0" offset="0 0 0" />\n   <assemble_item object_id="4" instance_id="0" transform="1 0 0 0 1 0 0 0 1 435.6 128 0" offset="0 0 0" />\n  </assemble>\n</config>\n';
  const settings = { printer_settings_id: 'Bambu Lab P1S 0.4 nozzle', filament_type: ['PLA', 'PLA', 'PLA', 'PLA', 'PLA'], filament_colour: ['#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFAA00'] };
  return fflate.zipSync({
    '[Content_Types].xml': fflate.strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>'),
    '_rels/.rels': fflate.strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': fflate.strToU8(root),
    '3D/_rels/3dmodel.model.rels': fflate.strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/><Relationship Target="/3D/Objects/object_3.model" Id="rel-2" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/Objects/object_1.model': fflate.strToU8(obj1), '3D/Objects/object_3.model': fflate.strToU8(obj3),
    'Metadata/model_settings.config': fflate.strToU8(ms), 'Metadata/project_settings.config': fflate.strToU8(JSON.stringify(settings, null, 4))
  });
}

/* ---------- Teile wie js/app.js partsFromImport ---------- */
const load = bytes => K.importModels([{ name: 'designer.3mf', bytes }], fflate);
function toParts(imp) {
  return imp.parts.map((p, i) => ({ id: i, name: p.name, origPos: p.pos, R: K.IDENTITY3, geom: K.makeGeom(p.name, p.pos), slot: p.extruder ? p.extruder - 1 : null, plate: p.plate || 1,
    objectId: p.objectId || null, instance: p.instance || 0, bodies: null, painted: !!p.painted, dSlot: p.extruder ? p.extruder - 1 : null, modSlots: (p.modifiers || []).map(e => e - 1),
    paintTris: !!p.paintTris, modVols: (p.modVols || []).map(m => ({ dSlot: m.extruder - 1, pos: m.pos })), paintState: p.paintState || null, paintSlots: (p.paintSlots || []).map(e => e - 1), paintCodes: p.paintCodes || null, paintSrc: p.paintSrc || null }));
}
const tpl = K.exportTemplate('kobra_s1', '0.4');
const BASE = { printer: 'kobra_s1', nozD: '0.4', nozM: 'steel_hardened', material: 'pla_hs', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
function build(parts, threemf) {
  const jobs = parts.map(p => ({ geom: p.geom, slot: p.slot, bodies: p.bodies, part: p, holes: [], r: K.compute(BASE, p.geom, { getMat: K.getMat, settings: K.store.settings }) }));
  const res = K.build3mfFromProject(tpl, jobs[0].r, jobs, jobs[0].slot ?? 0, fflate, null, threemf);
  return { res, z: fflate.unzipSync(res.bytes) };
}
const bbox = P => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < P.length; i++) { const k = i % 3; mn[k] = Math.min(mn[k], P[i]); mx[k] = Math.max(mx[k], P[i]); } return [mn, mx]; };
const dims = P => { const [mn, mx] = bbox(P); return mx.map((v, k) => +(v - mn[k]).toFixed(2)); };
const paintedStates = z => { const s = new Set(); for (const [n, d] of Object.entries(z)) if (/\.model$/.test(n)) for (const m of fflate.strFromU8(d).matchAll(/paint_color="([0-9A-Fa-f]+)"/g)) K.paintStates(m[1]).forEach(x => s.add(x)); return [...s].sort(); };
const slices = [];

/* 1) Import */
const imp = load(designer3mf()), parts = toParts(imp), tm = imp.threemf;
const bemalt = parts.find(p => /bemalt/.test(p.name)), turm = parts.find(p => /turm/.test(p.name));
check('Import: zwei Objekte auf zwei Platten', parts.length === 2 && bemalt.plate === 1 && turm.plate === 2, parts.map(p => p.name + '@' + p.plate));
check('Import: Bemalung je Dreieck (Filament 2 und 5)', bemalt.paintState && Array.from(bemalt.paintState).filter(Boolean).join() === '2,5' && JSON.stringify(bemalt.paintSlots) === '[1,4]', bemalt.paintSlots);
check('Import: Farb-Modifikator mit Netz (Filament 3)', JSON.stringify(turm.modSlots) === '[2]' && turm.modVols.length === 1, turm.modSlots);

/* 2) Bemalung auf eigene Slots: Farbe 5 des Designers → Slot 2 (Kobra S1 hat 4) */
tm.designMap = { 4: 1 };
{ const { z } = build(parts, tm);
  check('Bemalung umgeschrieben: nur Filamente ≤ 4 (5 → 2)', JSON.stringify(paintedStates(z)) === '[2]', paintedStates(z));
  const ps = JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config']));
  check('Projekt hat 4 Filamente (Kobra S1)', ps.filament_settings_id.length === 4);
  const f = path.join(OUT, 'bemalt.3mf'); fs.writeFileSync(f, z ? build(parts, tm).res.bytes : ''); slices.push({ name: 'Bemalung', file: f, plates: 2 }); }

/* 3) Drehen (Turm 90° um X) und Größe (bemaltes Teil 150 %) – in der Transformation des Objekts */
turm.R = K.rotateAxis('x', 90); turm.geom = K.partGeom(turm);
bemalt.scale = [1.5, 1.5, 1.5]; bemalt.geom = K.partGeom(bemalt);
{ const { res, z } = build(parts, tm), re = toParts(load(res.bytes));
  const t2 = re.find(p => /turm/.test(p.name)), b2 = re.find(p => /bemalt/.test(p.name));
  check('Gedrehter Turm: 20 × 40 × 20 mm, steht auf dem Bett', JSON.stringify(dims(t2.origPos)) === '[20,40,20]' && Math.abs(bbox(t2.origPos)[0][2]) < 0.01, [dims(t2.origPos), bbox(t2.origPos)[0][2]]);
  check('Bemaltes Teil 150 %: 45 × 45 × 15 mm, steht auf dem Bett', JSON.stringify(dims(b2.origPos)) === '[45,45,15]' && Math.abs(bbox(b2.origPos)[0][2]) < 0.01, dims(b2.origPos));
  check('Bemalung bleibt nach Größenänderung erhalten', JSON.stringify(paintedStates(z)) === '[2]');
  const f = path.join(OUT, 'gedreht.3mf'); fs.writeFileSync(f, res.bytes); slices.push({ name: 'Drehen und Größe', file: f, plates: 2, turmHeight: 20 }); }

/* 4) Beschriftung auf dem Objekt des Designers: erhaben, Slot 3 */
{ const a = K.topFace(bemalt.geom);
  bemalt.texts = [{ id: 1, text: 'AB', height: 10, depth: 1, stroke: 0.12, rot: 0, mode: 'raised', slot: 2, anchor: K.anchorToOrig(K.anchorUnscaled(a, bemalt), bemalt.R) }];
  const { res, z } = build(parts, tm), ms = fflate.strFromU8(z['Metadata/model_settings.config']);
  check('Text als Bauteil des Objekts (normal_part, Slot 3)', /<object id="2">[\s\S]*?<part id="\d+" subtype="normal_part">\s*<metadata key="name" value="Schrift „AB“"\/>[\s\S]*?key="extruder" value="3"/.test(ms));
  const re = load(res.bytes), b3 = re.parts.find(p => /bemalt/.test(p.name)), body = b3 && (b3.bodies || []).find(x => /AB/.test(x.name));
  if (body) {
    let st = 0; for (const x of b3.bodies) { if (x === body) break; st += x.count; }
    const [mn, mx] = bbox(b3.pos.subarray(st * 9, (st + body.count) * 9)), [pmn, pmx] = bbox(b3.pos);
    check('Text liegt auf der Oberseite des Teils (Z 14–16 mm, mittig)', mn[2] > 13.5 && mx[2] < 16.5 && Math.abs((mn[0] + mx[0]) / 2 - (pmn[0] + pmx[0]) / 2) < 1, [mn, mx]);
  } else check('Text als Körper wieder eingelesen', false, b3 && b3.bodies);
  bemalt.texts.push({ id: 2, text: 'C', height: 8, depth: 0.6, stroke: 0.12, rot: 0, mode: 'engraved', slot: null, anchor: bemalt.texts[0].anchor });
  const ms2 = fflate.strFromU8(build(parts, tm).z['Metadata/model_settings.config']);
  check('Vertiefter Text als negative_part', /subtype="negative_part">\s*<metadata key="name" value="Gravur „C“"/.test(ms2));
  bemalt.texts.pop();
  const f = path.join(OUT, 'text.3mf'); fs.writeFileSync(f, res.bytes); slices.push({ name: 'Text', file: f, plates: 2, textSlot: 2 }); }

/* 4b) Eigene Bemalung auf dem Objekt des Designers (js/paint-ui.js): Seite vorn (Dreieck 4) mit einer Kugel in Slot 4 bemalen,
   die bemalte Deckfläche (Dreieck 3, Filament 5 des Designers) ausradieren – beides landet in den Dreiecken des Designers */
{ check('Herkunft der Dreiecke bekannt (Datei, Netz)', JSON.stringify(bemalt.paintSrc) === JSON.stringify([{ path: '3D/Objects/object_1.model', id: '1', start: 0, count: 12 }]), bemalt.paintSrc);
  const P = bemalt.origPos, tri = i => [0, 1, 2].map(v => [P[i * 9 + v * 3], P[i * 9 + v * 3 + 1], P[i * 9 + v * 3 + 2]]);
  const [a, b, c] = tri(4), m = [0, 1, 2].map(k => (a[k] + b[k] + c[k]) / 3), tree = K.paintApply({ s: 0 }, a, b, c, K.paintBrushSphere(m, m, 4), 4, 0.25);
  check('Kugel teilt das Dreieck am Rand', !!tree.c, K.paintCode(tree));
  bemalt.paintUser = { rev: 1, codes: { 4: K.paintCode(tree), 3: '0' }, slots: [3] };
  const { res, z } = build(parts, tm), obj = fflate.strFromU8(z['3D/Objects/object_1.model']);
  const tris = [...obj.matchAll(/<triangle\b[^>]*>/g)].map(m => (/paint_color="([^"]*)"/.exec(m[0]) || [])[1] || '');
  check('eigener Code im Dreieck 4 des Designers', tris[4] === K.paintCode(tree), tris[4]);
  check('ausradiert: Dreieck 3 ohne Bemalung', tris[3] === '', tris[3]);
  check('Bemalung des Designers bleibt daneben (Dreieck 2: Filament 2)', tris[2] === '8', tris[2]);
  check('Slot 4 bekommt ein Filament (Projekt mit 4 Filamenten)', JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config'])).filament_settings_id.length === 4);
  const re = load(res.bytes).parts.find(p => /bemalt/.test(p.name));
  check('wieder eingelesen: Filament 4 kommt vor', (re.paintSlots || []).includes(4), re.paintSlots);
  const f = path.join(OUT, 'eigen.3mf'); fs.writeFileSync(f, res.bytes); slices.push({ name: 'Eigene Bemalung', file: f, plates: 2, usesSlot: 3 });
  bemalt.paintUser = null; }

/* 5) Druck Objekt für Objekt: print_sequence und Abstand für den Druckkopf */
{ K.setPrintSequence(true);
  const ps = JSON.parse(fflate.strFromU8(build(parts, tm).z['Metadata/project_settings.config']));
  check('Druck Objekt für Objekt: print_sequence = by object', ps.print_sequence === 'by object');
  check('Freiraum des Druckkopfs aus dem Profil (S1: 60 mm)', K.clearanceOf(tpl).radius === 60 && K.clearanceOf(tpl).rod === 48);
  K.setPrintSequence(false); }

/* 6) OrcaSlicer (wenn vorhanden) */
if (!fs.existsSync(ORCA)) console.log('\nOrca-CLI nicht gefunden (' + ORCA + ') – Slicen übersprungen');
else for (const c of slices) {
  const dir = path.join(OUT, 'o-' + slices.indexOf(c)); fs.mkdirSync(dir);
  try { execFileSync(ORCA, ['--slice', '0', '--outputdir', dir, c.file], { stdio: 'pipe', timeout: 600000, cwd: OUT }); }
  catch (e) { check(c.name + ': Orca-CLI', false, (e.stderr || e.stdout || e.message).toString().slice(-300)); continue; }
  const g = fs.readdirSync(dir).filter(f => /\.gcode$/.test(f)).sort();
  check(c.name + ': Orca slict ' + g.length + ' Platten', g.length === c.plates, g);
  const txt = n => fs.readFileSync(path.join(dir, 'plate_' + n + '.gcode'), 'utf8');
  if (c.turmHeight && g.length > 1) { const zmax = +(/; max_z_height: ([\d.]+)/.exec(txt(2)) || [])[1]; check(c.name + ': gedrehter Turm ' + zmax + ' mm hoch', Math.abs(zmax - c.turmHeight) < 0.3); }
  if (c.usesSlot != null && g.length) { const used = ((/; filament used \[g\] = (.*)/.exec(txt(1)) || [])[1] || '').split(',').map(Number);
    check(c.name + ': Slot ' + (c.usesSlot + 1) + ' wird gedruckt (' + (used[c.usesSlot] || 0) + ' g)', used[c.usesSlot] > 0, used); }
  if (c.textSlot != null && g.length) { const used = ((/; filament used \[g\] = (.*)/.exec(txt(1)) || [])[1] || '').split(',').map(Number);
    check(c.name + ': Slot ' + (c.textSlot + 1) + ' druckt den Text (' + (used[c.textSlot] || 0) + ' g)', used[c.textSlot] > 0, used); }
}

console.log('\n' + pass + '/' + (pass + fail) + ' bestanden' + (fail ? '' : ' – OK') + '\nArbeitsordner: ' + OUT);
process.exitCode = fail ? 1 : 0;
