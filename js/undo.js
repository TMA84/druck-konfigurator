'use strict';
/* Rückgängig / Wiederholen für das Projekt (Strg/⌘+Z, Strg/⌘+Umschalt+Z bzw. Strg+Y, Knöpfe in der Werkzeugleiste).
   Nach jeder Änderung (update(), kurz verzögert) wird der bearbeitbare Stand festgehalten: Teile (Reihenfolge, Slot,
   Platte, Kopien, Drehung, Größe, Filament/Werte, Körper-Slots, Beschriftung, Bohrlöcher …), Farbzuordnung, Anordnung,
   Druckreihenfolge, gewähltes Teil. Große, unveränderliche Daten (Netze, Bemalung, Modifikatoren) bleiben Verweise –
   ein Schritt kostet nur ein paar Kilobyte. Bis UNDO_MAX Schritte; ein neu geladenes Modell beginnt von vorn. */
const UNDO_MAX = 60, UNDO_DELAY_MS = 350;
const UNDO_HEAVY = new Set(['origPos', 'geom', 'holeGeom', 'holeCands', 'paintState', 'modVols']);
const undo = { past: [], future: [], cur: null, key: null, project: null, timer: 0, applying: false };

function undoCapture() {
  const parts = project.parts.map(p => {
    const f = {};
    for (const [k, v] of Object.entries(p)) if (!UNDO_HEAVY.has(k)) f[k] = v;
    return { ref: p, f: JSON.parse(JSON.stringify(f)) };
  });
  const tm = project.threemf;
  const extra = JSON.parse(JSON.stringify({ designMap: tm ? tm.designMap || {} : null, layout: tm ? tm.layout || null : null, removed: tm ? !!tm.removed : null,
    platesFixed: !!project.platesFixed, printSeq: project.printSeq || 'layer', name: project.name }));
  return { parts, extra, selected: project.selected || 0 };
}
const undoKey = s => JSON.stringify([s.parts.map(x => x.f), s.extra]);

// Nach jeder Änderung aufgerufen (js/panel.js update)
function undoRecord() {
  if (undo.applying || !project) { if (!project) undoReset(); return; }
  clearTimeout(undo.timer);
  undo.timer = setTimeout(() => {
    if (undo.applying || !project) return;
    if (project !== undo.project) { undoReset(); undo.project = project; }
    const s = undoCapture(), k = undoKey(s);
    if (k === undo.key) { if (undo.cur) undo.cur.selected = s.selected; return; }
    if (undo.cur) { undo.past.push(undo.cur); if (undo.past.length > UNDO_MAX) undo.past.shift(); undo.future = []; }
    undo.cur = s; undo.key = k;
    undoButtons();
  }, UNDO_DELAY_MS);
}
function undoReset() { undo.past = []; undo.future = []; undo.cur = null; undo.key = null; undo.project = project; undoButtons(); }

function undoApply(s) {
  undo.applying = true;
  try {
    const sameGeom = (p, f) => JSON.stringify([p.R || null, p.scale || null]) === JSON.stringify([f.R || null, f.scale || null]);
    project.parts = s.parts.map(({ ref, f }) => {
      const geomOk = sameGeom(ref, f), holes = f.holes;
      for (const k of Object.keys(ref)) if (!UNDO_HEAVY.has(k)) delete ref[k];
      Object.assign(ref, JSON.parse(JSON.stringify(f)));
      if (!geomOk) {
        ref.geom = partGeom(ref);
        if (typeof findHoles === 'function' && holes && holes.length) { ref.holeCands = findHoles(ref.geom); ref.holeGeom = ref.geom; }
        if (typeof orientCache !== 'undefined') orientCache.delete(ref);
      }
      return ref;
    });
    project.parts.forEach((p, i) => { p.id = i; });
    const tm = project.threemf, e = s.extra;
    if (tm) { tm.designMap = { ...(e.designMap || {}) }; tm.layout = e.layout || undefined; if (!tm.layout) delete tm.layout; tm.removed = e.removed || undefined; }
    project.platesFixed = e.platesFixed; project.printSeq = e.printSeq;
    if (typeof setPrintSequence === 'function') setPrintSequence(e.printSeq === 'object');
    undo.cur = s; undo.key = undoKey(s);
    const sel = Math.min(s.selected, project.parts.length - 1);
    if (typeof renderFileinfo === 'function') renderFileinfo();
    $('partList').classList.remove('hidden');
    selectPart(Math.max(0, sel));   // lädt Formular und 3D-Ansicht, ruft update()
  } finally { setTimeout(() => { undo.applying = false; }, UNDO_DELAY_MS + 50); }
  undoButtons();
}
function undoStep(dir) {
  if (!project || undo.applying) return false;
  clearTimeout(undo.timer);
  // noch nicht festgehaltene Änderung zuerst sichern, damit sie sich wiederholen lässt
  const now = undoCapture();
  if (undo.cur && undoKey(now) !== undo.key) { undo.past.push(undo.cur); undo.future = []; undo.cur = now; undo.key = undoKey(now); }
  const from = dir < 0 ? undo.past : undo.future, to = dir < 0 ? undo.future : undo.past;
  if (!from.length) { toast(dir < 0 ? t('Nichts zum Rückgängigmachen') : t('Nichts zum Wiederholen')); return false; }
  to.push(undo.cur);
  undoApply(from.pop());
  toast(dir < 0 ? t('Rückgängig') : t('Wiederholt'));
  return true;
}
function undoButtons() {
  const u = $('tbUndo'), r = $('tbRedo');
  if (u) u.disabled = !project || !undo.past.length;
  if (r) r.disabled = !project || !undo.future.length;
}
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  // in Eingabefeldern bleibt das eigene Rückgängig des Browsers
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(checkbox|radio|range|button)$/i.test(el.type || ''))) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault();
  undoStep(k === 'y' || e.shiftKey ? 1 : -1);
});
$('tbUndo').addEventListener('click', () => undoStep(-1));
$('tbRedo').addEventListener('click', () => undoStep(1));
