"""3MF mit der OrcaSlicer-Kommandozeile slicen und Verbrauch/Druckzeit aus dem G-Code lesen (Kostenkalkulation).

Orca wird gesucht in: $ORCA_PATH, /opt/orca/AppRun (Container), macOS-App, Windows-Standardpfad, PATH.
Im Container läuft Orca ohne Bildschirm (geprüft 2026-09-28 mit 2.4.2 auf aarch64).
Es wird immer nur ein Auftrag gleichzeitig geslict; weitere warten.
Uploads (3MF, G-Code) kommen als Datei (upload_file, im Auftragsordner – gleiches Dateisystem, also verknüpfen statt
kopieren); slice_3mf und import_gcode nehmen einen Pfad oder bytes und lesen die Datei nie ganz in den Speicher.
Neu slicen nur geänderter Platten: slice_3mf(data, plates=[2, 3], count=4, reuse=<job>) slict Platte 2 und 3
einzeln (--slice N) und übernimmt die übrigen G-Codes aus dem früheren Auftrag.
Druckwerte je Platte (partial=True): Die Seite schickt je Gruppe von Platten mit gleichen Werten eine eigene 3MF und
slict nur deren Platten; was der frühere Auftrag von den übrigen schon hat, wird übernommen, Fehlendes bleibt weg (die
nächste Gruppe ergänzt es). Erst der letzte Auftrag der Kette hat alle Platten.
"""
import contextlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time

CANDIDATES = [
    os.environ.get("ORCA_PATH", ""),
    "/opt/orca/AppRun",
    "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
    r"C:\Program Files\OrcaSlicer\orca-slicer.exe",
    shutil.which("orca-slicer") or "",
]
MAX_BYTES = 200 * 1024 * 1024
KEEP_JOBS = 8              # so viele Slice-Aufträge (G-Code) bleiben für Vorschau und Download
# Aufträge der Druckwarteschlange: dauerhafte Kopie im Datenordner (2026-10-07: nach der ersten Platte war der Auftrag
# weg – jedes neue Slicen räumt die ältesten der KEEP_JOBS auf, und das temporäre Verzeichnis überlebt keinen Neustart)
PINNED_DIR = os.environ.get("SLICE_PINNED_DIR") or os.path.join(
    os.environ.get("DATA_DIR") or os.path.join(os.path.expanduser("~"), ".druck-konfigurator"), "queue-jobs")
# Mit DATA_DIR (Container, Home-Assistant-Add-on: /data) im Datenordner – überlebt Neustarts und Updates (2026-10-08:
# nach einem Add-on-Update war der Slice-Stand der offenen Seite weg: „Slice-Auftrag nicht (mehr) vorhanden“)
JOBS_DIR = os.environ.get("SLICE_JOBS_DIR") or (os.path.join(os.environ["DATA_DIR"], "slice-jobs") if os.environ.get("DATA_DIR")
                                                else os.path.join(tempfile.gettempdir(), "druck-konfigurator-jobs"))
JOB_ID = re.compile(r"^[0-9a-f]{16}$")
TIMEOUT_S = 900
TAIL_BYTES = 2 * 1024 * 1024   # Statistik und Einstellungen stehen am Ende des G-Codes
UPLOAD_PREFIX = ".upload-"     # Upload-Dateien und Arbeitsordner („.slice-“) im Auftragsordner: keine Auftrags-Id,
WORK_PREFIX = ".slice-"        # bleiben beim Aufräumen der Aufträge stehen; nach einem Absturz nach STALE_S weg
STALE_S = 24 * 3600
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


def _keep_failure(src, log):
    """Letzten fehlgeschlagenen Auftrag zur Fehlersuche aufheben (überschreibt den vorigen)."""
    d = os.environ.get("SLICE_DEBUG_DIR", tempfile.gettempdir())
    try:
        shutil.copyfile(src, os.path.join(d, "druck-konfigurator-slice-fehler.3mf"))   # in Stücken, nicht ganz im Speicher
        with open(os.path.join(d, "druck-konfigurator-slice-fehler.log"), "w") as f:
            f.write(log)
    except OSError:
        pass


_jobs_lock = threading.Lock()   # Aufräumen der Aufträge (Slicen und G-Code-Import gleichzeitig)
_protected = {}                 # Auftrag → Anzahl laufender Übernahmen (reuse): nicht wegräumen


def _new_job_dir(protect=()):
    """Neuer Auftragsordner; die ältesten weg (außer protect und gerade übernommenen Aufträgen)."""
    with _jobs_lock:
        os.makedirs(JOBS_DIR, exist_ok=True)
        skip = set(protect) | set(_protected)
        names = os.listdir(JOBS_DIR)
        old = sorted((os.path.join(JOBS_DIR, d) for d in names if JOB_ID.match(d) and d not in skip), key=os.path.getmtime)
        _remove_stale(names)
        for d in old[:max(0, len(old) - KEEP_JOBS + 1)]:
            shutil.rmtree(d, ignore_errors=True)
        job = os.urandom(8).hex()
        path = os.path.join(JOBS_DIR, job)
        os.mkdir(path)
        return job, path


def _remove_stale(names):
    """Upload-Dateien und Arbeitsordner, die ein Absturz liegen ließ (älter als STALE_S)."""
    for d in names:
        if d.startswith((UPLOAD_PREFIX, WORK_PREFIX)):
            p = os.path.join(JOBS_DIR, d)
            try:
                if os.path.getmtime(p) < time.time() - STALE_S:
                    shutil.rmtree(p, ignore_errors=True) if os.path.isdir(p) else os.unlink(p)
            except OSError:
                pass


def upload_file():
    """Neue leere Datei für einen Upload → (fd, Pfad). Im Auftragsordner, damit sie ohne Kopie (os.link) zum Auftrag
    bzw. Arbeitsordner kommt. Wegräumen muss der Aufrufer."""
    os.makedirs(JOBS_DIR, exist_ok=True)
    return tempfile.mkstemp(prefix=UPLOAD_PREFIX, dir=JOBS_DIR)


@contextlib.contextmanager
def _source(data):
    """Pfad (bleibt, wie er ist) oder bytes (vorübergehend in eine Upload-Datei) → Pfad."""
    if not isinstance(data, (bytes, bytearray)):
        yield os.fspath(data)
        return
    fd, path = upload_file()
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        yield path
    finally:
        with contextlib.suppress(OSError):
            os.unlink(path)


def _head(path, n):
    with open(path, "rb") as f:
        return f.read(n)


@contextlib.contextmanager
def _protect(job):
    """Solange ein Auftrag übernommen wird (reuse), räumt ihn kein anderes Slicen/Import weg (sonst FileNotFoundError)."""
    with _jobs_lock:
        if job:
            _protected[job] = _protected.get(job, 0) + 1
    try:
        yield
    finally:
        with _jobs_lock:
            if job and _protected.get(job, 0) > 1:
                _protected[job] -= 1
            elif job:
                _protected.pop(job, None)


def _link_or_copy(src, dst):
    """Datei verknüpfen (schnell, kein Platz) – über Dateisystemgrenzen hinweg kopieren."""
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


_pin_lock = threading.Lock()
_pinning = set()


def pin_job(job):
    """Auftrag dauerhaft aufheben (in PINNED_DIR). True, wenn danach vorhanden.
    2026-10-08: ohne Vorschauen vorab (die baut job_file bei Bedarf) und mit Verknüpfungen statt Kopien – bei 7 Platten
    mit je ~18 MB G-Code dauerte das Anlegen der Warteschlange sonst lange ohne Rückmeldung."""
    if not JOB_ID.match(str(job)):
        return False
    dst = os.path.join(PINNED_DIR, job)
    if os.path.isdir(dst):
        return True
    src = os.path.join(JOBS_DIR, job)
    if not os.path.isdir(src):
        return False
    os.makedirs(PINNED_DIR, exist_ok=True)
    tmp = dst + ".tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(src, tmp, copy_function=_link_or_copy)
    os.replace(tmp, dst)
    return True


def pin_job_async(job, done=None):
    """pin_job im Hintergrund (der Server antwortet sofort); doppelte Aufrufe für denselben Auftrag laufen nur einmal."""
    with _pin_lock:
        if job in _pinning:
            return
        _pinning.add(job)

    def run():
        ok = False
        try:
            ok = pin_job(job)
        except OSError as e:
            print("Warteschlange: Auftrag %s nicht aufgehoben: %s" % (job, e), flush=True)
        finally:
            with _pin_lock:
                _pinning.discard(job)
        if done:
            done(ok)
    threading.Thread(target=run, daemon=True, name="pin-" + str(job)).start()


def keep_pinned(jobs):
    """Nur diese Aufträge dauerhaft behalten, die übrigen Kopien löschen."""
    if not os.path.isdir(PINNED_DIR):
        return
    for d in os.listdir(PINNED_DIR):
        if d.split(".")[0] not in jobs:   # auch die Zwischenkopie „<job>.tmp“ eines laufenden Aufhebens behalten
            shutil.rmtree(os.path.join(PINNED_DIR, d), ignore_errors=True)


def job_file(job, plate, ext):
    """Pfad zu plate_<n>.gcode bzw. .preview eines Auftrags oder None (nur gültige Ids, keine Pfadtricks)."""
    if not JOB_ID.match(str(job)) or not str(plate).isdigit():
        return None
    for root in (JOBS_DIR, PINNED_DIR):
        base = os.path.join(root, job, "plate_%d" % int(plate))
        gcode = base + ".gcode"
        if os.path.isfile(gcode):
            break
    else:
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


def import_gcode(data, name=""):
    """Fertigen G-Code (2026-10-18, „G-Code drucken“) als Auftrag mit einer Platte ablegen – danach wie geslict:
    Vorschau (job_file … preview), Drucken über /api/anycubic/print, 3D-Fortschritt. Rückgabe wie slice_3mf (eine Platte).
    data: Pfad (z. B. upload_file; wird verknüpft, der Aufrufer räumt ihn weg) oder bytes."""
    with _source(data) as src:
        size = os.path.getsize(src)
        if not size or size > MAX_BYTES:
            raise SliceError("G-Code fehlt oder ist zu groß (höchstens 200 MB)", "bad_request")
        head = _head(src, 4096).decode("utf-8", "replace")
        if not re.search(r"^\s*(;|G[0-9]|M[0-9]|T[0-9])", head, re.M):
            raise SliceError("Das sieht nicht nach G-Code aus", "bad_request")
        job, path = _new_job_dir()
        dest = os.path.join(path, "plate_1.gcode")
        _link_or_copy(src, dest)   # gleiches Dateisystem: keine Kopie
    return {"job": job, "name": name, "plates": [{"plate": 1, "reused": False, **_plate_stats(dest)}]}


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


def _reusable_some(reuse, keep):
    """Wie _reusable, aber nur die G-Codes, die es gibt (partial: die übrigen Platten kommen aus einer weiteren 3MF)."""
    if not reuse or not JOB_ID.match(str(reuse)):
        return {}
    paths = {n: os.path.join(JOBS_DIR, reuse, "plate_%d.gcode" % n) for n in keep}
    return {n: p for n, p in paths.items() if os.path.isfile(p)}


def _run(orca, src, out, tmp, index):
    try:
        return subprocess.run([orca, "--slice", str(index), "--outputdir", out, src], cwd=tmp,
                              capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise SliceError("Slicen dauert zu lange (über %d min)" % (TIMEOUT_S // 60), "timeout")


def slice_3mf(data, plates=None, count=None, reuse=None, partial=False):
    """data: Pfad der 3MF (z. B. upload_file; wird verknüpft, der Aufrufer räumt sie weg) oder bytes.
    plates/count/reuse: nur diese Platten (1-basiert) neu slicen, die übrigen der count Platten aus reuse
    übernehmen. Fehlt dort etwas, wird alles geslict – außer mit partial (Druckwerte je Platte): dann nur diese
    Platten plus, was reuse von den übrigen hat. Ergebnis je Platte mit "reused": True/False."""
    with _source(data) as upload:
        size = os.path.getsize(upload)
        if not size or size > MAX_BYTES or _head(upload, 2) != b"PK":
            raise SliceError("Keine gültige 3MF-Datei (höchstens 200 MB)", "bad_request")
        orca = find_orca()
        if not orca:
            raise SliceError("OrcaSlicer ist auf dem Server nicht installiert (im Container enthalten; lokal ORCA_PATH setzen)", "no_slicer")
        reuse = str(reuse) if reuse and JOB_ID.match(str(reuse)) else None
        with _protect(reuse):
            return _slice(orca, upload, plates, count, reuse, partial)


def _slice(orca, upload, plates, count, reuse, partial=False):
    todo, keep = None, {}
    if plates is not None and count:
        todo = sorted({int(n) for n in plates if 1 <= int(n) <= int(count)})
        others = [n for n in range(1, int(count) + 1) if n not in todo]
        if partial and todo:
            keep = _reusable_some(reuse, others)
        else:
            keep = _reusable(reuse, others) or {}
            if len(keep) + len(todo) != int(count) or not (todo or keep):
                todo, keep = None, {}
    os.makedirs(JOBS_DIR, exist_ok=True)
    # Arbeitsordner im Auftragsordner: 3MF hinein und G-Codes heraus ohne Kopie (gleiches Dateisystem)
    with _lock, tempfile.TemporaryDirectory(prefix=WORK_PREFIX, dir=JOBS_DIR) as tmp:
        src, out = os.path.join(tmp, "projekt.3mf"), os.path.join(tmp, "out")
        os.mkdir(out)
        _link_or_copy(upload, src)
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
            _keep_failure(src, log)
            msg = _failure_reason(result, log)
            if "temperatures are incompatible" in msg:
                msg = ("Die Filamente brauchen zu unterschiedliche Düsentemperaturen (z. B. PLA zusammen mit ASA/ABS) – "
                       "Orca slict so nicht. Für mehrfarbige Teile Filamente derselben Art in die Slots legen.")
            raise SliceError("OrcaSlicer konnte nicht slicen: " + msg, "failed")
        job, job_dir = _new_job_dir(protect=[reuse] if keep else ())
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
