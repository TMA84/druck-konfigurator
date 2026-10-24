'use strict';
/* An Drucker senden und drucken: G-Code einer geslicten Platte (letzte Kostenberechnung, /api/slice) über den
   Server auf den Kobra S1 laden und starten (/api/anycubic/print, tools/anycubic_lan.py print_gcode).
   Vorher zeigt der Dialog den Zustand des Druckers und die Zuordnung Werkzeug → ACE-Slot mit Warnung, wenn
   Material oder Farbe nicht zum Slot passen. Der Server prüft noch einmal: Drucker frei, G-Code für dieses Modell. */

const SEND_PRINTER = 'kobra_s1';
let sendInfo = null; // Stand des Druckers beim Öffnen
let sendFootStd = '';
/* Senden läuft (Hochladen/Planen): Dialog bleibt offen (Esc gesperrt), „Jetzt drucken“ gesperrt – auch nach erneutem
   Öffnen, sonst ginge derselbe Druck zweimal raus. sendReq: nur die Antwort der letzten Abfrage zählt (Erneut abfragen,
   neu geöffnet), eine ältere darf kein „Drucker bereit“ mehr anzeigen. */
let sendBusy = false, sendReq = 0, sendRun = 0;
// Was gedruckt wird: letzter Slice-Stand oder der einer Warteschlange (js/queue-ui.js) mit Rückmeldung beim Start
// own: fertiger G-Code („G-Code drucken …“, js/gcode-ui.js) – Werkzeug → Slot frei wählbar (map), Material aus dem G-Code,
// bed: Betttemperatur der ersten Schicht aus dem G-Code (fürs Vorwärmen)
let sendCtx = { slice: null, materials: null, name: '', onStarted: null, own: false, map: {} };

async function openSendDialog(plate, opts) {
  if (sendBusy) { if (!$('sendDlg').open) $('sendDlg').showModal(); return; }
  const o = opts || {};
  sendCtx = { slice: o.slice || (costState && costState.slice), materials: o.materials || costState.materials, name: o.name || (project ? project.name : ''), onStarted: o.onStarted || null,
    own: !!o.own, map: o.map || {}, colours: o.colours || [], bed: o.bed || 0 };
  const s = sendCtx.slice;
  if (!s || !s.job) { toast(t('Zuerst „Kosten berechnen“ – dabei wird geslict')); return; }
  const host = printerHost(SEND_PRINTER);
  if (!host) { toast(t('Erst unter ⚙ Einstellungen → Drucker-Verbindung den Drucker einrichten')); return; }
  $('sendPlate').innerHTML = s.plates.map(p => '<option value="' + p.plate + '">' + t('Platte {n}', { n: p.plate }) + ' · ' + duration(p.time_s) + ' · ' + de(p.total_g, 1) + ' g</option>').join('');
  if (plate) $('sendPlate').value = String(plate);
  // „Später starten“ zurücksetzen – ein Fehler dort darf das Senden nie verhindern (10.12.0: Dialog ging nicht auf)
  try { if (typeof sendLaterReset === 'function') sendLaterReset(); } catch (e) { console.error(e); }
  $('sendPlate').disabled = !!o.onStarted;   // aus der Warteschlange: genau diese Platte
  $('sendSub').textContent = sendCtx.name + ' → ' + host;
  sendFootStd = sendFootStd || $('sendFoot').innerHTML;
  $('sendFoot').innerHTML = sendCtx.own ? esc(t('Das Tool lädt diesen G-Code unverändert auf den Drucker und startet ihn – Temperaturen und Material wie im G-Code. Bett frei? Richtige Druckplatte? Passt das Filament in den gewählten Slots?')) : sendFootStd;
  $('sendState').textContent = t('Frage den Drucker ab …'); $('sendState').className = 'note';
  $('sendMap').innerHTML = ''; $('sendGo').disabled = true;
  sendInfo = null;
  const req = ++sendReq;
  if (!$('sendDlg').open) $('sendDlg').showModal();
  let info = null;
  try { info = await lanApi('api/anycubic/status?host=' + encodeURIComponent(host)); }
  catch (e) {
    if (req !== sendReq) return;
    sendInfo = null; $('sendState').textContent = t('Drucker nicht erreichbar: {msg}', { msg: t(e.message) }); $('sendState').className = 'note bad'; return;
  }
  if (req !== sendReq || sendBusy) return;
  sendInfo = info;
  renderSendDialog();
}

function renderSendDialog() {
  if (sendBusy) { $('sendGo').disabled = true; return; }
  const s = sendCtx.slice, plate = +$('sendPlate').value, p = s.plates.find(x => x.plate === plate), st = sendInfo;
  const free = st && !st.printing && (st.state === 'free' || !st.state);
  // „busy“ ohne Auftrag: meist wartet nach einem Abbruch ein Dialog am Display (Kobra S1, Firmware 2.7) – das Tool schickt dafür nichts
  const stuck = st && !free && !st.job && !st.printing && st.state === 'busy';
  $('sendState').innerHTML = !st ? '' : free ? esc(t('Drucker bereit ({model}, Firmware {fw}).', { model: st.model || 'Kobra S1', fw: st.firmware || '?' }))
    : (stuck ? esc(t('Drucker meldet „beschäftigt“, aber es läuft kein Auftrag – meist wartet am Display ein Dialog (z. B. nach einem Abbruch). Dort bestätigen oder den Drucker aus- und einschalten.'))
      : esc(t('Drucker ist nicht frei ({what}) – erst den laufenden Vorgang beenden.', { what: st.job ? t('druckt „{name}“', { name: st.job.name }) : t(st.state) }))) +
      ' <button type="button" class="linkbtn" data-send-refresh>' + esc(t('Erneut abfragen')) + '</button>';
  $('sendState').className = 'note' + (free ? '' : ' bad');
  // Modell: geslict für X, verbunden ist Y → nicht senden; andere Anycubic als der Kobra S1 sind experimentell (js/anycubic-models.js)
  const want = lastResult ? lanModelOf(lastResult.printer) : null, have = st ? anycubicLanModel(st.model) : null;
  const mismatch = !sendCtx.own && !!(want && have && want.key !== have.key);   // eigener G-Code: prüft der Server
  if (mismatch) { $('sendState').innerHTML = esc(t('Geslict für {want}, verbunden ist ein {have} – bitte oben den passenden Drucker wählen und neu slicen.', { want: want.label, have: have.label })); $('sendState').className = 'note bad'; }
  else if (st && have && !have.tested) $('sendState').innerHTML += '<br><small>' + esc(t('{model}: Unterstützung experimentell – bisher nur am Kobra S1 geprüft. Erste Schicht beobachten; Rückmeldung gern als GitHub-Issue.', { model: have.label })) + '</small>';
  const slots = aceSlots(st);
  let warn = 0;
  const rows = (p ? p.grams : []).map((g, tool) => {
    if (!(g > 0)) return '';
    const to = (sendCtx.map || {})[tool] ?? tool, mat = sendCtx.materials && sendCtx.materials[tool], ace = slots[to];
    const want = mat ? (ORCA_KIND[mat.kind] || mat.name) : '', have = ace && ace.present ? ace.type : '';
    const bad = !have || (mat && !slotMatchesKind(have, mat.kind));
    if (bad) warn++;
    const sw = c => '<span class="pslot" style="display:inline-block;width:11px;height:11px;border-radius:2px;border:1px solid rgba(0,0,0,.35);vertical-align:middle;background:' + safeColour(c, '#dddddd') + '"></span> ';
    // eigener G-Code: Slot wählbar (Auswahl mit Material und Farbe je Slot), Farbe aus dem G-Code daneben
    const pick = sendCtx.own && slots.length ? '<select data-send-tool="' + tool + '" aria-label="' + esc(t('Slot für Werkzeug {n}', { n: 'T' + tool })) + '">' +
      slots.map((s, i) => '<option value="' + i + '"' + (i === to ? ' selected' : '') + '>Slot ' + (i + 1) + ': ' + esc(s.present ? s.type || '?' : t('leer')) + '</option>').join('') + '</select> ' : 'Slot ' + (to + 1) + ': ';
    const gcol = sendCtx.own && (sendCtx.colours || [])[tool] ? sw(sendCtx.colours[tool]) : '';
    return '<tr><td>T' + tool + '</td><td>' + gcol + esc(want || '?') + '<small>' + de(g, 1) + ' g</small></td><td' + (bad ? ' class="warn"' : '') + '>' + pick +
      (have ? sw(ace.colour) + (sendCtx.own ? '' : esc(have)) : sendCtx.own ? '' : t('leer')) + (bad ? '<small>' + (have ? t('anderes Material als im G-Code') : t('kein Filament im Slot')) + '</small>' : '') + '</td></tr>';
  }).join('');
  $('sendMap').innerHTML = '<table class="changes"><thead><tr><th>' + t('Werkzeug') + '</th><th>G-Code</th><th>ACE</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    (p && typeof spoolShortage === 'function' && spoolShortage(p.grams).length ? '<p class="note bad">' + esc(spoolShortagePrefix(spoolShortage(p.grams)) + ' ' + spoolShortageText(spoolShortage(p.grams))) + '</p>' : '') +
    (warn ? '<p class="note bad">' + t('{n} Slot(s) passen nicht zum G-Code. Temperaturen im G-Code gelten für das geslicte Material – erst Filament tauschen oder neu slicen.', { n: warn }) +
      (!sendCtx.onStarted && !sendCtx.own && project ? ' <button type="button" class="btn sec" data-send-adopt>' + esc(t('Filament aus der ACE übernehmen und neu slicen')) + '</button>' : '') + '</p>' : '');
  // später starten (js/schedule-ui.js): Drucker muss jetzt nicht frei sein, der Server prüft zur Startzeit
  let later = null;
  try { later = typeof sendLaterState === 'function' ? sendLaterState(p) : null; } catch (e) { console.error(e); }
  if (mismatch) { $('sendGo').disabled = true; return; }
  if (later) {
    $('sendGo').disabled = !later.ok;
    $('sendGo').textContent = later.now ? (warn ? t('Trotzdem vorwärmen und drucken') : t('Vorwärmen und drucken')) : warn ? t('Trotzdem planen') : t('Planen');
    const info = $(later.now ? 'sendHeatInfo' : 'sendLaterInfo');
    if (later.why) info.textContent = later.why + ' ' + info.textContent;
    return;
  }
  $('sendGo').disabled = !free;
  $('sendGo').textContent = warn ? t('Trotzdem drucken') : t('Jetzt drucken');
}

$('sendPlate').addEventListener('change', renderSendDialog);
$('sendMap').addEventListener('change', e => { const s = e.target.closest('[data-send-tool]'); if (!s) return; (sendCtx.map = sendCtx.map || {})[+s.dataset.sendTool] = +s.value; renderSendDialog(); });
/* Material passt nicht: eigene Angaben, die der ACE widersprechen, verwerfen, die Teile auf das Filament der Slots
   umstellen (adoptSlotMaterials), neu slicen und den Dialog mit dem neuen G-Code wieder öffnen – gesendet wird erst auf Klick */
async function sendAdopt() {
  const plate = +$('sendPlate').value, slots = aceSlots(sendInfo), id = lastResult && lastResult.printer.id;
  const rows = id && store.settings.manualSlots && store.settings.manualSlots[id];
  if (rows) {
    const differs = (r, a) => { const k = kindOfType(r.type || ''); return k ? !slotMatchesKind(a.type, k) : String(r.type || '').toUpperCase() !== String(a.type).toUpperCase(); };
    store.settings.manualSlots[id] = rows.map((r, i) => r && r.override && slots[i] && slots[i].present && slots[i].type && differs(r, slots[i]) ? null : r);
    persist();
  }
  adoptSlotMaterials();
  $('sendDlg').close();
  setTab('slice');
  await runCosts();
  if (costState.slice && !costState.error) openSendDialog(plate);
}
$('sendDlg').addEventListener('click', e => {
  if (e.target.closest('[data-send-adopt]')) { sendAdopt(); return; }
  if (e.target.closest('[data-send-refresh]')) openSendDialog(+$('sendPlate').value, { slice: sendCtx.slice, materials: sendCtx.materials, name: sendCtx.name, onStarted: sendCtx.onStarted, own: sendCtx.own, map: sendCtx.map, colours: sendCtx.colours, bed: sendCtx.bed });
});
$('sendGo').addEventListener('click', async () => {
  // Benachrichtigung bei Pause/Fertig (js/workbench-ui.js wbEvents) – fragen, solange ein Klick die Erlaubnis trägt
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch (e) { /* egal */ }
  let later = null;
  try { later = typeof sendLaterState === 'function' ? sendLaterState(sendCtx.slice.plates.find(x => x.plate === +$('sendPlate').value)) : null; } catch (e) { console.error(e); }
  if (sendBusy) return;
  if (later) { if (later.ok) { sendBusy = true; try { await sendSchedule(later); } finally { sendBusy = false; } } return; }
  const plate = +$('sendPlate').value, host = printerHost(SEND_PRINTER), btn = $('sendGo');
  sendBusy = true; sendReq++;   // eine noch laufende Abfrage des Dialogs verwerfen
  const run = ++sendRun;   // finally gibt nur frei, wenn kein neuer Versuch (nach dem Neu-Slicen) übernommen hat
  btn.disabled = true; btn.textContent = t('Lade hoch …');
  try {
    const req = { host, job: sendCtx.slice.job, plate, name: sendCtx.name ? sendCtx.name.replace(/\.(stl|obj|3mf|zip|gcode|gco|g)$/i, '') : 'druck',
      ...(sendCtx.own ? { own: true, slots: sendCtx.map } : {}),
      options: { auto_leveling: $('sendLevel').checked ? 1 : 0, flow_calibration: $('sendFlow').checked ? 1 : 0, timelapse: $('sendLapse').checked ? 1 : 0 } };
    const r = await lanApi('api/anycubic/print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
    sendBusy = false;
    $('sendDlg').close();
    // Druck läuft: Verlauf (js/history-ui.js) und andere Module hören auf „print-started“
    try { document.dispatchEvent(new CustomEvent('print-started', { detail: { req, res: r } })); } catch (e) { console.error(e); }
    if (sendCtx.onStarted) sendCtx.onStarted(plate);
    toast(r.job ? t('Druck gestartet: {name}', { name: r.job.name }) : (r.note ? t(r.note) : t('Gesendet')));
    setTab('printer');
  } catch (e) {
    // Slice-Stand nicht mehr auf dem Server (Neustart, aufgeräumt): einmal neu slicen und gleich erneut starten
    if (/nicht \(mehr\) vorhanden/.test(e.message) && !sendCtx.onStarted && !sendCtx.own && project && !sendCtx.resliced) {
      $('sendState').textContent = t('Der Slice-Stand war nicht mehr auf dem Server (z. B. nach einem Neustart) – wird neu berechnet …'); $('sendState').className = 'note';
      btn.textContent = t('Slicen …');
      costState.sig = null;
      await runCosts();
      if (costState.slice && costState.slice.job && !costState.error) { sendCtx.slice = costState.slice; sendCtx.resliced = true; sendBusy = false; btn.disabled = false; $('sendGo').click(); return; }
    }
    sendBusy = false;
    $('sendState').textContent = t('Nicht gestartet: {msg}', { msg: t(e.message) }) + (sendCtx.onStarted && /nicht \(mehr\) vorhanden/.test(e.message) ? ' ' + t('Bitte die Warteschlange neu anlegen.') : '');
    $('sendState').className = 'note bad';
    btn.disabled = false; btn.textContent = t('Erneut versuchen');
  } finally { if (run === sendRun) sendBusy = false; }
});
$('sendOpen').addEventListener('click', () => openSendDialog());
$('pvSend').addEventListener('click', () => openSendDialog(+$('pvPlate').value));
$('sendDlg').addEventListener('click', e => { if (e.target === e.currentTarget && !sendBusy) e.currentTarget.close(); });
// Esc während des Hochladens: Dialog bleibt offen (sonst wirkte der Druck abgebrochen, und ein zweiter Klick schickte ihn erneut)
$('sendDlg').addEventListener('cancel', e => { if (sendBusy) e.preventDefault(); });
$('sendDlg').addEventListener('click', e => { if (sendBusy && e.target.closest('[data-close]')) e.stopPropagation(); });   // „Abbrechen“ ebenso (js/app.js schließt über document)
