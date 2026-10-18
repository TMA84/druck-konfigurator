'use strict';
/* G-Code drucken (2026-10-18): fertig geslicten G-Code (z. B. aus OrcaSlicer) auf den Server laden (/api/gcode → Auftrag mit
   einer Platte wie nach dem Slicen, tools/slicer.py import_gcode) und über den Dialog „An Drucker senden“ starten
   (js/send-ui.js, own: Werkzeug → ACE-Slot frei wählbar). Druckzeit, Gramm je Werkzeug, Material und Farben aus dem
   Kommentarblock am Ende des G-Codes; Vorschau und 3D-Fortschritt wie bei eigenen Drucken. Der Server prüft vor dem
   Start: Drucker frei, G-Code für dieses Druckermodell. */

async function gcodeOpenFile(file) {
  if (!file) return;
  if (!printerHost(SEND_PRINTER)) { toast(t('Erst unter ⚙ Einstellungen → Drucker-Verbindung den Drucker einrichten')); return; }
  toast(t('Lade {name} …', { name: file.name }));
  try {
    const r = await lanApi('api/gcode?name=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const f = r.facts || {}, kinds = (f.types || []).map(x => ({ kind: kindOfType(x), name: x }));
    if (!r.plates || !r.plates.length || !(r.plates[0].grams || []).some(g => g > 0))
      toast(t('Im G-Code fehlt die Filament-Statistik von OrcaSlicer – Werkzeuge und Druckzeit unbekannt'));
    openSendDialog(1, { slice: { job: r.job, plates: r.plates }, materials: kinds, name: file.name, own: true, colours: f.colours || [] });
  } catch (e) { toast(t('G-Code nicht übernommen: {msg}', { msg: t(e.message) })); }
}
$('gcodeFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; gcodeOpenFile(f); });
for (const id of ['wbGcode', 'gcodeOpen']) $(id).addEventListener('click', () => $('gcodeFile').click());
