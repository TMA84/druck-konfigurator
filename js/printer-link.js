'use strict';
/* Live-Abfrage der Filament-Belegung.
   Kobra S1 mit Werksfirmware (LAN-Modus): über den eigenen Server (/api/anycubic/…, tools/anycubic_lan.py),
   der Browser kann das verschlüsselte MQTT des Druckers nicht selbst sprechen. Dort lassen sich auch
   ACE-Einstellungen schreiben (Slot-Filament, Nachfüllen).
   Über Moonraker – nur lesende GET-Anfragen:
   Kobra S1 (Rinkhals): Objekt filament_hub → ACE-Slots.
   Snapmaker U1 (paxx/Klipper): Objekt print_task_config → Arrays je Werkzeugkopf.
   Funktioniert nur, wenn die Seite über http://127.0.0.1 läuft (Moonraker-CORS);
   per Doppelklick (file://) blockiert der Browser die Antwort. */

const MOONRAKER_PORT = 7125;
const LINK_TIMEOUT_MS = 8000;  // Kobra S1 (Rinkhals) antwortet gemessen zwischen 0,2 und 15 s
const LINK_ATTEMPTS = 2;

const hex2 = n => Math.max(0, Math.min(255, Math.round(+n || 0))).toString(16).padStart(2, '0').toUpperCase();
const normType = t => String(t || '').trim().toUpperCase();

// Je Drucker: Abfrage-Objekt und Umwandlung in [{type, colour, name, present}]
const SLOT_ADAPTERS = {
  kobra_s1: {
    query: 'filament_hub',
    parse: status => {
      const hub = ((status.filament_hub || {}).filament_hubs || [])[0];
      if (!hub || !Array.isArray(hub.slots)) throw Error(t('keine ACE-Daten (filament_hub) gefunden'));
      return hub.slots.slice().sort((a, b) => a.index - b.index).map(s => {
        const c = Array.isArray(s.color) ? s.color : [136, 136, 136];
        return { type: normType(s.type), colour: '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]), name: normType(s.type) || t('leer'), present: s.status === 'ready' };
      });
    }
  },
  snapmaker_u1: {
    query: 'print_task_config',
    parse: status => {
      const p = status.print_task_config;
      if (!p || !Array.isArray(p.filament_type)) throw Error(t('keine Werkzeugkopf-Daten (print_task_config) gefunden'));
      return p.filament_type.map((t, i) => {
        const rgba = String((p.filament_color_rgba || [])[i] || '888888FF');
        const vendor = (p.filament_vendor || [])[i] || '';
        return { type: normType(t), colour: '#' + rgba.slice(0, 6).toUpperCase(), name: (vendor ? vendor + ' ' : '') + normType(t), present: (p.filament_exist || [])[i] !== false };
      });
    }
  }
};

// Nur über den lokalen Server (http). file:// blockiert der Drucker per CORS, eine https-Seite (Online-Version)
// darf der Browser nicht an ein http-Gerät im Heimnetz fragen lassen.
function linkAvailable() { return location.protocol === 'http:'; }

/* ---------- Werksfirmware (LAN-Modus) über den eigenen Server ---------- */
const LAN_PRINTERS = ['kobra_s1'];
const linkMode = printerId => ((store.settings.printerLinkMode || {})[typeof linkId === 'function' ? linkId(printerId) : printerId]) || 'auto';
let healthInfo = null;
// Was kann der Server? {lan: LAN-Modus (paho-mqtt + cryptography), slicer: Orca-Version oder null}
function serverHealth() {
  if (!healthInfo) healthInfo = location.protocol.startsWith('http')
    ? fetch('api/health').then(r => r.ok ? r.json() : {}, () => ({})) : Promise.resolve({});
  return healthInfo;
}
const lanServerAvailable = () => serverHealth().then(j => !!j.lan);
async function lanApi(path, opts) {
  let res, data = {};
  try { res = await fetch(path, opts); data = await res.json(); }
  catch (e) { throw Error(t('Server des Konfigurators nicht erreichbar')); }
  if (!res.ok) { const err = Error(data.error ? t(data.error) : t('Server antwortet mit HTTP {status}', { status: res.status })); err.kind = data.kind; throw err; }
  return data;
}
// Slots aller ACE-Einheiten hintereinander (Slot 5 = Box 2, Slot 1) aus dem Stand von api/anycubic/status
const aceSlots = st => ((st && st.ace) || []).flatMap(box => box.slots.map(s => ({ ...s, box: box.id })));
async function fetchLanStatus(host) {
  const st = await lanApi('api/anycubic/status?host=' + encodeURIComponent(host));
  const slots = [];
  (st.ace || []).forEach(box => box.slots.forEach(s => slots.push({ type: s.type, colour: s.colour || '#888888', name: s.present ? s.type + (s.rfid ? ' (RFID)' : '') : t('leer'), present: s.present, rfid: !!(s.present && s.rfid), box: box.id, index: s.index })));
  if (!slots.length) throw Error(st.has_ace === 0 ? t('Am Drucker ist keine ACE angeschlossen') : t('Drucker meldet keine ACE-Slots'));
  return { slots, host, time: new Date(), via: 'lan', status: st };
}
// Einstellungen schreiben: nur, was tools/anycubic_lan.py freigibt (WRITABLE)
function lanCommand(host, type, action, data) {
  return lanApi('api/anycubic/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, type, action, data }) });
}
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) || 0);
// slots: [{box, index, type, colour}] – je ACE-Einheit ein Befehl
async function writeLanSlots(host, slots) {
  const byBox = new Map();
  slots.forEach(s => (byBox.get(s.box) || byBox.set(s.box, []).get(s.box)).push({ index: s.index, type: s.type, color: hexToRgb(s.colour) }));
  for (const [id, list] of byBox) {
    const r = await lanCommand(host, 'multiColorBox', 'setInfo', { multi_color_box: [{ id, slots: list }] });
    if (!r.ok) throw Error(r.msg ? t('Drucker hat die Slot-Angabe abgelehnt: {msg}', { msg: t(r.msg) }) : t('Drucker hat die Slot-Angabe abgelehnt'));
  }
}

// Liefert {slots, host, time, via} oder wirft einen Fehler mit verständlicher Meldung.
// Kobra S1: je nach Einstellung Werksfirmware (LAN) und/oder Moonraker; „auto“ versucht LAN zuerst.
async function fetchLiveSlots(printerId, host) {
  if (LAN_PRINTERS.includes(linkId(printerId)) && host && linkMode(printerId) !== 'moonraker') {
    const mode = linkMode(printerId);
    if (await lanServerAvailable()) {
      try { return await fetchLanStatus(host); }
      catch (e) {
        if (mode === 'lan') throw e;
        try { return await fetchMoonrakerSlots(printerId, host); }
        catch (e2) { throw Error(t('Werksfirmware: {lan} · Moonraker: {moonraker}', { lan: e.message, moonraker: e2.message })); }
      }
    }
    if (mode === 'lan') throw Error(t('Der Server kann den LAN-Modus nicht (im Container enthalten; lokal: pip install -r requirements.txt)'));
  }
  return fetchMoonrakerSlots(printerId, host);
}

async function fetchMoonrakerSlots(printerId, host) {
  const adapter = SLOT_ADAPTERS[linkId(printerId)];
  if (!adapter) throw Error(t('für diesen Drucker gibt es keine Live-Abfrage'));
  if (!host) throw Error(t('keine IP-Adresse eingetragen'));
  if (!linkAvailable()) throw Error(location.protocol === 'https:'
    ? t('Live-Abfrage geht in der Online-Version nicht – dafür das Tool herunterladen und über den lokalen Server starten')
    : t('Live-Abfrage nur beim Start über „Konfigurator starten.cmd“ bzw. tools/serve.py (nicht per Doppelklick auf index.html)'));
  for (let attempt = 1; ; attempt++) {
    try { return await querySlotsOnce(adapter, host); }
    catch (e) { if (attempt >= LINK_ATTEMPTS || !e.retryable) throw e; }
  }
}

async function querySlotsOnce(adapter, host) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), LINK_TIMEOUT_MS);
  try {
    const res = await fetch('http://' + host + ':' + MOONRAKER_PORT + '/printer/objects/query?' + adapter.query, { signal: ctrl.signal });
    if (!res.ok) throw Error(t('Drucker antwortet mit HTTP {status}', { status: res.status }));
    const data = await res.json();
    return { slots: adapter.parse((data.result || {}).status || {}), host, time: new Date(), via: 'moonraker' };
  } catch (e) {
    const err = e.name === 'AbortError' ? Error(t('Drucker unter {host} antwortet nicht (Zeitüberschreitung)', { host }))
      : e instanceof TypeError ? Error(t('Drucker unter {host} nicht erreichbar oder Zugriff blockiert', { host })) : null;
    if (err) { err.retryable = true; throw err; }
    throw e;
  } finally { clearTimeout(timer); }
}

// Grobe Zuordnung Druckerangabe → Filamenttyp des Konfigurators ("PLA+", "PETG-HF" …)
function slotMatchesKind(slotType, kind) {
  const t = normType(slotType), k = (ORCA_KIND[kind] || '').toUpperCase();
  return !!t && !!k && (t === k || t.startsWith(k));
}
