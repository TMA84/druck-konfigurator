"""Aufträge der Druckwarteschlange bleiben erhalten (tools/slicer.py pin_job/keep_pinned/job_file).
2026-10-07: nach der ersten Platte war der Auftrag weg – neues Slicen räumte ihn aus dem temporären Ordner.
Aufruf: python tests/queue_pin.py"""
import os
import shutil
import sys
import tempfile

d = tempfile.mkdtemp()
os.environ["SLICE_JOBS_DIR"] = os.path.join(d, "jobs")
os.environ["SLICE_PINNED_DIR"] = os.path.join(d, "pinned")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import slicer  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER", name, detail)


def fake_job():
    job, path = slicer._new_job_dir()
    for n in (1, 2):
        with open(os.path.join(path, "plate_%d.gcode" % n), "w") as f:
            f.write("; plate %d\nG1 X1 Y1 Z0.2 E1\n" % n)
    return job


job = fake_job()
check("Auftrag frisch vorhanden", slicer.job_file(job, 2, "gcode") is not None)
check("aufheben", slicer.pin_job(job) and os.path.isfile(os.path.join(os.environ["SLICE_PINNED_DIR"], job, "plate_2.gcode")))
for _ in range(slicer.KEEP_JOBS + 2):   # weiteres Slicen räumt den temporären Ordner auf
    fake_job()
check("temporärer Auftrag aufgeräumt", not os.path.isdir(os.path.join(os.environ["SLICE_JOBS_DIR"], job)))
g = slicer.job_file(job, 2, "gcode")
check("Platte 2 trotzdem druckbar (aus der Kopie)", g is not None and open(g).read().startswith("; plate 2"), g)
check("Vorschau aus der Kopie", slicer.job_file(job, 1, "preview") is not None)
check("erneutes Aufheben harmlos", slicer.pin_job(job))
check("unbekannter Auftrag: nicht aufgehoben", slicer.pin_job("0123456789abcdef") is False)
check("ungültige Id abgewiesen", slicer.pin_job("../etc") is False)
other = fake_job()
slicer.pin_job(other)
slicer.keep_pinned([other])
check("alte Kopie weggeräumt, aktuelle bleibt", not os.path.isdir(os.path.join(os.environ["SLICE_PINNED_DIR"], job)) and slicer.job_file(other, 1, "gcode") is not None)
slicer.keep_pinned([])
check("Warteschlange beendet: keine Kopie mehr", not os.listdir(os.environ["SLICE_PINNED_DIR"]))
# im Hintergrund, ohne Vorschauen vorab, mit Verknüpfung statt Kopie
import time as _t
j2 = fake_job()
done = []
slicer.pin_job_async(j2, done.append)
for _ in range(50):
    if done:
        break
    _t.sleep(0.05)
pinned = os.path.join(os.environ["SLICE_PINNED_DIR"], j2, "plate_1.gcode")
check("im Hintergrund aufgehoben", done == [True] and os.path.isfile(pinned), done)
check("ohne Vorschau vorab", not os.path.exists(pinned.replace(".gcode", ".preview")))
check("verknüpft statt kopiert (gleiches Dateisystem)", os.stat(pinned).st_ino == os.stat(os.path.join(os.environ["SLICE_JOBS_DIR"], j2, "plate_1.gcode")).st_ino)
os.makedirs(os.path.join(os.environ["SLICE_PINNED_DIR"], j2 + ".tmp"), exist_ok=True)
slicer.keep_pinned([j2])
check("Zwischenkopie des aktuellen Auftrags bleibt", os.path.isdir(os.path.join(os.environ["SLICE_PINNED_DIR"], j2 + ".tmp")))
shutil.rmtree(d, ignore_errors=True)
print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
