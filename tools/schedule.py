"""Geplanter Druck: eine Platte zu einer festen Zeit starten, auf Wunsch vorher das Filament in der ACE trocknen.

Ausnahme vom Grundsatz „das Tool startet nie von selbst“ – nur auf ausdrücklichen Wunsch: Beim Planen bestätigt der
Nutzer, dass das Bett frei ist und die richtige Druckplatte liegt. Kurz vor dem Start prüft der Server noch einmal:
Drucker verbunden und frei, kein laufender Druck, in jedem benutzten Slot das Filament, für das geslict wurde. Fehlt
etwas, startet er nicht (Zustand „failed“ mit Grund – Seite und Home Assistant zeigen ihn).

Trocknen: so geplant, dass es zum Druckstart endet (Beginn = Start − Dauer); die ACE trocknet als Ganzes.
Vorwärmen (z. B. ABS/ASA: Bett ~10 min heiß, Haube zu): Bett auf Temperatur ab Start − Dauer – nur, wenn der Drucker
dann frei ist. Auch für „jetzt drucken“: Start = jetzt + Dauer. Startet der Druck nicht oder wird abgesagt, schaltet
der Server die Bettheizung wieder aus (heat_fn(False)).
Der G-Code wird beim Planen in den Datenordner kopiert (Slice-Aufträge im Zwischenspeicher werden aufgeräumt).

Stand: $DATA_DIR/schedule.json (bzw. $SCHEDULE_FILE), Dateien in $DATA_DIR/scheduled/<id>/.
{plan: {id, name, file, start_at, created, plate, wants:[{tool, type}], options, dry: {temp, minutes, start_at, sent}|null,
        state: wait|drying|started|failed|cancelled, note, done_at}|null, seq}
"""
import json
import os
import shutil
import threading
import time
import uuid

STATES = ("wait", "drying", "heating", "started", "failed", "cancelled")
ACTIVE = ("wait", "drying", "heating")
MAX_AHEAD_S = 14 * 24 * 3600        # höchstens zwei Wochen im Voraus
MIN_DRY_MIN, MAX_DRY_MIN = 30, 24 * 60
MIN_DRY_C, MAX_DRY_C = 35, 70
MIN_HEAT_C, MAX_HEAT_C = 40, 110          # Vorwärmen: Bett (Kobra S1 bis 110 °C)
MIN_HEAT_MIN, MAX_HEAT_MIN = 1, 60
TICK_S = 15
_lock = threading.Lock()


class ScheduleError(Exception):
    pass


def data_file():
    if os.environ.get("SCHEDULE_FILE"):
        return os.environ["SCHEDULE_FILE"]
    d = os.environ.get("DATA_DIR") or os.path.join(os.path.expanduser("~"), ".druck-konfigurator")
    return os.path.join(d, "schedule.json")


def files_dir(path=None):
    return os.path.join(os.path.dirname(path or data_file()), "scheduled")


def load(path=None):
    try:
        with open(path or data_file(), encoding="utf-8") as f:
            st = json.load(f)
        return st if isinstance(st, dict) else {"plan": None, "seq": 0}
    except (OSError, ValueError):
        return {"plan": None, "seq": 0}


def save(state, path=None):
    p = path or data_file()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, p)


def _num(v, lo, hi, name):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        raise ScheduleError("Ungültiger Wert: %s" % name)
    return v


def view(state, now=None):
    now = now or time.time()
    p = state.get("plan")
    if not p:
        return {"plan": None, "seq": state.get("seq", 0)}
    out = {k: v for k, v in p.items() if k != "file"}
    if p["state"] in ACTIVE:
        out["in_s"] = max(0, round(p["start_at"] - now))
        if p.get("dry") and not p["dry"].get("sent"):
            out["dry_in_s"] = max(0, round(p["dry"]["start_at"] - now))
        if p.get("preheat") and not p["preheat"].get("sent"):
            out["heat_in_s"] = max(0, round(p["preheat"]["start_at"] - now))
    return {"plan": out, "seq": state.get("seq", 0)}


def create(state, req, gcode_src, preview_src=None, path=None, now=None):
    """req: {name, start_at (Unix-Sekunden), plate, wants:[{tool,type}], options, bed_clear: True, dry: {temp, minutes}|None}."""
    now = now or time.time()
    p = state.get("plan")
    if p and p["state"] in ACTIVE:
        raise ScheduleError("Es ist schon ein Druck geplant – erst absagen")
    if req.get("bed_clear") is not True:
        raise ScheduleError("Bitte bestätigen: Bett frei, richtige Druckplatte liegt")
    start = _num(req.get("start_at"), now + 60, now + MAX_AHEAD_S, "Startzeit (mindestens 1 min, höchstens 14 Tage voraus)")
    dry = None
    if req.get("dry"):
        d = req["dry"]
        temp = int(_num(d.get("temp"), MIN_DRY_C, MAX_DRY_C, "Trockentemperatur"))
        minutes = int(_num(d.get("minutes"), MIN_DRY_MIN, MAX_DRY_MIN, "Trockendauer"))
        dry = {"temp": temp, "minutes": minutes, "start_at": start - minutes * 60, "sent": False}
        if dry["start_at"] < now - 60:
            raise ScheduleError("Zum Trocknen ist bis zum Start zu wenig Zeit – Start später legen oder kürzer trocknen")
    heat = None
    if req.get("preheat"):
        h = req["preheat"]
        bed = int(_num(h.get("bed"), MIN_HEAT_C, MAX_HEAT_C, "Vorwärmen: Betttemperatur"))
        minutes = int(_num(h.get("minutes"), MIN_HEAT_MIN, MAX_HEAT_MIN, "Vorwärmen: Dauer"))
        heat = {"bed": bed, "minutes": minutes, "start_at": start - minutes * 60, "sent": False}
        if heat["start_at"] < now - 60:
            raise ScheduleError("Zum Vorwärmen ist bis zum Start zu wenig Zeit")
    wants = []
    for w in req.get("wants") or []:
        if isinstance(w, dict) and isinstance(w.get("tool"), int) and 0 <= w["tool"] < 32 and isinstance(w.get("type"), str) and 0 < len(w["type"]) <= 16:
            wants.append({"tool": w["tool"], "type": w["type"]})
    opts = {k: 1 if (req.get("options") or {}).get(k) else 0 for k in ("auto_leveling", "flow_calibration", "timelapse")}
    pid = uuid.uuid4().hex[:12]
    d = os.path.join(files_dir(path), pid)
    if os.path.isdir(files_dir(path)):
        for old in os.listdir(files_dir(path)):          # nur ein Plan – alte Dateien weg
            shutil.rmtree(os.path.join(files_dir(path), old), ignore_errors=True)
    os.makedirs(d, exist_ok=True)
    shutil.copyfile(gcode_src, os.path.join(d, "plate.gcode"))
    if preview_src and os.path.isfile(preview_src):
        shutil.copyfile(preview_src, os.path.join(d, "plate.preview"))
    name = "".join(c if c.isalnum() or c in "._-" else "_" for c in str(req.get("name") or "druck"))[:80]
    state["plan"] = {"id": pid, "name": name, "file": d, "plate": int(req.get("plate") or 1), "start_at": start, "created": now,
                     "wants": wants, "options": opts, "dry": dry, "preheat": heat, "state": "wait", "note": None, "done_at": None}
    state["seq"] = state.get("seq", 0) + 1
    return state["plan"]


def cancel(state, now=None):
    p = state.get("plan")
    if not p or p["state"] not in ACTIVE:
        return False
    p.update(state="cancelled", note="abgesagt", done_at=now or time.time())
    state["seq"] = state.get("seq", 0) + 1
    return True


def check_ready(st, wants):
    """Vor dem Start: Grund, warum nicht gestartet werden darf, oder None."""
    if not st or not st.get("connected"):
        return "Drucker nicht erreichbar"
    if st.get("printing") or st.get("job"):
        return "Drucker druckt gerade"
    if st.get("state") not in ("free", None, ""):
        return "Drucker ist nicht frei (%s)" % st.get("state")
    slots = [s for box in (st.get("ace") or []) for s in (box.get("slots") or [])]
    for w in wants:
        s = next((x for x in slots if x.get("index") == w["tool"]), None)
        have = str((s or {}).get("type") or "").upper()
        if not s or not s.get("present") or not have:
            return "Slot %d leer – geslict für %s" % (w["tool"] + 1, w["type"])
        if not have.startswith(w["type"].upper()) and not w["type"].upper().startswith(have):
            return "Slot %d: %s eingelegt, geslict für %s" % (w["tool"] + 1, have, w["type"])
    return None


def _heat_off(p, heat_fn):
    if p.get("preheat") and p["preheat"].get("sent") and heat_fn:
        try:
            heat_fn(False, 0)
        except Exception:   # Absage/Fehler gilt trotzdem
            pass


def tick(state, st, start_fn, dry_fn, now=None, heat_fn=None):
    """Einmal: Trocknen und Vorwärmen anstoßen, zur Zeit starten. start_fn(plan) → None oder wirft; dry_fn(on, temp,
    minutes); heat_fn(on, bed)."""
    now = now or time.time()
    p = state.get("plan")
    if not p or p["state"] not in ACTIVE:
        return False
    changed = False
    if p.get("dry") and not p["dry"].get("sent") and now >= p["dry"]["start_at"]:
        try:
            dry_fn(True, p["dry"]["temp"], p["dry"]["minutes"])
            p["dry"]["sent"] = True
            p["state"] = "drying"
            p["note"] = None
        except Exception as e:     # nächster Versuch beim nächsten Durchlauf
            p["note"] = "Trocknen nicht gestartet: " + (str(e) or type(e).__name__)
        changed = True
    if p.get("preheat") and not p["preheat"].get("sent") and now >= p["preheat"]["start_at"] and now < p["start_at"]:
        why = check_ready(st, [])           # nur heizen, wenn der Drucker frei ist (kein anderer Druck)
        if why:
            p.update(state="failed", note="Nicht vorgewärmt: " + why, done_at=now)
            state["seq"] = state.get("seq", 0) + 1
            return True
        try:
            heat_fn(True, p["preheat"]["bed"])
            p["preheat"]["sent"] = True
            p["state"] = "heating"
        except Exception as e:     # nächster Versuch beim nächsten Durchlauf
            p["note"] = "Vorwärmen nicht gestartet: " + (str(e) or type(e).__name__)
        changed = True
    if now >= p["start_at"]:
        why = check_ready(st, p.get("wants") or [])
        if why:
            p.update(state="failed", note="Nicht gestartet: " + why, done_at=now)
            _heat_off(p, heat_fn)
        else:
            try:
                start_fn(p)
                p.update(state="started", note=None, done_at=now)
            except Exception as e:
                p.update(state="failed", note="Nicht gestartet: " + (str(e) or type(e).__name__), done_at=now)
                _heat_off(p, heat_fn)
        changed = True
    if changed:
        state["seq"] = state.get("seq", 0) + 1
    return changed


def api_get(path=None):
    with _lock:
        return view(load(path))


def api_post(req, gcode_for=None, path=None, now=None, on_cancel=None):
    """req.action: create (dazu job, plate – gcode_for(job, plate) → (gcode, preview)) | cancel | dismiss.
    on_cancel(plan): beim Absagen, wenn schon getrocknet wird (Trocknen beenden)."""
    with _lock:
        state = load(path)
        act = req.get("action")
        if act == "create":
            gcode, preview = gcode_for(str(req.get("job", "")), str(req.get("plate", ""))) if gcode_for else (None, None)
            if not gcode:
                raise ScheduleError("Slice-Auftrag nicht (mehr) vorhanden – bitte neu berechnen")
            create(state, req, gcode, preview, path, now)
        elif act == "cancel":
            pl = state.get("plan") or {}
            drying = bool((pl.get("dry") and pl["dry"].get("sent")) or (pl.get("preheat") and pl["preheat"].get("sent")))
            if not cancel(state, now):
                raise ScheduleError("Kein geplanter Druck")
            if drying and on_cancel:
                try:
                    on_cancel(state["plan"])
                except Exception as e:   # Absagen gilt trotzdem
                    state["plan"]["note"] = "abgesagt – Trocknen bitte am Drucker beenden (" + (str(e) or type(e).__name__) + ")"
        elif act == "dismiss":
            p = state.get("plan")
            if p and p["state"] not in ACTIVE:
                shutil.rmtree(p.get("file") or "", ignore_errors=True)
                state["plan"] = None
                state["seq"] = state.get("seq", 0) + 1
        else:
            raise ScheduleError("Unbekannte Aktion")
        save(state, path)
        return view(state, now)


class Runner:
    """Hintergrund-Thread: alle TICK_S Sekunden den Plan weiterschalten. status_fn() = Druckerstand (oder None)."""

    def __init__(self, status_fn, start_fn, dry_fn, path=None, tick_s=TICK_S, heat_fn=None):
        self.status_fn, self.start_fn, self.dry_fn, self.path, self.tick_s = status_fn, start_fn, dry_fn, path, tick_s
        self.heat_fn = heat_fn
        self.stopped = False
        self.thread = threading.Thread(target=self._run, daemon=True, name="schedule")

    def start(self):
        self.thread.start()
        return self

    def step(self, now=None):
        with _lock:
            state = load(self.path)
            p = state.get("plan")
            if not p or p["state"] not in ACTIVE:
                return False
            due = (now or time.time()) >= min(p["start_at"], (p.get("dry") or {}).get("start_at", p["start_at"]),
                                              (p.get("preheat") or {}).get("start_at", p["start_at"]))
            st = self.status_fn() if due else None
            if tick(state, st, self.start_fn, self.dry_fn, now, self.heat_fn):
                save(state, self.path)
                return True
            return False

    def _run(self):
        while not self.stopped:
            try:
                self.step()
            except Exception as e:   # der Plan darf den Server nie stören
                print("Geplanter Druck: " + (str(e) or type(e).__name__), flush=True)
            time.sleep(self.tick_s)
