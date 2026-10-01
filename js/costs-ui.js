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
function slotPrice(mat, liveType, slot) {
  // Preis der Spule im Slot (Filamentverwaltung, js/spools-ui.js) ist der genaueste
  const sp = slot != null && typeof spoolInSlot === 'function' ? spoolInSlot(slot) : null;
  if (sp && sp.price_per_kg > 0) return sp.price_per_kg;
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
    if (typeof extraSlots === 'function') for (const s of extraSlots(j.part)) if (!m[s]) m[s] = j.r.m;   // Beschriftung, eigene Bemalung
  }
  return m;
}

/* Alles, was die 3MF verändert – weicht es ab, muss neu geslict werden. Aufgeteilt in den globalen Stand
   (Drucker, Slots, Filamente, Werte der 3MF) und je Platte die Teile darauf: ändert sich nur eine Platte,
   slict der Server nur diese neu (js/plates.js changedPlates, tools/slicer.py). */
function sliceSigs() {
  if (!project || !lastResult) return null;
  const tpl = exportTemplate(lastResult.printer.id, lastResult.dSel);
  if (!tpl) return null;
  const plan = exportPlan(costDefaultSlot()), lay = projectLayout(tpl), src = plan.jobs.find(j => j.r === plan.r) || plan.jobs[0];
  const global = JSON.stringify([project.printSeq || 'layer', typeof packGapMm !== 'undefined' ? packGapMm : 8, lastResult.printer.id, lastResult.dSel, $('nozM').value, aceFlush(), acePurgeOwn(), exportSlots(tpl), plan.slot,
    src.part.input, src.part.overrides || null, project.threemf ? project.threemf.designMap || null : null,
    // welche Filamente in welchen Slots landen – als Menge, damit eine weitere Kopie nicht alle Platten ändert
    [...new Set(plan.jobs.map(j => JSON.stringify([j.part.input && j.part.input.material, j.slot, (j.bodies || []).map(b => b.slot), typeof extraSlots === 'function' ? extraSlots(j.part) : []])))].sort()]);
  const plates = Array.from({ length: lay.count }, (_, k) => JSON.stringify(plan.jobs.filter((j, i) => lay.plateOf[i] === k + 1)
    .map(j => [j.part.name, j.part.input, j.part.overrides || null, j.slot, (j.bodies || []).map(b => b.slot), j.part.R, (j.holes || []).length, j.geom.x, j.geom.y, j.geom.z, j.part.texts || null,
      // eigene Bemalung (Farbe, Stützen, Naht – js/paint-ui.js): jeder Strich ändert rev
      ['paintUser', 'paintSup', 'paintSeam'].map(k => j.part[k] ? j.part[k].rev : 0)])));
  return { global, plates };
}
function costSignature() { const s = sliceSigs(); return s && JSON.stringify(s); }

function costPurge() {
  if (!lastResult || lastResult.printer.id !== 'kobra_s1') return null; // Spülabfall im Schacht nur mit ACE
  const own = acePurgeOwn();
  return { gramsPerChange: own && own.grams > 0 ? own.grams : acePurgeGrams(aceFlush()) };
}

// Automatisch: nach einer Änderung kurz warten (mehrere Klicks = ein Slicen), nie zwei Aufträge gleichzeitig,
// und einen Stand, der schon fehlschlug, nicht endlos wiederholen
function scheduleAutoCost() {
  clearTimeout(costTimer);
  { const sig = costSignature();   // Ladebalken: Änderung erkannt, gleich wird neu geslict
    if (costAuto() && sig && !costState.busy && sig !== costState.sig && sig !== costState.failedSig && typeof sliceBar === 'function') sliceBar('wait'); }
  costTimer = setTimeout(() => {
    const sig = costSignature();
    if (costAuto() && sig && !costState.busy && sig !== costState.sig && sig !== costState.failedSig) runCosts();
  }, COST_AUTO_DELAY_MS);
}

// Neues Modell geladen: altes Slice-Ergebnis und Vorschau verwerfen (sonst zeigt ③ noch das vorige Modell)
let costProject = null;
function renderCostPanel() {
  if (project !== costProject) {
    costProject = project;
    if (!costState.busy) costState = { sig: null, sigs: null, slice: null, materials: null, busy: false, error: '', failedSig: null };
    else costState.stale = true;   // läuft noch für das alte Modell – Ergebnis gleich verwerfen
    if (typeof clearSlicePreview === 'function') clearSlicePreview();
  }
  if (typeof refreshSlicePreview === 'function' && costState.slice) pvStale(costState.sig !== costSignature());
  const info = $('costPanelInfo'), table = $('costTable'), btn = $('costRun');
  const tpl = lastResult && exportTemplate(lastResult.printer.id, lastResult.dSel);
  $('costAuto').checked = costAuto();
  if (costAuto() && project && tpl && !costState.busy) { const sig = costSignature(); if (sig !== costState.sig && sig !== costState.failedSig) scheduleAutoCost(); }
  btn.disabled = costState.busy || !project || !tpl;
  btn.textContent = costState.busy ? t('Slicen …') : t('Kosten berechnen');
  const fresh = costState.slice && costState.sig === costSignature();
  // Slice-Vorschau (js/preview-ui.js) zum letzten Slicen – auch wenn das Ergebnis veraltet ist
  $('previewOpen').classList.add('hidden');   // die Vorschau steht eingebettet daneben (js/preview-ui.js)
  const badge = $('sliceBadge');
  // Drucken nur mit aktuellem Slice-Stand und eingerichtetem Kobra S1 (js/send-ui.js)
  const canPrint = !!(fresh && costState.slice && costState.slice.job && lastResult && lastResult.printer.id === 'kobra_s1' && printerHost('kobra_s1'));
  $('sendOpen').classList.toggle('hidden', !canPrint);
  $('queueStart').classList.toggle('hidden', !(canPrint && costState.slice.plates.length > 1));
  $('plateCosts').classList.toggle('hidden', !(costState.slice && costState.slice.plates.length > 1));
  if (!costState.slice) {
    table.classList.add('hidden');
    badge.classList.add('hidden');
    info.textContent = costState.busy ? t('Slicen mit OrcaSlicer …') : costState.error || (!project ? t('Zuerst ein Modell laden.') : !tpl ? t('Für diese Düse gibt es keine 3MF-Vorlage.')
      : t('Slict das Projekt exakt mit OrcaSlicer (auf dem Server) und rechnet Filament, Spülabfall, Strom und Verschleiß.'));
    return;
  }
  const slots = [], live = typeof slotChoices === 'function' ? slotChoices() : [];
  (costState.slice.total.grams || []).forEach((g, i) => {
    const m = costState.materials[i], lt = live[i] && live[i].present ? live[i].type : '';
    slots[i] = { name: m ? m.name : lt ? t('{type} (laut ACE)', { type: lt }) : '', pricePerKg: slotPrice(m, lt, i) };
  });
  const r = computeCosts(costState.slice, slots, costPurge(), costCfg()), tot = costState.slice.total;
  renderPlateCosts(slots, live);
  const detail = l => l.key === 'filament' || l.key === 'purge' ? de(l.grams, 1) + ' g × ' + de(l.pricePerKg, 2) + ' €/kg'
    : l.key === 'power' ? de(l.kwh, 2) + ' kWh × ' + de(r.cfg.kwhPrice, 2) + ' €' : de(l.hours, 2) + ' h × ' + de(r.cfg.wearPerHour, 2) + ' €';
  const row = (label, small, v, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + (small ? '<small>' + small + '</small>' : '') + '</td><td>' + eur(v) + '</td></tr>';
  let html = r.lines.map(l => row(esc(l.label), detail(l), l.eur)).join('');
  if (r.markup || r.vat) {
    html += row(t('Summe'), '', r.subtotal, 'sum');
    if (r.markup) html += row(t('Aufschlag {pct} %', { pct: de(r.cfg.markupPct, 0) }), '', r.markup);
    if (r.vat) html += row(t('MwSt. {pct} %', { pct: de(r.cfg.vatPct, 0) }), '', r.vat);
  }
  html += row(t('Gesamt'), '', r.total, 'total');
  badge.textContent = eur(r.total); badge.classList.toggle('hidden', !fresh);
  table.querySelector('tbody').innerHTML = html;
  table.classList.remove('hidden');
  info.innerHTML = (fresh ? '' : costState.busy || (costAuto() && costSignature() !== costState.failedSig) ? t('<b>Wird neu berechnet …</b>') + ' ' : t('<b>Veraltet</b> – das Projekt hat sich geändert, bitte neu berechnen.') + ' ') +
    t('Druckzeit {time} · {g} g laut Orca', { time: duration(tot.time_s), g: de(tot.total_g, 1) }) + (costState.slice.plates.length > 1 ? ' · ' + t('{n} Platten', { n: costState.slice.plates.length }) : '') +
    (costState.slice.sliced != null && costState.slice.sliced < costState.slice.plates.length ? ' · ' + t('neu geslict: {n} von {total}', { n: costState.slice.sliced, total: costState.slice.plates.length }) : '') +
    (costState.slice.orca ? ' <span class="muted">(OrcaSlicer ' + esc(costState.slice.orca) + ')</span>' : '') +
    ((costState.notes || []).length ? '<br>' + costState.notes.map(esc).join('<br>') : '');
  // Reicht das Filament auf den Spulen (Filamentverwaltung)?
  const short = typeof spoolShortage === 'function' ? spoolShortage(tot.grams) : [];
  if (short.length) info.innerHTML += '<span class="note bad small spool-short">' + esc(spoolShortagePrefix(short) + ' ' + spoolShortageText(short)) + '</span>';
}

/* Kosten auch im Slicer: filament_cost (€/kg je Slot) und time_cost (€/h = Strom + Verschleiß) in die 3MF –
   OrcaSlicer und AnycubicSlicerNext zeigen damit nach dem Slicen fast dieselben Kosten (ohne Spülabfall,
   Aufschlag und MwSt., die kennen sie nicht). */
function costMachine(tpl) {
  const c = costCfg(), n = tpl.settings.filament_settings_id.length, round = v => String(Math.round(v * 100) / 100);
  const out = [{ label: t('Maschinenkosten je Stunde (Strom + Verschleiß)'), key: 'time_cost', value: round((c.powerW > 0 && c.kwhPrice > 0 ? c.powerW / 1000 * c.kwhPrice : 0) + (c.wearPerHour || 0)) }];
  const mats = project && lastResult ? slotMaterials(exportPlan(costDefaultSlot())) : {}, live = typeof slotChoices === 'function' ? slotChoices() : [];
  for (let i = 0; i < n; i++) {
    const lt = live[i] && live[i].present ? live[i].type : '';
    out.push({ label: t('Slot {n}: Filamentpreis (€/kg)', { n: i + 1 }), key: 'filament_cost', index: i, value: round(slotPrice(mats[i], lt, i) || c.pricePerKg) });
  }
  return out;
}

// Tabelle je Platte (Zeit, Filament, Wechsel, Kosten) und die empfohlene Druckreihenfolge nach Filament
function renderPlateCosts(slots, live) {
  const s = costState.slice;
  if (!s || s.plates.length < 2) return;
  const purge = costPurge(), cfg = costCfg();
  $('plateCosts').querySelector('tbody').innerHTML = s.plates.map(p => {
    const c = computeCosts({ total: p }, slots, purge, cfg);
    return '<tr data-pv-plate="' + p.plate + '" title="' + t('In der Vorschau zeigen') + '"><td>' + p.plate + (p.reused ? '<small>' + t('unverändert') + '</small>' : '') + '</td><td>' + duration(p.time_s) + (p.changes ? '<small>' + t('{n} Wechsel', { n: p.changes }) + '</small>' : '') + '</td><td>' + de(p.total_g, 1) + ' g</td><td>' + eur(c.total) + '</td></tr>';
  }).join('');
  const o = orderPlates(s.plates, costState.materials, live.length ? live : null, slotMatchesKind);
  const miss = o.list.filter(n => n.missing.length);
  const need = n => n.missing.map(m => m.have ? t('Slot {n} braucht {want} statt {have}', { n: m.slot + 1, want: esc(m.want), have: esc(m.have) })
    : t('Slot {n} braucht {want}', { n: m.slot + 1, want: esc(m.want) })).join(', ');
  $('plateOrder').innerHTML = !miss.length ? t('Alle Platten drucken mit dem eingelegten Filament.')
    : o.swaps === 1 && miss.length === o.list.length ? t('Vor dem Druck Filament tauschen: {need}.', { need: need(miss[0]) })
    : (miss.length < o.list.length ? t('Empfohlene Reihenfolge: <b>{order}</b> (erst alles mit dem eingelegten Filament, dann {n}× Spulen tauschen).', { order: o.list.map(n => n.plate).join(' → '), n: o.swaps })
      : t('Empfohlene Reihenfolge: <b>{order}</b> ({n}× Spulen tauschen).', { order: o.list.map(n => n.plate).join(' → '), n: o.swaps })) + ' ' +
      miss.map(n => t('Platte {n}: {need}', { n: n.plate, need: need(n) })).join(' · ');
}
$('plateCosts').addEventListener('click', e => {
  const tr = e.target.closest('[data-pv-plate]'); if (!tr) return;
  const sel = $('pvPlate'); sel.value = tr.dataset.pvPlate; sel.dispatchEvent(new Event('change'));
});

async function runCosts() {
  if (!project || costState.busy) return;
  const health = await serverHealth();
  if (!health.slicer) { costState = { ...costState, error: t('Der Server hat keinen OrcaSlicer – die Kostenkalkulation braucht den Container (oder lokal ORCA_PATH).'), failedSig: costSignature() }; renderCostPanel(); return; }
  // PLA und ASA/ABS auf einer Platte slict Orca nicht – gleich verständlich melden statt nach dem Slicen
  const clash = typeof plateConflicts === 'function' ? plateConflicts() : [];
  if (clash.length) {
    costState = { ...costState, slice: null, error: t(project.threemf ? 'Nicht berechnet: {list} Lösung: in ① Modell unter „Farben des Designers“ Slots mit derselben Filamentart wählen oder passendes Filament einlegen.'
      : 'Nicht berechnet: {list} Lösung: in ① Modell bei den Teilen Slots mit derselben Filamentart wählen oder passendes Filament einlegen.',
      { list: clash.map(c => (clash.length > 1 || projectLayout(plTpl()).count > 1 ? t('Platte {n}: {text}', { n: c.plate, text: c.text }) : c.text)).join(' ') }), failedSig: costSignature() };
    if (typeof clearSlicePreview === 'function') clearSlicePreview(t('Keine Vorschau – so lässt sich nicht slicen (siehe Kosten links).'));
    if (typeof sliceBar === 'function') sliceBar('error');
    renderCostPanel(); return;
  }
  costState = { ...costState, busy: true, error: '' };
  renderCostPanel();
  try {
    const sigs = sliceSigs(), sig = JSON.stringify(sigs), { bytes, plan, notes } = exportBytes(costDefaultSlot());
    // Nur geänderte Platten neu slicen, wenn der letzte Stand noch auf dem Server liegt
    const prev = costState.slice && costState.slice.job ? costState.sigs : null, changed = changedPlates(prev, sigs);
    const partial = changed && changed.length < sigs.plates.length;
    $('costPanelInfo').textContent = partial ? (changed.length ? t('Slicen: nur Platte {list} …', { list: changed.join(', ') }) : t('Übernehme den letzten Stand …')) : t('Slicen mit OrcaSlicer …');
    const nSlice = partial ? changed.length : sigs.plates.length, t0 = performance.now();
    if (typeof sliceBar === 'function') sliceBar('slice', { plates: nSlice, note: $('costPanelInfo').textContent.replace(/ …$/, '') });
    const q = partial ? '?plates=' + changed.join(',') + '&count=' + sigs.plates.length + '&reuse=' + costState.slice.job : '';
    const res = await fetch('api/slice' + q, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(data.error || t('Server antwortet mit HTTP {status}', { status: res.status }));
    if (costState.stale || project !== costProject) { costState = { sig: null, sigs: null, slice: null, materials: null, busy: false, error: '', failedSig: null }; renderCostPanel(); return; }
    costState = { sig, sigs, slice: data, materials: slotMaterials(plan), notes, busy: false, error: '', failedSig: null };
    if (typeof sbLearn === 'function' && nSlice) sbLearn(performance.now() - t0, nSlice);
    // Vorschau nur im Tab ③ laden – sonst ist der Lauf hier fertig
    if (typeof sliceBar === 'function') sliceBar(document.body.dataset.tab === 'slice' ? 'preview' : 'done');
    if (typeof refreshSlicePreview === 'function') setTimeout(() => refreshSlicePreview(true));
  } catch (e) {
    const stale = costState.stale;
    costState = { ...costState, busy: false, slice: null, stale: false, error: stale ? '' : t('Nicht berechnet: {msg}', { msg: t(e.message) }), failedSig: stale ? null : costSignature() };
    if (typeof sliceBar === 'function') sliceBar('error');
    if (typeof clearSlicePreview === 'function') clearSlicePreview(stale ? '' : t('Keine Vorschau – das Slicen ist fehlgeschlagen.'));
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
  if (bad.length) { alert(t('Bitte prüfen: {list}', { list: bad.join(', ') })); return; }
  // Preise von Filamenten, die gerade nicht aufgeführt sind, bleiben erhalten
  const shown = new Set([...document.querySelectorAll('[data-price]')].map(i => i.dataset.price));
  const kept = Object.fromEntries(Object.entries(store.settings.filamentPrices || {}).filter(([id]) => !shown.has(id)));
  store.settings.costs = costs;
  store.settings.filamentPrices = { ...kept, ...prices };
  store.settings.typePrices = types;
  persist();
  $('costDlg').close();
  renderCostPanel();
  toast(t('Kosten-Einstellungen gespeichert'));
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
