'use strict';
/* Mehrfarbig: Ein Teil kann aus mehreren Körpern bestehen (berührende Körper einer STL, Bauteile eines
   3MF-Objekts oder von Hand vereinte Dateien). part.bodies = [{name, start, count, slot, partId}] –
   Dreiecksbereiche in origPos/geom.pos (Drehen ändert die Reihenfolge nicht). Jeder Körper kann einen
   eigenen Slot bekommen; export3mf.js schreibt ihn als eigenes Orca-Bauteil. slot null = Slot des Teils. */

const BODY_PALETTE = ['#E8E8E8', '#E0533F', '#3F8AE0', '#F2C230', '#44B36B', '#9B59B6', '#FF8C1A', '#1ABC9C'];
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

// Import-Ergebnis → Körper mit Startindex; ein Slot nur, wenn er vom Slot des Objekts abweicht
function importedBodies(p) {
  if (!p.bodies || p.bodies.length < 2) return null;
  let start = 0;
  return p.bodies.map(b => {
    const o = { name: b.name, start, count: b.count, slot: b.extruder && b.extruder !== p.extruder ? b.extruder - 1 : null, partId: b.partId ?? null };
    start += b.count;
    return o;
  });
}
// fromPart: Körper stammt aus einem vereinten Teil – beim Trennen bekommt er wieder dessen Namen
const bodiesOf = p => p.bodies || [{ name: p.name, start: 0, count: p.origPos.length / 9, slot: null, partId: null, fromPart: true }];

// Maße je Körper, einmal je Netz berechnet
const bodyDimCache = new WeakMap();
function bodyDims(part) {
  let d = bodyDimCache.get(part.geom);
  if (d) return d;
  const pos = part.geom.pos;
  d = part.bodies.map(b => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = b.start * 9; i < (b.start + b.count) * 9; i++) { const k = i % 3, v = pos[i]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    return [0, 1, 2].map(k => mx[k] - mn[k]);
  });
  bodyDimCache.set(part.geom, d);
  return d;
}

const defaultSlot = () => lastResult ? +(store.last[slotKey(lastResult.printer.id)] || 0) : 0;
function slotColour(i, slots) {
  const s = slots[i];
  return s && /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : BODY_PALETTE[i % BODY_PALETTE.length];
}
const bodySlot = (part, b) => b.slot ?? part.slot ?? defaultSlot();
// Anzeige-Farbe: sehr dunkle Filamente (schwarzes ASA …) etwas anheben, sonst verschwinden sie auf dem dunklen Hintergrund
function viewRgb(hex) {
  const c = hexRgb(hex), l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], min = 0.22;
  if (l >= min) return c;
  const k = (min - l) / (1 - l);
  return c.map(v => v + (1 - v) * k);
}
// Farbe des Designers für eine Filamentnummer (0-basiert) – für die Ansicht „Designer“
function designerHex(d) {
  const c = project && project.threemf && project.threemf.settings && (project.threemf.settings.filament_colour || [])[d];
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : null;
}
const dView = () => typeof colourView === 'function' && colourView() === 'designer';
// Anzeigefarbe: Slot s oder – in der Ansicht „Designer“ – Farbe d des Designers (wenn bekannt)
const showHex = (s, d, slots) => (dView() && d != null && designerHex(d)) || slotColour(s, slots);
const rgbHex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
/* Bemalung je Dreieck (part.paintState, Filament des Designers 1-basiert, 0 = Slot des Teils) als Farbbereiche für
   Viewer.setPaint: zusammenhängende Dreiecke gleicher Farbe als ein Bereich (einmal je Netz), Farbe nach designMap. */
const paintRunCache = new WeakMap();
function paintRuns(part) {
  let r = paintRunCache.get(part.geom);
  if (r) return r;
  const ps = part.paintState; r = [];
  for (let i = 0; i < ps.length;) { let j = i + 1; while (j < ps.length && ps[j] === ps[i]) j++; r.push({ start: i, count: j - i, st: ps[i] }); i = j; }
  paintRunCache.set(part.geom, r);
  return r;
}
function paintedColours(part, slots, offset = 0) {
  const map = (project.threemf && project.threemf.designMap) || {}, own = part.slot ?? defaultSlot(), cache = {};
  return paintRuns(part).map(r => { const d = r.st ? r.st - 1 : part.dSlot, s = r.st ? map[d] ?? d : own, key = s + '/' + d;
    return { start: offset + r.start, count: r.count, rgb: cache[key] || (cache[key] = viewRgb(showHex(s, d, slots))) }; });
}
// Farb-Modifikatoren eines Teils als farbige Schicht; xf = Umrechnung der Koordinaten (ganze Platte) oder null
function modOverlayFor(part, slots, xf) {
  if (typeof modifierOverlay !== 'function') return [];
  const map = (project.threemf && project.threemf.designMap) || {};
  return modifierOverlay(part).map(o => {
    let pos = o.pos;
    if (xf) { pos = new Float32Array(o.pos.length); for (let i = 0; i < pos.length; i += 3) { const q = xf(o.pos[i], o.pos[i + 1], o.pos[i + 2]); pos[i] = q[0]; pos[i + 1] = q[1]; pos[i + 2] = q[2]; } }
    return { pos, color: rgbHex(viewRgb(showHex(map[o.dSlot] ?? o.dSlot, o.dSlot, slots))) };
  });
}

// Vorschau: alle Körper in ihrer Slotfarbe (Häkchen) oder ein Körper hervorgehoben (Zeile unter der Maus)
function paintBodies(part, highlight) {
  let paint = null;
  if (typeof plateView !== 'undefined' && plateView && shownPlate) {
    // ganze Platte: jedes Teil (und seine Körper) in seiner Slotfarbe, das gewählte Teil beim Überfahren hervorgehoben
    let over = [];
    if ($('bodyShow').checked) {
      const slots = slotChoices();
      paint = shownPlate.ranges.flatMap(r => { const q = project.parts[r.i];
        if (q && q.paintState && q.paintState.length === r.count) return paintedColours(q, slots, r.start);
        return q && q.bodies ? q.bodies.map(b => ({ start: r.start + b.start, count: b.count, rgb: viewRgb(showHex(bodySlot(q, b), b.dSlot, slots)) }))
          : [{ start: r.start, count: r.count, rgb: viewRgb(showHex(q ? q.slot ?? defaultSlot() : 0, q && q.dSlot, slots)) }]; });
      over = shownPlate.ranges.flatMap(r => project.parts[r.i] ? modOverlayFor(project.parts[r.i], slots, r.xf) : []);
    }
    Viewer.setPaint(paint);
    if (Viewer.setOverlay) Viewer.setOverlay(over);
    return;
  }
  const slots = slotChoices();
  if (part && part.bodies) {
    if (highlight != null) paint = part.bodies.map((b, j) => ({ start: b.start, count: b.count, rgb: j === highlight ? [1, .8, 0] : [.35, .37, .4] }));
    else if ($('bodyShow').checked) paint = part.bodies.map(b => ({ start: b.start, count: b.count, rgb: viewRgb(showHex(bodySlot(part, b), b.dSlot, slots)) }));
  } else if (part && part.paintState && part.paintState.length === part.geom.n && $('bodyShow').checked) {
    paint = paintedColours(part, slots);
  } else if (part && part.modVols && $('bodyShow').checked) {
    // nur Modifikatoren: das Teil selbst in seiner Slotfarbe, damit die Farben zusammenpassen
    paint = [{ start: 0, count: part.geom.n, rgb: viewRgb(showHex(part.slot ?? defaultSlot(), part.dSlot, slots)) }];
  }
  Viewer.setPaint(paint);
  if (Viewer.setOverlay) Viewer.setOverlay(part && $('bodyShow').checked && highlight == null ? modOverlayFor(part, slots, null) : []);
  if (miniReady) MiniView.setPaint(paint);
}

function renderBodies() {
  const box = $('bodyBox'), part = project && project.parts[project.selected];
  const joinable = !!part && !project.threemf && project.parts.length > 1;
  const multi = !!part && !!part.bodies, modColours = !!part && !!((part.modVols && part.modVols.length) || part.paintState);
  box.classList.toggle('hidden', !multi && !joinable && !modColours);
  if (!part) { paintBodies(null); return; }
  if (typeof secSum === 'function') secSum('bodies', multi ? t('{n} Körper', { n: part.bodies.length }) : '');
  const slots = slotChoices(), own = part.slot ?? null;
  const places = samePlacements(part), plates = [...new Set(places.map(p => p.plate || 1))].sort((a, b) => a - b);
  $('bodyInfo').innerHTML = multi
    ? t('{n} Körper – jeder kann einen eigenen Slot bekommen: oben in der Teileliste unter dem Teil. „wie Teil“ = {slot}.', { n: part.bodies.length, slot: own === null ? t('Slot aus dem Export-Dialog') : 'Slot ' + (own + 1) }) +
      (places.length > 1 ? t(' Gilt für alle {n} Platzierungen dieses Objekts (Platte {plates}).', { n: places.length, plates: plates.join(', ') }) : '')
    : t('Gehören mehrere Dateien zu <b>einem</b> mehrfarbigen Modell (z. B. je Farbe eine STL), hier zu einem Teil vereinen – die Lage aus den Dateien bleibt.');
  if (multi) {
    const dims = bodyDims(part);
    // Slot je Körper: in der Teileliste (Zeile des gewählten Teils, wie die Unterobjekte in OrcaSlicer)
    $('bodyList').innerHTML = '';
  } else $('bodyList').innerHTML = '';
  $('bodyJoin').classList.toggle('hidden', !joinable);
  if (joinable) $('bodyJoinSel').innerHTML = project.parts.map((p, i) => i === project.selected ? '' : '<option value="' + i + '">' + esc(p.name) + '</option>').join('');
  $('bodySplit').classList.toggle('hidden', !multi);
  paintBodies(part);
}

$('bodyList').addEventListener('click', e => {
  const c = e.target.closest('[data-body-slot]'); if (!c) return;
  const part = project.parts[project.selected], j = +c.dataset.bodySlot, b = part.bodies[j];
  openSlotPicker(c, b.slot ?? null, { title: t('Slot für {name}', { name: t(b.name) }), std: t('wie Teil'), stdSlot: part.slot ?? defaultSlot() }, v => {
    samePlacements(part).forEach(p => { if (p.bodies && p.bodies[j]) p.bodies[j].slot = v; });
    update();
  });
});
$('bodyList').addEventListener('mouseover', e => { const li = e.target.closest('[data-body]'); if (li) paintBodies(project.parts[project.selected], +li.dataset.body); });
$('bodyList').addEventListener('mouseleave', () => paintBodies(project.parts[project.selected]));
$('bodyShow').addEventListener('change', () => paintBodies(project && project.parts[project.selected]));

function replaceParts(parts, selected) {
  project.parts = parts;
  if (!project.threemf) project.platesFixed = false;
  parts.forEach((p, i) => { p.id = i; });
  $('partList').classList.remove('hidden');
  selectPart(selected);
}

// Teil j in das gewählte Teil aufnehmen: Lage aus den Dateien, Körper behalten ihren Slot
function joinParts(i, j) {
  const a = project.parts[i], b = project.parts[j], na = a.origPos.length / 9;
  const origPos = new Float32Array(a.origPos.length + b.origPos.length);
  origPos.set(a.origPos); origPos.set(b.origPos, a.origPos.length);
  const bodies = [...bodiesOf(a).map(x => ({ ...x })), ...bodiesOf(b).map(x => ({ ...x, start: x.start + na, slot: x.slot ?? b.slot ?? null }))];
  const joined = { ...a, origPos, R: IDENTITY3, geom: makeGeom(a.name, origPos), bodies, holes: [], holeGeom: null, holeCands: null };
  const parts = project.parts.map(p => p === a ? joined : p).filter(p => p !== b);
  replaceParts(parts, parts.indexOf(joined));
  toast(t('{b} mit {a} vereint ({n} Körper)', { b: b.name, a: a.name, n: bodies.length }));
}
$('bodyJoinBtn').addEventListener('click', () => { const j = +$('bodyJoinSel').value; if (Number.isInteger(j)) joinParts(project.selected, j); });

// Jeder Körper wird ein eigenes Teil (Lage wie bisher, Slot vom Körper oder Teil)
$('bodySplit').addEventListener('click', () => {
  const part = project.parts[project.selected], i = project.selected, tm = project.threemf;
  const pieces = part.bodies.map(b => {
    const name = b.fromPart ? b.name : part.name + ' · ' + b.name, origPos = part.origPos.slice(b.start * 9, (b.start + b.count) * 9);
    const piece = { ...part, name, origPos, geom: partGeom({ ...part, name, origPos }), slot: b.slot ?? part.slot ?? null, input: part.input && { ...part.input }, bodies: null, holes: [], holeGeom: null, holeCands: null, copyGroup: null };
    // aus einer Makerworld-3MF: eigene Teile mit eigenem Netz (das Objekt des Designers entfällt); Bemalung des Körpers bleibt
    if (tm) Object.assign(piece, { extra: true, objectId: null, instance: 0, modSlots: [], modVols: [], painted: false, dSlot: null,
      paintState: part.paintState ? part.paintState.slice(b.start, b.start + b.count) : null, paintSlots: part.paintState ? part.paintSlots : [] });
    return piece;
  });
  if (tm) tm.removed = true;
  replaceParts([...project.parts.slice(0, i), ...pieces, ...project.parts.slice(i + 1)], i);
  toast(t('{name} in {n} Teile getrennt', { name: part.name, n: pieces.length }));
});
