# Änderungen

Alle nennenswerten Änderungen am Druck-Konfigurator. Versionen folgen [SemVer](https://semver.org/lang/de/): Hauptversion bei grundlegenden Änderungen, Nebenversion bei neuen Funktionen, Patch bei Fehlerbehebungen.

## [10.36.6] – 2026-10-08

### Behoben
- **3D-Fortschritt, Z-Spindeln durch die Muttern:** Zu Druckbeginn (Bett ganz oben) endete die Spindel unter der Messingmutter. Jetzt stehen die Spindeln außerhalb des Kopfwegs und reichen bis über die Düsenspitze – in jeder Höhe laufen sie durch die Mutter (geprüft bei 0,2 / 100 / 240 mm), ohne den Kopf zu berühren.

## [10.36.5] – 2026-10-08

### Behoben
- **3D-Fortschritt, Riemenlauf:** Der Riemen liegt außen an den Rollen an statt durch ihre Mitte zu laufen – jede Rolle sitzt so, dass beide Riemenstücke sie tangential berühren (geprüft: Abstand Mitte–Riemen = Radius); die Umkehr vorn ist eine Rolle mit Durchmesser = Strangabstand, am Motor läuft der Riemen außen ums Ritzel.
- **3D-Fortschritt, Eckwagen:** Das schwarze Gehäuse umfasst die Enden beider X-Stangen.

## [10.36.4] – 2026-10-08

### Verbessert
- **3D-Fortschritt, Riemenrollen:** Umlenkrollen mit Bordscheiben, Lauffläche, Lagerscheibe (drei Löcher – Drehung sichtbar), Achse und Sechskantkopf; Motorritzel als GT2-Zahnscheibe (20 Zähne) mit Bordscheibe und Nabe mit Madenschraube.
- **3D-Fortschritt, Eckwagen an den Y-Schienen:** offene schwarze Gehäuse mit Führung um die Y-Stange, Boden- und Deckplatte und Außenwand – die beweglichen Umlenkrollen sitzen darin (nach Foto des Kobra S1).

## [10.36.3] – 2026-10-08

### Verbessert
- **3D-Fortschritt, Z-Spindeln:** sind echte Trapezgewindespindeln (Tr8: Kern mit vier erhabenen Gängen als Schraubenlinie) und drehen sich mit der Höhe – 8 mm Hub je Umdrehung –, dabei laufen sie sichtbar durch die Messingmutter am Bett.

## [10.36.2] – 2026-10-08

### Behoben
- **3D-Fortschritt, Kollisionen mit dem Druckkopf:** Die Z-Spindeln enden knapp unter der Düse (höher fährt das Bett nicht) statt bis zur Traverse zu reichen; die seitlichen Riemenstränge und die Motoren liegen außerhalb des Kopfwegs (≥ 5 mm Abstand, auch in den Ecken).
- **3D-Fortschritt, Seitenlüfter:** Die flache Düse sitzt etwa auf Höhe der Druckkopf-Düse.

## [10.36.1] – 2026-10-08

### Behoben
- **Home Assistant, Licht:** zeigt „An“/„Aus“ statt „Licht erkannt“ (ohne Geräteklasse Lichtsensor).

## [10.36.0] – 2026-10-08

### Neu
- **Mehr Werte in Home Assistant:** Ziel-Temperaturen von Düse und Bett, Bauteil-, Hilfs- und Gehäuselüfter (%), Druckgeschwindigkeit (Leise/Standard/Sport), Druckdauer bisher, Filament dieses Drucks (m), Licht (an/aus) und je ACE-Einheit Temperatur und Trocknen – dieselben Werte wie in der Werkbank.

## [10.35.2] – 2026-10-08

### Verbessert
- **3D-Fortschritt, Ansaugung des Seitenlüfters:** Luft aus dem Bauraum strömt als Kegel auf das Lüfterrad zu (Stärke nach der Leistung des Seitenlüfters), oben tritt sie als flacher Fächer aus der Düse.

## [10.35.1] – 2026-10-08

### Verbessert
- **3D-Fortschritt, Seitenlüfter:** Gehäuse mit Lüfterrad sitzt tiefer an der rechten Wand, ein Kanal führt hoch zur flachen Düse, die auf Höhe des Druckkopfs bleibt.

## [10.35.0] – 2026-10-08

### Neu
- **Warum pausiert der Druck?** Die Werkbank zeigt den Grund unter „pausiert“, Home Assistant als Sensor **Pausengrund**. Die Werksfirmware meldet nur pause 0/1; ermittelt wird: Pause aus der Druckwerkstatt (Werkbank/Home Assistant, eigener Befehl ≤ 90 s vorher) → Fehlercode/Text der Druck-Meldung → ACE ohne geladenen Slot („kein Filament im Drucker“) → „am Drucker pausiert – Grund nicht gemeldet“. Druck-Meldungen werden bei jedem Zustandswechsel vollständig mitgeschrieben (Rohdaten `print_log`), um die Erkennung an echten Pausen zu verbessern.
- **Benachrichtigung bei Pause und fertiger Platte:** Home-Assistant-Ereignis **Druck-Ereignis** (pausiert mit Grund, fortgesetzt, fertig, abgebrochen; vom Server, auch ohne offene Seite) – Beispiel-Automation fürs Handy im Handbuch. Die offene Seite meldet dasselbe als Browser-Benachrichtigung (Erlaubnis wird beim ersten Drucken erfragt).

## [10.34.4] – 2026-10-08

### Behoben
- **3D-Fortschritt, Schleppkette und Filamentschlauch:** Die Kette liegt als waagerechter Bogen knapp über dem Kopf – vom Rahmen hinten links nach links, links herum nach vorn zum Kopf; der Schlauch hängt in festem Abstand außen links an der Kette (vorher kreuzten sich Kette und Schlauch teilweise), löst sich erst am Kopf und das Filament läuft weiter bis zur Düse.

## [10.34.2] – 2026-10-08

### Verbessert
- **3D-Fortschritt, Gehäuselüfter erkennbar:** Rahmen mit Lüfterrad hinter einem dünnen Gitter in der Rückwand, das Rad dreht nach der gemeldeten Leistung. Die Abluft läuft innen als Kegel auf den Lüfter zu (angesaugt) und tritt hinter der Wand als schmaler Strahl aus.

## [10.34.1] – 2026-10-08

### Verbessert
- **3D-Fortschritt, Gehäuselüfter:** Der Luftstrom geht sichtbar durchs Gitter nach draußen (reicht etwa 6 cm hinter die Rückwand) statt am Gitter zu enden.

## [10.34.0] – 2026-10-08

### Neu
- **3D-Fortschritt, Lüfter mit Luftstrom:** großer Seitenlüfter rechts an der Wand mit flacher, waagerechter Düse oben auf Höhe des Druckkopfs – immer über dem Bett, flacher Luftfächer über die aktuelle Schicht, Gitter des Gehäuselüfters in der Rückwand, Bauteillüfter vorn am Kopf mit Luftstrom zur Düse, kleiner Hotend-Lüfter links am Kopf. Luftstrom (Dichte, Tempo) und Drehzahl der Lüfterräder richten sich nach den gemeldeten Werten (Bauteil-, Hilfs- und Gehäuselüfter in %); bei 0 % steht der Lüfter, kein Luftstrom. Der Hotend-Lüfter dreht beim Drucken immer.

### Verbessert
- **3D-Fortschritt nach Fotos des Kobra S1:** zwei X-Stangen (oben knapp unter der Kopfoberkante, unten auf halber Höhe), beide Riemen übereinander dazwischen in derselben Ebene, Y-Stangen auf Höhe der oberen X-Stange, Bauteillüfter im oberen Drittel der Front; Stangen und Riemen im hinteren Viertel des Kopfes (der Kopf ragt nach vorn), kleiner Hotend-Lüfter vorn unten an der linken Kopfseite.

## [10.33.3] – 2026-10-08

### Behoben
- **3D-Fortschritt, Z-Spindeln am Druckbett:** Die drei Spindeln (hinten mittig, vorn links und rechts) stehen jetzt direkt am Bett; Halter mit Messing-Spindelmutter verbinden das Bett mit jeder Spindel und bleiben beim Bett (vorher standen die Spindeln frei im Rahmen, ohne Verbindung zum Bett).

## [10.33.2] – 2026-10-08

### Behoben
- **3D-Fortschritt, Filament bis zur Düse:** Der Schlauch endet oben mittig im Kopf, das Filament läuft von dort senkrecht weiter bis zur Düsenspitze (vorher endete es am Schlauch).

## [10.33.1] – 2026-10-08

### Behoben
- **3D-Fortschritt, Druckkopf:** 100 statt 70 mm hoch – die Riemen enden jetzt im Kopf statt darüber frei in der Luft. Der orange Ring ist undurchsichtig und steht 2 mm über das Gehäuse; durchscheinend verschwand er von der Seite hinter dem Gehäuse und war nur von unten richtig zu sehen.

## [10.33.0] – 2026-10-08

### Verbessert
- **3D-Fortschritt, gedruckte Bahnen in Filamentfarbe:** Was der Kopf in der aktuellen Schicht schon gedruckt hat, erscheint sofort in der Farbe des Filaments (vorher Petrol); noch nicht gedruckt bleibt blass.
- **3D-Fortschritt, Riemen physikalisch richtig:** Die Zähne sitzen jetzt fest auf dem Riemen, gerechnet ab der Klemme am Kopf – fährt der Kopf, wandern sie auf jedem Abschnitt richtig (vorher rutschten sie auf stehenden Abschnitten, wenn sich ein Eckwagen bewegte); Rollen und Motorscheiben drehen um den Weg, der über sie gelaufen ist.
- **3D-Fortschritt, Proportionen wie beim Kobra S1:** Gehäuse ≈ Bauraum + 150 × 160 mm (S1: 400 × 410), Höhe Bauraum + 180, 20er-Profile, Stangen Ø 8 mm, NEMA-17-Motoren 42 × 42 × 40 mm in den hinteren Ecken, Riemen über den X-Stangen, Z-Spindeln am Rahmen.

## [10.32.1] – 2026-10-08

### Behoben
- **3D-Fortschritt, Motoren:** Beide Motorscheiben saßen auf derselben Höhe, die Riemen laufen aber auf zwei Ebenen – es sah aus, als triebe ein Motor beide. Jetzt sitzt jeder Motor mit Scheibe auf der Höhe seines Riemens (wie im Kobra S1: rechts oben, links unten), die Scheiben drehen mit ihrem Riemen.

## [10.32.0] – 2026-10-08

### Neu
- **3D-Fortschritt: Riemen, Schleppkette und Filament:** Kobra S1/S1 Max mit den zwei CoreXY-Riemen übereinander (Motoren hinten, Umlenkrollen vorn und an den Eckwagen, beide Enden am Kopf) – die Zähne laufen mit, Riemen A mit x + y, B mit x − y, die Rollen drehen sich. Bettschubser mit X-Riemen an der Traverse und Y-Riemen unter dem Bett. Dazu eine Schleppkette vom Rahmen zum Kopf und daneben der PTFE-Schlauch mit dem Filament in der Farbe der gerade gedruckten Bahn.

### Geändert
- **Veröffentlichen nur nach grünen Tests:** Das Container-Image baut erst, wenn die Tests auf GitHub (Node, Python, OrcaSlicer, Browser) für den Stand auf main grün sind; danach legt derselbe Workflow das GitHub-Release an (vorher eigener Workflow release.yml).

## [10.31.1] – 2026-10-08

### Neu
- **GitHub-Releases:** Nach jedem fertig gebauten Container-Image legt die Action „Release“ die Version aus CHANGELOG.md als Tag und Release an (Text = Abschnitt dieser Version).

### Geändert
- **Höchstwerte ohne eigene Zeile:** „Maximum dieses Druckers“ im Reiter Tempo entfällt (samt eigenen Höchstwerten und Hotend-Maximum) – es gilt die Herstellerangabe. Gibt man in einem Tempo- oder Beschleunigungsfeld mehr ein, wird auf den Höchstwert gesetzt und am Feld steht „Höchstwert laut Hersteller: … – darauf zurückgesetzt“ (Tooltip zeigt den Höchstwert); früher gespeicherte eigene Höchstwerte werden nicht mehr verwendet.

## [10.31.0] – 2026-10-08

### Verbessert
- **Brim beim Anordnen:** Der Abstand zwischen Teilen zählt ab dem Brim (Brim außen je Teil), der Brim bleibt auf dem Bett – vorher konnten die Brims ineinander gedruckter Teile zusammenwachsen. Gilt für das Rechteck-Verfahren und das Anordnen nach Grundfläche, in der Vorschau wie im Export.
- **Anordnen im Hintergrund:** Das Anordnen nach Grundfläche rechnet in einem Web Worker (js/nest-worker.js) – die Seite bleibt bedienbar, über den Platten steht „ordne platzsparend an …“; bis dahin gilt die Rechteck-Anordnung, Slicen und 3MF-Export warten auf das Ergebnis. Die Plattensignatur für das Teil-Slicen enthält jetzt die Lage der Teile.
- **Schräg anordnen (45°-Schritte):** Spart es eine Platte, werden Teile auch um 45/135/225/315° gedreht; Teile, die nur diagonal aufs Bett passen (z. B. 300-mm-Leiste auf 250 × 250), sind nicht mehr „zu groß“. 3MF-Matrix für beliebige Winkel, per Orca geprüft.
- **Warteschlange und neue Anordnung:** Braucht dasselbe Projekt jetzt weniger Platten, sagt es die Werkbank („2 statt 4 Platten“) und bietet – solange nichts gedruckt ist – „Warteschlange neu anlegen“ an.
- **Keine Browser-Popups bei Eingabefehlern:** Werte-Tafel, Kosten, Spülabfall, Filament-Editor und Düsen-Umrechnung zeigen den Fehler am Formular und markieren die Felder; Import-Fehler als Meldung.

### Neu
- **Hotend-Maximum (Volumenstrom) je Drucker:** dritter Wert in „Maximum dieses Druckers“ (eigener Wert – die Orca-Profile kennen kein Hotend-Maximum); der Volumenstrom geht nie darüber.

## [10.30.0] – 2026-10-08

### Neu
- **Höchstwerte je Drucker:** Höchstgeschwindigkeit und Druckbeschleunigung aus dem Orca-Maschinenprofil (machine_max_speed_x/y, machine_max_acceleration_extruding; normaler Modus) – Kobra S1 600 mm/s / 20 000 mm/s², Snapmaker U1 500 mm/s / 20 000 mm/s², alle Orca-Drucker aus ihrem Profil. Kein Tempo-Wert (Wände, Füllung, obere Fläche, Lückenfüllung, erste Schicht, Travel, Brücken) und keine Beschleunigung geht darüber – weder Vorschlag noch Anpassung noch eigener Standard; Eingaben darüber werden auf das Maximum gesetzt, das Datenblatt sagt es. Eigene Höchstwerte je Drucker oben im Reiter Tempo („Maximum dieses Druckers“).

## [10.29.0] – 2026-10-08

### Verbessert
- **Anordnen nach echter Grundfläche:** Dünne Rahmen, Winkel und Dreiecke bekamen je eine eigene Platte, weil nur mit dem umschließenden Rechteck gerechnet wurde (Rack-Teile belegen 18–28 % davon). Neu (js/nest.js): Grundfläche als 1-mm-Raster, Drehung 0/90/180/270°, Abstand zwischen den Umrissen, „unten links zuerst“ mit Vorausschau, welche Drehung des ersten Teils einer Platte am meisten Platz lässt. Wird genommen, wenn es Platten spart (z. B. RackV2: 5 statt 9 Platten, 4 XRiser + Backbar: 2 statt 5). Die Draufsicht zeigt die Umrisse. Nicht bei „Objekt für Objekt“.

## [10.28.0] – 2026-10-08

### Behoben
- **„Nicht gestartet: Slice-Auftrag nicht (mehr) vorhanden“:** Slice-Aufträge lagen im temporären Ordner – nach einem Neustart oder Update des Add-ons war der Stand der offenen Seite weg. Jetzt liegen sie mit DATA_DIR (Container, Home-Assistant-Add-on) im Datenordner (`slice-jobs`) und überstehen Neustarts; fehlt ein Auftrag trotzdem, slict die Seite einmal neu und startet dann gleich.

### Neu
- **Weitere Anycubic-Drucker mit LAN-Modus (experimentell):** Kobra S1 Max, Kobra 3 (Combo/V2), Kobra 3 Max und Kobra X – unter „Anderer Anycubic …“ (Abzeichen „LAN · experimentell“) gelten Drucken, Werkbank, ACE/Spülabfall, Spulen, Warteschlange, geplanter Druck und 3D-Fortschritt wie beim Kobra S1, über dieselbe Drucker-Verbindung. Modelltabelle (js/anycubic-models.js) mit Bauraum, Bauart, Lüftern und ACE-Anzahl aus den Orca-Profilen: S1 Max mit S1-Vorgaben für Hilfs-/Gehäuselüfter, Kobra 3/3 Max/X ohne. Senden-Dialog sperrt, wenn der Druck für ein anderes Modell geslict ist als das verbundene; Werkbank und Senden zeigen „experimentell“.
- **3D-Fortschritt je Bauart:** Bettschubser (Kobra 3, 3 Max, X) mit Z-Türmen, X-Achse und Y-Schienen unter dem Bett – die X-Achse fährt in Z, das Bett mit dem Teil in Y; CoreXY (S1, S1 Max) wie bisher; Bauraum je Modell.

## [10.27.3] – 2026-10-08

### Behoben
- **Warteschlange anlegen dauerte lange ohne Rückmeldung:** Der Server baute beim Anlegen für jede Platte die Vorschau und kopierte alle G-Codes (7 Platten × ~18 MB). Jetzt antwortet er sofort und sichert die Platten im Hintergrund – verknüpft statt kopiert, Vorschauen erst bei Bedarf. Der Knopf zeigt „Warteschlange wird angelegt …“.
- **Weitere Orca-Einstellungen wirkten nicht im Objekt:** Setzte man einen Wert, den das Tool auch selbst berechnet (z. B. Stützen-Typ, kleine Überhänge), blieb in den Objekt-Einstellungen der berechnete stehen – und der hat in Orca Vorrang. Jetzt gilt der zuletzt gesetzte Wert.

### Geändert
- 3D-Fortschritt: Druckkopf leicht durchsichtig, damit die Druckstelle zu sehen bleibt.
- **„Änderungen für alle Teile des Projekts“ standardmäßig an** (Wahl bleibt gespeichert) – vorher galten Werte nur für das gewählte Teil, andere Teile bekamen z. B. keine Stützen.
- Werte-Tafel, Reiter Stützen: „Stützen ab Überhang“ heißt jetzt **„Stützen bis Neigung (zur Waagerechten, höher = mehr)“** – Orca stützt Flächen, die flacher sind als der Winkel; 1° stützte fast nichts. Neu: **„Kleine Überhänge weglassen“** (Orca `support_remove_small_overhang`, Vorschlag ja) zum Abschalten, wenn kleine Ecken gestützt werden sollen.

## [10.27.2] – 2026-10-08

### Behoben
- **Keine Stützen an schrägen Überhängen, auch wenn sie ausdrücklich gewählt waren:** Der Vorschlag „Nur kritische Bereiche“ war an – damit stützt Orca nur Spitzen und Auskragungen; eine 55°-Schräge (über dem Grenzwinkel 45°) bekam keine einzige Stütze, mit „aus“ 98 Stützbahnen (Orca-CLI). Vorschlag jetzt **aus**; zum Sparen je Auftrag in der Werte-Tafel (Reiter Stützen) einschaltbar.

## [10.27.1] – 2026-10-08

### Behoben
- 3D-Fortschritt: Stangen silbern statt Kupfer, die beiden X-Stangen am Kopf übereinander statt hintereinander (wie am Kobra S1); drei Z-Spindeln – hinten in der Mitte, vorne links und vorne rechts.

## [10.27.0] – 2026-10-07

### Geändert
- **3D-Fortschritt wie der Kobra S1:** weißer Druckkopf mit orangem Streifen (nur die Außenhaut) und schwarzem Lüfter, zwei X-Stangen und die Y-Stangen in Kupfer, schwarze Eckwagen, blaue Motoren an den hinteren Ecken, schlanker rauchiger Rahmen mit Z-Spindeln, schwarze PEI-Platte; Rahmen und Mechanik bewegen sich gemeinsam (relativ dazu fährt das Bett). Standardansicht etwas weiter weg (mindestens ~230 mm).

## [10.26.0] – 2026-10-07

### Geändert
- **Neuer Name: Druckwerkstatt** (englisch: Print Workshop) – der Name ist mit dem Tool gewachsen. Geändert ist der angezeigte Name (Fenstertitel, Kopfzeile, Anmeldeseite, Handbuch, README, in Home Assistant Add-on-Name und Seitenleiste); Repository, Container-Image, Add-on-Kennung und das MQTT-Gerät in Home Assistant bleiben, damit Daten, Entitäten und Dashboards erhalten bleiben.
- 3D-Fortschritt: Traverse, Laufwagen und Schienen deckend und richtig verbunden (die Stangen sitzen in den Laufwagen unter der Traverse) – vorher lagen sie je nach Blickwinkel scheinbar davor oder dahinter.
- Handbuch, README und Handbuch-PDF auf den aktuellen Stand (Werte-Tafel, Brim außen/innen, 3D-Fortschritt, „Neue Spule eingelegt“, Warteschlange); alle Bilder neu aufgenommen. Der Bildgenerator stellt die Spulen jetzt immer nach (nie aus dem echten Datenordner).
- 3D-Fortschritt: Petrol-Streifen am Druckkopf entfernt – er lag als Platte quer durch den Kopf und verdeckte das Teil.
- 3D-Fortschritt: Bildausschnitt mindestens ~170 mm, damit der Druckkopf bei kleinen Teilen nicht das Bild füllt.

## [10.25.0] – 2026-10-07

### Geändert
- **3D-Fortschritt: Druckkopf und Mechanik neu gestaltet** – abgerundetes, durchscheinendes Graphit-Gehäuse mit Petrol-Streifen, Lüfterring, Alu-Heizblock und Messingdüse; X-Traverse als Alu-Profil mit Nut und Laufwagen, Y-Schienen als Stahlstangen (statt Glaskästen).
- Fortschrittsbalken des Drucks (und Fortschrittsbild für Home Assistant, Mal-Werkzeug) in Petrol statt Orange.

### Neu
- **„Neue Spule eingelegt“** (Spulen-Dialog, Restmenge auf der ACE-Kachel anklicken): Die ACE meldet für eine neue Spule gleicher Sorte und Farbe dieselben Werte – bisher zählte das Tool die alte weiter. Der Knopf archiviert die alte Spule und legt im Slot eine frische an (Füllgewicht, Marke, Preis übernommen; Füllgewicht wird wie bei jeder neuen Spule abgefragt).
- **Druckwerte neu: Reiter + Tabelle, direkt bearbeitbar.** Oben die Kennzahlen, darunter die Werte-Tafel mit Reitern nach Thema (mit Zähler) und Suche; je Reiter eine Tabelle **Einstellung | Wert | Vorschlag**. Wert direkt ändern – gilt beim Verlassen des Felds, bei Enter oder bei der Auswahl, × setzt auf den Vorschlag zurück. Werte ohne Anpassung (z. B. Herstellerbereich, Profilname) stehen als Anzeigezeilen im passenden Reiter, Erklärungen per „?“. Der separate Dialog „Werte für diesen Auftrag anpassen“ und die Themenkacheln entfallen; „Als Standard merken“, „für alle Teile“ und die Zeile „In Orca“ beim Brim sind in der Tafel.

## [10.24.0] – 2026-10-07

### Geändert
- **3D-Fortschritt schöner:** Bahnen als beleuchtete Raupen (Linienbreite × Schichthöhe, ein Instanz-Objekt – flüssig auch bei großen Drucken) statt 1-Pixel-Linien; gefüllte Druckplatte, dezentes Raster, Hintergrund passend zu hell/dunkel; aktuelle Schicht und Düse in Petrol. Über 600 000 Bahnen bleibt es bei den schnellen Linien.
- „Verbindung …“ und „Rohdaten“ in der Druckerleiste in hellem Petrol statt Orange.

## [10.23.0] – 2026-10-07

### Geändert
- **Druckwerte ruhiger:** oben die wichtigsten Kennzahlen (Düse, Heizbett, Schichthöhe, Wandlinien, Fülldichte, Stützen, Brim), darunter je Thema eine Karte als Liste „Bezeichnung … Wert“ (rechtsbündig, angepasste Werte in Petrol, Notizen klein darunter) in einem festen Raster statt unterschiedlich hoher Kacheln.
- **Abschnitt „Einstellungen in OrcaSlicer-Reihenfolge“ entfernt:** Er war fürs Eintippen von Hand gedacht – 3MF-Export und Slicen im Tool tragen alle Werte selbst ein, und die Druckwerte zeigen jetzt alles.

### Behoben
- **Warteschlange: nächste Platte ließ sich nicht starten („Auftrag nicht mehr vorhanden“):** Der Server behielt nur die letzten 8 Slice-Aufträge im temporären Ordner – jedes weitere Slicen (auch das automatische für die Kosten) räumte den Auftrag der Warteschlange weg, ein Neustart sowieso. Jetzt kopiert der Server den Auftrag der Warteschlange beim Anlegen (und beim Abrufen einer bestehenden) mit allen Platten und Vorschauen in den Datenordner (`queue-jobs`) und räumt die Kopie erst weg, wenn die Warteschlange beendet oder ersetzt wird.

## [10.22.0] – 2026-10-07

### Geändert
- **Neues Farbschema Graphit + Petrol** (hell und dunkel): kühles Anthrazit bzw. helles Blaugrau mit Petrol als Akzent; der Snapmaker U1 bekommt Bernstein, damit er sich abhebt.
- **Druckwerte: alle Werte als Kacheln nach Thema** – Temperatur, Kühlung, Tempo, Qualität, Struktur, Filament, Brim & Haftung, Stützen, Oberflächen, Sonstiges; nichts mehr eingeklappt, inkl. der weiteren Orca-Einstellungen, ohne Doppelungen. Jede Karte zeigt die Zahl angepasster Werte, Kachel anklicken öffnet die Anpassung bei dem Wert, „✎ anpassen“ den Reiter des Themas.
- **Werte anpassen mit Reitern und Suche:** dieselben Themen als Reiter (mit Zähler angepasster Werte), Suchfeld über alle Reiter (findet auch über den Themennamen, z. B. „brim“, „lüfter“).

## [10.21.0] – 2026-10-07

### Neu
- **Form innen** für den inneren Brim: *Ohrenkette – nur große Löcher* (Vorschlag), *Ohrenkette – alle Löcher, Mitte bleibt frei* (auch kleine Löcher und Schlitze, Ohren dort so klein, dass die Mitte offen bleibt), *Ohren nur an Lochecken*, *Orca innen ringsum* (Orcas eigener innerer Brim, mit Warnung, dass kleine Löcher zulaufen). Die Zeile „In Orca“ zeigt die jeweilige Einstellung. Mit der Orca-CLI geprüft (4-mm-Loch: frei / Brim mit offener Mitte / zu).

## [10.20.0] – 2026-10-07

### Geändert
- **Brim aufgeräumt:** eigener Abschnitt „Brim“ in „Werte für diesen Auftrag“ – **Brim außen** und **Brim innen** getrennt an/aus (je „aus“ wählbar), **Form außen** (Ohrenkette – Löcher und Schriften frei / Orca ringsum / Orca-Mausohren nur an Ecken) und **Abstand zum Teil**. Darunter die Zeile **„In Orca“**: welche Orca-Einstellungen für dieses Teil geschrieben werden (erkennt, ob das Teil Löcher oder Schriften in der ersten Schicht hat). Die Karte Aufbau zeigt außen und innen zusammen („5 mm · innen 3 mm“, „nur innen 3 mm“).

## [10.19.1] – 2026-10-06

### Behoben
- **Brim fehlte an langen geraden Kanten** (und neben Schlitzen nahe am Rand): Orca rückt gesetzte Mausohren auf den nächsten Eckpunkt des Umrisses, solange „Brim am kompensierten Umriss“ an ist – Ohren auf Kanten landeten an Lochecken (im Orca-2.4.2-Quelltext nachgelesen). Für Teile mit gesetzten Ohren ist das jetzt aus, und die Ohren bilden eine dichte Kette entlang des ganzen Außenrands (bzw. Lochrands bei Brim innen). Neben Löchern werden die Ohren kleiner statt wegzufallen (mindestens 0,3 mm Abstand zum Loch). Mit der Orca-CLI geprüft: Rahmen und Platte mit Schlitz 2 mm vom Rand – alle Kanten mit Brim, 0 Bahnen im Loch/Schlitz.

## [10.19.0] – 2026-10-06

### Geändert
- **Brim innen als eigene Auswahl** (aus / 2 / 3 / 5 mm, Vorschlag aus) statt Brim-Art „außen und in großen Löchern“ plus Zahlenfeld: gilt nur für große Löcher (mindestens dreifache Breite), kleine Löcher, Schlitze, Schriften und Inseln bleiben frei; auch ohne äußeren Brim möglich. Frühere Einstellungen werden übernommen. Mit der Orca-CLI geprüft (20-mm-Loch mit Brim, 4-mm-Loch frei, nur innen ohne Außenrand).

## [10.18.2] – 2026-10-06

### Behoben
- **Kein Brim (nur mit Raft):** Die gesetzten Mausohren lagen je nach Teilhöhe durch Rundung minimal über dem Bett (z. B. +0,00004 mm bei 2,667 mm Höhe) – Orca verwirft solche Ohren, es gab gar keinen Brim. Die Ohren liegen jetzt 0,05 mm unter der Unterseite; mit der Orca-CLI nachgestellt und geprüft.

## [10.18.1] – 2026-10-05

### Behoben
- **Brim schloss Schriften und kleine Öffnungen:** Orca zieht den äußeren Brim auch um jede Insel in einem Durchbruch (das Innere von Buchstaben, Stege in Öffnungen) – mit der Orca-CLI nachgestellt. Neue Brim-Art „außen – Löcher und Schriften frei“ (Vorschlag): Teile mit Löchern in der ersten Schicht bekommen gesetzte Mausohren auf den Ecken des Außenumrisses (Orca „painted“, `Metadata/brim_ear_points.txt`), Ecken nahe an Löchern bleiben frei; geprüft: 0 Brim-Bahnen im Loch, runde Teile mit durchgehendem Rand. Ohne Löcher bleibt der normale Brim.
- **Innerer Brim schloss kleine Öffnungen:** „außen und in großen Löchern“ setzt innen nur noch Ohren an den Ecken von Löchern mit mindestens dreifacher Innenbreite; kleine Löcher, Schlitze, Schriften und Inseln bleiben frei (Orca füllt bei seinem inneren Brim jedes Loch bis zur Brim-Breite). Neu: **Brim-Breite innen** separat einstellbar (Vorschlag höchstens 3 mm). Geprüft: 20-mm-Loch mit Brim an den Ecken, 4-mm-Loch frei.
- **Brim doppelt einstellbar:** „Brim-Art“ steht nicht mehr unter den weiteren Orca-Einstellungen, sondern direkt unter „Brim“; Skirt und Raft stehen im selben Abschnitt.

## [10.18.0] – 2026-10-05

### Neu
- **Druckwerte: Karte „Weitere Orca-Einstellungen“** – Stützen-Typ/-Stil (wenn gestützt wird), Elefantenfuß, Wandgenerator, Wandreihenfolge, Bügeln, Brim-Art, Linienbreite und alles, was du zusätzlich gesetzt hast; angepasste Werte hervorgehoben, Kachel anklicken öffnet den Dialog bei dem Wert.

### Geändert
- Weniger Hinweise in den Druckwerten: Düse (steht oben), „Vorschlag unverändert“, „STL-Maße … berücksichtigt“ entfallen; die Stützen-Empfehlung erscheint nur noch, wenn es Überhänge gibt.
- Stützen-Typ „Normal“ heißt auch in der Karte Aufbau so (statt „Baumstützen“); angepasste Kacheln schneiden den Text nicht mehr an.

## [10.17.0] – 2026-10-05

### Neu
- **Weitere Orca-Einstellungen anpassbar** (rund 30): Stützen-Typ und -Stil, Überhangwinkel, Abstände, Kontaktschichten, Grundmuster, Astdurchmesser; Elefantenfuß-Kompensation, Wandgenerator (Arachne), Wandreihenfolge, präzise Außenwand, Linienbreiten, Loch-/Konturkompensation; Bügeln, Oberflächenmuster, nur eine Wand oben; Brim-Art (Mausohren …), Skirt, Raft; Prime-Turm, Brücken-Tempo. Vorschlag = was ohne Eingabe gedruckt würde (Rechnung bzw. Druckerprofil), geschrieben nur, wenn gesetzt; auch als Standard merkbar.

### Behoben
- **3D-Fortschritt fehlte bei geplanten Drucken (z. B. mit Vorwärmen):** Der Server legte Vorschau und Objekte erst nach dem Start ab; die Seite hatte da schon nachgefragt, „keine Vorschau“ bekommen und es nie wieder versucht. Jetzt legt der Server sie vor dem Start ab, und die Seite fragt alle 20 s erneut, solange sie fehlen (auch die Objektliste zum Überspringen).

## [10.16.0] – 2026-10-04

### Behoben
- **Angepasste Werte wurden bei mehreren Teilen teils nicht gedruckt:** Werte, die Orca je Filament-Slot (Düse, Bett, Lüfter, Rückzug, Fluss, Z-Hop …) oder für die ganze Platte (Schichthöhe, erste Schicht, Travel, Beschleunigung) führt, kamen nur aus dem ersten Teil – am zweiten Teil gesetzt gingen sie verloren. Jetzt verteilt der Dialog sie auf alle Teile mit demselben Slot bzw. alle Teile und sagt das am Feld („gilt für die ganze Platte“).

### Neu
- **Angepasste Werte als Standard:** Im Dialog „Werte für diesen Auftrag“ **Als Standard für {Filament} merken** – gilt je Drucker und Filament als neuer Vorschlag, der Werkswert bleibt daneben sichtbar; **Standard zurücksetzen** stellt die Werkswerte wieder her. Werte für den einzelnen Auftrag haben Vorrang. Gespeichert **auf dem Server** – gelten in jedem Browser (Mac, iPhone, Home Assistant); vorhandene Werte aus dem Browser werden einmal übernommen.

## [10.15.0] – 2026-10-04

### Neu
- **Alle Werte anpassbar, immer mit Vorschlag:** „Werte für diesen Auftrag“ deckt jetzt alles ab, was das Tool in den Druck schreibt – neu: Düse erste Schicht, Höhe der ersten Schicht, Nahtposition, obere Fläche, Lückenfüllung, max. Volumenstrom, Durchflussverhältnis, Pressure Advance, Z-Hop, Lüfter erste Schicht, Brim-Abstand. Neben jedem Feld der Vorschlag (= was ohne Eingabe gedruckt wird); Warnung am Feld bei Düse außerhalb des Herstellerbereichs oder > 30 % Abweichung. Zeile im Datenblatt anklicken öffnet den Dialog bei diesem Wert.

### Behoben
- **ABS/ASA: Brim löste sich vom Teil.** Das Kobra-S1-Profil lässt 0,1 mm Spalt zwischen Brim und Teil, und der Brim folgte nicht dem durch die Elefantenfuß-Kompensation eingezogenen Umriss. Jetzt folgt jeder Brim dem kompensierten Umriss, bei ABS/ASA ohne Spalt – die innerste Brim-Linie überlappt die Außenwand 0,35 statt 0,27 mm (gemessen im G-Code).

## [10.14.0] – 2026-10-04

### Neu
- **Kobra-S1-Vorgaben je Filament:** PLA Hilfs-/Gehäuselüfter 60/60 %, PETG 30/40 %, ABS/ASA Hilfslüfter aus, Gehäuselüfter 10 %, Bett ≥ 100 °C, immer 5 mm Brim, 10 min Vorwärmen schon angehakt; TPU 30/60 %. Überschreibbar unter „Werte für diesen Auftrag“.

### Behoben
- **Werkbank, geplanter Druck:** Die Karte war eine schmale Spalte mit abgeschnittenem Text; jetzt eine Zeile über die ganze Breite. Der Druckauftrag zeigt „Bett heizt vor – Druck startet um …“ statt „Kein Druck aktiv“, oben steht „heizt vor“ / „trocknet“.

## [10.13.0] – 2026-10-04

### Behoben
- **Werte für diesen Auftrag: Kommastellen gingen verloren** – alles außer der Schichthöhe wurde ganzzahlig gespeichert (1,3 mm Rückzug → 1 mm). Jetzt auf die Schrittweite des Felds gerundet.

### Neu
- **Hilfs- und Gehäuselüfter einstellbar** (Kobra S1, „Werte für diesen Auftrag“): seitlicher Hilfslüfter und Gehäuselüfter/Abluft während des Drucks; geschrieben nur, wenn gesetzt (sonst Profil, je 60 %). „Lüfter“ heißt dort jetzt „Lüfter (Bauteil)“.
- **Bett vorwärmen** vor dem Druck (Sendedialog → „Vor dem Druck“, z. B. ABS/ASA): Temperatur und Dauer; „Vorwärmen und drucken“ heizt sofort und startet nach der Dauer, mit „Später starten“ direkt vor der Startzeit. Ausgeführt vom Server, nach erneuter Prüfung; bei Absage oder wenn der Druck nicht startet, geht die Heizung wieder aus.

## [10.12.2] – 2026-10-03

### Behoben
- **3D-Fortschritt zeigte beim Bett vermessen das Modell fertig:** Mit „Echte Kopfposition“ nahm das Tool die Schicht aus der Kopfhöhe – beim Vermessen steht der Kopf aber hoch über dem Bett (S1: Z ≈ 380 mm), das ergab die oberste Schicht. Jetzt zählt die Kopfhöhe erst ab Schicht 1 und nur, wenn sie zum Modell passt; davor steht „Vorbereitung vor der ersten Schicht“.

## [10.12.1] – 2026-10-03

### Behoben
- **„An Drucker senden“ öffnete sich nicht (10.12.0):** Der neue Teil „Später starten“ las die Filamente als Liste, nach dem Slicen sind sie aber ein Objekt je Slot – der Fehler brach das Öffnen ab. Behoben; ein Fehler in diesem Zusatzteil verhindert das Senden künftig nie mehr.

## [10.12.0] – 2026-10-03

### Neu
- **Tempo und Rückzug einstellbar:** Unter **Werte für diesen Auftrag** zusätzlich erste Schicht, Travel, Beschleunigung und **Rückzug** (Länge, Geschwindigkeit). Rückzug schreibt das Tool nur, wenn du ihn setzt – sonst bleibt das Orca-Profil des Slots. Jede Karte bei den Druckwerten hat **✎ anpassen** und öffnet den Dialog beim passenden Abschnitt.
- **Druck zeitlich planen** (Sendedialog → **Später starten**): Startzeit bis 14 Tage voraus, optional **vorher trocknen** – das Trocknen endet zum Druckstart. Bestätigung „Bett frei, richtige Druckplatte“ nötig; der Server startet zur Zeit, auch ohne offene Seite, nach erneuter Prüfung (Drucker frei, Filament passt) – sonst nicht, mit Grund. Anzeige und **Absagen** in der Werkbank, in Home Assistant „Geplanter Start“ und „Geplanter Druck“.

## [10.11.2] – 2026-10-02

### Behoben
- **Drucker zeigte das Modell nach dem Hochladen nicht an:** OrcaSlicer schreibt auf der Kommandozeile (Container) kein Vorschaubild in den G-Code. Das Tool zeichnet es jetzt selbst (schräg von oben, Filamentfarben, durchsichtiger Hintergrund) und setzt es wie Orca ein – Größe aus dem Profil (Kobra S1: 230 × 110 PNG). Beim Hochladen und beim Herunterladen des G-Codes; ein Fehler dabei hält den Druck nie auf.
- **3MF aus Bambu Studio ließ sich nicht slicen:** Objekte, die im Projekt auf „nicht drucken“ stehen oder neben den Platten liegen, nahm das Tool mit – beim Mitten des Designer-Layouts rutschte dadurch das echte Teil vom Bett, und Orca brach ab („keine Objekte auf der Platte“). Solche Objekte lässt das Tool jetzt weg, wie Bambu Studio/OrcaSlicer (mit Hinweis).

## [10.11.1] – 2026-10-02

### Verbessert
- **Jedes Objekt überspringbar**, auch das letzte noch laufende (bisher gesperrt – „dann abbrechen“). Beim letzten fragt die Zeile deutlicher nach: danach druckt der Drucker nichts mehr.

## [10.11.0] – 2026-10-02

### Neu
- **Home Assistant: Druck pausieren / fortsetzen** als Knöpfe – nur mit der Add-on-Option **Steuern aus Home Assistant** (Standard aus). Abbrechen geht nie über Home Assistant; ohne laufenden Druck lehnt der Drucker ab.
- **Home Assistant: „Filament knapp“** (`binary_sensor.druck_konfigurator_filament_low`): an, wenn eine Spule unter der Warnschwelle liegt oder die noch wartenden Platten der Warteschlange mehr brauchen, als im Slot ist; der Grund steht im Attribut `filament_note`.

### Verbessert
- **Druckzeiten mit Vorbereitung:** In ③, bei den Platten und in der Warteschlange kommt die gemessene Vorbereitung (Bett vermessen, Aufheizen; Standard 7 min) je Platte auf Orcas Zeit – z. B. „Druckzeit ≈ 16 min (Orca 9 min + Vorbereitung)“.
- **Seite lädt schneller:** Der Server verbot dem Browser bisher, irgendetwas zu behalten, und schickte bei jedem Öffnen 80 Dateien mit 2,1 MB. Jetzt bekommt jede Datei eine Versionskennung und bleibt im Browser, bis sie sich ändert; Texte kommen gzip-komprimiert. Erstes Öffnen 632 KB statt 2,1 MB, jedes weitere 5 KB (gemessen lokal: 90–140 ms statt 210–810 ms). Spürbar vor allem am Handy über Home Assistant.

## [10.10.0] – 2026-10-02

### Neu
- **Home Assistant: Kamera „3D-Fortschritt“** – das Add-on schickt bei jeder Schicht ein Bild des Druckfortschritts per MQTT (schräg von oben, in den Farben der ACE-Slots, aktuelle Schicht hell). Ohne Anmeldung am Add-on nutzbar: Dashboard, Handy-App, Bild in Benachrichtigungen. Gezeichnet ohne Zusatzpakete, schrittweise (0,2–0,4 s je Schicht, ~15 KB).
- **Sätze zusammenhalten** (Plattenübersicht, Standard an): Bei Modellen aus mehreren Teilen kommt jeder Satz ganz auf eine Platte – 20 RFID-Halter: Platte 1 mit 14, Platte 2 mit 6 kompletten Sätzen statt 20 Haltern + 8 Deckeln und 12 einzelnen Deckeln. Höchstens eine Platte mehr als frei verteilt, sonst frei (mit Hinweis).

### Verbessert
- **Modell-Ansicht aufgeräumt:** Die Werkzeug-Reiter (Platten, Lage, Größe, Farben, Bohrlöcher, Text) stehen in einem Raster – bisher waren „Bohrlöcher“ und „Text“ abgeschnitten. Bei Modellen aus mehreren Teilen mit gleicher Anzahl gilt nur die Anzahl in der Kopfzeile; die eigene Anzahl eines Teils gibt es über „Anzahl nur für dieses Teil …“. Hinweise erscheinen in der 3D-Ansicht oben statt über der Überhang-Leiste.
- **Werkbank → Rohdaten** zeigen die letzten 40 Meldungen des Druckers (Art, Aktion, Zustand, Alter) – zur Fehlersuche, z. B. was nach einem Abbruch kommt.
- **Falsches Filament früher bemerkt:** Ist bei den Druckwerten ein anderes Material gewählt als im Slot des Teils steckt (vom Drucker/ACE oder eigene Angabe), steht das rot unter der Filament-Auswahl und in ③ vor dem Slicen – mit **Filament aus dem Slot übernehmen**. Bisher fiel es erst im Sendedialog auf.

### Behoben
- **Restzeit ohne Vorbereitung:** Bett vermessen und Aufheizen vor der ersten Schicht (am S1 ~7 min) fehlten in der Restzeit und galten danach als „langsamer gedruckt“. Jetzt getrennt gerechnet; das Tool merkt sich die Dauer je Druck. Nachgerechnet an Platte 1 vom 01.10.: Orca 92,6 min, echt 99,7 min – mit Vorbereitung 99,6 min.
- **Druckhistorie: Dauer viel zu lang** – der Kobra S1 meldet einen fertigen oder abgebrochenen Druck weiter, bis am Display bestätigt wird; das Tool zählte bis dahin weiter (ein Druck stand mit 22 h in der Historie). Jetzt endet er bei „fertig“/„abgebrochen“.
- **Seite lud manchmal unvollständig** („Modell konnte nicht gelesen werden: … is not defined“): Der Server wies bei den gut 70 gleichzeitig geladenen Skripten einen Teil der Verbindungen ab (Warteschlange 5). Jetzt 128 – mit der alten kamen im Test nur ~20 von 100 gleichzeitigen Verbindungen durch, jetzt alle. Damit sind auch die gelegentlichen Fehlstarts der automatischen Tests weg.

## [10.9.6] – 2026-10-01

### Neu
- **Nur 3D-Fortschritt zum Einbetten:** `…/?ansicht=3d` zeigt bildschirmfüllend nur den 3D-Fortschritt des laufenden Drucks – z. B. als Webseiten-Karte im Home-Assistant-Dashboard. Ändert keine gespeicherten Einstellungen, kein Hinweisdialog.

## [10.9.5] – 2026-10-01

### Behoben
- **Objektliste im Druck sprang beim Scrollen zurück:** Sie wurde bei jedem neuen Stand (alle paar Sekunden) neu aufgebaut. Jetzt nur noch bei Änderungen, die Scrollposition bleibt.

## [10.9.4] – 2026-10-01

### Verbessert
- **Objekte überspringen – sehen, welches gemeint ist:** Name anklicken hebt das Objekt im 3D-Fortschritt **blau** hervor (Block vom Bett bis zur aktuellen Schicht, bleibt stehen – auch am Handy; gedruckte Bahnen sind ja schon orange). Die Rückfrage steht jetzt in der Liste (**Ja, überspringen** / **Nein**) statt als Browser-Dialog, damit das Objekt dabei sichtbar bleibt; bei Kamera-Ansicht wechselt sie zum 3D-Fortschritt.

### Behoben
- **Drucker blieb nach einem Neustart „beschäftigt“:** Riss die Verbindung ab (Drucker aus/neu gestartet), zeigte das Tool weiter den letzten Stand – z. B. „busy“ nach einem Abbruch – und kam teils nicht wieder an den Drucker heran (Verbindungs-Thread starb an einem unerwarteten Fehler). Jetzt: ohne Verbindung „nicht erreichbar“ statt altem Stand, nach 10 s baut die nächste Abfrage die Verbindung neu auf, ohne Verbindung startet kein Druck.

## [10.9.3] – 2026-10-01

### Verbessert
- **Senden: „beschäftigt“ ohne Auftrag** (Kobra S1 nach einem Abbruch) – der Dialog sagt, dass am Display meist ein Dialog wartet, mit **Erneut abfragen**.
- **Senden: falsches Material** – neuer Knopf **„Filament aus der ACE übernehmen und neu slicen“**: Teile aufs Filament der Slots umstellen, widersprechende eigene Slot-Angaben verwerfen, neu slicen, Dialog wieder öffnen.
- **Werkbank, Achsen:** Die Z-Knöpfe heißen jetzt **Bett ↑** (oben) und **Bett ↓** (unten) – wie sich das Bett beim Kobra S1 bewegt – statt Z+/Z− mit Erklärsatz.

## [10.9.2] – 2026-10-01

### Verbessert
- **SUNLU-Farben mit den echten Farbcodes** aus SUNLUs Farbtabellen auf sunlu.com (19 Filamente, z. B. Klein Blue #1729AB statt geschätzt #002FA7); fehlende Farben der Tabellen ergänzt. Shop-Farben ohne Tabelleneintrag bleiben als ungefähr markiert.

## [10.9.1] – 2026-10-01

### Neu
- **Umschalter „Farben | Grenzwinkel“** unter dem Modell (bleibt gemerkt): Farben = Slot-, Körper- und Malfarben wie gedruckt, auch für einfache Teile; Grenzwinkel = Überhänge blau/gelb/rot. Ersetzt „Farben zeigen“ unter Mehrfarbig.

### Behoben
- **Grenzwinkel in der Modellansicht wieder sichtbar:** Einfache Teile (STL) erschienen einfarbig in der Slotfarbe statt blau/gelb/rot nach Überhang – eine leere Modifikatorliste galt als „hat Modifikatoren“.

## [10.9.0] – 2026-10-01

### Neu
- **Platten kompakter:** Teile einer nicht vollen Platte liegen als mittiger Block statt an Rand und Ecke (12 Teile vorher als „L“, jetzt 3 × 4). Unter jeder Platte stehen Kopien als eine Zeile („Teil 1 ×20“). Beim automatischen Anordnen kein Hinweis „Nicht alles passte …“ mehr – weitere Platten sind dort gewollt.
- **Abstand beim Anordnen einstellbar** (Plattenübersicht, 3–15 mm, Standard 8 mm, bleibt gemerkt): kleine Teile passen dichter – 20 RFID-Halter-Sätze mit 3 mm: 38 Teile auf Platte 1 statt 28. Teile werden beim Anordnen auch um 180°/270° gedreht. Objekt für Objekt gilt weiter mindestens der Freiraum des Druckkopfs.
- **Anzahl für ein ganzes Modell:** Besteht ein Modell aus mehreren Teilen (z. B. der RFID-Halter aus Halter und Deckel), steht darüber eine Kopfzeile mit **einer** Anzahl für alle Teile – 20 Sätze sind eine Eingabe. Kopien erscheinen als **eine Zeile „×20“** statt 20 Zeilen; ✕ entfernt das Teil mit allen Kopien (mit Rückgängig); bei Kopien auf mehreren Platten stehen alle Platten in der Zeile.
- **① Modell und ② Druckwerte übersichtlicher:** Teile oben (ruhige Zeilen, Stützen als Farbpunkt, Details nur beim gewählten Teil), Filamente einklappbar mit schmaler Slot-Leiste, Werkzeuge des Teils als Reiter statt Abschnitten untereinander, Import-Hinweise in einer Zeile. Druckwerte links in Gruppen, **Farbwechsel & Spülmenge** jetzt dort (statt in ③), kleine 3D-Ansicht eingeklappt; rechts die Werte in drei Karten (Temperatur & Kühlung, Tempo, Aufbau), Hinweise mit Anzahl.
- **Überspringen im 3D-Fortschritt:** Objekt anklicken statt in der Liste suchen; unter der Maus orange umrandet.
- **Übersprungene Objekte im 3D-Fortschritt:** ab der Schicht des Überspringens dunkel, der Druckkopf lässt sie aus und fährt wie der Drucker gleich zum nächsten Objekt.
- **STL in Zoll:** Bei sehr kleinen STL (höchstens 10 mm) bietet das Tool „In Zoll umrechnen (×25,4)“ an, mit Rückgängig; Skalierung jetzt bis 3000 %.
- Druckhistorie: „Objekt(e) übersprungen“ bei solchen Drucken (der gezählte Verbrauch stimmt ohnehin, er kommt aus dem gemeldeten Filament).

### Behoben
- **Restzeit im Tab ④ sprang stark:** Angezeigt wurde die Schätzung des Druckers. Für Drucke aus dem Tool rechnet die Seite jetzt selbst: Orcas Gesamtzeit verteilt auf die Schichten (Weg und Vorschub aller Bewegungen, dazu die Farbwechsel mit der Wechselzeit des Profils), ab der aktuellen Schicht aufsummiert und an das gemessene Tempo angepasst. Der Wert des Druckers steht klein darunter.
- Kurztest des Container-Images scheiterte zufällig („Connection reset“, Exit-Code 23): „curl | grep -q“ mit pipefail – jetzt Antwort erst lesen, dann prüfen, mit Wiederholungen.

## [10.8.3] – 2026-09-30

### Verbessert
- **Kamera startet von selbst**, sobald sie im Tab ④ zu sehen ist (Ansicht „Kamera“, Drucker verbunden); in der 3D-Ansicht läuft kein Kamerastrom im Hintergrund. Von Hand gestoppt bleibt sie aus, bis der Tab wieder geöffnet wird.

## [10.8.2] – 2026-09-30

### Behoben
- **Kamerabild auf dem iPhone:** Der Player flv.js lief auf dem iPhone nicht. Jetzt mpegts.js (Nachfolger von flv.js), das auf dem iPhone ab iOS 17.1 über Apples ManagedMediaSource abspielt; ältere iPhones bekommen einen Hinweis.

## [10.8.1] – 2026-09-30

### Verbessert
- ② Druckwerte: Die Farben des Herstellers erscheinen nur noch, wenn der Slot des Teils seine Farbe nicht per RFID von der ACE bekommen hat – sonst steht dort nur „Farbe per RFID von der ACE gelesen“.

## [10.8.0] – 2026-09-30

### Neu
- **Objekte überspringen** während des Drucks (Tab ④ → Druckauftrag → Objekte): ein Teil, das sich gelöst hat, lässt sich weglassen, der Rest druckt weiter. Befehl der Werksfirmware (skip im Kanal „web“, Protokoll-Fakt aus anycubic-orca-plugin); Objekte aus dem G-Code, Umrisse im 3D-Fortschritt. Nur für Drucke aus dem Tool.

### Behoben
- **Kamera zeigte oft ein altes Bild:** Der Server reichte den Strom erst in vollen 64-KB-Blöcken weiter – bei der geringen Datenrate der Kamera Sekunden zu spät. Jetzt sofort; dazu verbindet sich die Kamera neu, wenn keine Bilder mehr kommen, holt Rückstand auf und startet frisch, wenn das Fenster wieder nach vorn kommt.

## [10.7.1] – 2026-09-30

### Behoben
- **STL in Meter** (z. B. aus Blender oder Onshape) wurde als winziges Teil gelesen und ließ sich nicht slicen (RFID-Halter). Wie OrcaSlicer rechnet das Tool solche Dateien jetzt auf Millimeter um und zeigt einen Hinweis.

## [10.7.0] – 2026-09-30

### Neu
- **Filamente von Anycubic und SUNLU** in ② Druckwerte, nach Hersteller gruppiert (16 Anycubic, 18 SUNLU) mit den **Druckwerten der Hersteller** (Anycubic: eigene Kobra-S1-Profile aus OrcaSlicer bzw. Produktseite; SUNLU: Produktseiten und SUNLUs Slicer-Profile) und ihren **Farben** (Anycubic mit den offiziellen Farbcodes aus dem Shop, SUNLU nach Farbnamen). Farbe anklicken trägt sie für den Slot des Teils ein. Alle 34 Profile mit der Orca-CLI geslict.
- **Stützen und Naht malen** (Bemalen → Stützen / Naht): erzwingen/verhindern wie in OrcaSlicer; erzwungene Stützen an einem Teil ohne Stützen werden als „nur gemalte Stellen“ (tree(manual)) exportiert – mit der Orca-CLI geprüft.
- **Lücken füllen** und **Vorschau beim Füllen** im Bemalen-Feld; Hinweis, wenn die Farbzuordnung selbst übermalte Stellen nicht mehr betrifft.
- **Bemalen wie in OrcaSlicer** (Werkzeugleiste, Pinsel): Farbe je Fläche mit Kreis, Kugel, Dreieck, Füllen (nach Flächenwinkel) und Höhenbereich; Radierer (auch Umschalt), alles entfernen; Größe per Regler oder Alt+Mausrad, Slot per Klick oder Taste 1–9. Kreis und Kugel teilen Dreiecke am Pinselrand fein auf – gespeichert im Orca-Format (paint_color). Die Lage der Teilstücke ist mit der Orca-CLI nachgemessen, der G-Code druckt genau die bemalte Fläche. Geht auf eigenen Modellen und auf Makerworld-Objekten (die Bemalung des Designers bleibt daneben erhalten), gilt für alle Kopien, mit Rückgängig, übersteht Neuladen, auf dem Handy mit dem Finger.
- Bemalung des Designers wird in der 3D-Ansicht jetzt genau gezeigt (auch geteilte Dreiecke), getrennte Teile einer Makerworld-3MF behalten ihre Bemalung beim Export.
- **Rückgängig / Wiederholen** für das ganze Projekt: Strg/⌘+Z, Strg/⌘+Umschalt+Z (oder Strg+Y) und zwei Knöpfe vorn in der Werkzeugleiste – Slot, Größe, Drehung, Platte, Kopien, Entfernen, Farbzuordnung, Druckreihenfolge, Beschriftung, Bohrlöcher (bis 60 Schritte).
- **Beschriftung auf Objekten des Designers** (Makerworld-/Orca-3MF): erhaben mit eigenem Slot oder vertieft; kommt als weiteres Bauteil ins Objekt, wie OrcaSlicer es speichert (mit Orca-CLI geprüft).

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
