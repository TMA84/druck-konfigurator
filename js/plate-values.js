'use strict';
/* Druckwerte je Platte (2026-10-26). Schichthöhe, erste Schicht, Beschleunigung, Temperaturen, Lüfter … stehen in einer
   3MF nur einmal (project_settings) – Orca slict alle Platten einer Datei mit denselben Werten. Jede Platte bekommt hier
   die Werte ihrer eigenen Teile (Leitteil wie exportPlan: erstes Teil ohne eigenen Slot, sonst das erste). Platten mit
   gleichen Werten bilden eine Gruppe; gibt es mehr als eine, baut js/costs-ui.js je Gruppe eine eigene 3MF (alle
   Platten drin, damit Nummern und Lage stimmen, aber mit den Werten der Gruppe, a.focus) und lässt den Server nur deren
   Platten slicen (api/slice?partial=1, Kette über reuse – tools/slicer.py). Eine Gruppe: alles wie bisher. */

// Plan einer Platte k (1-basiert): wie exportPlan, aber Leitteil und Slot nur aus den Teilen dieser Platte
function platePlan(plan, k, plates) {
  const own = plan.jobs.filter((j, i) => plates[i] === k);
  if (!own.length) return null;
  const def = own.filter(j => j.slot === null);
  return { r: (def[0] || own[0]).r, slot: def.length ? plan.slot : own[0].slot, own };
}
/* Gruppen gleicher Werte: [{plates: [1, 3], r, slot}] in Plattenreihenfolge. Schlüssel = die Projekt-Einstellungen, die
   Orca für diese Platte bekäme (ohne Turm – den plant der Export je Platte selbst). */
function plateGroups(tpl, plan, plates) {
  const n = Math.max(1, ...plates), live = exportSlots(tpl), machine = exportMachine(tpl), nFil = tpl.settings.filament_settings_id.length, groups = [], byKey = new Map();
  for (let k = 1; k <= n; k++) {
    const pp = platePlan(plan, k, plates);
    if (!pp) continue;
    let key;
    try {
      const { extra } = slotPlan(pp.own, pp.r, pp.slot);
      key = JSON.stringify([pp.slot, buildProjectSettings(tpl, pp.r, pp.slot, live, extra.filter(e => e.slot < nFil), machine).settings]);
    } catch (e) { console.error('plateGroups', e); key = 'k' + k; }
    if (!byKey.has(key)) { const g = { plates: [], r: pp.r, slot: pp.slot }; byKey.set(key, g); groups.push(g); }
    byKey.get(key).plates.push(k);
  }
  return groups;
}
// Für Hinweise (3MF für Orca, Export-Dialog): haben die Platten unterschiedliche Druckwerte?
function platesDiffer(defaultSlot) {
  try {
    if (!project || !lastResult) return false;
    const tpl = exportTemplate(lastResult.printer.id, lastResult.dSel), plan = exportPlan(defaultSlot);
    return !!tpl && plateGroups(tpl, plan, partPlates()).length > 1;
  } catch (e) { return false; }
}
