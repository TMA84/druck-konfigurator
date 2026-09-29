"""Prüft tools/ha_mqtt.py gegen einen Mini-MQTT-Broker (3.1.1): Discovery-Themen und -Nutzdaten, Verfügbarkeit mit
Last Will, Stand (alle 15 s und bei Änderung), Restmenge je ACE-Slot und „Bett abräumen“.
Aufruf: python tests/ha_mqtt.py   (braucht paho-mqtt; ohne echten Broker oder Drucker)"""
import json
import os
import socket
import struct
import sys
import threading
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
import ha_mqtt  # noqa: E402
import printqueue as pq  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER " + name + (": " + str(detail) if detail else ""))


# ---------- Mini-Broker: merkt sich alle PUBLISH (Thema, Nutzdaten, retain) und den Last Will ----------
def enc_str(b):
    return struct.pack("!H", len(b)) + b


def packet(ptype, flags, body):
    n, rem = len(body), b""
    while True:
        byte, n = n % 128, n // 128
        rem += bytes([byte | (0x80 if n else 0)])
        if not n:
            break
    return bytes([(ptype << 4) | flags]) + rem + body


def recv_exact(sock, n):
    b = b""
    while len(b) < n:
        c = sock.recv(n - len(b))
        if not c:
            raise ConnectionError
        b += c
    return b


def read_packet(sock):
    head = recv_exact(sock, 1)[0]
    mult, length = 1, 0
    while True:
        b = recv_exact(sock, 1)[0]
        length += (b & 127) * mult
        mult *= 128
        if not b & 128:
            break
    return head >> 4, head & 15, recv_exact(sock, length)


class Broker(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(4)
        self.port = self.srv.getsockname()[1]
        self.pubs, self.logins, self.wills, self.subs, self.conns = [], [], [], [], []
        self.lock = threading.Lock()

    def run(self):
        while True:
            try:
                conn, _ = self.srv.accept()
            except OSError:
                return
            self.conns.append(conn)
            threading.Thread(target=self.client, args=(conn,), daemon=True).start()

    def send_to_all(self, topic, payload):
        for c in list(self.conns):
            try:
                c.sendall(packet(3, 0, enc_str(topic.encode()) + payload))
            except OSError:
                pass

    def client(self, conn):
        try:
            while True:
                ptype, flags, body = read_packet(conn)
                if ptype == 1:  # CONNECT
                    i = 2 + struct.unpack("!H", body[:2])[0] + 1
                    cflags = body[i]
                    i += 3
                    fields = []
                    while i < len(body):
                        n = struct.unpack("!H", body[i:i + 2])[0]
                        fields.append(body[i + 2:i + 2 + n])
                        i += 2 + n
                    fields = fields[1:]   # ohne Client-Id
                    if cflags & 0x04:
                        self.wills.append((fields[0].decode(), fields[1], bool(cflags & 0x20), (cflags >> 3) & 3))
                        fields = fields[2:]
                    user = fields[0].decode() if cflags & 0x80 else None
                    pw = fields[1].decode() if cflags & 0x40 else None
                    self.logins.append((user, pw))
                    conn.sendall(packet(2, 0, bytes([0, 0 if (user, pw) == ("ha", "geheim") else 5])))
                elif ptype == 8:  # SUBSCRIBE
                    n = struct.unpack("!H", body[2:4])[0]
                    self.subs.append(body[4:4 + n].decode())
                    conn.sendall(packet(9, 0, body[:2] + b"\x01"))
                elif ptype == 3:  # PUBLISH
                    n = struct.unpack("!H", body[:2])[0]
                    topic, rest = body[2:2 + n].decode(), body[2 + n:]
                    qos = (flags >> 1) & 3
                    if qos:
                        conn.sendall(packet(4, 0, rest[:2]))
                        rest = rest[2:]
                    with self.lock:
                        self.pubs.append((topic, rest.decode(), bool(flags & 1)))
                elif ptype == 12:  # PINGREQ
                    conn.sendall(packet(13, 0, b""))
                elif ptype == 14:  # DISCONNECT
                    conn.close()
                    return
        except (ConnectionError, OSError):
            return

    def last(self, topic):
        with self.lock:
            return next((p for p in reversed(self.pubs) if p[0] == topic), None)

    def count(self, topic):
        with self.lock:
            return sum(1 for p in self.pubs if p[0] == topic)


def wait(cond, s=5):
    end = time.time() + s
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


# ---------- reine Funktionen ----------
check("aus ohne MQTT_HOST", ha_mqtt.config_from_env({}) is None and ha_mqtt.config_from_env({"MQTT_HOST": " "}) is None)
cfg = ha_mqtt.config_from_env({"MQTT_HOST": "core-mosquitto", "MQTT_USER": "u", "MQTT_PORT": "8883", "MQTT_TLS": "true"})
check("Einstellungen", cfg == {"host": "core-mosquitto", "port": 8883, "user": "u", "password": None, "tls": True,
                               "prefix": "homeassistant", "base": "druck_konfigurator"}, cfg)
check("Druckerstatus offline", ha_mqtt.printer_state(None) == "offline" and ha_mqtt.printer_state({"connected": False}) == "offline")
check("Druckerstatus frei", ha_mqtt.printer_state({"connected": True, "state": "free", "job": None}) == "frei")
check("Druckerstatus pausiert", ha_mqtt.printer_state({"connected": True, "job": {"status": "druckt", "paused": True}}) == "pausiert")

ST = {"model": "Anycubic Kobra S1", "firmware": "2.7.2.7", "connected": True, "state": "busy", "printing": True,
      "job": {"name": "Teil_Platte2", "status": "druckt", "progress": 42, "layer": 12, "layers": 200, "remaining_min": 30, "paused": False},
      "temps": {"curr_nozzle_temp": 219.64, "target_nozzle_temp": 220, "curr_hotbed_temp": 60.2, "target_hotbed_temp": 60},
      "ace": [{"slots": [{"index": i} for i in range(4)], "loaded_slot": 0}]}
SPOOLS = {"spools": [{"id": "a1", "slot": 0, "remaining_g": 812.5, "net_g": 1000, "type": "PLA", "colour": "#FFFFFF", "name": "Weiß", "brand": "Anycubic", "archived": False},
                     {"id": "b2", "slot": None, "remaining_g": 100, "net_g": 1000, "type": "PETG", "colour": "#000000", "name": "", "brand": "", "archived": False},
                     {"id": "c3", "slot": 2, "remaining_g": 5, "net_g": 250, "type": "ASA", "colour": "#010101", "name": "", "brand": "", "archived": True}]}
p = ha_mqtt.payload(ST, None, now=1_000_000_000)
check("Stand: Druck", p["printer_state"] == "druckt" and p["progress"] == 42 and p["remaining_min"] == 30 and p["job"] == "Teil_Platte2" and p["layer"] == "12/200", p)
check("Stand: Fertig um", p["finish"] == "2001-09-09T02:16:00+00:00", p["finish"])
check("Stand: Temperaturen gerundet", p["nozzle_temp"] == 219.6 and p["bed_temp"] == 60.2)
check("Stand: ohne Warteschlange", p["queue_state"] == "keine" and p["plates"] == "0/0" and p["bed_clear"] == "OFF")
p0 = ha_mqtt.payload(None, None)
check("Stand: Drucker offline", p0["printer_state"] == "offline" and p0["progress"] is None and p0["finish"] is None and p0["layer"] is None)
sl = ha_mqtt.slot_payloads(ST, SPOOLS)
check("Slots: 4 laut ACE", sorted(sl) == [1, 2, 3, 4], sl)
check("Slot 1 mit Spule", sl[1]["remaining_g"] == 812.5 and sl[1]["name"] == "Weiß" and sl[1]["type"] == "PLA" and sl[1]["net_g"] == 1000)
check("Slot 3 archivierte Spule zählt nicht", sl[3]["remaining_g"] is None)
check("Slots ohne Drucker laut Filamentverwaltung", sorted(ha_mqtt.slot_payloads(None, SPOOLS)) == [1])

# ---------- gegen den Broker ----------
broker = Broker()
broker.start()
qstate = pq.empty_state()
JOB = "0123456789abcdef"
pq.update(qstate, {"action": "create", "name": "Teil", "job": JOB, "plates": [{"plate": 1, "time_s": 600}, {"plate": 2, "time_s": 900}]})
pq.update(qstate, {"action": "started", "plate": 1})
status = {"st": None}
env = {"MQTT_HOST": "127.0.0.1", "MQTT_PORT": str(broker.port), "MQTT_USER": "ha", "MQTT_PASSWORD": "geheim", "MQTT_BASE_TOPIC": "dk_test"}
cfg = ha_mqtt.config_from_env(env)
pub = ha_mqtt.Publisher(cfg, lambda: status["st"], lambda: pq.view(qstate, status["st"]), lambda: SPOOLS, loop_s=0.1, every_s=0.6)
pub.start()
check("verbunden mit Anmeldung", wait(lambda: pub.connected) and broker.logins[-1] == ("ha", "geheim"), broker.logins)
check("Last Will offline retained", broker.wills and broker.wills[-1][:3] == ("dk_test/availability", b"offline", True), broker.wills)
check("abonniert homeassistant/status", wait(lambda: "homeassistant/status" in broker.subs), broker.subs)
check("online retained", wait(lambda: broker.last("dk_test/availability") == ("dk_test/availability", "online", True)))
disc = lambda comp, key: broker.last("homeassistant/%s/dk_test/%s/config" % (comp, key))
check("Discovery ohne Drucker: Gerät ohne Modell", wait(lambda: disc("sensor", "progress")) and json.loads(disc("sensor", "progress")[1])["device"]["name"] == "Druck-Konfigurator")
check("ohne Drucker keine Slot-Sensoren außer bekannten", wait(lambda: disc("sensor", "slot1_remaining")) and disc("sensor", "slot2_remaining") is None)
status["st"] = ST
check("Discovery neu mit Modell", wait(lambda: disc("sensor", "slot4_remaining") is not None))
keys = ["printer_state", "progress", "remaining_min", "finish", "job", "layer", "nozzle_temp", "bed_temp", "queue_state",
        "queue_remaining_min", "plates"]
check("alle Sensoren angemeldet", all(disc("sensor", k) for k in keys), [k for k in keys if not disc("sensor", k)])
check("Discovery retained", all(disc("sensor", k)[2] for k in keys) and disc("binary_sensor", "bed_clear")[2])
c = json.loads(disc("sensor", "progress")[1])
check("Fortschritt: Nutzdaten", c["unique_id"] == "dk_test_progress" and c["state_topic"] == "dk_test/state" and c["value_template"] == "{{ value_json.progress }}"
      and c["unit_of_measurement"] == "%" and c["availability_topic"] == "dk_test/availability", c)
check("Gerät", c["device"] == {"identifiers": ["dk_test"], "name": "Druck-Konfigurator Anycubic Kobra S1", "manufacturer": "Anycubic",
                               "model": "Anycubic Kobra S1", "sw_version": "2.7.2.7"}, c["device"])
check("Fertig um: timestamp", json.loads(disc("sensor", "finish")[1])["device_class"] == "timestamp")
t = json.loads(disc("sensor", "nozzle_temp")[1])
check("Düse: Temperatur", t["device_class"] == "temperature" and t["unit_of_measurement"] == "°C" and t["state_class"] == "measurement")
b = json.loads(disc("binary_sensor", "bed_clear")[1])
check("Bett abräumen: binary_sensor", b["name"] == "Bett abräumen" and b["payload_on"] == "ON" and b["value_template"] == "{{ value_json.bed_clear }}" and b["unique_id"] == "dk_test_bed_clear", b)
s1 = json.loads(disc("sensor", "slot1_remaining")[1])
check("Slot-Sensor", s1["state_topic"] == "dk_test/slot/1" and s1["json_attributes_topic"] == "dk_test/slot/1" and s1["unit_of_measurement"] == "g"
      and s1["device_class"] == "weight" and s1["name"] == "Slot 1 Filament", s1)
uids = [json.loads(p[1])["unique_id"] for p in broker.pubs if p[0].endswith("/config")]
check("unique_ids eindeutig je Entität", len(set(uids)) == len(keys) + 1 + 4, sorted(set(uids)))
check("Stand gesendet", wait(lambda: broker.last("dk_test/state") and json.loads(broker.last("dk_test/state")[1])["progress"] == 42))
st = json.loads(broker.last("dk_test/state")[1])
check("Stand: Warteschlange", st["queue_state"] == "Platte 1 druckt" and st["plates"] == "0/2" and st["bed_clear"] == "OFF" and st["queue_remaining_min"] == 45, st)
check("Stand nicht retained", broker.last("dk_test/state")[2] is False)
sl1 = json.loads(broker.last("dk_test/slot/1")[1])
check("Slot 1 gesendet", sl1["remaining_g"] == 812.5 and sl1["name"] == "Weiß" and sl1["colour"] == "#FFFFFF", sl1)

# Platte fertig → Bett abräumen an, sofort gesendet
pq.tick(qstate, {"printing": True, "job": {"status": "druckt"}})
pq.tick(qstate, {"printing": False, "job": None})
check("Bett abräumen → ON", wait(lambda: json.loads(broker.last("dk_test/state")[1])["bed_clear"] == "ON"))
st = json.loads(broker.last("dk_test/state")[1])
check("Text nach fertiger Platte", st["queue_state"] == "Platte 1 fertig – Bett abräumen, danach Platte 2" and st["plates"] == "1/2", st)
pq.update(qstate, {"action": "started", "plate": 2})
check("nächste Platte gestartet → OFF", wait(lambda: json.loads(broker.last("dk_test/state")[1])["bed_clear"] == "OFF"))
pq.tick(qstate, {"printing": True, "job": {"status": "druckt"}})
pq.tick(qstate, {"printing": True, "job": {"status": "fertig"}})
check("letzte Platte → ON", wait(lambda: json.loads(broker.last("dk_test/state")[1])["bed_clear"] == "ON"))
pq.update(qstate, {"action": "end"})
check("Warteschlange beendet → OFF", wait(lambda: json.loads(broker.last("dk_test/state")[1])["bed_clear"] == "OFF"))

# ohne Änderung: alle every_s erneut
n = broker.count("dk_test/state")
time.sleep(1.5)
check("regelmäßig erneut gesendet", 1 <= broker.count("dk_test/state") - n <= 4, broker.count("dk_test/state") - n)

# Home Assistant neu gestartet → Discovery erneut
n = broker.count("homeassistant/sensor/dk_test/progress/config")
broker.send_to_all("homeassistant/status", b"online")
check("Discovery nach HA-Neustart", wait(lambda: broker.count("homeassistant/sensor/dk_test/progress/config") > n))

# Broker weg → neu verbinden
logins = len(broker.logins)
for conn in list(broker.conns):
    try:
        conn.shutdown(socket.SHUT_RDWR)
        conn.close()
    except OSError:
        pass
check("neu verbunden", wait(lambda: len(broker.logins) > logins, 10), broker.logins)
check("nach Neuverbindung wieder online", wait(lambda: broker.pubs[-1][0] != "" and broker.last("dk_test/availability")[1] == "online"))
pub.stop()
check("beim Beenden offline", wait(lambda: broker.last("dk_test/availability")[1] == "offline"))

# Falsches Passwort und fehlende Bibliothek: kein Absturz
bad = ha_mqtt.Publisher(dict(cfg, password="falsch"), lambda: None, lambda: None, lambda: None, loop_s=0.1)
bad.start()
time.sleep(0.5)
check("abgelehnte Anmeldung: kein Absturz, nicht verbunden", bad.thread.is_alive() and not bad.connected)
bad.stop()
check("start() ohne Host", ha_mqtt.start(None, None, None, env={}) == (None, None))

print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
