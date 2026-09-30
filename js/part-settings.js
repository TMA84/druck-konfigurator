'use strict';
/* Werte je Teil: Das Formular links zeigt die Einstellungen des gewählten Teils. Jedes Teil merkt sich
   Filament, Objektart, Priorität, Belastung, Support, Stützreduzierung und seinen Slot. Beim Export
   bekommt jedes Teil sein eigenes Ergebnis (partJobs); export3mf.js schreibt Abweichungen als
   Objekt-Einstellung und die Filamentwerte je Slot. */

const PART_FIELDS = ['material', 'object', 'goal', 'load', 'support', 'supportLevel'];
const formSnapshot = () => Object.fromEntries(PART_FIELDS.map(id => [id, $(id).value]));

// Beim Laden: alle Teile starten mit der aktuellen Auswahl
function initPartInputs(parts) {
  const snap = formSnapshot();
  parts.forEach(p => { if (!p.input) p.input = { ...snap }; });
}
function loadPartIntoForm(part) {
  if (!part.input) return;
  // Gibt es den gespeicherten Wert nicht mehr (z. B. Filament gelöscht), gilt die erste Option –
  // sonst bliebe die Auswahl des vorher gewählten Teils stehen und würde übernommen.
  for (const id of PART_FIELDS) {
    const sel = $(id), v = part.input[id];
    sel.value = [...sel.options].some(o => o.value === v) ? v : (sel.options[0] || {}).value;
  }
}
/* Dasselbe 3MF-Objekt kann mehrfach auf mehreren Platten stehen. Orca speichert Slot, Werte und Körper-Slots
   je Objekt, nicht je Platzierung – deshalb gilt jede Änderung für alle Platzierungen (Platten). */
// Platzierungen desselben 3MF-Objekts bzw. Kopien eines Teils (js/plates-ui.js) teilen Einstellungen und Slots
function samePlacements(part) {
  if (project && project.threemf && part.objectId != null) return project.parts.filter(p => p.objectId === part.objectId);
  return project && part.copyGroup ? project.parts.filter(p => p.copyGroup === part.copyGroup) : [part];
}

// Aus update(): aktuelle Auswahl gehört zum gewählten Teil (und allen Platzierungen desselben Objekts)
function savePartFromForm() {
  const p = project && project.parts[project.selected];
  if (p) { const input = formSnapshot(); samePlacements(p).forEach(x => { x.input = { ...input }; }); }
}

// Slots des aktuellen Druckers: live vom Drucker, sonst aus der Orca-Vorlage
function slotChoices() {
  const r = lastResult, tpl = r && exportTemplate(r.printer.id, r.dSel);
  return tpl ? dialogSlots(tpl) : [];
}

// Auch bei einem einzelnen Teil: Slot wählbar (dann ohne Teile-Auswahl)
function renderPartScope() {
  const multi = !!project && project.parts.length > 1;
  $('partScope').classList.toggle('hidden', !project);
  if (!project) return;
  $('partScope').classList.toggle('single', !multi);
  $('partSlotAll').classList.toggle('hidden', !multi);
  const p = project.parts[project.selected], sel = $('partSlot'), slots = slotChoices();
  $('partScopeName').textContent = p.name;
  // Teil hier wählen, ohne in den Tab „Modell“ zu wechseln
  $('partPick').innerHTML = project.parts.map((x, i) => '<option value="' + i + '"' + (i === project.selected ? ' selected' : '') + '>' + esc(x.name) + (project.threemf && project.threemf.plates.length > 1 ? ' · ' + t('Platte {n}', { n: x.plate }) : '') + '</option>').join('');
  sel.innerHTML = '<option value="">' + t('wie beim Export gewählt') + '</option>' +
    slots.map(s => '<option value="' + s.idx + '">Slot ' + (s.idx + 1) + (s.type ? ' · ' + esc(s.type) + (typeof slotOriginNote === 'function' ? slotOriginNote() : '') : '') + '</option>').join('');
  sel.value = p.slot === null || p.slot === undefined || p.slot >= slots.length ? '' : String(p.slot);
  renderPartUses(p, slots);
}
/* „Druckt aus“: alle Slots, die das Teil nutzt – Grundkörper, Körper, Farb-Modifikatoren und Bemalung des Designers
   (umgelegt über designMap), erhabene Beschriftung. Die Druckwerte gelten für alle diese Slots (die 3MF schreibt die
   Filamentwerte des Teils auch dorthin); liegt in einem Slot eine andere Filamentart, warnt die Zeile. */
function renderPartUses(p, slots) {
  const def = typeof defaultSlot === 'function' ? defaultSlot() : 0, map = (project.threemf && project.threemf.designMap) || {}, uses = new Map();
  const add = (s, why) => { if (s == null) return; if (!uses.has(s)) uses.set(s, new Set()); uses.get(s).add(why); };
  add(p.slot ?? def, t('Grundkörper'));
  (p.bodies || []).forEach(b => { if (b.slot != null) add(b.slot, t('Körper')); });
  (p.modSlots || []).forEach(d => add(map[d] ?? d, t('Modifikator')));
  (p.paintSlots || []).forEach(d => add(map[d] ?? d, t('Bemalung')));
  (p.texts || []).filter(x => x.mode !== 'engraved').forEach(x => add(x.slot ?? p.slot ?? def, t('Beschriftung')));
  const box = $('partUses');
  if (uses.size < 2) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const mat = getMat($('material').value), grp = typeof TEMP_GROUP !== 'undefined' ? TEMP_GROUP[mat.kind] : null, odd = [];
  const list = [...uses].sort((a, b) => a[0] - b[0]).map(([s, why]) => {
    const x = slots[s] || {}, k = typeof kindOfType === 'function' && x.type ? kindOfType(x.type) : null;
    if (grp && k && TEMP_GROUP[k] && TEMP_GROUP[k] !== grp) odd.push('Slot ' + (s + 1) + ' ' + x.type);
    return '<span class="use">' + slotChipHTML(s, s, 'tabindex="-1" disabled', '') + '<span>' + (x.type ? esc(x.type) + ' · ' : '') + esc([...why].join(', ')) + '</span></span>';
  }).join('');
  box.innerHTML = '<span class="use-head">' + t('Druckt aus') + '</span>' + list +
    (odd.length ? '<p class="note bad small">' + t('{slots}: andere Filamentart als „{mat}“ – die Druckwerte gelten für alle Slots des Teils, so slict OrcaSlicer nicht. Slot mit passendem Filament wählen.', { slots: odd.join(', '), mat: esc(mat.name) }) + '</p>' : '');
}
$('partSlotAll').addEventListener('click', () => {
  const v = $('partSlot').value;
  applySlotToAll(v === '' ? null : +v);
});
$('partPick').addEventListener('change', () => { const i = +$('partPick').value; if (i !== project.selected) selectPart(i); });
$('partSlot').addEventListener('change', () => {
  const p = project.parts[project.selected], v = $('partSlot').value;
  setPartSlot(p, v === '' ? null : +v);     // stellt auch das Filament passend zum Slot um (js/slot-picker.js)
});

// Je Teil ein eigenes Ergebnis; Drucker, Düse und Überhangwinkel gelten für alle
function partJobs() {
  const base = currentInput(), ctx = { getMat, settings: store.settings };
  // Plattenzuordnung nur, wenn sie jemand festgelegt hat (sonst verteilt build3mfFiles automatisch)
  const plateOf = p => project.platesFixed && !project.threemf ? p.plate : undefined;
  return project.parts.map(p => ({ geom: p.geom, plate: plateOf(p), slot: p.slot ?? null, bodies: p.bodies, part: p, holes: p.holeGeom === p.geom ? p.holes || [] : [], r: compute({ ...base, ...(p.input || {}), overrides: p.overrides || null }, p.geom, ctx) }));
}

/* Globale Werte = erstes Teil ohne eigenen Slot (dessen Slot wählt der Dialog); haben alle Teile einen
   eigenen Slot, das erste Teil mit seinem Slot. */
function exportPlan(defaultSlot) {
  const jobs = partJobs(), def = jobs.filter(j => j.slot === null);
  const slot = def.length ? defaultSlot : jobs[0].slot;
  return { jobs, slot, r: (def[0] || jobs[0]).r, usesDefault: def.length > 0 };
}

// Filament passend zu einem Slot-Typ: das bisherige, wenn es passt, sonst das erste Profil dieser Art
function materialForSlotType(type, current) {
  const mats = allMats();
  if (slotMatchesKind(type, (mats.find(m => m.id === current) || {}).kind)) return current;
  const m = mats.find(x => slotMatchesKind(type, x.kind));
  return m ? m.id : current;
}

// Filament von Hand gewählt: dann folgt es dem Slot nicht mehr automatisch (js/slot-picker.js adoptSlotMaterialFor)
$('material').addEventListener('change', () => {
  const p = project && project.parts[project.selected];
  if (p) samePlacements(p).forEach(x => { x.matManual = true; });
});
