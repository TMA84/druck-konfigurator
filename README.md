# Druck-Konfigurator für OrcaSlicer

Startwerte berechnen und direkt als **OrcaSlicer-Projekt (3MF)** speichern – mit Überhang-Analyse, Lage-Vorschlag, Einstellungen je Teil und Umstellung von Makerworld-Projekten auf den eigenen Drucker. Zurzeit **nur für Anycubic-Drucker**: der **Kobra S1 (Combo)** mit eigener, getesteter Vorlage und die übrigen Anycubic-Modelle aus den OrcaSlicer-Profilen. Die anderen Hersteller (und der Snapmaker U1) sind im Code enthalten, aber ausgeblendet – `index.html?alle-drucker` zeigt sie.

![Übersicht](docs/img/uebersicht.png)

## Was es kann

- **Anycubic-Drucker:** Kobra S1 mit eigener Vorlage, weitere Anycubic-Modelle aus den OrcaSlicer-Profilen – Geschwindigkeiten und Beschleunigung werden auf das Profil des Druckers begrenzt
- **Modell laden:** STL (auch mit mehreren Körpern), mehrere Dateien, 3MF, Makerworld-ZIP
- **Lage auf dem Bett:** schlägt die Seite vor, die am wenigsten Stützen braucht – Stützen auf dem Teil zählen stärker, weil sie schwer abgehen
- **Druckwerte:** Temperaturen, Schichthöhe, Geschwindigkeiten, Wände, Füllung, Stützen, Brim – je nach Filament, Objektart, Priorität und Belastung; oben die Kennzahlen, darunter die **Werte-Tafel** (Reiter nach Thema, Suche, Tabelle *Einstellung | Wert | Vorschlag*) – jeder Wert direkt änderbar, auch rund 30 weitere Orca-Einstellungen, eigene Standardwerte je Filament auf dem Server
- **Brim, der Löcher und Schriften freilässt:** gesetzte Mausohren entlang des Außenrands statt Orcas Rundum-Brim um Inseln in Öffnungen; Brim außen und innen getrennt, innen nur in großen Löchern
- **Mehrere Teile:** eigenes Filament, eigene Werte und eigener Slot je Teil; Kopien, Modelle kombinieren, einzelne Teile oder Modelle wieder entfernen
- **Slots wie in OrcaSlicer:** farbige Slot-Chips in der Teileliste, Filamentleiste, bei Makerworld-3MF „Modell → Slot“ mit automatischer Zuordnung nach Farbe und Material; das Filament in den Druckwerten folgt dem Slot
- **Mehrfarbig:** mehrere Körper in einem Teil, jeder mit eigenem Slot – auch mehrere STLs (eine je Farbe) zu einem Teil vereinen; **Bemalung** und Farb-Modifikatoren von Makerworld-Modellen werden angezeigt und auf die eigenen Slots umgeschrieben (auch mehr Farben als Slots)
- **Werkzeugleiste in der 3D-Ansicht:** hinzufügen, neue Platte, ausrichten, anordnen, Kopien, trennen, Fläche aufs Bett, drehen, **Größe** (Prozent oder mm je Achse), Schnitt, Text, messen, ganze Platte – auch für Makerworld-3MF
- **Platten:** platzsparend anordnen, Kosten je Platte, Reihenfolge nach Filament, **Druck Objekt für Objekt** mit Abstand für den Druckkopf
- **Bemalen wie in OrcaSlicer:** Farbe, Stützen (erzwingen/verhindern) und Naht je Fläche – Kreis, Kugel, Dreieck, Füllen mit Vorschau, Höhenbereich, Lücken füllen, Radierer; Orca-kompatibel (paint_color, paint_supports, paint_seam), auch auf Makerworld-Modellen
- **Filamente von Anycubic und SUNLU** mit den Druckwerten der Hersteller und ihren Farben (Anycubic mit offiziellen Farbcodes) – Farbe anklicken trägt sie für den Slot ein
- **Beschriftung:** Text erhaben (eigene Farbe) oder vertieft auf ein Teil
- **Weniger Spülabfall (Kobra S1):** Schätzung von Farbwechseln, Abfall und Zeit; Empfehlung für die Spülmenge am Drucker
- **Kostenkalkulation:** exakt geslict mit OrcaSlicer (im Container) – Filament je Slot, Spülabfall, Strom, Verschleiß, optional Aufschlag und MwSt.
- **Slice-Vorschau:** der geslicte G-Code als Schichtansicht im Tool (Linienart oder Filament, Schichtregler) und zum Herunterladen
- **Drucker-Werkbank (Kobra S1, LAN-Modus):** Druckauftrag mit Pause/Abbruch, Kamera, Temperaturen, Lüfter, Licht, Achsen und ACE (Trocknen, Laden, Nachfüllen) – auch mit mehreren ACE-Einheiten
- **3D-Fortschritt:** der laufende Druck Schicht für Schicht als beleuchtete Raupen, mit Druckkopf auf der echten Position (folgt den Bahnen mit den Geschwindigkeiten aus dem G-Code), Druckplatte und Mechanik; Objekte während des Drucks überspringen
- **Filamentverwaltung und Druckhistorie:** Spulen mit errechneter Restmenge (auch „Neue Spule eingelegt“ bei gleicher Sorte und Farbe), Verbrauch und Kosten je Druck, Monatsstatistik
- **Warteschlange und geplanter Druck:** Platten nacheinander drucken, mit „Bett abräumen“-Hinweis (der Server hebt die Platten dauerhaft auf); Druck zeitlich planen, vorher trocknen und Bett vorwärmen
- **Home Assistant:** als Add-on (Seitenleiste, Einstellungen dort) und Sensoren über MQTT (Fortschritt, Restzeit, Warteschlange, Restmenge je Slot)
- **Direkt drucken:** geslicte Platte an den Kobra S1 senden und starten – mit Prüfung der ACE-Belegung
- **Bohrlöcher verstärken:** erkannte Löcher per Häkchen mit einem 100-%-Füllung-Ring versehen (Orca-Modifikator)
- **3MF für OrcaSlicer:** Werte, Stützen und Slots landen direkt im Projekt
- **Makerworld-3MF umstellen:** Bambu-Einstellungen raus, eigenes Druckerprofil rein, Platten und Farben bleiben
- **Drucker-Verbindung (Kobra S1):** mit der **Werksfirmware im LAN-Modus** die ACE-Belegung live lesen und Slot-Filament sowie „Nachfüllen“ am Drucker ändern – oder über Rinkhals/Moonraker lesen. Ohne Verbindung: Belegung einmal eintragen
- **Als Container** (z. B. auf dem NAS) oder lokal im Browser, ohne Cloud; das geladene Projekt übersteht ein Neuladen, optional mit PIN geschützt
- **Deutsch und Englisch, hell und dunkel (Graphit + Petrol), Desktop, Tablet und Handy**

## Schnellstart

**Online ausprobieren (Ursprungsprojekt):** https://wolfb63-del.github.io/druck-konfigurator/ – der Konfigurator von wolfb63-del direkt im Browser, auch auf Mac, Linux und Tablet (ohne die Drucker- und Server-Funktionen dieses Forks).

**Als Container (NAS/Heimserver, empfohlen für die Drucker-Verbindung):**

```
docker compose up -d --build
```

Danach im Browser `http://<IP-des-NAS>:8765/` öffnen. Das Image enthält OrcaSlicer für die Kostenkalkulation (rund 1,5 GB, x86_64 und ARM). Der Container braucht nur ausgehende Verbindungen zum Drucker (Ports 18910 und 9883 im LAN-Modus); das normale Docker-Netz reicht. Die Seite hat keine Anmeldung – nur im Heimnetz betreiben, nicht ins Internet freigeben. Eigene Filamentwerte speichert weiterhin jeder Browser für sich.

**Als Home-Assistant-Add-on:** In Home Assistant unter **Einstellungen → Add-ons → Add-on-Store → ⋮ → Repositories** `https://github.com/TMA84/ha-addons` hinzufügen, dann **Druck-Konfigurator** installieren. Das Tool erscheint in der Seitenleiste (Ingress, mit der HA-Anmeldung); optional zusätzlich direkt auf Port 8765. Spulen und Verbrauch der Filamentverwaltung liegen im Add-on unter `/data`.

**Oder herunterladen:**

1. **Code → Download ZIP**, entpacken.
2. Doppelklick auf **`index.html`** – keine Installation nötig.
3. Modell ins Fenster ziehen und die Schritte **① Modell → ② Druckwerte → ③ Slicen & Kosten** durchgehen – dort drucken oder als 3MF für OrcaSlicer speichern.

Ausführlich: **[Handbuch](HANDBUCH.md)** (auch als [PDF](docs/Handbuch.pdf)).

## Voraussetzungen

- Windows, macOS oder Linux mit aktuellem Browser (Chrome, Edge, Firefox, Safari) – getestet ist Windows mit Chrome; auf Mac und Linux sollte es genauso laufen, Rückmeldungen willkommen
- OrcaSlicer (Vorlagen erstellt mit 2.4.2)
- Nur für die Drucker-Verbindung: der Container **oder** Python 3.8+ lokal (Windows `Konfigurator starten.cmd`, Mac/Linux `python3 tools/serve.py`, dann `http://127.0.0.1:8765`). Für die Werksfirmware (LAN-Modus) lokal einmal `pip install -r requirements.txt` (paho-mqtt, cryptography) – im Container ist das enthalten. Für Rinkhals/Moonraker reicht Python allein. In der Online-Version geht die Live-Abfrage nicht (der Browser blockiert Anfragen von einer https-Seite an den Drucker im Heimnetz).

## Hinweise

- Alle Werte sind **Startwerte ohne Gewähr**. Getestet am Kobra S1 mit PLA High Speed und TPU; die U1-Werte sind noch nicht am U1 gegengetestet.
- Der 3MF-Export nutzt die Orca-Vorlagen in `templates/` (0,4-mm-Düse). Eigene Vorlagen: in Orca ein leeres Projekt mit deinem Drucker speichern, nach `templates/<drucker>_0.4.3mf` legen und `node tools/build-orca-templates.js` ausführen.

## Für Entwickler

Bei jedem Push laufen die Tests auf GitHub (`.github/workflows/tests.yml`: Node, Python, OrcaSlicer, Bedientest).

Reines HTML/CSS/JavaScript ohne Build-Schritt (`<script src>`, funktioniert auch über `file://`). Tests mit Node:

```
node tests/compare-v4.js      # gleiche Ergebnisse wie v4
node tests/import.js          # Import (STL/ZIP/3MF)
node tests/orient.js          # Lage-Bewertung
node tests/export-project.js  # Makerworld-Umstellung
node tests/holes.js           # Bohrloch-Erkennung
node tests/purge.js           # Farbwechsel- und Abfall-Schätzung
python tests/lan.py           # Werksfirmware/LAN-Modus gegen einen nachgebauten Kobra S1 (braucht requirements.txt)
node tests/costs.js           # Kostenkalkulation
python tests/slice.py         # Slicen für die Kosten (mit OrcaSlicer, sonst nur Parser)
python tests/preview.py       # G-Code → Schichtvorschau
node tests/overrides.js       # Werte je Auftrag anpassen
node tests/plates.js          # Platten: Zuordnung, Reihenfolge nach Filament, Warteschlange
node tests/export-project-arrange.js  # Makerworld-3MF anordnen/kombinieren/Kopien (mit OrcaSlicer)
python tests/spools.py        # Filamentverwaltung (Erkennen, Verbrauch, Export/Import)
python tests/printqueue.py    # Warteschlange auf dem Server
python tests/ha_mqtt.py       # Home-Assistant-MQTT (gegen einen nachgebauten Broker)
python tests/printed.py       # Vorschau gestarteter Drucke (3D-Fortschritt)
node tests/engrave.js         # Beschriftung: Schrift, Platzierung, 3MF (mit OrcaSlicer)
node tests/paint.js           # Bemalung je Dreieck (paint_color): lesen, schreiben, Teilstücke wie Orca, Pinsel, Füllen, Import
node tests/filaments.js       # Filamente der Hersteller: Werte stimmig, Farbcodes, Rechenkern
node tests/paint-orca.js      # Bemalen gegen Orca: Farbe, Stützen (erzwingen/verhindern), Naht im G-Code
node tests/designer-3mf.js    # Makerworld-Aufbau: Bemalung (auch eigene), Modifikator, Drehen/Größe, Text am Objekt (mit Orca-CLI)
python tests/auth.py          # PIN-Schutz
node tools/headless.js smoke  # Bedientest im Chrome ohne Fenster (Server muss laufen)
node tests/verify-3mf.js      # Export gegen die OrcaSlicer-CLI (dauert einige Minuten)
node tests/verify-orca-printers.js  # 3MF für beliebige Drucker gegen die OrcaSlicer-CLI (dauert lang)
```

Der Bedientest `tests/ui-smoke.js` läuft im Browser (Anleitung im Kopf der Datei; mit `index.html?alle-drucker`, weil er auch U1 und andere Hersteller prüft). Bedientest der Drucker-Verbindung ohne echten Drucker: `python tests/lan.py --serve` startet einen nachgebauten Kobra S1 unter 127.0.0.1. Handbuch-PDF neu erzeugen: `node tools/build-handbuch.js`; Bilder in docs/img: `node tools/build-screenshots.js` (Server muss laufen). Druckerliste neu erzeugen, wenn eine neue OrcaSlicer-Version installiert ist: `node tools/build-orca-printers.js`.

## Haftungsausschluss

Die Nutzung erfolgt auf eigene Verantwortung. Der Druck-Konfigurator ist ein privates, nicht kommerzielles Projekt und wird ohne jede Gewährleistung bereitgestellt.

1. **Keine Gewähr für die Werte.** Alle berechneten Einstellungen – auch die für einen Auftrag angepassten – sind Startwerte. Filamente unterscheiden sich je nach Hersteller und Charge; die Angaben auf der Rolle, die Vorschau im Slicer und ein Testdruck haben immer Vorrang.
2. **Keine Haftung für Schäden an Drucker und Zubehör.** Für Schäden an Düse, Druckplatte (z. B. PETG auf glatter PEI-Platte ohne Trennmittel), Hotend, ACE oder anderen Teilen, für Verstopfungen, Fehldrucke, Kollisionen oder verbrauchtes Material wird keine Haftung übernommen.
3. **Steuern und Drucken aus dem Tool.** Über den LAN-Modus der Werksfirmware kann das Tool den Drucker steuern: Druck hochladen und starten, pausieren und abbrechen, Temperaturen, Lüfter, Licht, Achsen, Filament laden und Trocknen. Vor jedem Start prüfst du selbst, dass das Bett frei ist, die richtige Druckplatte liegt und das Filament in den Slots zum G-Code passt. Die Warteschlange startet nie von selbst. Anycubic unterstützt diese Schnittstelle offiziell nicht; eine neue Firmware kann sie ändern oder abschalten. Die optionale Anbindung über Moonraker setzt eine Fremd-Firmware voraus (z. B. Rinkhals) – deren Installation und Nutzung liegt vollständig in deiner Verantwortung.
4. **Kosten, Zeiten und Restmengen sind Schätzungen.** Die Kosten beruhen auf dem Slicen mit OrcaSlicer und deinen Preisen; sie sind kein verbindliches Angebot. Die Restmenge der Spulen errechnet das Tool aus dem gemeldeten Verbrauch – sie kann abweichen (Messfehler, Drucke ohne laufenden Server, Spülabfall). Für einen Druck, der knapp wird, lieber nachwiegen.
5. **Keine zugesicherte Eignung der gedruckten Teile.** Ob ein Teil für eine sicherheitskritische oder tragende Anwendung, für den Kontakt mit Lebensmitteln oder als Kinderspielzeug geeignet ist, beurteilt allein der Nutzer. Auch die Bohrloch-Verstärkung ersetzt keine Festigkeitsprüfung.
6. **Gesundheit und Sicherheit.** Beim Drucken – besonders mit ABS und ASA – entstehen Dämpfe und ultrafeine Partikel: Raum gut lüften, nicht in Wohn- oder Schlafräumen drucken. 3D-Drucker nicht unbeaufsichtigt betreiben – auch nicht, wenn du aus der Ferne (Kamera, Home Assistant) zusiehst.
7. **Betrieb als Server, Container oder Home-Assistant-Add-on.** Die Seite hat keine eigene Anmeldung. Nur im Heimnetz betreiben und nicht ins Internet freigeben; im Home-Assistant-Add-on schützt die Anmeldung von Home Assistant (Ingress), der optionale direkte Port nicht. Daten (Spulen, Verbrauch) liegen nur lokal auf dem Server bzw. im Browser.
8. **Marken.** Dieses Projekt steht in keiner Verbindung zu Anycubic, Snapmaker, Bambu Lab, Makerworld, OrcaSlicer oder Home Assistant. Produkt- und Markennamen werden nur zur Beschreibung verwendet und gehören ihren Inhabern.
9. **Fremde Modelle und Software.** Wer Projekte anderer (z. B. von Makerworld) mit dem Tool umstellt, ist selbst für die Einhaltung ihrer Lizenz verantwortlich – etwa „nicht kommerziell“ oder „keine Weitergabe“. Das Container-Image enthält OrcaSlicer unverändert unter dessen eigener Lizenz (AGPL-3.0), siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Dank

Dieses Projekt ist ein Fork des **[Druck-Konfigurators von wolfb63-del](https://github.com/wolfb63-del/druck-konfigurator)**. Von dort stammen die Grundlage des Tools – die Empfehlungslogik und das Datenblatt (Konfigurator v4/v5), die 3D-Ansicht mit Überhang-Analyse, Lage auf dem Bett, Bohrloch-Verstärkung, Makerworld-Import und der 3MF-Export für OrcaSlicer. **Vielen Dank für die Arbeit und dafür, dass sie offen geteilt wird!** Die Erweiterungen in diesem Fork (Anycubic-Werkbank, Mehrfarbdruck, Kosten, mehrere Platten, Filamentverwaltung, Container und Home-Assistant-Add-on, Englisch) stehen unter derselben Lizenz.

## Änderungen und Lizenz

- Versionen und Änderungen: [CHANGELOG.md](CHANGELOG.md)
- Lizenz: [CC BY-NC 4.0](LICENSE) – nutzen, ändern und weitergeben erlaubt, **nicht kommerziell**, mit Namensnennung (Urheber: wolfb63-del, Erweiterungen: TMA84).
- Mitgelieferte Bibliotheken (three.js, fflate) stehen unter MIT-Lizenz, siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
