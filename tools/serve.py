"""Webserver für den Druck-Konfigurator: liefert die Seite aus und spricht mit Anycubic-Druckern.

Wie `python -m http.server`, schickt aber "Cache-Control: no-store": Sonst mischt der Browser nach
einem Update alte und neue Skripte (beobachtet 2026-09-26: alte engine.js + neue panel.js → Fehler).

API (nur Drucker mit privater IP-Adresse, siehe tools/anycubic_lan.py):
  GET  /api/health                         → {"ok": true, "lan": <LAN-Modus verfügbar>}
  GET  /api/anycubic/status?host=<ip>      → Stand für Werkbank und Belegung (stehende Verbindung, alle 5 s)
  GET  /api/anycubic/camera?host=<ip>      → Kamerabild als HTTP-FLV (durchgereicht, der Drucker erlaubt kein CORS)
  POST /api/anycubic/print  {host, job, plate, name, options}  → G-Code einer geslicten Platte hochladen und drucken
  POST /api/anycubic/command  {host, type, action, data}  → nur freigegebene Einstellungen (WRITABLE)
  POST /api/slice  (3MF als application/octet-stream)  → Verbrauch je Slot und Druckzeit je Platte (OrcaSlicer), job-Id
       ?plates=2,3&count=4&reuse=<job>                  → nur diese Platten neu slicen, die übrigen aus <job> übernehmen
  GET  /api/slice/<job>/plate_<n>.preview              → kompakte Schichtvorschau (tools/gcode_preview.py)
  GET  /api/slice/<job>/plate_<n>.gcode                → G-Code zum Herunterladen
  GET  /api/spools                                     → Filamentverwaltung: Spulen mit Restmenge (tools/spools.py)
  POST /api/spools  {action: update|add|delete|config, …} → Spule ändern, Drucker für die Verbrauchszählung festlegen

Aufruf: python tools/serve.py [PORT]
  Standard: nur auf diesem Rechner (127.0.0.1). Im Container / auf dem NAS: KONFIGURATOR_HOST=0.0.0.0.
"""
import functools
import http.server
import json
import os
import re
import shutil
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anycubic_lan  # noqa: E402
import slicer  # noqa: E402
import spools  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_BODY = 64 * 1024
STATUS_FOR = {"forbidden": 403, "missing_libs": 501, "unreachable": 502, "lan_off": 409, "unsupported": 409,
              "rejected": 502, "bad_response": 502, "timeout": 504, "no_slicer": 501, "bad_request": 400, "failed": 422}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Adressen der Drucker sind unkritisch, Abfragen aber häufig – nur Fehler und API-Aufrufe loggen
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
        except (ValueError, KeyError) as e:
            self._json(400, {"error": "Ungültige Anfrage: " + str(e), "kind": "bad_request"})

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/api/health":
            return self._json(200, {"ok": True, "lan": anycubic_lan.AVAILABLE, "slicer": slicer.version()})
        if url.path == "/api/anycubic/status":
            host = urllib.parse.parse_qs(url.query).get("host", [""])[0]
            return self._api(lambda: anycubic_lan.status(host))
        if url.path == "/api/spools":
            return self._api(spools.api_get)
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
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
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
            if ctype != "application/json" or length > MAX_BODY:
                return self._json(415, {"error": "JSON erwartet", "kind": "bad_request"})

            def change():
                req = json.loads(self.rfile.read(length) or b"{}")
                if req.get("action") == "config" and req.get("host"):
                    req["host"] = anycubic_lan.check_host(req["host"])   # nur private Adressen
                return spools.api_post(req)
            return self._api(change)
        if path == "/api/anycubic/print":
            if ctype != "application/json" or length > MAX_BODY:
                return self._json(415, {"error": "JSON erwartet", "kind": "bad_request"})

            def send():
                req = json.loads(self.rfile.read(length) or b"{}")
                gcode = slicer.job_file(str(req.get("job", "")), str(req.get("plate", "")), "gcode")
                if not gcode:
                    raise slicer.SliceError("Slice-Auftrag nicht (mehr) vorhanden – bitte neu berechnen", "bad_request")
                name = re.sub(r"[^\w.\-]+", "_", str(req.get("name") or "druck"))[:80] + "_Platte" + str(int(req["plate"])) + ".gcode"
                return anycubic_lan.print_gcode(req["host"], gcode, name, req.get("options") or {})
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


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("KONFIGURATOR_PORT", "8765"))
    host = os.environ.get("KONFIGURATOR_HOST", "127.0.0.1")
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer((host, port), handler) as server:
        shown = "127.0.0.1" if host in ("127.0.0.1", "0.0.0.0") else host
        print(f"Druck-Konfigurator unter http://{shown}:{port}/" + (" (im ganzen Netz erreichbar)" if host == "0.0.0.0" else " – Fenster offen lassen."), flush=True)
        if not anycubic_lan.AVAILABLE:
            print("Hinweis: LAN-Modus (Werksfirmware) braucht: pip install -r requirements.txt", flush=True)
        print("Kostenkalkulation: " + ("OrcaSlicer " + str(slicer.version()) + " unter " + slicer.find_orca() if slicer.find_orca() else "kein OrcaSlicer gefunden (ORCA_PATH setzen)"), flush=True)
        spools.Tracker(anycubic_lan).start()   # Filamentverwaltung: Verbrauch mitzählen (tools/spools.py)
        print("Filamentverwaltung: " + spools.data_file(), flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
