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
  ['brim_gap', t('Brim-Abstand zum Teil'), 'mm', 0, 1, 0.05, t('Kühlung & Haftung')]
];
const ovPart = () => project && project.parts[project.selected];
const ovCount = p => p && p.overrides ? Object.keys(p.overrides).length : 0;
const ovFmt = (f, v) => f[0] === 'support' || f[0] === 'critical' ? (v === 'on' ? t('an') : t('aus')) : f[0] === 'layer' ? de(v, 2) + ' mm' : (typeof v === 'number' ? de(v, Number.isInteger(v) ? 0 : 2) : t(String(v).replace(/ oder .*/, ''))) + (f[2] && typeof v === 'number' ? ' ' + f[2] : '');

// Leiste über dem Datenblatt: Knopf, wie viele Werte angepasst sind, alle zurücknehmen
function renderOverrideBar() {
  const p = ovPart(), n = ovCount(p), r = lastResult;
  $('ovOpen').disabled = !p;
  $('ovOpen').title = p ? '' : t('Zuerst ein Modell laden');
  const diff = r && r.changed ? r.changed.length : 0;
  $('ovInfo').textContent = !p ? t('Zuerst ein Modell laden.') : n ? t(n > 1 ? '{n} Werte angepasst' : '{n} Wert angepasst', { n }) + (diff < n ? ' ' + t('({n} davon wie der Vorschlag)', { n: n - diff }) : '') + (project.parts.length > 1 ? ' – ' + t('für „{name}“', { name: p.name }) : '') : t('Vorschlag unverändert.');
  $('ovReset').classList.toggle('hidden', !n);
}

function openOverrideDialog(focusGroup) {
  const p = ovPart(), r = lastResult; if (!p || !r) return;
  const sugg = r.suggested || {}, own = p.overrides || {};
  let group = '';
  $('ovRows').innerHTML = OV_FIELDS.filter(f => !/^fan_(aux|box)$/.test(f[0]) || (r.printer && r.printer.id === 'kobra_s1')).map(f => {
    const [k, label, unit, min, max, step, grp, opts] = f, cur = own[k];
    const head = grp !== group ? '<div class="ov-group">' + esc(grp) + '</div>' : ''; group = grp;
    const input = opts
      ? '<select data-ov="' + k + '"><option value="">' + t('– Vorschlag –') + '</option>' + opts.map(o => { const [v, txt] = Array.isArray(o) ? o : [o, t(o)]; return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(txt) + '</option>'; }).join('') + '</select>'
      : '<input data-ov="' + k + '" type="number" inputmode="decimal" min="' + min + '" max="' + max + '" step="' + step + '" value="' + (cur ?? '') + '" placeholder="' + esc(sugg[k] ?? '') + '" aria-label="' + esc(label) + '">';
    return head + '<div class="ov-row' + (cur !== undefined ? ' set' : '') + '"><span>' + esc(label) + (unit ? ' <small class="muted">' + unit + '</small>' : '') + '</span>' +
      '<span class="ov-sugg">' + t('Vorschlag {v}', { v: esc(sugg[k] !== undefined ? ovFmt(f, sugg[k]) : '–') }) + '</span>' + input +
      '<button type="button" class="ov-x" data-ov-x="' + k + '" title="' + t('Vorschlag verwenden') + '"' + (cur === undefined ? ' hidden' : '') + '>×</button></div>';
  }).join('');
  $('ovAllRow').classList.toggle('hidden', project.parts.length < 2); $('ovAll').checked = false;
  $('ovTitle').textContent = t('Werte anpassen') + (project.parts.length > 1 ? ' · ' + p.name : '');
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

$('ovSave').addEventListener('click', () => {
  const out = {}, bad = [];
  for (const f of OV_FIELDS) {
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
  if (bad.length) { alert(t('Bitte prüfen: {list}', { list: bad.join(', ') })); return; }
  const p = ovPart(), value = Object.keys(out).length ? out : null;
  const targets = $('ovAll').checked ? project.parts : samePlacements(p);
  targets.forEach(x => { x.overrides = value ? { ...value } : null; });
  $('ovDlg').close();
  update();
  toast(value ? t('{n} Wert(e) angepasst', { n: Object.keys(out).length }) + (targets.length > 1 ? ' ' + t('für {n} Teile', { n: targets.length }) : '') : t('Vorschlag wird verwendet'));
});
$('ovOpen').addEventListener('click', openOverrideDialog);
$('ovReset').addEventListener('click', () => {
  const p = ovPart(); if (!p) return;
  samePlacements(p).forEach(x => { x.overrides = null; });
  update(); toast(t('Anpassungen zurückgenommen – Vorschlag gilt'));
});
$('ovDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
