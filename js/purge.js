'use strict';
/* Farbwechsel und Spülabfall schätzen (Mehrfarbdruck). Kein DOM – tests/purge.js prüft das in Node.
   Beim Kobra S1 spült die Anycubic-Firmware bei jedem Wechsel selbst in den Abfallschacht; die Menge
   stellt man am Drucker ein (ACE-Menü „Spülmenge“, 0,1–3,0, Werkseinstellung 1,5). Der Slicer kann sie
   nicht setzen – er schreibt nur „T<n>“. Recherche 2026-09-28: Rinkhals-Doku (filament_hub/flush_multiplier),
   Messung Hoffman Engineering (100 Wechsel PLA rot/weiß): 1,5 → 108 g / 126,4 s je Wechsel,
   1,0 → 77,5 g (Druck unverändert sauber), 0,5 → 45 g (Weiß rosa verfärbt, Kleckse aufs Bett). */

const ACE_FLUSH_DEFAULT = 1.5;
const ACE_FLUSH_RECOMMENDED = 1.0;
const ACE_FLUSH_CHOICES = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0];
// Gerade durch die drei Messpunkte (Abweichung < 0,02 g bzw. 0,5 s)
const acePurgeGrams = f => 0.13 + 0.635 * f;
const aceChangeSeconds = (f, base = 126.423) => base + 38.4 * (f - ACE_FLUSH_DEFAULT);

/* items: [{geom, slot, bodies?, plate}] – slot/Körper-Slots 0-basiert, null = defaultSlot.
   Zählt je Platte und Schicht die Slots, die dort gedruckt werden (Körper nach Höhenbereich), und daraus
   die wenigsten Wechsel, wie Orca sie plant: Innerhalb einer Schicht |S| − 1 Wechsel, dazu einer, wenn die
   Schicht nicht mit dem zuletzt genutzten Filament beginnen kann. Welches Filament eine Schicht beendet,
   wird über alle Schichten optimal gewählt (dp[x] = wenigste Wechsel, wenn die Schicht mit x endet). */
function estimateColourChanges(items, defaultSlot, layer, firstLayer = layer) {
  const plates = new Map();
  for (const it of items) {
    const g = it.geom, own = it.slot ?? defaultSlot;
    const ranges = it.bodies && it.bodies.length > 1
      ? it.bodies.map(b => { let lo = Infinity, hi = -Infinity;
          for (let i = b.start * 9 + 2; i < (b.start + b.count) * 9; i += 3) { const z = g.pos[i]; if (z < lo) lo = z; if (z > hi) hi = z; }
          return { lo: lo - g.mn[2], hi: hi - g.mn[2], slot: b.slot ?? own }; })
      : [{ lo: 0, hi: g.z, slot: own }];
    if (it.textRanges) ranges.push(...it.textRanges);   // erhabene Beschriftung (js/export-ui.js purgeItems)
    const p = it.plate || 1;
    (plates.get(p) || plates.set(p, []).get(p)).push(...ranges);
  }
  let total = 0;
  for (const ranges of plates.values()) {
    const top = Math.max(...ranges.map(r => r.hi));
    let dp = null; // Map: letztes Filament → Wechsel bisher
    for (let z0 = 0, h = firstLayer; z0 < top - 1e-6; z0 += h, h = layer) {
      const S = [...new Set(ranges.filter(r => r.lo < z0 + h - 1e-6 && r.hi > z0 + 1e-6).map(r => r.slot))];
      if (!S.length) continue;
      const next = new Map();
      for (const x of S) {
        let best = Infinity;
        if (!dp) best = S.length - 1;
        else for (const [p, c] of dp) {
          // beginnt die Schicht mit p (p kommt vor und ist nicht das letzte), spart sie einen Wechsel
          const free = S.length === 1 ? p === x : S.includes(p) && p !== x;
          best = Math.min(best, c + S.length - (free ? 1 : 0));
        }
        next.set(x, best);
      }
      dp = next;
    }
    if (dp) total += Math.min(...dp.values());
  }
  return total;
}

// Abfall und Zeit für n Wechsel bei Spülmenge f (Kobra S1 mit ACE); own = eigene Messung {grams, seconds} je Wechsel
function acePurgeEstimate(n, f, own) {
  const g = own && own.grams > 0 ? own.grams : acePurgeGrams(f), s = own && own.seconds > 0 ? own.seconds : aceChangeSeconds(f);
  return { changes: n, grams: n * g, seconds: n * s, own: !!(own && (own.grams > 0 || own.seconds > 0)) };
}
