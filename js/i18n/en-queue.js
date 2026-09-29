'use strict';
/* Englische Texte (Warteschlange auf dem Server: js/queue-ui.js, Meldungen von tools/printqueue.py). */
I18N.add({
  'Warteschlange nicht angelegt: {msg}': 'Queue not created: {msg}',
  'Warteschlange nicht aktualisiert: {msg}': 'Queue not updated: {msg}',
  // tools/printqueue.py
  'Slice-Auftrag fehlt – bitte neu berechnen': 'Slice job missing – please recalculate',
  'Platten fehlen': 'Plates missing',
  'Platte doppelt': 'Duplicate plate',
  'Reihenfolge fehlt': 'Order missing',
  'Ungültiger Zustand': 'Invalid state',
  'Ungültige Plattennummer': 'Invalid plate number',
  'unbekannte Aktion': 'unknown action',
  'Keine Warteschlange': 'No queue',
  'Platte nicht in der Warteschlange': 'Plate is not in the queue',
  'Platte druckt gerade': 'Plate is printing right now',
  'Platte wartet nicht': 'Plate is not waiting',
  'angelegt': 'created',
  'beendet': 'ended',
  'gestartet': 'started',
  'wartet wieder': 'waiting again'
});
I18N.addRx([
  [/^Platte (\d+) nicht im Slice-Stand$/, 'Plate $1 is not in the sliced set'],
  [/^Ungültiger Wert: (.*)$/s, 'Invalid value: $1']
]);
