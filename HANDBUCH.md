# Druck-Konfigurator – Handbuch

Der Druck-Konfigurator berechnet passende Startwerte für den **Anycubic Kobra S1 (Combo)** und den **Snapmaker U1** und schreibt sie direkt in eine Projektdatei für **OrcaSlicer**. Du lädst ein Modell, das Tool prüft Maße und Überhänge, schlägt die beste Lage auf dem Bett vor und liefert eine 3MF-Datei, die in Orca sofort mit den richtigen Werten öffnet.

Alles läuft lokal in deinem Browser. Es werden keine Modelle oder Daten ins Internet geschickt.

> **Hinweis:** Alle Werte sind Startwerte ohne Gewähr. Filamente unterscheiden sich je nach Hersteller und Charge – die Angaben auf der Rolle haben Vorrang. Die Slicer-Vorschau immer prüfen.

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
11. [3D-Ansicht](#11-3d-ansicht)
12. [Grenzen und bekannte Einschränkungen](#12-grenzen-und-bekannte-einschränkungen)
13. [Probleme lösen](#13-probleme-lösen)

---

## 1. Installation und Start

**Voraussetzungen:** Windows mit einem aktuellen Browser (Chrome, Edge oder Firefox) und OrcaSlicer. Für die Live-Abfrage der Filament-Belegung zusätzlich [Python](https://www.python.org) (Version 3.8 oder neuer).

1. Das Projekt als ZIP herunterladen (auf GitHub: **Code → Download ZIP**) und in einen Ordner entpacken, z. B. `C:\Druck-Konfigurator`.
2. Starten – zwei Möglichkeiten:
   - **Empfohlen:** Doppelklick auf **`Konfigurator starten.cmd`**. Es öffnet sich ein schwarzes Fenster (lokaler Webserver) und der Browser mit dem Tool. Das Fenster offen lassen, solange du das Tool benutzt. Der Server ist nur auf deinem PC erreichbar.
   - **Ohne Python:** Doppelklick auf **`index.html`**. Alles funktioniert, nur die Live-Abfrage der Filament-Belegung vom Drucker nicht (der Browser blockiert sie bei direkt geöffneten Dateien).

> Deine eigenen Filamentwerte speichert der Browser getrennt je Startart. Bleib deshalb bei einer Startart – oder übertrage die Werte über **Profile → Profile exportieren/importieren**.

---

## 2. Die Oberfläche

![Übersicht](docs/img/uebersicht.png)

- **Kopfzeile:** Drucker umschalten (**Kobra S1** / **U1**), Düsengröße und Düsenmaterial.
- **Menüs:**
  - **Datei** – Modell öffnen, Modell entfernen
  - **Profile** – Filamentwerte anpassen, neues Filament, eigene Profile, Import/Export, Düsen-Umrechnung, Drucker-Verbindung
  - **Export** – 3MF für OrcaSlicer, Filament-/Process-JSON, Drucken/PDF, als Text kopieren
  - **?** – Kurzhilfe
- **Registerkarten:** **Einstellungen** (Auswahl und Datenblatt) und **3D-Ansicht**.
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

Bei mehreren Teilen erscheint in der Modellkarte eine **Teileliste**. Jede Zeile zeigt Name, Maße, Slot und ob das Teil Stützen braucht.

- **Anklicken wählt ein Teil.** Das Formular links, das Datenblatt und die 3D-Ansicht gelten dann für dieses Teil – oben im Formular steht **„Einstellungen für Teil“** mit dem Namen.
- Jedes Teil merkt sich **eigenes Filament, Objektart, Priorität, Belastung, Support und Stützreduzierung**.
- Über **Slot** kannst du jedem Teil einen eigenen Filament-Slot geben. „Wie beim Export gewählt“ bedeutet: Das Teil bekommt den Standard-Slot aus dem Export-Dialog.

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

Bei 3MF-Projekten bleibt die Lage des Designers erhalten; Drehen ist dort gesperrt.

---

## 6. Einstellungen und Datenblatt

Links wählst du **Filament, Objektart, Priorität, Belastung, Support** und **Stützreduzierung**. Rechts steht das **Datenblatt** mit den wichtigsten Werten (Temperaturen, Schichthöhe, Geschwindigkeiten, Wände, Füllung, Stützen, Brim) und aufklappbar:

- **Einstellungen in Slicer-Reihenfolge** – alle Werte in der Reihenfolge der Slicer-Registerkarten
- **Stützparameter** – alle Stützwerte (Abstände, Schnittstelle, Baum-Parameter)
- **Hinweise** – Warnungen, z. B. zu Material und Düse
- **OrcaSlicer-Import (JSON)** – Alternative zum 3MF-Export

**Stützen:** Das Tool empfiehlt Baumstützen, wenn das Teil relevante Überhänge hat. Der Abstand zwischen Stütze und Teil entspricht einer Schichthöhe (PETG 0,05 mm mehr, weil es stärker haftet) – so halten die Stützen sicher und lassen sich trotzdem lösen.

**Düsen-Umrechnung:** Für 0,25/0,6/0,8 mm und andere Düsenmaterialien rechnet das Tool die Werte um. Der 3MF-Export ist derzeit nur mit der **0,4-mm-Düse** möglich.

---

## 7. Eigene Filamentwerte und Profile

- **Werte anpassen** (unter der Filament-Auswahl oder im Menü **Profile**): eigene Temperatur, Geschwindigkeit, Lüfter usw. speichern. Alle Empfehlungen rechnen danach mit deinen Werten.
- **Neues Filament:** zusätzliches Profil, z. B. für eine bestimmte Marke.
- **Profile exportieren/importieren:** eigene Werte als Datei sichern oder auf einen anderen PC übertragen.

---

## 8. Drucker-Verbindung (Filament-Belegung live)

Unter **Profile → Drucker-Verbindung** trägst du die IP-Adressen deiner Drucker im Heimnetz ein und testest die Verbindung. Das Tool fragt dann beim Export die **tatsächliche Filament-Belegung** (Typ und Farbe je Slot) ab.

- Voraussetzung: Der Drucker läuft mit **Moonraker/Klipper** (Kobra S1 mit Rinkhals, Snapmaker U1) und das Tool wurde über `Konfigurator starten.cmd` gestartet.
- Das Tool **liest nur** – es sendet keine Befehle an den Drucker.
- Antwortet der Drucker nicht, wird die Belegung aus deiner Orca-Vorlage verwendet.

---

## 9. 3MF für OrcaSlicer speichern

![Export-Dialog](docs/img/export.png)

**Export → 3MF für OrcaSlicer …** öffnet den Dialog:

1. **Slot wählen** – bei einem Teil der Slot, bei mehreren der Standard-Slot für Teile ohne eigenen Slot. **Vom Drucker laden** holt die aktuelle Belegung.
2. Bei mehreren Teilen zeigt die Tabelle **Teil · Slot · Filament · eigene Werte**. Passt das Filament eines Teils nicht zum Slot, hilft **„Filament … passend zur Belegung wählen“**.
3. **Was geändert wird** – alle Werte, die gegenüber deiner Orca-Vorlage geändert werden.
4. **3MF speichern** – die Datei landet in deinem Download-Ordner, z. B. `modell_KobraS1_Slot2.3mf`.

In der Datei stehen: Druckerprofil aus der Vorlage, die berechneten Filament- und Prozesswerte, die Stützen, je Teil der Slot und abweichende Werte als **Objekt-Einstellung**. Mehrere Teile werden nebeneinander aufs Bett gelegt; passt nicht alles, kommt eine weitere Platte dazu.

> Die **Schichthöhe** gilt in Orca für die ganze Platte. Empfiehlt das Tool für einzelne Teile eine andere, steht das als Hinweis im Dialog.

---

## 10. Makerworld-Projekte umstellen

Viele Makerworld-3MFs sind für Bambu-Drucker eingestellt. Lädst du so eine Datei, zeigt die Modellkarte „Ursprünglich für: …“. Beim Export:

- **bleiben erhalten:** Geometrie, Lage, Platten, Farbzuweisung und Bemalung des Designers,
- **werden ersetzt:** alle Drucker-, Filament- und Prozesseinstellungen durch dein S1- bzw. U1-Profil mit den berechneten Werten,
- **jede Platte** wird auf die Bettmitte deines Druckers gerückt.

Ist eine Platte größer als dein Bett, erscheint ein Hinweis.

---

## 11. 3D-Ansicht

![3D-Ansicht](docs/img/ansicht3d.png)

- Maus: **links ziehen** drehen, **rechts ziehen** verschieben, **Rad** zoomen.
- **Überhangwinkel** (unten): Flächen steiler als dieser Winkel werden rot markiert; grau = liegt auf dem Bett.
- **Wireframe**, **Achsen**, **Schnitt** (Schnittebene je Achse verschieben), **Messen** (zwei Punkte anklicken).
- **Fläche aufs Bett**, **↻ X**, **↻ Y** – wie in der Modellkarte.

---

## 12. Grenzen und bekannte Einschränkungen

- Getestet sind die Werte am **Kobra S1** mit PLA High Speed und TPU. Die **U1-Werte** sind übernommen und noch nicht am U1 gegengetestet – vorsichtig beginnen.
- 3MF-Export nur mit **0,4-mm-Düse** (dafür gibt es die Orca-Vorlagen).
- Die Überhang-Erkennung ist eine Geometrie-Näherung. Bei beschädigten Netzen (verdrehte Flächen) kann ein Überhang übersehen werden.
- Die Beschriftung „Slicer-Reihenfolge“ nennt beim S1 derzeit „Anycubic Slicer Next“; die Werte gelten genauso in OrcaSlicer.

---

## 13. Probleme lösen

| Problem | Lösung |
|---|---|
| Fehlermeldung beim Laden nach einem Update, z. B. „… is not defined“ | Der Browser hat alte Dateien gespeichert. Einmal **Strg + F5** drücken. |
| „Drucker antwortet nicht“ | IP prüfen (Profile → Drucker-Verbindung → Testen), Drucker eingeschaltet und im selben Netz? Das Tool muss über `Konfigurator starten.cmd` laufen. Der Kobra S1 antwortet manchmal langsam – **Vom Drucker laden** erneut klicken. |
| „Python wurde nicht gefunden“ | Python installieren (beim Setup „Add python.exe to PATH“ anhaken) oder `index.html` direkt öffnen. |
| Menüpunkt „3MF für OrcaSlicer“ ist grau | Zuerst ein Modell laden und die 0,4-mm-Düse wählen. |
| Werte in Orca weichen ab | Die 3MF über **Datei → Projekt öffnen** laden (nicht als Modell importieren – dann übernimmt Orca nur die Geometrie). |
| Eigene Filamentwerte sind weg | Werte hängen am Browser und an der Startart (Doppelklick vs. `Konfigurator starten.cmd`). Über **Profile exportieren/importieren** übertragen. |

---

*Druck-Konfigurator · Lizenz: CC BY-NC 4.0 (nur nicht-kommerziell) · Änderungen siehe [CHANGELOG.md](CHANGELOG.md)*
