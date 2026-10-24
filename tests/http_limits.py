"""Prüft die Härtung von tools/serve.py auf HTTP-Ebene: Content-Length (negativ, ungültig, zu groß), kaputtes JSON,
JSON ohne Objekt, interne Fehler (500 statt keiner Antwort), nur Dateien der Seite (kein .git, tools/, keine
Verzeichnislisten), Servername ohne PIN (DNS-Rebinding), Upload-Plätze (503), Kamera/Stand von fremden Seiten,
globale PIN-Sperre, Aufräumen der Slice-Aufträge während einer Übernahme, eine Benutzerabfrage bei Home Assistant.
Aufruf: python tests/http_limits.py (ohne Drucker, ohne OrcaSlicer)."""
import functools
import http.client
import json
import os
import socket
import sys
import tempfile
import threading
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
tmp = tempfile.mkdtemp(prefix="http-limits-")
os.environ["DATA_DIR"] = tmp
os.environ["SPOOL_FILE"] = os.path.join(tmp, "spools.json")
os.environ["QUEUE_FILE"] = os.path.join(tmp, "queue.json")
os.environ["SLICE_JOBS_DIR"] = os.path.join(tmp, "jobs")
for k in ("KONFIGURATOR_PIN", "KONFIGURATOR_PRINTER", "KONFIGURATOR_ALLOWED_HOSTS", "SUPERVISOR_TOKEN"):
    os.environ.pop(k, None)
import serve  # noqa: E402
import slicer  # noqa: E402
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


def req(method, path, body=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, r.headers, data


def raw(lines, body=b""):
    """Anfrage von Hand (eigene Content-Length) – Antwort (Status, Inhalt)."""
    s = socket.create_connection(("127.0.0.1", PORT), timeout=10)
    s.sendall(("\r\n".join(lines) + "\r\n\r\n").encode() + body)
    data = b""
    while True:
        try:
            chunk = s.recv(65536)
        except socket.timeout:
            break
        if not chunk:
            break
        data += chunk
    s.close()
    head, _, rest = data.partition(b"\r\n\r\n")
    if not head.startswith(b"HTTP/"):
        return 0, data   # ohne Statuszeile (HTTP/0.9-Antwort)
    return int(head.split(b" ")[1]), rest


def post_len(path, length, ctype="application/json", body=b""):
    return raw(["POST %s HTTP/1.1" % path, "Host: 127.0.0.1", "Content-Type: " + ctype, "Content-Length: " + length,
                "Connection: close"], body)


def j(data):
    try:
        return json.loads(data)
    except ValueError:
        return {}


# 1) Content-Length
st, data = post_len("/api/prefs", "-1")
check("negative Content-Length → 400", st == 400 and j(data).get("kind") == "bad_request", (st, data))
st, data = post_len("/api/anycubic/command", "abc")
check("ungültige Content-Length → 400 JSON", st == 400 and "Content-Length" in j(data).get("error", ""), (st, data))
st, data = post_len("/api/queue", str(serve.MAX_BODY + 1))
check("zu groß → 413", st == 413, (st, data))
st, data = post_len("/api/slice", str(slicer.MAX_BYTES + 1), "application/octet-stream")
check("3MF zu groß → 413", st == 413, (st, data))
st, data = post_len("/api/prefs", "\u00b2")
check("Content-Length „²“ → 400", st == 400, (st, data))
st, data = post_len("/api/gcode", "-5", "application/octet-stream")
check("G-Code negative Länge → 400", st == 400, (st, data))
st, data = raw(["POST /login HTTP/1.1", "Host: 127.0.0.1", "Content-Length: x", "Connection: close"])
check("ohne PIN: /login unbekannt (404)", st == 404, st)
os.environ["KONFIGURATOR_PIN"] = "4711"
st, data = raw(["POST /login HTTP/1.1", "Host: 127.0.0.1", "Content-Type: application/x-www-form-urlencoded", "Content-Length: x", "Connection: close"])
check("Anmeldung mit ungültiger Länge → 400 statt Absturz", st == 400, st)
os.environ.pop("KONFIGURATOR_PIN")

# 2) JSON: kaputt, kein Objekt, interner Fehler
H = {"Content-Type": "application/json"}
st, _, data = req("POST", "/api/prefs", b"{kaputt", H)
check("kaputtes JSON → 400 JSON", st == 400 and j(data).get("kind") == "bad_request", (st, data))
st, _, data = req("POST", "/api/schedule", b"{kaputt", H)
check("kaputtes JSON (schedule) → 400 JSON", st == 400 and j(data).get("kind") == "bad_request", (st, data))
for path in ("/api/prefs", "/api/schedule", "/api/anycubic/command", "/api/anycubic/print", "/api/queue", "/api/spools"):
    st, _, data = req("POST", path, b"[1, 2]", H)
    check("JSON ohne Objekt → 400 (%s)" % path, st == 400 and "Objekt" in j(data).get("error", ""), (st, data))
st, _, data = req("POST", "/api/prefs", b'"text"', H)
check("JSON-Text → 400", st == 400, st)
orig = serve.prefs.api_post
serve.prefs.api_post = lambda body: 1 / 0
st, _, data = req("POST", "/api/prefs", b"{}", H)
serve.prefs.api_post = orig
check("interner Fehler → 500 JSON", st == 500 and j(data).get("kind") == "internal", (st, data))
st, _, data = req("POST", "/api/unbekannt", b"{}", H)
check("unbekannter POST → 404", st == 404 and j(data).get("kind") == "not_found", (st, data))

# 3) nur Dateien der Seite
for path in ("/.git/config", "/.git/HEAD", "/tools/", "/tools/serve.py", "/tools/login.html", "/README.md", "/Dockerfile",
             "/js/", "/vendor/", "/js/../tools/serve.py", "/%2e%2e/tools/serve.py", "/js/%2e%2e/tools/serve.py",
             "/tests/auth.py", "/tests/", "/.github/workflows/tests.yml", "/js/.hidden"):
    st, _, data = req("GET", path)
    check("gesperrt: " + path, st == 404 and b"<li>" not in data, st)
check("HEAD /.git/config → 404", req("HEAD", "/.git/config")[0] == 404)
for path in ("/", "/index.html", "/index.html?alle-drucker", "/js/app.js", "/css/app.css", "/vendor/three.min.js", "/img/favicon.svg",
             "/docs/Handbuch.pdf", "/tests/ui-smoke.js"):
    check("frei: " + path, req("GET", path)[0] == 200, req("GET", path)[0])
os.environ["KONFIGURATOR_CACHE"] = "0"   # ohne Cache: SimpleHTTPRequestHandler – auch dort keine Listen
check("ohne Cache: /js/ ohne Liste", req("GET", "/js/")[0] == 404)
check("ohne Cache: /.git/config", req("GET", "/.git/config")[0] == 404)
check("ohne Cache: /js/app.js", req("GET", "/js/app.js")[0] == 200)
os.environ.pop("KONFIGURATOR_CACHE")
check("static_allowed: Backslash", not serve.static_allowed("/js/..\\tools\\serve.py"))

# 4) Servername ohne PIN (DNS-Rebinding)
st, h, data = req("GET", "/api/queue", headers={"Host": "boese.example:%d" % PORT})
check("fremder Servername → 403", st == 403 and b"KONFIGURATOR_ALLOWED_HOSTS" in data, (st, data))
check("fremder Servername: auch Seite", req("GET", "/", headers={"Host": "boese.example"})[0] == 403)
check("fremder Servername: auch POST", req("POST", "/api/prefs", b"{}", dict(H, Host="rebind.example.com"))[0] == 403)
os.environ["KONFIGURATOR_PRINTER"] = "192.168.1.50"
st, _, data = req("GET", "/api/health", headers={"Host": "boese.example"})
check("fremder Servername: /api/health offen, ohne Drucker", st == 200 and j(data).get("printer") is None, (st, data))
check("IP-Adresse: /api/health mit Drucker", j(req("GET", "/api/health")[2]).get("printer") == "192.168.1.50")
os.environ.pop("KONFIGURATOR_PRINTER")
for host in ("127.0.0.1:%d" % PORT, "192.168.1.5:8765", "[::1]:8765", "[fe80::1]", "localhost:8765", "nas", "homeassistant:8765",
             "drucker.local", "NAS.LAN:8765", "box.home.arpa", "x.internal", "nas.fritz.box", "drucker.local."):
    check("erlaubter Servername: " + host, req("GET", "/api/queue", headers={"Host": host})[0] == 200, host)
os.environ["KONFIGURATOR_ALLOWED_HOSTS"] = "drucker.example.de, werkstatt.example.org"
check("KONFIGURATOR_ALLOWED_HOSTS", req("GET", "/api/queue", headers={"Host": "Drucker.Example.de:8765"})[0] == 200)
check("KONFIGURATOR_ALLOWED_HOSTS: andere weiter gesperrt", req("GET", "/api/queue", headers={"Host": "boese.example.de"})[0] == 403)
os.environ.pop("KONFIGURATOR_ALLOWED_HOSTS")
os.environ["KONFIGURATOR_PIN"] = "4711"
check("mit PIN: Servername egal (Anmeldung nötig)", req("GET", "/api/queue", headers={"Host": "boese.example"})[0] == 401)
os.environ.pop("KONFIGURATOR_PIN")

# 5) Upload-Plätze: höchstens zwei große Dateien gleichzeitig
serve.UPLOAD_SLOTS.acquire()
serve.UPLOAD_SLOTS.acquire()
st, data = post_len("/api/gcode?name=x", "10", "application/octet-stream", b"G1 X1 Y1\n\n")
serve.UPLOAD_SLOTS.release()
serve.UPLOAD_SLOTS.release()
check("Upload belegt → 503 sofort", st == 503 and j(data).get("kind") == "busy", (st, data))
st, _, data = req("POST", "/api/gcode?name=t.gcode", b"; G-Code\nG1 X1 Y1 E1\n", {"Content-Type": "application/octet-stream"})
check("G-Code danach angenommen", st == 200 and j(data).get("job"), (st, data[:200]))
st, _, data = req("POST", "/api/gcode", b"kein gcode", {"Content-Type": "application/octet-stream"})
check("Upload-Platz nach Fehler frei", st == 400 and serve.UPLOAD_SLOTS.acquire(blocking=False) and serve.UPLOAD_SLOTS.acquire(blocking=False), st)
serve.UPLOAD_SLOTS.release()
serve.UPLOAD_SLOTS.release()

# 6) Kamera und Stand von fremden Seiten
st, _, data = req("GET", "/api/anycubic/camera?host=192.168.1.9", headers={"Sec-Fetch-Site": "cross-site"})
check("Kamera von fremder Seite → 403", st == 403, (st, data))
st, _, data = req("GET", "/api/anycubic/status?host=192.168.1.9", headers={"Sec-Fetch-Site": "same-site"})
check("Stand von fremder Seite ohne Drucker → 403", st == 403, (st, data))
calls = []
orig_status = serve.anycubic_lan.status
serve.anycubic_lan.status = lambda host, pos=False: calls.append((host, pos)) or {"ok": True}
os.environ["KONFIGURATOR_PRINTER"] = "192.168.1.50"
req("GET", "/api/anycubic/status?host=192.168.1.9&pos=1", headers={"Sec-Fetch-Site": "cross-site"})
req("GET", "/api/anycubic/status?host=192.168.1.9", headers={"Sec-Fetch-Site": "same-origin"})
req("GET", "/api/anycubic/status?host=192.168.1.8")
os.environ.pop("KONFIGURATOR_PRINTER")
serve.anycubic_lan.status = orig_status
check("fremde Seite: nur eingestellter Drucker; eigene Seite frei", calls == [("192.168.1.50", False), ("192.168.1.9", False), ("192.168.1.8", False)], calls)

# 7) Protokoll ohne Pfad (kaputte Anfragezeile) bricht nicht ab
# (Python 3.12 antwortet darauf ohne Statuszeile, wie HTTP/0.9 – dann zählt die Fehlerseite)
st, data = raw(["KAPUTT"])
check("kaputte Anfragezeile → Antwort 400", st == 400 or b"Error code: 400" in (data or b""), (st, (data or b"")[:80]))
h = serve.Handler.__new__(serve.Handler)
h.client_address, h.requestline = ("127.0.0.1", 1), ""
try:
    h.log_message("%s", "nur ein Wert")
    h.log_message("%s %s %s", "x", "404", "-")
    check("log_message ohne path/command", True)
except Exception as e:
    check("log_message ohne path/command", False, repr(e))

# 8) globale PIN-Sperre: viele Adressen zusammen höchstens LOGIN_MAX_FAILS_ALL
serve._fails.clear()
serve._fails_all.clear()
for i in range(serve.LOGIN_MAX_FAILS_ALL - 1):
    serve.login_failed("10.0.0.%d" % i)
check("knapp unter der Grenze noch frei", not serve.login_blocked("10.9.9.9"))
serve.login_failed("10.0.0.99")
check("nach %d Fehlversuchen verschiedener Adressen gesperrt" % serve.LOGIN_MAX_FAILS_ALL, serve.login_blocked("10.9.9.9"))
serve._fails_all[:] = [time.time() - serve.LOGIN_WINDOW - 1] * serve.LOGIN_MAX_FAILS_ALL
check("globale Sperre verfällt", not serve.login_blocked("10.9.9.9"))
serve._fails.clear()
serve._fails_all.clear()

# 9) Slice-Aufträge: der übernommene Auftrag (reuse) wird nicht weggeräumt
first, _ = slicer._new_job_dir()
with slicer._protect(first):
    for _ in range(slicer.KEEP_JOBS + 3):
        slicer._new_job_dir()
    check("übernommener Auftrag bleibt beim Aufräumen", os.path.isdir(os.path.join(slicer.JOBS_DIR, first)))
check("Schutz danach aufgehoben", first not in slicer._protected)
keep, _ = slicer._new_job_dir()
for _ in range(slicer.KEEP_JOBS + 3):
    slicer._new_job_dir(protect=[keep])
check("protect beim Anlegen", os.path.isdir(os.path.join(slicer.JOBS_DIR, keep)))
for _ in range(slicer.KEEP_JOBS + 1):
    slicer._new_job_dir()
check("ohne Schutz wieder aufgeräumt", not os.path.isdir(os.path.join(slicer.JOBS_DIR, first)) and not os.path.isdir(os.path.join(slicer.JOBS_DIR, keep)))

# 10) Home Assistant: nur eine Benutzerabfrage gleichzeitig, die anderen nehmen den alten Stand
fetches = []


def slow_fetch():
    fetches.append(1)
    time.sleep(0.3)
    return {"admin1": True}


orig_fetch = ha_users._fetch_users
ha_users._fetch_users = slow_fetch
ha_users._cache.update(at=time.time() - ha_users.CACHE_S - 1, ok=True, admins={"admin1"}, users={"admin1"})
res = []
ts = [threading.Thread(target=lambda: res.append(ha_users.is_admin("admin1"))) for _ in range(8)]
for t in ts:
    t.start()
for t in ts:
    t.join()
check("eine Abfrage für viele Anfragen", len(fetches) == 1 and res == [True] * 8, (len(fetches), res))
fetches.clear()
ha_users._cache.update(at=0, ok=False, admins=set(), users=set())   # noch nie abgefragt: warten statt „nur ansehen“
res = []
ts = [threading.Thread(target=lambda: res.append(ha_users.is_admin("admin1"))) for _ in range(5)]
for t in ts:
    t.start()
for t in ts:
    t.join()
check("erste Abfrage: alle warten auf das Ergebnis", len(fetches) == 1 and res == [True] * 5, (len(fetches), res))
ha_users._fetch_users = orig_fetch

check("Verbindungs-Zeitlimit gesetzt", 0 < (serve.Handler.timeout or 0) <= 120, serve.Handler.timeout)

srv.shutdown()
print("%d ok, %d fehlgeschlagen" % (passed, failed))
sys.exit(1 if failed else 0)
