"""Prüft tools/spools.py: Spulen erkennen, Verbrauch und Spülabfall mitzählen, Restmenge, Änderungen.
Aufruf: python tests/spools.py (ohne Drucker, mit nachgestellten ACE-Berichten)."""
import math
import os
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
import spools  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER " + name + (": " + str(detail) if detail else ""))


def ace(*slots):
    return [dict({"index": i, "present": True, "rfid": True}, **s) for i, s in enumerate(slots)]


ASA = {"type": "ASA", "colour": "#010101", "sku": "SPM-6"}
PLA_G = {"type": "PLA", "colour": "#009639", "sku": "AHPLCG-107"}
PLA_W = {"type": "PLA", "colour": "#EFF0F1", "sku": "AHPLBW-107"}
EMPTY = {"present": False, "type": "", "colour": ""}

# Umrechnung
check("1 m PLA ≈ 2,98 g", abs(spools.mm_to_g(1000, "PLA") - math.pi * 0.875 ** 2 * 1.24) < 1e-9 and 2.9 < spools.mm_to_g(1000, "PLA") < 3.0)
check("Dichte PLA-CF wie PLA", spools.density("PLA-CF") == 1.24)
check("Spülabfall bei 1,5 ≈ 1,08 g", abs(spools.purge_g(1.5) - 1.0825) < 1e-9)

# Erkennen
st = spools.empty_state()
ev = spools.sync_slots(st, ace(ASA, PLA_G, PLA_W, EMPTY), now=100)
check("drei neue Spulen", [e["kind"] for e in ev] == ["new", "new", "new"] and len(st["spools"]) == 3, ev)
check("Füllgewicht 1000 g, Marke Anycubic bei RFID", all(sp["net_g"] == 1000 and sp["brand"] == "Anycubic" for sp in st["spools"]))
check("gleicher Stand → keine Ereignisse", spools.sync_slots(st, ace(ASA, PLA_G, PLA_W, EMPTY), now=110) == [])
green = next(sp for sp in st["spools"] if sp["sku"] == "AHPLCG-107")
# Grün herausnehmen, Weiß in Slot 2 umstecken
ev = spools.sync_slots(st, ace(ASA, EMPTY, PLA_G, EMPTY), now=120)
check("herausgenommen und umgesteckt erkannt", green["slot"] == 2 and any(e["kind"] == "removed" for e in ev), ev)
white = next(sp for sp in st["spools"] if sp["sku"] == "AHPLBW-107")
check("weiße Spule liegt im Regal", white["slot"] is None)
ev = spools.sync_slots(st, ace(ASA, PLA_W, PLA_G, EMPTY), now=130)
check("wieder eingelegt statt neu", [e["kind"] for e in ev] == ["reinserted"] and white["slot"] == 1 and len(st["spools"]) == 3, ev)

# Verbrauch: Druck mit Slot 0, Farbwechsel zu Slot 1
job = {"filename": "/useremain/x/teil.gcode", "progress": 0, "supplies_usage": 0}
spools.track(st, job, 0, now=200)
spools.track(st, dict(job, supplies_usage=1000, progress=10), 0, now=210)
asa = next(sp for sp in st["spools"] if sp["sku"] == "SPM-6")
check("1 m ASA gezählt", abs(asa["used_g"] - spools.mm_to_g(1000, "ASA")) < 1e-3, asa["used_g"])
spools.track(st, dict(job, supplies_usage=1000, progress=20), 1, now=220)
check("Farbwechsel: Spülabfall für die neue Spule", abs(white["purge_g"] - spools.purge_g(1.5)) < 1e-3 and st["track"]["changes"] == 1, white)
spools.track(st, dict(job, supplies_usage=3000, progress=50), 1, now=230)
check("2 m PLA für Slot 1", abs(white["used_g"] - spools.mm_to_g(2000, "PLA")) < 1e-3, white["used_g"])
check("Restmenge = 1000 − Verbrauch − Spülabfall", abs(spools.remaining(white) - round(1000 - white["used_g"] - white["purge_g"], 1)) < 0.06)
spools.track(st, None, 1, now=300)
h = st["history"][-1]
check("Druckende: in den letzten Drucken", h["job"].endswith("teil.gcode") and h["changes"] == 1 and set(h["used"]) == {asa["id"], white["id"]} and st["track"] == {}, h)

# Druck erst mittendrin gesehen (Server-Neustart): ab jetzt zählen, nicht alles doppelt
before = asa["used_g"]
spools.track(st, {"filename": "b.gcode", "progress": 60, "supplies_usage": 5000}, 0, now=400)
spools.track(st, {"filename": "b.gcode", "progress": 61, "supplies_usage": 5100}, 0, now=405)
check("mittendrin: nur der Zuwachs", abs(asa["used_g"] - before - spools.mm_to_g(100, "ASA")) < 1e-3, asa["used_g"] - before)
spools.track(st, None, 0, now=500)

# Änderungen von der Seite
spools.update(st, {"action": "update", "id": white["id"], "remaining_g": 250, "name": "Weiß matt"})
check("gewogene Restmenge übernommen", spools.remaining(white) == 250 and white["name"] == "Weiß matt", spools.remaining(white))
spools.track(st, {"filename": "c.gcode", "progress": 0, "supplies_usage": 0}, 1, now=600)
spools.track(st, {"filename": "c.gcode", "progress": 5, "supplies_usage": 1000}, 1, now=610)
check("danach wird weiter abgezogen", abs(spools.remaining(white) - round(250 - spools.mm_to_g(1000, "PLA"), 1)) < 0.06, spools.remaining(white))
spools.track(st, None, 1, now=700)
try:
    spools.update(st, {"action": "delete", "id": white["id"]})
    check("Spule in der ACE lässt sich nicht löschen", False)
except ValueError:
    check("Spule in der ACE lässt sich nicht löschen", True)
spools.update(st, {"action": "add", "type": "petg", "colour": "#FF0000", "net_g": 750})
check("eigene Spule angelegt", any(sp["type"] == "PETG" and sp["net_g"] == 750 and sp["slot"] is None for sp in st["spools"]))
spools.update(st, {"action": "config", "flush": 1.0})
check("Spülmenge 1,0 übernommen", st["flush"] == 1.0)
try:
    spools.update(st, {"action": "config", "flush": 9})
    check("unsinnige Spülmenge abgelehnt", False)
except ValueError:
    check("unsinnige Spülmenge abgelehnt", True)

# Speichern und Laden
with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "sub", "spools.json")
    spools.save(st, p)
    back = spools.load(p)
    check("gespeichert und geladen", len(back["spools"]) == len(st["spools"]) and back["flush"] == 1.0)
    check("fehlende Datei → leerer Stand", spools.load(os.path.join(d, "fehlt.json"))["spools"] == [])


# Tracker mit nachgestelltem Drucker
class FakeLink:
    def __init__(self):
        self.reports = {"multiColorBox": {"data": {"multi_color_box": [{"id": 0, "loaded_slot": 0, "slots": [
            {"index": 0, "sku": "SPM-6", "type": "ASA", "color": [1, 1, 1], "edit_status": 0, "status": 5}]}]}}}
        self.info = {"project": {"filename": "t.gcode", "progress": 0, "supplies_usage": 500}}

    def data(self, kind):
        return self.info if kind == "info" else {}


class FakeLan:
    AVAILABLE = True

    def __init__(self):
        self.link = FakeLink()

    def get_link(self, host):
        return self.link

    import anycubic_lan as _real
    ace_boxes = staticmethod(_real.ace_boxes)


with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "spools.json")
    lan = FakeLan()
    tr = spools.Tracker(lan, p)
    check("ohne Drucker-Adresse nichts tun", tr.step() is False)
    s0 = spools.load(p)
    spools.update(s0, {"action": "config", "host": "192.168.1.50"})
    spools.save(s0, p)
    tr.step()
    lan.link.info["project"]["supplies_usage"] = 1500
    tr.step()
    got = spools.load(p)
    check("Tracker erkennt Spule und zählt", len(got["spools"]) == 1 and abs(got["spools"][0]["used_g"] - spools.mm_to_g(1500, "ASA")) < 1e-3, got["spools"])

print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
