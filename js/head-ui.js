'use strict';
/* Druckkopf-Grafik in ④ (Karte „Druckkopf & Temperaturen“, 2026-11-09): Spule, Kühlkörper mit Lüfter, Düse, Schichten und
   Bett als Zeichnung, die Werte daran beschriftet. Auch allein zum Einbetten: index.html?ansicht=kopf (Home-Assistant-Karte
   custom:druckwerkstatt-card mit „ansicht: kopf“).
   Woher die Werte kommen:
   - Düse, Bett, Lüfter, Schicht: Stand des Druckers (wb.st, alle 3 s)
   - Spule: der geladene ACE-Slot (Farbe, Material, Slot-Nummer)
   - Speed: Vorschub der Bahnen, die der Kopf gerade fährt (G-Code-Vorschau, ±2 s um die Stelle aus der echten Kopfposition,
     js/live-head.js lvTrack – Weg durch Druckzeit, also samt Abbremsen in Ecken). Ohne Kopfposition: Mittel der Schicht.
   - Fluss: Speed × Querschnitt der Bahnen dieser Schicht (Vorschau layer_xs: Filamentvolumen / Bahnlänge, tools/gcode_preview.py)
   - Farbwechsel: je Schicht aus der Vorschau (changes) – bisher / gesamt
   - Druckzeit Düse: Stunden seit „Düse prüfen/wechseln“ (maintenance.items nozzle), darunter gesamt (maintenance.total_h)
   - Energie: nur eingebettet in Home Assistant – die Karte schickt den Wert ihrer Leistungs-Entität (postMessage). */

const HD_WINDOW_S = 2, HD_POWER_FRESH_MS = 5 * 60000, HD_ROWS = 7;
const hd = { built: false, powerW: null, powerAt: 0 };

// Leistung von der Home-Assistant-Karte (gleicher Ursprung über Ingress): {druckwerkstatt: 'leistung', w: 112}
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.druckwerkstatt !== 'leistung') return;
  const w = +e.data.w;
  hd.powerW = Number.isFinite(w) && w >= 0 ? w : null; hd.powerAt = Date.now();
  if (typeof wb !== 'undefined' && wb.st) hdRender(wb.st);
});

function hdSvg() {
  const fins = [], rows = [];
  for (let i = 0; i < 8; i++) fins.push('<rect class="hd-metal" x="228" y="' + (182 + i * 23) + '" width="144" height="13" rx="1"/>');
  for (let i = 0; i < HD_ROWS; i++) {
    const y = 600 - i * 14, l = 206, r = 394;
    rows.push('<path data-hd-row="' + i + '" class="hd-row" d="M' + (i % 2 ? r : l) + ' ' + y + ' H' + (i % 2 ? l : r) + '"/>');
  }
  const label = (k, x, y, anchor, lx, ly, tx, ty) => {
    const ux0 = anchor === 'start' ? x : x - 150, ux1 = anchor === 'start' ? x + 150 : x, ue = anchor === 'start' ? ux1 : ux0;
    return '<g data-hd-k="' + k + '" class="hd-label">' +
      '<text class="hd-cap" x="' + x + '" y="' + y + '" text-anchor="' + anchor + '"></text>' +
      '<text class="hd-val" x="' + x + '" y="' + (y + 32) + '" text-anchor="' + anchor + '"></text>' +
      '<text class="hd-sub" x="' + x + '" y="' + (y + 50) + '" text-anchor="' + anchor + '"></text>' +
      '<path class="hd-lead" d="M' + ux0 + ' ' + (y + 58) + ' H' + ux1 + ' M' + ue + ' ' + (y + 58) + ' L' + tx + ' ' + ty + '"/></g>';
  };
  return '<svg class="hd-svg" viewBox="0 0 600 720" role="img" aria-labelledby="hdTitle"><title id="hdTitle"></title>' +
    // Spule
    '<rect class="hd-metal" x="212" y="18" width="176" height="9" rx="3"/><rect class="hd-metal" x="212" y="103" width="176" height="9" rx="3"/>' +
    '<g class="hd-spool">' + [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => '<rect x="224" y="' + (31 + i * 8) + '" width="152" height="5"/>').join('') + '</g>' +
    '<rect class="hd-pill" x="248" y="50" width="104" height="30" rx="15"/><text class="hd-pilltxt" x="300" y="71" text-anchor="middle" data-hd="mat"></text>' +
    // Filament, Zuführung, Kühlkörper, Lüfter
    '<rect class="hd-metal" x="276" y="130" width="48" height="14"/><rect class="hd-metal" x="264" y="152" width="72" height="22"/>' +
    fins.join('') +
    '<g class="hd-fan"><path class="hd-fanframe" d="M220 236 H170 V330 H220"/><g class="hd-blades"><circle cx="198" cy="283" r="7"/>' +
    [0, 60, 120, 180, 240, 300].map(a => '<path d="M198 283 L' + (198 + 26 * Math.cos(a * Math.PI / 180)) + ' ' + (283 + 26 * Math.sin(a * Math.PI / 180)) +
      ' L' + (198 + 22 * Math.cos((a + 24) * Math.PI / 180)) + ' ' + (283 + 22 * Math.sin((a + 24) * Math.PI / 180)) + 'Z"/>').join('') + '</g></g>' +
    '<rect class="hd-metal" x="256" y="378" width="88" height="46"/>' +
    '<path class="hd-fil" data-hd="fil" d="M300 112 V478"/>' +
    '<circle class="hd-badge" cx="300" cy="283" r="36"/><text class="hd-badgetxt" x="300" y="297" text-anchor="middle" data-hd="slot"></text>' +
    '<path class="hd-nozzle" data-hd="noz" d="M276 428 H324 L300 476 Z"/>' +
    // Schichten und Bett
    '<path class="hd-fil hd-drop" data-hd="drop" d="M300 478 V516"/>' + rows.join('') +
    '<path class="hd-bedtop" d="M128 624 H472 L524 664 H76 Z"/><rect class="hd-bedfront" x="76" y="664" width="448" height="40"/>' +
    '<g class="hd-waves" data-hd="waves">' + [276, 300, 324].map(x => '<path d="M' + x + ' 656 c-6 -6 6 -10 0 -16 s6 -10 0 -16"/>').join('') + '</g>' +
    '<text class="hd-bedtxt" x="300" y="692" text-anchor="middle" data-hd="bed"></text>' +
    // Beschriftung: links Energie, Lüfter, Fluss – rechts Laufzeit, Farbwechsel, Speed, Düse, Schicht
    label('power', 20, 132, 'start', 0, 0, 236, 188) + label('fan', 20, 214, 'start', 0, 0, 170, 283) + label('flow', 20, 452, 'start', 0, 0, 296, 490) +
    label('hours', 580, 70, 'end', 0, 0, 368, 186) + label('changes', 580, 156, 'end', 0, 0, 368, 232) +
    label('speed', 580, 268, 'end', 0, 0, 368, 340) + label('nozzle', 580, 382, 'end', 0, 0, 344, 404) + label('layer', 580, 492, 'end', 0, 0, 398, 568) +
    '</svg>';
}

function hdBuild() {
  const box = $('wbHead');
  if (!box || hd.built) return !!box;
  box.innerHTML = hdSvg();
  hd.built = true;
  return true;
}

// Speed (mm/s) und Fluss (mm³/s) – {speed, flow, now} oder null; now = an der Kopfposition, sonst Mittel der Schicht
function hdMotion(st) {
  const d = typeof lv !== 'undefined' && lv.data, job = st && st.job;
  if (!d || !job || job.paused || lv.name !== job.name || !lv.at || !(+job.layer >= 1)) return null;
  const li = lv.at.li, xs = Array.isArray(d.layer_xs) ? +d.layer_xs[li] || 0 : 0;
  const start = d.layers[li][1], end = li + 1 < d.layers.length ? d.layers[li + 1][1] : d.count, P = lv.pos;
  if (!P || end <= start) return null;
  let speed = null, now = false;
  const h = lv.hs;
  if (h && h.snapped && h.li === li && typeof lvTrack === 'function') {
    const tr = lvTrack(li), s = lvHeadS(h, performance.now());
    let L = 0, T = 0;
    for (let k = 0; k < end - start; k++) {
      if (tr.b[k] < s - HD_WINDOW_S || tr.a[k] > s + HD_WINDOW_S) continue;
      const o = (start + k) * 6;
      L += Math.hypot(P[o + 3] - P[o], P[o + 4] - P[o + 1]); T += tr.b[k] - tr.a[k];
    }
    if (T > 0.05) { speed = L / T; now = true; }
  }
  if (speed == null && d.v) {
    // Mittel der Schicht: Vorschub der Bahnen nach Länge gewichtet
    let L = 0, LV = 0;
    for (let i = start; i < end; i++) { const o = i * 6, l = Math.hypot(P[o + 3] - P[o], P[o + 4] - P[o + 1]); if (d.v[i]) { L += l; LV += l * d.v[i] * (d.speed_unit || 2); } }
    if (L > 0) speed = LV / L;
  }
  if (speed == null) return null;
  return { speed, flow: xs > 0 ? speed * xs : null, now };
}

// Farbwechsel bisher / gesamt aus der Vorschau
function hdChanges(st) {
  const d = typeof lv !== 'undefined' && lv.data, job = st && st.job;
  if (!d || !job || lv.name !== job.name || !Array.isArray(d.changes)) return null;
  const total = d.changes.reduce((a, b) => a + b, 0);
  if (!lv.at || !(+job.layer >= 1)) return { done: 0, total };
  const li = Math.min(d.changes.length - 1, lv.at.li);
  let done = 0; for (let i = 0; i < li; i++) done += d.changes[i];
  return { done: Math.min(total, done + Math.floor(d.changes[li] * (lv.at.frac || 0))), total };
}

const hdHours = h => { const m = Math.round(h * 60); return Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
const hdDeg = v => v == null || !Number.isFinite(+v) ? '–' : Math.round(+v) + '°';

function hdLabel(k, cap, val, sub) {
  const g = document.querySelector('[data-hd-k="' + k + '"]');
  if (!g) return;
  g.classList.toggle('hidden', val == null);
  const [c, v, s] = g.querySelectorAll('text');
  c.textContent = cap; v.textContent = val == null ? '' : val; s.textContent = sub || '';
}

function hdRender(st) {
  if (!st || !hdBuild()) return;
  const tp = st.temps || {}, fans = st.fans || {}, job = st.job, svg = $('wbHead').firstElementChild;
  // geladene Spule (alle ACE-Einheiten, Slots durchgezählt)
  let slot = null, g = 0;
  for (const b of st.ace || []) for (const s of b.slots || []) { if (s.loaded && s.present && !slot) slot = { n: g + 1, colour: safeColour(s.colour, '#cfd6e0'), type: s.type }; g++; }
  const col = slot ? slot.colour : '#7c8796';
  svg.style.setProperty('--hd-fil', col);
  svg.querySelector('[data-hd="mat"]').textContent = slot ? String(slot.type || '?').slice(0, 8) : t('leer');
  svg.querySelector('[data-hd="slot"]').textContent = slot ? slot.n : '–';
  svg.querySelector('title').textContent = t('Druckkopf: Düse {n}, Bett {b}', { n: hdDeg(tp.curr_nozzle_temp), b: hdDeg(tp.curr_hotbed_temp) });
  svg.classList.toggle('hd-noz-hot', +tp.target_nozzle_temp > 0);
  svg.classList.toggle('hd-bed-hot', +tp.target_hotbed_temp > 0);
  svg.querySelector('[data-hd="bed"]').textContent = hdDeg(tp.curr_hotbed_temp) + (+tp.target_hotbed_temp > 0 ? ' / ' + hdDeg(tp.target_hotbed_temp) : '');
  // Lüfter dreht sich je nach Bauteillüfter (Dauer einer Umdrehung 0,3–2 s)
  const fp = +fans.fan_speed_pct || 0;
  svg.style.setProperty('--hd-spin', fp > 0 ? (2.2 - fp / 100 * 1.9).toFixed(2) + 's' : '0s');
  svg.classList.toggle('hd-fan-on', fp > 0);
  // Schichten: gedruckter Anteil
  const frac = job && +job.layers > 0 ? Math.max(0, Math.min(1, (+job.layer || 0) / +job.layers)) : 0, done = Math.round(frac * HD_ROWS);
  svg.querySelectorAll('[data-hd-row]').forEach(r => r.classList.toggle('done', +r.dataset.hdRow < done));
  svg.classList.toggle('hd-printing', !!job);

  const pw = hd.powerW != null && Date.now() - hd.powerAt < HD_POWER_FRESH_MS ? hd.powerW : null;
  hdLabel('power', t('Energie'), pw == null ? null : Math.round(pw) + ' W');
  const sub = [fans.aux_fan_speed_pct != null ? t('Zusatz {p} %', { p: Math.round(fans.aux_fan_speed_pct) }) : '', fans.box_fan_level != null ? t('Gehäuse {p} %', { p: Math.round(fans.box_fan_level) }) : ''].filter(Boolean).join(' · ');
  hdLabel('fan', t('Bauteillüfter'), fans.fan_speed_pct != null ? Math.round(fp) + ' %' : '–', sub);
  const mo = hdMotion(st);
  hdLabel('flow', t('Fluss'), mo && mo.flow != null ? de(mo.flow, 1) + ' mm³/s' : '–', mo && mo.flow != null ? (mo.now ? t('geschätzt aus dem G-Code') : t('Ø dieser Schicht')) : '');
  hdLabel('speed', t('Speed'), mo ? Math.round(mo.speed) + ' mm/s' : '–', mo ? (mo.now ? t('laut G-Code an dieser Stelle') : t('Ø dieser Schicht')) : '');
  // groß die Druckstunden der Düse (seit „Düse prüfen/wechseln“ erledigt, Wartung in ③), darunter alle Stunden
  const mt = typeof spoolData !== 'undefined' && spoolData && spoolData.maintenance || {};
  const tot = mt.total_h, noz = (mt.items || []).find(i => i.key === 'nozzle');
  const totTxt = typeof tot === 'number' ? t('gesamt {h}', { h: hdHours(tot) }) : '';
  if (noz && typeof noz.hours === 'number') hdLabel('hours', t('Druckzeit Düse'), hdHours(noz.hours), totTxt);
  else hdLabel('hours', t('Gesamtlaufzeit'), typeof tot === 'number' ? hdHours(tot) : '–', t('gedruckt mit der Druckwerkstatt'));
  const ch = hdChanges(st);
  hdLabel('changes', t('Farbwechsel'), ch ? ch.done + ' / ' + ch.total : '–', ch ? t('bisher / in diesem Druck') : '');
  hdLabel('nozzle', t('Düsentemperatur'), hdDeg(tp.curr_nozzle_temp), +tp.target_nozzle_temp > 0 ? t('Ziel {temp}', { temp: hdDeg(tp.target_nozzle_temp) }) : t('aus'));
  hdLabel('layer', t('Schicht'), job && job.layers != null ? safeInt(job.layer) + ' / ' + safeInt(job.layers) : '–', job ? safeInt(job.progress) + ' %' : t('kein Druck'));
}
