'use strict';
/* Wandelt die in OrcaSlicer gespeicherten Vorlagen (templates/<drucker>_<düse>.3mf) in
   js/orca-templates.js um. Nötig, weil der Browser über file:// keine Dateien nachladen darf.
   Nur erneut ausführen, wenn eine Vorlage neu gespeichert wurde:  node tools/build-orca-templates.js */
const fs = require('fs');
const path = require('path');
const fflate = require('../vendor/fflate.min.js');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'templates');
const OUT = path.join(ROOT, 'js', 'orca-templates.js');
const ORCA_PROFILES = process.env.ORCA_PROFILES || 'C:/Program Files/OrcaSlicer/resources/profiles';

// System-Filamentpresets je Drucker/Düse aus der Orca-Installation: Filamenttyp → Presetname.
// Damit bekommt jeder Slot im Export das Preset, das zum echten Filament passt.
const PRESET_SOURCES = {
  kobra_s1: { '0.4': { vendor: 'Anycubic', re: /^Anycubic (.+) @Anycubic Kobra S1 0\.4 nozzle$/ } },
  snapmaker_u1: { '0.4': { vendor: 'Snapmaker', re: /^Snapmaker (.+) @U1$/ } }
};
function filamentPresets(printer, nozzle) {
  const src = (PRESET_SOURCES[printer] || {})[nozzle];
  if (!src) return {};
  const dir = path.join(ORCA_PROFILES, src.vendor, 'filament');
  if (!fs.existsSync(dir)) { console.warn(`WARNUNG: ${dir} fehlt – Export behält die Presetnamen der Vorlage`); return {}; }
  const presets = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const name = f.slice(0, -5), m = src.re.exec(name);
    if (m) presets[m[1].toUpperCase()] = name;  // z. B. PETG → "Anycubic PETG @Anycubic Kobra S1 0.4 nozzle"
  }
  return presets;
}

/* Werte der System-Filamentpresets (Vererbung aufgelöst), nur Schlüssel, die die Vorlage je Slot führt und die
   vom Vorlagen-Slot abweichen. js/export3mf-settings.js schreibt sie beim Presetwechsel in den Slot – sonst rechnet
   die Orca-CLI mit den Werten des PLA-Presets der Vorlage weiter (Lüfterschwellen, Rückzug, PA …; gefunden
   2026-11-12: ABS-Slots liefen mit Hilfslüfter 60 % und Lüfter ab Schicht 2 statt 0 % und ab Schicht 6). */
const VALUE_SKIP = new Set(['filament_settings_id', 'filament_colour', 'filament_multi_colour', 'filament_colour_type', 'filament_self_index',
  'filament_map', 'filament_extruder_variant', 'default_filament_colour', 'inherits', 'name', 'from', 'instantiation', 'setting_id',
  'compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition', 'version', 'type']);
function filamentValues(printer, nozzle, presets, tplSettings) {
  const src = (PRESET_SOURCES[printer] || {})[nozzle];
  if (!src || !Object.keys(presets).length) return undefined;
  const dir = path.join(ORCA_PROFILES, src.vendor, 'filament');
  const load = name => {
    const f = path.join(dir, name + '.json');
    if (!fs.existsSync(f)) return {};
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Object.assign(j.inherits ? load(j.inherits) : {}, j);
  };
  const one = v => String(Array.isArray(v) ? v[0] : v);
  const out = {};
  for (const [type, name] of Object.entries(presets)) {
    const r = load(name), vals = {};
    for (const [k, v] of Object.entries(r)) {
      const t = tplSettings[k];
      if (VALUE_SKIP.has(k) || !Array.isArray(t) || t.length !== tplSettings.filament_settings_id.length) continue;
      if (one(v) !== String(t[0])) vals[k] = one(v);
    }
    out[type] = vals;
  }
  return out;
}

// printable_area: ["0x0","250x0","250x250","0x250"] → Mittelpunkt des Druckbetts
function bedCenter(area) {
  const pts = area.map(p => p.split('x').map(Number));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function readTemplate(file) {
  const zip = fflate.unzipSync(new Uint8Array(fs.readFileSync(file)));
  const text = name => { if (!zip[name]) throw Error(`${path.basename(file)}: ${name} fehlt`); return fflate.strFromU8(zip[name]); };
  const settings = JSON.parse(text('Metadata/project_settings.config'));
  const version = (text('Metadata/slice_info.config').match(/OrcaSlicer-Version" value="([^"]+)"/) || [])[1] || '';
  const slots = settings.filament_settings_id.map((name, i) => ({
    name, type: (settings.filament_type || [])[i] || '', colour: (settings.filament_colour || [])[i] || '#888888'
  }));
  return { source: path.basename(file), orcaVersion: version, printerPreset: settings.printer_settings_id,
    bedCenter: bedCenter(settings.printable_area), slots, settings };
}

const templates = {};
for (const f of fs.readdirSync(TEMPLATE_DIR).filter(f => /^[a-z0-9_]+_\d+(\.\d+)?\.3mf$/.test(f)).sort()) {
  const [, printer, nozzle] = f.match(/^(.+)_(\d+(?:\.\d+)?)\.3mf$/);
  const tpl = readTemplate(path.join(TEMPLATE_DIR, f));
  tpl.filamentPresets = filamentPresets(printer, nozzle);
  const values = filamentValues(printer, nozzle, tpl.filamentPresets, tpl.settings);
  if (values) tpl.filamentValues = values;
  (templates[printer] = templates[printer] || {})[nozzle] = tpl;
  console.log(`${f}: ${tpl.printerPreset}, ${tpl.slots.length} Slots, Bettmitte ${tpl.bedCenter.join('/')}, Orca ${tpl.orcaVersion}, ${Object.keys(tpl.filamentPresets).length} Filamentpresets`);
}
fs.writeFileSync(OUT, "'use strict';\n/* ERZEUGT von tools/build-orca-templates.js aus templates/*.3mf – nicht von Hand bearbeiten. */\n" +
  'const ORCA_TEMPLATES=' + JSON.stringify(templates) + ';\n');
console.log(`→ ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
