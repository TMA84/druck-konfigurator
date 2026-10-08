'use strict';
/* Druckwarteschlange (Tab ④ Drucker): alle Platten eines Slice-Stands nacheinander drucken. Reihenfolge nach
   Filament (js/plates.js orderPlates). Ist eine Platte fertig, meldet das Tool „Bett abräumen“ (auch als
   Browser-Benachrichtigung); die nächste startet erst nach Klick – über den Senden-Dialog mit Slot-Prüfung.
   Nie automatisch: das Bett muss vorher leer sein.
   Mit Server (GET api/queue → 200): Die Warteschlange liegt auf dem Server (tools/printqueue.py). Er schaut selbst
   alle 5 s beim Drucker nach – fertige Platten erkennt er auch ohne offene Seite (und meldet sie an Home Assistant).
   Die Seite fragt api/queue ab und meldet neue Ereignisse (event.seq > zuletzt gesehen) als Benachrichtigung.
   Ohne Server (Datei geöffnet, alter Server): wie bisher im Browser –
   store.settings.queue = {name, slice:{job, plates}, materials:{slot:{kind,name}}, items:[{plate, time_s, total_g, state}], lastDone}
   Stand des Druckers: aus der Werkbank (wbPoll), sonst alle 20 s, solange eine Platte läuft. */

const QUEUE_POLL_MS = 20000;
const QUEUE_SRV_MS = { printing: 5000, active: 15000, idle: 60000 };
const QUEUE_EVENT_MAX_AGE_S = 12 * 3600;   // ältere Ereignisse nicht mehr als Benachrichtigung
const QUEUE_STATE = { wait: 'wartet', printing: 'druckt', done: 'fertig', skipped: 'übersprungen' };   // Anzeige (übersetzt mit t())
let queueTimer = 0, queueSt = null;
// Server-Warteschlange: srv = letzte Antwort von api/queue; mode null = noch unbekannt, 'server' | 'local'
const qSrv = { mode: null, srv: null, timer: 0 };
const queue = () => qSrv.mode === 'server' ? (qSrv.srv && qSrv.srv.queue) || null : store.settings.queue || null;
function saveQueue(q) { store.settings.queue = q; persist(); }

async function queueServerDetect() {
  if (!location.protocol.startsWith('http')) return 'local';
  try {
    const r = await fetch('api/queue');
    if (!r.ok) return 'local';
    qSrv.srv = await r.json();
    return qSrv.srv && qSrv.srv.server ? 'server' : 'local';
  } catch (e) { return 'local'; }
}

async function queueApi(body) {
  const r = await lanApi('api/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  queueServerData(r);
  return r;
}

// Antwort von api/queue übernehmen: Stand des Druckers, neue Ereignisse melden
function queueServerData(r) {
  qSrv.srv = r;
  if (r.printer && (!queueSt || !queueSt.time || (r.printer.time || 0) * 1000 >= queueSt.time)) queueSt = Object.assign({}, r.printer, { time: (r.printer.time || 0) * 1000 });
  const ev = r.event, seen = store.settings.queueSeen || 0;
  if (ev && ev.seq > seen) {
    store.settings.queueSeen = ev.seq; persist();
    // nur, was noch gilt: Bett noch nicht abgeräumt (bzw. abgebrochen) und nicht zu alt
    if (Date.now() / 1000 - (ev.time || 0) < QUEUE_EVENT_MAX_AGE_S && r.queue && (r.bed_clear || ev.kind === 'aborted')) notifyDone({ plate: ev.plate, aborted: ev.kind === 'aborted' }, r.queue);
  } else if (!ev && r.seq > seen) { store.settings.queueSeen = r.seq; persist(); }
  renderQueue();
}

async function queueSync() {
  clearTimeout(qSrv.timer);
  try { const r = await fetch('api/queue'); if (r.ok) queueServerData(await r.json()); } catch (e) { /* nächster Versuch */ }
  const q = queue();
  qSrv.timer = setTimeout(queueSync, !q ? QUEUE_SRV_MS.idle : q.items.some(i => i.state === 'printing') ? QUEUE_SRV_MS.printing : QUEUE_SRV_MS.active);
}

// Warteschlange aus dem Browser (ältere Version) einmalig auf den Server übernehmen
async function queueMigrate() {
  const local = store.settings.queue;
  if (!local || queue()) { if (local && queue()) saveQueue(null); return; }
  try {
    await queueApi({ action: 'create', name: local.name, job: local.slice.job, plates: local.slice.plates, materials: local.materials,
      order: local.items.map(i => ({ plate: i.plate, state: i.state })) });
    saveQueue(null);
  } catch (e) { /* bleibt lokal liegen, nächster Versuch beim nächsten Laden */ }
}

async function startQueue() {
  const s = costState.slice;
  if (!s || !s.job || s.plates.length < 2) return;
  const old = queue();
  if (old && old.items.some(i => i.state === 'printing')) { toast(t('Es läuft noch eine Platte der bisherigen Warteschlange – erst beenden')); setTab('printer'); return; }
  const live = typeof slotChoices === 'function' ? slotChoices() : [];
  const o = orderPlates(s.plates, costState.materials, live.length ? live : null, slotMatchesKind);
  const materials = Object.fromEntries(Object.entries(costState.materials || {}).map(([k, m]) => [k, m ? { kind: m.kind, name: m.name } : null]));
  const name = project ? project.name : 'Druck';
  const plates = s.plates.map(p => ({ plate: p.plate, grams: p.grams, total_g: p.total_g, time_s: p.time_s + prepS(), changes: p.changes }));
  if (qSrv.mode === 'server') {
    // Rückmeldung, solange der Server anlegt (2026-10-08: bei vielen großen Platten dauerte das ohne jedes Zeichen)
    const btn = $('queueStart'), label = btn.textContent;
    btn.disabled = true; btn.textContent = t('Warteschlange wird angelegt …');
    try { await queueApi({ action: 'create', name, job: s.job, plates, materials, order: o.list.map(n => n.plate) }); }
    catch (e) { toast(t('Warteschlange nicht angelegt: {msg}', { msg: e.message })); return; }
    finally { btn.disabled = false; btn.textContent = label; }
    queueSync();
  } else {
    saveQueue({ name, created: Date.now(), materials, slice: { job: s.job, plates },
      items: o.list.map(n => { const p = s.plates.find(x => x.plate === n.plate); return { plate: n.plate, time_s: p.time_s + prepS(), total_g: p.total_g, state: 'wait' }; }) });
  }
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  toast(t(o.changed ? 'Warteschlange mit {n} Platten angelegt – sortiert nach Filament' : 'Warteschlange mit {n} Platten angelegt', { n: s.plates.length }));
  setTab('printer');
  renderQueue();
}

function queuePrint(plate) {
  const q = queue(); if (!q) return;
  openSendDialog(plate, { slice: q.slice, materials: q.materials, name: q.name, onStarted: p => {
    if (qSrv.mode === 'server') {
      queueApi({ action: 'started', plate: p }).then(() => queueSync(), e => toast(t('Warteschlange nicht aktualisiert: {msg}', { msg: e.message })));
      return;
    }
    const cur = queue(), it = cur && cur.items.find(i => i.plate === p);
    if (!it) return;
    Object.assign(it, { state: 'printing', started: Date.now(), seen: false, aborted: false });
    cur.lastDone = null;
    saveQueue(cur); renderQueue(); queuePoll();
  } });
}

function notifyDone(it, q) {
  const next = queueNext(q);
  const title = t(it.aborted ? 'Platte {n} abgebrochen' : 'Platte {n} fertig', { n: it.plate });
  const body = it.aborted ? t('Sie steht wieder in der Warteschlange.') : next ? t('Bett abräumen – dann Platte {n} starten.', { n: next.plate }) : t('Bett abräumen. Das war die letzte Platte.');
  toast(title + ': ' + body);
  if (!document.title.startsWith('● ')) document.title = '● ' + document.title;
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: 'druck-queue' }); } catch (e) { /* ohne Benachrichtigung */ }
}
window.addEventListener('focus', () => { document.title = document.title.replace(/^● /, ''); });

// Neuer Stand vom Drucker (Werkbank oder eigene Abfrage). Mit Server schaltet der Server weiter – hier nur anzeigen.
function onQueueStatus(st) {
  queueSt = Object.assign({}, st, { time: Date.now() });
  if (qSrv.mode !== 'local') { renderQueue(); return; }
  const q = queue(); if (!q) return;
  const cur = q.items.find(i => i.state === 'printing'), seen = cur && cur.seen;
  const done = queueTick(q, st);
  if (done) { q.lastDone = done.plate; saveQueue(q); notifyDone(done, q); }
  else if (cur && cur.seen !== seen) saveQueue(q);
  renderQueue();
}

async function queuePoll() {
  clearTimeout(queueTimer);
  if (qSrv.mode !== 'local') return;
  const q = queue();
  if (!q || !q.items.some(i => i.state === 'printing')) return;
  if (document.body.dataset.tab !== 'printer') {   // im Drucker-Tab fragt die Werkbank ohnehin ab
    const host = printerHost('kobra_s1');
    if (host) { try { onQueueStatus(await lanApi('api/anycubic/status?host=' + encodeURIComponent(host))); } catch (e) { /* nächster Versuch */ } }
  }
  queueTimer = setTimeout(queuePoll, QUEUE_POLL_MS);
}

function renderQueue() {
  const q = queue(), card = $('queueCard');
  card.classList.toggle('hidden', !q);
  if (!q) return;
  const st = queueSt, cur = q.items.find(i => i.state === 'printing'), next = queueNext(q);
  const free = st && !st.printing, done = q.items.filter(i => i.state === 'done').length;
  const rest = st || !qSrv.srv ? queueRemaining(q, st) : qSrv.srv.remaining_s || 0;
  $('queueT').textContent = t('Warteschlange · {name}', { name: q.name.replace(/\.(stl|3mf|zip)$/i, '') });
  $('queueSum').textContent = t('{done} von {total} fertig', { done, total: q.items.length }) + (rest > 0 ? ' · ' + t('noch ≈ {time} Druckzeit (ohne Pausen zum Abräumen)', { time: duration(rest) }) : '');
  const ace = st && st.ace && st.ace.length ? aceSlots(st) : null;
  const banner = $('queueBanner');
  const last = q.lastDone && q.items.find(i => i.plate === q.lastDone);
  banner.classList.toggle('hidden', !(last || (!cur && !next)));
  banner.innerHTML = !cur && !next ? '<b>' + t('Alle Platten gedruckt.') + '</b>'
    : last ? '<b>' + t(last.aborted ? 'Platte {n} abgebrochen' : 'Platte {n} fertig – Bett abräumen.', { n: last.plate }) + '</b>' + (next ? ' ' + t('Danach:') + ' <button class="btn" type="button" data-q-print="' + next.plate + '"' + (free ? '' : ' disabled') + '>' + t('Platte {n} drucken …', { n: next.plate }) + '</button>' : '') : '';
  $('queueList').innerHTML = q.items.map((it, n) => {
    const need = plateNeeds(q.slice.plates.find(p => p.plate === it.plate) || { plate: it.plate }, q.materials, ace, slotMatchesKind);
    const prog = it.state === 'printing' && st && st.job && st.job.progress != null ? ' · ' + st.job.progress + ' %' : '';
    const act = it.state === 'wait' ? '<button class="btn sec" type="button" data-q-print="' + it.plate + '"' + (free && !cur ? '' : ' disabled title="' + t('Erst wenn der Drucker frei ist') + '"') + '>' + t('Drucken …') + '</button><button class="linkbtn" type="button" data-q-skip="' + it.plate + '">' + t('Überspringen') + '</button>'
      : it.state === 'printing' ? '' : '<button class="linkbtn" type="button" data-q-again="' + it.plate + '">' + t('Nochmal') + '</button>';
    return '<li class="q-' + it.state + '"><span class="q-n">' + (n + 1) + '</span><span class="q-main"><b>' + t('Platte {n}', { n: it.plate }) + '</b><small>' + duration(it.time_s) + ' · ' + de(it.total_g, 1) + ' g</small>' +
      (need.missing.length && it.state === 'wait' ? '<small class="warn">' + need.missing.map(m => m.have ? t('Slot {n}: {want} einlegen (jetzt {have})', { n: m.slot + 1, want: esc(m.want), have: esc(m.have) }) : t('Slot {n}: {want} einlegen', { n: m.slot + 1, want: esc(m.want) })).join(' · ') + '</small>' : '') + '</span>' +
      '<span class="wb-pill q-state">' + t(QUEUE_STATE[it.state]) + prog + '</span><span class="q-act">' + act + '</span></li>';
  }).join('');
}

$('queueCard').addEventListener('click', e => {
  const q = queue(); if (!q) return;
  const p = e.target.closest('[data-q-print]'), s = e.target.closest('[data-q-skip]'), a = e.target.closest('[data-q-again]');
  if (p) { queuePrint(+p.dataset.qPrint); return; }
  const plate = s ? +s.dataset.qSkip : a ? +a.dataset.qAgain : 0, it = q.items.find(i => i.plate === plate);
  if (!it || !(s || a)) return;
  if (qSrv.mode === 'server') { queueApi({ action: s ? 'skip' : 'again', plate }).then(queueSync, err => toast(t(err.message))); return; }
  it.state = s ? 'skipped' : 'wait';
  saveQueue(q); renderQueue();
});
$('queueEnd').addEventListener('click', async () => {
  if (qSrv.mode === 'server') {
    try { await queueApi({ action: 'end' }); } catch (e) { toast(t(e.message)); return; }
    queueSync();
  } else { saveQueue(null); clearTimeout(queueTimer); }
  renderQueue(); toast(t('Warteschlange beendet – ein laufender Druck läuft weiter'));
});
$('queueStart').addEventListener('click', startQueue);
document.addEventListener('visibilitychange', () => { if (!document.hidden && qSrv.mode === 'server') queueSync(); });
renderQueue();
queueServerDetect().then(async mode => {
  qSrv.mode = mode;
  if (mode === 'server') { await queueMigrate(); queueServerData(qSrv.srv); queueSync(); }
  else { renderQueue(); queuePoll(); }
});
