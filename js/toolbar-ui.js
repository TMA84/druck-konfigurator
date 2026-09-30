'use strict';
/* Werkzeugleiste der 3D-Ansicht (Tab ①) wie in OrcaSlicer: Modell (hinzufügen, neue Platte, ausrichten, anordnen), Teil
   (Kopie +/−, trennen, entfernen), Bearbeiten (Fläche aufs Bett, drehen, Größe, Schnitt, Text, messen), Ansicht (ganze
   Platte, Drahtgitter, Achsen). Die Knöpfe lösen die vorhandenen Funktionen aus; Drehen und Größe öffnen ein kleines Feld
   unter dem Knopf. Ausgegraut, wenn es für das gewählte Teil nicht geht (z. B. Drehen bei einer Makerworld-3MF). */
const tbPart = () => project && project.parts[project.selected];

function updateToolbar() {
  const p = tbPart(), many = !!project && project.parts.length > 1, tpl = typeof plTpl === 'function' && plTpl();
  const lay = p && tpl ? projectLayout(tpl) : null, n = p && typeof copyGroupOf === 'function' ? copyGroupOf(p).length : 0;
  // ausgegraut mit Grund im Tooltip (sonst der normale Tooltip)
  const dis = (id, why) => { const b = $(id); if (!b) return; if (!b.dataset.title) b.dataset.title = b.title;
    b.disabled = !!why; b.title = why ? b.dataset.title + ' – ' + why : b.dataset.title; b.setAttribute('aria-label', b.title); };
  const noPart = !p && t('zuerst ein Modell laden');
  dis('tbNewPlate', noPart || (!many && t('nur bei mehreren Teilen')));
  dis('tbArrange', noPart || (!many && t('nur bei mehreren Teilen')));
  dis('tbCopyPlus', noPart);
  dis('tbCopyMinus', noPart || (n < 2 && t('nur eine Kopie vorhanden')));
  dis('tbSplit', noPart || (!p.bodies && t('Teil hat nur einen Körper')));
  dis('tbDelete', noPart || (!many && t('ein Teil bleibt immer – zum Leeren „Entfernen“ in der Modellkarte')));
  dis('tbScale', noPart);
  dis('tbRotate', noPart);
  dis('tbText', noPart || (typeof txUsable === 'function' && !txUsable(p) && t('bei Objekten aus einer Makerworld-3MF noch nicht möglich')));
  dis('btnPlate', noPart || (!many && t('nur bei mehreren Teilen')));
}

// Abschnitt der Modellkarte aufklappen und zeigen (für Text, Größe „mehr …“)
function tbOpenSection(key, focusId) {
  if (typeof secOpen === 'function' && !secOpen(key)) { store.settings.secOpen = { ...(store.settings.secOpen || {}), [key]: true }; persist(); secApply(key); }
  const box = $(SECTIONS[key]); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (focusId) setTimeout(() => { const el = $(focusId); if (el) el.focus(); }, 250);
}

// Kleines Feld unter einem Knopf (Drehen, Größe)
function tbPopOpen(btn, html) {
  const pop = $('tbPop');
  if (!pop.classList.contains('hidden') && pop.dataset.for === btn.id) { tbPopClose(); return; }
  pop.innerHTML = html; pop.dataset.for = btn.id; pop.classList.remove('hidden');
  const st = $('stage').getBoundingClientRect(), r = btn.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(st.width - pop.offsetWidth - 6, r.left - st.left)) + 'px';
  pop.style.top = (r.bottom - st.top + 6) + 'px';
  btn.classList.add('active');
}
function tbPopClose() {
  const pop = $('tbPop'), b = pop.dataset.for && $(pop.dataset.for);
  pop.classList.add('hidden'); if (b) b.classList.remove('active'); pop.dataset.for = '';
}
document.addEventListener('click', e => { if (!e.target.closest('#tbPop') && !e.target.closest('#tbRotate,#tbScale')) tbPopClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('tbPop').classList.contains('hidden')) tbPopClose(); });

$('tbNewPlate').addEventListener('click', () => {
  const p = tbPart(), tpl = plTpl(), lay = tpl && projectLayout(tpl); if (!p || !lay) return;
  movePart(project.selected, lay.count + 1);
  toast(t('{name} auf Platte {n}', { name: p.name, n: lay.count + 1 }));
});
$('tbArrange').addEventListener('click', () => $('plateAuto').click());
$('tbCopyPlus').addEventListener('click', () => { const p = tbPart(); if (p) setCopies(p, copyGroupOf(p).length + 1); });
$('tbCopyMinus').addEventListener('click', () => { const p = tbPart(); if (p) setCopies(p, copyGroupOf(p).length - 1); });
$('tbSplit').addEventListener('click', () => $('bodySplit').click());
$('tbDelete').addEventListener('click', () => { if (project) removePart(project.selected); });
$('tbText').addEventListener('click', () => tbOpenSection('text', 'txText'));
$('tbRotate').addEventListener('click', e => tbPopOpen(e.currentTarget,
  '<span class="tb-pop-title">' + t('Drehen um 90°') + '</span><div class="tb-pop-row">' +
  ['x', 'y', 'z'].map(a => '<button type="button" data-orient="' + a + '">↻ ' + a.toUpperCase() + '</button>').join('') +
  '<button type="button" data-orient="reset">' + t('Original') + '</button></div>'));
$('tbScale').addEventListener('click', e => {
  const p = tbPart(); if (!p) return;
  const s = p.scale || [1, 1, 1], pct = s[0] === s[1] && s[1] === s[2] ? Math.round(s[0] * 1000) / 10 : '';
  tbPopOpen(e.currentTarget, '<span class="tb-pop-title">' + t('Größe') + ' · ' + de(p.geom.x, 1) + ' × ' + de(p.geom.y, 1) + ' × ' + de(p.geom.z, 1) + ' mm</span>' +
    '<div class="tb-pop-row"><label><input id="tbScalePct" type="number" min="1" max="2000" step="1" value="' + pct + '" inputmode="decimal"> %</label>' +
    [50, 100, 200].map(v => '<button type="button" data-tbsz="' + v + '">' + v + ' %</button>').join('') + '</div>' +
    '<button type="button" class="linkbtn" id="tbScaleMore">' + t('Je Achse, Bauraum füllen …') + '</button>');
  setTimeout(() => $('tbScalePct') && $('tbScalePct').select(), 30);
});
$('tbPop').addEventListener('click', e => {
  const b = e.target.closest('[data-tbsz]'), p = tbPart();
  if (b && p) { const f = +b.dataset.tbsz / 100; setPartScale(p, [f, f, f]); tbPopClose(); return; }
  if (e.target.closest('#tbScaleMore')) { tbPopClose(); tbOpenSection('size', 'szPct'); }
});
$('tbPop').addEventListener('change', e => {
  if (e.target.id !== 'tbScalePct') return;
  const p = tbPart(), v = num(e.target.value);
  if (p && v > 0) { setPartScale(p, [v / 100, v / 100, v / 100]); tbPopClose(); }
});
