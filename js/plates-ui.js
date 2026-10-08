'use strict';
/* Platten im Schritt ① Modell: Übersicht je Platte mit Draufsicht, Teile verschieben, Anzahl (Kopien).
   STL-Projekte verteilt das Tool automatisch auf möglichst wenige Platten (arrangeParts), bis ein Teil
   verschoben wird – ab dann gilt part.plate (project.platesFixed) und die 3MF übernimmt die Zuordnung.
   Makerworld-3MF: zuerst die Platten des Designers (ohne Draufsicht). „Platzsparend anordnen“ packt die Objekte
   neu (project.threemf.layout = 'auto'), Verschieben, Kopien (weitere Instanzen) und hinzugefügte Teile platziert
   das Tool selbst (layout3mf) – die 3MF des Designers mit Modifikatoren und Bemalung bleibt dabei erhalten.
   Kopien teilen Einstellungen, Slot und Farben (part.copyGroup, siehe samePlacements). Logik: js/plates.js. */

const plTpl = () => lastResult && exportTemplate(lastResult.printer.id, lastResult.dSel);

// Platzierung aller Teile: count Platten, plateOf[i] (1-basiert), places (Bettkoordinaten; null = Lage des Designers)
// Zwischengespeichert (layoutKey): update() fragt je Durchlauf mehrfach (Platten, Kosten, Spülmenge, Export-Dialog …),
// mit 30–50 Kopien wäre sonst jedes Mal neu zu packen. Das Ergebnis nicht verändern – es wird geteilt.
function projectLayout(tpl) {
  if (!project || !tpl) return null;
  const key = layoutKey(tpl);
  if (plCache.lay && plCache.lay.key === key) return plCache.lay.val;
  const val = computeLayout(tpl);
  plCache.lay = { key, val };
  return val;
}
/* Brim außen je Teil (mm) – Rand beim Anordnen wie im Export (build3mfFiles: brimPad des Teil-Ergebnisses); das
   Ergebnis je Teil (compute) ist teuer, daher nur neu, wenn sich Eingaben, Anpassungen oder Teile ändern */
const padCache = { sig: null, val: null };
// Hintergrund-Anordnung fertig (js/nest.js): neu zeichnen – der Schlüssel (nestRev) erzwingt die neue Lage, Kosten slicen neu
function onNestDone() { if (project && typeof update === 'function') update(); }
function partPads() {
  if (!project || typeof brimPad !== 'function' || typeof exportPlan !== 'function' || !lastResult) return null;
  let sig;
  try { sig = JSON.stringify([currentInput(), store.settings.ovDefaults || null, project.parts.map(p => [geomId(p.geom), p.input || null, p.overrides || null])]); } catch (e) { return null; }
  if (padCache.sig !== sig) {
    let val = null;
    try { val = exportPlan(costDefaultSlot()).jobs.map(j => brimPad(j.r)); } catch (e) { console.error(e); }
    padCache.sig = sig; padCache.val = val;
  }
  return padCache.val;
}
function computeLayout(tpl) {
  if (project.threemf && needsRelayout(project.threemf, project.parts)) {
    const pads = partPads();
    const r = layout3mf(project.parts.map((p, i) => ({ geom: p.geom, plate: p.plate, own: ownPlaced(p), pad: pads ? pads[i] : 0 })), tpl, project.threemf.layout || null);
    return { count: r.count, plateOf: r.plateOf, places: r.places, oversize: r.oversize, oversizePlates: r.oversizePlates, overflow: r.overflow, designer: r.designer };
  }
  if (project.threemf) {
    const plateOf = project.parts.map(p => p.plate || 1), vol = buildVolume(tpl);
    return { fixed3mf: true, count: Math.max(1, ...plateOf), plateOf, places: null, overflow: false,
      oversize: project.parts.map((p, i) => i).filter(i => volumeExcess(project.parts[i].geom, vol).length),
      oversizePlates: plateShifts(project.parts.map(p => ({ geom: p.geom, plate: p.plate })), tpl).oversize };
  }
  const pads = partPads(), r = project.platesFixed ? arrangeByPlate(project.parts.map((p, i) => ({ geom: p.geom, plate: p.plate, pad: pads ? pads[i] : 0 })), tpl) : packAll(tpl);
  // automatisch angeordnet: weitere Platten sind gewollt, kein „passte nicht“
  return { count: r.plateCount, plateOf: r.places.map(p => p.plate + 1), places: r.places, oversize: r.oversize, overflow: !!project.platesFixed && r.overflow, setsKept: r.setsKept };
}
// Alle Teile platzsparend auf möglichst wenige Platten (ohne Zuordnung) – auch für „Platzsparend wären es n Platten“
/* Sätze eines Modells aus mehreren Teilen (gleiche Datei, src): Satz k = je Teil die k-te Kopie – z. B. 20 RFID-Halter =
   20 × (Halter + Deckel). Nur Modelle mit mindestens zwei Teilen und mehr als einem Satz; [[Teil-Indizes], …] */
function projectSets() {
  if (!project || project.threemf) return [];
  const bySrc = new Map();
  project.parts.forEach((p, i) => {
    if (!p.src) return;
    const g = p.copyGroup || 'i' + i, m = bySrc.get(p.src) || bySrc.set(p.src, new Map()).get(p.src);
    (m.get(g) || m.set(g, []).get(g)).push(i);
  });
  const sets = [];
  for (const groups of bySrc.values()) {
    const lists = [...groups.values()];
    if (lists.length < 2 || Math.max(...lists.map(l => l.length)) < 2) continue;
    for (let k = 0; k < Math.max(...lists.map(l => l.length)); k++) { const s = lists.map(l => l[k]).filter(i => i != null); if (s.length > 1) sets.push(s); }
  }
  return sets;
}
function packAll(tpl) {
  const key = layoutKey(tpl, true);
  if (plCache.all && plCache.all.key === key) return plCache.all.val;
  const val = arrangeParts(project.parts.map(p => p.geom), tpl, project.keepSets === false ? null : projectSets(), partPads());
  plCache.all = { key, val };
  return val;
}
/* Schlüssel für den Zwischenspeicher: Projekt, Bett (Größe, Mitte, Höhe), Anordnungsart und je Teil die Geometrie
   (Objekt-Identität – Drehen erzeugt eine neue, js/orient-ui.js – und Maße), Platte und „selbst platziert“.
   Verschieben, Kopieren, Löschen, Drehen und ein anderer Drucker ändern ihn. packOnly: nur, was arrangeParts liest. */
const plCache = { lay: null, all: null, ids: new WeakMap(), n: 0 };
function geomId(g) {
  if (!g || typeof g !== 'object') return '-';
  let id = plCache.ids.get(g);
  if (!id) { id = ++plCache.n; plCache.ids.set(g, id); }
  return id;
}
function layoutKey(tpl, packOnly) {
  const tm = project.threemf;
  const head = [geomId(project), bedSize(tpl).join('x'), (tpl.bedCenter || []).join(','), [].concat(tpl.settings && tpl.settings.printable_height || [])[0],
    packOnly ? 'all' : tm ? '3mf:' + (tm.layout || '') : project.platesFixed ? 'fixed' : 'auto', project.parts.length, project.printSeq === 'object' ? 'obj' : 'layer', 'gap' + packGapMm,
    project.keepSets === false ? 'nosets' : 'sets:' + project.parts.map(p => (p.src || '') + '/' + (p.copyGroup || '')).join(','),
    // Brim je Teil (Rand beim Anordnen) und fertige Hintergrund-Anordnungen (js/nest.js)
    'pads:' + (partPads() || []).join(','), 'nest' + (typeof nestRev !== 'undefined' ? nestRev : '')].join('|');
  return head + '|' + project.parts.map(p => { const g = p.geom || {};
    return geomId(g) + ':' + g.x + ':' + g.y + ':' + g.z + (packOnly ? '' : ':' + (p.plate || '') + (ownPlaced(p) ? '*' : '')); }).join(';');
}

// Ab der ersten Änderung feste Zuordnung: jedes Teil behält die Platte, auf der es gerade steht
function fixPlates(tpl) {
  if (project.platesFixed) return;
  const lay = projectLayout(tpl);
  project.parts.forEach((p, i) => { p.plate = lay.plateOf[i]; });
  project.platesFixed = true;
  if (project.threemf && project.threemf.layout === 'auto') project.threemf.layout = 'plates';
}
// Nach dem Packen: Nummern ohne Lücken, übergelaufene Teile auf ihrer neuen Platte
// (3MF: immer, damit die Plattennummer in der Teileliste stimmt – beim automatischen Anordnen zählt sie nicht)
function normalizePlates(tpl) {
  if (!project.platesFixed && !project.threemf) return;
  const lay = projectLayout(tpl);
  project.parts.forEach((p, i) => { p.plate = lay.plateOf[i]; });
}

function movePart(i, plate) {
  const tpl = plTpl(); if (!tpl) return;
  fixPlates(tpl);
  project.parts[i].plate = plate;
  if (project.threemf) project.parts[i].moved = true;   // Platte packt ab jetzt das Tool
  normalizePlates(tpl);
  update();
}

const copyGroupOf = p => p.copyGroup ? project.parts.filter(x => x.copyGroup === p.copyGroup) : [p];
// Teile einer Platte, Kopien zusammengefasst: [{name (ohne „ (2)“), idx: [Teil-Indizes]}]
function plateRows(idx) {
  const rows = [], by = new Map();
  for (const i of idx) {
    const p = project.parts[i], k = p.copyGroup || 'i' + i;
    if (!by.has(k)) { const r = { name: p.name.replace(/ \(\d+\)$/, ''), idx: [] }; by.set(k, r); rows.push(r); }
    by.get(k).idx.push(i);
  }
  return rows;
}
function cloneFrom(p) {
  return { ...p, input: p.input ? { ...p.input } : null, overrides: p.overrides ? { ...p.overrides } : null,
    bodies: p.bodies ? p.bodies.map(b => ({ ...b })) : p.bodies, holes: (p.holes || []).map(h => ({ ...h })) };
}
/* Anzahl eines Teils setzen: fehlende Kopien kommen auf dieselbe Platte (passt es nicht, auf eine neue).
   3MF-Objekt: Kopie = weitere Instanz desselben Objekts (copy, gleiche objectId/instance als Vorlage der Lage). */
function setCopies(part, n) {
  const tpl = plTpl(); if (!tpl) return;
  n = Math.max(1, Math.min(50, Math.round(n)));
  if (!part.copyGroup) part.copyGroup = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const group = copyGroupOf(part), base = part.name.replace(/ \(\d+\)$/, '');
  if (n > group.length) {
    if (project.platesFixed || (project.threemf && project.threemf.layout !== 'auto')) fixPlates(tpl);
    const last = group[group.length - 1], at = project.parts.indexOf(last) + 1, add = [];
    const copy = !!project.threemf && part.objectId != null && !part.extra;
    for (let k = group.length; k < n; k++) add.push({ ...cloneFrom(part), name: base + ' (' + (k + 1) + ')', plate: last.plate, ...(copy ? { copy: true } : {}) });
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
  $('partList').classList.remove('hidden');
  update();
}

// Welche Slots eine Platte nutzt (vor dem Slicen: Slot der Teile und ihrer Körper)
// (auch Farb-Modifikatoren des Designers, js/design-ui.js usedSlots)
function plateSlotUse(plan, idx) {
  const g = [0, 0, 0, 0];
  usedSlots(plan, idx).forEach(s => { while (g.length <= s) g.push(0); g[s] = 1; });
  return g;
}

function plateSvg(tpl, lay, idx, slots, def) {
  const [bw, bd] = bedSize(tpl), [bx, by] = tpl.bedCenter, x0 = bx - bw / 2, y0 = by - bd / 2;
  const rects = idx.map(i => {
    const p = project.parts[i], pl = lay.places[i], s = slots[p.slot ?? def], [fw, fd] = footprint(p.geom, pl), g = { x: fw, y: fd };
    const col = s && /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : '#9aa8bc';
    // echte Grundfläche (js/nest.js) – ineinander gelegte Teile sieht man sonst nur als überlappende Rechtecke
    const d = typeof footprintPath === 'function' ? footprintPath(p.geom, placeAng(pl)) : null;
    if (d) return '<path data-pick="' + i + '" transform="translate(' + (pl.lx - g.x / 2 - x0).toFixed(1) + ' ' + (bd - (pl.ly - y0) - g.y / 2).toFixed(1) + ')" d="' + d + '" fill="' + col + '"' +
      (i === project.selected ? ' class="sel"' : '') + '><title>' + esc(p.name) + '</title></path>';
    return '<rect data-pick="' + i + '" x="' + (pl.lx - g.x / 2 - x0).toFixed(1) + '" y="' + (bd - (pl.ly - y0) - g.y / 2).toFixed(1) + '" width="' + g.x.toFixed(1) + '" height="' + g.y.toFixed(1) +
      '" rx="2" fill="' + col + '"' + (i === project.selected ? ' class="sel"' : '') + '><title>' + esc(p.name) + '</title></rect>';
  }).join('');
  return '<svg class="plate-svg" viewBox="0 0 ' + bw + ' ' + bd + '" role="img" aria-label="' + t('Draufsicht') + '"><rect class="bed" width="' + bw + '" height="' + bd + '" rx="4"/>' + rects + '</svg>';
}

function renderPlates() {
  const box = $('plateBox'), tpl = plTpl(), lay = project && projectLayout(tpl);
  if (!lay) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const plan = exportPlan(costDefaultSlot()), slots = typeof slotChoices === 'function' ? slotChoices() : [];
  const mats = slotMaterials(plan), kinds = slotKindsFor(tpl, plan), canAdopt = slotMaterialChanges().length > 0, sl = costState.slice && costState.sig === costSignature() ? costState.slice : null;
  const sel = project.parts[project.selected], fixed = lay.fixed3mf, tm = project.threemf;
  const plN = t(lay.count > 1 ? '{n} Platten' : '{n} Platte', { n: lay.count });
  if (typeof secSum === 'function') secSum('plates', plN);
  // Anordnung nach Grundfläche rechnet im Hintergrund (js/nest.js)
  { let n = $('plateNestBusy'); if (!n) { n = document.createElement('small'); n.id = 'plateNestBusy'; n.className = 'muted nest-busy'; $('plateTitle').after(n); }
    n.textContent = typeof nestBusy === 'function' && nestBusy() ? t('ordne platzsparend an …') : ''; }
  // 3MF: Platten des Designers, bis angeordnet wird (layout); ohne layout packt das Tool nur Platten mit eigenen Teilen
  const auto = tm ? tm.layout === 'auto' : !project.platesFixed, designerLayout = tm && !tm.layout;
  $('plateByObject').checked = project.printSeq === 'object';
  // Sätze zusammenhalten: nur bei Modellen aus mehreren Teilen mit mehreren Sätzen, beim automatischen Anordnen
  const hasSets = !project.threemf && !project.platesFixed && projectSets().length > 0;
  $('plateSetsRow').classList.toggle('hidden', !hasSets);
  $('plateSets').checked = project.keepSets !== false;
  $('plateSetsNote').textContent = hasSets && project.keepSets !== false && lay.setsKept === false ? t('Sätze zusammen hätten mehr als eine Platte zusätzlich gebraucht – Teile deshalb frei verteilt.') : '';
  $('plateSeqNote').textContent = project.printSeq === 'object' ? t('Jedes Teil wird ganz fertig gedruckt, bevor das nächste beginnt – dafür {r} mm Abstand für den Druckkopf.', { r: de(clearanceOf(tpl).radius, 0) }) : '';
  $('plateInfo').textContent = fixed ? t('{plates} aus der 3MF des Designers, Lage wie vom Designer.', { plates: plN })
    : plN + ' · ' + (designerLayout ? t('Platten des Designers wie angelegt, eigene Teile platzsparend') : auto ? t('automatisch platzsparend verteilt') : t('eigene Zuordnung'));
  // Platzsparend anordnen: bei eigener Zuordnung, bei Makerworld-3MF, wenn es Platten spart (Modifikatoren und Bemalung bleiben)
  const packed = project.parts.length > 1 ? packAll(tpl).plateCount : lay.count;
  $('plateAuto').classList.toggle('hidden', auto || (designerLayout && packed >= lay.count));
  $('plateAuto').title = designerLayout ? t('Platzsparend: {n} statt {m} Platten. Farb-Modifikatoren und Bemalung des Designers bleiben erhalten.', { n: packed, m: lay.count })
    : t('Zuordnung verwerfen und alle Teile auf möglichst wenige Platten verteilen');
  $('plateSave').textContent = packed < lay.count ? t('Platzsparend angeordnet wären es {n} statt {m} Platten.', { n: packed, m: lay.count }) : '';
  $('plateSave').classList.toggle('hidden', !(packed < lay.count));
  const warn = [];
  const vol = buildVolume(tpl);
  if (lay.oversize.length) warn.push(t('Passt nicht in den Bauraum ({size} mm): {parts}.', { size: de(vol[0], 0) + ' × ' + de(vol[1], 0) + (isFinite(vol[2]) ? ' × ' + de(vol[2], 0) : ''),
    parts: lay.oversize.map(i => project.parts[i].name + ' – ' + volumeExcess(project.parts[i].geom, vol).join(', ')).join('; ') }));
  else if ((lay.oversizePlates || []).length) warn.push(t('Teile auf Platte {list} belegen mehr als das Bett.', { list: lay.oversizePlates.join(', ') }));
  if (lay.overflow) warn.push(t('Nicht alles passte auf die gewählte Platte – der Rest steht auf einer weiteren.'));
  // Objekt für Objekt: höchstens ein Teil je Platte höher als der Freiraum bis zur X-Achse (sonst bricht Orca ab)
  if (project.printSeq === 'object') {
    const { rod } = clearanceOf(tpl);
    for (let k = 1; k <= lay.count; k++) {
      const tall = project.parts.filter((p, i) => lay.plateOf[i] === k && p.geom.z > rod);
      if (tall.length > 1) warn.push(t('Platte {n}: {parts} sind höher als {h} mm – beim Druck Objekt für Objekt darf nur ein Teil so hoch sein. Auf eigene Platten verteilen oder Schicht für Schicht drucken.', { n: k, parts: tall.map(p => p.name).join(', '), h: de(rod, 0) }));
    }
  }
  $('plateWarn').textContent = warn.join(' '); $('plateWarn').classList.toggle('hidden', !warn.length);
  let html = '';
  for (let k = 1; k <= lay.count; k++) {
    const idx = project.parts.map((p, i) => i).filter(i => lay.plateOf[i] === k);
    if (!idx.length && fixed) continue;
    const need = plateNeeds({ plate: k, grams: plateSlotUse(plan, idx) }, mats, slots.length ? slots : null, slotMatchesKind);
    const sp = sl && sl.plates.find(p => p.plate === k), conflict = tempConflict(kinds, usedSlots(plan, idx));
    html += '<li class="plate-card"><div class="plate-head"><b>' + t('Platte {n}', { n: k }) + '</b><span class="muted small">' + t(idx.length > 1 ? '{n} Teile' : '{n} Teil', { n: idx.length }) +
      (sp ? ' · ' + duration(sp.time_s + prepS()) + ' · ' + de(sp.total_g, 1) + ' g' : '') + '</span>' +
      '<span class="plate-slots">' + need.tools.map(tl => { const s = slots[tl], c = s && /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : '#dddddd'; return '<span class="pslot" style="background:' + c + '" title="Slot ' + (tl + 1) + (s && s.type ? ' · ' + esc(s.type) : '') + '"></span>'; }).join('') + '</span></div>' +
      (lay.places ? plateSvg(tpl, lay, idx, slots, plan.slot) : '') +
      (need.missing.length ? '<p class="note bad small">' + need.missing.map(m => m.have ? t('Slot {n}: braucht {want}, eingelegt ist {have}', { n: m.slot + 1, want: esc(m.want), have: esc(m.have) })
        : t('Slot {n}: braucht {want}, leer', { n: m.slot + 1, want: esc(m.want) })).join(' · ') +
        (need.missing.some(m => m.have) && canAdopt ? ' <button type="button" class="linkbtn" data-adopt>' + t('Filament aus dem ACE übernehmen') + '</button>' : '') + '</p>' : '') +
      (conflict ? '<p class="note bad small">' + t(project.threemf ? '<b>Slict so nicht:</b> {text} Lösung: oben unter <b>Farben des Designers</b> auf Slots mit derselben Filamentart legen oder passendes Filament einlegen.'
        : '<b>Slict so nicht:</b> {text} Lösung: den Teilen/Körpern Slots mit derselben Filamentart geben oder passendes Filament einlegen.', { text: esc(conflictText(conflict, kinds)) }) + '</p>' : '') +
      // Teile der Platte (Platte und Anzahl ändern: in der Teileliste oben, Zeile des gewählten Teils)
      // Kopien eines Teils als eine Zeile „Teil ×14“ (20 Sätze wären sonst 40 Zeilen)
      '<ul class="plate-parts">' + plateRows(idx).map(r => '<li' + (r.idx.includes(project.selected) ? ' class="sel"' : '') + '><button type="button" class="linkbtn" data-pick="' + r.idx[0] + '">' +
        esc(r.name) + (r.idx.length > 1 ? ' <span class="pcopies">×' + r.idx.length + '</span>' : '') + '</button></li>').join('') + '</ul></li>';
  }
  $('plateList').innerHTML = html;
  // „Ganze Platte“ in der 3D-Ansicht: nach Verschieben, Kopien, Anordnen neu zeichnen (einmal je neuer Anordnung)
  const pk = plCache.lay && plCache.lay.key + '|' + project.selected;
  if (typeof plateView !== 'undefined' && plateView && pk !== plCache.shownKey) { plCache.shownKey = pk; if (geom) setTimeout(() => showModel(geom)); }
}

$('plateList').addEventListener('click', e => {
  if (e.target.closest('[data-adopt]')) { adoptSlotMaterials(); return; }
  const b = e.target.closest('[data-pick]'); if (!b) return;
  const i = +b.dataset.pick; if (i !== project.selected) selectPart(i);
});
$('plateAuto').addEventListener('click', () => {
  project.platesFixed = false;
  // 3MF des Designers bleibt: das Tool setzt nur Lage und Platte je Objekt neu (build3mfFromProject)
  if (project.threemf) { project.threemf.layout = 'auto'; const tpl = plTpl(); if (tpl) normalizePlates(tpl); }
  update(); toast(t('Teile automatisch platzsparend verteilt'));
});


/* Druckreihenfolge umschalten: Objekt für Objekt braucht Abstand – die Teile werden neu angeordnet (bei Makerworld-3MF die
   Platten des Designers einzeln, die sind sonst meist zu eng). */
/* Abstand zwischen den Teilen beim Anordnen (einstellbar, gemerkt in store.settings.packGap): neu anordnen, wie es die
   Zuordnung zulässt (automatisch verteilte Platten sofort; Makerworld-Platten des Designers bleiben, wie sie sind). */
setPackGap(store.settings.packGap ?? PART_GAP_MM);
function packGapSet(mm) {
  setPackGap(mm); store.settings.packGap = packGapMm; persist();
  $('packGapIn').value = String(packGapMm);
  const tpl = plTpl(); if (tpl && project) normalizePlates(tpl);
  if (project) update();
}
$('packGapIn').value = String(packGapMm);
$('packGapIn').addEventListener('change', () => packGapSet(Math.round(num($('packGapIn').value))));
$('packGapMinus').addEventListener('click', () => packGapSet(packGapMm - 1));
$('packGapPlus').addEventListener('click', () => packGapSet(packGapMm + 1));
$('plateSets').addEventListener('change', () => {
  if (!project) return;
  project.keepSets = $('plateSets').checked;
  update();
  toast(project.keepSets ? t('Sätze bleiben zusammen auf einer Platte') : t('Teile frei verteilt (Sätze können getrennt werden)'));
});
$('plateByObject').addEventListener('change', () => {
  if (!project) return;
  project.printSeq = $('plateByObject').checked ? 'object' : 'layer';
  setPrintSequence(project.printSeq === 'object');
  if (project.printSeq === 'object' && project.threemf && !project.threemf.layout && project.parts.length > 1) project.threemf.layout = 'plates';
  const tpl = plTpl(); if (tpl) normalizePlates(tpl);
  update();
  toast(project.printSeq === 'object' ? t('Druck Objekt für Objekt – Teile mit Abstand für den Druckkopf angeordnet') : t('Druck Schicht für Schicht'));
});
