'use strict';
/* Live-Ansicht im Tab ④ Drucker: der geslicte G-Code des laufenden Drucks in 3D, bis zur Schicht, die der Drucker
   meldet – fertige Schichten in Filamentfarbe, die aktuelle orange, die kommenden blass. Umschalter in der
   Kamera-Karte (Kamera | 3D-Fortschritt). Die Vorschau hebt der Server beim Start auf (api/printing/preview,
   tools/serve.py remember_print) – deshalb nur für Drucke, die aus dem Tool gestartet wurden.
   Datenformat und Farben wie in ③ (js/preview-ui.js: parsePreview, hexToRgb01, toolColour).
   Druckkopf (Abschnitt „Druckkopf“ unten): immer an der echten Kopfposition (der Server fragt sie bei offener 3D-Ansicht auch
   während des Drucks ab, api/anycubic/status?pos=1 – am Kobra S1 mit Firmware 2.7.2.7 geprüft am 2026-09-29; der Schalter
   „Echte Kopfposition“ entfiel 2026-10-09) auf der gemeldeten Bahn; fehlt eine frische Position, geschätzt über die Schichtzeit.
   Aufgeteilt (Ladereihenfolge in index.html): js/live-scene.js (Szene, Zustand lv), js/live-mech.js (Mechanik),
   js/live-ace.js (Gehäuse, ACE), js/live-fx.js (Effekte, Lüfter), js/live-head.js (Druckkopf, Schichtfarben); hier Laden,
   Stand vom Drucker (liveUpdate), Restzeit und Umschalter – diese Datei als letzte, ihr Ende läuft beim Laden. */

const LV_RETRY_MS = 20000;
/* Leerlauf (kein Druckauftrag): Szene einmal mit leerer Vorschau aufbauen (Bettmitte), Kopf an die gemeldete Position (falls frisch)
   oder geparkt über der Bettmitte. Rückgabe: true = echte Position, false = geparkt, null = kein WebGL */
function lvIdle(st) {
  if (!lv.idle || !lv.data) {
    if (!lvInit()) return null;
    const b = lvBed(), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    lv.data = { count: 0, bbox: [cx - 1, cy - 1, 0, cx + 1, cy + 1, 1], layers: [], q: new Uint16Array(0), a: new Uint8Array(0), v: null, types: [] };
    lv.idle = true; lv.missing = false; lv.hs = null; lv.disp = null;
    lvResize(); lvBuild();
  }
  const p = st && st.position, real = !!(p && st.position_age_s != null && st.position_age_s < LV_POS_FRESH_S && Number.isFinite(+p.x));
  lv.hs = null; lv.head.visible = true;
  lvPlaceHead(real ? { x: +p.x - lv.cx, y: +p.y - lv.cy, z: +p.z } : { x: 0, y: 0, z: 40 });
  lvRender();
  return real;
}
async function lvLoad(name) {
  lv.name = name; lv.data = null; lv.missing = false; lv.loading = true; lv.idle = false;
  $('wbLiveNote').textContent = t('Lade 3D-Ansicht …'); $('wbLiveNote').classList.remove('hidden');
  try {
    const r = await fetch('api/printing/preview?name=' + encodeURIComponent(name));
    if (lv.name !== name) return;
    if (!r.ok) { lv.missing = true; lv.missingAt = Date.now(); return; }
    lv.data = parsePreview(await r.arrayBuffer()); lv.filRgb = null; lv.filTool = null;
    // Werkzeug → Slot vom Start (fehlt bei älteren Drucken: Werkzeug n = Slot n)
    lv.toolSlot = await fetch('api/printing/slots?name=' + encodeURIComponent(name)).then(q => q.ok ? q.json() : {}).then(j => (j && j.slots) || {}, () => ({}));
    if (lv.name !== name) return;
    if (!lvInit()) { lv.missing = true; return; }
    lvResize(); lvBuild();
    if (typeof skDrawLines === 'function' && wb.st && wb.st.job) skDrawLines(new Set(wb.st.job.skipped || []));
  } catch (e) { lv.missing = true; lv.missingAt = Date.now(); }
  finally { lv.loading = false; if (wb.st) liveUpdate(wb.st); }
}

// Aus der Werkbank bei jedem Stand (alle 3 s): passende Vorschau laden, Schicht nachführen
function liveUpdate(st) {
  lvFx(st); lvAceColours(st); lvDisplay(st);
  // Spule gewechselt (andere Farbe im Slot): gedruckte Bahnen und Schlauch neu einfärben
  const ck = st && st.ace ? aceSlots(st).map(s => s.colour).join() : '';
  if (ck !== lv.aceKey) { lv.aceKey = ck; lv.filRgb = null; lv.filTool = null; if (lv.data && lv.mesh && lv.shown >= 0) lvColour(lv.shown, lv.shownDone); }
  const job = st && st.job, card = $('wbLiveStage');
  if (!card) return;
  if (!job || !job.name) {
    // ohne Druckauftrag: Drucker, Gehäuse und ACE trotzdem zeigen (leeres Bett, Kopf an der gemeldeten Stelle oder geparkt)
    lv.at = null; lv.name = null;
    const real = lvIdle(st);
    if (real == null) { $('wbLiveNote').textContent = t('Kein Druck aktiv.'); $('wbLiveNote').classList.remove('hidden'); return; }
    $('wbLiveNote').classList.add('hidden');
    return;
  }
  // fehlte die Vorschau, alle 20 s erneut fragen (der Server legt sie beim Start ab – ein früher Abruf kam zu früh)
  if (!lv.loading && (job.name !== lv.name || (lv.missing && Date.now() - (lv.missingAt || 0) > LV_RETRY_MS))) { lvLoad(job.name); return; }
  if (lv.loading) return;
  if (lv.missing || !lv.data) {
    $('wbLiveNote').textContent = t('Für diesen Druck gibt es keine 3D-Ansicht – sie steht nur für Drucke bereit, die aus dem Tool gestartet wurden.');
    $('wbLiveNote').classList.remove('hidden');
    return;
  }
  $('wbLiveNote').classList.add('hidden');
  // Schicht des Druckers (1-basiert, eigene Zählung) auf die Schichten der Vorschau abbilden
  const n = lv.data.layers.length, L = +job.layer || 0, T = +job.layers || 0;
  const cur = T > 0 ? Math.min(n - 1, Math.max(0, Math.round(L / T * n) - 1)) : Math.min(n - 1, Math.max(0, L - 1));
  // Mit echter Kopfposition: Schicht aus der gemeldeten Höhe und wie weit sie ist (genauer als die Schichtzahl des Druckers)
  const head = lv.head ? lvHeadSet(st, cur, L, T) : null, onPath = head && head.snapped;
  const li = onPath ? head.li : cur;
  // neue Schicht: blass; was der Kopf abfährt, färbt lvHeadTick nach und nach orange (ohne Kopf: ganz orange)
  if (li !== lv.shown || !!head !== (lv.shownDone != null)) lvColour(li, head ? lv.data.layers[li][1] : null);
  lv.at = { li, frac: onPath ? head.frac : 0.5 };   // für die eigene Restzeit (lvRemaining)
  // keine Statuszeile mehr: Fortschritt, Schicht und Restzeit stehen im Display am Drucker (lvDisplay, 2026-10-09)
}

/* Eigene Restzeit (Tab ④ „Verbleibend“, „Fertig um“): Orcas Gesamtzeit (orca_s) verteilt nach dem Anteil jeder Schicht
   (layer_s: Weg/Vorschub aller Bewegungen plus Farbwechsel mit der Wechselzeit des Profils, tools/gcode_preview.py); ab der
   aktuellen Schicht aufsummiert. Läuft der Druck schneller oder langsamer als geschätzt, gleicht das gemessene Tempo
   (gedruckte Zeit des Druckers gegen die geschätzte bis hier) es nach und nach aus. null = keine Daten (ältere Vorschau). */
const LV_PACE_MIN = 0.75, LV_PACE_MAX = 1.5, LV_PACE_FULL_S = 3600, LV_PACE_FROM_S = 900;
const LV_PREP_DEFAULT_S = 420, LV_PREP_MIN_S = 60, LV_PREP_MAX_S = 1800;
function lvRemaining(st) {
  const d = lv.data, job = st && st.job;
  if (!d || !job || !Array.isArray(d.layer_s) || !d.orca_s || !lv.at || d.layer_s.length !== d.layers.length) return null;
  const ls = d.layer_s, tot = ls.reduce((s, v) => s + v, 0);
  if (!(tot > 0)) return null;
  // gelernte Druckzeit (js/costs-ui.js timeK): Orcas Gesamtzeit vorab angepasst, das gemessene Tempo gleicht den Rest aus
  const orcaS = d.orca_s * (typeof timeK === 'function' ? timeK() : 1);
  const k = orcaS / tot, li = Math.min(ls.length - 1, Math.max(0, lv.at.li));
  let before = 0; for (let i = 0; i < li; i++) before += ls[i];
  const done = k * (before + lv.at.frac * ls[li]), rest = Math.max(0, orcaS - done);
  const el = (+job.elapsed_min || 0) * 60;
  /* Vorbereitung vor der ersten Schicht (Bett vermessen, Aufheizen) rechnet Orca nicht mit – am S1 gemessen ~7 min
     (2026-10-01: 99,7 min echt, Orca 92,6 min). Das Tool merkt sich die Dauer je Druck (store.settings.prepS) und
     zählt sie getrennt: vorher kommt sie auf die Restzeit, danach nicht mehr ins Tempo. */
  const prepEst = +store.settings.prepS > 0 ? +store.settings.prepS : LV_PREP_DEFAULT_S;
  if (lv.prep.job !== job.name) lv.prep = { job: job.name, s: null };
  if (!(+job.layer >= 1)) return { s: orcaS + Math.max(LV_PREP_MIN_S, prepEst - el), pace: 1, prep: true };
  if (lv.prep.s == null) {
    // erste Schicht gerade begonnen: bis hierher war Vorbereitung (nur wenn der Druck von Anfang an zu sehen war)
    lv.prep.s = el > 0 && el < LV_PREP_MAX_S && done < 120 ? el : prepEst;
    if (el > 0 && el < LV_PREP_MAX_S && done < 120) { store.settings.prepS = Math.round(+store.settings.prepS > 0 ? (+store.settings.prepS + el) / 2 : el); persist(); }
  }
  // Tempo: gedruckte Zeit laut Drucker (ohne Vorbereitung) gegen die geschätzte – erst ab ¼ h, voll ab 1 h
  const run = Math.max(0, el - lv.prep.s);
  let pace = 1;
  if (done > LV_PACE_FROM_S && run > 0) {
    const w = Math.min(1, done / LV_PACE_FULL_S);
    pace = 1 + w * (Math.min(LV_PACE_MAX, Math.max(LV_PACE_MIN, run / done)) - 1);
  }
  return { s: rest * pace, pace };
}

// Umschalter Kamera | 3D-Fortschritt (Wahl bleibt gespeichert)
function liveMode(mode) {
  lv.mode = mode;
  if (!EMBED_3D) { store.settings.wbView = mode; persist(); }
  const live = mode === 'live';
  $('wbLiveStage').classList.toggle('hidden', !live);
  document.querySelector('.wb-video').classList.toggle('hidden', live);
  document.querySelectorAll('[data-wb-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.wbView === mode)));
  if (live) { if (lv.renderer) setTimeout(lvResize); if (wb.st) liveUpdate(wb.st); }
  // Kamera nur, wenn sie zu sehen ist (js/workbench-ui.js wbCamAuto)
  if (live) { if (wb.player) wbCamOff(); } else if (typeof wbCamAuto === 'function') wbCamAuto();
}
document.querySelectorAll('[data-wb-view]').forEach(b => b.addEventListener('click', () => liveMode(b.dataset.wbView)));
$('wbLiveGhost').value = lvGhostMode();
$('wbLiveGhost').addEventListener('change', e => { store.settings.liveGhost = e.currentTarget.value; persist(); lvGhostApply(); });
for (const [id, key, grp] of [['wbLiveEnc', 'liveEnclosure', 'enclosureG'], ['wbLiveAce', 'liveAce', 'aceG']]) {
  $(id).checked = store.settings[key] !== false;
  $(id).addEventListener('change', e => { store.settings[key] = e.currentTarget.checked; persist(); if (lv[grp]) { lv[grp].visible = e.currentTarget.checked; if (lv.head && lv.head.visible) lvMechUpdate(lv.head.position, true); lvRefit(); lvRender(); } });
}
liveMode(!EMBED_3D && store.settings.wbView === 'cam' ? 'cam' : 'live');
