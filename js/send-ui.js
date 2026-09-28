'use strict';
/* An Drucker senden und drucken: G-Code einer geslicten Platte (letzte Kostenberechnung, /api/slice) über den
   Server auf den Kobra S1 laden und starten (/api/anycubic/print, tools/anycubic_lan.py print_gcode).
   Vorher zeigt der Dialog den Zustand des Druckers und die Zuordnung Werkzeug → ACE-Slot mit Warnung, wenn
   Material oder Farbe nicht zum Slot passen. Der Server prüft noch einmal: Drucker frei, G-Code für dieses Modell. */

const SEND_PRINTER = 'kobra_s1';
let sendInfo = null; // Stand des Druckers beim Öffnen

async function openSendDialog(plate) {
  const s = costState && costState.slice;
  if (!s || !s.job) { toast('Zuerst „Kosten berechnen“ – dabei wird geslict'); return; }
  const host = printerHost(SEND_PRINTER);
  if (!host) { toast('Erst unter ⚙ Einstellungen → Drucker-Verbindung den Drucker einrichten'); return; }
  $('sendPlate').innerHTML = s.plates.map(p => '<option value="' + p.plate + '">Platte ' + p.plate + ' · ' + duration(p.time_s) + ' · ' + de(p.total_g, 1) + ' g</option>').join('');
  if (plate) $('sendPlate').value = String(plate);
  $('sendSub').textContent = (project ? project.name : '') + ' → ' + host;
  $('sendState').textContent = 'Frage den Drucker ab …'; $('sendState').className = 'note';
  $('sendMap').innerHTML = ''; $('sendGo').disabled = true;
  $('sendDlg').showModal();
  try { sendInfo = await lanApi('/api/anycubic/status?host=' + encodeURIComponent(host)); }
  catch (e) { sendInfo = null; $('sendState').textContent = 'Drucker nicht erreichbar: ' + e.message; $('sendState').className = 'note bad'; return; }
  renderSendDialog();
}

function renderSendDialog() {
  const s = costState.slice, plate = +$('sendPlate').value, p = s.plates.find(x => x.plate === plate), st = sendInfo;
  const free = st && !st.printing && (st.state === 'free' || !st.state);
  $('sendState').textContent = !st ? '' : free ? 'Drucker bereit (' + (st.model || 'Kobra S1') + ', Firmware ' + (st.firmware || '?') + ').'
    : 'Drucker ist nicht frei (' + (st.job ? 'druckt „' + st.job.name + '“' : st.state) + ') – erst den laufenden Vorgang beenden.';
  $('sendState').className = 'note' + (free ? '' : ' bad');
  const slots = (st && st.ace && st.ace[0] && st.ace[0].slots) || [];
  let warn = 0;
  const rows = (p ? p.grams : []).map((g, t) => {
    if (!(g > 0)) return '';
    const mat = costState.materials && costState.materials[t], ace = slots[t];
    const want = mat ? (ORCA_KIND[mat.kind] || mat.name) : '', have = ace && ace.present ? ace.type : '';
    const bad = !have || (mat && !slotMatchesKind(have, mat.kind));
    if (bad) warn++;
    const sw = c => '<span class="pslot" style="display:inline-block;width:11px;height:11px;border-radius:2px;border:1px solid rgba(0,0,0,.35);vertical-align:middle;background:' + esc(c || '#dddddd') + '"></span> ';
    return '<tr><td>T' + t + '</td><td>' + esc(want || '?') + '<small>' + de(g, 1) + ' g</small></td><td' + (bad ? ' class="warn"' : '') + '>Slot ' + (t + 1) + ': ' +
      (have ? sw(ace.colour) + esc(have) : 'leer') + (bad ? '<small>' + (have ? 'anderes Material als im G-Code' : 'kein Filament im Slot') + '</small>' : '') + '</td></tr>';
  }).join('');
  $('sendMap').innerHTML = '<table class="changes"><thead><tr><th>Werkzeug</th><th>G-Code</th><th>ACE</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    (warn ? '<p class="note bad">' + warn + ' Slot(s) passen nicht zum G-Code. Temperaturen im G-Code gelten für das geslicte Material – erst Filament tauschen oder neu slicen.</p>' : '');
  $('sendGo').disabled = !free;
  $('sendGo').textContent = warn ? 'Trotzdem drucken' : 'Jetzt drucken';
}

$('sendPlate').addEventListener('change', renderSendDialog);
$('sendGo').addEventListener('click', async () => {
  const plate = +$('sendPlate').value, host = printerHost(SEND_PRINTER), btn = $('sendGo');
  btn.disabled = true; btn.textContent = 'Lade hoch …';
  try {
    const r = await lanApi('/api/anycubic/print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      host, job: costState.slice.job, plate, name: project ? project.name.replace(/\.(stl|3mf|zip)$/i, '') : 'druck',
      options: { auto_leveling: $('sendLevel').checked ? 1 : 0, flow_calibration: $('sendFlow').checked ? 1 : 0, timelapse: $('sendLapse').checked ? 1 : 0 } }) });
    $('sendDlg').close();
    toast(r.job ? 'Druck gestartet: ' + r.job.name : (r.note || 'Gesendet'));
    setTab('printer');
  } catch (e) {
    $('sendState').textContent = 'Nicht gestartet: ' + e.message; $('sendState').className = 'note bad';
    btn.disabled = false; btn.textContent = 'Erneut versuchen';
  }
});
$('sendOpen').addEventListener('click', () => openSendDialog());
$('pvSend').addEventListener('click', () => openSendDialog(+$('pvPlate').value));
$('sendDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
