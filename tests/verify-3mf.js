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
  let supportMoves = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith(';TYPE:')) type = line.slice(6).trim();
    const mk = /^G9111 bedTemp=(\d+) extruderTemp=(\d+)/.exec(line); // Anycubic-Startmakro (Kobra S1)
    if (mk) { bedCmds.push(+mk[1]); nozzleCmds.push(+mk[2]); }
    const tn = /^M10[49] .*?S(\d+)/.exec(line); if (tn && +tn[1] > 0) nozzleCmds.push(+tn[1]);
    const tb = /^M1[49]0 .*?S(\d+)/.exec(line); if (tb && +tb[1] > 0) bedCmds.push(+tb[1]);
    if (!/^G[01] /.test(line)) continue;
    if (/^Support/i.test(type) && / E\.?\d/.test(line)) supportMoves++;
    const gx = /X(-?[\d.]+)/.exec(line), gy = /Y(-?[\d.]+)/.exec(line), ge = /E([\d.]+)/.exec(line);
    if (gx) x = +gx[1]; if (gy) y = +gy[1];
    if (ge && +ge[1] > 0 && x !== null && y !== null && /wall/i.test(type)) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
  }
  return { cfg, filament, maxZ, bb, nozzleCmds, bedCmds, supportMoves };
}

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FEHL ') + msg); if (!ok) failures++; };

// ONLY_MW=1: nur die Makerworld-Prüfung (schneller beim Entwickeln)
const ONLY_MW = !!process.env.ONLY_MW;
for (const [i, c] of (ONLY_MW ? [] : CASES).entries()) {
  const inp = { printer: c.printer, material: c.material, nozD: '0.4', nozM: NOZ_MAT[c.printer], object: c.object, goal: c.goal,
    load: c.load, support: c.support || 'auto', supportLevel: 'balanced', thresh: '45' };
  const geom = MODELS[c.model];
  const r = K.compute(inp, geom, { getMat: K.getMat, settings: K.store.settings });
  const tpl = K.exportTemplate(c.printer, '0.4');
  const { bytes } = K.build3mf(tpl, r, geom, c.slot, fflate, c.live);
  // 0) Orca-GUI übernimmt nur Schlüssel aus different_settings_to_system → jede Änderung muss dort stehen
  const ps = JSON.parse(fflate.strFromU8(fflate.unzipSync(bytes)['Metadata/project_settings.config']));
  const listed = ps.different_settings_to_system.map(s => s.split(';'));
  const unlisted = K.plannedChanges(r, c.slot, c.live).filter(p => p.key in ps && !listed[p.perSlot ? 1 + p.index : 0].includes(p.key));
  check(unlisted.length === 0 && listed.length === ps.filament_settings_id.length + 2, `Änderungsliste vollständig (${listed.length} Gruppen)` + (unlisted.length ? ': fehlt ' + unlisted.map(p => p.key).join(',') : ''));
  const wantPreset = (ps.filament_type[c.slot] || '').toUpperCase();
  check(ps.filament_settings_id[c.slot] === (tpl.filamentPresets[wantPreset] || ps.filament_settings_id[c.slot]) && ps.filament_settings_id[c.slot].includes(wantPreset), `Slot ${c.slot + 1} Preset „${ps.filament_settings_id[c.slot]}“ passt zu ${wantPreset}`);
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
  // 1b) Stützen werden tatsächlich gedruckt, wenn sie empfohlen sind – und sonst nicht
  check(r.supOn ? g.supportMoves > 0 : g.supportMoves === 0, `Stützen im G-Code: ${g.supportMoves} Bahnen (empfohlen: ${r.supOn ? 'ja' : 'nein'})`);
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

/* ---------- Mehrere Teile: Anordnung auf einer Platte bzw. Verteilung auf mehrere Platten ---------- */
function sliceParts(label, printer, parts, expectPlates) {
  const inp = { printer, material: 'pla_hs', nozD: '0.4', nozM: NOZ_MAT[printer], object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
  const r = K.compute(inp, parts[0], { getMat: K.getMat, settings: K.store.settings });
  const tpl = K.exportTemplate(printer, '0.4');
  const { bytes, plateCount } = K.build3mf(tpl, r, parts.map(geom => ({ geom })), 0, fflate);
  console.log(`\n${label}: ${printer} · ${parts.length} Teile`);
  check(plateCount === expectPlates, `${plateCount} Platte(n), erwartet ${expectPlates}`);
  const dir = path.join(OUT, label.replace(/\W+/g, '_')); fs.mkdirSync(dir);
  const file = path.join(dir, 'export.3mf'); fs.writeFileSync(file, bytes);
  try { execFileSync(ORCA, ['--slice', '0', '--outputdir', dir, file], { stdio: 'pipe', timeout: 240000 }); }
  catch (e) { check(false, 'Orca-CLI fehlgeschlagen: ' + (e.stderr || e.message).toString().slice(0, 300)); return null; }
  const gfiles = fs.readdirSync(dir).filter(f => f.endsWith('.gcode')).sort();
  check(gfiles.length === expectPlates, `G-Code je Platte: ${gfiles.join(', ')}`);
  return { tpl, gcodes: gfiles.map(f => parseGcode(fs.readFileSync(path.join(dir, f), 'utf8'))) };
}
const [bw1] = [250];
let res = ONLY_MW ? null : sliceParts('Mehrteilig', 'kobra_s1', [MODELS.cube, MODELS.mushroom, MODELS.pillar], 1);
if (res) {
  const g = res.gcodes[0], [bx, by] = res.tpl.bedCenter;
  const w = g.bb[2] - g.bb[0], sumW = MODELS.cube.x + MODELS.mushroom.x + MODELS.pillar.x + 2 * 8;
  check(Math.abs(g.maxZ - Math.max(MODELS.cube.z, MODELS.mushroom.z, MODELS.pillar.z)) < 0.3, `Höhe ${g.maxZ} = höchstes Teil`);
  check(Math.abs(w - sumW) < 1.5, `Teile nebeneinander: Wände über ${w.toFixed(1)} mm ≈ ${sumW.toFixed(1)} mm (inkl. 2 × 8 mm Abstand)`);
  check(Math.abs((g.bb[0] + g.bb[2]) / 2 - bx) < 1.5 && g.bb[0] > 0 && g.bb[2] < bw1, `Gruppe mittig auf dem Bett (${g.bb[0].toFixed(1)}–${g.bb[2].toFixed(1)}, Mitte ${bx})`);
}
const big = stl('platte.stl', boxTris(0, 0, 0, 200, 190, 3));
res = ONLY_MW ? null : sliceParts('Zwei Platten', 'snapmaker_u1', [big, big], 2);
if (res) res.gcodes.forEach((g, i) => {
  const [bx, by] = res.tpl.bedCenter, mx = (g.bb[0] + g.bb[2]) / 2, my = (g.bb[1] + g.bb[3]) / 2;
  check(Math.abs(mx - bx) < 1.5 && Math.abs(my - by) < 1.5 && Math.abs(g.bb[2] - g.bb[0] - 200) < 1.5, `Platte ${i + 1}: Teil mittig ${mx.toFixed(1)}/${my.toFixed(1)} ≈ ${bx}/${by}`);
});

/* ---------- Werte je Teil: PETG-Pilz mit Stützen in Slot 2, PLA-Würfel schnell im Standard-Slot 1 ---------- */
if (!ONLY_MW) {
  const base = { printer: 'snapmaker_u1', nozD: '0.4', nozM: NOZ_MAT.snapmaker_u1, load: 'medium', supportLevel: 'balanced', thresh: '45' };
  const ctxc = { getMat: K.getMat, settings: K.store.settings };
  const rA = K.compute({ ...base, material: 'petg', object: 'overhang', goal: 'strong', support: 'allow' }, MODELS.mushroom, ctxc);
  const rB = K.compute({ ...base, material: 'pla_hs', object: 'general', goal: 'fast', support: 'auto' }, MODELS.cube, ctxc);
  const tpl = K.exportTemplate('snapmaker_u1', '0.4');
  const { bytes, objectChanges } = K.build3mf(tpl, rB, [{ geom: MODELS.mushroom, r: rA, slot: 1 }, { geom: MODELS.cube, r: rB }], 0, fflate);
  console.log('\nWerte je Teil: pilz.stl PETG Slot 2 · wuerfel.stl PLA Slot 1');
  const own = (objectChanges[0] || { changes: [] }).changes.map(c => c.key);
  check(objectChanges.length === 1 && own.includes('enable_support') && own.includes('wall_loops'), 'Objekt-Einstellungen nur für den Pilz: ' + own.join(','));
  const dir = path.join(OUT, 'je_teil'); fs.mkdirSync(dir);
  const file = path.join(dir, 'export.3mf'); fs.writeFileSync(file, bytes);
  try {
    execFileSync(ORCA, ['--slice', '0', '--outputdir', dir, file], { stdio: 'pipe', timeout: 240000 });
    const text = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.gcode'))), 'utf8');
    // Bahnen je Objekt und Art zählen (Orca markiert Objekte mit "; printing object <name>")
    const per = {}; let obj = null, type = '';
    for (const line of text.split('\n')) {
      const po = /^; printing object (\S+)/.exec(line); if (po) { obj = po[1]; continue; }
      if (/^; stop printing object/.test(line)) { obj = null; continue; }
      if (line.startsWith(';TYPE:')) type = line.slice(6).trim();
      if (/^G1 .* E\.?\d/.test(line)) { const k = (obj || '-') + '|' + type; per[k] = (per[k] || 0) + 1; }
    }
    const supportOf = name => Object.entries(per).filter(([k]) => k.startsWith(name + '|') && /^Support/i.test(k.split('|')[1])).reduce((s, [, v]) => s + v, 0);
    check(supportOf('pilz.stl') > 0 && supportOf('wuerfel.stl') === 0, `Stützen nur am Pilz (Pilz ${supportOf('pilz.stl')}, Würfel ${supportOf('wuerfel.stl')})`);
    check(/^; filament: (2,1|1,2)$/m.test(text), 'Beide Slots im Einsatz: ' + (text.match(/^; filament: .*$/m) || ['?'])[0]);
    check(new RegExp('^M10[49] S' + rA.nozzle + ' T1', 'm').test(text), `Slot 2 (T1) heizt auf ${rA.nozzle} °C (PETG)`);
    const cfg = parseGcode(text).cfg, temps = cfg.nozzle_temperature.split(/[,;]/);
    check(temps[0] === String(rB.nozzle) && temps[1] === String(rA.nozzle), `Düsentemperaturen je Slot ${temps.slice(0, 2).join('/')} = ${rB.nozzle}/${rA.nozzle}`);
    check(cfg.wall_loops === String(rB.w) && cfg.enable_support === '0', `Globale Werte vom Würfel (Wände ${cfg.wall_loops}, Stützen ${cfg.enable_support})`);
  } catch (e) { check(false, 'Orca-CLI fehlgeschlagen: ' + (e.stderr || e.message).toString().slice(0, 300)); }
}

/* ---------- Makerworld-3MF auf den eigenen Drucker umstellen (optional: MW3MF=<Pfad>) ---------- */
const MW = process.env.MW3MF;
if (MW && fs.existsSync(MW)) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'import.js'), 'utf8'), ctx, { filename: 'import.js' });
  const I = vm.runInContext('({importModels, makeGeom, build3mfFromProject})', ctx);
  for (const printer of ['kobra_s1', 'snapmaker_u1']) {
    const imp = I.importModels([{ name: path.basename(MW), bytes: new Uint8Array(fs.readFileSync(MW)) }], fflate);
    const base = { printer, nozD: '0.4', nozM: NOZ_MAT[printer], material: 'petg', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
    const jobs = imp.parts.map(p => { const geom = I.makeGeom(p.name, p.pos);
      return { geom, slot: p.extruder - 1, part: { objectId: p.objectId, plate: p.plate }, r: K.compute(base, geom, { getMat: K.getMat, settings: K.store.settings }) }; });
    const tpl = K.exportTemplate(printer, '0.4');
    const res = I.build3mfFromProject(tpl, jobs[0].r, jobs, jobs[0].slot, fflate, null, imp.threemf);
    console.log(`\nMakerworld → ${printer}: ${jobs.length} Teile, ${res.plateCount} Platten` + (res.notes.length ? ' · Hinweise: ' + res.notes.join(' | ') : ''));
    const z = fflate.unzipSync(res.bytes), ps = JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config']));
    check(ps.printer_settings_id === tpl.printerPreset, `Druckerprofil ${ps.printer_settings_id}`);
    check(fflate.strFromU8(z['Metadata/model_settings.config']).includes('paint_color') === fflate.strFromU8(fflate.unzipSync(new Uint8Array(fs.readFileSync(MW)))['Metadata/model_settings.config']).includes('paint_color') && Object.keys(z).filter(k => k.startsWith('3D/Objects/')).length === 8, 'Geometrie-Dateien und Bemalung unverändert übernommen');
    const dir = path.join(OUT, 'mw_' + printer); fs.mkdirSync(dir);
    const file = path.join(dir, 'export.3mf'); fs.writeFileSync(file, res.bytes);
    try { execFileSync(ORCA, ['--slice', '0', '--outputdir', dir, file], { stdio: 'pipe', timeout: 400000 }); }
    catch (e) { check(false, 'Orca-CLI fehlgeschlagen: ' + (e.stderr || e.message).toString().slice(0, 300)); continue; }
    const gfiles = fs.readdirSync(dir).filter(f => /^plate_\d+\.gcode$/.test(f)).sort();
    check(gfiles.length === res.plateCount, `G-Code je Platte: ${gfiles.join(', ')}`);
    const [bx, by] = tpl.bedCenter;
    for (const gf of gfiles) {
      const id = +gf.match(/\d+/)[0], on = jobs.filter(j => j.part.plate === id), g = parseGcode(fs.readFileSync(path.join(dir, gf), 'utf8'));
      const mx = (g.bb[0] + g.bb[2]) / 2, my = (g.bb[1] + g.bb[3]) / 2, h = Math.max(...on.map(j => j.geom.z));
      const slots = [...new Set(on.map(j => String(j.slot + 1)))].sort().join(',');
      check(Math.abs(mx - bx) < 2 && Math.abs(my - by) < 2, `Platte ${id}: Mitte ${mx.toFixed(1)}/${my.toFixed(1)} ≈ Bett ${bx}/${by}`);
      check(Math.abs(g.maxZ - h) < 0.35, `Platte ${id}: Höhe ${g.maxZ} ≈ ${h.toFixed(2)} mm`);
      check(g.filament === slots, `Platte ${id}: Slot(s) ${g.filament} = ${slots}`);
      check(g.nozzleCmds.includes(jobs[0].r.nozzle), `Platte ${id}: PETG ${jobs[0].r.nozzle} °C wird geheizt (${[...new Set(g.nozzleCmds)].join('/')})`);
    }
  }
}

console.log(failures ? `\nFEHLGESCHLAGEN: ${failures} Prüfungen` : '\nOK: alle Werte kommen im Orca-G-Code an');
console.log('Arbeitsordner: ' + OUT);
process.exit(failures ? 1 : 0);
