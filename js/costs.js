'use strict';
/* Kostenkalkulation aus dem exakten Slice-Ergebnis (Server /api/slice, OrcaSlicer). Kein DOM – tests/costs.js.
   Posten: Filament je Slot (Gramm × €/kg des Filaments in diesem Slot), Spülabfall der ACE (nur Kobra S1:
   Wechsel laut Orca × Gramm je Wechsel, zum mittleren Preis der genutzten Filamente), Strom (Leistung ×
   Druckzeit × €/kWh), Verschleiß (€/h), dann Aufschlag und MwSt. Orcas Druckzeit enthält die Wechselzeit
   (machine_load_filament_time), die Filamentmenge den Prime-Turm – den Spülabfall der Firmware nicht. */

const COST_DEFAULTS = {
  pricePerKg: 25,    // €/kg, wenn für ein Filament kein eigener Preis hinterlegt ist
  powerW: 150,       // mittlere Leistungsaufnahme beim Drucken (Kobra S1: Bett + Hotend, grob)
  kwhPrice: 0.35,    // €/kWh
  wearPerHour: 0.30, // Verschleiß/Abschreibung (Düse, Bett, Riemen, Gerät) je Druckstunde
  markupPct: 0,      // Aufschlag auf die Summe
  vatPct: 0          // MwSt. (z. B. 19), auf Summe + Aufschlag
};

// Sprache: t() aus js/util.js, in tests/costs.js (ohne util.js) nur die Platzhalter ersetzen
const costT = (s, p) => typeof t === 'function' ? t(s, p) : s.replace(/\{(\w+)\}/g, (m, k) => p && k in p ? p[k] : m);

/* slice: {total:{grams:[je Slot], time_s, changes}}
   slots: [{name, pricePerKg}] je Slot-Index (Filament in diesem Slot)
   purge: {gramsPerChange} oder null (kein Spülabfall, z. B. Werkzeugwechsler)
   cfg: wie COST_DEFAULTS */
function computeCosts(slice, slots, purge, cfg) {
  const c = { ...COST_DEFAULTS, ...(cfg || {}) }, t = slice.total, hours = (t.time_s || 0) / 3600;
  const lines = [];
  let usedG = 0, usedEur = 0;
  (t.grams || []).forEach((g, i) => {
    if (!(g > 0)) return;
    const s = slots[i] || {}, price = s.pricePerKg > 0 ? s.pricePerKg : c.pricePerKg, eur = g / 1000 * price;
    usedG += g; usedEur += eur;
    lines.push({ key: 'filament', label: 'Slot ' + (i + 1) + (s.name ? ' · ' + s.name : ''), grams: g, pricePerKg: price, eur });
  });
  if (purge && purge.gramsPerChange > 0 && t.changes > 0) {
    const g = t.changes * purge.gramsPerChange, price = usedG > 0 ? usedEur / usedG * 1000 : c.pricePerKg;
    lines.push({ key: 'purge', label: costT('Spülabfall ({n} Wechsel)', { n: t.changes }), grams: g, pricePerKg: price, eur: g / 1000 * price });
  }
  if (c.powerW > 0 && c.kwhPrice > 0) lines.push({ key: 'power', label: costT('Strom'), kwh: c.powerW / 1000 * hours, eur: c.powerW / 1000 * hours * c.kwhPrice });
  if (c.wearPerHour > 0) lines.push({ key: 'wear', label: costT('Verschleiß'), hours, eur: hours * c.wearPerHour });
  const subtotal = lines.reduce((s, l) => s + l.eur, 0);
  const markup = subtotal * (c.markupPct || 0) / 100, vat = (subtotal + markup) * (c.vatPct || 0) / 100;
  const grams = lines.filter(l => l.grams).reduce((s, l) => s + l.grams, 0);
  return { lines, subtotal, markup, vat, total: subtotal + markup + vat, hours, grams, cfg: c };
}
