'use strict';
/* Objekte überspringen (Tab ④ Druckauftrag): Liste der Objekte des laufenden Drucks mit „Überspringen“ – z. B. wenn sich
   ein Teil gelöst hat. Die Objekte liest der Server beim Start aus dem G-Code (EXCLUDE_OBJECT_DEFINE, api/printing/objects –
   nur für Drucke aus dem Tool); der Befehl geht über api/anycubic/command (skip/start, tools/anycubic_lan.py) mit der
   Nummer des Objekts (Reihenfolge im G-Code). Umrisse erscheinen im 3D-Fortschritt (übersprungen rot, unter der Maus orange). */
const sk = { name: null, objects: null, loading: false, hover: -1, lines: null, st: null };

// „teil.stl_id_1_copy_0“ → „teil.stl“ (Kopie 2, wenn es mehrere gibt)
function skLabel(o, all) {
  const m = /^(.*)_id_(\d+)_copy_(\d+)$/.exec(o.name), base = m ? m[1] : o.name;
  const copies = m ? all.filter(x => (/^(.*)_id_(\d+)_copy_\d+$/.exec(x.name) || [])[2] === m[2]).length : 1;
  return copies > 1 ? t('{name} (Kopie {n})', { name: base, n: +m[3] + 1 }) : base;
}
async function skLoad(name) {
  sk.name = name; sk.objects = null; sk.loading = true; skClearLines();
  try {
    const r = await fetch('api/printing/objects?name=' + encodeURIComponent(name));
    if (sk.name === name && r.ok) sk.objects = await r.json();
  } catch (e) { /* keine Liste – Abschnitt bleibt aus */ }
  finally { sk.loading = false; if (sk.st) skRender(sk.st); }
}
function skRender(st) {
  sk.st = st;
  const box = $('wbObjects'), job = st && st.job;
  if (!box) return;
  if (!job || !job.name) { box.classList.add('hidden'); box.innerHTML = ''; sk.name = null; sk.objects = null; skClearLines(); return; }
  if (job.name !== sk.name && !sk.loading) { skLoad(job.name); return; }
  const objs = sk.objects;
  if (!objs || objs.length < 2) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const skipped = new Set(job.skipped || []), left = objs.length - objs.filter(o => skipped.has(o.id)).length;
  box.classList.remove('hidden');
  box.innerHTML = '<div class="wb-obj-head"><b>' + esc(t('Objekte')) + '</b> <span class="muted">' + esc(t('{n} von {m} werden gedruckt', { n: left, m: objs.length })) + '</span></div>' +
    '<ul class="wb-obj-list">' + objs.map(o => {
      const off = skipped.has(o.id);
      return '<li data-sk-row="' + o.id + '" class="' + (off ? 'off' : '') + '"><span class="wb-obj-name" title="' + esc(o.name) + '">' + esc(skLabel(o, objs)) + '</span>' +
        (off ? '<span class="wb-obj-state">' + esc(job.skipped_confirmed ? t('übersprungen') : t('übersprungen (gesendet)')) + '</span>'
          : '<button type="button" class="btn sec small" data-sk-skip="' + o.id + '"' + (left < 2 ? ' disabled title="' + esc(t('Das letzte Objekt lässt sich nicht überspringen – dann den Druck abbrechen')) + '"' : '') + '>' + esc(t('Überspringen')) + '</button>') + '</li>';
    }).join('') + '</ul><p class="wb-obj-note muted">' + esc(t('Übersprungene Objekte druckt der Drucker ab sofort nicht mehr – das lässt sich nicht zurücknehmen.')) + '</p>';
  skDrawLines(skipped);
}
// Umrisse im 3D-Fortschritt (js/live-ui.js)
function skClearLines() {
  if (!sk.lines || typeof lv === 'undefined' || !lv.scene) { sk.lines = null; return; }
  for (const l of sk.lines) { lv.scene.remove(l); l.geometry.dispose(); l.material.dispose(); }
  sk.lines = null;
  if (typeof lvRender === 'function') lvRender();
}
function skDrawLines(skipped) {
  if (typeof lv === 'undefined' || !lv.scene || !lv.data || !sk.objects) return;
  skClearLines();
  sk.lines = sk.objects.filter(o => o.polygon && o.polygon.length > 2).map(o => {
    const pts = o.polygon.map(([x, y]) => new THREE.Vector3(x - lv.cx, y - lv.cy, 0.3));
    const col = o.id === sk.hover ? 0xf0a371 : skipped.has(o.id) ? 0xe5514f : 0x7d8792;
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col }));
    lv.scene.add(line); return line;
  });
  if (typeof lvRender === 'function') lvRender();
}
$('wbObjects').addEventListener('click', e => {
  const b = e.target.closest('[data-sk-skip]'); if (!b || !sk.objects) return;
  const o = sk.objects.find(x => x.id === +b.dataset.skSkip); if (!o) return;
  if (!confirm(t('„{name}“ ab jetzt nicht mehr drucken? Das lässt sich nicht zurücknehmen.', { name: skLabel(o, sk.objects) }))) return;
  wbCmd(b, 'skip', 'start', { parts: [o.id] }, t('„{name}“ wird übersprungen', { name: skLabel(o, sk.objects) }));
});
$('wbObjects').addEventListener('mouseover', e => { const r = e.target.closest('[data-sk-row]'); const h = r ? +r.dataset.skRow : -1; if (h !== sk.hover) { sk.hover = h; if (sk.st && sk.st.job) skDrawLines(new Set(sk.st.job.skipped || [])); } });
$('wbObjects').addEventListener('mouseleave', () => { sk.hover = -1; if (sk.st && sk.st.job) skDrawLines(new Set(sk.st.job.skipped || [])); });
