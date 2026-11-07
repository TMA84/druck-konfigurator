'use strict';
/* Werkbank, Karte „Nivellierung“: Bettnetz des Druckers als 3D-Fläche (api/anycubic/mesh, tools/mesh.py).
   Nur mit Rinkhals (Moonraker auf dem Drucker) – Werksfirmware gibt das Netz nicht heraus, dann ein Hinweis statt Fehler.
   Abgefragt einmal je Drucker, sobald er verbunden ist (js/workbench-ui.js wbPoll → meshOnStatus), nach jedem Druckende
   (vor dem Druck vermisst der Drucker das Bett neu) und mit „Aktualisieren“ – kein Dauerabfragen.
   Klipper: probed_matrix[y][x], Zeile 0 = vorn (mesh_min Y). Positiv = Bett an dieser Stelle höher.
   Zeichnen nur bei Änderungen (wie js/miniview.js), Farben hell/dunkel wie js/live-scene.js.
   Vergleich: der Server merkt sich jede neue Messung (tools/mesh.py, history) – gewählte frühere Messung gestrichelt über
   der Fläche, Änderung je Punkt in der Tabelle. „Jetzt vermessen“: POST api/anycubic/mesh/calibrate (nur wenn frei),
   danach alle MH_CALIB_POLL_MS den Stand fragen und am Ende das neue Netz laden. Schrauben: Schätzung aus dem Netz an den Schrauben (inneres Quadrat oder Ecken), wie weit welche zu drehen ist. */

const mh = { host: null, data: null, err: null, kind: '', busy: false, printing: null, at: 0, seq: 0, nums: false,
  renderer: null, scene: null, camera: null, controls: null, group: null, lines: [], prevLines: [], outline: null,
  cmp: null, screws: false, calib: null, calibTimer: null };   // cmp: null = vorige Messung, '' = ohne Vergleich, sonst Zeitpunkt (at) als Text
const MH_CALIB_POLL_MS = 5000;
const MH_RETRY_MS = 60000;   // nach „nicht erreichbar“ höchstens einmal je Minute erneut (nicht bei „nur mit Rinkhals“)
// Blau – Weiß – Rot (niedrig → hoch), dieselben Stufen wie der Verlauf in css/app.css .wb-mesh-scale
const MH_STOPS = [[0x21, 0x66, 0xac], [0x67, 0xa9, 0xcf], [0xf7, 0xf7, 0xf7], [0xef, 0x8a, 0x62], [0xb2, 0x18, 0x2b]];
function meshColour(f) {
  const x = Math.min(1, Math.max(0, f)) * (MH_STOPS.length - 1), i = Math.min(MH_STOPS.length - 2, Math.floor(x)), k = x - i;
  return MH_STOPS[i].map((c, j) => (c + (MH_STOPS[i + 1][j] - c) * k) / 255);
}
const meshDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
const meshMm = v => de(v, 3) + ' mm';
const meshMmS = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + de(Math.abs(v), 3) + ' mm';
const meshWhen = at => new Date(at * 1000).toLocaleString(LOCALE(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const MESH_OK_MM = 0.05;   // Ecke gilt als passend
// Gleiches Raster (Punkte und Grenzen) – sonst ist ein Vergleich Punkt für Punkt sinnlos
const meshFits = (a, b) => !!(a && b && a.probed.length === b.probed.length && a.probed[0].length === b.probed[0].length
  && a.min[0] === b.min[0] && a.min[1] === b.min[1] && a.max[0] === b.max[0] && a.max[1] === b.max[1]);
function meshPrev() {
  const h = (mh.data && mh.data.history) || [];
  if (mh.cmp === '') return null;
  const e = mh.cmp == null ? h[0] : h.find(x => String(x.at) === mh.cmp);
  return meshFits(mh.data, e) ? e : null;
}
// Änderung je Punkt (jetzt − vorher): größte (mit Vorzeichen und Ort), mittlere Abweichung
function meshDiff(d, prev) {
  let max = 0, at = [0, 0], sum = 0, n = 0;
  d.probed.forEach((row, y) => row.forEach((v, x) => {
    const dv = v - prev.probed[y][x]; sum += Math.abs(dv); n++;
    if (Math.abs(dv) > Math.abs(max)) { max = dv; at = [x, y]; }
  }));
  return { max, at, mean: sum / n };
}
const meshAxis = (d, i, n, k) => d.min[k] + (d.max[k] - d.min[k]) * i / (n - 1);

// Kennzahlen aus den gemessenen Punkten (nicht aus dem interpolierten Netz)
function meshStats(m) {
  const all = m.flat(), lo = Math.min(...all), hi = Math.max(...all);
  return { lo, hi, span: hi - lo, mean: all.reduce((a, b) => a + b, 0) / all.length };
}
// Überhöhung: Spanne ≈ ¼ der Bettbreite, auf 1-2-5 abgerundet
function meshFactor(span, width) {
  if (!(span > 1e-6)) return 100;
  const raw = Math.min(1000, width * 0.25 / span), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return Math.max(1, (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p);
}

function meshOnStatus(st) {
  if (document.documentElement.classList.contains('embed-3d')) return;   // eingebettet nur 3D-Fortschritt
  const host = wbHost();
  if (!host || !st || st.connected === false) return;
  const printing = !!st.printing, ended = mh.printing === true && !printing;
  if (mh.printing !== printing) { mh.printing = printing; meshRunState(); }
  if (mh.busy) return;
  const retry = mh.err && !['unsupported', 'empty'].includes(mh.kind) && Date.now() - mh.at > MH_RETRY_MS;
  if (mh.host !== host || ended || retry) meshLoad();
}

async function meshLoad() {
  const host = wbHost();
  if (!host) return;
  if (!mh.calibTimer && mh.host !== host) meshCalibPoll(true);   // Seite neu geladen, während der Drucker vermisst?
  const seq = ++mh.seq;
  mh.host = host; mh.busy = true; mh.at = Date.now();
  $('wbMeshLoad').disabled = true;
  if (!mh.data) $('wbMeshNote').textContent = t('Lade …');
  try {
    const d = await lanApi('api/anycubic/mesh?host=' + encodeURIComponent(host));
    if (seq !== mh.seq) return;
    if (mh.cmp && !(d.history || []).some(x => String(x.at) === mh.cmp)) mh.cmp = null;
    mh.data = d; mh.err = null; mh.kind = ''; mh.time = new Date().toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    if (seq !== mh.seq) return;
    mh.err = e.message; mh.kind = e.kind || '';
    if (mh.kind === 'unsupported' || mh.kind === 'empty') mh.data = null;   // sonst den letzten Stand weiter zeigen
  } finally {
    if (seq === mh.seq) { mh.busy = false; $('wbMeshLoad').disabled = false; mh.at = Date.now(); }
  }
  meshRender();
}
$('wbMeshLoad').addEventListener('click', meshLoad);

// ---------- Jetzt vermessen ----------
$('wbMeshBed').value = String([60, 70, 100].includes(store.settings.meshBed) ? store.settings.meshBed : 60);
$('wbMeshBed').addEventListener('change', e => { store.settings.meshBed = Number(e.currentTarget.value); persist(); });
$('wbMeshRun').addEventListener('click', async () => {
  const host = wbHost(), bed = Number($('wbMeshBed').value);
  if (!host || mh.printing) return;
  if (!confirm(t('Bett jetzt vermessen (Bett {bed} °C)? Der Drucker fährt in die Ausgangsstellung, heizt, wischt die Düse und tastet das Bett ab (5 × 5 Punkte) – etwa 4–5 Minuten. Das Bett muss leer sein.', { bed }))) return;
  $('wbMeshRun').disabled = true;
  try {
    await lanApi('api/anycubic/mesh/calibrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, bed }) });
    mh.calib = { started: Date.now() / 1000, bed, done: null, error: null };
    meshCalibPoll();
  } catch (e) {
    mh.calib = { done: Date.now() / 1000, error: e.message };
  }
  meshRunState();
});
/* Stand vom Server: läuft → weiter fragen; eben fertig → neues Netz laden. once: nur nachsehen (nach dem Laden der Seite). */
async function meshCalibPoll(once) {
  clearTimeout(mh.calibTimer); mh.calibTimer = null;
  const host = wbHost();
  if (!host) return;
  let c = null;
  try { c = (await lanApi('api/anycubic/mesh/calibrate?host=' + encodeURIComponent(host))).state; } catch (e) { if (once) return; }
  const was = mh.calib && !mh.calib.done;
  if (c) mh.calib = c;
  if (c && !c.done) mh.calibTimer = setTimeout(meshCalibPoll, MH_CALIB_POLL_MS);
  else if (was && c && c.done && !c.error) meshLoad();
  else if (was && !c && !once) mh.calibTimer = setTimeout(meshCalibPoll, MH_CALIB_POLL_MS);
  meshRunState();
}
function meshRunState() {
  const c = mh.calib, running = !!(c && !c.done), note = $('wbMeshRunNote');
  $('wbMeshRunRow').classList.toggle('hidden', mh.kind === 'unsupported');
  $('wbMeshRun').disabled = running || !!mh.printing || !wbHost();
  $('wbMeshBed').disabled = running;
  $('wbMeshRun').title = mh.printing ? t('Nur wenn der Drucker frei ist') : '';
  note.textContent = running ? t('Vermessen läuft seit {min} min – heizt, wischt, tastet ab …', { min: Math.max(0, Math.floor((Date.now() / 1000 - c.started) / 60)) })
    : c && c.error ? t('Vermessen fehlgeschlagen: {msg}', { msg: t(c.error) })
    : c && c.done ? t('Vermessen fertig ({time}).', { time: new Date(c.done * 1000).toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' }) })
    : mh.printing ? t('Vermessen geht nur, wenn der Drucker frei ist.') : '';
}
$('wbMeshNums').addEventListener('click', () => {
  mh.nums = !mh.nums; $('wbMeshNums').setAttribute('aria-pressed', String(mh.nums));
  $('wbMeshTable').classList.toggle('hidden', !mh.nums);
});
$('wbMeshScrewsBtn').addEventListener('click', () => {
  mh.screws = !mh.screws; $('wbMeshScrewsBtn').setAttribute('aria-pressed', String(mh.screws));
  $('wbMeshScrews').classList.toggle('hidden', !mh.screws);
});
$('wbMeshCmp').addEventListener('change', e => {
  const v = e.currentTarget.value, h = (mh.data && mh.data.history) || [];
  mh.cmp = h[0] && v === String(h[0].at) ? null : v;
  meshRender();
});
$('wbMeshPitch').value = String(store.settings.meshPitch || 0.5);
if (!$('wbMeshPitch').value) $('wbMeshPitch').value = '0.5';
$('wbMeshScrewAt').value = store.settings.meshScrewAt === 'corners' ? 'corners' : 'inner';
$('wbMeshScrewAt').addEventListener('change', e => { store.settings.meshScrewAt = e.currentTarget.value; persist(); if (mh.data) meshScrews(mh.data); });
$('wbMeshScrewRef').value = ['bl', 'br', 'fl', 'fr'].includes(store.settings.meshScrewRef) ? store.settings.meshScrewRef : 'auto';
function meshSetRef(v) { $('wbMeshScrewRef').value = v; store.settings.meshScrewRef = $('wbMeshScrewRef').value || 'auto'; persist(); if (mh.data) meshScrews(mh.data); }
$('wbMeshScrewRef').addEventListener('change', e => meshSetRef(e.currentTarget.value));
// Klick auf eine Schraube: sie wird Bezug
$('wbMeshScrewGrid').addEventListener('click', e => { const el = e.target.closest('[data-ref]'); if (el) meshSetRef(el.dataset.ref); });
$('wbMeshPitch').addEventListener('change', e => { store.settings.meshPitch = Number(e.currentTarget.value); persist(); if (mh.data) meshScrews(mh.data); });

function meshRender() {
  const d = mh.data, note = $('wbMeshNote');
  meshRunState();
  $('wbMeshBody').classList.toggle('hidden', !d);
  $('wbMeshNums').classList.toggle('hidden', !d);
  $('wbMeshScrewsBtn').classList.toggle('hidden', !d);
  if (!d) {
    $('wbMeshSum').textContent = '';
    note.textContent = mh.kind === 'unsupported' ? t('Nivellierungsdaten gibt es nur mit Rinkhals (Moonraker) – Werksfirmware gibt sie nicht heraus.')
      : mh.err ? t('Nicht abgefragt: {msg}', { msg: mh.err }) : t('Noch nicht abgefragt.');
    note.classList.remove('hidden');
    return;
  }
  note.textContent = mh.err ? t('Stand von {time} – jetzt nicht abgefragt: {msg}', { time: mh.time || '?', msg: mh.err }) : '';
  note.classList.toggle('hidden', !mh.err);
  const s = meshStats(d.probed), rows = d.probed.length, cols = d.probed[0].length;
  const fac = meshFactor(s.span, Math.max(d.max[0] - d.min[0], d.max[1] - d.min[1]));
  $('wbMeshSum').textContent = t('Spanne {span}', { span: meshMm(s.span) }) + ' · ' + t('{cols} × {rows} Punkte', { cols, rows })
    + (d.profile ? ' · ' + t('Profil „{name}“', { name: d.profile }) : '') + ' · '
    + (d.at ? t('gemessen {when}', { when: meshWhen(d.at) }) : mh.time);
  meshCmpSelect(d);
  const prev = meshPrev(), ps = prev && meshStats(prev.probed), diff = prev && meshDiff(d, prev);
  $('wbMeshHi').textContent = meshMm(s.hi); $('wbMeshMid').textContent = meshMm((s.hi + s.lo) / 2); $('wbMeshLo').textContent = meshMm(s.lo);
  const stats = [[t('Max'), meshMm(s.hi)], [t('Min'), meshMm(s.lo)], [t('Spanne (Distanz)'), meshMm(s.span)], [t('Mittelwert'), meshMm(s.mean)]];
  if (prev) stats.push([t('Spanne vorher'), meshMm(ps.span) + ' (' + meshMmS(s.span - ps.span) + ')'],
    [t('Größte Änderung'), meshMmS(diff.max)], [t('Änderung im Mittel'), meshMm(diff.mean)]);
  stats.push([t('Höhe überhöht'), '× ' + de(fac, 0)]);
  $('wbMeshStats').innerHTML = stats.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('');
  const cmpNote = $('wbMeshCmpNote');
  cmpNote.classList.toggle('hidden', !prev);
  cmpNote.textContent = prev ? t('Gestrichelt: Messung vom {when}. Größte Änderung {d} bei X {x}, Y {y} mm.', { when: meshWhen(prev.at), d: meshMmS(diff.max),
    x: de(meshAxis(d, diff.at[0], cols, 0), 0), y: de(meshAxis(d, diff.at[1], rows, 1), 0) }) : '';
  meshTable(d, s, prev);
  meshScrews(d);
  meshScene(d, s, fac, prev);
}

// Auswahl „Vergleich mit“: frühere Messungen (neueste zuerst); anderes Raster nicht wählbar
function meshCmpSelect(d) {
  const h = d.history || [], sel = $('wbMeshCmp');
  $('wbMeshCmpRow').classList.toggle('hidden', !h.length);
  if (!h.length) return;
  const cur = mh.cmp == null ? String(h[0].at) : mh.cmp;
  sel.innerHTML = '<option value="">' + esc(t('ohne Vergleich')) + '</option>' + h.map((e, i) => {
    const ok = meshFits(d, e), label = (i ? '' : t('vorige Messung') + ' · ') + meshWhen(e.at) + ' · '
      + (ok ? t('Spanne {span}', { span: meshMm(meshStats(e.probed).span) }) : t('anderes Raster'));
    return '<option value="' + e.at + '"' + (ok ? '' : ' disabled') + (String(e.at) === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
  }).join('');
  if (mh.cmp === '') sel.value = '';
}

/* Stellschrauben an den Ecken: Höhe der Eckpunkte des Netzes, Bezug wählbar (2026-11-07) – automatisch die Ecke, bei der
   insgesamt am wenigsten zu drehen ist, oder eine feste Ecke (z. B. die Schraube, die man nicht erreicht oder die fest sitzt).
   Höher als der Bezug → anziehen (senkt die Ecke bei Schrauben mit Feder), tiefer → lösen. Umdrehungen = Höhe / Steigung, auf ⅛. */
const MESH_CORNERS = [['hinten links', 1, 0, 'bl'], ['hinten rechts', 1, 1, 'br'], ['vorne links', 0, 0, 'fl'], ['vorne rechts', 0, 1, 'fr']];
const meshScrewRef = () => MESH_CORNERS.some(c => c[3] === $('wbMeshScrewRef').value) ? $('wbMeshScrewRef').value : 'auto';
/* Lage der Schrauben als Anteil der vermessenen Fläche: Kobra S1 – inneres Quadrat (¼ und ¾, beim 5 × 5-Netz 5…245 mm
   genau die Messpunkte bei 65 und 185 mm; Angabe des Nutzers 2026-11-02), sonst Ecken (0 und 1) */
const MESH_SCREW_AT = { inner: [0.25, 0.75], corners: [0, 1] };
const meshScrewWhere = () => MESH_SCREW_AT[$('wbMeshScrewAt').value] ? $('wbMeshScrewAt').value : 'inner';
// Höhe an einer Stelle (Anteil fx, fy der vermessenen Fläche), bilinear zwischen den Messpunkten
function meshAt(m, fx, fy) {
  const r = m.length, c = m[0].length, x = fx * (c - 1), y = fy * (r - 1);
  const i = Math.min(c - 2, Math.floor(x)), j = Math.min(r - 2, Math.floor(y)), u = x - i, v = y - j;
  return (m[j][i] * (1 - u) + m[j][i + 1] * u) * (1 - v) + (m[j + 1][i] * (1 - u) + m[j + 1][i + 1] * u) * v;
}
function meshScrewPlan(d) {
  const m = d.probed, at = MESH_SCREW_AT[meshScrewWhere()];
  const pts = MESH_CORNERS.map(([name, yb, xb, key]) => ({ name, key, fx: at[xb], fy: at[yb], z: meshAt(m, at[xb], at[yb]) }));
  const want = meshScrewRef();
  let ref = pts.find(p => p.key === want), best = Infinity;
  if (!ref) for (const p of pts) { const sum = pts.reduce((a, q) => a + Math.abs(q.z - p.z), 0); if (sum < best - 1e-9) { best = sum; ref = p; } }
  return pts.map(p => ({ ...p, ref: p === ref, dz: p.z - ref.z }));
}
const meshPos = (d, f, k) => d.min[k] + (d.max[k] - d.min[k]) * f;
const MESH_EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
function meshTurns(mm, pitch) {
  const e = Math.round(Math.abs(mm) / pitch * 8);
  if (!e) return '';
  const whole = Math.floor(e / 8), txt = (whole ? String(whole) + (e % 8 ? ' ' : '') : '') + MESH_EIGHTHS[e % 8];
  return (e > 8 ? t('≈ {n} Umdrehungen', { n: txt }) : t('≈ {n} Umdrehung', { n: txt }))
    + (e < 8 ? ' (' + Math.round(Math.abs(mm) / pitch * 360) + '°)' : '');
}
function meshScrews(d) {
  const pitch = Number($('wbMeshPitch').value) || 0.5, plan = meshScrewPlan(d);
  $('wbMeshScrewGrid').innerHTML = plan.map(p => {
    const ok = Math.abs(p.dz) < MESH_OK_MM, turns = meshTurns(p.dz, pitch);
    const what = p.ref ? t('Bezug – nicht drehen') : ok || !turns ? t('passt')
      : p.dz > 0 ? t('anziehen (im Uhrzeigersinn) – senkt das Bett hier') : t('lösen (gegen den Uhrzeigersinn) – hebt das Bett hier');
    return '<div class="wb-mesh-screw' + (p.ref ? ' ref' : ok ? ' ok' : p.dz > 0 ? ' down' : ' up') + '" data-ref="' + p.key + '" title="' + esc(t('Als Bezug nehmen')) + '"><b>' + esc(t(p.name)) + '</b>'
      + '<span class="wb-mesh-screw-dz">' + esc(meshMmS(p.dz)) + '</span>'
      + '<span>' + esc(what) + '</span>' + (!p.ref && !ok && turns ? '<span class="wb-mesh-screw-turns">' + esc(turns) + '</span>' : '') + '</div>';
  }).join('');
  const all = plan.every(p => Math.abs(p.dz) < MESH_OK_MM);
  $('wbMeshScrewNote').textContent = (all ? t('Alle Ecken liegen innerhalb von {mm} – nichts zu drehen.', { mm: meshMm(MESH_OK_MM) }) + ' ' : '')
    + t('Schätzung aus dem Bettnetz an den Schrauben (X {x1} / {x2}, Y {y1} / {y2} mm) für Stellschrauben mit Feder: Anziehen senkt das Bett an dieser Stelle. In kleinen Schritten drehen, dann neu vermessen und mit dieser Messung vergleichen – den Rest gleicht das Bettnetz beim Druck ohnehin aus.',
      { x1: de(meshPos(d, plan[2].fx, 0), 0), x2: de(meshPos(d, plan[3].fx, 0), 0), y1: de(meshPos(d, plan[2].fy, 1), 0), y2: de(meshPos(d, plan[0].fy, 1), 0) });
}

// Messpunkte als Tabelle von oben, vor dem Drucker stehend: vorn (Zeile 0, mesh_min Y) unten, hinten oben; gefärbt wie die Fläche
function meshTable(d, s, prev) {
  const m = d.probed, rows = m.length, cols = m[0].length;
  const at = (lo, hi, i, n) => lo + (hi - lo) * i / (n - 1);
  let h = '<table><thead><tr><th>' + esc(t('Y \\ X (mm)')) + '</th>';
  for (let x = 0; x < cols; x++) h += '<th>' + esc(de(at(d.min[0], d.max[0], x, cols), 0)) + '</th>';
  h += '</tr></thead><tbody>';
  for (let y = rows - 1; y >= 0; y--) {
    h += '<tr><th>' + esc(de(at(d.min[1], d.max[1], y, rows), 0)) + '</th>';
    for (let x = 0; x < cols; x++) {
      const v = m[y][x], c = meshColour(s.span > 0 ? (v - s.lo) / s.span : 0.5), lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      h += '<td style="background:rgb(' + c.map(q => Math.round(q * 255)).join(',') + ');color:' + (lum < 0.55 ? '#fff' : '#1b1f24') + '">' + esc(de(v, 3))
        + (prev ? '<small>' + esc(meshMmS(v - prev.probed[y][x]).replace(' mm', '')) + '</small>' : '') + '</td>';
    }
    h += '</tr>';
  }
  $('wbMeshTable').innerHTML = h + '</tbody><caption>' + esc(t('Blick von oben, vorne = unten')) + ' · ' + esc(t('Werte in mm; X links → rechts, Y vorne → hinten'))
    + (prev ? ' · ' + esc(t('klein: Änderung seit {when}', { when: meshWhen(prev.at) })) : '') + '</caption></table>';
}

// ---------- 3D ----------
/* Beschriftung am Bettrand (Sprite, immer zur Kamera gedreht): weiße Schrift mit dunklem Rand – lesbar hell wie dunkel */
function meshLabel(text, x, y) {
  const cv = document.createElement('canvas'), c = cv.getContext('2d'), fs = 40, font = '600 ' + fs + 'px system-ui, sans-serif';
  c.font = font;
  cv.width = Math.ceil(c.measureText(text).width) + 16; cv.height = fs + 16;
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 7; c.strokeStyle = 'rgba(20,26,30,.9)'; c.strokeText(text, cv.width / 2, cv.height / 2);
  c.fillStyle = '#fff'; c.fillText(text, cv.width / 2, cv.height / 2);
  // feste Größe auf dem Bildschirm (sizeAttenuation aus): lesbar auch auf dem Telefon
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true, sizeAttenuation: false }));
  const h = 0.05; sp.scale.set(h * cv.width / cv.height, h, 1); sp.position.set(x, y, 0); sp.renderOrder = 2;
  return sp;
}
function meshDraw() { if (mh.renderer) mh.renderer.render(mh.scene, mh.camera); }
function meshInit() {
  if (mh.renderer) return true;
  if (typeof THREE === 'undefined' || !THREE.OrbitControls) return false;
  const stage = $('wbMeshStage');
  try { mh.renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch (e) { console.warn('Nivellierung: kein WebGL', e); return false; }
  mh.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.appendChild(mh.renderer.domElement);
  mh.scene = new THREE.Scene();
  mh.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a949a, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.35); sun.position.set(0.4, -1, 1.2); mh.scene.add(sun);
  mh.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000); mh.camera.up.set(0, 0, 1);
  mh.controls = new THREE.OrbitControls(mh.camera, mh.renderer.domElement);
  mh.controls.addEventListener('change', meshDraw);
  mh.controls.addEventListener('start', () => { mh.userView = true; });   // selbst gedreht/gezoomt: nicht mehr einpassen
  new ResizeObserver(meshResize).observe(stage);
  new MutationObserver(meshTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  meshTheme();
  return true;
}
function meshResize() {
  if (!mh.renderer) return;
  const el = $('wbMeshStage'), w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  mh.renderer.setSize(w, h, false); mh.camera.aspect = w / h; mh.camera.updateProjectionMatrix();
  meshFit();
  meshDraw();
}
function meshTheme() {
  if (!mh.scene) return;
  const dark = meshDark();
  mh.scene.background = new THREE.Color(dark ? 0x2a343a : 0xe9eff1);
  for (const l of mh.lines) l.material.color.setHex(dark ? 0x10161a : 0x26343b);
  for (const l of mh.prevLines) l.material.color.setHex(dark ? 0xffd166 : 0x6a3d9a);
  if (mh.outline) mh.outline.material.color.setHex(dark ? 0xd0d6da : 0x3a454b);
  meshDraw();
}
function meshDispose() {
  if (!mh.group) return;
  mh.scene.remove(mh.group);
  mh.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  mh.group = null; mh.lines = []; mh.prevLines = []; mh.outline = null;
}
/* Fläche aus mesh_matrix (interpoliert, wenn feiner als die Messung), sonst probed_matrix. Bett: 0 … mesh_max + mesh_min
   (Rand wie vorn/links auch hinten/rechts), Mitte im Ursprung; z = Abweichung × Überhöhung. */
function meshScene(d, s, fac, prev) {
  if (!meshInit()) { if (!mh.nums) $('wbMeshNums').click(); $('wbMeshStage').classList.add('hidden'); return; }
  meshDispose();
  const m = d.mesh.length * d.mesh[0].length > d.probed.length * d.probed[0].length ? d.mesh : d.probed;
  const rows = m.length, cols = m[0].length, bx = d.max[0] + d.min[0], by = d.max[1] + d.min[1], cx = bx / 2, cy = by / 2;
  const px = i => d.min[0] + (d.max[0] - d.min[0]) * i / (cols - 1) - cx, py = j => d.min[1] + (d.max[1] - d.min[1]) * j / (rows - 1) - cy;
  const g = mh.group = new THREE.Group();
  const pos = new Float32Array(rows * cols * 3), col = new Float32Array(rows * cols * 3), idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = (j * cols + i) * 3, v = m[j][i], c = meshColour(s.span > 0 ? (v - s.lo) / s.span : 0.5);
    pos[k] = px(i); pos[k + 1] = py(j); pos[k + 2] = v * fac;
    col[k] = c[0]; col[k + 1] = c[1]; col[k + 2] = c[2];
    if (i < cols - 1 && j < rows - 1) { const a = j * cols + i, b = a + 1, e = a + cols, f = e + 1; idx.push(a, b, f, a, f, e); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
  // Gitterlinien über der Fläche: je Zeile und Spalte eine Linie
  const lineMat = () => new THREE.LineBasicMaterial({ color: 0x26343b, transparent: true, opacity: 0.55 });
  const line = pts => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat()); mh.lines.push(l); g.add(l); };
  for (let j = 0; j < rows; j++) line(Array.from({ length: cols }, (_, i) => new THREE.Vector3(px(i), py(j), m[j][i] * fac)));
  for (let i = 0; i < cols; i++) line(Array.from({ length: rows }, (_, j) => new THREE.Vector3(px(i), py(j), m[j][i] * fac)));
  // frühere Messung (Vergleich): gestrichelte Gitterlinien in derselben Überhöhung
  let plo = s.lo, phi = s.hi;
  if (prev) {
    const pm = prev.probed, pr = pm.length, pc = pm[0].length;
    const qx = i => d.min[0] + (d.max[0] - d.min[0]) * i / (pc - 1) - cx, qy = j => d.min[1] + (d.max[1] - d.min[1]) * j / (pr - 1) - cy;
    const dash = pts => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x6a3d9a, dashSize: 5, gapSize: 4, depthTest: false, transparent: true, opacity: 0.9 }));
      l.computeLineDistances(); l.renderOrder = 1; mh.prevLines.push(l); g.add(l);   // auch unter der Fläche sichtbar
    };
    for (let j = 0; j < pr; j++) dash(Array.from({ length: pc }, (_, i) => new THREE.Vector3(qx(i), qy(j), pm[j][i] * fac)));
    for (let i = 0; i < pc; i++) dash(Array.from({ length: pr }, (_, j) => new THREE.Vector3(qx(i), qy(j), pm[j][i] * fac)));
    const ps = meshStats(pm); plo = Math.min(plo, ps.lo); phi = Math.max(phi, ps.hi);
  }
  // Nullebene (durchsichtig) und Umriss des Betts
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(bx, by), new THREE.MeshBasicMaterial({ color: 0x8a949a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  g.add(plane);
  mh.outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * cx, b * cy, 0))),
    new THREE.LineBasicMaterial({ color: 0x3a454b }));
  g.add(mh.outline);
  // Ausrichtung wie Klipper/Orca: X links → rechts, Y vorn → hinten, Ursprung vorn links (Zeile 0 = vorderer Rand)
  const off = 16;
  for (const [txt, x, y] of [[t('vorne'), 0, -cy - off], [t('hinten'), 0, cy + off], [t('links'), -cx - off * 1.6, 0], [t('rechts'), cx + off * 1.7, 0],
    ['X →', cx * 0.55, -cy - off], ['Y →', -cx - off * 1.6, cy * 0.55], ['0,0', -cx - off * 0.6, -cy - off * 0.6]]) g.add(meshLabel(txt, x, y));
  mh.scene.add(g);
  mh.fit = { x: cx + off * 2.4, y: cy + off * 1.5, lo: plo * fac, hi: phi * fac };
  meshTheme(); meshResize();
}
/* Kamera: von vorn, etwas erhöht (wie man vor dem Drucker steht), Bett samt Beschriftung passend zur Größe der Ansicht –
   bis man selbst dreht oder zoomt, danach bleibt die eigene Ansicht */
function meshFit() {
  if (!mh.fit || mh.userView) return;
  const f = mh.fit, z = (f.lo + f.hi) / 2, dir = new THREE.Vector3(0, -1.1, 0.6).normalize(), cam = mh.camera;
  const pts = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const pz of [Math.min(0, f.lo), Math.max(0, f.hi)]) pts.push(new THREE.Vector3(sx * f.x, sy * f.y, pz));
  const fits = d => {
    cam.position.copy(dir).multiplyScalar(d).add(new THREE.Vector3(0, 0, z)); cam.lookAt(0, 0, z);
    cam.near = d / 100; cam.far = d * 20; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    return pts.every(p => { const q = p.clone().project(cam); return Math.abs(q.x) < 0.94 && Math.abs(q.y) < 0.9 && Math.abs(q.z) < 1; });
  };
  // kleinster Abstand, bei dem Bett und Beschriftung ganz zu sehen sind (Halbierung)
  let lo = 10, hi = 20000;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
  fits(hi);
  mh.controls.target.set(0, 0, z); mh.controls.update();
}
