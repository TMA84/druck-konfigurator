# Druck-Konfigurator – Handbuch

Der Druck-Konfigurator berechnet passende Startwerte für den **Anycubic Kobra S1 (Combo)** und den **Snapmaker U1** und schreibt sie direkt in eine Projektdatei für **OrcaSlicer**. Du lädst ein Modell, das Tool prüft Maße und Überhänge, schlägt die beste Lage auf dem Bett vor und liefert eine 3MF-Datei, die in Orca sofort mit den richtigen Werten öffnet.

Alles läuft lokal in deinem Browser. Es werden keine Modelle oder Daten ins Internet geschickt.

> **Hinweis:** Alle Werte sind Startwerte ohne Gewähr. Filamente unterscheiden sich je nach Hersteller und Charge – die Angaben auf der Rolle haben Vorrang. Die Slicer-Vorschau immer prüfen. Nutzung auf eigene Verantwortung – den vollständigen **Haftungsausschluss** findest du in der [README](README.md#haftungsausschluss) und im Tool unter **? → Haftungsausschluss**.

---

## Inhalt

1. [Installation und Start](#1-installation-und-start)
2. [Die Oberfläche](#2-die-oberfläche)
3. [Modell laden](#3-modell-laden)
4. [Mehrere Teile](#4-mehrere-teile)
5. [Lage auf dem Bett](#5-lage-auf-dem-bett)
6. [Einstellungen und Datenblatt](#6-einstellungen-und-datenblatt)
7. [Eigene Filamentwerte und Profile](#7-eigene-filamentwerte-und-profile)
8. [Drucker-Verbindung (Filament-Belegung live)](#8-drucker-verbindung-filament-belegung-live)
9. [3MF für OrcaSlicer speichern](#9-3mf-für-orcaslicer-speichern)
10. [Makerworld-Projekte umstellen](#10-makerworld-projekte-umstellen)
11. [3D-Ansicht](#11-3d-ansicht-schritt--modell)
12. [Grenzen und bekannte Einschränkungen](#12-grenzen-und-bekannte-einschränkungen)
13. [Probleme lösen](#13-probleme-lösen)

---

## 1. Installation und Start

**Als Container (empfohlen für die Drucker-Verbindung):** auf dem NAS oder Heimserver im Projektordner `docker compose up -d --build`, dann im Browser `http://<IP-des-NAS>:8765/` – von jedem Gerät im Heimnetz. Die Seite hat keine Anmeldung: nur im Heimnetz betreiben, nicht ins Internet freigeben. Eigene Filamentwerte speichert weiterhin jeder Browser für sich (über **Profile exportieren/importieren** übertragen).

**Online:** https://wolfb63-del.github.io/druck-konfigurator/ – ohne Download, auch auf Mac, Linux und Tablet. Die Live-Abfrage vom Drucker geht dort nicht; „Belegung eintragen“ schon. Eigene Filamentwerte speichert der Browser getrennt von der heruntergeladenen Version.

**Voraussetzungen:** Windows, macOS oder Linux mit einem aktuellen Browser (Chrome, Edge, Firefox oder Safari) und OrcaSlicer. Getestet ist Windows mit Chrome; auf Mac und Linux sollte es genauso laufen. **Keine Installation nötig.** Nur wer die Filament-Belegung live vom Drucker lesen will (Rinkhals/Moonraker), braucht zusätzlich [Python](https://www.python.org) (Version 3.8 oder neuer).

1. Das Projekt als ZIP herunterladen (auf GitHub: **Code → Download ZIP**) und in einen Ordner entpacken, z. B. `C:\Druck-Konfigurator`.
2. Starten – zwei Möglichkeiten:
   - **Normal:** Doppelklick auf **`index.html`**. Alles funktioniert; die Filament-Belegung trägst du einmal im Export-Dialog ein (siehe [Kapitel 9](#9-3mf-für-orcaslicer-speichern)).
   - **Mit Live-Abfrage** (nur Rinkhals/Moonraker, braucht Python): unter Windows Doppelklick auf **`Konfigurator starten.cmd`**; unter Mac/Linux im Projektordner im Terminal `python3 tools/serve.py` eingeben und im Browser `http://127.0.0.1:8765` öffnen. Es öffnet sich ein schwarzes Fenster (lokaler Webserver) und der Browser mit dem Tool. Das Fenster offen lassen, solange du das Tool benutzt. Der Server ist nur auf deinem PC erreichbar. Direkt geöffnet (`index.html`) blockiert der Browser die Antworten der Drucker.

> Deine eigenen Filamentwerte speichert der Browser getrennt je Startart. Bleib deshalb bei einer Startart – oder übertrage die Werte über **⚙ Einstellungen → Profile exportieren/importieren**.

---

## 2. Die Oberfläche

![Übersicht](docs/img/uebersicht.png)

- **Kopfzeile:** Drucker umschalten (**Kobra S1** / **Anderer Anycubic …**), Düsengröße und Düsenmaterial. Zurzeit bietet das Tool nur Anycubic-Drucker an; der Snapmaker U1 und die übrigen Hersteller sind ausgeblendet (`index.html?alle-drucker` zeigt sie).

### Anderer Anycubic-Drucker

Über **Anderer Anycubic …** wählst du aus den Anycubic-Druckern der OrcaSlicer-Profile (z. B. Kobra 3, Kobra S1 Max, Kobra X). Namen eintippen, Drucker mit passender Düse anklicken. (Mit `index.html?alle-drucker`: rund 990 Drucker von 63 Herstellern.)

- **Geschwindigkeiten, Beschleunigung und Volumenstrom** höchstens so hoch wie im OrcaSlicer-Profil des Druckers – ein langsamer Drucker bleibt bei seinen Werten, TPU trotzdem langsam.
- **Temperaturen und Materialwerte** stammen aus den Tests am Kobra S1 und gelten hier als allgemeine Startwerte.
- Die **3MF** enthält Druckerprofil, Prozessprofil und passende Filamentprofile des Herstellers aus OrcaSlicer; Orca lädt beim Öffnen genau diese Profile.
- Heizt der Start-G-Code eines Herstellerprofils fest auf eine Temperatur (bei rund 20 Profilen, z. B. LONGER LK10), warnt das Datenblatt – Orca würde sonst mit dieser festen Temperatur drucken.
- Kobra S1 und U1 nutzen weiterhin deine eigenen Orca-Vorlagen und die Live-Abfrage.
- **Arbeitsschritte (Registerkarten)** – der Reihe nach von links nach rechts:

  | Schritt | Inhalt |
  |---|---|
  | **① Modell** | große 3D-Ansicht; daneben Teileliste, Lage auf dem Bett, Mehrfarbig, Bohrlöcher |
  | **② Druckwerte** | je Teil Filament, Objektart, Priorität, Belastung, Support – rechts das Datenblatt; die lange Liste „Einstellungen in OrcaSlicer-Reihenfolge“ ist eingeklappt |
  | **③ Slicen & Kosten** | Kosten (automatisch neu berechnet), Ausgabe (**Drucken …**, **3MF für OrcaSlicer speichern**), Filament-Slots, Spülmenge – rechts die Slice-Vorschau |
  | **④ Drucker** | Werkbank: Druckauftrag, Kamera, Temperaturen, Achsen, ACE |

  Die Registerkarte **① Modell** zeigt „geladen“, **③** den Gesamtpreis, **④** den Druckfortschritt. Die Pfeiltasten ←/→ wechseln zwischen den Schritten.
- **Menüs:**
  - **Datei** – Modell öffnen, Modell entfernen, 3MF für OrcaSlicer; unter **Weitere Exporte** Filament-/Process-JSON, Datenblatt drucken/als PDF, Datenblatt als Text kopieren
  - **⚙ Einstellungen** – *Filamente* (Werte anpassen, neues Filament, eigene Profile, Import/Export), *Drucker* (Drucker-Verbindung, Düsen-Umrechnung), *Farben & Kosten* (Filament-Slots, Farbwechsel & Spülmenge, Preise & Sätze)
  - **?** – Kurzhilfe
- Neben vielen Werten steht ein **?** – mit der Maus darauf zeigen (oder antippen) für eine Erklärung.

---

## 3. Modell laden

Über **Datei → Modell öffnen** oder einfach per Drag & Drop ins Fenster. Möglich sind:

| Datei | Was passiert |
|---|---|
| **STL** | Wird eingelesen; stecken mehrere getrennte Körper darin, werden sie als einzelne Teile erkannt. |
| **mehrere STLs** | Alle zusammen als ein Projekt mit Teileliste. |
| **3MF** | Objekte, Platten und Slot-Zuweisung werden übernommen (Modifier und Hilfskörper werden nicht als Teil gezählt). |
| **ZIP** (z. B. von Makerworld) | Wird entpackt. Liegt genau eine 3MF darin, wird diese verwendet, sonst alle STLs. |

Körper, die sich berühren oder überlappen, bleiben ein Teil – z. B. Hohlkörper oder unverschmolzene Exporte aus Tinkercad.

---

## 4. Mehrere Teile

Bei mehreren Teilen erscheint im Schritt **① Modell** eine **Teileliste**. Jede Zeile zeigt Name, Maße, Slot und ob das Teil Stützen braucht.

- **Anklicken wählt ein Teil.** Die Druckwerte, das Datenblatt und die 3D-Ansicht gelten dann für dieses Teil. In **② Druckwerte** steht oben **„Einstellungen für Teil“** – dort wählst du das Teil auch direkt über **Teil**, ohne zurück zum Modell zu wechseln.
- Jedes Teil merkt sich **eigenes Filament, Objektart, Priorität, Belastung, Support und Stützreduzierung**.
- Über **Slot** kannst du jedem Teil einen eigenen Filament-Slot geben. „Wie beim Export gewählt“ bedeutet: Das Teil bekommt den Standard-Slot aus dem Export-Dialog.

### Mehrfarbig: mehrere Farben in einem Teil

Besteht ein Teil aus mehreren **Körpern**, zeigt der Schritt **① Modell** den Kasten **Mehrfarbig**. Körper sind:

- Körper einer STL, die sich berühren oder überlappen (z. B. Schrift auf einer Platte, Stiel und Hut),
- die Bauteile eines Objekts in einer 3MF (die Slots des Designers werden übernommen),
- Dateien, die du selbst vereint hast (siehe unten).

Jeder Körper bekommt über die Auswahl rechts einen eigenen **Slot** – und damit die Farbe, die in diesem Slot steckt. „wie Teil“ heißt: Er bekommt den Slot des Teils. Fährst du mit der Maus über eine Zeile, leuchtet der Körper in der Vorschau gelb auf; **Farben zeigen** färbt alle Körper in der Farbe ihres Slots (live vom Drucker oder aus deiner Belegung, sonst Ersatzfarben).

Steht dasselbe Objekt einer 3MF auf mehreren Platten, gilt die Farbwahl für **alle Platten** – Orca speichert sie je Objekt. Der Kasten nennt dann, auf welchen Platten das Objekt steht.

Ein Körper hat dieselben Werte wie sein Teil – gedacht ist das für Farbwechsel. In der 3MF wird jeder Körper ein eigenes Bauteil mit eigenem Slot; der Export-Dialog listet ihn unter dem Teil mit „↳“ auf.

**Mehrere Dateien zu einem Teil vereinen:** Viele mehrfarbige Modelle kommen als eine STL je Farbe, alle an derselben Stelle. Wähle eine Datei, dann unter **Mit Teil vereinen** die zweite und **Vereinen**. Die Lage aus den Dateien bleibt, eine Drehung wird zurückgesetzt. **In einzelne Teile trennen** macht das wieder rückgängig. Bei Makerworld-3MF gibt es beides nicht, dort bleiben die Objekte des Designers.

Hohlräume (die Innenwand eines Hohlkörpers) gelten nicht als eigener Körper. Körper, die sich Eckpunkte teilen (ein zusammenhängendes Netz), bleiben ein Körper – dann die Farben als getrennte Dateien exportieren.

### Farbwechsel und Abfall (Kobra S1)

Beim Kobra S1 spült die Firmware bei jedem Farbwechsel selbst in den Abfallschacht – der Slicer schreibt nur den Wechselbefehl. Der Export-Dialog zeigt deshalb bei mehrfarbigen Projekten eine Schätzung: **wie viele Farbwechsel**, wie viel **Abfall** und wie lange die Wechsel dauern. Die Zahl der Wechsel rechnet das Tool wie OrcaSlicer (mit der Orca-Kommandozeile verglichen); Abfall und Zeit stammen aus einer Messung mit PLA (100 Wechsel).

Die Menge stellst du **am Drucker** ein: Touchscreen, ACE-Menü, **Spülmenge** (0,1–3,0, ab Werk 1,5). Im Dialog wählst du unter **Spülmenge am Drucker**, was dort eingestellt ist – die Datei bekommt dann die passende Wechselzeit, damit Orca die Druckzeit richtig schätzt.

| Spülmenge | Abfall je Wechsel | Zeit je Wechsel | Ergebnis im Test |
|---|---|---|---|
| 1,5 (Werk) | ≈ 1,1 g | ≈ 2 min 6 s | sauber |
| **1,0 (empfohlen)** | ≈ 0,8 g | ≈ 1 min 47 s | genauso sauber, rund 30 % weniger Abfall |
| 0,5 | ≈ 0,45 g | ≈ 1 min 28 s | Farben mischen sich (Weiß wird rosa), Kleckse fallen teils aufs Bett |

Bei Schwarz → Weiß oder Silk-Filament eher 1,2–1,5. Am meisten spart, wer **weniger wechselt**: mehrere Teile gleichzeitig drucken (sie teilen sich die Wechsel jeder Schicht) und Farbe nur in wenigen Schichten einsetzen, z. B. Schrift oben auf einer Fläche statt durch die ganze Höhe.

---

## 5. Lage auf dem Bett

![Modellkarte mit Lage-Vorschlag](docs/img/modell.png)

Unter **Lage auf dem Bett** bewertet das Tool, wie viele Stützen die aktuelle Lage braucht und wie viel Auflagefläche das Teil hat. Es prüft die großen ebenen Flächen des Teils als mögliche Auflage und schlägt eine bessere Lage vor, wenn sie deutlich weniger Stützen braucht.

- Stützen, die **auf dem Teil selbst** oder in Löchern stehen, zählen dreifach: Sie gehen schwerer ab und hinterlassen Spuren.
- Sehr wenig Auflagefläche (Kippgefahr) wird ebenfalls berücksichtigt.
- **Übernehmen** dreht das Teil in die vorgeschlagene Lage.
- **Fläche aufs Bett …** – wechselt in die 3D-Ansicht; die Fläche anklicken, die unten liegen soll (Esc bricht ab).
- **↻ X / ↻ Y / ↻ Z** – um 90° drehen. **Original** – Lage aus der Datei.
- Bei mehreren Teilen: **Alle Teile nach Vorschlag ausrichten**.
- Unter der Modell-Karte zeigt eine **kleine 3D-Vorschau** das gewählte Teil in seiner aktuellen Lage – rot eingefärbte Flächen brauchen Stützen. Ziehen dreht die Ansicht, das Mausrad zoomt.

Bei 3MF-Projekten bleibt die Lage des Designers erhalten; Drehen ist dort gesperrt.

### Bohrlöcher verstärken

Unter **Bohrlöcher verstärken** listet das Tool die runden Löcher des gewählten Teils auf – senkrecht und waagerecht, mit Durchmesser, Tiefe und Lage. Nichts wird automatisch geändert: Setze ein **Häkchen** bei den Löchern, die Last tragen (z. B. Schraubenlöcher). Beim 3MF-Export bekommt jedes angehakte Loch in Orca einen **Modifikator**: einen Ring von 3 mm rund um das Loch mit **100 % Füllung**. Dort ist das Teil dann massiv und verteilt die Last der Schraube besser.

- Nach einer Drehung wird neu erkannt, die Häkchen werden zurückgesetzt.
- Nur bei STL-Teilen; Makerworld-Projekte bleiben unverändert.
- In Orca erscheint der Modifikator unter dem Objekt als „Verstärkung Loch …“ und lässt sich dort anpassen oder löschen.

---

## 6. Einstellungen und Datenblatt

Links wählst du **Filament, Objektart, Priorität, Belastung, Support** und **Stützreduzierung**. Rechts steht das **Datenblatt** mit den wichtigsten Werten (Temperaturen, Schichthöhe, Geschwindigkeiten, Wände, Füllung, Stützen, Brim) und aufklappbar:

- **Einstellungen in Slicer-Reihenfolge** – alle Werte in der Reihenfolge der Slicer-Registerkarten
- **Stützparameter** – alle Stützwerte (Abstände, Schnittstelle, Baum-Parameter)
- **Hinweise** – Warnungen, z. B. zu Material und Düse
- **OrcaSlicer-Import (JSON)** – Alternative zum 3MF-Export

**Wasserdicht / Behälter:** Diese Objektart setzt mindestens 4 Wandlinien, 5 Deck- und 6 Bodenschichten, 5 °C mehr Düsentemperatur, eine langsamere Außenwand und in Orca „Lückenfüllung überall“. Die Hinweise nennen weitere Tipps (Vasenmodus für einfache Gefäße, Epoxid-Beschichtung). Nicht für Trinkwasser oder Lebensmittel – nach dem Druck mit Wasser testen.

**Stützen:** Das Tool empfiehlt Baumstützen, wenn das Teil relevante Überhänge hat. Der Abstand zwischen Stütze und Teil entspricht einer Schichthöhe (PETG 0,05 mm mehr, weil es stärker haftet) – so halten die Stützen sicher und lassen sich trotzdem lösen.

**Düsen-Umrechnung:** Für 0,25/0,6/0,8 mm und andere Düsenmaterialien rechnet das Tool die Werte um. Der 3MF-Export ist derzeit nur mit der **0,4-mm-Düse** möglich.

---

## 7. Eigene Filamentwerte und Profile

- **Werte anpassen** (unter der Filament-Auswahl oder im Menü **Profile**): eigene Temperatur, Geschwindigkeit, Lüfter usw. speichern. Alle Empfehlungen rechnen danach mit deinen Werten.
- **Neues Filament:** zusätzliches Profil, z. B. für eine bestimmte Marke.
- **Profile exportieren/importieren:** eigene Werte als Datei sichern oder auf einen anderen PC übertragen.

---

## 8. Drucker-Verbindung (Filament-Belegung live)

Unter **⚙ Einstellungen → Drucker-Verbindung** trägst du die IP-Adresse deines Druckers im Heimnetz ein, wählst die **Verbindung** und testest sie. Das Tool fragt dann beim Export die **tatsächliche Filament-Belegung** (Typ und Farbe je Slot) ab. Das Tool muss dafür über den Server laufen (Container oder `Konfigurator starten.cmd`).

### Kobra S1 mit Werksfirmware (LAN-Modus)

1. Am Drucker **Einstellungen → Netzwerk → LAN-Modus** einschalten. Im LAN-Modus ist der Drucker nicht mit der Anycubic-Cloud verbunden – die Anycubic-App kann ihn dann nicht fernsteuern.
2. Im Tool die IP-Adresse eintragen, **Verbindung: Automatisch** oder **Werksfirmware (LAN-Modus)**, **Testen**.

Das Tool meldet sich wie Anycubics eigener Slicer am Drucker an (Anmeldung über Port 18910, danach verschlüsselte Verbindung über Port 9883). Die Zugangsdaten wechselt der Drucker; das Tool speichert sie nicht. Möglich ist dann:

- **Belegung lesen** – Typ und Farbe je ACE-Slot, auch mehrere ACE-Einheiten.
- **Slot-Filament am Drucker ändern:** in den [Filament-Slots](#filament-slots) einen Slot überschreiben und **Überschriebene Slots auch in die ACE schreiben** anhaken – dann landet die Angabe in der ACE (wie am Touchscreen). Leere Slots lassen sich so nicht „leer setzen“.
- **Automatisch nachfüllen** (Runout-Nachschub aus einem anderen Slot) ein- oder ausschalten – erscheint nach einem erfolgreichen Test.
- **Rohdaten vom Drucker** ansehen (ohne die geheime Upload-Adresse).

Das Tool sendet **keine Druck-, Bewegungs- oder Heizbefehle** – nur diese Einstellungen. Die **Spülmenge** meldet die Firmware über diese Verbindung nach bisherigem Stand nicht; sie bleibt am Touchscreen (siehe [Farbwechsel und Abfall](#farbwechsel-und-abfall-kobra-s1)). Das Protokoll ist nicht von Anycubic dokumentiert, sondern nachvollzogen; ein Firmware-Update kann es ändern.

### Rinkhals/Moonraker

Mit **Verbindung: Rinkhals (Moonraker)** liest das Tool die Belegung über Moonraker (nur lesend). Das bringt eine Fremd-Firmware mit – nicht vom Hersteller, Installation und Nutzung auf eigene Verantwortung, Anleitung beim Projekt selbst:

- **Anycubic Kobra S1:** [Rinkhals](https://jbatonnet.github.io/Rinkhals/)
- **Snapmaker U1:** [Extended Firmware von paxx12](https://github.com/paxx12-snapmaker-u1/SnapmakerU1-Extended-Firmware)

Weiteres:

- Über Moonraker **liest** das Tool nur.
- **Automatisch** versucht zuerst den LAN-Modus, dann Moonraker.
- Ohne Verbindung trägst du die Belegung in den Filament-Slots selbst ein.

### Filament-Slots

Im Schritt **③ Slicen & Kosten** zeigt der Abschnitt **Filament-Slots** jeden Slot mit Farbe, Material und Herkunft (vom Drucker, überschrieben, eigene Angabe) – ist eine Verbindung eingerichtet, liest das Tool die ACE beim Öffnen einmal aus. Darunter stellst du unter **Farbwechsel & Spülmenge** die Spülmenge ein und siehst die Schätzung für das geladene Projekt.

Bearbeiten über **✎ Bearbeiten / überschreiben**, **⚙ Einstellungen → Filament-Slots …** oder **Slots bearbeiten** im Export-Dialog stellst du je Slot **Material und Farbe** ein.

- **Mit Drucker-Verbindung** zeigt jede Zeile, was die ACE meldet (mit RFID-Rollen automatisch richtig). Stimmt das nicht – z. B. Rolle ohne RFID-Chip, anderes Material als eingelesen –, hakst du **Überschreiben** an oder änderst einfach Material/Farbe (der Haken setzt sich dann selbst). Überschriebene Slots nehmen immer deine Angabe, auch nach dem nächsten Auslesen.
- **Ohne Verbindung** gilt, was du einträgst – bis du es änderst (z. B. nach einem Spulenwechsel).
- **Eigene Angaben löschen** nimmt alle Überschreibungen zurück.
- Mit der Werksfirmware kannst du überschriebene Slots zusätzlich **in die ACE schreiben**; danach meldet der Drucker sie selbst und die Überschreibung entfällt.

Die Slots bestimmen Filamenttyp und Farbe in der 3MF, die Vorauswahl im Export-Dialog und die Farben in der Vorschau („Farben zeigen“).

### Farbwechsel & Spülmenge einstellen

**⚙ Einstellungen → Farbwechsel & Spülmenge …** enthält dieselbe Einstellung wie der Export-Dialog: die **Spülmenge**, die am Drucker eingestellt ist. Zusätzlich kannst du **eigene Messwerte** eintragen – Abfall und Zeit je Farbwechsel, wenn dein Filament anders spült als die Referenzmessung. Selbst messen: Abfall nach einem mehrfarbigen Druck wiegen und durch die Zahl der Wechsel teilen. Die eigenen Werte gelten für die gewählte Spülmenge; wechselst du sie im Export-Dialog, verwirft das Tool sie.


### Kostenkalkulation

Im Schritt **③ Slicen & Kosten** unter **Kosten** steht der Preis des geladenen Projekts. Mit **automatisch neu berechnen** (Standard) rechnet das Tool nach jeder Änderung an Einstellungen oder Modell von selbst neu – kurz verzögert, damit mehrere Klicks nur einmal geslict werden; **Kosten berechnen** löst es von Hand aus. Das Tool baut dafür dieselbe 3MF wie beim Speichern und lässt sie auf dem Server **exakt mit OrcaSlicer slicen** – Verbrauch je Slot und Druckzeit kommen also aus Orca, nicht aus einer Schätzung. Das dauert je nach Modell Sekunden bis Minuten. Voraussetzung: das Tool läuft im Container (Orca ist dort enthalten) oder lokal mit installiertem OrcaSlicer.

| Posten | Rechnung |
|---|---|
| **Filament** je Slot | Gramm laut Orca × Preis des Filamenttyps in diesem Slot (inklusive Prime-Turm) |
| **Spülabfall** (Kobra S1) | Farbwechsel laut Orca × Abfall je Wechsel (aus „Farbwechsel & Spülmenge“) × mittlerer Filamentpreis |
| **Strom** | Leistung × Druckzeit × Strompreis |
| **Verschleiß** | Druckzeit × Satz je Stunde |
| **Aufschlag, MwSt.** | optional, z. B. wenn du für andere druckst |

Preise und Sätze stellst du unter **Preise & Sätze …** ein (auch **⚙ Einstellungen → Preise & Sätze …**): den **Preis je Filamenttyp** (PLA, PETG, ABS, ASA, TPU) und für alles andere, dazu Leistung, Strompreis, Verschleiß, Aufschlag und MwSt. Kostet ein einzelnes Filament mehr oder weniger als sein Typ, trägst du es unter „Abweichender Preis für einzelne Filamente“ ein. Slots ohne Filamentprofil – etwa Farben des Designers – rechnet das Tool mit dem Typ, den die ACE meldet. Änderst du dort etwas, rechnet das Tool sofort neu, ohne erneut zu slicen. Änderst du das Projekt (Filament, Slot, Lage …), steht beim Ergebnis **Veraltet** – dann neu berechnen.

Brauchen die Filamente zu unterschiedliche Temperaturen (z. B. PLA und ASA in einem Druck), slict Orca nicht; das Tool sagt das dann.

### Slice-Vorschau

Im Schritt **③ Slicen & Kosten** steht rechts die **Vorschau**: der geslicte G-Code als Schichtansicht – zum Prüfen, ohne OrcaSlicer zu öffnen. Sie lädt nach jedem Slicen neu.

- **Platte** wählen, mit dem **Schichtregler** (oder den Pfeiltasten ↑/↓) durch die Schichten gehen; **nur diese Schicht** zeigt eine einzelne.
- **Farben nach Linienart** (Außenwand, Füllung, Stützen, Reinigungsturm …) oder **nach Filament** – dann in den Farben deiner Slots (von der ACE gelesen). Sehr dunkles Filament erscheint grau, damit man es sieht.
- Einträge der Legende anklicken blendet sie aus und wieder ein.
- **G-Code herunterladen** speichert den G-Code der Platte – derselbe, den OrcaSlicer mit dieser 3MF erzeugt.

Die Vorschau zeigt nur Druckbahnen (keine Fahrwege). Das Tool hebt die letzten fünf Slice-Aufträge auf; ältere muss man neu berechnen.

---

### Drucker-Werkbank (Tab „Drucker“)

Mit der Werksfirmware im LAN-Modus steuerst du den Kobra S1 im Tab **Drucker** – das Tool muss über den Server laufen (Container oder `Konfigurator starten.cmd`). Ist noch keine Verbindung eingerichtet, fragt der Tab nach der IP-Adresse.

| Bereich | Was geht |
|---|---|
| **Druckauftrag** | Name, Fortschritt, Schicht, gedruckte und verbleibende Zeit; **Pausieren**, **Fortsetzen**, **Abbrechen** (mit Rückfrage). Der Reiter „Drucker“ zeigt den Fortschritt in Prozent. |
| **Kamera** | Live-Bild der Druckerkamera (**Kamera starten**). Braucht einen Browser mit MSE (Chrome, Edge, Firefox, Safari am Mac). |
| **Druckeinstellungen** | Zieltemperatur Düse und Bett (bis 300 / 110 °C), Vorheizen für PLA, PETG, ASA/ABS oder **Aus**, Bauteil-, Zusatz- und Gehäuselüfter, Licht. Die Druckgeschwindigkeit (Leise/Standard/Sport) wird angezeigt; ändern geht nur am Drucker. |
| **Achsen** | X/Y/Z um 1, 10 oder 50 mm fahren, **⌂ XY** und **⌂ Z** referenzieren, Motoren aus. **Während eines Drucks gesperrt.** Nicht referenzierte Achsen fährt der Drucker nicht. |
| **ACE-Verwaltung** | Slots mit Material, Farbe und RFID; **Laden**/**Zurück** je Slot (während eines Drucks gesperrt), **Automatisch nachfüllen**, **Trocknen** mit Temperatur und Dauer. |
| **Drucker** | Modell, Firmware, IP, Zustand, Verbindung; **Rohdaten** zum Nachsehen. |

Das Tool fragt den Stand alle paar Sekunden ab, solange der Tab offen ist; der Server hält dafür eine Verbindung zum Drucker und beendet sie nach 10 Minuten ohne Zugriff. Jeder Befehl wird auf dem Server geprüft (erlaubte Befehle, Wertebereiche, Sperren während des Drucks).

**Nicht dabei**, weil nicht belegt: Druckgeschwindigkeit ändern, Dateien auf dem Drucker verwalten.

Drucke, die über LAN gestartet wurden (auch aus Anycubics Slicer oder diesem Tool), haben die Auftragsnummer −1 – das ist normal, Pause und Abbruch senden sie so.

### Direkt drucken

Im Schritt **③ Slicen & Kosten** startet **Drucken …** (unter Ausgabe, oder **An Drucker senden …** in der Vorschau) den Druck einer Platte, ohne OrcaSlicer zu öffnen:

1. **Platte** wählen. Der Dialog fragt den Drucker ab: frei? Ist er beschäftigt, lässt er sich nicht starten.
2. Die Tabelle zeigt je Werkzeug im G-Code, aus welchem **ACE-Slot** gedruckt wird (Werkzeug T0 = Slot 1 usw.) und was dort steckt. Passt Material oder Slot nicht (leer, anderes Material), steht es rot da – die Temperaturen im G-Code gelten für das geslicte Material. Dann Filament tauschen oder neu slicen; „Trotzdem drucken“ geht auf eigene Verantwortung.
3. **Bett automatisch vermessen** (empfohlen), optional **Flusskalibrierung** und **Zeitraffer**.
4. **Jetzt drucken** lädt den G-Code auf den Drucker und startet ihn; danach wechselt das Tool in den Tab **Drucker**.

Gedruckt wird genau der Stand der letzten Kostenberechnung. Hast du danach etwas geändert, erscheint **Drucken …** erst nach einer neuen Berechnung. Der Server prüft vor dem Start noch einmal, dass der Drucker frei ist und der G-Code für dieses Modell geslict wurde. Vor dem ersten Druck: Bett frei, richtige Druckplatte?

## 9. 3MF für OrcaSlicer speichern

![Export-Dialog](docs/img/export.png)

Der Knopf **„3MF für OrcaSlicer speichern“** im Schritt **③ Slicen & Kosten** unter **Ausgabe** (oder **Datei → 3MF für OrcaSlicer …**) öffnet den Dialog:

1. **Belegung prüfen** – was steckt in welchem Slot? **Slots bearbeiten** öffnet die [Filament-Slots](#filament-slots) (auch über **⚙ Einstellungen → Filament-Slots …**). Mit Drucker-Verbindung holt **Vom Drucker laden** die Belegung aus der ACE.
2. **Slot wählen** – bei einem Teil der Slot, bei mehreren der Standard-Slot für Teile ohne eigenen Slot.
3. Bei mehreren Teilen zeigt die Tabelle **Teil · Slot · Filament · eigene Werte**. Passt das Filament eines Teils nicht zum Slot, hilft **„Filament … passend zur Belegung wählen“**.
4. **Was geändert wird** – alle Werte, die gegenüber deiner Orca-Vorlage geändert werden.
5. **3MF speichern** – die Datei landet in deinem Download-Ordner, z. B. `modell_KobraS1_Slot2.3mf`.
6. Die Datei in OrcaSlicer über **Datei → Projekt öffnen** laden (nicht „Importieren“) und dort slicen – bei Rückfrage „Projekt-Einstellungen übernehmen“ wählen.

In der Datei stehen: Druckerprofil aus der Vorlage, die berechneten Filament- und Prozesswerte (auch Lüfter in der ersten Schicht und Z-Hop je Filament sowie die Beschleunigung, wenn das Datenblatt eine vorgibt). Der **Rückzug** bleibt beim Orca-Standard: Er hängt von Filament, Temperatur und Extruder ab, und das Orca-Filamentprofil des Slots bringt passende Werte mit, die Stützen, je Teil der Slot und abweichende Werte als **Objekt-Einstellung**. Mehrere Teile werden nebeneinander aufs Bett gelegt; passt nicht alles, kommt eine weitere Platte dazu.

> Die **Schichthöhe** gilt in Orca für die ganze Platte. Empfiehlt das Tool für einzelne Teile eine andere, steht das als Hinweis im Dialog.

---

## 10. Makerworld-Projekte umstellen

Viele Makerworld-3MFs sind für Bambu-Drucker eingestellt. Lädst du so eine Datei, zeigt **① Modell** „Ursprünglich für: …“. Beim Export:

- **bleiben erhalten:** Geometrie, Lage, Platten, Farbzuweisung und Bemalung des Designers,
- **werden ersetzt:** alle Drucker-, Filament- und Prozesseinstellungen durch dein S1- bzw. U1-Profil mit den berechneten Werten,
- **jede Platte** wird auf die Bettmitte deines Druckers gerückt.

Ist eine Platte größer als dein Bett, erscheint ein Hinweis.

---

## 11. 3D-Ansicht (Schritt ① Modell)

![3D-Ansicht](docs/img/ansicht3d.png)

- Maus: **links ziehen** drehen, **rechts ziehen** verschieben, **Rad** zoomen.
- **Überhangwinkel** (unten): Flächen steiler als dieser Winkel werden rot markiert; grau = liegt auf dem Bett.
- **Wireframe**, **Achsen**, **Schnitt** (Schnittebene je Achse verschieben), **Messen** (zwei Punkte anklicken).
- **Fläche aufs Bett**, **↻ X**, **↻ Y** – wie in der Spalte daneben unter „Lage auf dem Bett“.

---

## 12. Grenzen und bekannte Einschränkungen

- Getestet sind die Werte am **Kobra S1** mit PLA High Speed und TPU. Die **U1-Werte** sind übernommen und noch nicht am U1 gegengetestet – vorsichtig beginnen.
- 3MF-Export nur mit **0,4-mm-Düse** (dafür gibt es die Orca-Vorlagen).
- Bohrlöcher werden nur erkannt, wenn sie rund sind und entlang einer Achse des Teils verlaufen (bis etwa 3° Neigung). Schräge Löcher, Sechskant-Aussparungen für Muttern und Senkungen erscheinen nicht in der Liste.
- Die Überhang-Erkennung ist eine Geometrie-Näherung. Bei beschädigten Netzen (verdrehte Flächen) kann ein Überhang übersehen werden.

---

## 13. Probleme lösen

| Problem | Lösung |
|---|---|
| Fehlermeldung beim Laden nach einem Update, z. B. „… is not defined“ | Der Browser hat alte Dateien gespeichert. Einmal **Strg + F5** drücken. |
| „Drucker antwortet nicht“ | IP prüfen (⚙ Einstellungen → Drucker-Verbindung → Testen), Drucker eingeschaltet und im selben Netz? Das Tool muss über `Konfigurator starten.cmd` laufen. Der Kobra S1 antwortet manchmal langsam – **Vom Drucker laden** erneut klicken. |
| „Python wurde nicht gefunden“ | Python installieren (beim Setup „Add python.exe to PATH“ anhaken) oder `index.html` direkt öffnen. |
| Menüpunkt „3MF für OrcaSlicer“ ist grau | Zuerst ein Modell laden und die 0,4-mm-Düse wählen. |
| Werte in Orca weichen ab | Die 3MF über **Datei → Projekt öffnen** laden (nicht als Modell importieren – dann übernimmt Orca nur die Geometrie). |
| Eigene Filamentwerte sind weg | Werte hängen am Browser und an der Startart (Doppelklick vs. `Konfigurator starten.cmd`). Über **Profile exportieren/importieren** übertragen. |

---

*Druck-Konfigurator · Lizenz: CC BY-NC 4.0 (nur nicht-kommerziell) · Änderungen siehe [CHANGELOG.md](CHANGELOG.md)*
