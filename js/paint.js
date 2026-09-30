'use strict';
/* Farbbemalung je Dreieck (Bambu Studio / OrcaSlicer: paint_color, PrusaSlicer: slic3rpe:mmu_segmentation). Aufbau wie
   TriangleSelector::serialize: Hex-Ziffern, von hinten gelesen. Je Knoten eine Ziffer: untere 2 Bit = Zahl der geteilten
   Seiten (0 = Blatt), obere 2 Bit = Filament (1–2; 3 = „erweitert“, dann folgt eine Ziffer + 3) bzw. bei geteilten
   Dreiecken die besondere Seite; danach die Kinder (geteilte Seiten + 1) in derselben Reihenfolge.
   Filament 0 = keins (Slot des Teils), sonst Filamentnummer des Designers (1-basiert).
   Nur Lesen der Farben und Umschreiben der Filamentnummern – die Unterteilung bleibt unverändert. */

// Baum als flache Liste lesen: [{split, side, state}] in Lesereihenfolge (Tiefe zuerst)
function paintNodes(str) {
  const out = [];
  let pos = str.length;
  const next = () => { if (pos <= 0) throw Error('paint_color zu kurz'); return parseInt(str[--pos], 16); };
  const node = () => {
    const code = next(), split = code & 3;
    if (!split) { let st = code >> 2; if (st === 3) st = next() + 3; out.push({ split: 0, state: st }); return; }
    out.push({ split, side: code >> 2 });
    for (let k = 0; k <= split; k++) node();
  };
  while (pos > 0) node();      // üblich: genau ein Baum je Dreieck
  return out;
}
// Überwiegendes Filament eines Dreiecks (Flächenanteil: jedes Kind ≈ gleicher Teil seines Elternteils)
function paintMain(str) {
  if (!str) return 0;
  if (str.length === 1) { const c = parseInt(str, 16); return (c & 3) ? paintMainTree(str) : c >> 2; }
  if (str.length === 2 && (parseInt(str[1], 16) & 3) === 0 && parseInt(str[1], 16) >> 2 === 3) return parseInt(str[0], 16) + 3;
  return paintMainTree(str);
}
function paintMainTree(str) {
  let nodes;
  try { nodes = paintNodes(str); } catch (e) { return 0; }
  const w = new Map();
  let i = 0;
  const walk = share => {
    const n = nodes[i++];
    if (!n) return;
    if (!n.split) { w.set(n.state, (w.get(n.state) || 0) + share); return; }
    for (let k = 0; k <= n.split; k++) walk(share / (n.split + 1));
  };
  while (i < nodes.length) walk(1);
  let best = 0, bw = -1;
  for (const [s, v] of w) if (v > bw) { best = s; bw = v; }
  return best;
}
// Alle vorkommenden Filamente eines Codes
function paintStates(str) {
  try { return [...new Set(paintNodes(str).filter(n => !n.split).map(n => n.state))]; } catch (e) { return []; }
}
// Filamentnummern umschreiben (map: alte Nummer → neue, 1-basiert; 0 bleibt 0); Ergebnis wieder als Hex-Code
function paintRemap(str, map) {
  const nodes = paintNodes(str), nib = [];
  for (const n of nodes) {
    if (n.split) { nib.push((n.side << 2) | n.split); continue; }
    const st = n.state ? (map(n.state) ?? n.state) : 0;
    if (st < 3) nib.push(st << 2); else { nib.push(3 << 2); nib.push(st - 3); }
  }
  // von hinten gelesen → in umgekehrter Reihenfolge schreiben
  let s = '';
  for (let k = nib.length - 1; k >= 0; k--) s += nib[k].toString(16).toUpperCase();
  return s;
}
