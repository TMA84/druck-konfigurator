'use strict';
/* Sicherung und Umzug (⚙ Einstellungen → Sicherung speichern / einspielen): alles Dauerhafte als EINE JSON-Datei.
   Den Serverteil (Spulen, Druckhistorie, Standardwerte) liefert GET /api/backup (tools/backup.py); die Seite hängt den
   Browserteil an: eigene Filamentprofile (store.profiles), ausgewählte Einstellungen (BK_SETTINGS) und die letzte Auswahl.
   Nicht drin: Bedienzustand (offene Abschnitte, Ansicht, Sprache, Darstellung), Warteschlange, geplanter Druck und das
   geladene Projekt (IndexedDB, js/project-store.js – dafür gibt es den 3MF-Export).
   Einspielen: Datei prüfen → Dialog (Zusammenführen / Ersetzen, Ersetzen mit Rückfrage) → POST /api/backup (der Server
   prüft alles, bevor er schreibt) → erst danach der Browserteil → Seite neu laden, damit alle Teile den neuen Stand lesen. */

const BK_FORMAT = 'druckwerkstatt-backup', BK_VERSION = 1, BK_MAX_BYTES = 8 * 1024 * 1024;
// Einstellungen, die zum Umzug gehören, mit erwarteter Art; alles andere bleibt im Browser (Bedienzustand)
const BK_SETTINGS = {
  steelOffset: 'number', steelVol: 'number', aceFlush: 'number', packGap: 'number', prepS: 'number', sliceMsPerPlate: 'number',
  costAuto: 'boolean', ovAll: 'boolean',
  costs: 'object', filamentPrices: 'object', typePrices: 'object', manualSlots: 'object', aceCount: 'object',
  printerHosts: 'object', printerLinkMode: 'object', acePurgeOwn: 'object?'
};
let bkPending = null;   // {name, data, summary} – Datei, die gerade im Dialog steht

// Wert aus der Datei: nur einfache Daten (Zahl, wahr/falsch, null, kurzer Text ohne Markup, Listen/Objekte begrenzt)
function bkPlain(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= 200 && !/[<>]/.test(v);
  if (depth >= 4 || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.length <= 200 && v.every(x => bkPlain(x, depth + 1));
  const keys = Object.keys(v);
  return keys.length <= 300 && keys.every(k => /^[\w.\-|: ]{1,80}$/.test(k) && !PROFILE_DROP.has(k) && bkPlain(v[k], depth + 1));
}
function bkCleanSettings(s) {
  const out = {};
  if (!s || typeof s !== 'object' || Array.isArray(s)) return out;
  for (const [k, kind] of Object.entries(BK_SETTINGS)) {
    if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
    const v = s[k];
    if (kind === 'object?' && v === null) out[k] = null;
    else if (kind.startsWith('object') ? v && typeof v === 'object' && !Array.isArray(v) && bkPlain(v) : typeof v === kind && bkPlain(v)) out[k] = v;
  }
  return out;
}
function bkCleanProfiles(p) {
  const out = {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
  for (const id of Object.keys(p)) {
    if (!/^[\w.-]{1,64}$/.test(id) || PROFILE_DROP.has(id)) continue;
    const c = sanitizeProfile(p[id]);
    if (c) out[id] = Object.assign({}, P({}), c);
  }
  return out;
}
function bkCleanLast(l) {
  const out = {};
  if (!l || typeof l !== 'object' || Array.isArray(l)) return out;
  for (const k of Object.keys(l)) {
    const v = l[k];
    if (PROFILE_DROP.has(k) || !/^\w{1,40}$/.test(k) || v == null) continue;
    if (typeof v !== 'object') { if (bkPlain(v)) out[k] = v; }
    else if (k === 'orcaPrinter' && !Array.isArray(v)) out[k] = { vendor: String(v.vendor || '').slice(0, 100), name: String(v.name || '').slice(0, 200) };
  }
  return out;
}

async function bkSave() {
  try {
    const r = await fetch('api/backup', { cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) throw Error(t((d && d.error) || 'Server antwortet mit HTTP {status}', { status: r.status }));
    d.browser = { profiles: store.profiles, settings: bkCleanSettings(store.settings), last: store.last };
    const name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'druckwerkstatt-sicherung.json';
    downloadJSON(JSON.stringify(d), name);
    toast(t('Sicherung gespeichert'));
  } catch (e) { toast(t('Sicherung nicht möglich: {msg}', { msg: e.message })); }
}

function bkSummary(d) {
  const s = (d.server && d.server.spools) || {}, b = d.browser || {};
  const n = x => Array.isArray(x) ? x.length : (x && typeof x === 'object' ? Object.keys(x).length : 0);
  return { spools: n(s.spools), history: n(s.history), prefs: n(d.server && d.server.prefs && d.server.prefs.ovDefaults),
    profiles: Object.keys(bkCleanProfiles(b.profiles)).length, settings: Object.keys(bkCleanSettings(b.settings)).length };
}
function bkRender() {
  const p = bkPending, s = p.summary, when = p.data.exported ? new Date(p.data.exported * 1000).toLocaleString(LOCALE()) : '–';
  const row = (label, v) => '<li>' + esc(label) + ': <b>' + esc(String(v)) + '</b></li>';
  $('backupBody').innerHTML = '<p>' + esc(t('Datei {file}, gesichert am {date}:', { file: p.name, date: when })) + '</p><ul>' +
    row(t('Spulen'), s.spools) + row(t('Drucke in der Historie'), s.history) + row(t('eigene Standardwerte (Drucker/Filament)'), s.prefs) +
    row(t('eigene Filamentprofile'), s.profiles) + row(t('Einstellungen (Kosten, Preise, Slots, Drucker-Adressen …)'), s.settings) + '</ul>' +
    '<p class="muted small">' + esc(t('Zusammenführen gleicht Spulen ab (neuerer Stand gewinnt) und nimmt Unbekanntes dazu. Ersetzen übernimmt alles genau wie in der Datei – der bisherige Stand geht verloren. Danach lädt die Seite neu.')) + '</p>';
}
async function bkRestore(mode) {
  const p = bkPending;
  if (!p) return;
  if (mode === 'replace' && !confirm(t('Wirklich ersetzen? Spulen, Druckhistorie, Standardwerte und eigene Profile werden durch den Stand der Datei ersetzt.'))) return;
  const btns = [$('backupMerge'), $('backupReplace')];
  btns.forEach(b => { b.disabled = true; });
  try {
    const { browser, ...server } = p.data;
    const r = await fetch('api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, data: server }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(t(d.error || 'Server antwortet mit HTTP {status}', { status: r.status }));
    if (browser) {   // erst nach dem Server: schlägt dort etwas fehl, bleibt auch der Browser, wie er war
      const prof = bkCleanProfiles(browser.profiles), set = bkCleanSettings(browser.settings), last = bkCleanLast(browser.last);
      if (mode === 'replace') { store.profiles = prof; store.last = last; }
      else { Object.assign(store.profiles, prof); Object.assign(store.last, last); }
      Object.assign(store.settings, set);
      persist();
    }
    bkPending = null;
    $('backupDlg').close();
    toast(t('Sicherung eingespielt – Seite lädt neu'));
    setTimeout(() => location.reload(), 1200);
  } catch (e) { toast(t('Einspielen fehlgeschlagen: {msg}', { msg: e.message })); }
  finally { btns.forEach(b => { b.disabled = false; }); }
}

$('backupSave').addEventListener('click', bkSave);
$('backupLoad').addEventListener('click', () => $('backupFile').click());
$('backupFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    if (file.size > BK_MAX_BYTES) throw Error(t('Datei zu groß (höchstens 8 MB)'));
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || data.format !== BK_FORMAT) throw Error(t('Keine Sicherung der Druckwerkstatt'));
    if (!Number.isInteger(data.version) || data.version > BK_VERSION) throw Error(t('Sicherung aus einer neueren Version der Druckwerkstatt – bitte zuerst aktualisieren'));
    if (!data.server || typeof data.server !== 'object') throw Error(t('Sicherung ohne Serverteil'));
    bkPending = { name: file.name, data, summary: bkSummary(data) };
    bkRender();
    $('backupDlg').showModal();
  } catch (err) { toast(t('Einspielen fehlgeschlagen: {msg}', { msg: err instanceof SyntaxError ? t('keine gültige JSON-Datei') : err.message })); }
});
$('backupMerge').addEventListener('click', () => bkRestore('merge'));
$('backupReplace').addEventListener('click', () => bkRestore('replace'));
$('backupDlg').addEventListener('close', () => { bkPending = null; });
