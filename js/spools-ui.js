'use strict';
/* Filamentverwaltung „Spulen & Restmengen“. Den Stand hält der Server (/api/spools, tools/spools.py): Er erkennt die
   Spulen in der ACE (RFID-Artikelnummer, Typ, Farbe) und zählt den Verbrauch beim Drucken selbst mit – auch bei
   Drucken aus anderen Programmen und ohne offene Seite. Restmenge = Füllgewicht − Verbrauch − Spülabfall ± Korrektur.
   Hier: Anzeige (ACE-Kacheln, Slot-Liste, Dialog), Korrekturen (gewogen), eigene Spulen, Warnung bei zu wenig Filament.
   Die Seite nennt dem Server Drucker-Adresse und Spülmenge (config), damit er richtig zählt. */

const SPOOL_POLL_MS = 15000;
let spoolData = null, spoolTimer = 0, spoolCfgSent = '', spoolEdit = null;

const spoolInSlot = i => spoolData && spoolData.spools.find(s => s.slot === i && !s.archived) || null;
const spoolGrams = g => Math.round(g) >= 1000 ? de(g / 1000, 2) + ' kg' : de(g, 0) + ' g';
const spoolPct = s => s.net_g > 0 ? Math.max(0, Math.min(100, s.remaining_g / s.net_g * 100)) : 0;
const spoolName = s => s.name || [s.brand, s.type].filter(Boolean).join(' ') || s.type;
const spoolLow = s => s.remaining_g < Math.min(150, s.net_g * 0.15);

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
  const sig = JSON.stringify(cfg);
  if (sig === spoolCfgSent || (spoolData.host === cfg.host && spoolData.flush === cfg.flush && (spoolData.purge_g || null) === cfg.purge_g)) { spoolCfgSent = sig; return; }
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
  return '<span class="wb-rest' + (spoolLow(s) ? ' low' : '') + '" title="' + esc(t('Restmenge laut Verbrauchszählung – ⚙ Einstellungen → Spulen & Restmengen')) + '"><i style="width:' + spoolPct(s).toFixed(0) + '%"></i></span>' +
    '<small class="wb-rest-g">≈ ' + spoolGrams(s.remaining_g) + '</small>';
}
// Text für die Slot-Liste in ③
const spoolSlotText = i => { const s = spoolInSlot(i); return s ? ' · ≈ ' + spoolGrams(s.remaining_g) : ''; };

// Reicht das Filament? grams je Slot → [{slot, need, have}]
function spoolShortage(grams) {
  if (!spoolData) return [];
  return (grams || []).map((g, i) => ({ slot: i, need: g, sp: spoolInSlot(i) })).filter(x => x.need > 0 && x.sp && x.need > x.sp.remaining_g)
    .map(x => ({ slot: x.slot, need: x.need, have: x.sp.remaining_g }));
}
const spoolShortageText = list => list.map(x => t('Slot {n}: braucht ≈ {need}, auf der Spule sind noch ≈ {have}.', { n: x.slot + 1, need: spoolGrams(x.need), have: spoolGrams(x.have) })).join(' ');

function renderSpoolBits() {
  if (typeof renderSidePanels === 'function' && typeof lastResult !== 'undefined' && lastResult) renderSidePanels();
  if (typeof renderCostPanel === 'function' && typeof lastResult !== 'undefined' && lastResult) renderCostPanel();
  if ($('spoolDlg').open) renderSpoolDialog();
}

/* ---------- Dialog ---------- */
function openSpoolDialog() { spoolEdit = null; renderSpoolDialog(); $('spoolDlg').showModal(); refreshSpools(); }

function renderSpoolDialog() {
  const body = $('spoolBody');
  if (!spoolData) { body.innerHTML = '<p class="note">' + t('Die Filamentverwaltung braucht den Server des Konfigurators (tools/serve.py bzw. den Container).') + '</p>'; return; }
  const all = spoolData.spools, inAce = all.filter(s => s.slot != null).sort((a, b) => a.slot - b.slot);
  const shelf = all.filter(s => s.slot == null && !s.archived), arch = all.filter(s => s.slot == null && s.archived);
  const host = spoolData.host;
  let html = '<p class="muted small">' + (host ? t('Der Server zählt den Verbrauch am Drucker {host} mit – auch wenn diese Seite geschlossen ist.', { host: esc(host) })
    : t('Noch kein Drucker verbunden – ⚙ Einstellungen → Drucker-Verbindung. Danach erkennt der Server die Spulen in der ACE.')) + '</p>';
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
      return '<li><b>' + esc(name) + '</b><small>' + new Date((h.end || 0) * 1000).toLocaleString(LOCALE(), { dateStyle: 'short', timeStyle: 'short' }) + (h.changes ? ' · ' + t('{n} Farbwechsel', { n: h.changes }) : '') + '</small><span>' + (used || '–') + '</span></li>';
    }).join('') + '</ul>';
  }
  body.innerHTML = html;
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
    '<p class="muted small">' + t('Verbraucht bisher ≈ {used} (davon Spülabfall ≈ {purge}). Gewogen: Gewicht mit Spule minus Gewicht der leeren Spule.', { used: spoolGrams(used), purge: spoolGrams(s.purge_g || 0) }) + '</p>' +
    '<div class="spool-actions"><button type="button" class="btn" data-spool-save="' + s.id + '">' + t('Speichern') + '</button>' +
    (s.slot == null ? '<button type="button" class="btn sec" data-spool-arch="' + s.id + '">' + (s.archived ? t('Zurückholen') : t('Archivieren')) + '</button><button type="button" class="btn danger" data-spool-del="' + s.id + '">' + t('Löschen') + '</button>' : '') +
    '</div></div></li>';
}

$('spoolBody').addEventListener('click', async e => {
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
    if (ar) { const s = spoolData.spools.find(x => x.id === ar.dataset.spoolArch); await spoolPost({ action: 'update', id: s.id, archived: !s.archived }); spoolEdit = null; renderSpoolDialog(); }
    if (dl && confirm(t('Spule endgültig löschen?'))) { await spoolPost({ action: 'delete', id: dl.dataset.spoolDel }); spoolEdit = null; renderSpoolDialog(); }
  } catch (err) { toast(t(err.message)); }
});
$('spoolAdd').addEventListener('click', async () => {
  try { const d = await spoolPost({ action: 'add', type: 'PLA', colour: '#FFFFFF' }); spoolEdit = d.spools[d.spools.length - 1].id; renderSpoolDialog(); }
  catch (err) { toast(t(err.message)); }
});
$('spoolDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
ACTIONS.spools = openSpoolDialog;
refreshSpools();
