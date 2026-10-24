"""Prüft Sicherung und Umzug (tools/backup.py, GET/POST /api/backup): Rundreise in einen leeren Datenordner, Zusammenführen,
kaputte/zu große/zu tiefe Dateien, Pfade in der Datei, kein halbes Einspielen bei Fehlern, keine Geheimnisse in der Datei,
Zugriffsschutz (PIN, nur ansehen, fremde Seiten). Aufruf: python tests/backup.py (ohne Drucker, ohne Home Assistant)."""
import functools
import http.client
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
tmp = tempfile.mkdtemp(prefix="backup-")
os.environ["DATA_DIR"] = tmp
for k in ("SPOOL_FILE", "QUEUE_FILE", "PREFS_FILE", "SCHEDULE_FILE"):
    os.environ.pop(k, None)
os.environ["SLICE_JOBS_DIR"] = os.path.join(tmp, "jobs")
for k in ("KONFIGURATOR_PIN", "KONFIGURATOR_PRINTER", "KONFIGURATOR_ALLOWED_HOSTS", "SUPERVISOR_TOKEN"):
    os.environ.pop(k, None)
os.environ["MQTT_PASSWORD"] = "geheim-mqtt-123"   # darf nie in der Sicherung landen
import serve  # noqa: E402
import backup  # noqa: E402
import prefs  # noqa: E402
import spools  # noqa: E402
import ha_users  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER " + name + (": " + str(detail) if detail else ""))


srv = serve.Server(("127.0.0.1", 0), functools.partial(serve.Handler, directory=serve.ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
JSON = {"Content-Type": "application/json"}


def req(method, path, body=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=20)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, r.headers, data


def post(obj, headers=None):
    st, _, data = req("POST", "/api/backup", json.dumps(obj).encode(), dict(JSON, **(headers or {})))
    try:
        return st, json.loads(data)
    except ValueError:
        return st, {"raw": data}


def files_snapshot():
    out = {}
    for p in (spools.data_file(), prefs.data_file()):
        out[p] = open(p, "rb").read() if os.path.exists(p) else None
    return out


# --- Ausgangsstand: zwei Spulen, ein Druck, Standardwerte, Warteschlange und Plan (die nicht in die Sicherung gehören)
now = time.time()
state = spools.empty_state()
state.update(host="192.168.1.50", flush=2.0, low_g=150, price_default=30.0,
             track={"task": "x", "mm": 12.0})
state["spools"] = [
    {"id": "aaa111", "sku": "AC-PLA-W", "type": "PLA", "colour": "#FFFFFF", "name": "Weiß", "brand": "Anycubic", "notes": "",
     "rfid": True, "archived": False, "needs_check": False, "net_g": 1000.0, "used_g": 120.0, "purge_g": 4.0, "adjust_g": 0.0,
     "added": now - 9000, "last_seen": now - 100, "slot": 0, "price_per_kg": 22.0},
    {"id": "bbb222", "sku": "", "type": "PETG", "colour": "#112233", "name": "", "brand": "", "notes": "Regal",
     "rfid": False, "archived": False, "needs_check": False, "net_g": 750.0, "used_g": 0.0, "purge_g": 0.0, "adjust_g": 0.0,
     "added": now - 8000, "last_seen": now - 5000, "slot": None},
]
state["history"] = [{"job": "Halter_Platte1", "start": now - 4000, "end": now - 2000, "changes": 0, "used": {"aaa111": 12.5},
                     "grams_total": 12.5, "cost_eur": 0.28, "duration_s": 2000.0, "types": {"PLA": 12.5}}]
spools.save(state)
prefs.api_post({"key": "ovDefaults", "value": {"kobra_s1|abs": {"bed": 105, "fan": 5}}})
with open(os.path.join(tmp, "queue.json"), "w") as f:
    json.dump({"version": 1, "seq": 3, "queue": {"name": "Q"}, "bed_clear": False, "event": None, "events": []}, f)
with open(os.path.join(tmp, "schedule.json"), "w") as f:
    json.dump({"plan": {"id": "p1", "state": "wait"}, "seq": 1}, f)

# --- 1) Export
st, h, raw = req("GET", "/api/backup")
check("Export 200", st == 200, st)
check("Export als Datei", 'filename="druckwerkstatt-sicherung-' in (h.get("Content-Disposition") or ""), h.get("Content-Disposition"))
bk = json.loads(raw)
check("Format/Version", bk.get("format") == backup.FORMAT and bk.get("version") == 1)
check("Spulen und Historie drin", len(bk["server"]["spools"]["spools"]) == 2 and len(bk["server"]["spools"]["history"]) == 1)
check("Standardwerte drin", bk["server"]["prefs"] == {"ovDefaults": {"kobra_s1|abs": {"bed": 105, "fan": 5}}})
check("keine Druckeradresse, kein Zähler", "host" not in bk["server"]["spools"] and "track" not in bk["server"]["spools"])
check("keine Warteschlange/kein Plan", set(bk["server"]) == {"spools", "prefs"})
check("kein MQTT-Passwort", b"geheim-mqtt-123" not in raw)
os.environ["KONFIGURATOR_PIN"] = "4711"
check("keine PIN in der Datei", b"4711" not in backup.build()[1])
os.environ.pop("KONFIGURATOR_PIN")

# --- 2) Rundreise in einen leeren Datenordner (anderer Server): replace
other = tempfile.mkdtemp(prefix="backup-other-")
sp2, pr2 = os.path.join(other, "spools.json"), os.path.join(other, "prefs.json")
spools.save(dict(spools.empty_state(), host="10.0.0.9", track={"t": 1}), sp2)
data = dict(bk, browser={"profiles": {"mein_pla": {"name": "Mein PLA"}}, "settings": {}, "last": {}})
res = backup.restore(data, "replace", spool_path=sp2, prefs_path=pr2)
s2 = spools.load(sp2)
check("replace: Spulen übernommen", [s["id"] for s in s2["spools"]] == ["aaa111", "bbb222"], res)
check("replace: Historie übernommen", len(s2["history"]) == 1 and s2["history"][0]["used"] == {"aaa111": 12.5})
check("replace: Einstellungen übernommen", s2["flush"] == 2.0 and s2["low_g"] == 150 and s2["price_default"] == 30.0)
check("replace: Adresse/Zähler des Ziels bleiben", s2["host"] == "10.0.0.9" and s2["track"] == {"t": 1})
check("replace: Standardwerte übernommen", prefs.api_get(pr2) == {"ovDefaults": {"kobra_s1|abs": {"bed": 105, "fan": 5}}})
check("replace: Zusammenfassung", res["spools"]["total"] == 2 and res["prefs"]["entries"] == 1, res)
check("keine .tmp-Reste", not [f for f in os.listdir(other) if f.endswith(".tmp")], os.listdir(other))

# --- 3) merge: eigene Standardwerte bleiben, Datei kommt dazu; eigene Spule bleibt
prefs.api_post({"key": "ovDefaults", "value": {"kobra_s1|pla": {"bed": 60}, "kobra_s1|abs": {"bed": 100}}}, pr2)
s2["spools"].append(dict(s2["spools"][1], id="ccc333", type="ABS", colour="#000000"))
spools.save(s2, sp2)
res = backup.restore(bk, "merge", spool_path=sp2, prefs_path=pr2)
check("merge: Standardwerte vereinigt, Datei gewinnt", prefs.api_get(pr2)["ovDefaults"] == {"kobra_s1|pla": {"bed": 60}, "kobra_s1|abs": {"bed": 105, "fan": 5}})
check("merge: eigene Spule bleibt", "ccc333" in [s["id"] for s in spools.load(sp2)["spools"]], res)
check("merge: Historie nicht doppelt", len(spools.load(sp2)["history"]) == 1)

# --- 4) Über HTTP einspielen (replace) und Antwort
st, d = post({"mode": "replace", "data": bk})
check("POST replace 200", st == 200 and d.get("note") == "Sicherung eingespielt", (st, d))

# --- 5) Ungültiges: nichts darf sich ändern
before = files_snapshot()
bad = [
    ("kein Objekt", [1, 2], 400),
    ("falsches Format", {"format": "x", "version": 1, "server": {}}, 400),
    ("neuere Version", dict(bk, version=99), 400),
    ("Version als Text", dict(bk, version="1"), 400),
    ("ohne Serverteil", {"format": backup.FORMAT, "version": 1}, 400),
    ("leerer Serverteil", {"format": backup.FORMAT, "version": 1, "server": {}}, 400),
    ("unbekannter Teil (Pfad)", dict(bk, server=dict(bk["server"], **{"../../etc/passwd": "x"})), 400),
    ("Warteschlange nicht einspielbar", dict(bk, server=dict(bk["server"], queue={"queue": None})), 400),
    ("Spule kaputt", dict(bk, server=dict(bk["server"], spools=dict(bk["server"]["spools"], spools=[{"id": "../x"}]))), 400),
    ("Spulen-id als Pfad", dict(bk, server=dict(bk["server"], spools=dict(bk["server"]["spools"], spools=[dict(bk["server"]["spools"]["spools"][0], id="../../x")]))), 400),
    ("Slot doppelt", dict(bk, server=dict(bk["server"], spools=dict(bk["server"]["spools"], spools=[bk["server"]["spools"]["spools"][0], dict(bk["server"]["spools"]["spools"][1], slot=0)]))), 400),
    ("Standardwert ungültig (gültige Spulen davor)", dict(bk, server=dict(bk["server"], prefs={"ovDefaults": {"kobra_s1|abs": {"bed": "<script>" * 10}}})), 400),
    ("Standardwerte unbekannter Schlüssel", dict(bk, server=dict(bk["server"], prefs={"secret": 1})), 400),
    ("Browserteil kein Objekt", dict(bk, browser=[1]), 400),
    ("Browserteil zu groß", dict(bk, browser={"x": "a" * (backup.MAX_BROWSER_BYTES + 10)}), 400),
]
for name, payload, code in bad:
    st, d = post({"mode": "replace", "data": payload})
    check("abgelehnt: " + name, st == code and d.get("kind") == "bad_request" and d.get("error"), (st, d))
st, d = post({"mode": "alles", "data": bk})
check("abgelehnt: unbekannte Art", st == 400 and "merge" in d.get("error", ""), (st, d))
st, d = post({"data": bk})
check("abgelehnt: ohne Art", st == 400, (st, d))
check("nach Fehlern unverändert", files_snapshot() == before)

# zu tief verschachtelt (RecursionError) → 400, kein 500
deep = b'{"mode":"replace","data":' + b"[" * 100000 + b"]" * 100000 + b"}"
st, _, data = req("POST", "/api/backup", deep, JSON)
check("sehr tief (JSON-Parser) → 400, kein 500", st == 400, (st, data[:200]))
try:   # je nach Python-Version RecursionError beim Lesen oder erst die eigene Tiefenprüfung – beides deutsch
    backup.validate(backup.parse(b'{"format":"druckwerkstatt-backup","version":1,"server":{},"browser":' + b"[" * 100000 + b"]" * 100000 + b"}"))
    check("sehr tief → Fehler", False)
except backup.BackupError as e:
    check("sehr tief → Fehler", "verschachtelt" in str(e), e)
nest = {"format": backup.FORMAT, "version": 1, "server": dict(bk["server"])}
x = nest
for _ in range(60):
    x["browser"] = {}
    x = x["browser"]
st, d = post({"mode": "merge", "data": nest})
check("zu tief (Prüfung) → 400", st == 400, (st, d))
st, _, data = req("POST", "/api/backup", b"{kaputt", JSON)
check("kaputtes JSON → 400", st == 400 and "JSON" in data.decode(), (st, data))

# Größe: Content-Length über der Grenze → 413 ohne Lesen; falscher Typ → 415
s = socket.create_connection(("127.0.0.1", PORT), timeout=10)
s.sendall(("POST /api/backup HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n"
           % (backup.MAX_BYTES + 1)).encode())
resp = s.recv(4096)
s.close()
check("zu groß → 413", resp.startswith(b"HTTP/1.0 413") or resp.startswith(b"HTTP/1.1 413"), resp[:60])
st, _, _ = req("POST", "/api/backup", json.dumps({"mode": "merge", "data": bk}), {"Content-Type": "text/plain"})
check("nicht JSON → 415", st == 415, st)
check("nach Größenfehlern unverändert", files_snapshot() == before)

# Schreibfehler beim zweiten Teil: erster Teil darf nicht ersetzt sein (erst alle .tmp, dann umbenennen)
blocked = tempfile.mkdtemp(prefix="backup-blocked-")
sp3, pr3 = os.path.join(blocked, "spools.json"), os.path.join(blocked, "kein-ordner", "prefs.json")
spools.save(spools.empty_state(), sp3)
open(os.path.join(blocked, "kein-ordner"), "w").close()   # Datei statt Ordner → prefs nicht schreibbar
orig = open(sp3, "rb").read()
try:
    backup.restore(bk, "replace", spool_path=sp3, prefs_path=pr3)
    check("Schreibfehler gemeldet", False)
except backup.BackupError as e:
    check("Schreibfehler gemeldet", "nicht gespeichert" in str(e), e)
check("Schreibfehler: Spulen unverändert", open(sp3, "rb").read() == orig)
check("Schreibfehler: keine .tmp-Reste", not [f for f in os.listdir(blocked) if f.endswith(".tmp")], os.listdir(blocked))

# --- 6) Zugriffsschutz
st, _, _ = req("GET", "/api/backup", headers={"Sec-Fetch-Site": "cross-site"})
check("Export von fremder Seite → 403", st == 403, st)
st, _, _ = req("GET", "/api/backup", headers={"Sec-Fetch-Site": "same-origin"})
check("Export von eigener Seite → 200", st == 200, st)
os.environ["KONFIGURATOR_PIN"] = "4711"
check("PIN: Export 401", req("GET", "/api/backup")[0] == 401)
check("PIN: Einspielen 401", post({"mode": "merge", "data": bk})[0] == 401)
os.environ.pop("KONFIGURATOR_PIN")
check("fremder Servername ohne PIN → 403", req("GET", "/api/backup", headers={"Host": "evil.example.com"})[0] == 403)
# nur ansehen (Home Assistant ohne Admin-Rechte) – Ingress hier von 127.0.0.1
os.environ["SUPERVISOR_TOKEN"] = "sup-token"
proxy, serve.INGRESS_PROXY = serve.INGRESS_PROXY, "127.0.0.1"
ha_users._cache.update(at=time.time(), ok=True, admins={"admin1"}, users={"admin1", "user1"})
ing = lambda uid: {"X-Ingress-Path": "/api/hassio_ingress/abc", "X-Remote-User-Id": uid}  # noqa: E731
check("nur ansehen: Export 403", req("GET", "/api/backup", headers=ing("user1"))[0] == 403)
check("nur ansehen: Einspielen 403", post({"mode": "merge", "data": bk}, ing("user1"))[0] == 403)
check("Admin: Export 200", req("GET", "/api/backup", headers=ing("admin1"))[0] == 200)
check("Admin: Einspielen 200", post({"mode": "merge", "data": bk}, ing("admin1"))[0] == 200)
serve.INGRESS_PROXY = proxy
os.environ.pop("SUPERVISOR_TOKEN")
check("nach allem keine .tmp-Reste", not [f for f in os.listdir(tmp) if f.endswith(".tmp")], os.listdir(tmp))

srv.shutdown()
for d in (tmp, other, blocked):
    shutil.rmtree(d, ignore_errors=True)
print("backup.py: %d ok, %d Fehler" % (passed, failed))
sys.exit(1 if failed else 0)
