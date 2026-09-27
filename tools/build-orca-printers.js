'use strict';
/* Erzeugt aus den Systemprofilen einer OrcaSlicer-Installation die Druckerauswahl des Tools:
     js/orca-printers/index.js        – Hersteller → Modelle → Düsen (klein, wird immer geladen)
     js/orca-printers/<hersteller>.js – aufgelöste Drucker-, Prozess- und Filamentprofile (wird bei Bedarf geladen)
   „Aufgelöst“ heißt: die inherits-Kette (z. B. Drucker → Hersteller-Basis → fdm_machine_common) ist zusammengeführt.
   Aufruf: node tools/build-orca-printers.js   (ORCA_PROFILES=<Pfad> optional)
   Neu erzeugen, wenn eine neue OrcaSlicer-Version andere Profile mitbringt. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORCA_PROFILES = process.env.ORCA_PROFILES || 'C:/Program Files/OrcaSlicer/resources/profiles';
const OUT = path.join(ROOT, 'js', 'orca-printers');
// Filamenttypen, die das Tool kennt (Materialtabelle) bzw. im Slot-Dialog anbietet
const FIL_TYPES = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PLA-CF', 'PETG-CF', 'PA', 'PC'];
// Diese Schlüssel beschreiben das Profil selbst und gehören nicht in die Einstellungen
const META = new Set(['type', 'name', 'inherits', 'from', 'instantiation', 'setting_id', 'filament_id', 'version', 'is_custom_defined',
  'compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition', 'description', 'renamed_from']);

// ---------- alle Profile einlesen ----------
const idx = { machine: new Map(), process: new Map(), filament: new Map() };
for (const vendor of fs.readdirSync(ORCA_PROFILES)) {
  for (const kind of Object.keys(idx)) {
    const dir = path.join(ORCA_PROFILES, vendor, kind);
    if (!fs.existsSync(dir)) continue;
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.json')) continue;
        try {
          const j = JSON.parse(fs.readFileSync(p, 'utf8'));
          const name = j.name || path.basename(p, '.json');
          if (!idx[kind].has(name)) idx[kind].set(name, { j, vendor });
        } catch (err) { console.warn('übersprungen (kein JSON): ' + p); }
      }
    })(dir);
  }
}

const cache = new Map();
function resolve(kind, name, depth = 0) {
  const key = kind + '|' + name;
  if (cache.has(key)) return cache.get(key);
  const e = idx[kind].get(name);
  if (!e || depth > 30) return null;
  const parent = e.j.inherits ? resolve(kind, e.j.inherits, depth + 1) || {} : {};
  const out = Object.assign({}, parent);
  for (const [k, v] of Object.entries(e.j)) if (!META.has(k)) out[k] = v;
  cache.set(key, out);
  return out;
}
const first = v => Array.isArray(v) ? v[0] : v;
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Filament je Typ für einen Drucker: zuerst Hersteller-Profile für genau diesen Drucker (bevorzugt „Generic“),
// sonst die allgemeinen Orca-Profile („Generic PLA @System“ …), die für alle Drucker gelten.
const instFil = [...idx.filament.entries()].filter(([, e]) => String(e.j.instantiation) === 'true');
function filamentsFor(machineName) {
  const pick = {};
  // Vorrang: „Generic …“, dann die Marke des Druckerherstellers (erstes Wort des Druckernamens), dann andere
  const brand = machineName.split(' ')[0].toLowerCase();
  const score = n => (/^generic\b/i.test(n) ? 0 : n.toLowerCase().startsWith(brand) ? 1 : /generic/i.test(n) ? 2 : 3);
  for (const [name, e] of instFil) {
    if (!(e.j.compatible_printers || []).includes(machineName)) continue;
    const r = resolve('filament', name); const t = String(first(r && r.filament_type) || '').toUpperCase();
    if (!FIL_TYPES.includes(t)) continue;
    if (!pick[t] || score(name) < score(pick[t])) pick[t] = name;
  }
  // Kein Generic-/Herstellerprofil (nur Fremdmarken wie „addnorth …“) → das allgemeine Orca-Profil
  for (const t of FIL_TYPES) if ((!pick[t] || score(pick[t]) >= 3) && idx.filament.has('Generic ' + t + ' @System')) pick[t] = 'Generic ' + t + ' @System';
  return pick;
}

/* Prozessprofil eines Druckers: das eingetragene Standardprofil; fehlt es (oder gibt es das nicht mehr),
   ein Profil, das Orca als passend für diesen Drucker kennzeichnet – bevorzugt „Standard“ mit einer
   Schichthöhe um die halbe Düse; sonst die Orca-Grundwerte (fdm_process_common). */
const instProc = [...idx.process.entries()].filter(([, e]) => String(e.j.instantiation) === 'true');
const FALLBACK_PROCESS = 'fdm_process_common';
function processFor(machineName, m) {
  const def = first(m.default_print_profile);
  if (def && resolve('process', def)) return def;
  const target = Number(first(m.nozzle_diameter) || 0.4) / 2;
  let best = null, bestScore = Infinity;
  for (const [name, e] of instProc) {
    if (!(e.j.compatible_printers || []).includes(machineName)) continue;
    const r = resolve('process', name); if (!r) continue;
    const score = Math.abs(Number(r.layer_height || 0.2) - target) * 10 + (/standard/i.test(name) ? 0 : 1);
    if (score < bestScore) { best = name; bestScore = score; }
  }
  return best || (resolve('process', FALLBACK_PROCESS) ? FALLBACK_PROCESS : null);
}

// ---------- Drucker sammeln ----------
const vendors = {};
let count = 0, skipped = 0;
for (const [name, e] of idx.machine) {
  if (String(e.j.instantiation) !== 'true') continue;
  const m = resolve('machine', name);
  const proc = m && processFor(name, m);
  if (!m || !proc || !m.printable_area) { skipped++; continue; }
  // printable_area steht teils als Liste, teils als Text „0x0,220x0,…“
  const area = Array.isArray(m.printable_area) ? m.printable_area : String(m.printable_area).split(',');
  const pts = area.map(p => String(p).split('x').map(Number));
  if (pts.some(p => p.length !== 2 || p.some(n => !Number.isFinite(n)))) { skipped++; continue; }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const v = vendors[e.vendor] || (vendors[e.vendor] = { printers: {}, processes: {}, filaments: {} });
  const fil = filamentsFor(name);
  v.printers[name] = {
    model: m.printer_model || name.replace(/ \d+(\.\d+)? nozzle$/, ''),
    nozzle: first(m.nozzle_diameter) || '0.4',
    extruders: (m.nozzle_diameter || [1]).length,
    bed: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)],
    center: [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2],
    process: proc, filaments: fil, machine: m
  };
  v.processes[proc] = resolve('process', proc);
  for (const f of Object.values(fil)) v.filaments[f] = resolve('filament', f);
  count++;
}

/* ---------- neutrales Grundgerüst für die Projektdatei ----------
   Eine Orca-Projektdatei enthält ~650 Schlüssel; die Profile liefern nur einen Teil davon, den Rest nimmt Orca
   aus seinen eingebauten Grundwerten. Die S1-Vorlage (von Orca gespeichert) enthält diese Grundwerte – ohne alle
   Schlüssel, die aus den S1-Profilen stammen (sonst würde z. B. der S1-Start-G-Code bei fremden Druckern landen). */
const fflate = require('../vendor/fflate.min.js');
const tplZip = fflate.unzipSync(new Uint8Array(fs.readFileSync(path.join(ROOT, 'templates', 'kobra_s1_0.4.3mf'))));
const tplSettings = JSON.parse(fflate.strFromU8(tplZip['Metadata/project_settings.config']));
const s1Machine = resolve('machine', tplSettings.printer_settings_id) || resolve('machine', 'Anycubic Kobra S1 0.4 nozzle') || {};
const s1Process = resolve('process', tplSettings.print_settings_id) || resolve('process', (tplSettings.inherits_group || [])[0]) || resolve('process', first(s1Machine.default_print_profile)) || {};
const s1Filaments = (tplSettings.filament_settings_id || []).map(n => resolve('filament', n) || {});
const fromS1 = new Set([s1Machine, s1Process, ...s1Filaments].flatMap(o => Object.keys(o)));
const nTpl = tplSettings.filament_settings_id.length;
// Filament-Schlüssel = je Slot eine Liste (so lang wie die Slots der Vorlage) und im Filamentprofil vorhanden
const filKeys = Object.keys(tplSettings).filter(k => Array.isArray(tplSettings[k]) && tplSettings[k].length === nTpl &&
  (k.startsWith('filament_') || s1Filaments.some(f => k in f)));
const base = {};
// print_compatible_printers nennt den Drucker der Vorlage – Orca lehnt Projekte ab, deren Prozessprofil nicht
// zum Drucker passt (Ursache der anfänglichen CLI-Fehler, gefunden 2026-09-27); wird je Drucker neu gesetzt
const PER_PRINTER = new Set(['print_compatible_printers']);
for (const [k, v] of Object.entries(tplSettings)) if (!fromS1.has(k) && !PER_PRINTER.has(k)) base[k] = v;
/* Schlüssel, die je Kopf (Extruder) gelten: beim S1 (1 Kopf, 4 Slots) einmal bzw. als Einzelwert, beim U1
   (4 Köpfe) viermal. Drucker mit mehreren Köpfen brauchen diese Listen in voller Länge, sonst lehnt Orca
   das Projekt ab (beobachtet 2026-09-27 bei allen Mehrkopf-Druckern). */
const u1Zip = fflate.unzipSync(new Uint8Array(fs.readFileSync(path.join(ROOT, 'templates', 'snapmaker_u1_0.4.3mf'))));
const u1Settings = JSON.parse(fflate.strFromU8(u1Zip['Metadata/project_settings.config']));
const u1Heads = (u1Settings.nozzle_diameter || []).length;
const extruderKeys = Object.keys(u1Settings).filter(k => Array.isArray(u1Settings[k]) && u1Settings[k].length === u1Heads &&
  !(Array.isArray(tplSettings[k]) && tplSettings[k].length === nTpl) && k !== 'flush_volumes_matrix');
if (Object.keys(s1Machine).length < 20) console.warn('WARNUNG: S1-Druckerprofil nicht aufgelöst – Grundgerüst enthält evtl. S1-Werte');

// ---------- schreiben ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const index = {};
let total = 0;
for (const [vendor, v] of Object.entries(vendors).sort()) {
  const file = slug(vendor) + '.js';
  const js = "'use strict';\n/* ERZEUGT von tools/build-orca-printers.js aus den OrcaSlicer-Systemprofilen – nicht von Hand bearbeiten. */\n" +
    'ORCA_PRINTER_DATA[' + JSON.stringify(vendor) + ']=' + JSON.stringify(v) + ';\n';
  fs.writeFileSync(path.join(OUT, file), js);
  total += js.length;
  index[vendor] = { file, printers: Object.fromEntries(Object.entries(v.printers).map(([n, p]) => [n, { model: p.model, nozzle: p.nozzle, bed: p.bed }])) };
}
const orcaVersion = (() => { try { return JSON.parse(fs.readFileSync(path.join(ORCA_PROFILES, 'OrcaFilamentLibrary.json'), 'utf8')).version || ''; } catch (e) { return ''; } })();
fs.writeFileSync(path.join(OUT, 'index.js'), "'use strict';\n/* ERZEUGT von tools/build-orca-printers.js – nicht von Hand bearbeiten. */\n" +
  'const ORCA_PRINTER_DATA={};\nconst ORCA_PRINTER_INDEX=' + JSON.stringify({ orcaProfiles: orcaVersion, vendors: index }) + ';\n' +
  '// Grundgerüst der Projektdatei (Orca-Grundwerte ohne S1-Profilwerte) und die Schlüssel, die je Filament-Slot gelten\n' +
  'const ORCA_PROJECT_BASE=' + JSON.stringify({ orcaVersion: (tplZip['Metadata/slice_info.config'] ? (/OrcaSlicer-Version" value="([^"]+)"/.exec(fflate.strFromU8(tplZip['Metadata/slice_info.config'])) || [])[1] : '') || '', settings: base, filamentKeys: filKeys, extruderKeys }) + ';\n');
console.log('Je Kopf: ' + extruderKeys.length + ' Schlüssel (' + extruderKeys.slice(0, 8).join(', ') + ' …)');
console.log('Grundgerüst: ' + Object.keys(base).length + ' von ' + Object.keys(tplSettings).length + ' Schlüsseln (ohne S1-Profilwerte), ' + filKeys.length + ' Filament-Schlüssel');
console.log(count + ' Drucker von ' + Object.keys(vendors).length + ' Herstellern, ' + skipped + ' ohne Prozessprofil übersprungen');
console.log('Herstellerdateien zusammen ' + (total / 1e6).toFixed(1) + ' MB, Index ' + (fs.statSync(path.join(OUT, 'index.js')).size / 1024).toFixed(0) + ' KB');
const biggest = fs.readdirSync(OUT).map(f => [f, fs.statSync(path.join(OUT, f)).size]).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log('größte: ' + biggest.map(([f, s]) => f + ' ' + (s / 1e6).toFixed(2) + ' MB').join(', '));
