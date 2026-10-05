'use strict';
/* Werte für diesen Auftrag anpassen (Schritt ② Druckwerte): je Teil part.overrides = {nozzle: 225, …}.
   compute() (js/engine.js) setzt sie statt des Vorschlags ein – Datenblatt, 3MF, Slicen, Kosten und Drucken
   nutzen dann dieselben Werte. Gilt für alle Platzierungen desselben Objekts; auf Wunsch für alle Teile. */

const OV_PATTERNS = ['Gyroid', 'Kubisch', 'Gitter', 'Waben', 'Linien', 'Dreiecke', 'Kreuzschraffur', 'Blitz'];
const OV_BRIMS = ['Nicht nötig', '3 mm', '5 mm', '8 mm', '10 mm'];
// Muster- und Brim-Werte bleiben deutsch (export3mf.js ordnet sie Orca-Werten zu); angezeigt wird t(Wert).
// [Schlüssel, Beschriftung, Einheit, min, max, Schritt, Gruppe] – Auswahllisten statt Zahl bei options
const OV_FIELDS = [
  ['nozzle', t('Düse'), '°C', 150, 300, 5, t('Temperatur')], ['nozzle_first', t('Düse erste Schicht'), '°C', 150, 300, 5, t('Temperatur')],
  ['bed', t('Heizbett'), '°C', 0, 110, 5, t('Temperatur')],
  ['layer', t('Schichthöhe'), 'mm', 0.04, 0.6, 0.02, t('Qualität')], ['first_layer', t('Höhe der ersten Schicht'), 'mm', 0.08, 0.6, 0.02, t('Qualität')],
  ['seam', t('Nahtposition'), '', 0, 0, 0, t('Qualität'), ['Hinten', 'Ausgerichtet', 'Nächste', 'Zufällig']],
  ['w', t('Wandlinien'), '', 1, 12, 1, t('Struktur')], ['t', t('Obere Schichten'), '', 0, 30, 1, t('Struktur')], ['b', t('Untere Schichten'), '', 0, 30, 1, t('Struktur')],
  ['inf', t('Fülldichte'), '%', 0, 100, 5, t('Struktur')], ['pattern', t('Füllmuster'), '', 0, 0, 0, t('Struktur'), OV_PATTERNS],
  ['sp_outer', t('Außenwand'), 'mm/s', 10, 600, 5, t('Geschwindigkeit')], ['sp_inner', t('Innenwand'), 'mm/s', 10, 600, 5, t('Geschwindigkeit')], ['sp_fill', t('Füllung'), 'mm/s', 10, 600, 5, t('Geschwindigkeit')],
  ['sp_first', t('Erste Schicht'), 'mm/s', 5, 300, 5, t('Geschwindigkeit')], ['sp_travel', t('Travel'), 'mm/s', 50, 1000, 10, t('Geschwindigkeit')],
  ['sp_top', t('Obere Fläche'), 'mm/s', 10, 400, 5, t('Geschwindigkeit')], ['sp_gap', t('Lückenfüllung'), 'mm/s', 10, 400, 5, t('Geschwindigkeit')],
  ['accel', t('Beschleunigung (0 = Werksprofil)'), 'mm/s²', 0, 20000, 500, t('Geschwindigkeit')],
  ['max_vol', t('Max. Volumenstrom'), 'mm³/s', 1, 60, 0.5, t('Filament')], ['flow', t('Durchflussverhältnis'), '', 0.8, 1.2, 0.01, t('Filament')],
  ['pa', t('Pressure Advance'), '', 0, 0.2, 0.005, t('Filament')], ['zhop', t('Z-Hop'), 'mm', 0, 2, 0.1, t('Filament')],
  // Rückzug: nur wenn gesetzt, sonst das Orca-Profil des Slots
  ['retr_len', t('Rückzug Länge'), 'mm', 0, 10, 0.1, t('Rückzug')], ['retr_speed', t('Rückzug Geschwindigkeit'), 'mm/s', 5, 150, 5, t('Rückzug')],
  ['fan', t('Lüfter (Bauteil)'), '%', 0, 100, 5, t('Kühlung & Haftung')], ['fan_first', t('Lüfter erste Schicht'), '%', 0, 100, 5, t('Kühlung & Haftung')],
  // nur Kobra S1 (Orca-Profil mit Hilfs- und Abluftlüfter) – bei anderen Druckern ausgeblendet (ovFieldsFor)
  ['fan_aux', t('Hilfslüfter (seitlich)'), '%', 0, 100, 5, t('Kühlung & Haftung')], ['fan_box', t('Gehäuselüfter (Abluft)'), '%', 0, 100, 5, t('Kühlung & Haftung')],
  ['support', t('Stützen'), '', 0, 0, 0, t('Kühlung & Haftung'), [['on', t('an')], ['off', t('aus')]]],
  // Orca „Nur kritische Bereiche“: an = Stützen nur für Spitzen/Auskragungen, aus = auch normale Überhänge
  ['critical', t('Nur kritische Bereiche'), '', 0, 0, 0, t('Kühlung & Haftung'), [['on', t('an')], ['off', t('aus')]]], ['brim', 'Brim', '', 0, 0, 0, t('Kühlung & Haftung'), OV_BRIMS],
  ['brim_kind', t('Brim-Art'), '', 0, 0, 0, t('Kühlung & Haftung'), Object.entries(BRIM_KINDS).map(([v, l]) => [v, t(l)])],
  ['brim_inner', t('Brim-Breite innen'), 'mm', 1, 10, 0.5, t('Kühlung & Haftung')],
  ['brim_gap', t('Brim-Abstand zum Teil'), 'mm', 0, 1, 0.05, t('Kühlung & Haftung')]
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
  return out;
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
const ovFmt = (f, v) => Array.isArray(f[7]) && Array.isArray(f[7][0]) && !f[0].startsWith('x:') ? ((f[7].find(o => String(o[0]) === String(v)) || [, String(v)])[1]) : f[0].startsWith('x:') && typeof extraLabel === 'function' ? extraLabel(f[0].slice(2), v) : f[0] === 'support' || f[0] === 'critical' ? (v === 'on' ? t('an') : t('aus')) : f[0] === 'layer' ? de(v, 2) + ' mm' : (typeof v === 'number' ? de(v, Number.isInteger(v) ? 0 : 2) : t(String(v).replace(/ oder .*/, ''))) + (f[2] && typeof v === 'number' ? ' ' + f[2] : '');

// Leiste über dem Datenblatt: Knopf, wie viele Werte angepasst sind, alle zurücknehmen
function renderOverrideBar() {
  const p = ovPart(), n = ovCount(p), r = lastResult;
  $('ovOpen').disabled = !p;
  $('ovOpen').title = p ? '' : t('Zuerst ein Modell laden');
  const diff = r && r.changed ? r.changed.length : 0;
  $('ovInfo').textContent = !p ? t('Zuerst ein Modell laden.') : n ? t(n > 1 ? '{n} Werte angepasst' : '{n} Wert angepasst', { n }) + (diff < n ? ' ' + t('({n} davon wie der Vorschlag)', { n: n - diff }) : '') + (project.parts.length > 1 ? ' – ' + t('für „{name}“', { name: p.name }) : '') : '';
  $('ovReset').classList.toggle('hidden', !n);
  // eigene Standardwerte für dieses Filament (js/engine.js ovDefaults)
  const nDef = r && r.ovDefaults ? Object.keys(r.ovDefaults).length : 0;
  if (p && nDef) $('ovInfo').textContent += (n ? ' · ' : '') + t('{n} eigene Standardwerte ({mat})', { n: nDef, mat: r.m.name });
}

function openOverrideDialog(focusGroup) {
  const p = ovPart(), r = lastResult; if (!p || !r) return;
  const sugg = { ...(r.suggested || {}) }, own = p.overrides || {}, def = r.ovDefaults || {};
  let group = '';
  for (const f of ovFields()) if (f[0].startsWith('x:')) { const v = extraSuggestion(r, f[0].slice(2)); if (v !== undefined) sugg[f[0]] = /^-?\d+(\.\d+)?$/.test(String(v)) && !f[7] ? +v : String(v); }
  $('ovRows').innerHTML = ovFields().filter(f => !/^fan_(aux|box)$/.test(f[0]) || (r.printer && r.printer.id === 'kobra_s1')).map(f => {
    const [k, label, unit, min, max, step, grp, opts] = f, cur = own[k];
    const head = grp !== group ? '<div class="ov-group">' + esc(grp) + '</div>' : ''; group = grp;
    const input = opts
      ? '<select data-ov="' + k + '"><option value="">' + t('– Vorschlag –') + '</option>' + opts.map(o => { const [v, txt] = Array.isArray(o) ? o : [o, t(o)]; return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(txt) + '</option>'; }).join('') + '</select>'
      : '<input data-ov="' + k + '" type="number" inputmode="decimal" min="' + min + '" max="' + max + '" step="' + step + '" value="' + (cur ?? '') + '" placeholder="' + esc(def[k] ?? sugg[k] ?? '') + '" aria-label="' + esc(label) + '">';
    const sc = project.parts.length > 1 ? ovScope(k) : null;
    const scTxt = sc === 'plate' ? t('gilt für die ganze Platte') : sc === 'slot' ? t('gilt für alle Teile mit Slot {n}', { n: ovSlotOf(p) + 1 }) : '';
    return head + '<div class="ov-row' + (cur !== undefined ? ' set' : '') + '"><span>' + esc(label) + (unit ? ' <small class="muted">' + unit + '</small>' : '') + (scTxt ? '<small class="ov-scope muted">' + esc(scTxt) + '</small>' : '') + '</span>' +
      '<span class="ov-sugg">' + (def[k] !== undefined ? t('Standard {v}', { v: esc(ovFmt(f, def[k])) }) + ' <small class="muted">' + t('Werk {v}', { v: esc(sugg[k] !== undefined ? ovFmt(f, sugg[k]) : '–') }) + '</small>'
        : t('Vorschlag {v}', { v: esc(sugg[k] !== undefined ? ovFmt(f, sugg[k]) : '–') })) + '</span>' + input +
      '<button type="button" class="ov-x" data-ov-x="' + k + '" title="' + t('Vorschlag verwenden') + '"' + (cur === undefined ? ' hidden' : '') + '>×</button></div>';
  }).join('');
  $('ovAllRow').classList.toggle('hidden', project.parts.length < 2); $('ovAll').checked = false;
  $('ovTitle').textContent = t('Werte anpassen') + (project.parts.length > 1 ? ' · ' + p.name : '');
  const nDef = Object.keys(def).length;
  $('ovDefSave').textContent = t('Als Standard für {mat} merken', { mat: r.m.name });
  $('ovDefReset').classList.toggle('hidden', !nDef);
  $('ovDefInfo').textContent = nDef ? t('{n} eigene Standardwerte für {mat} auf diesem Drucker aktiv.', { n: nDef, mat: r.m.name }) : '';
  $('ovDlg').showModal();
  // aus dem Datenblatt („✎ anpassen“): zum Abschnitt springen
  if (typeof focusGroup === 'string') { const g = [...$('ovRows').querySelectorAll('.ov-group')].find(x => x.textContent === focusGroup); if (g) { g.scrollIntoView({ block: 'start' }); const i = g.nextElementSibling && g.nextElementSibling.querySelector('[data-ov]'); if (i) i.focus(); } }
  // aus einer Zeile des Datenblatts: genau dieses Feld
  else if (focusGroup && focusGroup.key) { const i = $('ovRows').querySelector('[data-ov="' + focusGroup.key + '"]'); if (i) { i.closest('.ov-row').scrollIntoView({ block: 'center' }); i.focus(); i.closest('.ov-row').classList.add('ov-focus'); } }
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
$('ovRows').addEventListener('input', e => {
  const el = e.target.closest('[data-ov]'); if (!el) return;
  const row = el.closest('.ov-row'), set = el.value !== '';
  row.classList.toggle('set', set); row.querySelector('.ov-x').hidden = !set;
  let w = row.querySelector('.ov-warn');
  const msg = set && el.tagName === 'INPUT' ? ovWarn(el.dataset.ov, num(el.value)) : '';
  if (msg && !w) { w = document.createElement('small'); w.className = 'ov-warn'; row.appendChild(w); }
  if (w) { w.textContent = msg; w.hidden = !msg; }
});
$('ovRows').addEventListener('click', e => {
  const x = e.target.closest('[data-ov-x]'); if (!x) return;
  const el = $('ovRows').querySelector('[data-ov="' + x.dataset.ovX + '"]'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
});
$('ovClear').addEventListener('click', () => $('ovRows').querySelectorAll('[data-ov]').forEach(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }));

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
$('ovSave').addEventListener('click', () => {
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
  $('ovDlg').close();
  update();
  const n = Object.keys(out).length;
  toast(n ? t('{n} Wert(e) angepasst', { n }) + (touched.size > 1 ? ' ' + t('für {n} Teile', { n: touched.size }) : '') : t('Vorschlag wird verwendet'));
});
$('ovOpen').addEventListener('click', openOverrideDialog);
/* Als Standard merken: die eingetragenen Werte gelten ab jetzt für dieses Filament auf diesem Drucker (js/engine.js
   ovDefaults) – als neuer Vorschlag; die Anpassungen dieses Teils fallen weg (sie stecken jetzt im Standard) */
const ovMatName = () => lastResult && lastResult.m ? lastResult.m.name : '';
$('ovDefSave').addEventListener('click', () => {
  const out = ovCollect(), r = lastResult; if (!out || !r) return;
  if (!Object.keys(out).length) { toast(t('Keine Werte eingetragen – nichts zu merken')); return; }
  const all = store.settings.ovDefaults || (store.settings.ovDefaults = {});
  all[r.defKey] = { ...(all[r.defKey] || {}), ...out };
  const p = ovPart(); samePlacements(p).forEach(x => { x.overrides = null; });
  persist(); prefsPush(); $('ovDlg').close(); update();
  toast(t('{n} Wert(e) als Standard für {mat} gemerkt', { n: Object.keys(out).length, mat: ovMatName() }));
});
$('ovDefReset').addEventListener('click', () => {
  const r = lastResult; if (!r || !store.settings.ovDefaults || !store.settings.ovDefaults[r.defKey]) return;
  if (!confirm(t('Eigene Standardwerte für {mat} löschen? Danach gelten wieder die Werkswerte.', { mat: ovMatName() }))) return;
  delete store.settings.ovDefaults[r.defKey]; persist(); prefsPush(); $('ovDlg').close(); update();
  toast(t('Werkswerte für {mat} wieder aktiv', { mat: ovMatName() }));
});
$('ovReset').addEventListener('click', () => {
  const p = ovPart(); if (!p) return;
  samePlacements(p).forEach(x => { x.overrides = null; });
  update(); toast(t('Anpassungen zurückgenommen – Vorschlag gilt'));
});
$('ovDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

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
