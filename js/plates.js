'use strict';
/* Mehrere Platten (ohne DOM – tests/plates.js): welche Platten sich seit dem letzten Slicen geändert haben,
   welches Filament jede Platte braucht, eine Druckreihenfolge mit möglichst wenig Spulentausch und der
   Stand der Druckwarteschlange.
   Werkzeug n im G-Code druckt aus ACE-Slot n (js/send-ui.js). Eine Platte „passt“, wenn in jedem Slot, den sie
   nutzt, Filament der geslicten Art liegt; sonst muss vorher eine Spule getauscht werden. */

/* Geänderte Platten (1-basiert) zwischen zwei Ständen {global, plates:[Signatur je Platte]} –
   null = alles neu slicen (anderer globaler Stand, andere Plattenzahl oder kein früherer Stand) */
function changedPlates(prev, next) {
  if (!prev || !next || prev.global !== next.global || prev.plates.length !== next.plates.length) return null;
  return next.plates.map((s, i) => s === prev.plates[i] ? 0 : i + 1).filter(Boolean);
}

/* Bedarf einer geslicten Platte {plate, grams:[je Werkzeug]}: genutzte Slots und die, deren Filament nicht passt.
   materials: {slot: {kind, name}} (geslict), ace: [{present, type, colour}] je Slot oder null (unbekannt),
   matches(type, kind): passt Slot-Typ zur Filamentart */
function plateNeeds(p, materials, ace, matches) {
  const tools = (p.grams || []).map((g, t) => g > 0 ? t : -1).filter(t => t >= 0);
  const missing = !ace ? [] : tools.filter(t => {
    const m = materials && materials[t], s = ace[t];
    return !s || !s.present || (m && m.kind && !matches(s.type, m.kind));
  }).map(t => ({ slot: t, want: materials && materials[t] ? materials[t].name : '?', have: ace[t] && ace[t].present ? ace[t].type : '' }));
  return { plate: p.plate, tools, missing };
}

/* Reihenfolge: zuerst alle Platten, die mit dem jetzigen ACE-Stand drucken, dann die übrigen nach nötigem
   Tausch gruppiert (gleicher Tausch hintereinander, weniger Tausch zuerst) – innerhalb einer Gruppe nach Nummer. */
function orderPlates(plates, materials, ace, matches) {
  const needs = plates.map(p => plateNeeds(p, materials, ace, matches));
  const key = n => n.missing.map(m => m.slot + ':' + m.want).join('|');
  const groups = new Map();
  for (const n of needs) { const k = key(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  const order = [...groups.entries()].sort(([a, x], [b, y]) => (a === '' ? -1 : b === '' ? 1 : 0) || x[0].missing.length - y[0].missing.length || x[0].plate - y[0].plate);
  const list = order.flatMap(([, g]) => g.sort((a, b) => a.plate - b.plate));
  const swaps = order.filter(([k]) => k !== '').length;
  return { list, swaps, changed: list.some((n, i) => n.plate !== plates[i].plate) };
}

/* Warteschlange: items [{plate, time_s, state: wait | printing | done | skipped, seen}] – Stand des Druckers
   st {printing, job:{status, remaining_min}} weiterschalten. Gibt die Platte zurück, die gerade fertig wurde. */
function queueTick(q, st) {
  const cur = q.items.find(i => i.state === 'printing');
  if (!cur || !st) return null;
  const status = st.job && st.job.status;
  if (st.printing && status !== 'fertig' && status !== 'abgebrochen') { cur.seen = true; return null; }
  // Erst wenn der Drucker den Auftrag einmal gemeldet hat – direkt nach dem Start ist er oft noch „frei“
  if (!cur.seen && !(Date.now() - (cur.started || 0) > 10 * 60000)) return null;
  cur.state = status === 'abgebrochen' ? 'wait' : 'done';
  cur.aborted = status === 'abgebrochen';
  cur.finished = Date.now();
  return cur;
}
const queueNext = q => q.items.find(i => i.state === 'wait') || null;
// Restzeit: laufender Druck laut Drucker, dazu alle wartenden Platten laut Orca
function queueRemaining(q, st) {
  const cur = q.items.find(i => i.state === 'printing');
  const now = cur ? (st && st.job && st.job.remaining_min != null ? st.job.remaining_min * 60 : cur.time_s || 0) : 0;
  return now + q.items.filter(i => i.state === 'wait').reduce((s, i) => s + (i.time_s || 0), 0);
}
