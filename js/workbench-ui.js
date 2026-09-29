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
const wb = { timer: 0, st: null, err: '', player: null };
const wbHost = () => printerHost(WB_PRINTER);
const wbMin = m => m == null ? '–' : m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min';
const wbDeg = v => v == null ? '–' : Math.round(v) + ' °C';

function onWorkbenchTab(active) {
  if (active) wbPoll();
  else { clearTimeout(wb.timer); wbCamOff(); }
}

async function wbPoll() {
  clearTimeout(wb.timer);
  if (document.body.dataset.tab !== 'printer') return;
  const host = wbHost();
  if (!host || !(await lanServerAvailable())) { wbRenderNoLink(host ? t('Der Server kann den LAN-Modus nicht (im Container enthalten; lokal: pip install -r requirements.txt).') : ''); return; }
  try { wb.st = await lanApi('/api/anycubic/status?host=' + encodeURIComponent(host)); wb.err = ''; }
  catch (e) { wb.err = t(e.message); }
  wbRender();
  if (!wb.err && typeof onQueueStatus === 'function') onQueueStatus(wb.st);   // Warteschlange (js/queue-ui.js)
  wb.timer = setTimeout(wbPoll, WB_POLL_MS);
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
  $('wbMeta').textContent = [st.name && st.model && st.name !== st.model ? st.model : '', st.firmware ? 'Firmware ' + st.firmware : '', st.ip || wbHost()].filter(Boolean).join(' · ');
  const state = $('wbState');
  state.textContent = wb.err ? t('nicht erreichbar') : job ? (job.paused ? t('pausiert') : t(job.status || job.state || 'aktiv')) : st.state === 'free' ? t('bereit') : st.state || '?';
  state.className = 'wb-pill' + (job && !job.paused ? ' live' : '');
  const light = (st.lights || [])[0];
  $('wbLight').disabled = !light; if (light && document.activeElement !== $('wbLight')) $('wbLight').checked = light.status === 1;
  if (!$('wbRawOut').classList.contains('hidden')) $('wbRawOut').textContent = JSON.stringify(st.raw, null, 1);

  // Druckauftrag
  if (job) {
    const jt = wbJobTitle(job.name), pct = job.progress ?? 0;
    $('wbJob').innerHTML = (wb.err ? '<p class="note bad">' + esc(wb.err) + '</p>' : '') +
      '<div class="wb-jobtitle" title="' + esc(job.name) + '">' + esc(jt.title) + '</div>' + (jt.sub ? '<div class="wb-jobsub">' + esc(jt.sub) + '</div>' : '') +
      '<div class="wb-bigpct"><b>' + pct + ' %</b><span>' + (job.paused ? t('pausiert') : esc(t(job.status || ''))) + '</span></div>' +
      '<div class="wb-progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div>' +
      '<dl class="wb-jobinfo"><div><dt>' + t('Schicht') + '</dt><dd>' + (job.layer ?? '–') + ' / ' + (job.layers ?? '–') + '</dd></div>' +
      '<div><dt>' + t('Fertig um') + '</dt><dd>' + (job.remaining_min != null && !job.paused ? wbClock(job.remaining_min) : '–') + '</dd></div>' +
      '<div><dt>' + t('Verbleibend') + '</dt><dd>' + wbMin(job.remaining_min) + '</dd></div><div><dt>' + t('Gedruckt') + '</dt><dd>' + wbMin(job.elapsed_min) + '</dd></div>' +
      (job.filament_mm ? '<div><dt>' + t('Filament bisher') + '</dt><dd>' + de(job.filament_mm / 1000, 1) + ' m</dd></div>' : '') + '</dl>';
  } else $('wbJob').innerHTML = (wb.err ? '<p class="note bad">' + esc(wb.err) + '</p>' : '') + '<p class="wb-idle">' + t('Kein Druck aktiv. Drucken lässt sich aus dem Schritt <b>③ Slicen &amp; Kosten</b>.') + '</p>';
  $('wbPause').disabled = !job || job.paused; $('wbResume').disabled = !job || !job.paused; $('wbStop').disabled = !job;
  $('wbPause').classList.toggle('hidden', !job || job.paused); $('wbResume').classList.toggle('hidden', !(job && job.paused)); $('wbStop').classList.toggle('hidden', !job);
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

  // ACE: Kacheln in Filamentfarbe
  const box = (st.ace || [])[0];
  $('wbAceSlots').innerHTML = box ? box.slots.map(s => '<li class="' + (s.loaded ? 'loaded' : '') + (s.present ? '' : ' empty') + '">' +
      '<div class="wb-swatch" style="' + (s.present ? 'background:' + esc(s.colour || '#dddddd') : '') + '"><span>' + (s.index + 1) + '</span></div>' +
      '<div class="wb-slotinfo"><b>' + (s.present ? esc(s.type) : t('leer')) + '</b><small>' + (s.present ? (s.loaded ? t('im Drucker') : s.rfid ? 'RFID' : t('von Hand')) : '–') + '</small>' +
        (s.present && typeof spoolTileHTML === 'function' ? spoolTileHTML(s.index) : '') + '</div>' +
      (s.present ? '<div class="wb-feed"><button type="button" data-wb-feed="' + s.index + ',1"' + (printing ? ' disabled' : '') + ' title="' + t('Filament bis zur Düse laden') + '">' + t('Laden') + '</button><button type="button" data-wb-feed="' + s.index + ',2"' + (printing ? ' disabled' : '') + ' title="' + t('Filament zurückziehen') + '">' + t('Zurück') + '</button></div>' : '') + '</li>').join('')
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
$('wbAceSlots').addEventListener('click', e => {
  const b = e.target.closest('[data-wb-feed]'); if (!b) return;
  const [slot, type] = b.dataset.wbFeed.split(',').map(Number), box = wb.st.ace[0];
  wbCmd(b, 'multiColorBox', 'feedFilament', { multi_color_box: [{ id: box.id, feed_status: { slot_index: slot, type } }] }, type === 1 ? t('Lade Slot {n}', { n: slot + 1 }) : t('Ziehe Slot {n} zurück', { n: slot + 1 }));
});
$('wbAutoFeed').addEventListener('change', e => {
  const box = wb.st.ace[0];
  wbCmd(e.currentTarget, 'multiColorBox', 'setAutoFeed', { multi_color_box: [{ id: box.id, auto_feed: e.currentTarget.checked ? 1 : 0 }] });
});
$('wbDry').addEventListener('click', e => {
  const box = wb.st.ace[0], on = !(box.drying && box.drying.status);
  wbCmd(e.currentTarget, 'multiColorBox', 'setDry', { multi_color_box: [{ id: box.id, drying_status: { status: on ? 1 : 0, target_temp: Math.round(num($('wbDryTemp').value)), duration: Math.round(num($('wbDryMin').value)) } }] }, on ? t('Trocknen gestartet') : t('Trocknen beendet'));
});
$('wbRaw').addEventListener('click', () => { $('wbRawOut').classList.toggle('hidden'); if (wb.st) $('wbRawOut').textContent = JSON.stringify(wb.st.raw, null, 1); });

/* ---------- Kamera: HTTP-FLV vom Drucker, über den Server (flv.js spielt es im Browser ab) ---------- */
function wbCamOff() {
  if (wb.player) { try { wb.player.destroy(); } catch (e) { /* schon zu */ } wb.player = null; }
  $('wbCamBtn').textContent = t('Kamera starten'); $('wbCamNote').textContent = t('Kamera aus'); $('wbCamNote').classList.remove('hidden');
  $('wbVideo').removeAttribute('src'); $('wbVideo').load();
}
$('wbCamBtn').addEventListener('click', () => {
  if (wb.player) { wbCamOff(); return; }
  if (typeof flvjs === 'undefined' || !flvjs.isSupported()) { $('wbCamNote').textContent = t('Dieser Browser kann das Kamerabild (FLV) nicht abspielen.'); return; }
  $('wbCamNote').textContent = t('Starte Kamera …');
  const player = flvjs.createPlayer({ type: 'flv', isLive: true, hasAudio: false, url: location.origin + '/api/anycubic/camera?host=' + encodeURIComponent(wbHost()) },
    { enableStashBuffer: false, lazyLoad: false, liveBufferLatencyChasing: true });
  player.attachMediaElement($('wbVideo'));
  player.on(flvjs.Events.ERROR, (type, detail) => { $('wbCamNote').textContent = t('Kamera nicht verfügbar ({detail})', { detail }); $('wbCamNote').classList.remove('hidden'); });
  $('wbVideo').onplaying = () => $('wbCamNote').classList.add('hidden');
  player.load(); player.play().catch(() => { /* Autoplay: startet nach Klick */ });
  wb.player = player; $('wbCamBtn').textContent = t('Kamera stoppen');
});

if (document.body.dataset.tab === 'printer') wbPoll();
