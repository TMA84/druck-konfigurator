'use strict';
/* 3MF bauen im Hintergrund (js/export-ui.js exportBytesAsync): dieselben Exportfunktionen wie im Fenster – bei großen
   Modellen bleibt die Seite beim Kosten-Slicen bedienbar. EXPORT_WORKER_SCRIPTS = Ladeliste (auch tests/export-worker.js).
   Nachricht hin: {lang, i18n: [Adressen der Wörterbücher], args} (args = exportArgsPlain: Vorlage, Ergebnisse, Teile als
   Zahlenarrays), zurück: {bytes, notes} (bytes ohne Kopie) oder {error}. */
const EXPORT_WORKER_SCRIPTS = ['util.js', 'data.js', 'engine.js', 'paint.js', 'holes.js', 'font-hershey.js', 'engrave.js', 'orca-extra.js', 'brim-ears.js', 'nest.js',
  'export3mf-settings.js', 'export3mf-mesh.js', 'export3mf-pack.js', 'export3mf-relayout.js', 'export3mf.js', '../vendor/fflate.min.js'];
if (typeof importScripts === 'function') {
  importScripts(...EXPORT_WORKER_SCRIPTS);
  nestSync = true;   // Anordnen nach Grundfläche gleich hier rechnen (kein weiterer Worker)
  onmessage = e => {
    const { lang, i18n, args } = e.data;
    // Hinweise in der Sprache der Seite (t() aus js/util.js mit denselben Wörterbüchern)
    I18N.lang = lang;
    if (lang !== 'de' && i18n && i18n.length) try { importScripts(...i18n); } catch (err) { console.error('export-worker i18n', err); }
    try {
      const { bytes, notes } = build3mfPlain(args, fflate);
      postMessage({ bytes, notes }, [bytes.buffer]);
    } catch (err) {
      postMessage({ error: String((err && err.message) || err) });
    }
  };
}
