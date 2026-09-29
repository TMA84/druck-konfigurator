"""Prüft tools/printqueue.py: Warteschlange anlegen, Fertig-/Abbruch-Regeln (wie js/plates.js queueTick), Speichern,
Prüfung der Aktionen von der Seite, Beobachter mit nachgestelltem Drucker, API von tools/serve.py.
Aufruf: python tests/printqueue.py (ohne Drucker)."""
import http.client
import json
import os
import sys
import tempfile
import threading

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
import printqueue as pq  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER " + name + (": " + str(detail) if detail else ""))


def raises(fn, text=""):
    try:
        fn()
    except pq.QueueError as e:
        return text in str(e)
    return False


JOB = "0123456789abcdef"
PLATES = [{"plate": 1, "grams": [10, 0], "total_g": 10, "time_s": 600, "changes": 0},
          {"plate": 2, "grams": [0, 20], "total_g": 20, "time_s": 1200, "changes": 0},
          {"plate": 3, "grams": [5, 5], "total_g": 11, "time_s": 1800, "changes": 3}]
CREATE = {"action": "create", "name": "Teil.3mf", "job": JOB, "plates": PLATES, "materials": {"0": {"kind": "pla", "name": "PLA"}, "1": None},
          "order": [2, 1, 3]}
PRINTING = {"printing": True, "job": {"status": "druckt", "remaining_min": 15}}
FREE = {"printing": False, "job": None}

# Anlegen und prüfen
s = pq.empty_state()
check("anlegen", pq.update(s, dict(CREATE), now=1000) == "angelegt")
q = s["queue"]
check("Reihenfolge übernommen", [i["plate"] for i in q["items"]] == [2, 1, 3] and all(i["state"] == "wait" for i in q["items"]))
check("Restzeit = alle wartenden", pq.remaining_s(q, None) == 3600)
check("nächste Platte", pq.next_item(q)["plate"] == 2)
check("Materialien übernommen", q["materials"] == {"0": {"kind": "pla", "name": "PLA"}, "1": None})
for bad, text in [(dict(CREATE, job="../etc"), "Slice-Auftrag"), (dict(CREATE, plates=[]), "Platten fehlen"),
                  (dict(CREATE, plates="x"), "Platten fehlen"), (dict(CREATE, order=[1, 1]), "nicht im Slice-Stand"),
                  (dict(CREATE, order=[9]), "Platte 9 nicht im Slice-Stand"), (dict(CREATE, order=["1"]), "Plattennummer"),
                  (dict(CREATE, plates=[dict(PLATES[0], time_s="lang")]), "time_s"),
                  (dict(CREATE, plates=[dict(PLATES[0], grams=[-1])]), "grams"),
                  (dict(CREATE, plates=[PLATES[0], PLATES[0]]), "doppelt"),
                  (dict(CREATE, order=[{"plate": 1, "state": "kaputt"}]), "Zustand"),
                  ({"action": "zaubern"}, "unbekannte Aktion"), ({"action": "skip", "plate": 7}, "nicht in der Warteschlange"),
                  ({"action": "skip", "plate": True}, "Plattennummer")]:
    check("abgelehnt: " + text, raises(lambda: pq.update(s, bad), text), bad)
check("nicht-Objekt abgelehnt", raises(lambda: pq.update(s, [1]), "JSON"))

# Start, gesehen, fertig
pq.update(s, {"action": "started", "plate": 2}, now=2000)
cur = pq.current(q)
check("gestartet → druckt", cur["plate"] == 2 and cur["seen"] is False and cur["started"] == 2000)
check("Restzeit mit laufendem Druck laut Orca", pq.remaining_s(q, None) == 1200 + 600 + 1800)
check("Restzeit laut Drucker", pq.remaining_s(q, PRINTING) == 15 * 60 + 600 + 1800)
check("frei direkt nach dem Start zählt nicht", pq.tick(s, FREE, now=2010) is None and cur["state"] == "printing")
check("„fertig“ vom vorigen Druck zählt nicht", pq.tick(s, {"printing": True, "job": {"status": "fertig"}}, now=2015) is None and cur["state"] == "printing")
check("ohne Stand nichts", pq.tick(s, None, now=2020) is None)
ev = pq.tick(s, PRINTING, now=2030)
check("druckt → gesehen", ev == {"kind": "seen", "plate": 2} and cur["seen"] is True)
check("weiter druckend: kein Ereignis", pq.tick(s, PRINTING, now=2040) is None)
check("Anlegen gesperrt, solange eine Platte druckt", raises(lambda: pq.update(s, dict(CREATE)), "erst beenden"))
check("Überspringen der laufenden gesperrt", raises(lambda: pq.update(s, {"action": "skip", "plate": 2}), "druckt gerade"))
ev = pq.tick(s, {"printing": True, "job": {"status": "fertig"}}, now=3000)
check("„fertig“ → done", ev and ev["kind"] == "done" and ev["plate"] == 2 and ev["next"] == 1 and ev["seq"] == 1 and cur["state"] == "done", ev)
check("Bett abräumen an, letzte Platte gemerkt", s["bed_clear"] is True and q["lastDone"] == 2 and s["event"]["time"] == 3000)
sm = pq.summary(s)
check("Text: Bett abräumen", sm["text"] == "Platte 2 fertig – Bett abräumen, danach Platte 1" and sm["done"] == 1 and sm["total"] == 3, sm)
check("kein zweites Ereignis", pq.tick(s, FREE, now=3010) is None and s["seq"] == 1)

# Nächste Platte: Bett abräumen aus; nicht mehr druckend → fertig
pq.update(s, {"action": "started", "plate": 1}, now=4000)
check("Start → Bett abräumen aus", s["bed_clear"] is False and q["lastDone"] is None)
pq.tick(s, PRINTING, now=4010)
ev = pq.tick(s, FREE, now=5000)
check("druckt nicht mehr → done", ev["kind"] == "done" and ev["plate"] == 1 and ev["seq"] == 2)

# Abbruch
pq.update(s, {"action": "started", "plate": 3}, now=6000)
pq.tick(s, PRINTING, now=6010)
ev = pq.tick(s, {"printing": True, "job": {"status": "abgebrochen"}}, now=6100)
it3 = next(i for i in q["items"] if i["plate"] == 3)
check("abgebrochen → wartet wieder", ev["kind"] == "aborted" and it3["state"] == "wait" and it3["aborted"] is True, ev)
check("abgebrochen: Bett-Signal nicht an", s["bed_clear"] is False)
check("Text nach Abbruch", pq.summary(s)["text"] == "Platte 3 wartet")

# 10 min ohne Meldung: zählt trotzdem
pq.update(s, {"action": "started", "plate": 3}, now=7000)
check("vor 10 min nicht", pq.tick(s, FREE, now=7000 + 599) is None)
ev = pq.tick(s, FREE, now=7000 + 601)
check("nach 10 min ohne Meldung fertig", ev and ev["kind"] == "done" and it3["aborted"] is False)
check("alle gedruckt", pq.summary(s)["text"] == "alle Platten gedruckt" or pq.summary(s)["text"].startswith("Platte 3 fertig"), pq.summary(s))
check("Ereignisliste", [e["seq"] for e in s["events"]] == [1, 2, 3, 4])

# Überspringen / Nochmal / Start einer anderen, während eine noch als „druckt“ gilt
pq.update(s, {"action": "again", "plate": 2})
check("Nochmal → wartet", next(i for i in q["items"] if i["plate"] == 2)["state"] == "wait")
pq.update(s, {"action": "skip", "plate": 2})
check("Überspringen", next(i for i in q["items"] if i["plate"] == 2)["state"] == "skipped")
check("Überspringen nur wartende", raises(lambda: pq.update(s, {"action": "skip", "plate": 2}), "wartet nicht"))
pq.update(s, {"action": "again", "plate": 1})
pq.update(s, {"action": "again", "plate": 2})
pq.update(s, {"action": "started", "plate": 1}, now=8000)
pq.update(s, {"action": "started", "plate": 2}, now=8100)
check("ungesehene vorige Platte → wartet wieder", next(i for i in q["items"] if i["plate"] == 1)["state"] == "wait" and pq.current(q)["plate"] == 2)

# Beenden
pq.update(s, {"action": "end"})
check("beendet", s["queue"] is None and s["bed_clear"] is False and pq.summary(s)["text"] == "keine")
check("Ereignisnummer bleibt", s["seq"] == 4)

# Übernahme aus dem Browser mit Zuständen
s2 = pq.empty_state()
pq.update(s2, dict(CREATE, order=[{"plate": 1, "state": "done"}, {"plate": 2, "state": "printing"}, 3]), now=100)
check("Übernahme mit Zuständen", [i["state"] for i in s2["queue"]["items"]] == ["done", "printing", "wait"])
check("zwei laufende abgelehnt", raises(lambda: pq.update(pq.empty_state(), dict(CREATE, order=[{"plate": 1, "state": "printing"}, {"plate": 2, "state": "printing"}])), "Zustand"))

# Speichern / Laden, API-Funktionen
with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "sub", "queue.json")
    check("leer ohne Datei", pq.api_get(p)["queue"] is None)
    r = pq.api_post(dict(CREATE), p)
    check("api_post legt an und speichert", r["note"] == "angelegt" and r["queue"]["items"][0]["plate"] == 2 and os.path.exists(p))
    check("api_get liest", pq.load(p)["queue"]["name"] == "Teil.3mf" and pq.api_get(p)["remaining_s"] == 3600)
    open(p, "w").write("{kaputt")
    check("kaputte Datei → leer", pq.load(p)["queue"] is None)
    pq.api_post(dict(CREATE), p)

    # Beobachter mit nachgestelltem Drucker
    class FakeLan:
        AVAILABLE = True
        st = FREE

        def status(self, host):
            if host != "192.168.1.50":
                raise RuntimeError("falscher Drucker")
            return dict(self.st, raw={"geheim": 1})

    lan, host = FakeLan(), [None]
    w = pq.Watcher(lan, lambda: host[0], p)
    check("ohne Drucker nichts", w.step() is None and w.latest() is None)
    host[0] = "192.168.1.50"
    pq.api_post({"action": "started", "plate": 2}, p)
    events = []
    w.listeners.append(events.append)
    lan.st = PRINTING
    check("Beobachter: gesehen", w.step() == {"kind": "seen", "plate": 2} and pq.load(p)["queue"]["items"][0]["seen"] is True)
    check("Stand ohne Rohdaten", "raw" not in w.latest() and w.latest()["printing"] is True)
    lan.st = FREE
    ev = w.step()
    check("Beobachter: fertig gespeichert", ev["kind"] == "done" and pq.load(p)["bed_clear"] is True and len(events) == 2)
    v = pq.api_get(p, w.latest())
    check("Ansicht mit Drucker", v["printer"]["printing"] is False and v["event"]["plate"] == 2 and v["summary"]["bed_clear"] is True)

    # HTTP-API über tools/serve.py (eigener Port, eigene Datei)
    os.environ["QUEUE_FILE"] = os.path.join(d, "http.json")
    os.environ["SPOOL_FILE"] = os.path.join(d, "spools.json")
    import serve  # noqa: E402
    import http.server
    import functools
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(serve.Handler, directory=serve.ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]

    def call(method, body=None, ctype="application/json"):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        c.request(method, "/api/queue", body=json.dumps(body) if body is not None else None, headers={"Content-Type": ctype} if body is not None else {})
        r = c.getresponse()
        return r.status, json.loads(r.read())

    code, j = call("GET")
    check("GET api/queue", code == 200 and j["server"] is True and j["queue"] is None and j["remaining_s"] == 0, j)
    code, j = call("POST", dict(CREATE))
    check("POST create", code == 200 and j["note"] == "angelegt" and len(j["queue"]["items"]) == 3, j)
    code, j = call("POST", dict(CREATE), ctype="text/plain")
    check("nur JSON", code == 415)
    code, j = call("POST", {"action": "skip", "plate": 42})
    check("Fehler 409 mit Meldung", code == 409 and j["error"] == "Platte nicht in der Warteschlange", (code, j))
    code, j = call("POST", {"action": "started", "plate": 2})
    check("POST started", code == 200 and j["queue"]["items"][0]["state"] == "printing" and j["summary"]["text"] == "Platte 2 druckt")
    code, j = call("POST", {"action": "end"})
    check("POST end", code == 200 and j["queue"] is None)
    srv.shutdown()

print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
