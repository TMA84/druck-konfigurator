# Änderungen

Alle nennenswerten Änderungen am Druck-Konfigurator. Versionen folgen [SemVer](https://semver.org/lang/de/): Hauptversion bei grundlegenden Änderungen, Nebenversion bei neuen Funktionen, Patch bei Fehlerbehebungen.

## [Unveröffentlicht]

### Neu
- **Filamente von Anycubic und SUNLU** in ② Druckwerte, nach Hersteller gruppiert (16 Anycubic, 18 SUNLU) mit den **Druckwerten der Hersteller** (Anycubic: eigene Kobra-S1-Profile aus OrcaSlicer bzw. Produktseite; SUNLU: Produktseiten und SUNLUs Slicer-Profile) und ihren **Farben** (Anycubic mit den offiziellen Farbcodes aus dem Shop, SUNLU nach Farbnamen). Farbe anklicken trägt sie für den Slot des Teils ein. Alle 34 Profile mit der Orca-CLI geslict.
- **Stützen und Naht malen** (Bemalen → Stützen / Naht): erzwingen/verhindern wie in OrcaSlicer; erzwungene Stützen an einem Teil ohne Stützen werden als „nur gemalte Stellen“ (tree(manual)) exportiert – mit der Orca-CLI geprüft.
- **Lücken füllen** und **Vorschau beim Füllen** im Bemalen-Feld; Hinweis, wenn die Farbzuordnung selbst übermalte Stellen nicht mehr betrifft.
- **Bemalen wie in OrcaSlicer** (Werkzeugleiste, Pinsel): Farbe je Fläche mit Kreis, Kugel, Dreieck, Füllen (nach Flächenwinkel) und Höhenbereich; Radierer (auch Umschalt), alles entfernen; Größe per Regler oder Alt+Mausrad, Slot per Klick oder Taste 1–9. Kreis und Kugel teilen Dreiecke am Pinselrand fein auf – gespeichert im Orca-Format (paint_color). Die Lage der Teilstücke ist mit der Orca-CLI nachgemessen, der G-Code druckt genau die bemalte Fläche. Geht auf eigenen Modellen und auf Makerworld-Objekten (die Bemalung des Designers bleibt daneben erhalten), gilt für alle Kopien, mit Rückgängig, übersteht Neuladen, auf dem Handy mit dem Finger.
- Bemalung des Designers wird in der 3D-Ansicht jetzt genau gezeigt (auch geteilte Dreiecke), getrennte Teile einer Makerworld-3MF behalten ihre Bemalung beim Export.
- **Rückgängig / Wiederholen** für das ganze Projekt: Strg/⌘+Z, Strg/⌘+Umschalt+Z (oder Strg+Y) und zwei Knöpfe vorn in der Werkzeugleiste – Slot, Größe, Drehung, Platte, Kopien, Entfernen, Farbzuordnung, Druckreihenfolge, Beschriftung, Bohrlöcher (bis 60 Schritte).
- **Beschriftung auf Objekten des Designers** (Makerworld-/Orca-3MF): erhaben mit eigenem Slot oder vertieft; kommt als weiteres Bauteil ins Objekt, wie OrcaSlicer es speichert (mit Orca-CLI geprüft).

### Behoben
- Gemalte Stützen und Naht lösten im Tab ③ kein neues Slicen aus – die Vorschau zeigte die alten Stützen.

### Verbessert
- Pinselstriche werden auch bei großen bemalten Flächen flüssig angezeigt (nur die geänderten Dreiecke).
- Test `tests/paint-orca.js` (auf GitHub): Farbe, Stützen und Naht landen im Orca-G-Code genau dort, wo gemalt wurde; `tests/filaments.js` prüft die Herstellerprofile.
- **Bohrlöcher bleiben gewählt**, wenn ein Teil gedreht oder in der Größe geändert wird (das Loch wird im neuen Netz wiedergefunden).
- Test `tests/designer-3mf.js`: Makerworld-Aufbau ohne echte Datei – Bemalung, Farb-Modifikator, Drehen und Größe, Text am Objekt, Objekt für Objekt; mit Orca-CLI geslict (auch auf GitHub). Bedientest prüft zusätzlich Rückgängig, Bohrlöcher nach Größe/Drehung und das Wiederherstellen nach Neuladen.
- Aufgeräumt: alter Abschnitt „Farben des Designers“ und die alte Körperliste (beides steckt seit 10.6 in der Filamentliste und der Teileliste).
- Englische Oberfläche: fehlende Übersetzungen der neuen Tooltips und Bedienhilfen ergänzt.
- Handy: der gewählte Reiter wird in der Reiterleiste ins Bild geholt.
- Test `tests/paint.js` für die Bemalung je Dreieck (auch auf GitHub).
- README: Funktionsliste auf den Stand von 10.6 gebracht.

## [10.6.1] – 2026-09-30

### Neu
- **Ladebalken beim Slicen:** oben im Tab ③ nach jeder Änderung (Änderung erkannt → Slicen mit geschätzter Dauer, gelernt aus den letzten Läufen → Vorschau laden), dazu ein Kreisel am Reiter „③ Slicen & Kosten“, wenn im Hintergrund geslict wird.

## [10.6.0] – 2026-09-30

### Neu
- **Slot-Zuordnung wie in OrcaSlicer:** Slot-Chips in der Teileliste (Auswahl mit Farbe, Nummer, Material), Filamentleiste „Slots am Drucker“, bei 3MF „Modell → Slot“ mit den Filamenten des Designers; automatische Zuordnung nach Farbe und Material, Ansicht Slot- oder Designerfarben.
- **Filament folgt dem Slot:** In ② wird das Filament passend zum Slot gewählt (verknüpftes Spulenprofil zuerst), außer es wurde von Hand gewählt.
- **Mehrfarbige Teile:** Farben im Teil (Grundkörper, Körper, Modifikatoren, Beschriftung) mit eigenem Chip; **Bemalung je Dreieck** (Bambu/Orca paint_color, z. B. Mario mit 7 Farben) wird gelesen, angezeigt und beim Export auf die eigenen Slots umgeschrieben (mit Orca-CLI geprüft); **Farb-Modifikatoren** des Designers (z. B. Schriftzug) in der 3D-Ansicht eingefärbt.
- **Ganze Platte** in der 3D-Ansicht; Kamera passt das Teil mit Rand ein (auch hochkant).
- **Projekt übersteht Neuladen** (IndexedDB; große Daten nur einmal gespeichert). **Modell entfernen** – alles oder ein einzelnes hinzugefügtes Modell, mit Rückgängig.
- **Modellkarte aufgeräumt:** aufklappbare Abschnitte mit Kurzinfo, Platte und Anzahl in der Teilezeile, Bohrlöcher nur bei erkannten Löchern.
- **Druckwerte:** Stützwerte an einer Stelle, Slicer-Abschnitte aufklappbar, angepasste Werte markiert und filterbar, Slicer-Anleitung eingeklappt, JSON-Hinweise im Menü.
- **Handy-Ansicht** (bis 640 px).
- **Objekt für Objekt drucken:** Orca-Druckreihenfolge „nach Objekt“; Teile mit dem Freiraum des Druckkopfs angeordnet (S1: 60 mm), Warnung bei mehr als einem Teil über der X-Achsen-Höhe (mit Orca-CLI geprüft).
- **Werkzeugleiste in der 3D-Ansicht** wie in OrcaSlicer (Symbole: hinzufügen, neue Platte, ausrichten, anordnen, Kopie ±, trennen, entfernen, Fläche aufs Bett, drehen, Größe, Schnitt, Text, messen, ganze Platte, Drahtgitter, Achsen).
- **Makerworld-3MF bearbeiten:** Drehen, Fläche aufs Bett, Ausrichten, neue Platte und Trennen jetzt auch für Objekte des Designers (Drehung in der Objekt-Transformation, Modifikatoren drehen mit; mit Orca-CLI geprüft). Ausgegraute Werkzeuge nennen den Grund.
- **Größe ändern:** Prozent oder Zielmaß je Achse, gleichmäßig oder einzeln, „Bauraum füllen“; auch für Makerworld-3MF (Skalierung in der Objekt-Transformation, mit Orca-CLI geprüft).
- **Druckt aus** in ②: alle Slots des Teils (Grundkörper, Körper, Bemalung, Modifikatoren, Beschriftung), Warnung bei anderer Filamentart.

### Behoben
- Farben des Designers umlegen setzte eigene Slots anderer Teile zurück.
- Slots, die nur die Bemalung nutzt, bekamen nicht die Filamentwerte des Teils (Orca: „nozzle temperatures are incompatible“).

## [10.5.0] – 2026-09-29

### Neu
- **Druckkopf mit echten Geschwindigkeiten:** Die Vorschau speichert den Vorschub je Bahn aus dem G-Code (Format GCPV3); der Kopf fährt damit weiter – mit einem vereinfachten Bewegungsplaner wie Klipper (Kurvengeschwindigkeit aus dem Winkel, Rampen, Beschleunigung je Linienart, Rückzug/Z-Hop bei Fahrten; am echten Druck auf ±5 % genau) – bei älteren Vorschauen mit den Geschwindigkeiten aus den Druckereinstellungen je Linienart. Leerfahrten zwischen Teilen werden abgefahren statt übersprungen; Meldungsalter wird eingerechnet, ein Filter glättet Restsprünge.
- **Mechanik im 3D-Fortschritt:** Druckbett, X-Traverse und Y-Schienen, die mit dem Kopf mitfahren; Kopf in etwa echter Größe.
- **Farben:** Auf der aktuellen Schicht ist noch nicht Gedrucktes blass und färbt sich orange, sobald der Kopf darüber war; sehr dunkle Filamente werden aufgehellt.

### Behoben
- Bahnen blieben zunächst schwarz (zwei Farb-Aktualisierungen im selben Bild – die erste ging verloren).

## [10.4.0] – 2026-09-29

### Neu
- **Druckkopf folgt den Bahnen:** Die echte Position rastet auf der nächsten G-Code-Bahn ein; zwischen zwei Meldungen fährt der Kopf mit der gemessenen Geschwindigkeit weiter, Abweichungen gleichen sich weich aus (bei Fahrten/Parken gleitet er gerade). Flüssige Bewegung auch bei der Schätzung.
- **Genauerer Fortschritt:** Schicht aus der gemeldeten Höhe, Fortschritt innerhalb der Schicht in %; jede Bahn färbt sich in Filamentfarbe ein, sobald der Kopf sie abgefahren hat.
- **Echte Kopfposition standardmäßig an** (am Kobra S1 geprüft); Kopf passt sich der Modellgröße an.
- Handbuch-Bilder und PDF neu (3D-Fortschritt mit Druckkopf, zwei ACE, ✕ in der Teileliste).

### Intern
- Tests auf GitHub: Chrome ohne Fenster startet zuverlässig (Port von Chrome gewählt, bis zu 3 Versuche, kein Hängen mehr); Profil-Import im Bedientest abgewartet.

## [10.3.0] – 2026-09-29

### Neu
- **Druckkopf im 3D-Fortschritt:** geschätzt auf der aktuellen Schicht oder – Schalter **Echte Kopfposition** – an der Stelle, die der Drucker meldet (Abfrage auch während des Drucks, nur solange die Ansicht offen und der Schalter an ist; am Kobra S1 geprüft).
- **Kommende Schichten** im 3D-Fortschritt durchsichtig (Standard), ausgeblendet oder voll – der aktuelle Stand bleibt sichtbar.

## [10.2.0] – 2026-09-29

### Neu
- **Mehrere ACE-Einheiten:** Kobra S1 bis 2 ACE (8 Slots), andere Anycubic-Drucker bis 4 (16 Slots). Slots zählen durch (ACE 2 = Slot 5–8); Anzahl vom Drucker erkannt oder im Dialog Filament-Slots einstellbar. 3MF mit bis zu 16 Filamenten (Werte je Filament, Spülmatrix; mit Orca-CLI geprüft), Filamentverwaltung, HA-Sensoren und Druckstart über alle Einheiten; Tab ④ mit Reitern je ACE.
- **Einzelne Teile entfernen:** ✕ in der Teileliste (oder Entf), mit „Rückgängig“; bei 3MF-Projekten fehlt das Teil im Export, die übrigen bleiben an ihrer Stelle (mit Orca-CLI geprüft).

### Behoben
- **Licht/Trocknen „nicht bestätigt“**, obwohl der Drucker den Befehl ausführt: Kommt keine erkennbare Antwort, prüft der Server den gemeldeten Zustand (Licht, Trocknen, Nachfüllen, Lüfter). Bleibt der Fehler, nennt die Meldung, was der Drucker geantwortet hat.

## [10.1.0] – 2026-09-29

### Neu
- **Beschriftung:** Text auf ein Teil – **erhaben** mit eigenem Slot (andere Farbe) oder **vertieft** (Orca `negative_part`); Höhe, Tiefe, Strichstärke, Drehung, oberste Fläche oder Fläche anklicken, Warnungen bei Überstand. Schrift Hershey Simplex (eigene Umsetzung, `js/font-hershey.js`, Lizenzhinweis in THIRD_PARTY_NOTICES). Mit Orca geprüft (erhaben druckt aus dem eigenen Slot, vertieft schneidet die oberen Schichten).
- **Druckhistorie & Statistik:** echter Verbrauch und Kosten je Druck, Vergleich mit der Schätzung aus ③ (bei Drucken aus dem Tool), Monatsübersicht und Diagramm nach Filamenttyp, Filter, CSV-Export; bis 500 Drucke. HA-Sensoren „Filament/Kosten/Drucke diesen Monat“.
- **Filamentprofil aus einer Spule** anlegen und verknüpfen; „Filament aus dem ACE übernehmen“ nimmt dann dieses Profil.
- **PIN-Schutz** für den direkten Zugriff (`KONFIGURATOR_PIN`, Add-on-Option `access_pin`): Anmeldeseite, Sitzung 30 Tage, Sperre nach 5 Fehlversuchen; Home-Assistant-Ingress und `/api/health` bleiben frei.
- **Tests auf GitHub** (`.github/workflows/tests.yml`): Node, Python, OrcaSlicer (Slicen, 3MF-Prüfung) und Bedientest im Chrome ohne Fenster bei jedem Push.
- **Tablet-Ansicht:** Kopfzeile, Tabs und Drucker-Werkbank für Hoch- und Querformat, Bedienelemente ≥ 44 px bei Touch.

### Geändert
- Schneller bei vielen Teilen: Plattenverteilung zwischengespeichert, Zahlenformat mit festem Formatierer (`de()` war ≈ ⅔ der Rechenzeit eines Updates; ein Update jetzt ≈ 13–15 statt 35–50 ms).
- Wörterbücher aufgeräumt: 95 doppelt geführte Begriffe (teils mit abweichendem Englisch) an einer Stelle, 3 ungenutzte Einträge entfernt. Import der Filamentverwaltung bis 4 MB.

### Behoben
- Auf Englisch konnte ein Modell nicht geladen werden („Cannot set properties of null“): Der Übersetzer ersetzte den Block „Filament“ und löschte dabei die Kennzeichnung daneben. Er ersetzt jetzt nichts mehr, wenn die Übersetzung gleich ist, und behält Elemente mit id.
- ① Modell ließ sich unter 860 px Breite nicht scrollen.

### Geprüft
- Node: import 25, orient 15, export-project 11, holes 9, purge 11, costs 8, overrides 15, plates 44, engrave 26, export-project-arrange 56 (Orca). Python: lan 49, spools 93, printqueue 65, ha_mqtt 52, printed 7, preview 9, auth 36, slice 21 (Orca). verify-3mf ohne Fehler, Bedientest 127/127, Englisch ohne deutsche Reste.

## [10.0.0] – 2026-09-29

### Neu
- **Home Assistant über MQTT** (`tools/ha_mqtt.py`): Gerät „Druck-Konfigurator <Drucker>“ mit Sensoren für Druckerzustand, Fortschritt, Restzeit, Fertig um, Auftrag, Schicht, Düse/Bett, Warteschlange, Platten fertig/gesamt, **Bett abräumen** (binär, für Handy-Benachrichtigungen) und Restmenge je ACE-Slot – mit MQTT-Discovery. Das Add-on holt die Broker-Zugangsdaten selbst vom Mosquitto-Add-on (`services: mqtt:want`, Option `mqtt_enabled`); sonst `MQTT_HOST`/`MQTT_PORT`/`MQTT_USER`/`MQTT_PASSWORD`.
- **Warteschlange auf dem Server** (`tools/printqueue.py`, `api/queue`): erkennt „Platte fertig“ auch ohne offene Seite; alle Seiten zeigen denselben Stand; Benachrichtigung im Browser wie bisher, dazu der HA-Sensor. Druckstart bleibt ein Klick.
- **3D-Fortschritt in ④ Drucker** (`js/live-ui.js`): der geslicte Druck bis zur aktuellen Schicht – fertige Schichten in Filamentfarbe, aktuelle orange, kommende grau; Umschalter Kamera | 3D-Fortschritt. Die Vorschau speichert der Server beim Druckstart dauerhaft (`api/printing/preview`), sie übersteht Neuladen und Neustart. Nur für Drucke aus dem Tool.
- **Filamentverwaltung:** Export/Import der Spulen (Zusammenführen oder Ersetzen – z. B. vom Mac ins HA-Add-on); **neue Spule erkannt → Gewicht abfragen** (Banner auf der ACE-Karte); **Warnschwelle** „Warnen unter … g“ mit Hinweis vor dem Drucken („Zu wenig Filament“ / „Filament wird knapp“).
- **Makerworld-Projekte bleiben erhalten** beim Kombinieren (Modell hinzufügen), platzsparenden Anordnen und bei Kopien: Farb-Modifikatoren, Bemalung, SVG- und Negativteile des Designers bleiben; Kopien sind zusätzliche Instanzen desselben Objekts, hinzugefügte Teile eigene Objekte. Mit Orca geprüft (porta utensili auf 3 Platten, Schriftzug weiter aus Slot 2).
- Werkzeuge: `tools/headless.js` (Chrome ohne Fenster: Bedientest, Screenshots, Prüfungen), `tools/build-screenshots.js` (alle Bilder in docs/img neu).

### Geändert
- Handbuch: neue Bilder (Slicen & Kosten, Drucker mit 3D-Fortschritt, Spulen), Abschnitte Home Assistant, Warteschlange auf dem Server, Spulen-Export und Warnschwelle; überholte Aussagen korrigiert. PDF neu (`tools/build-handbuch.js` jetzt über das DevTools-Protokoll, auch am Mac zuverlässig).
- Bedientest `tests/ui-smoke.js` deckt Platten, Kopien, Modell hinzufügen, Slot für alle, Werte je Auftrag, Spulen-Dialog und Darstellung ab (127 Prüfungen).

### Behoben
- 3MF-Dialog warnte nach dem Anordnen einer Makerworld-3MF fälschlich vor zu großen Platten.
- Slot, der nur von einem Farb-Modifikator des Designers genutzt wird, bekam die Filamentwerte der Vorlage – Orca lehnte dann ab („nozzle temperatures are incompatible“).

### Geprüft
- Node: import 25, orient 15, export-project 11, holes 9, purge 11, costs 8, overrides 15, plates 37, export-project-arrange 56 (mit Orca). Python: lan 49, spools 65, printqueue 65, ha_mqtt 46, printed 7, preview 9, slice 21 (mit Orca). verify-3mf gegen Orca ok. Bedientest 127/127 (headless).

## [9.5.1] – 2026-09-29

### Neu
- **Slot für alle Teile übernehmen:** in ② neben der Slot-Auswahl („Für alle Teile übernehmen“) und in ③ unter den Filament-Slots („Slot N für alle Teile übernehmen“, erscheint, wenn die Teile verschiedene Slots haben). Körper mehrfarbiger Teile behalten ihre eigenen Slots; passt das Filament nicht zum Slot, wird es umgestellt.

## [9.5.0] – 2026-09-29

### Geändert
- **Teile platzsparend anordnen:** Statt zeilenweise („Regal“) packt das Tool jetzt in freie Rechtecke, probiert mehrere Reihenfolgen und dreht Teile um 90° um die Hochachse, wenn das eine Platte spart (sonst nicht). Beispiele: hohes Teil 100×230 + 6 × 60×60 und 2 × 200×100 + 4 × 40×40 jetzt 1 statt 2 Platten; nie mehr Platten als vorher. Gedrehte Teile stehen richtig in der 3MF, der Draufsicht und bei der Turm-Platzierung (mit Orca geprüft).
- **Platzsparend anordnen auch für Makerworld-Projekte:** Passen die Teile auf weniger Platten als vom Designer angelegt, zeigt ① Modell „Platzsparend angeordnet wären es 3 statt 4 Platten“ und bietet **Platzsparend anordnen** an (baut die 3MF neu auf; Farb-Modifikatoren und Bemalung des Designers entfallen). Beispiel porta utensili: 3 statt 4 Platten, 18 h 20 statt 18 h 42 min.

### Geprüft
- `tests/plates.js` 37/37 (Packen, Drehen nur bei Bedarf, im Bett und ohne Überlappung).

## [9.4.0] – 2026-09-29

### Neu
- **Modell hinzufügen** (Datei-Menü und „+ Hinzufügen“ in ① Modell): weitere Modelle ins bestehende Projekt laden und zusammen drucken, statt das Projekt zu ersetzen. Mit **Anzahl** (Platten) jedes Teil mehrfach. Kommt eine Makerworld-/Orca-3MF dazu, wird die 3MF neu aufgebaut: Platten und Körper-Slots bleiben, übrige Designer-Einstellungen, Farb-Modifikatoren und Bemalung entfallen (Hinweis im Modell). Geprüft: ACE-Guide + 3 × Deckel geslict (32,9 g).
- **Slot wählen auch bei einem einfarbigen Teil:** ② „Einstellungen für Teil“ zeigt die Slot-Auswahl jetzt auch bei nur einem Teil; in ③ **Filament-Slots** den Slot anklicken = damit drucken (markiert „druckt damit“). Bei mehreren Teilen setzt der Klick den Standard-Slot für Teile ohne eigenen Slot. Passt das Filament nicht zum Slot, wird es passend umgestellt.

### Geändert
- Draufsicht der Platten im Dunkelmodus: heller Rand, damit dunkle Teile auf dem Bett sichtbar sind.

## [9.3.3] – 2026-09-29

### Neu
- **„Nur kritische Bereiche“ (Stützen) je Auftrag einstellbar:** ② → *Werte für diesen Auftrag anpassen* → „Nur kritische Bereiche“ an/aus. Vorschlag bleibt **an** (wie bisher). An = OrcaSlicer stützt nur Spitzen und Auskragungen, normale Überhänge nicht; aus = auch normale Überhänge. Datenblatt, Stützparameter und Anleitung zeigen den gewählten Wert; bei „an“ erklärt die Anleitung, dass normale Überhänge ungestützt bleiben und wo man es ausschaltet.

### Behoben
- **Stützen erschienen beim Slicen scheinbar nicht:** Mit „nur kritische Bereiche“ erzeugt Orca bei normalen Überhängen keine Stützen, obwohl sie empfohlen oder eingeschaltet waren – das war nicht zu erkennen und nicht änderbar. Geprüft mit Orca: ACE-Guide (Makerworld) an 0 / aus 110 Stützbahnen, Trichterform an 0 / aus 98. Empfehlung bei wenigen Überhängen heißt jetzt „Ja – wenige Baumstützen“. Tests: `tests/slice.py` zählt die Stützbahnen im G-Code (an/aus), `tests/overrides.js` prüft Vorschlag und Umschalten.

## [9.3.2] – 2026-09-29

### Behoben
- **Kamera: „Kamera nicht verfügbar (Exception)“.** Beim Umstellen auf relative Pfade (9.2.0) wurde die Kamera-Adresse zu `http://…:8765api/…` zusammengesetzt. Jetzt relativ zur Seite aufgelöst – auch hinter dem Home-Assistant-Ingress. Fehlermeldungen der Kamera nennen zusätzlich den Grund. Geprüft: Der Server liefert den Strom (FLV, H.264 mit Codec-Daten am Anfang, ≈ 50–60 KB/s).

## [9.3.1] – 2026-09-29

### Geändert
- **Haftungsausschluss überarbeitet** (README und Dialog, Version 2 – wird einmal neu bestätigt): Steuern und Drucken über den LAN-Modus (Werkbank, Warteschlange, inoffizielle Schnittstelle), Kosten/Zeiten/Restmengen als Schätzungen, Betrieb als Server/Container/Home-Assistant-Add-on ohne eigene Anmeldung, OrcaSlicer unter eigener Lizenz, Home Assistant bei den Marken. Der alte Punkt „liest nur und steuert nichts“ stimmte nicht mehr.
- **Dank an das Ursprungsprojekt** [wolfb63-del/druck-konfigurator](https://github.com/wolfb63-del/druck-konfigurator): README (Abschnitt „Dank“), Fußzeile der Seite, Haftungsausschluss-Dialog, LICENSE (Urheber und Hinweis auf die Änderungen, wie CC BY-NC 4.0 es verlangt) und README des Home-Assistant-Add-ons.

## [9.3.0] – 2026-09-29

### Neu
- **Image automatisch bauen:** GitHub Actions (`.github/workflows/docker-image.yml`) baut bei jedem Push auf `main` `ghcr.io/tma84/druck-konfigurator` für amd64 und arm64 (je eigene Maschine, mit Kurztest: Server startet, OrcaSlicer da) – `:latest`, `:<Version>`, `:sha-…`. Das Home-Assistant-Add-on baut darauf auf.
- **Drucker vorgeben:** `KONFIGURATOR_PRINTER=<IP>` (im Add-on die Option `printer_ip`). Die Seite übernimmt den Drucker von selbst (solange im Browser keine eigene Adresse steht), die Filamentverwaltung zählt ab dem Start des Servers mit. Im Dialog Drucker-Verbindung steht, dass er aus den Server-Einstellungen kommt.

## [9.2.0] – 2026-09-29

### Neu
- **Home-Assistant-Add-on** im Repo [TMA84/ha-addons](https://github.com/TMA84/ha-addons) (Ordner `druck-konfigurator`): in der Seitenleiste über Ingress, optional direkt auf Port 8765, Daten der Filamentverwaltung in `/data`, amd64 und aarch64.

### Geändert
- Aufrufe des eigenen Servers mit relativen Pfaden (`api/…` statt `/api/…`), damit das Tool hinter einem Proxy mit Präfix läuft (Home-Assistant-Ingress). Geprüft mit einem nachgebauten Ingress: Seite, Slicen, Vorschau, Download, Filamentverwaltung.

## [9.1.2] – 2026-09-29

### Neu
- **Favicon:** Druckbett mit Schichten in Orange (`img/favicon.svg`, PNG 32 px und Apple-Touch-Icon 180 px), dazu Theme-Farbe für Browserleisten.

## [9.1.1] – 2026-09-29

### Behoben
- **Licht und Trocknen meldeten „Drucker hat den Befehl nicht bestätigt“**, obwohl der Drucker die Einstellung übernahm. Die Werksfirmware 2.7.2.7 bestätigt diese Befehle ohne die Nachrichten-Nummer der Anfrage; jetzt gilt auch die nächste Antwort derselben Art und Aktion als Bestätigung. Der Nachbau in `tests/lan.py` antwortet dafür wie die echte Firmware (49/49).

## [9.1.0] – 2026-09-29

### Neu
- **Filamentverwaltung „Spulen & Restmengen“** (⚙ Einstellungen und ACE-Karte im Tab Drucker). Der Server erkennt die Spulen in der ACE automatisch (RFID-Artikelnummer, Typ, Farbe) – neu eingelegt, herausgenommen, wieder eingelegt – und **errechnet die Restmenge**: Füllgewicht − Verbrauch − Spülabfall. Den Verbrauch zählt er beim Drucken selbst mit (vom Drucker gemeldete Millimeter, zugeordnet dem Slot im Druckkopf, Dichte je Typ; Spülabfall je Farbwechsel wie in ③), auch bei Drucken aus anderen Programmen und ohne offene Seite (`tools/spools.py`, Daten in `~/.druck-konfigurator/spools.json`, im Container im Volume `/data`).
- Restmenge auf den ACE-Kacheln und in der Slot-Liste; Warnung in ③ und im Senden-Dialog, wenn eine Platte mehr braucht, als auf der Spule ist. Korrektur durch Wiegen, eigene Spulen ohne RFID, Archiv, Verbrauch der letzten Drucke. Spulenpreis (€/kg) fließt in die Kosten.
- Die ACE meldet keine Restmenge (`consumables_percent` ist bei Firmware 2.7.2.7 immer 0) – deshalb die Rechnung.

### Geprüft
- `tests/spools.py` 25/25 (Erkennen, Umstecken, Wiedereinlegen, Verbrauch, Farbwechsel, Neustart mitten im Druck, Wiegen, Tracker). Am echten Kobra S1 (nur lesend): vier Spulen erkannt, laufender Druck zählt auf die ASA-Spule.

## [9.0.0] – 2026-09-29

### Neu
- **Englische Oberfläche.** Umschalter **DE / EN** oben rechts; ohne Auswahl nach Browsersprache. Alle Texte der Seite, Dialoge, Datenblatt, Kosten, Vorschau, Warteschlange, Werkbank und die Meldungen des Servers. Technik: `t('Deutscher Text {x}', {x})` (js/util.js), Wörterbücher `js/i18n/en-*.js`, feste Seitentexte übersetzt `js/i18n/dom.js` beim Laden. Werte, die in die 3MF oder zum Drucker gehen, bleiben unverändert; Zahlen im Format der Sprache.
- **Modernes Erscheinungsbild** (`css/modern.css`): ruhige Flächen und Karten, Systemschrift, schlanke Kopfzeile, Tabs mit Unterstrich, weichere Felder und Knöpfe.
- **Dunkelmodus:** ☀ / A / ☾ oben rechts – hell, automatisch (wie das System) oder dunkel (`js/theme.js`).

### Geprüft
- Englisch im Browser: alle vier Tabs und alle Dialoge ohne deutsche Reste (automatische Suche), Slicen mit Kosten je Platte. Deutsch: Bedientest 112/112, alle Node-Tests, 3MF-Regression gegen OrcaSlicer ok; Datenblatt-Ausgaben byte-gleich zu vorher (≈ 13.500 Vergleiche).

## [8.5.0] – 2026-09-29

### Neu
- **Kosten auch im Slicer:** Die 3MF enthält die Preise aus „Preise & Sätze“ – `filament_cost` je Slot (Filament- bzw. Typpreis) und `time_cost` (Strom + Verschleiß je Stunde). OrcaSlicer und AnycubicSlicerNext rechnen damit selbst (ohne Spülabfall, Aufschlag, MwSt.).

### Geprüft
- **AnycubicSlicerNext 1.4.1.1** (Orca 2.3.1) öffnet und slict die 3MF des Tools: eine und zwei Platten, alle geprüften Werte gleich wie in OrcaSlicer 2.4.2 (Temperaturen, Schichthöhe, Wände, Füllung, Stützen, Slot-Farben, Wechselzeit, Turm); Gramm/Zeit leicht anders (8,09 statt 7,88 g, 51 statt 55 min). Mit Kostenwerten: Filamentkosten 0,35 € aus den eigenen Preisen.
- `tests/slice.py` prüft die Kostenwerte im G-Code (18/18), `tests/verify-3mf.js` unverändert ok.

## [8.4.0] – 2026-09-28

### Neu
- **Farben des Designers → Slot** (① Modell, Makerworld-/Orca-3MF): jede Farbe des Designers – Objekt, Körper oder Farb-Modifikator wie ein Schriftzug – auf einen beliebigen ACE-Slot legen. Modifikatoren werden in der 3MF umgeschrieben; Bemalung mit dem Farbpinsel bleibt beim Slot des Designers (Hinweis).
- **Prüfung vor dem Slicen:** Mischt eine Platte PLA/TPU mit PETG/ABS/ASA, meldet das Tool das gleich verständlich („Slot 2 PLA zusammen mit Slot 1 ABS …“) mit Lösungsweg, statt Orca erst scheitern zu lassen. Auch auf der Plattenkarte.
- **Filament aus dem ACE übernehmen:** Knopf bei „Slot 1: braucht ABS, eingelegt ist ASA“ stellt die Teile auf das Filament im Slot um (nur sichtbar, wenn er etwas ändert).

### Behoben
- Orcas Meldung zu unverträglichen Düsentemperaturen kam teils als „unbekannter Fehler“ an.
- **Slice-Vorschau zeigte nach dem Laden eines neuen Modells noch das alte.** Jetzt verwirft ein neues Modell das letzte Slice-Ergebnis sofort (auch ein noch laufendes), die Vorschau ist leer bis zum neuen Slicen; schlägt das Slicen fehl, bleibt sie leer. Zeigt die Vorschau einen älteren Stand desselben Projekts, steht „älterer Stand“ daneben.

## [8.3.0] – 2026-09-28

### Neu
- **Platten-Übersicht** (① Modell): je Platte eine Karte mit Draufsicht aufs Bett, Teilen, genutzten Slots und Hinweis, wenn ein Slot anderes Filament braucht als eingelegt. Teile per Auswahl auf eine andere oder **neue Platte** verschieben; **Platzsparend anordnen** verteilt wieder automatisch. **Anzahl** je Teil (Kopien teilen Einstellungen, Slot und Farben). Makerworld-3MF: Platten des Designers, nur Anzeige.
- **Kosten und Zeit je Platte** (③): Tabelle mit Zeit, Farbwechseln, Filament und Kosten je Platte; Klick zeigt die Platte in der Vorschau.
- **Nur geänderte Platten neu slicen:** Ändert sich nur eine Platte, slict OrcaSlicer nur diese (`--slice N`), die übrigen G-Codes übernimmt der Server aus dem letzten Stand (`/api/slice?plates=…&count=…&reuse=…`). Fehlt der alte Stand, wird alles geslict.
- **Reihenfolge nach Filament:** Empfehlung, erst alle Platten mit dem eingelegten Filament zu drucken und dann gruppiert nach nötigem Spulentausch.
- **Druck-Warteschlange** (④ Drucker): „Alle Platten nacheinander …“ legt die Platten in dieser Reihenfolge an. Ist eine Platte fertig, meldet das Tool **„Bett abräumen“** (auch als Browser-Benachrichtigung und ● im Fenstertitel); die nächste startet erst nach Klick über den Senden-Dialog mit Slot-Prüfung. Restzeit aller Platten, Überspringen, Nochmal; abgebrochene Platten kommen zurück in die Warteschlange. Überwacht auch, wenn ein anderer Tab offen ist.
- **Bauraum beachten:** 3D-Ansicht zeigt den Bauraum des Druckers (Kobra S1: 250 × 250 × 250 mm) als Drahtbox, rot mit Hinweis, wenn das Teil nicht hineinpasst – jetzt auch in der **Höhe**. Plattenübersicht, 3MF-Dialog und Makerworld-Platten prüfen ebenfalls die Höhe. Die Slice-Vorschau zeigt das Druckbett mit Rand.

### Geprüft
- `tests/plates.js` (22 Prüfungen: geänderte Platten, Filamentbedarf, Reihenfolge, Warteschlange, Plattenzuordnung, Überlauf). `tests/slice.py` mit echtem OrcaSlicer: nur Platte 2 neu geslict, Platte 1 übernommen, Summe gleich (16/16). `tests/verify-3mf.js` unverändert ok. Im Browser: Kopien, Verschieben, Bauraum-Warnung (280 mm hoch), Teil-Neuslicen „1 von 2“, Warteschlange mit simuliertem Druckerstand (kein Befehl an den echten Drucker).

## [8.2.0] – 2026-09-28

### Neu
- **Werte für diesen Auftrag anpassen** (② Druckwerte): Düse, Bett, Schichthöhe, Wände, Deck-/Bodenschichten, Fülldichte, Füllmuster, Geschwindigkeiten, Lüfter, Stützen, Brim – je Teil, Vorschlag daneben, leer = Vorschlag. Die Anpassung wirkt in `compute()` selbst, dadurch gleich in Datenblatt (markiert, mit Vorschlag), 3MF, Slicen, Kosten und Drucken. Auf Wunsch für alle Teile.
- 3MF: weitere Füllmuster (kubisch, Gitter, Waben, Linien, Dreiecke, Kreuzschraffur, Blitz).

### Geprüft
- `tests/overrides.js` (13 Prüfungen: 3MF-Werte, Markierung, Vorschlag bleibt, gleicher Wert ≠ Abweichung, Stützen aus). Im Browser: Anpassung → Datenblatt markiert, 3MF mit 5 Wänden/50 %/kubisch/225 °C, Kosten automatisch neu (4,26 → 6,81 g).

## [8.1.0] – 2026-09-28

### Geändert
- **Drucker-Seite neu gestaltet:** Statusleiste (Drucker, Firmware, Zustand, Verbindung, Licht) · Druckauftrag groß mit lesbarem Namen (aus „0928-1842-Name_plate(01)_ASA_0.16_…“ wird „Name“ + „Platte 1 · ASA · 0,16 mm“), Fortschritt, Schicht, **fertig um**, Filament bisher · Kamera groß · Temperaturen mit Heizbalken · ACE als Slot-Kacheln in Filamentfarbe mit Trocknen-Fortschritt · Achsen während eines Drucks nur als Hinweis. Knöpfe ohne Auftrag ausgeblendet.

### Behoben
- **Slots aus der ACE nach einem Fehlversuch:** Scheiterte das Lesen (z. B. Container ohne Heimnetz), blieb die Seite still bei den eigenen Angaben. Jetzt neuer Versuch alle 30 s und beim Zurückkehren ins Fenster; Auswahllisten zeigen „(eigene Angabe)“, solange die Werte nicht vom Drucker stammen.

## [8.0.0] – 2026-09-28

### Geändert
- **Neue Aufteilung in Arbeitsschritte:** ① Modell (große 3D-Ansicht mit Teileliste, Lage, Mehrfarbig, Bohrlöchern daneben) · ② Druckwerte (Werte je Teil mit Teileauswahl, Datenblatt; Orca-Reihenfolge eingeklappt) · ③ Slicen & Kosten (Kosten, Ausgabe mit „Drucken …“ und 3MF, Slots, Spülmenge; Slice-Vorschau eingebettet statt als Fenster) · ④ Drucker. Registerkarten zeigen „geladen“, Gesamtpreis und Druckfortschritt.
- **Menüs zusammengefasst:** „Datei“ (Modell, 3MF, weitere Exporte) und „⚙ Einstellungen“ in Gruppen Filamente / Drucker / Farben & Kosten; das Menü „Export“ entfällt.
- Beim ersten Start öffnet der Schritt „Modell“.

### Geprüft
- Bedientest `tests/ui-smoke.js`: 112 von 112 (mit frischem Browserspeicher).

## [7.5.0] – 2026-09-28

### Neu
- **Filamentpreis je Typ** (PLA, PETG, ABS, ASA, TPU; „Preise & Sätze“). Reihenfolge: Einzelpreis des Filaments → Typpreis → Preis für andere. Slots ohne Filamentprofil (Farben des Designers) nach dem Typ, den die ACE meldet („PLA-CF“ → PLA). Bestehende Preise der Standardfilamente werden einmalig zu Typpreisen.
- **Kosten automatisch neu berechnen** nach jeder Änderung an Einstellungen oder Modell (Schalter im Abschnitt Kosten, Standard an): 1,5 s Verzögerung, nie zwei Slice-Aufträge gleichzeitig, fehlgeschlagene Stände werden nicht endlos wiederholt.

## [7.4.0] – 2026-09-28

### Neu
- **Direkt drucken:** „Drucken …“ (Kosten) bzw. „An Drucker senden …“ (Slice-Vorschau) lädt den G-Code einer geslicten Platte auf den Kobra S1 und startet ihn. Dialog mit Zustand des Druckers, Zuordnung Werkzeug → ACE-Slot (Warnung bei leerem Slot oder anderem Material) und Optionen (Bett vermessen, Flusskalibrierung, Zeitraffer). Server: Upload als multipart an die signierte Adresse aus `/info`, Start `print`/`start` im Kanal „slicer“ mit Datei, Größe, MD5 und Slotzuordnung (`/api/anycubic/print`); nur wenn der Drucker frei ist und der G-Code für das verbundene Modell geslict wurde. Protokollfakten aus anycubic-orca-plugin und kobra-connect, eigene Umsetzung.

### Geändert
- Auftragsnummer −1 ist bei LAN-Drucken der Normalfall (auch bei Anycubics Slicer) – der Hinweis dazu entfällt.

### Geprüft
- `tests/lan.py` (47 Prüfungen, Nachbau): Upload mit Token/multipart/Länge, Start im Kanal slicer mit Datei, Größe, MD5, taskid −1, Slotzuordnung und Optionen, zweiter Druck abgelehnt, G-Code für anderes Modell abgelehnt. Im Browser gegen den Nachbau: Slicen, Dialog mit Warnung, Senden, Werkbank zeigt „heizt vor“. **Am echten Drucker noch nicht gedruckt.**

## [7.3.0] – 2026-09-28

### Neu
- **Drucker-Werkbank** (Tab „Drucker“, Kobra S1 mit Werksfirmware im LAN-Modus): Druckauftrag (Fortschritt, Schicht, Zeiten; Pausieren, Fortsetzen, Abbrechen mit Rückfrage), Kamera (HTTP-FLV über den Server, Wiedergabe mit flv.js), Temperaturen mit Vorheiz-Voreinstellungen, drei Lüfter, Licht, Achsen (Fahren, Referenzieren, Motoren aus), ACE (Laden/Zurückziehen je Slot, Nachfüllen, Trocknen), Druckerdaten und Rohdaten.
- **Stehende Verbindung je Drucker** im Server (`PrinterLink`): eine Anmeldung, Abfrage alle 5 s, Befehle mit Bestätigung, neue Anmeldung bei Abbruch, Ende nach 10 min ohne Zugriff. Belegung und Werkbank nutzen sie gemeinsam.
- Befehle werden auf dem Server geprüft und die Nutzdaten dort gebaut: nur freigegebene Befehle, Grenzen (Düse ≤ 300 °C, Bett ≤ 110 °C, Achsweg ≤ 50 mm, Trocknen ≤ 70 °C/24 h), Achsen und Laden während eines Drucks gesperrt, Pause/Abbruch nur mit der Auftragsnummer des laufenden Drucks.

### Geprüft
- `tests/lan.py` (39 Prüfungen, Nachbau): Temperaturen, Lüfter, Licht, Achsen, Grenzen, Sperre während des Drucks, Pause mit Auftragsnummer. Bedientest im Browser gegen den Nachbau. Am echten Kobra S1 (Firmware 2.7.2.7) während eines laufenden Drucks nur gelesen: Auftrag, Temperaturen, Lüfter, Licht, ACE (trocknet) – Befehle nicht am echten Drucker ausgelöst.


## [7.2.0] – 2026-09-28

### Neu
- **Slice-Vorschau** (Kosten → „Slice-Vorschau“): der von OrcaSlicer erzeugte G-Code als Schichtansicht im Tool – je Platte, Schichtregler, „nur diese Schicht“, Farben nach Linienart oder nach Filament (Slotfarben der ACE), Legende zum Ausblenden, G-Code-Download. Der Server hebt die letzten fünf Aufträge auf und liefert je Platte eine kompakte Vorschau (`tools/gcode_preview.py`: nur Druckbahnen, gerade Bahnen zusammengefasst, 16-bit-Koordinaten – z. B. 27,5 MB G-Code → 9,5 MB).

### Geprüft
- `tests/preview.py` (relative/absolute Extrusion, Bögen, Schichten, Werkzeuge). Im Browser mit einem Makerworld-Projekt (4 Platten, 680 000 Bahnen je Platte): Schichten, Filamentfarben, Schrift des Designers in Slot 2 sichtbar.

## [7.1.0] – 2026-09-28

### Neu
- **Kostenkalkulation** (Tab „Einstellungen“ → Kosten): Die 3MF wird auf dem Server exakt mit der OrcaSlicer-Kommandozeile geslict (`/api/slice`, `tools/slicer.py`); daraus Filament je Slot, Spülabfall der ACE, Strom, Verschleiß, optional Aufschlag und MwSt. Preise je Filament und Sätze unter „Preise & Sätze …“; Änderungen rechnen sofort neu, Projektänderungen markieren das Ergebnis als veraltet.
- **Container mit OrcaSlicer 2.4.2** (Ubuntu 24.04, x86_64 und aarch64, ohne Bildschirm) – rund 1,5 GB.

### Behoben
- **Makerworld-Projekte ließen sich nicht slicen** (Kostenkalkulation, Orca-Kommandozeile): „File Version 2.7.1.62 not supported by current cli version 2.4.2“. Die Umstellung setzt jetzt die Dateiversion der eigenen Vorlage und die OrcaSlicer-Angabe; Geometrie, Platten und Farben bleiben.
- **Reinigungsturm auf dem Teil** („gcode path conflicts found between WipeTower and …“): Die Turmposition wird je Platte mit mehreren Farben frei gesucht; notfalls werden die Teile nach vorne links gerückt, sonst ohne Turm (Hinweis). Gilt für neue Exporte und Makerworld-Umstellungen.
- **Farben des Designers erkannt:** Modifikatoren mit eigenem Slot (z. B. Text/Logo) und bemalte Flächen zählen als mehrfarbig (Teileliste: „Farben vom Designer“).
- Fehlermeldungen beim Slicen enthalten Orcas eigentliche Fehlerzeilen; der letzte fehlgeschlagene Auftrag wird zur Fehlersuche aufgehoben (`SLICE_DEBUG_DIR`).
- **3MF: Temperaturbereich je Filament** (`nozzle_temperature_range_low/high`) wird jetzt aus dem Datenblatt geschrieben. Bisher blieb der PLA-Bereich der Vorlage stehen, und Orca verweigerte Mehrfarbdrucke mit ASA/ABS/PETG („nozzle temperatures are incompatible“).
- Export-Dialog markiert auch **Körper**, deren Slot ein anderes Material enthält.
- Orcas Meldung zu unverträglichen Temperaturen (z. B. PLA + ASA) erscheint verständlich auf Deutsch.

### Geprüft
- `tests/slice.py` (Mac-Orca und im Container: 13,18 g, 1 Wechsel, 55 min – gleiche Werte), `tests/costs.js`, `tests/verify-3mf.js` (Temperaturbereich im G-Code). PLA + ASA wird von Orca abgelehnt, ASA + ABS geslict.

## [7.0.0] – 2026-09-28

### Geändert
- **Nur noch Anycubic-Drucker** in der Auswahl (Kobra S1 und die Anycubic-Modelle aus den Orca-Profilen). Snapmaker U1 und die übrigen Hersteller bleiben im Code, sind aber ausgeblendet (`js/config.js`; `index.html?alle-drucker` zeigt alles).

### Neu
- **Kobra S1 mit Werksfirmware (LAN-Modus):** Der Server meldet sich wie Anycubics Slicer am Drucker an (HTTP 18910, MQTT über TLS 9883) und liest die ACE-Belegung. Schreiben lassen sich Einstellungen: Slot-Filament/-Farbe („Auch am Drucker speichern“ in „Belegung eintragen“) und „Automatisch nachfüllen“. Keine Druck-, Bewegungs- oder Heizbefehle; nur Drucker mit privater IP-Adresse. Verbindung wählbar: Automatisch / Werksfirmware / Rinkhals (Moonraker).
- **Container:** `Dockerfile` und `docker-compose.yml` für NAS/Heimserver (`KONFIGURATOR_HOST=0.0.0.0`). Neue Server-API `/api/health`, `/api/anycubic/status`, `/api/anycubic/command`.

### Neu (Einstellungen)
- **Im Tab „Einstellungen“** (linke Spalte): Filament-Slots mit Herkunft (vom Drucker / überschrieben / eigene Angabe) und Farbwechsel & Spülmenge mit Schätzung für das geladene Projekt. Mit eingerichteter Verbindung wird die ACE beim Start einmal gelesen.
- **Profile → Filament-Slots …:** Material und Farbe je Slot. Mit Verbindung aus der ACE gelesen, je Slot **überschreibbar** (bleibt auch nach erneutem Auslesen); ohne Verbindung eigene Angabe. Überschriebene Slots lassen sich bei Werksfirmware in die ACE schreiben. Ersetzt „Belegung eintragen“ im Export-Dialog („Slots bearbeiten“ öffnet denselben Dialog).
- **Profile → Farbwechsel & Spülmenge …:** Spülmenge am Drucker und optional eigene Messwerte (Abfall und Zeit je Wechsel) für Schätzung und Wechselzeit in der 3MF.

### Behoben
- **Drucker-Verbindung ging ohne „Speichern“ verloren:** Ein erfolgreicher Test übernimmt die Verbindung jetzt automatisch. Ohne Verbindung zeigt der Abschnitt „Filament-Slots“ im Tab Einstellungen ein IP-Feld mit „Verbinden“.
- **Am echten Kobra S1 (Firmware 2.7.2.7) geprüft:** ACE mit 4 RFID-Slots wird gelesen. „Geladen“ nur noch laut `loaded_slot` – status 5 bedeutet dort bei allen belegten Slots nur „bereit“. Verbindungsfehler nennen den Grund (abgelehnt / keine Antwort) und werden einmal wiederholt.
- **Mehrfarbig über alle Platten:** Steht dasselbe 3MF-Objekt auf mehreren Platten, gelten Körper-Slots, Slot und Werte jetzt für alle Platzierungen. Bisher übernahm der Export nur die erste Platzierung – Farben, die auf Platte 2 gewählt wurden, gingen verloren.

### Geprüft
- `tests/lan.py`: Handshake, Entschlüsselung, MQTT über TLS mit selbst signiertem Zertifikat, Belegung, Slot schreiben, Nachfüllen, abgelehnte Befehle – gegen einen nachgebauten Kobra S1 (26 Prüfungen), auch im Container. Bedientest im Browser gegen den Nachbau (`python tests/lan.py --serve`). **Noch nicht am echten Drucker geprüft.**

## [6.3.0] – 2026-09-28

### Neu
- **Mehrfarbig – mehrere Farben in einem Teil:** Körper eines Teils (berührende Körper einer STL, Bauteile eines 3MF-Objekts) bekommen je einen eigenen Slot. Kasten „Mehrfarbig“ in der Modellkarte mit Auswahl je Körper, Hervorheben in der Vorschau und „Farben zeigen“. In der 3MF wird jeder Körper ein eigenes Orca-Bauteil mit eigenem Slot; bei Makerworld-3MF wird der Slot je Bauteil in der Originaldatei gesetzt.
- **Dateien zu einem Teil vereinen** (z. B. eine STL je Farbe) und wieder **trennen**.
- Hohlräume (nach innen gerichtete Hüllen) werden ihrem Körper zugeordnet und nicht als eigener Körper gezählt.
- **Farbwechsel und Abfall (Kobra S1):** Der Export-Dialog schätzt Farbwechsel (gleiche Zahl wie OrcaSlicer), Abfall im Schacht und Wechselzeit. Auswahl „Spülmenge am Drucker“ (Empfehlung 1,0 statt Werk 1,5 – rund 30 % weniger Abfall); die 3MF bekommt die passende Wechselzeit (`machine_load_filament_time`) für eine richtige Zeitschätzung in Orca. Die Spülmenge selbst stellt man am Touchscreen ein – die Firmware spült selbst, der Slicer kann die Menge nicht setzen.

### Geprüft
- Mit der OrcaSlicer-CLI: Teil mit zwei Körpern in Slot 1 und 3 – beide Slots im Einsatz, Stiel mit T0, Hut mit T2, geschätzte Farbwechsel = Orca, Wechselzeit im G-Code (`tests/verify-3mf.js`). Wechselzahl zusätzlich an vier Anordnungen mit Orca verglichen (`tests/purge.js`).

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
