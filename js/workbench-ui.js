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
  if (!host || !(await lanServerAvailable())) { wbRenderNoLink(host ? 'Der Server kann den LAN-Modus nicht (im Container enthalten; lokal: pip install -r requirements.txt).' : ''); return; }
  try { wb.st = await lanApi('/api/anycubic/status?host=' + encodeURIComponent(host)); wb.err = ''; }
  catch (e) { wb.err = e.message; }
  wbRender();
  wb.timer = setTimeout(wbPoll, WB_POLL_MS);
}

function wbRenderNoLink(why) {
  $('wbNoLink').classList.remove('hidden'); $('wbGrid').classList.add('hidden');
  $('wbNoLinkWhy').textContent = why || 'Am Drucker Einstellungen → Netzwerk → LAN-Modus einschalten, dann hier die IP-Adresse eintragen.';
  $('wbHost').value = wbHost() || '';
}
$('wbConnect').addEventListener('click', async () => {
  const host = $('wbHost').value.trim();
  if (!IP_PATTERN.test(host)) { toast('Bitte eine IP-Adresse wie 192.168.1.50 eintragen'); return; }
  $('wbConnect').disabled = true; $('wbNoLinkWhy').textContent = 'Verbinde mit ' + host + ' …';
  try {
    const live = await fetchLanStatus(host);
    saveLink(WB_PRINTER, host, 'lan');
    slotState = { printer: WB_PRINTER, live, note: '' };
    toast('Verbunden – Verbindung gespeichert');
    wbPoll(); update();
  } catch (e) { $('wbNoLinkWhy').textContent = 'Nicht verbunden: ' + e.message; }
  finally { $('wbConnect').disabled = false; }
});

// Eingabefeld nicht überschreiben, während jemand darin tippt oder schiebt
const wbSet = (el, v) => { if (document.activeElement !== el && !el.dataset.touched) el.value = v; };

function wbRender() {
  const st = wb.st;
  $('wbNoLink').classList.add('hidden'); $('wbGrid').classList.remove('hidden');
  const conn = $('wbConn');
  conn.textContent = wb.err ? 'getrennt' : st && st.connected ? 'verbunden' : 'verbinde …';
  conn.className = 'wb-pill ' + (wb.err ? 'bad' : 'good');
  if (!st) { $('wbJob').innerHTML = '<p class="muted">' + esc(wb.err || 'Lade …') + '</p>'; return; }
  const printing = !!st.printing, job = st.job;

  // Druckauftrag
  $('wbState').textContent = wb.err ? 'nicht erreichbar' : job ? (job.paused ? 'pausiert' : job.status || job.state || 'aktiv') : st.state === 'free' ? 'bereit' : st.state || '?';
  $('wbJob').innerHTML = (wb.err ? '<p class="note bad">' + esc(wb.err) + '</p>' : '') + (job
    ? '<div class="wb-jobname" title="' + esc(job.name) + '">' + esc(job.name || 'Druck') + '</div>' +
      '<div class="wb-progress" role="progressbar" aria-valuenow="' + (job.progress || 0) + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + (job.progress || 0) + '%"></i></div>' +
      '<div class="wb-jobinfo"><span>Fortschritt</span><b>' + (job.progress ?? '–') + ' %</b><span>Schicht</span><b>' + (job.layer ?? '–') + ' / ' + (job.layers ?? '–') + '</b>' +
      '<span>Gedruckt</span><b>' + wbMin(job.elapsed_min) + '</b><span>Verbleibend</span><b>' + wbMin(job.remaining_min) + '</b></div>'
    : '<p class="muted">Kein Druck aktiv.</p>');
  $('wbPause').disabled = !job || job.paused; $('wbResume').disabled = !job || !job.paused; $('wbStop').disabled = !job;
  const badge = $('printerBadge');
  badge.textContent = job ? (job.progress ?? 0) + ' %' : ''; badge.classList.toggle('hidden', !job);

  // Temperaturen, Lüfter, Licht
  const t = st.temps || {};
  $('wbNozCur').textContent = wbDeg(t.curr_nozzle_temp); $('wbNozTgt').textContent = t.target_nozzle_temp ? '→ ' + wbDeg(t.target_nozzle_temp) : 'aus';
  $('wbBedCur').textContent = wbDeg(t.curr_hotbed_temp); $('wbBedTgt').textContent = t.target_hotbed_temp ? '→ ' + wbDeg(t.target_hotbed_temp) : 'aus';
  wbSet($('wbNozIn'), t.target_nozzle_temp || ''); wbSet($('wbBedIn'), t.target_hotbed_temp || '');
  document.querySelectorAll('[data-wb-fan]').forEach(inp => { const v = (st.fans || {})[inp.dataset.wbFan]; if (v != null) wbSet(inp, v); inp.nextElementSibling.textContent = inp.value + ' %'; });
  const light = (st.lights || [])[0];
  $('wbLight').disabled = !light; if (light && document.activeElement !== $('wbLight')) $('wbLight').checked = light.status === 1;
  $('wbSpeed').textContent = st.speed_mode != null ? 'Geschwindigkeit: ' + (WB_SPEED[st.speed_mode] || st.speed_mode) + ' (am Drucker einstellen)' : '';

  // Achsen
  const p = st.position;
  $('wbPos').textContent = p ? 'X ' + de(p.x, 1) + ' · Y ' + de(p.y, 1) + ' · Z ' + de(p.z, 2) + ' mm' : '';
  $('wbAxNote').classList.toggle('hidden', !printing);
  document.querySelectorAll('[data-wb-jog],[data-wb-home],#wbMotorsOff').forEach(b => { b.disabled = printing || !!wb.err; });

  // ACE
  const box = (st.ace || [])[0];
  $('wbAceSlots').innerHTML = box ? box.slots.map(s => '<li><span class="pslot" style="background:' + esc(s.colour || '#dddddd') + '"></span><b>Slot ' + (s.index + 1) + '</b>' +
    '<span>' + (s.present ? esc(s.type) + (s.loaded ? ' <small>· im Drucker</small>' : '') + (s.rfid ? ' <small>· RFID</small>' : '') : '<span class="muted">leer</span>') + '</span>' +
    '<span class="wb-feed">' + (s.present ? '<button type="button" data-wb-feed="' + s.index + ',1"' + (printing ? ' disabled' : '') + ' title="Filament bis zur Düse laden">Laden</button><button type="button" data-wb-feed="' + s.index + ',2"' + (printing ? ' disabled' : '') + ' title="Filament zurückziehen">Zurück</button>' : '') + '</span></li>').join('')
    : '<li class="muted">' + (st.has_ace === 0 ? 'Keine ACE angeschlossen.' : 'Keine ACE-Daten.') + '</li>';
  $('wbAutoFeed').disabled = !box; if (box && document.activeElement !== $('wbAutoFeed')) $('wbAutoFeed').checked = box.auto_feed === 1;
  const dry = box && box.drying || {};
  $('wbAceTemp').textContent = box && box.temp != null ? 'ACE ' + box.temp + ' °C' : '';
  $('wbDry').textContent = dry.status ? 'Trocknen beenden' : 'Starten'; $('wbDry').disabled = !box;
  $('wbDryState').textContent = dry.status ? 'Trocknet bei ' + dry.target_temp + ' °C, noch ' + wbMin(dry.remain_time) : '';

  // Drucker
  const row = (k, v) => v == null || v === '' ? '' : '<dt>' + k + '</dt><dd>' + esc(String(v)) + '</dd>';
  $('wbInfo').innerHTML = row('Modell', st.model) + row('Name', st.name) + row('Firmware', st.firmware) + row('IP', st.ip || wbHost()) +
    row('Zustand', st.state) + row('Kamera', st.camera ? 'vorhanden' : 'keine') + row('ACE', st.has_ace ? 'angeschlossen' : 'nicht erkannt') +
    row('Funktionen', Object.entries(st.features || {}).filter(([, v]) => v).length + ' gemeldet');
  if (!$('wbRawOut').classList.contains('hidden')) $('wbRawOut').textContent = JSON.stringify(st.raw, null, 1);
}

// Befehl senden, Knopf solange sperren, danach sofort neu lesen
async function wbCmd(btn, type, action, data, done) {
  const host = wbHost(); if (!host) return;
  if (btn) btn.disabled = true;
  try {
    const r = await lanCommand(host, type, action, data);
    if (!r.ok) throw Error(r.msg || 'vom Drucker abgelehnt (' + (r.state || r.code) + ')');
    if (done) toast(done);
  } catch (e) { toast('Nicht ausgeführt: ' + e.message); }
  finally { if (btn) btn.disabled = false; document.querySelectorAll('[data-touched]').forEach(el => delete el.dataset.touched); wbPoll(); }
}

$('wbPause').addEventListener('click', e => wbCmd(e.currentTarget, 'print', 'pause', {}, 'Druck pausiert'));
$('wbResume').addEventListener('click', e => wbCmd(e.currentTarget, 'print', 'resume', {}, 'Druck fortgesetzt'));
$('wbStop').addEventListener('click', e => {
  const job = wb.st && wb.st.job;
  if (!confirm('Druck „' + (job && job.name || '') + '“ wirklich abbrechen? Das lässt sich nicht rückgängig machen.')) return;
  wbCmd(e.currentTarget, 'print', 'stop', {}, 'Druck abgebrochen');
});
document.querySelectorAll('[data-wb-temp]').forEach(b => b.addEventListener('click', () => {
  const nozzle = b.dataset.wbTemp === '0', v = Math.round(num((nozzle ? $('wbNozIn') : $('wbBedIn')).value) || 0);
  wbCmd(b, 'tempature', 'set', nozzle ? { type: 0, target_nozzle_temp: v, target_hotbed_temp: 0 } : { type: 1, target_nozzle_temp: 0, target_hotbed_temp: v }, (nozzle ? 'Düse' : 'Bett') + (v ? ' auf ' + v + ' °C' : ' aus'));
}));
['wbNozIn', 'wbBedIn'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') document.querySelector('[data-wb-temp="' + (id === 'wbNozIn' ? 0 : 1) + '"]').click(); }));
document.querySelectorAll('[data-wb-preset]').forEach(b => b.addEventListener('click', () => {
  const [n, bed] = WB_PRESETS[b.dataset.wbPreset];
  wbCmd(b, 'tempature', 'set', { type: 2, target_nozzle_temp: n, target_hotbed_temp: bed }, n ? 'Heize auf ' + n + ' / ' + bed + ' °C' : 'Heizungen aus');
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
document.querySelectorAll('[data-wb-home]').forEach(b => b.addEventListener('click', () => wbCmd(b, 'axis', 'move', { axis: +b.dataset.wbHome, move_type: 2 }, 'Fahre nach Hause')));
$('wbMotorsOff').addEventListener('click', e => wbCmd(e.currentTarget, 'axis', 'turnOff', null, 'Motoren aus – Achsen müssen danach neu referenziert werden'));
$('wbAceSlots').addEventListener('click', e => {
  const b = e.target.closest('[data-wb-feed]'); if (!b) return;
  const [slot, type] = b.dataset.wbFeed.split(',').map(Number), box = wb.st.ace[0];
  wbCmd(b, 'multiColorBox', 'feedFilament', { multi_color_box: [{ id: box.id, feed_status: { slot_index: slot, type } }] }, type === 1 ? 'Lade Slot ' + (slot + 1) : 'Ziehe Slot ' + (slot + 1) + ' zurück');
});
$('wbAutoFeed').addEventListener('change', e => {
  const box = wb.st.ace[0];
  wbCmd(e.currentTarget, 'multiColorBox', 'setAutoFeed', { multi_color_box: [{ id: box.id, auto_feed: e.currentTarget.checked ? 1 : 0 }] });
});
$('wbDry').addEventListener('click', e => {
  const box = wb.st.ace[0], on = !(box.drying && box.drying.status);
  wbCmd(e.currentTarget, 'multiColorBox', 'setDry', { multi_color_box: [{ id: box.id, drying_status: { status: on ? 1 : 0, target_temp: Math.round(num($('wbDryTemp').value)), duration: Math.round(num($('wbDryMin').value)) } }] }, on ? 'Trocknen gestartet' : 'Trocknen beendet');
});
$('wbRaw').addEventListener('click', () => { $('wbRawOut').classList.toggle('hidden'); if (wb.st) $('wbRawOut').textContent = JSON.stringify(wb.st.raw, null, 1); });

/* ---------- Kamera: HTTP-FLV vom Drucker, über den Server (flv.js spielt es im Browser ab) ---------- */
function wbCamOff() {
  if (wb.player) { try { wb.player.destroy(); } catch (e) { /* schon zu */ } wb.player = null; }
  $('wbCamBtn').textContent = 'Kamera starten'; $('wbCamNote').textContent = 'Kamera aus'; $('wbCamNote').classList.remove('hidden');
}
$('wbCamBtn').addEventListener('click', () => {
  if (wb.player) { wbCamOff(); return; }
  if (typeof flvjs === 'undefined' || !flvjs.isSupported()) { $('wbCamNote').textContent = 'Dieser Browser kann das Kamerabild (FLV) nicht abspielen.'; return; }
  $('wbCamNote').textContent = 'Starte Kamera …';
  const player = flvjs.createPlayer({ type: 'flv', isLive: true, hasAudio: false, url: location.origin + '/api/anycubic/camera?host=' + encodeURIComponent(wbHost()) },
    { enableStashBuffer: false, lazyLoad: false, liveBufferLatencyChasing: true });
  player.attachMediaElement($('wbVideo'));
  player.on(flvjs.Events.ERROR, (type, detail) => { $('wbCamNote').textContent = 'Kamera nicht verfügbar (' + detail + ')'; $('wbCamNote').classList.remove('hidden'); });
  $('wbVideo').onplaying = () => $('wbCamNote').classList.add('hidden');
  player.load(); player.play().catch(() => { /* Autoplay: startet nach Klick */ });
  wb.player = player; $('wbCamBtn').textContent = 'Kamera stoppen';
});

if (document.body.dataset.tab === 'printer') wbPoll();
