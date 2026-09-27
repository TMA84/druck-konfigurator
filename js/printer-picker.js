'use strict';
/* Auswahl „Anderer Drucker“: alle Drucker aus den OrcaSlicer-Systemprofilen (ORCA_PRINTER_INDEX).
   Die Daten eines Herstellers werden erst bei Bedarf per <script> nachgeladen – das funktioniert auch
   per Doppelklick (file://), anders als fetch(). Kobra S1 und U1 behalten ihre eigenen Vorlagen. */

const loadedVendors = new Map();   // Hersteller → Promise
function loadOrcaVendor(vendor) {
  if (ORCA_PRINTER_DATA[vendor]) return Promise.resolve();
  if (!loadedVendors.has(vendor)) {
    const info = ORCA_PRINTER_INDEX.vendors[vendor];
    loadedVendors.set(vendor, new Promise((ok, fail) => {
      if (!info) { fail(Error('Hersteller unbekannt: ' + vendor)); return; }
      const s = document.createElement('script');
      s.src = 'js/orca-printers/' + info.file;
      s.onload = () => (ORCA_PRINTER_DATA[vendor] ? ok() : fail(Error('Profildaten fehlen')));
      s.onerror = () => { loadedVendors.delete(vendor); fail(Error('Profildatei nicht ladbar: ' + info.file)); };
      document.head.appendChild(s);
    }));
  }
  return loadedVendors.get(vendor);
}

// Nur Düsen, für die das Tool umrechnen kann (NOZ-Tabelle)
const pickerNozzleOk = n => !!NOZ[nkey(n)];
// In der Kopfzeile steht der Hersteller schon als Zeile darüber – im Modellnamen nicht wiederholen
const shortModelLabel = (label, vendor) => { const f = vendorLabel(vendor); return label.startsWith(f + ' ') ? label.slice(f.length + 1) : label; };

// Gewählten Orca-Drucker aktivieren (lädt die Herstellerdaten, stellt Düse passend ein)
async function activateOrcaPrinter(vendor, name) {
  await loadOrcaVendor(vendor);
  const entry = orcaPrinterEntry(vendor, name);
  if (!entry) throw Error('Drucker nicht gefunden: ' + name);
  PRINTERS.orca = entry;
  store.last.orcaPrinter = { vendor, name };
  $('printerOrcaLabel').textContent = shortModelLabel(entry.label, vendor);
  $('printerOrcaVendor').textContent = vendorLabel(vendor);
  $('printerOrcaBtn').title = entry.label + ' – zum Ändern anklicken';
  $('printer').value = 'orca';
  $('printer').dispatchEvent(new Event('change'));
  if (pickerNozzleOk(entry.orca.nozzle)) { $('nozD').value = nkey(entry.orca.nozzle); $('nozD').dispatchEvent(new Event('change')); }
  syncPrinterSwitch();
}

/* ---------- Auswahlfenster ---------- */
const vendorLabel = v => (v === 'BBL' ? 'Bambu Lab' : v);
function fillPickerVendors() {
  const sel = $('pickVendor');
  if (sel.options.length) return;
  const vendors = Object.keys(ORCA_PRINTER_INDEX.vendors).sort((a, b) => vendorLabel(a).localeCompare(vendorLabel(b), 'de'));
  sel.innerHTML = vendors.map(v => '<option value="' + esc(v) + '">' + esc(vendorLabel(v)) + ' (' + Object.keys(ORCA_PRINTER_INDEX.vendors[v].printers).length + ')</option>').join('');
}
function renderPickerList() {
  const v = $('pickVendor').value, q = $('pickSearch').value.trim().toLowerCase();
  const printers = Object.entries(ORCA_PRINTER_INDEX.vendors[v].printers)
    .filter(([n]) => !q || n.toLowerCase().includes(q))
    .sort((a, b) => a[1].model.localeCompare(b[1].model, 'de') || Number(a[1].nozzle) - Number(b[1].nozzle));
  const cur = store.last.orcaPrinter && store.last.orcaPrinter.name;
  $('pickList').innerHTML = printers.length ? printers.map(([n, p]) => {
    const ok = pickerNozzleOk(p.nozzle);
    return '<li><button type="button" data-pick="' + esc(n) + '"' + (n === cur ? ' aria-current="true"' : '') + (ok ? '' : ' disabled title="Diese Düsengröße kann das Tool nicht umrechnen"') + '>' +
      '<b>' + esc(p.model) + '</b><small>Düse ' + de(Number(p.nozzle), 2) + ' mm · Bett ' + de(p.bed[0], 0) + ' × ' + de(p.bed[1], 0) + ' mm</small></button></li>';
  }).join('') : '<li class="muted">Kein Drucker gefunden.</li>';
}
function openPrinterPicker() {
  fillPickerVendors();
  const last = store.last.orcaPrinter;
  if (last && ORCA_PRINTER_INDEX.vendors[last.vendor]) $('pickVendor').value = last.vendor;
  $('pickSearch').value = '';
  renderPickerList();
  $('pickerDlg').showModal();
  $('pickSearch').focus();
}
$('pickVendor').addEventListener('change', renderPickerList);
$('pickSearch').addEventListener('input', renderPickerList);
$('pickList').addEventListener('click', async e => {
  const b = e.target.closest('[data-pick]'); if (!b || b.disabled) return;
  b.textContent = 'Lade Profil …';
  try { await activateOrcaPrinter($('pickVendor').value, b.dataset.pick); $('pickerDlg').close(); toast('Drucker: ' + PRINTERS.orca.label); }
  catch (err) { toast('Drucker konnte nicht geladen werden: ' + err.message); renderPickerList(); }
});
$('pickerDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// Beim Start den zuletzt gewählten Orca-Drucker wiederherstellen
if (store.last.printer === 'orca' && store.last.orcaPrinter) {
  activateOrcaPrinter(store.last.orcaPrinter.vendor, store.last.orcaPrinter.name).catch(() => { /* bleibt beim S1 */ });
} else if (store.last.orcaPrinter && ORCA_PRINTER_INDEX.vendors[store.last.orcaPrinter.vendor]) {
  const fullName = store.last.orcaPrinter.name.replace(/ \d+(\.\d+)? nozzle$/, '');
  $('printerOrcaLabel').textContent = shortModelLabel(fullName, store.last.orcaPrinter.vendor);
  $('printerOrcaVendor').textContent = vendorLabel(store.last.orcaPrinter.vendor);
  $('printerOrcaBtn').title = fullName + ' – zum Auswählen anklicken';
}
