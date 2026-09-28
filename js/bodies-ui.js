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

// Vorschau: alle Körper in ihrer Slotfarbe (Häkchen) oder ein Körper hervorgehoben (Zeile unter der Maus)
function paintBodies(part, highlight) {
  let paint = null;
  if (part && part.bodies) {
    const slots = slotChoices();
    if (highlight != null) paint = part.bodies.map((b, j) => ({ start: b.start, count: b.count, rgb: j === highlight ? [1, .8, 0] : [.35, .37, .4] }));
    else if ($('bodyShow').checked) paint = part.bodies.map(b => ({ start: b.start, count: b.count, rgb: hexRgb(slotColour(bodySlot(part, b), slots)) }));
  }
  Viewer.setPaint(paint);
  if (miniReady) MiniView.setPaint(paint);
}

function renderBodies() {
  const box = $('bodyBox'), part = project && project.parts[project.selected];
  const joinable = !!part && !project.threemf && project.parts.length > 1;
  const multi = !!part && !!part.bodies;
  box.classList.toggle('hidden', !multi && !joinable);
  if (!part) { paintBodies(null); return; }
  const slots = slotChoices(), own = part.slot ?? null;
  const places = samePlacements(part), plates = [...new Set(places.map(p => p.plate || 1))].sort((a, b) => a - b);
  $('bodyInfo').innerHTML = multi
    ? part.bodies.length + ' Körper – jeder kann einen eigenen Slot und damit eine eigene Farbe bekommen. „wie Teil“ = ' + (own === null ? 'Slot aus dem Export-Dialog' : 'Slot ' + (own + 1)) + '.' +
      (places.length > 1 ? ' Gilt für alle ' + places.length + ' Platzierungen dieses Objekts (Platte ' + plates.join(', ') + ').' : '')
    : 'Gehören mehrere Dateien zu <b>einem</b> mehrfarbigen Modell (z. B. je Farbe eine STL), hier zu einem Teil vereinen – die Lage aus den Dateien bleibt.';
  if (multi) {
    const dims = bodyDims(part);
    $('bodyList').innerHTML = part.bodies.map((b, j) => {
      const opts = '<option value="">wie Teil</option>' + slots.map(s => '<option value="' + s.idx + '"' + (b.slot === s.idx ? ' selected' : '') + '>Slot ' + (s.idx + 1) + (s.type ? ' · ' + esc(s.type) : '') + '</option>').join('');
      return '<li data-body="' + j + '"><span class="pslot" style="background:' + slotColour(bodySlot(part, b), slots) + '"></span>' +
        '<span class="bname" title="' + esc(b.name) + '">' + esc(b.name) + '<small>' + dims[j].map(v => de(v, v < 10 ? 1 : 0)).join('×') + ' mm</small></span>' +
        '<select data-body-slot="' + j + '" aria-label="Slot für ' + esc(b.name) + '">' + opts + '</select></li>';
    }).join('');
  } else $('bodyList').innerHTML = '';
  $('bodyJoin').classList.toggle('hidden', !joinable);
  if (joinable) $('bodyJoinSel').innerHTML = project.parts.map((p, i) => i === project.selected ? '' : '<option value="' + i + '">' + esc(p.name) + '</option>').join('');
  $('bodySplit').classList.toggle('hidden', !multi || !!project.threemf);
  paintBodies(part);
}

$('bodyList').addEventListener('change', e => {
  const sel = e.target.closest('[data-body-slot]'); if (!sel) return;
  const part = project.parts[project.selected], j = +sel.dataset.bodySlot, v = sel.value === '' ? null : +sel.value;
  samePlacements(part).forEach(p => { if (p.bodies && p.bodies[j]) p.bodies[j].slot = v; });
  update();
});
$('bodyList').addEventListener('mouseover', e => { const li = e.target.closest('[data-body]'); if (li) paintBodies(project.parts[project.selected], +li.dataset.body); });
$('bodyList').addEventListener('mouseleave', () => paintBodies(project.parts[project.selected]));
$('bodyShow').addEventListener('change', () => paintBodies(project && project.parts[project.selected]));

function replaceParts(parts, selected) {
  project.parts = parts;
  parts.forEach((p, i) => { p.id = i; });
  $('partList').classList.toggle('hidden', parts.length < 2);
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
  toast(b.name + ' mit ' + a.name + ' vereint (' + bodies.length + ' Körper)');
}
$('bodyJoinBtn').addEventListener('click', () => { const j = +$('bodyJoinSel').value; if (Number.isInteger(j)) joinParts(project.selected, j); });

// Jeder Körper wird ein eigenes Teil (Lage wie bisher, Slot vom Körper oder Teil)
$('bodySplit').addEventListener('click', () => {
  const part = project.parts[project.selected], i = project.selected;
  const pieces = part.bodies.map(b => {
    const name = b.fromPart ? b.name : part.name + ' · ' + b.name, origPos = part.origPos.slice(b.start * 9, (b.start + b.count) * 9);
    return { ...part, name, origPos, geom: makeGeom(name, rotatePositions(origPos, part.R)), slot: b.slot ?? part.slot ?? null, input: part.input && { ...part.input }, bodies: null, holes: [], holeGeom: null, holeCands: null };
  });
  replaceParts([...project.parts.slice(0, i), ...pieces, ...project.parts.slice(i + 1)], i);
  toast(part.name + ' in ' + pieces.length + ' Teile getrennt');
});
