# Änderungen

Alle nennenswerten Änderungen am Druck-Konfigurator. Versionen folgen [SemVer](https://semver.org/lang/de/): Hauptversion bei grundlegenden Änderungen, Nebenversion bei neuen Funktionen, Patch bei Fehlerbehebungen.

## [5.4.0] – 2026-09-26

### Neu
- **Beschleunigung** in der 3MF, wenn das Datenblatt eine vorgibt (TPU: 800 mm/s² für Wände, Füllung und Flächen; Fahrten und erste Schicht bleiben). Mit der OrcaSlicer-CLI geprüft – die Wände werden tatsächlich höchstens mit diesem Wert gedruckt.

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
