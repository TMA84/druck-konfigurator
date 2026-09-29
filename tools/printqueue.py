"""Druckwarteschlange auf dem Server: alle Platten eines Slice-Stands nacheinander drucken.

Früher lag die Warteschlange nur im Browser – ohne offene Seite merkte niemand, dass eine Platte fertig war. Jetzt hält
der Server sie in $DATA_DIR/queue.json (bzw. $QUEUE_FILE) und schaut alle 5 s selbst beim Drucker nach (Watcher).
Die Seite (js/queue-ui.js) zeigt sie an; Home Assistant bekommt den Stand über MQTT (tools/ha_mqtt.py).

Regeln wie js/plates.js queueTick: Eine Platte gilt erst als fertig, wenn der Drucker sie einmal als laufend gemeldet
hat (direkt nach dem Start ist er oft noch „frei“; nach 10 min ohne Meldung zählt sie trotzdem) und danach nicht mehr
druckt oder „fertig“ meldet. „abgebrochen“ stellt sie wieder auf „wartet“ (aborted). Gestartet wird nie automatisch:
die nächste Platte startet die Seite nach Klick (api/anycubic/print) und meldet das mit {action: started}.

Stand: {version, seq, queue: {name, created, slice:{job, plates}, materials, items:[{plate, time_s, total_g, state,
seen, started, aborted, finished}], lastDone} | None, bed_clear, event: {seq, kind: done|aborted, plate, time, next,
name} | None, events: [...]}. Zeiten in Sekunden (Unix).
"""
import json
import os
import re
import threading
import time

POLL_S = 5
UNSEEN_S = 10 * 60
MAX_PLATES = 200
EVENTS = 20
STATES = ("wait", "printing", "done", "skipped")
_lock = threading.RLock()


class QueueError(ValueError):
    """Ungültige Aktion – die Meldung geht so (deutsch) an die Seite und wird dort übersetzt."""


def data_file():
    if os.environ.get("QUEUE_FILE"):
        return os.environ["QUEUE_FILE"]
    d = os.environ.get("DATA_DIR") or os.path.join(os.path.expanduser("~"), ".druck-konfigurator")
    return os.path.join(d, "queue.json")


def empty_state():
    return {"version": 1, "seq": 0, "queue": None, "bed_clear": False, "event": None, "events": []}


def load(path=None):
    try:
        with open(path or data_file()) as f:
            s = json.load(f)
        base = empty_state()
        base.update(s if isinstance(s, dict) else {})
        return base
    except (OSError, ValueError):
        return empty_state()


def save(state, path=None):
    path = path or data_file()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


# ---------- Logik (rein, ohne Datei und Drucker) ----------
def current(q):
    return next((i for i in q["items"] if i["state"] == "printing"), None) if q else None


def next_item(q):
    return next((i for i in q["items"] if i["state"] == "wait"), None) if q else None


def remaining_s(q, st):
    """Laufender Druck laut Drucker (sonst Orca), dazu alle wartenden Platten laut Orca – wie queueRemaining."""
    if not q:
        return 0
    cur = current(q)
    job = (st or {}).get("job") or {}
    now = (job["remaining_min"] * 60 if isinstance(job.get("remaining_min"), (int, float)) else cur.get("time_s") or 0) if cur else 0
    return int(now + sum(i.get("time_s") or 0 for i in q["items"] if i["state"] == "wait"))


def tick(state, st, now=None):
    """Neuer Stand des Druckers (anycubic_lan.status). Gibt das Ereignis zurück, wenn eine Platte fertig/abgebrochen ist."""
    now = now or time.time()
    q = state.get("queue")
    cur = current(q)
    if not cur or not st:
        return None
    status = (st.get("job") or {}).get("status")
    if st.get("printing") and status not in ("fertig", "abgebrochen"):
        if not cur.get("seen"):
            cur["seen"] = True
            return {"kind": "seen", "plate": cur["plate"]}
        return None
    # Erst wenn der Drucker den Auftrag einmal gemeldet hat – direkt nach dem Start ist er oft noch „frei“
    if not cur.get("seen") and not now - (cur.get("started") or 0) > UNSEEN_S:
        return None
    aborted = status == "abgebrochen"
    cur.update(state="wait" if aborted else "done", aborted=aborted, finished=now)
    q["lastDone"] = cur["plate"]
    nxt = next_item(q)
    state["seq"] = int(state.get("seq") or 0) + 1
    ev = {"seq": state["seq"], "kind": "aborted" if aborted else "done", "plate": cur["plate"], "time": now,
          "next": nxt["plate"] if nxt else None, "name": q.get("name")}
    state["event"] = ev
    state["events"] = (state.get("events") or [])[-(EVENTS - 1):] + [ev]
    if not aborted:
        state["bed_clear"] = True
    return ev


def _num(v, name, lo=0, hi=1e9):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        raise QueueError("Ungültiger Wert: " + name)
    return v


def _plate_no(v):
    if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 999:
        raise QueueError("Ungültige Plattennummer")
    return v


def _text(v, n=200):
    return str(v or "")[:n]


def _create(req, now):
    job = str(req.get("job") or "")
    if not re.fullmatch(r"[0-9a-f]{16}", job):
        raise QueueError("Slice-Auftrag fehlt – bitte neu berechnen")
    plates = req.get("plates")
    if not isinstance(plates, list) or not 1 <= len(plates) <= MAX_PLATES:
        raise QueueError("Platten fehlen")
    clean = []
    for p in plates:
        if not isinstance(p, dict):
            raise QueueError("Platten fehlen")
        grams = p.get("grams") or []
        if not isinstance(grams, list) or len(grams) > 64:
            raise QueueError("Ungültiger Wert: grams")
        clean.append({"plate": _plate_no(p.get("plate")), "grams": [_num(g or 0, "grams") for g in grams],
                      "total_g": _num(p.get("total_g") or 0, "total_g"), "time_s": _num(p.get("time_s") or 0, "time_s"),
                      "changes": _num(p.get("changes") or 0, "changes")})
    by_no = {p["plate"]: p for p in clean}
    if len(by_no) != len(clean):
        raise QueueError("Platte doppelt")
    mats = req.get("materials") or {}
    if not isinstance(mats, dict) or len(mats) > 64:
        raise QueueError("Ungültiger Wert: materials")
    materials = {str(k)[:4]: ({"kind": _text(m.get("kind"), 40), "name": _text(m.get("name"), 80)} if isinstance(m, dict) else None)
                 for k, m in mats.items()}
    order = req.get("order")
    if order is None:
        order = [p["plate"] for p in clean]
    if not isinstance(order, list) or not order:
        raise QueueError("Reihenfolge fehlt")
    items, seen = [], set()
    for o in order:
        # Zahl oder {plate, state} (Übernahme einer Warteschlange aus dem Browser)
        n, stt = (o.get("plate"), o.get("state") or "wait") if isinstance(o, dict) else (o, "wait")
        n = _plate_no(n)
        if n not in by_no or n in seen:
            raise QueueError("Platte %d nicht im Slice-Stand" % n)
        if stt not in STATES:
            raise QueueError("Ungültiger Zustand")
        seen.add(n)
        it = {"plate": n, "time_s": by_no[n]["time_s"], "total_g": by_no[n]["total_g"], "state": stt}
        if stt == "printing":
            it.update(started=now, seen=False, aborted=False)
        items.append(it)
    if sum(1 for i in items if i["state"] == "printing") > 1:
        raise QueueError("Ungültiger Zustand")
    return {"name": _text(req.get("name") or "Druck", 120), "created": now, "materials": materials,
            "slice": {"job": job, "plates": clean}, "items": items, "lastDone": None}


def update(state, req, now=None):
    """Aktion von der Seite: {action: create|started|skip|again|end, …}. Gibt eine Meldung zurück oder wirft QueueError."""
    now = now or time.time()
    if not isinstance(req, dict):
        raise QueueError("JSON erwartet")
    a = req.get("action")
    q = state.get("queue")
    if a == "create":
        if current(q):
            raise QueueError("Es läuft noch eine Platte der bisherigen Warteschlange – erst beenden")
        state["queue"] = _create(req, now)
        state["bed_clear"] = False
        return "angelegt"
    if a == "end":
        state["queue"] = None
        state["bed_clear"] = False
        return "beendet"
    if a not in ("started", "skip", "again"):
        raise QueueError("unbekannte Aktion")
    if not q:
        raise QueueError("Keine Warteschlange")
    plate = _plate_no(req.get("plate"))
    it = next((i for i in q["items"] if i["plate"] == plate), None)
    if not it:
        raise QueueError("Platte nicht in der Warteschlange")
    if a == "started":
        other = current(q)
        if other and other is not it:
            # Der Drucker war beim Start frei – die vorige Platte ist also durch (oder lief nie)
            other.update(state="done" if other.get("seen") else "wait", finished=now)
        it.update(state="printing", started=now, seen=False, aborted=False)
        it.pop("finished", None)
        q["lastDone"] = None
        state["bed_clear"] = False
        return "gestartet"
    if it["state"] == "printing":
        raise QueueError("Platte druckt gerade")
    if a == "skip":
        if it["state"] != "wait":
            raise QueueError("Platte wartet nicht")
        it["state"] = "skipped"
        return "übersprungen"
    it.update(state="wait", aborted=False)
    it.pop("finished", None)
    return "wartet wieder"


def summary(state, st=None):
    """Kurzfassung für Home Assistant: Text, Restzeit, Platten fertig/gesamt."""
    q = state.get("queue")
    if not q:
        return {"active": False, "text": "keine", "remaining_s": 0, "done": 0, "total": 0, "current": None, "next": None,
                "bed_clear": False}
    cur, nxt = current(q), next_item(q)
    done = sum(1 for i in q["items"] if i["state"] == "done")
    total = sum(1 for i in q["items"] if i["state"] != "skipped")
    if cur:
        text = "Platte %d druckt" % cur["plate"]
    elif state.get("bed_clear") and q.get("lastDone") is not None:
        text = "Platte %d fertig – Bett abräumen" % q["lastDone"] + (", danach Platte %d" % nxt["plate"] if nxt else "")
    elif nxt:
        text = "Platte %d wartet" % nxt["plate"]
    else:
        text = "alle Platten gedruckt"
    return {"active": True, "text": text, "remaining_s": remaining_s(q, st), "done": done, "total": total,
            "current": cur["plate"] if cur else None, "next": nxt["plate"] if nxt else None, "bed_clear": bool(state.get("bed_clear"))}


def printer_view(st):
    """Das Nötigste vom Druckerstand für die Seite (Anzeige der Warteschlange ohne eigene Abfrage)."""
    if not st:
        return None
    return {k: st.get(k) for k in ("model", "state", "printing", "job", "ace", "connected", "time")}


def view(state, st=None):
    return {"queue": state.get("queue"), "seq": state.get("seq") or 0, "event": state.get("event"), "events": state.get("events") or [],
            "bed_clear": bool(state.get("bed_clear")), "remaining_s": remaining_s(state.get("queue"), st),
            "summary": summary(state, st), "printer": printer_view(st), "server": True}


# ---------- Beobachter: fragt den Drucker ab (gemeinsam für Warteschlange und Home Assistant) ----------
class Watcher:
    """Hintergrund-Thread: alle 5 s Stand des Druckers (anycubic_lan.status) holen, Warteschlange weiterschalten.
    host_fn() liefert die Adresse (Filamentverwaltung bzw. KONFIGURATOR_PRINTER) oder None. latest() für andere Teile."""

    def __init__(self, lan, host_fn, path=None):
        self.lan, self.host_fn, self.path = lan, host_fn, path
        self.status, self.status_time, self.last_error = None, 0, None
        self.listeners = []
        self.thread = threading.Thread(target=self._run, daemon=True, name="printqueue")

    def start(self):
        self.thread.start()
        return self

    def latest(self, max_age=60):
        return self.status if self.status and time.time() - self.status_time < max_age else None

    def step(self):
        host = self.host_fn()
        if not host or not getattr(self.lan, "AVAILABLE", True):
            self.status = None
            return None
        try:
            st = self.lan.status(host)
        except Exception as e:   # Drucker aus / nicht erreichbar: später wieder
            self.status = None
            raise e
        st = dict(st, time=time.time())
        st.pop("raw", None)
        self.status, self.status_time = st, time.time()
        with _lock:
            state = load(self.path)
            ev = tick(state, st)
            if ev:
                save(state, self.path)
        if ev and ev["kind"] != "seen":
            print("Warteschlange: Platte %s %s" % (ev["plate"], "fertig – Bett abräumen" if ev["kind"] == "done" else "abgebrochen"), flush=True)
        for fn in self.listeners:
            try:
                fn(ev)
            except Exception:
                pass
        return ev

    def _run(self):
        while True:
            try:
                self.step()
                self.last_error = None
            except Exception as e:  # der Beobachter darf den Server nie stören
                if str(e) != str(self.last_error):
                    print("Warteschlange: " + str(e), flush=True)
                self.last_error = e
            time.sleep(POLL_S if not self.last_error else 15)


def api_get(path=None, st=None):
    with _lock:
        return view(load(path), st)


def api_post(req, path=None, st=None):
    with _lock:
        state = load(path)
        msg = update(state, req)
        save(state, path)
        return dict(view(state, st), note=msg)
