# Änderungen

Alle nennenswerten Änderungen am Druck-Konfigurator. Versionen folgen [SemVer](https://semver.org/lang/de/): Hauptversion bei grundlegenden Änderungen, Nebenversion bei neuen Funktionen, Patch bei Fehlerbehebungen.

## [6.2.0] – 2026-09-27

### Geändert
- **Drucker-Verbindung im Profil-Menü besser erklärt:** deutlich, dass das nur mit Klipper/Moonraker geht (nicht mit Werksfirmware), mit Links zu den nötigen Fremd-Firmwares – Rinkhals beim Kobra S1, die Extended Firmware von paxx12 beim Snapmaker U1. Ohne Moonraker der Hinweis auf "Belegung eintragen" als Alternative. Handbuch und README korrigiert (U1 brauchte bisher fälschlich keine erwähnte Fremd-Firmware).

## [6.1.0] – 2026-09-27

### Geändert
- **3MF-Export deutlich sichtbarer:** eigener Aufruf-Kasten mit Beschreibung und Knopf direkt oben im Datenblatt (bisher nur im Menü versteckt). Im Export-Dialog eine kurze Schritt-für-Schritt-Anleitung (Slot wählen → speichern → in OrcaSlicer über "Projekt öffnen" laden).

## [6.0.0] – 2026-09-27

### Neu
- **Rund 990 Drucker von 63 Herstellern** aus den OrcaSlicer-Profilen: Auswahl „Anderer Drucker …“ mit Suche. Geschwindigkeiten, Beschleunigung und Volumenstrom werden auf das Orca-Profil des Druckers begrenzt; die 3MF enthält dessen Drucker-, Prozess- und Filamentprofile. Herstellerdaten werden erst bei Bedarf geladen.
- Warnung, wenn der Start-G-Code eines Herstellerprofils fest auf eine Temperatur heizt.
- Filamentprofile je Slot bringen ihre Werte in die 3MF mit (auch für die Orca-Kommandozeile).

### Geprüft
- Mit der OrcaSlicer-CLI: je ein Drucker pro Hersteller sowie eine Stichprobe von Mehrkopf-Druckern (Bambu, Prusa XL, IDEX) – Bettmitte, Düsentemperatur, Geschwindigkeit, G-Code-Art, Start-G-Code. `tests/verify-orca-printers.js`.

### Bekannte Einschränkung
- Bei einer kleinen Zahl älterer Anycubic-Profile mit „marlin“-Firmware (z. B. Kobra Max, Kobra Plus) bricht die Orca-Kommandozeile beim Slicen ab; Ursache nicht abschließend geklärt. Betroffen sind eher gleichnamige Modelle mit Klipper-Nachfolgeprofil, das funktioniert.

## [5.8.0] – 2026-09-27

### Neu
- **Online-Version** über GitHub Pages: https://wolfb63-del.github.io/druck-konfigurator/ (ohne Live-Abfrage vom Drucker; „Vom Drucker laden“ erklärt dort, warum).
- Dokumentation: läuft auch unter macOS und Linux (nicht getestet); Start der Live-Abfrage dort mit `python3 tools/serve.py`.
- **Kleine 3D-Vorschau** unter der Modell-Karte: zeigt das gewählte Teil in seiner aktuellen Lage auf dem Bett, Überhänge rot – Auswirkungen von Drehen und Lage-Vorschlag sofort sichtbar, ohne in die 3D-Ansicht zu wechseln.

## [5.7.0] – 2026-09-26

### Neu
- **Objektart „Wasserdicht / Behälter“:** mindestens 4 Wandlinien, 5/6 Deck-/Bodenschichten, +5 °C, Außenwand 30 % langsamer, in der 3MF „Lückenfüllung überall“ und „Vertikale Schalendicke sicherstellen“; Hinweise zu Vasenmodus und Epoxid. Mit der OrcaSlicer-CLI geprüft.

## [5.6.0] – 2026-09-26

### Neu
- **Haftungsausschluss:** beim ersten Start im Tool zu bestätigen (erscheint erneut, wenn er sich inhaltlich ändert), jederzeit über **? → Haftungsausschluss** und die Fußzeile erreichbar; ausführlich in der README.

### Behoben
- Export-Dialog: „unbekannt“ statt abgeschnittenem Slot-Text, kein doppeltes „2 Teile (2 Teile)“.

## [5.5.0] – 2026-09-26

### Geändert
- **Drei Spalten** auf breiten Bildschirmen: Auswahl | Modell (Teile, Lage, Bohrlöcher) | Datenblatt – alle Modell-Einstellungen ohne Scrollen sichtbar. Unter 1240 px steht das Modell unter der Auswahl.

## [5.4.1] – 2026-09-26

### Geändert
- **Rückzug bleibt beim Orca-Standard** (Filament- bzw. Druckerprofil) und wird nicht mehr überschrieben – er hängt von Filament, Temperatur und Extruder ab. Das Datenblatt zeigt „Orca-Standard“ mit dem S1-Testwert als Richtwert. Damit gilt beim U1 wieder dessen eigener Rückzug (z. B. 1,5 mm).
- Export-Dialog: Hinweis über der Slot-Auswahl nennt das gewählte Filament („Wähle den Slot, in dem dein PETG steckt“).

## [5.4.0] – 2026-09-26

### Neu
- **Beschleunigung** in der 3MF, wenn das Datenblatt eine vorgibt (TPU: 800 mm/s² für Wände, Füllung und Flächen; Fahrten und erste Schicht bleiben). Mit der OrcaSlicer-CLI geprüft – die Wände werden tatsächlich höchstens mit diesem Wert gedruckt.

### Geändert
- Slot-Auswahl zeigt den Filamenttyp nur noch, wenn er wirklich bekannt ist (live vom Drucker oder selbst eingetragen). Die Typen aus der Orca-Vorlage werden nicht mehr angezeigt – sie spiegeln nicht wider, was gerade im Drucker steckt.

### Behoben
- Bei vielen Teilen war der untere Teil der linken Spalte (Teileliste, Lage, Bohrlöcher) nicht erreichbar. Die Spalte hat jetzt eine eigene Laufleiste.

## [5.3.0] – 2026-09-26

### Neu
- **Lüfter erste Schicht, Rückzug und Z-Hop** landen jetzt in der 3MF – als Filamentwert je Slot, das Druckerprofil bleibt unverändert. Mit der OrcaSlicer-CLI geprüft, beim Rückzug auch in den tatsächlichen G-Code-Befehlen.

### Hinweis
- Beim Snapmaker U1 ersetzen die Rückzugswerte des Tools (0,6–0,8 mm, aus den Kobra-S1-Tests) die 1,5 mm aus dem U1-Druckerprofil. Bei Fäden am U1 den Rückzug in „Werte anpassen“ erhöhen.

## [5.2.0] – 2026-09-26

### Neu
- **Filament-Belegung von Hand eintragen** (Export-Dialog → „Belegung eintragen“): Typ und Farbe je Slot, bleibt gespeichert. Damit funktionieren Slot-Hinweise, Presets und mehrfarbige Projekte auch mit Originalfirmware, ohne Live-Abfrage.

### Geändert
- Start per Doppelklick auf `index.html` ist der Normalfall; Python wird nur noch für die Live-Abfrage (Rinkhals/Moonraker) gebraucht.

## [5.1.0] – 2026-09-26

### Neu
- **Bohrlöcher verstärken:** Das Tool erkennt runde Löcher (senkrecht und waagerecht) und schlägt sie mit Häkchen vor. Angehakte Löcher bekommen im 3MF einen Orca-Modifikator – Ring von 3 mm mit 100 % Füllung. Mit der OrcaSlicer-CLI geprüft.

### Geändert
- Anleitungen und Datenblatt nennen für beide Drucker OrcaSlicer.

## [5.0.0] – 2026-09-26

Erste veröffentlichte Version. Basis ist der Druck-Konfigurator v4 (eine HTML-Datei), jetzt als Werkzeug mit 3D-Ansicht und direktem Export für OrcaSlicer.

### Neu
- **Oberfläche:** Druckerumschaltung Kobra S1 / Snapmaker U1 im Kopf, Menüs Datei/Profile/Export, Registerkarten Einstellungen und 3D-Ansicht, aufklappbares Datenblatt.
- **3MF-Export für OrcaSlicer:** auf Basis gespeicherter Orca-Vorlagen je Drucker; berechnete Filament-, Prozess- und Stützwerte, Slot wählbar, Liste aller Änderungen. Werte bleiben beim Öffnen in der Orca-Oberfläche erhalten.
- **Filament-Belegung live vom Drucker** über Moonraker (nur lesend), Start über `Konfigurator starten.cmd`.
- **Import:** STL mit mehreren Körpern, mehrere Dateien, ZIP (z. B. Makerworld), 3MF.
- **Mehrere Teile:** Teileliste; Filament, Objektart, Priorität, Support und Slot je Teil; abweichende Werte als Orca-Objekt-Einstellung.
- **Lage auf dem Bett:** Vorschlag der besten Auflagefläche (Stützen auf dem Teil zählen dreifach), Fläche anklicken, 90°-Tasten.
- **Stützen:** alle Stützwerte in der 3MF; Abstand zum Teil = Schichthöhe, PETG +0,05 mm.
- **Makerworld-3MF umstellen:** Bambu-Einstellungen durch das eigene S1-/U1-Profil ersetzen, Platten, Farben und Bemalung behalten, jede Platte auf die Bettmitte.
- **Handbuch** (`HANDBUCH.md`, `docs/Handbuch.pdf`).

### Geprüft
- Gleiche Eingabe → gleiches Ergebnis wie v4 (47.920 Kombinationen, `tests/compare-v4.js`).
- Export gegen die echte OrcaSlicer-Kommandozeile: jeder Wert im G-Code, Slots, Temperaturbefehle, Lage und Höhe auf dem Bett, Stützen je Teil, Makerworld-Projekt auf S1 und U1 (`tests/verify-3mf.js`).
- Bedientest aller Funktionen im Browser (`tests/ui-smoke.js`).

### Bekannte Grenzen
- 3MF-Export nur mit 0,4-mm-Düse.
- U1-Werte sind nicht am U1 gegengetestet.
- Schichthöhe gilt in Orca für die ganze Platte.
