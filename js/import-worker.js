'use strict';
/* Modell lesen im Hintergrund (js/app.js importInWorker): dieselben Lesefunktionen wie im Fenster (js/import.js, js/stl.js)
   plus die Analyse je Teil (makeGeom) – das Fenster bleibt bei großen Dateien bedienbar und zeigt den Fortschritt.
   Ablauf: Worker meldet {ready}, dann Nachricht hin: {lang, i18n: [Adressen der Wörterbücher], entries: [{name, bytes}]}
   zurück: {progress: 0…1} beliebig oft, dann {imp, geoms} (geoms je Teil ohne name/pos – die setzt das Fenster)
   oder {error, range}. Zahlenarrays gehen ohne Kopie zurück (transfer). */
importScripts('util.js', 'stl.js', 'paint.js', 'import.js', '../vendor/fflate.min.js');
postMessage({ ready: true });   // erst jetzt schickt das Fenster die Bytes (vorher könnte es noch selbst lesen)

onmessage = e => {
  const { lang, i18n, entries } = e.data;
  // Hinweise und Fehlermeldungen in der Sprache der Seite (t() aus js/util.js mit denselben Wörterbüchern)
  I18N.lang = lang;
  if (lang !== 'de' && i18n && i18n.length) try { importScripts(...i18n); } catch (err) { console.error('import-worker i18n', err); }
  let last = -1;
  loadProgress = f => { const p = Math.floor(f * 100); if (p !== last) { last = p; postMessage({ progress: f }); } };
  try {
    // Lesen bis 50 %, Analyse der Teile (Überhänge) den Rest – nach Dreiecken gewichtet
    const imp = progressSub(0, 0.5, () => importModels(entries, fflate));
    const all = imp.parts.reduce((s, p) => s + p.pos.length, 0) || 1;
    let done = 0;
    const geoms = imp.parts.map(p => {
      const from = done / all; done += p.pos.length;
      const g = progressSub(0.5 + 0.5 * from, 0.5 + 0.5 * done / all, () => makeGeom(p.name, p.pos));
      delete g.name; delete g.pos;
      return g;
    });
    // jeden Puffer nur einmal übergeben (Teilstücke derselben Datei, z. B. ungepackte ZIP-Einträge, teilen ihn)
    const buffers = new Set(), add = a => { if (a && ArrayBuffer.isView(a)) buffers.add(a.buffer); };
    imp.parts.forEach((p, i) => { add(p.pos); add(p.paintState); (p.modVols || []).forEach(m => add(m.pos)); const g = geoms[i]; add(g.ang); add(g.area); add(g.bed); add(g.hidden); });
    if (imp.threemf && imp.threemf.zip) Object.values(imp.threemf.zip).forEach(add);
    postMessage({ imp, geoms }, [...buffers]);
  } catch (err) {
    postMessage({ error: String((err && err.message) || err), range: err instanceof RangeError });
  }
};
