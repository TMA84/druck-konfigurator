'use strict';
/* Englische Texte für Sprache/Darstellung in der Kopfzeile (index.html, js/theme.js). */
I18N.add({
  'Sprache und Darstellung': 'Language and appearance',
  'Sprache': 'Language',
  'Darstellung': 'Appearance',
  'Hell': 'Light',
  'Dunkel': 'Dark',
  'Automatisch (wie das System)': 'Automatic (follows the system)'
});
// Automatische Namen aus dem Import (bleiben in den Daten deutsch, weil sie in die 3MF gehen) – nur in der Anzeige
I18N.addRx([[/^Körper (\d+)$/, 'Body $1'], [/^Objekt (\d+)$/, 'Object $1']]);
// Dieselben deutschen Wörter kommen in mehreren Bereichen vor – hier einheitlich (diese Datei lädt zuletzt)
I18N.add({
  'Heizbett': 'Heated bed',
  'Dünnwandiges Gehäuse': 'Thin-walled enclosure',
  'Nur kritische Bereiche': 'Critical regions only',
  'Schnittstellenabstand': 'Interface spacing',
  'Erste Schicht': 'First layer',
  'Füllmuster': 'Infill pattern',
  'Füllung': 'Infill',
  'Stützen': 'Supports',
  'Sonstiges': 'Other',
  'Standard': 'Standard',
  'Beenden': 'Stop',
  'fertig': 'done',
  'Drucker meldet keine ACE-Slots': "The printer doesn't report any ACE slots",
  'Drucker hat die Slot-Angabe abgelehnt': 'The printer rejected the slot data'
});
