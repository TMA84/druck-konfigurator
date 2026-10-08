'use strict';
/* Drucker-Werkbank (Tab „Drucker“): Kobra S1 mit Werksfirmware über den LAN-Modus (tools/anycubic_lan.py).
   Stand alle 3 s, solange der Tab offen ist (der Server hält die Verbindung und fragt selbst alle 5 s).
   Befehle prüft der Server noch einmal (Wertebereiche, Achsen/Einziehen während eines Drucks gesperrt).
   Entscheidung 2026-09-28: Werkbank mit Druckauftrag, Kamera, Temperaturen/Lüftern/Licht, Achsen, ACE.
   Drucke über LAN haben die Auftragsnummer −1 (so auch bei Anycubics Slicer); Pause/Abbruch senden sie so.
   Drucken aus dem Tool: js/send-ui.js. Nicht dabei (nicht belegt): Druckgeschwindigkeit ändern, Dateiverwaltung. */

const WB_POLL_MS = 3000;
const WB_PRINTER = 'kobra_s1';
const WB_PRESETS = { pla: [215, 60], petg: [240, 75], asa: [250, 95], off: [0, 0] };
const WB_SPEED = { 1: 'Leise', 2: 'Standard', 3: 'Sport' };
const wb = { timer: 0, st: null, err: '', player: null, box: 0 };
const wbHost = () => printerHost(WB_PRINTER);
const wbMin = m => m == null ? '–' : m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min';
const wbDeg = v => v == null ? '–' : Math.round(v) + ' °C';

function onWorkbenchTab(active) {
  if (active) { wb.camUserOff = false; wbPoll(); }
  else { clearTimeout(wb.timer); wbCamOff(); }
}
/* Kamera startet von selbst, sobald sie zu sehen ist: Tab ④ offen, Ansicht „Kamera“, Drucker verbunden und mit Kamera.
   Von Hand gestoppt bleibt sie aus, bis der Tab wieder geöffnet wird; in der 3D-Ansicht läuft kein Strom im Hintergrund. */
function wbCamAuto() {
  if (wb.player || wb.camUserOff || document.hidden || document.body.dataset.tab !== 'printer') return;
  if (typeof lv !== 'undefined' && lv.mode !== 'cam') return;
  const st = wb.st;
  if (!st || wb.err || !st.connected || st.camera === false || !wbHost()) return;
  wb.camRetries = 0; wbCamStart(false);
}

async function wbPoll() {
  clearTimeout(wb.timer);
  if (document.body.dataset.tab !== 'printer') return;
  const host = wbHost();
  if (!host || !(await lanServerAvailable())) { wbRenderNoLink(host ? t('Der Server kann den LAN-Modus nicht (im Container enthalten; lokal: pip install -r requirements.txt).') : ''); return; }
  // pos=1: Kopfposition auch während des Drucks (Schalter in der 3D-Ansicht, js/live-ui.js)
  const pos = typeof livePosWanted === 'function' && livePosWanted() ? '&pos=1' : '';
  const prev = wb.st;
  try { wb.st = await lanApi('api/anycubic/status?host=' + encodeURIComponent(host) + pos); wb.err = ''; }
  catch (e) { wb.err = t(e.message); }
  if (!wb.err) wbEvents(prev, wb.st);
  wbRender();
  if (!wb.err && typeof onQueueStatus === 'function') onQueueStatus(wb.st);
  if (!wb.err && typeof liveUpdate === 'function') liveUpdate(wb.st);   // 3D-Fortschritt (js/live-ui.js)
  wbCamAuto();   // Warteschlange (js/queue-ui.js)
  if (typeof schedPoll === 'function') schedPoll();   // geplanter Druck (js/schedule-ui.js)
  wb.timer = setTimeout(wbPoll, WB_POLL_MS);
}

/* Druck pausiert (mit Grund), fertig oder abgebrochen: Meldung in der Seite und – wenn erlaubt – als Benachrichtigung
   (gleiches tag wie die Warteschlange: eine Meldung, nicht zwei). Zuverlässig auch ohne offene Seite: Home Assistant,
   Ereignis „Druck-Ereignis“ (tools/ha_mqtt.py). */
function wbNotify(title, body) {
  toast(title + (body ? ' – ' + body : ''));
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body: body || '', tag: 'druck-queue' }); } catch (e) { /* nur Hinweis */ }
}
function wbEvents(prev, st) {
  const pj = prev && prev.job, sj = st && st.job;
  if (!pj || (prev.connected === false) || (st && st.connected === false)) return;
  const name = wbJobTitle(pj.name).title;
  if (sj && sj.name === pj.name) {
    if (!pj.paused && sj.paused) wbNotify(t('Druck pausiert: {name}', { name }), st.pause_reason ? t(st.pause_reason) : '');
    return;
  }
  const end = !sj ? st && st.last_job : null, s = end ? String(end.status || end.state) : '';
  if (/fertig|finished|complete/.test(s)) wbNotify(t('Platte fertig: {name}', { name }), t('Bett abräumen'));
  else if (/abgebrochen|stop|cancel/.test(s)) wbNotify(t('Druck abgebrochen: {name}', { name }), '');
}
function wbRenderNoLink(why) {
  $('wbNoLink').classList.remove('hidden'); $('wbGrid').classList.add('hidden');
  $('wbNoLinkWhy').textContent = why || t('Am Drucker Einstellungen → Netzwerk → LAN-Modus einschalten, dann hier die IP-Adresse eintragen.');
  $('wbHost').value = wbHost() || '';
}
$('wbConnect').addEventListener('click', async () => {
  const host = $('wbHost').value.trim();
  if (!IP_PATTERN.test(host)) { toast(t('Bitte eine IP-Adresse wie 192.168.1.50 eintragen')); return; }
  $('wbConnect').disabled = true; $('wbNoLinkWhy').textContent = t('Verbinde mit {host} …', { host });
  try {
    const live = await fetchLanStatus(host);
    saveLink(WB_PRINTER, host, 'lan');
    slotState = { printer: WB_PRINTER, live, note: '' };
    toast(t('Verbunden – Verbindung gespeichert'));
    wbPoll(); update();
  } catch (e) { $('wbNoLinkWhy').textContent = t('Nicht verbunden: {msg}', { msg: t(e.message) }); }
  finally { $('wbConnect').disabled = false; }
});

// Eingabefeld nicht überschreiben, während jemand darin tippt oder schiebt
const wbSet = (el, v) => { if (document.activeElement !== el && !el.dataset.touched) el.value = v; };

// Dateinamen aus Anycubics Slicer lesbar machen: „0928-1842-Name_plate(01)_ASA_0.16_1h51m30s“ → „Name“ + Details
function wbJobTitle(raw) {
  const s = String(raw || t('Druck'));
  const m = /^(?:\d{4}-\d{4}-)?(.*?)(?:_plate\((\d+)\))?(?:_([A-Z][A-Z0-9+-]*)_(\d+(?:\.\d+)?)_(\d+h)?(\d+m)?(\d+s)?)?$/.exec(s);
  if (!m) return { title: s, sub: '' };
  const bits = [m[2] ? t('Platte {n}', { n: +m[2] }) : '', m[3] || '', m[4] ? de(+m[4], 2) + ' mm' : ''].filter(Boolean);
  return { title: (m[1] || s).replace(/_/g, ' ').trim(), sub: bits.join(' · ') };
}
const wbClock = min => { const d = new Date(Date.now() + min * 60000); return d.toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' }) + (d.toDateString() !== new Date().toDateString() ? t(' (morgen)') : ''); };
function wbHeat(bar, tile, cur, tgt) {
  bar.style.width = (tgt > 0 ? Math.min(100, (cur || 0) / tgt * 100) : Math.min(100, (cur || 0) / 3)) + '%';
  tile.classList.toggle('off', !(tgt > 0));
}

function wbRender() {
  const st = wb.st;
  $('wbNoLink').classList.add('hidden'); $('wbGrid').classList.remove('hidden');
  const conn = $('wbConn');
  conn.textContent = wb.err ? t('getrennt') : st && st.connected ? t('verbunden') : t('verbinde …');
  conn.className = 'wb-pill ' + (wb.err ? 'bad' : 'good');
  if (!st) { $('wbJob').innerHTML = '<p class="muted">' + esc(wb.err || t('Lade …')) + '</p>'; return; }
  const printing = !!st.printing, job = st.job;

  // Statusleiste
  $('wbName').textContent = st.name || st.model || 'Kobra S1';
  { const md = typeof anycubicLanModel === 'function' ? anycubicLanModel(st.model) : null;   // andere Anycubic als der Kobra S1: experimentell
    if (md && !md.tested) $('wbName').insertAdjacentHTML('beforeend', ' <span class="badge lan-exp" title="' + esc(t('Bisher nur am Kobra S1 geprüft – Rückmeldung gern als GitHub-Issue')) + '">' + esc(t('experimentell')) + '</span>'); }
  $('wbMeta').textContent = [st.name && st.model && st.name !== st.model ? st.model : '', st.firmware ? 'Firmware ' + st.firmware : '', st.ip || wbHost()].filter(Boolean).join(' · ');
  const state = $('wbState');
  const plan = typeof sched !== 'undefined' && sched.v && sched.v.plan, planLabel = plan && { heating: t('heizt vor'), drying: t('trocknet') }[plan.state];
  state.textContent = wb.err ? t('nicht erreichbar') : job ? (job.paused ? t('pausiert') : t(job.status || job.state || 'aktiv')) : planLabel || (st.state === 'free' ? t('bereit') : st.state || '?');
  state.className = 'wb-pill' + (job && !job.paused ? ' live' : '');
  const light = (st.lights || [])[0];
  $('wbLight').disabled = !light; if (light && document.activeElement !== $('wbLight')) $('wbLight').checked = light.status === 1;
  if (!$('wbRawOut').classList.contains('hidden')) $('wbRawOut').textContent = JSON.stringify(st.raw, null, 1);

  // Druckauftrag
  if (job) {
    const jt = wbJobTitle(job.name), pct = job.progress ?? 0;
    // Restzeit: eigene Schätzung aus Orca und der aktuellen Schicht (js/live-ui.js lvRemaining), sonst die des Druckers
    const own = !job.paused && typeof lvRemaining === 'function' ? lvRemaining(st) : null, remMin = own ? Math.round(own.s / 60) : job.remaining_min;
    const remTip = own ? t('Aus der Orca-Schätzung und der aktuellen Schicht; der Drucker meldet {m}', { m: wbMin(job.remaining_min) }) : t('Laut Drucker');
    $('wbJob').innerHTML = (wb.err ? '<p class="note bad">' + esc(wb.err) + '</p>' : '') +
      '<div class="wb-jobtitle" title="' + esc(job.name) + '">' + esc(jt.title) + '</div>' + (jt.sub ? '<div class="wb-jobsub">' + esc(jt.sub) + '</div>' : '') +
      '<div class="wb-bigpct"><b>' + pct + ' %</b><span>' + (job.paused ? t('pausiert') : esc(t(job.status || ''))) + '</span></div>' +
      (job.paused ? '<p class="note warn wb-pause"><b>' + t('Pausiert') + ':</b> ' + esc(t(st.pause_reason || 'am Drucker pausiert – Grund nicht gemeldet')) + '</p>' : '') +
      '<div class="wb-progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div>' +
      '<dl class="wb-jobinfo"><div><dt>' + t('Schicht') + '</dt><dd>' + (job.layer ?? '–') + ' / ' + (job.layers ?? '–') + '</dd></div>' +
      '<div title="' + esc(remTip) + '"><dt>' + t('Fertig um') + '</dt><dd>' + (remMin != null && !job.paused ? wbClock(remMin) : '–') + '</dd></div>' +
      '<div title="' + esc(remTip) + '"><dt>' + t('Verbleibend') + '</dt><dd>' + wbMin(remMin) + (own && job.remaining_min != null ? '<small class="wb-printer-rem">' + esc(t('Drucker: {m}', { m: wbMin(job.remaining_min) })) + '</small>' : '') + '</dd></div><div><dt>' + t('Gedruckt') + '</dt><dd>' + wbMin(job.elapsed_min) + '</dd></div>' +
      (job.filament_mm ? '<div><dt>' + t('Filament bisher') + '</dt><dd>' + de(job.filament_mm / 1000, 1) + ' m</dd></div>' : '') + '</dl>';
  } else {
    // kein Druck, aber ein Plan läuft (js/schedule-ui.js): heizt vor / trocknet / wartet – statt „Kein Druck aktiv“
    const plan = typeof sched !== 'undefined' && sched.v && sched.v.plan, active = plan && ['wait', 'drying', 'heating'].includes(plan.state);
    const msg = !active ? t('Kein Druck aktiv. Drucken lässt sich aus dem Schritt <b>③ Slicen &amp; Kosten</b>.')
      : esc(t({ heating: 'Bett heizt vor – Druck startet um {s}', drying: 'Filament trocknet – Druck startet um {s}', wait: 'Druck geplant – Start um {s}' }[plan.state], { s: schedWhen(plan.start_at) })) +
        (plan.start_at > Date.now() / 1000 ? ' (' + esc(t('in {t}', { t: duration(plan.start_at - Date.now() / 1000) })) + ')' : '') + '<br><small>' + esc(plan.name) + ' · ' + esc(t('Platte {n}', { n: plan.plate })) + '</small>';
    $('wbJob').innerHTML = (wb.err ? '<p class="note bad">' + esc(wb.err) + '</p>' : '') + '<p class="wb-idle">' + msg + '</p>';
  }
  $('wbPause').disabled = !job || job.paused; $('wbResume').disabled = !job || !job.paused; $('wbStop').disabled = !job;
  $('wbPause').classList.toggle('hidden', !job || job.paused); $('wbResume').classList.toggle('hidden', !(job && job.paused)); $('wbStop').classList.toggle('hidden', !job);
  if (typeof skRender === 'function') skRender(st);   // Objekte überspringen (js/skip-ui.js)
  const badge = $('printerBadge');
  badge.textContent = job ? (job.progress ?? 0) + ' %' : ''; badge.classList.toggle('hidden', !job);

  // Temperaturen, Lüfter
  const tp = st.temps || {};
  $('wbNozCur').textContent = wbDeg(tp.curr_nozzle_temp); $('wbNozTgt').textContent = tp.target_nozzle_temp ? t('Ziel {temp}', { temp: wbDeg(tp.target_nozzle_temp) }) : t('aus');
  $('wbBedCur').textContent = wbDeg(tp.curr_hotbed_temp); $('wbBedTgt').textContent = tp.target_hotbed_temp ? t('Ziel {temp}', { temp: wbDeg(tp.target_hotbed_temp) }) : t('aus');
  wbHeat($('wbNozBar'), $('wbNozBar').closest('.wb-temp'), tp.curr_nozzle_temp, tp.target_nozzle_temp);
  wbHeat($('wbBedBar'), $('wbBedBar').closest('.wb-temp'), tp.curr_hotbed_temp, tp.target_hotbed_temp);
  wbSet($('wbNozIn'), tp.target_nozzle_temp || ''); wbSet($('wbBedIn'), tp.target_hotbed_temp || '');
  document.querySelectorAll('[data-wb-fan]').forEach(inp => { const v = (st.fans || {})[inp.dataset.wbFan]; if (v != null) wbSet(inp, v); inp.nextElementSibling.textContent = inp.value + ' %'; });
  $('wbSpeed').textContent = st.speed_mode != null ? t('Druckgeschwindigkeit: {mode} – ändern am Drucker', { mode: WB_SPEED[st.speed_mode] ? t(WB_SPEED[st.speed_mode]) : st.speed_mode }) : '';

  // Achsen: während des Drucks nur der Hinweis
  const p = st.position;
  $('wbPos').textContent = p ? 'X ' + de(p.x, 1) + ' · Y ' + de(p.y, 1) + ' · Z ' + de(p.z, 2) : '';
  $('wbAxNote').classList.toggle('hidden', !printing); $('wbAxBody').classList.toggle('hidden', printing);
  document.querySelectorAll('[data-wb-jog],[data-wb-home],#wbMotorsOff').forEach(b => { b.disabled = printing || !!wb.err; });

  // ACE: Kacheln in Filamentfarbe. Mehrere Einheiten (bis 4): Reiter je ACE; Slot-Nummern laufen über alle Einheiten
  // (ACE 2 = Slot 5–8), Laden/Trocknen/Temperatur gelten für die gewählte Einheit
  const boxes = st.ace || [], bi = Math.min(wb.box || 0, Math.max(0, boxes.length - 1)), box = boxes[bi], base = wbSlotBase(boxes, bi);
  $('wbAceTabs').classList.toggle('hidden', boxes.length < 2);
  $('wbAceTabs').innerHTML = boxes.length < 2 ? '' : boxes.map((x, i) => '<button type="button" data-wb-box="' + i + '" aria-pressed="' + (i === bi) + '">ACE ' + (i + 1) +
    (x.drying && x.drying.status ? ' <small>' + t('trocknet') + '</small>' : '') + '</button>').join('');
  $('wbAceSlots').innerHTML = box ? box.slots.map(s => { const g = base + s.index; return '<li class="' + (s.loaded ? 'loaded' : '') + (s.present ? '' : ' empty') + '">' +
      '<div class="wb-swatch" style="' + (s.present ? 'background:' + esc(s.colour || '#dddddd') : '') + '"><span>' + (g + 1) + '</span></div>' +
      '<div class="wb-slotinfo"><b>' + (s.present ? esc(s.type) : t('leer')) + '</b><small>' + (s.present ? (s.loaded ? t('im Drucker') : s.rfid ? 'RFID' : t('von Hand')) : '–') + '</small>' +
        (s.present && typeof spoolTileHTML === 'function' ? spoolTileHTML(g) : '') + '</div>' +
      (s.present ? '<div class="wb-feed"><button type="button" data-wb-feed="' + s.index + ',1"' + (printing ? ' disabled' : '') + ' title="' + t('Filament bis zur Düse laden') + '">' + t('Laden') + '</button><button type="button" data-wb-feed="' + s.index + ',2"' + (printing ? ' disabled' : '') + ' title="' + t('Filament zurückziehen') + '">' + t('Zurück') + '</button></div>' : '') + '</li>'; }).join('')
    : '<li class="empty" style="grid-column:1/-1;padding:10px">' + (st.has_ace === 0 ? t('Keine ACE angeschlossen.') : t('Keine ACE-Daten.')) + '</li>';
  $('wbAutoFeed').disabled = !box; if (box && document.activeElement !== $('wbAutoFeed')) $('wbAutoFeed').checked = box.auto_feed === 1;
  const dry = box && box.drying || {};
  $('wbAceTemp').textContent = box && box.temp != null ? t('{temp} °C in der ACE', { temp: box.temp }) : '';
  $('wbDry').textContent = dry.status ? t('Beenden') : t('Starten'); $('wbDry').disabled = !box;
  $('wbDryState').textContent = dry.status ? t('{temp} °C · noch {left}', { temp: dry.target_temp, left: wbMin(dry.remain_time) }) : t('aus');
  $('wbDryBar').style.width = dry.status && dry.duration ? Math.max(0, Math.min(100, (1 - (dry.remain_time || 0) / dry.duration) * 100)) + '%' : '0';
  document.querySelectorAll('#wbDryTemp,#wbDryMin').forEach(el => { el.disabled = !!dry.status; });
}

// Befehl senden, Knopf solange sperren, danach sofort neu lesen
async function wbCmd(btn, type, action, data, done) {
  const host = wbHost(); if (!host) return;
  if (btn) btn.disabled = true;
  try {
    const r = await lanCommand(host, type, action, data);
    if (!r.ok) throw Error(r.msg || t('vom Drucker abgelehnt ({code})', { code: r.state || r.code }));
    if (done) toast(done);
  } catch (e) { toast(t('Nicht ausgeführt: {msg}', { msg: t(e.message) })); }
  finally { if (btn) btn.disabled = false; document.querySelectorAll('[data-touched]').forEach(el => delete el.dataset.touched); wbPoll(); }
}

$('wbPause').addEventListener('click', e => wbCmd(e.currentTarget, 'print', 'pause', {}, t('Druck pausiert')));
$('wbResume').addEventListener('click', e => wbCmd(e.currentTarget, 'print', 'resume', {}, t('Druck fortgesetzt')));
$('wbStop').addEventListener('click', e => {
  const job = wb.st && wb.st.job;
  if (!confirm(t('Druck „{name}“ wirklich abbrechen? Das lässt sich nicht rückgängig machen.', { name: job && job.name || '' }))) return;
  wbCmd(e.currentTarget, 'print', 'stop', {}, t('Druck abgebrochen'));
});
document.querySelectorAll('[data-wb-temp]').forEach(b => b.addEventListener('click', () => {
  const nozzle = b.dataset.wbTemp === '0', v = Math.round(num((nozzle ? $('wbNozIn') : $('wbBedIn')).value) || 0);
  wbCmd(b, 'tempature', 'set', nozzle ? { type: 0, target_nozzle_temp: v, target_hotbed_temp: 0 } : { type: 1, target_nozzle_temp: 0, target_hotbed_temp: v }, nozzle ? (v ? t('Düse auf {v} °C', { v }) : t('Düse aus')) : (v ? t('Bett auf {v} °C', { v }) : t('Bett aus')));
}));
['wbNozIn', 'wbBedIn'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') document.querySelector('[data-wb-temp="' + (id === 'wbNozIn' ? 0 : 1) + '"]').click(); }));
document.querySelectorAll('[data-wb-preset]').forEach(b => b.addEventListener('click', () => {
  const [n, bed] = WB_PRESETS[b.dataset.wbPreset];
  wbCmd(b, 'tempature', 'set', { type: 2, target_nozzle_temp: n, target_hotbed_temp: bed }, n ? t('Heize auf {n} / {bed} °C', { n, bed }) : t('Heizungen aus'));
}));
document.querySelectorAll('[data-wb-fan]').forEach(inp => {
  inp.addEventListener('input', () => { inp.dataset.touched = '1'; inp.nextElementSibling.textContent = inp.value + ' %'; });
  inp.addEventListener('change', () => wbCmd(null, 'fan', 'setSpeed', { [inp.dataset.wbFan]: +inp.value }));
});
$('wbLight').addEventListener('change', e => {
  const l = (wb.st && wb.st.lights || [])[0] || { type: 2 };
  wbCmd(e.currentTarget, 'light', 'control', { type: l.type, status: e.currentTarget.checked ? 1 : 0, brightness: 100 });
});
document.querySelectorAll('[data-wb-jog]').forEach(b => b.addEventListener('click', () => {
  const [axis, dir] = b.dataset.wbJog.split(',').map(Number);
  wbCmd(b, 'axis', 'move', { axis, move_type: dir, distance: +$('wbStep').value });
}));
document.querySelectorAll('[data-wb-home]').forEach(b => b.addEventListener('click', () => wbCmd(b, 'axis', 'move', { axis: +b.dataset.wbHome, move_type: 2 }, t('Fahre nach Hause'))));
$('wbMotorsOff').addEventListener('click', e => wbCmd(e.currentTarget, 'axis', 'turnOff', null, t('Motoren aus – Achsen müssen danach neu referenziert werden')));
// Erster Slot einer Einheit in der Zählung über alle Einheiten (wie js/printer-link.js aceSlots)
const wbSlotBase = (boxes, bi) => boxes.slice(0, bi).reduce((n, b) => n + b.slots.length, 0);
const wbBox = () => { const boxes = (wb.st && wb.st.ace) || []; return boxes[Math.min(wb.box || 0, boxes.length - 1)]; };
$('wbAceTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-wb-box]'); if (!b) return;
  wb.box = +b.dataset.wbBox; if (wb.st) wbRender();
});
$('wbAceSlots').addEventListener('click', e => {
  const b = e.target.closest('[data-wb-feed]'); if (!b) return;
  const [slot, type] = b.dataset.wbFeed.split(',').map(Number), box = wbBox(), n = wbSlotBase(wb.st.ace, wb.st.ace.indexOf(box)) + slot + 1;
  wbCmd(b, 'multiColorBox', 'feedFilament', { multi_color_box: [{ id: box.id, feed_status: { slot_index: slot, type } }] }, type === 1 ? t('Lade Slot {n}', { n }) : t('Ziehe Slot {n} zurück', { n }));
});
// Nachfüllen gilt für den ganzen Drucker: an alle Einheiten
$('wbAutoFeed').addEventListener('change', e => {
  const on = e.currentTarget.checked ? 1 : 0;
  wbCmd(e.currentTarget, 'multiColorBox', 'setAutoFeed', { multi_color_box: wb.st.ace.map(box => ({ id: box.id, auto_feed: on })) });
});
$('wbDry').addEventListener('click', e => {
  const box = wbBox(), on = !(box.drying && box.drying.status);
  wbCmd(e.currentTarget, 'multiColorBox', 'setDry', { multi_color_box: [{ id: box.id, drying_status: { status: on ? 1 : 0, target_temp: Math.round(num($('wbDryTemp').value)), duration: Math.round(num($('wbDryMin').value)) } }] }, on ? t('Trocknen gestartet') : t('Trocknen beendet'));
});
$('wbRaw').addEventListener('click', () => { $('wbRawOut').classList.toggle('hidden'); if (wb.st) $('wbRawOut').textContent = JSON.stringify({ ...wb.st.raw, letzte_meldungen: wb.st.recent }, null, 1); });

/* ---------- Kamera: HTTP-FLV vom Drucker, über den Server (mpegts.js spielt es im Browser ab – Nachfolger von flv.js,
   läuft auch auf dem iPhone ab iOS 17.1 über Apples ManagedMediaSource; flv.js ging dort gar nicht) ----------
   Gegen ein „altes Bild“: Bleibt der Strom stehen (keine neuen Bilder, aber auch kein Fehler – das letzte Bild bliebe
   stehen), verbindet ein Wächter nach CAM_STALL_MS neu; wächst der Rückstand im Puffer (z. B. nach einem Tab im
   Hintergrund), springt die Wiedergabe ans Ende; kommt das Fenster wieder nach vorn, startet der Strom frisch. */
const CAM_STALL_MS = 6000, CAM_MAX_LAG_S = 1.5, CAM_RETRY_MAX = 5;
function wbCamFrames() {
  const v = $('wbVideo'), q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
  return q ? q.totalVideoFrames : (v.webkitDecodedFrameCount || Math.round(v.currentTime * 30));
}
function wbCamStop(keepButton) {
  clearInterval(wb.camWatch); wb.camWatch = 0;
  if (wb.player) { try { wb.player.destroy(); } catch (e) { /* schon zu */ } wb.player = null; }
  $('wbVideo').removeAttribute('src'); $('wbVideo').load();
  if (!keepButton) wb.camOn = false;
}
function wbCamOff() {
  wbCamStop();
  $('wbCamBtn').textContent = t('Kamera starten'); $('wbCamNote').textContent = t('Kamera aus'); $('wbCamNote').classList.remove('hidden');
}
function wbCamStart(reconnect) {
  if (typeof mpegts === 'undefined' || !mpegts.isSupported() || !mpegts.getFeatureList().mseLivePlayback) {
    $('wbCamNote').textContent = /iPhone|iPod/.test(navigator.userAgent) ? t('Das Kamerabild braucht auf dem iPhone iOS 17.1 oder neuer.') : t('Dieser Browser kann das Kamerabild (FLV) nicht abspielen.'); $('wbCamNote').classList.remove('hidden'); return;
  }
  wbCamStop(true);
  wb.camOn = true;
  $('wbCamNote').textContent = reconnect ? t('Kamerabild hing – verbinde neu …') : t('Starte Kamera …'); $('wbCamNote').classList.remove('hidden');
  // „&t=“ gegen zwischengespeicherte Antworten; der Server startet die Übertragung am Drucker jedes Mal neu
  const player = mpegts.createPlayer({ type: 'flv', isLive: true, hasAudio: false, url: new URL('api/anycubic/camera?host=' + encodeURIComponent(wbHost()) + '&t=' + Date.now(), location.href).href },
    { enableStashBuffer: false, lazyLoad: false, autoCleanupSourceBuffer: true, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: CAM_MAX_LAG_S, liveBufferLatencyMinRemain: 0.3,
      enableWorker: false });
  player.attachMediaElement($('wbVideo'));
  // Fehlerart, Detail und Meldung von mpegts.js (z. B. NetworkError · HttpStatusCodeInvalid · 502) – danach neu versuchen
  player.on(mpegts.Events.ERROR, (type, detail, info) => {
    $('wbCamNote').textContent = t('Kamera nicht verfügbar ({detail})', { detail: [detail, info && (info.msg || info.code)].filter(Boolean).join(' · ') }); $('wbCamNote').classList.remove('hidden');
    wb.camLast = 0;
  });
  $('wbVideo').onplaying = () => { $('wbCamNote').classList.add('hidden'); wb.camRetries = 0; };
  player.load(); player.play().catch(() => { /* Autoplay: startet nach Klick */ });
  wb.player = player; $('wbCamBtn').textContent = t('Kamera stoppen');
  wb.camFrames = -1; wb.camLast = Date.now();
  wb.camWatch = setInterval(() => {
    const v = $('wbVideo'), f = wbCamFrames(), now = Date.now();
    if (f !== wb.camFrames) { wb.camFrames = f; wb.camLast = now; }
    // Rückstand aufholen: ans Ende des Puffers springen
    if (v.buffered.length) { const end = v.buffered.end(v.buffered.length - 1); if (end - v.currentTime > CAM_MAX_LAG_S) v.currentTime = Math.max(0, end - 0.3); }
    const idle = now - wb.camLast;
    if (idle > 2500 && idle < CAM_STALL_MS) { $('wbCamNote').textContent = t('Kamerabild von vor {s} s – warte auf neue Bilder …', { s: Math.round(idle / 1000) }); $('wbCamNote').classList.remove('hidden'); }
    if (idle >= CAM_STALL_MS && !document.hidden) {
      wb.camRetries = (wb.camRetries || 0) + 1;
      if (wb.camRetries > CAM_RETRY_MAX) { wbCamStop(); $('wbCamBtn').textContent = t('Kamera starten'); $('wbCamNote').textContent = t('Kamera liefert keine Bilder – später erneut starten'); $('wbCamNote').classList.remove('hidden'); return; }
      wbCamStart(true);
    }
  }, 1000);
}
$('wbCamBtn').addEventListener('click', () => { if (wb.player) { wbCamOff(); wb.camUserOff = true; return; } wb.camUserOff = false; wb.camRetries = 0; wbCamStart(false); });
// Fenster/Tab wieder vorn: frisch verbinden (im Hintergrund drosselt der Browser, danach käme ein altes Bild)
document.addEventListener('visibilitychange', () => { if (!document.hidden && wb.camOn && wb.player) { wb.camRetries = 0; wbCamStart(true); } });

if (document.body.dataset.tab === 'printer') wbPoll();
