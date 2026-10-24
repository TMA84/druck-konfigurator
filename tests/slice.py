"""Prüft tools/slicer.py: G-Code-Statistik lesen und – wenn OrcaSlicer da ist – ein echtes 3MF slicen
(zweifarbiger Pilz aus dem Export, 2 Körper in Slot 1 und 3). Aufruf: python tests/slice.py
Das 3MF erzeugt node (tests/make-test-3mf.js); ohne node wird nur der Parser geprüft."""
import os
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
import slicer  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER " + name + (": " + str(detail) if detail else ""))


# 1) Parser
check("Dauer 1d 2h 3m 4s", slicer.parse_duration("1d 2h 3m 4s") == 93784)
check("Dauer 55m 4s", slicer.parse_duration("55m 4s") == 3304)
tail = "; filament used [mm] = 2641.32, 0.00, 1776.13, 0.00\n; filament used [g] = 7.88, 0.00, 5.30, 0.00\n; total filament used [g] = 13.18\n; total filament change = 1\n; estimated printing time (normal mode) = 55m 4s\n"
p = slicer.parse_gcode_tail(tail)
check("Statistik gelesen", p["grams"] == [7.88, 0.0, 5.3, 0.0] and p["total_g"] == 13.18 and p["changes"] == 1 and p["time_s"] == 3304, p)
for bad in (b"", b"kein zip", b"PK" + b"x" * 10):
    try:
        slicer.slice_3mf(bad)
        check("ungültige Datei abgelehnt", bad.startswith(b"PK") and slicer.find_orca() is None)
    except slicer.SliceError as e:
        check("ungültige Datei abgelehnt (" + e.kind + ")", e.kind in ("bad_request", "failed", "no_slicer"), e)

# Upload als Datei (serve.py schreibt in Stücken in slicer.upload_file): verknüpft, nicht ganz gelesen; die Datei
# gehört weiter dem Aufrufer
def upload(data):
    fd, path = slicer.upload_file()
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return path


def leftovers():
    return [n for n in os.listdir(slicer.JOBS_DIR) if n.startswith((slicer.UPLOAD_PREFIX, slicer.WORK_PREFIX))]


src = upload(b"; G-Code\nG1 X1 Y1 E1\n" * 1000)
r = slicer.import_gcode(src, "datei.gcode")
dest = slicer.job_file(r["job"], 1, "gcode")
check("G-Code aus Datei übernommen", dest and os.path.getsize(dest) == os.path.getsize(src) and r["name"] == "datei.gcode", r)
check("Upload-Datei bleibt beim Aufrufer", os.path.isfile(src))
os.unlink(src)
check("Auftrag behält den G-Code ohne Upload-Datei", os.path.isfile(dest))
for bad in (b"kein gcode", b""):
    src = upload(bad)
    try:
        slicer.import_gcode(src)
        check("ungültiger G-Code aus Datei abgelehnt", False)
    except slicer.SliceError as e:
        check("ungültiger G-Code aus Datei abgelehnt", e.kind == "bad_request", e)
    os.unlink(src)
src = upload(b"kein zip")
try:
    slicer.slice_3mf(src)
    check("ungültige 3MF aus Datei abgelehnt", False)
except slicer.SliceError as e:
    check("ungültige 3MF aus Datei abgelehnt", e.kind == "bad_request", e)
os.unlink(src)
check("keine Upload-Dateien übrig (bytes)", not leftovers(), leftovers())

# 2) Echtes Slicen
if slicer.find_orca():
    try:
        data = subprocess.run(["node", os.path.join(ROOT, "tests", "make-test-3mf.js")], capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        data = open(os.environ["TEST_3MF"], "rb").read() if os.environ.get("TEST_3MF") else None
    if data:
        r = slicer.slice_3mf(data)
        t = r["total"]
        print("OrcaSlicer %s: %s g je Slot, %.2f g, %d s, %d Wechsel" % (r["orca"], t["grams"], t["total_g"], t["time_s"], t["changes"]))
        check("eine Platte", len(r["plates"]) == 1, r["plates"])
        check("Slot 1 und 3 verbraucht, 2 und 4 nicht", t["grams"][0] > 1 and t["grams"][2] > 1 and t["grams"][1] == 0 and t["grams"][3] == 0, t["grams"])
        check("1 Farbwechsel", t["changes"] == 1, t["changes"])
        check("Druckzeit plausibel (10–120 min)", 600 < t["time_s"] < 7200, t["time_s"])
        # Zwei Platten: alles, dann nur Platte 2 neu (Platte 1 übernommen)
        two = subprocess.run(["node", os.path.join(ROOT, "tests", "make-test-3mf.js"), "platten"], capture_output=True, check=True).stdout
        full = slicer.slice_3mf(two)
        check("zwei Platten geslict", [p["plate"] for p in full["plates"]] == [1, 2] and full["sliced"] == 2, full["plates"])
        part = slicer.slice_3mf(two, plates=[2], count=2, reuse=full["job"])
        check("nur Platte 2 neu geslict", part["sliced"] == 1 and [p["reused"] for p in part["plates"]] == [True, False], part["plates"])
        check("übernommene Platte gleich", part["plates"][0]["total_g"] == full["plates"][0]["total_g"] and part["plates"][0]["time_s"] == full["plates"][0]["time_s"])
        check("Summe wie beim vollen Slicen", abs(part["total"]["total_g"] - full["total"]["total_g"]) < 0.05, (part["total"], full["total"]))
        check("G-Code beider Platten im neuen Auftrag", all(slicer.job_file(part["job"], n, "gcode") for n in (1, 2)))
        # Kostenwerte in der 3MF kommen im G-Code an (auch für OrcaSlicer/AnycubicSlicerNext selbst)
        costly = slicer.slice_3mf(subprocess.run(["node", os.path.join(ROOT, "tests", "make-test-3mf.js"), "kosten"], capture_output=True, check=True).stdout)
        with open(slicer.job_file(costly["job"], 1, "gcode"), "rb") as f:
            f.seek(-slicer.TAIL_BYTES, 2) if os.path.getsize(f.name) > slicer.TAIL_BYTES else None
            tail = f.read().decode("utf-8", "replace")
        check("time_cost 0,35 €/h in der 3MF", "; time_cost = 0.35" in tail)
        check("filament_cost je Slot", "; filament_cost = 25,30,27.5,40" in tail)
        # Stützen und „Nur kritische Bereiche“ (Vorschlag seit 2026-10-08 aus, je Auftrag umschaltbar): an → Orca stützt
        # normale Überhänge nicht (2026-09-29: 0 Stützbahnen), aus → Stützen im G-Code
        def supports(*args):
            job = slicer.slice_3mf(subprocess.run(["node", os.path.join(ROOT, "tests", "make-test-3mf.js"), "stuetzen", *args], capture_output=True, check=True).stdout)
            with open(slicer.job_file(job["job"], 1, "gcode"), encoding="utf-8", errors="replace") as f:
                text = f.read()
            return text.count("\n;TYPE:Support"), "; support_critical_regions_only = 1" in text
        n_off, crit_off = supports()
        n_on, crit_on = supports("an")
        check("Vorschlag: nur kritische Bereiche aus, je Auftrag an", crit_on and not crit_off, (crit_on, crit_off))
        check("Vorschlag (aus): Stützen im G-Code (Trichterform)", n_off > 20, n_off)
        check("an: weniger Stützen als aus", n_on < n_off, (n_on, n_off))
        gone = slicer.slice_3mf(two, plates=[2], count=2, reuse="0" * 16)
        check("fehlender Auftrag: alles geslict", gone["sliced"] == 2, gone["plates"])
        # aus einer Upload-Datei (wie serve.py): gleiches Ergebnis, Datei bleibt beim Aufrufer, kein Arbeitsordner übrig
        src = upload(data)
        from_file = slicer.slice_3mf(src)
        check("3MF aus Datei geslict", from_file["total"]["total_g"] == r["total"]["total_g"], from_file["total"])
        check("3MF-Upload-Datei bleibt beim Aufrufer", os.path.isfile(src))
        os.unlink(src)
        check("kein Arbeitsordner/Upload übrig", not leftovers(), leftovers())
    else:
        print("Hinweis: kein Test-3MF (node fehlt) – echtes Slicen übersprungen")
else:
    print("Hinweis: kein OrcaSlicer gefunden – echtes Slicen übersprungen")

print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
