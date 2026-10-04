'use strict';
/* Druck zeitlich planen (Sendedialog → „Später starten“) und Anzeige in der Werkbank. Ausgeführt wird der Plan vom
   Server (tools/schedule.py), auch ohne offene Seite: zur Zeit Trocknen anstoßen (endet zum Druckstart), dann – nach
   erneuter Prüfung: Drucker frei, Filament passt – den Druck starten. Ein Plan zur Zeit. */
const sched = { v: null, at: 0 };
// Trocknen: Vorgabe je Filamentart (°C) – Stunden 4; die ACE trocknet als Ganzes
const DRY_DEFAULT_C = { pla: 45, tpu: 45, petg: 55, abs: 60, asa: 60 };

const pad2 = n => String(n).padStart(2, '0');
const localInput = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
const schedWhen = ts => { const d = new Date(ts * 1000), today = new Date().toDateString() === d.toDateString();
  return (today ? '' : d.toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'numeric' }) + ' ') + d.toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' }); };

async function schedLoad() {
  try { sched.v = await lanApi('api/schedule'); sched.at = Date.now(); } catch (e) { /* ohne Server: kein Plan */ }
  schedRender();
  if (typeof wb !== 'undefined' && wb.st && !wb.st.job && typeof wbRender === 'function') wbRender();   // Druckauftrag: „heizt vor …“
  return sched.v;
}
const schedBusy = () => !!(sched.v && sched.v.plan && ['wait', 'drying', 'heating'].includes(sched.v.plan.state));

// ---------- Sendedialog ----------
function sendLaterReset() {
  const d = new Date(Date.now() + 3600e3); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  $('sendLater').checked = false; $('sendAt').value = localInput(d); $('sendDry').checked = false; $('sendBedOk').checked = false;
  // materials: Objekt Slot → Filament (letzte Kostenberechnung bzw. Warteschlange), keine Liste
  const kinds = Object.values(sendCtx.materials || {}).filter(Boolean).map(m => m.kind);
  $('sendDryTemp').value = String(Math.max(...kinds.map(k => DRY_DEFAULT_C[k] || 45), 45)); $('sendDryH').value = '4';
  $('sendLaterBox').classList.toggle('hidden', !!sendCtx.onStarted);   // aus der Warteschlange: nicht planbar
  // Vorwärmen: Bett wie in den Druckwerten (mit Anpassung), 10 min
  const bed = lastResult && lastResult.m ? +lastResult.m.bed : 0;
  // Kobra-S1-Vorgabe (js/engine.js preheatMin): ABS/ASA 10 min vorwärmen – schon angehakt
  const pre = lastResult && lastResult.preheatMin > 0 && !sendCtx.onStarted ? lastResult.preheatMin : 0;
  $('sendHeat').checked = pre > 0; $('sendHeatBed').value = String(Math.min(110, Math.max(40, bed || 100))); $('sendHeatMin').value = String(pre || 10);
  $('sendHeat').closest('label').classList.toggle('hidden', !!sendCtx.onStarted); $('sendHeatRow').classList.toggle('hidden', !pre);
  schedLoad().then(() => typeof renderSendDialog === 'function' && $('sendDlg').open && renderSendDialog());
}
// Zustand für den Knopf: null = jetzt drucken; sonst {ok, why, req}
function sendLaterState(p) {
  const heat = $('sendHeat').checked ? { bed: Math.round(num($('sendHeatBed').value)), minutes: Math.round(num($('sendHeatMin').value)) } : null;
  if (!$('sendLater').checked && !heat) return null;
  const now = Date.now() / 1000, later = $('sendLater').checked;
  // jetzt mit Vorwärmen: Start = jetzt + Dauer (der Server heizt sofort und startet danach)
  const at = later ? new Date($('sendAt').value).getTime() / 1000 : now + (heat ? heat.minutes * 60 : 0) + 20;
  const dry = $('sendDry').checked ? { temp: Math.round(num($('sendDryTemp').value)), minutes: Math.round(num($('sendDryH').value) * 60) } : null;
  let why = '';
  if (heat && !(heat.bed >= 40 && heat.bed <= 110 && heat.minutes >= 1 && heat.minutes <= 60)) why = t('Vorwärmen: 40–110 °C, 1–60 min.');
  else if (!later && !(sendInfo && !sendInfo.printing && (sendInfo.state === 'free' || !sendInfo.state))) why = t('Drucker ist nicht frei – zum Vorwärmen muss er frei sein.');
  else if (heat && later && at - heat.minutes * 60 < now - 60) why = t('Zum Vorwärmen ist bis zum Start zu wenig Zeit.');
  else if (schedBusy()) why = t('Es ist schon ein Druck geplant – erst in der Werkbank absagen.');
  else if (!(at > now + 60)) why = t('Startzeit liegt nicht in der Zukunft.');
  else if (dry && !(dry.temp >= 35 && dry.temp <= 70 && dry.minutes >= 30 && dry.minutes <= 1440)) why = t('Trocknen: 35–70 °C, 0,5–24 h.');
  else if (dry && at - dry.minutes * 60 < now - 60) why = t('Zum Trocknen ist bis zum Start zu wenig Zeit.');
  else if (later && !$('sendBedOk').checked) why = t('Bitte bestätigen: Bett frei, richtige Druckplatte liegt – gestartet wird ohne dich.');
  const wants = (p ? p.grams : []).map((g, tool) => g > 0 && sendCtx.materials && sendCtx.materials[tool] && ORCA_KIND[sendCtx.materials[tool].kind]
    ? { tool, type: ORCA_KIND[sendCtx.materials[tool].kind] } : null).filter(Boolean);
  const run = p ? p.time_s + (typeof prepS === 'function' ? prepS() : 0) : 0;
  const heatTxt = heat ? (later ? t('Vorwärmen ab {d}, ', { d: schedWhen(at - heat.minutes * 60) }) : t('Bett jetzt auf {c} °C, nach {m} min Druckstart. ', { c: heat.bed, m: heat.minutes })) : '';
  $('sendHeatInfo').textContent = later ? '' : heatTxt;
  if (later) $('sendLaterInfo').textContent = at > now ? heatTxt + (dry ? t('Trocknen ab {d}, ', { d: schedWhen(at - dry.minutes * 60) }) : '') +
    t('Start {s}, fertig ≈ {e}.', { s: schedWhen(at), e: schedWhen(at + run) }) + ' ' + t('Vor dem Start prüft der Server: Drucker frei, Filament passt – sonst startet er nicht.') : '';
  return { ok: !why, why, now: !later, req: { action: 'create', job: sendCtx.slice.job, plate: p ? p.plate : 1, start_at: Math.round(at),
    bed_clear: later ? $('sendBedOk').checked : true, wants, dry: later ? dry : null, preheat: heat,
    name: sendCtx.name ? sendCtx.name.replace(/\.(stl|3mf|zip)$/i, '') : 'druck',
    options: { auto_leveling: $('sendLevel').checked ? 1 : 0, flow_calibration: $('sendFlow').checked ? 1 : 0, timelapse: $('sendLapse').checked ? 1 : 0 } } };
}
async function sendSchedule(state) {
  const btn = $('sendGo'); btn.disabled = true; btn.textContent = t('Plane …');
  try {
    sched.v = await lanApi('api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.req) });
    $('sendDlg').close(); setTab('printer'); schedRender();
    toast(state.now ? t('Bett heizt vor – Druckstart um {s}', { s: schedWhen(state.req.start_at) }) : t('Druck geplant: Start {s}', { s: schedWhen(state.req.start_at) }));
  } catch (e) {
    $('sendState').textContent = t('Nicht geplant: {msg}', { msg: t(e.message) }); $('sendState').className = 'note bad';
    btn.disabled = false; btn.textContent = t('Planen');
  }
}
['sendLater', 'sendAt', 'sendDry', 'sendDryTemp', 'sendDryH', 'sendBedOk', 'sendHeat', 'sendHeatBed', 'sendHeatMin'].forEach(id => $(id).addEventListener('input', () => {
  $('sendLaterRows').classList.toggle('hidden', !$('sendLater').checked); $('sendDryRow').classList.toggle('hidden', !$('sendDry').checked);
  $('sendHeatRow').classList.toggle('hidden', !$('sendHeat').checked);
  // Trocknen gewählt, aber Start zu früh: auf den frühesten möglichen Start schieben (Viertelstunde)
  if ((id === 'sendDry' || id === 'sendDryH') && $('sendDry').checked) {
    const min = num($('sendDryH').value) * 3600e3, at = new Date($('sendAt').value).getTime();
    if (min > 0 && !(at - min > Date.now() + 60e3)) { const d = new Date(Date.now() + min + 5 * 60e3); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); $('sendAt').value = localInput(d); }
  }
  if (id === 'sendLater' && $('sendLater').checked) $('sendLaterBox').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (typeof renderSendDialog === 'function') renderSendDialog();
}));

// ---------- Werkbank ----------
function schedRender() {
  const card = $('schedCard'), p = sched.v && sched.v.plan;
  if (!card) return;
  card.classList.toggle('hidden', !p);
  if (!p) return;
  const active = ['wait', 'drying', 'heating'].includes(p.state), now = Date.now() / 1000;
  const label = { wait: t('geplant'), drying: t('trocknet'), heating: t('heizt vor'), started: t('gestartet'), failed: t('nicht gestartet'), cancelled: t('abgesagt') }[p.state] || p.state;
  $('schedSum').textContent = label + ' · ' + t('Start {s}', { s: schedWhen(p.start_at) }) +
    (active && p.start_at > now ? ' (' + t('in {t}', { t: duration(p.start_at - now) }) + ')' : '') +
    (p.preheat ? ' · ' + t('vorwärmen {c} °C, {m} min', { c: p.preheat.bed, m: p.preheat.minutes }) : '') +
    ' · ' + p.name + ' · ' + t('Platte {n}', { n: p.plate }) +
    (p.dry ? ' · ' + t('trocknen {c} °C, {h} h', { c: p.dry.temp, h: de(p.dry.minutes / 60, p.dry.minutes % 60 ? 1 : 0) }) + (active && !p.dry.sent ? ' ' + t('ab {d}', { d: schedWhen(p.dry.start_at) }) : '') : '');
  $('schedCancel').classList.toggle('hidden', !active); $('schedDismiss').classList.toggle('hidden', active);
  $('schedNote').textContent = p.note || ''; $('schedNote').classList.toggle('hidden', !p.note);
  $('schedNote').className = 'note small' + (p.state === 'failed' ? ' bad' : '') + (p.note ? '' : ' hidden');
}
async function schedAction(action) {
  try { sched.v = await lanApi('api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }); }
  catch (e) { toast(t(e.message)); }
  schedRender();
}
$('schedCancel').addEventListener('click', () => { if (confirm(t('Geplanten Druck absagen? Läuft das Trocknen schon, wird es beendet.'))) schedAction('cancel'); });
$('schedDismiss').addEventListener('click', () => schedAction('dismiss'));
// mit der Werkbank abfragen (höchstens alle 10 s)
function schedPoll() { if (Date.now() - sched.at > 10000) schedLoad(); else schedRender(); }
