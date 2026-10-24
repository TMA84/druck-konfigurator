'use strict';
/* Makerworld-/Orca-3MF neu anordnen, Modelle hinzufügen, Kopien – die 3MF des Designers bleibt (Modifikatoren,
   Bemalung). Prüft build3mfFromProject und, wenn vorhanden, das Ergebnis mit der Orca-CLI.
   Immer (auch in CI): nachgebaute Makerworld-3MF im Aufbau der beiden echten Dateien (synthMakerworld unten) –
     „porta“: 5 Objekte auf 4 Platten (Objekte in 3D/Objects, zwei Objekte teilen ein Netz, gedrehte Build-Items,
     Körper mit eigenem Slot, Deckel mit 5 Text-/SVG-Modifikatoren in Slot 2, Negativteil, SVG-Datei, filament_sequence.json),
     „ACE“: ein Objekt, Netz in der Haupt-Datei, um X gedreht, eine Platte.
   Zusätzlich, wenn vorhanden: dieselben Fälle mit den echten Dateien
     PORTA3MF=<porta+utensili+condizionatore+3+3mf.3mf>, ACE3MF=<ACE+Guide+V2.3mf> (Standard: ~/Downloads); ARRANGE_REAL=0 lässt sie weg.
   Aufruf: node tests/export-project-arrange.js
   ORCA=<Pfad zur OrcaSlicer-CLI> (Standard: /Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const fflate = require('../vendor/fflate.min.js');

const ROOT = path.join(__dirname, '..');
const DL = path.join(os.homedir(), 'Downloads');
const PORTA = process.env.PORTA3MF || path.join(DL, 'porta+utensili+condizionatore+3+3mf.3mf');
const ACE = process.env.ACE3MF || path.join(DL, 'ACE+Guide+V2.3mf');
const ORCA = process.env.ORCA || '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'arrange3mf-'));

const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'holes', 'brim-ears', 'export3mf-settings', 'export3mf-mesh', 'export3mf-pack', 'export3mf-relayout', 'export3mf', 'import'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({importModels, makeGeom, compute, getMat, store, exportTemplate, build3mfFromProject, layout3mf, ownPlaced, bedSize})', ctx);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FEHL ' + name + (detail !== undefined ? ': ' + detail : '')); } }
const checkAll = check;

const load = f => K.importModels([{ name: path.basename(f), bytes: new Uint8Array(fs.readFileSync(f)) }], fflate);

// Teile wie js/app.js partsFromImport (ohne DOM)
function toParts(imp) {
  return imp.parts.map((p, i) => {
    let start = 0;
    const bodies = p.bodies && p.bodies.length > 1 ? p.bodies.map(b => { const o = { name: b.name, start, count: b.count, slot: b.extruder && b.extruder !== p.extruder ? b.extruder - 1 : null, partId: b.partId ?? null }; start += b.count; return o; }) : null;
    return { id: i, name: p.name, geom: K.makeGeom(p.name, p.pos), slot: p.extruder ? p.extruder - 1 : null, plate: p.plate || 1, objectId: p.objectId || null, instance: p.instance || 0,
      bodies, painted: !!p.painted, modSlots: (p.modifiers || []).map(e => e - 1), paintTris: !!p.paintTris };
  });
}
const BASE = { printer: 'kobra_s1', nozD: '0.4', nozM: 'steel_hardened', material: 'pla_hs', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
const tpl = K.exportTemplate('kobra_s1', '0.4'), [BW, BD] = K.bedSize(tpl);
function build(parts, threemf, live) {
  const jobs = parts.map(p => ({ geom: p.geom, slot: p.slot, bodies: p.bodies, part: p, holes: [], r: K.compute(BASE, p.geom, { getMat: K.getMat, settings: K.store.settings }) }));
  const def = jobs.find(j => j.slot == null), slot = def ? 0 : jobs[0].slot;
  const res = K.build3mfFromProject(tpl, (def || jobs[0]).r, jobs, slot, fflate, live || null, threemf);
  const z = fflate.unzipSync(res.bytes);
  return { res, z, root: fflate.strFromU8(z['3D/3dmodel.model']), ms: fflate.strFromU8(z['Metadata/model_settings.config']) };
}
const layoutOf = (parts, threemf) => K.layout3mf(parts.map(p => ({ geom: p.geom, plate: p.plate, own: K.ownPlaced(p) })), tpl, threemf.layout || null);
function stlBox(name, sx, sy, sz) {
  const v = [[0,0,0],[sx,0,0],[sx,sy,0],[0,sy,0],[0,0,sz],[sx,0,sz],[sx,sy,sz],[0,sy,sz]];
  const tris = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const b = Buffer.alloc(84 + tris.length * 50); b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((k, j) => v[k].forEach((c, a) => b.writeFloatLE(c + [300, 300, 7][a], 84 + i * 50 + 12 + j * 12 + a * 4))));
  return { name, bytes: new Uint8Array(b) };
}
// Hinzugefügte Teile wie js/app.js addParts bei einer 3MF: einfache Teile ohne Objekt des Designers
const asExtra = (parts, plate) => parts.map(p => ({ ...p, extra: true, objectId: null, instance: 0, painted: false, paintTris: false, modSlots: [], plate }));

// Ergebnis erneut importieren: Plattenzuordnung, Lage auf der Platte (Hüllquader in Bettkoordinaten)
function reimport(bytes) {
  const imp = K.importModels([{ name: 'x.3mf', bytes }], fflate);
  const count = Math.max(...imp.parts.map(p => p.plate)), cols = Math.ceil(Math.sqrt(count));
  return { imp, count, boxes: imp.parts.map(p => { const g = K.makeGeom(p.name, p.pos), pi = p.plate - 1, ox = (pi % cols) * BW * 1.2, oy = -Math.floor(pi / cols) * BD * 1.2;
    return { name: p.name, plate: p.plate, objectId: p.objectId, x0: g.mn[0] - ox, x1: g.mx[0] - ox, y0: g.mn[1] - oy, y1: g.mx[1] - oy }; }) };
}
const onBed = b => b.x0 >= -0.5 && b.y0 >= -0.5 && b.x1 <= BW + 0.5 && b.y1 <= BD + 0.5;
const fmtBox = b => b.name + '@' + b.plate + ' ' + [b.x0, b.y0, b.x1, b.y1].map(v => v.toFixed(1)).join('/');
function transformsValid(root) {
  const items = [...root.matchAll(/<item\b[^>]*transform="([^"]+)"/g)].map(m => m[1].trim().split(/\s+/).map(Number));
  return items.length && items.every(m => { if (m.length !== 12 || !m.every(Number.isFinite)) return false;
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    return Math.abs(Math.abs(det) - 1) < 1e-3; });
}
const modifierOf = (ms, objectId) => { const o = (new RegExp('<object id="' + objectId + '">([\\s\\S]*?)</object>').exec(ms) || [])[1] || '';
  return [...o.matchAll(/<part id="\d+" subtype="modifier_part">([\s\S]*?)<\/part>/g)].map(m => (/key="extruder" value="(\d+)"/.exec(m[1]) || [])[1]); };

const cases = [];

/* Fälle 1–3 für ein Paar Dateien (nachgebaut oder echt): label steht vor jeder Prüfung und jedem Orca-Fall,
   SVG = Pfad der SVG-Datei des Logo-Modifikators in der porta-3MF */
function suite(label, PORTA_FILE, ACE_FILE, SVG) {
  const check = (name, ok, detail) => checkAll('[' + label + '] ' + name, ok, detail);

  /* 1) porta utensili: 5 Objekte auf 4 Platten → platzsparend auf 3 Platten */
  {
    const imp = load(PORTA_FILE), parts = toParts(imp), threemf = imp.threemf;
    check('porta: 5 Objekte auf 4 Designer-Platten', parts.length === 5 && Math.max(...parts.map(p => p.plate)) === 4, parts.map(p => p.name + '@' + p.plate).join(', '));
    const lid = parts.find(p => /coperchio/.test(p.name));
    check('porta: Deckel hat Text-Modifikatoren mit Slot 2', lid && lid.modSlots.includes(1), lid && lid.modSlots.join());
    const origMs = fflate.strFromU8(threemf.zip['Metadata/model_settings.config']);
    threemf.layout = 'auto';
    const lay = layoutOf(parts, threemf), t = build(parts, threemf);
    check('porta angeordnet: 3 Platten', t.res.plateCount === 3 && lay.count === 3, t.res.plateCount);
    check('porta: 3 Platten in model_settings', (t.ms.match(/<plate>/g) || []).length === 3);
    check('porta: filament_sequence für 3 Platten', Object.keys(JSON.parse(fflate.strFromU8(t.z['Metadata/filament_sequence.json']))).length === 3);
    check('porta: Build-Item-Transformationen gültig', transformsValid(t.root));
    check('porta: 5 Build-Items, 5 Instanzen', (t.root.match(/<item\b/g) || []).length === 5 && (t.ms.match(/<model_instance>/g) || []).length === 5 && (t.ms.match(/<assemble_item\b/g) || []).length === 5);
    check('porta: Modifikatoren des Deckels (Slot 2) bleiben', modifierOf(t.ms, lid.objectId).filter(e => e === '2').length === modifierOf(origMs, lid.objectId).filter(e => e === '2').length && modifierOf(t.ms, lid.objectId).length === 5, modifierOf(t.ms, lid.objectId).join());
    check('porta: Objekt-Netze unverändert', Object.keys(threemf.zip).filter(k => k.startsWith('3D/Objects/')).every(k => t.z[k] && t.z[k].length === threemf.zip[k].length));
    check('porta: SVG und Negativteil bleiben', !!t.z[SVG] && /subtype="negative_part"/.test(t.ms));
    const rot = lay.places.filter(p => p.rot).length;
    const re = reimport(t.res.bytes);
    check('porta: erneut importiert 5 Teile auf 3 Platten', re.imp.parts.length === 5 && re.count === 3, re.count);
    check('porta: alle Teile auf ihrem Bett', re.boxes.every(onBed), re.boxes.map(fmtBox).join(' | '));
    const want = parts.map((p, i) => p.name + '@' + lay.plateOf[i]).sort().join(), got = re.boxes.map(b => b.name + '@' + b.plate).sort().join();
    check('porta: Platten wie in der Übersicht (layout3mf)', want === got, want + ' ≠ ' + got);
    console.log('     (' + rot + ' Teil(e) um 90° gedreht)');
    cases.push({ name: label + '-porta', bytes: t.res.bytes, count: 3, slot2Plate: lay.plateOf[parts.indexOf(lid)], lidName: lid.name });

    // Designer-Lage (nicht angeordnet): alter Weg, Platten bleiben
    delete threemf.layout;
    const d = build(parts, threemf);
    check('porta nicht angeordnet: 4 Platten wie beim Designer', d.res.plateCount === 4 && (d.ms.match(/<plate>/g) || []).length === 4);

    // Ein Teil entfernt (js/app.js removePart): fehlt im Export, die übrigen behalten die Lage des Designers
    const drop = parts.find(p => p !== lid), rest = parts.filter(p => p !== drop);
    threemf.removed = true;
    const r = build(rest, threemf), re2 = reimport(r.res.bytes), plates = new Set(rest.map(p => p.plate)).size;
    check('porta ohne „' + drop.name + '“: 4 Build-Items, 4 Instanzen', (r.root.match(/<item\b/g) || []).length === 4 && (r.ms.match(/<model_instance>/g) || []).length === 4);
    check('porta ohne Teil: erneut importiert 4 Teile, ' + plates + ' Platten', re2.imp.parts.length === 4 && re2.count === plates && !re2.imp.parts.some(p => p.name === drop.name), re2.imp.parts.map(p => p.name + '@' + p.plate).join(', '));
    const keep = rest.find(p => p.plate === lid.plate) || lid, before = reimport(d.res.bytes).boxes.find(b => b.name === keep.name), after = re2.boxes.find(b => b.name === keep.name);
    check('porta ohne Teil: „' + keep.name + '“ bleibt an seiner Stelle', before && after && Math.abs(before.x0 - after.x0) < 0.01 && Math.abs(before.y0 - after.y0) < 0.01, before && after && fmtBox(before) + ' → ' + fmtBox(after));
    delete threemf.removed;
    cases.push({ name: label + '-porta_ohne_teil', bytes: r.res.bytes, count: plates, instances: null });
  }

  /* 2) ACE-Guide + erzeugte STL-Box (Modell hinzufügen) */
  {
    const imp = load(ACE_FILE), parts = toParts(imp), threemf = imp.threemf;
    const box = asExtra(toParts(K.importModels([stlBox('box.stl', 30, 20, 10)], fflate)), 2);
    box[0].slot = 2;
    const all = parts.concat(box);
    const t = build(all, threemf);
    const boxObj = /<object id="(\d+)">\s*<metadata key="name" value="box\.stl"\/>\s*<metadata key="extruder" value="(\d+)"\/>/.exec(t.ms);
    check('ACE+Box: Box ist Objekt mit Slot 3', boxObj && boxObj[2] === '3', t.ms.slice(-1500));
    check('ACE+Box: 2 Build-Items', (t.root.match(/<item\b/g) || []).length === 2 && transformsValid(t.root));
    check('ACE+Box: Designer-Platte bleibt, Box auf Platte 2', t.res.plateCount === 2);
    const re = reimport(t.res.bytes);
    check('ACE+Box: erneut importiert beide Objekte', re.imp.parts.length === 2 && re.imp.parts.some(p => p.name === 'box.stl' && p.extruder === 3), re.imp.parts.map(p => p.name + ':' + p.extruder).join());
    check('ACE+Box: beide auf dem Bett', re.boxes.every(onBed), re.boxes.map(fmtBox).join(' | '));
    const bx = re.boxes.find(b => b.name === 'box.stl');
    check('ACE+Box: Box 30×20 mm mittig auf Platte 2', bx && Math.abs((bx.x0 + bx.x1) / 2 - tpl.bedCenter[0]) < 0.5 && Math.abs((bx.y0 + bx.y1) / 2 - tpl.bedCenter[1]) < 0.5 && Math.abs(bx.x1 - bx.x0 - 30) < 0.01, bx && fmtBox(bx));
    cases.push({ name: label + '-ace-box', bytes: t.res.bytes, count: 2, slot2Plate: 2, slotIdx: 2 });
    // platzsparend: beides auf eine Platte
    threemf.layout = 'auto';
    const a = build(all, threemf), ra = reimport(a.res.bytes);
    check('ACE+Box angeordnet: 1 Platte, beide auf dem Bett', a.res.plateCount === 1 && ra.count === 1 && ra.boxes.every(onBed), ra.boxes.map(fmtBox).join(' | '));
    cases.push({ name: label + '-ace-box-auto', bytes: a.res.bytes, count: 1, slot2Plate: 1, slotIdx: 2 });
  }

  /* 3) Kopien: weitere Instanz desselben Objekts */
  {
    const imp = load(ACE_FILE), parts = toParts(imp), threemf = imp.threemf;
    const copies = [1, 2].map(k => ({ ...parts[0], name: parts[0].name + ' (' + (k + 1) + ')', copy: true }));
    const all = parts.concat(copies), t = build(all, threemf), id = parts[0].objectId;
    check('ACE ×3: 3 Build-Items desselben Objekts', (t.root.match(new RegExp('<item objectid="' + id + '"', 'g')) || []).length === 3 && transformsValid(t.root));
    check('ACE ×3: Instanzen 0–2 in model_settings', [0, 1, 2].every(n => new RegExp('<metadata key="object_id" value="' + id + '"/>\\s*<metadata key="instance_id" value="' + n + '"/>').test(t.ms)));
    check('ACE ×3: ein Objekt-Eintrag', (t.ms.match(new RegExp('<object id="' + id + '">', 'g')) || []).length === 1);
    const re = reimport(t.res.bytes);
    check('ACE ×3: erneut importiert 3 Teile, auf dem Bett', re.imp.parts.length === 3 && re.boxes.every(onBed), re.boxes.map(fmtBox).join(' | '));
    cases.push({ name: label + '-ace-copies', bytes: t.res.bytes, count: re.count, instances: 3 });

    // Kopie des Deckels (mit Modifikatoren) in der porta-Datei, platzsparend
    const pimp = load(PORTA_FILE), pparts = toParts(pimp), lid = pparts.find(p => /coperchio/.test(p.name));
    pimp.threemf.layout = 'auto';
    const pall = pparts.concat([{ ...lid, name: lid.name + ' (2)', copy: true }]), pt = build(pall, pimp.threemf);
    check('porta + Deckel-Kopie: 2 Instanzen des Deckels, Modifikatoren einmal im Objekt', (pt.root.match(new RegExp('<item objectid="' + lid.objectId + '"', 'g')) || []).length === 2 && modifierOf(pt.ms, lid.objectId).length === 5);
    const pre = reimport(pt.res.bytes);
    check('porta + Deckel-Kopie: 6 Teile, alle auf dem Bett', pre.imp.parts.length === 6 && pre.boxes.every(onBed), pre.boxes.map(fmtBox).join(' | '));
    cases.push({ name: label + '-porta-copy', bytes: pt.res.bytes, count: pt.res.plateCount });
  }
}

/* ---------- Nachgebaute Makerworld-3MF (laufen immer, auch ohne die echten Dateien) ----------
   Aufbau wie die beiden echten Dateien (Bambu Studio 2.7 bzw. 1.3), Maße ähnlich, Netze sind Quader:
   porta (Designer-Bett 256 mm, Platten im Abstand 307,2 mm, 2 Spalten):
     Platte 1  Objekt 3  „scritta porta utensili“ 200×200 mm: zwei Körper in object_1.model (Schriftplatte Slot 2, Boden Slot 1)
     Platte 2  Objekt 10 „coperchio.stl“ 215×215 mm, Build-Item um X gedreht (180°): Deckel + 4 Text-Modifikatoren und
               1 SVG-Modifikator (BambuStudioShape → 3D/logo_test.svg), alle Slot 2, in object_2.model
     Platte 3  Objekt 13 „scatola.stl“ 215×215 mm: Kasten + Negativteil (vertiefter Text) in object_3.model
     Platte 4  Objekte 15 und 16 „gancio.stl“: zwei Haken, beide auf dasselbe Netz in object_4.model, um Y gedreht (stehend)
     dazu filament_sequence.json für 4 Platten und project_settings mit 2 Filamenten des Designers.
   ACE: ein Objekt „ACE Guide V2.stl“ 58×60×25 mm, Netz in 3D/3dmodel.model (ohne p:path), Build-Item um X gedreht, Platte 1. */
const SYNTH_SVG = '3D/logo_test.svg';
function synthMakerworld(dir) {
  const u8 = s => fflate.strToU8(s), XML = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const mesh = (x0, y0, z0, x1, y1, z1) => {
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    return '<mesh><vertices>' + v.map(p => '<vertex x="' + p[0] + '" y="' + p[1] + '" z="' + p[2] + '"/>').join('') + '</vertices><triangles>' +
      f.map(t => '<triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"/>').join('') + '</triangles></mesh>';
  };
  const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';
  const UU = n => 'p:UUID="' + ('0000000' + n.toString(16)).slice(-8) + '-61cb-4c03-9d28-80fed5dfa1dc"';
  const objFile = objs => XML + '<model unit="millimeter" xml:lang="en-US" ' + NS + '>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n' +
    objs.map(([id, m]) => '  <object id="' + id + '" ' + UU(id + 0x100) + ' type="model">' + m + '</object>\n').join('') + ' </resources>\n <build/>\n</model>\n';
  const comps = (file, list) => '<components>' + list.map(([id, tr]) => '<component p:path="/3D/Objects/' + file + '" objectid="' + id + '" ' + UU(id + 0x200) + ' transform="' + tr + '"/>').join('') + '</components>';
  const I = '1 0 0 0 1 0 0 0 1 ', meta = (k, v) => '      <metadata key="' + k + '" value="' + v + '"/>\n';
  const part = (id, sub, name, ext, extra = '') => '    <part id="' + id + '" subtype="' + sub + '">\n' + meta('name', name) + meta('matrix', '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1') +
    (ext ? meta('extruder', ext) : '') + extra + '    </part>\n';
  const object = (id, name, parts) => '  <object id="' + id + '">\n    <metadata key="name" value="' + name + '"/>\n    <metadata key="extruder" value="1"/>\n' + parts.join('') + '  </object>\n';
  const plate = (k, ids) => '  <plate>\n    <metadata key="plater_id" value="' + k + '"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n' +
    ids.map(id => '    <model_instance>\n      <metadata key="object_id" value="' + id + '"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="' + (200 + id) + '"/>\n    </model_instance>\n').join('') + '  </plate>\n';
  const contentTypes = u8(XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="gcode" ContentType="text/x.gcode"/></Types>');
  const rels = u8(XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  const settings = (printer, n) => JSON.stringify({ printer_settings_id: printer, printable_area: ['0x0', '256x0', '256x256', '0x256'],
    filament_type: Array(n).fill('PLA'), filament_colour: ['#FFFFFF', '#000000'].slice(0, n), filament_settings_id: Array(n).fill('Bambu PLA Basic @BBL P1S') }, null, 4);

  // porta: Weltlage der Platten wie bei Bambu (Abstand 1,2 × 256 mm)
  const S = 307.2, item = (id, tr) => '  <item objectid="' + id + '" ' + UU(id + 0x300) + ' transform="' + tr + '" printable="1"/>\n';
  const root = XML + '<model unit="millimeter" xml:lang="en-US" ' + NS + '>\n <metadata name="Application">BambuStudio-02.07.01.62</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n' +
    ' <metadata name="Title">scatola (nachgebaut)</metadata>\n <resources>\n' +
    '  <object id="3" ' + UU(3) + ' type="model">' + comps('object_1.model', [[1, I + '20 80 5'], [2, I + '0 0 0']]) + '</object>\n' +
    '  <object id="10" ' + UU(10) + ' type="model">' + comps('object_2.model', [[4, I + '0 0 0'], [5, I + '0 -75 0'], [6, I + '0 -35 0'], [7, I + '0 5 0'], [8, I + '0 45 0'],
      [9, '0.5 0 0 0 0.5 0 0 0 1 40 80 0']]) + '</object>\n' +
    '  <object id="13" ' + UU(13) + ' type="model">' + comps('object_3.model', [[11, I + '0 0 0'], [12, I + '0 -80 0']]) + '</object>\n' +
    '  <object id="15" ' + UU(15) + ' type="model">' + comps('object_4.model', [[14, I + '0 0 0']]) + '</object>\n' +
    '  <object id="16" ' + UU(16) + ' type="model">' + comps('object_4.model', [[14, I + '0 0 0']]) + '</object>\n' +
    ' </resources>\n <build ' + UU(0x999) + '>\n' +
    item(3, I + '28 28 0') + item(10, '1 0 0 0 -1 0 0 0 -1 ' + (S + 128) + ' 128 9') + item(13, I + '128 ' + (128 - S) + ' 0') +
    item(15, '0 0 -1 0 1 0 1 0 0 ' + (S + 106) + ' ' + (118 - S) + ' 50') + item(16, '0 0 -1 0 1 0 1 0 0 ' + (S + 106) + ' ' + (138 - S) + ' 50') +
    ' </build>\n</model>\n';
  const svgShape = '      <BambuStudioShape filepath="logo_test.svg" filepath3mf="' + SYNTH_SVG + '" scale="1e-05" depth="0.4" transform="' + I + '0 0 0" />\n';
  const ms = XML + '<config>\n' +
    object(3, 'scritta porta utensili', [part(1, 'normal_part', 'scritta porta utensili.stl', 2), part(2, 'normal_part', 'porta utensili.stl', 1)]) +
    object(15, 'gancio.stl', [part(14, 'normal_part', 'gancio.stl')]) + object(16, 'gancio.stl', [part(14, 'normal_part', 'gancio.stl')]) +
    object(10, 'coperchio.stl', [part(4, 'normal_part', 'coperchio.stl'), ...[5, 6, 7, 8].map(k => part(k, 'modifier_part', 'text_shape', 2)), part(9, 'modifier_part', 'logo_test', 2, svgShape)]) +
    object(13, 'scatola.stl', [part(11, 'normal_part', 'scatola.stl'), part(12, 'negative_part', 'text_shape', 1)]) +
    plate(1, [3]) + plate(2, [10]) + plate(3, [13]) + plate(4, [15, 16]) +
    '  <assemble>\n' + [3, 15, 16, 10, 13].map((id, k) => '   <assemble_item object_id="' + id + '" instance_id="0" transform="' + I + (k * 220) + ' 0 10" offset="0 0 0" />\n').join('') + '  </assemble>\n</config>\n';
  const seq = JSON.stringify(Object.fromEntries([1, 2, 3, 4].map(k => ['plate_' + k, { nozzle_sequence: [], optimal_assignment: [], sequence: [] }])));
  const porta = fflate.zipSync({
    '[Content_Types].xml': contentTypes, '_rels/.rels': rels,
    '3D/3dmodel.model': u8(root),
    '3D/_rels/3dmodel.model.rels': u8(XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + [1, 2, 3, 4].map(k => '<Relationship Target="/3D/Objects/object_' + k + '.model" Id="rel-' + k + '" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>').join('') + '</Relationships>'),
    // Schriftplatte 160×40×1 auf dem Boden 200×200×5
    '3D/Objects/object_1.model': u8(objFile([[1, mesh(0, 0, 0, 160, 40, 1)], [2, mesh(0, 0, 0, 200, 200, 5)]])),
    // Deckel 215×215×9; Schriftzüge 0,4 mm tief an der Unterseite des Netzes = oben nach dem Drehen des Build-Items
    '3D/Objects/object_2.model': u8(objFile([[4, mesh(-107.5, -107.5, 0, 107.5, 107.5, 9)], [5, mesh(-60, -8, 0, 60, 8, 0.4)], [6, mesh(-90, -8, 0, 90, 8, 0.4)],
      [7, mesh(-20, -8, 0, 20, 8, 0.4)], [8, mesh(-45, -8, 0, 45, 8, 0.4)], [9, mesh(-40, -40, 0, 40, 40, 0.4)]])),
    // Kasten 215×215×18 mit vertieftem Text im Boden
    '3D/Objects/object_3.model': u8(objFile([[11, mesh(-107.5, -107.5, 0, 107.5, 107.5, 18)], [12, mesh(-30, -6, 0, 30, 6, 0.4)]])),
    // Haken 50 lang, 12 breit, 43 tief – stehend nach dem Drehen um Y: 43×12 mm Grundfläche, 50 mm hoch
    '3D/Objects/object_4.model': u8(objFile([[14, mesh(0, -6, 0, 50, 6, 43)]])),
    [SYNTH_SVG]: u8('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'),
    'Metadata/model_settings.config': u8(ms),
    'Metadata/filament_sequence.json': u8(seq),
    'Metadata/project_settings.config': u8(settings('Bambu Lab P1S 0.4 nozzle', 2)),
    'Metadata/slice_info.config': u8(XML + '<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="02.07.01.62"/>\n  </header>\n</config>\n')
  });

  // ACE: Netz zentriert, Build-Item um X gedreht (y → z): 58 breit, 25 hoch, 60 tief
  const ace = fflate.zipSync({
    '[Content_Types].xml': contentTypes, '_rels/.rels': rels,
    '3D/3dmodel.model': u8(XML + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n' +
      ' <metadata name="Application">BambuStudio-1.3.3.3</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n' +
      '  <object id="1" type="model">' + mesh(-29, -12.5, -30, 29, 12.5, 30) + '</object>\n' +
      '  <object id="2" type="model"><components><component objectid="1" transform="' + I + '0 0 0"/></components></object>\n' +
      ' </resources>\n <build>\n  <item objectid="2" transform="1 0 0 0 2.22044605e-16 -1 0 1 2.22044605e-16 125 125 12.5" printable="1"/>\n </build>\n</model>\n'),
    'Metadata/model_settings.config': u8(XML + '<config>\n' + object(2, 'ACE Guide V2.stl', [part(1, 'normal_part', 'ACE Guide V2.stl')]) + plate(1, [2]) +
      '  <assemble>\n   <assemble_item object_id="2" instance_id="0" transform="' + I + '0 0 30" offset="0 0 0" />\n  </assemble>\n</config>\n'),
    'Metadata/project_settings.config': u8(settings('Bambu Lab X1 Carbon 0.4 nozzle', 1))
  });
  fs.mkdirSync(dir, { recursive: true });
  const P = path.join(dir, 'porta-nachgebaut.3mf'), A = path.join(dir, 'ace-nachgebaut.3mf');
  fs.writeFileSync(P, porta); fs.writeFileSync(A, ace);
  return [P, A];
}

{
  const [P, A] = synthMakerworld(path.join(OUT, 'synth'));
  // Aufbau der nachgebauten Dateien selbst prüfen – sonst prüften die Fälle unten womöglich etwas anderes als gedacht
  const pi = load(P), ai = load(A), lid = pi.parts.find(p => /coperchio/.test(p.name)), sc = pi.parts.find(p => /scritta/.test(p.name));
  const g = n => { const p = pi.parts.find(x => x.name === n), m = K.makeGeom(n, p.pos); return [m.mx[0] - m.mn[0], m.mx[1] - m.mn[1], m.mx[2] - m.mn[2]].map(v => +v.toFixed(2)); };
  check('[synth] Aufbau: porta 5 Objekte auf Platten 1,2,3,4,4', pi.parts.map(p => p.plate).sort().join() === '1,2,3,4,4', pi.parts.map(p => p.name + '@' + p.plate).join(', '));
  check('[synth] Aufbau: Schriftplatte Körper mit Slot 2', sc && sc.bodies && sc.bodies.map(b => b.extruder).join() === '2,1', sc && JSON.stringify(sc.bodies));
  check('[synth] Aufbau: Deckel 215×215×9 mm, Modifikator-Slot 2, steht auf dem Bett', lid && g('coperchio.stl').join() === '215,215,9' && JSON.stringify(lid.modifiers) === '[2]' && K.makeGeom('', lid.pos).mn[2] > -0.01, lid && [g('coperchio.stl'), lid.modifiers]);
  check('[synth] Aufbau: Haken stehen (43×12×50 mm)', pi.parts.filter(p => p.name === 'gancio.stl').length === 2 && g('gancio.stl').join() === '43,12,50', g('gancio.stl'));
  check('[synth] Aufbau: ACE 58×60×25 mm mittig auf Platte 1', ai.parts.length === 1 && (() => { const m = K.makeGeom('', ai.parts[0].pos);
    return [m.mx[0] - m.mn[0], m.mx[1] - m.mn[1], m.mx[2] - m.mn[2]].map(v => +v.toFixed(2)).join() === '58,60,25' && Math.abs(m.mn[2]) < 0.01 && Math.abs(m.mn[0] + m.mx[0] - 250) < 0.01; })());
  suite('synth', P, A, SYNTH_SVG);
}

// Echte Makerworld-Dateien (wenn vorhanden): Kopien in einen eigenen Ordner, die Originale bleiben unberührt
if (process.env.ARRANGE_REAL === '0') console.log('\nEchte Makerworld-Dateien abgeschaltet (ARRANGE_REAL=0)');
else if (![PORTA, ACE].every(f => fs.existsSync(f))) console.log('\nEchte Makerworld-Dateien fehlen (' + [PORTA, ACE].filter(f => !fs.existsSync(f)).join(', ') + ') – nur die nachgebauten geprüft');
else {
  const dir = path.join(OUT, 'echt'); fs.mkdirSync(dir);
  const copy = f => { const to = path.join(dir, path.basename(f)); fs.copyFileSync(f, to); return to; };
  suite('echt', copy(PORTA), copy(ACE), '3D/photo_5830413672373751700_x.svg');
}

/* 4) Drehen: zwei Designer-Platten mit 200×100 und 100×200 mm passen nur gedreht auf eine Platte.
   Das hohe Teil hat einen Modifikator mit Slot 2 – er muss mitgedreht werden. */
{
  const u8 = s => fflate.strToU8(s);
  const boxXml = (id, sx, sy, sz, ox = 0, oy = 0) => {
    const v = [[0,0,0],[sx,0,0],[sx,sy,0],[0,sy,0],[0,0,sz],[sx,0,sz],[sx,sy,sz],[0,sy,sz]].map(p => [p[0] + ox, p[1] + oy, p[2]]);
    const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
    return '<object id="' + id + '" type="model"><mesh><vertices>' + v.map(p => '<vertex x="' + p[0] + '" y="' + p[1] + '" z="' + p[2] + '"/>').join('') +
      '</vertices><triangles>' + f.map(t => '<triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"/>').join('') + '</triangles></mesh></object>';
  };
  const meta = (k, v) => '<metadata key="' + k + '" value="' + v + '"/>';
  const inst = id => '<model_instance>' + meta('object_id', id) + meta('instance_id', 0) + meta('identify_id', id) + '</model_instance>';
  const zip = fflate.zipSync({
    '[Content_Types].xml': u8('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': u8('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': u8('<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"><metadata name="Application">BambuStudio-01.09.00.00</metadata><resources>' +
      boxXml(1, 200, 100, 10) + boxXml(2, 100, 200, 10) + boxXml(3, 30, 30, 12, 35, 160) +
      '<object id="4" type="model"><components><component objectid="2"/><component objectid="3"/></components></object>' +
      '<object id="5" type="model"><components><component objectid="1"/></components></object></resources>' +
      '<build><item objectid="5" transform="1 0 0 0 1 0 0 0 1 28 78 0" printable="1"/><item objectid="4" transform="1 0 0 0 1 0 0 0 1 385 28 0" printable="1"/></build></model>'),
    'Metadata/model_settings.config': u8('<?xml version="1.0" encoding="UTF-8"?>\n<config>\n<object id="5">' + meta('name', 'breit') + meta('extruder', 1) + '<part id="1" subtype="normal_part">' + meta('name', 'breit') + '</part></object>\n' +
      '<object id="4">' + meta('name', 'hoch') + meta('extruder', 1) + '<part id="2" subtype="normal_part">' + meta('name', 'hoch') + '</part><part id="3" subtype="modifier_part">' + meta('name', 'Farbe') + meta('extruder', 2) + '</part></object>\n' +
      '<plate>' + meta('plater_id', 1) + inst(5) + '</plate>\n<plate>' + meta('plater_id', 2) + inst(4) + '</plate>\n</config>\n'),
    'Metadata/project_settings.config': u8(JSON.stringify(tpl.settings))
  });
  const f = path.join(OUT, 'drehen.3mf'); fs.writeFileSync(f, zip);
  const imp = load(f), parts = toParts(imp), threemf = imp.threemf;
  threemf.layout = 'auto';
  const lay = layoutOf(parts, threemf), hi = parts.findIndex(p => p.name === 'hoch');
  check('Drehen: 1 Platte, das hohe Teil gedreht', lay.count === 1 && lay.places[hi].rot && !lay.places[1 - hi].rot, JSON.stringify(lay.places));
  const t = build(parts, threemf);
  const ps = JSON.parse(fflate.strFromU8(t.z['Metadata/project_settings.config']));
  check('Drehen: Slot 2 (nur Modifikator) hat die Düsentemperatur des Teils', ps.nozzle_temperature[1] === ps.nozzle_temperature[0], ps.nozzle_temperature.join('/'));
  check('Drehen: Build-Item des hohen Teils um 90° gedreht', /<item objectid="4"[^>]*transform="0 1 0 -1 0 0 0 0 1 /.test(t.root), (t.root.match(/<item[^>]*>/g) || []).join(' '));
  check('Drehen: Modifikator (Slot 2) bleibt im Objekt', modifierOf(t.ms, 4).join() === '2');
  const re = reimport(t.res.bytes), b = re.boxes.find(x => x.name === 'hoch');
  check('Drehen: hohes Teil liegt jetzt 200 × 100 mm, beide auf dem Bett', b && Math.abs(b.x1 - b.x0 - 200) < 0.01 && Math.abs(b.y1 - b.y0 - 100) < 0.01 && re.boxes.every(onBed), re.boxes.map(fmtBox).join(' | '));
  cases.push({ name: 'drehen', bytes: t.res.bytes, count: 1, slot2Plate: 1, span: [200, 208] });
}

/* ---------- Orca-CLI ---------- */
function layerRanges(text) {
  // G1-Bahnen mit Extrusion in Schicht 2 (zweites ;LAYER_CHANGE)
  const parts = text.split(/^;LAYER_CHANGE/m), layer = parts[2] || '';
  let x = null, y = null; const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const line of layer.split('\n')) {
    if (!/^G[01] /.test(line)) continue;
    const gx = /X(-?[\d.]+)/.exec(line), gy = /Y(-?[\d.]+)/.exec(line);
    if (gx) x = +gx[1]; if (gy) y = +gy[1];
    if (/ E\.?\d/.test(line) && x !== null && y !== null) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
  }
  return bb;
}
const usedGrams = text => ((/^; filament used \[g\] = (.*)$/m.exec(text) || [])[1] || '').split(',').map(Number);
if (!fs.existsSync(ORCA)) console.log('\nOrca-CLI nicht gefunden (' + ORCA + ') – Slicen übersprungen');
else for (const c of cases) {
  const dir = path.join(OUT, c.name); fs.mkdirSync(dir);
  const file = path.join(dir, c.name + '.3mf'); fs.writeFileSync(file, c.bytes);
  try { execFileSync(ORCA, ['--slice', '0', '--outputdir', dir, file], { stdio: 'pipe', timeout: 600000 }); }
  catch (e) { check(c.name + ': Orca-CLI fehlgeschlagen', false, (e.stderr || e.stdout || e.message).toString().slice(-400)); continue; }
  const gfiles = fs.readdirSync(dir).filter(f => /^plate_\d+\.gcode$/.test(f)).sort();
  check(c.name + ': ' + gfiles.length + ' G-Code-Dateien (erwartet ' + c.count + ')', gfiles.length === c.count, gfiles.join(', '));
  for (const gf of gfiles) {
    const text = fs.readFileSync(path.join(dir, gf), 'utf8'), bb = layerRanges(text), g = usedGrams(text);
    check(c.name + ' ' + gf + ': Schicht 2 im Bett X ' + bb[0].toFixed(1) + '–' + bb[2].toFixed(1) + ', Y ' + bb[1].toFixed(1) + '–' + bb[3].toFixed(1) + ' (Filament g: ' + g.join('/') + ')',
      bb[0] >= 0 && bb[1] >= 0 && bb[2] <= BW && bb[3] <= BD && bb[2] > bb[0]);
    if (c.span) check(c.name + ' ' + gf + ': belegte Fläche ' + (bb[2] - bb[0]).toFixed(1) + ' × ' + (bb[3] - bb[1]).toFixed(1) + ' ≈ ' + c.span.join(' × ') + ' mm (Teil gedreht)',
      Math.abs(bb[2] - bb[0] - c.span[0]) < 2 && Math.abs(bb[3] - bb[1] - c.span[1]) < 2);
    const n = +gf.match(/\d+/)[0];
    if (c.slot2Plate === n) {
      const s = c.slotIdx ?? 1;
      check(c.name + ' ' + gf + ': Slot ' + (s + 1) + (c.lidName ? ' (Text-Modifikator ' + c.lidName + ')' : '') + ' wird gedruckt: ' + (g[s] || 0) + ' g', g[s] > 0, g.join('/'));
    }
    if (c.instances) {
      const objs = new Set([...text.matchAll(/^; start printing object, unique label id: (\d+)/gm)].map(m => m[1]));
      const defs = (text.match(/^EXCLUDE_OBJECT_DEFINE /gm) || []).length;
      check(c.name + ' ' + gf + ': ' + Math.max(objs.size, defs) + ' Objekte gedruckt (erwartet ' + c.instances + ')', Math.max(objs.size, defs) === c.instances);
    }
  }
}

console.log('\n' + pass + '/' + (pass + fail) + ' bestanden' + (fail ? '' : ' – OK') + '\nArbeitsordner: ' + OUT);
process.exit(fail ? 1 : 0);
