'use strict';
/* Slot-Auswahl wie in OrcaSlicer: farbiger Chip mit der Slotnummer (Teileliste, Körper), ein Klick öffnet eine Liste aller
   Slots mit Farbe, Nummer und Material. Dazu die Filamentleiste im Tab ① (alle Slots des Druckers; Klick = Slot für das
   gewählte Teil). Slots kommen aus slotChoices() (js/part-settings.js: live vom Drucker, eigene Angabe oder Vorlage).
   null = „Standard“: der Slot aus dem Export-Dialog bzw. „wie Teil“ bei Körpern – der Chip zeigt dann gestrichelt,
   welcher Slot tatsächlich gilt. */

const validSlotHex = c => /^#[0-9a-f]{6}$/i.test(c || '');
// Schrift auf der Farbe: hell auf dunkel, dunkel auf hell
function slotInk(hex) {
  if (!validSlotHex(hex)) return '#1d2129';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#1d2129' : '#ffffff';
}
/* Chip-HTML. slot = eigener Slot oder null; eff = Slot, der dann tatsächlich gilt (für null); attrs = data-Attribute.
   label = Bezeichnung für Screenreader („Slot für pilz.stl“). */
function slotChipHTML(slot, eff, attrs, label) {
  const slots = typeof slotChoices === 'function' ? slotChoices() : [], s = slots[slot ?? eff] || {};
  const bg = validSlotHex(s.colour) ? s.colour : '#c7ccd4', n = (slot ?? eff ?? 0) + 1;
  const title = (slot == null ? t('Standard-Slot') + ' – ' : '') + 'Slot ' + n + (s.type ? ' · ' + s.type : '') + (label ? ' · ' + label : '');
  return '<button type="button" class="slot-chip' + (slot == null ? ' std' : '') + '" ' + attrs + ' style="--chip:' + bg + ';--chip-ink:' + slotInk(bg) + '"' +
    ' title="' + esc(title) + '" aria-label="' + esc(title) + '" aria-haspopup="listbox">' + n + '</button>';
}

// Eine Auswahlliste für alle Chips; onPick(slot | null)
const slotPop = { el: null, onPick: null, anchor: null };
function openSlotPicker(anchor, current, opts, onPick) {
  closeSlotPicker();
  const slots = typeof slotChoices === 'function' ? slotChoices() : [];
  if (!slots.length) { toast(t('Für diesen Drucker gibt es keine Slots')); return; }
  const el = slotPop.el || (slotPop.el = document.createElement('div'));
  el.className = 'slot-pop'; el.setAttribute('role', 'listbox'); el.setAttribute('aria-label', opts.title || t('Slot wählen'));
  const row = (v, sw, main, sub, sel) => '<button type="button" role="option" data-v="' + v + '" aria-selected="' + sel + '"' + (sel ? ' class="sel"' : '') + '>' + sw +
    '<span class="sp-main">' + main + '</span><span class="sp-sub">' + sub + '</span></button>';
  const sw = s => { const bg = validSlotHex(s.colour) ? s.colour : '#c7ccd4'; return '<span class="slot-chip" style="--chip:' + bg + ';--chip-ink:' + slotInk(bg) + '">' + (s.idx + 1) + '</span>'; };
  const n = slots.length;
  el.innerHTML = (opts.std ? row('', '<span class="slot-chip std" style="--chip:#c7ccd4;--chip-ink:#1d2129">' + (opts.stdSlot == null ? '·' : opts.stdSlot + 1) + '</span>', esc(opts.std), '', current == null) : '') +
    slots.map(s => row(s.idx, sw(s), (typeof slotLabel === 'function' ? slotLabel(s.idx, n) : 'Slot ' + (s.idx + 1)),
      s.present === false ? t('leer') : esc(s.type || '') + (s.name && s.name !== s.type ? ' <small>' + esc(s.name) + '</small>' : ''), current === s.idx)).join('');
  document.body.appendChild(el);
  // unter dem Chip, im Fenster gehalten
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
  el.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  slotPop.onPick = onPick; slotPop.anchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  (el.querySelector('.sel') || el.querySelector('button')).focus();
}
function closeSlotPicker() {
  if (!slotPop.el || !slotPop.el.isConnected) return;
  slotPop.el.remove();
  if (slotPop.anchor) { slotPop.anchor.setAttribute('aria-expanded', 'false'); if (document.activeElement === document.body) slotPop.anchor.focus(); }
  slotPop.anchor = null;
}
document.addEventListener('click', e => {
  if (!slotPop.el || !slotPop.el.isConnected) return;
  const b = e.target.closest('.slot-pop button');
  if (b) { const v = b.dataset.v, cb = slotPop.onPick; closeSlotPicker(); if (cb) cb(v === '' ? null : +v); return; }
  if (!e.target.closest('.slot-pop') && e.target !== slotPop.anchor) closeSlotPicker();
}, true);
document.addEventListener('keydown', e => {
  if (!slotPop.el || !slotPop.el.isConnected) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSlotPicker(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const bs = [...slotPop.el.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
    e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
  }
});
window.addEventListener('resize', closeSlotPicker);
window.addEventListener('scroll', e => { if (!(e.target && e.target.closest && e.target.closest('.slot-pop'))) closeSlotPicker(); }, true);

/* Filament passend zum Slot eines Teils: mit der Spule im Slot verknüpftes Profil (Filamentverwaltung) zuerst, sonst das
   bisherige, wenn es zur Filamentart passt, sonst das erste Profil dieser Art. null = passt schon / Slot unbekannt. */
function slotMaterialFor(p, slot, force) {
  if (p.matManual && !force) return null;
  const slots = typeof slotChoices === 'function' ? slotChoices() : [], i = slot === undefined ? p.slot ?? defaultSlot() : slot, s = slots[i];
  if (!s || !s.type || s.present === false || !p.input) return null;
  const m = (typeof spoolProfileForSlot === 'function' && spoolProfileForSlot(i)) || materialForSlotType(s.type, p.input.material);
  return m && m !== p.input.material ? m : null;
}
// Filament der Teile an ihre Slots anpassen (alle Platzierungen je Objekt); Rückgabe: Anzahl umgestellter Teile
function adoptSlotMaterialFor(parts, slot) {
  let n = 0;
  for (const p of parts) { const m = slotMaterialFor(p, slot); if (m) { samePlacements(p).forEach(x => { if (x.input) x.input.material = m; }); n++; } }
  if (n && project.parts[project.selected]) loadPartIntoForm(project.parts[project.selected]);
  return n;
}
const matName = id => { const m = typeof allMats === 'function' && allMats().find(x => x.id === id); return m ? m.name : id; };
// Slot eines Teils setzen (alle Platzierungen desselben Objekts) – und das Filament in den Druckwerten passend dazu
// (auch wenn es vorher von Hand gewählt war: eine neue Slotwahl ist ein neuer Wunsch)
function setPartSlot(p, v) {
  samePlacements(p).forEach(x => { x.slot = v; x.matManual = false; });
  const n = adoptSlotMaterialFor([p]);
  update();
  if (n) toast(t('{part}: Filament auf „{mat}“ umgestellt (passend zu Slot {n})', { part: p.name, mat: matName(p.input.material), n: (v ?? defaultSlot()) + 1 }));
}

/* Filamentleiste (Tab ①): alle Slots; der Slot des gewählten Teils ist markiert, die Zahl darunter = wie viele Teile ihn
   nutzen. Klick: Slot für das gewählte Teil. */
/* Ändert sich die Belegung (vom Drucker gelesen, von Hand eingetragen, zweite ACE …), folgen die Teile ohne von Hand
   gewähltes Filament ihrem Slot. Einmal je neuer Belegung; danach update() nur, wenn sich etwas geändert hat. */
let slotTypeSig = null;
function followSlotTypes(slots) {
  const sig = (project ? project.parts.length : 0) + '|' + slots.map(s => (s.present === false ? '' : s.type) + '/' + (s.colour || '')).join(',');
  if (sig === slotTypeSig) return;
  slotTypeSig = sig;
  if (project && adoptSlotMaterialFor(project.parts)) setTimeout(update);
}
function renderFilamentBar() {
  const bar = $('filBar'); if (!bar) return;
  const slots = project && typeof slotChoices === 'function' ? slotChoices() : [];
  if (project && slots.length) followSlotTypes(slots);
  bar.classList.toggle('hidden', !slots.length);
  if (!slots.length) return;
  const def = typeof defaultSlot === 'function' ? defaultSlot() : 0, p = project.parts[project.selected], cur = p ? p.slot ?? def : null;
  const uses = slots.map(s => project.parts.filter(x => (x.slot ?? def) === s.idx).length), n = slots.length;
  renderDesignFilaments(slots);
  $('filBarList').innerHTML = slots.map((s, i) => {
    const bg = validSlotHex(s.colour) ? s.colour : '#c7ccd4';
    return '<li><button type="button" data-fil="' + i + '" class="fil' + (i === cur ? ' sel' : '') + (s.present === false ? ' empty' : '') + '" style="--chip:' + bg + ';--chip-ink:' + slotInk(bg) + '"' +
      ' title="' + esc((typeof slotLabel === 'function' ? slotLabel(i, n) : 'Slot ' + (i + 1)) + (s.type ? ' · ' + s.type : '') + (i === def ? ' · ' + t('Standard-Slot') : '') + ' – ' + t('Klick: für das gewählte Teil')) + '">' +
      '<span class="fil-n">' + (i + 1) + '</span><span class="fil-t">' + esc(s.present === false ? t('leer') : s.type || '–') + '</span>' +
      (uses[i] ? '<span class="fil-u" title="' + esc(t('{n} Teil(e)', { n: uses[i] })) + '">' + uses[i] + '</span>' : '') + (i === def ? '<span class="fil-std">★</span>' : '') + '</button></li>';
  }).join('');
}
$('filBarList').addEventListener('click', e => {
  const b = e.target.closest('[data-fil]'); if (!b || !project) return;
  const p = project.parts[project.selected]; if (!p) return;
  const before = p.input && p.input.material;
  setPartSlot(p, +b.dataset.fil);
  if (!p.input || p.input.material === before) toast(t('{part}: Slot {n}', { part: p.name, n: +b.dataset.fil + 1 }));
});
$('filBarEdit').addEventListener('click', () => { if (typeof openSlotDialog === 'function') openSlotDialog(); });

/* „Filamente des Modells“ wie in OrcaSlicer: je Filament des Designers (Makerworld-3MF) Farbe, Nummer und Material, dazu
   der Slot, auf den es gedruckt wird (designMap; Klick → Slot wählen, wie „Remap filaments“). */
function renderDesignFilaments(slots) {
  const box = $('filDesign'), tm = project && project.threemf, cols = tm && typeof designColours === 'function' ? designColours() : [];
  const show = !!tm && cols.length >= 2 && slots.length > 0;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const map = tm.designMap || {}, n = slots.length;
  $('filDesignReset').classList.toggle('hidden', !Object.keys(map).length);
  $('filDesignList').innerHTML = cols.map(c => {
    const to = map[c.d] ?? c.d, dc = validSlotHex(c.colour) ? c.colour : '#c7ccd4', s = slots[to] || {};
    const over = c.d >= n && map[c.d] == null;
    return '<li' + (over ? ' class="bad"' : '') + ' title="' + esc([...c.uses].join(', ')) + '"><span class="slot-chip dnum" style="--chip:' + dc + ';--chip-ink:' + slotInk(dc) + '">' + (c.d + 1) + '</span>' +
      '<span class="fd-type">' + esc(c.type || '–') + '</span><span class="dc-arrow">→</span>' +
      slotChipHTML(to, to, 'data-dfil="' + c.d + '"', t('Farbe {n} des Designers', { n: c.d + 1 })) +
      '<span class="fd-slot">' + esc(s.present === false ? t('leer') : (s.type || '')) + '</span></li>';
  }).join('');
}
$('filDesignList').addEventListener('click', e => {
  const c = e.target.closest('[data-dfil]'); if (!c) return;
  const d = +c.dataset.dfil, map = project.threemf.designMap || {};
  openSlotPicker(c, map[d] ?? d, { title: t('Slot für Farbe {n} des Designers', { n: d + 1 }) }, v => { if (v != null) setDesignSlot(d, v); });
});
$('filDesignAuto').addEventListener('click', () => autoAssignDesignColours());
$('filDesignReset').addEventListener('click', () => resetDesignColours());
// Farben in der 3D-Ansicht: Slotfarben (so wird gedruckt) oder wie vom Designer angelegt
const colourView = () => store.settings.colourView === 'designer' ? 'designer' : 'slot';
function applyColourView() {
  document.querySelectorAll('[data-colview]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.colview === colourView())));
  if (project && typeof paintBodies === 'function') paintBodies(project.parts[project.selected]);
}
document.querySelectorAll('[data-colview]').forEach(b => b.addEventListener('click', () => { store.settings.colourView = b.dataset.colview; persist(); applyColourView(); }));
applyColourView();
