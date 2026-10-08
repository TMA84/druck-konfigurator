'use strict';
/* Weitere Orca-Einstellungen für „Werte für diesen Auftrag“ (2026-10-05): Werte, die das Tool sonst unverändert aus dem
   Druckerprofil (bzw. seiner eigenen Rechnung, z. B. Stützen) übernimmt. Gespeichert als Anpassung „x:<orca_key>“;
   geschrieben wird nur, was du setzt – als letzte Änderung, gewinnt also gegen den berechneten Wert (js/export3mf.js).
   Vorschlag = was ohne Eingabe gedruckt würde (js/overrides-ui.js extraSuggestion).
   [orca_key, Beschriftung, Abschnitt, Einheit|null, min, max, Schritt | Auswahl [[Orca-Wert, Beschriftung], …], Geltung]
   Geltung: object = je Teil (Orca-Objekteinstellung), plate = ganze Platte. */
const ORCA_EXTRA = [
  ['support_type', 'Stützen-Typ', 'Stützen', null, 0, 0, [['tree(auto)', 'Baum (automatisch)'], ['normal(auto)', 'Normal (automatisch)'], ['tree(manual)', 'Baum (nur gemalt)'], ['normal(manual)', 'Normal (nur gemalt)']], 'object'],
  ['support_style', 'Stützen-Stil', 'Stützen', null, 0, 0, [['default', 'Standard'], ['grid', 'Gitter'], ['snug', 'Eng anliegend'], ['tree_slim', 'Baum schlank'], ['tree_strong', 'Baum kräftig'], ['tree_hybrid', 'Baum hybrid'], ['organic', 'Organisch']], 'object'],
  // Orca misst zur Waagerechten: gestützt wird, was flacher ist als der Winkel – höher = mehr Stützen (2026-10-08: 1° sah
  // nach „ab 1° Überhang“ aus, stützte aber fast nichts)
  ['support_threshold_angle', 'Stützen bis Neigung (zur Waagerechten, höher = mehr)', 'Stützen', '°', 0, 90, 1, 'object'],
  ['support_remove_small_overhang', 'Kleine Überhänge weglassen', 'Stützen', null, 0, 0, [['1', 'ja'], ['0', 'nein – auch kleine stützen']], 'object'],
  ['support_on_build_plate_only', 'Stützen nur vom Bett', 'Stützen', null, 0, 0, [['1', 'ja'], ['0', 'auch auf dem Teil']], 'object'],
  ['support_top_z_distance', 'Abstand oben (Z)', 'Stützen', 'mm', 0, 1, 0.02, 'object'],
  ['support_object_xy_distance', 'Abstand seitlich (XY)', 'Stützen', 'mm', 0, 2, 0.05, 'object'],
  ['support_interface_top_layers', 'Kontaktschichten oben', 'Stützen', null, 0, 10, 1, 'object'],
  ['support_base_pattern', 'Grundmuster', 'Stützen', null, 0, 0, [['default', 'Standard'], ['rectilinear', 'Linien'], ['rectilinear-grid', 'Gitter'], ['honeycomb', 'Waben'], ['lightning', 'Blitz'], ['hollow', 'Hohl']], 'object'],
  ['tree_support_branch_diameter', 'Astdurchmesser (Baum)', 'Stützen', 'mm', 1, 10, 0.5, 'object'],
  ['elefant_foot_compensation', 'Elefantenfuß-Kompensation', 'Qualität', 'mm', 0, 0.5, 0.025, 'plate'],
  ['wall_generator', 'Wandgenerator', 'Qualität', null, 0, 0, [['classic', 'Klassisch'], ['arachne', 'Arachne (variable Breite)']], 'plate'],
  ['wall_sequence', 'Wandreihenfolge', 'Qualität', null, 0, 0, [['inner wall/outer wall', 'innen, dann außen'], ['outer wall/inner wall', 'außen, dann innen'], ['inner-outer-inner wall', 'innen–außen–innen']], 'object'],
  ['precise_outer_wall', 'Präzise Außenwand', 'Qualität', null, 0, 0, [['1', 'an'], ['0', 'aus']], 'plate'],
  ['line_width', 'Linienbreite', 'Qualität', 'mm', 0.2, 1.2, 0.01, 'plate'],
  ['outer_wall_line_width', 'Linienbreite Außenwand', 'Qualität', 'mm', 0.2, 1.2, 0.01, 'plate'],
  ['initial_layer_line_width', 'Linienbreite erste Schicht', 'Qualität', 'mm', 0.2, 1.2, 0.01, 'plate'],
  ['xy_hole_compensation', 'Lochkompensation (XY)', 'Qualität', 'mm', -0.5, 0.5, 0.01, 'plate'],
  ['xy_contour_compensation', 'Konturkompensation (XY)', 'Qualität', 'mm', -0.5, 0.5, 0.01, 'plate'],
  ['ironing_type', 'Bügeln', 'Oberflächen', null, 0, 0, [['no ironing', 'aus'], ['top', 'obere Flächen'], ['topmost', 'nur oberste Fläche'], ['solid', 'alle massiven Flächen']], 'object'],
  ['top_surface_pattern', 'Muster obere Fläche', 'Oberflächen', null, 0, 0, [['monotonicline', 'Monoton (Linien)'], ['monotonic', 'Monoton'], ['rectilinear', 'Linien'], ['alignedrectilinear', 'Linien ausgerichtet'], ['concentric', 'Konzentrisch'], ['hilbertcurve', 'Hilbert-Kurve'], ['archimedeanchords', 'Archimedisch'], ['octagramspiral', 'Achtstern-Spirale']], 'object'],
  ['bottom_surface_pattern', 'Muster untere Fläche', 'Oberflächen', null, 0, 0, [['monotonic', 'Monoton'], ['monotonicline', 'Monoton (Linien)'], ['rectilinear', 'Linien'], ['alignedrectilinear', 'Linien ausgerichtet'], ['concentric', 'Konzentrisch'], ['hilbertcurve', 'Hilbert-Kurve'], ['archimedeanchords', 'Archimedisch'], ['octagramspiral', 'Achtstern-Spirale']], 'object'],
  ['only_one_wall_top', 'Nur eine Wand oben', 'Oberflächen', null, 0, 0, [['1', 'an'], ['0', 'aus']], 'object'],
  ['skirt_loops', 'Skirt-Runden', 'Brim & Haftung', null, 0, 10, 1, 'plate'],
  ['raft_layers', 'Raft-Schichten', 'Brim & Haftung', null, 0, 10, 1, 'object'],
  ['enable_prime_tower', 'Prime-Turm (Mehrfarbig)', 'Sonstiges', null, 0, 0, [['1', 'an'], ['0', 'aus']], 'plate'],
  ['bridge_speed', 'Brücken-Tempo', 'Sonstiges', 'mm/s', 5, 300, 5, 'object']
];
const ORCA_EXTRA_BY_KEY = Object.fromEntries(ORCA_EXTRA.map(f => [f[0], f]));
// Anpassungen „x:<key>“ → {orca_key: Wert}
const extraOverrides = ov => Object.fromEntries(Object.entries(ov || {}).filter(([k, v]) => k.startsWith('x:') && ORCA_EXTRA_BY_KEY[k.slice(2)] && v !== '' && v != null).map(([k, v]) => [k.slice(2), v]));
// Anzeige eines Werts (Auswahl → Beschriftung)
function extraLabel(key, v) {
  const f = ORCA_EXTRA_BY_KEY[key]; if (!f) return String(v);
  if (Array.isArray(f[6])) { const o = f[6].find(x => String(x[0]) === String(v)); return o ? t(o[1]) : String(v); }
  return String(v) + (f[3] ? ' ' + f[3] : '');
}
