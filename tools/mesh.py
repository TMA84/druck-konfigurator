"""Bettnetz (Nivellierung) des Druckers über Moonraker – für die Karte „Nivellierung“ der Werkbank (js/mesh-ui.js).

Werksfirmware des Kobra S1 gibt das Bettnetz nicht heraus (weder MQTT noch HTTP). Mit Rinkhals läuft auf dem Drucker
Moonraker (Port 7125, ohne Anmeldung): GET /printer/objects/query?bed_mesh liefert das Netz wie bei Klipper –
probed_matrix[y][x] (Zeilen von mesh_min bis mesh_max in Y, Spalten in X), mesh_matrix (interpoliert, oft gleich).
Geprüft 2026-10-25 am Kobra S1 mit Rinkhals: 5 × 5 Punkte, mesh_min [5, 5], mesh_max [245, 245].
Nur lesen, nur private Adressen (anycubic_lan.check_host). Port: KONFIGURATOR_MOONRAKER_PORT (Standard 7125).
"""
import json
import math
import os
import socket
import urllib.error
import urllib.request

import anycubic_lan

TIMEOUT_S = 5
MAX_BYTES = 2 * 1024 * 1024   # Antwort enthält auch andere Objekte (Rinkhals: mmu …) – ein paar kB
DIM_MIN, DIM_MAX = 2, 50
UNSUPPORTED = "Nivellierungsdaten gibt es nur mit Rinkhals (Moonraker) – Werksfirmware gibt sie nicht heraus"
EMPTY = "Drucker hat kein Bettnetz geladen – er vermisst das Bett beim nächsten Druckstart (oder am Display: Nivellierung)"


class MeshError(Exception):
    """kind: unsupported (kein Moonraker, 404) | empty (kein Netz geladen, 404) | bad_response (502) | unreachable/timeout."""
    STATUS = {"unsupported": 404, "empty": 404, "bad_response": 502, "unreachable": 502, "timeout": 504}

    def __init__(self, message, kind):
        super().__init__(message)
        self.kind = kind
        self.status = self.STATUS.get(kind, 502)


def port():
    try:
        p = int(os.environ.get("KONFIGURATOR_MOONRAKER_PORT", "7125"))
    except ValueError:
        return 7125
    return p if 0 < p < 65536 else 7125


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _matrix(m, name):
    """Liste von Zeilen gleicher Länge mit endlichen Zahlen, je Richtung 2–50 Punkte."""
    if not isinstance(m, list) or not all(isinstance(r, list) for r in m):
        raise MeshError(name + ": keine Matrix", "bad_response")
    if not (DIM_MIN <= len(m) <= DIM_MAX) or not (DIM_MIN <= len(m[0]) <= DIM_MAX):
        raise MeshError(name + ": %d × %d Punkte (erlaubt %d–%d je Richtung)" % (len(m[0]) if m else 0, len(m), DIM_MIN, DIM_MAX), "bad_response")
    if any(len(r) != len(m[0]) for r in m):
        raise MeshError(name + ": Zeilen ungleich lang", "bad_response")
    if not all(_num(v) for r in m for v in r):
        raise MeshError(name + ": enthält keine Zahl", "bad_response")
    return [[float(v) for v in r] for r in m]


def _point(p, name):
    if not isinstance(p, list) or len(p) != 2 or not all(_num(v) for v in p):
        raise MeshError(name + ": zwei Zahlen erwartet", "bad_response")
    return [float(p[0]), float(p[1])]


def parse(data):
    """Antwort von Moonraker → {probed, mesh, min, max, profile, source} – oder MeshError."""
    try:
        bm = data["result"]["status"].get("bed_mesh")
    except (KeyError, TypeError, AttributeError):
        raise MeshError("Unerwartete Antwort von Moonraker", "bad_response")
    if bm is None:
        raise MeshError(EMPTY, "empty")
    if not isinstance(bm, dict):
        raise MeshError("bed_mesh: kein Objekt", "bad_response")
    probed = bm.get("probed_matrix")
    if probed in (None, [], [[]]):   # Klipper ohne geladenes Netz: [[]]
        raise MeshError(EMPTY, "empty")
    probed = _matrix(probed, "probed_matrix")
    mesh = bm.get("mesh_matrix")
    mesh = probed if mesh in (None, [], [[]]) else _matrix(mesh, "mesh_matrix")
    lo, hi = _point(bm.get("mesh_min"), "mesh_min"), _point(bm.get("mesh_max"), "mesh_max")
    if not (hi[0] > lo[0] and hi[1] > lo[1]):
        raise MeshError("mesh_max muss größer als mesh_min sein", "bad_response")
    profile = bm.get("profile_name")
    return {"probed": probed, "mesh": mesh, "min": lo, "max": hi,
            "profile": profile[:64] if isinstance(profile, str) else "", "source": "moonraker"}


def fetch(host, timeout=TIMEOUT_S):
    """Bettnetz vom Drucker holen (nur private Adressen). LanError (forbidden …) aus check_host, sonst MeshError."""
    host = anycubic_lan.check_host(host)
    url = "http://%s:%d/printer/objects/query?bed_mesh" % ("[" + host + "]" if ":" in host else host, port())
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            body = r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:   # Port offen, aber kein Moonraker (oder Klipper ohne bed_mesh)
        raise MeshError(UNSUPPORTED if e.code == 404 else "Moonraker antwortet mit HTTP %d" % e.code,
                        "unsupported" if e.code == 404 else "bad_response")
    except (socket.timeout, TimeoutError):
        raise MeshError("Drucker antwortet nicht (Zeitüberschreitung) – eingeschaltet, im selben Netz?", "timeout")
    except urllib.error.URLError as e:
        if isinstance(e.reason, ConnectionRefusedError):
            raise MeshError(UNSUPPORTED, "unsupported")
        if isinstance(e.reason, (socket.timeout, TimeoutError)):
            raise MeshError("Drucker antwortet nicht (Zeitüberschreitung) – eingeschaltet, im selben Netz?", "timeout")
        raise MeshError("Drucker nicht erreichbar: " + (str(e.reason) or type(e.reason).__name__), "unreachable")
    except ConnectionRefusedError:
        raise MeshError(UNSUPPORTED, "unsupported")
    except OSError as e:   # Verbindung abgebrochen, unvollständige Antwort …
        raise MeshError("Drucker nicht erreichbar: " + (str(e) or type(e).__name__), "unreachable")
    if len(body) > MAX_BYTES:
        raise MeshError("Antwort von Moonraker zu groß", "bad_response")
    try:
        data = json.loads(body)
    except ValueError:
        raise MeshError("Antwort von Moonraker ist kein JSON", "bad_response")
    return parse(data)
