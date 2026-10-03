"""Geplanter Druck (tools/schedule.py): Prüfungen beim Planen, Trocknen vor dem Start, Start nur bei freiem Drucker
mit passendem Filament, Absagen. Aufruf: python tests/schedule.py"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import schedule as sc  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER", name, detail)


def fails(name, fn, text):
    try:
        fn()
        check(name, False, "kein Fehler")
    except sc.ScheduleError as e:
        check(name, text in str(e), e)


d = tempfile.mkdtemp()
path = os.path.join(d, "schedule.json")
g = os.path.join(d, "src.gcode")
with open(g, "w") as f:
    f.write("G1 X0\n")
prev = os.path.join(d, "src.preview")
with open(prev, "wb") as f:
    f.write(b"GCPV3")
NOW = 1_800_000_000
FREE = {"connected": True, "printing": False, "job": None, "state": "free",
        "ace": [{"id": 0, "slots": [{"index": 0, "type": "PLA", "present": True}, {"index": 1, "type": "PETG", "present": True},
                                    {"index": 2, "type": "", "present": False}]}]}
base = {"action": "create", "job": "j", "plate": 1, "name": "Halter Satz", "start_at": NOW + 3 * 3600, "bed_clear": True,
        "wants": [{"tool": 0, "type": "PLA"}], "options": {"auto_leveling": True}}
gfor = lambda job, plate: (g, prev)

fails("ohne Bestätigung „Bett frei“", lambda: sc.api_post(dict(base, bed_clear=False), gfor, path, NOW), "Bett frei")
fails("Start in der Vergangenheit", lambda: sc.api_post(dict(base, start_at=NOW - 10), gfor, path, NOW), "Startzeit")
fails("zu weit voraus", lambda: sc.api_post(dict(base, start_at=NOW + 30 * 86400), gfor, path, NOW), "Startzeit")
fails("Trocknen länger als die Zeit bis zum Start", lambda: sc.api_post(dict(base, dry={"temp": 45, "minutes": 240}), gfor, path, NOW), "zu wenig Zeit")
fails("Trockentemperatur zu hoch", lambda: sc.api_post(dict(base, dry={"temp": 90, "minutes": 60}), gfor, path, NOW), "Trockentemperatur")
fails("Slice-Auftrag weg", lambda: sc.api_post(base, lambda j, p: (None, None), path, NOW), "nicht (mehr)")

v = sc.api_post(dict(base, dry={"temp": 45, "minutes": 120}), gfor, path, NOW)
p = v["plan"]
check("geplant: wartet, Startzeit, Trocknen 2 h vorher", p["state"] == "wait" and p["start_at"] == NOW + 3 * 3600 and p["dry"]["start_at"] == NOW + 3600
      and v["plan"]["in_s"] == 3 * 3600 and v["plan"]["dry_in_s"] == 3600, p)
check("G-Code in den Datenordner kopiert, nicht in der Antwort", os.path.isfile(os.path.join(sc.files_dir(path), p["id"], "plate.gcode")) and "file" not in p)
check("Name bereinigt", p["name"] == "Halter_Satz", p["name"])
fails("zweiter Plan, solange einer wartet", lambda: sc.api_post(base, gfor, path, NOW), "schon ein Druck geplant")

calls = []
start = lambda plan: calls.append(("start", plan["name"]))
dry = lambda on, temp, minutes: calls.append(("dry", on, temp, minutes))
run = sc.Runner(lambda: FREE, start, dry, path=path)
check("vor dem Trocknen: nichts", run.step(NOW + 60) is False and calls == [])
run.step(NOW + 3600 + 5)
check("Trocknen zur Zeit gestartet", calls == [("dry", True, 45, 120)] and sc.api_get(path)["plan"]["state"] == "drying", calls)
run.step(NOW + 3 * 3600 - 30)
check("vor dem Start: kein zweites Trocknen, kein Start", calls == [("dry", True, 45, 120)], calls)
run.step(NOW + 3 * 3600 + 1)
pl = sc.api_get(path)["plan"]
check("zur Zeit gestartet", calls[-1] == ("start", "Halter_Satz") and pl["state"] == "started", (calls, pl))
check("danach nichts mehr", run.step(NOW + 4 * 3600) is False)
sc.api_post({"action": "dismiss"}, None, path, NOW)
check("erledigten Plan entfernen", sc.api_get(path)["plan"] is None and not os.listdir(sc.files_dir(path)))

# Prüfungen vor dem Start
check("bereit", sc.check_ready(FREE, [{"tool": 0, "type": "PLA"}, {"tool": 1, "type": "PETG"}]) is None)
check("druckt", "druckt" in sc.check_ready(dict(FREE, printing=True), []))
check("nicht verbunden", "nicht erreichbar" in sc.check_ready(dict(FREE, connected=False), []))
check("busy", "nicht frei" in sc.check_ready(dict(FREE, state="busy"), []))
check("falsches Filament", "PLA eingelegt, geslict für PETG" in sc.check_ready(FREE, [{"tool": 0, "type": "PETG"}]))
check("Slot leer", "leer" in sc.check_ready(FREE, [{"tool": 2, "type": "PLA"}]))
check("PLA+ passt zu PLA", sc.check_ready(dict(FREE, ace=[{"id": 0, "slots": [{"index": 0, "type": "PLA+", "present": True}]}]), [{"tool": 0, "type": "PLA"}]) is None)

calls.clear()
sc.api_post(dict(base, wants=[{"tool": 0, "type": "PETG"}]), gfor, path, NOW)
sc.Runner(lambda: FREE, start, dry, path=path).step(NOW + 3 * 3600 + 1)
pl = sc.api_get(path)["plan"]
check("falsches Filament zur Startzeit: nicht gestartet, Grund", pl["state"] == "failed" and "geslict für PETG" in pl["note"] and calls == [], pl)
sc.api_post({"action": "dismiss"}, None, path, NOW)

def boom(plan):
    raise RuntimeError("Upload abgelehnt")
sc.api_post(base, gfor, path, NOW)
sc.Runner(lambda: FREE, boom, dry, path=path).step(NOW + 3 * 3600 + 1)
check("Fehler beim Start: failed mit Grund", "Upload abgelehnt" in sc.api_get(path)["plan"]["note"])
sc.api_post({"action": "dismiss"}, None, path, NOW)

# Absagen während des Trocknens beendet das Trocknen
calls.clear()
sc.api_post(dict(base, dry={"temp": 50, "minutes": 60}), gfor, path, NOW)
sc.Runner(lambda: FREE, start, dry, path=path).step(NOW + 2 * 3600 + 5)
stopped = []
sc.api_post({"action": "cancel"}, None, path, NOW + 2 * 3600 + 60, on_cancel=lambda plan: stopped.append(plan["id"]))
pl = sc.api_get(path)["plan"]
check("abgesagt, Trocknen beendet", pl["state"] == "cancelled" and len(stopped) == 1, (pl, stopped))
check("nach Absage startet nichts", sc.Runner(lambda: FREE, start, dry, path=path).step(NOW + 4 * 3600) is False and not any(c[0] == "start" for c in calls))
fails("Absagen ohne Plan", lambda: sc.api_post({"action": "cancel"}, None, path, NOW), "Kein geplanter Druck")

print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
