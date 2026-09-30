"""Prüft die Vorschau gestarteter Drucke (Live-Ansicht ④): tools/serve.py remember_print / printed_preview.
Sie liegt dauerhaft beim Server (DATA_DIR/printed) – übersteht Neuladen der Seite, andere Browser und Server-Neustart.
Aufruf: python tests/printed.py (ohne Drucker)."""
import importlib
import os
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
tmp = tempfile.mkdtemp(prefix="printed-")
os.environ["SPOOL_FILE"] = os.path.join(tmp, "data", "spools.json")
os.environ["SLICE_JOBS_DIR"] = os.path.join(tmp, "jobs")
passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER " + name + (": " + str(detail) if detail else ""))


def load():
    for m in ("slicer", "spools", "serve"):
        sys.modules.pop(m, None)
    import serve  # noqa: E402
    return serve


serve = load()
# Slice-Auftrag mit Vorschau nachstellen
job = "0123456789abcdef"
os.makedirs(os.path.join(tmp, "jobs", job))
open(os.path.join(tmp, "jobs", job, "plate_1.gcode"), "w").write(
    "; G-Code\nEXCLUDE_OBJECT_DEFINE NAME=halter.stl_id_0_copy_0 CENTER=100,120 POLYGON=[[90,110],[110,110],[110,130],[90,130],[90,110]]\n"
    "EXCLUDE_OBJECT_DEFINE NAME=halter.stl_id_0_copy_1 CENTER=140,120 POLYGON=[[130,110],[150,110],[150,130],[130,130],[130,110]]\n"
    "EXCLUDE_OBJECT_START NAME=halter.stl_id_0_copy_0\nG1 X1 Y1 E1\n")
open(os.path.join(tmp, "jobs", job, "plate_1.preview"), "wb").write(b"GCPV2 Testvorschau")

serve.remember_print("halter_Platte1.gcode", job, 1)
p = serve.printed_preview("halter_Platte1")
check("Vorschau unter dem Auftragsnamen gespeichert", p and open(p, "rb").read() == b"GCPV2 Testvorschau", p)
check("liegt beim Server (DATA_DIR/printed)", p and os.path.dirname(p) == os.path.join(tmp, "data", "printed"), p)
check("Name mit Pfad/Endung vom Drucker gefunden", serve.printed_preview("/useremain/app/gk/gcode/halter_Platte1.gcode") == p)
check("anderer Auftrag → keine Vorschau", serve.printed_preview("fremder_Druck") is None)
# Objekte zum Überspringen (Tab ④): aus EXCLUDE_OBJECT_DEFINE, in G-Code-Reihenfolge nummeriert
import json  # noqa: E402
objs = json.load(open(p[:-len(".preview")] + ".objects.json"))
check("Objekte aus dem G-Code gemerkt (Nummer, Name, Mitte, Umriss)", [o["id"] for o in objs] == [0, 1] and objs[1]["name"] == "halter.stl_id_0_copy_1"
      and objs[0]["center"] == [100.0, 120.0] and len(objs[0]["polygon"]) == 5, objs)

# Slice-Auftrag wird aufgeräumt (neu geslict) → Vorschau bleibt trotzdem
import shutil  # noqa: E402
shutil.rmtree(os.path.join(tmp, "jobs", job))
serve = load()   # „Server-Neustart“
check("nach Aufräumen und Server-Neustart noch da", serve.printed_preview("halter_Platte1") == p)

# höchstens PRINTED_KEEP Vorschauen
os.makedirs(os.path.join(tmp, "jobs", job))
open(os.path.join(tmp, "jobs", job, "plate_1.gcode"), "w").write("; G-Code\n")
open(os.path.join(tmp, "jobs", job, "plate_1.preview"), "wb").write(b"GCPV2 x")
for k in range(serve.PRINTED_KEEP + 3):
    serve.remember_print("teil%02d_Platte1.gcode" % k, job, 1)
n = len([f for f in os.listdir(os.path.join(tmp, "data", "printed")) if f.endswith(".preview")])
check("es bleiben höchstens %d Vorschauen" % serve.PRINTED_KEEP, n == serve.PRINTED_KEEP, n)
check("ohne Slice-Auftrag kein Fehler", serve.remember_print("x.gcode", "ffffffffffffffff", 1) is None)

shutil.rmtree(tmp, ignore_errors=True)
print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
