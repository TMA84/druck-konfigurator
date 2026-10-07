'use strict';
/* Werte für diesen Auftrag anpassen (Schritt ② Druckwerte): je Teil part.overrides = {nozzle: 225, …}.
   compute() (js/engine.js) setzt sie statt des Vorschlags ein – Datenblatt, 3MF, Slicen, Kosten und Drucken
   nutzen dann dieselben Werte. Gilt für alle Platzierungen desselben Objekts; auf Wunsch für alle Teile. */

const OV_PATTERNS = ['Gyroid', 'Kubisch', 'Gitter', 'Waben', 'Linien', 'Dreiecke', 'Kreuzschraffur', 'Blitz'];
const OV_BRIMS = [['Nicht nötig', 'aus'], ['3 mm', '3 mm'], ['5 mm', '5 mm'], ['8 mm', '8 mm'], ['10 mm', '10 mm']];
// Muster- und Brim-Werte bleiben deutsch (export3mf.js ordnet sie Orca-Werten zu); angezeigt wird t(Wert).
// [Schlüssel, Beschriftung, Einheit, min, max, Schritt, Gruppe] – Auswahllisten statt Zahl bei options
const OV_FIELDS = [
  ['nozzle', t('Düse'), '°C', 150, 300, 5, t('Temperatur')], ['nozzle_first', t('Düse erste Schicht'), '°C', 150, 300, 5, t('Temperatur')],
  ['bed', t('Heizbett'), '°C', 0, 110, 5, t('Temperatur')],
  ['layer', t('Schichthöhe'), 'mm', 0.04, 0.6, 0.02, t('Qualität')], ['first_layer', t('Höhe der ersten Schicht'), 'mm', 0.08, 0.6, 0.02, t('Qualität')],
  ['seam', t('Nahtposition'), '', 0, 0, 0, t('Qualität'), ['Hinten', 'Ausgerichtet', 'Nächste', 'Zufällig']],
  ['w', t('Wandlinien'), '', 1, 12, 1, t('Struktur')], ['t', t('Obere Schichten'), '', 0, 30, 1, t('Struktur')], ['b', t('Untere Schichten'), '', 0, 30, 1, t('Struktur')],
  ['inf', t('Fülldichte'), '%', 0, 100, 5, t('Struktur')], ['pattern', t('Füllmuster'), '', 0, 0, 0, t('Struktur'), OV_PATTERNS],
  ['sp_outer', t('Außenwand'), 'mm/s', 10, 600, 5, t('Tempo')], ['sp_inner', t('Innenwand'), 'mm/s', 10, 600, 5, t('Tempo')], ['sp_fill', t('Füllung'), 'mm/s', 10, 600, 5, t('Tempo')],
  ['sp_first', t('Erste Schicht'), 'mm/s', 5, 300, 5, t('Tempo')], ['sp_travel', t('Travel'), 'mm/s', 50, 1000, 10, t('Tempo')],
  ['sp_top', t('Obere Fläche'), 'mm/s', 10, 400, 5, t('Tempo')], ['sp_gap', t('Lückenfüllung'), 'mm/s', 10, 400, 5, t('Tempo')],
  ['accel', t('Beschleunigung (0 = Werksprofil)'), 'mm/s²', 0, 20000, 500, t('Tempo')],
  ['max_vol', t('Max. Volumenstrom'), 'mm³/s', 1, 60, 0.5, t('Tempo')], ['flow', t('Durchflussverhältnis'), '', 0.8, 1.2, 0.01, t('Filament')],
  ['pa', t('Pressure Advance'), '', 0, 0.2, 0.005, t('Filament')], ['zhop', t('Z-Hop'), 'mm', 0, 2, 0.1, t('Filament')],
  // Rückzug: nur wenn gesetzt, sonst das Orca-Profil des Slots
  ['retr_len', t('Rückzug Länge'), 'mm', 0, 10, 0.1, t('Filament')], ['retr_speed', t('Rückzug Geschwindigkeit'), 'mm/s', 5, 150, 5, t('Filament')],
  ['fan', t('Lüfter (Bauteil)'), '%', 0, 100, 5, t('Kühlung')], ['fan_first', t('Lüfter erste Schicht'), '%', 0, 100, 5, t('Kühlung')],
  // nur Kobra S1 (Orca-Profil mit Hilfs- und Abluftlüfter) – bei anderen Druckern ausgeblendet (ovFieldsFor)
  ['fan_aux', t('Hilfslüfter (seitlich)'), '%', 0, 100, 5, t('Kühlung')], ['fan_box', t('Gehäuselüfter (Abluft)'), '%', 0, 100, 5, t('Kühlung')],
  ['support', t('Stützen'), '', 0, 0, 0, t('Stützen'), [['on', t('an')], ['off', t('aus')]]],
  // Orca „Nur kritische Bereiche“: an = Stützen nur für Spitzen/Auskragungen, aus = auch normale Überhänge
  ['critical', t('Nur kritische Bereiche'), '', 0, 0, 0, t('Stützen'), [['on', t('an')], ['off', t('aus')]]], 
  // Brim (2026-10-07): außen und innen getrennt an/aus, Form außen, Abstand; darunter, was in Orca geschrieben wird (ovBrimInfo)
  ['brim', t('Brim außen'), '', 0, 0, 0, t('Brim & Haftung'), OV_BRIMS.map(([v, l]) => [v, t(l)])],
  ['brim_kind', t('Form außen'), '', 0, 0, 0, t('Brim & Haftung'), Object.entries(BRIM_KINDS).map(([v, l]) => [v, t(l)])],
  ['brim_inner', t('Brim innen'), '', 0, 0, 0, t('Brim & Haftung'), BRIM_INNER.map(([v, l]) => [v, t(l)])],
  ['brim_inner_kind', t('Form innen'), '', 0, 0, 0, t('Brim & Haftung'), Object.entries(BRIM_INNER_KINDS).map(([v, l]) => [v, t(l)])],
  ['brim_gap', t('Abstand zum Teil'), 'mm', 0, 1, 0.05, t('Brim & Haftung')]
];
/* Geltungsbereich in Orca: je Teil (Objekt-Einstellung), je Filament-Slot (Filamentprofil) oder für die ganze Platte
   (Prozess). Slot- und Plattenwerte wirkten bisher nur am ersten Teil des Slots bzw. des Projekts – bei mehreren Teilen
   gingen sie am gewählten Teil still verloren (2026-10-04, Probedruck). Jetzt verteilt sie der Dialog selbst. */
const OV_SCOPE = { layer: 'plate', first_layer: 'plate', sp_first: 'plate', sp_travel: 'plate', accel: 'plate',
  nozzle: 'slot', nozzle_first: 'slot', bed: 'slot', fan: 'slot', fan_first: 'slot', fan_aux: 'slot', fan_box: 'slot',
  max_vol: 'slot', flow: 'slot', pa: 'slot', zhop: 'slot', retr_len: 'slot', retr_speed: 'slot' };
const ovSlotOf = q => q.slot ?? (typeof costDefaultSlot === 'function' ? costDefaultSlot() : 0);
const ovPart = () => project && project.parts[project.selected];
/* Alle Felder des Dialogs: berechnete Werte (OV_FIELDS) und weitere Orca-Einstellungen (js/orca-extra.js, Schlüssel „x:…“) */
function ovFields() {
  const extra = typeof ORCA_EXTRA === 'undefined' ? [] : ORCA_EXTRA.map(f => ['x:' + f[0], t(f[1]), f[3] || '', f[4], f[5], Array.isArray(f[6]) ? 0 : f[6], t(f[2]),
    Array.isArray(f[6]) ? f[6].map(([v, l]) => [v, t(l)]) : undefined]);
  const out = OV_FIELDS.slice();
  for (const f of extra) { let at = -1; out.forEach((g, i) => { if (g[6] === f[6]) at = i; }); if (at >= 0) out.splice(at + 1, 0, f); else out.push(f); }
  // nach Thema (Reiter) ordnen, innerhalb des Themas Reihenfolge wie bisher
  const ti = f => { const i = VALUE_THEMES.findIndex(th => t(th) === f[6]); return i < 0 ? VALUE_THEMES.length : i; };
  return out.map((f, i) => [f, i]).sort((a, b) => ti(a[0]) - ti(b[0]) || a[1] - b[1]).map(x => x[0]);
}
const ovScope = k => k.startsWith('x:') ? (typeof ORCA_EXTRA_BY_KEY !== 'undefined' && ORCA_EXTRA_BY_KEY[k.slice(2)] ? ORCA_EXTRA_BY_KEY[k.slice(2)][7] : 'object') : OV_SCOPE[k];
/* Vorschlag für eine weitere Orca-Einstellung: was ohne Eingabe gedruckt würde – der berechnete Wert, wenn das Tool ihn
   setzt (z. B. Stützen), sonst der Wert aus dem Druckerprofil */
function extraSuggestion(r, key) {
  try {
    const own = plannedChanges({ ...r, extraOv: {} }, 0, null).filter(c => c.key === key && !c.perSlot).pop();
    if (own) return own.value;
    const tpl = exportTemplate(r.printer.id, r.dSel), v = tpl && tpl.settings ? tpl.settings[key] : undefined;
    return Array.isArray(v) ? v[0] : v;
  } catch (e) { return undefined; }
}
const ovCount = p => p && p.overrides ? Object.keys(p.overrides).length : 0;
const ovFmt = (f, v) => f[0] === 'accel' && +v === 0 ? t('Werksprofil') : Array.isArray(f[7]) && Array.isArray(f[7][0]) && !f[0].startsWith('x:') ? ((f[7].find(o => String(o[0]) === String(v)) || [, String(v)])[1]) : f[0].startsWith('x:') && typeof extraLabel === 'function' ? extraLabel(f[0].slice(2), v) : f[0] === 'support' || f[0] === 'critical' ? (v === 'on' ? t('an') : t('aus')) : f[0] === 'layer' ? de(v, 2) + ' mm' : (typeof v === 'number' ? de(v, Number.isInteger(v) ? 0 : 2) : t(String(v).replace(/ oder .*/, ''))) + (f[2] && typeof v === 'number' ? ' ' + f[2] : '');

// Fußzeile der Tafel: wie viele Werte angepasst sind, alle zurücknehmen
function renderOverrideBar() {
  const p = ovPart(), n = ovCount(p), r = lastResult;
  const diff = r && r.changed ? r.changed.length : 0;
  $('ovInfo').textContent = !p ? t('Zuerst ein Modell laden.') : n ? t(n > 1 ? '{n} Werte angepasst' : '{n} Wert angepasst', { n }) + (diff < n ? ' ' + t('({n} davon wie der Vorschlag)', { n: n - diff }) : '') + (project.parts.length > 1 ? ' – ' + t('für „{name}“', { name: p.name }) : '') : '';
  $('ovReset').classList.toggle('hidden', !n);
  // eigene Standardwerte für dieses Filament (js/engine.js ovDefaults)
  const nDef = r && r.ovDefaults ? Object.keys(r.ovDefaults).length : 0;
  if (p && nDef) $('ovInfo').textContent += (n ? ' · ' : '') + t('{n} eigene Standardwerte ({mat})', { n: nDef, mat: r.m.name });
  if (typeof ovPanelSync === 'function') ovPanelSync();
}

/* Werte für diesen Auftrag als feste Tafel in ② Druckwerte (2026-10-07, vorher ein Dialog): Reiter nach Thema, je Reiter
   eine Tabelle Einstellung | Wert | Vorschlag – Wert direkt änderbar, gilt beim Verlassen des Felds bzw. bei der Auswahl.
   Dazu reine Anzeigezeilen für Werte ohne Anpassung (z. B. Herstellerbereich). ovPanelSync() zeichnet nur neu, wenn sich
   Teil, Vorschläge oder Anpassungen geändert haben – sonst gingen Eingaben verloren. */
let ovPanelKey = null;
// Vorschläge der weiteren Orca-Einstellungen in einem Durchgang (statt je Feld neu zu rechnen)
function ovExtraSugg(r) {
  const out = {}; if (typeof ORCA_EXTRA === 'undefined') return out;
  let pc = [], tpl = null; try { pc = plannedChanges({ ...r, extraOv: {} }, 0, null); } catch (e) {} try { tpl = exportTemplate(r.printer.id, r.dSel); } catch (e) {}
  for (const f of ORCA_EXTRA) { const c = pc.filter(c => c.key === f[0] && !c.perSlot).pop(); let v = c ? c.value : tpl && tpl.settings ? tpl.settings[f[0]] : undefined; if (Array.isArray(v)) v = v[0]; if (v !== undefined) out['x:' + f[0]] = v; }
  return out;
}
// Anzeigezeilen: Werte aus der Orca-Liste ohne eigenes Feld, nach Thema (js/panel.js ORDER_THEME/ROW_THEME)
function ovReadonlyRows(r) {
  if (typeof ORDER_THEME === 'undefined') return {};
  const keys = new Set(ovFields().map(f => f[0])), by = {}, seen = new Set();
  for (const [g, rows] of r.ordered) { if (!ORDER_THEME[g]) continue;
    for (const x of rows) { const k = ROW_OV_T[t(x[0])] || (ROW_AS_EXTRA[x[0]] ? 'x:' + ROW_AS_EXTRA[x[0]] : null);
      if (k && keys.has(k)) continue;
      const th = ROW_THEME[x[0]] || ORDER_THEME[g], id = th + '|' + x[0]; if (seen.has(id)) continue; seen.add(id);
      (by[t(th)] = by[t(th)] || []).push(x); } }
  return by;
}
function ovRenderPanel() {
  const p = ovPart(), r = lastResult; if (!p || !r) { $('ovRows').innerHTML = ''; $('ovTabs').innerHTML = ''; return; }
  const sugg = { ...(r.suggested || {}) }, own = p.overrides || {}, def = r.ovDefaults || {}, xs = ovExtraSugg(r);
  for (const f of ovFields()) if (f[0].startsWith('x:') && xs[f[0]] !== undefined) { const v = xs[f[0]]; sugg[f[0]] = /^-?\d+(\.\d+)?$/.test(String(v)) && !f[7] ? +v : String(v); }
  const ro = ovReadonlyRows(r), roHtml = th => (ro[th] || []).map(x => '<div class="ov-row ov-ro" data-theme="' + esc(th) + '"><span>' + esc(t(x[0])) + '</span><span class="ov-ro-v">' + x[1] +
    (x[2] ? '<small class="muted">' + x[2] + '</small>' : '') + '</span><span class="ov-sugg"></span><span></span></div>').join('');
  let group = '', html = '';
  for (const f of ovFields().filter(f => !/^fan_(aux|box)$/.test(f[0]) || (r.printer && r.printer.id === 'kobra_s1'))) {
    const [k, label, unit, min, max, step, grp, opts] = f, cur = own[k];
    if (grp !== group) { if (group) html += roHtml(group); html += '<div class="ov-group" data-theme="' + esc(grp) + '">' + esc(grp) + '</div>'; group = grp; }
    const ph = def[k] ?? sugg[k] ?? '';
    const input = opts
      ? '<select data-ov="' + k + '" aria-label="' + esc(label) + '"><option value="">' + esc(t('Vorschlag') + (sugg[k] !== undefined || def[k] !== undefined ? ': ' + ovFmt(f, def[k] ?? sugg[k]) : '')) + '</option>' + opts.map(o => { const [v, txt] = Array.isArray(o) ? o : [o, t(o)]; return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(txt) + '</option>'; }).join('') + '</select>'
      : '<input data-ov="' + k + '" type="number" inputmode="decimal" min="' + min + '" max="' + max + '" step="' + step + '" value="' + (cur ?? '') + '" placeholder="' + esc(ph) + '" aria-label="' + esc(label) + '">' + (unit ? '<small class="ov-unit muted">' + unit + '</small>' : '');
    const sc = project.parts.length > 1 ? ovScope(k) : null;
    const scTxt = sc === 'plate' ? t('gilt für die ganze Platte') : sc === 'slot' ? t('gilt für alle Teile mit Slot {n}', { n: ovSlotOf(p) + 1 }) : '';
    // Erklärung (?) wie im Datenblatt: über die deutsche Zeilenbezeichnung (js/panel.js ROW_OV, helpFor)
    const rowName = typeof ROW_OV !== 'undefined' ? Object.keys(ROW_OV).find(l => ROW_OV[l] === k) : null, hp = rowName && typeof helpFor === 'function' ? helpFor(rowName, r.m.kind) : '';
    html += '<div class="ov-row' + (cur !== undefined ? ' set' : '') + '" data-theme="' + esc(grp) + '"><span>' + esc(label) + (hp ? '<span class="help" title="' + esc(hp) + '">?</span>' : '') + (scTxt ? '<small class="ov-scope muted">' + esc(scTxt) + '</small>' : '') + '</span>' +
      '<span class="ov-in">' + input + '</span>' +
      '<span class="ov-sugg">' + (def[k] !== undefined ? t('Standard {v}', { v: esc(ovFmt(f, def[k])) }) + ' <small class="muted">' + t('Werk {v}', { v: esc(sugg[k] !== undefined ? ovFmt(f, sugg[k]) : '–') }) + '</small>'
        : esc(sugg[k] !== undefined ? ovFmt(f, sugg[k]) : '–')) + '</span>' +
      '<button type="button" class="ov-x" data-ov-x="' + k + '" title="' + t('Vorschlag verwenden') + '"' + (cur === undefined ? ' hidden' : '') + '>×</button></div>';
  }
  if (group) html += roHtml(group);
  for (const th of Object.keys(ro)) if (!html.includes('data-theme="' + esc(th) + '"')) html += '<div class="ov-group" data-theme="' + esc(th) + '">' + esc(th) + '</div>' + roHtml(th);
  $('ovRows').innerHTML = html;
  ovBrimSugg = sugg; ovBrimHoles = undefined;
  { const last = $('ovRows').querySelector('[data-ov="brim_gap"]'); if (last) last.closest('.ov-row').insertAdjacentHTML('afterend', '<div id="ovBrimInfo" class="ov-brim-info muted small" data-theme="' + esc(t('Brim & Haftung')) + '"></div>'); }
  ovTab(ovTabNow && $('ovRows').querySelector('[data-theme="' + CSS.escape(ovTabNow) + '"]') ? ovTabNow : t(VALUE_THEMES[0]));
  ovBrimInfo();
  $('ovAllRow').classList.toggle('hidden', project.parts.length < 2);
  const nDef = Object.keys(def).length;
  $('ovDefSave').textContent = t('Als Standard für {mat} merken', { mat: r.m.name });
  $('ovDefReset').classList.toggle('hidden', !nDef);
  $('ovDefInfo').textContent = nDef ? t('{n} eigene Standardwerte für {mat} auf diesem Drucker aktiv.', { n: nDef, mat: r.m.name }) : '';
}
// nach jedem update(): neu zeichnen, wenn sich etwas Relevantes geändert hat; Fokus und Reiter bleiben
function ovPanelSync() {
  const p = ovPart(), r = lastResult;
  const key = p && r ? JSON.stringify([project.selected, project.parts.length, r.m.id, r.printer.id, r.dSel, p.overrides, r.ovDefaults, r.suggested, typeof LANG !== 'undefined' ? LANG : '']) : '';
  $('ovPanel').classList.toggle('hidden', !p);
  if (key === ovPanelKey) return;
  ovPanelKey = key;
  const a = document.activeElement, fk = a && a.dataset && a.dataset.ov, sc = window.scrollY;
  ovRenderPanel();
  if (fk) { const el = $('ovRows').querySelector('[data-ov="' + fk + '"]'); if (el) el.focus({ preventScroll: true }); }
  window.scrollTo(0, sc);
}
// zu einem Thema oder Wert springen (früher: Dialog öffnen) – aus Kennzahlen, Datenblatt und Hinweisen
function openOverrideDialog(focusGroup) {
  if (!ovPart() || !lastResult) return;
  if (typeof setTab === 'function') setTab('settings');
  ovPanelKey = null; ovPanelSync();
  $('ovSearch').value = '';
  if (typeof focusGroup === 'string') ovTab(focusGroup);
  else if (focusGroup && focusGroup.key) { const el = $('ovRows').querySelector('[data-ov="' + focusGroup.key + '"]'); if (el) ovTab(el.closest('.ov-row').dataset.theme); }
  const el = focusGroup && focusGroup.key ? $('ovRows').querySelector('[data-ov="' + focusGroup.key + '"]') : $('ovRows').querySelector('.ov-row:not([hidden]) [data-ov]');
  $('ovPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (el) { el.focus({ preventScroll: true }); if (focusGroup && focusGroup.key) { el.closest('.ov-row').classList.add('ov-focus'); setTimeout(() => el.closest('.ov-row') && el.closest('.ov-row').classList.remove('ov-focus'), 1600); } }
}
/* Warnung am Feld (sperrt nichts): Düse außerhalb des Herstellerbereichs der Spule, sonst > 30 % vom Vorschlag entfernt –
   der Vorschlag ist der erprobte Stand, × setzt darauf zurück */
function ovWarn(k, v) {
  const r = lastResult, sugg = (r && r.suggested) || {}, s = +sugg[k];
  if (!r || !Number.isFinite(v)) return '';
  if (k === 'nozzle' || k === 'nozzle_first') {
    const m = /(\d+)\s*[–-]\s*(\d+)/.exec(r.m.range || '');
    if (m && (v < +m[1] || v > +m[2])) return t('außerhalb des Herstellerbereichs {r}', { r: r.m.range });
  }
  if (Number.isFinite(s) && s > 0 && Math.abs(v - s) / s > 0.3) return t('deutlich anders als der Vorschlag ({s})', { s: de(s, s < 1 ? 3 : s < 10 ? 2 : 0) });
  return '';
}
/* Reiter nach Thema (mit Zähler angepasster Werte) und Suche über alle Reiter (2026-10-07) */
let ovTabNow = null;
function ovTabsRender() {
  const rows = [...$('ovRows').querySelectorAll('.ov-row')], themes = [...new Set(rows.map(r => r.dataset.theme))];
  $('ovTabs').innerHTML = themes.map(th => { const n = rows.filter(r => r.dataset.theme === th && r.classList.contains('set')).length;
    return '<button type="button" role="tab" class="ov-tab' + (th === ovTabNow ? ' on' : '') + '" data-tab="' + esc(th) + '" aria-selected="' + (th === ovTabNow) + '">' + esc(th) + (n ? ' <span class="ov-tab-n">' + n + '</span>' : '') + '</button>'; }).join('');
}
function ovTab(th) {
  ovTabNow = th; const q = $('ovSearch').value.trim().toLowerCase();
  $('ovRows').querySelectorAll('[data-theme]').forEach(el => {
    const hit = q ? (el.classList.contains('ov-row') && (el.textContent + ' ' + el.dataset.theme).toLowerCase().includes(q)) : el.dataset.theme === th && !el.classList.contains('ov-group');
    el.hidden = !hit;
  });
  // bei der Suche die Themen der Treffer als Überschrift zeigen
  if (q) $('ovRows').querySelectorAll('.ov-group').forEach(g => { g.hidden = !$('ovRows').querySelector('.ov-row[data-theme="' + CSS.escape(g.dataset.theme) + '"]:not([hidden])'); });
  $('ovNoHit').hidden = !q || !!$('ovRows').querySelector('.ov-row:not([hidden])');
  ovTabsRender();
  $('ovTabs').classList.toggle('searching', !!q);
  $('ovPanel').classList.toggle('searching', !!q);
}
$('ovTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; $('ovSearch').value = ''; ovTab(b.dataset.tab); $('ovRows').scrollTop = 0; });
$('ovSearch').addEventListener('input', () => ovTab(ovTabNow));

/* Was beim Brim in Orca landet – für die Werte im Dialog (leer = Vorschlag) und dieses Teil (Löcher in der ersten Schicht?) */
let ovBrimSugg = {}, ovBrimHoles;
function ovBrimHasHoles() {
  if (ovBrimHoles !== undefined) return ovBrimHoles;
  const p = ovPart(), g = p && p.geom;
  try { ovBrimHoles = !!(g && g.pos && typeof brimEarPoints === 'function' && brimEarPoints([{ pos: g.pos }], [], [0, 0, 0], g.mn[2], 5)); } catch (e) { ovBrimHoles = false; }
  return ovBrimHoles;
}
function ovBrimInfo() {
  const box = $('ovBrimInfo'); if (!box) return;
  const val = k => { const el = $('ovRows').querySelector('[data-ov="' + k + '"]'); return el && el.value !== '' ? el.value : ovBrimSugg[k]; };
  const outer = String(val('brim') || 'Nicht nötig'), w = Number((/^(\d+(?:[.,]\d+)?)/.exec(outer) || [0, 0])[1].toString().replace(',', '.')) || 0;
  const kind = val('brim_kind') || 'auto', inner = Number(val('brim_inner')) || 0, ik = val('brim_inner_kind') || 'large', gap = val('brim_gap'), holes = ovBrimHasHoles();
  const code = s => '<code>' + esc(s) + '</code>', lines = [];
  const innerTxt = { large: t('innen: Ohrenkette {w} mm nur in Löchern ab {min} mm Weite; kleine Löcher, Schlitze und Schriften bleiben frei', { w: de(inner, 0), min: de(inner * 3, 0) }),
    all: t('innen: Ohrenkette bis {w} mm in allen Löchern, in kleinen Löchern kleiner – die Mitte bleibt frei', { w: de(inner, 0) }),
    corners: t('innen: Ohren bis {w} mm nur an Lochecken, in kleinen Löchern kleiner', { w: de(inner, 0) }) }[ik];
  if (!w && !inner) lines.push(t('Kein Brim:') + ' ' + code('brim_type = no_brim'));
  else if (inner && ik === 'orca') {
    lines.push(code('brim_type = ' + (w ? 'outer_and_inner' : 'inner_only')) + ' · ' + code('brim_width = ' + String(w || inner)) + ' – ' + t('Orca füllt jedes Loch bis zur Brim-Breite: kleine Löcher, Schlitze und Schriften laufen zu'));
    if (w && kind !== 'outer') lines.push(t('außen: Orcas Brim ringsum (die Form außen gilt hier nicht)'));
    if (w && inner !== w) lines.push(t('Orca kennt nur eine Brim-Breite – es gilt {w} mm für außen und innen', { w: de(w, 0) }));
  }
  else if (kind === 'auto' && holes) {
    lines.push(t('Dieses Teil hat Löcher oder Schriften in der ersten Schicht →') + ' ' + code('brim_type = painted') + ' · ' + code('brim_use_efc_outline = 0') + ' · ' + t('gesetzte Ohren in {f}', { f: code('brim_ear_points.txt') }));
    if (w) lines.push(t('außen: Ohrenkette {w} mm entlang des Außenrands, neben Löchern kleiner', { w: de(w, 0) }));
    if (inner) lines.push(innerTxt);
  } else {
    if (w) lines.push(code('brim_type = ' + (kind === 'ears' ? 'brim_ears' : 'outer_only')) + ' · ' + code('brim_width = ' + de(w, 0).replace(',', '.')) +
      (kind === 'outer' ? ' – ' + t('zieht den Brim auch um Inseln in Löchern') : kind === 'ears' ? ' – ' + t('Orca setzt Ohren an spitze Ecken') : ' – ' + t('keine Löcher: normaler Brim')));
    if (inner) lines.push(kind === 'auto' ? t('innen: dieses Teil hat keine Löcher – kein innerer Brim') : t('innen: wirkt nur mit Form außen „Ohrenkette“ oder Form innen „Orca innen ringsum“'));
  }
  if (w || inner) lines.push(code('brim_object_gap = ' + String(gap ?? '').replace(',', '.')));
  box.innerHTML = '<b>' + t('In Orca:') + '</b> ' + lines.join('<br>');
}
$('ovRows').addEventListener('change', e => { if (/^brim/.test((e.target.dataset || {}).ov || '')) ovBrimInfo(); });
$('ovRows').addEventListener('input', e => {
  const el = e.target.closest('[data-ov]'); if (!el) return;
  if (/^brim/.test(el.dataset.ov)) ovBrimInfo();
  setTimeout(ovTabsRender, 0);
  const row = el.closest('.ov-row'), set = el.value !== '';
  row.classList.toggle('set', set); row.querySelector('.ov-x').hidden = !set;
  let w = row.querySelector('.ov-warn');
  const msg = set && el.tagName === 'INPUT' ? ovWarn(el.dataset.ov, num(el.value)) : '';
  if (msg && !w) { w = document.createElement('small'); w.className = 'ov-warn'; row.appendChild(w); }
  if (w) { w.textContent = msg; w.hidden = !msg; }
});
$('ovRows').addEventListener('click', e => {
  const x = e.target.closest('[data-ov-x]'); if (!x) return;
  const el = $('ovRows').querySelector('[data-ov="' + x.dataset.ovX + '"]'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); ovApply(true);
});

// Eingaben des Dialogs → {Schlüssel: Wert} oder null (ungültige Eingabe gemeldet)
function ovCollect() {
  const out = {}, bad = [];
  for (const f of ovFields()) {
    const [k, label, , min, max, step, , opts] = f, el = $('ovRows').querySelector('[data-ov="' + k + '"]'), s = el ? el.value.trim() : '';
    if (!s) continue;
    if (opts) { out[k] = s; continue; }
    const v = num(s);
    if (isNaN(v) || v < min || v > max) { bad.push(label + ' (' + de(min, min < 1 ? 2 : 0) + '–' + de(max, 0) + ')'); continue; }
    // auf die Schrittweite des Felds runden (Schichthöhe 0,02 mm, Rückzug 0,1 mm – bisher wurde alles außer der
    // Schichthöhe ganzzahlig, aus 1,3 mm Rückzug wurde 1 mm)
    const dec = step > 0 && step < 1 ? Math.min(3, String(step).split('.')[1].length) : 0;
    out[k] = Math.round(v * 10 ** dec) / 10 ** dec;
  }
  if (bad.length) { alert(t('Bitte prüfen: {list}', { list: bad.join(', ') })); return null; }
  return out;
}
function ovApply(quiet) {
  const out = ovCollect(); if (!out) return;
  const p = ovPart(), base = $('ovAll').checked ? project.parts : samePlacements(p), touched = new Set();
  for (const q of project.parts) {
    const next = { ...(q.overrides || {}) };
    for (const f of ovFields()) {
      const k = f[0], sc = ovScope(k) || 'object';
      if (!(sc === 'plate' || base.includes(q) || (sc === 'slot' && ovSlotOf(q) === ovSlotOf(p)))) continue;
      const before = JSON.stringify(next[k]);
      if (k in out) next[k] = out[k]; else delete next[k];
      if (JSON.stringify(next[k]) !== before) touched.add(q);
    }
    q.overrides = Object.keys(next).length ? next : null;
  }
  base.forEach(q => touched.add(q));
  update();
  if (!quiet && touched.size > 1) toast(t('Für {n} Teile übernommen', { n: touched.size }));
}
// Änderung gilt sofort: Auswahl, Feld verlassen, Enter, × (Vorschlag)
$('ovRows').addEventListener('change', e => { if (e.target.closest('[data-ov]')) ovApply(); });
$('ovRows').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input[data-ov]')) { e.preventDefault(); ovApply(); } });
/* Als Standard merken: die eingetragenen Werte gelten ab jetzt für dieses Filament auf diesem Drucker (js/engine.js
   ovDefaults) – als neuer Vorschlag; die Anpassungen dieses Teils fallen weg (sie stecken jetzt im Standard) */
const ovMatName = () => lastResult && lastResult.m ? lastResult.m.name : '';
$('ovDefSave').addEventListener('click', () => {
  const out = ovCollect(), r = lastResult; if (!out || !r) return;
  if (!Object.keys(out).length) { toast(t('Keine Werte eingetragen – nichts zu merken')); return; }
  const all = store.settings.ovDefaults || (store.settings.ovDefaults = {});
  all[r.defKey] = { ...(all[r.defKey] || {}), ...out };
  const p = ovPart(); samePlacements(p).forEach(x => { x.overrides = null; });
  persist(); prefsPush(); update();
  toast(t('{n} Wert(e) als Standard für {mat} gemerkt', { n: Object.keys(out).length, mat: ovMatName() }));
});
$('ovDefReset').addEventListener('click', () => {
  const r = lastResult; if (!r || !store.settings.ovDefaults || !store.settings.ovDefaults[r.defKey]) return;
  if (!confirm(t('Eigene Standardwerte für {mat} löschen? Danach gelten wieder die Werkswerte.', { mat: ovMatName() }))) return;
  delete store.settings.ovDefaults[r.defKey]; persist(); prefsPush(); update();
  toast(t('Werkswerte für {mat} wieder aktiv', { mat: ovMatName() }));
});
$('ovReset').addEventListener('click', () => {
  const p = ovPart(); if (!p) return;
  samePlacements(p).forEach(x => { x.overrides = null; });
  update(); toast(t('Anpassungen zurückgenommen – Vorschlag gilt'));
});

/* Standardwerte auf dem Server (tools/prefs.py, /api/prefs) – gelten in jedem Browser (Mac, iPhone, Home Assistant).
   Beim Start vom Server holen; liegen dort noch keine, aber im Browser, werden sie einmal hochgeladen. Ohne Server
   (Datei per Doppelklick) bleiben sie wie bisher im Browser. */
let prefsOnServer = false;
async function prefsPush() {
  if (!prefsOnServer) return;
  try { await lanApi('api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'ovDefaults', value: store.settings.ovDefaults || {} }) }); }
  catch (e) { toast(t('Standardwerte nicht auf dem Server gespeichert: {msg}', { msg: t(e.message) })); }
}
async function prefsPull() {
  let srv;
  try { srv = await lanApi('api/prefs'); } catch (e) { return; }
  prefsOnServer = true;
  const remote = srv.ovDefaults || {}, local = store.settings.ovDefaults || {};
  if (Object.keys(remote).length) {
    if (JSON.stringify(remote) !== JSON.stringify(local)) { store.settings.ovDefaults = remote; persist(); if (typeof update === 'function') update(); }
  } else if (Object.keys(local).length) prefsPush();   // bisher nur im Browser – einmal hochladen
}
window.addEventListener('load', prefsPull);
