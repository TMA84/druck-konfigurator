'use strict';
/* 3MF-Export für OrcaSlicer. Basis ist die vom Nutzer in Orca gespeicherte Vorlage
   (ORCA_TEMPLATES, erzeugt aus templates/*.3mf). Überschrieben werden nur Werte, die der
   Konfigurator berechnet – alles andere (Druckerprofil, Start-G-Code, Grenzen) bleibt aus der
   Vorlage. Kein DOM-Zugriff: tests/verify-3mf.js prüft das Ergebnis mit der Orca-CLI. */

const ORCA_KIND = { pla: 'PLA', petg: 'PETG', abs: 'ABS', asa: 'ASA', tpu: 'TPU' };
const BED_TEMP_KEYS = ['hot_plate_temp', 'textured_plate_temp', 'cool_plate_temp', 'eng_plate_temp'];
const SEAM_ORCA = { Hinten: 'back', Ausgerichtet: 'aligned' };
const ACCEL_KEYS = [[t('Beschleunigung Standard'), 'default_acceleration'], [t('Beschleunigung Außenwand'), 'outer_wall_acceleration'],
  [t('Beschleunigung Innenwand'), 'inner_wall_acceleration'], [t('Beschleunigung massive Füllung'), 'internal_solid_infill_acceleration'],
  [t('Beschleunigung Füllung'), 'sparse_infill_acceleration'], [t('Beschleunigung obere Fläche'), 'top_surface_acceleration']];
const PART_GAP_MM = 8;          // Abstand zwischen Teilen beim Anordnen
const PLATE_STRIDE = 1.2;       // Orca legt Platte n um 1,2 × Bettgröße versetzt ab (Spalten = ⌈√Platten⌉)
const objectPath = k => '/3D/Objects/object_' + k + '.model';

function exportTemplate(printerId, nozD) {
  if (printerId === 'orca') return typeof orcaActiveTemplate === 'function' ? orcaActiveTemplate(nozD) : null;
  return (ORCA_TEMPLATES[printerId] || {})[nozD] || null;
}

// Gleiche Zuordnung wie buildOrcaProcessJSON: Gyroid ist in beiden Mustervorschlägen die Primärempfehlung.
// Füllmuster (Datenblatt/Anpassung) → Orca; „Gyroid oder Kubisch“ (Empfehlung) = Gyroid
const INFILL_PATTERNS = { Gyroid: 'gyroid', Kubisch: 'cubic', Gitter: 'grid', Waben: 'honeycomb', Linien: 'line', Dreiecke: 'triangles', Kreuzschraffur: 'crosshatch', Blitz: 'lightning' };
function orcaInfillPattern(pattern) { return INFILL_PATTERNS[pattern] || (String(pattern).indexOf('Gyroid') === 0 ? 'gyroid' : 'crosshatch'); }
const numStr = v => String(Math.round(Number(v) * 1000) / 1000);

// Brim-Empfehlung ("5–8 mm", "Nicht nötig", "0–5 mm") → [brim_type, brim_width]; untere Grenze als Startwert.
function orcaBrim(brim) {
  const m = /^(\d+(?:[.,]\d+)?)/.exec(brim);
  const w = m ? Number(m[1].replace(',', '.')) : 0;
  return w > 0 ? ['outer_only', numStr(w)] : ['no_brim', null];
}

/* Stützen wie im Datenblatt (Stützparameter): gleiches Material wie das Teil, Z-Abstand = Schichthöhe
   (PETG +0,05 mm), Spannen („1,0–1,5 mm“) mit der unteren Grenze. „Nur kritische Bereiche“ nach r.supCritical
   (Vorschlag an, je Auftrag umschaltbar): Damit erzeugt Orca nur Stützen für Spitzen und Auskragungen, bei normalen
   Überhängen gar keine (per Orca-CLI geprüft 2026-09-29: ACE-Guide 0 statt 110 Stützbahnen, Trichterform 0 statt 98;
   der Pilz-Test vom 2026-09-26 hatte nur eine Auskragung).
   Astabstand/-durchmesser: die v4-Werte entsprechen den organischen Baumstützen (Orca-Standard 1 mm / 2 mm);
   der klassische Astabstand (Standard 5 mm) bleibt unverändert. */
function supportChanges(r) {
  const sp = r.sp, tpu = r.tpu;
  const out = [
    [t('Stützentyp'), 'support_type', 'tree(auto)'],
    [t('Schwellenwinkel'), 'support_threshold_angle', sp.angle],
    [t('Nur kritische Bereiche'), 'support_critical_regions_only', r.supCritical === false ? 0 : 1],
    [t('Nur auf Druckplatte'), 'support_on_build_plate_only', 1],
    [t('Kleine Überhänge entfernen'), 'support_remove_small_overhang', sp.small === 'Ein' ? 1 : 0],
    [t('Raft'), 'raft_layers', 0],
    [t('Oberer Z-Abstand'), 'support_top_z_distance', numStr(r.supZ.top)],
    [t('Unterer Z-Abstand'), 'support_bottom_z_distance', numStr(r.supZ.bottom)],
    [t('Stützen/Objekt XY-Abstand'), 'support_object_xy_distance', numStr(lowerNum(sp.xy))],
    [t('Abstand erste Schicht'), 'support_object_first_layer_gap', tpu ? '0.25' : '0.2'],
    [t('Obere Schnittstellenschichten'), 'support_interface_top_layers', sp.iface],
    [t('Untere Schnittstellenschichten'), 'support_interface_bottom_layers', 1],
    [t('Schnittstellenabstand'), 'support_interface_spacing', numStr(lowerNum(sp.gap))],
    [t('Abstand Grundmuster'), 'support_base_pattern_spacing', tpu ? '3' : '2.5'],
    [t('Wände um Stützen'), 'tree_support_wall_count', 0],
    [t('Stützspitze'), 'tree_support_tip_diameter', '0.8'],
    [t('Ast-Dichte'), 'tree_support_top_rate', lowerNum(sp.density) + '%'],
    [t('Astabstand'), 'tree_support_branch_distance_organic', numStr(lowerNum(sp.branch))],
    [t('Ast-Durchmesser'), 'tree_support_branch_diameter_organic', '2']
  ];
  // Gleiches Material wie das Teil (Entscheidung 2026-09-26): 0 = Filament des Objekts
  out.push([t('Stützenfilament'), 'support_filament', 0], [t('Schnittstellenfilament'), 'support_interface_filament', 0]);
  return out;
}

// Herstellerbereich aus dem Datenblatt („230–260 °C“), immer inklusive der tatsächlichen Drucktemperatur
function nozzleRange(r) {
  const n = (String(r.m.range || '').match(/\d{3}/g) || []).map(Number), t = Number(r.nozzle);
  const lo = n.length ? Math.min(...n) : t - 10, hi = n.length ? Math.max(...n) : t + 10;
  return [Math.min(lo, t), Math.max(hi, t)];
}

/* Liefert die Werte, die in project_settings.config geschrieben werden, jeweils mit
   Beschriftung, damit Dialog und Test dieselbe Liste verwenden. slot ist 0-basiert.
   liveSlots (optional): echte Belegung vom Drucker [{type, colour}] – Typ und Farbe aller
   Slots werden übernommen, der gewählte Slot bekommt den Typ des gewählten Filaments. */
function plannedChanges(r, slot, liveSlots) {
  const f = []; // [Beschriftung, Key, Wert, Slot-Index oder null]
  const fil = (label, key, v, index = slot) => f.push([label, key, String(v), index]);
  const proc = (label, key, v) => f.push([label, key, String(v), null]);

  (liveSlots || []).forEach((s, i) => {
    if (s.colour) fil(t('Slot {n} Farbe (Drucker)', { n: i + 1 }), 'filament_colour', s.colour, i);
    if (i !== slot && s.type) fil(t('Slot {n} Typ (Drucker)', { n: i + 1 }), 'filament_type', s.type, i);
  });

  fil(t('Filamenttyp'), 'filament_type', ORCA_KIND[r.m.kind] || 'PLA');
  fil(t('Düse'), 'nozzle_temperature', r.nozzle);
  fil(t('Düse erste Schicht'), 'nozzle_temperature_initial_layer', r.nozzle);
  // Empfohlener Bereich des Filaments – sonst bleibt der PLA-Bereich der Vorlage (190–240 °C) stehen, und Orca
  // verweigert Mehrfarbdrucke mit ASA/ABS/PETG („nozzle temperatures are incompatible“, beobachtet 2026-09-28)
  const [lo, hi] = nozzleRange(r);
  fil(t('Temperaturbereich von'), 'nozzle_temperature_range_low', lo);
  fil(t('Temperaturbereich bis'), 'nozzle_temperature_range_high', hi);
  BED_TEMP_KEYS.forEach(k => { fil(t('Heizbett ({plate})', { plate: k.replace('_temp', '') }), k, r.m.bed); fil(t('Heizbett erste Schicht ({plate})', { plate: k.replace('_temp', '') }), k + '_initial_layer', r.m.bed); });
  fil(t('Lüfter min.'), 'fan_min_speed', r.m.fan);
  fil(t('Lüfter max.'), 'fan_max_speed', r.m.fan);
  fil(t('Max. Volumenstrom'), 'filament_max_volumetric_speed', numStr(r.maxVol));
  fil(t('Durchflussverhältnis'), 'filament_flow_ratio', numStr(r.m.flow));
  // Lüfter erste Schicht und Z-Hop als Filament-Überschreibung je Slot. Den Rückzug schreibt das Tool
  // bewusst nicht: er hängt von Filament, Temperatur und Extruder ab, das Orca-Filamentprofil des Slots
  // bringt passende Werte mit (Entscheidung des Nutzers 2026-09-26, bisherige Standardwerte passten).
  fil(t('Lüfter erste Schicht aus'), 'close_fan_the_first_x_layers', Number(r.m.fanFirst) > 0 ? 0 : 1);
  const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  if (isNum(r.m.zhop)) fil(t('Z-Hop'), 'filament_z_hop', numStr(r.m.zhop));
  if (r.m.pa !== null && r.m.pa !== undefined && r.m.pa !== '') {
    fil(t('Pressure Advance'), 'pressure_advance', numStr(r.m.pa));
    fil(t('Pressure Advance aktiv'), 'enable_pressure_advance', 1);
  }

  proc(t('Schichthöhe'), 'layer_height', numStr(r.layer));
  proc(t('Erste Schicht'), 'initial_layer_print_height', numStr(r.firstLayer));
  proc(t('Wandlinien'), 'wall_loops', r.w);
  proc(t('Fülldichte'), 'sparse_infill_density', r.inf + '%');
  proc(t('Füllmuster'), 'sparse_infill_pattern', orcaInfillPattern(r.pattern));
  proc(t('Obere Schichten'), 'top_shell_layers', r.t);
  proc(t('Untere Schichten'), 'bottom_shell_layers', r.b);
  proc(t('Außenwand'), 'outer_wall_speed', r.sp_outer);
  proc(t('Innenwand'), 'inner_wall_speed', r.sp_inner);
  proc(t('Füllung'), 'sparse_infill_speed', r.sp_fill);
  proc(t('Innere massive Füllung'), 'internal_solid_infill_speed', r.sp_fill);
  proc(t('Obere Fläche'), 'top_surface_speed', r.top);
  proc(t('Lückenfüllung'), 'gap_infill_speed', r.m.gap);
  proc(t('Erste Schicht Geschwindigkeit'), 'initial_layer_speed', r.m.first);
  proc(t('Travel'), 'travel_speed', r.m.travel);
  // Beschleunigung nur, wenn das Datenblatt sie vorgibt (TPU 800 mm/s²); sonst bleibt das Werksprofil.
  // Druckbewegungen werden begrenzt, Travel und erste Schicht (500 mm/s² in den Vorlagen) bleiben.
  if (Number(r.m.accel) > 0) ACCEL_KEYS.forEach(([label, key]) => proc(label, key, numStr(r.m.accel)));
  proc(t('Stützen'), 'enable_support', r.supOn ? 1 : 0);
  if (r.supOn) supportChanges(r).forEach(([label, key, v]) => proc(label, key, v));
  const [brimType, brimWidth] = orcaBrim(r.brim);
  proc(t('Brim'), 'brim_type', brimType);
  if (brimWidth) proc(t('Brim-Breite'), 'brim_width', brimWidth);
  if (SEAM_ORCA[r.seam]) proc(t('Nahtposition'), 'seam_position', SEAM_ORCA[r.seam]);
  if (r.o === 'watertight') {  // Lücken zwischen den Bahnen sind die typischen Undichtigkeiten
    proc(t('Lückenfüllung'), 'gap_fill_target', 'everywhere');
    proc(t('Vertikale Schalendicke sicherstellen'), 'ensure_vertical_shell_thickness', 'ensure_all');
  }
  return f.map(([label, key, value, index]) => ({ label, key, value, perSlot: index !== null, index }));
}

// Neue project_settings (Kopie) + Liste der tatsächlichen Änderungen gegenüber der Vorlage.
/* OrcaSlicer-GUI lädt beim Öffnen eines Projekts die genannten System-Presets neu und übernimmt aus
   der Datei nur die Schlüssel, die in different_settings_to_system stehen (Aufbau wie von Orca selbst
   gespeichert: [Prozess, Filament 1..n, Drucker], Schlüssel mit ";" getrennt). Ohne diese Liste
   landen in der Oberfläche die Presetwerte statt der exportierten (beobachtet 2026-09-26). */
function filamentSlotTypes(r, slot, liveSlots, n, extra = []) {
  const types = Array(n).fill(null);
  (liveSlots || []).forEach((s, i) => { if (i < n && s.type) types[i] = s.type; });
  extra.forEach(e => { if (e.slot < n) types[e.slot] = ORCA_KIND[e.r.m.kind] || types[e.slot]; });
  types[slot] = ORCA_KIND[r.m.kind] || types[slot];
  return types;
}

/* extra: [{slot, r}] – weitere Slots, die Teile mit eigenem Filament belegen. Dort werden nur die
   Filamentwerte (Temperaturen, Lüfter, Fluss …) aus dem Ergebnis dieses Teils geschrieben.
   machine: [{label, key, value, index?}] – Druckerwerte (z. B. Filamentwechsel-Zeit passend zur Spülmenge);
   mit index ein Wert je Filament-Slot (z. B. filament_cost). */
function buildProjectSettings(tpl, r, slot, liveSlots, extra = [], machine = []) {
  const settings = JSON.parse(JSON.stringify(tpl.settings));
  const changes = [];
  const nFil = settings.filament_settings_id.length;
  const groups = nFil + 2; // Prozess, Filamente, Drucker
  const tplDiff = tpl.settings.different_settings_to_system || [];
  const diff = Array.from({ length: groups }, (_, i) => new Set(String(tplDiff[i] || '').split(';').filter(Boolean)));
  const inherits = Array.from({ length: groups }, (_, i) => (tpl.settings.inherits_group || [])[i] || '');

  // 1) Jeder Slot bekommt das System-Preset seines Filamenttyps (sofern Orca eines kennt)
  const presets = tpl.filamentPresets || {};
  filamentSlotTypes(r, slot, liveSlots, nFil, extra).forEach((type, i) => {
    const preset = type && presets[String(type).toUpperCase()];
    if (!preset || settings.filament_settings_id[i] === preset) return;
    changes.push({ label: t('Slot {n} Preset', { n: i + 1 }), key: 'filament_settings_id', before: settings.filament_settings_id[i], after: preset });
    settings.filament_settings_id[i] = preset;
    diff[1 + i].clear();    // Abweichungen der alten (Benutzer-)Presets gelten nicht mehr
    inherits[1 + i] = '';   // direkt ein System-Preset
    // Kennt die Vorlage die Werte des Profils (Orca-Drucker), auch diese in den Slot übernehmen –
    // sonst rechnet die Orca-CLI mit den Werten des vorigen Profils (die Oberfläche lädt sie neu).
    const vals = tpl.filamentValues && tpl.filamentValues[String(type).toUpperCase()];
    if (vals) for (const [k, v] of Object.entries(vals)) if (k !== 'filament_settings_id' && Array.isArray(settings[k]) && i < settings[k].length) settings[k][i] = Array.isArray(v) ? v[0] : v;
  });

  // 2) Berechnete Werte schreiben und als „geändert“ vermerken
  const extraFil = extra.flatMap(e => plannedChanges(e.r, e.slot, null)
    .filter(c => c.perSlot && c.index === e.slot)
    .map(c => ({ ...c, label: t('Slot {n}: {label}', { n: e.slot + 1, label: c.label }) })));
  for (const c of [...plannedChanges(r, slot, liveSlots), ...extraFil]) {
    if (!(c.key in settings)) continue; // Schlüssel kennt diese Orca-Version nicht → Vorlage unverändert
    if (c.perSlot && !(c.index < settings[c.key].length)) continue; // mehr Druckerslots als in der Vorlage
    const before = c.perSlot ? settings[c.key][c.index] : settings[c.key];
    if (c.perSlot) settings[c.key][c.index] = c.value; else settings[c.key] = c.value;
    diff[c.perSlot ? 1 + c.index : 0].add(c.key);
    if (before !== c.value) changes.push({ label: c.label, key: c.key, before, after: c.value });
  }
  for (const c of machine) {
    if (!(c.key in settings)) continue;
    const slotted = c.index != null && Array.isArray(settings[c.key]);
    if (slotted && !(c.index < settings[c.key].length)) continue;
    const before = slotted ? settings[c.key][c.index] : settings[c.key];
    if (slotted) settings[c.key][c.index] = c.value; else settings[c.key] = c.value;
    diff[slotted ? 1 + c.index : groups - 1].add(c.key);
    if (before !== c.value) changes.push({ label: c.label, key: c.key, before, after: c.value });
  }
  settings.different_settings_to_system = diff.map(s => [...s].join(';'));
  settings.inherits_group = inherits;
  return { settings, changes };
}

/* Prozesswerte, die Orca je Objekt überschreiben kann (Objekt-Einstellungen). Schichthöhe, erste Schicht,
   Travel und Erste-Schicht-Geschwindigkeit gelten für die ganze Platte und bleiben global. */
const OBJECT_KEYS = new Set(['wall_loops', 'sparse_infill_density', 'sparse_infill_pattern', 'top_shell_layers', 'bottom_shell_layers',
  'outer_wall_speed', 'inner_wall_speed', 'sparse_infill_speed', 'internal_solid_infill_speed', 'top_surface_speed', 'gap_infill_speed',
  'enable_support', 'raft_layers', 'brim_type', 'brim_width', 'seam_position', 'gap_fill_target', 'ensure_vertical_shell_thickness']);
const isObjectKey = k => OBJECT_KEYS.has(k) || /^(support_|tree_support_)/.test(k);

// Abweichungen eines Teils von den globalen Werten → [{label, key, value}] für model_settings.config
function objectOverrides(settings, pr) {
  return plannedChanges(pr, 0, null).filter(c => !c.perSlot && isObjectKey(c.key) && c.key in settings && String(settings[c.key]) !== c.value);
}

const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const uuid = (n, tail) => ('0000' + n.toString(16)).slice(-4) + '0000-' + tail;
const coord = v => String(Math.round(v * 1e5) / 1e5);

// Netz als 3MF-Objekt: gemeinsame Eckpunkte, lokal um den Mittelpunkt zentriert (wie Orca es speichert).
// Ein Netz als <object>; center = Mittelpunkt des Teils, damit Modifikatoren relativ dazu passen
function meshObjectXML(pos, center, id) {
  const [cx, cy, cz] = center, n = pos.length / 9;
  const index = new Map(), verts = [], tris = [];
  for (let i = 0; i < n; i++) {
    const t = [];
    for (let v = 0; v < 3; v++) {
      const o = i * 9 + v * 3;
      const x = coord(pos[o] - cx), y = coord(pos[o + 1] - cy), z = coord(pos[o + 2] - cz);
      const key = x + ' ' + y + ' ' + z;
      let vid = index.get(key);
      if (vid === undefined) { vid = verts.length; index.set(key, vid); verts.push('     <vertex x="' + x + '" y="' + y + '" z="' + z + '"/>'); }
      t.push(vid);
    }
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) tris.push('     <triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"/>');
  }
  return '  <object id="' + id + '" p:UUID="' + uuid(id, '81cb-4c03-9d28-80fed5dfa1dc') + '" type="model">\n   <mesh>\n    <vertices>\n' +
    verts.join('\n') + '\n    </vertices>\n    <triangles>\n' + tris.join('\n') + '\n    </triangles>\n   </mesh>\n  </object>\n';
}

/* Körper eines Teils (Mehrfarbdruck): bodies = [{name, start, count, slot}] – Dreiecksbereiche in geom.pos.
   Jeder Körper wird ein eigenes Orca-Bauteil; slot null = Slot des Teils. Der erste Körper behält die
   Id des Teils, weitere liegen weit über denen der Teile und Modifikatoren. */
const BODY_ID_BASE = 1000000;
function bodyVolumes(geom, bodies, k) {
  if (!bodies || bodies.length < 2) return [{ id: k, name: geom.name, pos: geom.pos, slot: null }];
  return bodies.map((b, j) => ({ id: j ? BODY_ID_BASE + k * 1000 + j : k, name: b.name, pos: geom.pos.subarray(b.start * 9, (b.start + b.count) * 9), slot: b.slot ?? null }));
}

// Netz-Datei eines Teils: seine Körper (vols: [{id, pos}]) und Modifikatoren (mods: [{id, pos}])
function meshModelXML(geom, vols, mods = []) {
  const center = [(geom.mn[0] + geom.mx[0]) / 2, (geom.mn[1] + geom.mx[1]) / 2, (geom.mn[2] + geom.mx[2]) / 2];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n' +
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n' + vols.map(v => meshObjectXML(v.pos, center, v.id)).join('') +
    mods.map(m => meshObjectXML(m.pos, center, m.id)).join('') + ' </resources>\n <build/>\n</model>\n';
}

/* Bohrloch-Verstärkung: je gewähltem Loch ein Orca-Modifikator (Zylinder) mit 100 % Füllung.
   Ids liegen weit über denen der Teile, damit sie in keiner Datei kollidieren. */
const HOLE_MOD_ID_BASE = 10000;
const HOLE_MOD_SETTINGS = [['sparse_infill_density', '100%']];
function holeMods(k, holes) {
  return (holes || []).map((h, j) => ({ id: HOLE_MOD_ID_BASE + k * 1000 + j + 1, pos: holeModifierMesh(h), name: 'Verstärkung Loch ' + h.id + ' (Ø ' + de(2 * h.r, 1) + ' mm)' }));
}

function bedSize(tpl) {
  const pts = (tpl.settings.printable_area || []).map(p => p.split('x').map(Number));
  if (!pts.length) return [tpl.bedCenter[0] * 2, tpl.bedCenter[1] * 2];
  return [0, 1].map(k => Math.max(...pts.map(p => p[k])) - Math.min(...pts.map(p => p[k])));
}

// Bauraum [Breite, Tiefe, Höhe] in mm (Höhe aus printable_height, sonst unbegrenzt)
function buildVolume(tpl) {
  const h = +[].concat(tpl.settings.printable_height || [])[0];
  return [...bedSize(tpl), h > 0 ? h : Infinity];
}
// Passt ein Teil (so wie es liegt) in den Bauraum? Liste der Überschreitungen, z. B. ['Höhe 262 > 250 mm']
function volumeExcess(g, vol) {
  const out = [];
  [[t('Breite'), g.x, vol[0]], [t('Tiefe'), g.y, vol[1]], [t('Höhe'), g.z, vol[2]]].forEach(([n, v, max]) => { if (v > max + 0.01) out.push(t('{dim} {size} > {max} mm', { dim: n, size: de(v, 0), max: de(max, 0) })); });
  return out;
}

/* Teile zeilenweise aufs Bett legen; passt keine Zeile mehr, beginnt eine neue Platte.
   groups: Listen von Teil-Indizes, jede Gruppe beginnt auf einer eigenen Platte (Plattenzuordnung je Teil);
   läuft eine Gruppe über, geht es auf einer zusätzlichen Platte weiter.
   Ergebnis je Teil: {plate (0-basiert), x, y} = Mitte in Orca-Weltkoordinaten, lx/ly = Mitte auf der Platte. */
function packPlates(geoms, groups, tpl) {
  const [bw, bd] = bedSize(tpl), [bx, by] = tpl.bedCenter, gap = PART_GAP_MM;
  const plates = [];   // je Platte Zeilen: {y0, depth, width, items:[{i, x0}]}
  const sources = [];  // je Platte: aus welcher Gruppe (Plattennummer) sie stammt
  for (const [gi, idx] of groups.entries()) {
    const order = idx.slice().sort((a, b) => geoms[b].y - geoms[a].y || geoms[b].x - geoms[a].x);
    let rows = []; plates.push(rows); sources.push(gi);
    const nextY = () => rows.length ? rows[rows.length - 1].y0 + rows[rows.length - 1].depth + gap : 0;
    for (const i of order) {
      const g = geoms[i];
      let row = rows.find(r => r.width + gap + g.x <= bw && g.y <= r.depth);
      if (!row) {
        if (rows.length && nextY() + g.y > bd) { rows = []; plates.push(rows); sources.push(gi); }
        row = { y0: nextY(), depth: g.y, width: -gap, items: [] };
        rows.push(row);
      }
      row.items.push({ i, x0: row.width + gap });
      row.width += gap + g.x;
    }
  }
  // leere Gruppen (Platte ohne Teile) weglassen
  const used = plates.map((p, k) => [p, sources[k]]).filter(([p]) => p.length);
  const cols = Math.ceil(Math.sqrt(used.length || 1)), places = [];
  used.forEach(([prow, src], pi) => {
    const usedW = Math.max(...prow.map(r => r.width)), last = prow[prow.length - 1], usedD = last.y0 + last.depth;
    const lx0 = bx - usedW / 2, ly0 = by - usedD / 2;
    const ox = (pi % cols) * bw * PLATE_STRIDE, oy = -Math.floor(pi / cols) * bd * PLATE_STRIDE;
    prow.forEach(r => r.items.forEach(it => {
      const lx = lx0 + it.x0 + geoms[it.i].x / 2, ly = ly0 + r.y0 + r.depth / 2;
      places[it.i] = { plate: pi, x: ox + lx, y: oy + ly, lx, ly, group: src };
    }));
  });
  // Teile, die größer als das Bett sind, lassen sich nicht sinnvoll platzieren → Hinweis im Dialog
  const vol = buildVolume(tpl), oversize = geoms.map((g, i) => i).filter(i => volumeExcess(geoms[i], vol).length);
  const overflow = used.length > new Set(used.map(([, s]) => s)).size;
  return { places, plateCount: used.length, oversize, overflow };
}
// Alle Teile automatisch auf möglichst wenige Platten (ohne feste Zuordnung)
function arrangeParts(geoms, tpl) { return packPlates(geoms, [geoms.map((g, i) => i)], tpl); }
// Nach Plattenzuordnung je Teil (1-basiert); Platten in aufsteigender Reihenfolge, Lücken fallen weg
function arrangeByPlate(items, tpl) {
  const nums = [...new Set(items.map(p => p.plate || 1))].sort((a, b) => a - b);
  return packPlates(items.map(p => p.geom), nums.map(n => items.map((p, i) => i).filter(i => (items[i].plate || 1) === n)), tpl);
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
/* Dateiversion im Bambu-Format, wie sie die Orca-Vorlagen tragen. Neuere Angaben (z. B. Bambu Studio 2.7.1 bei
   Makerworld-Projekten) lehnt die Orca-Kommandozeile ab: „File Version 2.7.1.62 not supported by current cli
   version 2.4.2“ (beobachtet 2026-09-28) – die Orca-Oberfläche öffnet sie trotzdem. */
const BBL_FILE_VERSION = '02.06.00.51';
const MODEL_OPEN = '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n';
const REL_TYPE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

function modelSettingsXML(objs, plateCount) {
  const object = o => '  <object id="' + o.id + '">\n    <metadata key="name" value="' + o.name + '"/>\n    <metadata key="extruder" value="' + o.extruder + '"/>\n' +
    o.overrides.map(c => '    <metadata key="' + c.key + '" value="' + xmlEsc(c.value) + '"/>\n').join('') +
    o.vols.map((v, j) => '    <part id="' + v.id + '" subtype="normal_part">\n      <metadata key="name" value="' + xmlEsc(v.name) + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
      (v.slot !== null ? '      <metadata key="extruder" value="' + (v.slot + 1) + '"/>\n' : '') + '      <metadata key="source_file" value="' + o.name + '"/>\n' +
      '      <metadata key="source_object_id" value="0"/>\n      <metadata key="source_volume_id" value="' + j + '"/>\n      <metadata key="source_offset_x" value="0"/>\n      <metadata key="source_offset_y" value="0"/>\n      <metadata key="source_offset_z" value="0"/>\n    </part>\n').join('') +
    (o.mods || []).map(m => '    <part id="' + m.id + '" subtype="modifier_part">\n      <metadata key="name" value="' + xmlEsc(m.name) + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
      HOLE_MOD_SETTINGS.map(([k, v]) => '      <metadata key="' + k + '" value="' + v + '"/>\n').join('') + '    </part>\n').join('') + '  </object>\n';
  const instance = o => '    <model_instance>\n      <metadata key="object_id" value="' + o.id + '"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="' + o.k + '"/>\n    </model_instance>\n';
  const plate = pi => '  <plate>\n    <metadata key="plater_id" value="' + (pi + 1) + '"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n' +
    objs.filter(o => o.place.plate === pi).map(instance).join('') + '  </plate>\n';
  return XML_HEAD + '<config>\n' + objs.map(object).join('') + Array.from({ length: plateCount }, (_, pi) => plate(pi)).join('') +
    '  <assemble>\n' + objs.map(o => '   <assemble_item object_id="' + o.id + '" instance_id="0" transform="1 0 0 0 1 0 0 0 1 ' + coord(o.place.x) + ' ' + coord(o.place.y) + ' ' + o.hz + '" offset="0 0 0" />\n').join('') + '  </assemble>\n</config>\n';
}

// parts: ein geom (Einzelteil) oder [{geom}] – alle Teile bekommen dieselben Werte und den gewählten Slot.
/* parts: ein geom oder [{geom, r?, slot?}]. r/slot = Werte und Slot für alle Teile ohne eigene Angabe.
   Teile mit eigenem r bekommen abweichende Prozesswerte als Objekt-Einstellung, ein eigener Slot
   bekommt die Filamentwerte dieses Teils. notes: Werte, die Orca nur global kennt. */
/* Welche Slots welche Filamentwerte bekommen: der Standard-Slot die von r, jeder weitere Slot die des
   ersten Teils darin. Teile mit anderem Material im selben Slot → Hinweis (Orca kennt ein Filament je Slot). */
function slotPlan(items, r, slot) {
  const partSlot = p => (p.slot === null || p.slot === undefined ? slot : p.slot);
  const extra = [], notes = [];
  // Körper mit eigenem Slot belegen diesen Slot mit dem Filament ihres Teils
  const users = items.flatMap(p => [p, ...(p.bodies || []).filter(b => b.slot !== null && b.slot !== undefined)
    .map(b => ({ geom: { name: p.geom.name + ' · ' + b.name }, r: p.r, slot: b.slot }))]);
  for (const p of users) {
    const ps = partSlot(p), pr = p.r || r;
    if (ps === slot) { if (pr.m.kind !== r.m.kind) notes.push(t('{part}: {material} im selben Slot wie {main} – es gelten die Filamentwerte von {main}.', { part: p.geom.name, material: pr.m.name, main: r.m.name })); continue; }
    const other = extra.find(e => e.slot === ps);
    if (!other) extra.push({ slot: ps, r: pr });
    else if (other.r.m.kind !== pr.m.kind) notes.push(t('{part}: Slot {n} ist schon mit {material} belegt – es gelten dessen Filamentwerte.', { part: p.geom.name, n: ps + 1, material: other.r.m.name }));
  }
  for (const p of items) if (p.r && Math.abs(p.r.layer - r.layer) > 1e-9) notes.push(t('{part}: Schichthöhe {layer} mm empfohlen – Orca nutzt für alle Teile {used} mm.', { part: p.geom.name, layer: de(p.r.layer, 2), used: de(r.layer, 2) }));
  return { extra, notes, partSlot };
}

/* ---------- Reinigungsturm (Prime-Turm) je Platte platzieren ----------
   Die Vorlage kennt nur eine feste Turmposition. Steht dort ein Teil, bricht die Orca-Kommandozeile ab
   („gcode path conflicts found between WipeTower and …“, beobachtet 2026-09-28 mit einem 200 × 200-mm-Teil).
   Je Platte mit mehr als einem Slot: freie Stelle nahe der Vorlagenposition; sonst die Teile nach vorne links
   rücken; geht auch das nicht, ohne Turm (beim Kobra S1 spült die Firmware ohnehin in den Schacht).
   Größe vorsichtig geschätzt: Breite laut Profil, Tiefe 25 mm, dazu Brim und Rippen. wipe_tower_x/y = Ecke vorne links. */
const TOWER_DEPTH_MM = 25, TOWER_CLEAR_MM = 5, TOWER_EDGE_MM = 3, TOWER_STEP_MM = 5;
const firstNum = v => Number(Array.isArray(v) ? v[0] : v);
function bedMin(tpl) {
  const pts = (tpl.settings.printable_area || []).map(p => p.split('x').map(Number));
  return pts.length ? [0, 1].map(k => Math.min(...pts.map(p => p[k]))) : [0, 0];
}
function towerFootprint(settings) {
  const w = firstNum(settings.prime_tower_width) || 35, brim = firstNum(settings.prime_tower_brim_width) || 0;
  const rib = settings.wipe_tower_wall_type === 'rib' ? (firstNum(settings.wipe_tower_extra_rib_length) || 0) : 0;
  return { w, d: TOWER_DEPTH_MM, pad: brim + rib / 2 + 2 };
}
function findTowerSpot(rects, [x0, y0, x1, y1], fp, prefer) {
  let best = null;
  for (let x = x0 + TOWER_EDGE_MM + fp.pad; x + fp.w + fp.pad <= x1 - TOWER_EDGE_MM; x += TOWER_STEP_MM)
    for (let y = y0 + TOWER_EDGE_MM + fp.pad; y + fp.d + fp.pad <= y1 - TOWER_EDGE_MM; y += TOWER_STEP_MM) {
      const t = [x - fp.pad, y - fp.pad, x + fp.w + fp.pad, y + fp.d + fp.pad];
      if (rects.some(o => o[0] - TOWER_CLEAR_MM < t[2] && t[0] < o[2] + TOWER_CLEAR_MM && o[1] - TOWER_CLEAR_MM < t[3] && t[1] < o[3] + TOWER_CLEAR_MM)) continue;
      const dist = Math.hypot(x - prefer[0], y - prefer[1]);
      if (!best || dist < best.dist) best = { x, y, dist };
    }
  return best && [best.x, best.y];
}
/* plates: [{rects:[[x0,y0,x1,y1]] in Bettkoordinaten, slots:Set}] – Index = Platte − 1.
   Ergebnis: {xs, ys, shifts:[[dx,dy]], notes, disable} – shifts rücken die Teile einer Platte. */
function planTowers(settings, tpl, plates) {
  const fp = towerFootprint(settings), [mx, my] = bedMin(tpl), [bw, bd] = bedSize(tpl), bed = [mx, my, mx + bw, my + bd];
  const prefer = [firstNum(settings.wipe_tower_x) || mx + bw / 2, firstNum(settings.wipe_tower_y) || my + bd / 2];
  const res = { xs: [], ys: [], shifts: [], notes: [], disable: false };
  const off = String(settings.enable_prime_tower) === '0';
  plates.forEach((p, i) => {
    let pos = null, shift = [0, 0];
    if (!off && p.slots.size > 1 && p.rects.length) {
      pos = findTowerSpot(p.rects, bed, fp, prefer);
      if (!pos) {
        shift = [mx + TOWER_EDGE_MM + 2 - Math.min(...p.rects.map(r => r[0])), my + TOWER_EDGE_MM + 2 - Math.min(...p.rects.map(r => r[1]))];
        pos = findTowerSpot(p.rects.map(r => [r[0] + shift[0], r[1] + shift[1], r[2] + shift[0], r[3] + shift[1]]), bed, fp, prefer);
        if (pos) res.notes.push(t('Platte {n}: Teile nach vorne links gerückt, damit der Reinigungsturm Platz hat.', { n: i + 1 }));
        else { shift = [0, 0]; res.disable = true; res.notes.push(t('Platte {n}: kein Platz für den Reinigungsturm – die 3MF ist ohne Turm (beim Kobra S1 spült die Firmware in den Schacht).', { n: i + 1 })); }
      }
    }
    res.xs.push(String(pos ? pos[0] : prefer[0])); res.ys.push(String(pos ? pos[1] : prefer[1])); res.shifts.push(shift);
  });
  return res;
}
// Turmposition (und ggf. „ohne Turm“) in die Einstellungen; Orca übernimmt nur gelistete Prozessschlüssel
function applyTowers(settings, changes, plan) {
  const mark = key => { const g = settings.different_settings_to_system; if (Array.isArray(g) && !String(g[0] || '').split(';').includes(key)) g[0] = g[0] ? g[0] + ';' + key : key; };
  const set = (label, key, value) => { const before = settings[key]; settings[key] = value; mark(key); if (JSON.stringify(before) !== JSON.stringify(value)) changes.push({ label, key, before: Array.isArray(before) ? before.join(', ') : before, after: Array.isArray(value) ? value.join(', ') : value }); };
  if (plan.disable) set(t('Reinigungsturm'), 'enable_prime_tower', '0');
  else { set(t('Reinigungsturm X je Platte'), 'wipe_tower_x', plan.xs); set(t('Reinigungsturm Y je Platte'), 'wipe_tower_y', plan.ys); }
}

function build3mfFiles(tpl, r, parts, slot, liveSlots, machine) {
  const items = (Array.isArray(parts) ? parts : [parts]).map(p => p.geom ? p : { geom: p });
  const list = items.map(p => p.geom);
  const { extra, notes, partSlot } = slotPlan(items, r, slot);
  const { settings, changes } = buildProjectSettings(tpl, r, slot, liveSlots, extra, machine);
  // Plattenzuordnung je Teil beachten (plate 1-basiert); ohne Angabe alles automatisch
  const { places, plateCount, overflow } = items.some(p => p.plate) ? arrangeByPlate(items, tpl) : arrangeParts(list, tpl);
  if (overflow) notes.push(t('Nicht alle Teile einer Platte passen aufs Bett – sie stehen auf einer zusätzlichen Platte.'));
  {
    // Reinigungsturm je Platte: Teile in Bettkoordinaten der Platte (arrangeParts versetzt Platten wie Orca)
    const [bw, bd] = bedSize(tpl), cols = Math.ceil(Math.sqrt(plateCount));
    const origin = pi => [(pi % cols) * bw * PLATE_STRIDE, -Math.floor(pi / cols) * bd * PLATE_STRIDE];
    const plates = Array.from({ length: plateCount }, () => ({ rects: [], slots: new Set(), idx: [] }));
    items.forEach((p, i) => {
      const pl = places[i], [ox, oy] = origin(pl.plate), g = p.geom, q = plates[pl.plate];
      q.rects.push([pl.x - ox - g.x / 2, pl.y - oy - g.y / 2, pl.x - ox + g.x / 2, pl.y - oy + g.y / 2]);
      q.slots.add(partSlot(p)); (p.bodies || []).forEach(b => { if (b.slot != null) q.slots.add(b.slot); });
      q.idx.push(i);
    });
    const tp = planTowers(settings, tpl, plates);
    plates.forEach((q, pi) => { const [dx, dy] = tp.shifts[pi]; if (dx || dy) q.idx.forEach(i => { places[i] = { ...places[i], x: places[i].x + dx, y: places[i].y + dy }; }); });
    applyTowers(settings, changes, tp);
    notes.push(...tp.notes);
  }
  const n = list.length, title = xmlEsc(n === 1 ? list[0].name : n + ' Teile');
  // Netz k (1..n) liegt in object_k.model mit id k; das Objekt im Hauptmodell hat id n+k.
  const objs = items.map((p, i) => ({ g: p.geom, k: i + 1, id: n + i + 1, name: xmlEsc(p.geom.name), hz: coord(p.geom.z / 2), place: places[i],
    extruder: partSlot(p) + 1, overrides: p.r ? objectOverrides(settings, p.r) : [], mods: holeMods(i + 1, p.holes), vols: bodyVolumes(p.geom, p.bodies, i + 1) }));
  const objectChanges = objs.filter(o => o.overrides.length).map(o => ({ name: o.g.name, changes: o.overrides }));
  const files = {
    '[Content_Types].xml': XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n',
    '_rels/.rels': XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="' + REL_TYPE + '"/>\n</Relationships>\n',
    '3D/_rels/3dmodel.model.rels': XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      objs.map(o => ' <Relationship Target="' + objectPath(o.k) + '" Id="rel-' + o.k + '" Type="' + REL_TYPE + '"/>\n').join('') + '</Relationships>\n',
    '3D/3dmodel.model': XML_HEAD + MODEL_OPEN +
      ' <metadata name="Application">BambuStudio-' + BBL_FILE_VERSION + '</metadata>\n <metadata name="OrcaSlicer">' + xmlEsc(tpl.orcaVersion) + '</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="Title">' + title + '</metadata>\n <resources>\n' +
      objs.map(o => '  <object id="' + o.id + '" p:UUID="' + uuid(o.k, '61cb-4c03-9d28-80fed5dfa1dc') + '" type="model">\n   <components>\n' +
        o.vols.map(v => '    <component p:path="' + objectPath(o.k) + '" objectid="' + v.id + '" p:UUID="' + uuid(v.id, 'b206-40ff-9872-83e8017abed1') + '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n').join('') +
        o.mods.map(m => '    <component p:path="' + objectPath(o.k) + '" objectid="' + m.id + '" p:UUID="' + uuid(m.id, 'b206-40ff-9872-83e8017abed1') + '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n').join('') +
        '   </components>\n  </object>\n').join('') +
      ' </resources>\n <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">\n' +
      objs.map(o => '  <item objectid="' + o.id + '" p:UUID="' + uuid(o.id, 'b1ec-4553-aec9-835e5b724bb4') + '" transform="1 0 0 0 1 0 0 0 1 ' + coord(o.place.x) + ' ' + coord(o.place.y) + ' ' + o.hz + '" printable="1"/>\n').join('') +
      ' </build>\n</model>\n',
    'Metadata/model_settings.config': modelSettingsXML(objs, plateCount),
    'Metadata/project_settings.config': JSON.stringify(settings, null, 4),
    'Metadata/slice_info.config': XML_HEAD + '<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="' + BBL_FILE_VERSION + '"/>\n    <header_item key="OrcaSlicer-Version" value="' + xmlEsc(tpl.orcaVersion) + '"/>\n  </header>\n</config>\n',
    'Metadata/filament_sequence.json': JSON.stringify(Object.fromEntries(Array.from({ length: plateCount }, (_, pi) => ['plate_' + (pi + 1), { nozzle_sequence: [], optimal_assignment: [], sequence: [] }])))
  };
  objs.forEach(o => { files[objectPath(o.k).slice(1)] = meshModelXML(o.g, o.vols, o.mods); });
  return { files, changes, plateCount, objectChanges, notes };
}

/* ---------- Vorhandene 3MF (z. B. Makerworld) auf den eigenen Drucker umstellen ----------
   Entscheidung 2026-09-26: Lage, Platten, Farben und Bemalung des Designers bleiben. Ersetzt werden
   die Einstellungen (project_settings aus der eigenen Orca-Vorlage + berechnete Werte), je Objekt
   Slot und die selbst berechneten Objektwerte; jede Platte wird auf die Bettmitte gerückt. */
const PLATE_SLICE_FILES = /^Metadata\/plate_\d+\.gcode(\.md5)?$/;

// Mitte der Teile je Platte → Verschiebung auf die Bettmitte der Platte im eigenen Drucker
function plateShifts(jobs, tpl) {
  const [bw, bd] = bedSize(tpl), [bx, by] = tpl.bedCenter;
  const ids = [...new Set(jobs.map(j => j.plate || 1))].sort((a, b) => a - b);
  const count = Math.max(...ids), cols = Math.ceil(Math.sqrt(count)), shifts = new Map(), oversize = [];
  for (const id of ids) {
    const on = jobs.filter(j => (j.plate || 1) === id);
    const mnx = Math.min(...on.map(j => j.geom.mn[0])), mxx = Math.max(...on.map(j => j.geom.mx[0]));
    const mny = Math.min(...on.map(j => j.geom.mn[1])), mxy = Math.max(...on.map(j => j.geom.mx[1]));
    const pi = id - 1, tx = (pi % cols) * bw * PLATE_STRIDE + bx, ty = -Math.floor(pi / cols) * bd * PLATE_STRIDE + by;
    shifts.set(id, [tx - (mnx + mxx) / 2, ty - (mny + mxy) / 2]);
    if (mxx - mnx > bw || mxy - mny > bd || Math.max(...on.map(j => j.geom.z)) > buildVolume(tpl)[2] + 0.01) oversize.push(id);
  }
  return { shifts, oversize };
}

// Objekt-Kopf in model_settings.config: Slot setzen, eigene Werte setzen bzw. auf global zurücknehmen
function patchObjectHead(head, extruder, own, computedKeys) {
  const setMeta = (h, key, value) => {
    const re = new RegExp('(<metadata key="' + key + '" value=")[^"]*(")');
    return re.test(h) ? h.replace(re, '$1' + xmlEsc(value) + '$2') : h.replace(/(<object id="[^"]*">\n?)/, '$1    <metadata key="' + key + '" value="' + xmlEsc(value) + '"/>\n');
  };
  let h = setMeta(head, 'extruder', extruder);
  const ownKeys = new Set(own.map(c => c.key));
  for (const key of computedKeys) if (!ownKeys.has(key)) h = h.replace(new RegExp('[ \\t]*<metadata key="' + key + '" value="[^"]*"/>\\n?', 'g'), '');
  for (const c of own) h = setMeta(h, c.key, c.value);
  return h;
}

// Slot eines Bauteils (Körper) im Objekt setzen; extruder null = Slot des Objekts (Eintrag entfernen)
function patchPartExtruder(ms, objectId, partId, extruder) {
  const pid = String(partId).replace(/[^\w-]/g, '');
  const objRe = new RegExp('(<object id="' + objectId + '">[\\s\\S]*?</object>)');
  return ms.replace(objRe, obj => obj.replace(new RegExp('(<part id="' + pid + '"[^>]*>)([\\s\\S]*?)(</part>)'), (all, open, body, close) => {
    const re = /[ \t]*<metadata key="extruder" value="[^"]*"\/>\n?/;
    body = body.replace(re, '');
    if (extruder !== null) body = body.replace(/^(\n?)/, '$1      <metadata key="extruder" value="' + extruder + '"/>\n');
    return open + body + close;
  }));
}

/* Farb-Modifikatoren des Designers auf andere Slots legen: map {Slot des Designers (0-basiert): eigener Slot}.
   Nur Modifikatoren (subtype modifier_part); Bemalung je Dreieck (paint_color) bleibt beim Slot des Designers. */
function patchModifierExtruders(ms, objectId, map, nFil) {
  const objRe = new RegExp('(<object id="' + objectId + '">[\\s\\S]*?</object>)');
  return ms.replace(objRe, obj => obj.replace(/(<part\b[^>]*subtype="modifier_part"[^>]*>)([\s\S]*?)(<\/part>)/g, (all, open, body, close) =>
    open + body.replace(/(<metadata key="extruder" value=")(\d+)("\/>)/, (m, a, v, b) => {
      const to = map[+v - 1];
      return to == null ? m : a + (Math.min(to, nFil - 1) + 1) + b;
    }) + close));
}

/* jobs: [{geom, r, slot, bodies?, part:{objectId, plate}}] wie aus partJobs(); threemf = Import-Ergebnis mit zip. */
function build3mfFromProject(tpl, r, jobs, slot, zipLib, liveSlots, threemf, machine) {
  const items = jobs.map(j => ({ ...j, plate: j.part && j.part.plate }));
  const { extra, notes, partSlot } = slotPlan(items, r, slot);
  const nFil = tpl.settings.filament_settings_id.length;
  items.forEach(j => { if (partSlot(j) >= nFil) notes.push(t('{part}: Slot {n} gibt es an deinem Drucker nicht – bitte in Orca zuweisen.', { part: j.geom.name, n: partSlot(j) + 1 })); });
  items.forEach(j => (j.bodies || []).forEach(b => { if (b.slot != null && b.slot >= nFil) notes.push(t('{part} · {body}: Slot {n} gibt es an deinem Drucker nicht – Slot {last} wird verwendet.', { part: j.geom.name, body: b.name, n: b.slot + 1, last: nFil })); }));
  const { settings, changes } = buildProjectSettings(tpl, r, slot, liveSlots, extra.filter(e => e.slot < nFil), machine);
  const { shifts, oversize } = plateShifts(items, tpl);
  oversize.forEach(id => notes.push(t('Platte {n} ist größer als dein Druckbett – in Orca prüfen.', { n: id })));
  {
    // Reinigungsturm je Platte (Platten-Ids 1..n); Teile nach der Verschiebung auf die Bettmitte
    const count = Math.max(1, ...items.map(j => j.plate || 1)), [bw, bd] = bedSize(tpl), cols = Math.ceil(Math.sqrt(count));
    const plates = Array.from({ length: count }, () => ({ rects: [], slots: new Set() }));
    for (const j of items) {
      const id = j.plate || 1, [sx, sy] = shifts.get(id) || [0, 0], pi = id - 1, ox = (pi % cols) * bw * PLATE_STRIDE, oy = -Math.floor(pi / cols) * bd * PLATE_STRIDE;
      plates[pi].rects.push([j.geom.mn[0] + sx - ox, j.geom.mn[1] + sy - oy, j.geom.mx[0] + sx - ox, j.geom.mx[1] + sy - oy]);
      plates[pi].slots.add(Math.min(partSlot(j), nFil - 1)); (j.bodies || []).forEach(b => { if (b.slot != null) plates[pi].slots.add(Math.min(b.slot, nFil - 1)); });
      if (j.part && j.part.painted) plates[pi].slots.add('bemalt'); // Farben des Designers → mehrfarbig, Turm nötig
    }
    const tp = planTowers(settings, tpl, plates);
    tp.shifts.forEach(([dx, dy], pi) => { if ((dx || dy) && shifts.has(pi + 1)) { const [sx, sy] = shifts.get(pi + 1); shifts.set(pi + 1, [sx + dx, sy + dy]); } });
    applyTowers(settings, changes, tp);
    notes.push(...tp.notes);
  }

  const out = {};
  for (const [name, data] of Object.entries(threemf.zip)) if (!PLATE_SLICE_FILES.test(name)) out[name] = data;
  out['Metadata/project_settings.config'] = zipLib.strToU8(JSON.stringify(settings, null, 4));
  // Dateiversion auf die der eigenen Vorlage setzen (sonst verweigert die Orca-Kommandozeile neuere Bambu-Dateien)
  const setVersion = (name, re, value) => { if (out[name]) out[name] = zipLib.strToU8(zipLib.strFromU8(out[name]).replace(re, value)); };
  setVersion('3D/3dmodel.model', /(<metadata name="Application">)[^<]*(<\/metadata>)/, '$1BambuStudio-' + BBL_FILE_VERSION + '$2');
  // Mit OrcaSlicer-Angabe prüft Orca gegen die eigene Version statt gegen die Bambu-Version
  const model = zipLib.strFromU8(out['3D/3dmodel.model']);
  if (!/<metadata name="OrcaSlicer">/.test(model))
    out['3D/3dmodel.model'] = zipLib.strToU8(model.replace(/(<metadata name="Application">[^<]*<\/metadata>)/, '$1\n <metadata name="OrcaSlicer">' + xmlEsc(tpl.orcaVersion) + '</metadata>'));
  else setVersion('3D/3dmodel.model', /(<metadata name="OrcaSlicer">)[^<]*(<\/metadata>)/, '$1' + xmlEsc(tpl.orcaVersion) + '$2');
  setVersion('Metadata/slice_info.config', /(header_item key="X-BBL-Client-Version" value=")[^"]*(")/, '$1' + BBL_FILE_VERSION + '$2');

  // Build-Items verschieben (Translation = letzte drei Werte der Matrix)
  const rootPath = Object.keys(out).find(k => /^3D\/3dmodel\.model$/i.test(k));
  // Je Build-Item die Platte seiner Instanz – dasselbe Objekt kann auf mehreren Platten stehen
  const plateOfItem = new Map(items.map(j => [j.part.objectId + '#' + (j.part.instance || 0), j.plate || 1]));
  const itemCount = new Map();
  out[rootPath] = zipLib.strToU8(zipLib.strFromU8(out[rootPath]).replace(/<((?:\w+:)?item\b)([^>]*?)(\/?)>/g, (all, tag, attrs, close) => {
    const id = (/objectid="([^"]+)"/.exec(attrs) || [])[1], inst = itemCount.get(id) || 0;
    itemCount.set(id, inst + 1);
    const shift = shifts.get(plateOfItem.get(id + '#' + inst));
    if (!shift) return all;
    const t = (/transform="([^"]+)"/.exec(attrs) || [])[1];
    const m = t ? t.trim().split(/\s+/).map(Number) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    m[9] += shift[0]; m[10] += shift[1];
    const tr = 'transform="' + m.map(v => String(Math.round(v * 1e4) / 1e4)).join(' ') + '"';
    return '<' + tag + (t ? attrs.replace(/transform="[^"]+"/, tr) : attrs + ' ' + tr) + close + '>';
  }));

  // Slot und eigene Werte je Objekt
  const computedKeys = [...new Set(plannedChanges(r, 0, null).filter(c => !c.perSlot && isObjectKey(c.key)).map(c => c.key).concat([...OBJECT_KEYS], supportChanges(r).map(x => x[1])))];
  const objectChanges = [];
  let ms = zipLib.strFromU8(out['Metadata/model_settings.config'] || zipLib.strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<config>\n</config>\n'));
  const done = new Set(); // Objekt mit mehreren Instanzen nur einmal anpassen
  for (const j of items) {
    if (done.has(j.part.objectId)) continue;
    done.add(j.part.objectId);
    const own = objectOverrides(settings, j.r);
    if (own.length) objectChanges.push({ name: j.geom.name, changes: own });
    const esc = String(j.part.objectId).replace(/[^\w-]/g, '');
    if (!new RegExp('<object id="' + esc + '">').test(ms)) { notes.push(t('{part}: keine Objekt-Einstellungen in der 3MF – Slot und eigene Werte bitte in Orca prüfen.', { part: j.geom.name })); continue; }
    ms = ms.replace(new RegExp('(<object id="' + esc + '">)([\\s\\S]*?)(?=<part\\b|</object>)'), (all, open, body) => patchObjectHead(open + body, Math.min(partSlot(j), nFil - 1) + 1, own, computedKeys));
    for (const b of j.bodies || []) if (b.partId != null) ms = patchPartExtruder(ms, esc, b.partId, b.slot == null ? null : Math.min(b.slot, nFil - 1) + 1);
    if (threemf.designMap && Object.keys(threemf.designMap).length) ms = patchModifierExtruders(ms, esc, threemf.designMap, nFil);
  }
  out['Metadata/model_settings.config'] = zipLib.strToU8(ms);
  return { bytes: zipLib.zipSync(out, { level: 6 }), changes, objectChanges, notes, plateCount: shifts.size };
}

// ZIP über fflate (vendor/fflate.min.js); zipLib wird übergeben, damit der Test es in Node nutzen kann.
function build3mf(tpl, r, parts, slot, zipLib, liveSlots, machine) {
  const { files, changes, plateCount, objectChanges, notes } = build3mfFiles(tpl, r, parts, slot, liveSlots, machine);
  const entries = {};
  for (const [p, text] of Object.entries(files)) entries[p] = zipLib.strToU8(text);
  return { bytes: zipLib.zipSync(entries, { level: 6 }), changes, plateCount, objectChanges, notes };
}
