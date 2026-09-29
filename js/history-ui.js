'use strict';
/* Druckhistorie & Statistik (⚙ Einstellungen → Farben & Kosten). Quelle: die Druckhistorie der Filamentverwaltung
   (tools/spools.py, bis 500 Drucke) über GET api/spools/export. Je Druck: echter Verbrauch (g) je Spule, Kosten
   (g × €/kg der Spule bzw. Standardpreis), Dauer, Farbwechsel und – bei Drucken aus diesem Tool – die Schätzung
   (Orca-Gramm, Zeit, Filamentkosten).
   Anzeige: Summen für diesen Monat und die letzten 12 Monate, Balken je Monat (Gramm nach Filamenttyp gestapelt),
   Tabelle der Drucke (neueste zuerst) mit Filter nach Monat, Export als CSV.

   Plan (Schätzung) an den Server: Startet die Seite einen Druck (Senden-Dialog, auch aus der Warteschlange), geht
   POST api/anycubic/print über fetch. Diese Datei hängt sich an window.fetch und schickt nach einer erfolgreichen
   Antwort {action: plan, job_name, plate, estimate} an api/spools – ohne js/send-ui.js zu ändern. */

const HIST_TYPES = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];          // feste Reihenfolge = feste Farbe (css/history.css)
let histData = null, histMonth = '', histErr = '';

/* ---------- Plan beim Druckstart ---------- */
// Filamentkosten der Schätzung wie ③ (js/costs.js): Filament + Spülabfall, ohne Strom/Verschleiß – vergleichbar mit dem echten Verbrauch
function histEstimate(req) {
  const ctx = typeof sendCtx !== 'undefined' && sendCtx && sendCtx.slice ? sendCtx : null;
  const slice = ctx && ctx.slice.job === req.job ? ctx.slice : typeof costState !== 'undefined' && costState.slice && costState.slice.job === req.job ? costState.slice : null;
  const p = slice && (slice.plates || []).find(x => +x.plate === +req.plate);
  if (!p) return null;
  const est = { grams: (p.grams || []).map(g => Math.round((+g || 0) * 100) / 100), total_g: p.total_g, time_s: p.time_s, name: String(req.name || '').slice(0, 200) };
  try {
    const mats = (ctx && ctx.materials) || (typeof costState !== 'undefined' && costState.materials) || {};
    const live = typeof slotChoices === 'function' ? slotChoices() : [], slots = [];
    (p.grams || []).forEach((g, i) => { const lt = live[i] && live[i].present ? live[i].type : ''; slots[i] = { pricePerKg: slotPrice(mats[i], lt, i) }; });
    const r = computeCosts({ total: p }, slots, costPurge(), costCfg());
    est.cost_eur = Math.round(r.lines.filter(l => l.key === 'filament' || l.key === 'purge').reduce((s, l) => s + l.eur, 0) * 1000) / 1000;
    est.cost_total_eur = Math.round(r.total * 1000) / 1000;
  } catch (e) { /* ohne Preise: nur Gramm und Zeit */ }
  return est;
}
// Dateiname auf dem Drucker wie tools/serve.py: <name>_Platte<n>.gcode (der Server liefert ihn als filename zurück)
const histJobName = (req, res) => (res && res.filename) || String(req.name || 'druck').replace(/[^\p{L}\p{N}_.\-]+/gu, '_').slice(0, 80) + '_Platte' + parseInt(req.plate, 10);
function histSendPlan(req, res) {
  const estimate = histEstimate(req);
  if (!estimate) return;
  fetch('api/spools', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'plan', job_name: histJobName(req, res), plate: parseInt(req.plate, 10), estimate }) }).catch(() => {});
}
if (typeof window !== 'undefined' && window.fetch && !window.fetch.histWrapped) {
  const origFetch = window.fetch;
  const wrapped = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input && input.url || '';
      if (/(^|\/)api\/anycubic\/print(\?|$)/.test(url) && init && String(init.method || '').toUpperCase() === 'POST' && typeof init.body === 'string') {
        const req = JSON.parse(init.body);
        p.then(r => { if (r.ok) r.clone().json().then(res => histSendPlan(req, res), () => histSendPlan(req, null)); }, () => {});
      }
    } catch (e) { /* nie den Druckstart stören */ }
    return p;
  };
  wrapped.histWrapped = true;
  window.fetch = wrapped;
}

/* ---------- Daten ---------- */
const histMonthKey = ts => { const d = new Date(ts * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const histMonthLabel = (key, long) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(LOCALE(), long ? { month: 'long', year: 'numeric' } : { month: 'short' }); };
const histTypeKey = type => { const T = String(type || '').toUpperCase(); return HIST_TYPES.find(k => T.startsWith(k)) || (T && T !== '?' ? 'other' : 'unknown'); };
const histTypeLabel = k => k === 'other' ? t('Sonstige') : k === 'unknown' ? t('unbekannt') : k;
const histDur = s => typeof duration === 'function' ? duration(s) : Math.round(s / 60) + ' min';

// Druckname lesbar: Pfad, Endung und „_Platte<n>“ weg, dann wie die Werkbank (wbJobTitle)
function histTitle(h) {
  let raw = String(h.job || '').replace(/^.*[\\/]/, '').replace(/(\.(gcode|3mf|gco|g))+$/i, ''), plate = '';
  const m = /_Platte(\d+)$/.exec(raw);
  if (m) { plate = t('Platte {n}', { n: +m[1] }); raw = raw.slice(0, m.index); }
  const w = typeof wbJobTitle === 'function' ? wbJobTitle(raw) : { title: raw.replace(/_/g, ' '), sub: '' };
  return { title: (h.estimate && h.estimate.name) || w.title || raw, sub: [plate, w.sub].filter(Boolean).join(' · ') };
}

// Einträge vereinheitlichen (ältere Drucke ohne grams_total/cost_eur/types: aus used und den Spulen rechnen)
function histRows(d) {
  const byId = Object.fromEntries((d.spools || []).map(s => [s.id, s]));
  const dflt = d.price_default > 0 ? d.price_default : typeof costCfg === 'function' ? costCfg().pricePerKg : 25;
  return (d.history || []).filter(h => h && h.end).map(h => {
    const used = h.used || {};
    const grams = typeof h.grams_total === 'number' ? h.grams_total : Object.values(used).reduce((s, g) => s + (+g || 0), 0);
    let cost = h.cost_eur, types = h.types;
    if (typeof cost !== 'number') cost = Object.entries(used).reduce((s, [id, g]) => { const sp = byId[id]; return s + g / 1000 * (sp && sp.price_per_kg > 0 ? sp.price_per_kg : dflt); }, 0);
    if (!types) { types = {}; Object.entries(used).forEach(([id, g]) => { const k = byId[id] ? byId[id].type : '?'; types[k] = (types[k] || 0) + g; }); }
    const byType = {};
    Object.entries(types).forEach(([k, g]) => { const tk = histTypeKey(k); byType[tk] = (byType[tk] || 0) + (+g || 0); });
    const dur = typeof h.duration_s === 'number' ? h.duration_s : h.start ? h.end - h.start : 0;
    return { h, end: h.end, month: histMonthKey(h.end), grams, cost, byType, dur: Math.max(0, dur), changes: h.changes || 0, est: h.estimate || null, name: histTitle(h) };
  }).sort((a, b) => b.end - a.end);
}
const histSum = rows => rows.reduce((s, r) => ({ n: s.n + 1, g: s.g + r.grams, eur: s.eur + r.cost, h: s.h + r.dur / 3600 }), { n: 0, g: 0, eur: 0, h: 0 });
// Die letzten 12 Monate (einschließlich des laufenden), älteste zuerst
function histMonths(now) {
  const d = now || new Date(), out = [];
  for (let i = 11; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')); }
  return out;
}
const histPct = (real, est) => est > 0 ? (real - est) / est * 100 : null;

/* ---------- Anzeige ---------- */
function histTiles(label, s) {
  return '<div class="hs-sum"><h4>' + label + '</h4><dl>' +
    '<div><dt>' + t('Drucke') + '</dt><dd>' + s.n + '</dd></div>' +
    '<div><dt>' + t('Filament') + '</dt><dd>' + de(s.g / 1000, 2) + ' kg</dd></div>' +
    '<div><dt>' + t('Kosten') + '</dt><dd>' + de(s.eur, 2) + ' €</dd></div>' +
    '<div><dt>' + t('Druckzeit') + '</dt><dd>' + de(s.h, 1) + ' h</dd></div></dl></div>';
}

// Balken je Monat, Gramm nach Filamenttyp gestapelt (inline SVG). Klick auf einen Monat filtert die Tabelle.
function histChart(rows, months) {
  const per = months.map(m => { const o = {}; rows.filter(r => r.month === m).forEach(r => Object.entries(r.byType).forEach(([k, g]) => { o[k] = (o[k] || 0) + g; })); return o; });
  const keys = HIST_TYPES.map(k => k).concat(['other', 'unknown']).filter(k => per.some(o => o[k] > 0));
  const tot = per.map(o => Object.values(o).reduce((s, g) => s + g, 0)), max = Math.max(...tot, 0);
  if (!(max > 0)) return '<p class="muted small">' + t('In den letzten 12 Monaten noch kein Verbrauch gezählt.') + '</p>';
  // runde Achse: 1, 2, 5 × 10^n
  const step = (() => { const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 5, 10].map(f => f * p).find(v => v >= raw); })();
  const top = Math.ceil(max / step) * step;
  const W = 640, H = 210, L = 46, R = 8, T = 10, B = 26, pw = (W - L - R) / months.length, bw = Math.min(30, pw * 0.62), ph = H - T - B;
  const y = g => T + ph - g / top * ph;
  const gfmt = g => g >= 1000 ? de(g / 1000, g % 1000 ? 1 : 0) + ' kg' : de(g, 0) + ' g';
  let svg = '<svg class="hs-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('Filament je Monat, nach Filamenttyp')) + '">';
  for (let v = 0; v <= top + 1e-9; v += step) svg += '<line class="hs-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="hs-ax" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + gfmt(v) + '</text>';
  months.forEach((m, i) => {
    const x = L + i * pw + (pw - bw) / 2, o = per[i];
    let acc = 0;
    const segs = keys.filter(k => o[k] > 0);
    const tip = histMonthLabel(m, true) + ': ' + gfmt(tot[i]) + (segs.length ? ' – ' + segs.map(k => histTypeLabel(k) + ' ' + gfmt(o[k])).join(', ') : '');
    svg += '<g class="hs-bar' + (histMonth === m ? ' sel' : '') + '" data-hs-month="' + m + '"><title>' + esc(tip) + '</title>' +
      '<rect class="hs-hit" x="' + (L + i * pw).toFixed(1) + '" y="' + T + '" width="' + pw.toFixed(1) + '" height="' + (ph + B) + '"/>';
    segs.forEach((k, j) => {
      const y0 = y(acc), y1 = y(acc + o[k]); acc += o[k];
      const h = Math.max(0, y0 - y1 - (j ? 2 : 0));   // 2 px Abstand zwischen den Stücken
      if (h > 0) svg += '<rect class="hs-t-' + k.toLowerCase() + '" x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '"' + (j === segs.length - 1 ? ' rx="3"' : '') + '/>';
    });
    svg += '<text class="hs-ax' + (histMonth === m ? ' sel' : '') + '" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(histMonthLabel(m)) + '</text></g>';
  });
  svg += '</svg>';
  const legend = '<div class="hs-legend">' + keys.map(k => '<span><i class="hs-t-' + k.toLowerCase() + '"></i>' + esc(histTypeLabel(k)) + '</span>').join('') + '</div>';
  return legend + svg;
}

function histTable(rows) {
  if (!rows.length) return '<p class="muted small">' + t('Keine Drucke in diesem Zeitraum.') + '</p>';
  const body = rows.map(r => {
    const e = r.est, pct = e ? histPct(r.cost, e.cost_eur) : null, gp = e ? histPct(r.grams, e.total_g) : null;
    const estTxt = e && typeof e.cost_eur === 'number' ? '<small>' + t('geschätzt {eur}', { eur: de(e.cost_eur, 2) + ' €' }) +
      (pct != null ? ' <span class="hs-diff' + (Math.abs(pct) >= 15 ? ' big' : '') + '">' + (pct > 0 ? '+' : '') + de(pct, 0) + ' %</span>' : '') + '</small>' : '';
    const gTxt = e && e.total_g > 0 ? '<small>' + t('geschätzt {g}', { g: de(e.total_g, 1) + ' g' }) + (gp != null ? ' (' + (gp > 0 ? '+' : '') + de(gp, 0) + ' %)' : '') + '</small>' : '';
    const date = new Date(r.end * 1000).toLocaleString(LOCALE(), { dateStyle: 'short', timeStyle: 'short' });
    return '<tr><td>' + esc(date) + '</td><td><b>' + esc(r.name.title) + '</b>' + (r.name.sub ? '<small>' + esc(r.name.sub) + '</small>' : '') + '</td>' +
      '<td>' + (r.dur ? histDur(r.dur) : '–') + (e && e.time_s ? '<small>' + t('geschätzt {time}', { time: histDur(e.time_s) }) + '</small>' : '') + '</td>' +
      '<td class="num">' + de(r.grams, 1) + ' g' + gTxt + '</td><td class="num">' + de(r.cost, 2) + ' €' + estTxt + '</td><td class="num">' + (r.changes || '–') + '</td></tr>';
  }).join('');
  return '<div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>' + t('Datum') + '</th><th>' + t('Druck') + '</th><th>' + t('Dauer') + '</th><th class="num">' + t('Filament') + '</th><th class="num">' +
    t('Kosten (echt)') + '</th><th class="num">' + t('Farbwechsel') + '</th></tr></thead><tbody>' + body + '</tbody></table></div>';
}

function renderHistoryDialog() {
  const body = $('historyBody');
  if (!histData) { body.innerHTML = '<p class="note' + (histErr ? ' bad' : '') + '">' + (histErr || t('Lade die Druckhistorie …')) + '</p>'; return; }
  const rows = histRows(histData), now = new Date(), months = histMonths(now), cur = months[months.length - 1];
  const last12 = rows.filter(r => r.month >= months[0]);
  const monthsWith = [...new Set(rows.map(r => r.month))];
  if (histMonth && !monthsWith.includes(histMonth) && !months.includes(histMonth)) histMonth = '';
  const shown = histMonth ? rows.filter(r => r.month === histMonth) : rows;
  const withEst = shown.filter(r => r.est && r.est.cost_eur > 0);
  let html = '<div class="hs-sums">' + histTiles(t('Dieser Monat ({month})', { month: esc(histMonthLabel(cur, true)) }), histSum(rows.filter(r => r.month === cur))) +
    histTiles(t('Letzte 12 Monate'), histSum(last12)) + '</div>';
  html += '<h4 class="spool-h">' + t('Filament je Monat') + '</h4>' + histChart(rows, months);
  html += '<div class="hs-filter"><label>' + t('Monat') + ' <select id="historyMonth"><option value="">' + t('Alle ({n} Drucke)', { n: rows.length }) + '</option>' +
    monthsWith.map(m => '<option value="' + m + '"' + (m === histMonth ? ' selected' : '') + '>' + esc(histMonthLabel(m, true)) + '</option>').join('') + '</select></label>' +
    (histMonth ? '<span class="muted small">' + esc(t('{n} Drucke · {kg} kg · {eur}', { n: shown.length, kg: de(histSum(shown).g / 1000, 2), eur: de(histSum(shown).eur, 2) + ' €' })) + '</span>' : '') +
    (withEst.length ? '<span class="muted small">' + esc(t('Echt zu geschätzt (Drucke aus dem Tool): {pct}', { pct: (v => (v > 0 ? '+' : '') + de(v, 0) + ' %')(histPct(withEst.reduce((s, r) => s + r.cost, 0), withEst.reduce((s, r) => s + r.est.cost_eur, 0))) })) + '</span>' : '') + '</div>';
  html += histTable(shown);
  html += '<p class="muted small">' + t('Kosten = gezählter Verbrauch × Preis der Spule (sonst Standardpreis {p} €/kg aus „Preise & Sätze“), nur Filament und Spülabfall. Die Schätzung stammt aus ③ beim Start aus diesem Tool.', { p: de(histData.price_default || 25, 2) }) + '</p>';
  body.innerHTML = html;
}

async function loadHistory() {
  try {
    const r = await fetch('api/spools/export');
    if (!r.ok) throw Error(t('Server antwortet mit HTTP {status}', { status: r.status }));
    histData = await r.json(); histErr = '';
  } catch (e) {
    histData = null;
    histErr = location.protocol.startsWith('http') ? t('Druckhistorie nicht geladen: {msg}', { msg: esc(t(e.message)) }) : t('Die Druckhistorie braucht den Server des Konfigurators (tools/serve.py bzw. den Container).');
  }
  if ($('historyDlg').open) renderHistoryDialog();
}

function openHistoryDialog() {
  renderHistoryDialog();
  if (!$('historyDlg').open) $('historyDlg').showModal();
  loadHistory();
}

/* ---------- CSV ---------- */
function historyCsv(rows) {
  const dec = I18N.lang === 'de' ? ',' : '.', sep = I18N.lang === 'de' ? ';' : ',';
  const n = (v, d) => v == null || isNaN(v) ? '' : Number(v).toFixed(d).replace('.', dec);
  const q = v => { const s = String(v ?? ''); return /["\n\r;,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = [t('Ende'), t('Druck'), t('Platte'), t('Dauer (min)'), t('Filament (g)'), t('Kosten (€)'), t('Geschätzt (g)'), t('Geschätzt (€)'), t('Abweichung Kosten (%)'), t('Farbwechsel'), t('Auftrag')].concat(HIST_TYPES.map(k => k + ' (g)'), [t('Sonstige') + ' (g)']);
  const lines = rows.map(r => {
    const e = r.est || {}, d = new Date(r.end * 1000), pad = x => String(x).padStart(2, '0');
    const iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return [iso, r.name.title, r.name.sub, n(r.dur / 60, 0), n(r.grams, 1), n(r.cost, 2), n(e.total_g, 1), n(e.cost_eur, 2), n(histPct(r.cost, e.cost_eur), 1), r.changes, r.h.job]
      .concat(HIST_TYPES.map(k => n(r.byType[k] || 0, 1)), [n((r.byType.other || 0) + (r.byType.unknown || 0), 1)]).map(q).join(sep);
  });
  return '﻿' + [head.map(q).join(sep)].concat(lines).join('\r\n') + '\r\n';
}
function downloadHistoryCsv() {
  if (!histData) { toast(t('Druckhistorie noch nicht geladen')); return; }
  const rows = histRows(histData), shown = histMonth ? rows.filter(r => r.month === histMonth) : rows;
  const blob = new Blob([historyCsv(shown)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'druckhistorie' + (histMonth ? '-' + histMonth : '') + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('historyBody').addEventListener('change', e => { if (e.target.id === 'historyMonth') { histMonth = e.target.value; renderHistoryDialog(); } });
$('historyBody').addEventListener('click', e => {
  const b = e.target.closest('[data-hs-month]'); if (!b) return;
  histMonth = histMonth === b.dataset.hsMonth ? '' : b.dataset.hsMonth; renderHistoryDialog();
});
$('historyCsv').addEventListener('click', downloadHistoryCsv);
$('historyDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
ACTIONS.history = openHistoryDialog;
