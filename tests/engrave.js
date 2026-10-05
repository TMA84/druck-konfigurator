'use strict';
/* Beschriftung (js/engrave.js, js/font-hershey.js, Export in js/export3mf.js):
   Schriftumfang, gültiges Netz, Lage auf der Oberseite eines Quaders, 3MF mit erhabener und vertiefter Schrift
   (Bauteil-Subtypen und Slots in model_settings.config) und – wenn die Orca-CLI da ist – Slicen beider Fälle.
   Aufruf: node tests/engrave.js   (ORCA=<Pfad zur Orca-CLI> optional; fehlt sie, entfällt der Orca-Teil) */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const fflate = require('../vendor/fflate.min.js');

const ROOT = path.join(__dirname, '..');
const ORCA = process.env.ORCA || (process.platform === 'darwin' ? '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer' : 'C:\\Program Files\\OrcaSlicer\\orca-slicer.exe');
const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'orient', 'holes', 'font-hershey', 'engrave', 'brim-ears', 'export3mf', 'purge'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({HERSHEY_SIMPLEX, textStrokes, textSolid, textMesh, topFace, faceAnchor, coplanarRegion, anchorToOrig, textWarnings, unknownChars, makeGeom, rotatePositions, rotateAxis, compute, getMat, store, exportTemplate, build3mf})', ctx);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('ok   ' + name + (detail !== undefined ? ' (' + detail + ')' : '')); } else { fail++; console.log('FEHL ' + name + (detail !== undefined ? ': ' + detail : '')); } }
const r1 = v => Math.round(v * 10) / 10;

function boxTris(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].map(t => t.map(i => v[i]));
}
const boxGeom = (name, ...b) => K.makeGeom(name, Float32Array.from(boxTris(...b).flat(2)));
function bbox(pos) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const k = i % 3; mn[k] = Math.min(mn[k], pos[i]); mx[k] = Math.max(mx[k], pos[i]); }
  return { mn, mx, size: [0, 1, 2].map(k => mx[k] - mn[k]) };
}
// Signiertes Volumen (positiv = Normalen nach außen)
function signedVolume(pos) {
  let v = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.subarray(i, i + 9);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

/* ---------- 1) Schriftumfang ---------- */
const need = [];
for (let c = 32; c <= 126; c++) need.push(String.fromCharCode(c));
need.push(...'ÄÖÜäöüß€°');
const missing = need.filter(c => !K.HERSHEY_SIMPLEX.glyphs[c]);
check('Schrift: ASCII 32–126, ÄÖÜäöüß, €, °', !missing.length, missing.join(''));
check('Unbekannte Zeichen erkannt', K.unknownChars('Aé✓').join('') === 'é✓', K.unknownChars('Aé✓').join(''));
const badGlyph = need.filter(c => { const d = K.HERSHEY_SIMPLEX.glyphs[c]; return d.length % 2 || [...d].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126); });
check('Zeichendaten im JHF-Format (Paare druckbarer Zeichen)', !badGlyph.length, badGlyph.join(''));

/* ---------- 2) Netz ---------- */
const H = 8, S = 0.12;
const st = K.textStrokes('HALLO', H, S);
const solid = K.textSolid('HALLO', { height: H, stroke: S, z0: 0, z1: 1 });
const bb = bbox(solid);
check('Netz: nur endliche Werte', solid.every(Number.isFinite));
check('Netz: vollständige Dreiecke, sinnvolle Anzahl', solid.length % 9 === 0 && solid.length / 9 > 200 && solid.length / 9 < 20000, solid.length / 9 + ' Dreiecke');
check('Netz: Höhe ≈ Versalhöhe + Strich (' + r1(H * (1 + S)) + ' mm)', Math.abs(bb.size[1] - H * (1 + S)) < 0.05, r1(bb.size[1]));
check('Netz: Breite = Breite der Striche, zentriert', Math.abs(bb.size[0] - st.w) < 0.05 && Math.abs(bb.mn[0] + bb.mx[0]) < 0.01 && Math.abs(bb.mn[1] + bb.mx[1]) < 0.01, r1(bb.size[0]) + ' mm');
check('Netz: Tiefe 1 mm, Normalen nach außen (Volumen > 0)', Math.abs(bb.size[2] - 1) < 1e-6 && signedVolume(solid) > 0, r1(signedVolume(solid)) + ' mm³');
const wide = K.textStrokes('Größe 20 °C €', H, S);
check('Umlaute/Sonderzeichen erzeugen Striche', wide.strokes.length >= 17 && wide.w > 60, wide.strokes.length + ' Striche, ' + r1(wide.w) + ' mm');

/* ---------- 3) Lage auf der Oberseite ---------- */
const box = boxGeom('quader.stl', 0, 0, 0, 60, 30, 10);
const top = K.topFace(box);
check('Oberseite gefunden: z = 10, Mitte 30/15, Normale +Z', top && Math.abs(top.p[2] - 10) < 1e-6 && Math.abs(top.p[0] - 30) < 1e-6 && Math.abs(top.p[1] - 15) < 1e-6 && top.n[2] > 0.999, top && top.p.map(r1).join('/'));
check('Leserichtung entlang X (längere Seite)', top && Math.abs(top.u[0] - 1) < 1e-9, top && top.u.join(','));
const tx = { text: 'HALLO', height: H, depth: 1, stroke: S, mode: 'raised', slot: 1, rot: 0, anchor: K.anchorToOrig(top, null) };
const m = K.textMesh(tx, null), mb = bbox(m);
check('Erhaben: sitzt auf der Oberseite (z 10 … 11), mittig', Math.abs(mb.mn[2] - 9.98) < 1e-3 && Math.abs(mb.mx[2] - 11) < 1e-6 && Math.abs((mb.mn[0] + mb.mx[0]) / 2 - 30) < 0.01 && Math.abs((mb.mn[1] + mb.mx[1]) / 2 - 15) < 0.01, mb.mn.map(r1).join('/') + ' … ' + mb.mx.map(r1).join('/'));
check('Ohne Hinweis, wenn der Text auf die Fläche passt', K.textWarnings(box, tx, null, top.region).length === 0, K.textWarnings(box, tx, null, top.region).join(' | '));
const big = { ...tx, text: 'VIEL ZU LANGER TEXT' };
check('Hinweis, wenn der Text über Fläche und Teil ragt', K.textWarnings(box, big, null, top.region).length === 2, K.textWarnings(box, big, null, top.region).join(' | '));
const r90 = bbox(K.textMesh({ ...tx, rot: 90 }, null));
check('Drehung 90°: Text läuft entlang Y', Math.abs(r90.size[1] - mb.size[0]) < 0.01 && Math.abs(r90.size[0] - mb.size[1]) < 0.01);
const eng = bbox(K.textMesh({ ...tx, mode: 'engraved' }, null));
check('Vertieft: Abzugskörper z 9 … 10,3', Math.abs(eng.mn[2] - 9) < 1e-6 && Math.abs(eng.mx[2] - 10.3) < 1e-6);
// Seitenfläche: vorne (−Y), Text liest sich von vorn (u = +X), oben = +Z
const front = K.faceAnchor(box, [...Array(box.n).keys()].find(i => { const o = i * 9; return box.pos[o + 1] === 0 && box.pos[o + 4] === 0 && box.pos[o + 7] === 0; }), [30, 0, 5]);
check('Vorderseite: Normale −Y, Leserichtung +X', front.n[1] < -0.999 && front.u[0] > 0.999, front.n.join(',') + ' / ' + front.u.join(','));
// Teil gedreht: Anker in origPos-Koordinaten folgt der Drehung
const R = K.rotateAxis('x', 90), rot = K.makeGeom('gedreht', K.rotatePositions(box.pos, R));
const mr = bbox(K.textMesh(tx, R));
check('Nach Drehung des Teils bleibt der Text auf „seiner“ Fläche', Math.abs(mr.mn[1] - 9.98) < 1e-3 || Math.abs(mr.mx[1] + 9.98) < 1e-3 || Math.abs(mr.mn[1] - rot.mx[1]) < 0.03 || Math.abs(mr.mx[1] - rot.mn[1]) < 0.03, mr.mn.map(r1).join('/') + ' … ' + mr.mx.map(r1).join('/'));

/* ---------- 4) 3MF ---------- */
const inp = { printer: 'kobra_s1', material: 'pla_hs', nozD: '0.4', nozM: 'steel_hardened', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
const r = K.compute(inp, box, { getMat: K.getMat, settings: K.store.settings });
const tpl = K.exportTemplate('kobra_s1', '0.4');
const cases = {
  ohne: [{ geom: box, r }],
  erhaben: [{ geom: box, r, texts: [tx] }],
  vertieft: [{ geom: box, r, texts: [{ ...tx, text: 'HALLO', height: 10, depth: 1.2, mode: 'engraved', slot: null }] }]
};
const files = {};
for (const [label, parts] of Object.entries(cases)) {
  const { bytes } = K.build3mf(tpl, r, parts, 0, fflate);
  const z = fflate.unzipSync(bytes), ms = fflate.strFromU8(z['Metadata/model_settings.config']), ps = JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config']));
  const obj = fflate.strFromU8(z['3D/Objects/object_1.model']), comps = (fflate.strFromU8(z['3D/3dmodel.model']).match(/<component /g) || []).length;
  const normal = (ms.match(/subtype="normal_part"/g) || []).length, neg = (ms.match(/subtype="negative_part"/g) || []).length;
  if (label === 'erhaben') {
    check('3MF erhaben: zwei normal_part, Schrift mit Slot 2', normal === 2 && neg === 0 && /<metadata key="name" value="Schrift „HALLO“"\/>\s*<metadata key="matrix"[^>]*>\s*<metadata key="extruder" value="2"\/>/.test(ms), normal + ' normal / ' + neg + ' negativ');
    check('3MF erhaben: Slot 2 bekommt die Filamentwerte (PLA)', ps.filament_type[1] === 'PLA' && ps.nozzle_temperature[1] === String(r.nozzle), ps.filament_type[1] + ' ' + ps.nozzle_temperature[1]);
    check('3MF erhaben: zwei Netze, zwei Komponenten', (obj.match(/<object /g) || []).length === 2 && comps === 2);
  }
  if (label === 'vertieft') {
    check('3MF vertieft: normal_part + negative_part ohne eigenen Slot', normal === 1 && neg === 1 && !/negative_part">[\s\S]*?extruder[\s\S]*?<\/part>/.test(ms), normal + ' normal / ' + neg + ' negativ');
    check('3MF vertieft: Abzugskörper ohne Füllungswert des Loch-Modifikators', !/sparse_infill_density/.test(ms));
  }
  files[label] = bytes;
}

/* ---------- 5) Orca-CLI ---------- */
if (!fs.existsSync(ORCA)) console.log('\n(Orca-CLI nicht gefunden: ' + ORCA + ' – Slicen übersprungen)');
else {
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'engrave-'));
  const res = {};
  for (const [label, bytes] of Object.entries(files)) {
    const dir = path.join(OUT, label); fs.mkdirSync(dir);
    const file = path.join(dir, 'export.3mf'); fs.writeFileSync(file, bytes);
    try { execFileSync(ORCA, ['--slice', '0', '--outputdir', dir, file], { stdio: 'pipe', timeout: 300000 }); }
    catch (e) { check(false, label + ': Orca-CLI fehlgeschlagen', (e.stderr || e.message).toString().slice(0, 300)); continue; }
    const gf = fs.readdirSync(dir).find(f => f.endsWith('.gcode'));
    if (!gf) { check(false, label + ': kein G-Code'); continue; }
    const text = fs.readFileSync(path.join(dir, gf), 'utf8');
    const grams = ((text.match(/^; filament used \[g\] = (.*)$/m) || [])[1] || '').split(',').map(Number);
    let maxZ = 0, zc = 0; const top = [];
    for (const line of text.split('\n')) {
      const zm = /^;Z:([\d.]+)/.exec(line); if (zm) zc = +zm[1];
      if (/^G1 .*E\.?\d/.test(line) && /X/.test(line)) { maxZ = Math.max(maxZ, zc); if (zc > 9.5 && zc <= 10.01) { const x = /X([\d.-]+)/.exec(line), y = /Y([\d.-]+)/.exec(line); if (x && y) top.push([+x[1], +y[1]]); } }
    }
    res[label] = { grams, maxZ, top };
    console.log('     ' + label + ': Filament [g] = ' + grams.join(', ') + ' · höchste Schicht ' + maxZ + ' mm');
  }
  if (res.erhaben) check('Orca erhaben: Schrift-Slot 2 hat Filament > 0 g, Höhe 11 mm', res.erhaben.grams[1] > 0 && Math.abs(res.erhaben.maxZ - 11) < 0.25, 'Slot 2: ' + res.erhaben.grams[1] + ' g, ' + res.erhaben.maxZ + ' mm');
  if (res.ohne && res.vertieft) {
    const a = res.ohne.grams[0], b = res.vertieft.grams[0];
    // Schnitt: in den obersten Schichten (z 9,5 … 10) liegen Bahnen der Buchstabenwände mitten im Textbereich;
    // ohne Text läuft dort nur die durchgehende Deckfläche (Bahnenden am Rand)
    const xs = res.ohne.top.map(p => p[0]), ys = res.ohne.top.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const near = pts => pts.filter(([x, y]) => Math.abs(x - cx) < 15 && Math.abs(y - cy) < 5).length;
    check('Orca vertieft: weniger Filament oder Schnitt in den obersten Schichten', b < a || near(res.vertieft.top) > near(res.ohne.top) + 50, a + ' g → ' + b + ' g; Bahnpunkte im Textbereich oben ' + near(res.ohne.top) + ' → ' + near(res.vertieft.top));
    check('Orca vertieft: Höhe bleibt 10 mm (Abzugskörper wird nicht gedruckt)', Math.abs(res.vertieft.maxZ - 10) < 0.25, res.vertieft.maxZ);
  }
}

console.log('\n' + pass + ' ok, ' + fail + ' fehlgeschlagen');
process.exitCode = fail ? 1 : 0;
