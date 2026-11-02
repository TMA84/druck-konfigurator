"""Bettnetz (Nivellierung) des Druckers über Moonraker – für die Karte „Nivellierung“ der Werkbank (js/mesh-ui.js).

Werksfirmware des Kobra S1 gibt das Bettnetz nicht heraus (weder MQTT noch HTTP). Mit Rinkhals läuft auf dem Drucker
Moonraker (Port 7125, ohne Anmeldung): GET /printer/objects/query?bed_mesh liefert das Netz wie bei Klipper –
probed_matrix[y][x] (Zeilen von mesh_min bis mesh_max in Y, Spalten in X), mesh_matrix (interpoliert, oft gleich).
Geprüft 2026-10-25 am Kobra S1 mit Rinkhals: 5 × 5 Punkte, mesh_min [5, 5], mesh_max [245, 245].
Nur lesen, nur private Adressen (anycubic_lan.check_host). Port: KONFIGURATOR_MOONRAKER_PORT (Standard 7125).

Verlauf (Vergleich mit früheren Messungen): jedes neue Netz (anders als das zuletzt gesehene) landet mit Zeitpunkt in
$DATA_DIR/mesh-history.json (bzw. $MESH_HISTORY_FILE), je Drucker die letzten HISTORY_MAX. Die Antwort trägt dazu
"at" (wann dieses Netz zuerst gesehen wurde) und "history" (ältere Messungen, neueste zuerst).

Jetzt vermessen (calibrate): nur wenn der Drucker frei ist (print_stats/idle_timeout über Moonraker), schickt
POST /printer/gcode/script mit G9111 (wie beim Druckstart: heizt, wischt, Z-Offset), BED_MESH_CALIBRATE, Heizungen aus
und BED_MESH_OUTPUT. Die Anycubic-Firmware tastet immer 5 × 5 ab – PROBE_COUNT=7,7 ignoriert sie (geprüft 2026-11-02). Moonraker antwortet erst am Ende
(einige Minuten) – das läuft in einem eigenen Thread; calib_state (GET …/mesh/calibrate) sagt, ob es fertig ist.
Geprüft 2026-11-02 am Kobra S1 (Rinkhals): G9111 allein misst nur den Z-Offset; BED_MESH_CALIBRATE tastet ab, das Netz
bleibt aber nur im Speicher – Moonraker (bed_mesh) und printer_mutable.cfg zeigen weiter das Netz des letzten Druckstarts,
auch BED_MESH_PROFILE SAVE ändert daran nichts (nur SAVE_CONFIG, das startet die Firmware neu – nicht benutzt). Darum
liest der Server das Netz danach mit BED_MESH_OUTPUT aus der Konsole (/server/gcode_store) und merkt es sich
($DATA_DIR/mesh-calibrated.json); fetch zeigt es, solange Moonraker noch das Netz von vorher meldet.
"""
import json
import math
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

import anycubic_lan

TIMEOUT_S = 5
MAX_BYTES = 2 * 1024 * 1024   # Antwort enthält auch andere Objekte (Rinkhals: mmu …) – ein paar kB
DIM_MIN, DIM_MAX = 2, 50
HISTORY_MAX = 30      # Messungen je Drucker
HISTORY_HOSTS = 8     # Drucker im Verlauf
SAME_MM = 0.0005      # gleiche Messung, wenn kein Punkt weiter abweicht
_lock = threading.Lock()
CALIB_BED = (40, 110)        # °C, Bett beim Vermessen (wie beim Druck: PLA 60, PETG 70, ABS 100)
CALIB_NOZZLE = 170           # °C, wie LeviQ3 (extru_temp) – Düse sauber wischen, ohne zu tropfen
CALIB_TIMEOUT_S = 1800
BUSY_STATES = ("printing", "paused")
_calib = {}                  # Drucker → {"started", "bed", "done", "error"}
UNSUPPORTED = "Nivellierungsdaten gibt es nur mit Rinkhals (Moonraker) – Werksfirmware gibt sie nicht heraus"
EMPTY = "Drucker hat kein Bettnetz geladen – er vermisst das Bett beim nächsten Druckstart (oder am Display: Nivellierung)"


class MeshError(Exception):
    """kind: unsupported (kein Moonraker, 404) | empty (kein Netz geladen, 404) | bad_response (502) | unreachable/timeout."""
    STATUS = {"unsupported": 404, "empty": 404, "bad_response": 502, "unreachable": 502, "timeout": 504, "busy": 409, "bad_request": 400}

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
    o = _override(host)
    try:
        d = parse(data)
    except MeshError as e:
        if o and e.kind == "empty":
            return remember(host, _as_mesh(o))
        raise
    if o and (o["base"] is None or o["base"] == d["probed"]):
        return remember(host, _as_mesh(o, d.get("profile", "")))
    if o:   # Firmware hat inzwischen selbst neu vermessen (Druckstart) – deren Netz gilt
        with _lock:
            _set_override(host, None)
    return remember(host, d)


def _as_mesh(o, profile=""):
    return {"probed": o["probed"], "mesh": o["probed"], "min": o["min"], "max": o["max"], "profile": profile, "source": "calibrate"}


def _moon(host, path, body=None, timeout=TIMEOUT_S):
    """GET (oder POST mit JSON) an Moonraker → JSON. Fehler wie fetch als MeshError."""
    url = "http://%s:%d%s" % ("[" + host + "]" if ":" in host else host, port(), path)
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"} if body is not None else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read(65536)).get("error", {}).get("message", "")
        except (ValueError, AttributeError, OSError):
            msg = ""
        if e.code == 404 and not msg:
            raise MeshError(UNSUPPORTED, "unsupported")
        raise MeshError("Drucker meldet: " + (str(msg)[:300] or "HTTP %d" % e.code), "bad_response")
    except (socket.timeout, TimeoutError):
        raise MeshError("Drucker antwortet nicht (Zeitüberschreitung) – eingeschaltet, im selben Netz?", "timeout")
    except urllib.error.URLError as e:
        if isinstance(e.reason, ConnectionRefusedError):
            raise MeshError(UNSUPPORTED, "unsupported")
        raise MeshError("Drucker nicht erreichbar: " + (str(e.reason) or type(e.reason).__name__), "unreachable")
    except OSError as e:
        raise MeshError("Drucker nicht erreichbar: " + (str(e) or type(e).__name__), "unreachable")
    try:
        return json.loads(raw)
    except ValueError:
        raise MeshError("Antwort von Moonraker ist kein JSON", "bad_response")


def calib_script(bed):
    """G-Code für „Jetzt vermessen“: Ablauf wie beim Druckstart (G9111), dann das Netz."""
    # G9111 allein heizt, wischt und misst nur den Z-Offset (LeviQ3) – das Netz misst die Firmware beim Druck in einem
    # eigenen Schritt (geprüft 2026-11-02: Netz danach unverändert). Darum immer BED_MESH_CALIBRATE hinterher.
    lines = ["G9111 bedTemp=%d extruderTemp=%d" % (bed, CALIB_NOZZLE),
             "BED_MESH_CALIBRATE MESH_MIN=5,5 MESH_MAX=245,245"]
    lines += ["M104 S0", "M140 S0", "BED_MESH_OUTPUT"]
    return "\n".join(lines)


_ROW_RE = re.compile(r"^\s*//\s*(-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?)*)\s*$")


def parse_output(store):
    """Netz aus der Konsole (/server/gcode_store): letzte Antwort „Probed Z positions“ nach dem letzten BED_MESH_CALIBRATE."""
    items = store.get("result", {}).get("gcode_store") if isinstance(store, dict) else None
    if not isinstance(items, list):
        raise MeshError("Konsole des Druckers nicht lesbar", "bad_response")
    found = None
    for it in items:
        msg = it.get("message", "") if isinstance(it, dict) else ""
        if not isinstance(msg, str):
            continue
        if it.get("type") == "command" and "BED_MESH_CALIBRATE" in msg:
            found = None
        elif it.get("type") == "response" and "Probed Z positions" in msg:
            found = msg
    if not found:
        raise MeshError("Neues Netz nicht in der Konsole gefunden", "bad_response")
    rows = [[float(v) for v in m.group(1).split()] for m in map(_ROW_RE.match, found.splitlines()) if m]
    return _matrix(rows, "BED_MESH_OUTPUT")


def calib_file():
    d = os.environ.get("DATA_DIR") or os.path.join(os.path.expanduser("~"), ".druck-konfigurator")
    return os.environ.get("MESH_CALIB_FILE") or os.path.join(d, "mesh-calibrated.json")


def _override(host):
    """Selbst vermessenes Netz (noch nicht von der Firmware gespeichert) → {base, probed, min, max, at} oder None."""
    try:
        with open(calib_file(), encoding="utf-8") as f:
            o = json.load(f).get(host)
        e = _entry(o)
        base = o.get("base")
        if base is not None:
            base = _matrix(base, "base")
    except (OSError, ValueError, AttributeError, MeshError):
        return None
    return dict(e, base=base) if e else None


def _set_override(host, o):
    p = calib_file()
    try:
        with open(p, encoding="utf-8") as f:
            state = json.load(f)
        if not isinstance(state, dict):
            state = {}
    except (OSError, ValueError):
        state = {}
    if o is None:
        if host not in state:
            return
        state.pop(host)
    else:
        state[host] = o
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p + ".tmp", "w", encoding="utf-8") as f:
            json.dump(state, f, separators=(",", ":"))
        os.replace(p + ".tmp", p)
    except OSError as e:
        print("Vermessenes Netz nicht gespeichert: %s" % e, file=sys.stderr)


def calib_state(host):
    host = anycubic_lan.check_host(host)
    with _lock:
        c = _calib.get(host)
        return dict(c) if c else None


def calibrate(host, bed=60, run_async=True):
    """Vermessen starten (nur wenn frei). → {"started": True, "bed"}; MeshError busy/… sonst."""
    host = anycubic_lan.check_host(host)
    if isinstance(bed, bool) or not isinstance(bed, int) or not CALIB_BED[0] <= bed <= CALIB_BED[1]:
        raise MeshError("Betttemperatur %d–%d °C" % CALIB_BED, "bad_request")
    st = _moon(host, "/printer/objects/query?print_stats=state&idle_timeout=state&webhooks=state")
    try:
        status = st["result"]["status"]
    except (KeyError, TypeError):
        raise MeshError("Unerwartete Antwort von Moonraker", "bad_response")
    if (status.get("webhooks") or {}).get("state") not in (None, "ready"):
        raise MeshError("Klipper auf dem Drucker ist nicht bereit", "busy")
    if (status.get("print_stats") or {}).get("state") in BUSY_STATES or (status.get("idle_timeout") or {}).get("state") == "Printing":
        raise MeshError("Drucker ist beschäftigt (druckt oder pausiert) – vermessen nur, wenn er frei ist", "busy")
    with _lock:
        c = _calib.get(host)
        if c and not c.get("done"):
            raise MeshError("Vermessen läuft schon", "busy")
        _calib[host] = {"started": int(time.time()), "bed": bed, "done": None, "error": None}
    script = calib_script(bed)
    try:   # Netz, das Moonraker jetzt meldet – solange es das noch meldet, gilt das selbst vermessene
        base = parse(_moon(host, "/printer/objects/query?bed_mesh"))["probed"]
    except MeshError:
        base = None

    def run():
        err = None
        try:
            _moon(host, "/printer/gcode/script", {"script": script}, timeout=CALIB_TIMEOUT_S)
            probed = parse_output(_moon(host, "/server/gcode_store?count=100"))
            now = int(time.time())
            o = {"at": now, "probed": probed, "min": [5.0, 5.0], "max": [245.0, 245.0], "profile": "", "base": base}
            with _lock:
                _set_override(host, o)
            remember(host, o, now=now)
        except MeshError as e:
            err = str(e)
        except Exception as e:   # noqa: BLE001 – Thread darf nicht still sterben
            err = str(e) or type(e).__name__
        with _lock:
            _calib[host].update(done=int(time.time()), error=err)
    if run_async:
        threading.Thread(target=run, daemon=True, name="mesh-calibrate").start()
    else:
        run()
    return {"started": True, "bed": bed}


def history_file():
    if os.environ.get("MESH_HISTORY_FILE"):
        return os.environ["MESH_HISTORY_FILE"]
    d = os.environ.get("DATA_DIR") or os.path.join(os.path.expanduser("~"), ".druck-konfigurator")
    return os.path.join(d, "mesh-history.json")


def _entry(e):
    """Gespeicherte Messung prüfen → {at, probed, min, max, profile} oder None (kaputte Einträge fallen weg)."""
    try:
        if not isinstance(e, dict) or not _num(e.get("at")):
            return None
        probed = _matrix(e.get("probed"), "probed")
        lo, hi = _point(e.get("min"), "min"), _point(e.get("max"), "max")
    except MeshError:
        return None
    prof = e.get("profile")
    return {"at": int(e["at"]), "probed": probed, "min": lo, "max": hi, "profile": prof[:64] if isinstance(prof, str) else ""}


def load_history(path=None):
    try:
        with open(path or history_file(), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(d, dict):
        return {}
    out = {}
    for host, lst in d.items():
        if isinstance(host, str) and isinstance(lst, list):
            ok = [x for x in map(_entry, lst[-HISTORY_MAX:]) if x]
            if ok:
                out[host[:64]] = ok
    return out


def _save_history(state, path=None):
    p = path or history_file()
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, p)
    except OSError as e:   # Verlauf ist Beiwerk – das Netz trotzdem zeigen
        print("Bettnetz-Verlauf nicht gespeichert: %s" % e, file=sys.stderr)


def same(a, b):
    """Gleiches Raster und kein Punkt weiter als SAME_MM entfernt."""
    pa, pb = a["probed"], b["probed"]
    if a["min"] != b["min"] or a["max"] != b["max"] or len(pa) != len(pb) or len(pa[0]) != len(pb[0]):
        return False
    return all(abs(x - y) <= SAME_MM for ra, rb in zip(pa, pb) for x, y in zip(ra, rb))


def remember(host, d, now=None, path=None):
    """Netz im Verlauf ablegen (nur wenn anders als das zuletzt gesehene) → d mit "at" und "history" (neueste zuerst)."""
    entry = {"at": int(now if now is not None else time.time()), "probed": d["probed"], "min": d["min"], "max": d["max"],
             "profile": d.get("profile", "")}
    with _lock:
        state = load_history(path)
        lst = state.pop(host, [])
        if lst and same(lst[-1], entry):
            entry = lst[-1]
            state[host] = lst
        else:
            lst = (lst + [entry])[-HISTORY_MAX:]
            state[host] = lst   # zuletzt gemessener Drucker steht hinten
            while len(state) > HISTORY_HOSTS:
                state.pop(next(iter(state)))
            _save_history(state, path)
    out = dict(d)
    out["at"] = entry["at"]
    out["history"] = list(reversed(lst[:-1]))
    return out
