"""Filamentverwaltung: Spulen erkennen und die Restmenge errechnen.

Die ACE meldet je Slot Typ, Farbe und die RFID-Artikelnummer (sku), aber keine Restmenge (consumables_percent
bleibt bei der Werksfirmware 2.7.2.7 immer 0, geprüft 2026-09-29). Deshalb:
  Restmenge = Füllgewicht der Spule − Verbrauch beim Drucken − Spülabfall bei Farbwechseln (± eigene Korrektur).
Verbrauch: Während eines Drucks meldet der Drucker die bisher verbrauchten Millimeter (project.supplies_usage).
Jeder Zuwachs zählt für die Spule im Slot, der gerade im Druckkopf steckt (loaded_slot) – so stimmt es auch bei
Mehrfarbdrucken und bei Drucken aus anderen Programmen. mm → g über Durchmesser 1,75 mm und die Dichte des Typs.
Farbwechsel (anderer loaded_slot während eines Drucks): Spülabfall der ACE für die neue Spule (wie js/purge.js).

Erkennung: gleicher Slot mit gleicher sku/Farbe/Typ = dieselbe Spule. Sonst eine Spule aus dem Regal mit gleicher
sku/Farbe/Typ (wieder eingelegt, die zuletzt gesehene) oder eine neue Spule (Füllgewicht 1000 g, änderbar).
Spulen ohne RFID (von Hand am Drucker eingestellt) haben keine sku – dann zählen Typ und Farbe.

Daten: JSON-Datei $SPOOL_FILE oder $DATA_DIR/spools.json (Standard ~/.druck-konfigurator/spools.json, im Container /data).
Der Server fragt den Drucker dafür dauerhaft ab (Tracker), sobald die Seite ihm die Adresse genannt hat.
"""
import json
import math
import os
import threading
import time
import uuid

DIAMETER_MM = 1.75
DENSITY = {"PLA": 1.24, "PETG": 1.27, "ABS": 1.04, "ASA": 1.07, "TPU": 1.21, "PA": 1.14, "PC": 1.20, "PVA": 1.23, "HIPS": 1.04}
DEFAULT_NET_G = 1000
FLUSH_DEFAULT = 1.5
HISTORY = 50
POLL_S = 5
_lock = threading.RLock()


def data_file():
    if os.environ.get("SPOOL_FILE"):
        return os.environ["SPOOL_FILE"]
    d = os.environ.get("DATA_DIR") or os.path.join(os.path.expanduser("~"), ".druck-konfigurator")
    return os.path.join(d, "spools.json")


def density(ftype):
    t = str(ftype or "").upper()
    return next((v for k, v in DENSITY.items() if t.startswith(k)), 1.24)


def mm_to_g(mm, ftype):
    return math.pi * (DIAMETER_MM / 2) ** 2 * mm / 1000 * density(ftype)


def purge_g(flush):
    return 0.13 + 0.635 * float(flush)      # Messung am Kobra S1, js/purge.js acePurgeGrams


def empty_state():
    return {"version": 1, "host": None, "flush": FLUSH_DEFAULT, "purge_g": None, "spools": [], "track": {}, "history": []}


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
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def remaining(sp):
    return round(max(0.0, sp["net_g"] - sp.get("used_g", 0) - sp.get("purge_g", 0) + sp.get("adjust_g", 0)), 1)


def view(state):
    """Für die Seite: Spulen mit Restmenge, Slot-Zuordnung, letzte Drucke."""
    spools = [dict(sp, remaining_g=remaining(sp)) for sp in state["spools"]]
    return {"spools": spools, "host": state.get("host"), "flush": state.get("flush"), "purge_g": state.get("purge_g"),
            "history": state.get("history", [])[-HISTORY:], "track": state.get("track") or {}, "file": data_file()}


def _same(sp, s):
    if sp["type"] != s["type"] or sp["colour"].upper() != s["colour"].upper():
        return False
    return (sp.get("sku") or "") == (s.get("sku") or "")


def new_spool(s, slot, now):
    return {"id": uuid.uuid4().hex[:12], "sku": s.get("sku") or "", "type": s["type"], "colour": s["colour"], "rfid": bool(s.get("rfid")),
            "name": "", "brand": "Anycubic" if s.get("rfid") else "", "net_g": DEFAULT_NET_G, "used_g": 0.0, "purge_g": 0.0, "adjust_g": 0.0,
            "slot": slot, "added": now, "last_seen": now, "notes": "", "archived": False}


def sync_slots(state, slots, now=None):
    """ACE-Slots [{index, type, colour, present, sku, rfid}] → Spulen zuordnen. Ergebnis: Liste von Ereignissen."""
    now = now or time.time()
    events = []
    spools = state["spools"]
    for s in slots:
        i = s.get("index")
        cur = next((sp for sp in spools if sp.get("slot") == i), None)
        if not s.get("present"):
            if cur:
                cur["slot"] = None
                events.append({"kind": "removed", "slot": i, "id": cur["id"]})
            continue
        if cur and _same(cur, s):
            cur["last_seen"] = now
            continue
        if cur:
            cur["slot"] = None
            events.append({"kind": "removed", "slot": i, "id": cur["id"]})
        shelf = [sp for sp in spools if sp.get("slot") is None and not sp.get("archived") and _same(sp, s) and remaining(sp) > 0]
        if shelf:
            sp = max(shelf, key=lambda x: x.get("last_seen") or 0)
            sp["slot"], sp["last_seen"] = i, now
            events.append({"kind": "reinserted", "slot": i, "id": sp["id"]})
        else:
            sp = new_spool(s, i, now)
            spools.append(sp)
            events.append({"kind": "new", "slot": i, "id": sp["id"]})
    return events


def track(state, project, loaded_slot, now=None):
    """Verbrauch mitzählen. project = info.project des Druckers (None = kein Druck), loaded_slot aus der ACE."""
    now = now or time.time()
    t = state.get("track") or {}
    changed = False
    if project:
        name = str(project.get("filename") or project.get("name") or "?")
        mm = project.get("supplies_usage")
        mm = float(mm) if isinstance(mm, (int, float)) else None
        if t.get("job") != name:
            # Neuer Druck. Sieht der Server ihn erst mittendrin (z. B. nach einem Neustart), zählt er ab jetzt.
            early = (project.get("progress") or 0) <= 2
            t = {"job": name, "start": now, "mm": 0.0 if early or mm is None else mm, "slot": loaded_slot, "used": {}, "changes": 0}
            changed = True
        if mm is not None and mm < t["mm"] - 1:
            t["mm"] = mm                                      # Zähler neu gestartet
        slot_sp = lambda i: next((sp for sp in state["spools"] if sp.get("slot") == i), None)
        if isinstance(loaded_slot, int) and loaded_slot >= 0:
            if isinstance(t.get("slot"), int) and t["slot"] >= 0 and loaded_slot != t["slot"]:
                sp = slot_sp(loaded_slot)
                t["changes"] = t.get("changes", 0) + 1
                if sp:
                    g = state.get("purge_g") or purge_g(state.get("flush") or FLUSH_DEFAULT)
                    sp["purge_g"] = round(sp.get("purge_g", 0) + g, 3)
                    t["used"][sp["id"]] = round(t["used"].get(sp["id"], 0) + g, 3)
                changed = True
            t["slot"] = loaded_slot
            if mm is not None and mm > t["mm"]:
                sp = slot_sp(loaded_slot)
                if sp:
                    g = mm_to_g(mm - t["mm"], sp["type"])
                    sp["used_g"] = round(sp.get("used_g", 0) + g, 3)
                    t["used"][sp["id"]] = round(t["used"].get(sp["id"], 0) + g, 3)
                t["mm"] = mm
                changed = True
        state["track"] = t
    elif t.get("job"):
        # Druck zu Ende: in die Liste der letzten Drucke
        state.setdefault("history", []).append({"job": t["job"], "start": t.get("start"), "end": now, "used": t.get("used", {}), "changes": t.get("changes", 0)})
        state["history"] = state["history"][-HISTORY:]
        state["track"] = {}
        changed = True
    return changed


EDITABLE = {"name": str, "brand": str, "notes": str, "net_g": float, "archived": bool, "price_per_kg": float}


def update(state, req):
    """Änderung von der Seite: {action: update|add|delete|config, …}. Gibt eine Meldung zurück oder wirft ValueError."""
    a = req.get("action")
    if a == "config":
        if "host" in req:
            state["host"] = req["host"] or None
        if req.get("flush") is not None:
            f = float(req["flush"])
            if not 0.1 <= f <= 3:
                raise ValueError("Spülmenge 0,1–3")
            state["flush"] = f
        if "purge_g" in req:
            state["purge_g"] = float(req["purge_g"]) if req["purge_g"] else None
        return "ok"
    if a == "add":
        s = {"type": str(req.get("type") or "PLA").upper(), "colour": str(req.get("colour") or "#FFFFFF"), "sku": "", "rfid": False}
        sp = new_spool(s, None, time.time())
        state["spools"].append(sp)
        req = dict(req, id=sp["id"])
        a = "update"
    sp = next((x for x in state["spools"] if x["id"] == req.get("id")), None)
    if not sp:
        raise ValueError("Spule nicht gefunden")
    if a == "delete":
        if sp.get("slot") is not None:
            raise ValueError("Spule steckt noch in der ACE – erst herausnehmen")
        state["spools"].remove(sp)
        return "gelöscht"
    if a != "update":
        raise ValueError("unbekannte Aktion")
    for k, typ in EDITABLE.items():
        if k in req:
            v = typ(req[k]) if req[k] is not None else None
            if k in ("net_g", "price_per_kg") and v is not None and not 0 <= v <= 20000:
                raise ValueError(k + " außerhalb 0–20000")
            sp[k] = v
    if req.get("type"):
        sp["type"] = str(req["type"]).upper()
    if req.get("colour") and not sp.get("rfid"):
        sp["colour"] = str(req["colour"])
    if req.get("remaining_g") is not None:
        # gewogen: Korrektur so setzen, dass die Restmenge stimmt
        r = float(req["remaining_g"])
        if not 0 <= r <= 20000:
            raise ValueError("Restmenge außerhalb 0–20000")
        sp["adjust_g"] = round(r - (sp["net_g"] - sp.get("used_g", 0) - sp.get("purge_g", 0)), 1)
    return "gespeichert"


class Tracker:
    """Hält die Verbindung zum Drucker (state.host) und zählt mit. Läuft als Hintergrund-Thread im Server."""

    def __init__(self, lan, path=None):
        self.lan, self.path, self.last_error, self.saved = lan, path, None, 0
        self.thread = threading.Thread(target=self._run, daemon=True, name="spools")

    def start(self):
        self.thread.start()
        return self

    def step(self):
        with _lock:
            state = load(self.path)
            host = state.get("host")
            if not host or not self.lan.AVAILABLE:
                return False
        link = self.lan.get_link(host)
        if not link.reports:
            return False
        boxes = self.lan.ace_boxes({"multiColorBox": [link.reports["multiColorBox"]]} if "multiColorBox" in link.reports else {})
        info = link.data("info")
        with _lock:
            state = load(self.path)
            changed = False
            if boxes:
                changed = bool(sync_slots(state, boxes[0]["slots"])) or changed
            loaded = boxes[0]["loaded_slot"] if boxes else -1
            changed = track(state, info.get("project") if info else None, loaded) or changed
            if changed or time.time() - self.saved > 60:     # „zuletzt gesehen“ höchstens minütlich schreiben
                save(state, self.path)
                self.saved = time.time()
        return changed

    def _run(self):
        while True:
            try:
                self.step()
                self.last_error = None
            except Exception as e:  # der Tracker darf den Server nie stören
                if str(e) != str(self.last_error):
                    print("Filamentverwaltung: " + str(e), flush=True)
                self.last_error = e
            time.sleep(POLL_S if not self.last_error else 30)


def api_get(path=None):
    with _lock:
        return view(load(path))


def api_post(req, path=None):
    with _lock:
        state = load(path)
        msg = update(state, req)
        save(state, path)
        return dict(view(state), note=msg)
