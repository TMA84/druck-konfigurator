"""Webserver für den Druck-Konfigurator: liefert die Seite aus und spricht mit Anycubic-Druckern.

Wie `python -m http.server`, schickt aber "Cache-Control: no-store": Sonst mischt der Browser nach
einem Update alte und neue Skripte (beobachtet 2026-09-26: alte engine.js + neue panel.js → Fehler).

API (nur Drucker mit privater IP-Adresse, siehe tools/anycubic_lan.py):
  GET  /api/health                         → {"ok": true, "lan": <LAN-Modus verfügbar>}
  GET  /api/anycubic/status?host=<ip>      → Stand für Werkbank und Belegung (stehende Verbindung, alle 5 s)
       &pos=1                                → Kopfposition auch während des Drucks abfragen (Test-Schalter der 3D-Ansicht)
  GET  /api/anycubic/camera?host=<ip>      → Kamerabild als HTTP-FLV (durchgereicht, der Drucker erlaubt kein CORS)
  POST /api/anycubic/print  {host, job, plate, name, options}  → G-Code einer geslicten Platte hochladen und drucken
  POST /api/anycubic/command  {host, type, action, data}  → nur freigegebene Einstellungen (WRITABLE)
  POST /api/slice  (3MF als application/octet-stream)  → Verbrauch je Slot und Druckzeit je Platte (OrcaSlicer), job-Id
       ?plates=2,3&count=4&reuse=<job>                  → nur diese Platten neu slicen, die übrigen aus <job> übernehmen
  GET  /api/slice/<job>/plate_<n>.preview              → kompakte Schichtvorschau (tools/gcode_preview.py)
  GET  /api/slice/<job>/plate_<n>.gcode                → G-Code zum Herunterladen
  GET  /api/spools                                     → Filamentverwaltung: Spulen mit Restmenge (tools/spools.py)
  POST /api/spools  {action: update|add|delete|config, …} → Spule ändern, Drucker für die Verbrauchszählung festlegen
  GET  /api/printing/preview?name=<Auftrag>          → Schichtvorschau eines aus dem Tool gestarteten Drucks (Live-Ansicht)
  GET  /api/printing/objects?name=<Auftrag>          → Objekte dieses Drucks (Name, Mitte, Umriss) zum Überspringen
  GET  /api/queue                                      → Druckwarteschlange des Servers (tools/printqueue.py) mit Restzeit
  POST /api/queue  {action: create|started|skip|again|end, …} → Warteschlange anlegen/ändern (Druckstart bleibt ein Klick)

Aufruf: python tools/serve.py [PORT]
  Standard: nur auf diesem Rechner (127.0.0.1). Im Container / auf dem NAS: KONFIGURATOR_HOST=0.0.0.0.
  KONFIGURATOR_PRINTER=<IP>: Drucker vorgeben (z. B. aus den Einstellungen des Home-Assistant-Add-ons) – die Seite
  übernimmt ihn, und die Filamentverwaltung zählt gleich ab dem Start mit.
  MQTT_HOST=<Broker> (dazu MQTT_PORT, MQTT_USER, MQTT_PASSWORD …): Stand für Home Assistant (tools/ha_mqtt.py).
  KONFIGURATOR_PIN=<4–32 Zeichen>: Zugriffsschutz für den direkten Zugriff (NAS, Add-on-Port) – siehe „Zugriffsschutz“.
"""
import functools
import gzip
import hmac
import html
import http.cookies
import http.server
import json
import os
import re
import secrets
import shutil
import sys
import threading
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anycubic_lan  # noqa: E402
import gcode_preview  # noqa: E402
import ha_mqtt  # noqa: E402
import printqueue  # noqa: E402
import progress_image  # noqa: E402
import slicer  # noqa: E402
import spools  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_BODY = 64 * 1024
MAX_SPOOL_BODY = 4 * 1024 * 1024   # Import der Filamentverwaltung (bis 500 Drucke Historie in einem Stück)
STATUS_FOR = {"forbidden": 403, "missing_libs": 501, "unreachable": 502, "lan_off": 409, "unsupported": 409,
              "rejected": 502, "bad_response": 502, "timeout": 504, "no_slicer": 501, "bad_request": 400, "failed": 422}
WATCHER = None   # printqueue.Watcher: fragt den Drucker für Warteschlange und Home Assistant ab (main)


def printer_now():
    """Letzter Stand des Druckers aus dem Hintergrund-Thread (oder None)."""
    return WATCHER.latest() if WATCHER else None


def printer_host():
    """Drucker für Warteschlange/MQTT: wie die Filamentverwaltung, sonst KONFIGURATOR_PRINTER."""
    try:
        return spools.api_get().get("host") or preset_printer()
    except Exception:
        return preset_printer()


# Dateien der Seite: mit Versionskennung (?v=…, index.html schreibt der Server so um) darf der Browser sie behalten –
# beim zweiten Öffnen fallen gut 80 Anfragen und 2 MB weg (wichtig über Home-Assistant-Ingress/Cloud). Texte gzip.
STATIC_GZIP = {".js", ".css", ".html", ".json", ".svg", ".md", ".txt"}
_VERSION_RE = re.compile(r'((?:src|href)=")((?:js|vendor|css|img)/[^"?#]+)(")')
_index_cache = {"key": None, "body": None}
_gzip_cache = {}
GZIP_CACHE_MAX = 32 * 1024 * 1024


def file_version(rel):
    try:
        st = os.stat(os.path.join(ROOT, rel))
    except OSError:
        return None
    return "%x%x" % (st.st_mtime_ns // 1000000 % 0xFFFFFFFF, st.st_size)


def index_html():
    """index.html mit ?v=<Version> an jeder eigenen Datei – neu, sobald sich index.html oder eine der Dateien ändert."""
    path = os.path.join(ROOT, "index.html")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    refs = [m.group(2) for m in _VERSION_RE.finditer(text)]
    key = (os.stat(path).st_mtime_ns,) + tuple(file_version(r) for r in refs)
    if _index_cache["key"] != key:
        body = _VERSION_RE.sub(lambda m: m.group(1) + m.group(2) + ("?v=" + file_version(m.group(2)) if file_version(m.group(2)) else "") + m.group(3), text)
        _index_cache.update(key=key, body=body.encode("utf-8"))
    return _index_cache["body"]


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if not getattr(self, "_cache_set", False):
            self.send_header("Cache-Control", "no-store")
        self._cache_set = False
        super().end_headers()

    def _static(self, url):
        """Seite und ihre Dateien: index.html umgeschrieben (no-cache), versionierte Dateien dauerhaft im Cache, sonst
        Nachfrage per ETag (304). Texte gzip, wenn der Browser es kann. Gibt False zurück, wenn es keine Datei ist."""
        rel = url.path.lstrip("/") or "index.html"
        if rel == "index.html":
            body, ctype, etag = index_html(), "text/html; charset=utf-8", None
        else:
            full = self.translate_path(url.path)
            if not os.path.isfile(full) or not os.path.realpath(full).startswith(os.path.realpath(ROOT) + os.sep):
                return False
            st = os.stat(full)
            etag = '"%x-%x"' % (st.st_mtime_ns, st.st_size)
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-cache")
                self._cache_set = True
                self.end_headers()
                return True
            with open(full, "rb") as f:
                body = f.read()
            ctype = self.guess_type(full)
        ext = os.path.splitext(rel)[1].lower()
        versioned = "v=" in url.query
        gz = ext in STATIC_GZIP and "gzip" in (self.headers.get("Accept-Encoding") or "") and len(body) > 1024
        if gz:
            k = (rel, len(body), hash(body) if rel == "index.html" else etag)
            if k not in _gzip_cache:
                # höchstens ~32 MB komprimierte Dateien halten (alle Dateien der Seite zusammen sind < 1 MB)
                if sum(len(v) for v in _gzip_cache.values()) > GZIP_CACHE_MAX:
                    _gzip_cache.clear()
                _gzip_cache[k] = gzip.compress(body, 6)
            body = _gzip_cache[k]
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        if etag:
            self.send_header("ETag", etag)
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if versioned else "no-cache")
        self._cache_set = True
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        return True

    def log_message(self, fmt, *args):
        # Adressen der Drucker sind unkritisch, Abfragen aber häufig – nur Fehler und API-Aufrufe loggen
        if self.path == "/api/queue" and self.command == "GET" and args and str(args[1]) == "200":
            return   # fragt die Seite alle paar Sekunden ab
        if self.path.startswith("/api/") or (args and str(args[1])[:1] in "45"):
            super().log_message(fmt, *args)

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api(self, fn):
        try:
            self._json(200, fn())
        except (anycubic_lan.LanError, slicer.SliceError) as e:
            self._json(STATUS_FOR.get(e.kind, 500), {"error": str(e), "kind": e.kind})
        except printqueue.QueueError as e:
            self._json(409, {"error": str(e), "kind": "bad_request"})
        except (ValueError, KeyError) as e:
            self._json(400, {"error": "Ungültige Anfrage: " + str(e), "kind": "bad_request"})

    # ---------- Zugriffsschutz (KONFIGURATOR_PIN), Hilfsfunktionen unten bei „Zugriffsschutz“ ----------
    def _auth_ok(self):
        """Ohne PIN, über den HA-Ingress oder mit gültiger Sitzung → True."""
        if not auth_pin() or is_ingress(self.client_address[0], self.headers):
            return True
        c = http.cookies.SimpleCookie()
        try:
            c.load(self.headers.get("Cookie") or "")
        except http.cookies.CookieError:
            return False
        return SESSION_COOKIE in c and session_valid(c[SESSION_COOKIE].value)

    def _auth_gate(self):
        """True, wenn die Anfrage hier schon beantwortet wurde (Anmeldeseite, 401, Umleitung)."""
        if not auth_pin():
            return False
        url = urllib.parse.urlparse(self.path)
        if url.path == "/login":
            if self.command == "POST":
                self._login_post()
            else:
                self._login_page(urllib.parse.parse_qs(url.query).get("next", [""])[0])
            return True
        if (url.path == "/api/health" and self.command in ("GET", "HEAD")) or self._auth_ok():
            return False
        if url.path.startswith("/api/") or self.command != "GET":
            self._json(401, {"error": "Anmeldung nötig", "kind": "auth"})
            return True
        # relativ umleiten (funktioniert auch hinter einem Präfix): /js/x.js → ../login?next=js/x.js
        target = self.path.lstrip("/")
        self.send_response(303)
        self.send_header("Location", "../" * url.path.lstrip("/").count("/") + "login?next=" + urllib.parse.quote(target, safe=""))
        self.send_header("Content-Length", "0")
        self.end_headers()
        return True

    def _login_page(self, nxt, error="", code=200):
        page = LOGIN_HTML.replace("{{NEXT}}", html.escape(safe_next(nxt), quote=True)).replace(
            "{{ERROR}}", '<p class="err">%s</p>' % html.escape(error) if error else "")
        body = page.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _login_post(self):
        length = int(self.headers.get("Content-Length") or 0)
        form = urllib.parse.parse_qs(self.rfile.read(min(length, 4096)).decode("utf-8", "replace")) if length > 0 else {}
        nxt, ip = form.get("next", [""])[0], self.client_address[0]
        if login_blocked(ip):
            return self._login_page(nxt, "Zu viele Versuche – bitte 5 Minuten warten. / Too many attempts, wait 5 minutes.", 429)
        if not pin_matches(form.get("pin", [""])[0]):
            login_failed(ip)
            return self._login_page(nxt, "falsche PIN / wrong PIN", 401)
        login_reset(ip)
        self.send_response(303)
        self.send_header("Set-Cookie", "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Strict"
                         % (SESSION_COOKIE, session_new(), SESSION_SECONDS))
        self.send_header("Location", "./" + safe_next(nxt))
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        if self._auth_gate():   # Zugriffsschutz (KONFIGURATOR_PIN)
            return
        url = urllib.parse.urlparse(self.path)
        if not url.path.startswith("/api/") and os.environ.get("KONFIGURATOR_CACHE", "1") != "0" and self._static(url):
            return
        super().do_HEAD()

    def do_GET(self):
        if self._auth_gate():   # Zugriffsschutz (KONFIGURATOR_PIN)
            return
        url = urllib.parse.urlparse(self.path)
        if url.path == "/api/health":
            # ohne Anmeldung (Healthcheck, HA-Watchdog) keine Drucker-Adresse
            printer = preset_printer() if self._auth_ok() else None
            return self._json(200, {"ok": True, "lan": anycubic_lan.AVAILABLE, "slicer": slicer.version(), "printer": printer})
        if url.path == "/api/anycubic/status":
            q = urllib.parse.parse_qs(url.query)
            host, pos = q.get("host", [""])[0], q.get("pos", [""])[0] == "1"
            return self._api(lambda: anycubic_lan.status(host, pos=pos))
        if url.path == "/api/printing/preview":
            # Schichtvorschau des laufenden Drucks (nur für Drucke, die das Tool gestartet hat) – Live-Ansicht in ④
            path = printed_preview(urllib.parse.parse_qs(url.query).get("name", [""])[0])
            if not path:
                return self._json(404, {"error": "Keine Vorschau für diesen Druck (nur für Drucke aus dem Tool)", "kind": "not_found"})
            return self._file(path, "application/octet-stream")
        if url.path == "/api/printing/objects":
            # Objekte des laufenden Drucks (Name, Mitte, Umriss) – zum Überspringen; nur für Drucke aus dem Tool
            path = printed_preview(urllib.parse.parse_qs(url.query).get("name", [""])[0])
            objs = path and path[:-len(".preview")] + ".objects.json"
            if not objs or not os.path.exists(objs):
                return self._json(404, {"error": "Keine Objektliste für diesen Druck (nur für Drucke aus dem Tool)", "kind": "not_found"})
            return self._file(objs, "application/json")
        if url.path == "/api/spools":
            return self._api(spools.api_get)
        if url.path == "/api/queue":
            return self._api(lambda: printqueue.api_get(st=printer_now()))
        if url.path == "/api/spools/export":           # ganzer Spulenstand als Datei (Umzug Mac ↔ Home Assistant)
            name, body = spools.api_export()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % name)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if url.path == "/api/anycubic/camera":
            return self._camera(urllib.parse.parse_qs(url.query).get("host", [""])[0])
        m = re.match(r"^/api/slice/([0-9a-f]{16})/plate_(\d+)\.(preview|gcode)$", url.path)
        if m:
            path = slicer.job_file(m.group(1), m.group(2), m.group(3))
            if not path:
                return self._json(404, {"error": "Slice-Auftrag nicht (mehr) vorhanden – bitte neu berechnen", "kind": "not_found"})
            return self._file(path, "text/x.gcode" if m.group(3) == "gcode" else "application/octet-stream",
                              "plate_%s.gcode" % m.group(2) if m.group(3) == "gcode" else None)
        if url.path.startswith("/api/"):
            return self._json(404, {"error": "unbekannt", "kind": "not_found"})
        if os.environ.get("KONFIGURATOR_CACHE", "1") != "0" and self._static(url):
            return None
        return super().do_GET()

    def _camera(self, host):
        """Kamerastrom des Druckers weiterreichen, solange der Browser zusieht."""
        try:
            cam = anycubic_lan.camera_url(host)
            upstream = urllib.request.urlopen(cam, timeout=10)
        except anycubic_lan.LanError as e:
            return self._json(STATUS_FOR.get(e.kind, 500), {"error": str(e), "kind": e.kind})
        except OSError as e:
            return self._json(502, {"error": "Kamera nicht erreichbar: " + str(e), "kind": "unreachable"})
        self.send_response(200)
        self.send_header("Content-Type", upstream.headers.get("Content-Type") or "video/x-flv")
        self.end_headers()
        try:
            # read1: sofort weiterreichen, was angekommen ist – read(64 KB) wartete, bis ein ganzer Block voll war; bei der
            # geringen Datenrate der Kamera kam das Bild dann Sekunden zu spät („altes Bild“)
            read = getattr(upstream, "read1", upstream.read)
            while True:
                chunk = read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass   # Browser hat die Ansicht geschlossen
        finally:
            upstream.close()

    def _file(self, path, ctype, download_name=None):
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        if download_name:
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % download_name)
        self.end_headers()
        with open(path, "rb") as f:
            shutil.copyfileobj(f, self.wfile, 1024 * 1024)

    def do_POST(self):
        if self._auth_gate():   # Zugriffsschutz (KONFIGURATOR_PIN)
            return
        path = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        ctype = self.headers.get("Content-Type", "").split(";")[0].strip()
        if path == "/api/slice":
            # application/octet-stream ist kein „einfacher“ Typ: fremde Webseiten bräuchten eine CORS-Freigabe
            if ctype != "application/octet-stream":
                return self._json(415, {"error": "3MF als application/octet-stream erwartet", "kind": "bad_request"})
            if length > slicer.MAX_BYTES:
                return self._json(413, {"error": "3MF zu groß (höchstens 200 MB)", "kind": "bad_request"})
            # ?plates=2,3&count=4&reuse=<job>: nur geänderte Platten neu slicen, die übrigen übernehmen
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            plates = [int(n) for n in q.get("plates", [""])[0].split(",") if n.isdigit()] if "plates" in q else None
            count = int(q["count"][0]) if q.get("count", [""])[0].isdigit() else None
            reuse = q.get("reuse", [""])[0] or None
            return self._api(lambda: slicer.slice_3mf(self.rfile.read(length), plates, count, reuse))
        if path == "/api/spools":
            if ctype != "application/json" or length > MAX_SPOOL_BODY:
                return self._json(415, {"error": "JSON erwartet", "kind": "bad_request"})

            def change():
                req = json.loads(self.rfile.read(length) or b"{}")
                if req.get("action") == "config" and req.get("host"):
                    req["host"] = anycubic_lan.check_host(req["host"])   # nur private Adressen
                return spools.api_post(req)
            return self._api(change)
        if path == "/api/queue":
            if ctype != "application/json" or length > MAX_BODY:
                return self._json(415, {"error": "JSON erwartet", "kind": "bad_request"})
            return self._api(lambda: printqueue.api_post(json.loads(self.rfile.read(length) or b"{}"), st=printer_now()))
        if path == "/api/anycubic/print":
            if ctype != "application/json" or length > MAX_BODY:
                return self._json(415, {"error": "JSON erwartet", "kind": "bad_request"})

            def send():
                req = json.loads(self.rfile.read(length) or b"{}")
                gcode = slicer.job_file(str(req.get("job", "")), str(req.get("plate", "")), "gcode")
                if not gcode:
                    raise slicer.SliceError("Slice-Auftrag nicht (mehr) vorhanden – bitte neu berechnen", "bad_request")
                name = re.sub(r"[^\w.\-]+", "_", str(req.get("name") or "druck"))[:80] + "_Platte" + str(int(req["plate"])) + ".gcode"
                res = anycubic_lan.print_gcode(req["host"], gcode, name, req.get("options") or {})
                remember_print(res.get("filename") or name, str(req.get("job", "")), int(req["plate"]))
                return res
            return self._api(send)
        if path != "/api/anycubic/command":
            return self._json(404, {"error": "unbekannt", "kind": "not_found"})
        if length > MAX_BODY:
            return self._json(413, {"error": "Anfrage zu groß", "kind": "bad_request"})
        # Nur Aufrufe der eigenen Seite (einfacher Schutz gegen fremde Webseiten im selben Netz)
        if ctype != "application/json":
            return self._json(415, {"error": "JSON erwartet", "kind": "bad_request"})

        def run():
            req = json.loads(self.rfile.read(length) or b"{}")
            return anycubic_lan.command(req["host"], req["type"], req["action"], req.get("data"))
        return self._api(run)


# ---------- Zugriffsschutz (KONFIGURATOR_PIN) ----------
# Ohne KONFIGURATOR_PIN ist alles offen wie bisher. Mit PIN braucht jede Anfrage eine Sitzung (Cookie, 30 Tage, nur im
# Speicher – nach einem Neustart neu anmelden). Ausgenommen: GET /api/health (Docker-Healthcheck, HA-Watchdog), die
# Anmeldeseite /login und der Home-Assistant-Ingress (Supervisor-Proxy 172.30.32.2 UND Kopfzeile X-Ingress-Path –
# die Kopfzeile allein kann jeder setzen). Höchstens 5 falsche PINs je Adresse in 5 Minuten, danach 429.
SESSION_COOKIE = "dk_session"
SESSION_SECONDS = 30 * 24 * 3600
SESSION_MAX = 1000
INGRESS_PROXY = "172.30.32.2"
LOGIN_MAX_FAILS, LOGIN_WINDOW = 5, 300
LOGIN_HTML = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "login.html"), encoding="utf-8").read()
_sessions = {}   # Token → Ablaufzeit
_fails = {}      # Client-Adresse → Zeitpunkte falscher Versuche
_auth_lock = threading.Lock()


def auth_pin():
    """PIN aus KONFIGURATOR_PIN oder None (kein Schutz)."""
    return (os.environ.get("KONFIGURATOR_PIN") or "").strip() or None


def pin_matches(pin):
    expected = auth_pin()
    return bool(expected) and hmac.compare_digest(str(pin).strip().encode(), expected.encode())


def is_ingress(client_ip, headers):
    """Anfrage über den Home-Assistant-Ingress: nur vom Supervisor-Proxy UND mit X-Ingress-Path."""
    ip = str(client_ip or "")
    ip = ip[7:] if ip.startswith("::ffff:") else ip
    return ip == INGRESS_PROXY and bool(headers) and headers.get("X-Ingress-Path") is not None


def session_new():
    token = secrets.token_urlsafe(32)
    now = time.time()
    with _auth_lock:
        for t in [t for t, exp in _sessions.items() if exp < now]:
            del _sessions[t]
        while len(_sessions) >= SESSION_MAX:
            del _sessions[min(_sessions, key=_sessions.get)]
        _sessions[token] = now + SESSION_SECONDS
    return token


def session_valid(token):
    with _auth_lock:
        exp = _sessions.get(str(token))
    return exp is not None and exp > time.time()


def _recent_fails(ip, now):
    return [t for t in _fails.get(ip, []) if now - t < LOGIN_WINDOW]


def login_blocked(ip):
    with _auth_lock:
        return len(_recent_fails(ip, time.time())) >= LOGIN_MAX_FAILS


def login_failed(ip):
    now = time.time()
    with _auth_lock:
        _fails[ip] = _recent_fails(ip, now) + [now]
        for k in [k for k in _fails if not _recent_fails(k, now)]:
            del _fails[k]


def login_reset(ip):
    with _auth_lock:
        _fails.pop(ip, None)


def safe_next(nxt):
    """Ziel nach der Anmeldung: nur relative Pfade dieses Servers (keine fremden Seiten)."""
    nxt = str(nxt or "").lstrip("/\\")
    if not re.fullmatch(r"[\w\-./?=&%+,~;:]*", nxt) or "://" in nxt or nxt.startswith("login") or ":" in nxt.split("/")[0]:
        return ""
    return nxt


# ---------- Vorschau gestarteter Drucke (Live-Ansicht) ----------
# Beim Start merkt sich der Server die Schichtvorschau unter dem Dateinamen auf dem Drucker (DATA_DIR/printed),
# damit sie auch dann noch da ist, wenn inzwischen neu geslict wurde (Slice-Aufträge werden aufgeräumt).
PRINTED_KEEP = 10


def _printed_dir():
    return os.path.join(os.path.dirname(spools.data_file()), "printed")


def _stem(name):
    base = str(name or "").replace("\\", "/").rsplit("/", 1)[-1]
    return re.sub(r"(\.(gcode|3mf|gco|g))+$", "", base, flags=re.I)


def remember_print(filename, job, plate):
    try:
        prev = slicer.job_file(job, plate, "preview")
        if not prev:
            return
        d = _printed_dir()
        os.makedirs(d, exist_ok=True)
        key = re.sub(r"[^\w.\-]+", "_", _stem(filename))[:120] or "druck"
        shutil.copyfile(prev, os.path.join(d, key + ".preview"))
        # Objekte des G-Codes (zum Überspringen im Tab ④)
        gcode = slicer.job_file(job, plate, "gcode")
        if gcode:
            with open(os.path.join(d, key + ".objects.json"), "w", encoding="utf-8") as f:
                json.dump(gcode_preview.read_objects(gcode), f)
        old = sorted((os.path.join(d, f) for f in os.listdir(d) if f.endswith(".preview")), key=os.path.getmtime)
        for f in old[:max(0, len(old) - PRINTED_KEEP)]:
            os.remove(f)
            if os.path.exists(f[:-len(".preview")] + ".objects.json"):
                os.remove(f[:-len(".preview")] + ".objects.json")
    except OSError as e:
        print("Vorschau für die Live-Ansicht nicht gespeichert: " + str(e), flush=True)


def printed_preview(name):
    """Pfad der gespeicherten Vorschau zum Auftragsnamen des Druckers (genau oder als Endung) oder None."""
    stem = re.sub(r"[^\w.\-]+", "_", _stem(name))
    d = _printed_dir()
    if not stem or not os.path.isdir(d):
        return None
    files = [f[:-len(".preview")] for f in os.listdir(d) if f.endswith(".preview")]
    hit = next((f for f in files if f == stem), None) or next((f for f in files if stem.endswith(f) or f.endswith(stem)), None)
    return os.path.join(d, hit + ".preview") if hit else None


def preset_printer():
    """Vorgegebener Drucker aus KONFIGURATOR_PRINTER (nur private Adressen), sonst None."""
    ip = (os.environ.get("KONFIGURATOR_PRINTER") or "").strip()
    if not ip:
        return None
    try:
        return anycubic_lan.check_host(ip)
    except anycubic_lan.LanError:
        return None


class Server(http.server.ThreadingHTTPServer):
    # Die Seite lädt gut 70 Skripte auf einmal; mit der Standard-Warteschlange (5 Verbindungen) wies der Server einen Teil
    # ab – dann fehlten Skripte und es hieß z. B. „getMat is not defined“ (gefunden 2026-10-02)
    request_queue_size = 128
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Browser hat die Verbindung geschlossen (Kamera zu, Seite neu geladen): kein Fehlerbericht im Protokoll
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("KONFIGURATOR_PORT", "8765"))
    host = os.environ.get("KONFIGURATOR_HOST", "127.0.0.1")
    if auth_pin() and not 4 <= len(auth_pin()) <= 32:
        sys.exit("KONFIGURATOR_PIN muss 4 bis 32 Zeichen lang sein – Server nicht gestartet")
    handler = functools.partial(Handler, directory=ROOT)
    with Server((host, port), handler) as server:
        shown = "127.0.0.1" if host in ("127.0.0.1", "0.0.0.0") else host
        print(f"Druck-Konfigurator unter http://{shown}:{port}/" + (" (im ganzen Netz erreichbar)" if host == "0.0.0.0" else " – Fenster offen lassen."), flush=True)
        print("Zugriffsschutz: " + ("PIN nötig (außer Home-Assistant-Ingress und /api/health)" if auth_pin() else "aus (KONFIGURATOR_PIN nicht gesetzt)"), flush=True)
        if not anycubic_lan.AVAILABLE:
            print("Hinweis: LAN-Modus (Werksfirmware) braucht: pip install -r requirements.txt", flush=True)
        print("Kostenkalkulation: " + ("OrcaSlicer " + str(slicer.version()) + " unter " + slicer.find_orca() if slicer.find_orca() else "kein OrcaSlicer gefunden (ORCA_PATH setzen)"), flush=True)
        if preset_printer():
            spools.api_post({"action": "config", "host": preset_printer()})
            print("Drucker vorgegeben: " + preset_printer(), flush=True)
        elif os.environ.get("KONFIGURATOR_PRINTER"):
            print("KONFIGURATOR_PRINTER ist keine private IP-Adresse – ignoriert", flush=True)
        spools.Tracker(anycubic_lan).start()   # Filamentverwaltung: Verbrauch mitzählen (tools/spools.py)
        print("Filamentverwaltung: " + spools.data_file(), flush=True)
        global WATCHER
        WATCHER = printqueue.Watcher(anycubic_lan, printer_host).start()   # Warteschlange: fertige Platten erkennen
        print("Warteschlange: " + printqueue.data_file(), flush=True)
        try:
            _, note = ha_mqtt.start(printer_now, lambda: printqueue.api_get(st=printer_now()), spools.api_get,
                                    image_fn=progress_image.ProgressImages(printed_preview),
                                    control_fn=lambda action: anycubic_lan.command(printer_host() or "", "print", action, {}))
            if note:
                print(note, flush=True)
        except Exception as e:   # MQTT darf den Start nie verhindern
            print("Home Assistant (MQTT): " + str(e), flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
