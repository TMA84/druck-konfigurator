'use strict';
/* Anycubic-Drucker mit LAN-Modus der Werksfirmware (gleiches Protokoll wie der Kobra S1, tools/anycubic_lan.py).
   Laut Anycubic: Kobra-3-Reihe, Kobra S1, S1 Max und Kobra X. Getestet ist nur der Kobra S1 – die übrigen sind
   „experimentell“ (2026-10-08), bis sie jemand bestätigt.
   kin: corexy = Kopf fährt X/Y, Bett fährt Z (Rahmen und Mechanik fahren relativ zum Teil in Z);
        bed    = Bettschubser: Bett fährt Y, die X-Achse mit Kopf fährt Z (Rahmen fährt relativ zum Teil in Y und Z).
   size: Bauraum x, y, z (mm, Orca-Profil). fans: Hilfs-/Gehäuselüfter laut Orca-Profil (auxiliary_fan, Abluft).
   ace: höchstens so viele ACE-Einheiten. presets: Lüfter-/Bett-Vorgaben wie beim Kobra S1 (geschlossene Drucker). */
const ANYCUBIC_LAN_MODELS = [
  { key: 'kobra_s1_max', re: /kobra s1 max/i, label: 'Kobra S1 Max', kin: 'corexy', size: [350, 350, 350], fans: { aux: true, box: true }, enclosed: true, ace: 2, tested: false },
  { key: 'kobra_s1', re: /kobra s1\b/i, label: 'Kobra S1', kin: 'corexy', size: [250, 250, 250], fans: { aux: true, box: true }, enclosed: true, ace: 2, tested: true },
  { key: 'kobra_3_max', re: /kobra 3 max/i, label: 'Kobra 3 Max', kin: 'bed', size: [426, 420, 500], fans: { aux: false, box: false }, enclosed: false, ace: 2, tested: false },
  { key: 'kobra_3', re: /kobra 3\b/i, label: 'Kobra 3', kin: 'bed', size: [255, 255, 260], fans: { aux: false, box: false }, enclosed: false, ace: 2, tested: false },
  { key: 'kobra_x', re: /kobra x\b/i, label: 'Kobra X', kin: 'bed', size: [260, 260, 260], fans: { aux: false, box: false }, enclosed: false, ace: 4, tested: false }
];
// Modell zu einem Namen („Anycubic Kobra 3 Combo“, Meldung des Druckers) oder null
const anycubicLanModel = name => ANYCUBIC_LAN_MODELS.find(m => m.re.test(String(name || ''))) || null;
// LAN-Modell des gewählten Druckers (eigener Kobra S1 oder „Anderer Anycubic …“ aus den Orca-Profilen) oder null
function lanModelOf(printer) {
  if (!printer) return null;
  if (printer.id === 'kobra_s1') return ANYCUBIC_LAN_MODELS.find(m => m.key === 'kobra_s1');
  if (printer.id === 'orca' && printer.orca && printer.orca.vendor === 'Anycubic') return anycubicLanModel(printer.label);
  return null;
}
// Drucker übers Netz steuerbar (Werkbank, Senden, Warteschlange)?
const isLanPrinter = printer => !!lanModelOf(printer);
// Kennung der Druckerverbindung: alle LAN-Anycubic teilen die gespeicherte Verbindung „kobra_s1“ (bestehende Einstellungen
// bleiben gültig); „Anderer Anycubic …“ mit LAN-Modus wird dafür wie der Kobra S1 behandelt
const linkId = id => (id === 'orca' && typeof PRINTERS !== 'undefined' && isLanPrinter(PRINTERS.orca) ? 'kobra_s1' : id);
