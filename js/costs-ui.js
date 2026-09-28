'use strict';
/* Kostenkalkulation im Schritt „③ Slicen & Kosten“: „Kosten berechnen“ baut die 3MF wie beim Speichern, lässt sie auf
   dem Server exakt slicen (/api/slice, OrcaSlicer) und rechnet mit js/costs.js. Preise und Sätze ändern das
   Ergebnis sofort (ohne neues Slicen); ändert sich das Projekt, ist das Ergebnis „veraltet“.
   store.settings.costs = {pricePerKg, powerW, kwhPrice, wearPerHour, markupPct, vatPct}
   store.settings.filamentPrices = {filament-id: €/kg} */

const costCfg = () => ({ ...COST_DEFAULTS, ...(store.settings.costs || {}) });
const filamentPrice = id => (store.settings.filamentPrices || {})[id];
const typePrice = kind => (store.settings.typePrices || {})[kind];
const COST_KINDS = Object.keys(KIND_LABEL);                       // pla, petg, abs, asa, tpu
const kindOfType = t => COST_KINDS.find(k => slotMatchesKind(t, k)) || null;   // „PLA-CF“ → pla
/* Preis eines Slots: eigener Preis des Filaments → Preis seines Typs → (sonst) Standard in computeCosts.
   Slots ohne Filamentprofil (z. B. Farben des Designers) nach dem Typ, den die ACE meldet. */
function slotPrice(mat, liveType) {
  if (mat && filamentPrice(mat.id) > 0) return filamentPrice(mat.id);
  const kind = mat ? mat.kind : kindOfType(liveType);
  return kind && typePrice(kind) > 0 ? typePrice(kind) : undefined;
}
const costAuto = () => store.settings.costAuto !== false;
const COST_AUTO_DELAY_MS = 1500;
let costTimer = 0;
const eur = v => de(v, 2) + ' €';
const costDefaultSlot = () => lastResult ? +(store.last[slotKey(lastResult.printer.id)] || 0) : 0;
let costState = { sig: null, slice: null, materials: null, busy: false, error: '' };

// Welches Filament in welchem Slot: Standard-Slot = globale Werte, sonst das erste Teil bzw. der erste Körper darin
function slotMaterials(plan) {
  const m = {};
  m[plan.slot] = plan.r.m;
  for (const j of plan.jobs) {
    const s = j.slot ?? plan.slot;
    if (!m[s]) m[s] = j.r.m;
    for (const b of j.bodies || []) if (b.slot != null && !m[b.slot]) m[b.slot] = j.r.m;
  }
  return m;
}

// Alles, was die 3MF verändert – weicht es ab, muss neu geslict werden
function costSignature() {
  if (!project || !lastResult) return null;
  const tpl = exportTemplate(lastResult.printer.id, lastResult.dSel);
  if (!tpl) return null;
  const plan = exportPlan(costDefaultSlot());
  return JSON.stringify([lastResult.printer.id, lastResult.dSel, $('nozM').value, project.name, aceFlush(), acePurgeOwn(), exportSlots(tpl),
    plan.jobs.map(j => [j.part.name, j.part.input, j.slot, (j.bodies || []).map(b => b.slot), j.part.R, (j.holes || []).length])]);
}

function costPurge() {
  if (!lastResult || lastResult.printer.id !== 'kobra_s1') return null; // Spülabfall im Schacht nur mit ACE
  const own = acePurgeOwn();
  return { gramsPerChange: own && own.grams > 0 ? own.grams : acePurgeGrams(aceFlush()) };
}

// Automatisch: nach einer Änderung kurz warten (mehrere Klicks = ein Slicen), nie zwei Aufträge gleichzeitig,
// und einen Stand, der schon fehlschlug, nicht endlos wiederholen
function scheduleAutoCost() {
  clearTimeout(costTimer);
  costTimer = setTimeout(() => {
    const sig = costSignature();
    if (costAuto() && sig && !costState.busy && sig !== costState.sig && sig !== costState.failedSig) runCosts();
  }, COST_AUTO_DELAY_MS);
}

function renderCostPanel() {
  const info = $('costPanelInfo'), table = $('costTable'), btn = $('costRun');
  const tpl = lastResult && exportTemplate(lastResult.printer.id, lastResult.dSel);
  $('costAuto').checked = costAuto();
  if (costAuto() && project && tpl && !costState.busy) { const sig = costSignature(); if (sig !== costState.sig && sig !== costState.failedSig) scheduleAutoCost(); }
  btn.disabled = costState.busy || !project || !tpl;
  btn.textContent = costState.busy ? 'Slicen …' : 'Kosten berechnen';
  const fresh = costState.slice && costState.sig === costSignature();
  // Slice-Vorschau (js/preview-ui.js) zum letzten Slicen – auch wenn das Ergebnis veraltet ist
  $('previewOpen').classList.add('hidden');   // die Vorschau steht eingebettet daneben (js/preview-ui.js)
  const badge = $('sliceBadge');
  // Drucken nur mit aktuellem Slice-Stand und eingerichtetem Kobra S1 (js/send-ui.js)
  $('sendOpen').classList.toggle('hidden', !(fresh && costState.slice && costState.slice.job && lastResult && lastResult.printer.id === 'kobra_s1' && printerHost('kobra_s1')));
  if (!costState.slice) {
    table.classList.add('hidden');
    badge.classList.add('hidden');
    info.textContent = costState.busy ? 'Slicen mit OrcaSlicer …' : costState.error || (!project ? 'Zuerst ein Modell laden.' : !tpl ? 'Für diese Düse gibt es keine 3MF-Vorlage.'
      : 'Slict das Projekt exakt mit OrcaSlicer (auf dem Server) und rechnet Filament, Spülabfall, Strom und Verschleiß.');
    return;
  }
  const slots = [], live = typeof slotChoices === 'function' ? slotChoices() : [];
  (costState.slice.total.grams || []).forEach((g, i) => {
    const m = costState.materials[i], lt = live[i] && live[i].present ? live[i].type : '';
    slots[i] = { name: m ? m.name : lt ? lt + ' (laut ACE)' : '', pricePerKg: slotPrice(m, lt) };
  });
  const r = computeCosts(costState.slice, slots, costPurge(), costCfg()), t = costState.slice.total;
  const detail = l => l.key === 'filament' || l.key === 'purge' ? de(l.grams, 1) + ' g × ' + de(l.pricePerKg, 2) + ' €/kg'
    : l.key === 'power' ? de(l.kwh, 2) + ' kWh × ' + de(r.cfg.kwhPrice, 2) + ' €' : de(l.hours, 2) + ' h × ' + de(r.cfg.wearPerHour, 2) + ' €';
  const row = (label, small, v, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + (small ? '<small>' + small + '</small>' : '') + '</td><td>' + eur(v) + '</td></tr>';
  let html = r.lines.map(l => row(esc(l.label), detail(l), l.eur)).join('');
  if (r.markup || r.vat) {
    html += row('Summe', '', r.subtotal, 'sum');
    if (r.markup) html += row('Aufschlag ' + de(r.cfg.markupPct, 0) + ' %', '', r.markup);
    if (r.vat) html += row('MwSt. ' + de(r.cfg.vatPct, 0) + ' %', '', r.vat);
  }
  html += row('Gesamt', '', r.total, 'total');
  badge.textContent = eur(r.total); badge.classList.toggle('hidden', !fresh);
  table.querySelector('tbody').innerHTML = html;
  table.classList.remove('hidden');
  info.innerHTML = (fresh ? '' : costState.busy || (costAuto() && costSignature() !== costState.failedSig) ? '<b>Wird neu berechnet …</b> ' : '<b>Veraltet</b> – das Projekt hat sich geändert, bitte neu berechnen. ') +
    'Druckzeit ' + duration(t.time_s) + ' · ' + de(t.total_g, 1) + ' g laut Orca' + (costState.slice.plates.length > 1 ? ' · ' + costState.slice.plates.length + ' Platten' : '') +
    (costState.slice.orca ? ' <span class="muted">(OrcaSlicer ' + esc(costState.slice.orca) + ')</span>' : '') +
    ((costState.notes || []).length ? '<br>' + costState.notes.map(esc).join('<br>') : '');
}

async function runCosts() {
  if (!project || costState.busy) return;
  const health = await serverHealth();
  if (!health.slicer) { costState = { ...costState, error: 'Der Server hat keinen OrcaSlicer – die Kostenkalkulation braucht den Container (oder lokal ORCA_PATH).', failedSig: costSignature() }; renderCostPanel(); return; }
  costState = { ...costState, busy: true, error: '' };
  renderCostPanel();
  try {
    const sig = costSignature(), { bytes, plan, notes } = exportBytes(costDefaultSlot());
    $('costPanelInfo').textContent = 'Slicen mit OrcaSlicer …';
    const res = await fetch('/api/slice', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(data.error || 'Server antwortet mit HTTP ' + res.status);
    costState = { sig, slice: data, materials: slotMaterials(plan), notes, busy: false, error: '', failedSig: null };
    if (typeof refreshSlicePreview === 'function') setTimeout(() => refreshSlicePreview(true));
  } catch (e) {
    costState = { ...costState, busy: false, slice: null, error: 'Nicht berechnet: ' + e.message, failedSig: costSignature() };
  }
  renderCostPanel();   // hat sich während des Slicens etwas geändert, plant das gleich den nächsten Lauf
}
$('costRun').addEventListener('click', () => { costState.failedSig = null; runCosts(); });
$('costAuto').addEventListener('change', () => { store.settings.costAuto = $('costAuto').checked; persist(); renderCostPanel(); });

/* ---------- Dialog „Kosten: Preise & Sätze“ ---------- */
const COST_FIELDS = [['cdDefault', 'pricePerKg'], ['cdPower', 'powerW'], ['cdKwh', 'kwhPrice'], ['cdWear', 'wearPerHour'], ['cdMarkup', 'markupPct'], ['cdVat', 'vatPct']];
const deNum = v => String(v).replace('.', ',');
function openCostSettings() {
  const c = costCfg();
  COST_FIELDS.forEach(([id, k]) => { $(id).value = deNum(c[k]); });
  $('cdTypes').innerHTML = COST_KINDS.map(k => '<div class="ed-row"><label for="cdt_' + k + '">' + esc(KIND_LABEL[k]) + '</label><div class="ed-in"><input id="cdt_' + k + '" data-type-price="' + k + '" inputmode="decimal" placeholder="' + deNum(c.pricePerKg) + '" value="' + (typePrice(k) > 0 ? deNum(typePrice(k)) : '') + '"><span class="u">€/kg</span></div></div>').join('');
  // Filamente des Projekts (bzw. des Formulars) und alle mit eigenem Preis
  const ids = new Set(Object.keys(store.settings.filamentPrices || {}));
  if (project) project.parts.forEach(p => p.input && ids.add(p.input.material));
  ids.add($('material').value);
  const mats = [...ids].map(id => allMats().find(m => m.id === id)).filter(Boolean);
  $('cdMaterials').innerHTML = mats.map(m => '<div class="ed-row"><label for="cdp_' + esc(m.id) + '">' + esc(m.name) + '</label><div class="ed-in"><input id="cdp_' + esc(m.id) + '" data-price="' + esc(m.id) + '" inputmode="decimal" placeholder="' + deNum(c.pricePerKg) + '" value="' + (filamentPrice(m.id) > 0 ? deNum(filamentPrice(m.id)) : '') + '"><span class="u">€/kg</span></div></div>').join('');
  $('costDlg').showModal();
}
$('cdSave').addEventListener('click', () => {
  const costs = {}, prices = {}, bad = [];
  for (const [id, k] of COST_FIELDS) { const v = num($(id).value); if (isNaN(v) || v < 0 || (k === 'pricePerKg' && !(v > 0))) bad.push($(id).closest('.ed-row').querySelector('label').textContent); else costs[k] = v; }
  document.querySelectorAll('[data-price]').forEach(inp => { const s = inp.value.trim(); if (!s) return; const v = num(s); if (isNaN(v) || v <= 0) bad.push(inp.closest('.ed-row').querySelector('label').textContent); else prices[inp.dataset.price] = v; });
  const types = {};
  document.querySelectorAll('[data-type-price]').forEach(inp => { const s = inp.value.trim(); if (!s) return; const v = num(s); if (isNaN(v) || v <= 0) bad.push(inp.closest('.ed-row').querySelector('label').textContent); else types[inp.dataset.typePrice] = v; });
  if (bad.length) { alert('Bitte prüfen: ' + bad.join(', ')); return; }
  // Preise von Filamenten, die gerade nicht aufgeführt sind, bleiben erhalten
  const shown = new Set([...document.querySelectorAll('[data-price]')].map(i => i.dataset.price));
  const kept = Object.fromEntries(Object.entries(store.settings.filamentPrices || {}).filter(([id]) => !shown.has(id)));
  store.settings.costs = costs;
  store.settings.filamentPrices = { ...kept, ...prices };
  store.settings.typePrices = types;
  persist();
  $('costDlg').close();
  renderCostPanel();
  toast('Kosten-Einstellungen gespeichert');
});
$('cdReset').addEventListener('click', () => { COST_FIELDS.forEach(([id, k]) => { $(id).value = deNum(COST_DEFAULTS[k]); }); document.querySelectorAll('[data-type-price]').forEach(i => { i.value = ''; }); });
$('costDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
ACTIONS.costs = openCostSettings;
// Einmalig (2026-09-28): Preise der Standardfilamente aus der Zeit vor den Typpreisen werden Typpreise;
// Preise eigener Filamente bleiben als Einzelpreis
if (!store.settings.typePrices && store.settings.filamentPrices && Object.keys(store.settings.filamentPrices).length) {
  const types = {}, keep = {};
  for (const [id, v] of Object.entries(store.settings.filamentPrices)) {
    const m = allMats().find(x => x.id === id);
    if (m && m.builtin && !(m.kind in types)) types[m.kind] = v; else keep[id] = v;
  }
  store.settings.typePrices = types; store.settings.filamentPrices = keep; persist();
}
if (lastResult) renderCostPanel();
