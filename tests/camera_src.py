"""Kameraquelle Rinkhals (tools/camera_src.py, serve.py /api/anycubic/camera…): nachgebautes Moonraker und mjpg-streamer
auf 127.0.0.1. Prüft Erkennung, Rückfall auf FLV ohne Moonraker, Durchreichen des MJPEG-Stroms (Bytes, boundary, sofort
weiter), Standbild, Zwischenspeicher – und dass für MJPEG weder startCapture (schaltet das Licht ein) noch camera_watch läuft.
Aufruf: python tests/camera_src.py (ohne Drucker, ohne paho)."""
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
tmp = tempfile.mkdtemp(prefix="camera-src-")
os.environ["DATA_DIR"] = tmp
os.environ["SPOOL_FILE"] = os.path.join(tmp, "spools.json")
os.environ["QUEUE_FILE"] = os.path.join(tmp, "queue.json")
os.environ["SLICE_JOBS_DIR"] = os.path.join(tmp, "jobs")
for k in ("KONFIGURATOR_PIN", "KONFIGURATOR_PRINTER", "KONFIGURATOR_ALLOWED_HOSTS", "SUPERVISOR_TOKEN"):
    os.environ.pop(k, None)
import serve  # noqa: E402
import camera_src  # noqa: E402
import anycubic_lan  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER " + name + (": " + str(detail) if detail else ""))


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


BOUNDARY = "boundarydonotcross"
JPEG = b"\xff\xd8\xff\xe0" + bytes(range(256)) * 40 + b"\xff\xd9"
FRAME = ("--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % (BOUNDARY, len(JPEG))).encode() + JPEG + b"\r\n"
fake = {"webcams": [], "hits": 0, "stream_paths": [], "release": threading.Event()}


class Fake(http.server.BaseHTTPRequestHandler):
    """Moonraker (/server/webcams/list) und mjpg-streamer (…?action=stream|snapshot) in einem."""
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/server/webcams/list":
            fake["hits"] += 1
            body = json.dumps({"result": {"webcams": fake["webcams"]}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if self.path.endswith("?action=snapshot"):
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(JPEG)))
            self.end_headers()
            return self.wfile.write(JPEG)
        if self.path.endswith("?action=stream"):
            fake["stream_paths"].append((self.server.server_address[1], self.path))
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace;boundary=" + BOUNDARY)
            self.end_headers()
            self.wfile.write(FRAME)
            self.wfile.flush()
            fake["release"].wait(5)   # zweites Bild erst, wenn der Test das erste gesehen hat
            self.wfile.write(FRAME)
            return None
        self.send_error(404)


def start_fake():
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    s.daemon_threads = True
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


moon, web, mjpg = start_fake(), start_fake(), start_fake()
camera_src.MOONRAKER_PORT = moon.server_address[1]
camera_src.WEB_PORT = web.server_address[1]
camera_src.MJPEG_PORT = mjpg.server_address[1]

# Werksfirmware-Pfad nachbauen: ruft jemand camera_url/camera_watch, steht es hier (echtes camera_url sendete startCapture)
calls = []


def fake_camera_url(host):
    calls.append(("camera_url", host))
    raise anycubic_lan.LanError("Drucker meldet keine Kamera", "unsupported")


anycubic_lan.camera_url = fake_camera_url
anycubic_lan.camera_watch = lambda host, delta: calls.append(("camera_watch", host, delta))

srv = serve.Server(("127.0.0.1", 0), functools.partial(serve.Handler, directory=serve.ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
H = "127.0.0.1"


def req(path, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    c.request("GET", path, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, r.headers, data


def j(data):
    try:
        return json.loads(data)
    except ValueError:
        return {}


CAM = {"name": "Webcam", "enabled": True, "aspect_ratio": "4:3", "target_fps": 15, "target_fps_idle": 5,
       "service": "mjpegstreamer-adaptive", "stream_url": "/webcam/?action=stream", "snapshot_url": "/webcam/?action=snapshot",
       "flip_horizontal": False, "flip_vertical": False, "rotation": 0}

# 1) Ohne Moonraker (Port zu): FLV wie bisher, kein Standbild
camera_src.MOONRAKER_PORT = free_port()
st, _, data = req("/api/anycubic/camera/info?host=" + H)
check("ohne Moonraker → flv", st == 200 and j(data) == {"source": "flv"}, (st, data))
st, _, data = req("/api/anycubic/camera/snapshot?host=" + H)
check("ohne Moonraker: Standbild 404 unsupported", st == 404 and j(data).get("kind") == "unsupported", (st, data))
st, _, data = req("/api/anycubic/camera?host=" + H)
check("ohne Moonraker: Werksfirmware-Pfad (camera_url)", st == 409 and calls == [("camera_url", H)], (st, calls))
check("ohne Moonraker: nur kurz gemerkt", camera_src._cache[H][2] == camera_src.MISS_CACHE_S, camera_src._cache.get(H))
camera_src.MOONRAKER_PORT = moon.server_address[1]
camera_src.forget(H)
calls.clear()

# 2) Moonraker ohne MJPEG-Kamera (abgeschaltet, anderer Dienst): FLV, aber lange gemerkt
fake["webcams"] = [dict(CAM, enabled=False), dict(CAM, service="webrtc-camerastreamer")]
check("Kamera aus / WebRTC → flv", camera_src.info(H) == {"source": "flv"} and camera_src._cache[H][2] == camera_src.WEBCAM_CACHE_S)
camera_src.forget(H)

# 3) Rinkhals erkannt: info, Zwischenspeicher
fake.update(webcams=[CAM], hits=0)
st, _, data = req("/api/anycubic/camera/info?host=" + H)
check("Rinkhals → mjpeg", st == 200 and j(data) == {"source": "mjpeg", "fps": 15, "aspect": "4:3", "flip_h": False, "flip_v": False, "rotation": 0}, (st, data))
for _ in range(3):
    req("/api/anycubic/camera/info?host=" + H)
check("Zwischenspeicher: Moonraker nur einmal gefragt", fake["hits"] == 1, fake["hits"])
cam = camera_src.detect(H)
check("relativer Pfad → Port der Weboberfläche, dann 8080",
      cam["streams"] == ["http://%s:%d/webcam/?action=stream" % (H, camera_src.WEB_PORT), "http://%s:%d/?action=stream" % (H, camera_src.MJPEG_PORT)], cam)
t0, c0, v0 = camera_src._cache[H]
camera_src._cache[H] = (t0 - v0 - 1, c0, v0)   # 5 min später
camera_src.detect(H)
check("abgelaufen → neu gefragt", fake["hits"] == 2, fake["hits"])
camera_src.MOONRAKER_PORT = free_port()   # Moonraker antwortet kurz nicht: bei MJPEG bleiben (FLV schaltete das Licht ein)
t0, c0, v0 = camera_src._cache[H]
camera_src._cache[H] = (t0 - v0 - 1, c0, v0)
check("Moonraker kurz weg: bleibt bei MJPEG", camera_src.info(H)["source"] == "mjpeg" and camera_src._cache[H][2] == camera_src.MISS_CACHE_S)
camera_src.MOONRAKER_PORT = moon.server_address[1]
camera_src.detect(H, fresh=True)

# 4) Strom durchreichen: Content-Type mit boundary, Bytes unverändert, erstes Bild sofort (read1), kein startCapture
c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
c.request("GET", "/api/anycubic/camera?host=" + H)
r = c.getresponse()
check("Strom: 200, multipart mit boundary", r.status == 200 and r.headers.get("Content-Type") == "multipart/x-mixed-replace;boundary=" + BOUNDARY, (r.status, r.headers.get("Content-Type")))
first = b""
try:
    while len(first) < len(FRAME):
        first += r.read1(65536) if hasattr(r, "read1") else r.read(len(FRAME) - len(first))
except socket.timeout:
    pass
check("erstes Bild kommt, bevor der Strom endet", first == FRAME, len(first))
fake["release"].set()
rest = r.read()
c.close()
check("ganzer Strom unverändert", first + rest == FRAME * 2, len(first + rest))
check("Strom über Port der Weboberfläche", fake["stream_paths"][-1] == (camera_src.WEB_PORT, "/webcam/?action=stream"), fake["stream_paths"])
check("MJPEG: kein camera_url (startCapture), kein camera_watch", calls == [], calls)
check("MJPEG: keine MQTT-Verbindung zum Drucker", H not in anycubic_lan._links, list(anycubic_lan._links))

# 5) Weboberfläche fehlt: direkt mjpg-streamer auf 8080
camera_src.WEB_PORT = free_port()
camera_src.forget(H)
st, hd, data = req("/api/anycubic/camera?host=" + H)
check("ohne Port 80 → mjpg-streamer direkt", st == 200 and data == FRAME * 2 and fake["stream_paths"][-1] == (camera_src.MJPEG_PORT, "/?action=stream"), (st, len(data), fake["stream_paths"][-1:]))

# 5b) ?frames=1 (für den HA-Ingress): je Bild 4 Byte Länge + JPEG, application/octet-stream (komprimiert HA nicht)
st, hd, data = req("/api/anycubic/camera?frames=1&host=" + H)
want = (len(JPEG).to_bytes(4, "big") + JPEG) * 2
check("frames=1: Länge + JPEG je Bild", st == 200 and hd.get("Content-Type") == camera_src.FRAMES_TYPE and data == want, (st, hd.get("Content-Type"), len(data)))
check("frames=1: kein startCapture", calls == [], calls)


class Lines:
    """urlopen-Antwort nachgebaut: readline/read auf festen Bytes."""
    def __init__(self, b):
        import io
        self.f = io.BytesIO(b)

    def readline(self, n=-1):
        return self.f.readline(n)

    def read(self, n=-1):
        return self.f.read(n)


check("frames(): zwei Bilder, Leerzeilen dazwischen", list(camera_src.frames(Lines(b"\r\n" + FRAME + b"\r\n" + FRAME))) == [JPEG, JPEG])
no_len = ("--%s\r\nContent-Type: image/jpeg\r\n\r\n" % BOUNDARY).encode() + JPEG
check("frames(): ohne Content-Length → Ende", list(camera_src.frames(Lines(FRAME + no_len))) == [JPEG])
check("frames(): abgeschnittenes Bild verworfen", list(camera_src.frames(Lines(FRAME + FRAME[:-200]))) == [JPEG])
check("frames(): zu großes Bild → Ende", list(camera_src.frames(Lines(FRAME), max_bytes=100)) == [])

# 6) Standbild
st, hd, data = req("/api/anycubic/camera/snapshot?host=" + H)
check("Standbild: JPEG", st == 200 and hd.get("Content-Type") == "image/jpeg" and data == JPEG, (st, hd.get("Content-Type"), len(data)))
camera_src.WEB_PORT = web.server_address[1]

# 7) Absolute Adresse auf ein anderes Gerät: nicht benutzen (nur 8080 des Druckers)
fake["webcams"] = [dict(CAM, stream_url="http://10.0.0.99/?action=stream", snapshot_url="http://127.0.0.1:%d/webcam/?action=snapshot" % camera_src.WEB_PORT)]
cam = camera_src.detect(H, fresh=True)
check("fremde absolute Adresse verworfen", cam["streams"] == ["http://%s:%d/?action=stream" % (H, camera_src.MJPEG_PORT)], cam["streams"])
check("absolute Adresse auf den Drucker behalten", cam["snapshots"][0] == "http://127.0.0.1:%d/webcam/?action=snapshot" % camera_src.WEB_PORT, cam["snapshots"])

# 8) Strom geht nicht (Rinkhals beendet): 502 und neu bestimmen
camera_src.MJPEG_PORT, camera_src.WEB_PORT = free_port(), free_port()
fake["webcams"] = [CAM]
camera_src.detect(H, fresh=True)
st, _, data = req("/api/anycubic/camera?host=" + H)
check("Strom weg → 502, Quelle vergessen", st == 502 and j(data).get("kind") == "unreachable" and H not in camera_src._cache and calls == [], (st, data, calls))

# 9) Zugriff wie beim Kamerastrom: nur eigene Seite, nur private Adressen, nicht für „nur ansehen“
for p in ("/api/anycubic/camera/info", "/api/anycubic/camera/snapshot"):
    st, _, _ = req(p + "?host=" + H, {"Sec-Fetch-Site": "cross-site"})
    check(p + " von fremder Seite → 403", st == 403, st)
    st, _, data = req(p + "?host=8.8.8.8")
    check(p + " öffentliche Adresse → 403", st == 403 and j(data).get("kind") == "forbidden", (st, data))
    check(p + " nicht für „nur ansehen“", p not in serve.VIEWER_GET)
st, _, data = req("/api/anycubic/camera?host=8.8.8.8")
check("Kamera öffentliche Adresse → 403", st == 403, (st, data))

srv.shutdown()
print("%d bestanden, %d fehlgeschlagen" % (passed, failed))
sys.exit(1 if failed else 0)
