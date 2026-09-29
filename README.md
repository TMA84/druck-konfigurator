# Druck-Konfigurator für OrcaSlicer

Startwerte berechnen und direkt als **OrcaSlicer-Projekt (3MF)** speichern – mit Überhang-Analyse, Lage-Vorschlag, Einstellungen je Teil und Umstellung von Makerworld-Projekten auf den eigenen Drucker. Zurzeit **nur für Anycubic-Drucker**: der **Kobra S1 (Combo)** mit eigener, getesteter Vorlage und die übrigen Anycubic-Modelle aus den OrcaSlicer-Profilen. Die anderen Hersteller (und der Snapmaker U1) sind im Code enthalten, aber ausgeblendet – `index.html?alle-drucker` zeigt sie.

![Übersicht](docs/img/uebersicht.png)

## Was es kann

- **Anycubic-Drucker:** Kobra S1 mit eigener Vorlage, weitere Anycubic-Modelle aus den OrcaSlicer-Profilen – Geschwindigkeiten und Beschleunigung werden auf das Profil des Druckers begrenzt
- **Modell laden:** STL (auch mit mehreren Körpern), mehrere Dateien, 3MF, Makerworld-ZIP
- **Lage auf dem Bett:** schlägt die Seite vor, die am wenigsten Stützen braucht – Stützen auf dem Teil zählen stärker, weil sie schwer abgehen
- **Datenblatt:** Temperaturen, Schichthöhe, Geschwindigkeiten, Wände, Füllung, Stützen, Brim – je nach Filament, Objektart, Priorität und Belastung
- **Mehrere Teile:** eigenes Filament, eigene Werte und eigener Slot je Teil
- **Mehrfarbig:** mehrere Körper in einem Teil, jeder mit eigenem Slot – auch mehrere STLs (eine je Farbe) zu einem Teil vereinen
- **Weniger Spülabfall (Kobra S1):** Schätzung von Farbwechseln, Abfall und Zeit; Empfehlung für die Spülmenge am Drucker
- **Kostenkalkulation:** exakt geslict mit OrcaSlicer (im Container) – Filament je Slot, Spülabfall, Strom, Verschleiß, optional Aufschlag und MwSt.
- **Slice-Vorschau:** der geslicte G-Code als Schichtansicht im Tool (Linienart oder Filament, Schichtregler) und zum Herunterladen
- **Drucker-Werkbank (Kobra S1, LAN-Modus):** Druckauftrag mit Pause/Abbruch, Kamera, Temperaturen, Lüfter, Licht, Achsen und ACE (Trocknen, Laden, Nachfüllen)
- **Direkt drucken:** geslicte Platte an den Kobra S1 senden und starten – mit Prüfung der ACE-Belegung
- **Bohrlöcher verstärken:** erkannte Löcher per Häkchen mit einem 100-%-Füllung-Ring versehen (Orca-Modifikator)
- **3MF für OrcaSlicer:** Werte, Stützen und Slots landen direkt im Projekt
- **Makerworld-3MF umstellen:** Bambu-Einstellungen raus, eigenes Druckerprofil rein, Platten und Farben bleiben
- **Drucker-Verbindung (Kobra S1):** mit der **Werksfirmware im LAN-Modus** die ACE-Belegung live lesen und Slot-Filament sowie „Nachfüllen“ am Drucker ändern – oder über Rinkhals/Moonraker lesen. Ohne Verbindung: Belegung einmal eintragen
- **Als Container** (z. B. auf dem NAS) oder lokal im Browser, ohne Cloud

## Schnellstart

**Online ausprobieren:** https://wolfb63-del.github.io/druck-konfigurator/ – läuft direkt im Browser, auch auf Mac, Linux und Tablet (ohne Live-Abfrage vom Drucker).

**Als Container (NAS/Heimserver, empfohlen für die Drucker-Verbindung):**

```
docker compose up -d --build
```

Danach im Browser `http://<IP-des-NAS>:8765/` öffnen. Das Image enthält OrcaSlicer für die Kostenkalkulation (rund 1,5 GB, x86_64 und ARM). Der Container braucht nur ausgehende Verbindungen zum Drucker (Ports 18910 und 9883 im LAN-Modus); das normale Docker-Netz reicht. Die Seite hat keine Anmeldung – nur im Heimnetz betreiben, nicht ins Internet freigeben. Eigene Filamentwerte speichert weiterhin jeder Browser für sich.

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
node tests/verify-3mf.js      # Export gegen die OrcaSlicer-CLI (dauert einige Minuten)
node tests/verify-orca-printers.js  # 3MF für beliebige Drucker gegen die OrcaSlicer-CLI (dauert lang)
```

Der Bedientest `tests/ui-smoke.js` läuft im Browser (Anleitung im Kopf der Datei; mit `index.html?alle-drucker`, weil er auch U1 und andere Hersteller prüft). Bedientest der Drucker-Verbindung ohne echten Drucker: `python tests/lan.py --serve` startet einen nachgebauten Kobra S1 unter 127.0.0.1. Handbuch-PDF neu erzeugen: `node tools/build-handbuch.js`. Druckerliste neu erzeugen, wenn eine neue OrcaSlicer-Version installiert ist: `node tools/build-orca-printers.js`.

## Haftungsausschluss

Die Nutzung erfolgt auf eigene Verantwortung. Der Druck-Konfigurator ist ein privates, nicht kommerzielles Projekt und wird ohne jede Gewährleistung bereitgestellt.

1. **Keine Gewähr für die Werte.** Alle berechneten Einstellungen sind Startwerte. Filamente unterscheiden sich je nach Hersteller und Charge; die Angaben auf der Rolle, die Vorschau im Slicer und ein Testdruck haben immer Vorrang.
2. **Keine Haftung für Schäden an Drucker und Zubehör.** Für Schäden an Düse, Druckplatte (z. B. PETG auf glatter PEI-Platte ohne Trennmittel), Hotend oder anderen Teilen, für Verstopfungen, Fehldrucke oder verbrauchtes Material wird keine Haftung übernommen.
3. **Keine zugesicherte Eignung der gedruckten Teile.** Ob ein Teil für eine sicherheitskritische oder tragende Anwendung, für den Kontakt mit Lebensmitteln oder als Kinderspielzeug geeignet ist, beurteilt allein der Nutzer. Auch die Bohrloch-Verstärkung ersetzt keine Festigkeitsprüfung.
4. **Gesundheit und Sicherheit.** Beim Drucken – besonders mit ABS und ASA – entstehen Dämpfe und ultrafeine Partikel: Raum gut lüften, nicht in Wohn- oder Schlafräumen drucken. 3D-Drucker nicht unbeaufsichtigt betreiben.
5. **Drucker-Verbindung.** Die optionale Live-Abfrage liest über Moonraker nur die Filament-Belegung und sendet keine Steuerbefehle. Moonraker läuft nicht mit der Werksfirmware, sondern erfordert eine Fremd-Firmware (z. B. Rinkhals oder die Extended Firmware von paxx12) – deren Installation und Nutzung liegt vollständig in der Verantwortung des Nutzers.
6. **Marken.** Dieses Projekt steht in keiner Verbindung zu Anycubic, Snapmaker, Bambu Lab, Makerworld oder OrcaSlicer. Produkt- und Markennamen werden nur zur Beschreibung verwendet und gehören ihren Inhabern.
7. **Fremde Modelle.** Wer Projekte anderer (z. B. von Makerworld) mit dem Tool umstellt, ist selbst für die Einhaltung ihrer Lizenz verantwortlich – etwa „nicht kommerziell“ oder „keine Weitergabe“.

## Änderungen und Lizenz

- Versionen und Änderungen: [CHANGELOG.md](CHANGELOG.md)
- Lizenz: [CC BY-NC 4.0](LICENSE) – nutzen, ändern und weitergeben erlaubt, **nicht kommerziell**, mit Namensnennung.
- Mitgelieferte Bibliotheken (three.js, fflate) stehen unter MIT-Lizenz, siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
