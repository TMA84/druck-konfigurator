"""Anycubic-Werksfirmware im LAN-Modus: Filament-Belegung lesen, ACE-Einstellungen schreiben.

Ablauf (beobachtetes Protokoll, beschrieben in PROTOCOL.md des Projekts anycubic-lan, MIT):
1. GET  http://<drucker>:18910/info          → Token, Steuer-URL, Modell (nur im LAN-Modus "ctrlType": "lan")
2. POST <ctrlInfoUrl>?ts&nonce&sign&did      → AES-128-CBC-verschlüsselte MQTT-Zugangsdaten
3. MQTT 3.1.1 über TLS (Port 9883, selbst signiertes Zertifikat) → Anfragen je Art, Antworten als Bericht

Die Zugangsdaten wechseln; sie werden nur für die Dauer einer Anfrage gehalten, nie gespeichert.
Die signierte Upload-URL (fileUploadurl) wird aus allen Antworten entfernt.
Braucht paho-mqtt und cryptography (requirements.txt); ohne sie meldet AVAILABLE False.
Je Drucker hält PrinterLink eine Verbindung offen (Abfrage alle 5 s, Ende nach 10 min ohne Zugriff).
"""
import base64
import hashlib
import os
import re
import ipaddress
import collections
import json
import secrets
import socket
import ssl
import string
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

try:
    import paho.mqtt.client as mqtt
    from cryptography.hazmat.primitives import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    AVAILABLE = True
except ImportError:  # ohne Pakete läuft der Server weiter, nur der LAN-Modus fehlt
    AVAILABLE = False

INFO_PORT = 18910
DEFAULT_BROKER_PORT = 9883
HTTP_TIMEOUT = 10
MQTT_CONNECT_TIMEOUT = 15
TOPIC_PREFIX = "anycubic/anycubicCloud/v1"
# Schreiben: siehe WRITABLE unten. Bis 2026-09-28 nur Einstellungen; seitdem auf Wunsch die Werkbank
# (Druckauftrag, Temperaturen, Lüfter, Licht, Achsen, ACE) – alle Werte werden geprüft.
SECRET_KEYS = {"fileUploadurl", "token"}


class LanError(Exception):
    """kind: unreachable | lan_off | unsupported | rejected | bad_response | timeout | forbidden | missing_libs"""

    def __init__(self, message, kind):
        super().__init__(message)
        self.kind = kind


# ---------- Adresse prüfen ----------
def check_host(host):
    """Nur Geräte im Heimnetz: private oder lokale Adressen (der Server soll nicht beliebige Ziele ansprechen)."""
    host = (host or "").strip()
    if not host or len(host) > 253 or not all(c.isalnum() or c in ".-:" for c in host):
        raise LanError("Ungültige Adresse", "forbidden")
    try:
        addr = ipaddress.ip_address(socket.gethostbyname(host))
    except (socket.gaierror, UnicodeError, ValueError):
        raise LanError("Adresse " + host + " nicht gefunden", "unreachable")
    if not (addr.is_private or addr.is_loopback) or addr.is_multicast or addr.is_unspecified:
        raise LanError("Nur Drucker im Heimnetz (private IP-Adressen) sind erlaubt", "forbidden")
    return host


# ---------- Handshake ----------
def _reason(err):
    """Verständlicher Grund für einen Verbindungsfehler (für die Meldung im Tool)."""
    r = getattr(err, "reason", err)
    if isinstance(r, ConnectionRefusedError):
        return "Verbindung abgelehnt – LAN-Modus an? Läuft das Tool in einem Container, der das Heimnetz nicht erreicht?"
    if isinstance(r, (socket.timeout, TimeoutError)) or "timed out" in str(r):
        return "keine Antwort (Zeitüberschreitung) – eingeschaltet, im selben Netz?"
    return str(r) or type(r).__name__


def _http(url, method="GET", attempts=2):
    # Der Kobra S1 antwortet gelegentlich nicht (beobachtet 2026-09-26 und 2026-09-28) – einmal wiederholen
    for attempt in range(attempts):
        req = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None)
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as res:
                body = res.read()
            break
        except urllib.error.HTTPError as e:
            raise LanError("Drucker antwortet mit HTTP " + str(e.code), "bad_response")
        except (urllib.error.URLError, OSError) as e:
            if attempt + 1 >= attempts:
                raise LanError("Drucker nicht erreichbar: " + _reason(e), "unreachable")
            time.sleep(1)
    try:
        doc = json.loads(body)  # ohne JSON-Content-Type ausgeliefert
    except ValueError:
        raise LanError("Antwort des Druckers ist kein JSON", "bad_response")
    if not isinstance(doc, dict):
        raise LanError("Antwort des Druckers unerwartet", "bad_response")
    return doc


def discovery(host):
    doc = _http("http://" + host + ":" + str(INFO_PORT) + "/info")
    if doc.get("ctrlType") == "cloud":
        raise LanError("LAN-Modus ist am Drucker aus (Einstellungen → Netzwerk → LAN-Modus)", "lan_off")
    if not all(doc.get(k) for k in ("token", "ctrlInfoUrl", "modelId")) or len(str(doc["token"])) != 32:
        raise LanError("Dieser Drucker unterstützt den LAN-Zugang nicht (ältere Firmware oder Modell)", "unsupported")
    return doc


def signature(signing_key, ts, nonce):
    keyed = hashlib.md5(signing_key.encode()).hexdigest()
    return hashlib.md5((keyed + str(ts) + nonce).encode()).hexdigest()


def build_iv(source):
    return source.encode()[:16].ljust(16, b"\x00")


def decrypt_info(info_b64, aes_key, iv_source):
    try:
        raw = base64.b64decode(info_b64)
        dec = Cipher(algorithms.AES(aes_key.encode()), modes.CBC(build_iv(iv_source))).decryptor()
        padded = dec.update(raw) + dec.finalize()
        unpad = padding.PKCS7(128).unpadder()
        creds = json.loads((unpad.update(padded) + unpad.finalize()).decode())
    except Exception:
        raise LanError("Zugangsdaten des Druckers nicht entschlüsselbar", "bad_response")
    if not isinstance(creds, dict) or not all(creds.get(k) for k in ("broker", "username", "password", "deviceId")):
        raise LanError("Zugangsdaten des Druckers unvollständig", "bad_response")
    return creds


def parse_broker(url):
    u = urllib.parse.urlparse(url)
    if u.scheme not in ("mqtt", "mqtts") or not u.hostname:
        raise LanError("Unbekannte Broker-Adresse", "bad_response")
    return u.hostname, u.port or DEFAULT_BROKER_PORT, u.scheme == "mqtts"


def handshake(host):
    doc = discovery(host)
    token = str(doc["token"])
    ts = int(time.time() * 1000)
    nonce = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(6))
    did = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(32))
    query = urllib.parse.urlencode([("ts", ts), ("nonce", nonce), ("sign", signature(token[:16], ts, nonce)), ("did", did)])
    ctrl = str(doc["ctrlInfoUrl"])
    res = _http(ctrl + ("&" if "?" in ctrl else "?") + query, "POST")
    if res.get("code") != 200:
        raise LanError("Drucker lehnt die Anmeldung ab: " + str(res.get("message") or res.get("code")), "rejected")
    data = res.get("data") or {}
    if not data.get("info") or not data.get("token"):
        raise LanError("Anmeldeantwort des Druckers unvollständig", "bad_response")
    creds = decrypt_info(data["info"], token[16:32], str(data["token"]))
    b_host, b_port, b_tls = parse_broker(creds["broker"])
    # Der Broker liegt auf dem Drucker; zeigt die Antwort woandershin, trotzdem nur im Heimnetz verbinden
    check_host(b_host)
    return {"discovery": doc, "model_id": str(doc["modelId"]), "device_id": str(creds["deviceId"]),
            "username": creds["username"], "password": creds["password"], "broker": (b_host, b_port, b_tls)}


# ---------- MQTT-Sitzung ----------
def redact(obj):
    if isinstance(obj, dict):
        return {k: ("***" if k in SECRET_KEYS else redact(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


# ---------- Stehende Verbindung je Drucker ----------
# Die Werkbank fragt alle paar Sekunden; eine Anmeldung je Anfrage wäre langsam und belastet den Drucker.
# Je Drucker eine MQTT-Verbindung, die den Stand alle POLL_S Sekunden abfragt, Befehle mit msgid bestätigt
# und sich nach IDLE_S ohne Zugriff selbst beendet. Neue Anmeldung bei Verbindungsabbruch (Zugangsdaten wechseln).
POLL_S = 5
IDLE_S = 600
POLL_QUERIES = [("info", "query"), ("multiColorBox", "getInfo"), ("peripherie", "query"), ("tempature", "query"),
                ("fan", "query"), ("light", "query")]
FIRST_DATA_S = 12
# Ohne Verbindung (Drucker aus, Neustart): nach so vielen Sekunden baut die nächste Abfrage die Verbindung ganz neu auf
RELINK_S = 10
_links, _links_lock = {}, threading.Lock()


class PrinterLink:
    def __init__(self, host):
        self.host = host
        self.lock = threading.Lock()
        self.reports = {}          # Art → letzter Bericht (ohne Geheimnisse)
        self.waiters = {}          # msgid → [Event, Antwort]
        self.waiters_ka = {}       # (Art, Aktion) → [[Event, Antwort], …] – Antworten ohne unsere msgid
        self.recent = collections.deque(maxlen=40)   # (Zeit, Art, Aktion, msgid?, state, code) – zur Fehlersuche
        self.seen = {}             # Art → Zeitpunkt des letzten Berichts
        self.pos_until = 0         # bis dahin Kopfposition auch während des Drucks abfragen (status(…, pos=True))
        self.skipped = {}          # Auftrag (task_id) → übersprungene Objekte, die das Tool gesendet hat (skip/start)
        self.skipped_at = {}       # Auftrag → {Objekt: Schicht des Druckers beim Überspringen} (für den 3D-Fortschritt)
        self.connected = threading.Event()
        self.first = threading.Event()
        self.error = None
        self.error_kind = None
        self.error_at = 0
        self.client = None
        self.web_topic = None
        self.model_id = None
        self.discovery = {}
        self.last_access = time.time()
        self.stopped = False
        self.thread = threading.Thread(target=self._run, daemon=True, name="printer-" + host)
        self.thread.start()

    # -- Verbindung --
    def _connect(self):
        if not AVAILABLE:
            raise LanError("LAN-Modus braucht die Python-Pakete paho-mqtt und cryptography (pip install -r requirements.txt)", "missing_libs")
        hs = handshake(self.host)
        b_host, b_port, b_tls = hs["broker"]
        self.model_id = hs["model_id"]
        self.discovery = redact({k: v for k, v in hs["discovery"].items() if k != "ctrlInfoUrl"})
        self.web_topic = TOPIC_PREFIX + "/web/printer/" + hs["model_id"] + "/" + hs["device_id"] + "/"
        # Druckstart kommt wie von Anycubics Slicer über den Kanal „slicer“ (beobachtet in anycubic-orca-plugin, kobra-connect)
        self.slicer_topic = TOPIC_PREFIX + "/slicer/printer/" + hs["model_id"] + "/" + hs["device_id"] + "/"
        self._upload_url = hs["discovery"].get("fileUploadurl")   # geheim: nie in Antworten oder Protokolle
        report_topic = TOPIC_PREFIX + "/printer/public/" + hs["model_id"] + "/" + hs["device_id"] + "/#"
        failed = []

        def on_connect(client, _u, _f, reason, _p=None):
            if getattr(reason, "is_failure", False) or (isinstance(reason, int) and reason != 0):
                failed.append(str(reason))
            else:
                client.subscribe(report_topic, qos=1)
            self.connected.set()

        def on_disconnect(*_a):
            self.connected.clear()

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="druck-konfigurator-" + secrets.token_hex(6), protocol=mqtt.MQTTv311)
        client.username_pw_set(hs["username"], hs["password"])
        if b_tls:
            # selbst signiertes Zertifikat ohne festen Namen – verschlüsselt, aber ohne Prüfung (bleibt im Heimnetz)
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            client.tls_set_context(ctx)
        client.on_connect, client.on_disconnect, client.on_message = on_connect, on_disconnect, self._on_message
        self.connected.clear()
        try:
            client.connect(b_host, b_port, keepalive=60)
        except (OSError, ssl.SSLError) as e:
            raise LanError("MQTT-Verbindung zum Drucker fehlgeschlagen: " + str(e), "unreachable")
        client.loop_start()
        if not self.connected.wait(MQTT_CONNECT_TIMEOUT) or failed:
            client.loop_stop()
            raise LanError("Drucker lehnt die MQTT-Anmeldung ab" + (" (" + failed[0] + ")" if failed else ""), "rejected")
        time.sleep(0.2)  # Abo bestätigt, bevor die ersten Antworten kommen
        self.client = client

    def _run(self):
        backoff = 5
        while not self.stopped:
            try:
                self._connect()
                self.error, self.error_kind, backoff = None, None, 5
                while not self.stopped and self.connected.is_set():
                    if time.time() - self.last_access > IDLE_S:
                        self.stopped = True
                        break
                    for kind, action in POLL_QUERIES:
                        self.publish(kind, action, None)
                    # Kopfposition: ohne Druck immer; während des Drucks nur auf Wunsch (Schalter „Echte Kopfposition“
                    # in der 3D-Ansicht; am S1 mit Firmware 2.7.2.7 geprüft 2026-09-29: frische Werte während des Drucks)
                    if self.reports.get("info") and (self._printing() is False or time.time() < self.pos_until):
                        self.publish("axis", "query", None)
                    for _ in range(POLL_S * 10):
                        if self.stopped or not self.connected.is_set():
                            break
                        time.sleep(0.1)
            except LanError as e:
                self.error, self.error_kind, self.error_at = str(e), e.kind, time.time()
                self.first.set()                               # wartende Anfragen bekommen den Fehler
                if e.kind in ("lan_off", "unsupported", "rejected", "missing_libs", "forbidden"):
                    self.stopped = True                        # bleibt so, bis der Nutzer etwas ändert
            except Exception as e:   # unerwartet (z. B. beim Neustart des Druckers) – der Thread darf nicht sterben
                self.error, self.error_kind, self.error_at = "Verbindungsfehler: " + _reason(e), "unreachable", time.time()
                self.first.set()
            finally:
                # Verbindung weg: alten Stand verwerfen – sonst zeigt die Seite nach einem Neustart des Druckers weiter
                # „busy“ von vorher (beobachtet 2026-10-01, Kobra S1)
                with self.lock:
                    had = bool(self.reports)
                    self.reports.clear()
                    self.seen.clear()
                if had and not self.error and not self.stopped:
                    self.error, self.error_kind, self.error_at = "Verbindung zum Drucker unterbrochen", "unreachable", time.time()
                if self.client:
                    self.client.loop_stop()
                    try:
                        self.client.disconnect()
                    except Exception:
                        pass
                    self.client = None
            if not self.stopped:
                for _ in range(backoff * 10):
                    if self.stopped:
                        break
                    time.sleep(0.1)
                backoff = min(backoff * 2, 60)
        with _links_lock:
            if _links.get(self.host) is self:
                del _links[self.host]

    def _on_message(self, _c, _u, msg):
        try:
            doc = json.loads(msg.payload)
        except ValueError:
            return
        if not isinstance(doc, dict) or len(doc) <= 1:
            return  # reine Quittung {"msgid": ""}
        kind = doc.get("type")
        if kind is None:
            kind = next((seg for seg in reversed(msg.topic.split("/")) if seg not in ("report", "response")), "")
        if not kind:
            return  # leere Berichte (Kobra X) tragen nichts
        doc = redact(doc)
        with self.lock:
            self.recent.append((time.time(), kind, doc.get("action"), bool(doc.get("msgid")), doc.get("state"), doc.get("code")))
            self.seen[kind] = time.time()
            # Die Box-Liste nur aus Berichten, die sie vollständig enthalten (getInfo …); Bestätigungen und
            # Teilmeldungen (setInfo ohne Daten, autoUpdateInfo …) unter eigenem Schlüssel
            boxes = (doc.get("data") or {}).get("multi_color_box") if isinstance(doc.get("data"), dict) else None
            if kind == "multiColorBox" and not (isinstance(boxes, list) and boxes and all("slots" in b for b in boxes)):
                self.reports["multiColorBox:" + str(doc.get("action"))] = doc
            elif kind in ("light", "axis", "fan", "tempature") and doc.get("action") not in ("query", "report", "auto", None) and kind in self.reports:
                self.reports[kind + ":" + str(doc.get("action"))] = doc     # Bestätigung eines Befehls ≠ Stand
            else:
                self.reports[kind] = doc
            w = self.waiters.get(doc.get("msgid") or "")
            if not w:
                # Die Werksfirmware bestätigt manche Befehle (Licht, Trocknen) ohne die msgid der Anfrage
                # (beobachtet 2026-09-29, Firmware 2.7.2.7): dann gilt die nächste Antwort derselben Art und Aktion
                pending = self.waiters_ka.get((kind, doc.get("action")))
                w = next((x for x in pending or [] if not x[0].is_set()), None)
            if w:
                w[1] = doc
                w[0].set()
            if "info" in self.reports and "multiColorBox" in self.reports:
                self.first.set()

    # -- Senden --
    def publish(self, kind, action, data, msgid=None, channel="web"):
        if not self.client:
            raise LanError("Keine Verbindung zum Drucker", "unreachable")
        msg = {"type": kind, "action": action, "timestamp": int(time.time() * 1000), "msgid": msgid or str(uuid.uuid4()),
               "data": data if data is not None else {}}
        self.client.publish((self.slicer_topic if channel == "slicer" else self.web_topic) + kind, json.dumps(msg), qos=1)

    def request(self, kind, action, data, timeout=10, channel="web"):
        if not self.connected.wait(MQTT_CONNECT_TIMEOUT) or not self.client:
            raise LanError(self.error or "Keine Verbindung zum Drucker", "unreachable")
        msgid = str(uuid.uuid4())
        w = [threading.Event(), None]
        with self.lock:
            self.waiters[msgid] = w
            self.waiters_ka.setdefault((kind, action), []).append(w)
        try:
            self.publish(kind, action, data, msgid, channel)
            if not w[0].wait(timeout):
                raise LanError("Drucker hat den Befehl nicht bestätigt", "timeout")
            return w[1]
        finally:
            with self.lock:
                self.waiters.pop(msgid, None)
                lst = self.waiters_ka.get((kind, action)) or []
                if w in lst:
                    lst.remove(w)

    # -- Lesen --
    def data(self, kind):
        with self.lock:
            return ((self.reports.get(kind) or {}).get("data")) or {}

    def _printing(self):
        info = self.data("info")
        return bool(info.get("project")) if info else None

    def project(self):
        return self.data("info").get("project") or None


def close_all():
    """Alle Verbindungen beenden (Tests; oder wenn sich die Adresse ändert)."""
    with _links_lock:
        links = list(_links.values())
        _links.clear()
    for link in links:
        link.stopped = True
        if link.client:
            link.connected.clear()


def get_link(host):
    host = check_host(host)
    with _links_lock:
        link = _links.get(host)
        # neu aufbauen: beendet, Thread tot oder seit RELINK_S ohne Verbindung (z. B. Drucker neu gestartet)
        stale = link is not None and (not link.thread.is_alive() or (not link.connected.is_set() and link.error and time.time() - link.error_at > RELINK_S))
        if link is None or link.stopped or stale:
            if link is not None:
                link.stopped = True
            link = _links[host] = PrinterLink(host)
        link.last_access = time.time()
    return link


def _ready(host):
    link = get_link(host)
    fresh = not link.first.is_set()
    link.first.wait(FIRST_DATA_S)
    if fresh:   # erste Abfrage: den übrigen Antworten kurz Zeit geben
        for _ in range(20):
            if all(k in link.reports for k, _a in POLL_QUERIES):
                break
            time.sleep(0.1)
    if not link.reports and link.error:
        raise LanError(link.error, link.error_kind or "unreachable")
    if not link.reports:
        raise LanError("Drucker antwortet nicht (keine Daten nach %d s)" % FIRST_DATA_S, "timeout")
    return link


# ---------- Auswertung ----------
def _hex(rgb):
    try:
        return "#" + "".join("%02X" % max(0, min(255, int(c))) for c in rgb[:3])
    except (TypeError, ValueError):
        return ""


def ace_boxes(reports):
    """multiColorBox-Berichte → [{id, model_id, auto_feed, loaded_slot, temp, drying, slots:[…]}] (letzter Stand)."""
    boxes = {}
    for rep in reports.get("multiColorBox", []):
        for box in ((rep.get("data") or {}).get("multi_color_box") or []):
            if isinstance(box, dict) and "id" in box:
                boxes[box["id"]] = box
    out = []
    for bid in sorted(boxes):
        b = boxes[bid]
        loaded = b.get("loaded_slot", -1)
        slots = []
        for s in sorted((b.get("slots") or []), key=lambda s: s.get("index", 0)):
            empty = s.get("edit_status") == 2 or not s.get("type")
            slots.append({"index": s.get("index"), "type": "" if empty else str(s.get("type", "")).upper(),
                          "colour": "" if empty else _hex(s.get("color") or []), "present": not empty,
                          # status 5 heißt am echten S1 (Firmware 2.7.2.7, 2026-09-28) nur „bereit“ – bei allen
                          # belegten Slots. Im Drucker ist nur der Slot aus loaded_slot (−1 = keiner gemeldet).
                          "loaded": isinstance(loaded, int) and loaded >= 0 and s.get("index") == loaded,
                          "rfid": s.get("edit_status") == 0, "sku": s.get("sku", "")})
        out.append({"id": bid, "model_id": b.get("model_id"), "auto_feed": b.get("auto_feed"), "loaded_slot": loaded,
                    "temp": b.get("temp"), "drying": b.get("drying_status"), "slots": slots})
    return out


def all_slots(boxes):
    """Slots aller ACE-Einheiten hintereinander mit durchgehender Nummer (index; Box 2, Slot 1 = 4) – wie im Browser
    (js/printer-link.js aceSlots). box/local: Einheit und Slot darin, für Befehle an die ACE."""
    out, base = [], 0
    for b in boxes:
        for s in b["slots"]:
            out.append(dict(s, index=base + (s.get("index") or 0), box=b["id"], local=s.get("index")))
        base += max(4, len(b["slots"]))
    return out


def loaded_slot(boxes):
    """Durchgehende Nummer des Slots, der gerade im Drucker ist (−1 = keiner)."""
    return next((s["index"] for s in all_slots(boxes) if s.get("loaded")), -1)


PRINT_STATUS = {1: "druckt", 2: "fertig", 3: "abgebrochen", 4: "lädt herunter", 5: "prüft", 6: "heizt vor", 7: "slict", 9: "nivelliert"}


def _reported_skips(project):
    """Übersprungene Objekte, falls die Firmware sie im Auftrag meldet (Feldname je nach Version) – sonst []."""
    for k in ("objects_skip_parts", "model_objects_skip_parts", "skip_parts"):
        v = (project or {}).get(k)
        if isinstance(v, list):
            return sorted({int(x) for x in v if str(x).strip().isdigit()})
    return []


def _job(project):
    if not project:
        return None
    name = str(project.get("filename") or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"(\.(gcode|3mf|gco|g))+$", "", name, flags=re.I)
    return {"name": name, "task_id": project.get("task_id"), "progress": project.get("progress"),
            "layer": project.get("curr_layer"), "layers": project.get("total_layers"),
            "elapsed_min": project.get("print_time"), "remaining_min": project.get("remain_time"),
            "state": project.get("state"), "status": PRINT_STATUS.get(project.get("print_status"), project.get("print_status")),
            "paused": bool(project.get("pause")), "filament_mm": project.get("supplies_usage"),
            "skipped_reported": _reported_skips(project)}


def _job_with_skips(link, project):
    job = _job(project)
    if job:
        sent = sorted(link.skipped.get(str(job.get("task_id")), set()))
        job["skipped"] = sorted(set(sent) | set(job["skipped_reported"]))
        job["skipped_at"] = {str(k): v for k, v in link.skipped_at.get(str(job.get("task_id")), {}).items()}
        job["skipped_confirmed"] = bool(job["skipped_reported"])
    return job


POS_WHILE_PRINTING_S = 20   # so lange nach der letzten Anfrage mit pos=True weiter abfragen


def status(host, pos=False):
    """Gesamter Stand für Belegung und Werkbank (aus der stehenden Verbindung).
    pos=True: Kopfposition auch während des Drucks abfragen (für die nächsten POS_WHILE_PRINTING_S Sekunden)."""
    link = _ready(host)
    if pos:
        link.pos_until = time.time() + POS_WHILE_PRINTING_S
    with link.lock:
        reps = dict(link.reports)
        pos_age = time.time() - link.seen["axis"] if "axis" in link.seen else None
        # letzte Meldungen (Art, Aktion, Zustand) – zur Fehlersuche, z. B. was nach einem Abbruch kommt (Rohdaten der Werkbank)
        now = time.time()
        recent = [{"age_s": round(now - ts, 1), "type": k, "action": a, "state": st, "code": c, "own": m} for ts, k, a, m, st, c in link.recent]
    data = lambda k: ((reps.get(k) or {}).get("data")) or {}
    info, peri, temp, fan, light, axis = data("info"), data("peripherie"), data("tempature"), data("fan"), data("light"), data("axis")
    t = info.get("temp") or {}
    temps = {k: temp.get(k, t.get(k)) for k in ("curr_nozzle_temp", "target_nozzle_temp", "curr_hotbed_temp", "target_hotbed_temp")}
    lights = light.get("lights") if isinstance(light.get("lights"), list) else ([light] if light.get("type") is not None else [])
    return {"model": info.get("model") or link.discovery.get("modelName"), "model_id": link.model_id,
            "name": info.get("printerName"), "firmware": info.get("version"), "ip": info.get("ip"),
            "state": info.get("state"), "printing": bool(info.get("project")), "job": _job_with_skips(link, info.get("project")),
            "temps": temps, "fans": {k: fan.get(k, info.get(k)) for k in ("fan_speed_pct", "aux_fan_speed_pct", "box_fan_level")},
            "speed_mode": info.get("print_speed_mode"), "lights": lights,
            "position": (axis.get("coordinates") if isinstance(axis, dict) else None),
            "position_age_s": round(pos_age, 1) if pos_age is not None else None,
            "camera": bool(peri.get("camera")), "has_ace": peri.get("multiColorBox"), "features": info.get("features") or {},
            "ace": ace_boxes({"multiColorBox": [reps["multiColorBox"]]} if "multiColorBox" in reps else {}),
            "connected": link.connected.is_set(), "error": link.error, "missing": [k for k, _ in POLL_QUERIES if k not in reps],
            # Rohdaten zum Nachsehen (z. B. ob die Firmware die Spülmenge meldet); Geheimnisse entfernt
            "raw": {k: [v.get("data")] for k, v in reps.items()}, "recent": recent}


# ---------- Befehle ----------
# Nur diese Befehle, mit geprüften Werten; das Tool baut die Nutzdaten selbst (nichts wird ungeprüft durchgereicht).
MAX_NOZZLE_C, MAX_BED_C, MAX_JOG_MM, MAX_DRY_C, MAX_DRY_MIN = 300, 110, 50, 70, 24 * 60
WRITABLE = {("multiColorBox", "setInfo"), ("multiColorBox", "setAutoFeed"), ("multiColorBox", "setDry"), ("multiColorBox", "feedFilament"),
            ("print", "pause"), ("print", "resume"), ("print", "stop"), ("light", "control"), ("tempature", "set"),
            ("fan", "setSpeed"), ("axis", "move"), ("axis", "turnOff"), ("video", "startCapture"), ("skip", "start")}
VERIFIABLE = {("skip", "start"), ("light", "control"), ("multiColorBox", "setDry"), ("multiColorBox", "setAutoFeed"), ("fan", "setSpeed")}
NOT_WHILE_PRINTING = {("axis", "move"), ("axis", "turnOff"), ("multiColorBox", "feedFilament")}
REFRESH_AFTER = {"multiColorBox": ("multiColorBox", "getInfo"), "light": ("light", "query"), "fan": ("fan", "query"),
                 "tempature": ("tempature", "query"), "axis": ("axis", "query"), "print": ("info", "query"), "skip": ("info", "query")}
# Objekt überspringen (skip/start im Kanal „web“, data {"objects_skip_parts": ["0", "2", …]}): Nummer = Reihenfolge der
# Objekte im G-Code (EXCLUDE_OBJECT_DEFINE, ab 0). Protokoll-Fakt aus anycubic-orca-plugin (dort am echten Drucker
# geprüft; KX-Bridge); gesendet wird wie bei Orca/Bambu die ganze Liste, also auch schon übersprungene Objekte.
MAX_SKIP_PARTS = 64


def _int(v, lo, hi, name):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != int(v) or not lo <= v <= hi:
        raise LanError("%s muss eine ganze Zahl von %d bis %d sein" % (name, lo, hi), "forbidden")
    return int(v)


def _boxes(data):
    boxes = (data or {}).get("multi_color_box")
    if not isinstance(boxes, list) or not boxes or not all(isinstance(b, dict) and isinstance(b.get("id"), int) for b in boxes):
        raise LanError("Befehl braucht multi_color_box mit Box-id", "forbidden")
    return boxes


def _payload(kind, action, data, link):
    """Geprüfte Nutzdaten für einen freigegebenen Befehl."""
    if (kind, action) not in WRITABLE:
        raise LanError("Dieser Befehl ist nicht freigegeben: " + str(kind) + "/" + str(action), "forbidden")
    d = data or {}
    if (kind, action) in NOT_WHILE_PRINTING and link and link._printing():
        raise LanError("Während eines Drucks gesperrt", "forbidden")
    if kind == "skip":
        job = link and link.project()
        if not job or not job.get("task_id"):
            raise LanError("Es läuft kein Druckauftrag", "forbidden")
        parts = d.get("parts")
        if not isinstance(parts, list) or not parts or len(parts) > MAX_SKIP_PARTS:
            raise LanError("Objekt-Nummern fehlen", "forbidden")
        new = {_int(p, 0, MAX_SKIP_PARTS - 1, "Objekt") for p in parts}
        done = set(link.skipped.get(str(job["task_id"]), set())) | set(_reported_skips(job))
        return {"objects_skip_parts": [str(p) for p in sorted(done | new)]}
    if kind == "print":
        job = link and link.project()
        if not job or not job.get("task_id"):
            raise LanError("Es läuft kein Druckauftrag", "forbidden")
        return {"taskid": str(job["task_id"])}
    if kind == "light":
        on = _int(d.get("status"), 0, 1, "status")
        return {"type": _int(d.get("type", 2), 0, 9, "type"), "status": on, "brightness": _int(d.get("brightness", 100), 0, 100, "brightness") if on else 0}
    if kind == "tempature":
        t = _int(d.get("type"), 0, 2, "type")   # 0 Düse, 1 Bett, 2 beide
        return {"type": t, "target_nozzle_temp": _int(d.get("target_nozzle_temp", 0), 0, MAX_NOZZLE_C, "Düsentemperatur"),
                "target_hotbed_temp": _int(d.get("target_hotbed_temp", 0), 0, MAX_BED_C, "Betttemperatur")}
    if kind == "fan":
        keys = [k for k in ("fan_speed_pct", "aux_fan_speed_pct", "box_fan_level") if k in d]
        if len(keys) != 1:
            raise LanError("Genau ein Lüfter je Befehl", "forbidden")
        return {keys[0]: _int(d[keys[0]], 0, 100, keys[0])}
    if (kind, action) == ("axis", "move"):
        mt = _int(d.get("move_type"), 0, 2, "move_type")
        return {"axis": _int(d.get("axis"), 1, 4, "axis"), "move_type": mt, "distance": 0 if mt == 2 else _int(d.get("distance"), 1, MAX_JOG_MM, "Weg (mm)")}
    if (kind, action) == ("axis", "turnOff"):
        return None
    if kind == "video":
        return {}
    boxes = _boxes(d)
    out = []
    for b in boxes:
        if action == "setAutoFeed":
            out.append({"id": b["id"], "auto_feed": _int(b.get("auto_feed"), 0, 1, "auto_feed")})
        elif action == "setInfo":
            slots = []
            for s in b.get("slots") or []:
                ok = isinstance(s.get("index"), int) and 0 <= s["index"] < 16 and isinstance(s.get("type"), str) and len(s["type"]) <= 16 \
                    and isinstance(s.get("color"), list) and len(s["color"]) == 3 and all(isinstance(c, int) and 0 <= c <= 255 for c in s["color"])
                if not ok:
                    raise LanError("Slot-Angabe ungültig (index, type, color [r,g,b])", "forbidden")
                slots.append({"index": s["index"], "type": s["type"], "color": s["color"]})
            out.append({"id": b["id"], "slots": slots})
        elif action == "setDry":
            ds = b.get("drying_status") or {}
            on = _int(ds.get("status"), 0, 1, "status")
            out.append({"id": b["id"], "drying_status": {"status": on, "target_temp": _int(ds.get("target_temp", 0), 0, MAX_DRY_C, "Trockentemperatur") if on else 0,
                                                          "duration": _int(ds.get("duration", 0), 0, MAX_DRY_MIN, "Dauer (min)") if on else 0, "remain_time": None}})
        elif action == "feedFilament":
            fs = b.get("feed_status") or {}
            out.append({"id": b["id"], "feed_status": {"slot_index": _int(fs.get("slot_index"), 0, 15, "slot_index"), "type": _int(fs.get("type"), 1, 3, "type")}})
    return {"multi_color_box": out}


def command(host, kind, action, data):
    if (kind, action) not in WRITABLE:
        raise LanError("Dieser Befehl ist nicht freigegeben: " + str(kind) + "/" + str(action), "forbidden")
    link = _ready(host)
    payload = _payload(kind, action, data, link)
    sent = time.time()
    try:
        rep = link.request(kind, action, payload, timeout=5 if (kind, action) in VERIFIABLE else 10)
    except LanError as e:
        if e.kind != "timeout":
            raise
        rep = None
    ok = rep is not None and rep.get("code", 200) == 200 and rep.get("state") not in ("failed",)
    # Stand des betroffenen Bereichs gleich neu holen, damit die Anzeige nicht bis zur nächsten Abfrage hinterherhinkt
    kind_q, action_q = REFRESH_AFTER.get(kind, (None, None))
    if kind_q:
        try:
            link.request(kind_q, action_q, None, timeout=4)
        except LanError:
            pass
    if kind == "skip":
        # Merken, was gesendet wurde – die Firmware quittiert je nach Version nicht; die Anzeige zeigt es als „gesendet“
        job = link.project() or {}
        parts = {int(x) for x in (payload or {}).get("objects_skip_parts", [])}
        with link.lock:
            key = str(job.get("task_id"))
            link.skipped[key] = parts
            at = link.skipped_at.setdefault(key, {})
            for p in parts:
                at.setdefault(p, job.get("curr_layer") or 0)
        if rep is None or ok:
            reported = set(_reported_skips(link.project()))
            return {"ok": True, "state": "verified" if parts <= reported else "sent", "code": rep and rep.get("code"), "msg": rep and rep.get("msg"),
                    "reply": rep and rep.get("data"), "skipped": sorted(parts)}
    if rep is None:
        # Keine erkennbare Quittung: Die Werksfirmware führt Licht/Trocknen aus, antwortet aber je nach Version
        # anders (ohne msgid, andere Aktion …). Dann zählt, ob der Drucker den neuen Zustand meldet.
        if _took_effect(link, kind, action, payload):
            return {"ok": True, "state": "verified", "code": None, "msg": "Zustand am Drucker bestätigt", "reply": None}
        with link.lock:
            seen = sorted({"%s/%s%s" % (k, a, "" if m else " ohne msgid") for (ts, k, a, m, _s, _c) in link.recent
                           if ts >= sent and (k, a) not in POLL_QUERIES})
        raise LanError("Drucker hat den Befehl nicht bestätigt" + (" (empfangen: " + ", ".join(seen) + ")" if seen else ""), "timeout")
    return {"ok": ok, "state": rep.get("state"), "code": rep.get("code"), "msg": rep.get("msg"), "reply": rep.get("data")}


def _took_effect(link, kind, action, payload):
    """Meldet der Drucker nach dem Befehl den gewünschten Zustand? (nur für Befehle mit ablesbarem Zustand)"""
    if (kind, action) == ("light", "control"):
        light = link.data("light")
        lights = light.get("lights") if isinstance(light.get("lights"), list) else [light]
        return any(isinstance(l, dict) and l.get("type") == payload["type"] and l.get("status") == payload["status"] for l in lights)
    boxes = {b.get("id"): b for b in (link.data("multiColorBox").get("multi_color_box") or []) if isinstance(b, dict)}
    want = (payload or {}).get("multi_color_box") or []
    if (kind, action) == ("multiColorBox", "setDry") and want:
        return all(((boxes.get(w["id"]) or {}).get("drying_status") or {}).get("status") == w["drying_status"]["status"] for w in want)
    if (kind, action) == ("multiColorBox", "setAutoFeed") and want:
        return all((boxes.get(w["id"]) or {}).get("auto_feed") == w["auto_feed"] for w in want)
    if (kind, action) == ("fan", "setSpeed"):
        fan = link.data("fan")
        return all(fan.get(k) == v for k, v in payload.items())
    return False


def camera_url(host):
    """Kamera-Adresse (HTTP-FLV, Port 18088) – nur auf dem Drucker selbst; startet die Übertragung."""
    link = _ready(host)
    url = (link.data("info").get("urls") or {}).get("rtspUrl") or link.discovery.get("rtspUrl")
    if not url:
        raise LanError("Drucker meldet keine Kamera", "unsupported")
    u = urllib.parse.urlparse(url)
    if u.hostname != host and u.hostname != (link.data("info").get("ip")):
        raise LanError("Kamera-Adresse zeigt nicht auf den Drucker", "forbidden")
    check_host(u.hostname)
    try:
        link.request("video", "startCapture", {}, timeout=8)
    except LanError:
        pass   # läuft sie schon, antwortet der Drucker teils nicht – dann trotzdem versuchen
    return url


# ---------- Druck senden: G-Code hochladen und starten ----------
# Ablauf wie Anycubics Slicer im LAN-Modus (Fakten aus anycubic-orca-plugin und kobra-connect/docs/mqtt-commands.md,
# eigene Umsetzung): 1. HTTP-POST (multipart: filename, gcode) an die signierte Upload-Adresse aus /info,
# Antwort {"code": 200, "data": {"gcode": <Dateiname>}}; 2. MQTT print/start im Kanal „slicer“ mit Dateiname,
# Größe, MD5 und der Zuordnung Werkzeug (T<n> im G-Code) → ACE-Slot. taskid "-1" = neuer Auftrag.
UPLOAD_TIMEOUT_S = 300
START_WAIT_S = 20


def gcode_facts(path):
    """Aus der Orca-Statistik am Ende: verwendete Werkzeuge, Farben, Filamenttypen, Druckermodell."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        f.seek(max(0, size - 2 * 1024 * 1024))
        tail = f.read().decode("utf-8", "replace")
    def line(key):
        m = re.search(r"^; " + re.escape(key) + r" = (.*)$", tail, re.M)
        return m.group(1).strip() if m else ""
    grams = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", line("filament used [g]"))]
    return {"size": size, "tools": [i for i, g in enumerate(grams) if g > 0],
            "colours": [c.strip() for c in re.split(r"[;,]", line("filament_colour")) if c.strip()],
            "types": [t.strip() for t in re.split(r"[;,]", line("filament_type")) if t.strip()],
            "printer": line("printer_model") or line("printer_settings_id")}


def _md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _upload(link, path, filename):
    """G-Code streamend hochladen (multipart/form-data, ohne Zusatzpakete)."""
    import http.client
    url = link._upload_url
    if not url:
        raise LanError("Drucker nennt keine Upload-Adresse (LAN-Modus an?)", "unsupported")
    u = urllib.parse.urlparse(url)
    if u.hostname not in (link.host, link.data("info").get("ip")):
        raise LanError("Upload-Adresse zeigt nicht auf den Drucker", "forbidden")
    check_host(u.hostname)
    boundary = "----druckkonfigurator" + secrets.token_hex(12)
    safe = re.sub(r"[^\w.\-]+", "_", filename)
    head = ("--%s\r\nContent-Disposition: form-data; name=\"filename\"\r\n\r\n%s\r\n--%s\r\nContent-Disposition: form-data; name=\"gcode\"; filename=\"%s\"\r\n"
            "Content-Type: application/octet-stream\r\n\r\n" % (boundary, safe, boundary, safe)).encode()
    tail = ("\r\n--%s--\r\n" % boundary).encode()
    size = os.path.getsize(path)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=UPLOAD_TIMEOUT_S)
    try:
        conn.putrequest("POST", u.path + ("?" + u.query if u.query else ""))
        for k, v in (("Content-Type", "multipart/form-data; boundary=" + boundary), ("Content-Length", str(len(head) + size + len(tail))),
                     ("X-File-Length", str(size)), ("X-BBL-Client-Type", "slicer"), ("User-Agent", "Druck-Konfigurator")):
            conn.putheader(k, v)
        conn.endheaders()
        conn.send(head)
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(256 * 1024), b""):
                conn.send(chunk)
        conn.send(tail)
        res = conn.getresponse()
        body = res.read()
    except OSError as e:
        raise LanError("Hochladen fehlgeschlagen: " + _reason(e), "unreachable")
    finally:
        conn.close()
    if res.status == 401:
        link._upload_url = None
        raise LanError("Drucker lehnt das Hochladen ab (Anmeldung abgelaufen) – bitte noch einmal senden", "rejected")
    try:
        doc = json.loads(body)
    except ValueError:
        raise LanError("Drucker antwortet beim Hochladen mit HTTP %d" % res.status, "bad_response")
    if doc.get("code") != 200:
        raise LanError("Drucker lehnt die Datei ab: " + str(doc.get("msg") or doc.get("message") or doc.get("code")), "rejected")
    return ((doc.get("data") or {}).get("gcode")) or safe


def print_gcode(host, path, filename, options=None):
    """G-Code einer geslicten Platte hochladen und drucken. Nur wenn der Drucker frei ist und der G-Code
    für dieses Modell geslict wurde. options: auto_leveling, timelapse, flow_calibration (0/1)."""
    link = _ready(host)
    o = options or {}
    if not link.connected.is_set():
        raise LanError(link.error or "Keine Verbindung zum Drucker", "unreachable")
    if link._printing() or str(link.data("info").get("state")) not in ("free", "None", ""):
        raise LanError("Der Drucker ist nicht frei (%s) – erst den laufenden Vorgang beenden" % link.data("info").get("state"), "forbidden")
    facts = gcode_facts(path)
    model = str(link.data("info").get("model") or link.discovery.get("modelName") or "")
    if model and facts["printer"] and model.lower().replace("anycubic ", "") not in facts["printer"].lower():
        raise LanError("Der G-Code ist für „%s“ geslict, verbunden ist „%s“" % (facts["printer"], model), "forbidden")
    if not link._upload_url:          # nach einem 401 neu anmelden, dann gibt /info eine frische Adresse
        link._upload_url = discovery(link.host).get("fileUploadurl")
    # Werkzeug n im G-Code druckt aus ACE-Slot n (so exportiert das Tool), über alle Einheiten durchgezählt
    # (ACE 2 = Slot 5–8, ams_index 4–7; mit zwei Einheiten noch nicht am echten Drucker geprüft). Farben und Typ zur Kontrolle.
    ace = ace_boxes({"multiColorBox": [link.reports["multiColorBox"]]} if "multiColorBox" in link.reports else {})
    slots = all_slots(ace)
    missing = [t + 1 for t in facts["tools"] if slots and t >= len(slots)]
    if missing:
        raise LanError("Der G-Code nutzt Slot %s – am Drucker gibt es nur %d Slots" % (", ".join(map(str, missing)), len(slots)), "forbidden")
    stored = _upload(link, path, filename)
    rgb = lambda h: [int(h[i:i + 2], 16) for i in (1, 3, 5)] if re.fullmatch(r"#[0-9a-fA-F]{6}", h or "") else [255, 255, 255]
    mapping = [{"paint_index": t, "ams_index": t, "paint_color": rgb(facts["colours"][t] if t < len(facts["colours"]) else "") + [255],
                "ams_color": rgb(slots[t]["colour"] if t < len(slots) else "") + [255],
                "material_type": (facts["types"][t] if t < len(facts["types"]) else "PLA")} for t in facts["tools"] or [0]]
    flag = lambda k, d=0: 1 if o.get(k, d) else 0
    data = {"taskid": "-1", "url": "", "filename": stored, "md5": _md5(path), "filepath": None, "filetype": 1, "project_type": 1,
            "filesize": facts["size"], "task_mode": 1,
            "ams_settings": {"use_ams": bool(slots), "ams_box_mapping": mapping if slots else []},
            "task_settings": {"auto_leveling": flag("auto_leveling", 1), "vibration_compensation": 0, "flow_calibration": flag("flow_calibration"),
                              "dry_mode": 0, "timelapse": {"status": flag("timelapse"), "count": 0, "type": 0},
                              "ai_settings": {"status": 0, "count": 0, "type": 0},
                              "drying_settings": {"status": 0, "target_temp": 0, "duration": 0, "remain_time": 0}, "model_objects_skip_parts": []}}
    msgid = str(uuid.uuid4())
    link.publish("print", "start", data, msgid, channel="slicer")
    # Bestätigung: der Drucker meldet einen Auftrag (info.project) oder einen print-Bericht zu start
    deadline = time.time() + START_WAIT_S
    while time.time() < deadline:
        rep = link.reports.get("print") or {}
        if rep.get("action") == "start" and rep.get("state") == "failed":
            raise LanError("Drucker hat den Start abgelehnt: " + str(rep.get("msg") or rep.get("code")), "rejected")
        if link._printing():
            return {"ok": True, "filename": stored, "tools": facts["tools"], "job": _job(link.project())}
        link.publish("info", "query", None)
        time.sleep(1.5)
    return {"ok": True, "filename": stored, "tools": facts["tools"], "job": None,
            "note": "Datei hochgeladen und Start gesendet – der Drucker meldet noch keinen Auftrag. Bitte am Drucker prüfen."}
