'use strict';
/* Werkbank, Karte „Heizbett einregeln (PID)“: PID_CALIBRATE für das Bett über Moonraker (api/anycubic/pid, tools/mesh.py).
   Nur mit Rinkhals – sichtbar, sobald die Karte „Nivellierung“ ein Netz von Moonraker hat (mh, js/mesh-ui.js).
   Ergebnis aus der Konsole des Druckers; ob die Firmware die Werte übernommen hat, prüft der Server an printer_mutable.cfg.
   Ablauf wie „Jetzt vermessen“: Rückfrage, nur wenn frei, Stand alle PID_POLL_MS fragen. */

const pid = { host: null, state: null, timer: null, busy: false };
const PID_POLL_MS = 10000;

$('wbPidTarget').value = String([60, 70, 100].includes(store.settings.pidTarget) ? store.settings.pidTarget : 60);
$('wbPidTarget').addEventListener('change', e => { store.settings.pidTarget = Number(e.currentTarget.value); persist(); });
$('wbPidRun').addEventListener('click', async () => {
  const host = wbHost(), target = Number($('wbPidTarget').value);
  if (!host || mh.printing) return;
  if (!confirm(t('PID-Abgleich des Heizbetts starten (Ziel {target} °C)? Das Bett heizt mehrmals auf und kühlt etwas ab – etwa 10–20 Minuten, nicht anfassen. Abbrechen geht nur am Display (Not-Aus).', { target }))) return;
  pid.busy = true; pidRender();
  try {
    await lanApi('api/anycubic/pid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, target }) });
    pid.state = { started: Date.now() / 1000, target, done: null, error: null };
    pidPoll();
  } catch (e) {
    pid.state = { done: Date.now() / 1000, error: e.message };
  }
  pid.busy = false; pidRender();
});

// von meshRunState: Karte zeigen, sobald Moonraker da ist; je Drucker einmal den Stand holen (Seite neu geladen?)
function pidSync() {
  const host = wbHost(), on = !!(host && mh.data && mh.kind !== 'unsupported');
  $('wbPidCard').classList.toggle('hidden', !on);
  if (on && pid.host !== host) { pid.host = host; pid.state = null; pidPoll(true); }
  pidRender();
}

async function pidPoll(once) {
  clearTimeout(pid.timer); pid.timer = null;
  const host = wbHost();
  if (!host) return;
  try {
    const c = (await lanApi('api/anycubic/pid?host=' + encodeURIComponent(host))).state;
    if (c) pid.state = c;
    if (c && !c.done) pid.timer = setTimeout(pidPoll, PID_POLL_MS);
  } catch (e) {
    if (!once) pid.timer = setTimeout(pidPoll, PID_POLL_MS);
  }
  pidRender();
}

const pidNum = v => v == null ? '–' : de(v, 3);
function pidRender() {
  const c = pid.state, running = !!(c && !c.done), note = $('wbPidNote');
  $('wbPidRun').disabled = pid.busy || running || !!mh.printing || !wbHost();
  $('wbPidTarget').disabled = running;
  note.textContent = running ? t('PID-Abgleich läuft ({target} °C) seit {min} min …', { target: c.target, min: Math.max(0, Math.floor((Date.now() / 1000 - c.started) / 60)) })
    : c && c.error ? t('PID-Abgleich fehlgeschlagen: {msg}', { msg: t(c.error) })
    : c && c.done ? t('PID-Abgleich fertig ({time}).', { time: new Date(c.done * 1000).toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' }) })
    : mh.printing ? t('Geht nur, wenn der Drucker frei ist.') : '';
  const res = $('wbPidResult'), saved = $('wbPidSaved'), show = !!(c && c.done && c.new);
  res.classList.toggle('hidden', !show); saved.classList.toggle('hidden', !show);
  $('wbPidSum').textContent = show ? t('neu: Kp {kp} · Ki {ki} · Kd {kd}', { kp: pidNum(c.new.kp), ki: pidNum(c.new.ki), kd: pidNum(c.new.kd) }) : '';
  if (!show) return;
  res.innerHTML = '<dt></dt><dd>' + esc(t('vorher')) + '</dd><dd>' + esc(t('neu')) + '</dd>' + [['Kp', 'kp'], ['Ki', 'ki'], ['Kd', 'kd']].map(([k, f]) =>
    '<dt>' + k + '</dt><dd>' + esc(pidNum(c.old && c.old[f])) + '</dd><dd class="new">' + esc(pidNum(c.new[f])) + '</dd>').join('');
  saved.className = 'small ' + (c.saved ? 'ok' : 'warn');
  saved.textContent = c.saved ? t('Die Firmware hat die neuen Werte gespeichert – sie gelten ab jetzt.')
    : t('Die Firmware hat die neuen Werte nicht von selbst übernommen. Klipper übernimmt sie erst mit SAVE_CONFIG, das die Firmware neu startet – das macht die Druckwerkstatt nicht von selbst.');
}
