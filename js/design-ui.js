'use strict';
/* Farben des Designers → Slot (① Modell, nur Makerworld-/Orca-3MF): Jede Farbe, die der Designer vergeben hat
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
    if (typeof textSlots === 'function') textSlots(j.part).forEach(s => used.add(s));   // erhabene Beschriftung (js/engrave.js)
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
  }
  return [...out.values()].sort((a, b) => a.d - b.d);
}

function renderDesignColours() {
  const box = $('designBox');
  if (!project || !project.threemf) { box.classList.add('hidden'); return; }
  const cols = designColours();
  if (cols.length < 2) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const map = project.threemf.designMap || (project.threemf.designMap = {});
  const slots = typeof slotChoices === 'function' ? slotChoices() : [], n = Math.max(4, slots.length);
  const sw = c => '<span class="pslot" style="background:' + (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#dddddd') + '"></span>';
  $('designList').innerHTML = cols.map(c => {
    const to = map[c.d] ?? c.d;
    const opts = Array.from({ length: n }, (_, s) => { const x = slots[s] || {}; return '<option value="' + s + '"' + (s === to ? ' selected' : '') + '>Slot ' + (s + 1) + (x.type ? ' · ' + esc(x.type) : '') + (x.name && !x.type ? ' · ' + esc(x.name) : '') + '</option>'; }).join('');
    return '<li>' + sw(c.colour) + '<span class="dc-name" title="' + esc([...c.uses].join(', ')) + '">' + t('Farbe {n}', { n: c.d + 1 }) + (c.type ? ' <small class="muted">' + esc(c.type) + '</small>' : '') + '<small>' + esc([...c.uses].slice(0, 2).join(', ') + (c.uses.size > 2 ? ' …' : '')) + '</small></span>' +
      '<span class="dc-arrow">→</span>' + sw((slots[to] || {}).colour) + '<select data-design="' + c.d + '" aria-label="' + t('Slot für Farbe {n}', { n: c.d + 1 }) + '">' + opts + '</select></li>';
  }).join('');
  const painted = project.parts.some(p => p.paintTris);
  $('designNote').textContent = painted ? t('Bemalte Flächen (Farbpinsel des Designers) behalten ihren Slot – umlegen geht dort nur in OrcaSlicer.') : '';
  $('designNote').classList.toggle('hidden', !painted);
  $('designReset').classList.toggle('hidden', !Object.keys(map).length);
}

// Objekt und Körper mit Farbe des Designers folgen der Zuordnung (eigene Slot-Änderungen an ihnen werden dabei ersetzt)
function setDesignSlot(d, s) {
  const map = project.threemf.designMap;
  if (s === d) delete map[d]; else map[d] = s;
  const to = x => map[x] ?? x;
  for (const p of project.parts) {
    if (p.dSlot != null) p.slot = to(p.dSlot);
    for (const b of p.bodies || []) if (b.dSlot != null) { const s = to(b.dSlot); b.slot = s === p.slot ? null : s; }
  }
  update();
}
$('designList').addEventListener('change', e => { const s = e.target.closest('[data-design]'); if (s) setDesignSlot(+s.dataset.design, +s.value); });
$('designReset').addEventListener('click', () => { Object.keys(project.threemf.designMap).map(Number).forEach(d => setDesignSlot(d, d)); toast(t('Farben wieder wie vom Designer')); });

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
