"""Kameraquelle je Drucker: Rinkhals (MJPEG von mjpg-streamer) oder Werksfirmware (HTTP-FLV, tools/anycubic_lan.py).

Mit Rinkhals (eigene Firmware-Erweiterung für den Kobra S1) meldet Moonraker auf Port 7125 die Kamera unter
GET /server/webcams/list (gemessen 2026-10-25: service „mjpegstreamer-adaptive“, stream_url „/webcam/?action=stream“,
snapshot_url „/webcam/?action=snapshot“, 4:3, 15 fps). mjpg-streamer liefert das Bild ohne MQTT-Befehl – anders als
video/startCapture der Werksfirmware schaltet das das Licht nicht ein. Relative Pfade gelten für die Weboberfläche
auf Port 80 (leitet an mjpg-streamer weiter); geht das nicht, direkt mjpg-streamer auf Port 8080.

Nur Lesen über HTTP, keine MQTT-Befehle. Ergebnis je Drucker WEBCAM_CACHE_S zwischengespeichert (ohne Antwort von
Moonraker nur MISS_CACHE_S: kurz nach dem Einschalten startet Moonraker später als der Rest).
"""
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

# Ports als Modulwerte – die Tests setzen eigene (tests/camera_src.py)
MOONRAKER_PORT = 7125
WEB_PORT = 80
MJPEG_PORT = 8080
DETECT_TIMEOUT_S = 2
WEBCAM_CACHE_S = 300
MISS_CACHE_S = 30
SNAPSHOT_MAX = 8 * 1024 * 1024
MJPEG_SERVICES = ("mjpegstreamer", "uv4l-mjpeg")   # Moonraker-Dienste, deren stream_url MJPEG liefert

_cache = {}   # host → (Zeit, Ergebnis oder None, gültig in s)
_lock = threading.Lock()


def _url(host, path, port):
    """Pfad aus der Webcam-Liste → Adresse auf dem Drucker; absolute Adressen nur, wenn sie auf denselben Drucker zeigen."""
    if not isinstance(path, str) or not path.strip():
        return None
    u = urllib.parse.urlparse(path.strip())
    if u.scheme or u.netloc:
        if u.scheme != "http" or u.hostname != host:
            return None
        return u.geturl()
    if not u.path.startswith("/"):
        return None
    return "http://%s:%d%s" % (host, port, path.strip())


def _probe(host):
    """Webcam-Liste von Moonraker → Quelle (dict) oder None; zweiter Wert: hat Moonraker geantwortet?"""
    url = "http://%s:%d/server/webcams/list" % (host, MOONRAKER_PORT)
    for attempt in range(2):   # zweiter Versuch: die erste Anfrage hing am echten Drucker einmal über 3 s (2026-10-25)
        try:
            with urllib.request.urlopen(url, timeout=DETECT_TIMEOUT_S) as r:
                data = json.loads(r.read(256 * 1024).decode("utf-8"))
            break
        except urllib.error.HTTPError:
            return None, True    # Moonraker da, aber ohne Webcam-Liste
        except urllib.error.URLError as e:
            if attempt or isinstance(e.reason, ConnectionRefusedError):
                return None, False   # Port zu: Werksfirmware (oder Moonraker startet noch) – sofort, ohne zweiten Versuch
        except (OSError, ValueError):
            if attempt:
                return None, False
    cams = ((data or {}).get("result") or {}).get("webcams") if isinstance(data, dict) else None
    for cam in cams if isinstance(cams, list) else []:
        if not isinstance(cam, dict) or cam.get("enabled") is False:
            continue
        if not str(cam.get("service") or "").startswith(MJPEG_SERVICES):
            continue
        fallback = "http://%s:%d/?action=" % (host, MJPEG_PORT)
        streams = [_url(host, cam.get("stream_url"), WEB_PORT), fallback + "stream"]
        snaps = [_url(host, cam.get("snapshot_url"), WEB_PORT), fallback + "snapshot"]

        def num(v, lo, hi):
            return v if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi else None
        aspect = cam.get("aspect_ratio")
        return {"source": "mjpeg",
                "streams": [s for i, s in enumerate(streams) if s and s not in streams[:i]],
                "snapshots": [s for i, s in enumerate(snaps) if s and s not in snaps[:i]],
                "fps": num(cam.get("target_fps"), 1, 120),
                "aspect": aspect if isinstance(aspect, str) and len(aspect) <= 8 else None,
                "flip_h": cam.get("flip_horizontal") is True, "flip_v": cam.get("flip_vertical") is True,
                "rotation": cam.get("rotation") if cam.get("rotation") in (0, 90, 180, 270) else 0}, True
    return None, True


def detect(host, fresh=False):
    """Rinkhals-Kamera dieses Druckers (dict mit streams/snapshots …) oder None (Werksfirmware → FLV)."""
    now = time.time()
    with _lock:
        hit = _cache.get(host)
    if hit and not fresh and now - hit[0] < hit[2]:
        return hit[1]
    cam, answered = _probe(host)
    if not answered and hit and hit[1]:
        # schon als Rinkhals erkannt, Moonraker antwortet gerade nur nicht: nicht auf FLV wechseln (startCapture schaltete
        # das Licht ein) – geht der Strom wirklich nicht mehr, vergisst serve.py die Quelle (forget)
        cam = hit[1]
    with _lock:
        _cache[host] = (now, cam, WEBCAM_CACHE_S if answered else MISS_CACHE_S)
        if len(_cache) > 64:   # nur ein paar Drucker im Heimnetz; alte Einträge weg
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:len(_cache) - 64]:
                del _cache[k]
    return cam


def forget(host):
    """Quelle neu bestimmen (Stream ging nicht – Rinkhals aus, Drucker neu gestartet)."""
    with _lock:
        _cache.pop(host, None)


def info(host):
    """Für die Seite: welcher Spieler (mjpeg → <img>, flv → mpegts.js), dazu fps, Seitenverhältnis, Spiegeln/Drehen."""
    cam = detect(host)
    if not cam:
        return {"source": "flv"}
    return {k: cam[k] for k in ("source", "fps", "aspect", "flip_h", "flip_v", "rotation")}


def open_first(urls, ctype, timeout=10):
    """Erste Adresse, die mit diesem Inhaltstyp antwortet (urlopen-Antwort) – sonst OSError mit dem letzten Grund."""
    err = OSError("keine Kamera-Adresse")
    for u in urls:
        try:
            r = urllib.request.urlopen(u, timeout=timeout)
        except OSError as e:
            err = e
            continue
        got = (r.headers.get("Content-Type") or "").strip().lower()
        if got.startswith(ctype):
            return r
        r.close()
        err = OSError("unerwarteter Inhalt (%s)" % (got or "ohne Content-Type"))
    raise err
