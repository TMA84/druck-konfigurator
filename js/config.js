'use strict';
/* Welche Hersteller das Tool anbietet. Entscheidung 2026-09-28: zunächst nur Anycubic. Die übrigen
   Drucker (Snapmaker U1, alle Orca-Hersteller) bleiben im Code und werden nur ausgeblendet –
   vendors: null schaltet alles frei, zum Testen auch per Adresse „index.html?alle-drucker“. */
const APP_CONFIG = { vendors: ['Anycubic'] };
if (typeof location !== 'undefined' && /[?&]alle-drucker\b/.test(location.search)) APP_CONFIG.vendors = null;

const vendorEnabled = v => !APP_CONFIG.vendors || APP_CONFIG.vendors.includes(v);
const BUILTIN_VENDOR = { kobra_s1: 'Anycubic', snapmaker_u1: 'Snapmaker' };

// Nach data.js: ausgeblendete eingebaute Drucker aus PRINTERS und der Oberfläche nehmen
function applyVendorConfig() {
  for (const [id, vendor] of Object.entries(BUILTIN_VENDOR)) {
    if (vendorEnabled(vendor)) continue;
    delete PRINTERS[id];
    if (typeof document !== 'undefined')
      document.querySelectorAll('[data-printer="' + id + '"], #printer option[value="' + id + '"], [data-link-printer="' + id + '"]').forEach(e => e.remove());
  }
  if (typeof document !== 'undefined' && APP_CONFIG.vendors && APP_CONFIG.vendors.length === 1) {
    const small = document.getElementById('printerOrcaVendor');
    if (small && small.textContent === 'Anderer') small.textContent = 'Anderer ' + APP_CONFIG.vendors[0];
  }
}
applyVendorConfig();
