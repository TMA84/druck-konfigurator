"""Home Assistant über MQTT (Discovery): Druckerstand, Warteschlange, Restmengen der ACE-Slots und „Bett abräumen“.

Einstellungen über Umgebungsvariablen (im Add-on setzt run.sh sie aus dem MQTT-Dienst des Supervisors):
  MQTT_HOST (leer = aus), MQTT_PORT (1883), MQTT_USER, MQTT_PASSWORD, MQTT_TLS (true/false),
  MQTT_DISCOVERY_PREFIX (homeassistant), MQTT_BASE_TOPIC (druck_konfigurator)

Themen (base = MQTT_BASE_TOPIC):
  <base>/availability     online | offline (Last Will, retained)
  <base>/state            JSON mit allen Werten (siehe payload()), alle 15 s und bei Änderung – auch Filament, Kosten und
                          Anzahl der Drucke im laufenden Monat (aus der Druckhistorie, tools/spools.py stats)
  <base>/slot/<n>         JSON je ACE-Slot (1 …): remaining_g, name, type, colour, net_g, brand
  <prefix>/<component>/<base>/<key>/config   Discovery (retained)
Ein Gerät „Druck-Konfigurator <Druckermodell>“. Der Server liest nur – über MQTT wird nichts gesteuert.
"""
import datetime
import json
import os
import ssl
import threading
import time

try:
    import paho.mqtt.client as mqtt
    AVAILABLE = True
except ImportError:  # ohne paho-mqtt bleibt MQTT aus
    mqtt = None
    AVAILABLE = False

STATE_EVERY_S = 15
LOOP_S = 2
ORIGIN = {"name": "Druck-Konfigurator", "url": "https://github.com/TMA84/druck-konfigurator"}

# key → (Komponente, Name, Wert im JSON, Einheit, device_class, state_class, Symbol)
ENTITIES = [
    ("printer_state", "sensor", "Druckerstatus", None, None, None, "mdi:printer-3d"),
    ("progress", "sensor", "Fortschritt", "%", None, "measurement", "mdi:progress-clock"),
    ("remaining_min", "sensor", "Restzeit", "min", "duration", None, "mdi:timer-sand"),
    ("finish", "sensor", "Fertig um", None, "timestamp", None, "mdi:clock-end"),
    ("job", "sensor", "Druckauftrag", None, None, None, "mdi:file-document-outline"),
    ("layer", "sensor", "Schicht", None, None, None, "mdi:layers-triple"),
    ("nozzle_temp", "sensor", "Düse", "°C", "temperature", "measurement", None),
    ("bed_temp", "sensor", "Druckbett", "°C", "temperature", "measurement", None),
    ("queue_state", "sensor", "Warteschlange", None, None, None, "mdi:format-list-numbered"),
    ("queue_remaining_min", "sensor", "Warteschlange Restzeit", "min", "duration", None, "mdi:timer-sand"),
    ("plates", "sensor", "Platten fertig", None, None, None, "mdi:layers-outline"),
    ("bed_clear", "binary_sensor", "Bett abräumen", None, None, None, "mdi:printer-3d-nozzle-alert"),
    # Druckhistorie der Filamentverwaltung (tools/spools.py stats): laufender Monat, beginnt am 1. wieder bei 0
    ("month_filament_g", "sensor", "Filament diesen Monat", "g", "weight", "total", "mdi:printer-3d-nozzle"),
    ("month_cost_eur", "sensor", "Filamentkosten diesen Monat", "EUR", "monetary", "total", "mdi:cash"),
    ("month_prints", "sensor", "Drucke diesen Monat", None, None, "total", "mdi:counter"),
]
PRINTER_STATE = {"free": "frei", "busy": "beschäftigt", "offline": "offline"}


def config_from_env(env=None):
    env = os.environ if env is None else env
    host = (env.get("MQTT_HOST") or "").strip()
    if not host:
        return None
    try:
        port = int(env.get("MQTT_PORT") or 1883)
    except ValueError:
        port = 1883
    return {"host": host, "port": port, "user": env.get("MQTT_USER") or None, "password": env.get("MQTT_PASSWORD") or None,
            "tls": str(env.get("MQTT_TLS") or "").lower() in ("1", "true", "yes", "on"),
            "prefix": (env.get("MQTT_DISCOVERY_PREFIX") or "homeassistant").strip("/"),
            "base": (env.get("MQTT_BASE_TOPIC") or "druck_konfigurator").strip("/")}


def _finish(remaining_min, now):
    if not isinstance(remaining_min, (int, float)):
        return None
    ts = int((now + remaining_min * 60) // 60 * 60)      # auf die Minute – sonst ändert sich der Wert bei jeder Abfrage
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).isoformat(timespec="seconds")


def printer_state(st):
    if not st or st.get("connected") is False:
        return "offline"
    job = st.get("job")
    if job:
        if job.get("paused"):
            return "pausiert"
        return str(job.get("status") or "druckt")
    return PRINTER_STATE.get(st.get("state"), st.get("state") or "frei")


def month_values(spool_view):
    """Monatswerte aus spools.view()["stats"] (ohne Filamentverwaltung: None)."""
    sm = (spool_view or {}).get("stats") if isinstance(spool_view, dict) else None
    if not isinstance(sm, dict):
        return {"month_filament_g": None, "month_cost_eur": None, "month_prints": None, "month": None}
    return {"month_filament_g": round(sm.get("grams") or 0, 1), "month_cost_eur": round(sm.get("cost_eur") or 0, 2),
            "month_prints": int(sm.get("prints") or 0), "month": sm.get("month"), "month_hours": round(sm.get("hours") or 0, 2)}


def payload(st, queue, now=None, spool_view=None):
    """Werte für <base>/state. st = anycubic_lan.status (oder None), queue = printqueue.api_get(), spool_view = spools.api_get()."""
    now = now or time.time()
    job = (st or {}).get("job") or {}
    temps = (st or {}).get("temps") or {}
    sm = (queue or {}).get("summary") or {}
    rnd = lambda v: round(v, 1) if isinstance(v, (int, float)) else None
    rem = job.get("remaining_min") if isinstance(job.get("remaining_min"), (int, float)) else None
    return dict({"printer_state": printer_state(st), "progress": job.get("progress") if isinstance(job.get("progress"), (int, float)) else None,
            "remaining_min": rem, "finish": _finish(rem, now) if job else None, "job": job.get("name") or None,
            "layer": "%s/%s" % (job.get("layer"), job.get("layers")) if job.get("layers") else None,
            "nozzle_temp": rnd(temps.get("curr_nozzle_temp")), "bed_temp": rnd(temps.get("curr_hotbed_temp")),
            "queue_state": sm.get("text") or "keine", "queue_remaining_min": round((sm.get("remaining_s") or 0) / 60),
            "plates": "%d/%d" % (sm.get("done") or 0, sm.get("total") or 0), "plates_done": sm.get("done") or 0,
            "plates_total": sm.get("total") or 0, "queue_current": sm.get("current"), "queue_next": sm.get("next"),
            "bed_clear": "ON" if sm.get("bed_clear") or (queue or {}).get("bed_clear") else "OFF"}, **month_values(spool_view))


def slot_payloads(st, spool_view):
    """Je ACE-Slot (1 …, über alle Einheiten: ACE 2 = Slot 5–8) die Spule mit Restmenge. Anzahl Slots laut Drucker,
    sonst laut Filamentverwaltung."""
    boxes = (st or {}).get("ace") or []
    n = sum(max(4, len(b.get("slots") or [])) for b in boxes[:-1]) + len(boxes[-1].get("slots") or []) if boxes else 0
    spools = [sp for sp in (spool_view or {}).get("spools") or [] if isinstance(sp.get("slot"), int) and not sp.get("archived")]
    n = max([n] + [sp["slot"] + 1 for sp in spools])
    out = {}
    for i in range(n):
        sp = next((x for x in spools if x["slot"] == i), None)
        out[i + 1] = {"remaining_g": sp.get("remaining_g") if sp else None, "name": (sp.get("name") or "") if sp else "",
                      "type": sp.get("type") if sp else "", "colour": sp.get("colour") if sp else "",
                      "net_g": sp.get("net_g") if sp else None, "brand": (sp.get("brand") or "") if sp else "",
                      "id": sp.get("id") if sp else None}
    return out


class Publisher:
    """Hintergrund-Thread mit stehender Verbindung zum Broker. Verbindet neu, wenn der Broker weg war."""

    def __init__(self, cfg, status_fn, queue_fn, spools_fn, loop_s=LOOP_S, every_s=STATE_EVERY_S):
        self.cfg, self.status_fn, self.queue_fn, self.spools_fn = cfg, status_fn, queue_fn, spools_fn
        self.loop_s, self.every_s = loop_s, every_s
        b = cfg["base"]
        self.t_avail, self.t_state, self.t_slot = b + "/availability", b + "/state", b + "/slot/%d"
        self.client, self.connected, self.need_discovery = None, False, True
        self.last, self.last_time, self.slots_last, self.disc_key = None, 0, {}, None
        self.last_error = None
        self.stopped = False
        self.thread = threading.Thread(target=self._run, daemon=True, name="ha-mqtt")

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.stopped = True
        c = self.client
        if c:
            try:
                c.publish(self.t_avail, "offline", qos=1, retain=True).wait_for_publish(2)
            except Exception:
                pass
            c.disconnect()
            c.loop_stop()

    # -- Discovery --
    def device(self, st):
        model = (st or {}).get("model")
        d = {"identifiers": [self.cfg["base"]], "name": "Druck-Konfigurator" + (" " + model if model else ""),
             "manufacturer": "Anycubic", "model": model or "3D-Drucker"}
        if (st or {}).get("firmware"):
            d["sw_version"] = str(st["firmware"])
        return d

    def discovery(self, st, slots):
        """{Thema: Nutzdaten} für alle Entitäten."""
        base, prefix, dev = self.cfg["base"], self.cfg["prefix"], self.device(st)
        common = {"availability_topic": self.t_avail, "payload_available": "online", "payload_not_available": "offline",
                  "device": dev, "origin": ORIGIN}
        out = {}
        for key, comp, name, unit, dclass, sclass, icon in ENTITIES:
            c = dict(common, name=name, unique_id=base + "_" + key, default_entity_id=comp + "." + base + "_" + key,
                     state_topic=self.t_state, value_template="{{ value_json.%s }}" % key)
            if unit:
                c["unit_of_measurement"] = unit
            if dclass:
                c["device_class"] = dclass
            if sclass:
                c["state_class"] = sclass
            if icon:
                c["icon"] = icon
            if comp == "binary_sensor":
                c.update(payload_on="ON", payload_off="OFF")
            if key in ("printer_state", "queue_state", "month_prints"):
                c["json_attributes_topic"] = self.t_state
            out["%s/%s/%s/%s/config" % (prefix, comp, base, key)] = c
        for n in slots:
            key = "slot%d_remaining" % n
            out["%s/sensor/%s/%s/config" % (prefix, base, key)] = dict(
                common, name="Slot %d Filament" % n, unique_id=base + "_" + key, default_entity_id="sensor." + base + "_" + key,
                state_topic=self.t_slot % n, value_template="{{ value_json.remaining_g }}", json_attributes_topic=self.t_slot % n,
                unit_of_measurement="g", device_class="weight", state_class="measurement", icon="mdi:printer-3d-nozzle")
        return out

    # -- Verbindung --
    def _connect(self):
        cfg = self.cfg
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="druck-konfigurator-" + cfg["base"], protocol=mqtt.MQTTv311)
        if cfg.get("user"):
            c.username_pw_set(cfg["user"], cfg.get("password"))
        if cfg.get("tls"):
            ctx = ssl.create_default_context()
            ctx.check_hostname = False          # Broker im Heimnetz (z. B. core-mosquitto) meist ohne passendes Zertifikat
            ctx.verify_mode = ssl.CERT_NONE
            c.tls_set_context(ctx)
        c.will_set(self.t_avail, "offline", qos=1, retain=True)
        c.reconnect_delay_set(2, 60)

        def on_connect(client, _u, _f, reason, _p=None):
            if getattr(reason, "is_failure", False):
                self._log("Anmeldung abgelehnt (%s)" % reason)
                return
            self.connected, self.need_discovery, self.last = True, True, None
            client.subscribe(cfg["prefix"] + "/status", qos=1)     # Home Assistant neu gestartet → Discovery erneut
            self.last_error = None

        def on_disconnect(*_a):
            self.connected = False

        def on_message(_c, _u, msg):
            if msg.topic == cfg["prefix"] + "/status" and msg.payload == b"online":
                self.need_discovery, self.last = True, None

        c.on_connect, c.on_disconnect, c.on_message = on_connect, on_disconnect, on_message
        c.connect_async(cfg["host"], cfg["port"], keepalive=60)
        c.loop_start()                                   # verbindet selbst neu (auch den ersten Versuch)
        self.client = c

    def _log(self, msg):
        if msg != self.last_error:
            print("Home Assistant (MQTT): " + msg, flush=True)
        self.last_error = msg

    def _pub(self, topic, obj, retain=False):
        self.client.publish(topic, obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False), qos=1 if retain else 0, retain=retain)

    def step(self, now=None):
        """Einmal: Werte holen, bei Bedarf Discovery und Stand senden. Gibt True zurück, wenn gesendet wurde."""
        now = now or time.time()
        if not self.connected:
            return False
        st = self.status_fn()
        spool_view = self.spools_fn()
        state = payload(st, self.queue_fn(), now, spool_view)
        slots = slot_payloads(st, spool_view)
        dev = self.device(st)
        key = (dev["name"], dev.get("sw_version"), tuple(slots))
        if self.need_discovery or key != self.disc_key:
            for topic, cfg in self.discovery(st, slots).items():
                self._pub(topic, cfg, retain=True)
            self._pub(self.t_avail, "online", retain=True)
            self.need_discovery, self.disc_key, self.last, self.slots_last = False, key, None, {}
        sent = False
        if state != self.last or now - self.last_time >= self.every_s:
            self._pub(self.t_state, state)
            self.last, self.last_time, sent = state, now, True
        for n, sp in slots.items():
            if sp != self.slots_last.get(n) or sent:
                self._pub(self.t_slot % n, sp)
                self.slots_last[n] = sp
        return sent

    def _run(self):
        while not self.stopped:
            try:
                if not self.client:
                    self._connect()
                self.step()
            except Exception as e:   # MQTT darf den Server nie stören
                self._log(str(e) or type(e).__name__)
            time.sleep(self.loop_s)


def start(status_fn, queue_fn, spools_fn, env=None):
    """Aus serve.py: startet den Publisher, wenn MQTT_HOST gesetzt ist. Gibt (Publisher|None, Meldung) zurück."""
    cfg = config_from_env(env)
    if not cfg:
        return None, None
    if not AVAILABLE:
        return None, "Home Assistant (MQTT): braucht paho-mqtt (pip install -r requirements.txt) – aus"
    p = Publisher(cfg, status_fn, queue_fn, spools_fn).start()
    return p, "Home Assistant (MQTT): %s:%d, Themen %s/…, Discovery %s/…" % (cfg["host"], cfg["port"], cfg["base"], cfg["prefix"])
