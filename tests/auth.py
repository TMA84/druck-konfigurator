"""Prüft den Zugriffsschutz von tools/serve.py (KONFIGURATOR_PIN): ohne PIN offen, mit PIN 401/Umleitung zur
Anmeldeseite, Anmeldung mit Cookie, falsche PIN, Sperre nach 5 Fehlversuchen (429), /api/health bleibt offen,
Home-Assistant-Ingress nur vom Supervisor-Proxy. Aufruf: python tests/auth.py (ohne Drucker)."""
import functools
import gzip
import re
import urllib.error
import http.client
import http.server
import json
import os
import sys
import tempfile
import threading
import urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
tmp = tempfile.mkdtemp(prefix="auth-")
os.environ["DATA_DIR"] = tmp
os.environ["SPOOL_FILE"] = os.path.join(tmp, "spools.json")
os.environ["QUEUE_FILE"] = os.path.join(tmp, "queue.json")
os.environ["SLICE_JOBS_DIR"] = os.path.join(tmp, "jobs")
os.environ.pop("KONFIGURATOR_PIN", None)
os.environ.pop("KONFIGURATOR_PRINTER", None)
import serve  # noqa: E402

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


def login(pin, nxt="index.html"):
    body = urllib.parse.urlencode({"pin": pin, "next": nxt})
    return req("POST", "/login", body, {"Content-Type": "application/x-www-form-urlencoded"})


# 1) ohne PIN: alles offen wie bisher
st, _, data = req("GET", "/index.html")
check("ohne PIN: Seite offen", st == 200 and b"Druckwerkstatt" in data, st)
st, _, data = req("GET", "/api/queue")
check("ohne PIN: API offen", st == 200, st)

# 2) mit PIN: API 401 JSON, Seiten → Anmeldeseite
os.environ["KONFIGURATOR_PIN"] = "4711"
st, _, data = req("GET", "/api/queue")
j = json.loads(data or b"{}")
check("PIN: API 401", st == 401 and j == {"error": "Anmeldung nötig", "kind": "auth"}, (st, data))
st, _, data = req("POST", "/api/queue", b"{}", {"Content-Type": "application/json"})
check("PIN: POST-API 401", st == 401, st)
st, h, _ = req("GET", "/index.html?alle-drucker")
check("PIN: Seite → Anmeldung", st == 303 and h["Location"] == "login?next=" + urllib.parse.quote("index.html?alle-drucker", safe=""), (st, h["Location"]))
st, h, _ = req("GET", "/js/app.js")
check("PIN: Umleitung relativ (Präfix)", st == 303 and h["Location"].startswith("../login?next=js%2Fapp.js"), h["Location"])
st, _, _ = req("GET", "/tools/login.html")
check("PIN: Vorlage nicht frei abrufbar", st == 303, st)

# 3) /api/health bleibt offen, ohne Drucker-Adresse
os.environ["KONFIGURATOR_PRINTER"] = "192.168.1.50"
st, _, data = req("GET", "/api/health")
j = json.loads(data)
check("PIN: /api/health offen", st == 200 and j["ok"] is True and "slicer" in j, (st, data))
check("PIN: /api/health ohne Drucker-IP", j.get("printer") is None and b"192.168" not in data, data)

# 4) Anmeldeseite
st, h, data = req("GET", "/login?next=index.html%3Falle-drucker")
check("Anmeldeseite", st == 200 and b'name="pin"' in data and b'action="login"' in data and b"Please enter" in data, st)
check("Anmeldeseite: Ziel übernommen", b'value="index.html?alle-drucker"' in data, data[-600:])
st, h, data = req("GET", '/login?next="><script>')
check("Anmeldeseite: Ziel bereinigt", b"<script>" not in data and b'name="next" value=""' in data)

# 5) falsche PIN
st, h, data = login("0000")
check("falsche PIN → Fehler", st == 401 and "falsche PIN" in data.decode() and "Set-Cookie" not in h, st)

# 6) richtige PIN → Cookie, Umleitung zum Ziel
st, h, _ = login("4711", "index.html?alle-drucker")
cookie = h.get("Set-Cookie") or ""
check("Anmeldung: Umleitung zum Ziel", st == 303 and h["Location"] == "./index.html?alle-drucker", (st, h["Location"]))
check("Cookie: HttpOnly, SameSite=Strict, Path=/, 30 Tage",
      "HttpOnly" in cookie and "SameSite=Strict" in cookie and "Path=/" in cookie and "Max-Age=2592000" in cookie, cookie)
token = cookie.split(";")[0]
check("Cookie: zufälliges Token", token.startswith("dk_session=") and len(token) > 40, token)
st, _, data = req("GET", "/api/queue", headers={"Cookie": token})
check("mit Cookie: API", st == 200, st)
st, _, data = req("GET", "/index.html", headers={"Cookie": "andere=1; " + token})
check("mit Cookie: Seite", st == 200 and b"Druckwerkstatt" in data, st)
st, _, data = req("GET", "/api/health", headers={"Cookie": token})
check("mit Cookie: /api/health mit Drucker", json.loads(data).get("printer") == "192.168.1.50", data)
os.environ.pop("KONFIGURATOR_PRINTER")
st, _, _ = req("GET", "/api/queue", headers={"Cookie": "dk_session=erfunden"})
check("erfundenes Token → 401", st == 401, st)
st, h, _ = login("4711", "https://boese.example/")
check("Ziel nur relativ", h["Location"] == "./", h["Location"])
st, h, _ = login("4711", "//boese.example/x")
check("Ziel ohne //", h["Location"] == "./boese.example/x", h["Location"])

# 7) Sperre: höchstens 5 Fehlversuche in 5 Minuten, dann 429 (auch mit richtiger PIN)
for i in range(5):
    st, _, _ = login("falsch%d" % i)
check("5. Fehlversuch noch 401", st == 401, st)
st, _, data = login("4711")
check("danach 429", st == 429, st)
serve._fails.clear()
st, _, _ = login("4711")
check("nach Ablauf wieder möglich", st == 303, st)
# Zeitfenster: alte Fehlversuche zählen nicht
serve._fails["127.0.0.1"] = [0.0] * 5
check("alte Fehlversuche verfallen", not serve.login_blocked("127.0.0.1"))
serve._fails.clear()

# 8) Sitzung läuft ab
t = serve.session_new()
serve._sessions[t] = 1.0
check("abgelaufene Sitzung ungültig", not serve.session_valid(t))

# 9) Ingress: nur Supervisor-Proxy UND Kopfzeile
check("Ingress: Proxy + Kopfzeile", serve.is_ingress("172.30.32.2", {"X-Ingress-Path": "/api/hassio_ingress/abc"}))
check("Ingress: Kopfzeile allein reicht nicht", not serve.is_ingress("192.168.1.20", {"X-Ingress-Path": "/x"}))
check("Ingress: Proxy ohne Kopfzeile nicht", not serve.is_ingress("172.30.32.2", {}))
check("Ingress: IPv4-mapped", serve.is_ingress("::ffff:172.30.32.2", {"X-Ingress-Path": "/x"}))
st, _, _ = req("GET", "/api/queue", headers={"X-Ingress-Path": "/api/hassio_ingress/abc"})
check("Ingress-Kopfzeile von 127.0.0.1 → 401", st == 401, st)


class Fake(serve.Handler):
    def __init__(self, ip, headers):   # ohne Socket: nur die Prüfung
        self.client_address, self.headers = (ip, 12345), headers


check("Handler: Ingress freigegeben", Fake("172.30.32.2", {"X-Ingress-Path": "/x"})._auth_ok())
check("Handler: fremde Adresse gesperrt", not Fake("172.30.32.3", {"X-Ingress-Path": "/x"})._auth_ok())

# 10) PIN wieder aus → offen
os.environ.pop("KONFIGURATOR_PIN")
st, _, _ = req("GET", "/api/queue")
check("PIN entfernt: offen", st == 200, st)
check("PIN-Vergleich ohne PIN immer falsch", not serve.pin_matches(""))

# Viele Verbindungen auf einmal (die Seite lädt gut 70 Skripte): keine wird abgewiesen (2026-10-02: Warteschlange 5 →
# einzelne Skripte fehlten, „getMat is not defined“)
import socket as _sock
from concurrent.futures import ThreadPoolExecutor
def _burst(_):
    try:
        c = _sock.create_connection(("127.0.0.1", PORT), timeout=10)
        c.sendall(b"GET /api/health HTTP/1.0\r\n\r\n")
        data = b""
        while True:
            chunk = c.recv(4096)
            if not chunk:
                break
            data += chunk
        c.close()
        return data.startswith(b"HTTP/1.0 200") or data.startswith(b"HTTP/1.1 200")
    except OSError:
        return False
check("Server-Warteschlange groß genug", serve.Server.request_queue_size >= 64, serve.Server.request_queue_size)
with ThreadPoolExecutor(max_workers=100) as ex:
    results = list(ex.map(_burst, range(100)))
check("100 gleichzeitige Verbindungen: alle beantwortet", all(results), "%d/100" % sum(results))

# Dateien der Seite: index.html mit ?v=, versionierte Dateien dauerhaft im Cache, sonst ETag/304, Texte gzip
import urllib.request as _ur
def _get(path, headers=None):
    req = _ur.Request("http://127.0.0.1:%d%s" % (PORT, path), headers=headers or {})
    try:
        with _ur.urlopen(req) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), b""
if not serve.auth_pin():
    st_, h, body = _get("/")
    html_ = gzip.decompress(body).decode() if h.get("Content-Encoding") == "gzip" else body.decode()
    check("index.html: eigene Skripte mit ?v=", 'src="js/app.js?v=' in html_ and h.get("Cache-Control") == "no-cache", h.get("Cache-Control"))
    v = re.search(r'js/app.js\?v=([0-9a-f]+)', html_).group(1)
    st_, h, body = _get("/js/app.js?v=" + v, {"Accept-Encoding": "gzip"})
    check("versioniert: dauerhaft im Cache, gzip", "immutable" in h.get("Cache-Control", "") and h.get("Content-Encoding") == "gzip" and b"loadFiles" in gzip.decompress(body), h)
    st_, h, _b = _get("/js/app.js")
    st2, h2, _b2 = _get("/js/app.js", {"If-None-Match": h.get("ETag", "")})
    check("ohne Version: ETag, Nachfrage → 304", h.get("Cache-Control") == "no-cache" and st2 == 304, (h.get("ETag"), st2))
    check("API weiter ohne Cache", _get("/api/health")[1].get("Cache-Control") == "no-store")
    check("kein Zugriff außerhalb des Ordners", _get("/../../etc/passwd")[0] in (400, 403, 404))

srv.shutdown()
print("%d ok, %d fehlgeschlagen" % (passed, failed))
sys.exit(1 if failed else 0)
