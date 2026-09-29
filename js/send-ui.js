'use strict';
/* An Drucker senden und drucken: G-Code einer geslicten Platte (letzte Kostenberechnung, /api/slice) über den
   Server auf den Kobra S1 laden und starten (/api/anycubic/print, tools/anycubic_lan.py print_gcode).
   Vorher zeigt der Dialog den Zustand des Druckers und die Zuordnung Werkzeug → ACE-Slot mit Warnung, wenn
   Material oder Farbe nicht zum Slot passen. Der Server prüft noch einmal: Drucker frei, G-Code für dieses Modell. */

const SEND_PRINTER = 'kobra_s1';
let sendInfo = null; // Stand des Druckers beim Öffnen
// Was gedruckt wird: letzter Slice-Stand oder der einer Warteschlange (js/queue-ui.js) mit Rückmeldung beim Start
let sendCtx = { slice: null, materials: null, name: '', onStarted: null };

async function openSendDialog(plate, opts) {
  const o = opts || {};
  sendCtx = { slice: o.slice || (costState && costState.slice), materials: o.materials || costState.materials, name: o.name || (project ? project.name : ''), onStarted: o.onStarted || null };
  const s = sendCtx.slice;
  if (!s || !s.job) { toast(t('Zuerst „Kosten berechnen“ – dabei wird geslict')); return; }
  const host = printerHost(SEND_PRINTER);
  if (!host) { toast(t('Erst unter ⚙ Einstellungen → Drucker-Verbindung den Drucker einrichten')); return; }
  $('sendPlate').innerHTML = s.plates.map(p => '<option value="' + p.plate + '">' + t('Platte {n}', { n: p.plate }) + ' · ' + duration(p.time_s) + ' · ' + de(p.total_g, 1) + ' g</option>').join('');
  if (plate) $('sendPlate').value = String(plate);
  $('sendPlate').disabled = !!o.onStarted;   // aus der Warteschlange: genau diese Platte
  $('sendSub').textContent = sendCtx.name + ' → ' + host;
  $('sendState').textContent = t('Frage den Drucker ab …'); $('sendState').className = 'note';
  $('sendMap').innerHTML = ''; $('sendGo').disabled = true;
  $('sendDlg').showModal();
  try { sendInfo = await lanApi('api/anycubic/status?host=' + encodeURIComponent(host)); }
  catch (e) { sendInfo = null; $('sendState').textContent = t('Drucker nicht erreichbar: {msg}', { msg: t(e.message) }); $('sendState').className = 'note bad'; return; }
  renderSendDialog();
}

function renderSendDialog() {
  const s = sendCtx.slice, plate = +$('sendPlate').value, p = s.plates.find(x => x.plate === plate), st = sendInfo;
  const free = st && !st.printing && (st.state === 'free' || !st.state);
  $('sendState').textContent = !st ? '' : free ? t('Drucker bereit ({model}, Firmware {fw}).', { model: st.model || 'Kobra S1', fw: st.firmware || '?' })
    : t('Drucker ist nicht frei ({what}) – erst den laufenden Vorgang beenden.', { what: st.job ? t('druckt „{name}“', { name: st.job.name }) : t(st.state) });
  $('sendState').className = 'note' + (free ? '' : ' bad');
  const slots = (st && st.ace && st.ace[0] && st.ace[0].slots) || [];
  let warn = 0;
  const rows = (p ? p.grams : []).map((g, tool) => {
    if (!(g > 0)) return '';
    const mat = sendCtx.materials && sendCtx.materials[tool], ace = slots[tool];
    const want = mat ? (ORCA_KIND[mat.kind] || mat.name) : '', have = ace && ace.present ? ace.type : '';
    const bad = !have || (mat && !slotMatchesKind(have, mat.kind));
    if (bad) warn++;
    const sw = c => '<span class="pslot" style="display:inline-block;width:11px;height:11px;border-radius:2px;border:1px solid rgba(0,0,0,.35);vertical-align:middle;background:' + esc(c || '#dddddd') + '"></span> ';
    return '<tr><td>T' + tool + '</td><td>' + esc(want || '?') + '<small>' + de(g, 1) + ' g</small></td><td' + (bad ? ' class="warn"' : '') + '>Slot ' + (tool + 1) + ': ' +
      (have ? sw(ace.colour) + esc(have) : t('leer')) + (bad ? '<small>' + (have ? t('anderes Material als im G-Code') : t('kein Filament im Slot')) + '</small>' : '') + '</td></tr>';
  }).join('');
  $('sendMap').innerHTML = '<table class="changes"><thead><tr><th>' + t('Werkzeug') + '</th><th>G-Code</th><th>ACE</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    (p && typeof spoolShortage === 'function' && spoolShortage(p.grams).length ? '<p class="note bad">' + esc(t('Zu wenig Filament:') + ' ' + spoolShortageText(spoolShortage(p.grams))) + '</p>' : '') +
    (warn ? '<p class="note bad">' + t('{n} Slot(s) passen nicht zum G-Code. Temperaturen im G-Code gelten für das geslicte Material – erst Filament tauschen oder neu slicen.', { n: warn }) + '</p>' : '');
  $('sendGo').disabled = !free;
  $('sendGo').textContent = warn ? t('Trotzdem drucken') : t('Jetzt drucken');
}

$('sendPlate').addEventListener('change', renderSendDialog);
$('sendGo').addEventListener('click', async () => {
  const plate = +$('sendPlate').value, host = printerHost(SEND_PRINTER), btn = $('sendGo');
  btn.disabled = true; btn.textContent = t('Lade hoch …');
  try {
    const r = await lanApi('api/anycubic/print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      host, job: sendCtx.slice.job, plate, name: sendCtx.name ? sendCtx.name.replace(/\.(stl|3mf|zip)$/i, '') : 'druck',
      options: { auto_leveling: $('sendLevel').checked ? 1 : 0, flow_calibration: $('sendFlow').checked ? 1 : 0, timelapse: $('sendLapse').checked ? 1 : 0 } }) });
    $('sendDlg').close();
    if (sendCtx.onStarted) sendCtx.onStarted(plate);
    toast(r.job ? t('Druck gestartet: {name}', { name: r.job.name }) : (r.note ? t(r.note) : t('Gesendet')));
    setTab('printer');
  } catch (e) {
    $('sendState').textContent = t('Nicht gestartet: {msg}', { msg: t(e.message) }); $('sendState').className = 'note bad';
    btn.disabled = false; btn.textContent = t('Erneut versuchen');
  }
});
$('sendOpen').addEventListener('click', () => openSendDialog());
$('pvSend').addEventListener('click', () => openSendDialog(+$('pvPlate').value));
$('sendDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
