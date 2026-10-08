'use strict';
/* Anordnen nach Grundfläche im Hintergrund (js/nest.js nestStartWorker): bekommt die Netze der Teile, rechnet
   nestSolve und schickt die Platten zurück – das Fenster bleibt dabei bedienbar. */
importScripts('nest.js');
// wie js/export3mf.js
function lexLess(a, b) { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; }
onmessage = e => {
  const { id, geoms, of, idx, W, H, gap, pads } = e.data, G = [];
  for (const [i, k] of of) G[i] = geoms[k];
  let bins = null;
  try { bins = nestSolve((i, a) => footprintMask(G[i], a), i => 'g' + of.find(x => x[0] === i)[1], idx, W, H, gap, pads); } catch (err) { console.error(err); }
  postMessage({ id, bins });
};
