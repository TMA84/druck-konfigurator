"""3MF mit der OrcaSlicer-Kommandozeile slicen und Verbrauch/Druckzeit aus dem G-Code lesen (Kostenkalkulation).

Orca wird gesucht in: $ORCA_PATH, /opt/orca/AppRun (Container), macOS-App, Windows-Standardpfad, PATH.
Im Container läuft Orca ohne Bildschirm (geprüft 2026-09-28 mit 2.4.2 auf aarch64).
Es wird immer nur ein Auftrag gleichzeitig geslict; weitere warten.
Neu slicen nur geänderter Platten: slice_3mf(data, plates=[2, 3], count=4, reuse=<job>) slict Platte 2 und 3
einzeln (--slice N) und übernimmt die übrigen G-Codes aus dem früheren Auftrag.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading

CANDIDATES = [
    os.environ.get("ORCA_PATH", ""),
    "/opt/orca/AppRun",
    "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
    r"C:\Program Files\OrcaSlicer\orca-slicer.exe",
    shutil.which("orca-slicer") or "",
]
MAX_BYTES = 200 * 1024 * 1024
KEEP_JOBS = 8              # so viele Slice-Aufträge (G-Code) bleiben für Vorschau und Download
JOBS_DIR = os.environ.get("SLICE_JOBS_DIR", os.path.join(tempfile.gettempdir(), "druck-konfigurator-jobs"))
JOB_ID = re.compile(r"^[0-9a-f]{16}$")
TIMEOUT_S = 900
TAIL_BYTES = 2 * 1024 * 1024   # Statistik und Einstellungen stehen am Ende des G-Codes
_lock = threading.Lock()
_version = {}


class SliceError(Exception):
    """kind: no_slicer | bad_request | failed | timeout"""

    def __init__(self, message, kind):
        super().__init__(message)
        self.kind = kind


def find_orca():
    return next((p for p in CANDIDATES if p and os.path.isfile(p) and os.access(p, os.X_OK)), None)


def version():
    """„2.4.2“ o. ä. oder None; einmal ermittelt (erste Zeile von --help: „OrcaSlicer-2.4.2:“)."""
    path = find_orca()
    if not path:
        return None
    if path not in _version:
        try:
            out = subprocess.run([path, "--help"], capture_output=True, text=True, timeout=60).stdout
            m = re.search(r"OrcaSlicer-([\w.\-]+?):?\s", out)
            _version[path] = m.group(1) if m else "?"
        except (OSError, subprocess.SubprocessError):
            _version[path] = None
    return _version[path]


def parse_duration(text):
    """„1d 2h 3m 4s“ → Sekunden"""
    units = {"d": 86400, "h": 3600, "m": 60, "s": 1}
    return sum(int(n) * units[u] for n, u in re.findall(r"(\d+)\s*([dhms])", text or ""))


def _numbers(text):
    return [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", text or "")]


def parse_gcode_tail(text):
    """Orca-Statistik aus dem Ende einer plate_N.gcode."""
    def line(key):
        m = re.search(r"^; " + re.escape(key) + r" = (.*)$", text, re.M)
        return m.group(1).strip() if m else None
    grams = _numbers(line("filament used [g]"))
    return {
        "grams": grams,
        "mm": _numbers(line("filament used [mm]")),
        "total_g": float(line("total filament used [g]") or sum(grams)),
        "time_s": parse_duration(line("estimated printing time (normal mode)")),
        "time_text": line("estimated printing time (normal mode)") or "",
        "changes": int(float(line("total filament change") or 0)),
    }


# Rauschen, das Orca auch bei Erfolg ausgibt
NOISE = re.compile(r"Not precalculated Placeable areas|run found error|^\s*$")


def _failure_reason(result, log):
    """Die aussagekräftigen Fehlerzeilen aus Orcas Ausgabe (die letzte Zeile ist nur „run found error, exit“)."""
    if result.get("error_string") and result.get("error_string") != "Success.":
        return str(result["error_string"])
    lines = [ln.strip() for ln in log.splitlines() if re.search(r"error|fail|invalid|cannot|could not|not support|incompatible", ln, re.I) and not NOISE.search(ln)]
    return " · ".join(dict.fromkeys(lines[-3:])) or "unbekannter Fehler (siehe Orca-Protokoll)"


def _keep_failure(data, log):
    """Letzten fehlgeschlagenen Auftrag zur Fehlersuche aufheben (überschreibt den vorigen)."""
    d = os.environ.get("SLICE_DEBUG_DIR", tempfile.gettempdir())
    try:
        with open(os.path.join(d, "druck-konfigurator-slice-fehler.3mf"), "wb") as f:
            f.write(data)
        with open(os.path.join(d, "druck-konfigurator-slice-fehler.log"), "w") as f:
            f.write(log)
    except OSError:
        pass


def _new_job_dir():
    os.makedirs(JOBS_DIR, exist_ok=True)
    old = sorted((os.path.join(JOBS_DIR, d) for d in os.listdir(JOBS_DIR) if JOB_ID.match(d)), key=os.path.getmtime)
    for d in old[:max(0, len(old) - KEEP_JOBS + 1)]:
        shutil.rmtree(d, ignore_errors=True)
    job = os.urandom(8).hex()
    path = os.path.join(JOBS_DIR, job)
    os.mkdir(path)
    return job, path


def job_file(job, plate, ext):
    """Pfad zu plate_<n>.gcode bzw. .preview eines Auftrags oder None (nur gültige Ids, keine Pfadtricks)."""
    if not JOB_ID.match(str(job)) or not str(plate).isdigit():
        return None
    base = os.path.join(JOBS_DIR, job, "plate_%d" % int(plate))
    gcode = base + ".gcode"
    if not os.path.isfile(gcode):
        return None
    if ext == "gcode":
        return gcode
    prev = base + ".preview"
    if not os.path.isfile(prev):
        import gcode_preview
        data = gcode_preview.build_preview(gcode)
        with open(prev + ".tmp", "wb") as f:
            f.write(data)
        os.replace(prev + ".tmp", prev)
    return prev


def _plate_stats(path):
    with open(path, "rb") as f:
        f.seek(max(0, os.path.getsize(path) - TAIL_BYTES))
        tail = f.read().decode("utf-8", "replace")
    return {"gcode_mb": round(os.path.getsize(path) / 1e6, 1), **parse_gcode_tail(tail)}


def _reusable(reuse, keep):
    """Pfade der G-Codes, die aus dem früheren Auftrag übernommen werden, oder None, wenn einer fehlt."""
    if not reuse or not JOB_ID.match(str(reuse)):
        return None
    paths = {n: os.path.join(JOBS_DIR, reuse, "plate_%d.gcode" % n) for n in keep}
    return paths if all(os.path.isfile(p) for p in paths.values()) else None


def _run(orca, src, out, tmp, index):
    try:
        return subprocess.run([orca, "--slice", str(index), "--outputdir", out, src], cwd=tmp,
                              capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise SliceError("Slicen dauert zu lange (über %d min)" % (TIMEOUT_S // 60), "timeout")


def slice_3mf(data, plates=None, count=None, reuse=None):
    """plates/count/reuse: nur diese Platten (1-basiert) neu slicen, die übrigen der count Platten aus reuse
    übernehmen. Fehlt dort etwas, wird alles geslict. Ergebnis je Platte mit "reused": True/False."""
    if not data or len(data) > MAX_BYTES or not data.startswith(b"PK"):
        raise SliceError("Keine gültige 3MF-Datei (höchstens 200 MB)", "bad_request")
    orca = find_orca()
    if not orca:
        raise SliceError("OrcaSlicer ist auf dem Server nicht installiert (im Container enthalten; lokal ORCA_PATH setzen)", "no_slicer")
    todo, keep = None, {}
    if plates is not None and count:
        todo = sorted({int(n) for n in plates if 1 <= int(n) <= int(count)})
        keep = _reusable(reuse, [n for n in range(1, int(count) + 1) if n not in todo]) or {}
        if len(keep) + len(todo) != int(count) or not (todo or keep):
            todo, keep = None, {}
    with _lock, tempfile.TemporaryDirectory(prefix="slice-") as tmp:
        src, out = os.path.join(tmp, "projekt.3mf"), os.path.join(tmp, "out")
        os.mkdir(out)
        with open(src, "wb") as f:
            f.write(data)
        proc, result = None, {}
        for index in (todo if todo is not None else [0]):
            proc = _run(orca, src, out, tmp, index)
            try:
                with open(os.path.join(out, "result.json")) as f:
                    result = json.load(f)
            except (OSError, ValueError):
                result = {}
            if index and not os.path.isfile(os.path.join(out, "plate_%d.gcode" % index)):
                break    # diese Platte ging nicht – Fehler unten melden
        made = [n for n in os.listdir(out) if re.fullmatch(r"plate_\d+\.gcode", n)]
        missing = todo is not None and len(made) != len(todo)
        if (todo is None and not made) or missing:
            log = ((proc.stdout or "") + "\n" + (proc.stderr or "")) if proc else ""
            _keep_failure(data, log)
            msg = _failure_reason(result, log)
            if "temperatures are incompatible" in msg:
                msg = ("Die Filamente brauchen zu unterschiedliche Düsentemperaturen (z. B. PLA zusammen mit ASA/ABS) – "
                       "Orca slict so nicht. Für mehrfarbige Teile Filamente derselben Art in die Slots legen.")
            raise SliceError("OrcaSlicer konnte nicht slicen: " + msg, "failed")
        job, job_dir = _new_job_dir()
        plates_out = []
        for name in made:
            dest = os.path.join(job_dir, name)
            shutil.move(os.path.join(out, name), dest)  # für Vorschau und Download aufheben
            plates_out.append({"plate": int(re.findall(r"\d+", name)[0]), "reused": False, **_plate_stats(dest)})
        for n, path in keep.items():
            dest = os.path.join(job_dir, "plate_%d.gcode" % n)
            shutil.copyfile(path, dest)
            prev = path[:-len(".gcode")] + ".preview"
            if os.path.isfile(prev):
                shutil.copyfile(prev, dest[:-len(".gcode")] + ".preview")
            plates_out.append({"plate": n, "reused": True, **_plate_stats(dest)})
    plates_out.sort(key=lambda p: p["plate"])
    if not plates_out:
        raise SliceError("OrcaSlicer hat keine Platte geslict", "failed")
    n = max(len(p["grams"]) for p in plates_out)
    total = {"grams": [round(sum(p["grams"][i] if i < len(p["grams"]) else 0 for p in plates_out), 2) for i in range(n)],
             "total_g": round(sum(p["total_g"] for p in plates_out), 2), "time_s": sum(p["time_s"] for p in plates_out),
             "changes": sum(p["changes"] for p in plates_out)}
    return {"plates": plates_out, "total": total, "orca": version(), "job": job, "sliced": len(made)}
