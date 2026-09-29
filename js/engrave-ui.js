'use strict';
/* Beschriftung (① Modell, Abschnitt „Beschriftung“): Text erhaben (eigener Slot, andere Farbe) oder vertieft auf eine
   Fläche des gewählten Teils. Standard-Fläche = Oberseite (js/engrave.js topFace); „Fläche wählen …“ wie „Fläche aufs
   Bett“ (Viewer.setPick). Das Formular ist ein Entwurf mit Vorschau; „Text hinzufügen“ legt ihn in part.texts ab
   (für alle Platzierungen/Kopien des Teils), Export in js/export3mf.js (textVolumes).
   Nur für STL-Teile und in eine 3MF hinzugefügte Teile (part.extra) – Objekte des Designers noch nicht. */

const TEXT_FIELDS = ['txText', 'txHeight', 'txDepth', 'txStroke', 'txRot', 'txMode', 'txSlot'];
const TEXT_ENGRAVED_COLOUR = 0xe5514f;
const txState = { part: null, geom: null, anchor: null, picked: false, editing: null };
const topFaceCache = new WeakMap();   // geom → Oberseite (Anker mit Fläche)

const txPart = () => project && project.parts[project.selected];
const txUsable = p => !!p && (!project.threemf || !!p.extra);
function txTop(geom) {
  if (!topFaceCache.has(geom)) topFaceCache.set(geom, topFace(geom));
  return topFaceCache.get(geom);
}
const txPartSlot = p => p.slot ?? (typeof defaultSlot === 'function' ? defaultSlot() : 0);
const txHex = h => parseInt(String(h).slice(1), 16);
const txNum = (id, lo, hi, def) => { const v = num($(id).value); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };

// Slot-Auswahl: Slots des Druckers (alle ACE-Einheiten, sonst 1–4); Vorschlag = ein anderer Slot als der des Teils
function txSlotOptions(part, chosen) {
  const slots = slotChoices(), list = slots.length ? slots : [0, 1, 2, 3].map(idx => ({ idx }));
  const own = txPartSlot(part), def = chosen ?? (list.find(s => s.idx !== own) || list[0]).idx;
  $('txSlot').innerHTML = list.map(s => '<option value="' + s.idx + '"' + (s.idx === def ? ' selected' : '') + '>Slot ' + (s.idx + 1) + (s.type ? ' · ' + esc(s.type) : '') + (s.idx === own ? ' ' + t('(wie Teil)') : '') + '</option>').join('');
}

// Formular → Entwurf (Anker in origPos-Koordinaten des Teils)
function txDraft(part) {
  if (!txState.anchor) return null;
  const mode = $('txMode').value === 'engraved' ? 'engraved' : 'raised';
  return { id: txState.editing || Date.now(), text: $('txText').value.slice(0, 60), height: txNum('txHeight', 1, 200, TEXT_DEFAULTS.height), depth: txNum('txDepth', 0.2, 20, TEXT_DEFAULTS.depth),
    stroke: txNum('txStroke', 5, 40, TEXT_DEFAULTS.stroke * 100) / 100, rot: +$('txRot').value || 0, mode, slot: mode === 'raised' ? +$('txSlot').value : null,
    anchor: anchorToOrig(txState.anchor, part.R) };
}

function txResetAnchor(part) {
  txState.part = part; txState.geom = part.geom; txState.picked = false; txState.editing = null;
  txState.anchor = txTop(part.geom);
}

// Vorschau: gespeicherte Texte in Slotfarbe (vertieft rot, halb durchsichtig), dazu der Entwurf
function txPreview() {
  const part = txPart();
  if (!Viewer.setExtras) return;
  if (!txUsable(part)) { Viewer.setExtras([]); return; }
  const slots = slotChoices(), list = [];
  const add = (x, draft) => {
    if (!String(x.text || '').trim()) return;
    const col = x.mode === 'engraved' ? TEXT_ENGRAVED_COLOUR : txHex(slotColour(x.slot ?? txPartSlot(part), slots));
    list.push({ pos: textMesh(x, part.R), color: col, opacity: x.mode === 'engraved' ? 0.55 : draft ? 0.85 : 1 });
  };
  (part.texts || []).forEach(x => { if (x.id !== txState.editing) add(x, false); });
  const d = txDraft(part);
  if (d) add(d, true);
  Viewer.setExtras(list);
  // Hinweise zum Entwurf
  const warn = d && d.text.trim() ? textWarnings(part.geom, d, part.R, txState.anchor.region) : [];
  $('txWarn').innerHTML = warn.map(esc).join('<br>');
  $('txWarn').classList.toggle('hidden', !warn.length);
  const dims = d && d.text.trim() ? textStrokes(d.text, d.height, d.stroke) : null;
  $('txSize').textContent = dims ? de(dims.w, 1) + ' × ' + de(dims.h, 1) + ' mm' : '';
  $('txAdd').disabled = !(d && d.text.trim());
}

function renderEngrave() {
  const box = $('textBox'), part = txPart();
  if (!box) return;
  const usable = txUsable(part);
  box.classList.toggle('hidden', !usable);
  if (!usable) { txState.part = null; if (Viewer.setExtras) Viewer.setExtras([]); return; }
  const changed = txState.part !== part;
  if (changed || (txState.geom !== part.geom && !txState.editing)) txResetAnchor(part);
  if (txState.geom !== part.geom) txState.geom = part.geom;   // beim Bearbeiten nach einer Drehung: Anker aus dem Text
  $('txFace').textContent = !txState.anchor ? t('keine ebene Fläche gefunden – bitte wählen') : txState.picked ? t('gewählte Fläche') : t('Oberseite');
  const slotSel = $('txSlot').value;
  txSlotOptions(part, changed || slotSel === '' ? null : +slotSel);
  $('txSlotWrap').classList.toggle('hidden', $('txMode').value === 'engraved');
  $('txAdd').textContent = txState.editing ? t('Änderung übernehmen') : t('Text hinzufügen');
  $('txNew').classList.toggle('hidden', !txState.editing);
  const slots = slotChoices(), texts = part.texts || [];
  $('textInfo').textContent = texts.length ? '' : t('Erhaben wird der Text ein eigenes Bauteil mit eigenem Slot (andere Farbe), vertieft schneidet OrcaSlicer ihn aus dem Teil.');
  $('textList').innerHTML = texts.map(x => {
    const warn = textWarnings(part.geom, x, part.R, null);
    const col = x.mode === 'engraved' ? '#e5514f' : slotColour(x.slot ?? txPartSlot(part), slots);
    const what = x.mode === 'engraved' ? t('vertieft {d} mm', { d: de(x.depth, 1) }) : t('erhaben {d} mm · Slot {n}', { d: de(x.depth, 1), n: (x.slot ?? txPartSlot(part)) + 1 });
    return '<li data-text="' + x.id + '"' + (x.id === txState.editing ? ' class="editing"' : '') + '><span class="pslot" style="background:' + col + '"></span>' +
      '<button type="button" class="tname" data-text-edit="' + x.id + '" title="' + esc(t('Bearbeiten')) + '">' + esc(x.text) + '<small>' + t('{h} mm hoch', { h: de(x.height, 1) }) + ' · ' + what + (x.rot ? ' · ' + x.rot + '°' : '') + '</small>' +
      (warn.length ? '<small class="bad">' + warn.map(esc).join(' ') + '</small>' : '') + '</button>' +
      '<button type="button" class="tdel" data-text-del="' + x.id + '" aria-label="' + esc(t('Text „{text}“ entfernen', { text: x.text })) + '" title="' + esc(t('Entfernen')) + '">✕</button></li>';
  }).join('');
  txPreview();
}

// Text in alle Platzierungen/Kopien des Teils schreiben
function txSetTexts(part, texts) { samePlacements(part).forEach(p => { p.texts = texts; }); }

function txCommit() {
  const part = txPart(), d = part && txDraft(part);
  if (!d || !d.text.trim()) return;
  const texts = (part.texts || []).slice(), i = texts.findIndex(x => x.id === d.id);
  if (i >= 0) texts[i] = d; else texts.push(d);
  txSetTexts(part, texts);
  toast(i >= 0 ? t('Text geändert') : t('Text „{text}“ hinzugefügt', { text: d.text }));
  txState.editing = null;
  $('txText').value = '';
  update();
}

function txEdit(id) {
  const part = txPart(), x = (part.texts || []).find(y => y.id === id);
  if (!x) return;
  txState.editing = id; txState.picked = true;
  // Anker zurück in geom-Koordinaten; Fläche für die Hinweise neu suchen (Dreieck unter dem Mittelpunkt)
  const f = textFrame({ ...x, rot: 0 }, part.R), tri = txTriangleAt(part.geom, f.o, f.n);
  txState.anchor = tri >= 0 ? { ...faceAnchor(part.geom, tri, f.o), u: f.u, n: f.n, p: f.o } : { p: f.o, n: f.n, u: f.u, region: { tris: [] } };
  $('txText').value = x.text; $('txHeight').value = x.height; $('txDepth').value = x.depth; $('txStroke').value = Math.round(x.stroke * 100);
  $('txRot').value = String(x.rot || 0); $('txMode').value = x.mode;
  txSlotOptions(part, x.slot);
  renderEngrave();
  $('txText').focus();
}
// Dreieck, auf dem der Punkt p liegt (Normale ≈ n)
function txTriangleAt(geom, p, n) {
  const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = v3.norm(v3.cross(n, ax)), frame = [u, v3.cross(n, u)];
  let best = -1, bd = 0.05;
  for (let i = 0; i < geom.n; i++) {
    const tn = triNormal(geom.pos, i);
    if (v3.dot(tn.n, n) < 0.99) continue;
    const d = Math.abs(v3.dot(v3.sub(p, triCentroid(geom.pos, i)), tn.n));
    if (d < bd && regionContains(geom, { tris: [i] }, p, frame)) { best = i; bd = d; }
  }
  return best;
}

function txPickFace() {
  const part = txPart();
  if (!part) return;
  setTab('3d');
  $('txPick').classList.add('active');
  toast(t('Fläche für den Text anklicken (Esc bricht ab)'));
  Viewer.setPick(true, (fi, pt) => {
    $('txPick').classList.remove('active');
    if (part !== txPart()) return;
    txState.anchor = faceAnchor(part.geom, fi, pt || null);
    txState.picked = true;
    renderEngrave();
  });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('txPick') && $('txPick').classList.contains('active')) { Viewer.setPick(false); $('txPick').classList.remove('active'); } });

TEXT_FIELDS.forEach(id => { const el = $(id); if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { if (id === 'txMode') renderEngrave(); else txPreview(); }); });
$('txText').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); txCommit(); } });
$('txAdd').addEventListener('click', txCommit);
$('txPick').addEventListener('click', txPickFace);
$('txTop').addEventListener('click', () => { const p = txPart(); if (p) { const ed = txState.editing; txResetAnchor(p); txState.editing = ed; renderEngrave(); } });
$('txNew').addEventListener('click', () => { const p = txPart(); if (p) { txResetAnchor(p); $('txText').value = ''; renderEngrave(); } });
$('textList').addEventListener('click', e => {
  const del = e.target.closest('[data-text-del]'), ed = e.target.closest('[data-text-edit]'), part = txPart();
  if (!part) return;
  if (del) {
    const id = +del.dataset.textDel;
    txSetTexts(part, (part.texts || []).filter(x => x.id !== id));
    if (txState.editing === id) txState.editing = null;
    update();
  } else if (ed) txEdit(+ed.dataset.textEdit);
});

/* update() (js/panel.js) ruft renderEngrave auf. */
