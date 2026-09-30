"""Prüft tools/anycubic_lan.py gegen einen nachgebauten Kobra S1 im LAN-Modus (ohne echten Drucker):
HTTP-Handshake (/info, /ctrl mit AES-verschlüsselten Zugangsdaten) und ein Mini-MQTT-Broker, der mit den
dokumentierten Berichten antwortet (PROTOCOL.md von anycubic-lan: Kobra S1, Firmware 2.7.2.7).
Aufruf: python tests/lan.py   (braucht paho-mqtt und cryptography)"""
import base64
import hashlib
import http.server
import json
import os
import datetime
import re
import socket
import ssl
import struct
import time
import tempfile
import sys
import threading
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import anycubic_lan as lan  # noqa: E402
from cryptography.hazmat.primitives import padding  # noqa: E402
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes  # noqa: E402

TOKEN = "0123456789abcdeffedcba9876543210"
USER, PASSWORD, DEVICE = "printer-user", "printer-pass", "372d94454cf5d746d07a8100df8674aa"
# Wie am echten Kobra S1 (Firmware 2.7.2.7, 2026-09-28): status 5 bei allen belegten Slots, geladen laut loaded_slot
ACE = {"id": 0, "status": 1, "model_id": 40001, "auto_feed": 0, "loaded_slot": 0, "temp": 25,
       "drying_status": {"status": 0, "target_temp": 0, "duration": 0, "remain_time": 0},
       "slots": [{"index": 0, "sku": "", "type": "PLA", "color": [255, 255, 255], "status": 5, "edit_status": 0},
                 {"index": 1, "sku": "", "type": "PETG", "color": [16, 32, 48], "status": 5, "edit_status": 1},
                 {"index": 2, "sku": "", "type": "", "color": [0, 0, 0], "status": 0, "edit_status": 2}]}
INFO = {"printerName": "Anycubic Kobra S1", "model": "Anycubic Kobra S1", "ip": "127.0.0.1", "version": "2.7.2.7", "state": "free",
        "urls": {"fileUploadurl": "http://127.0.0.1:18910/gcode_upload?s=SIGNED", "rtspUrl": "http://127.0.0.1:18088/flv"}, "project": None}

passed = failed = 0
uploads = []


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER " + name + (": " + str(detail) if detail else ""))


# ---------- Mini-MQTT-Broker (3.1.1, ohne TLS: Broker-URL mqtt://) ----------
def enc_str(s):
    b = s.encode()
    return struct.pack("!H", len(b)) + b


def packet(ptype, flags, body):
    n, rem = len(body), b""
    while True:
        byte, n = n % 128, n // 128
        rem += bytes([byte | (0x80 if n else 0)])
        if not n:
            break
    return bytes([(ptype << 4) | flags]) + rem + body


def read_packet(sock):
    head = sock.recv(1)
    if not head:
        return None, None, None
    mult, length = 1, 0
    while True:
        b = sock.recv(1)[0]
        length += (b & 127) * mult
        mult *= 128
        if not b & 128:
            break
    body = b""
    while len(body) < length:
        chunk = sock.recv(length - len(body))
        if not chunk:
            return None, None, None
        body += chunk
    return head[0] >> 4, head[0] & 15, body


def self_signed_context():
    """TLS wie am Drucker: selbst signiertes Zertifikat für einen beliebigen Namen."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "kobra-s1-irgendwas")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(1) \
        .not_valid_before(now).not_valid_after(now + datetime.timedelta(days=1)).sign(key, hashes.SHA256())
    d = tempfile.mkdtemp()
    open(d + "/c.pem", "wb").write(cert.public_bytes(serialization.Encoding.PEM))
    open(d + "/k.pem", "wb").write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(d + "/c.pem", d + "/k.pem")
    return ctx


class FakeBroker(threading.Thread):
    def __init__(self, tls=False):
        super().__init__(daemon=True)
        self.tls = self_signed_context() if tls else None
        self.srv = socket.socket()
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(4)
        self.port = self.srv.getsockname()[1]
        self.commands, self.logins = [], []
        self.ace = json.loads(json.dumps(ACE))
        self.temps = {"curr_nozzle_temp": 26, "target_nozzle_temp": 0, "curr_hotbed_temp": 24, "target_hotbed_temp": 0}
        self.fans = {"fan_speed_pct": 0, "aux_fan_speed_pct": 0, "box_fan_level": 0}
        self.light, self.pos, self.moves, self.starts = {"type": 2, "status": 0, "brightness": 0}, {"x": 10, "y": 20, "z": 5}, [], []
        self.silent, self.ignore = set(), set()   # (Art, Aktion): ausführen ohne Antwort / gar nicht ausführen

    def run(self):
        while True:
            conn, _ = self.srv.accept()
            if self.tls:
                try:
                    conn = self.tls.wrap_socket(conn, server_side=True)
                except (ssl.SSLError, OSError):
                    continue
            threading.Thread(target=self.client, args=(conn,), daemon=True).start()

    def reply(self, conn, kind, doc):
        topic = lan.TOPIC_PREFIX + "/printer/public/20025/" + DEVICE + "/" + kind + "/report"
        conn.sendall(packet(3, 0, enc_str(topic) + json.dumps(doc).encode()))

    def client(self, conn):
        while True:
            ptype, flags, body = read_packet(conn)
            if ptype is None:
                return
            if ptype == 1:  # CONNECT
                i = 2 + struct.unpack("!H", body[:2])[0] + 1
                cflags = body[i]
                i += 3
                fields = []
                while i < len(body):
                    n = struct.unpack("!H", body[i:i + 2])[0]
                    fields.append(body[i + 2:i + 2 + n].decode())
                    i += 2 + n
                user, pw = (fields[1], fields[2]) if cflags & 0xC0 == 0xC0 else (None, None)
                self.logins.append((user, pw))
                conn.sendall(packet(2, 0, bytes([0, 0 if (user, pw) == (USER, PASSWORD) else 5])))
            elif ptype == 8:  # SUBSCRIBE
                conn.sendall(packet(9, 0, body[:2] + b"\x01"))
            elif ptype == 3:  # PUBLISH
                n = struct.unpack("!H", body[:2])[0]
                topic, rest = body[2:2 + n].decode(), body[2 + n:]
                if (flags >> 1) & 3:
                    conn.sendall(packet(4, 0, rest[:2]))
                    rest = rest[2:]
                msg = json.loads(rest)
                self.commands.append((topic, msg))
                kind, action = msg["type"], msg["action"]
                self.reply(conn, kind, {"msgid": ""})  # reine Quittung – muss ignoriert werden
                if (kind, action) == ("info", "query"):
                    self.reply(conn, "info", {"type": "info", "action": "report", "state": "done", "code": 200, "msgid": "x", "data": INFO})
                elif (kind, action) == ("multiColorBox", "getInfo"):
                    self.reply(conn, kind, {"type": kind, "action": "getInfo", "state": "success", "code": 200, "msgid": msg["msgid"], "data": {"multi_color_box": [self.ace]}})
                elif (kind, action) == ("tempature", "query"):
                    self.reply(conn, kind, {"type": kind, "action": "query", "state": "done", "code": 200, "msgid": msg["msgid"], "data": dict(self.temps)})
                elif (kind, action) == ("tempature", "set"):
                    d = msg["data"]
                    if d["type"] in (0, 2): self.temps["target_nozzle_temp"] = d["target_nozzle_temp"]
                    if d["type"] in (1, 2): self.temps["target_hotbed_temp"] = d["target_hotbed_temp"]
                    self.reply(conn, kind, {"type": kind, "action": "set", "state": "done", "code": 200, "msgid": msg["msgid"], "data": None})
                elif (kind, action) == ("fan", "query"):
                    self.reply(conn, kind, {"type": kind, "action": "query", "state": "done", "code": 200, "msgid": msg["msgid"], "data": dict(self.fans)})
                elif (kind, action) == ("fan", "setSpeed"):
                    self.fans.update(msg["data"])
                    self.reply(conn, kind, {"type": kind, "action": "setSpeed", "state": "done", "code": 200, "msgid": msg["msgid"], "data": None})
                elif (kind, action) == ("light", "query"):
                    self.reply(conn, kind, {"type": kind, "action": "query", "state": "done", "code": 200, "msgid": msg["msgid"], "data": {"lights": [dict(self.light)]}})
                elif (kind, action) in self.ignore:
                    pass
                elif (kind, action) == ("light", "control") and (kind, action) in self.silent:
                    self.light.update(msg["data"])   # führt aus, bestätigt aber nicht (andere Firmware)
                elif (kind, action) == ("light", "control"):
                    self.light.update(msg["data"])
                    # wie die Werksfirmware 2.7.2.7: Bestätigung ohne die msgid der Anfrage
                    self.reply(conn, kind, {"type": kind, "action": "control", "state": "done", "code": 200, "msgid": "", "data": dict(self.light)})
                elif (kind, action) == ("axis", "query"):
                    self.reply(conn, kind, {"type": kind, "action": "query", "state": "done", "code": 200, "msgid": msg["msgid"], "data": {"coordinates": dict(self.pos)}})
                elif (kind, action) == ("axis", "move"):
                    d = msg["data"]; ax = {1: "x", 2: "y", 3: "z"}.get(d["axis"])
                    if d["move_type"] == 2:
                        for k in ("xy" if d["axis"] == 4 else ax): self.pos[k] = 0
                    elif ax:
                        self.pos[ax] += d["distance"] * (1 if d["move_type"] == 1 else -1)
                    self.moves.append(d)
                    self.reply(conn, kind, {"type": kind, "action": "move", "state": "done", "code": 200, "msgid": msg["msgid"], "data": None})
                elif (kind, action) == ("print", "start"):
                    self.starts.append((topic, msg["data"]))
                    INFO["project"] = {"task_id": -1, "filename": "/useremain/app/gk/gcode/" + msg["data"]["filename"], "progress": 0, "curr_layer": 0,
                                       "total_layers": 10, "print_time": 0, "remain_time": 30, "print_status": 6, "state": "preheating", "pause": 0}
                    INFO["state"] = "busy"
                    self.reply(conn, kind, {"type": kind, "action": "start", "state": "start", "code": 200, "msgid": msg["msgid"], "data": None})
                elif (kind, action) == ("print", "pause"):
                    self.reply(conn, kind, {"type": kind, "action": "pause", "state": "done", "code": 200, "msgid": msg["msgid"], "data": None})
                elif (kind, action) == ("peripherie", "query"):
                    self.reply(conn, kind, {"type": kind, "action": "query", "state": "done", "code": 200, "data": {"camera": 1, "multiColorBox": 1, "udisk": 1}})
                elif (kind, action) == ("multiColorBox", "setAutoFeed"):
                    self.ace["auto_feed"] = msg["data"]["multi_color_box"][0]["auto_feed"]
                    self.reply(conn, kind, {"type": kind, "action": "setAutoFeed", "state": "success", "code": 200, "msgid": msg["msgid"], "data": None})
                elif (kind, action) == ("multiColorBox", "setDry"):
                    self.ace["drying_status"] = msg["data"]["multi_color_box"][0]["drying_status"]
                    # wie die Werksfirmware 2.7.2.7: Bestätigung ohne die msgid der Anfrage
                    self.reply(conn, kind, {"type": kind, "action": "setDry", "state": "success", "code": 200, "msgid": "", "data": None})
                elif (kind, action) == ("multiColorBox", "setInfo"):
                    for s in msg["data"]["multi_color_box"][0]["slots"]:
                        self.ace["slots"][s["index"]].update(type=s["type"], color=s["color"], edit_status=1)
                    self.reply(conn, kind, {"type": kind, "action": "setInfo", "state": "success", "code": 200, "msgid": msg["msgid"], "data": None})
            elif ptype == 12:  # PINGREQ
                conn.sendall(packet(13, 0, b""))
            elif ptype == 14:  # DISCONNECT
                conn.close()
                return


# ---------- HTTP: /info und /ctrl ----------
def make_http(broker_port, ctrl_type="lan", scheme="mqtt"):
    seen = {}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, doc):
            body = json.dumps(doc).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")  # wie der Drucker: kein JSON-Content-Type
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            port = self.server.server_address[1]
            self.send({"ctrlType": ctrl_type, "token": TOKEN, "ctrlInfoUrl": "http://127.0.0.1:%d/ctrl" % port, "modelId": "20025",
                       "modelName": "Anycubic Kobra S1", "fileUploadurl": "http://127.0.0.1:%d/gcode_upload?s=SECRET" % port})

        def do_POST(self):
            if self.path.startswith("/gcode_upload"):
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                body = self.rfile.read(int(self.headers["Content-Length"]))
                uploads.append({"token": q.get("s", [""])[0], "ctype": self.headers.get("Content-Type", ""), "length": self.headers.get("X-File-Length"), "body": body})
                if q.get("s", [""])[0] != "SECRET":
                    self.send_response(401); self.end_headers(); return
                name = re.search(rb'name="filename"\r\n\r\n([^\r]*)', body).group(1).decode()
                return self.send({"code": 200, "data": {"gcode": name}})
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            seen.update({k: v[0] for k, v in q.items()})
            keyed = hashlib.md5(TOKEN[:16].encode()).hexdigest()
            if q["sign"][0] != hashlib.md5((keyed + q["ts"][0] + q["nonce"][0]).encode()).hexdigest():
                return self.send({"code": 401, "message": "sign"})
            creds = json.dumps({"broker": "%s://127.0.0.1:%d" % (scheme, broker_port), "username": USER, "password": PASSWORD, "deviceId": DEVICE}).encode()
            pad = padding.PKCS7(128).padder()
            iv_src = "abcdefghij"  # kürzer als 16 → mit 0x00 auffüllen
            enc = Cipher(algorithms.AES(TOKEN[16:].encode()), modes.CBC(iv_src.encode().ljust(16, b"\0"))).encryptor()
            info = base64.b64encode(enc.update(pad.update(creds) + pad.finalize()) + enc.finalize()).decode()
            self.send({"code": 200, "data": {"info": info, "token": iv_src}})

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, seen


if "--serve" in sys.argv:
    # Nachgebauter Drucker für den Bedientest im Browser: /info auf Port 18910, MQTT über TLS
    tls_broker = FakeBroker(tls=True)
    tls_broker.start()

    class Fixed(http.server.ThreadingHTTPServer):
        allow_reuse_address = True
    srv, _ = make_http(tls_broker.port, scheme="mqtts")
    srv.shutdown()
    fixed = Fixed(("127.0.0.1", 18910), srv.RequestHandlerClass)
    print("Nachgebauter Kobra S1 unter 127.0.0.1 (LAN-Modus) – Strg+C beendet", flush=True)
    fixed.serve_forever()

broker = FakeBroker()
broker.start()
http_srv, seen = make_http(broker.port)
lan.INFO_PORT = http_srv.server_address[1]

# 1) Kleinteile
check("Signatur wie dokumentiert", lan.signature("0123456789abcdef", 1700000000000, "aB3xY9") == hashlib.md5((hashlib.md5(b"0123456789abcdef").hexdigest() + "1700000000000aB3xY9").encode()).hexdigest())
check("IV kürzen/auffüllen", lan.build_iv("x" * 20) == b"x" * 16 and lan.build_iv("ab") == b"ab" + b"\0" * 14)
check("Broker-URL mit Standardport", lan.parse_broker("mqtts://10.0.0.5") == ("10.0.0.5", 9883, True))
for bad in ("8.8.8.8", "example.com", "1.1.1.1", "", "a b"):
    try:
        lan.check_host(bad)
        check("Adresse außerhalb des Heimnetzes abgelehnt: " + bad, False)
    except lan.LanError as e:
        check("Adresse außerhalb des Heimnetzes abgelehnt: " + bad, e.kind in ("forbidden", "unreachable"), e.kind)
check("Private Adresse erlaubt", lan.check_host("192.168.1.50") == "192.168.1.50")

# 2) Belegung lesen
st = lan.status("127.0.0.1")
slots = st["ace"][0]["slots"] if st["ace"] else []
check("Firmware und Modell", st["firmware"] == "2.7.2.7" and st["model"] == "Anycubic Kobra S1" and st["model_id"] == "20025", st)
check("Drei Slots: PLA weiß geladen, PETG von Hand, leer", [(s["type"], s["colour"], s["present"], s["loaded"]) for s in slots] ==
      [("PLA", "#FFFFFF", True, True), ("PETG", "#102030", True, False), ("", "", False, False)], slots)
check("Alle Anfragen beantwortet", st["missing"] == [], st["missing"])
check("Anmeldung mit entschlüsselten Zugangsdaten", broker.logins[-1] == (USER, PASSWORD))
check("Anfrage-Topics", {t.rsplit("/", 1)[1] for t, _ in broker.commands} >= {"info", "multiColorBox", "peripherie"} and
      all(t.startswith(lan.TOPIC_PREFIX + "/web/printer/20025/" + DEVICE + "/") for t, _ in broker.commands))
check("multiColorBox mit getInfo gefragt", any(m["type"] == "multiColorBox" and m["action"] == "getInfo" for _, m in broker.commands))
dump = json.dumps(st)
check("Upload-URL und Token nicht in der Antwort", "SIGNED" not in dump and "SECRET" not in dump and TOKEN not in dump)
check("did: 32 Zeichen A-Z0-9", len(seen.get("did", "")) == 32 and seen["did"].isalnum() and seen["did"].upper() == seen["did"])

# 3) Einstellung schreiben: Slot 3 auf ASA rot
res = lan.command("127.0.0.1", "multiColorBox", "setInfo", {"multi_color_box": [{"id": 0, "slots": [{"index": 2, "type": "ASA", "color": [200, 0, 0]}]}]})
check("setInfo bestätigt", res["ok"] and res["state"] == "success", res)
st = lan.status("127.0.0.1")
check("Slot 3 danach ASA rot", st["ace"][0]["slots"][2]["type"] == "ASA" and st["ace"][0]["slots"][2]["colour"] == "#C80000", st["ace"][0]["slots"][2])

res = lan.command("127.0.0.1", "multiColorBox", "setAutoFeed", {"multi_color_box": [{"id": 0, "auto_feed": 1}]})
check("Nachfüllen eingeschaltet", res["ok"] and lan.status("127.0.0.1")["ace"][0]["auto_feed"] == 1, res)

# 3b) Werkbank: Temperaturen, Lüfter, Licht, Achsen (gegen den Nachbau); Stand danach sofort aktuell
res = lan.command("127.0.0.1", "tempature", "set", {"type": 2, "target_nozzle_temp": 210, "target_hotbed_temp": 60})
st = lan.status("127.0.0.1")
check("Temperaturen gesetzt und gemeldet", res["ok"] and st["temps"]["target_nozzle_temp"] == 210 and st["temps"]["target_hotbed_temp"] == 60, st["temps"])
lan.command("127.0.0.1", "fan", "setSpeed", {"fan_speed_pct": 40})
res = lan.command("127.0.0.1", "light", "control", {"type": 2, "status": 1, "brightness": 80})
check("Licht bestätigt, obwohl die Antwort keine msgid trägt", res["ok"], res)
res = lan.command("127.0.0.1", "multiColorBox", "setDry", {"multi_color_box": [{"id": 0, "drying_status": {"status": 1, "target_temp": 45, "duration": 240}}]})
check("Trocknen bestätigt, obwohl die Antwort keine msgid trägt", res["ok"] and broker.ace["drying_status"]["target_temp"] == 45, res)
broker.silent.add(("light", "control"))
res = lan.command("127.0.0.1", "light", "control", {"type": 2, "status": 0})
check("Licht aus ohne jede Antwort: am gemeldeten Zustand bestätigt", res["ok"] and res["state"] == "verified" and broker.light["status"] == 0, res)
broker.silent.clear()
broker.ignore.add(("light", "control"))
try:
    lan.command("127.0.0.1", "light", "control", {"type": 2, "status": 1, "brightness": 80})
    check("Licht, das der Drucker nicht schaltet, gilt als nicht bestätigt", False)
except lan.LanError as e:
    check("Licht, das der Drucker nicht schaltet, gilt als nicht bestätigt", e.kind == "timeout" and "nicht bestätigt" in str(e), str(e))
broker.ignore.clear()
lan.command("127.0.0.1", "light", "control", {"type": 2, "status": 1, "brightness": 80})
st = lan.status("127.0.0.1")
check("Lüfter 40 % und Licht an", st["fans"]["fan_speed_pct"] == 40 and st["lights"] and st["lights"][0]["status"] == 1, (st["fans"], st["lights"]))
lan.command("127.0.0.1", "axis", "move", {"axis": 1, "move_type": 1, "distance": 10})
lan.command("127.0.0.1", "axis", "move", {"axis": 3, "move_type": 2})
st = lan.status("127.0.0.1")
check("X +10 mm, Z nach Hause", st["position"] == {"x": 20, "y": 20, "z": 0} and broker.moves[-1] == {"axis": 3, "move_type": 2, "distance": 0}, (st["position"], broker.moves))
for bad in ({"type": 0, "target_nozzle_temp": 350}, {"type": 1, "target_hotbed_temp": 130}, {"type": 5}):
    try:
        lan.command("127.0.0.1", "tempature", "set", bad); check("zu heiß abgelehnt " + str(bad), False)
    except lan.LanError as e:
        check("zu heiß abgelehnt " + str(bad), e.kind == "forbidden", e)
for bad in ({"axis": 1, "move_type": 1, "distance": 100}, {"axis": 9, "move_type": 1, "distance": 1}):
    try:
        lan.command("127.0.0.1", "axis", "move", bad); check("Achsweg abgelehnt " + str(bad), False)
    except lan.LanError as e:
        check("Achsweg abgelehnt " + str(bad), e.kind == "forbidden", e)
try:
    lan.command("127.0.0.1", "fan", "setSpeed", {"fan_speed_pct": 10, "box_fan_level": 10}); check("zwei Lüfter auf einmal abgelehnt", False)
except lan.LanError as e:
    check("zwei Lüfter auf einmal abgelehnt", e.kind == "forbidden")
# Während eines Drucks: Achsen gesperrt, Pause nimmt die task_id des Auftrags
INFO["project"] = {"task_id": 614707220, "filename": ".3mf_temp/Wuerfel_plate(01).gcode", "progress": 60, "curr_layer": 3, "total_layers": 5, "print_time": 7, "remain_time": 42, "print_status": 1, "state": "printing", "pause": 0}
lan.close_all()
st = lan.status("127.0.0.1")
check("Druckauftrag gelesen", st["printing"] and st["job"]["name"] == "Wuerfel_plate(01)" and st["job"]["progress"] == 60 and st["job"]["status"] == "druckt", st["job"])
try:
    lan.command("127.0.0.1", "axis", "move", {"axis": 1, "move_type": 1, "distance": 1}); check("Achsen während des Drucks gesperrt", False)
except lan.LanError as e:
    check("Achsen während des Drucks gesperrt", e.kind == "forbidden" and "Druck" in str(e), e)
lan.command("127.0.0.1", "print", "pause", {"taskid": "irgendwas"})
check("Pause mit task_id des laufenden Auftrags", any(m["type"] == "print" and m["action"] == "pause" and m["data"] == {"taskid": "614707220"} for _, m in broker.commands))
# Objekt überspringen: skip/start im Kanal „web“, ganze Liste als Texte; zweites Objekt dazu → beide; ohne Quittung „gesendet“
r = lan.command("127.0.0.1", "skip", "start", {"parts": [2]})
sk = [(tp, m) for tp, m in broker.commands if m["type"] == "skip"]
check("Überspringen: skip/start im Kanal web mit objects_skip_parts", sk and "/web/" in sk[-1][0] and sk[-1][1]["action"] == "start" and sk[-1][1]["data"] == {"objects_skip_parts": ["2"]}, sk[-1:] )
check("Überspringen ohne Quittung: als gesendet gemerkt", r["ok"] and r["state"] == "sent" and r["skipped"] == [2], r)
lan.command("127.0.0.1", "skip", "start", {"parts": [0]})
check("zweites Objekt: ganze Liste gesendet (0 und 2)", [m for _, m in broker.commands if m["type"] == "skip"][-1]["data"] == {"objects_skip_parts": ["0", "2"]})
st = lan.status("127.0.0.1")
check("Stand: übersprungene Objekte am Auftrag", st["job"]["skipped"] == [0, 2] and st["job"]["skipped_confirmed"] is False, st["job"])
for bad in ({"parts": []}, {"parts": [-1]}, {"parts": [64]}, {"parts": ["x"]}, {}):
    try:
        lan.command("127.0.0.1", "skip", "start", bad); check("Überspringen abgelehnt " + str(bad), False)
    except lan.LanError as e:
        check("Überspringen abgelehnt " + str(bad), e.kind == "forbidden", e)
INFO["project"] = None
lan.close_all()
try:
    lan.command("127.0.0.1", "skip", "start", {"parts": [1]}); check("Überspringen ohne Druck abgelehnt", False)
except lan.LanError as e:
    check("Überspringen ohne Druck abgelehnt", e.kind == "forbidden" and "Druck" in str(e), e)
lan.close_all()

# 3c) Druck senden: G-Code hochladen (multipart, signierte Adresse) und print/start im Kanal „slicer“
gtmp = tempfile.NamedTemporaryFile("w", suffix=".gcode", delete=False)
gtmp.write("; HEADER\nG1 X1 Y1 E1\n; filament used [g] = 3.10, 0.00, 1.20, 0.00\n; filament_colour = #FF0000;#00FF00;#0000FF;#FFFFFF\n"
           "; filament_type = PLA;PLA;PETG;PLA\n; printer_model = Anycubic Kobra S1\n")
gtmp.close()
g5 = tempfile.NamedTemporaryFile("w", suffix=".gcode", delete=False)
g5.write("; filament used [g] = 0, 0, 0, 0, 2.0\n; filament_type = PLA;PLA;PLA;PLA;PLA\n; printer_model = Anycubic Kobra S1\n")
g5.close()
n_up = len(uploads)
try:
    lan.print_gcode("127.0.0.1", g5.name, "slot5.gcode"); check("Slot 5 ohne zweite ACE abgelehnt (vor dem Hochladen)", False)
except lan.LanError as e:
    check("Slot 5 ohne zweite ACE abgelehnt (vor dem Hochladen)", e.kind == "forbidden" and "Slot 5" in str(e) and len(uploads) == n_up, str(e))
os.unlink(g5.name)
res = lan.print_gcode("127.0.0.1", gtmp.name, "Schild_Platte1.gcode", {"auto_leveling": 1, "timelapse": 0})
up = uploads[-1] if uploads else {}
check("Hochgeladen mit Token, multipart, Länge", up.get("token") == "SECRET" and up.get("ctype", "").startswith("multipart/form-data") and up.get("length") == str(os.path.getsize(gtmp.name)) and b"G1 X1 Y1 E1" in up.get("body", b""), {k: v for k, v in up.items() if k != "body"})
topic, data = broker.starts[-1] if broker.starts else ("", {})
check("Start im Kanal slicer", "/slicer/printer/20025/" + DEVICE + "/print" in topic, topic)
check("Start mit Datei, Größe, MD5, taskid -1", data.get("filename") == "Schild_Platte1.gcode" and data.get("filesize") == os.path.getsize(gtmp.name) and len(data.get("md5", "")) == 32 and data.get("taskid") == "-1", data)
m = data.get("ams_settings", {})
check("Werkzeuge 0 und 2 → ACE-Slots 0 und 2, Farbe und Typ aus dem G-Code", m.get("use_ams") and [(x["paint_index"], x["ams_index"], x["material_type"], x["paint_color"]) for x in m["ams_box_mapping"]] == [(0, 0, "PLA", [255, 0, 0, 255]), (2, 2, "PETG", [0, 0, 255, 255])], m)
check("Bettnivellierung an, Zeitraffer aus", data.get("task_settings", {}).get("auto_leveling") == 1 and data["task_settings"]["timelapse"]["status"] == 0)
check("Druck läuft danach", res["ok"] and res["job"] and res["job"]["name"] == "Schild_Platte1", res)

# Kopfposition während des Drucks: nur auf Wunsch (status(pos=True)), sonst keine axis/query
lan.POLL_S = 1
axisq = lambda: sum(1 for _t, m in broker.commands if (m.get("type"), m.get("action")) == ("axis", "query"))
n0 = axisq(); time.sleep(2.5)
check("während des Drucks ohne Wunsch keine Positionsabfrage", axisq() == n0, axisq() - n0)
lan.status("127.0.0.1", pos=True); n1 = axisq(); time.sleep(2.5)
st = lan.status("127.0.0.1")
check("mit pos=True wird die Position auch während des Drucks abgefragt", axisq() > n1 and st.get("position_age_s") is not None and st["position_age_s"] < 3, (axisq() - n1, st.get("position_age_s")))
lan.get_link("127.0.0.1").pos_until = 0
lan.POLL_S = 5
try:
    lan.print_gcode("127.0.0.1", gtmp.name, "noch_einer.gcode"); check("zweiter Druck abgelehnt, solange einer läuft", False)
except lan.LanError as e:
    check("zweiter Druck abgelehnt, solange einer läuft", e.kind == "forbidden", e)
INFO["project"] = None; INFO["state"] = "free"
lan.close_all()
open(gtmp.name, "a").write("; printer_model = Anycubic Kobra 3\n")
g3 = gtmp.name + ".k3"
open(g3, "w").write(open(gtmp.name).read().replace("printer_model = Anycubic Kobra S1", "printer_model = Anycubic Kobra 3"))
try:
    lan.print_gcode("127.0.0.1", g3, "falsch.gcode"); check("G-Code für anderen Drucker abgelehnt", False)
except lan.LanError as e:
    check("G-Code für anderen Drucker abgelehnt", e.kind == "forbidden" and "Kobra 3" in str(e), e)
os.unlink(gtmp.name); os.unlink(g3)
lan.close_all()

# 4) Nicht freigegebene Befehle und Fehlerfälle
for kind, action, data in (("print", "stop", {"taskid": "1"}), ("axis", "move", {}), ("system", "reboot", {}), ("multiColorBox", "setInfo", {"multi_color_box": [{"id": 0, "slots": [{"index": 0, "type": "PLA", "color": [300, 0, 0]}]}]})):
    try:
        lan.command("127.0.0.1", kind, action, data)
        check("abgelehnt: " + kind + "/" + action, False)
    except lan.LanError as e:
        check("abgelehnt: " + kind + "/" + action, e.kind == "forbidden", e)
# 5) Wie am echten Drucker: MQTT über TLS mit selbst signiertem Zertifikat (mqtts://)
tls_broker = FakeBroker(tls=True)
tls_broker.start()
tls_srv, _ = make_http(tls_broker.port, scheme="mqtts")
lan.close_all()
lan.INFO_PORT = tls_srv.server_address[1]
st = lan.status("127.0.0.1")
check("TLS mit selbst signiertem Zertifikat", st["ace"] and st["ace"][0]["slots"][0]["type"] == "PLA" and tls_broker.logins, st.get("missing"))

off_srv, _ = make_http(broker.port, ctrl_type="cloud")
lan.close_all()
lan.INFO_PORT = off_srv.server_address[1]
try:
    lan.status("127.0.0.1")
    check("LAN-Modus aus erkannt", False)
except lan.LanError as e:
    check("LAN-Modus aus erkannt", e.kind == "lan_off", e)
lan.close_all()
lan.INFO_PORT = 1  # hier lauscht niemand
try:
    lan.status("127.0.0.1")
    check("Nicht erreichbar erkannt", False)
except lan.LanError as e:
    check("Nicht erreichbar erkannt", e.kind == "unreachable", e)

# Mehrere ACE-Einheiten: Slots durchgehend (ACE 2, Slot 1 = Slot 5), auch wenn eine Einheit weniger als 4 Slots meldet
two = lan.ace_boxes({"multiColorBox": [{"data": {"multi_color_box": [dict(ACE, loaded_slot=-1), dict(ACE, id=1, loaded_slot=1)]}}]})
flat = lan.all_slots(two)
check("zwei ACE: Slots 1–3 und 5–7, Box und Slot darin", [(s["index"], s["box"], s["local"]) for s in flat] == [(0, 0, 0), (1, 0, 1), (2, 0, 2), (4, 1, 0), (5, 1, 1), (6, 1, 2)], flat)
check("zwei ACE: geladener Slot = ACE 2, Slot 2 → 5 (0-basiert)", lan.loaded_slot(two) == 5, lan.loaded_slot(two))

print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
