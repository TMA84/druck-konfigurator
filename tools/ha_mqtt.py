"""Home Assistant über MQTT (Discovery): Druckerstand, Warteschlange, Restmengen der ACE-Slots und „Bett abräumen“.

Einstellungen über Umgebungsvariablen (im Add-on setzt run.sh sie aus dem MQTT-Dienst des Supervisors):
  MQTT_HOST (leer = aus), MQTT_PORT (1883), MQTT_USER, MQTT_PASSWORD, MQTT_TLS (true/false),
  MQTT_DISCOVERY_PREFIX (homeassistant), MQTT_BASE_TOPIC (druck_konfigurator)

Themen (base = MQTT_BASE_TOPIC):
  <base>/availability     online | offline (Last Will, retained)
  <base>/state            JSON mit allen Werten (siehe payload()), alle 15 s und bei Änderung – auch Filament, Kosten und
                          Anzahl der Drucke im laufenden Monat (aus der Druckhistorie, tools/spools.py stats)
  <base>/slot/<n>         JSON je ACE-Slot (1 …): remaining_g, name, type, colour, net_g, brand
  <base>/progress_image   PNG des Druckfortschritts (MQTT-Kamera „3D-Fortschritt“, retained; tools/progress_image.py) –
                          bei jeder neuen Schicht, nur für Drucke aus dem Tool
  <prefix>/<component>/<base>/<key>/config   Discovery (retained)
  <base>/event            Druck-Ereignis (MQTT-Event „Druck-Ereignis“): {"event_type": pausiert|fortgesetzt|fertig|abgebrochen,
                          "druck", "grund", "fortschritt"} – nicht retained; für Benachrichtigungen per Automation
  <base>/cmd              nur mit MQTT_CONTROL=1: „pause“ / „resume“ (Knöpfe „Druck pausieren“ / „Druck fortsetzen“)
Ein Gerät „Druck-Konfigurator <Druckermodell>“. Ohne MQTT_CONTROL liest der Server nur – über MQTT wird nichts gesteuert.
Mit MQTT_CONTROL (Add-on-Option „Steuern aus Home Assistant“, Standard aus) nur Pausieren und Fortsetzen, nie Abbrechen;
der Befehl geht wie aus der Werkbank an den Drucker (tools/anycubic_lan.py command) – ohne laufenden Druck lehnt er ab.
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
    # warum der Druck pausiert (tools/anycubic_lan.py pause_reason); leer, solange nicht pausiert
    ("pause_reason", "sensor", "Pausengrund", None, None, None, "mdi:pause-octagon"),
    ("progress", "sensor", "Fortschritt", "%", None, "measurement", "mdi:progress-clock"),
    ("remaining_min", "sensor", "Restzeit", "min", "duration", None, "mdi:timer-sand"),
    ("finish", "sensor", "Fertig um", None, "timestamp", None, "mdi:clock-end"),
    ("job", "sensor", "Druckauftrag", None, None, None, "mdi:file-document-outline"),
    ("layer", "sensor", "Schicht", None, None, None, "mdi:layers-triple"),
    ("nozzle_temp", "sensor", "Düse", "°C", "temperature", "measurement", None),
    ("bed_temp", "sensor", "Druckbett", "°C", "temperature", "measurement", None),
    # Werte wie in der Werkbank (2026-10-08): Ziele, Lüfter, Geschwindigkeitsstufe, Dauer, Filament, Licht
    ("nozzle_target", "sensor", "Düse Ziel", "°C", "temperature", "measurement", "mdi:thermometer-chevron-up"),
    ("bed_target", "sensor", "Druckbett Ziel", "°C", "temperature", "measurement", "mdi:thermometer-chevron-up"),
    ("fan_part", "sensor", "Bauteillüfter", "%", None, "measurement", "mdi:fan"),
    ("fan_aux", "sensor", "Hilfslüfter", "%", None, "measurement", "mdi:fan"),
    ("fan_box", "sensor", "Gehäuselüfter", "%", None, "measurement", "mdi:fan"),
    ("speed_mode", "sensor", "Druckgeschwindigkeit", None, None, None, "mdi:speedometer"),
    ("elapsed_min", "sensor", "Druckdauer bisher", "min", "duration", None, "mdi:timer-outline"),
    ("filament_m", "sensor", "Filament dieser Druck", "m", "distance", None, "mdi:printer-3d-nozzle"),
    ("light", "binary_sensor", "Licht", None, "light", None, "mdi:lightbulb"),
    ("queue_state", "sensor", "Warteschlange", None, None, None, "mdi:format-list-numbered"),
    ("queue_remaining_min", "sensor", "Warteschlange Restzeit", "min", "duration", None, "mdi:timer-sand"),
    ("plates", "sensor", "Platten fertig", None, None, None, "mdi:layers-outline"),
    ("bed_clear", "binary_sensor", "Bett abräumen", None, None, None, "mdi:printer-3d-nozzle-alert"),
    # Spule unter der Warnschwelle oder die wartenden Platten der Warteschlange brauchen mehr, als im Slot ist
    ("filament_low", "binary_sensor", "Filament knapp", None, "problem", None, "mdi:printer-3d-nozzle-alert"),
    # geplanter Druck (tools/schedule.py)
    ("schedule_start", "sensor", "Geplanter Start", None, "timestamp", None, "mdi:calendar-clock"),
    ("schedule_state", "sensor", "Geplanter Druck", None, None, None, "mdi:calendar-check"),
    # Druckhistorie der Filamentverwaltung (tools/spools.py stats): laufender Monat, beginnt am 1. wieder bei 0
    ("month_filament_g", "sensor", "Filament diesen Monat", "g", "weight", "total", "mdi:printer-3d-nozzle"),
    ("month_cost_eur", "sensor", "Filamentkosten diesen Monat", "EUR", "monetary", "total", "mdi:cash"),
    ("month_prints", "sensor", "Drucke diesen Monat", None, None, "total", "mdi:counter"),
]
PRINTER_STATE = {"free": "frei", "busy": "beschäftigt", "offline": "offline"}
SPEED_MODE = {1: "Leise", 2: "Standard", 3: "Sport"}   # wie die Werkbank (js/workbench-ui.js WB_SPEED)


def num(v, nd=None):
    return (round(v, nd) if nd is not None else v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def machine_values(st):
    """Ziele, Lüfter, Geschwindigkeit, Dauer, Filament, Licht und je ACE Temperatur und Trocknen (aceN_temp, aceN_drying)."""
    st = st or {}
    temps, fans, job = st.get("temps") or {}, st.get("fans") or {}, st.get("job") or {}
    light = (st.get("lights") or [None])[0] or {}
    out = {"nozzle_target": num(temps.get("target_nozzle_temp")), "bed_target": num(temps.get("target_hotbed_temp")),
           "fan_part": num(fans.get("fan_speed_pct")), "fan_aux": num(fans.get("aux_fan_speed_pct")), "fan_box": num(fans.get("box_fan_level")),
           "speed_mode": SPEED_MODE.get(st.get("speed_mode"), st.get("speed_mode")) if st.get("speed_mode") is not None else None,
           "elapsed_min": num(job.get("elapsed_min")) if job else None,
           "filament_m": round(job["filament_mm"] / 1000, 2) if job and isinstance(job.get("filament_mm"), (int, float)) else None,
           "light": ("ON" if light.get("status") else "OFF") if light else None}
    for i, b in enumerate(st.get("ace") or [], 1):
        dry = b.get("drying") or {}
        out["ace%d_temp" % i] = num(b.get("temp"))
        out["ace%d_drying" % i] = ("trocknet %s °C, noch %s min" % (dry.get("target_temp"), dry.get("remain_time"))) if dry.get("status") else "aus"
    return out
EVENT_TYPES = ["pausiert", "fortgesetzt", "fertig", "abgebrochen"]
FINISHED = {"fertig", "finished", "complete", "completed", 2}
ABORTED = {"abgebrochen", "stoped", "stopped", "canceled", "cancelled", 3}


def print_events(prev, st):
    """Ereignisse zwischen zwei Ständen: [(event_type, Nutzdaten)]. prev/st = anycubic_lan.status (oder None).
    pausiert/fortgesetzt aus job.paused; fertig/abgebrochen, wenn der Druck endet (job weg oder Status fertig/abgebrochen)."""
    if not prev or not st or st.get("connected") is False or prev.get("connected") is False:
        return []
    pj, sj = prev.get("job") or None, st.get("job") or None
    out, name = [], (sj or pj or {}).get("name")
    info = lambda **kw: dict({"druck": name, "fortschritt": (sj or pj or {}).get("progress")}, **kw)
    if pj and sj and pj.get("name") == sj.get("name"):
        if not pj.get("paused") and sj.get("paused"):
            out.append(("pausiert", info(grund=st.get("pause_reason") or "Grund nicht gemeldet")))
        elif pj.get("paused") and not sj.get("paused"):
            out.append(("fortgesetzt", info()))
    done = lambda j: j and (j.get("status") in FINISHED or j.get("state") in FINISHED)
    stop = lambda j: j and (j.get("status") in ABORTED or j.get("state") in ABORTED)
    if pj and not (done(pj) or stop(pj)):
        end = sj if sj and sj.get("name") == pj.get("name") else (st.get("last_job") if not sj else None)
        if end and done(end):
            out.append(("fertig", dict(info(), druck=pj.get("name"), fortschritt=100)))
        elif end and stop(end):
            out.append(("abgebrochen", dict(info(), druck=pj.get("name"))))
    return out


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
            "base": (env.get("MQTT_BASE_TOPIC") or "druck_konfigurator").strip("/"),
            "control": str(env.get("MQTT_CONTROL") or "").lower() in ("1", "true", "yes", "on")}


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


def filament_check(queue, spool_view):
    """Hinweise (Text je Slot): Spule unter der Warnschwelle, oder die noch wartenden Platten der Warteschlange
    brauchen mehr, als auf der Spule ist (Gramm je Slot aus dem Slicen)."""
    sv = spool_view or {}
    low = sv.get("low_g") or 100
    spools = {sp["slot"]: sp for sp in sv.get("spools") or [] if isinstance(sp.get("slot"), int) and not sp.get("archived")
              and isinstance(sp.get("remaining_g"), (int, float))}
    need = {}
    q = (queue or {}).get("queue") or {}
    plates = {p.get("plate"): p for p in ((q.get("slice") or {}).get("plates") or [])}
    for it in q.get("items") or []:
        if it.get("state") == "wait":
            for i, g in enumerate((plates.get(it.get("plate")) or {}).get("grams") or []):
                if isinstance(g, (int, float)) and g > 0:
                    need[i] = need.get(i, 0) + g
    out = []
    for i in sorted(set(spools) | set(need)):
        sp = spools.get(i)
        if not sp:
            continue
        rem = sp["remaining_g"]
        if need.get(i, 0) > rem:
            out.append("Slot %d: Warteschlange braucht noch ≈ %d g, auf der Spule ≈ %d g" % (i + 1, round(need[i]), round(rem)))
        elif rem < low:
            out.append("Slot %d: nur noch ≈ %d g" % (i + 1, round(rem)))
    return out


SCHEDULE_STATE = {"wait": "geplant", "drying": "trocknet", "heating": "heizt vor", "started": "gestartet", "failed": "nicht gestartet", "cancelled": "abgesagt"}


def payload(st, queue, now=None, spool_view=None, plan=None):
    """Werte für <base>/state. st = anycubic_lan.status (oder None), queue = printqueue.api_get(), spool_view = spools.api_get()."""
    now = now or time.time()
    job = (st or {}).get("job") or {}
    temps = (st or {}).get("temps") or {}
    sm = (queue or {}).get("summary") or {}
    rnd = lambda v: round(v, 1) if isinstance(v, (int, float)) else None
    rem = job.get("remaining_min") if isinstance(job.get("remaining_min"), (int, float)) else None
    return dict({"printer_state": printer_state(st), "pause_reason": (st or {}).get("pause_reason") if job.get("paused") else None, "progress": job.get("progress") if isinstance(job.get("progress"), (int, float)) else None,
            "remaining_min": rem, "finish": _finish(rem, now) if job else None, "job": job.get("name") or None,
            "layer": "%s/%s" % (job.get("layer"), job.get("layers")) if job.get("layers") else None,
            "nozzle_temp": rnd(temps.get("curr_nozzle_temp")), "bed_temp": rnd(temps.get("curr_hotbed_temp")),
            "queue_state": sm.get("text") or "keine", "queue_remaining_min": round((sm.get("remaining_s") or 0) / 60),
            "plates": "%d/%d" % (sm.get("done") or 0, sm.get("total") or 0), "plates_done": sm.get("done") or 0,
            "filament_low": "ON" if filament_check(queue, spool_view) else "OFF", "filament_note": "; ".join(filament_check(queue, spool_view)) or None,
            "schedule_start": datetime.datetime.fromtimestamp(int(plan["start_at"]), datetime.timezone.utc).isoformat(timespec="seconds")
            if plan and plan.get("state") in ("wait", "drying", "heating") else None,
            "schedule_state": SCHEDULE_STATE.get((plan or {}).get("state"), "keiner"), "schedule_note": (plan or {}).get("note"),
            "plates_total": sm.get("total") or 0, "queue_current": sm.get("current"), "queue_next": sm.get("next"),
            "bed_clear": "ON" if sm.get("bed_clear") or (queue or {}).get("bed_clear") else "OFF"}, **month_values(spool_view), **machine_values(st))


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

    def __init__(self, cfg, status_fn, queue_fn, spools_fn, loop_s=LOOP_S, every_s=STATE_EVERY_S, image_fn=None, control_fn=None, plan_fn=None):
        self.cfg, self.status_fn, self.queue_fn, self.spools_fn, self.image_fn = cfg, status_fn, queue_fn, spools_fn, image_fn
        self.plan_fn = plan_fn
        self.control_fn = control_fn if cfg.get("control") else None   # nur, wenn ausdrücklich eingeschaltet
        self.loop_s, self.every_s = loop_s, every_s
        b = cfg["base"]
        self.t_avail, self.t_state, self.t_slot, self.t_image, self.t_cmd = b + "/availability", b + "/state", b + "/slot/%d", b + "/progress_image", b + "/cmd"
        self.client, self.connected, self.need_discovery = None, False, True
        self.t_event, self.prev_st = b + "/event", None
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
        aces = len((st or {}).get("ace") or [])
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
            if key in ("printer_state", "queue_state", "month_prints", "filament_low", "schedule_state"):
                c["json_attributes_topic"] = self.t_state
            out["%s/%s/%s/%s/config" % (prefix, comp, base, key)] = c
        out["%s/event/%s/print_event/config" % (prefix, base)] = dict(
            common, name="Druck-Ereignis", unique_id=base + "_print_event", default_entity_id="event." + base + "_print_event",
            state_topic=self.t_event, event_types=EVENT_TYPES, icon="mdi:printer-3d-nozzle-alert")
        if self.image_fn:
            out["%s/camera/%s/progress/config" % (prefix, base)] = dict(
                common, name="3D-Fortschritt", unique_id=base + "_progress", default_entity_id="camera." + base + "_progress",
                topic=self.t_image, icon="mdi:cube-outline")
        if self.control_fn:
            for key, name, icon in (("pause", "Druck pausieren", "mdi:pause"), ("resume", "Druck fortsetzen", "mdi:play")):
                out["%s/button/%s/%s/config" % (prefix, base, key)] = dict(
                    common, name=name, unique_id=base + "_" + key, default_entity_id="button." + base + "_" + key,
                    command_topic=self.t_cmd, payload_press=key, icon=icon)
        for i in range(1, aces + 1):
            for key, name, unit, dclass, icon in (("ace%d_temp" % i, "ACE %d Temperatur" % i, "°C", "temperature", "mdi:thermometer"),
                                                  ("ace%d_drying" % i, "ACE %d Trocknen" % i, None, None, "mdi:heat-wave")):
                c = dict(common, name=name, unique_id=base + "_" + key, default_entity_id="sensor." + base + "_" + key,
                         state_topic=self.t_state, value_template="{{ value_json.%s }}" % key, icon=icon)
                if unit:
                    c.update(unit_of_measurement=unit, device_class=dclass, state_class="measurement")
                out["%s/sensor/%s/%s/config" % (prefix, base, key)] = c
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
            if self.control_fn:
                client.subscribe(self.t_cmd, qos=1)
            self.last_error = None

        def on_disconnect(*_a):
            self.connected = False

        def on_message(_c, _u, msg):
            if msg.topic == cfg["prefix"] + "/status" and msg.payload == b"online":
                self.need_discovery, self.last = True, None
            elif msg.topic == self.t_cmd and self.control_fn and msg.payload in (b"pause", b"resume") and not msg.retain:
                act = msg.payload.decode()
                threading.Thread(target=self._control, args=(act,), daemon=True).start()   # nicht im Netz-Thread warten

        c.on_connect, c.on_disconnect, c.on_message = on_connect, on_disconnect, on_message
        c.connect_async(cfg["host"], cfg["port"], keepalive=60)
        c.loop_start()                                   # verbindet selbst neu (auch den ersten Versuch)
        self.client = c

    def _control(self, action):
        try:
            self.control_fn(action)
            self._log("Befehl aus Home Assistant: %s" % action)
        except Exception as e:   # z. B. kein Druck läuft – nur melden
            self._log("Befehl %s abgelehnt: %s" % (action, str(e) or type(e).__name__))

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
        state = payload(st, self.queue_fn(), now, spool_view, self.plan_fn() if self.plan_fn else None)
        slots = slot_payloads(st, spool_view)
        dev = self.device(st)
        key = (dev["name"], dev.get("sw_version"), tuple(slots), len((st or {}).get("ace") or []))
        if self.need_discovery or key != self.disc_key:
            for topic, cfg in self.discovery(st, slots).items():
                self._pub(topic, cfg, retain=True)
            self._pub(self.t_avail, "online", retain=True)
            self.need_discovery, self.disc_key, self.last, self.slots_last = False, key, None, {}
        # Ereignisse (pausiert mit Grund, fortgesetzt, fertig, abgebrochen) – einmal je Wechsel, nicht retained
        for etype, data in print_events(self.prev_st, st):
            self._pub(self.t_event, dict(data, event_type=etype))
        if st:
            self.prev_st = st
        sent = False
        if state != self.last or now - self.last_time >= self.every_s:
            self._pub(self.t_state, state)
            self.last, self.last_time, sent = state, now, True
        for n, sp in slots.items():
            if sp != self.slots_last.get(n) or sent:
                self._pub(self.t_slot % n, sp)
                self.slots_last[n] = sp
        if self.image_fn:
            try:
                img = self.image_fn(st)          # nur bei neuer Schicht ein Bild, sonst None
            except Exception as e:               # das Bild darf den Stand nie aufhalten
                img = None
                self._log("Fortschrittsbild: " + (str(e) or type(e).__name__))
            if img:
                self.client.publish(self.t_image, img, qos=0, retain=True)
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


def start(status_fn, queue_fn, spools_fn, env=None, image_fn=None, control_fn=None, plan_fn=None):
    """Aus serve.py: startet den Publisher, wenn MQTT_HOST gesetzt ist. Gibt (Publisher|None, Meldung) zurück."""
    cfg = config_from_env(env)
    if not cfg:
        return None, None
    if not AVAILABLE:
        return None, "Home Assistant (MQTT): braucht paho-mqtt (pip install -r requirements.txt) – aus"
    p = Publisher(cfg, status_fn, queue_fn, spools_fn, image_fn=image_fn, control_fn=control_fn, plan_fn=plan_fn).start()
    return p, "Home Assistant (MQTT): %s:%d, Themen %s/…, Discovery %s/…%s" % (cfg["host"], cfg["port"], cfg["base"], cfg["prefix"],
                                                                         ", Pausieren/Fortsetzen aus Home Assistant erlaubt" if cfg["control"] and control_fn else "")
