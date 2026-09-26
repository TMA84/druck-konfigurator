'use strict';
/* 3MF-Export für OrcaSlicer. Basis ist die vom Nutzer in Orca gespeicherte Vorlage
   (ORCA_TEMPLATES, erzeugt aus templates/*.3mf). Überschrieben werden nur Werte, die der
   Konfigurator berechnet – alles andere (Druckerprofil, Start-G-Code, Grenzen) bleibt aus der
   Vorlage. Kein DOM-Zugriff: tests/verify-3mf.js prüft das Ergebnis mit der Orca-CLI. */

const ORCA_KIND = { pla: 'PLA', petg: 'PETG', abs: 'ABS', asa: 'ASA', tpu: 'TPU' };
const BED_TEMP_KEYS = ['hot_plate_temp', 'textured_plate_temp', 'cool_plate_temp', 'eng_plate_temp'];
const SEAM_ORCA = { Hinten: 'back', Ausgerichtet: 'aligned' };
const PART_GAP_MM = 8;          // Abstand zwischen Teilen beim Anordnen
const PLATE_STRIDE = 1.2;       // Orca legt Platte n um 1,2 × Bettgröße versetzt ab (Spalten = ⌈√Platten⌉)
const objectPath = k => '/3D/Objects/object_' + k + '.model';

function exportTemplate(printerId, nozD) {
  return (ORCA_TEMPLATES[printerId] || {})[nozD] || null;
}

// Gleiche Zuordnung wie buildOrcaProcessJSON: Gyroid ist in beiden Mustervorschlägen die Primärempfehlung.
function orcaInfillPattern(pattern) { return pattern.indexOf('Gyroid') === 0 ? 'gyroid' : 'crosshatch'; }
const numStr = v => String(Math.round(Number(v) * 1000) / 1000);

// Brim-Empfehlung ("5–8 mm", "Nicht nötig", "0–5 mm") → [brim_type, brim_width]; untere Grenze als Startwert.
function orcaBrim(brim) {
  const m = /^(\d+(?:[.,]\d+)?)/.exec(brim);
  const w = m ? Number(m[1].replace(',', '.')) : 0;
  return w > 0 ? ['outer_only', numStr(w)] : ['no_brim', null];
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
    if (s.colour) fil('Slot ' + (i + 1) + ' Farbe (Drucker)', 'filament_colour', s.colour, i);
    if (i !== slot && s.type) fil('Slot ' + (i + 1) + ' Typ (Drucker)', 'filament_type', s.type, i);
  });

  fil('Filamenttyp', 'filament_type', ORCA_KIND[r.m.kind] || 'PLA');
  fil('Düse', 'nozzle_temperature', r.nozzle);
  fil('Düse erste Schicht', 'nozzle_temperature_initial_layer', r.nozzle);
  BED_TEMP_KEYS.forEach(k => { fil('Heizbett (' + k.replace('_temp', '') + ')', k, r.m.bed); fil('Heizbett erste Schicht (' + k.replace('_temp', '') + ')', k + '_initial_layer', r.m.bed); });
  fil('Lüfter min.', 'fan_min_speed', r.m.fan);
  fil('Lüfter max.', 'fan_max_speed', r.m.fan);
  fil('Max. Volumenstrom', 'filament_max_volumetric_speed', numStr(r.maxVol));
  fil('Durchflussverhältnis', 'filament_flow_ratio', numStr(r.m.flow));
  if (r.m.pa !== null && r.m.pa !== undefined && r.m.pa !== '') {
    fil('Pressure Advance', 'pressure_advance', numStr(r.m.pa));
    fil('Pressure Advance aktiv', 'enable_pressure_advance', 1);
  }

  proc('Schichthöhe', 'layer_height', numStr(r.layer));
  proc('Erste Schicht', 'initial_layer_print_height', numStr(r.firstLayer));
  proc('Wandlinien', 'wall_loops', r.w);
  proc('Fülldichte', 'sparse_infill_density', r.inf + '%');
  proc('Füllmuster', 'sparse_infill_pattern', orcaInfillPattern(r.pattern));
  proc('Obere Schichten', 'top_shell_layers', r.t);
  proc('Untere Schichten', 'bottom_shell_layers', r.b);
  proc('Außenwand', 'outer_wall_speed', r.sp_outer);
  proc('Innenwand', 'inner_wall_speed', r.sp_inner);
  proc('Füllung', 'sparse_infill_speed', r.sp_fill);
  proc('Innere massive Füllung', 'internal_solid_infill_speed', r.sp_fill);
  proc('Obere Fläche', 'top_surface_speed', r.top);
  proc('Lückenfüllung', 'gap_infill_speed', r.m.gap);
  proc('Erste Schicht Geschwindigkeit', 'initial_layer_speed', r.m.first);
  proc('Travel', 'travel_speed', r.m.travel);
  proc('Stützen', 'enable_support', r.supOn ? 1 : 0);
  if (r.supOn) {
    proc('Stützentyp', 'support_type', 'tree(auto)');
    proc('Schwellenwinkel', 'support_threshold_angle', r.sp.angle);
    proc('Nur auf Druckplatte', 'support_on_build_plate_only', 1);
  }
  const [brimType, brimWidth] = orcaBrim(r.brim);
  proc('Brim', 'brim_type', brimType);
  if (brimWidth) proc('Brim-Breite', 'brim_width', brimWidth);
  if (SEAM_ORCA[r.seam]) proc('Nahtposition', 'seam_position', SEAM_ORCA[r.seam]);
  return f.map(([label, key, value, index]) => ({ label, key, value, perSlot: index !== null, index }));
}

// Neue project_settings (Kopie) + Liste der tatsächlichen Änderungen gegenüber der Vorlage.
/* OrcaSlicer-GUI lädt beim Öffnen eines Projekts die genannten System-Presets neu und übernimmt aus
   der Datei nur die Schlüssel, die in different_settings_to_system stehen (Aufbau wie von Orca selbst
   gespeichert: [Prozess, Filament 1..n, Drucker], Schlüssel mit ";" getrennt). Ohne diese Liste
   landen in der Oberfläche die Presetwerte statt der exportierten (beobachtet 2026-09-26). */
function filamentSlotTypes(r, slot, liveSlots, n) {
  const types = Array(n).fill(null);
  (liveSlots || []).forEach((s, i) => { if (i < n && s.type) types[i] = s.type; });
  types[slot] = ORCA_KIND[r.m.kind] || types[slot];
  return types;
}

function buildProjectSettings(tpl, r, slot, liveSlots) {
  const settings = JSON.parse(JSON.stringify(tpl.settings));
  const changes = [];
  const nFil = settings.filament_settings_id.length;
  const groups = nFil + 2; // Prozess, Filamente, Drucker
  const tplDiff = tpl.settings.different_settings_to_system || [];
  const diff = Array.from({ length: groups }, (_, i) => new Set(String(tplDiff[i] || '').split(';').filter(Boolean)));
  const inherits = Array.from({ length: groups }, (_, i) => (tpl.settings.inherits_group || [])[i] || '');

  // 1) Jeder Slot bekommt das System-Preset seines Filamenttyps (sofern Orca eines kennt)
  const presets = tpl.filamentPresets || {};
  filamentSlotTypes(r, slot, liveSlots, nFil).forEach((type, i) => {
    const preset = type && presets[String(type).toUpperCase()];
    if (!preset || settings.filament_settings_id[i] === preset) return;
    changes.push({ label: 'Slot ' + (i + 1) + ' Preset', key: 'filament_settings_id', before: settings.filament_settings_id[i], after: preset });
    settings.filament_settings_id[i] = preset;
    diff[1 + i].clear();    // Abweichungen der alten (Benutzer-)Presets gelten nicht mehr
    inherits[1 + i] = '';   // direkt ein System-Preset
  });

  // 2) Berechnete Werte schreiben und als „geändert“ vermerken
  for (const c of plannedChanges(r, slot, liveSlots)) {
    if (!(c.key in settings)) continue; // Schlüssel kennt diese Orca-Version nicht → Vorlage unverändert
    if (c.perSlot && !(c.index < settings[c.key].length)) continue; // mehr Druckerslots als in der Vorlage
    const before = c.perSlot ? settings[c.key][c.index] : settings[c.key];
    if (c.perSlot) settings[c.key][c.index] = c.value; else settings[c.key] = c.value;
    diff[c.perSlot ? 1 + c.index : 0].add(c.key);
    if (before !== c.value) changes.push({ label: c.label, key: c.key, before, after: c.value });
  }
  settings.different_settings_to_system = diff.map(s => [...s].join(';'));
  settings.inherits_group = inherits;
  return { settings, changes };
}

const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const uuid = (n, tail) => ('0000' + n.toString(16)).slice(-4) + '0000-' + tail;
const coord = v => String(Math.round(v * 1e5) / 1e5);

// Netz als 3MF-Objekt: gemeinsame Eckpunkte, lokal um den Mittelpunkt zentriert (wie Orca es speichert).
function meshModelXML(geom, id = 1) {
  const cx = (geom.mn[0] + geom.mx[0]) / 2, cy = (geom.mn[1] + geom.mx[1]) / 2, cz = (geom.mn[2] + geom.mx[2]) / 2;
  const index = new Map(), verts = [], tris = [];
  for (let i = 0; i < geom.n; i++) {
    const t = [];
    for (let v = 0; v < 3; v++) {
      const o = i * 9 + v * 3;
      const x = coord(geom.pos[o] - cx), y = coord(geom.pos[o + 1] - cy), z = coord(geom.pos[o + 2] - cz);
      const key = x + ' ' + y + ' ' + z;
      let id = index.get(key);
      if (id === undefined) { id = verts.length; index.set(key, id); verts.push('     <vertex x="' + x + '" y="' + y + '" z="' + z + '"/>'); }
      t.push(id);
    }
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) tris.push('     <triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"/>');
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n' +
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n  <object id="' + id + '" p:UUID="' + uuid(id, '81cb-4c03-9d28-80fed5dfa1dc') + '" type="model">\n   <mesh>\n    <vertices>\n' +
    verts.join('\n') + '\n    </vertices>\n    <triangles>\n' + tris.join('\n') + '\n    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build/>\n</model>\n';
}

function bedSize(tpl) {
  const pts = (tpl.settings.printable_area || []).map(p => p.split('x').map(Number));
  if (!pts.length) return [tpl.bedCenter[0] * 2, tpl.bedCenter[1] * 2];
  return [0, 1].map(k => Math.max(...pts.map(p => p[k])) - Math.min(...pts.map(p => p[k])));
}

/* Teile zeilenweise aufs Bett legen; passt keine Zeile mehr, beginnt eine neue Platte.
   Ergebnis je Teil: {plate (0-basiert), x, y} = Mitte in Orca-Weltkoordinaten. */
function arrangeParts(geoms, tpl) {
  const [bw, bd] = bedSize(tpl), [bx, by] = tpl.bedCenter, gap = PART_GAP_MM;
  const order = geoms.map((g, i) => i).sort((a, b) => geoms[b].y - geoms[a].y || geoms[b].x - geoms[a].x);
  const plates = [];   // je Platte Zeilen: {y0, depth, width, items:[{i, x0}]}
  let rows = [];
  plates.push(rows);
  const nextY = () => rows.length ? rows[rows.length - 1].y0 + rows[rows.length - 1].depth + gap : 0;
  for (const i of order) {
    const g = geoms[i];
    let row = rows.find(r => r.width + gap + g.x <= bw && g.y <= r.depth);
    if (!row) {
      if (rows.length && nextY() + g.y > bd) { rows = []; plates.push(rows); }
      row = { y0: nextY(), depth: g.y, width: -gap, items: [] };
      rows.push(row);
    }
    row.items.push({ i, x0: row.width + gap });
    row.width += gap + g.x;
  }
  const cols = Math.ceil(Math.sqrt(plates.length)), places = [];
  plates.forEach((prow, pi) => {
    const usedW = Math.max(...prow.map(r => r.width)), last = prow[prow.length - 1], usedD = last.y0 + last.depth;
    const ox = (pi % cols) * bw * PLATE_STRIDE + bx - usedW / 2, oy = -Math.floor(pi / cols) * bd * PLATE_STRIDE + by - usedD / 2;
    prow.forEach(r => r.items.forEach(it => {
      places[it.i] = { plate: pi, x: ox + it.x0 + geoms[it.i].x / 2, y: oy + r.y0 + r.depth / 2 };
    }));
  });
  return { places, plateCount: plates.length };
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const MODEL_OPEN = '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n';
const REL_TYPE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

function modelSettingsXML(objs, slot, plateCount) {
  const object = o => '  <object id="' + o.id + '">\n    <metadata key="name" value="' + o.name + '"/>\n    <metadata key="extruder" value="' + (slot + 1) + '"/>\n' +
    '    <part id="' + o.k + '" subtype="normal_part">\n      <metadata key="name" value="' + o.name + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n      <metadata key="source_file" value="' + o.name + '"/>\n' +
    '      <metadata key="source_object_id" value="0"/>\n      <metadata key="source_volume_id" value="0"/>\n      <metadata key="source_offset_x" value="0"/>\n      <metadata key="source_offset_y" value="0"/>\n      <metadata key="source_offset_z" value="0"/>\n    </part>\n  </object>\n';
  const instance = o => '    <model_instance>\n      <metadata key="object_id" value="' + o.id + '"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="' + o.k + '"/>\n    </model_instance>\n';
  const plate = pi => '  <plate>\n    <metadata key="plater_id" value="' + (pi + 1) + '"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n' +
    objs.filter(o => o.place.plate === pi).map(instance).join('') + '  </plate>\n';
  return XML_HEAD + '<config>\n' + objs.map(object).join('') + Array.from({ length: plateCount }, (_, pi) => plate(pi)).join('') +
    '  <assemble>\n' + objs.map(o => '   <assemble_item object_id="' + o.id + '" instance_id="0" transform="1 0 0 0 1 0 0 0 1 ' + coord(o.place.x) + ' ' + coord(o.place.y) + ' ' + o.hz + '" offset="0 0 0" />\n').join('') + '  </assemble>\n</config>\n';
}

// parts: ein geom (Einzelteil) oder [{geom}] – alle Teile bekommen dieselben Werte und den gewählten Slot.
function build3mfFiles(tpl, r, parts, slot, liveSlots) {
  const list = (Array.isArray(parts) ? parts : [parts]).map(p => p.geom || p);
  const { settings, changes } = buildProjectSettings(tpl, r, slot, liveSlots);
  const { places, plateCount } = arrangeParts(list, tpl);
  const n = list.length, title = xmlEsc(n === 1 ? list[0].name : n + ' Teile');
  // Netz k (1..n) liegt in object_k.model mit id k; das Objekt im Hauptmodell hat id n+k.
  const objs = list.map((g, i) => ({ g, k: i + 1, id: n + i + 1, name: xmlEsc(g.name), hz: coord(g.z / 2), place: places[i] }));
  const files = {
    '[Content_Types].xml': XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n',
    '_rels/.rels': XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="' + REL_TYPE + '"/>\n</Relationships>\n',
    '3D/_rels/3dmodel.model.rels': XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      objs.map(o => ' <Relationship Target="' + objectPath(o.k) + '" Id="rel-' + o.k + '" Type="' + REL_TYPE + '"/>\n').join('') + '</Relationships>\n',
    '3D/3dmodel.model': XML_HEAD + MODEL_OPEN +
      ' <metadata name="Application">BambuStudio-02.06.00.51</metadata>\n <metadata name="OrcaSlicer">' + xmlEsc(tpl.orcaVersion) + '</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="Title">' + title + '</metadata>\n <resources>\n' +
      objs.map(o => '  <object id="' + o.id + '" p:UUID="' + uuid(o.k, '61cb-4c03-9d28-80fed5dfa1dc') + '" type="model">\n   <components>\n    <component p:path="' + objectPath(o.k) + '" objectid="' + o.k + '" p:UUID="' + uuid(o.k, 'b206-40ff-9872-83e8017abed1') + '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n   </components>\n  </object>\n').join('') +
      ' </resources>\n <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">\n' +
      objs.map(o => '  <item objectid="' + o.id + '" p:UUID="' + uuid(o.id, 'b1ec-4553-aec9-835e5b724bb4') + '" transform="1 0 0 0 1 0 0 0 1 ' + coord(o.place.x) + ' ' + coord(o.place.y) + ' ' + o.hz + '" printable="1"/>\n').join('') +
      ' </build>\n</model>\n',
    'Metadata/model_settings.config': modelSettingsXML(objs, slot, plateCount),
    'Metadata/project_settings.config': JSON.stringify(settings, null, 4),
    'Metadata/slice_info.config': XML_HEAD + '<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="02.06.00.51"/>\n    <header_item key="OrcaSlicer-Version" value="' + xmlEsc(tpl.orcaVersion) + '"/>\n  </header>\n</config>\n',
    'Metadata/filament_sequence.json': JSON.stringify(Object.fromEntries(Array.from({ length: plateCount }, (_, pi) => ['plate_' + (pi + 1), { nozzle_sequence: [], optimal_assignment: [], sequence: [] }])))
  };
  objs.forEach(o => { files[objectPath(o.k).slice(1)] = meshModelXML(o.g, o.k); });
  return { files, changes, plateCount };
}

// ZIP über fflate (vendor/fflate.min.js); zipLib wird übergeben, damit der Test es in Node nutzen kann.
function build3mf(tpl, r, parts, slot, zipLib, liveSlots) {
  const { files, changes, plateCount } = build3mfFiles(tpl, r, parts, slot, liveSlots);
  const entries = {};
  for (const [p, text] of Object.entries(files)) entries[p] = zipLib.strToU8(text);
  return { bytes: zipLib.zipSync(entries, { level: 6 }), changes, plateCount };
}
