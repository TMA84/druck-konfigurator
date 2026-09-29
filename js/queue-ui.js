'use strict';
/* Druckwarteschlange (Tab ④ Drucker): alle Platten eines Slice-Stands nacheinander drucken. Reihenfolge nach
   Filament (js/plates.js orderPlates). Ist eine Platte fertig, meldet das Tool „Bett abräumen“ (auch als
   Browser-Benachrichtigung); die nächste startet erst nach Klick – über den Senden-Dialog mit Slot-Prüfung.
   Nie automatisch: das Bett muss vorher leer sein.
   store.settings.queue = {name, slice:{job, plates}, materials:{slot:{kind,name}}, items:[{plate, time_s, total_g, state}], lastDone}
   Stand des Druckers: aus der Werkbank (wbPoll), sonst alle 20 s, solange eine Platte läuft. */

const QUEUE_POLL_MS = 20000;
const QUEUE_STATE = { wait: 'wartet', printing: 'druckt', done: 'fertig', skipped: 'übersprungen' };   // Anzeige (übersetzt mit t())
let queueTimer = 0, queueSt = null;
const queue = () => store.settings.queue || null;
function saveQueue(q) { store.settings.queue = q; persist(); }

function startQueue() {
  const s = costState.slice;
  if (!s || !s.job || s.plates.length < 2) return;
  const old = queue();
  if (old && old.items.some(i => i.state === 'printing')) { toast(t('Es läuft noch eine Platte der bisherigen Warteschlange – erst beenden')); setTab('printer'); return; }
  const live = typeof slotChoices === 'function' ? slotChoices() : [];
  const o = orderPlates(s.plates, costState.materials, live.length ? live : null, slotMatchesKind);
  const materials = Object.fromEntries(Object.entries(costState.materials || {}).map(([k, m]) => [k, m ? { kind: m.kind, name: m.name } : null]));
  saveQueue({ name: project ? project.name : 'Druck', created: Date.now(), materials,
    slice: { job: s.job, plates: s.plates.map(p => ({ plate: p.plate, grams: p.grams, total_g: p.total_g, time_s: p.time_s, changes: p.changes })) },
    items: o.list.map(n => { const p = s.plates.find(x => x.plate === n.plate); return { plate: n.plate, time_s: p.time_s, total_g: p.total_g, state: 'wait' }; }) });
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  toast(t(o.changed ? 'Warteschlange mit {n} Platten angelegt – sortiert nach Filament' : 'Warteschlange mit {n} Platten angelegt', { n: s.plates.length }));
  setTab('printer');
  renderQueue();
}

function queuePrint(plate) {
  const q = queue(); if (!q) return;
  openSendDialog(plate, { slice: q.slice, materials: q.materials, name: q.name, onStarted: p => {
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

// Neuer Stand vom Drucker (Werkbank oder eigene Abfrage)
function onQueueStatus(st) {
  queueSt = st;
  const q = queue(); if (!q) return;
  const cur = q.items.find(i => i.state === 'printing'), seen = cur && cur.seen;
  const done = queueTick(q, st);
  if (done) { q.lastDone = done.plate; saveQueue(q); notifyDone(done, q); }
  else if (cur && cur.seen !== seen) saveQueue(q);
  renderQueue();
}

async function queuePoll() {
  clearTimeout(queueTimer);
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
  const free = st && !st.printing, rest = queueRemaining(q, st), done = q.items.filter(i => i.state === 'done').length;
  $('queueT').textContent = t('Warteschlange · {name}', { name: q.name.replace(/\.(stl|3mf|zip)$/i, '') });
  $('queueSum').textContent = t('{done} von {total} fertig', { done, total: q.items.length }) + (rest > 0 ? ' · ' + t('noch ≈ {time} Druckzeit (ohne Pausen zum Abräumen)', { time: duration(rest) }) : '');
  const ace = st && st.ace && st.ace[0] ? st.ace[0].slots : null;
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
  if (s && it) { it.state = 'skipped'; saveQueue(q); renderQueue(); }
  if (a && it) { it.state = 'wait'; saveQueue(q); renderQueue(); }
});
$('queueEnd').addEventListener('click', () => { saveQueue(null); clearTimeout(queueTimer); renderQueue(); toast(t('Warteschlange beendet – ein laufender Druck läuft weiter')); });
$('queueStart').addEventListener('click', startQueue);
renderQueue();
queuePoll();
