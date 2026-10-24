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
{plan: {id, name, file, start_at, created, plate, wants:[{tool, type}], slots: {Werkzeug: ACE-Slot}, options,
        dry: {temp, minutes, start_at, sent}|null, state: wait|drying|heating|starting|started|failed|cancelled, note, done_at}|null, seq}
"""
import json
import os
import shutil
import threading
import time
import uuid

import anycubic_lan

STATES = ("wait", "drying", "heating", "starting", "started", "failed", "cancelled")
ACTIVE = ("wait", "drying", "heating")
BUSY = ACTIVE + ("starting",)      # „starting“: Upload läuft – nicht absagen, nicht entfernen, kein neuer Plan
GRACE_S = 300                      # so lange nach der Startzeit auf einen lesbaren Druckerstand warten
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


def _set_aside(path, what):
    """Kaputte Datei beiseitelegen statt beim nächsten Speichern stumm zu überschreiben (Stand von Hand rettbar)."""
    dest = path + ".corrupt-" + time.strftime("%Y%m%d-%H%M%S")
    try:
        os.replace(path, dest)
        print(what + ": Datei unlesbar, beiseitegelegt als " + dest + " – weiter mit leerem Stand", flush=True)
    except OSError as e:
        print(what + ": Datei unlesbar (" + str(e) + ") – weiter mit leerem Stand", flush=True)


def load(path=None):
    path = path or data_file()
    try:
        with open(path, encoding="utf-8") as f:
            st = json.load(f)
    except OSError:
        return {"plan": None, "seq": 0}
    except ValueError:
        _set_aside(path, "Geplanter Druck")
        return {"plan": None, "seq": 0}
    return st if isinstance(st, dict) else {"plan": None, "seq": 0}


def save(state, path=None):
    p = path or data_file()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())   # sonst nach Stromausfall evtl. leere Datei trotz os.replace
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
    if p and p["state"] in BUSY:
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
    # Werkzeug → ACE-Slot (beide 0-basiert, durchgehend über alle ACE) wie bei „jetzt drucken“; ohne: Werkzeug n aus Slot n
    smap = {}
    for k, v in (req.get("slots") or {}).items() if isinstance(req.get("slots"), dict) else ():
        if str(k).isdigit() and int(k) < 32 and isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 16:
            smap[str(int(k))] = v
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
                     "wants": wants, "slots": smap, "options": opts, "dry": dry, "preheat": heat, "state": "wait", "note": None, "done_at": None}
    state["seq"] = state.get("seq", 0) + 1
    return state["plan"]


def cancel(state, now=None):
    p = state.get("plan")
    if not p or p["state"] not in ACTIVE:
        return False
    p.update(state="cancelled", note="abgesagt", done_at=now or time.time())
    state["seq"] = state.get("seq", 0) + 1
    return True


UNREACHABLE = "Drucker nicht erreichbar"


def check_ready(st, wants, slots_map=None):
    """Vor dem Start: Grund, warum nicht gestartet werden darf, oder None. slots_map: {Werkzeug: ACE-Slot}."""
    if not st or not st.get("connected"):
        return UNREACHABLE
    if st.get("printing") or st.get("job"):
        return "Drucker druckt gerade"
    if st.get("state") not in ("free", None, ""):
        return "Drucker ist nicht frei (%s)" % st.get("state")
    # Werkzeug-Nummern sind durchgehend (ACE 2 = 4–7), st["ace"] zählt je Einheit ab 0 – also wie print_gcode umrechnen
    slots = anycubic_lan.all_slots(st.get("ace") or [])
    smap = {int(k): v for k, v in (slots_map or {}).items() if str(k).isdigit()}
    for w in wants:
        n = smap.get(w["tool"], w["tool"])
        s = next((x for x in slots if x.get("index") == n), None)
        have = str((s or {}).get("type") or "").upper()
        if not s or not s.get("present") or not have:
            return "Slot %d leer – geslict für %s" % (n + 1, w["type"])
        if not have.startswith(w["type"].upper()) and not w["type"].upper().startswith(have):
            return "Slot %d: %s eingelegt, geslict für %s" % (n + 1, have, w["type"])
    return None


def _heat_off(p, heat_fn):
    if p.get("preheat") and p["preheat"].get("sent") and heat_fn:
        try:
            heat_fn(False, 0)
        except Exception:   # Absage/Fehler gilt trotzdem
            pass


def tick(state, st, dry_fn, now=None, heat_fn=None):
    """Einmal: Trocknen und Vorwärmen anstoßen; zur Zeit und wenn alles passt state „starting“ setzen – den Start selbst
    macht der Aufrufer (Runner.step, ohne die Sperre), danach finish_start. dry_fn(on, temp, minutes); heat_fn(on, bed)."""
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
        if why == UNREACHABLE:
            # eine verpasste Abfrage (WLAN, Neuverbinden) darf den Plan nicht kippen – nächste Runde wieder versuchen
            if p.get("note") != "Warte auf den Drucker (Vorwärmen)":
                p["note"] = "Warte auf den Drucker (Vorwärmen)"
                changed = True
        elif why:
            p.update(state="failed", note="Nicht vorgewärmt: " + why, done_at=now)
            state["seq"] = state.get("seq", 0) + 1
            return True
        else:
            try:
                heat_fn(True, p["preheat"]["bed"])
                p["preheat"]["sent"] = True
                p["state"] = "heating"
                p["note"] = None
            except Exception as e:     # nächster Versuch beim nächsten Durchlauf
                p["note"] = "Vorwärmen nicht gestartet: " + (str(e) or type(e).__name__)
            changed = True
    if now >= p["start_at"]:
        why = check_ready(st, p.get("wants") or [], p.get("slots"))
        if why == UNREACHABLE and now < p["start_at"] + GRACE_S:
            # Stand gerade nicht lesbar (eine verpasste Abfrage): bis GRACE_S nach der Startzeit weiter versuchen
            if p.get("note") != "Warte auf den Drucker – Start, sobald er erreichbar ist":
                p["note"] = "Warte auf den Drucker – Start, sobald er erreichbar ist"
                changed = True
        elif why:
            p.update(state="failed", note="Nicht gestartet: " + why, done_at=now)
            _heat_off(p, heat_fn)
            changed = True
        else:
            p.update(state="starting", note=None)
            changed = True
    if changed:
        state["seq"] = state.get("seq", 0) + 1
    return changed


def finish_start(state, pid, err, heat_fn=None, now=None):
    """Ergebnis von start_fn eintragen (err: Ausnahme oder None) – nur, wenn der Plan noch derselbe ist."""
    now = now or time.time()
    p = state.get("plan")
    if not p or p.get("id") != pid or p["state"] != "starting":
        return False
    if err is None:
        p.update(state="started", note=None, done_at=now)
    else:
        p.update(state="failed", note="Nicht gestartet: " + (str(err) or type(err).__name__), done_at=now)
        _heat_off(p, heat_fn)
    state["seq"] = state.get("seq", 0) + 1
    return True


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
            if pl.get("state") == "starting":
                raise ScheduleError("Druck wird gerade gestartet – Absagen nicht mehr möglich")
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
            if p and p["state"] not in BUSY:     # „starting“: G-Code wird gerade hochgeladen
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
        self.starting = False
        self.thread = threading.Thread(target=self._run, daemon=True, name="schedule")

    def start(self):
        self.thread.start()
        return self

    def step(self, now=None):
        # Der Start (Upload bis UPLOAD_TIMEOUT_S) läuft ohne _lock – sonst hingen Seite und Home Assistant (api_get) so lange
        with _lock:
            state = load(self.path)
            p = state.get("plan")
            if p and p["state"] == "starting" and not self.starting:
                # Server während des Starts beendet: Ausgang unbekannt – nicht noch einmal starten
                p.update(state="failed", note="Start unterbrochen (Server neu gestartet) – bitte am Drucker prüfen", done_at=now or time.time())
                state["seq"] = state.get("seq", 0) + 1
                save(state, self.path)
                return True
            if not p or p["state"] not in ACTIVE:
                return False
            due = (now or time.time()) >= min(p["start_at"], (p.get("dry") or {}).get("start_at", p["start_at"]),
                                              (p.get("preheat") or {}).get("start_at", p["start_at"]))
            st = self.status_fn() if due else None
            if not tick(state, st, self.dry_fn, now, self.heat_fn):
                return False
            if p["state"] == "starting":
                self.starting = True
            save(state, self.path)
            if not self.starting:
                return True
            plan = dict(p)
        try:
            err = None
            try:
                self.start_fn(plan)
            except Exception as e:
                err = e
            with _lock:
                state = load(self.path)
                if finish_start(state, plan["id"], err, self.heat_fn, now):
                    save(state, self.path)
        finally:
            self.starting = False
        return True

    def _run(self):
        while not self.stopped:
            try:
                self.step()
            except Exception as e:   # der Plan darf den Server nie stören
                print("Geplanter Druck: " + (str(e) or type(e).__name__), flush=True)
            time.sleep(self.tick_s)
