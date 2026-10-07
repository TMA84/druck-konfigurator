'use strict';
/* Filamentverwaltung „Spulen & Restmengen“. Den Stand hält der Server (/api/spools, tools/spools.py): Er erkennt die
   Spulen in der ACE (RFID-Artikelnummer, Typ, Farbe) und zählt den Verbrauch beim Drucken selbst mit – auch bei
   Drucken aus anderen Programmen und ohne offene Seite. Restmenge = Füllgewicht − Verbrauch − Spülabfall ± Korrektur.
   Hier: Anzeige (ACE-Kacheln, Slot-Liste, Dialog), Korrekturen (gewogen), eigene Spulen, Warnung bei zu wenig Filament.
   Die Seite nennt dem Server Drucker-Adresse und Spülmenge (config), damit er richtig zählt.
   Neu erkannte Spulen (needs_check) fragt die Seite nach dem Füllgewicht (Hinweis auf der ACE-Karte in ④ und im Dialog).
   Warnschwelle low_g (Server, Standard 100 g): rote Anzeige und Warnung vor dem Drucken, wenn weniger übrig bliebe.
   Export/Import: ganzer Stand als JSON-Datei, zum Umziehen zwischen zwei Servern (Mac ↔ Home-Assistant-Add-on).
   Große Dateien (bis 500 Drucke in der Historie) gehen in Teilen: erst die Spulen, dann die Drucke (import_history).
   Filamentprofil aus einer Spule: „Als Filamentprofil anlegen“ legt ein eigenes Profil (store.profiles, wie „Neues
   Filament“ in js/panel.js) nach dem passenden Standardprofil an und verknüpft es (spool.profile_id).
   spoolProfileForSlot(i) liefert das verknüpfte Profil der Spule im Slot – für die Filamentwahl nach der ACE.
   Druckhistorie & Statistik: js/history-ui.js. */

const SPOOL_POLL_MS = 15000;
let spoolData = null, spoolTimer = 0, spoolCfgSent = '', spoolEdit = null, spoolImport = null;

const spoolInSlot = i => spoolData && spoolData.spools.find(s => s.slot === i && !s.archived) || null;
const spoolGrams = g => Math.round(g) >= 1000 ? de(g / 1000, 2) + ' kg' : de(g, 0) + ' g';
const spoolPct = s => s.net_g > 0 ? Math.max(0, Math.min(100, s.remaining_g / s.net_g * 100)) : 0;
const spoolName = s => s.name || [s.brand, s.type].filter(Boolean).join(' ') || s.type;
const spoolLowG = () => spoolData && typeof spoolData.low_g === 'number' ? spoolData.low_g : 100;
const spoolLow = s => s.remaining_g < spoolLowG();
const SPOOL_IMPORT_CHUNK = 56 * 1024;   // der Server nimmt höchstens 64 KB je Anfrage (tools/serve.py MAX_BODY)
const spoolChecks = () => spoolData ? spoolData.spools.filter(s => s.slot != null && s.needs_check && !s.archived).sort((a, b) => a.slot - b.slot) : [];

async function refreshSpools() {
  clearTimeout(spoolTimer);
  try {
    const r = await fetch('api/spools');
    spoolData = r.ok ? await r.json() : null;
  } catch (e) { spoolData = null; }
  if (spoolData) syncSpoolConfig();
  renderSpoolBits();
  spoolTimer = setTimeout(refreshSpools, SPOOL_POLL_MS);
}

// Drucker-Adresse und Spülmenge an den Server geben (nur wenn sie sich unterscheiden)
function syncSpoolConfig() {
  const host = typeof printerHost === 'function' ? printerHost('kobra_s1') : null;
  if (!host || !spoolData) return;
  const own = typeof acePurgeOwn === 'function' ? acePurgeOwn() : null;
  const cfg = { action: 'config', host, flush: typeof aceFlush === 'function' ? aceFlush() : 1.5, purge_g: own && own.grams > 0 ? own.grams : null };
  // Standardpreis (€/kg) aus „Preise & Sätze“ für die Kosten der Druckhistorie bei Spulen ohne eigenen Preis
  const price = typeof costCfg === 'function' ? costCfg().pricePerKg : null;
  if (price > 0) cfg.price_default = price;
  const sig = JSON.stringify(cfg);
  if (sig === spoolCfgSent || (spoolData.host === cfg.host && spoolData.flush === cfg.flush && (spoolData.purge_g || null) === cfg.purge_g &&
    (!cfg.price_default || spoolData.price_default === cfg.price_default))) { spoolCfgSent = sig; return; }
  spoolCfgSent = sig;
  spoolPost(cfg).catch(() => { spoolCfgSent = ''; });
}

async function spoolPost(body) {
  const r = await fetch('api/spools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(t(d.error || 'Server antwortet mit HTTP {status}', { status: r.status }));
  spoolData = d;
  renderSpoolBits();
  return d;
}

// Kleine Anzeige auf den ACE-Kacheln der Werkbank (js/workbench-ui.js)
function spoolTileHTML(i) {
  const s = spoolInSlot(i); if (!s) return '';
  // anklickbar: öffnet die Spule im Dialog (Restmenge, „Neue Spule eingelegt“)
  return '<button type="button" class="wb-rest-btn" data-spool-open="' + s.id + '" title="' + esc(t('Restmenge laut Verbrauchszählung – anklicken: Spule bearbeiten, neue Spule eingelegt')) + '">' +
    '<span class="wb-rest' + (spoolLow(s) ? ' low' : '') + '"><i style="width:' + spoolPct(s).toFixed(0) + '%"></i></span>' +
    '<small class="wb-rest-g">≈ ' + spoolGrams(s.remaining_g) + '</small></button>';
}
// Text für die Slot-Liste in ③
const spoolSlotText = i => { const s = spoolInSlot(i); return s ? ' · ≈ ' + spoolGrams(s.remaining_g) : ''; };

// Reicht das Filament? grams je Slot → [{slot, need, have, low}]. low: reicht, aber danach bleibt weniger als die Warnschwelle.
function spoolShortage(grams) {
  if (!spoolData) return [];
  const lim = spoolLowG();
  return (grams || []).map((g, i) => ({ slot: i, need: g, sp: spoolInSlot(i) })).filter(x => x.need > 0 && x.sp && (x.need > x.sp.remaining_g || x.sp.remaining_g - x.need < lim))
    .map(x => ({ slot: x.slot, need: x.need, have: x.sp.remaining_g, low: x.need <= x.sp.remaining_g }));
}
// „Zu wenig Filament“ nur, wenn eine Spule wirklich nicht reicht; sonst nur die Warnschwelle unterschritten
const spoolShortagePrefix = list => list.some(x => !x.low) ? t('Zu wenig Filament:') : t('Filament wird knapp:');
const spoolShortageText = list => list.map(x => x.low
  ? t('Slot {n}: danach bleiben nur ≈ {left} (Warnschwelle {lim}).', { n: x.slot + 1, left: spoolGrams(x.have - x.need), lim: spoolGrams(spoolLowG()) })
  : t('Slot {n}: braucht ≈ {need}, auf der Spule sind noch ≈ {have}.', { n: x.slot + 1, need: spoolGrams(x.need), have: spoolGrams(x.have) })).join(' ');

// Neue Spule erkannt: wie viel ist drauf? (ACE-Karte in ④ und Dialog)
function spoolCheckHTML() {
  return spoolChecks().map(s => '<div class="spool-check-row"><span class="spool-sw" style="background:' + esc(s.colour) + '"></span><span>' +
    esc(t('Neue Spule in Slot {n} erkannt ({type}, {colour}) – wie viel ist drauf?', { n: s.slot + 1, type: s.type, colour: s.colour })) + '</span>' +
    '<button type="button" class="linkbtn" data-spool-full="' + s.id + '">' + t('Voll ({g})', { g: spoolGrams(s.net_g) }) + '</button>' +
    '<button type="button" class="linkbtn" data-spool-weigh="' + s.id + '">' + t('Restmenge eingeben …') + '</button></div>').join('');
}
function renderSpoolCheck() {
  const box = $('spoolCheck'); if (!box) return;
  const html = spoolCheckHTML();
  box.classList.toggle('hidden', !html);
  if (box.innerHTML !== html) box.innerHTML = html;
}
async function spoolCheckClick(e) {
  const full = e.target.closest('[data-spool-full]'), weigh = e.target.closest('[data-spool-weigh]');
  if (!full && !weigh) return false;
  try {
    if (full) { await spoolPost({ action: 'update', id: full.dataset.spoolFull, needs_check: false }); toast(t('Spule gespeichert')); }
    else openSpoolDialog(weigh.dataset.spoolWeigh);
  } catch (err) { toast(t(err.message)); }
  return true;
}

function renderSpoolBits() {
  if (typeof renderSidePanels === 'function' && typeof lastResult !== 'undefined' && lastResult) renderSidePanels();
  if (typeof renderCostPanel === 'function' && typeof lastResult !== 'undefined' && lastResult) renderCostPanel();
  renderSpoolCheck();
  // nicht neu zeichnen, während jemand im Dialog tippt
  const typing = $('spoolBody').contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if ($('spoolDlg').open && !typing) renderSpoolDialog();
}

/* ---------- Dialog ---------- */
function openSpoolDialog(editId) {
  spoolEdit = typeof editId === 'string' ? editId : null; spoolImport = null;
  renderSpoolDialog(); if (!$('spoolDlg').open) $('spoolDlg').showModal(); refreshSpools();
  if (spoolEdit) setTimeout(() => { const f = $('spoolBody').querySelector('li.open [data-sf="remaining_g"]'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } }, 50);
}

function renderSpoolDialog() {
  const body = $('spoolBody');
  if (!spoolData) { body.innerHTML = '<p class="note">' + t('Die Filamentverwaltung braucht den Server des Konfigurators (tools/serve.py bzw. den Container).') + '</p>'; return; }
  const all = spoolData.spools, inAce = all.filter(s => s.slot != null).sort((a, b) => a.slot - b.slot);
  const shelf = all.filter(s => s.slot == null && !s.archived), arch = all.filter(s => s.slot == null && s.archived);
  const host = spoolData.host;
  let html = '<p class="muted small">' + (host ? t('Der Server zählt den Verbrauch am Drucker {host} mit – auch wenn diese Seite geschlossen ist.', { host: esc(host) })
    : t('Noch kein Drucker verbunden – ⚙ Einstellungen → Drucker-Verbindung. Danach erkennt der Server die Spulen in der ACE.')) + '</p>';
  if (spoolImport) html += '<div class="spool-import"><b>' + esc(t('Import aus {file}: {n} Spulen', { file: spoolImport.name, n: spoolImport.data.spools.length })) + '</b>' +
    '<span class="muted small">' + t('Zusammenführen: Spulen abgleichen, neuere Angaben gewinnen, unbekannte kommen dazu. Ersetzen: alles aus der Datei übernehmen (die Drucker-Adresse bleibt).') + '</span>' +
    '<span class="spool-actions"><button type="button" class="btn" data-spool-imp="merge">' + t('Zusammenführen') + '</button><button type="button" class="btn sec" data-spool-imp="replace">' + t('Ersetzen') + '</button>' +
    '<button type="button" class="linkbtn" data-spool-imp="">' + t('Abbrechen') + '</button></span></div>';
  const checks = spoolCheckHTML();
  if (checks) html += '<div class="spool-check">' + checks + '</div>';
  html += '<label class="spool-low">' + t('Warnen unter') + ' <input id="spoolLowG" type="number" min="0" max="5000" step="10" value="' + esc(String(spoolLowG())) + '"> g' +
    '<small class="muted">' + t('Rote Anzeige und Warnung vor dem Drucken, wenn weniger übrig bliebe.') + '</small></label>';
  const sec = (title, list, empty) => '<h4 class="spool-h">' + title + '</h4>' + (list.length ? '<ul class="spool-list">' + list.map(spoolRow).join('') + '</ul>' : '<p class="muted small">' + empty + '</p>');
  html += sec(t('In der ACE'), inAce, t('Keine Spule erkannt.'));
  html += sec(t('Im Regal'), shelf, t('Keine – herausgenommene Spulen erscheinen hier und werden beim Wiedereinlegen erkannt.'));
  if (arch.length) html += '<details class="spool-arch"><summary>' + t('Archiviert ({n})', { n: arch.length }) + '</summary><ul class="spool-list">' + arch.map(spoolRow).join('') + '</ul></details>';
  const hist = (spoolData.history || []).slice(-8).reverse();
  if (hist.length) {
    const byId = Object.fromEntries(all.map(s => [s.id, s]));
    html += '<h4 class="spool-h">' + t('Letzte Drucke') + '</h4><ul class="spool-hist">' + hist.map(h => {
      const name = typeof wbJobTitle === 'function' ? wbJobTitle(String(h.job).replace(/^.*\//, '').replace(/\.(gcode|3mf)$/i, '')).title : h.job;
      const used = Object.entries(h.used || {}).map(([id, g]) => { const s = byId[id]; return '<span class="spool-chip"><i style="background:' + esc(s ? s.colour : '#999') + '"></i>' + (s ? esc(s.type) : '?') + ' ' + spoolGrams(g) + '</span>'; }).join('');
      return '<li><b>' + esc(name) + '</b><small>' + new Date((h.end || 0) * 1000).toLocaleString(LOCALE(), { dateStyle: 'short', timeStyle: 'short' }) + (h.changes ? ' · ' + t('{n} Farbwechsel', { n: h.changes }) : '') +
        (typeof h.cost_eur === 'number' ? ' · ≈ ' + de(h.cost_eur, 2) + ' €' : '') + '</small><span>' + (used || '–') + '</span></li>';
    }).join('') + '</ul>' + (typeof openHistoryDialog === 'function' ? '<p class="small"><button type="button" class="linkbtn" data-spool-history>' + t('Alle Drucke & Statistik …') + '</button></p>' : '');
  }
  body.innerHTML = html;
}

/* ---------- Filamentprofil aus einer Spule ---------- */
// Verknüpftes eigenes Profil (nur wenn es im Browser noch existiert)
function spoolProfile(s) {
  if (!s || !s.profile_id || typeof store === 'undefined' || !store.profiles[s.profile_id] || typeof allMats !== 'function') return null;
  return allMats().find(m => m.id === s.profile_id) || null;
}
/* Für die Filamentwahl nach der ACE (z. B. js/design-ui.js slotMaterialChanges, „Filament aus dem ACE übernehmen“):
   id des Filamentprofils, das mit der Spule in Slot i verknüpft ist, sonst null. */
function spoolProfileForSlot(i) {
  const m = spoolProfile(spoolInSlot(i));
  return m ? m.id : null;
}
// PLA/PETG/ABS/ASA/TPU (auch „PLA-CF“, „PETG HF“) → Filamentart der Standardprofile
const spoolKind = type => { const T = String(type || '').toUpperCase(); return ['petg', 'pla', 'abs', 'asa', 'tpu'].find(k => T.startsWith(k.toUpperCase())) || 'pla'; };
const spoolProfileName = s => [s.brand, s.name || s.type].map(x => String(x || '').trim()).filter(Boolean).join(' ');
function spoolProfileHTML(s) {
  const m = spoolProfile(s);
  if (m) return '<p class="muted small">' + t('Filamentprofil: „{name}“', { name: esc(m.name) }) + '</p>';
  if (!s.brand && !s.name) return '';
  return '<p class="small"><button type="button" class="linkbtn" data-spool-profile="' + s.id + '" title="' + esc(t('Eigenes Filamentprofil mit den Startwerten des passenden Standardprofils, verknüpft mit dieser Spule')) + '">' +
    t('Als Filamentprofil anlegen') + '</button> <span class="muted">' + esc(t('„{name}“ nach {type}', { name: spoolProfileName(s), type: KIND_LABEL[spoolKind(s.type)] || s.type })) + '</span></p>';
}
// Wie „Neues Filament“ in js/panel.js: Startwerte des Standardprofils der Art, eigene id, store.profiles + persist()
async function spoolCreateProfile(s) {
  const kind = spoolKind(s.type), base = builtinOf(KIND_TEMPLATE[kind]) || builtinOf('pla');
  const keys = typeof EDIT_KEYS !== 'undefined' ? EDIT_KEYS : Object.keys(base).filter(k => !['id', 'builtin', 'status', 'src'].includes(k));
  const out = {};
  keys.forEach(k => { if (k in base) out[k] = Array.isArray(base[k]) ? base[k].slice() : base[k]; });
  const T = String(s.type || '').toUpperCase();
  Object.assign(out, { name: spoolProfileName(s), kind, abrasive: !!out.abrasive || /\b(CF|GF)\b|-(CF|GF)/.test(T), colour: s.colour,
    notes: t('Aus der Spule angelegt: {type}, Farbe {colour}', { type: s.type, colour: s.colour }) + (s.sku ? ' · RFID ' + s.sku : '') + (s.notes ? '\n' + s.notes : '') });
  const id = 'u' + Date.now().toString(36);
  store.profiles[id] = out;
  if (s.price_per_kg > 0) store.settings.filamentPrices = { ...(store.settings.filamentPrices || {}), [id]: s.price_per_kg };
  persist();
  await spoolPost({ action: 'update', id: s.id, profile_id: id });
  // Auswahlliste neu (die Auswahl bleibt), Ergebnis neu rechnen – wie nach „Neues Filament“
  try { if (typeof fillMaterialSelect === 'function') fillMaterialSelect($('material').value); if (typeof update === 'function') update(); }
  catch (e) { console.warn('Filamentliste nicht aktualisiert', e); }
  toast(t('Filamentprofil „{name}“ angelegt – auswählbar unter „Eigene Filamente“', { name: out.name }));
  return id;
}

function spoolRow(s) {
  const where = s.slot != null ? t('Slot {n}', { n: s.slot + 1 }) : t('zuletzt gesehen {date}', { date: new Date((s.last_seen || s.added) * 1000).toLocaleDateString(LOCALE()) });
  const head = '<div class="spool-row"><span class="spool-sw" style="background:' + esc(s.colour) + '"></span>' +
    '<span class="spool-name"><b>' + esc(spoolName(s)) + '</b><small>' + [where, s.sku ? 'RFID ' + esc(s.sku) : t('ohne RFID')].join(' · ') + '</small></span>' +
    '<span class="spool-rest' + (spoolLow(s) ? ' low' : '') + '"><span class="spool-bar"><i style="width:' + spoolPct(s).toFixed(0) + '%"></i></span><small>' +
    t('{rest} von {net}', { rest: spoolGrams(s.remaining_g), net: spoolGrams(s.net_g) }) + '</small></span>' +
    '<button type="button" class="linkbtn" data-spool-edit="' + s.id + '">' + (spoolEdit === s.id ? t('Schließen') : t('Bearbeiten')) + '</button></div>';
  if (spoolEdit !== s.id) return '<li>' + head + '</li>';
  const f = (k, label, v, attrs) => '<label>' + label + '<input data-sf="' + k + '" value="' + esc(v ?? '') + '" ' + (attrs || '') + '></label>';
  const used = (s.used_g || 0) + (s.purge_g || 0);
  return '<li class="open">' + head + '<div class="spool-form">' +
    f('name', t('Name'), s.name, 'placeholder="' + esc(spoolName(s)) + '"') + f('brand', t('Marke'), s.brand) +
    (s.rfid ? '' : f('type', t('Typ'), s.type) + f('colour', t('Farbe'), s.colour, 'type="color"')) +
    f('net_g', t('Füllgewicht (g, ohne Spule)'), s.net_g, 'type="number" min="0" max="20000" step="10"') +
    f('remaining_g', t('Restmenge jetzt (g, gewogen ohne Spule)'), '', 'type="number" min="0" max="20000" step="1" placeholder="' + de(s.remaining_g, 0) + '"') +
    f('price_per_kg', t('Preis (€/kg)'), s.price_per_kg, 'type="number" min="0" step="0.5" inputmode="decimal"') + f('notes', t('Notiz'), s.notes) +
    spoolProfileHTML(s) +
    '<p class="muted small">' + t('Verbraucht bisher ≈ {used} (davon Spülabfall ≈ {purge}). Gewogen: Gewicht mit Spule minus Gewicht der leeren Spule.', { used: spoolGrams(used), purge: spoolGrams(s.purge_g || 0) }) + '</p>' +
    '<div class="spool-actions"><button type="button" class="btn" data-spool-save="' + s.id + '">' + t('Speichern') + '</button>' +
    (s.slot != null ? '<button type="button" class="btn sec" data-spool-new="' + s.id + '" title="' + esc(t('Die ACE meldet bei gleicher Sorte und Farbe dieselben Werte – so beginnt die Zählung für die neue Spule von vorn; die alte wird archiviert.')) + '">' + t('Neue Spule eingelegt') + '</button>' : '') +
    (s.slot == null ? '<button type="button" class="btn sec" data-spool-arch="' + s.id + '">' + (s.archived ? t('Zurückholen') : t('Archivieren')) + '</button><button type="button" class="btn danger" data-spool-del="' + s.id + '">' + t('Löschen') + '</button>' : '') +
    '</div></div></li>';
}

// Import; zu große Dateien in Teilen (erst Spulen ohne Drucke, dann die Drucke in Stücken mit der id-Zuordnung des Servers)
async function spoolImportPost(mode, data) {
  const body = { action: 'import', mode, data };
  const hist = Array.isArray(data.history) ? data.history : [];
  if (JSON.stringify(body).length <= SPOOL_IMPORT_CHUNK || !hist.length) return spoolPost(body);
  const d = await spoolPost({ action: 'import', mode, data: { ...data, history: [] } }), idmap = (d.imported || {}).idmap || {};
  let part = [], res = d;
  const send = async () => { if (part.length) res = await spoolPost({ action: 'import_history', history: part, idmap }); part = []; };
  for (const h of hist) {
    if (part.length && JSON.stringify({ action: 'import_history', history: part.concat([h]), idmap }).length > SPOOL_IMPORT_CHUNK) await send();
    part.push(h);
  }
  await send();
  return { ...res, imported: d.imported };
}

$('spoolBody').addEventListener('click', async e => {
  if (await spoolCheckClick(e)) return;
  const imp = e.target.closest('[data-spool-imp]');
  if (imp) {
    const mode = imp.dataset.spoolImp, data = spoolImport && spoolImport.data;
    spoolImport = null;
    if (!mode) { renderSpoolDialog(); return; }
    try {
      const d = await spoolImportPost(mode, data), n = d.imported || {};
      toast(mode === 'replace' ? t('Import: {n} Spulen übernommen', { n: n.total || 0 }) : t('Import: {added} Spulen neu, {updated} aktualisiert', { added: n.added || 0, updated: n.updated || 0 }));
    }
    catch (err) { toast(t('Import fehlgeschlagen: {msg}', { msg: t(err.message) })); }
    renderSpoolDialog(); return;
  }
  if (e.target.closest('[data-spool-history]')) { openHistoryDialog(); return; }
  const pr = e.target.closest('[data-spool-profile]');
  if (pr) {
    const s = spoolData.spools.find(x => x.id === pr.dataset.spoolProfile);
    try { if (s) { await spoolCreateProfile(s); renderSpoolDialog(); } } catch (err) { toast(t(err.message)); }
    return;
  }
  const ed = e.target.closest('[data-spool-edit]'), sv = e.target.closest('[data-spool-save]'), ar = e.target.closest('[data-spool-arch]'), dl = e.target.closest('[data-spool-del]');
  try {
    if (ed) { spoolEdit = spoolEdit === ed.dataset.spoolEdit ? null : ed.dataset.spoolEdit; renderSpoolDialog(); return; }
    if (sv) {
      const req = { action: 'update', id: sv.dataset.spoolSave };
      sv.closest('li').querySelectorAll('[data-sf]').forEach(inp => {
        const k = inp.dataset.sf, v = inp.value.trim();
        if (['net_g', 'remaining_g', 'price_per_kg'].includes(k)) { if (v !== '') req[k] = num(v); else if (k === 'price_per_kg') req[k] = null; }
        else req[k] = v;
      });
      if (['net_g', 'remaining_g', 'price_per_kg'].some(k => k in req && req[k] !== null && isNaN(req[k]))) { toast(t('Bitte Zahlen eintragen')); return; }
      await spoolPost(req); spoolEdit = null; renderSpoolDialog(); toast(t('Spule gespeichert'));
    }
    const nw = e.target.closest('[data-spool-new]');
    if (nw) { const s = spoolData.spools.find(x => x.id === nw.dataset.spoolNew);
      if (!confirm(t('Neue Spule in Slot {n} eingelegt? Die bisherige ({name}, ≈ {rest}) wird archiviert, die Zählung beginnt neu.', { n: s.slot + 1, name: spoolName(s), rest: spoolGrams(s.remaining_g) }))) return;
      await spoolPost({ action: 'replace', id: s.id }); spoolEdit = null; renderSpoolDialog(); toast(t('Neue Spule in Slot {n} – bitte Füllgewicht bestätigen', { n: s.slot + 1 })); return; }
    if (ar) { const s = spoolData.spools.find(x => x.id === ar.dataset.spoolArch); await spoolPost({ action: 'update', id: s.id, archived: !s.archived }); spoolEdit = null; renderSpoolDialog(); }
    if (dl && confirm(t('Spule endgültig löschen?'))) { await spoolPost({ action: 'delete', id: dl.dataset.spoolDel }); spoolEdit = null; renderSpoolDialog(); }
  } catch (err) { toast(t(err.message)); }
});
$('spoolAdd').addEventListener('click', async () => {
  try { const d = await spoolPost({ action: 'add', type: 'PLA', colour: '#FFFFFF' }); spoolEdit = d.spools[d.spools.length - 1].id; renderSpoolDialog(); }
  catch (err) { toast(t(err.message)); }
});
$('spoolBody').addEventListener('change', async e => {
  if (e.target.id !== 'spoolLowG') return;
  const v = num(e.target.value);
  if (isNaN(v) || v < 0 || v > 5000) { toast(t('Bitte Zahlen eintragen')); return; }
  try { await spoolPost({ action: 'config', low_g: v }); e.target.blur(); toast(t('Warnschwelle gespeichert')); } catch (err) { toast(t(err.message)); }
});
$('spoolExport').addEventListener('click', () => {
  const a = document.createElement('a'); a.href = 'api/spools/export'; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
});
$('spoolImportBtn').addEventListener('click', () => $('spoolImportFile').click());
$('spoolImportFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw Error(t('Datei zu groß (höchstens 2 MB)'));
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !Array.isArray(data.spools)) throw Error(t('Keine Spulendatei der Druckwerkstatt'));
    delete data.track;
    spoolImport = { name: file.name, data }; renderSpoolDialog(); $('spoolBody').scrollTop = 0;
  } catch (err) { toast(t('Import fehlgeschlagen: {msg}', { msg: err instanceof SyntaxError ? t('keine gültige JSON-Datei') : err.message })); }
});
{ const box = $('spoolCheck'); if (box) box.addEventListener('click', spoolCheckClick); }
$('spoolDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
ACTIONS.spools = openSpoolDialog;
refreshSpools();

// ACE-Kachel der Werkbank: Restmenge anklicken → Spule im Dialog
document.addEventListener('click', e => { const b = e.target.closest('[data-spool-open]'); if (b && typeof openSpoolDialog === 'function') openSpoolDialog(b.dataset.spoolOpen); });
