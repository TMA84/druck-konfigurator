'use strict';
/* Prüft den 3MF-Export gegen die echte OrcaSlicer-CLI: erzeugte 3MF headless slicen und
   aus dem G-Code ablesen, ob Werte, Slot, Position und Höhe tatsächlich angekommen sind.
   Aufruf: node tests/verify-3mf.js   (ORCA=<Pfad zur orca-slicer.exe> optional) */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const fflate = require('../vendor/fflate.min.js');

const ROOT = path.join(__dirname, '..');
const ORCA = process.env.ORCA || 'C:\\Program Files\\OrcaSlicer\\orca-slicer.exe';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'verify3mf-'));

const ctx = vm.createContext({ console, TextDecoder });
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'export3mf'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({compute,getMat,store,parseSTL,exportTemplate,build3mf,plannedChanges})', ctx);

/* ---------- Testmodelle ---------- */
function boxTris(x0, y0, z0, x1, y1, z1) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].map(t => t.map(i => v[i]));
}
function stl(name, tris) {
  const b = Buffer.alloc(84 + tris.length * 50); b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.flat().forEach((c, j) => b.writeFloatLE(c, 84 + i * 50 + 12 + j * 4)));
  return K.parseSTL(name, b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}
// absichtlich nicht im Ursprung, damit die Zentrierung auf dem Bett geprüft wird
const MODELS = {
  cube: stl('wuerfel.stl', boxTris(40, 40, 5, 60, 60, 25)),
  mushroom: stl('pilz.stl', [...boxTris(15, 15, 0, 25, 25, 20), ...boxTris(0, 0, 20, 40, 40, 25)]),
  pillar: stl('saeule.stl', boxTris(0, 0, 0, 8, 8, 40))
};

const CASES = [
  { printer: 'kobra_s1', material: 'pla_hs', object: 'general', goal: 'balanced', load: 'medium', model: 'cube', slot: 0 },
  { printer: 'kobra_s1', material: 'petg', object: 'overhang', goal: 'quality', load: 'high', support: 'allow', model: 'mushroom', slot: 2 },
  { printer: 'snapmaker_u1', material: 'tpu', object: 'tire', goal: 'balanced', load: 'medium', model: 'pillar', slot: 1 },
  { printer: 'snapmaker_u1', material: 'petg_hs', object: 'precision', goal: 'fast', load: 'low', model: 'cube', slot: 3 },
  { printer: 'snapmaker_u1', material: 'abs', object: 'holder', goal: 'strong', load: 'high', support: 'allow', model: 'mushroom', slot: 0 },
  // mit Live-Belegung vom Drucker (Stand der Abfrage am 26.09.2026)
  { printer: 'kobra_s1', material: 'petg', object: 'general', goal: 'balanced', load: 'medium', model: 'cube', slot: 1,
    live: [{ type: 'PLA', colour: '#AFAFAF' }, { type: 'PETG', colour: '#75787B' }, { type: 'PETG', colour: '#212721' }, { type: 'PETG', colour: '#212721' }] },
  { printer: 'snapmaker_u1', material: 'abs', object: 'general', goal: 'balanced', load: 'medium', model: 'cube', slot: 2,
    live: [{ type: 'PLA', colour: '#BEC9A5' }, { type: 'PLA', colour: '#8C9099' }, { type: 'ABS', colour: '#000000' }, { type: 'PETG', colour: '#000000' }] }
];
const NOZ_MAT = { kobra_s1: 'steel_hardened', snapmaker_u1: 'steel_stainless' };

/* ---------- G-Code auswerten ---------- */
function parseGcode(text) {
  const cfg = {};
  for (const m of text.matchAll(/^; ([a-z0-9_]+) = (.*)$/gm)) cfg[m[1]] = m[2].trim();
  const filament = (text.match(/^; filament: (\d+)/m) || [])[1];
  const maxZ = Number((text.match(/^; max_z_height: ([\d.]+)/m) || [])[1]);
  // XY-Bereich der Wand-Extrusionen (;TYPE: … wall) als Lagekontrolle – ohne Reinigungslinie, Brim, Stützen
  let x = null, y = null, type = ''; const bb = [Infinity, Infinity, -Infinity, -Infinity];
  const nozzleCmds = [], bedCmds = [];
  for (const line of text.split('\n')) {
    if (line.startsWith(';TYPE:')) type = line.slice(6).trim();
    const mk = /^G9111 bedTemp=(\d+) extruderTemp=(\d+)/.exec(line); // Anycubic-Startmakro (Kobra S1)
    if (mk) { bedCmds.push(+mk[1]); nozzleCmds.push(+mk[2]); }
    const tn = /^M10[49] .*?S(\d+)/.exec(line); if (tn && +tn[1] > 0) nozzleCmds.push(+tn[1]);
    const tb = /^M1[49]0 .*?S(\d+)/.exec(line); if (tb && +tb[1] > 0) bedCmds.push(+tb[1]);
    if (!/^G[01] /.test(line)) continue;
    const gx = /X(-?[\d.]+)/.exec(line), gy = /Y(-?[\d.]+)/.exec(line), ge = /E([\d.]+)/.exec(line);
    if (gx) x = +gx[1]; if (gy) y = +gy[1];
    if (ge && +ge[1] > 0 && x !== null && y !== null && /wall/i.test(type)) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
  }
  return { cfg, filament, maxZ, bb, nozzleCmds, bedCmds };
}

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FEHL ') + msg); if (!ok) failures++; };

for (const [i, c] of CASES.entries()) {
  const inp = { printer: c.printer, material: c.material, nozD: '0.4', nozM: NOZ_MAT[c.printer], object: c.object, goal: c.goal,
    load: c.load, support: c.support || 'auto', supportLevel: 'balanced', thresh: '45' };
  const geom = MODELS[c.model];
  const r = K.compute(inp, geom, { getMat: K.getMat, settings: K.store.settings });
  const tpl = K.exportTemplate(c.printer, '0.4');
  const { bytes } = K.build3mf(tpl, r, geom, c.slot, fflate, c.live);
  const dir = path.join(OUT, 'case' + i); fs.mkdirSync(dir);
  const file = path.join(dir, 'export.3mf'); fs.writeFileSync(file, bytes);
  console.log(`\nFall ${i + 1}: ${c.printer} · ${r.m.name} · ${r.ob.label} · Slot ${c.slot + 1} · ${geom.name}`);
  try { execFileSync(ORCA, ['--slice', '0', '--outputdir', dir, file], { stdio: 'pipe', timeout: 240000 }); }
  catch (e) { check(false, 'Orca-CLI fehlgeschlagen: ' + (e.stderr || e.message).toString().slice(0, 300)); continue; }
  const gfile = fs.readdirSync(dir).find(f => f.endsWith('.gcode'));
  if (!gfile) { check(false, 'kein G-Code erzeugt'); continue; }
  const g = parseGcode(fs.readFileSync(path.join(dir, gfile), 'utf8'));

  // 1) Jeder geplante Wert muss im G-Code-Fuß stehen (Slot-Werte an Position des Slots)
  for (const p of K.plannedChanges(r, c.slot, c.live)) {
    const raw = g.cfg[p.key];
    if (raw === undefined) { check(false, `${p.key}: fehlt im G-Code`); continue; }
    const got = p.perSlot ? raw.split(/[,;]/)[p.index] : raw;
    if (got === undefined) { check(false, `${p.key}: kein Wert für Slot ${p.index + 1} (${raw})`); continue; }
    const same = got.toUpperCase() === p.value.toUpperCase() || (!isNaN(+got) && !isNaN(+p.value) && Math.abs(+got - +p.value) < 1e-6) || got.replace(/%$/, '') === p.value.replace(/%$/, '');
    check(same, `${p.label} (${p.key}): erwartet ${p.value}, im G-Code ${got}`);
  }
  // 2) Das Modell druckt mit dem gewählten Slot
  check(g.filament === String(c.slot + 1), `Slot: erwartet ${c.slot + 1}, G-Code "; filament: ${g.filament}"`);
  // 3) Tatsächliche Befehle: Düsen- und Betttemperatur
  const uniq = a => [...new Set(a)].join('/');
  check(g.nozzleCmds.includes(r.nozzle) && Math.max(...g.nozzleCmds) === r.nozzle, `Düsen-Befehle (M104/M109/G9111) ${uniq(g.nozzleCmds)}: ${r.nozzle} °C gesetzt, nichts höher`);
  check(g.bedCmds.includes(r.m.bed) && Math.max(...g.bedCmds) === r.m.bed, `Bett-Befehle (M140/M190/G9111) ${uniq(g.bedCmds)}: ${r.m.bed} °C gesetzt, nichts höher`);
  // 4) Höhe und Lage auf dem Bett
  check(Math.abs(g.maxZ - geom.z) <= r.layer + 0.05, `Höhe ${g.maxZ} mm ≈ Modell ${geom.z.toFixed(2)} mm`);
  const [bx, by] = tpl.bedCenter, mx = (g.bb[0] + g.bb[2]) / 2, my = (g.bb[1] + g.bb[3]) / 2;
  const w = g.bb[2] - g.bb[0], d = g.bb[3] - g.bb[1];
  check(Math.abs(mx - bx) < 1.5 && Math.abs(my - by) < 1.5, `Mitte der Wände ${mx.toFixed(1)}/${my.toFixed(1)} ≈ Bettmitte ${bx}/${by}`);
  check(Math.abs(w - geom.x) < 1.5 && Math.abs(d - geom.y) < 1.5, `Wände ${w.toFixed(1)} × ${d.toFixed(1)} mm ≈ Modell ${geom.x.toFixed(1)} × ${geom.y.toFixed(1)} mm`);
}

console.log(failures ? `\nFEHLGESCHLAGEN: ${failures} Prüfungen` : '\nOK: alle Werte kommen im Orca-G-Code an');
console.log('Arbeitsordner: ' + OUT);
process.exit(failures ? 1 : 0);
