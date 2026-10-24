'use strict';
/* 3MF-Export, Teil Anordnen (aus js/export3mf.js): Teile auf Platten packen (MaxRects, Sätze, kompakter Block),
   Grundfläche und Transformation platzierter Teile, Reinigungsturm je Platte. */

/* Teile platzsparend aufs Bett legen (Grundfläche = Hüllrechteck, Abstand packGap – einstellbar, Standard PART_GAP_MM). Verfahren „freie Rechtecke“
   (MaxRects, beste kurze Seite): jedes Teil kommt in die freie Lücke, in die es am knappsten passt, auf die erste
   Platte mit Platz; wenn es hilft, um 90° um die Hochachse gedreht. Mehrere Sortierungen werden durchprobiert, die
   mit den wenigsten Platten gewinnt (bei Gleichstand die dichteste erste Platte). Je Platte wird die belegte Fläche
   auf die Bettmitte gerückt. (2026-09-29, ersetzt das Zeilenverfahren: Mischungen mit 78–84 % Fläche brauchten 2 Platten.)
   groups: Listen von Teil-Indizes, jede Gruppe beginnt auf einer eigenen Platte (Plattenzuordnung je Teil);
   läuft eine Gruppe über, geht es auf einer zusätzlichen Platte weiter.
   Ergebnis je Teil: {plate (0-basiert), x, y, lx, ly, rot} – Mitte in Orca-Weltkoordinaten bzw. auf der Platte,
   rot = um 90° gedreht (Grundfläche dann y × x). */
const PACK_ORDERS = [
  (a, b) => b.x * b.y - a.x * a.y,
  (a, b) => Math.max(b.x, b.y) - Math.max(a.x, a.y),
  (a, b) => b.y - a.y || b.x - a.x,
  (a, b) => b.x - a.x || b.y - a.y,
  (a, b) => (b.x + b.y) - (a.x + a.y)
];
// a < b lexikografisch (erste abweichende Stelle entscheidet)
function lexLess(a, b) { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; }
function maxRectsBin(W, H) {
  let free = [{ x: 0, y: 0, w: W, h: H }];
  const fits = (f, w, h) => w <= f.w + 1e-6 && h <= f.h + 1e-6;
  const bin = {
    used: [],
    // Kopie zum Ausprobieren (ganzer Satz passt oder keiner – packSets)
    clone() { const c = maxRectsBin(W, H); c.setFree(free.map(f => ({ ...f }))); c.used = this.used.slice(); return c; },
    setFree(f) { free = f; },
    // beste Lücke für w × h (optional gedreht) → {x, y, w, h, rot, score} oder null
    find(w, h, allowRot) {
      let best = null;
      for (const f of free) for (const [ww, hh, rot] of allowRot && Math.abs(w - h) > 1e-6 ? [[w, h, false], [h, w, true]] : [[w, h, false]]) {
        if (!fits(f, ww, hh)) continue;
        const score = [Math.min(f.w - ww, f.h - hh), Math.max(f.w - ww, f.h - hh), f.y, f.x];
        if (!best || lexLess(score, best.score)) best = { x: f.x, y: f.y, w: ww, h: hh, rot, score };
      }
      return best;
    },
    place(r) {
      const next = [];
      for (const f of free) {
        if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) { next.push(f); continue; }
        if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
        if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
        if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
        if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
      }
      // in anderen enthaltene Lücken streichen
      free = next.filter((a, k) => !next.some((b, m) => m !== k && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (m < k || a.w !== b.w || a.h !== b.h || a.x !== b.x || a.y !== b.y)));
      this.used.push(r);
    }
  };
  return bin;
}
// Beste Lösung: wenigste Platten, dann möglichst wenige gedrehte Teile (Drehen nur, wenn es Platten spart), dann dichteste erste Platte
function packGroup(geoms, idx, W, H, gap) {
  let best = null;
  for (const allowRot of [false, true]) for (const order of PACK_ORDERS) {
    const seq = idx.slice().sort((a, b) => order(geoms[a], geoms[b]) || a - b), bins = [];
    for (const i of seq) {
      const w = geoms[i].x + gap, h = geoms[i].y + gap;
      let spot = null, bin = null;
      for (const b of bins) { const f = b.find(w, h, allowRot); if (f) { spot = f; bin = b; break; } }
      if (!spot) {
        bin = maxRectsBin(W + gap, H + gap); bins.push(bin);
        spot = bin.find(w, h, allowRot) || bin.find(w, h, true) || { x: 0, y: 0, w, h, rot: false };   // größer als das Bett: allein auf eine Platte
      }
      bin.place({ ...spot, i });
    }
    const fill = bins.length ? bins[0].used.reduce((s, r) => s + r.w * r.h, 0) : 0, rots = bins.reduce((s, b) => s + b.used.filter(r => r.rot).length, 0);
    if (!best || lexLess([bins.length, rots, -fill], [best.bins.length, best.rots, -best.fill])) best = { bins, fill, rots };
  }
  return best ? best.bins.map(b => compactBin(geoms, b, W, H, gap)) : [];
}
/* Teile einer Platte als möglichst kompakten Block legen: Auf dem leeren Bett landen wenige Teile sonst an Kante und
   Ecke (z. B. 12 gleiche als „L“). Probiert schmalere Bettbreiten durch und nimmt die Anordnung mit der kürzesten
   längeren Seite (dann kleinsten Fläche), in der noch alle Teile passen. */
function compactBin(geoms, bin, W, H, gap) {
  const rects = bin.used, ext = rs => [Math.max(...rs.map(r => r.x + r.w)) - Math.min(...rs.map(r => r.x)), Math.max(...rs.map(r => r.y + r.h)) - Math.min(...rs.map(r => r.y))];
  if (rects.length < 2) return bin;
  const allowRot = rects.some(r => r.rot), idx = rects.map(r => r.i), score = rs => { const [a, b] = ext(rs); return [Math.round(Math.max(a, b)), Math.round(a * b)]; };
  let best = rects, bestScore = score(rects);
  const minW = Math.max(...rects.map(r => r.w)), STEPS = 40;
  for (let k = 0; k <= STEPS; k++) {
    const w = minW + (W + gap - minW) * k / STEPS;
    for (const order of PACK_ORDERS) {
      const b = maxRectsBin(w, H + gap);
      let ok = true;
      for (const i of idx.slice().sort((a, c) => order(geoms[a], geoms[c]) || a - c)) {
        const f = b.find(geoms[i].x + gap, geoms[i].y + gap, allowRot);
        if (!f) { ok = false; break; }
        b.place({ ...f, i });
      }
      if (ok && lexLess(score(b.used), bestScore)) { best = b.used; bestScore = score(b.used); }
    }
  }
  return best === rects ? bin : { used: best };
}
/* Sätze zusammenhalten (Modell aus mehreren Teilen, z. B. RFID-Halter = Halter + Deckel, 20 Sätze): jeder Satz kommt
   ganz auf eine Platte – sonst lagen auf der letzten Platte nur Deckel und nach Platte 1 war kein Satz fertig.
   sets: Listen von Teil-Indizes (je Satz). Je Satz die erste Platte, auf der alle seine Teile Platz haben, sonst eine
   neue. Teile, die zu keinem Satz gehören, werden danach wie gewohnt verteilt. Ergebnis: Platten (bins) wie packGroup. */
function packSets(geoms, idx, sets, W, H, gap) {
  const inSet = new Set(sets.flat()), rest = idx.filter(i => !inSet.has(i));
  const area = i => geoms[i].x * geoms[i].y;
  let best = null;
  for (const allowRot of [false, true]) {
    const bins = [];
    for (const set of sets) {
      const items = set.slice().sort((a, b) => area(b) - area(a) || a - b);
      const tryBin = b => { const c = b.clone(); for (const i of items) { const f = c.find(geoms[i].x + gap, geoms[i].y + gap, allowRot); if (!f) return null; c.place({ ...f, i }); } return c; };
      let done = false;
      for (let k = 0; k < bins.length && !done; k++) { const c = tryBin(bins[k]); if (c) { bins[k] = c; done = true; } }
      if (!done) { const c = tryBin(maxRectsBin(W + gap, H + gap)); if (!c) return null; bins.push(c); }   // Satz größer als das Bett
    }
    for (const i of rest.sort((a, b) => area(b) - area(a) || a - b)) {
      const w = geoms[i].x + gap, h = geoms[i].y + gap;
      let spot = null, bin = null;
      for (const b of bins) { const f = b.find(w, h, allowRot); if (f) { spot = f; bin = b; break; } }
      if (!spot) { bin = maxRectsBin(W + gap, H + gap); bins.push(bin); spot = bin.find(w, h, true) || { x: 0, y: 0, w, h, rot: false }; }
      bin.place({ ...spot, i });
    }
    const rots = bins.reduce((s, b) => s + b.used.filter(r => r.rot).length, 0);
    if (!best || lexLess([bins.length, rots], [best.bins.length, best.rots])) best = { bins, rots };
  }
  return best.bins.map(b => compactBin(geoms, b, W, H, gap));
}
function packPlates(geoms, groups, tpl, sets, pads) {
  const [bw, bd] = bedSize(tpl), [bx, by] = tpl.bedCenter, gap = packGap(tpl);
  // Rechteck-Verfahren mit Brim: Hüllrechteck um 2 × Brim größer (Mitte bleibt die Mitte des Teils)
  const real = geoms;
  if (pads && pads.some(p => p > 0)) geoms = geoms.map((g, i) => pads[i] > 0 ? { x: g.x + 2 * pads[i], y: g.y + 2 * pads[i], z: g.z } : g);
  const plates = [];   // je Platte die belegten Rechtecke {i, x, y, w, h, rot} (inkl. Abstand)
  const sources = [];  // je Platte: aus welcher Gruppe (Plattennummer) sie stammt
  let setsKept = null;  // null = keine Sätze; true = zusammengehalten; false = hätte mehr als eine Platte zusätzlich gekostet
  for (const [gi, idx] of groups.entries()) {
    let bins = packGroup(geoms, idx, bw, bd, gap);
    // Grundfläche statt Hüllrechteck (js/nest.js), wenn das Platten spart – nicht bei „Objekt für Objekt“ (Kopf-Freiraum rechteckig)
    if (!printSeq.byObject && typeof nestGroup === 'function') {
      // auch, wenn ein Teil nur schräg aufs Bett passt (Rechteck-Verfahren: „zu groß“)
      const tooBig = idx.some(i => volumeExcess(real[i], [bw, bd, Infinity]).length && volumeExcess({ x: real[i].y, y: real[i].x, z: 0 }, [bw, bd, Infinity]).length);
      if (bins.length > 1 || tooBig) { const nb = nestGroup(real, idx, bw, bd, gap, pads); if (nb && (nb.length < bins.length || (tooBig && nb.length <= bins.length))) bins = nb; }
    }
    const mine = sets && sets.map(s => s.filter(i => idx.includes(i))).filter(s => s.length > 1);
    if (mine && mine.length) {
      const kept = packSets(geoms, idx, mine, bw, bd, gap);
      // höchstens eine Platte mehr als ohne Sätze – sonst wie bisher (und sagen)
      if (kept && kept.length <= bins.length + 1) { bins = kept; if (setsKept !== false) setsKept = true; } else setsKept = false;
    }
    if (!bins.length) { plates.push([]); sources.push(gi); }
    bins.forEach(b => { plates.push(b.used); sources.push(gi); });
  }
  // leere Gruppen (Platte ohne Teile) weglassen
  const used = plates.map((p, k) => [p, sources[k]]).filter(([p]) => p.length);
  const cols = Math.ceil(Math.sqrt(used.length || 1)), places = [];
  used.forEach(([rects, src], pi) => {
    const minX = Math.min(...rects.map(r => r.x)), minY = Math.min(...rects.map(r => r.y));
    const usedW = Math.max(...rects.map(r => r.x + r.w)) - gap - minX, usedD = Math.max(...rects.map(r => r.y + r.h)) - gap - minY;
    const lx0 = bx - usedW / 2 - minX, ly0 = by - usedD / 2 - minY;
    const ox = (pi % cols) * bw * PLATE_STRIDE, oy = -Math.floor(pi / cols) * bd * PLATE_STRIDE;
    for (const r of rects) {
      const lx = lx0 + r.x + (r.w - gap) / 2, ly = ly0 + r.y + (r.h - gap) / 2;
      places[r.i] = { plate: pi, x: ox + lx, y: oy + ly, lx, ly, group: src, rot: !!r.rot, ang: r.ang ?? (r.rot ? 90 : 0) };
    }
  });
  // Teile, die größer als das Bett sind, lassen sich nicht sinnvoll platzieren → Hinweis im Dialog
  // zu groß – außer schräg gelegt (Anordnen nach Grundfläche hat dann geprüft, dass es aufs Bett passt; Höhe zählt weiter)
  const vol = buildVolume(tpl), oversize = real.map((g, i) => i).filter(i => places[i] && placeAng(places[i]) % 90 ? real[i].z > vol[2] + 0.01
    : volumeExcess(real[i], vol).length && volumeExcess({ x: real[i].y, y: real[i].x, z: real[i].z }, vol).length);
  const overflow = used.length > new Set(used.map(([, s]) => s)).size;
  return { places, plateCount: used.length, oversize, overflow, setsKept };
}
// Grundfläche eines platzierten Teils (gedreht: Breite und Tiefe getauscht; schräg: Rechteck um den Drehpunkt, js/nest.js)
const footprint = (g, pl) => {
  const k = placeAng(pl);
  if (k % 90 && typeof footprintMask === 'function') { const m = footprintMask(g, k); if (m) return [m.fw, m.fd]; }
  return k === 90 || k === 270 ? [g.y, g.x] : [g.x, g.y];
};
// 3MF-Transformation (Zeilenvektor · Matrix): gedreht = +90° um Z, sonst nur verschoben
// Drehung um Z in 90°-Schritten (pl.ang; ältere Lagen nur pl.rot = 90°) – Zeilenvektor: 90° → (−y, x), 180° → (−x, −y), 270° → (y, −x)
// beliebige Winkel (Anordnen nach Grundfläche auch in 45°-Schritten): Zeilen (cos, sin) und (−sin, cos)
const placeAng = pl => pl ? (pl.ang != null ? ((pl.ang % 360) + 360) % 360 : pl.rot ? 90 : 0) : 0;
const ROT_Z = { 0: [1, 0, 0, 0, 1, 0, 0, 0, 1], 90: [0, 1, 0, -1, 0, 0, 0, 0, 1], 180: [-1, 0, 0, 0, -1, 0, 0, 0, 1], 270: [0, -1, 0, 1, 0, 0, 0, 0, 1] };
const rotZ = k => ROT_Z[k] || (() => { const c = Math.cos(k * Math.PI / 180), s = Math.sin(k * Math.PI / 180); return [c, s, 0, -s, c, 0, 0, 0, 1]; })();
const placeXY = (pl, a, b) => { const k = placeAng(pl); if (k === 90) return [-b, a]; if (k === 180) return [-a, -b]; if (k === 270) return [b, -a]; if (!k) return [a, b];
  const c = Math.cos(k * Math.PI / 180), s = Math.sin(k * Math.PI / 180); return [a * c - b * s, a * s + b * c]; };
const placeTransform = (pl, hz) => rotZ(placeAng(pl)).map(v => String(Math.abs(v) < 1e-12 ? 0 : +v.toFixed(9))).join(' ') + ' ' + coord(pl.x) + ' ' + coord(pl.y) + ' ' + hz;
// Alle Teile automatisch auf möglichst wenige Platten (ohne feste Zuordnung)
// pads[i] = Brim-Breite außen (mm): der Abstand zählt ab dem Brim, sonst wachsen die Brims zusammen
function arrangeParts(geoms, tpl, sets, pads) { return packPlates(geoms, [geoms.map((g, i) => i)], tpl, sets, pads); }
// Nach Plattenzuordnung je Teil (1-basiert); Platten in aufsteigender Reihenfolge, Lücken fallen weg
function arrangeByPlate(items, tpl) {
  const nums = [...new Set(items.map(p => p.plate || 1))].sort((a, b) => a - b);
  return packPlates(items.map(p => p.geom), nums.map(n => items.map((p, i) => i).filter(i => (items[i].plate || 1) === n)), tpl, null, items.map(p => p.pad || 0));
}

/* ---------- Reinigungsturm (Prime-Turm) je Platte platzieren ----------
   Die Vorlage kennt nur eine feste Turmposition. Steht dort ein Teil, bricht die Orca-Kommandozeile ab
   („gcode path conflicts found between WipeTower and …“, beobachtet 2026-09-28 mit einem 200 × 200-mm-Teil).
   Je Platte mit mehr als einem Slot: freie Stelle nahe der Vorlagenposition; sonst die Teile nach vorne links
   rücken; geht auch das nicht, ohne Turm (beim Kobra S1 spült die Firmware ohnehin in den Schacht).
   Größe vorsichtig geschätzt: Breite laut Profil, Tiefe 25 mm, dazu Brim und Rippen. wipe_tower_x/y = Ecke vorne links. */
const TOWER_DEPTH_MM = 25, TOWER_CLEAR_MM = 5, TOWER_EDGE_MM = 3, TOWER_STEP_MM = 5;
const firstNum = v => Number(Array.isArray(v) ? v[0] : v);
function bedMin(tpl) {
  const pts = (tpl.settings.printable_area || []).map(p => p.split('x').map(Number));
  return pts.length ? [0, 1].map(k => Math.min(...pts.map(p => p[k]))) : [0, 0];
}
function towerFootprint(settings) {
  const w = firstNum(settings.prime_tower_width) || 35, brim = firstNum(settings.prime_tower_brim_width) || 0;
  const rib = settings.wipe_tower_wall_type === 'rib' ? (firstNum(settings.wipe_tower_extra_rib_length) || 0) : 0;
  return { w, d: TOWER_DEPTH_MM, pad: brim + rib / 2 + 2 };
}
function findTowerSpot(rects, [x0, y0, x1, y1], fp, prefer) {
  let best = null;
  for (let x = x0 + TOWER_EDGE_MM + fp.pad; x + fp.w + fp.pad <= x1 - TOWER_EDGE_MM; x += TOWER_STEP_MM)
    for (let y = y0 + TOWER_EDGE_MM + fp.pad; y + fp.d + fp.pad <= y1 - TOWER_EDGE_MM; y += TOWER_STEP_MM) {
      const t = [x - fp.pad, y - fp.pad, x + fp.w + fp.pad, y + fp.d + fp.pad];
      if (rects.some(o => o[0] - TOWER_CLEAR_MM < t[2] && t[0] < o[2] + TOWER_CLEAR_MM && o[1] - TOWER_CLEAR_MM < t[3] && t[1] < o[3] + TOWER_CLEAR_MM)) continue;
      const dist = Math.hypot(x - prefer[0], y - prefer[1]);
      if (!best || dist < best.dist) best = { x, y, dist };
    }
  return best && [best.x, best.y];
}
/* plates: [{rects:[[x0,y0,x1,y1]] in Bettkoordinaten, slots:Set}] – Index = Platte − 1.
   Ergebnis: {xs, ys, shifts:[[dx,dy]], notes, disable} – shifts rücken die Teile einer Platte. */
function planTowers(settings, tpl, plates) {
  const fp = towerFootprint(settings), [mx, my] = bedMin(tpl), [bw, bd] = bedSize(tpl), bed = [mx, my, mx + bw, my + bd];
  const prefer = [firstNum(settings.wipe_tower_x) || mx + bw / 2, firstNum(settings.wipe_tower_y) || my + bd / 2];
  const res = { xs: [], ys: [], shifts: [], notes: [], disable: false };
  const off = String(settings.enable_prime_tower) === '0';
  plates.forEach((p, i) => {
    let pos = null, shift = [0, 0];
    if (!off && p.slots.size > 1 && p.rects.length) {
      pos = findTowerSpot(p.rects, bed, fp, prefer);
      if (!pos) {
        shift = [mx + TOWER_EDGE_MM + 2 - Math.min(...p.rects.map(r => r[0])), my + TOWER_EDGE_MM + 2 - Math.min(...p.rects.map(r => r[1]))];
        pos = findTowerSpot(p.rects.map(r => [r[0] + shift[0], r[1] + shift[1], r[2] + shift[0], r[3] + shift[1]]), bed, fp, prefer);
        if (pos) res.notes.push(t('Platte {n}: Teile nach vorne links gerückt, damit der Reinigungsturm Platz hat.', { n: i + 1 }));
        else { shift = [0, 0]; res.disable = true; res.notes.push(t('Platte {n}: kein Platz für den Reinigungsturm – die 3MF ist ohne Turm (beim Kobra S1 spült die Firmware in den Schacht).', { n: i + 1 })); }
      }
    }
    res.xs.push(String(pos ? pos[0] : prefer[0])); res.ys.push(String(pos ? pos[1] : prefer[1])); res.shifts.push(shift);
  });
  return res;
}
// Turmposition (und ggf. „ohne Turm“) in die Einstellungen; Orca übernimmt nur gelistete Prozessschlüssel
function applyTowers(settings, changes, plan) {
  const mark = key => { const g = settings.different_settings_to_system; if (Array.isArray(g) && !String(g[0] || '').split(';').includes(key)) g[0] = g[0] ? g[0] + ';' + key : key; };
  const set = (label, key, value) => { const before = settings[key]; settings[key] = value; mark(key); if (JSON.stringify(before) !== JSON.stringify(value)) changes.push({ label, key, before: Array.isArray(before) ? before.join(', ') : before, after: Array.isArray(value) ? value.join(', ') : value }); };
  if (plan.disable) set(t('Reinigungsturm'), 'enable_prime_tower', '0');
  else { set(t('Reinigungsturm X je Platte'), 'wipe_tower_x', plan.xs); set(t('Reinigungsturm Y je Platte'), 'wipe_tower_y', plan.ys); }
}
