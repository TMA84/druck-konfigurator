'use strict';
/* 3MF-Export, Teil Einstellungen (aus js/export3mf.js): Grundwerte, Druckreihenfolge, Abstand beim Anordnen, Vorlage
   (exportTemplate, widenTemplate für mehr Slots), Füllmuster/Brim/Stützen, geplante Änderungen und project_settings,
   Objekt-Einstellungen. Lädt vor den anderen Teilen: packGapMm braucht PART_GAP_MM beim Laden. */

const ORCA_KIND = { pla: 'PLA', petg: 'PETG', abs: 'ABS', asa: 'ASA', tpu: 'TPU' };
const BED_TEMP_KEYS = ['hot_plate_temp', 'textured_plate_temp', 'cool_plate_temp', 'eng_plate_temp'];
const SEAM_ORCA = { Hinten: 'back', Ausgerichtet: 'aligned', 'Nächste': 'nearest', 'Zufällig': 'random' };
const ACCEL_KEYS = [[t('Beschleunigung Standard'), 'default_acceleration'], [t('Beschleunigung Außenwand'), 'outer_wall_acceleration'],
  [t('Beschleunigung Innenwand'), 'inner_wall_acceleration'], [t('Beschleunigung massive Füllung'), 'internal_solid_infill_acceleration'],
  [t('Beschleunigung Füllung'), 'sparse_infill_acceleration'], [t('Beschleunigung obere Fläche'), 'top_surface_acceleration']];
const PART_GAP_MM = 8;          // Abstand zwischen Teilen beim Anordnen
/* Druckreihenfolge „Objekt für Objekt“ (Orca print_sequence = by object): jedes Teil wird ganz fertig gedruckt, bevor das
   nächste beginnt. Dann müssen die Teile den Freiraum des Druckkopfs einhalten (extruder_clearance_radius aus dem
   Druckerprofil, S1: 60 mm) und höchstens eines darf höher sein als der Abstand bis zur X-Achse (height_to_rod, S1: 48 mm) –
   Orca prüft beides und bricht sonst ab. Die Oberfläche setzt den Modus je Projekt (setPrintSequence). */
const printSeq = { byObject: false };
function setPrintSequence(on) { printSeq.byObject = !!on; }
function clearanceOf(tpl) {
  const s = (tpl && tpl.settings) || {};
  const num1 = v => +[].concat(v ?? [])[0];
  return { radius: num1(s.extruder_clearance_radius) || 60, rod: num1(s.extruder_clearance_height_to_rod) || 40 };
}
// Abstand beim Anordnen: einstellbar in der Plattenübersicht (setPackGap, 3–15 mm, Standard PART_GAP_MM); Objekt für Objekt
// mindestens der Freiraum des Druckkopfs
const PACK_GAP_MIN = 3, PACK_GAP_MAX = 15;
let packGapMm = PART_GAP_MM;
function setPackGap(mm) { packGapMm = Math.max(PACK_GAP_MIN, Math.min(PACK_GAP_MAX, Number(mm) || PART_GAP_MM)); }
const packGap = tpl => printSeq.byObject ? Math.max(packGapMm, clearanceOf(tpl).radius + 1) : packGapMm;
const PLATE_STRIDE = 1.2;       // Orca legt Platte n um 1,2 × Bettgröße versetzt ab (Spalten = ⌈√Platten⌉)
const objectPath = k => '/3D/Objects/object_' + k + '.model';

function exportTemplate(printerId, nozD) {
  if (printerId === 'orca') return typeof orcaActiveTemplate === 'function' ? orcaActiveTemplate(nozD) : null;
  const tpl = (ORCA_TEMPLATES[printerId] || {})[nozD] || null;
  // Zweite ACE am Drucker: Vorlage auf 8 Slots erweitern (Anzahl aus js/export-ui.js printerSlotCount)
  const n = tpl && typeof printerSlotCount === 'function' ? printerSlotCount(printerId, tpl) : 0;
  return tpl && n > tpl.slots.length ? widenTemplate(tpl, n) : tpl;
}

/* Vorlage mit n statt 4 Filament-Slots (zweite ACE-Einheit: Slot 5–8). Die Vorlage ist mit einer ACE gespeichert;
   alle Werte je Filament (Listen mit einem Eintrag je Slot) bekommen für die neuen Slots die Werte von Slot 1,
   filament_self_index zählt weiter, die Spülmatrix wächst auf n × n (neue Paare mit der größten Spülmenge der
   Vorlage – lieber etwas mehr spülen als verschmieren). Ergebnis je (Vorlage, n) zwischengespeichert. */
const NOT_PER_FILAMENT = new Set(['printable_area', 'bed_exclude_area', 'wrapping_exclude_area', 'thumbnails', 'head_wrap_detect_zone']);
const widened = new WeakMap();
function widenTemplate(tpl, n) {
  const cache = widened.get(tpl) || widened.set(tpl, {}).get(tpl);
  if (cache[n]) return cache[n];
  const src = tpl.settings, k0 = src.filament_settings_id.length, settings = JSON.parse(JSON.stringify(src));
  for (const [k, v] of Object.entries(settings)) {
    if (!Array.isArray(v) || v.length !== k0 || NOT_PER_FILAMENT.has(k)) continue;
    for (let i = k0; i < n; i++) v.push(k === 'filament_self_index' ? String(i + 1) : v[0]);
  }
  const m = (src.flush_volumes_matrix || []).map(Number);
  if (m.length === k0 * k0) {
    const most = String(Math.max(0, ...m));
    settings.flush_volumes_matrix = Array.from({ length: n * n }, (_, x) => { const i = Math.floor(x / n), j = x % n;
      return i === j ? '0' : i < k0 && j < k0 ? String(m[i * k0 + j]) : most; });
  }
  const vec = src.flush_volumes_vector || [];
  if (vec.length === 2 * k0) settings.flush_volumes_vector = Array.from({ length: 2 * n }, (_, i) => vec[i % vec.length]);
  // [Prozess, Filament 1..n, Drucker]: leere Gruppen für die neuen Slots vor dem Drucker einfügen
  for (const key of ['different_settings_to_system', 'inherits_group']) {
    const g = src[key];
    if (Array.isArray(g) && g.length === k0 + 2) settings[key] = [...g.slice(0, k0 + 1), ...Array(n - k0).fill(''), g[k0 + 1]];
  }
  const slots = [...tpl.slots, ...Array.from({ length: n - k0 }, () => ({ ...tpl.slots[0] }))];
  return (cache[n] = { ...tpl, slots, settings });
}

// Gleiche Zuordnung wie buildOrcaProcessJSON: Gyroid ist in beiden Mustervorschlägen die Primärempfehlung.
// Füllmuster (Datenblatt/Anpassung) → Orca; „Gyroid oder Kubisch“ (Empfehlung) = Gyroid
const INFILL_PATTERNS = { Gyroid: 'gyroid', Kubisch: 'cubic', Gitter: 'grid', Waben: 'honeycomb', Linien: 'line', Dreiecke: 'triangles', Kreuzschraffur: 'crosshatch', Blitz: 'lightning' };
function orcaInfillPattern(pattern) { return INFILL_PATTERNS[pattern] || (String(pattern).indexOf('Gyroid') === 0 ? 'gyroid' : 'crosshatch'); }
const numStr = v => String(Math.round(Number(v) * 1000) / 1000);

// Brim-Empfehlung ("5–8 mm", "Nicht nötig", "0–5 mm") → [brim_type, brim_width]; untere Grenze als Startwert.
// Brim-Breite außen in mm (0 ohne Brim) – Rand beim Anordnen (packPlates pads)
const brimPad = r => (r && r.brim ? Number(orcaBrim(r.brim)[1]) || 0 : 0);
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
    [t('Nur kritische Bereiche'), 'support_critical_regions_only', r.supCritical ? 1 : 0],
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
  fil(t('Düse erste Schicht'), 'nozzle_temperature_initial_layer', r.nozzleFirst ?? r.nozzle);
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
  if (Number(r.m.fanFirst) > 0) fil(t('Lüfter erste Schicht'), 'first_x_layer_fan_speed', numStr(r.m.fanFirst));
  const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  if (isNum(r.m.zhop)) fil(t('Z-Hop'), 'filament_z_hop', numStr(r.m.zhop));
  // Hilfs- und Gehäuselüfter (Kobra S1) nur, wenn du sie für diesen Auftrag gesetzt hast – sonst das Profil (60 %)
  if (r.fans2 && r.fans2.aux != null) fil(t('Hilfslüfter'), 'additional_cooling_fan_speed', numStr(r.fans2.aux));
  if (r.fans2 && r.fans2.box != null) fil(t('Gehäuselüfter (Abluft)'), 'during_print_exhaust_fan_speed', numStr(r.fans2.box));
  // Rückzug nur, wenn du ihn für diesen Auftrag gesetzt hast (r.retr) – sonst das Orca-Profil des Slots
  if (r.retr) {
    fil(t('Rückzug Länge'), 'filament_retraction_length', numStr(r.retr.len));
    fil(t('Rückzug Geschwindigkeit'), 'filament_retraction_speed', numStr(r.retr.speed));
  }
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
  proc(t('Erste Schicht Geschwindigkeit'), 'initial_layer_speed', r.sp_first ?? r.m.first);
  proc(t('Travel'), 'travel_speed', r.sp_travel ?? r.m.travel);
  // Beschleunigung nur, wenn das Datenblatt sie vorgibt (TPU 800 mm/s²); sonst bleibt das Werksprofil.
  // Druckbewegungen werden begrenzt, Travel und erste Schicht (500 mm/s² in den Vorlagen) bleiben.
  const accel = r.accel ?? r.m.accel;
  if (Number(accel) > 0) ACCEL_KEYS.forEach(([label, key]) => proc(label, key, numStr(accel)));
  proc(t('Stützen'), 'enable_support', r.supOn ? 1 : 0);
  if (r.supOn) supportChanges(r).forEach(([label, key, v]) => proc(label, key, v));
  let [brimType, brimWidth] = orcaBrim(r.brim);
  // Brim-Art: auto/außen = outer_only (auto setzt je Objekt mit Löchern gesetzte Mausohren, build3mfFiles), sonst wie gewählt
  // „inner“ = außen + nur große Löcher: ebenfalls über gesetzte Ohren (build3mfFiles), global daher outer_only
  if (brimType !== 'no_brim') brimType = { ears: 'brim_ears' }[r.brimKind] || 'outer_only';
  // Form innen „Orca innen ringsum“: Orcas eigener innerer Brim (füllt kleine Löcher ganz); eine Breite für beide Seiten
  if (Number(r.brimInner) > 0 && r.brimInnerKind === 'orca') {
    brimType = brimType === 'no_brim' ? 'inner_only' : 'outer_and_inner';
    if (!brimWidth) brimWidth = numStr(r.brimInner);
  }
  proc(t('Brim'), 'brim_type', brimType);
  if (brimWidth) proc(t('Brim-Breite'), 'brim_width', brimWidth);
  /* Brim muss am Teil hängen: das Kobra-S1-Profil lässt 0,1 mm Spalt (brim_object_gap), und die Elefantenfuß-Kompensation
     (0,075 mm) zieht die erste Schicht des Teils zusätzlich nach innen – bei ABS/ASA riss der Brim dort ab und das Teil
     löste sich (2026-10-04). Daher: Brim folgt dem kompensierten Umriss, bei ABS/ASA ohne Spalt. */
  if (brimType !== 'no_brim') {
    proc(t('Brim am kompensierten Umriss'), 'brim_use_efc_outline', 1);
    proc(t('Brim-Abstand zum Teil'), 'brim_object_gap', numStr(r.brimGap ?? ((r.m.kind === 'abs' || r.m.kind === 'asa') ? 0 : 0.1)));
  }
  if (SEAM_ORCA[r.seam]) proc(t('Nahtposition'), 'seam_position', SEAM_ORCA[r.seam]);
  if (r.o === 'watertight') {  // Lücken zwischen den Bahnen sind die typischen Undichtigkeiten
    proc(t('Lückenfüllung'), 'gap_fill_target', 'everywhere');
    proc(t('Vertikale Schalendicke sicherstellen'), 'ensure_vertical_shell_thickness', 'ensure_all');
  }
  // weitere Orca-Einstellungen (js/orca-extra.js): zuletzt – gewinnen gegen berechnete Werte (z. B. Stützen-Typ)
  for (const [k, v] of Object.entries(r.extraOv || {})) proc(typeof ORCA_EXTRA_BY_KEY !== 'undefined' && ORCA_EXTRA_BY_KEY[k] ? t(ORCA_EXTRA_BY_KEY[k][1]) : k, k, v);
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
  if (printSeq.byObject && 'print_sequence' in settings) {
    const before = settings.print_sequence;
    settings.print_sequence = 'by object'; diff[0].add('print_sequence');
    if (before !== 'by object') changes.push({ label: t('Druckreihenfolge'), key: 'print_sequence', before, after: 'by object' });
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
  'enable_support', 'raft_layers', 'brim_type', 'brim_width', 'brim_object_gap', 'seam_position',
  'wall_sequence', 'ironing_type', 'top_surface_pattern', 'bottom_surface_pattern', 'only_one_wall_top', 'bridge_speed', 'gap_fill_target', 'ensure_vertical_shell_thickness']);
const isObjectKey = k => OBJECT_KEYS.has(k) || /^(support_|tree_support_)/.test(k);

// Abweichungen eines Teils von den globalen Werten → [{label, key, value}] für model_settings.config
function objectOverrides(settings, pr, part) {
  // je Schlüssel der LETZTE Wert (weitere Orca-Einstellungen stehen am Ende und gewinnen gegen berechnete) – 2026-10-08:
  // vorher blieb der erste übrig, z. B. support_remove_small_overhang = 1 im Objekt trotz Einstellung 0
  const last = new Map();
  for (const c of plannedChanges(pr, 0, null)) if (!c.perSlot && isObjectKey(c.key)) last.set(c.key, c);
  const own = [...last.values()].filter(c => c.key in settings && String(settings[c.key]) !== c.value);
  return part ? supportPaintOverrides(settings, pr, part, own) : own;
}
/* Gemalte Stützen (js/paint-ui.js, Ebene „Stützen“): Erzwingen wirkt in Orca nur mit eingeschalteten Stützen. Ist das Teil
   sonst ohne Stützen, stützt „tree(manual)“ genau die gemalten Stellen (mit der Orca-CLI geprüft 2026-09-30). */
function supportPaintOverrides(settings, pr, part, own) {
  if (pr.supOn || typeof paintHasEnforcers !== 'function' || !paintHasEnforcers(part)) return own;
  const set = (key, value, label) => {
    const out = own.filter(c => c.key !== key);
    if (String(settings[key]) !== value) out.push({ label, key, value, perSlot: false });
    return out;
  };
  own = set('enable_support', '1', t('Stützen (nur gemalte Stellen)'));
  return set('support_type', 'tree(manual)', t('Stützentyp'));
}
