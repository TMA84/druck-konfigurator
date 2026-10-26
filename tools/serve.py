"""Webserver für die Druckwerkstatt (früher Druck-Konfigurator): liefert die Seite aus und spricht mit Anycubic-Druckern.

Wie `python -m http.server`, schickt aber "Cache-Control: no-store": Sonst mischt der Browser nach
einem Update alte und neue Skripte (beobachtet 2026-09-26: alte engine.js + neue panel.js → Fehler).

API (nur Drucker mit privater IP-Adresse, siehe tools/anycubic_lan.py):
  GET  /api/health                         → {"ok": true, "lan": <LAN-Modus verfügbar>}
  GET  /api/anycubic/status?host=<ip>      → Stand für Werkbank und Belegung (stehende Verbindung, alle 5 s)
       &pos=1                                → Kopfposition auch während des Drucks abfragen (Test-Schalter der 3D-Ansicht)
  GET  /api/anycubic/mesh?host=<ip>        → Bettnetz (Nivellierung) über Moonraker, nur mit Rinkhals (tools/mesh.py)
  GET  /api/anycubic/camera?host=<ip>      → Kamerabild als HTTP-FLV (durchgereicht, der Drucker erlaubt kein CORS);
                                              mit Rinkhals MJPEG von mjpg-streamer (ohne startCapture, tools/camera_src.py);
                                              &frames=1: dieselben Bilder als Länge + JPEG (geht auch über den HA-Ingress)
  GET  /api/anycubic/camera/info?host=<ip> → {"source": "mjpeg"|"flv", "fps", "aspect", …}: welcher Spieler in der Seite
  GET  /api/anycubic/camera/snapshot?host=<ip> → ein JPEG (nur Rinkhals; Werksfirmware → 404 unsupported)
  POST /api/anycubic/print  {host, job, plate, name, options, own?, slots?}  → G-Code einer geslicten Platte hochladen und drucken
                             (own: eigener G-Code, Name ohne „_Platte1“; slots: {Werkzeug: ACE-Slot})
  POST /api/anycubic/command  {host, type, action, data}  → nur freigegebene Einstellungen (WRITABLE)
  POST /api/slice  (3MF als application/octet-stream)  → Verbrauch je Slot und Druckzeit je Platte (OrcaSlicer), job-Id
  POST /api/gcode?name=<Datei>  (G-Code als application/octet-stream) → fertiger G-Code als Auftrag mit einer Platte (wie /api/slice)
       ?plates=2,3&count=4&reuse=<job>                  → nur diese Platten neu slicen, die übrigen aus <job> übernehmen
       …&partial=1                                      → Druckwerte je Platte: auch ohne vollständiges <job> (Kette je Wertegruppe)
  GET  /api/slice/<job>/plate_<n>.preview              → kompakte Schichtvorschau (tools/gcode_preview.py)
  GET  /api/slice/<job>/plate_<n>.gcode                → G-Code zum Herunterladen
  GET  /api/spools                                     → Filamentverwaltung: Spulen mit Restmenge (tools/spools.py)
  POST /api/spools  {action: update|add|delete|config, …} → Spule ändern, Drucker für die Verbrauchszählung festlegen
  GET  /api/printing/preview?name=<Auftrag>          → Schichtvorschau eines aus dem Tool gestarteten Drucks (Live-Ansicht)
  GET  /api/printing/objects?name=<Auftrag>          → Objekte dieses Drucks (Name, Mitte, Umriss) zum Überspringen
  GET  /api/queue                                      → Druckwarteschlange des Servers (tools/printqueue.py) mit Restzeit
  POST /api/queue  {action: create|started|skip|again|end, …} → Warteschlange anlegen/ändern (Druckstart bleibt ein Klick)
  GET  /api/backup                                     → Sicherung (Spulen, Historie, Standardwerte) als JSON-Datei (tools/backup.py)
  POST /api/backup  {mode: merge|replace, data}        → Sicherung einspielen (erst alles prüfen, dann schreiben)

Aufruf: python tools/serve.py [PORT]
  Standard: nur auf diesem Rechner (127.0.0.1). Im Container / auf dem NAS: KONFIGURATOR_HOST=0.0.0.0.
  KONFIGURATOR_PRINTER=<IP>: Drucker vorgeben (z. B. aus den Einstellungen des Home-Assistant-Add-ons) – die Seite
  übernimmt ihn, und die Filamentverwaltung zählt gleich ab dem Start mit.
  MQTT_HOST=<Broker> (dazu MQTT_PORT, MQTT_USER, MQTT_PASSWORD …): Stand für Home Assistant (tools/ha_mqtt.py).
  KONFIGURATOR_PIN=<4–32 Zeichen>: Zugriffsschutz für den direkten Zugriff (NAS, Add-on-Port) – siehe „Zugriffsschutz“.
  KONFIGURATOR_ALLOWED_HOSTS=<Name,Name>: ohne PIN beantwortet der Server nur Anfragen an IP-Adressen, localhost, Namen
  ohne Punkt und Namen auf .local/.lan/.home.arpa/.internal/.fritz.box (Schutz gegen DNS-Rebinding fremder Webseiten).
  Andere Namen (z. B. drucker.example.de im Heimnetz) hier eintragen, mit Komma getrennt.
"""
import functools
import gzip
import hmac
import html
import ipaddress
import http.cookies
import http.server
import json
import os
import posixpath
import re
import secrets
import shutil
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anycubic_lan  # noqa: E402
import backup  # noqa: E402
import camera_src  # noqa: E402
import gcode_preview  # noqa: E402
import gcode_thumbnail  # noqa: E402
import ha_mqtt  # noqa: E402
import ha_users  # noqa: E402
import mesh  # noqa: E402
import prefs  # noqa: E402
import printqueue  # noqa: E402
import schedule  # noqa: E402
import progress_image  # noqa: E402
import slicer  # noqa: E402
import spools  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_BODY = 64 * 1024
MAX_SPOOL_BODY = 4 * 1024 * 1024   # Import der Filamentverwaltung (bis 500 Drucke Historie in einem Stück)
MAX_BACKUP_BODY = backup.MAX_BYTES  # Sicherung einspielen (Spulen, Historie, Standardwerte, Teil des Browsers)
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
# Nur ansehen (Benutzer ohne Admin-Rechte): Lesen für den 3D-Fortschritt, ohne Kamera, Dateien und Änderungen
VIEWER_GET = {"/api/health", "/api/anycubic/status", "/api/anycubic/mesh", "/api/printing/preview", "/api/printing/objects", "/api/printing/slots", "/api/prefs", "/api/spools", "/api/queue", "/api/schedule"}
QUIET_GET = {"/api/prefs", "/api/schedule", "/api/queue", "/api/health", "/api/anycubic/status", "/api/anycubic/mesh", "/api/spools", "/api/printing/objects", "/api/printing/preview", "/api/printing/slots"}
GZIP_CACHE_MAX = 32 * 1024 * 1024
# Nur diese Dateien der Seite ausliefern (sonst 404) – nicht .git, tools/, Datenordner, Verzeichnislisten
STATIC_DIRS = ("js/", "css/", "vendor/", "img/", "docs/", "templates/", "ha/")
STATIC_FILES = {"", "index.html", "tests/ui-smoke.js"}   # ui-smoke.js: Bedientest (tools/headless.js smoke)
# Große Uploads (3MF/G-Code bis 200 MB): höchstens zwei gleichzeitig annehmen. Sie kommen in Stücken von UPLOAD_CHUNK in
# eine Datei im Auftragsordner (slicer.upload_file), nicht in den Speicher (Raspberry Pi mit dem Add-on)
UPLOAD_SLOTS = threading.BoundedSemaphore(2)
UPLOAD_CHUNK = 1024 * 1024


class ClientGone(Exception):
    """Verbindung beim Hochladen abgebrochen oder Zeitlimit: keine Antwort mehr möglich."""


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
    timeout = 60   # Sekunden je Lesen/Schreiben: hängende Verbindungen belegen sonst für immer einen Thread

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

    def list_directory(self, path):
        self.send_error(404)   # keine Verzeichnislisten
        return None

    def log_message(self, fmt, *args):
        # Adressen der Drucker sind unkritisch, Abfragen aber häufig – nur Fehler und API-Aufrufe loggen
        # (path/command fehlen bei kaputter Anfragezeile, args bei log_error)
        path, code = getattr(self, "path", "") or "", str(args[1]) if len(args) > 1 else ""
        if getattr(self, "command", None) in ("GET", "HEAD") and code in ("200", "304") and path.split("?")[0] in QUIET_GET:
            return   # Abfragen im Takt (Seite alle paar Sekunden, Watchdog von Home Assistant) – nur Fehler protokollieren
        if path.startswith("/api/") or code[:1] in ("4", "5") or not code:
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
            res = fn()
        except mesh.MeshError as e:   # eigene Codes: ohne Moonraker 404 (Hinweis in der Karte, kein Fehler)
            return self._json(e.status, {"error": str(e), "kind": e.kind})
        except (anycubic_lan.LanError, slicer.SliceError) as e:
            return self._json(STATUS_FOR.get(e.kind, 500), {"error": str(e), "kind": e.kind})
        except ClientGone:
            raise
        except backup.BackupError as e:
            return self._json(400, {"error": str(e), "kind": "bad_request"})
        except (printqueue.QueueError, schedule.ScheduleError, prefs.PrefsError) as e:
            return self._json(409, {"error": str(e), "kind": "bad_request"})
        except (ValueError, KeyError, TypeError) as e:
            return self._json(400, {"error": "Ungültige Anfrage: " + str(e), "kind": "bad_request"})
        except Exception as e:   # sonst bekäme der Browser gar keine Antwort
            traceback.print_exc()
            return self._json(500, {"error": "Interner Fehler: " + (str(e) or type(e).__name__), "kind": "internal"})
        self._json(200, res)

    def _reject(self, code, error):
        """Fehler vor dem Lesen des Inhalts: Verbindung danach schließen (der ungelesene Rest wäre sonst die nächste Anfrage)."""
        self.close_connection = True
        self._json(code, {"error": error, "kind": "bad_request"})

    def _length(self, limit):
        """Content-Length prüfen: Zahl ≥ 0 und höchstens limit, sonst 400/413 (dann None)."""
        raw = (self.headers.get("Content-Length") or "0").strip()
        if not re.fullmatch(r"[0-9]{1,15}", raw):   # auch negativ: rfile.read(-1) liest bis zum Verbindungsende, an allen Grenzen vorbei
            self._reject(400, "Ungültige Content-Length")
            return None
        if int(raw) > limit:
            self._reject(413, "Anfrage zu groß (höchstens %d MB)" % (limit // (1024 * 1024)) if limit >= 1024 * 1024 else "Anfrage zu groß")
            return None
        return int(raw)

    def _body(self, length):
        """JSON-Inhalt der Anfrage – nur ein Objekt ({…}), sonst ValueError (→ 400)."""
        req = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(req, dict):
            raise ValueError("JSON-Objekt erwartet")
        return req

    def _host_gate(self):
        """Ohne PIN nur Anfragen an Adressen im Heimnetz (Schutz gegen DNS-Rebinding) – True, wenn schon beantwortet."""
        if auth_pin() or is_ingress(self.client_address[0], self.headers) or host_allowed(self.headers.get("Host")):
            return False
        if urllib.parse.urlparse(self.path).path == "/api/health" and self.command in ("GET", "HEAD"):
            return False   # Healthcheck bleibt offen (ohne Drucker-Adresse, siehe do_GET)
        body = ("Unbekannter Servername – ohne PIN nur über IP-Adresse oder Heimnetz-Namen erreichbar "
                "(weitere Namen: KONFIGURATOR_ALLOWED_HOSTS)\n").encode()
        self.close_connection = True
        self.send_response(403)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        return True

    def _cross_site(self):
        """Vom Browser einer fremden Seite ausgelöst (<img>, Link)? Nur mit Sec-Fetch-Site erkennbar."""
        site = self.headers.get("Sec-Fetch-Site")
        return site is not None and site not in ("same-origin", "none")

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

    # ---------- Nur ansehen: Home-Assistant-Benutzer ohne Admin-Rechte (tools/ha_users.py) ----------
    def _viewer(self):
        """Über den Ingress von einem Benutzer ohne Admin-Rechte → True (nur 3D-Fortschritt, nichts ändern)."""
        if not ha_users.available() or not is_ingress(self.client_address[0], self.headers):
            return False
        # je Anfrage (der Proxy verwendet Verbindungen für verschiedene Benutzer weiter); ha_users hält die Liste vor
        return not ha_users.is_admin(self.headers.get("X-Remote-User-Id"))

    def _viewer_gate(self):
        """True, wenn die Anfrage hier schon beantwortet wurde (gesperrt oder auf ?ansicht=3d umgeleitet)."""
        if not self._viewer():
            return False
        url = urllib.parse.urlparse(self.path)
        if self.command in ("GET", "HEAD") and url.path in ("/", "/index.html") and "ansicht=3d" not in url.query:
            self.send_response(303)
            self.send_header("Location", "?ansicht=3d")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        if self.command in ("GET", "HEAD") and (not url.path.startswith("/api/") or url.path in VIEWER_GET):
            return False
        self._json(403, {"error": "Nur ansehen – ändern dürfen nur Admins von Home Assistant", "kind": "forbidden"})
        return True

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
        length = self._length(4096)
        if length is None:
            return
        form = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8", "replace")) if length > 0 else {}
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
        if self._host_gate() or self._auth_gate() or self._viewer_gate():   # Servername, PIN, nur ansehen
            return
        url = urllib.parse.urlparse(self.path)
        if not url.path.startswith("/api/") and not static_allowed(url.path):
            return self.send_error(404)
        if not url.path.startswith("/api/") and os.environ.get("KONFIGURATOR_CACHE", "1") != "0" and self._static(url):
            return
        super().do_HEAD()

    def do_GET(self):
        if self._host_gate() or self._auth_gate() or self._viewer_gate():   # Servername, PIN, nur ansehen
            return
        url = urllib.parse.urlparse(self.path)
        if url.path == "/api/health":
            # ohne Anmeldung (Healthcheck, HA-Watchdog) keine Drucker-Adresse
            printer = preset_printer() if self._auth_ok() and (auth_pin() or host_allowed(self.headers.get("Host"))) else None
            return self._json(200, {"ok": True, "lan": anycubic_lan.AVAILABLE, "slicer": slicer.version(), "printer": printer})
        if url.path == "/api/anycubic/status":
            q = urllib.parse.parse_qs(url.query)
            host, pos = q.get("host", [""])[0], q.get("pos", [""])[0] == "1"
            if self._viewer():   # nur ansehen: eingestellter Drucker, keine zusätzlichen Abfragen
                host, pos = printer_host() or host, False
            elif self._cross_site():   # von einer fremden Seite ausgelöst: keine Verbindung zu beliebigen Adressen
                if not printer_host():
                    return self._json(403, {"error": "Nur von der eigenen Seite", "kind": "forbidden"})
                host, pos = printer_host(), False
            return self._api(lambda: anycubic_lan.status(host, pos=pos))
        if url.path == "/api/anycubic/mesh":
            # Bettnetz (Karte „Nivellierung“): wie der Stand – nur ansehen/fremde Seite → eingestellter Drucker
            host = urllib.parse.parse_qs(url.query).get("host", [""])[0]
            if self._viewer():
                host = printer_host() or host
            elif self._cross_site():
                if not printer_host():
                    return self._json(403, {"error": "Nur von der eigenen Seite", "kind": "forbidden"})
                host = printer_host()
            return self._api(lambda: mesh.fetch(host))
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
        if url.path == "/api/printing/slots":
            # Werkzeug → ACE-Slot des laufenden Drucks (Farben der 3D-Ansicht); nur für Drucke aus dem Tool
            path = printed_preview(urllib.parse.parse_qs(url.query).get("name", [""])[0])
            if not path:
                return self._json(404, {"error": "Keine Zuordnung für diesen Druck (nur für Drucke aus dem Tool)", "kind": "not_found"})
            return self._json(200, {"slots": {str(k): v for k, v in progress_image.tool_slots(path).items()}})
        if url.path == "/api/spools":
            return self._api(spools.api_get)
        if url.path == "/api/queue":
            # auch beim Abrufen: rettet eine schon bestehende Warteschlange, solange ihr Auftrag noch da ist
            return self._api(lambda: queue_pin(printqueue.api_get(st=printer_now(), factor=spools.time_factor_value()), prune=False))
        if url.path == "/api/schedule":
            return self._api(schedule.api_get)
        if url.path == "/api/prefs":
            return self._api(prefs.api_get)
        if url.path == "/api/spools/export":           # ganzer Spulenstand als Datei (Umzug Mac ↔ Home Assistant)
            name, body = spools.api_export()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % name)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if url.path == "/api/backup":
            # Sicherung mit persönlichen Daten: nicht für „nur ansehen“ (fehlt in VIEWER_GET), nicht von fremden Seiten
            if self._cross_site():
                return self._json(403, {"error": "Sicherung nur von der eigenen Seite", "kind": "forbidden"})
            name, body = backup.build()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % name)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if url.path in ("/api/anycubic/camera", "/api/anycubic/camera/info", "/api/anycubic/camera/snapshot"):
            # startet die Kamera am Drucker bzw. fragt ihn ab – nur von der eigenen Seite (nicht für „nur ansehen“: fehlt in VIEWER_GET)
            if self._cross_site():
                return self._json(403, {"error": "Kamera nur von der eigenen Seite", "kind": "forbidden"})
            host = urllib.parse.parse_qs(url.query).get("host", [""])[0]
            if url.path.endswith("/info"):
                return self._api(lambda: camera_src.info(anycubic_lan.check_host(host)))
            if url.path.endswith("/snapshot"):
                return self._snapshot(host)
            return self._camera(host, urllib.parse.parse_qs(url.query).get("frames", [""])[0] == "1")
        m = re.match(r"^/api/slice/([0-9a-f]{16})/plate_(\d+)\.(preview|gcode)$", url.path)
        if m:
            path = slicer.job_file(m.group(1), m.group(2), m.group(3))
            if not path:
                return self._json(404, {"error": "Slice-Auftrag nicht (mehr) vorhanden – bitte neu berechnen", "kind": "not_found"})
            if m.group(3) == "gcode":
                with_thumbnail(m.group(1), m.group(2), path)
            return self._file(path, "text/x.gcode" if m.group(3) == "gcode" else "application/octet-stream",
                              "plate_%s.gcode" % m.group(2) if m.group(3) == "gcode" else None)
        if url.path.startswith("/api/"):
            return self._json(404, {"error": "unbekannt", "kind": "not_found"})
        if not static_allowed(url.path):
            return self.send_error(404)
        if os.environ.get("KONFIGURATOR_CACHE", "1") != "0" and self._static(url):
            return None
        return super().do_GET()

    def _camera(self, host, as_frames=False):
        """Kamerastrom des Druckers weiterreichen, solange der Browser zusieht."""
        try:
            host = anycubic_lan.check_host(host)
            rinkhals = camera_src.detect(host)
        except anycubic_lan.LanError as e:
            return self._json(STATUS_FOR.get(e.kind, 500), {"error": str(e), "kind": e.kind})
        if rinkhals:
            return self._camera_mjpeg(host, rinkhals, as_frames)
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
        anycubic_lan.camera_watch(host, +1)
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
            anycubic_lan.camera_watch(host, -1)   # letzter Zuschauer weg: Kamera später stoppen

    def _camera_mjpeg(self, host, cam, as_frames=False):
        """Rinkhals: MJPEG von mjpg-streamer durchreichen – kein MQTT, kein startCapture (das Licht bleibt, wie es ist),
        kein camera_watch (mjpg-streamer läuft ohnehin; nichts zu stoppen). as_frames (?frames=1, die Seite nutzt das):
        je Bild 4 Byte Länge (big-endian) + JPEG als application/octet-stream – multipart käme über den HA-Ingress
        komprimiert und damit nicht an."""
        try:
            upstream = camera_src.open_first(cam["streams"], "multipart/x-mixed-replace")
        except OSError as e:
            camera_src.forget(host)   # beim nächsten Versuch neu bestimmen (Rinkhals aus, Drucker neu gestartet)
            return self._json(502, {"error": "Kamera nicht erreichbar: " + str(e), "kind": "unreachable"})
        self.send_response(200)
        if as_frames:
            self.send_header("Content-Type", camera_src.FRAMES_TYPE)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                for jpeg in camera_src.frames(upstream):
                    self.wfile.write(len(jpeg).to_bytes(4, "big") + jpeg)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass   # Seite hat abgebrochen (AbortController)
            finally:
                upstream.close()
            return None
        self.send_header("Content-Type", upstream.headers.get("Content-Type"))   # mit boundary=…
        self.end_headers()
        try:
            read = getattr(upstream, "read1", upstream.read)   # wie bei FLV: jedes Bild sofort weiter
            while True:
                chunk = read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass   # Browser hat die Ansicht geschlossen (img.src = '')
        finally:
            upstream.close()

    def _snapshot(self, host):
        """Ein Standbild (JPEG) – nur mit Rinkhals; die Werksfirmware hat keins."""
        try:
            host = anycubic_lan.check_host(host)
            cam = camera_src.detect(host)
        except anycubic_lan.LanError as e:
            return self._json(STATUS_FOR.get(e.kind, 500), {"error": str(e), "kind": e.kind})
        if not cam:
            return self._json(404, {"error": "Standbild nur mit Rinkhals", "kind": "unsupported"})
        try:
            with camera_src.open_first(cam["snapshots"], "image/jpeg") as r:
                body = r.read(camera_src.SNAPSHOT_MAX + 1)
        except OSError as e:
            camera_src.forget(host)
            return self._json(502, {"error": "Kamera nicht erreichbar: " + str(e), "kind": "unreachable"})
        if len(body) > camera_src.SNAPSHOT_MAX or not body.startswith(b"\xff\xd8"):
            return self._json(502, {"error": "Kamera lieferte kein JPEG", "kind": "bad_response"})
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
        if self._host_gate() or self._auth_gate() or self._viewer_gate():   # Servername, PIN, nur ansehen
            return
        path = urllib.parse.urlparse(self.path).path
        ctype = self.headers.get("Content-Type", "").split(";")[0].strip()
        if path in ("/api/slice", "/api/gcode"):
            # application/octet-stream ist kein „einfacher“ Typ: fremde Webseiten bräuchten eine CORS-Freigabe
            if ctype != "application/octet-stream":
                return self._reject(415, ("3MF" if path == "/api/slice" else "G-Code") + " als application/octet-stream erwartet")
            length = self._length(slicer.MAX_BYTES)
            if length is None:
                return None
            if not UPLOAD_SLOTS.acquire(blocking=False):   # sonst bis zu 200 MB je wartender Anfrage im Speicher
                self.close_connection = True
                return self._json(503, {"error": "Der Server verarbeitet gerade schon zwei Dateien – bitte gleich noch einmal versuchen",
                                        "kind": "busy"})
            try:
                return self._upload(path, length)
            finally:
                UPLOAD_SLOTS.release()
        limit = MAX_SPOOL_BODY if path == "/api/spools" else MAX_BACKUP_BODY if path == "/api/backup" else MAX_BODY
        if path not in ("/api/spools", "/api/backup", "/api/queue", "/api/prefs", "/api/schedule", "/api/anycubic/print", "/api/anycubic/command"):
            self.close_connection = True
            return self._json(404, {"error": "unbekannt", "kind": "not_found"})
        # Nur Aufrufe der eigenen Seite (application/json ist kein „einfacher“ Typ – einfacher Schutz gegen fremde Webseiten)
        if ctype != "application/json":
            return self._reject(415, "JSON erwartet")
        length = self._length(limit)
        if length is None:
            return None
        if path == "/api/spools":
            def change():
                req = self._body(length)
                if req.get("action") == "config" and req.get("host"):
                    req["host"] = anycubic_lan.check_host(req["host"])   # nur private Adressen
                return spools.api_post(req)
            return self._api(change)
        if path == "/api/backup":
            def restore():
                req = backup.parse(self.rfile.read(length))
                return backup.restore(req.get("data"), req.get("mode"))
            return self._api(restore)
        if path == "/api/queue":
            return self._api(lambda: queue_post(self._body(length)))
        if path == "/api/prefs":
            # eigene Standardwerte für alle Browser (tools/prefs.py)
            return self._api(lambda: prefs.api_post(self._body(length)))
        if path == "/api/schedule":
            # Druck planen / absagen (tools/schedule.py); der G-Code wird mit Vorschaubild in den Datenordner kopiert
            def gcode_for(job, plate):
                gcode = slicer.job_file(job, plate, "gcode")
                if gcode:
                    with_thumbnail(job, plate, gcode)
                return gcode, slicer.job_file(job, plate, "preview") if gcode else None
            return self._api(lambda: schedule.api_post(self._body(length), gcode_for, on_cancel=scheduled_cancel))
        if path == "/api/anycubic/print":
            def send():
                req = self._body(length)
                gcode = slicer.job_file(str(req.get("job", "")), str(req.get("plate", "")), "gcode")
                if not gcode:
                    raise slicer.SliceError("Slice-Auftrag nicht (mehr) vorhanden – bitte neu berechnen", "bad_request")
                # eigener G-Code („G-Code drucken“): Name wie die Datei, ohne „_Platte1“
                name = re.sub(r"[^\w.\-]+", "_", str(req.get("name") or "druck"))[:80] + ("" if req.get("own") else "_Platte" + str(int(req["plate"]))) + ".gcode"
                with_thumbnail(str(req.get("job", "")), str(req.get("plate", "")), gcode)   # Bild fürs Display des Druckers
                # Vorschau und Objekte VOR dem Start ablegen – sobald der Drucker den Auftrag meldet, fragt die Seite danach
                remember_print(name, str(req.get("job", "")), int(req["plate"]), slots=req.get("slots"))
                res = anycubic_lan.print_gcode(req["host"], gcode, name, req.get("options") or {}, req.get("slots"))
                if res.get("filename") and res["filename"] != name:
                    remember_print(res["filename"], str(req.get("job", "")), int(req["plate"]), slots=req.get("slots"))
                return res
            return self._api(send)

        def run():   # /api/anycubic/command
            req = self._body(length)
            return anycubic_lan.command(req["host"], req["type"], req["action"], req.get("data"))
        return self._api(run)

    def _receive(self, fd, length):
        """Inhalt in Stücken in die Datei fd schreiben. Weniger als Content-Length → SliceError (400),
        Verbindung abgebrochen → ClientGone."""
        left = length
        with os.fdopen(fd, "wb") as f:
            while left:
                try:
                    chunk = self.rfile.read(min(left, UPLOAD_CHUNK))
                except OSError as e:   # Verbindung zurückgesetzt, Zeitlimit
                    raise ClientGone() from e
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        if left:
            self.close_connection = True
            raise slicer.SliceError("Datei unvollständig übertragen (%d von %d Bytes) – bitte noch einmal versuchen"
                                    % (length - left, length), "bad_request")

    def _upload(self, path, length):
        files = []

        def receive():
            fd, tmp = slicer.upload_file()
            files.append(tmp)
            self._receive(fd, length)
            return tmp
        try:
            if path == "/api/slice":
                # ?plates=2,3&count=4&reuse=<job>: nur geänderte Platten neu slicen, die übrigen übernehmen
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                plates = [int(n) for n in q.get("plates", [""])[0].split(",") if n.isdigit()] if "plates" in q else None
                count = int(q["count"][0]) if q.get("count", [""])[0].isdigit() else None
                reuse = q.get("reuse", [""])[0] or None
                partial = q.get("partial", [""])[0] == "1"   # Druckwerte je Platte: nur diese Platten (+ was reuse hat)
                return self._api(lambda: slicer.slice_3mf(receive(), plates, count, reuse, partial))
            # Fertiger G-Code zum Drucken (Tab ④ „G-Code drucken …“): wird ein Auftrag mit einer Platte wie nach dem Slicen
            name = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("name", [""])[0][:120]

            def take():
                res = slicer.import_gcode(receive(), name)
                gcode = slicer.job_file(res["job"], 1, "gcode")
                res["facts"] = {k: v for k, v in anycubic_lan.gcode_facts(gcode).items() if k != "size"}
                return res
            return self._api(take)
        except ClientGone:
            self.close_connection = True
            return None
        finally:
            for tmp in files:   # der Auftrag hat seine eigene Verknüpfung bzw. Kopie
                try:
                    os.unlink(tmp)
                except OSError:
                    pass


# ---------- Zugriffsschutz (KONFIGURATOR_PIN) ----------
# Ohne KONFIGURATOR_PIN ist alles offen wie bisher. Mit PIN braucht jede Anfrage eine Sitzung (Cookie, 30 Tage, nur im
# Speicher – nach einem Neustart neu anmelden). Ausgenommen: GET /api/health (Docker-Healthcheck, HA-Watchdog), die
# Anmeldeseite /login und der Home-Assistant-Ingress (Supervisor-Proxy 172.30.32.2 UND Kopfzeile X-Ingress-Path –
# die Kopfzeile allein kann jeder setzen). Höchstens 5 falsche PINs je Adresse in 5 Minuten, danach 429 – und
# höchstens 20 von allen Adressen zusammen (sonst probiert jemand mit vielen Adressen durch).
SESSION_COOKIE = "dk_session"
SESSION_SECONDS = 30 * 24 * 3600
SESSION_MAX = 1000
INGRESS_PROXY = "172.30.32.2"
LOGIN_MAX_FAILS, LOGIN_WINDOW = 5, 300
LOGIN_MAX_FAILS_ALL = 20
LOGIN_HTML = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "login.html"), encoding="utf-8").read()
_sessions = {}   # Token → Ablaufzeit
_fails = {}      # Client-Adresse → Zeitpunkte falscher Versuche
_fails_all = []  # Zeitpunkte falscher Versuche aller Adressen
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
    now = time.time()
    with _auth_lock:
        _fails_all[:] = [t for t in _fails_all if now - t < LOGIN_WINDOW]
        return len(_recent_fails(ip, now)) >= LOGIN_MAX_FAILS or len(_fails_all) >= LOGIN_MAX_FAILS_ALL


def login_failed(ip):
    now = time.time()
    with _auth_lock:
        _fails_all[:] = [t for t in _fails_all if now - t < LOGIN_WINDOW] + [now]
        _fails[ip] = _recent_fails(ip, now) + [now]
        for k in [k for k in _fails if not _recent_fails(k, now)]:
            del _fails[k]


def login_reset(ip):
    with _auth_lock:
        _fails.pop(ip, None)


LOCAL_SUFFIXES = (".local", ".lan", ".home.arpa", ".internal", ".fritz.box")


def host_allowed(host):
    """Servername aus der Host-Kopfzeile: IP-Adresse, localhost, Name ohne Punkt, Heimnetz-Endung oder
    KONFIGURATOR_ALLOWED_HOSTS. Ohne Kopfzeile (HTTP/1.0, Healthcheck) erlaubt – Browser schicken sie immer."""
    h = str(host or "").strip().lower()
    if not h:
        return True
    if h.startswith("["):
        h = h[1:h.find("]")] if "]" in h else h[1:]
    elif h.count(":") == 1:
        h = h.split(":")[0]
    h = h.rstrip(".")
    try:
        ipaddress.ip_address(h)
        return True
    except ValueError:
        pass
    extra = {x.strip().lower().rstrip(".") for x in (os.environ.get("KONFIGURATOR_ALLOWED_HOSTS") or "").split(",") if x.strip()}
    return (bool(h) and ("." not in h or h == "localhost" or h.endswith(".localhost") or h.endswith(LOCAL_SUFFIXES))) or h in extra


def static_allowed(path):
    """Nur Dateien, die die Seite lädt (STATIC_DIRS/STATIC_FILES) – nicht .git, tools/, Tests, Datenordner."""
    p = urllib.parse.unquote(str(path or ""))
    if "\\" in p or "\0" in p:
        return False
    p = posixpath.normpath("/" + p).lstrip("/")
    p = "" if p == "." else p
    if any(part.startswith(".") for part in p.split("/") if part):
        return False
    return p in STATIC_FILES or (p.startswith(STATIC_DIRS) and not p.endswith("/"))


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


def queue_post(req):
    """Warteschlange ändern; ihren Slice-Auftrag dauerhaft aufheben (slicer.pin_job), alte Kopien wegräumen."""
    return queue_pin(printqueue.api_post(req, st=printer_now(), factor=spools.time_factor_value()), prune=True)


def queue_pin(res, prune):
    q = (res or {}).get("queue") or {}
    job = (q.get("slice") or {}).get("job")
    try:
        if job:   # im Hintergrund – die Seite bekommt sofort Antwort
            slicer.pin_job_async(job, lambda ok: ok or print("Warteschlange: Slice-Auftrag %s nicht mehr vorhanden – nicht aufgehoben" % job, flush=True))
        if prune:
            slicer.keep_pinned([job] if job else [])
    except OSError as e:
        print("Warteschlange: Auftrag nicht aufgehoben: %s" % e, flush=True)
    return res


def scheduled_start(plan):
    """Geplanten Druck starten (schedule.Runner – die Prüfungen sind schon gelaufen)."""
    host = printer_host()
    if not host:
        raise anycubic_lan.LanError("Kein Drucker eingestellt", "unreachable")
    gcode, prev = os.path.join(plan["file"], "plate.gcode"), os.path.join(plan["file"], "plate.preview")
    # eigener G-Code („G-Code drucken“): Name wie die Datei, ohne „_Platte1“ – wie bei /api/anycubic/print
    name = plan["name"] + ("" if plan.get("own") else "_Platte" + str(plan["plate"])) + ".gcode"
    # Vorschau und Objekte VOR dem Start ablegen (2026-10-05: geplanter ASA-Druck ohne 3D-Fortschritt – die Seite hatte
    # schon nachgefragt, bevor die Vorschau da war, und es danach nicht mehr versucht)
    remember_print(name, "", plan["plate"], gcode_path=gcode, preview_path=prev, slots=plan.get("slots"))
    res = anycubic_lan.print_gcode(host, gcode, name, plan.get("options") or {}, plan.get("slots"))
    if res.get("filename") and res["filename"] != name:
        remember_print(res["filename"], "", plan["plate"], gcode_path=gcode, preview_path=prev, slots=plan.get("slots"))
    print("Geplanter Druck gestartet: " + name, flush=True)


def scheduled_dry(on, temp, minutes):
    """Trocknen in allen ACE-Einheiten (geplanter Druck)."""
    host, st = printer_host(), printer_now()
    if not host or not st or not st.get("ace"):
        raise anycubic_lan.LanError("Keine ACE gefunden", "unreachable")
    boxes = [{"id": b["id"], "drying_status": {"status": 1 if on else 0, "target_temp": temp, "duration": minutes}} for b in st["ace"]]
    anycubic_lan.command(host, "multiColorBox", "setDry", {"multi_color_box": boxes})
    print("Geplanter Druck: Trocknen %s (%d °C, %d min)" % ("gestartet" if on else "beendet", temp, minutes), flush=True)


def scheduled_heat(on, bed):
    """Bett vorwärmen bzw. Heizung aus (geplanter Druck)."""
    host = printer_host()
    if not host:
        raise anycubic_lan.LanError("Kein Drucker eingestellt", "unreachable")
    anycubic_lan.command(host, "tempature", "set", {"type": 1, "target_hotbed_temp": int(bed) if on else 0, "target_nozzle_temp": 0})
    print("Geplanter Druck: Bett %s" % ("auf %d °C" % bed if on else "aus"), flush=True)


def scheduled_cancel(plan):
    """Absagen: laufendes Trocknen beenden, Bettheizung aus."""
    if (plan.get("dry") or {}).get("sent"):
        scheduled_dry(False, 0, 0)
    if (plan.get("preheat") or {}).get("sent"):
        scheduled_heat(False, 0)


def with_thumbnail(job, plate, gcode):
    """Vorschaubild in den G-Code, wenn Orca keins geschrieben hat (tools/gcode_thumbnail.py) – Fehler nie weiterreichen."""
    try:
        prev = slicer.job_file(job, plate, "preview")
        if prev and gcode_thumbnail.add_thumbnails(gcode, prev):
            print("Vorschaubild in Platte %s eingesetzt" % plate, flush=True)
    except Exception as e:   # ohne Bild drucken ist besser als gar nicht
        print("Vorschaubild nicht eingesetzt: " + (str(e) or type(e).__name__), flush=True)


def remember_print(filename, job, plate, gcode_path=None, preview_path=None, slots=None):
    """Vorschau und Objekte für 3D-Fortschritt und Überspringen aufheben – aus dem Slice-Auftrag oder (geplanter Druck)
    aus den angegebenen Dateien. slots: {Werkzeug: ACE-Slot} wie an anycubic_lan.print_gcode – damit die 3D-Ansicht in der
    Farbe des Slots zeigt, aus dem wirklich gedruckt wird (nicht der Slot-Einstellung im Konfigurator)."""
    try:
        prev = preview_path or slicer.job_file(job, plate, "preview")
        if not prev or not os.path.isfile(prev):
            return
        d = _printed_dir()
        os.makedirs(d, exist_ok=True)
        key = re.sub(r"[^\w.\-]+", "_", _stem(filename))[:120] or "druck"
        shutil.copyfile(prev, os.path.join(d, key + ".preview"))
        smap = {str(k): v for k, v in (slots if isinstance(slots, dict) else {}).items()
                if str(k).isdigit() and isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 16}
        with open(os.path.join(d, key + ".slots.json"), "w", encoding="utf-8") as f:
            json.dump(smap, f)
        # Objekte des G-Codes (zum Überspringen im Tab ④)
        gcode = gcode_path or slicer.job_file(job, plate, "gcode")
        if gcode:
            with open(os.path.join(d, key + ".objects.json"), "w", encoding="utf-8") as f:
                json.dump(gcode_preview.read_objects(gcode), f)
        old = sorted((os.path.join(d, f) for f in os.listdir(d) if f.endswith(".preview")), key=os.path.getmtime)
        for f in old[:max(0, len(old) - PRINTED_KEEP)]:
            os.remove(f)
            for ext in (".objects.json", ".slots.json"):
                if os.path.exists(f[:-len(".preview")] + ext):
                    os.remove(f[:-len(".preview")] + ext)
    except OSError as e:
        print("Vorschau für die Live-Ansicht nicht gespeichert: " + str(e), flush=True)


def printed_preview(name):
    """Pfad der gespeicherten Vorschau zum Auftragsnamen des Druckers oder None. Genau, sonst als Endung ab einem „_“
    (der Drucker bzw. ein Umbenennen beim Hochladen kann vorne etwas anhängen/abschneiden) – nur wenn genau eine passt:
    „Halter_Platte1“ darf nie die Vorschau von „Wandhalter_Platte1“ bekommen (falsche Objekte zum Überspringen)."""
    stem = re.sub(r"[^\w.\-]+", "_", _stem(name))
    d = _printed_dir()
    if not stem or not os.path.isdir(d):
        return None
    files = [f[:-len(".preview")] for f in os.listdir(d) if f.endswith(".preview")]
    if stem in files:
        return os.path.join(d, stem + ".preview")
    hits = [f for f in files if stem.endswith("_" + f) or f.endswith("_" + stem)]
    return os.path.join(d, hits[0] + ".preview") if len(hits) == 1 else None


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
        print(f"Druckwerkstatt unter http://{shown}:{port}/" + (" (im ganzen Netz erreichbar)" if host == "0.0.0.0" else " – Fenster offen lassen."), flush=True)
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
        schedule.Runner(printer_now, scheduled_start, scheduled_dry, heat_fn=scheduled_heat).start()   # geplanter Druck (tools/schedule.py)
        print("Geplanter Druck: " + schedule.data_file(), flush=True)
        try:
            _, note = ha_mqtt.start(printer_now, lambda: printqueue.api_get(st=printer_now(), factor=spools.time_factor_value()), spools.api_get,
                                    image_fn=progress_image.ProgressImages(printed_preview),
                                    control_fn=lambda action: anycubic_lan.command(printer_host() or "", "print", action, {}),
                                    plan_fn=lambda: schedule.api_get().get("plan"))
            if note:
                print(note, flush=True)
        except Exception as e:   # MQTT darf den Start nie verhindern
            print("Home Assistant (MQTT): " + str(e), flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
