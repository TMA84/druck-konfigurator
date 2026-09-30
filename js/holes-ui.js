'use strict';
/* Bohrlöcher verstärken – nur als Vorschlag (Entscheidung 2026-09-26): erkannte Löcher des gewählten
   Teils mit Häkchen; angehakte bekommen beim 3MF-Export einen Orca-Modifikator mit 100 % Füllung.
   Nach einer Drehung oder Größenänderung wird neu erkannt; gewählte Löcher werden dabei wiedergefunden (holesRemember /
   holesRestore: Mittelpunkt mitdrehen/-skalieren, nächstes erkanntes Loch nehmen). */

const AXIS_LABEL = { z: t('senkrecht'), x: t('waagerecht (X)'), y: t('waagerecht (Y)') };

// Gewählte Löcher als Punkte in Originalkoordinaten merken (vor einer Änderung von Drehung oder Größe)
function holesRemember(part) {
  if (!part.holes || !part.holes.length || part.holeGeom !== part.geom) return null;
  const g = part.geom, pv = [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, g.mn[2]], s = part.scale || [1, 1, 1], R = part.R || IDENTITY3;
  return part.holes.map(h => {
    const [iu, iv, iw] = HOLE_AXES[h.axis], p = [0, 0, 0];
    p[iu] = h.c[0]; p[iv] = h.c[1]; p[iw] = (h.w0 + h.w1) / 2;
    const un = p.map((v, k) => pv[k] + (v - pv[k]) / s[k]);              // Größe heraus
    return { orig: [0, 1, 2].map(k => R[k] * un[0] + R[3 + k] * un[1] + R[6 + k] * un[2]), r: h.r };   // Rᵀ · p: Drehung heraus
  });
}
// … und nach der Änderung im neuen Netz wiederfinden (höchstens 2 mm bzw. ein halber Radius daneben)
function holesRestore(part, mem) {
  if (!mem || !mem.length) return 0;
  const cands = partHoles(part), g = part.geom, pv = [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, g.mn[2]], s = part.scale || [1, 1, 1], R = part.R || IDENTITY3;
  const picked = [];
  for (const m of mem) {
    const rp = [0, 1, 2].map(k => R[k * 3] * m.orig[0] + R[k * 3 + 1] * m.orig[1] + R[k * 3 + 2] * m.orig[2]);
    const p = rp.map((v, k) => pv[k] + (v - pv[k]) * s[k]);
    let best = null, bd = Infinity;
    for (const h of cands) {
      const [iu, iv, iw] = HOLE_AXES[h.axis];
      if (p[iw] < h.w0 - 1 || p[iw] > h.w1 + 1) continue;
      const d = Math.hypot(p[iu] - h.c[0], p[iv] - h.c[1]);
      if (d < bd) { bd = d; best = h; }
    }
    if (best && bd <= Math.max(2, best.r / 2) && !picked.includes(best)) picked.push(best);
  }
  part.holes = picked;
  return picked.length;
}

function partHoles(part) {
  if (part.holeGeom !== part.geom) { part.holeCands = findHoles(part.geom); part.holeGeom = part.geom; part.holes = []; }
  return part.holeCands;
}

function renderHoles() {
  const box = $('holeBox'), part = project && project.parts[project.selected];
  const usable = !!part && !project.threemf;
  box.classList.toggle('hidden', !usable);
  if (!usable) return;
  const cands = partHoles(part), chosen = new Set((part.holes || []).map(h => h.id)), g = part.geom;
  // ohne erkannte Löcher gibt es hier nichts zu tun – Abschnitt ausblenden
  box.classList.toggle('hidden', !cands.length);
  if (typeof secSum === 'function') secSum('holes', cands.length ? t('{n} erkannt', { n: cands.length }) + (chosen.size ? ', ' + t('{n} verstärkt', { n: chosen.size }) : '') : '');
  if (!cands.length) return;
  $('holeInfo').textContent = cands.length
    ? t(cands.length === 1 ? '{n} rundes Loch erkannt.' : '{n} runde Löcher erkannt.', { n: cands.length }) + t(' Angehakte bekommen in Orca einen Ring von {ring} mm mit 100 % Füllung – die Last verteilt sich besser.', { ring: HOLE_RING_MM })
    : t('Keine runden Löcher erkannt.');
  $('holeList').innerHTML = cands.map(h => {
    const [iu, iv] = HOLE_AXES[h.axis], at = t('bei {pos}', { pos: 'xyz'[iu] + ' ' + de(h.c[0] - g.mn[iu], 0) + ' / ' + 'xyz'[iv] + ' ' + de(h.c[1] - g.mn[iv], 0) + ' mm' });
    return '<li><label><input type="checkbox" data-hole="' + h.id + '"' + (chosen.has(h.id) ? ' checked' : '') + '>' +
      '<span><b>' + t('Loch {n}', { n: h.id }) + '</b> · Ø ' + de(2 * h.r, 1) + ' mm · ' + t('{d} mm tief', { d: de(h.depth, 1) }) + ' · ' + AXIS_LABEL[h.axis] + '<small>' + at + '</small></span></label></li>';
  }).join('');
  $('holeAll').classList.toggle('hidden', cands.length < 2);
}

$('holeList').addEventListener('change', e => {
  const cb = e.target.closest('[data-hole]'); if (!cb) return;
  const part = project.parts[project.selected], cands = partHoles(part);
  const ids = new Set((part.holes || []).map(h => h.id));
  if (cb.checked) ids.add(+cb.dataset.hole); else ids.delete(+cb.dataset.hole);
  part.holes = cands.filter(h => ids.has(h.id));
});
$('holeAll').addEventListener('click', () => {
  const part = project.parts[project.selected], cands = partHoles(part);
  part.holes = part.holes && part.holes.length === cands.length ? [] : cands.slice();
  renderHoles();
});
