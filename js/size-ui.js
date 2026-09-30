'use strict';
/* Größe je Teil (① Modell → Größe): Skalierung in Prozent (gleichmäßig) oder Zielmaß je Achse in mm; „gleichmäßig“ aus =
   jede Achse einzeln. part.scale = [sx, sy, sz] bezogen auf die Originalgröße, angewandt nach der Drehung um die Mitte der
   Grundfläche (js/orient.js partGeom). Gilt für alle Platzierungen desselben Teils (Kopien). 3MF-Objekte: die Datei des
   Designers bleibt, die Skalierung kommt in die Transformation (js/export3mf.js scaleItemTransform). */
const SZ_MIN = 0.01, SZ_MAX = 20;

function sizeOrig(part) {   // Maße ohne Skalierung (nach der Drehung)
  const s = part.scale || [1, 1, 1], g = part.geom;
  return [g.x / s[0], g.y / s[1], g.z / s[2]];
}
function setPartScale(part, s) {
  s = s.map(v => Math.min(SZ_MAX, Math.max(SZ_MIN, Math.round(v * 1e5) / 1e5)));
  const hadHoles = (part.holes || []).length;
  for (const p of samePlacements(part)) {
    p.scale = s.every(v => v === 1) ? null : s;
    p.geom = partGeom(p);
    if (typeof orientCache !== 'undefined') orientCache.delete(p);
  }
  if (hadHoles) toast(t('Größe geändert – Bohrlöcher bitte neu wählen'));
  if (part === project.parts[project.selected]) showModel(part.geom); else update();
}

function renderSize() {
  const box = $('sizeBox'), part = project && project.parts[project.selected];
  box.classList.toggle('hidden', !part);
  if (!part) return;
  const s = part.scale || [1, 1, 1], uni = s[0] === s[1] && s[1] === s[2], g = part.geom;
  if (typeof secSum === 'function') secSum('size', uni ? (s[0] === 1 ? '' : de(s[0] * 100, 0) + ' %') : s.map(v => de(v * 100, 0)).join(' / ') + ' %');
  $('sizePart').textContent = project.parts.length > 1 ? part.name : '';
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  set('szPct', uni ? String(Math.round(s[0] * 1000) / 10) : '');
  $('szPct').placeholder = uni ? '' : t('je Achse');
  set('szX', String(Math.round(g.x * 10) / 10)); set('szY', String(Math.round(g.y * 10) / 10)); set('szZ', String(Math.round(g.z * 10) / 10));
  if (!uni && $('szUniform').checked && document.activeElement !== $('szUniform')) $('szUniform').checked = false;
  const tpl = typeof plTpl === 'function' && plTpl(), vol = tpl ? buildVolume(tpl) : null, over = vol ? volumeExcess(g, vol) : [];
  $('szNote').textContent = (s.some(v => v !== 1) ? t('Original: {dims} mm', { dims: sizeOrig(part).map(v => de(v, 1)).join(' × ') }) : '') +
    (over.length ? (s.some(v => v !== 1) ? ' · ' : '') + t('passt nicht in den Bauraum') : '');
  $('szNote').classList.toggle('bad', !!over.length);
}

$('szPct').addEventListener('change', () => {
  const part = project && project.parts[project.selected], v = num($('szPct').value);
  if (!part || !(v > 0)) return;
  setPartScale(part, [v / 100, v / 100, v / 100]);
});
['X', 'Y', 'Z'].forEach((ax, k) => $('sz' + ax).addEventListener('change', () => {
  const part = project && project.parts[project.selected], v = num($('sz' + ax).value);
  if (!part || !(v > 0)) return;
  const o = sizeOrig(part), f = v / o[k], s = (part.scale || [1, 1, 1]).slice();
  if ($('szUniform').checked) setPartScale(part, [f, f, f]); else { s[k] = f; setPartScale(part, s); }
}));
document.querySelectorAll('[data-sz]').forEach(b => b.addEventListener('click', () => {
  const part = project && project.parts[project.selected]; if (!part) return;
  const f = +b.dataset.sz / 100; setPartScale(part, [f, f, f]);
}));
$('szReset').addEventListener('click', () => { const part = project && project.parts[project.selected]; if (part) setPartScale(part, [1, 1, 1]); });
// so groß wie möglich (gleichmäßig), dass das Teil noch in den Bauraum passt – mit 2 % Rand
$('szFit').addEventListener('click', () => {
  const part = project && project.parts[project.selected], tpl = typeof plTpl === 'function' && plTpl();
  if (!part || !tpl) return;
  const vol = buildVolume(tpl), o = sizeOrig(part), f = 0.98 * Math.min(vol[0] / o[0], vol[1] / o[1], isFinite(vol[2]) ? vol[2] / o[2] : Infinity);
  setPartScale(part, [f, f, f]);
  toast(t('{name}: {p} %', { name: part.name, p: de(f * 100, 0) }));
});
