# Offene Vorschläge (Stand 2026-09-25)

Gesammelt beim Bedientest. Nichts davon ist umgesetzt – Entscheidung liegt beim Nutzer.

## Wichtig (betrifft Richtigkeit)
1. **Sichttest in OrcaSlicer steht aus.** Die CLI bestätigt alle Werte; offen ist nur, wie die Orca-Oberfläche die geänderten Werte anzeigt (Preset als „geändert“ markiert?). Einmal eine exportierte 3MF öffnen und durchsehen.
2. **Slicer-Namen für den Kobra S1:** Die „Slicer-Reihenfolge“ und die Stützen-Anleitung nennen „Anycubic Slicer Next“, du slicst aber mit OrcaSlicer. Beschriftung auf OrcaSlicer umstellen.
3. **Nicht exportierte Empfehlungen:** Lüfter erste Schicht, Beschleunigung (bei TPU 800 mm/s²), Rückzug und Z-Hop landen noch nicht in der 3MF. Rückzug/Z-Hop sind Druckerwerte – sie ließen sich in der 3MF trotzdem setzen, weil die Vorlage das Druckerprofil mitbringt.
4. **Brim-Spannen:** Aus „5–8 mm“ wird 5 mm (untere Grenze), aus „0–5 mm bei Haftungsproblemen“ (Reifen) wird „kein Brim“. Ggf. im Export-Dialog wählbar machen.

## Komfort
5. **3MF-Dateien öffnen** (bisher nur STL) – auch eigene Orca-Projekte als Ausgangspunkt.
6. **Slot-Belegung live vom Drucker** (ACE / Werkzeugköpfe) statt aus der Vorlage – ungeprüft, ob die Drucker das per Netzwerk hergeben.
7. **Weitere Düsen** (0,6 / 0,8 mm): je Drucker eine Orca-Vorlage speichern, `node tools/build-orca-templates.js` – dann ist der 3MF-Export auch dort frei.
8. Lange Slot-Namen im Export-Dialog werden abgeschnitten → vollständigen Namen als Tooltip.
9. Deine alten v4-Profile: Das neue Tool nutzt denselben Speicherschlüssel; sie erscheinen, wenn es wie v4 per Doppelklick (file://) geöffnet wird. Sicherer Weg: in v4 „Exportieren“, im neuen Tool „Profile importieren“.

## Bereits geplant (Plan-Schritte 3 und 4)
10. Ausrichtung im Tool (Fläche aufs Bett legen, 90°-Tasten).
11. Testdruck-Protokoll pro Drucker/Profil – dafür sind die U1-Werte der wichtigste Kandidat (bisher nirgends gegengetestet).
