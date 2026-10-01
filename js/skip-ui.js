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
// Schicht des Druckers → Schicht der Vorschau (wie liveUpdate)
function skPreviewLayer(L) {
  const n = lv.data.layers.length, T = sk.st && sk.st.job ? +sk.st.job.layers || 0 : 0;
  return T > 0 ? Math.min(n - 1, Math.max(0, Math.round(L / T * n) - 1)) : Math.min(n - 1, Math.max(0, L - 1));
}
function skDrawLines(skipped) {
  if (typeof lv === 'undefined' || !lv.scene || !lv.data || !sk.objects) return;
  // Bahnen übersprungener Objekte ab der Schicht des Überspringens dunkel, der Kopf lässt sie aus (js/live-ui.js)
  if (typeof lvSkipSet === 'function') {
    const at = (sk.st && sk.st.job && sk.st.job.skipped_at) || {}, cur = lv.shown >= 0 ? lv.shown : 0;
    lvSkipSet(sk.objects.filter(o => skipped.has(o.id) && o.polygon && o.polygon.length > 2)
      .map(o => ({ polygon: o.polygon, from: at[o.id] != null ? skPreviewLayer(+at[o.id]) : cur })));
  }
  skClearLines();
  skHookView();
  sk.lines = sk.objects.filter(o => o.polygon && o.polygon.length > 2).map(o => {
    const pts = o.polygon.map(([x, y]) => new THREE.Vector3(x - lv.cx, y - lv.cy, 0.3));
    const col = o.id === sk.hover ? 0xf0a371 : skipped.has(o.id) ? 0xe5514f : 0x7d8792;
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col }));
    lv.scene.add(line); return line;
  });
  if (typeof lvRender === 'function') lvRender();
}
function skAsk(o, btn) {
  const skipped = new Set((sk.st && sk.st.job && sk.st.job.skipped) || []);
  if (skipped.has(o.id)) { toast(t('„{name}“ ist schon übersprungen', { name: skLabel(o, sk.objects) })); return; }
  if (sk.objects.length - skipped.size < 2) { toast(t('Das letzte Objekt lässt sich nicht überspringen – dann den Druck abbrechen')); return; }
  if (!confirm(t('„{name}“ ab jetzt nicht mehr drucken? Das lässt sich nicht zurücknehmen.', { name: skLabel(o, sk.objects) }))) return;
  wbCmd(btn || null, 'skip', 'start', { parts: [o.id] }, t('„{name}“ wird übersprungen', { name: skLabel(o, sk.objects) }));
}
$('wbObjects').addEventListener('click', e => {
  const b = e.target.closest('[data-sk-skip]'); if (!b || !sk.objects) return;
  const o = sk.objects.find(x => x.id === +b.dataset.skSkip); if (o) skAsk(o, b);
});

/* Im 3D-Fortschritt anklicken: Strahl der Maus bis zur Höhe der aktuellen Schicht, Objekt, in dessen Umriss der Punkt
   liegt (Ziehen = drehen, kein Klick). Unter der Maus orange umrandet. */
function skPick(ev) {
  if (!sk.objects || !lv.renderer || !lv.data || !sk.st || !sk.st.job) return null;
  const r = lv.renderer.domElement.getBoundingClientRect(), ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, lv.camera);
  const z = lv.shown >= 0 && lv.data.layers[lv.shown] ? lv.data.layers[lv.shown][0] : 0, p = new THREE.Vector3();
  if (!rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), p)) return null;
  const x = p.x + lv.cx, y = p.y + lv.cy;
  const inside = poly => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  return sk.objects.find(o => o.polygon && o.polygon.length > 2 && inside(o.polygon)) || null;
}
function skHookView() {
  if (sk.hooked || typeof lv === 'undefined' || !lv.renderer) return;
  sk.hooked = true;
  const el = lv.renderer.domElement;
  let down = null;
  el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
    down = null;
    const o = skPick(e); if (o) skAsk(o);
  });
  el.addEventListener('pointermove', e => {
    if (e.buttons) return;
    const o = skPick(e), h = o ? o.id : -1;
    el.style.cursor = o ? 'pointer' : '';
    el.title = o ? t('{name} – anklicken zum Überspringen', { name: skLabel(o, sk.objects) }) : '';
    if (h !== sk.hover) { sk.hover = h; if (sk.st && sk.st.job) skDrawLines(new Set(sk.st.job.skipped || [])); }
  });
}
$('wbObjects').addEventListener('mouseover', e => { const r = e.target.closest('[data-sk-row]'); const h = r ? +r.dataset.skRow : -1; if (h !== sk.hover) { sk.hover = h; if (sk.st && sk.st.job) skDrawLines(new Set(sk.st.job.skipped || [])); } });
$('wbObjects').addEventListener('mouseleave', () => { sk.hover = -1; if (sk.st && sk.st.job) skDrawLines(new Set(sk.st.job.skipped || [])); });
