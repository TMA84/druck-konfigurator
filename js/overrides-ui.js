'use strict';
/* Werte für diesen Auftrag anpassen (Schritt ② Druckwerte): je Teil part.overrides = {nozzle: 225, …}.
   compute() (js/engine.js) setzt sie statt des Vorschlags ein – Datenblatt, 3MF, Slicen, Kosten und Drucken
   nutzen dann dieselben Werte. Gilt für alle Platzierungen desselben Objekts; auf Wunsch für alle Teile. */

const OV_PATTERNS = ['Gyroid', 'Kubisch', 'Gitter', 'Waben', 'Linien', 'Dreiecke', 'Kreuzschraffur', 'Blitz'];
const OV_BRIMS = ['Nicht nötig', '3 mm', '5 mm', '8 mm', '10 mm'];
// Muster- und Brim-Werte bleiben deutsch (export3mf.js ordnet sie Orca-Werten zu); angezeigt wird t(Wert).
// [Schlüssel, Beschriftung, Einheit, min, max, Schritt, Gruppe] – Auswahllisten statt Zahl bei options
const OV_FIELDS = [
  ['nozzle', t('Düse'), '°C', 150, 300, 5, t('Temperatur')], ['bed', t('Heizbett'), '°C', 0, 110, 5, t('Temperatur')],
  ['layer', t('Schichthöhe'), 'mm', 0.04, 0.6, 0.02, t('Qualität')],
  ['w', t('Wandlinien'), '', 1, 12, 1, t('Struktur')], ['t', t('Obere Schichten'), '', 0, 30, 1, t('Struktur')], ['b', t('Untere Schichten'), '', 0, 30, 1, t('Struktur')],
  ['inf', t('Fülldichte'), '%', 0, 100, 5, t('Struktur')], ['pattern', t('Füllmuster'), '', 0, 0, 0, t('Struktur'), OV_PATTERNS],
  ['sp_outer', t('Außenwand'), 'mm/s', 10, 600, 5, t('Geschwindigkeit')], ['sp_inner', t('Innenwand'), 'mm/s', 10, 600, 5, t('Geschwindigkeit')], ['sp_fill', t('Füllung'), 'mm/s', 10, 600, 5, t('Geschwindigkeit')],
  ['fan', t('Lüfter'), '%', 0, 100, 5, t('Kühlung & Haftung')],
  ['support', t('Stützen'), '', 0, 0, 0, t('Kühlung & Haftung'), [['on', t('an')], ['off', t('aus')]]],
  // Orca „Nur kritische Bereiche“: an = Stützen nur für Spitzen/Auskragungen, aus = auch normale Überhänge
  ['critical', t('Nur kritische Bereiche'), '', 0, 0, 0, t('Kühlung & Haftung'), [['on', t('an')], ['off', t('aus')]]], ['brim', 'Brim', '', 0, 0, 0, t('Kühlung & Haftung'), OV_BRIMS]
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

function openOverrideDialog() {
  const p = ovPart(), r = lastResult; if (!p || !r) return;
  const sugg = r.suggested || {}, own = p.overrides || {};
  let group = '';
  $('ovRows').innerHTML = OV_FIELDS.map(f => {
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
}
$('ovRows').addEventListener('input', e => {
  const el = e.target.closest('[data-ov]'); if (!el) return;
  const row = el.closest('.ov-row'), set = el.value !== '';
  row.classList.toggle('set', set); row.querySelector('.ov-x').hidden = !set;
});
$('ovRows').addEventListener('click', e => {
  const x = e.target.closest('[data-ov-x]'); if (!x) return;
  const el = $('ovRows').querySelector('[data-ov="' + x.dataset.ovX + '"]'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
});
$('ovClear').addEventListener('click', () => $('ovRows').querySelectorAll('[data-ov]').forEach(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }));

$('ovSave').addEventListener('click', () => {
  const out = {}, bad = [];
  for (const f of OV_FIELDS) {
    const [k, label, , min, max, , , opts] = f, el = $('ovRows').querySelector('[data-ov="' + k + '"]'), s = el.value.trim();
    if (!s) continue;
    if (opts) { out[k] = s; continue; }
    const v = num(s);
    if (isNaN(v) || v < min || v > max) { bad.push(label + ' (' + de(min, min < 1 ? 2 : 0) + '–' + de(max, 0) + ')'); continue; }
    out[k] = k === 'layer' ? Math.round(v * 100) / 100 : Math.round(v);
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
