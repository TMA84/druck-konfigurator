'use strict';
/* Platten im Schritt ① Modell: Übersicht je Platte mit Draufsicht, Teile verschieben, Anzahl (Kopien).
   STL-Projekte verteilt das Tool automatisch auf möglichst wenige Platten (arrangeParts), bis ein Teil
   verschoben wird – ab dann gilt part.plate (project.platesFixed) und die 3MF übernimmt die Zuordnung.
   Makerworld-3MF: Platten des Designers, hier nur Anzeige (Verschieben in OrcaSlicer).
   Kopien teilen Einstellungen, Slot und Farben (part.copyGroup, siehe samePlacements). Logik: js/plates.js. */

const plTpl = () => lastResult && exportTemplate(lastResult.printer.id, lastResult.dSel);

// Platzierung aller Teile: count Platten, plateOf[i] (1-basiert), places (Bettkoordinaten, nur STL)
function projectLayout(tpl) {
  if (!project || !tpl) return null;
  if (project.threemf) {
    const plateOf = project.parts.map(p => p.plate || 1), vol = buildVolume(tpl);
    return { fixed3mf: true, count: Math.max(1, ...plateOf), plateOf, places: null, overflow: false,
      oversize: project.parts.map((p, i) => i).filter(i => volumeExcess(project.parts[i].geom, vol).length),
      oversizePlates: plateShifts(project.parts.map(p => ({ geom: p.geom, plate: p.plate })), tpl).oversize };
  }
  const r = project.platesFixed ? arrangeByPlate(project.parts, tpl) : arrangeParts(project.parts.map(p => p.geom), tpl);
  return { count: r.plateCount, plateOf: r.places.map(p => p.plate + 1), places: r.places, oversize: r.oversize, overflow: r.overflow };
}

// Ab der ersten Änderung feste Zuordnung: jedes Teil behält die Platte, auf der es gerade steht
function fixPlates(tpl) {
  if (project.platesFixed) return;
  const lay = projectLayout(tpl);
  project.parts.forEach((p, i) => { p.plate = lay.plateOf[i]; });
  project.platesFixed = true;
}
// Nach dem Packen: Nummern ohne Lücken, übergelaufene Teile auf ihrer neuen Platte
function normalizePlates(tpl) {
  if (!project.platesFixed) return;
  const lay = projectLayout(tpl);
  project.parts.forEach((p, i) => { p.plate = lay.plateOf[i]; });
}

function movePart(i, plate) {
  const tpl = plTpl(); if (!tpl) return;
  fixPlates(tpl);
  project.parts[i].plate = plate;
  normalizePlates(tpl);
  update();
}

const copyGroupOf = p => p.copyGroup ? project.parts.filter(x => x.copyGroup === p.copyGroup) : [p];
function cloneFrom(p) {
  return { ...p, input: p.input ? { ...p.input } : null, overrides: p.overrides ? { ...p.overrides } : null,
    bodies: p.bodies ? p.bodies.map(b => ({ ...b })) : p.bodies, holes: (p.holes || []).map(h => ({ ...h })) };
}
// Anzahl eines Teils setzen: fehlende Kopien kommen auf dieselbe Platte (passt es nicht, auf eine neue)
function setCopies(part, n) {
  if (project.threemf) return;
  const tpl = plTpl(); if (!tpl) return;
  n = Math.max(1, Math.min(50, Math.round(n)));
  if (!part.copyGroup) part.copyGroup = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const group = copyGroupOf(part), base = part.name.replace(/ \(\d+\)$/, '');
  if (n > group.length) {
    if (project.platesFixed) fixPlates(tpl);
    const last = group[group.length - 1], at = project.parts.indexOf(last) + 1, add = [];
    for (let k = group.length; k < n; k++) add.push({ ...cloneFrom(part), name: base + ' (' + (k + 1) + ')', plate: last.plate });
    project.parts.splice(at, 0, ...add);
  } else if (n < group.length) {
    const drop = new Set(group.slice(n));
    const keep = project.parts[project.selected];
    project.parts = project.parts.filter(p => !drop.has(p));
    project.selected = Math.max(0, project.parts.indexOf(drop.has(keep) ? group[0] : keep));
  }
  if (copyGroupOf(part).length === 1) part.copyGroup = null;
  project.parts.forEach((p, i) => { p.id = i; });
  normalizePlates(tpl);
  $('partList').classList.toggle('hidden', project.parts.length < 2);
  update();
}

// Welche Slots eine Platte nutzt (vor dem Slicen: Slot der Teile und ihrer Körper)
// (auch Farb-Modifikatoren des Designers, js/design-ui.js usedSlots)
function plateSlotUse(plan, idx) {
  const g = [0, 0, 0, 0];
  usedSlots(plan, idx).forEach(s => { g[s] = 1; });
  return g;
}

function plateSvg(tpl, lay, idx, slots, def) {
  const [bw, bd] = bedSize(tpl), [bx, by] = tpl.bedCenter, x0 = bx - bw / 2, y0 = by - bd / 2;
  const rects = idx.map(i => {
    const p = project.parts[i], g = p.geom, pl = lay.places[i], s = slots[p.slot ?? def];
    const col = s && /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : '#9aa8bc';
    return '<rect data-pick="' + i + '" x="' + (pl.lx - g.x / 2 - x0).toFixed(1) + '" y="' + (bd - (pl.ly - y0) - g.y / 2).toFixed(1) + '" width="' + g.x.toFixed(1) + '" height="' + g.y.toFixed(1) +
      '" rx="2" fill="' + col + '"' + (i === project.selected ? ' class="sel"' : '') + '><title>' + esc(p.name) + '</title></rect>';
  }).join('');
  return '<svg class="plate-svg" viewBox="0 0 ' + bw + ' ' + bd + '" role="img" aria-label="' + t('Draufsicht') + '"><rect class="bed" width="' + bw + '" height="' + bd + '" rx="4"/>' + rects + '</svg>';
}

function renderPlates() {
  const box = $('plateBox'), tpl = plTpl(), lay = project && projectLayout(tpl);
  if (!lay || (project.parts.length < 2 && lay.count < 2 && project.threemf)) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const plan = exportPlan(costDefaultSlot()), slots = typeof slotChoices === 'function' ? slotChoices() : [];
  const mats = slotMaterials(plan), kinds = slotKindsFor(tpl, plan), canAdopt = slotMaterialChanges().length > 0, sl = costState.slice && costState.sig === costSignature() ? costState.slice : null;
  const sel = project.parts[project.selected], fixed = lay.fixed3mf;
  const plN = t(lay.count > 1 ? '{n} Platten' : '{n} Platte', { n: lay.count });
  $('plateInfo').textContent = fixed ? t('{plates} aus der 3MF des Designers – Teile verschiebst du in OrcaSlicer.', { plates: plN })
    : plN + ' · ' + (project.platesFixed ? t('eigene Zuordnung') : t('automatisch platzsparend verteilt'));
  $('plateAuto').classList.toggle('hidden', fixed || !project.platesFixed);
  $('plateCopies').classList.toggle('hidden', fixed);
  if (!fixed && sel) { $('plateCopyName').textContent = sel.name.replace(/ \(\d+\)$/, ''); $('plateCopyN').value = copyGroupOf(sel).length; }
  const warn = [];
  const vol = buildVolume(tpl);
  if (lay.oversize.length) warn.push(t('Passt nicht in den Bauraum ({size} mm): {parts}.', { size: de(vol[0], 0) + ' × ' + de(vol[1], 0) + (isFinite(vol[2]) ? ' × ' + de(vol[2], 0) : ''),
    parts: lay.oversize.map(i => project.parts[i].name + ' – ' + volumeExcess(project.parts[i].geom, vol).join(', ')).join('; ') }));
  else if ((lay.oversizePlates || []).length) warn.push(t('Teile auf Platte {list} belegen mehr als das Bett.', { list: lay.oversizePlates.join(', ') }));
  if (lay.overflow) warn.push(t('Nicht alles passte auf die gewählte Platte – der Rest steht auf einer weiteren.'));
  $('plateWarn').textContent = warn.join(' '); $('plateWarn').classList.toggle('hidden', !warn.length);
  let html = '';
  for (let k = 1; k <= lay.count; k++) {
    const idx = project.parts.map((p, i) => i).filter(i => lay.plateOf[i] === k);
    if (!idx.length && fixed) continue;
    const need = plateNeeds({ plate: k, grams: plateSlotUse(plan, idx) }, mats, slots.length ? slots : null, slotMatchesKind);
    const sp = sl && sl.plates.find(p => p.plate === k), conflict = tempConflict(kinds, usedSlots(plan, idx));
    const moveOpts = i => Array.from({ length: lay.count }, (_, n) => '<option value="' + (n + 1) + '"' + (n + 1 === k ? ' selected' : '') + '>' + t('Platte {n}', { n: n + 1 }) + '</option>').join('') + '<option value="' + (lay.count + 1) + '">' + t('Neue Platte') + '</option>';
    html += '<li class="plate-card"><div class="plate-head"><b>' + t('Platte {n}', { n: k }) + '</b><span class="muted small">' + t(idx.length > 1 ? '{n} Teile' : '{n} Teil', { n: idx.length }) +
      (sp ? ' · ' + duration(sp.time_s) + ' · ' + de(sp.total_g, 1) + ' g' : '') + '</span>' +
      '<span class="plate-slots">' + need.tools.map(tl => { const s = slots[tl], c = s && /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : '#dddddd'; return '<span class="pslot" style="background:' + c + '" title="Slot ' + (tl + 1) + (s && s.type ? ' · ' + esc(s.type) : '') + '"></span>'; }).join('') + '</span></div>' +
      (lay.places ? plateSvg(tpl, lay, idx, slots, plan.slot) : '') +
      (need.missing.length ? '<p class="note bad small">' + need.missing.map(m => m.have ? t('Slot {n}: braucht {want}, eingelegt ist {have}', { n: m.slot + 1, want: esc(m.want), have: esc(m.have) })
        : t('Slot {n}: braucht {want}, leer', { n: m.slot + 1, want: esc(m.want) })).join(' · ') +
        (need.missing.some(m => m.have) && canAdopt ? ' <button type="button" class="linkbtn" data-adopt>' + t('Filament aus dem ACE übernehmen') + '</button>' : '') + '</p>' : '') +
      (conflict ? '<p class="note bad small">' + t(project.threemf ? '<b>Slict so nicht:</b> {text} Lösung: oben unter <b>Farben des Designers</b> auf Slots mit derselben Filamentart legen oder passendes Filament einlegen.'
        : '<b>Slict so nicht:</b> {text} Lösung: den Teilen/Körpern Slots mit derselben Filamentart geben oder passendes Filament einlegen.', { text: esc(conflictText(conflict, kinds)) }) + '</p>' : '') +
      '<ul class="plate-parts">' + idx.map(i => '<li' + (i === project.selected ? ' class="sel"' : '') + '><button type="button" class="linkbtn" data-pick="' + i + '">' + esc(project.parts[i].name) + '</button>' +
        (fixed ? '' : '<select data-move="' + i + '" aria-label="' + t('Auf Platte verschieben') + '">' + moveOpts(i) + '</select>') + '</li>').join('') + '</ul></li>';
  }
  $('plateList').innerHTML = html;
}

$('plateList').addEventListener('click', e => {
  if (e.target.closest('[data-adopt]')) { adoptSlotMaterials(); return; }
  const b = e.target.closest('[data-pick]'); if (!b) return;
  const i = +b.dataset.pick; if (i !== project.selected) selectPart(i);
});
$('plateList').addEventListener('change', e => { const s = e.target.closest('[data-move]'); if (s) movePart(+s.dataset.move, +s.value); });
$('plateAuto').addEventListener('click', () => { project.platesFixed = false; update(); toast(t('Teile automatisch platzsparend verteilt')); });
$('plateCopyN').addEventListener('change', () => setCopies(project.parts[project.selected], num($('plateCopyN').value) || 1));
$('plateCopyMinus').addEventListener('click', () => setCopies(project.parts[project.selected], copyGroupOf(project.parts[project.selected]).length - 1));
$('plateCopyPlus').addEventListener('click', () => setCopies(project.parts[project.selected], copyGroupOf(project.parts[project.selected]).length + 1));
