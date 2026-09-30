'use strict';
/* Farben des Designers → Slot (① Modell → Filamente → „Modell → Slot“, nur Makerworld-/Orca-3MF): Jede Farbe, die der Designer vergeben hat
   (Objekt, Körper, Farb-Modifikator wie ein Schriftzug), lässt sich auf einen anderen ACE-Slot legen – z. B. auf
   einen Slot mit Filament derselben Art, damit PLA und ASA/ABS nicht auf einer Platte landen.
   Objekt und Körper: part.slot / body.slot werden umgestellt. Modifikatoren: project.threemf.designMap
   {Slot des Designers: eigener Slot} (js/export3mf.js patchModifierExtruders). Bemalung je Dreieck bleibt.
   Dazu die Prüfung, ob eine Platte Filamente mit zu unterschiedlicher Düsentemperatur mischt. */

// PLA/TPU drucken um 200–220 °C, PETG/ABS/ASA um 240–260 °C – Orca lehnt Mischungen der beiden Gruppen ab
const TEMP_GROUP = { pla: 'niedrig', tpu: 'niedrig', petg: 'hoch', abs: 'hoch', asa: 'hoch' };

// Slot-Belegung der 3MF: Filamentart je Slot so, wie sie in die Datei geschrieben wird
function slotKindsFor(tpl, plan) {
  const n = tpl.settings.filament_settings_id.length, { extra } = slotPlan(plan.jobs, plan.r, plan.slot);
  return filamentSlotTypes(plan.r, plan.slot, exportSlots(tpl), n, extra).map(t => t ? kindOfType(t) : null);
}
// Genutzte Slots einer Teileauswahl inkl. Farb-Modifikatoren des Designers (umgelegt)
function usedSlots(plan, idx) {
  const map = (project.threemf && project.threemf.designMap) || {}, used = new Set();
  for (const i of idx) {
    const j = plan.jobs[i];
    used.add(j.slot ?? plan.slot);
    for (const b of j.bodies || []) if (b.slot != null) used.add(b.slot);
    for (const d of j.part.modSlots || []) used.add(map[d] ?? d);
    for (const d of j.part.paintSlots || []) used.add(map[d] ?? d);   // Bemalung je Dreieck (js/paint.js)
    if (typeof extraSlots === 'function') extraSlots(j.part).forEach(s => used.add(s));   // erhabene Beschriftung (js/engrave.js), eigene Bemalung (js/paint-ui.js)
  }
  return [...used].filter(s => s != null).sort((a, b) => a - b);
}
// Mischt diese Auswahl niedrige und hohe Düsentemperatur? → {low:[slots], high:[slots]} oder null
function tempConflict(kinds, slots) {
  const g = { niedrig: [], hoch: [] };
  slots.forEach(s => { const k = kinds[s], grp = TEMP_GROUP[k]; if (grp) g[grp].push(s); });
  return g.niedrig.length && g.hoch.length ? { low: g.niedrig, high: g.hoch } : null;
}
function conflictText(c, kinds) {
  const list = ss => ss.map(s => 'Slot ' + (s + 1) + ' ' + (ORCA_KIND[kinds[s]] || kinds[s])).join(', ');
  return t('{low} zusammen mit {high} – zu unterschiedliche Düsentemperaturen, so slict OrcaSlicer nicht.', { low: list(c.low), high: list(c.high) });
}
// Alle Platten prüfen (für ③ und die Plattenkarten): [{plate, text}]
function plateConflicts() {
  const tpl = plTpl(); if (!project || !tpl) return [];
  const plan = exportPlan(costDefaultSlot()), lay = projectLayout(tpl), kinds = slotKindsFor(tpl, plan), out = [];
  for (let k = 1; k <= lay.count; k++) {
    const idx = project.parts.map((p, i) => i).filter(i => lay.plateOf[i] === k), c = idx.length && tempConflict(kinds, usedSlots(plan, idx));
    if (c) out.push({ plate: k, text: conflictText(c, kinds), c });
  }
  return out;
}

// Farben des Designers im Projekt: Slot des Designers → {colour, type, uses}
function designColours() {
  const out = new Map(), st = (project.threemf && project.threemf.settings) || {};
  const add = (d, what) => { if (d == null) return; if (!out.has(d)) out.set(d, { d, colour: (st.filament_colour || [])[d], type: (st.filament_type || [])[d], uses: new Set() }); out.get(d).uses.add(what); };
  for (const p of project.parts) {
    add(p.dSlot, p.name);
    (p.bodies || []).forEach(b => add(b.dSlot, p.name + ' · ' + b.name));
    (p.modSlots || []).forEach(d => add(d, t('{name} (Modifikator)', { name: p.name })));
    (p.paintSlots || []).forEach(d => add(d, t('{name} (bemalt)', { name: p.name })));
  }
  return [...out.values()].sort((a, b) => a.d - b.d);
}

// Objekt und Körper mit Farbe des Designers folgen der Zuordnung (eigene Slot-Änderungen an ihnen werden dabei ersetzt)
// Nur Teile/Körper, die genau diese Farbe des Designers haben, bekommen den neuen Slot – eigene Slotwahl für andere
// Teile oder den Grundkörper bleibt (vorher wurden alle aus der Zuordnung neu gesetzt und so zurückgestellt)
function setDesignSlot(d, s) {
  const map = project.threemf.designMap;
  if (s === d) delete map[d]; else map[d] = s;
  const moved = [];
  for (const p of project.parts) {
    if (p.dSlot === d) { p.slot = s; p.matManual = false; moved.push(p); }
    for (const b of p.bodies || []) if (b.dSlot === d) b.slot = s === p.slot ? null : s;
  }
  if (typeof adoptSlotMaterialFor === 'function') adoptSlotMaterialFor(moved);
  update();
  // selbst übermalte Stellen (js/paint-ui.js) haben feste Slots und folgen der Zuordnung nicht
  const d1 = d + 1, over = project.parts.some(p => { const u = typeof paintUserCodes === 'function' && paintUserCodes(p);
    if (!u) return false;
    for (const k in u) { const dc = typeof paintDesignerCode === 'function' ? paintDesignerCode(p, +k) : ''; if (dc && paintStates(dc).includes(d1)) return true; }
    return false; });
  if (over) toast(t('Hinweis: Wo du Farbe {n} des Designers selbst übermalt hast, bleibt deine Farbe.', { n: d1 }));
}
// „Wie vom Designer“ (Filamente des Modells, js/slot-picker.js): alle Farben wieder auf ihren eigenen Slot
function resetDesignColours() {
  if (!project || !project.threemf) return;
  Object.keys(project.threemf.designMap || {}).map(Number).forEach(d => setDesignSlot(d, d));
  toast(t('Farben wieder wie vom Designer'));
}

// Filament der Teile auf das stellen, was in ihrem Slot liegt (z. B. ABS-Profil → ASA, wenn die ACE ASA meldet)
function slotMaterialChanges() {
  const slots = typeof slotChoices === 'function' ? slotChoices() : [], def = costDefaultSlot(), out = [];
  for (const p of project.parts) {
    const s = slots[p.slot ?? def];
    if (!s || !s.type || !p.input) continue;
    // mit der Spule im Slot verknüpftes Filamentprofil zuerst (Filamentverwaltung), sonst passend zum Typ
    const linked = typeof spoolProfileForSlot === 'function' ? spoolProfileForSlot(p.slot ?? def) : null;   // Profil-Id oder null
    const m = linked || materialForSlotType(s.type, p.input.material);
    if (m !== p.input.material) out.push([p, m]);
  }
  return out;
}
function adoptSlotMaterials() {
  const ch = slotMaterialChanges(), n = ch.length;
  ch.forEach(([p, m]) => { p.input.material = m; });
  loadPartIntoForm(project.parts[project.selected]); update();
  toast(n ? t(n > 1 ? '{n} Teile auf das Filament im Slot umgestellt' : '{n} Teil auf das Filament im Slot umgestellt', { n }) : t('Filament passt schon zu den Slots'));
}

/* Mehr Farben des Designers als Slots (z. B. Mario mit 7 Farben, eine ACE mit 4 Slots): die überzähligen Farben gleich auf
   den Slot mit der ähnlichsten Farbe legen (Slotfarbe vom Drucker/eigene Angabe, sonst die Farbe des Designers dort) –
   anpassen lässt es sich danach wie jede andere Zuordnung. Rückgabe: Anzahl umgelegter Farben. */
function autoMapDesignColours() {
  if (!project || !project.threemf) return 0;
  const cols = designColours(), slots = typeof slotChoices === 'function' ? slotChoices() : [], n = slots.length || 4;
  const map = project.threemf.designMap || (project.threemf.designMap = {});
  const rgb = h => /^#[0-9a-f]{6}$/i.test(h || '') ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null;
  const dist = (a, b) => (a[0] - b[0]) ** 2 * 0.3 + (a[1] - b[1]) ** 2 * 0.59 + (a[2] - b[2]) ** 2 * 0.11;
  const slotRgb = i => rgb((slots[i] || {}).colour) || rgb((cols.find(c => c.d === i) || {}).colour);
  // Belegung bekannt (vom Drucker oder eigene Angabe): jede Farbe auf den ähnlichsten Slot; sonst nur die überzähligen
  const known = slots.some(s => rgb(s.colour)) && !(typeof slotSource === 'function' && lastResult && slotSource(exportTemplate(lastResult.printer.id, lastResult.dSel)).kind === 'template');
  let moved = 0;
  for (const c of cols) {
    if ((!known && c.d < n) || map[c.d] != null) continue;
    // nur Slots mit Filament derselben Temperaturgruppe (PLA zu PLA/TPU, PETG/ABS/ASA untereinander) – sonst slict Orca nicht
    const grp = TEMP_GROUP[kindOfType(c.type || '')], ok = [...Array(n).keys()].filter(i => { const ty = (slots[i] || {}).type; return !grp || !ty || TEMP_GROUP[kindOfType(ty)] === grp; });
    const cand = ok.length ? ok : [...Array(n).keys()];
    const me = rgb(c.colour); let best = cand.includes(c.d % n) ? c.d % n : cand[0], bd = Infinity;
    if (me) for (const i of cand) { const s = slotRgb(i); if (s && dist(me, s) < bd) { bd = dist(me, s); best = i; } }
    if (best !== c.d) { map[c.d] = best; moved++; }
  }
  // Teile und Körper mit diesen Farben auf die neuen Slots (wie beim Umlegen von Hand)
  for (const p of project.parts) {
    if (p.dSlot != null && map[p.dSlot] != null) { p.slot = map[p.dSlot]; p.matManual = false; }
    for (const b of p.bodies || []) if (b.dSlot != null && map[b.dSlot] != null) b.slot = map[b.dSlot] === p.slot ? null : map[b.dSlot];
  }
  return moved;
}
// „Automatisch“ (Filamente des Modells): neu nach Farbe und Material zuordnen
function autoAssignDesignColours() {
  const tm = project && project.threemf; if (!tm) return;
  // neu zuordnen: bisherige Zuordnung verwerfen, Teile/Körper wieder auf die Farben des Designers, dann nach Ähnlichkeit
  tm.designMap = {};
  for (const p of project.parts) { if (p.dSlot != null) p.slot = p.dSlot; for (const b of p.bodies || []) if (b.dSlot != null) b.slot = b.dSlot === p.slot ? null : b.dSlot; }
  const n = autoMapDesignColours();
  update();
  toast(n ? t('{n} Farben des Designers auf ähnliche Slots gelegt', { n }) : t('Farben passen schon zu den Slots'));
}
