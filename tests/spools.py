"""Prüft tools/spools.py: Spulen erkennen, Verbrauch und Spülabfall mitzählen, Restmenge, Änderungen.
Aufruf: python tests/spools.py (ohne Drucker, mit nachgestellten ACE-Berichten)."""
import math
import os
import sys
import tempfile
import time

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


def fails(name, fn, part=""):
    try:
        fn()
        check(name, False, "kein Fehler")
    except ValueError as e:
        check(name, part in str(e), e)


# Neue Spule: nach dem Füllgewicht fragen (needs_check)
st = spools.empty_state()
spools.sync_slots(st, ace(ASA, PLA_G), now=100)
a0, g0 = st["spools"]
check("neue Spulen: needs_check", a0["needs_check"] and g0["needs_check"])
spools.update(st, {"action": "update", "id": a0["id"], "name": "x"})
check("nur Name geändert: bleibt offen", a0["needs_check"])
spools.update(st, {"action": "update", "id": a0["id"], "needs_check": False})
check("„Voll“ bestätigt", a0["needs_check"] is False and a0["net_g"] == 1000)
spools.update(st, {"action": "update", "id": g0["id"], "remaining_g": 400})
check("Restmenge eingetragen: erledigt", g0["needs_check"] is False and spools.remaining(g0) == 400)
spools.sync_slots(st, ace(ASA, EMPTY), now=110)
spools.sync_slots(st, ace(ASA, PLA_G), now=120)
check("wieder eingelegt: nicht erneut fragen", g0["needs_check"] is False and len(st["spools"]) == 2)
spools.update(st, {"action": "add", "type": "PLA", "colour": "#123456"})
check("von Hand angelegt: keine Nachfrage", st["spools"][-1]["needs_check"] is False)
old = spools.empty_state()
old["spools"].append({k: v for k, v in a0.items() if k != "needs_check"})
check("alte Daten ohne Feld: keine Nachfrage", not spools.view(old)["spools"][0].get("needs_check"))

# Warnschwelle
check("Warnschwelle Standard 100 g", spools.empty_state()["low_g"] == 100 and spools.view(spools.empty_state())["low_g"] == 100)
spools.update(st, {"action": "config", "low_g": 250})
check("Warnschwelle 250 g gespeichert", st["low_g"] == 250 and spools.view(st)["low_g"] == 250)
fails("Warnschwelle −5 abgelehnt", lambda: spools.update(st, {"action": "config", "low_g": -5}), "Warnschwelle")
fails("Warnschwelle Text abgelehnt", lambda: spools.update(st, {"action": "config", "low_g": "viel"}), "Warnschwelle")
spools.update(st, {"action": "config", "flush": 1.2})
check("andere Einstellung lässt Warnschwelle", st["low_g"] == 250)

# Export / Import
import json  # noqa: E402
st["host"] = "192.168.1.50"
st["history"] = [{"job": "a.gcode", "start": 10, "end": 20, "used": {a0["id"]: 5.0}, "changes": 0}]
name, body = spools.export_state(st, now=1790000000)
exp = json.loads(body)
check("Export: Dateiname mit Datum", name.startswith("spools-2026-") and name.endswith(".json"), name)
check("Export: Format und Spulen", exp["format"] == spools.EXPORT_FORMAT and len(exp["spools"]) == 3 and exp["low_g"] == 250)

# replace: alles außer host (und dem laufenden Zähler)
tgt = spools.empty_state()
tgt["host"], tgt["track"] = "10.0.0.9", {"job": "läuft.gcode"}
r = spools.import_state(tgt, exp, "replace")
check("replace: Spulen, Verlauf, Einstellungen übernommen", len(tgt["spools"]) == 3 and len(tgt["history"]) == 1 and tgt["low_g"] == 250 and tgt["flush"] == 1.2 and r["imported"]["total"] == 3, r)
check("replace: host und track bleiben", tgt["host"] == "10.0.0.9" and tgt["track"] == {"job": "läuft.gcode"})

# merge: zweiter Server hat dieselben Spulen mit anderen ids
other = spools.empty_state()
other["host"], other["flush"], other["low_g"] = "10.0.0.9", 2.0, 80
spools.sync_slots(other, ace(ASA, PLA_G, PLA_W), now=50)       # früher gesehen als im Export
oa, og, ow = other["spools"]
ow["last_seen"] = 9e9                                          # Weiß hier neuer
ow["name"] = "hier"
r = spools.import_state(other, exp, "merge")
check("merge: gleiche Spule über sku/Typ/Farbe im Slot", len(other["spools"]) == 4 and r["imported"]["added"] == 1, (r, len(other["spools"])))
check("merge: neuere Angaben gewinnen, id und Slot bleiben", spools.remaining(og) == 400 and og["id"] != g0["id"] and og["slot"] == 1 and og["needs_check"] is False, og)
check("merge: eigene neuere Spule bleibt", ow["name"] == "hier")
check("merge: unbekannte Spule ins Regal", other["spools"][-1]["slot"] is None and other["spools"][-1]["colour"] == "#123456")
check("merge: host/flush/low_g bleiben", other["host"] == "10.0.0.9" and other["flush"] == 2.0 and other["low_g"] == 80)
check("merge: Verlauf übernommen, ids umgeschrieben", other["history"][0]["used"] == {oa["id"]: 5.0}, other["history"])
n = len(other["spools"])
spools.import_state(other, exp, "merge")
check("merge zweimal: nichts doppelt", len(other["spools"]) == n and len(other["history"]) == 1)
same = spools.empty_state()
spools.import_state(same, exp, "replace")
exp2 = dict(exp, spools=[dict(sp, net_g=750, last_seen=sp["last_seen"] + 1) for sp in exp["spools"]])
spools.import_state(same, exp2, "merge")
check("merge über id: neuere Datei gewinnt", all(sp["net_g"] == 750 for sp in same["spools"]) and len(same["spools"]) == 3)

# Prüfung der Importdatei
fails("Import: keine Art", lambda: spools.import_state(spools.empty_state(), exp, "egal"), "merge")
fails("Import: kein Objekt", lambda: spools.import_state(spools.empty_state(), [1, 2], "merge"), "JSON-Objekt")
fails("Import: fremdes Format", lambda: spools.import_state(spools.empty_state(), {"format": "x", "spools": []}, "merge"), "Spulendatei")
fails("Import: spools fehlt", lambda: spools.import_state(spools.empty_state(), {"foo": 1}, "merge"), "Spulendatei")
bad = lambda **kw: dict(exp, spools=[dict(exp["spools"][0], **kw)])
fails("Import: Gewicht als Text", lambda: spools.import_state(spools.empty_state(), bad(net_g="1000"), "replace"), "net_g")
fails("Import: Gewicht unendlich", lambda: spools.import_state(spools.empty_state(), bad(net_g=float("inf")), "replace"), "net_g")
fails("Import: Slot ungültig", lambda: spools.import_state(spools.empty_state(), bad(slot=-1), "replace"), "Slot")
fails("Import: id ungültig", lambda: spools.import_state(spools.empty_state(), bad(id="../x"), "replace"), "id")
fails("Import: Name zu lang", lambda: spools.import_state(spools.empty_state(), bad(name="x" * 5000), "replace"), "name")
fails("Import: archived kein bool", lambda: spools.import_state(spools.empty_state(), bad(archived="ja"), "replace"), "archived")
fails("Import: doppelte id", lambda: spools.import_state(spools.empty_state(), dict(exp, spools=[exp["spools"][0]] * 2), "replace"), "doppelt")
fails("Import: zu viele Spulen", lambda: spools.import_state(spools.empty_state(), dict(exp, spools=[{}] * 501), "replace"), "Zu viele")
fails("Import: Verlauf kaputt", lambda: spools.import_state(spools.empty_state(), dict(exp, history=[{"used": {"a": "x"}}]), "replace"), "Verbrauch")
keep = spools.empty_state()
keep["spools"].append(dict(a0))
try:
    spools.import_state(keep, bad(net_g=-1), "replace")
except ValueError:
    pass
check("abgelehnter Import ändert nichts", len(keep["spools"]) == 1 and keep["spools"][0]["id"] == a0["id"])

# über api_post (Datei)
with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "spools.json")
    res = spools.api_post({"action": "import", "mode": "replace", "data": exp}, p)
    check("api_post import: Meldung und Zahlen", res["note"] == "Spulen ersetzt" and res["imported"]["total"] == 3 and len(spools.load(p)["spools"]) == 3, res.get("note"))
    nm, bd = spools.api_export(p)
    check("api_export liefert JSON", json.loads(bd)["format"] == spools.EXPORT_FORMAT)

# ---------- Druckhistorie: Kosten, Dauer, Plan (Schätzung aus dem Tool) ----------
hs = spools.empty_state()
spools.sync_slots(hs, ace(ASA, PLA_G), now=1000)
ha, hg = hs["spools"]
spools.update(hs, {"action": "update", "id": ha["id"], "price_per_kg": 40, "profile_id": "u123"})
check("profile_id an der Spule", ha["profile_id"] == "u123")
check("Standardpreis 25", spools.view(hs)["price_default"] == 25)
spools.update(hs, {"action": "config", "price_default": 20})
check("Standardpreis änderbar", hs["price_default"] == 20)
fails("Standardpreis 0 abgelehnt", lambda: spools.update(hs, {"action": "config", "price_default": 0}), "Standardpreis")
r = spools.update(hs, {"action": "plan", "job_name": "Würfel_Platte2.gcode", "plate": 2,
                       "estimate": {"grams": [10, 5.5], "total_g": 15.5, "time_s": 3600, "cost_eur": 0.52, "name": "Würfel"}})
check("Plan gespeichert, Schlüssel ohne Endung", r == "Plan gespeichert" and list(hs["plans"]) == ["Würfel_Platte2"], hs["plans"])
fails("Plan ohne Namen", lambda: spools.update(hs, {"action": "plan", "estimate": {}}), "job_name")
fails("Plan mit kaputten Gramm", lambda: spools.update(hs, {"action": "plan", "job_name": "x", "estimate": {"grams": ["a"]}}), "grams")
pj = {"filename": "/useremain/app/gk/Würfel_Platte2.gcode", "progress": 0, "supplies_usage": 0}
spools.track(hs, pj, 0, now=2000)
spools.track(hs, dict(pj, supplies_usage=1000, progress=50), 0, now=2600)
spools.track(hs, dict(pj, supplies_usage=1000, progress=60), 1, now=2700)
spools.track(hs, dict(pj, supplies_usage=2000, progress=90), 1, now=3000)
spools.track(hs, None, 1, now=5600)
e = hs["history"][-1]
ga, gg = spools.mm_to_g(1000, "ASA"), spools.mm_to_g(1000, "PLA") + spools.purge_g(1.5)
check("Historie: Dauer", e["duration_s"] == 3600, e)
check("Historie: Gramm gesamt", abs(e["grams_total"] - (ga + gg)) < 0.05, e)
check("Historie: Kosten je Spulenpreis bzw. Standard", abs(e["cost_eur"] - (ga / 1000 * 40 + gg / 1000 * 20)) < 0.005, e)
check("Historie: Gramm je Typ", set(e["types"]) == {"ASA", "PLA"} and abs(e["types"]["ASA"] - ga) < 0.01, e["types"])
check("Historie: Plan als Schätzung angehängt", e.get("estimate", {}).get("total_g") == 15.5 and e["estimate"]["plate"] == 2 and not hs["plans"], e.get("estimate"))
spools.track(hs, {"filename": "fremd.gcode", "progress": 0, "supplies_usage": 0}, 0, now=6000)
spools.track(hs, None, 0, now=6100)
check("fremder Druck ohne Schätzung", "estimate" not in hs["history"][-1])
# Plan als Endung (Drucker setzt ein Präfix)
spools.update(hs, {"action": "plan", "job_name": "Teil_Platte1", "estimate": {"grams": [1]}})
check("Plan passt als Endung", spools.find_plan(hs, "/x/2026-0929-Teil_Platte1.gcode") == "Teil_Platte1")
for i in range(60):
    spools.add_plan(hs, {"job_name": "p%d" % i, "estimate": {}}, now=10000 + i)
check("höchstens 50 Pläne, die ältesten fliegen", len(hs["plans"]) == 50 and "p59" in hs["plans"] and "p0" not in hs["plans"])
# Monatsstatistik (für Home Assistant)
now = time.time()
ms = spools.empty_state()
ms["history"] = [{"job": "a", "start": now - 7200, "end": now - 3600, "used": {}, "grams_total": 100, "cost_eur": 2.5, "duration_s": 3600, "changes": 0},
                 {"job": "b", "start": now - 3600, "end": now, "used": {"x": 50}, "changes": 0},
                 {"job": "alt", "start": 1000, "end": 2000, "used": {"x": 999}, "grams_total": 999, "cost_eur": 99, "duration_s": 1000, "changes": 0}]
sm = spools.stats(ms, now)
check("Monat: Drucke, Gramm, Kosten, Stunden", sm["prints"] == 2 and sm["grams"] == 150 and sm["cost_eur"] == 2.5 and sm["hours"] == 1, sm)
check("Seite bekommt Statistik und nur die letzten Drucke", spools.view(ms)["stats"]["prints"] == 2 and spools.view(ms)["history_total"] == 3)
many = spools.empty_state()
many["history"] = [{"job": "j%d" % i, "start": i, "end": i + 1, "used": {}, "changes": 0} for i in range(600)]
spools.track(many, {"filename": "n.gcode", "progress": 0}, 0, now=700)
spools.track(many, None, 0, now=800)
check("Historie auf 500 begrenzt", len(many["history"]) == 500 and many["history"][-1]["job"] == "n.gcode")
check("GET liefert nur 50", len(spools.view(many)["history"]) == spools.VIEW_HISTORY)
# Export/Import mit den neuen Feldern
nm, bd = spools.export_state(hs)
ex = json.loads(bd)
check("Export: Schätzung, Kosten, profile_id, Standardpreis", ex["history"][0]["estimate"]["total_g"] == 15.5 and ex["history"][0]["cost_eur"] > 0
      and any(sp.get("profile_id") == "u123" for sp in ex["spools"]) and ex["price_default"] == 20)
rt = spools.empty_state()
r = spools.import_state(rt, ex, "replace")
check("Import replace: neue Felder bleiben", rt["history"][0].get("estimate") == hs["history"][0]["estimate"] and rt["history"][0]["types"] == hs["history"][0]["types"]
      and rt["price_default"] == 20 and next(sp for sp in rt["spools"] if sp["id"] == ha["id"])["profile_id"] == "u123" and r["imported"]["idmap"], rt["history"][0])
fails("Import: Schätzung kaputt", lambda: spools.import_state(spools.empty_state(), dict(ex, history=[dict(ex["history"][0], estimate={"grams": [-1]})]), "replace"), "grams")
fails("Import: Kosten als Text", lambda: spools.import_state(spools.empty_state(), dict(ex, history=[dict(ex["history"][0], cost_eur="1")]), "replace"), "cost_eur")
fails("Import: Typen kaputt", lambda: spools.import_state(spools.empty_state(), dict(ex, history=[dict(ex["history"][0], types={"PLA": "x"})]), "replace"), "types")
# große Datei in Teilen: erst Spulen, dann Drucke nachreichen (mit Umschreiben der ids)
part = spools.empty_state()
spools.sync_slots(part, ace(ASA), now=1)                       # dieselbe ASA-Spule hier unter anderer id
r = spools.import_state(part, dict(ex, history=[]), "merge")
own_asa = part["spools"][0]["id"]
check("merge: idmap in der Antwort", r["imported"]["idmap"].get(ha["id"]) == own_asa, r["imported"])
r = spools.update(part, {"action": "import_history", "history": ex["history"], "idmap": r["imported"]["idmap"]})
check("Drucke nachgereicht, ids umgeschrieben", r["history_total"] == len(ex["history"]) and own_asa in part["history"][0]["used"], part["history"][0]["used"])
spools.update(part, {"action": "import_history", "history": ex["history"], "idmap": {}})
check("nachgereicht zweimal: nichts doppelt", len(part["history"]) == len(ex["history"]))
fails("import_history: kaputt", lambda: spools.update(part, {"action": "import_history", "history": "x"}), "history")

print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
