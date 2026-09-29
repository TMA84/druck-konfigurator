'use strict';
/* Englische Texte für Sprache/Darstellung in der Kopfzeile (index.html, js/theme.js). */
I18N.add({
  'Sprache und Darstellung': 'Language and appearance',
  'Sprache': 'Language',
  'Darstellung': 'Appearance',
  'Hell': 'Light',
  'Dunkel': 'Dark',
  'Automatisch (wie das System)': 'Automatic (follows the system)'
});
// Automatische Namen aus dem Import (bleiben in den Daten deutsch, weil sie in die 3MF gehen) – nur in der Anzeige
I18N.addRx([[/^Körper (\d+)$/, 'Body $1'], [/^Objekt (\d+)$/, 'Object $1']]);
// Dieselben deutschen Wörter kommen in mehreren Bereichen vor – hier einheitlich (diese Datei lädt zuletzt)
I18N.add({
  'Heizbett': 'Heated bed',
  'Dünnwandiges Gehäuse': 'Thin-walled enclosure',
  'Nur kritische Bereiche': 'Critical regions only',
  'Schnittstellenabstand': 'Interface spacing',
  'Erste Schicht': 'First layer',
  'Füllmuster': 'Infill pattern',
  'Füllung': 'Infill',
  'Stützen': 'Supports',
  'Sonstiges': 'Other',
  'Standard': 'Standard',
  'Beenden': 'Stop',
  'fertig': 'done',
  'Drucker meldet keine ACE-Slots': "The printer doesn't report any ACE slots",
  'Drucker hat die Slot-Angabe abgelehnt': 'The printer rejected the slot data'
});
// Drucker aus den Server-/Add-on-Einstellungen (js/export-ui.js, Dialog Drucker-Verbindung)
I18N.add({
  'Drucker {ip} aus den Server-Einstellungen übernommen': 'Printer {ip} taken from the server settings',
  'Voreingestellt in den Einstellungen des Servers (Home-Assistant-Add-on: printer_ip). Eine Änderung hier gilt nur für diesen Browser.': 'Preset in the server settings (Home Assistant add-on: <b>printer_ip</b>). A change here only applies to this browser.'
});
// Haftungsausschluss (Version 2, 2026-09-29) und Dank an das Ursprungsprojekt
I18N.add({
 "Startwerte ohne Gewähr. Die Werte – auch angepasste – sind Empfehlungen; Slicer-Vorschau und ein Testdruck haben immer Vorrang.": "<b>Starting values, no guarantee.</b> The values – including adjusted ones – are suggestions; the slicer preview and a test print always come first.",
 "Keine Haftung für Schäden an Drucker und Zubehör – z. B. Düse, Druckplatte (PETG auf PEI), ACE, Verstopfungen, Kollisionen, Fehldrucke, verbrauchtes Filament.": "<b>No liability for damage</b> to the printer and accessories – e.g. nozzle, build plate (PETG on PEI), ACE, clogs, collisions, failed prints, used filament.",
 "Steuern und Drucken: Über den LAN-Modus kann das Tool den Drucker steuern und Drucke starten. Vor jedem Start prüfst du Bett, Druckplatte und Filament selbst; die Warteschlange startet nie von selbst. Anycubic unterstützt diese Schnittstelle nicht offiziell.": "<b>Controlling and printing:</b> Through LAN mode the tool can control the printer and start prints. Before every start you check the bed, build plate and filament yourself; the queue never starts on its own. Anycubic does not officially support this interface.",
 "Schätzungen: Kosten, Druckzeiten und Restmengen der Spulen sind errechnet und können abweichen – kein verbindliches Angebot.": "<b>Estimates:</b> Costs, print times and remaining filament are calculated and may differ – not a binding quote.",
 "Gedruckte Teile: Keine Eignung für sicherheitskritische oder tragende Anwendungen, Lebensmittelkontakt oder Kinderspielzeug zugesichert – das beurteilst du selbst.": "<b>Printed parts:</b> No suitability is promised for safety-critical or load-bearing use, food contact or children’s toys – that is your call.",
 "Gesundheit: ABS und ASA dünsten aus – gut lüften. Drucker nicht unbeaufsichtigt laufen lassen, auch nicht mit Kamera oder Home Assistant.": "<b>Health:</b> ABS and ASA give off fumes – ventilate well. Don’t leave the printer running unattended, not even with the camera or Home Assistant.",
 "Betrieb: Die Seite hat keine eigene Anmeldung – nur im Heimnetz betreiben, nicht ins Internet freigeben.": "<b>Operation:</b> The page has no login of its own – run it on your home network only, never expose it to the internet.",
 "Marken: Kein Bezug zu Anycubic, Snapmaker, Bambu Lab, Makerworld, OrcaSlicer oder Home Assistant; die Namen dienen nur der Beschreibung.": "<b>Trademarks:</b> Not affiliated with Anycubic, Snapmaker, Bambu Lab, MakerWorld, OrcaSlicer or Home Assistant; the names are used for description only.",
 "Fremde Modelle: Wer Projekte anderer (z. B. von Makerworld) umstellt, beachtet deren Lizenz.": "<b>Other people’s models:</b> If you convert other people’s projects (e.g. from MakerWorld), respect their license.",
 "Ausführlich in der README auf GitHub. Lizenz: CC BY-NC 4.0, ohne Gewährleistung. Grundlage: Druck-Konfigurator von wolfb63-del – danke!": "Details in the README on GitHub. License: CC BY-NC 4.0, without warranty. Based on the <a href=\"https://github.com/wolfb63-del/druck-konfigurator\" target=\"_blank\" rel=\"noopener\">Druck-Konfigurator by wolfb63-del</a> – thank you!"
});
I18N.add({ 'Druck-Konfigurator – Fork des': 'Print Configurator – fork of the', 'Druck-Konfigurators von wolfb63-del': 'Druck-Konfigurator by wolfb63-del', '(danke!) · Startwerte ohne Gewähr – immer die Slicer-Vorschau prüfen. ·': '(thank you!) · Starting values, no guarantee – always check the slicer preview. ·' });
// Stützen ohne „nur kritische Bereiche“ (2026-09-29, js/engine.js, js/panel.js)
I18N.add({
  'Ja – wenige Baumstützen': 'Yes – a few tree supports',
  'Aus': 'Off',
  'Deutliche Überhänge (ca. {area} mm²). Vor dem Aktivieren von Stützen das Modell im Slicer drehen oder um 10–20° kippen – das reduziert Stützen oft mehr als jede Einstellung. Nur wenn das nicht reicht, Baumstützen aktivieren.': 'Significant overhangs (approx. {area} mm²). Before enabling supports, rotate the model in the slicer or tilt it by 10–20° – that often reduces supports more than any setting. Only if that is not enough, enable tree supports.',
  'Deutliche Überhänge erkannt (ca. {area} mm², {pct} % der Oberfläche, davon ca. {flat} mm² fast waagerecht). Baumstützen ab Druckbett.': 'Significant overhangs detected (approx. {area} mm², {pct} % of the surface, approx. {flat} mm² of it almost horizontal). Tree supports from the bed.',
  'Deutliche Überhänge erkannt (ca. {area} mm², {pct} % der Oberfläche). Baumstützen ab Druckbett.': 'Significant overhangs detected (approx. {area} mm², {pct} % of the surface). Tree supports from the bed.',
  '<b>So stellst du es in {slicer} ein:</b><br>1. <i>Stützstrukturen aktivieren</i> einschalten.<br>2. <i>Typ: Baum (automatisch)</i>; {crit}<br>3. <i>Schwellenwinkel: {angle}°</i>.<br>4. <i>Nur auf Druckplatte</i> zuerst testen; bei unerreichbaren Innenflächen deaktivieren.<br>5. Raft aus. Immer die Schichtvorschau prüfen.': '<b>How to set it up in {slicer}:</b><br>1. Turn on <i>Enable support</i>.<br>2. <i>Type: Tree (auto)</i>; {crit}<br>3. <i>Threshold angle: {angle}°</i>.<br>4. Test <i>On build plate only</i> first; disable it if inner surfaces cannot be reached.<br>5. Raft off. Always check the layer preview.',
  '<i>nur kritische Bereiche</i> einschalten – stützt nur Spitzen und Auskragungen. Fehlen in der Vorschau Stützen unter normalen Überhängen, unter <b>Werte für diesen Auftrag anpassen</b> ausschalten.': 'turn on <i>critical regions only</i> – supports only sharp tails and cantilevers. If the preview lacks supports under normal overhangs, turn it off under <b>Adjust values for this job</b>.',
  '<i>nur kritische Bereiche</i> ausgeschaltet lassen – so stützt der Slicer auch normale Überhänge.': 'leave <i>critical regions only</i> off – then the slicer also supports normal overhangs.'
});
// Slot wählen (③ Filament-Slots, js/export-ui.js)
I18N.add({
  'Anklicken: mit diesem Slot drucken': 'Click: print with this slot',
  'druckt damit': 'printing with it',
  'Druckt mit Slot {n}': 'Printing with slot {n}',
  'Standard-Slot {n} für Teile ohne eigenen Slot': 'Default slot {n} for parts without their own slot',
  'Filament auf {type} umgestellt': 'filament switched to {type}'
});
// Modell hinzufügen (js/app.js addParts, index.html)
I18N.add({
  'Kombiniert: Die 3MF wird neu aufgebaut – Platten und Körper-Slots bleiben, die übrigen Einstellungen des Designers entfallen.': 'Combined: the 3MF is rebuilt – plates and body slots stay, the designer’s other settings are dropped.',
  'Farb-Modifikatoren und Bemalung des Designers gehen dabei verloren.': 'The designer’s color modifiers and painting are lost.',
  '{n} Teile · {tri} Dreiecke': '{n} parts · {tri} triangles',
  '{n} Teil(e) hinzugefügt – jetzt {total} Teile': '{n} part(s) added – now {total} parts',
  'Modell hinzufügen … weiteres Modell ins Projekt – kombiniert drucken': 'Add model … <small>another model into the project – print combined</small>',
  'weiteres Modell ins Projekt – kombiniert drucken': 'another model into the project – print combined',
  'Modell hinzufügen …': 'Add model …',
  '+ Hinzufügen': '+ Add'
});
// Platzsparend anordnen (js/plates-ui.js)
I18N.add({
  'Platzsparend: {n} statt {m} Platten. Die 3MF wird dafür neu aufgebaut – Farb-Modifikatoren und Bemalung des Designers gehen verloren.': 'Compact: {n} instead of {m} plates. The 3MF is rebuilt for this – the designer’s color modifiers and painting are lost.',
  'Platzsparend angeordnet wären es {n} statt {m} Platten.': 'Arranged compactly it would be {n} instead of {m} plates.'
});
