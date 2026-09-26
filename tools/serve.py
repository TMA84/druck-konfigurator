"""Lokaler Webserver für den Druck-Konfigurator (nur 127.0.0.1).

Wie `python -m http.server`, schickt aber "Cache-Control: no-store": Sonst mischt der Browser nach
einem Update alte und neue Skripte (beobachtet 2026-09-26: alte engine.js + neue panel.js → Fehler).
Aufruf: python tools/serve.py [PORT]
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Druck-Konfigurator unter http://127.0.0.1:{port}/ – Fenster offen lassen.")
        server.serve_forever()


if __name__ == "__main__":
    main()
