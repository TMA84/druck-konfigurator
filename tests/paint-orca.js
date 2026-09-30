'use strict';
/* Bemalen (js/paint.js, js/paint-ui.js) gegen die echte OrcaSlicer-CLI: eigenes Netz exportieren (build3mf) und prüfen, ob
   der G-Code genau das Gemalte druckt.
     Farbe:  Pinselstrich (Kreis, Kapsel r = 8 mm von (20,40) nach (40,40)) auf einer 60-mm-Platte → Slot 2 oben nur dort
     Stützen: Tisch (Säule + Platte) ohne Stützen, Unterseite der Platte „erzwingen“ → Export setzt tree(manual), Orca stützt;
             halbe Unterseite → weniger Stützen; mit Stützen und „verhindern“ → keine Stützen
     Naht:   Würfel, Vorderseite „Naht hier“ → Nahtanfänge vorne; Rückseite „keine Naht“ → nicht hinten
   Ohne OrcaSlicer (ORCA=… bzw. Standardpfad) werden nur die Dateien geprüft. Aufruf: node tests/paint-orca.js */
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const fflate = require('../vendor/fflate.min.js');
const ROOT = path.join(__dirname, '..');
const ORCA = process.env.ORCA || '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer';
const HAVE_ORCA = fs.existsSync(ORCA);
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'paintorca-'));

const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'orient', 'holes', 'paint', 'export3mf'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({ makeGeom, compute, getMat, store, exportTemplate, build3mf, paintApply, paintCode, paintBrushCircle })', ctx);

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FEHL ' + name + (detail !== undefined ? ': ' + JSON.stringify(detail) : '')); } };
const box = (x0, y0, z0, x1, y1, z1) => { const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].flatMap(t => t.flatMap(i => v[i])); };
const tpl = K.exportTemplate('kobra_s1', '0.4');
const BASE = { printer: 'kobra_s1', material: 'pla_hs', nozD: '0.4', nozM: 'steel_hardened', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
const tri = (pos, t) => [0, 1, 2].map(k => Array.from(pos.slice(t * 9 + k * 3, t * 9 + k * 3 + 3)));

function exportPart(name, pos, part, overrides) {
  const geom = K.makeGeom(name + '.stl', Float32Array.from(pos));
  const r = K.compute({ ...BASE, overrides: overrides || null }, geom, { getMat: K.getMat, settings: K.store.settings });
  const res = K.build3mf(tpl, r, [{ geom, r, part: { ...part, geom } }], 0, fflate);
  const f = path.join(OUT, name + '.3mf'); fs.writeFileSync(f, res.bytes);
  return { f, z: fflate.unzipSync(res.bytes), r };
}
function slice(f) {
  const dir = f + '.out'; fs.mkdirSync(dir);
  execFileSync(ORCA, ['--slice', '0', '--outputdir', dir, f], { stdio: 'pipe', cwd: OUT, timeout: 600000 });
  return fs.readFileSync(path.join(dir, 'plate_1.gcode'), 'utf8').split('\n');
}
// Extrusionen (ohne Turm, Skirt, Brim) mit Werkzeug, Schicht und Art
function moves(g) {
  let tool = 0, x = 0, y = 0, layer = 0, feat = '', w = 0.45; const out = [];
  for (const l of g) {
    if (/^;LAYER_CHANGE/.test(l)) layer++;
    const F = /^;TYPE:(.*)/.exec(l); if (F) feat = F[1];
    const W = /^;WIDTH:([\d.]+)/.exec(l); if (W) w = +W[1];
    const T = /^T(\d+)/.exec(l); if (T) tool = +T[1];
    if (!/^G1 /.test(l)) continue;
    const X = /X([-\d.]+)/.exec(l), Y = /Y([-\d.]+)/.exec(l), E = /E([-\d.]+)/.exec(l), nx = X ? +X[1] : x, ny = Y ? +Y[1] : y;
    if (E && +E[1] > 0 && (X || Y) && !/tower|skirt|brim/i.test(feat)) out.push({ layer, tool, feat, w, x0: x, y0: y, x1: nx, y1: ny });
    x = nx; y = ny;
  }
  return out;
}
const bboxOf = ms => { const mn = [1e9, 1e9], mx = [-1e9, -1e9]; for (const s of ms) for (const [a, b] of [[s.x0, s.y0], [s.x1, s.y1]]) { mn[0] = Math.min(mn[0], a); mn[1] = Math.min(mn[1], b); mx[0] = Math.max(mx[0], a); mx[1] = Math.max(mx[1], b); } return { mn, mx }; };

/* 1) Farbe: Kapsel auf der Oberseite einer Platte */
{
  const pos = box(0, 0, 0, 60, 60, 3), codes = {};
  for (const t of [2, 3]) { const [a, b, c] = tri(pos, t); codes[t] = K.paintCode(K.paintApply({ s: 0 }, a, b, c, K.paintBrushCircle([20, 40, 3], [40, 40, 3], 8, [0, 0, -1]), 2, 0.25)); }
  const { f, z } = exportPart('farbe', pos, { paintUser: { rev: 1, codes, slots: [1] } });
  const mesh = fflate.strFromU8(z[Object.keys(z).find(k => /Objects\/.*\.model$/.test(k))]);
  check('Farbe: paint_color in den bemalten Dreiecken', (mesh.match(/paint_color="/g) || []).length === 2);
  check('Farbe: Slot 2 bekommt ein Filament', JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config'])).filament_settings_id.length >= 2);
  if (HAVE_ORCA) {
    const m = moves(slice(f)), last = Math.max(...m.map(s => s.layer)), top = m.filter(s => s.layer === last), { mn, mx } = bboxOf(top);
    const sc = [60 / (mx[0] - mn[0]), 60 / (mx[1] - mn[1])], t1 = top.filter(s => s.tool === 1);
    const b = { mn: [1e9, 1e9], mx: [-1e9, -1e9] }; let len = 0, cx = 0, cy = 0;
    for (const s of t1) { const l = Math.hypot(s.x1 - s.x0, s.y1 - s.y0); len += l; for (const [a, c] of [[s.x0, s.y0], [s.x1, s.y1]]) { const u = (a - mn[0]) * sc[0], v = (c - mn[1]) * sc[1]; b.mn[0] = Math.min(b.mn[0], u); b.mn[1] = Math.min(b.mn[1], v); b.mx[0] = Math.max(b.mx[0], u); b.mx[1] = Math.max(b.mx[1], v); }
      cx += ((s.x0 + s.x1) / 2 - mn[0]) * sc[0] * l; cy += ((s.y0 + s.y1) / 2 - mn[1]) * sc[1] * l; }
    const near = (v, w) => Math.abs(v - w) < 1.5;
    check('Farbe (Orca): Slot 2 oben genau im Strich (x 12–48, y 32–48)', t1.length && near(b.mn[0], 12) && near(b.mx[0], 48) && near(b.mn[1], 32) && near(b.mx[1], 48), [b.mn, b.mx].map(p => p.map(v => +v.toFixed(1))));
    check('Farbe (Orca): Mitte des Strichs bei (30, 40)', len && near(cx / len, 30) && near(cy / len, 40), [cx / len, cy / len]);
  }
}

/* 2) Stützen: Tisch ohne Stützen, Unterseite erzwingen (ganz und halb); mit Stützen verhindern */
{
  const pos = box(15, 15, 0, 25, 25, 20).concat(box(0, 0, 20, 40, 40, 25)), under = [12, 13];   // Unterseite der Platte
  const supCount = g => g.filter(l => /^;TYPE:Support/.test(l)).length, supLen = g => moves(g).filter(s => /Support/.test(s.feat)).reduce((n, s) => n + Math.hypot(s.x1 - s.x0, s.y1 - s.y0), 0);
  const ex = (name, codes, ov) => exportPart(name, pos, codes ? { paintSup: { rev: 1, codes, slots: [] } } : {}, ov);
  const off = { support: 'off' };
  const a = ex('stuetzen-aus', null, off), b = ex('stuetzen-erzwingen', { 12: '4', 13: '4' }, off), h = ex('stuetzen-halb', { 12: '4' }, off);
  const ms = z => fflate.strFromU8(z['Metadata/model_settings.config']);
  check('Stützen aus: Export ohne Stützen', a.r.supOn === false && !/key="enable_support" value="1"/.test(ms(a.z)) && String(JSON.parse(fflate.strFromU8(a.z['Metadata/project_settings.config'])).enable_support) === '0');
  check('Erzwingen ohne Stützen: Objekt bekommt enable_support 1 und tree(manual)', /key="enable_support" value="1"/.test(ms(b.z)) && /key="support_type" value="tree\(manual\)"/.test(ms(b.z)), ms(b.z).slice(0, 400));
  const c = ex('stuetzen-verhindern', { 12: '8', 13: '8' });
  check('Verhindern mit Stützen: Stützen bleiben eingeschaltet (auto)', c.r.supOn === true && !/tree\(manual\)/.test(ms(c.z)));
  if (HAVE_ORCA) {
    const ga = slice(a.f), gb = slice(b.f), gh = slice(h.f), gc = slice(c.f), gAuto = slice(ex('stuetzen-auto', null).f);
    check('Orca: ohne Stützen und ohne Malen keine Stützen', supCount(ga) === 0);
    check('Orca: erzwungen → Stützen unter der Platte', supCount(gb) > 0, supCount(gb));
    check('Orca: halbe Unterseite → weniger Stützen als ganze', supLen(gh) > 0 && supLen(gh) < supLen(gb) * 0.9, [supLen(gh), supLen(gb)].map(Math.round));
    check('Orca: Stützen automatisch → Stützen da', supCount(gAuto) > 0);
    check('Orca: verhindert → keine Stützen trotz automatisch', supCount(gc) === 0, supCount(gc));
  }
}

/* 3) Naht: Würfel 20 mm, Vorderseite (y min) bevorzugt, Rückseite gesperrt */
{
  const pos = box(0, 0, 0, 20, 20, 10);
  const starts = g => { const m = moves(g).filter(s => s.feat === 'Outer wall'); const { mn, mx } = bboxOf(m); const out = []; let prev = null;
    for (const s of m) { if (!prev || prev.layer !== s.layer || prev.x1 !== s.x0 || prev.y1 !== s.y0) out.push([s.x0 - mn[0], s.y0 - mn[1], mx[1] - mn[1]]); prev = s; } return out.slice(2); };
  const front = exportPart('naht-vorne', pos, { paintSeam: { rev: 1, codes: { 4: '4', 5: '4' }, slots: [] } });
  const back = exportPart('naht-nicht-hinten', pos, { paintSeam: { rev: 1, codes: { 8: '8', 9: '8' }, slots: [] } });
  const mesh = z => fflate.strFromU8(z[Object.keys(z).find(k => /Objects\/.*\.model$/.test(k))]);
  check('Naht: paint_seam im Export', (mesh(front.z).match(/paint_seam="4"/g) || []).length === 2 && (mesh(back.z).match(/paint_seam="8"/g) || []).length === 2);
  if (HAVE_ORCA) {
    const sf = starts(slice(front.f)), sb = starts(slice(back.f));
    check('Orca: Naht an der Vorderseite (y ≈ 0)', sf.length > 10 && sf.every(p => p[1] < 1), sf.slice(0, 3));
    check('Orca: keine Naht an der gesperrten Rückseite', sb.length > 10 && sb.every(p => p[1] < p[2] - 1), sb.slice(0, 3));
  }
}

if (!HAVE_ORCA) console.log('\nOrca-CLI nicht gefunden (' + ORCA + ') – nur die Dateien geprüft');
console.log('\n' + pass + '/' + (pass + fail) + ' bestanden' + (fail ? '' : ' – OK') + '\nArbeitsordner: ' + OUT);
process.exitCode = fail ? 1 : 0;
