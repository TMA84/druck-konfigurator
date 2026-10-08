'use strict';
/* 3MF-Export für OrcaSlicer. Basis ist die vom Nutzer in Orca gespeicherte Vorlage
   (ORCA_TEMPLATES, erzeugt aus templates/*.3mf). Überschrieben werden nur Werte, die der
   Konfigurator berechnet – alles andere (Druckerprofil, Start-G-Code, Grenzen) bleibt aus der
   Vorlage. Kein DOM-Zugriff: tests/verify-3mf.js prüft das Ergebnis mit der Orca-CLI. */

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

const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const uuid = (n, tail) => ('0000' + n.toString(16)).slice(-4) + '0000-' + tail;
const coord = v => String(Math.round(v * 1e5) / 1e5);

// Netz als 3MF-Objekt: gemeinsame Eckpunkte, lokal um den Mittelpunkt zentriert (wie Orca es speichert).
// Ein Netz als <object>; center = Mittelpunkt des Teils, damit Modifikatoren relativ dazu passen
// paint: Dreieck → Attribute der Bemalung (' paint_color="…" …', '' = keine) oder null (js/paint.js paintAttrsFn)
function meshObjectXML(pos, center, id, paint) {
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
    const pc = paint ? paint(i) : '';
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) tris.push('     <triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"' + pc + '/>');
  }
  return '  <object id="' + id + '" p:UUID="' + uuid(id, '81cb-4c03-9d28-80fed5dfa1dc') + '" type="model">\n   <mesh>\n    <vertices>\n' +
    verts.join('\n') + '\n    </vertices>\n    <triangles>\n' + tris.join('\n') + '\n    </triangles>\n   </mesh>\n  </object>\n';
}

/* Körper eines Teils (Mehrfarbdruck): bodies = [{name, start, count, slot}] – Dreiecksbereiche in geom.pos.
   Jeder Körper wird ein eigenes Orca-Bauteil; slot null = Slot des Teils. Der erste Körper behält die
   Id des Teils, weitere liegen weit über denen der Teile und Modifikatoren. */
const BODY_ID_BASE = 1000000;
// paint: Bemalung des Teils (Dreieck im ganzen Teil → Attribute, js/paint.js paintAttrsFn) oder null
function bodyVolumes(geom, bodies, k, paint) {
  if (!bodies || bodies.length < 2) return [{ id: k, name: geom.name, pos: geom.pos, slot: null, paint: paint || null }];
  return bodies.map((b, j) => ({ id: j ? BODY_ID_BASE + k * 1000 + j : k, name: b.name, pos: geom.pos.subarray(b.start * 9, (b.start + b.count) * 9), slot: b.slot ?? null,
    paint: paint ? i => paint(b.start + i) : null }));
}

// Netz-Datei eines Teils: seine Körper (vols: [{id, pos}]) und Modifikatoren (mods: [{id, pos}])
function meshModelXML(geom, vols, mods = []) {
  const center = [(geom.mn[0] + geom.mx[0]) / 2, (geom.mn[1] + geom.mx[1]) / 2, (geom.mn[2] + geom.mx[2]) / 2];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n' +
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n' + vols.map(v => meshObjectXML(v.pos, center, v.id, v.paint)).join('') +
    mods.map(m => meshObjectXML(m.pos, center, m.id)).join('') + ' </resources>\n <build/>\n</model>\n';
}

/* Bohrloch-Verstärkung: je gewähltem Loch ein Orca-Modifikator (Zylinder) mit 100 % Füllung.
   Ids liegen weit über denen der Teile, damit sie in keiner Datei kollidieren. */
const HOLE_MOD_ID_BASE = 10000;
const HOLE_MOD_SETTINGS = [['sparse_infill_density', '100%']];

/* Beschriftung (js/engrave.js): texts eines Teils (item.texts oder item.part.texts, Anker in origPos-Koordinaten,
   Drehung item.part.R). Erhaben = weiteres Bauteil (normal_part) mit eigenem Slot, vertieft = negative_part
   (Orca zieht es beim Slicen ab; Subtyp per Orca-CLI geprüft 2026-09-29). Ergebnis {vols, negs} wie bodyVolumes/holeMods. */
const TEXT_ID_BASE = 2000000;
const itemTexts = p => (p.texts || (p.part && p.part.texts) || []).filter(x => x && String(x.text || '').trim());
function textVolumes(k, p) {
  const R = (p.part && p.part.R) || null, vols = [], negs = [];
  itemTexts(p).forEach((x, j) => {
    const e = { id: TEXT_ID_BASE + k * 1000 + j + 1, pos: textMesh(typeof textScaled === 'function' ? textScaled(x, p.part) : x, R), name: (x.mode === 'engraved' ? 'Gravur' : 'Schrift') + ' „' + String(x.text).slice(0, 40) + '“' };
    if (x.mode === 'engraved') negs.push({ ...e, subtype: 'negative_part', settings: [] }); else vols.push({ ...e, slot: x.slot ?? null });
  });
  return { vols, negs };
}
// Slots erhabener Beschriftungen eines Teils
const textSlots = p => itemTexts(p).filter(x => x.mode !== 'engraved' && x.slot != null).map(x => x.slot);
// weitere Slots eines Teils neben Teil und Körpern: erhabene Beschriftung und eigene Bemalung (js/paint.js)
const paintSlotsOf = p => typeof paintUserSlots === 'function' ? paintUserSlots(p.part || p) : [];
const extraSlots = p => textSlots(p).concat(paintSlotsOf(p));
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

/* Teile platzsparend aufs Bett legen (Grundfläche = Hüllrechteck, Abstand packGap – einstellbar, Standard PART_GAP_MM). Verfahren „freie Rechtecke“
   (MaxRects, beste kurze Seite): jedes Teil kommt in die freie Lücke, in die es am knappsten passt, auf die erste
   Platte mit Platz; wenn es hilft, um 90° um die Hochachse gedreht. Mehrere Sortierungen werden durchprobiert, die
   mit den wenigsten Platten gewinnt (bei Gleichstand die dichteste erste Platte). Je Platte wird die belegte Fläche
   auf die Bettmitte gerückt. (2026-09-29, ersetzt das Zeilenverfahren: Mischungen mit 78–84 % Fläche brauchten 2 Platten.)
   groups: Listen von Teil-Indizes, jede Gruppe beginnt auf einer eigenen Platte (Plattenzuordnung je Teil);
   läuft eine Gruppe über, geht es auf einer zusätzlichen Platte weiter.
   Ergebnis je Teil: {plate (0-basiert), x, y, lx, ly, rot} – Mitte in Orca-Weltkoordinaten bzw. auf der Platte,
   rot = um 90° gedreht (Grundfläche dann y × x). */
const PACK_ORDERS = [
  (a, b) => b.x * b.y - a.x * a.y,
  (a, b) => Math.max(b.x, b.y) - Math.max(a.x, a.y),
  (a, b) => b.y - a.y || b.x - a.x,
  (a, b) => b.x - a.x || b.y - a.y,
  (a, b) => (b.x + b.y) - (a.x + a.y)
];
// a < b lexikografisch (erste abweichende Stelle entscheidet)
function lexLess(a, b) { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; }
function maxRectsBin(W, H) {
  let free = [{ x: 0, y: 0, w: W, h: H }];
  const fits = (f, w, h) => w <= f.w + 1e-6 && h <= f.h + 1e-6;
  const bin = {
    used: [],
    // Kopie zum Ausprobieren (ganzer Satz passt oder keiner – packSets)
    clone() { const c = maxRectsBin(W, H); c.setFree(free.map(f => ({ ...f }))); c.used = this.used.slice(); return c; },
    setFree(f) { free = f; },
    // beste Lücke für w × h (optional gedreht) → {x, y, w, h, rot, score} oder null
    find(w, h, allowRot) {
      let best = null;
      for (const f of free) for (const [ww, hh, rot] of allowRot && Math.abs(w - h) > 1e-6 ? [[w, h, false], [h, w, true]] : [[w, h, false]]) {
        if (!fits(f, ww, hh)) continue;
        const score = [Math.min(f.w - ww, f.h - hh), Math.max(f.w - ww, f.h - hh), f.y, f.x];
        if (!best || lexLess(score, best.score)) best = { x: f.x, y: f.y, w: ww, h: hh, rot, score };
      }
      return best;
    },
    place(r) {
      const next = [];
      for (const f of free) {
        if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) { next.push(f); continue; }
        if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
        if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
        if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
        if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
      }
      // in anderen enthaltene Lücken streichen
      free = next.filter((a, k) => !next.some((b, m) => m !== k && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (m < k || a.w !== b.w || a.h !== b.h || a.x !== b.x || a.y !== b.y)));
      this.used.push(r);
    }
  };
  return bin;
}
// Beste Lösung: wenigste Platten, dann möglichst wenige gedrehte Teile (Drehen nur, wenn es Platten spart), dann dichteste erste Platte
function packGroup(geoms, idx, W, H, gap) {
  let best = null;
  for (const allowRot of [false, true]) for (const order of PACK_ORDERS) {
    const seq = idx.slice().sort((a, b) => order(geoms[a], geoms[b]) || a - b), bins = [];
    for (const i of seq) {
      const w = geoms[i].x + gap, h = geoms[i].y + gap;
      let spot = null, bin = null;
      for (const b of bins) { const f = b.find(w, h, allowRot); if (f) { spot = f; bin = b; break; } }
      if (!spot) {
        bin = maxRectsBin(W + gap, H + gap); bins.push(bin);
        spot = bin.find(w, h, allowRot) || bin.find(w, h, true) || { x: 0, y: 0, w, h, rot: false };   // größer als das Bett: allein auf eine Platte
      }
      bin.place({ ...spot, i });
    }
    const fill = bins.length ? bins[0].used.reduce((s, r) => s + r.w * r.h, 0) : 0, rots = bins.reduce((s, b) => s + b.used.filter(r => r.rot).length, 0);
    if (!best || lexLess([bins.length, rots, -fill], [best.bins.length, best.rots, -best.fill])) best = { bins, fill, rots };
  }
  return best ? best.bins.map(b => compactBin(geoms, b, W, H, gap)) : [];
}
/* Teile einer Platte als möglichst kompakten Block legen: Auf dem leeren Bett landen wenige Teile sonst an Kante und
   Ecke (z. B. 12 gleiche als „L“). Probiert schmalere Bettbreiten durch und nimmt die Anordnung mit der kürzesten
   längeren Seite (dann kleinsten Fläche), in der noch alle Teile passen. */
function compactBin(geoms, bin, W, H, gap) {
  const rects = bin.used, ext = rs => [Math.max(...rs.map(r => r.x + r.w)) - Math.min(...rs.map(r => r.x)), Math.max(...rs.map(r => r.y + r.h)) - Math.min(...rs.map(r => r.y))];
  if (rects.length < 2) return bin;
  const allowRot = rects.some(r => r.rot), idx = rects.map(r => r.i), score = rs => { const [a, b] = ext(rs); return [Math.round(Math.max(a, b)), Math.round(a * b)]; };
  let best = rects, bestScore = score(rects);
  const minW = Math.max(...rects.map(r => r.w)), STEPS = 40;
  for (let k = 0; k <= STEPS; k++) {
    const w = minW + (W + gap - minW) * k / STEPS;
    for (const order of PACK_ORDERS) {
      const b = maxRectsBin(w, H + gap);
      let ok = true;
      for (const i of idx.slice().sort((a, c) => order(geoms[a], geoms[c]) || a - c)) {
        const f = b.find(geoms[i].x + gap, geoms[i].y + gap, allowRot);
        if (!f) { ok = false; break; }
        b.place({ ...f, i });
      }
      if (ok && lexLess(score(b.used), bestScore)) { best = b.used; bestScore = score(b.used); }
    }
  }
  return best === rects ? bin : { used: best };
}
/* Sätze zusammenhalten (Modell aus mehreren Teilen, z. B. RFID-Halter = Halter + Deckel, 20 Sätze): jeder Satz kommt
   ganz auf eine Platte – sonst lagen auf der letzten Platte nur Deckel und nach Platte 1 war kein Satz fertig.
   sets: Listen von Teil-Indizes (je Satz). Je Satz die erste Platte, auf der alle seine Teile Platz haben, sonst eine
   neue. Teile, die zu keinem Satz gehören, werden danach wie gewohnt verteilt. Ergebnis: Platten (bins) wie packGroup. */
function packSets(geoms, idx, sets, W, H, gap) {
  const inSet = new Set(sets.flat()), rest = idx.filter(i => !inSet.has(i));
  const area = i => geoms[i].x * geoms[i].y;
  let best = null;
  for (const allowRot of [false, true]) {
    const bins = [];
    for (const set of sets) {
      const items = set.slice().sort((a, b) => area(b) - area(a) || a - b);
      const tryBin = b => { const c = b.clone(); for (const i of items) { const f = c.find(geoms[i].x + gap, geoms[i].y + gap, allowRot); if (!f) return null; c.place({ ...f, i }); } return c; };
      let done = false;
      for (let k = 0; k < bins.length && !done; k++) { const c = tryBin(bins[k]); if (c) { bins[k] = c; done = true; } }
      if (!done) { const c = tryBin(maxRectsBin(W + gap, H + gap)); if (!c) return null; bins.push(c); }   // Satz größer als das Bett
    }
    for (const i of rest.sort((a, b) => area(b) - area(a) || a - b)) {
      const w = geoms[i].x + gap, h = geoms[i].y + gap;
      let spot = null, bin = null;
      for (const b of bins) { const f = b.find(w, h, allowRot); if (f) { spot = f; bin = b; break; } }
      if (!spot) { bin = maxRectsBin(W + gap, H + gap); bins.push(bin); spot = bin.find(w, h, true) || { x: 0, y: 0, w, h, rot: false }; }
      bin.place({ ...spot, i });
    }
    const rots = bins.reduce((s, b) => s + b.used.filter(r => r.rot).length, 0);
    if (!best || lexLess([bins.length, rots], [best.bins.length, best.rots])) best = { bins, rots };
  }
  return best.bins.map(b => compactBin(geoms, b, W, H, gap));
}
function packPlates(geoms, groups, tpl, sets) {
  const [bw, bd] = bedSize(tpl), [bx, by] = tpl.bedCenter, gap = packGap(tpl);
  const plates = [];   // je Platte die belegten Rechtecke {i, x, y, w, h, rot} (inkl. Abstand)
  const sources = [];  // je Platte: aus welcher Gruppe (Plattennummer) sie stammt
  let setsKept = null;  // null = keine Sätze; true = zusammengehalten; false = hätte mehr als eine Platte zusätzlich gekostet
  for (const [gi, idx] of groups.entries()) {
    let bins = packGroup(geoms, idx, bw, bd, gap);
    // Grundfläche statt Hüllrechteck (js/nest.js), wenn das Platten spart – nicht bei „Objekt für Objekt“ (Kopf-Freiraum rechteckig)
    if (bins.length > 1 && !printSeq.byObject && typeof nestGroup === 'function') { const nb = nestGroup(geoms, idx, bw, bd, gap); if (nb && nb.length < bins.length) bins = nb; }
    const mine = sets && sets.map(s => s.filter(i => idx.includes(i))).filter(s => s.length > 1);
    if (mine && mine.length) {
      const kept = packSets(geoms, idx, mine, bw, bd, gap);
      // höchstens eine Platte mehr als ohne Sätze – sonst wie bisher (und sagen)
      if (kept && kept.length <= bins.length + 1) { bins = kept; if (setsKept !== false) setsKept = true; } else setsKept = false;
    }
    if (!bins.length) { plates.push([]); sources.push(gi); }
    bins.forEach(b => { plates.push(b.used); sources.push(gi); });
  }
  // leere Gruppen (Platte ohne Teile) weglassen
  const used = plates.map((p, k) => [p, sources[k]]).filter(([p]) => p.length);
  const cols = Math.ceil(Math.sqrt(used.length || 1)), places = [];
  used.forEach(([rects, src], pi) => {
    const minX = Math.min(...rects.map(r => r.x)), minY = Math.min(...rects.map(r => r.y));
    const usedW = Math.max(...rects.map(r => r.x + r.w)) - gap - minX, usedD = Math.max(...rects.map(r => r.y + r.h)) - gap - minY;
    const lx0 = bx - usedW / 2 - minX, ly0 = by - usedD / 2 - minY;
    const ox = (pi % cols) * bw * PLATE_STRIDE, oy = -Math.floor(pi / cols) * bd * PLATE_STRIDE;
    for (const r of rects) {
      const lx = lx0 + r.x + (r.w - gap) / 2, ly = ly0 + r.y + (r.h - gap) / 2;
      places[r.i] = { plate: pi, x: ox + lx, y: oy + ly, lx, ly, group: src, rot: !!r.rot, ang: r.ang ?? (r.rot ? 90 : 0) };
    }
  });
  // Teile, die größer als das Bett sind, lassen sich nicht sinnvoll platzieren → Hinweis im Dialog
  const vol = buildVolume(tpl), oversize = geoms.map((g, i) => i).filter(i => volumeExcess(geoms[i], vol).length && volumeExcess({ x: geoms[i].y, y: geoms[i].x, z: geoms[i].z }, vol).length);
  const overflow = used.length > new Set(used.map(([, s]) => s)).size;
  return { places, plateCount: used.length, oversize, overflow, setsKept };
}
// Grundfläche eines platzierten Teils (gedreht: Breite und Tiefe getauscht)
const footprint = (g, pl) => pl && pl.rot ? [g.y, g.x] : [g.x, g.y];
// 3MF-Transformation (Zeilenvektor · Matrix): gedreht = +90° um Z, sonst nur verschoben
// Drehung um Z in 90°-Schritten (pl.ang; ältere Lagen nur pl.rot = 90°) – Zeilenvektor: 90° → (−y, x), 180° → (−x, −y), 270° → (y, −x)
const placeAng = pl => pl ? (pl.ang != null ? ((pl.ang % 360) + 360) % 360 : pl.rot ? 90 : 0) : 0;
const ROT_Z = { 0: [1, 0, 0, 0, 1, 0, 0, 0, 1], 90: [0, 1, 0, -1, 0, 0, 0, 0, 1], 180: [-1, 0, 0, 0, -1, 0, 0, 0, 1], 270: [0, -1, 0, 1, 0, 0, 0, 0, 1] };
const placeXY = (pl, a, b) => { const k = placeAng(pl); return k === 90 ? [-b, a] : k === 180 ? [-a, -b] : k === 270 ? [b, -a] : [a, b]; };
const placeTransform = (pl, hz) => ROT_Z[placeAng(pl)].map(String).join(' ') + ' ' + coord(pl.x) + ' ' + coord(pl.y) + ' ' + hz;
// Alle Teile automatisch auf möglichst wenige Platten (ohne feste Zuordnung)
function arrangeParts(geoms, tpl, sets) { return packPlates(geoms, [geoms.map((g, i) => i)], tpl, sets); }
// Nach Plattenzuordnung je Teil (1-basiert); Platten in aufsteigender Reihenfolge, Lücken fallen weg
function arrangeByPlate(items, tpl) {
  const nums = [...new Set(items.map(p => p.plate || 1))].sort((a, b) => a - b);
  return packPlates(items.map(p => p.geom), nums.map(n => items.map((p, i) => i).filter(i => (items[i].plate || 1) === n)), tpl);
}

/* ---------- Makerworld-/Orca-3MF neu anordnen (2026-09-29) ----------
   Teile, die das Tool selbst platziert: part.extra = hinzugefügtes einfaches Teil (STL oder Geometrie einer weiteren
   Datei, objectId null), part.copy = Kopie eines 3MF-Objekts (weitere Instanz desselben Objekts), part.moved = auf
   eine andere Platte verschoben. threemf.layout: 'auto' = alles platzsparend (Knopf „Platzsparend anordnen“),
   'plates' = danach eigene Plattenzuordnung, sonst Platten des Designers. */
const ownPlaced = p => !!p && !!(p.extra || p.copy || p.moved);
// Muss die 3MF neu angeordnet werden (Build-Items, Platten; auch wenn Teile entfernt wurden)? Sonst bleibt die Lage des Designers (nur auf die Bettmitte gerückt).
const needsRelayout = (threemf, parts) => !!(threemf && (threemf.layout || threemf.removed)) || parts.some(ownPlaced);
/* items: [{geom, plate (1-basiert), own}]. Platten ohne eigene Teile (und nicht angeordnet) behalten die Lage des Designers,
   auf die Bettmitte gerückt; die übrigen packt das Tool (packPlates, läuft eine über, folgt eine weitere Platte).
   Platten werden ohne Lücken durchnummeriert. Ergebnis wie arrangeParts, dazu plateOf (1-basiert), designer (Set
   der Plattennummern mit Designer-Lage) und oversizePlates. places[i].x/y = Mitte des Hüllrechtecks in Orca-Welt-
   koordinaten, auch für Teile in Designer-Lage (dort rot = false). */
function layout3mf(items, tpl, mode) {
  const geoms = items.map(p => p.geom), [bw, bd] = bedSize(tpl), [bx, by] = tpl.bedCenter, vol = buildVolume(tpl);
  const designer = new Set(), oversizePlates = [];
  if (mode === 'auto') {
    const r = arrangeParts(geoms, tpl);
    return { count: r.plateCount, plateOf: r.places.map(p => p.plate + 1), places: r.places, overflow: false, oversize: r.oversize, oversizePlates, designer };
  }
  const plateNo = p => p.plate || 1, all = items.map((p, i) => i);
  const nums = [...new Set(items.map(plateNo))].sort((a, b) => a - b);
  const packNums = nums.filter(k => mode === 'plates' || items.some(p => plateNo(p) === k && p.own));
  const pk = packNums.length ? packPlates(geoms, packNums.map(k => all.filter(i => plateNo(items[i]) === k)), tpl) : null;
  const local = [];
  let f = 0, overflow = false;
  for (const k of nums) {
    const idx = all.filter(i => plateNo(items[i]) === k);
    if (!packNums.includes(k)) {
      f++; designer.add(f);
      const mnx = Math.min(...idx.map(i => geoms[i].mn[0])), mxx = Math.max(...idx.map(i => geoms[i].mx[0]));
      const mny = Math.min(...idx.map(i => geoms[i].mn[1])), mxy = Math.max(...idx.map(i => geoms[i].mx[1]));
      const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
      for (const i of idx) local[i] = { f, lx: (geoms[i].mn[0] + geoms[i].mx[0]) / 2 - cx + bx, ly: (geoms[i].mn[1] + geoms[i].mx[1]) / 2 - cy + by, rot: false };
      if (mxx - mnx > bw || mxy - mny > bd || Math.max(...idx.map(i => geoms[i].z)) > vol[2] + 0.01) oversizePlates.push(f);
    } else {
      const bins = [...new Set(idx.map(i => pk.places[i].plate))].sort((a, b) => a - b), base = f;
      if (bins.length > 1) overflow = true;
      f += bins.length;
      for (const i of idx) { const pl = pk.places[i]; local[i] = { f: base + 1 + bins.indexOf(pl.plate), lx: pl.lx, ly: pl.ly, rot: pl.rot, ang: pl.ang }; }
    }
  }
  const cols = Math.ceil(Math.sqrt(f || 1));
  const places = local.map(L => { const pi = L.f - 1; return { plate: pi, x: (pi % cols) * bw * PLATE_STRIDE + L.lx, y: -Math.floor(pi / cols) * bd * PLATE_STRIDE + L.ly, lx: L.lx, ly: L.ly, rot: L.rot, ang: L.ang }; });
  // zu groß: in Designer-Lage so, wie es liegt; beim Packen auch gedreht nicht
  const oversize = all.filter(i => volumeExcess(geoms[i], vol).length && (designer.has(local[i].f) || volumeExcess({ x: geoms[i].y, y: geoms[i].x, z: geoms[i].z }, vol).length));
  return { count: f, plateOf: local.map(L => L.f), places, overflow, oversize, oversizePlates, designer };
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
/* Dateiversion im Bambu-Format, wie sie die Orca-Vorlagen tragen. Neuere Angaben (z. B. Bambu Studio 2.7.1 bei
   Makerworld-Projekten) lehnt die Orca-Kommandozeile ab: „File Version 2.7.1.62 not supported by current cli
   version 2.4.2“ (beobachtet 2026-09-28) – die Orca-Oberfläche öffnet sie trotzdem. */
const BBL_FILE_VERSION = '02.06.00.51';
const MODEL_OPEN = '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n';
const REL_TYPE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

// Objekt-Eintrag in model_settings.config: Name, Slot, eigene Werte, Bauteile (Körper) und Modifikatoren (name bereits XML-escaped)
function objectConfigXML(o) {
  return '  <object id="' + o.id + '">\n    <metadata key="name" value="' + o.name + '"/>\n    <metadata key="extruder" value="' + o.extruder + '"/>\n' +
    o.overrides.map(c => '    <metadata key="' + c.key + '" value="' + xmlEsc(c.value) + '"/>\n').join('') +
    o.vols.map((v, j) => '    <part id="' + v.id + '" subtype="normal_part">\n      <metadata key="name" value="' + xmlEsc(v.name) + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
      (v.slot !== null ? '      <metadata key="extruder" value="' + (v.slot + 1) + '"/>\n' : '') + '      <metadata key="source_file" value="' + o.name + '"/>\n' +
      '      <metadata key="source_object_id" value="0"/>\n      <metadata key="source_volume_id" value="' + j + '"/>\n      <metadata key="source_offset_x" value="0"/>\n      <metadata key="source_offset_y" value="0"/>\n      <metadata key="source_offset_z" value="0"/>\n    </part>\n').join('') +
    (o.mods || []).map(m => '    <part id="' + m.id + '" subtype="' + (m.subtype || 'modifier_part') + '">\n      <metadata key="name" value="' + xmlEsc(m.name) + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
      (m.settings || HOLE_MOD_SETTINGS).map(([k, v]) => '      <metadata key="' + k + '" value="' + v + '"/>\n').join('') + '    </part>\n').join('') + '  </object>\n';
}
function modelSettingsXML(objs, plateCount) {
  const object = objectConfigXML;
  const instance = o => '    <model_instance>\n      <metadata key="object_id" value="' + o.id + '"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="' + o.k + '"/>\n    </model_instance>\n';
  const plate = pi => '  <plate>\n    <metadata key="plater_id" value="' + (pi + 1) + '"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n' +
    objs.filter(o => o.place.plate === pi).map(instance).join('') + '  </plate>\n';
  return XML_HEAD + '<config>\n' + objs.map(object).join('') + Array.from({ length: plateCount }, (_, pi) => plate(pi)).join('') +
    '  <assemble>\n' + objs.map(o => '   <assemble_item object_id="' + o.id + '" instance_id="0" transform="' + placeTransform(o.place, o.hz) + '" offset="0 0 0" />\n').join('') + '  </assemble>\n</config>\n';
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
    .map(b => ({ geom: { name: p.geom.name + ' · ' + b.name }, r: p.r, slot: b.slot })),
    ...textSlots(p).map(s => ({ geom: { name: p.geom.name + ' · ' + t('Beschriftung') }, r: p.r, slot: s })),
    ...paintSlotsOf(p).map(s => ({ geom: { name: p.geom.name + ' · ' + t('Bemalung') }, r: p.r, slot: s }))]);
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
      const pl = places[i], [ox, oy] = origin(pl.plate), q = plates[pl.plate], [fw, fd] = footprint(p.geom, pl);
      q.rects.push([pl.x - ox - fw / 2, pl.y - oy - fd / 2, pl.x - ox + fw / 2, pl.y - oy + fd / 2]);
      q.slots.add(partSlot(p)); (p.bodies || []).forEach(b => { if (b.slot != null) q.slots.add(b.slot); }); extraSlots(p).forEach(s => q.slots.add(s));
      q.idx.push(i);
    });
    const tp = planTowers(settings, tpl, plates);
    plates.forEach((q, pi) => { const [dx, dy] = tp.shifts[pi]; if (dx || dy) q.idx.forEach(i => { places[i] = { ...places[i], x: places[i].x + dx, y: places[i].y + dy }; }); });
    applyTowers(settings, changes, tp);
    notes.push(...tp.notes);
  }
  const n = list.length, title = xmlEsc(n === 1 ? list[0].name : n + ' Teile');
  // Netz k (1..n) liegt in object_k.model mit id k; das Objekt im Hauptmodell hat id n+k.
  const nFil = settings.filament_settings_id.length;
  const objs = items.map((p, i) => { const tv = textVolumes(i + 1, p), paint = typeof paintAttrsFn === 'function' && p.part ? paintAttrsFn(p.part, {}, nFil) : null; return { g: p.geom, k: i + 1, id: n + i + 1, name: xmlEsc(p.geom.name), hz: coord(p.geom.z / 2), place: places[i],
    extruder: partSlot(p) + 1, overrides: p.r ? objectOverrides(settings, p.r, p.part) : [], mods: tv.negs.concat(holeMods(i + 1, p.holes)), vols: bodyVolumes(p.geom, p.bodies, i + 1, paint).concat(tv.vols) }; });
  // Brim „auto“: Teile mit Löchern/Schriften in der ersten Schicht bekommen statt des Rundum-Brims eine Ohrenkette am
  // Außenrand (js/brim-ears.js) – sonst zieht Orca den Brim um Inseln in den Öffnungen und schließt sie
  const ears = [];
  objs.forEach((o, i) => {
    const pr = items[i].r || r, [bt, bw] = orcaBrim(pr.brim), inner = Number(pr.brimInner) || 0;
    if (inner && pr.brimInnerKind === 'orca') return;   // Orcas eigener innerer Brim, keine gesetzten Ohren
    if ((bt === 'no_brim' && !inner) || (pr.brimKind && pr.brimKind !== 'auto') || typeof brimEarPoints !== 'function') return;
    const g = o.g, center = [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, (g.mn[2] + g.mx[2]) / 2];
    const pts = brimEarPoints(o.vols, o.mods.filter(m => m.subtype === 'negative_part'), center, g.mn[2], bt === 'no_brim' ? 0 : Number(bw), inner, pr.brimInnerKind || 'large');
    if (!pts) return;
    ears.push({ id: i + 1, pts, r: Number(bw) || inner });
    const own = [{ label: inner ? t('Brim: außen und in großen Löchern') : t('Brim: außen, Löcher und Schriften frei'), key: 'brim_type', value: 'painted', perSlot: false },
      // sonst rückt Orca 2.4 jedes gesetzte Ohr auf den nächsten Eckpunkt des Umrisses (geprüft 2026-10-06: Ohren auf
      // geraden Kanten landeten an Lochecken, der Brim fehlte auf den Kanten)
      { label: t('Brim am kompensierten Umriss'), key: 'brim_use_efc_outline', value: '0', perSlot: false }];
    // nur innen: Orca begrenzt den inneren Brim auf brim_width – dann die Innenbreite
    if (bt === 'no_brim') own.push({ label: t('Brim-Breite'), key: 'brim_width', value: numStr(inner), perSlot: false });
    o.overrides = o.overrides.filter(c => !own.some(x => x.key === c.key)).concat(own);
  });
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
      objs.map(o => '  <item objectid="' + o.id + '" p:UUID="' + uuid(o.id, 'b1ec-4553-aec9-835e5b724bb4') + '" transform="' + placeTransform(o.place, o.hz) + '" printable="1"/>\n').join('') +
      ' </build>\n</model>\n',
    'Metadata/model_settings.config': modelSettingsXML(objs, plateCount),
    'Metadata/project_settings.config': JSON.stringify(settings, null, 4),
    'Metadata/slice_info.config': XML_HEAD + '<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="' + BBL_FILE_VERSION + '"/>\n    <header_item key="OrcaSlicer-Version" value="' + xmlEsc(tpl.orcaVersion) + '"/>\n  </header>\n</config>\n',
    'Metadata/filament_sequence.json': JSON.stringify(Object.fromEntries(Array.from({ length: plateCount }, (_, pi) => ['plate_' + (pi + 1), { nozzle_sequence: [], optimal_assignment: [], sequence: [] }])))
  };
  objs.forEach(o => { files[objectPath(o.k).slice(1)] = meshModelXML(o.g, o.vols, o.mods); });
  if (ears.length) files['Metadata/brim_ear_points.txt'] = brimEarFile(ears);
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

/* Lage eines Build-Items neu: erst die Transformation des Designers (Zeilenvektor · m), dann um die Mitte c des
   Hüllrechtecks (Weltkoordinaten) optional +90° um Z drehen und diese Mitte auf (pl.x, pl.y) setzen. Höhe bleibt. */
const ROT_Z90 = [0, 1, 0, -1, 0, 0, 0, 0, 1], ROT_ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function relocateTransform(m, c, pl) {
  const R = ROT_Z[placeAng(pl)] || ROT_ID, out = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) out.push(m[r * 3] * R[k] + m[r * 3 + 1] * R[3 + k] + m[r * 3 + 2] * R[6 + k]);
  const tx = m[9] - c[0], ty = m[10] - c[1], tz = m[11];
  out.push(tx * R[0] + ty * R[3] + tz * R[6] + pl.x, tx * R[1] + ty * R[4] + tz * R[7] + pl.y, tx * R[2] + ty * R[5] + tz * R[8]);
  return out;
}
// 3MF-Objekt vergrößern/verkleinern: Weltachsen um die Mitte der Grundfläche pv skalieren (Zeilenvektor · Matrix)
function scaleItemTransform(m, s, pv) {
  if (!s || (s[0] === 1 && s[1] === 1 && s[2] === 1)) return m;
  const o = m.slice();
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[r * 3 + k] = m[r * 3 + k] * s[k];
  for (let k = 0; k < 3; k++) o[9 + k] = (m[9 + k] - pv[k]) * s[k] + pv[k];
  return o;
}
/* Transformation eines 3MF-Objekts passend zu part.geom: erst die Drehung part.R (Weltachsen, wie rotatePositions), dann
   die Größe part.scale um die Mitte der Grundfläche, zuletzt zurück aufs Bett (Unterkante wie vorher). Ohne Drehung und
   Größe unverändert. g = part.geom (gedreht und skaliert), g0z = Unterkante vor der Drehung (Designer: meist 0). */
function partItemTransform(m, part, g) {
  const R = part && part.R, rot = R && R.some((v, i) => v !== [1, 0, 0, 0, 1, 0, 0, 0, 1][i]), sc = part && part.scale;
  if (!rot && !(sc && (sc[0] !== 1 || sc[1] !== 1 || sc[2] !== 1))) return m;
  let o = m.slice();
  if (rot) {
    // Zeilenvektor: w' = w · Rᵀ → M' = M · Rᵀ, t' = t · Rᵀ
    const mul = row => [0, 1, 2].map(k => row[0] * R[k * 3] + row[1] * R[k * 3 + 1] + row[2] * R[k * 3 + 2]);
    for (let r = 0; r < 4; r++) { const v = mul([o[r * 3], o[r * 3 + 1], o[r * 3 + 2]]); o[r * 3] = v[0]; o[r * 3 + 1] = v[1]; o[r * 3 + 2] = v[2]; }
  }
  o = scaleItemTransform(o, sc, geomPivot(g));
  if (rot) {   // gedrehtes Teil wieder auf das Bett: Unterkante wie vor der Drehung (origPos, meist 0)
    let z0 = Infinity; const P = part.origPos || []; for (let i = 2; i < P.length; i += 3) if (P[i] < z0) z0 = P[i];
    o[11] += (isFinite(z0) ? z0 : 0) - g.mn[2];
  }
  return o;
}
/* Beschriftung auf Objekten des Designers (Makerworld-3MF): je Text ein weiteres Bauteil im Objekt – erhaben mit eigenem
   Slot (normal_part), vertieft als negative_part, wie OrcaSlicer es selbst speichert. Das Netz kommt als eigenes Objekt ins
   Hauptmodell und als Komponente in das Objekt des Designers, in dessen Koordinaten: Text (Koordinaten wie part.geom) →
   Größe und Drehung des Teils heraus → Welt der 3MF → Objekt (Umkehrung der ursprünglichen Transformation des Build-Items).
   Muss vor dem Verschieben der Build-Items laufen (braucht deren ursprüngliche Transformation). */
function inv3x4(m) {   // Umkehrung einer 3MF-Transformation (Zeilenvektor · 3×3 + t)
  const [a, b, c, d, e, f, g, h, i] = m, det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
  const t = [0, 1, 2].map(k => -(m[9] * r[k] + m[10] * r[3 + k] + m[11] * r[6 + k]));
  return r.concat(t);
}
function designerTexts(out, rootPath, items, zipLib, nFil) {
  const withText = [], seen = new Set();
  for (const j of items) {
    const p = j.part;
    if (!p || p.extra || p.objectId == null || seen.has(String(p.objectId)) || !itemTexts(j).length) continue;
    seen.add(String(p.objectId)); withText.push(j);
  }
  if (!withText.length || typeof textMesh !== 'function') return 0;
  let model = zipLib.strFromU8(out[rootPath]), ms = zipLib.strFromU8(out['Metadata/model_settings.config'] || zipLib.strToU8(''));
  let maxId = 0;
  for (const [name, data] of Object.entries(out)) if (/\.model$/i.test(name)) {
    const text = name === rootPath ? model : zipLib.strFromU8(data);
    for (const m of text.matchAll(/<(?:\w+:)?object\b[^>]*?\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  }
  for (const m of ms.matchAll(/<(?:object|part) id="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  const hasP = /<(?:\w+:)?model\b[^>]*xmlns:p=/.test(model), resources = [];
  let added = 0;
  for (const j of withText) {
    const p = j.part, id = String(p.objectId);
    const item = [...model.matchAll(/<(?:\w+:)?item\b([^>]*)>/g)].map(x => x[1]).find(a => (/objectid="([^"]+)"/.exec(a) || [])[1] === id);
    const tr = item && (/transform="([^"]+)"/.exec(item) || [])[1], M = tr ? tr.trim().split(/\s+/).map(Number) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const Mi = inv3x4(M); if (!Mi) continue;
    const g = p.geom, pv = [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, g.mn[2]], s = p.scale || [1, 1, 1], R = p.R || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const toLocal = (x, y, z) => {
      const u = [x, y, z].map((v, k) => pv[k] + (v - pv[k]) / s[k]);                                     // Größe heraus
      const w = [0, 1, 2].map(k => R[k] * u[0] + R[3 + k] * u[1] + R[6 + k] * u[2]);                   // Drehung heraus (Rᵀ)
      return [0, 1, 2].map(k => w[0] * Mi[k] + w[1] * Mi[3 + k] + w[2] * Mi[6 + k] + Mi[9 + k]);    // Welt → Objekt
    };
    let partsXml = '';
    for (const x of itemTexts(j)) {
      const mesh = textMesh(typeof textScaled === 'function' ? textScaled(x, p) : x, p.R || null), loc = new Float32Array(mesh.length);
      for (let i = 0; i < mesh.length; i += 3) { const q = toLocal(mesh[i], mesh[i + 1], mesh[i + 2]); loc[i] = q[0]; loc[i + 1] = q[1]; loc[i + 2] = q[2]; }
      const oid = ++maxId, xml = meshObjectXML(loc, [0, 0, 0], oid);
      resources.push(hasP ? xml : xml.replace(/ p:UUID="[^"]*"/, ''));
      model = model.replace(new RegExp('(<(?:\\w+:)?object\\b[^>]*\\bid="' + id + '"[^>]*>[\\s\\S]*?)(</(?:\\w+:)?components>)'),
        (all, head, close) => head + '   <component objectid="' + oid + '"' + (hasP ? ' p:UUID="' + uuid(oid, 'b206-40ff-9872-83e8017abed1') + '"' : '') + ' transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n  ' + close);
      const name = (x.mode === 'engraved' ? 'Gravur' : 'Schrift') + ' „' + String(x.text).slice(0, 40) + '“';
      partsXml += '    <part id="' + oid + '" subtype="' + (x.mode === 'engraved' ? 'negative_part' : 'normal_part') + '">\n      <metadata key="name" value="' + xmlEsc(name) + '"/>\n' +
        '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
        (x.mode !== 'engraved' && x.slot != null ? '      <metadata key="extruder" value="' + (Math.min(x.slot, nFil - 1) + 1) + '"/>\n' : '') + '    </part>\n';
      added++;
    }
    ms = ms.replace(new RegExp('(<object id="' + id + '">[\\s\\S]*?)(\\n?[ \\t]*</object>)'), (all, body, close) => body + '\n' + partsXml.replace(/\n$/, '') + close);
  }
  if (resources.length) model = model.replace(/(\n?[ \t]*<\/(?:\w+:)?resources>)/, '\n' + resources.join('').replace(/\n$/, '') + '$1');
  out[rootPath] = zipLib.strToU8(model);
  out['Metadata/model_settings.config'] = zipLib.strToU8(ms);
  return added;
}
const geomPivot = g => [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, g.mn[2]];
const fmtTransform = m => m.map(v => { const s = String(Math.round(v * 1e6) / 1e6); return s === '-0' ? '0' : s; }).join(' ');
const PLATE_FILE_KEYS = /[ \t]*<metadata key="(thumbnail_file|thumbnail_no_light_file|top_file|pick_file|pattern_file|pattern_bbox_file)" value="[^"]*"\/>\n?/g;

/* Build-Items, Platten (model_instance) und assemble der 3MF neu schreiben; hinzugefügte einfache Teile als neue
   Objekte (Netz direkt im Hauptmodell, ein Bauteil je Körper, dazu Loch-Modifikatoren) anhängen.
   Kopien eines 3MF-Objekts werden weitere Instanzen desselben Objekts (Orca: gleiche Bauteile, Modifikatoren, Bemalung
   und Objekt-Einstellungen, eigene Lage) – so bleibt die Datei klein und jede Änderung am Objekt gilt für alle Kopien.
   zipFiles: alle Dateien der 3MF (für freie Ids). Ergebnis {model, ms, objectChanges}. */
function relayout3mf(model, ms, items, lay, settings, partSlot, nFil, zipFiles, zipLib) {
  // freie Ids oberhalb aller vorhandenen (Objekte und Bauteile, auch in 3D/Objects/*)
  let maxId = 0;
  for (const [name, data] of Object.entries(zipFiles)) if (/\.model$/i.test(name)) {
    const text = name === '3D/3dmodel.model' ? model : zipLib.strFromU8(data);
    for (const m of text.matchAll(/<(?:\w+:)?object\b[^>]*?\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  }
  for (const m of ms.matchAll(/<(?:object|part) id="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  let nextId = maxId + 1;
  const hasP = /<(?:\w+:)?model\b[^>]*xmlns:p=/.test(model);
  const uuidAttr = (n, tail) => hasP ? ' p:UUID="' + uuid(n, tail) + '"' : '';
  // Build-Items des Designers je Objekt (Reihenfolge = Instanz) und seine Montage-Lage
  const orig = new Map();
  for (const m of model.matchAll(/<(?:\w+:)?item\b([^>]*?)\/?>/g)) {
    const id = (/objectid="([^"]+)"/.exec(m[1]) || [])[1], tr = (/transform="([^"]+)"/.exec(m[1]) || [])[1];
    const t = tr ? tr.trim().split(/\s+/).map(Number) : ROT_ID.concat([0, 0, 0]);
    if (!orig.has(id)) orig.set(id, []);
    orig.get(id).push({ attrs: m[1].replace(/\s*\/?\s*$/, ''), m: t.length === 12 && t.every(Number.isFinite) ? t : ROT_ID.concat([0, 0, 0]) });
  }
  const assembleOf = new Map();
  for (const m of ms.matchAll(/<assemble_item\b([^>]*?)\/?>/g)) {
    const a = attrsOfTag(m[1]);
    assembleOf.set(a.object_id + '#' + (a.instance_id || 0), a.transform);
  }
  const buildXml = [], instances = [], extraObjs = [], resources = [], objectChanges = [], used = new Map();
  items.forEach((j, i) => {
    const pl = lay.places[i], g = j.geom, c = [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2];
    const src = j.part && j.part.objectId != null && !j.part.extra && orig.get(String(j.part.objectId));
    if (src && src.length) {
      const id = String(j.part.objectId), base = src[Math.min(j.part.instance || 0, src.length - 1)], inst = used.get(id) || 0;
      used.set(id, inst + 1);
      const tr = fmtTransform(relocateTransform(partItemTransform(base.m, j.part, g), c, pl));
      let attrs = base.attrs.replace(/\s*transform="[^"]*"/, '') + ' transform="' + tr + '"';
      if (inst >= src.length || j.part.copy) attrs = attrs.replace(/p:UUID="[^"]*"/, 'p:UUID="' + uuid(0x8000 + i, 'c0de-4553-aec9-835e5b724bb4') + '"');
      buildXml.push('  <item' + (attrs.startsWith(' ') ? '' : ' ') + attrs + ' />');
      instances.push({ id, inst, plate: pl.plate, assemble: assembleOf.get(id + '#' + (j.part.instance || 0)) || tr });
      return;
    }
    // Hinzugefügtes Teil: Körper und Loch-Modifikatoren als Netze, lokal um die Mitte (wie build3mfFiles)
    const tv = textVolumes(1, j);
    const paint = typeof paintAttrsFn === 'function' && j.part ? paintAttrsFn(j.part, dmap, nFil) : null;
    const vols = bodyVolumes(g, j.bodies, 1, paint).concat(tv.vols).map(v => ({ ...v, id: nextId++ })), mods = tv.negs.concat(holeMods(1, j.holes)).map(m => ({ ...m, id: nextId++ }));
    const oid = nextId++, center = [c[0], c[1], (g.mn[2] + g.mx[2]) / 2];
    const mesh = (pos, id, pt) => { const x = meshObjectXML(pos, center, id, pt); return hasP ? x : x.replace(/ p:UUID="[^"]*"/, ''); };
    resources.push(...vols.map(v => mesh(v.pos, v.id, v.paint)), ...mods.map(m => mesh(m.pos, m.id)),
      '  <object id="' + oid + '"' + uuidAttr(oid, '61cb-4c03-9d28-80fed5dfa1dc') + ' type="model">\n   <components>\n' +
      vols.concat(mods).map(v => '    <component objectid="' + v.id + '"' + uuidAttr(v.id, 'b206-40ff-9872-83e8017abed1') + ' transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n').join('') + '   </components>\n  </object>\n');
    const tr = placeTransform(pl, coord(g.z / 2));
    buildXml.push('  <item objectid="' + oid + '"' + uuidAttr(oid, 'b1ec-4553-aec9-835e5b724bb4') + ' transform="' + tr + '" printable="1" />');
    const own = j.r ? objectOverrides(settings, j.r, j.part) : [];
    if (own.length) objectChanges.push({ name: g.name, changes: own });
    extraObjs.push({ id: oid, name: xmlEsc(g.name), extruder: Math.min(partSlot(j), nFil - 1) + 1, overrides: own, mods,
      vols: vols.map(v => ({ ...v, slot: v.slot == null ? null : Math.min(v.slot, nFil - 1) })) });
    instances.push({ id: String(oid), inst: 0, plate: pl.plate, assemble: tr });
  });
  if (resources.length) model = model.replace(/(\n?[ \t]*<\/(?:\w+:)?resources>)/, '\n' + resources.join('').replace(/\n$/, '') + '$1');
  model = model.replace(/(<(?:\w+:)?build\b[^>]*?)(?:\/>|>[\s\S]*?<\/((?:\w+:)?build)>)/, (all, open, close) => (open.endsWith(' ') ? open.slice(0, -1) : open) + '>\n' + buildXml.join('\n') + '\n </' + (close || 'build') + '>');

  // Platten: Kopf der gleichnamigen Platte des Designers (ohne Vorschaubilder, die nicht mehr passen), Instanzen neu
  const origPlates = [...ms.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map(m => m[1]);
  const plateXml = k => {
    const src = origPlates.find(b => new RegExp('key="plater_id" value="' + k + '"').test(b));
    const head = src ? src.replace(/\s*<model_instance>[\s\S]*?<\/model_instance>/g, '').replace(PLATE_FILE_KEYS, '').replace(/\s+$/, '')
      : '\n    <metadata key="plater_id" value="' + k + '"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>';
    return '  <plate>' + head + '\n' + instances.map((x, n) => [x, n]).filter(([x]) => x.plate === k - 1).map(([x, n]) => '    <model_instance>\n      <metadata key="object_id" value="' + x.id + '"/>\n      <metadata key="instance_id" value="' + x.inst + '"/>\n      <metadata key="identify_id" value="' + (2000 + n) + '"/>\n    </model_instance>\n').join('') + '  </plate>\n';
  };
  ms = ms.replace(/[ \t]*<plate>[\s\S]*?<\/plate>\n?/g, '').replace(/[ \t]*<assemble>[\s\S]*?<\/assemble>\n?/g, '');
  const tail = extraObjs.map(objectConfigXML).join('') + Array.from({ length: lay.count }, (_, k) => plateXml(k + 1)).join('') +
    '  <assemble>\n' + instances.map(x => '   <assemble_item object_id="' + x.id + '" instance_id="' + x.inst + '" transform="' + x.assemble + '" offset="0 0 0" />\n').join('') + '  </assemble>\n';
  ms = /<\/config>/.test(ms) ? ms.replace(/<\/config>\s*$/, tail + '</config>\n') : ms + tail;
  return { model, ms, objectChanges };
}
const attrsOfTag = tag => { const o = {}; tag.replace(/([\w:]+)="([^"]*)"/g, (_, k, v) => { o[k] = v; }); return o; };

/* jobs: [{geom, r, slot, bodies?, part:{objectId, plate}}] wie aus partJobs(); threemf = Import-Ergebnis mit zip.
   Ist die 3MF neu angeordnet oder kommen eigene Teile/Kopien dazu (needsRelayout), schreibt relayout3mf Build-Items,
   Platten und die neuen Objekte; sonst bleiben Lage und Platten des Designers (je Platte auf die Bettmitte gerückt). */
function build3mfFromProject(tpl, r, jobs, slot, zipLib, liveSlots, threemf, machine) {
  const items = jobs.map(j => ({ ...j, plate: j.part && j.part.plate }));
  const { extra, notes, partSlot } = slotPlan(items, r, slot);
  const nFil = tpl.settings.filament_settings_id.length;
  // Slots, die nur Farb-Modifikatoren des Designers nutzen (z. B. ein Schriftzug), bekommen die Filamentwerte ihres Teils –
  // sonst blieben dort die Vorlagenwerte, und Orca lehnt die Mischung ab („nozzle temperatures are incompatible“)
  const dmap = threemf.designMap || {};
  // dasselbe für die Bemalung je Dreieck (js/paint.js: Filamente des Designers, umgelegt über designMap)
  items.forEach(j => [...((j.part && j.part.modSlots) || []), ...((j.part && j.part.paintSlots) || [])].forEach(d => { const s = dmap[d] ?? d;
    if (s !== slot && s < nFil && !extra.some(e => e.slot === s)) extra.push({ slot: s, r: j.r || r }); }));
  items.forEach(j => { if (partSlot(j) >= nFil) notes.push(t('{part}: Slot {n} gibt es an deinem Drucker nicht – bitte in Orca zuweisen.', { part: j.geom.name, n: partSlot(j) + 1 })); });
  items.forEach(j => (j.bodies || []).forEach(b => { if (b.slot != null && b.slot >= nFil) notes.push(t('{part} · {body}: Slot {n} gibt es an deinem Drucker nicht – Slot {last} wird verwendet.', { part: j.geom.name, body: b.name, n: b.slot + 1, last: nFil })); }));
  const { settings, changes } = buildProjectSettings(tpl, r, slot, liveSlots, extra.filter(e => e.slot < nFil), machine);
  const relayout = needsRelayout(threemf, items.map(j => j.part));
  let shifts = new Map(), lay = null;
  if (relayout) {
    lay = layout3mf(items.map(j => ({ geom: j.geom, plate: j.plate, own: ownPlaced(j.part) })), tpl, threemf.layout || null);
    lay.oversizePlates.forEach(id => notes.push(t('Platte {n} ist größer als dein Druckbett – in Orca prüfen.', { n: id })));
    if (lay.oversize.length) notes.push(t('Passt nicht aufs Bett: {parts} – in Orca prüfen.', { parts: lay.oversize.map(i => items[i].geom.name).join(', ') }));
    if (lay.overflow) notes.push(t('Nicht alle Teile einer Platte passen aufs Bett – sie stehen auf einer zusätzlichen Platte.'));
    // Reinigungsturm je Platte: Hüllrechtecke in Bettkoordinaten der Platte
    const [bw, bd] = bedSize(tpl), cols = Math.ceil(Math.sqrt(lay.count));
    const origin = pi => [(pi % cols) * bw * PLATE_STRIDE, -Math.floor(pi / cols) * bd * PLATE_STRIDE];
    const plates = Array.from({ length: lay.count }, () => ({ rects: [], slots: new Set(), idx: [] }));
    items.forEach((j, i) => {
      const pl = lay.places[i], [ox, oy] = origin(pl.plate), q = plates[pl.plate], [fw, fd] = footprint(j.geom, pl);
      q.rects.push([pl.x - ox - fw / 2, pl.y - oy - fd / 2, pl.x - ox + fw / 2, pl.y - oy + fd / 2]);
      q.slots.add(Math.min(partSlot(j), nFil - 1)); (j.bodies || []).forEach(b => { if (b.slot != null) q.slots.add(Math.min(b.slot, nFil - 1)); }); extraSlots(j).forEach(s => q.slots.add(Math.min(s, nFil - 1)));
      if (j.part && (j.part.painted || (j.part.modSlots || []).length)) q.slots.add('bemalt');
      q.idx.push(i);
    });
    const tp = planTowers(settings, tpl, plates);
    plates.forEach((q, pi) => { const [dx, dy] = tp.shifts[pi]; if (dx || dy) q.idx.forEach(i => { lay.places[i] = { ...lay.places[i], x: lay.places[i].x + dx, y: lay.places[i].y + dy }; }); });
    applyTowers(settings, changes, tp);
    notes.push(...tp.notes);
  } else {
    const ps = plateShifts(items, tpl);
    shifts = ps.shifts;
    ps.oversize.forEach(id => notes.push(t('Platte {n} ist größer als dein Druckbett – in Orca prüfen.', { n: id })));
    // Reinigungsturm je Platte (Platten-Ids 1..n); Teile nach der Verschiebung auf die Bettmitte
    const count = Math.max(1, ...items.map(j => j.plate || 1)), [bw, bd] = bedSize(tpl), cols = Math.ceil(Math.sqrt(count));
    const plates = Array.from({ length: count }, () => ({ rects: [], slots: new Set() }));
    for (const j of items) {
      const id = j.plate || 1, [sx, sy] = shifts.get(id) || [0, 0], pi = id - 1, ox = (pi % cols) * bw * PLATE_STRIDE, oy = -Math.floor(pi / cols) * bd * PLATE_STRIDE;
      plates[pi].rects.push([j.geom.mn[0] + sx - ox, j.geom.mn[1] + sy - oy, j.geom.mx[0] + sx - ox, j.geom.mx[1] + sy - oy]);
      plates[pi].slots.add(Math.min(partSlot(j), nFil - 1)); (j.bodies || []).forEach(b => { if (b.slot != null) plates[pi].slots.add(Math.min(b.slot, nFil - 1)); }); extraSlots(j).forEach(s => plates[pi].slots.add(Math.min(s, nFil - 1)));
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

  // Beschriftung auf Objekten des Designers als weitere Bauteile (vor dem Verschieben: braucht die ursprünglichen Transformationen)
  designerTexts(out, Object.keys(out).find(k => /^3D\/3dmodel\.model$/i.test(k)), items, zipLib, nFil);
  // Build-Items verschieben (Translation = letzte drei Werte der Matrix)
  const rootPath = Object.keys(out).find(k => /^3D\/3dmodel\.model$/i.test(k));
  if (!relayout) {
    // Je Build-Item die Platte seiner Instanz – dasselbe Objekt kann auf mehreren Platten stehen
    const plateOfItem = new Map(items.map(j => [j.part.objectId + '#' + (j.part.instance || 0), j.plate || 1]));
    const itemOf = new Map(items.map(j => [j.part.objectId + '#' + (j.part.instance || 0), j]));
    const itemCount = new Map();
    out[rootPath] = zipLib.strToU8(zipLib.strFromU8(out[rootPath]).replace(/<((?:\w+:)?item\b)([^>]*?)(\/?)>/g, (all, tag, attrs, close) => {
      const id = (/objectid="([^"]+)"/.exec(attrs) || [])[1], inst = itemCount.get(id) || 0;
      itemCount.set(id, inst + 1);
      const shift = shifts.get(plateOfItem.get(id + '#' + inst));
      if (!shift) return all;
      const t = (/transform="([^"]+)"/.exec(attrs) || [])[1];
      const j = itemOf.get(id + '#' + inst);
      const m0 = t ? t.trim().split(/\s+/).map(Number) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], m = j ? partItemTransform(m0, j.part, j.geom) : m0;
      m[9] += shift[0]; m[10] += shift[1];
      const tr = 'transform="' + m.map(v => String(Math.round(v * 1e4) / 1e4)).join(' ') + '"';
      return '<' + tag + (t ? attrs.replace(/transform="[^"]+"/, tr) : attrs + ' ' + tr) + close + '>';
    }));
  }

  // Slot und eigene Werte je Objekt
  const computedKeys = [...new Set(plannedChanges(r, 0, null).filter(c => !c.perSlot && isObjectKey(c.key)).map(c => c.key).concat([...OBJECT_KEYS], supportChanges(r).map(x => x[1])))];
  const objectChanges = [];
  let ms = zipLib.strFromU8(out['Metadata/model_settings.config'] || zipLib.strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<config>\n</config>\n'));
  const done = new Set(); // Objekt mit mehreren Instanzen nur einmal anpassen
  for (const j of items) {
    if (j.part.objectId == null || j.part.extra || done.has(j.part.objectId)) continue;   // hinzugefügte Teile: relayout3mf
    done.add(j.part.objectId);
    const own = objectOverrides(settings, j.r, j.part);
    if (own.length) objectChanges.push({ name: j.geom.name, changes: own });
    const esc = String(j.part.objectId).replace(/[^\w-]/g, '');
    if (!new RegExp('<object id="' + esc + '">').test(ms)) { notes.push(t('{part}: keine Objekt-Einstellungen in der 3MF – Slot und eigene Werte bitte in Orca prüfen.', { part: j.geom.name })); continue; }
    ms = ms.replace(new RegExp('(<object id="' + esc + '">)([\\s\\S]*?)(?=<part\\b|</object>)'), (all, open, body) => patchObjectHead(open + body, Math.min(partSlot(j), nFil - 1) + 1, own, computedKeys));
    for (const b of j.bodies || []) if (b.partId != null) ms = patchPartExtruder(ms, esc, b.partId, b.slot == null ? null : Math.min(b.slot, nFil - 1) + 1);
    if (threemf.designMap && Object.keys(threemf.designMap).length) ms = patchModifierExtruders(ms, esc, threemf.designMap, nFil);
  }
  if (relayout) {
    const rl = relayout3mf(zipLib.strFromU8(out[rootPath]), ms, items, lay, settings, partSlot, nFil, out, zipLib);
    out[rootPath] = zipLib.strToU8(rl.model); ms = rl.ms; objectChanges.push(...rl.objectChanges);
    if (out['Metadata/filament_sequence.json']) out['Metadata/filament_sequence.json'] = zipLib.strToU8(JSON.stringify(Object.fromEntries(Array.from({ length: lay.count }, (_, pi) => ['plate_' + (pi + 1), { nozzle_sequence: [], optimal_assignment: [], sequence: [] }]))));
  }
  out['Metadata/model_settings.config'] = zipLib.strToU8(ms);
  // Bemalung je Dreieck: Filamente des Designers auf die eigenen Slots umschreiben (designMap), sonst blieben Nummern stehen,
  // die es am Drucker nicht gibt (Mario mit 7 Farben, eine ACE mit 4 Slots)
  const pmap = threemf.designMap || {}, remap = st => Math.min((pmap[st - 1] ?? st - 1), nFil - 1) + 1;
  if (typeof paintRemap === 'function' && items.some(j => j.part && j.part.paintState && (j.part.paintSlots || []).some(d => remap(d + 1) !== d + 1)))
    for (const name of Object.keys(out)) {
      if (!/\.model$/i.test(name)) continue;
      const txt = zipLib.strFromU8(out[name]);
      if (!txt.includes('paint_color="')) continue;
      out[name] = zipLib.strToU8(txt.replace(/paint_color="([0-9A-Fa-f]+)"/g, (all, code) => { try { return 'paint_color="' + paintRemap(code, remap) + '"'; } catch (e) { return all; } }));
    }
  // eigene Bemalung (js/paint-ui.js) in die Dreiecke des Designers schreiben – nach dem Umschreiben oben, sie hat schon Slot-Nummern
  writeUserPaint(out, items, zipLib, nFil);
  return { bytes: zipLib.zipSync(out, { level: 6 }), changes, objectChanges, notes, plateCount: relayout ? lay.count : shifts.size };
}

/* Eigene Bemalung auf Objekten des Designers: part.paintSrc sagt, aus welcher Datei und welchem Netz die Dreiecke des Teils
   stammen (js/import.js). Die Dreiecke dort bekommen je Ebene (Farbe, Stützen, Naht) den eigenen Code (Farbe: Filament =
   Slot + 1, höchstens nFil) bzw. verlieren die Bemalung („0“ = ausradiert). Mehrere Platzierungen desselben Objekts teilen
   die Bemalung (wie in OrcaSlicer). */
function writeUserPaint(out, items, zipLib, nFil) {
  if (typeof paintRemap !== 'function') return;
  const byFile = new Map(), done = new Set(), fil = s => Math.min(s - 1, nFil - 1) + 1;
  for (const j of items) {
    const p = j.part;
    if (!p || p.extra || p.objectId == null || !p.paintSrc || done.has(String(p.objectId))) continue;
    const layers = Object.keys(PAINT_LAYERS).map(l => ({ attr: PAINT_LAYERS[l].attr, codes: paintUserCodes(p, l), map: l === 'color' ? fil : null })).filter(x => x.codes && Object.keys(x.codes).length);
    if (!layers.length) continue;
    done.add(String(p.objectId));
    for (const s of p.paintSrc) {
      const f = byFile.get(s.path) || byFile.set(s.path, new Map()).get(s.path);
      if (!f.has(String(s.id))) f.set(String(s.id), { start: s.start, layers });
    }
  }
  for (const [path, objs] of byFile) {
    const name = Object.keys(out).find(k => k.toLowerCase() === path.replace(/^\//, '').toLowerCase());
    if (!name) continue;
    const txt = zipLib.strFromU8(out[name]);
    out[name] = zipLib.strToU8(txt.replace(/<((?:\w+:)?object)\b([^>]*)>([\s\S]*?)<\/\1>/g, (all, tag, attrs, body) => {
      const e = objs.get((/\bid="([^"]+)"/.exec(attrs) || [])[1]);
      if (!e) return all;
      let i = 0;
      return '<' + tag + attrs + '>' + body.replace(/<((?:\w+:)?triangle)\b([^>]*?)\s*(\/?)>/g, (tri, ttag, tattrs, close) => {
        const g = e.start + i++;
        let a = tattrs, changed = false;
        for (const L of e.layers) {
          const code = L.codes[g];
          if (code == null) continue;
          changed = true;
          a = a.replace(new RegExp('\\s*' + L.attr + '="[^"]*"'), '');
          if (code && code !== '0') a += ' ' + L.attr + '="' + (L.map ? paintRemap(code, L.map) : code) + '"';
        }
        return changed ? '<' + ttag + a + (close ? '/' : '') + '>' : tri;
      }) + '</' + tag + '>';
    }));
  }
}

// ZIP über fflate (vendor/fflate.min.js); zipLib wird übergeben, damit der Test es in Node nutzen kann.
function build3mf(tpl, r, parts, slot, zipLib, liveSlots, machine) {
  const { files, changes, plateCount, objectChanges, notes } = build3mfFiles(tpl, r, parts, slot, liveSlots, machine);
  const entries = {};
  for (const [p, text] of Object.entries(files)) entries[p] = zipLib.strToU8(text);
  return { bytes: zipLib.zipSync(entries, { level: 6 }), changes, plateCount, objectChanges, notes };
}
