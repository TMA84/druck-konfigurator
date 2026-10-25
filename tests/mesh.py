"""Prüft das Bettnetz (tools/mesh.py, GET /api/anycubic/mesh in tools/serve.py) gegen einen nachgebauten Moonraker auf
127.0.0.1: gültige Daten, abgelehnte Verbindung (Werksfirmware → Hinweis „nur mit Rinkhals“), kaputtes JSON, ungleich
lange Zeilen, NaN/Text, zu großes Netz, kein Netz geladen, Adresse außerhalb des Heimnetzes.
Aufruf: python tests/mesh.py (ohne Drucker)."""
import functools
import http.client
import http.server
import json
import os
import socket
import sys
import tempfile
import threading

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
tmp = tempfile.mkdtemp(prefix="mesh-")
os.environ["DATA_DIR"] = tmp
os.environ["SPOOL_FILE"] = os.path.join(tmp, "spools.json")
os.environ["QUEUE_FILE"] = os.path.join(tmp, "queue.json")
for k in ("KONFIGURATOR_PIN", "KONFIGURATOR_PRINTER", "KONFIGURATOR_ALLOWED_HOSTS", "SUPERVISOR_TOKEN"):
    os.environ.pop(k, None)
import mesh  # noqa: E402
import serve  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER " + name + (": " + str(detail) if detail else ""))


# echte Antwort des Kobra S1 mit Rinkhals (2026-10-25), gekürzt um die übrigen Objekte
PROBED = [[1.013833, 0.704667, 0.666333, 0.6965, 1.104333], [0.516667, 0.331333, 0.328667, 0.5115, 0.869333],
          [0.261167, -0.034167, 0.095833, 0.412, 0.745167], [0.012333, 0.126333, 0.193, 0.350833, 0.452],
          [0.011, 0.259833, 0.298167, 0.296, 0.335]]


def answer(bm):
    return json.dumps({"result": {"eventtime": 1.0, "status": {"mmu": {"enabled": True}, "bed_mesh": bm}}})


GOOD = {"profile_name": "default", "mesh_min": [5.0, 5.0], "mesh_max": [245.0, 245.0], "probed_matrix": PROBED,
        "mesh_matrix": PROBED, "profiles": {}}
fake = {"body": answer(GOOD), "code": 200}


class Moonraker(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = fake["body"].encode()
        self.send_response(fake["code"])
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


moon = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Moonraker)
threading.Thread(target=moon.serve_forever, daemon=True).start()
os.environ["KONFIGURATOR_MOONRAKER_PORT"] = str(moon.server_address[1])

srv = serve.Server(("127.0.0.1", 0), functools.partial(serve.Handler, directory=serve.ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()


def get(host="127.0.0.1", headers=None):
    c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=15)
    c.request("GET", "/api/anycubic/mesh?host=" + host, headers=headers or {})
    r = c.getresponse()
    data = json.loads(r.read() or b"{}")
    c.close()
    return r.status, data


def with_body(bm_or_text, code=200):
    fake["body"] = bm_or_text if isinstance(bm_or_text, str) else answer(bm_or_text)
    fake["code"] = code
    return get()


# gültig
st, d = get()
check("gültig: 200", st == 200, (st, d))
check("gültig: Matrix und Grenzen", d.get("probed") == PROBED and d.get("mesh") == PROBED and d.get("min") == [5.0, 5.0]
      and d.get("max") == [245.0, 245.0] and d.get("profile") == "default" and d.get("source") == "moonraker", d)
# interpoliertes Netz größer als das gemessene; ganze Zahlen werden zu float
big = [[float(x + y) for x in range(9)] for y in range(9)]
st, d = with_body({**GOOD, "mesh_matrix": big, "mesh_min": [5, 5]})
check("mesh_matrix größer: übernommen", st == 200 and len(d["mesh"]) == 9 and len(d["probed"]) == 5 and d["min"] == [5.0, 5.0], (st, d))
# mesh_matrix fehlt → probed
st, d = with_body({k: v for k, v in GOOD.items() if k != "mesh_matrix"})
check("ohne mesh_matrix: gemessenes Netz", st == 200 and d["mesh"] == PROBED, (st, d))

# kaputte Daten → 502
for name, bm in [
    ("ungleich lange Zeilen", {**GOOD, "probed_matrix": [[0.1, 0.2], [0.1]]}),
    ("NaN", {**GOOD, "probed_matrix": [[0.1, float("nan")], [0.1, 0.2]]}),
    ("Text", {**GOOD, "probed_matrix": [[0.1, "0.2"], [0.1, 0.2]]}),
    ("Wahrheitswert", {**GOOD, "probed_matrix": [[0.1, True], [0.1, 0.2]]}),
    ("zu groß (51 Spalten)", {**GOOD, "probed_matrix": [[0.0] * 51, [0.0] * 51]}),
    ("zu klein (1 Zeile)", {**GOOD, "probed_matrix": [[0.0, 0.1, 0.2]]}),
    ("keine Liste", {**GOOD, "probed_matrix": "1,2,3"}),
    ("mesh_matrix kaputt", {**GOOD, "mesh_matrix": [[1, 2], [3]]}),
    ("mesh_min fehlt", {k: v for k, v in GOOD.items() if k != "mesh_min"}),
    ("mesh_max ≤ mesh_min", {**GOOD, "mesh_max": [5.0, 245.0]}),
    ("mesh_min unendlich", {**GOOD, "mesh_min": [float("-inf"), 5.0]}),
]:
    st, d = with_body(bm)
    check("kaputt (%s): 502" % name, st == 502 and d.get("kind") == "bad_response", (st, d))
st, d = with_body("{kein json")
check("kaputtes JSON: 502", st == 502 and d.get("kind") == "bad_response", (st, d))
st, d = with_body('{"result": 5}')
check("unerwartete Struktur: 502", st == 502 and d.get("kind") == "bad_response", (st, d))
st, d = with_body("x" * (mesh.MAX_BYTES + 10))
check("zu große Antwort: 502", st == 502 and "zu groß" in d.get("error", ""), (st, d))

# kein Netz geladen → 404 empty
st, d = with_body({**GOOD, "probed_matrix": [[]], "mesh_matrix": [[]]})
check("kein Netz geladen: 404 empty", st == 404 and d.get("kind") == "empty", (st, d))
st, d = with_body(json.dumps({"result": {"status": {}}}))
check("bed_mesh fehlt: 404 empty", st == 404 and d.get("kind") == "empty", (st, d))
# anderer Dienst auf dem Port (HTTP 404) → wie ohne Moonraker
st, d = with_body("{}", code=404)
check("HTTP 404 vom Port: unsupported", st == 404 and d.get("kind") == "unsupported", (st, d))
fake["code"] = 200

# Werksfirmware: Port zu → 404 unsupported mit Hinweis
s = socket.socket()
s.bind(("127.0.0.1", 0))
closed = s.getsockname()[1]
s.close()
os.environ["KONFIGURATOR_MOONRAKER_PORT"] = str(closed)
st, d = get()
check("Verbindung abgelehnt: 404 unsupported", st == 404 and d.get("kind") == "unsupported" and "Rinkhals" in d.get("error", ""), (st, d))
os.environ["KONFIGURATOR_MOONRAKER_PORT"] = str(moon.server_address[1])
fake["body"] = answer(GOOD)

# nur Heimnetz
st, d = get("8.8.8.8")
check("öffentliche Adresse: 403", st == 403 and d.get("kind") == "forbidden", (st, d))
st, d = get("")
check("ohne Adresse: 403", st == 403, (st, d))
# fremde Seite ohne eingestellten Drucker: gesperrt
st, d = get(headers={"Sec-Fetch-Site": "cross-site"})
check("fremde Seite: 403", st == 403 and d.get("kind") == "forbidden", (st, d))
# Port aus der Umgebung: Unsinn → 7125
os.environ["KONFIGURATOR_MOONRAKER_PORT"] = "abc"
check("Port ungültig → 7125", mesh.port() == 7125)
os.environ["KONFIGURATOR_MOONRAKER_PORT"] = str(moon.server_address[1])

srv.shutdown()
moon.shutdown()
print("Bettnetz: %d ok, %d Fehler" % (passed, failed))
sys.exit(1 if failed else 0)
