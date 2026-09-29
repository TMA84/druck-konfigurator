'use strict';
/* Englische Texte (server) – Schlüssel = deutscher Text genau wie im Code, siehe t() in js/util.js.
   Meldungen aus tools/serve.py, tools/anycubic_lan.py (LanError, PRINT_STATUS, "note") und tools/slicer.py
   (SliceError) sowie die Fehler von lanApi() in js/printer-link.js. Meldungen mit wechselnden Teilen: I18N.addRx
   unten; zusammengesetzte Gründe werden dort mit t() weiter übersetzt. */
I18N.add({
  // tools/anycubic_lan.py – PRINT_STATUS (nur zur Anzeige übersetzen; im Code wird mit dem deutschen Wert verglichen)
  'abgebrochen': 'canceled',
  'lädt herunter': 'downloading',
  'prüft': 'checking',
  'heizt vor': 'preheating',
  'slict': 'slicing',
  'nivelliert': 'leveling',

  // tools/serve.py
  'Slice-Auftrag nicht (mehr) vorhanden – bitte neu berechnen': 'Slice job not found (anymore) – please calculate again',
  '3MF als application/octet-stream erwartet': '3MF expected as application/octet-stream',
  '3MF zu groß (höchstens 200 MB)': '3MF too large (200 MB max)',
  'JSON erwartet': 'JSON expected',
  'Anfrage zu groß': 'Request too large',

  // tools/anycubic_lan.py – LanError
  'Nur Drucker im Heimnetz (private IP-Adressen) sind erlaubt': 'Only printers on your home network (private IP addresses) are allowed',
  'Verbindung abgelehnt – LAN-Modus an? Läuft das Tool in einem Container, der das Heimnetz nicht erreicht?': "Connection refused – is LAN mode on? Is the tool running in a container that can't reach your home network?",
  'keine Antwort (Zeitüberschreitung) – eingeschaltet, im selben Netz?': 'no answer (timeout) – is it switched on and on the same network?',
  'Antwort des Druckers ist kein JSON': "The printer's answer isn't JSON",
  'Antwort des Druckers unerwartet': "Unexpected answer from the printer",
  'LAN-Modus ist am Drucker aus (Einstellungen → Netzwerk → LAN-Modus)': 'LAN mode is off on the printer (Settings → Network → LAN mode)',
  'Dieser Drucker unterstützt den LAN-Zugang nicht (ältere Firmware oder Modell)': "This printer doesn't support LAN access (older firmware or model)",
  'Zugangsdaten des Druckers nicht entschlüsselbar': "Couldn't decrypt the printer's credentials",
  'Zugangsdaten des Druckers unvollständig': "The printer's credentials are incomplete",
  'Unbekannte Broker-Adresse': 'Unknown broker address',
  'Anmeldeantwort des Druckers unvollständig': "The printer's login answer is incomplete",
  'LAN-Modus braucht die Python-Pakete paho-mqtt und cryptography (pip install -r requirements.txt)': 'LAN mode needs the Python packages paho-mqtt and cryptography (pip install -r requirements.txt)',
  'Drucker lehnt die MQTT-Anmeldung ab': 'The printer rejects the MQTT login',
  'Keine Verbindung zum Drucker': 'No connection to the printer',
  'Drucker hat den Befehl nicht bestätigt': "The printer didn't confirm the command",
  'Befehl braucht multi_color_box mit Box-id': 'The command needs multi_color_box with a box id',
  'Während eines Drucks gesperrt': 'Locked while printing',
  'Es läuft kein Druckauftrag': 'No print job is running',
  'Genau ein Lüfter je Befehl': 'Exactly one fan per command',
  'Slot-Angabe ungültig (index, type, color [r,g,b])': 'Invalid slot data (index, type, color [r,g,b])',
  'Drucker meldet keine Kamera': "The printer doesn't report a camera",
  'Kamera-Adresse zeigt nicht auf den Drucker': "The camera address doesn't point to the printer",
  'Drucker nennt keine Upload-Adresse (LAN-Modus an?)': "The printer doesn't give an upload address (is LAN mode on?)",
  'Upload-Adresse zeigt nicht auf den Drucker': "The upload address doesn't point to the printer",
  'Drucker lehnt das Hochladen ab (Anmeldung abgelaufen) – bitte noch einmal senden': 'The printer rejects the upload (login expired) – please send it again',
  'Datei hochgeladen und Start gesendet – der Drucker meldet noch keinen Auftrag. Bitte am Drucker prüfen.': "File uploaded and start sent – the printer doesn't report a job yet. Please check on the printer.",
  // Namen in „… muss eine ganze Zahl von … bis … sein“
  'Betttemperatur': 'Bed temperature',
  'Dauer (min)': 'Duration (min)',
  'Weg (mm)': 'Distance (mm)',

  // tools/slicer.py – SliceError
  'unbekannter Fehler (siehe Orca-Protokoll)': 'unknown error (see the Orca log)',
  'Keine gültige 3MF-Datei (höchstens 200 MB)': 'Not a valid 3MF file (200 MB max)',
  'OrcaSlicer ist auf dem Server nicht installiert (im Container enthalten; lokal ORCA_PATH setzen)': "OrcaSlicer isn't installed on the server (included in the container; locally, set ORCA_PATH)",
  'Die Filamente brauchen zu unterschiedliche Düsentemperaturen (z. B. PLA zusammen mit ASA/ABS) – Orca slict so nicht. Für mehrfarbige Teile Filamente derselben Art in die Slots legen.': "The filaments need nozzle temperatures that are too different (e.g. PLA together with ASA/ABS) – Orca won't slice that. For multicolor parts, load filaments of the same kind into the slots.",
  'OrcaSlicer hat keine Platte geslict': "OrcaSlicer didn't slice any plate",

  // js/printer-link.js – Fehler von lanApi() und fetchLanStatus()
});

// Meldungen mit wechselnden Teilen. Reihenfolge: das erste passende Muster gilt.
I18N.addRx([
  // tools/serve.py
  [/^Ungültige Anfrage: (.*)$/s, (m, a) => 'Invalid request: ' + t(a)],
  [/^Kamera nicht erreichbar: (.*)$/s, (m, a) => "Can't reach the camera: " + t(a)],
  // tools/anycubic_lan.py
  [/^Adresse (.*) nicht gefunden$/s, 'Address $1 not found'],
  [/^Drucker antwortet mit HTTP (\d+)$/, 'The printer answers with HTTP $1'],
  [/^Drucker antwortet beim Hochladen mit HTTP (\d+)$/, 'The printer answers the upload with HTTP $1'],
  [/^Drucker antwortet nicht \(keine Daten nach (\d+) s\)$/, 'The printer isn’t answering (no data after $1 s)'],
  [/^Drucker nicht erreichbar: (.*)$/s, (m, a) => "Can't reach the printer: " + t(a)],
  [/^Drucker lehnt die Anmeldung ab: (.*)$/s, 'The printer rejects the login: $1'],
  [/^Drucker lehnt die MQTT-Anmeldung ab \((.*)\)$/s, 'The printer rejects the MQTT login ($1)'],
  [/^MQTT-Verbindung zum Drucker fehlgeschlagen: (.*)$/s, 'MQTT connection to the printer failed: $1'],
  [/^(.*) muss eine ganze Zahl von (-?\d+) bis (-?\d+) sein$/s, (m, n, lo, hi) => t(n) + ' must be a whole number from ' + lo + ' to ' + hi],
  [/^Drucker hat den Befehl nicht bestätigt \(empfangen: (.*)\)$/s, (m, a) => "The printer didn't confirm the command (received: " + a.replace(/ ohne msgid/g, ' without msgid') + ')'],
  [/^Der G-Code nutzt Slot (.*) – am Drucker gibt es nur (\d+) Slots$/s, 'The G-code uses slot $1 – the printer only has $2 slots'],
  [/^Dieser Befehl ist nicht freigegeben: (.*)$/s, 'This command isn’t allowed: $1'],
  [/^Hochladen fehlgeschlagen: (.*)$/s, (m, a) => 'Upload failed: ' + t(a)],
  [/^Drucker lehnt die Datei ab: (.*)$/s, 'The printer rejects the file: $1'],
  [/^Der Drucker ist nicht frei \((.*)\) – erst den laufenden Vorgang beenden$/s, 'The printer isn’t free ($1) – finish the current task first'],
  [/^Der G-Code ist für „(.*)“ geslict, verbunden ist „(.*)“$/s, 'The G-code was sliced for “$1”, but “$2” is connected'],
  [/^Drucker hat den Start abgelehnt: (.*)$/s, 'The printer rejected the start: $1'],
  // tools/slicer.py
  [/^Slicen dauert zu lange \(über (\d+) min\)$/, 'Slicing takes too long (over $1 min)'],
  [/^OrcaSlicer konnte nicht slicen: (.*)$/s, (m, a) => 'OrcaSlicer could not slice: ' + t(a)],
  // js/printer-link.js und Vorsilben der Oberfläche vor Servermeldungen
  [/^Server antwortet mit HTTP (\d+)$/, 'The server answers with HTTP $1'],
  [/^Drucker hat die Slot-Angabe abgelehnt: (.*)$/s, 'The printer rejected the slot data: $1'],
  [/^Werksfirmware: (.*) · Moonraker: (.*)$/s, (m, a, b) => 'Stock firmware: ' + t(a) + ' · Moonraker: ' + t(b)],
  [/^Nicht berechnet: (.*)$/s, (m, a) => 'Not calculated: ' + t(a)]
]);
