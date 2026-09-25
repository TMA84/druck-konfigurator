'use strict';
/* 3MF-Export für OrcaSlicer. Basis ist die vom Nutzer in Orca gespeicherte Vorlage
   (ORCA_TEMPLATES, erzeugt aus templates/*.3mf). Überschrieben werden nur Werte, die der
   Konfigurator berechnet – alles andere (Druckerprofil, Start-G-Code, Grenzen) bleibt aus der
   Vorlage. Kein DOM-Zugriff: tests/verify-3mf.js prüft das Ergebnis mit der Orca-CLI. */

const ORCA_KIND = { pla: 'PLA', petg: 'PETG', abs: 'ABS', asa: 'ASA', tpu: 'TPU' };
const BED_TEMP_KEYS = ['hot_plate_temp', 'textured_plate_temp', 'cool_plate_temp', 'eng_plate_temp'];
const SEAM_ORCA = { Hinten: 'back', Ausgerichtet: 'aligned' };
const OBJECT_PATH = '/3D/Objects/object_1.model';

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
   Beschriftung, damit Dialog und Test dieselbe Liste verwenden. slot ist 0-basiert. */
function plannedChanges(r, slot) {
  const f = []; // [Beschriftung, Key, Wert, istSlotWert]
  const fil = (label, key, v) => f.push([label, key, String(v), true]);
  const proc = (label, key, v) => f.push([label, key, String(v), false]);

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
  return f.map(([label, key, value, perSlot]) => ({ label, key, value, perSlot }));
}

// Neue project_settings (Kopie) + Liste der tatsächlichen Änderungen gegenüber der Vorlage.
function buildProjectSettings(tpl, r, slot) {
  const settings = JSON.parse(JSON.stringify(tpl.settings));
  const changes = [];
  for (const c of plannedChanges(r, slot)) {
    if (!(c.key in settings)) continue; // Schlüssel kennt diese Orca-Version nicht → Vorlage unverändert
    const before = c.perSlot ? settings[c.key][slot] : settings[c.key];
    if (c.perSlot) settings[c.key][slot] = c.value; else settings[c.key] = c.value;
    if (before !== c.value) changes.push({ label: c.label, key: c.key, before, after: c.value });
  }
  return { settings, changes };
}

const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const coord = v => String(Math.round(v * 1e5) / 1e5);

// Netz als 3MF-Objekt: gemeinsame Eckpunkte, lokal um den Mittelpunkt zentriert (wie Orca es speichert).
function meshModelXML(geom) {
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
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n  <object id="1" p:UUID="00010000-81cb-4c03-9d28-80fed5dfa1dc" type="model">\n   <mesh>\n    <vertices>\n' +
    verts.join('\n') + '\n    </vertices>\n    <triangles>\n' + tris.join('\n') + '\n    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build/>\n</model>\n';
}

function build3mfFiles(tpl, r, geom, slot) {
  const { settings, changes } = buildProjectSettings(tpl, r, slot);
  const name = xmlEsc(geom.name);
  const [bx, by] = tpl.bedCenter, hz = coord(geom.z / 2);
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n',
    '3D/_rels/3dmodel.model.rels': '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="' + OBJECT_PATH + '" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n',
    '3D/3dmodel.model': '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n' +
      ' <metadata name="Application">BambuStudio-02.06.00.51</metadata>\n <metadata name="OrcaSlicer">' + xmlEsc(tpl.orcaVersion) + '</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="Title">' + name + '</metadata>\n' +
      ' <resources>\n  <object id="2" p:UUID="00000001-61cb-4c03-9d28-80fed5dfa1dc" type="model">\n   <components>\n    <component p:path="' + OBJECT_PATH + '" objectid="1" p:UUID="00010000-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n   </components>\n  </object>\n </resources>\n' +
      ' <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">\n  <item objectid="2" p:UUID="00000002-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 ' + coord(bx) + ' ' + coord(by) + ' ' + hz + '" printable="1"/>\n </build>\n</model>\n',
    '3D/Objects/object_1.model': meshModelXML(geom),
    'Metadata/model_settings.config': '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="2">\n    <metadata key="name" value="' + name + '"/>\n    <metadata key="extruder" value="' + (slot + 1) + '"/>\n' +
      '    <part id="1" subtype="normal_part">\n      <metadata key="name" value="' + name + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n      <metadata key="source_file" value="' + name + '"/>\n' +
      '      <metadata key="source_object_id" value="0"/>\n      <metadata key="source_volume_id" value="0"/>\n      <metadata key="source_offset_x" value="0"/>\n      <metadata key="source_offset_y" value="0"/>\n      <metadata key="source_offset_z" value="0"/>\n    </part>\n  </object>\n' +
      '  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n' +
      '    <model_instance>\n      <metadata key="object_id" value="2"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="1"/>\n    </model_instance>\n  </plate>\n' +
      '  <assemble>\n   <assemble_item object_id="2" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 ' + hz + '" offset="0 0 0" />\n  </assemble>\n</config>\n',
    'Metadata/project_settings.config': JSON.stringify(settings, null, 4),
    'Metadata/slice_info.config': '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="02.06.00.51"/>\n    <header_item key="OrcaSlicer-Version" value="' + xmlEsc(tpl.orcaVersion) + '"/>\n  </header>\n</config>\n',
    'Metadata/filament_sequence.json': '{"plate_1":{"nozzle_sequence":[],"optimal_assignment":[],"sequence":[]}}'
  };
  return { files, changes };
}

// ZIP über fflate (vendor/fflate.min.js); zipLib wird übergeben, damit der Test es in Node nutzen kann.
function build3mf(tpl, r, geom, slot, zipLib) {
  const { files, changes } = build3mfFiles(tpl, r, geom, slot);
  const entries = {};
  for (const [p, text] of Object.entries(files)) entries[p] = zipLib.strToU8(text);
  return { bytes: zipLib.zipSync(entries, { level: 6 }), changes };
}
