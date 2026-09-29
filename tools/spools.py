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
Neu erkannte Spulen tragen needs_check: true, bis der Nutzer das Füllgewicht bestätigt oder ändert (die Seite fragt nach).
Warnschwelle low_g (Standard 100 g): darunter zeigt die Seite die Spule rot und warnt vor dem Drucken.

Export/Import (zwischen zwei Servern, z. B. Mac und Home-Assistant-Add-on): GET /api/spools/export liefert den ganzen
Stand (export_state), POST {action: import, data, mode: merge|replace} spielt ihn ein (import_state).
  replace: alles aus der Datei übernehmen – außer host und dem laufenden Zähler track dieses Servers.
  merge:   Spulen zuordnen – zuerst über die id, sonst über gleiche sku/Typ/Farbe (bevorzugt im selben Slot, sonst eine
           Spule im Regal, jede höchstens einmal). Bei einem Paar gewinnt der Eintrag mit dem späteren last_seen (id und
           Slot bleiben die dieses Servers, der die ACE gerade sieht). Unbekannte Spulen kommen ins Regal (slot None).
           Letzte Drucke werden vereinigt. host, flush, purge_g, low_g und track bleiben die dieses Servers.

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
LOW_G_DEFAULT = 100
EXPORT_FORMAT = "druck-konfigurator-spools"
MAX_SPOOLS = 500
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
    return {"version": 1, "host": None, "flush": FLUSH_DEFAULT, "purge_g": None, "low_g": LOW_G_DEFAULT, "spools": [], "track": {}, "history": []}


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
    return {"spools": spools, "host": state.get("host"), "flush": state.get("flush"), "purge_g": state.get("purge_g"), "low_g": state.get("low_g", LOW_G_DEFAULT),
            "history": state.get("history", [])[-HISTORY:], "track": state.get("track") or {}, "file": data_file()}


def _same(sp, s):
    if sp["type"] != s["type"] or sp["colour"].upper() != s["colour"].upper():
        return False
    return (sp.get("sku") or "") == (s.get("sku") or "")


def new_spool(s, slot, now, check=True):
    return {"id": uuid.uuid4().hex[:12], "sku": s.get("sku") or "", "type": s["type"], "colour": s["colour"], "rfid": bool(s.get("rfid")),
            "name": "", "brand": "Anycubic" if s.get("rfid") else "", "net_g": DEFAULT_NET_G, "used_g": 0.0, "purge_g": 0.0, "adjust_g": 0.0,
            "slot": slot, "added": now, "last_seen": now, "notes": "", "archived": False,
            "needs_check": check}


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
        if req.get("low_g") is not None:
            v = _num(req["low_g"])
            if v is None or not 0 <= v <= 5000:
                raise ValueError("Warnschwelle 0–5000 g")
            state["low_g"] = v
        return "ok"
    if a == "import":
        return import_state(state, req.get("data"), req.get("mode"))
    if a == "add":
        s = {"type": str(req.get("type") or "PLA").upper(), "colour": str(req.get("colour") or "#FFFFFF"), "sku": "", "rfid": False}
        sp = new_spool(s, None, time.time(), check=False)   # von Hand angelegt: Füllgewicht gibt der Nutzer gleich ein
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
    if "needs_check" in req:
        sp["needs_check"] = bool(req["needs_check"])
    elif req.get("net_g") is not None or req.get("remaining_g") is not None:
        sp["needs_check"] = False          # Gewicht bestätigt oder eingetragen
    return "gespeichert"


def _num(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v)


def _str(d, k, maxlen, default=""):
    v = d.get(k, default)
    if v is None:
        v = default
    if not isinstance(v, str) or len(v) > maxlen:
        raise ValueError("Feld „%s“ ungültig (Text bis %d Zeichen erwartet)" % (k, maxlen))
    return v


def _clean_spool(d, n):
    """Eine Spule aus der Importdatei prüfen und in die eigene Form bringen."""
    if not isinstance(d, dict):
        raise ValueError("Spule %d ist kein Objekt" % n)
    sid = _str(d, "id", 64)
    if not sid or not all(c.isalnum() or c in "-_" for c in sid):
        raise ValueError("Spule %d: ungültige id" % n)
    sp = {"id": sid, "sku": _str(d, "sku", 64), "type": _str(d, "type", 32).upper() or "PLA", "colour": _str(d, "colour", 32) or "#FFFFFF",
          "name": _str(d, "name", 200), "brand": _str(d, "brand", 100), "notes": _str(d, "notes", 1000)}
    for k in ("rfid", "archived", "needs_check"):
        v = d.get(k, False)
        if not isinstance(v, bool):
            raise ValueError("Spule %d: „%s“ muss wahr/falsch sein" % (n, k))
        sp[k] = v
    for k, lo, hi, default in (("net_g", 0, 20000, DEFAULT_NET_G), ("used_g", 0, 1e6, 0.0), ("purge_g", 0, 1e6, 0.0),
                               ("adjust_g", -1e6, 1e6, 0.0), ("added", 0, 1e11, 0.0), ("last_seen", 0, 1e11, 0.0)):
        v = _num(d.get(k, default))
        if v is None or not lo <= v <= hi:
            raise ValueError("Spule %d: „%s“ ungültig" % (n, k))
        sp[k] = v
    if d.get("price_per_kg") is not None:
        v = _num(d["price_per_kg"])
        if v is None or not 0 <= v <= 20000:
            raise ValueError("Spule %d: „price_per_kg“ ungültig" % n)
        sp["price_per_kg"] = v
    slot = d.get("slot")
    if slot is not None and (isinstance(slot, bool) or not isinstance(slot, int) or not 0 <= slot < 64):
        raise ValueError("Spule %d: ungültiger Slot" % n)
    sp["slot"] = slot
    return sp


def _clean_history(lst):
    if not isinstance(lst, list) or len(lst) > 1000:
        raise ValueError("„history“ muss eine Liste sein")
    out = []
    for n, h in enumerate(lst, 1):
        if not isinstance(h, dict) or not isinstance(h.get("used", {}), dict) or len(h.get("used", {})) > 64:
            raise ValueError("Druck %d in „history“ ungültig" % n)
        e = {"job": _str(h, "job", 500), "changes": 0, "used": {}}
        for k in ("start", "end"):
            e[k] = _num(h.get(k)) if h.get(k) is not None else None
            if h.get(k) is not None and e[k] is None:
                raise ValueError("Druck %d: „%s“ ungültig" % (n, k))
        ch = h.get("changes", 0)
        if isinstance(ch, bool) or not isinstance(ch, int) or not 0 <= ch <= 100000:
            raise ValueError("Druck %d: „changes“ ungültig" % n)
        e["changes"] = ch
        for sid, g in h.get("used", {}).items():
            if not isinstance(sid, str) or len(sid) > 64 or _num(g) is None:
                raise ValueError("Druck %d: Verbrauch ungültig" % n)
            e["used"][sid] = _num(g)
        out.append(e)
    return out[-HISTORY:]


def validate_import(data):
    """Importdatei prüfen. Gibt einen bereinigten Stand zurück oder wirft ValueError (deutsche Meldung)."""
    if not isinstance(data, dict):
        raise ValueError("Keine Spulendatei (JSON-Objekt erwartet)")
    if data.get("format") not in (None, EXPORT_FORMAT) or not isinstance(data.get("spools"), list):
        raise ValueError("Keine Spulendatei des Druck-Konfigurators")
    if data.get("version", 1) != 1:
        raise ValueError("Unbekannte Version der Spulendatei")
    if len(data["spools"]) > MAX_SPOOLS:
        raise ValueError("Zu viele Spulen (höchstens %d)" % MAX_SPOOLS)
    spools = [_clean_spool(d, n) for n, d in enumerate(data["spools"], 1)]
    ids, slots = set(), set()
    for sp in spools:
        if sp["id"] in ids:
            raise ValueError("Spule %s kommt doppelt vor" % sp["id"])
        ids.add(sp["id"])
        if sp["slot"] is not None:
            if sp["slot"] in slots:
                raise ValueError("Slot %d ist doppelt belegt" % (sp["slot"] + 1))
            slots.add(sp["slot"])
    out = {"spools": spools, "history": _clean_history(data.get("history", []))}
    for k, lo, hi in (("flush", 0.1, 3), ("purge_g", 0, 100), ("low_g", 0, 5000)):
        if data.get(k) is not None:
            v = _num(data[k])
            if v is None or not lo <= v <= hi:
                raise ValueError("„%s“ ungültig" % k)
            out[k] = v
    return out


def import_state(state, data, mode):
    """Export eines anderen Servers einspielen (Regeln siehe oben). Gibt {note, imported: {mode, total, added, updated}} zurück."""
    if mode not in ("merge", "replace"):
        raise ValueError("Import: Art „merge“ oder „replace“ angeben")
    src = validate_import(data)
    if mode == "replace":
        state["spools"] = src["spools"]
        state["history"] = src["history"]
        state["flush"] = src.get("flush", FLUSH_DEFAULT)
        state["purge_g"] = src.get("purge_g")
        state["low_g"] = src.get("low_g", LOW_G_DEFAULT)
        return {"note": "Spulen ersetzt", "imported": {"mode": mode, "total": len(src["spools"]), "added": len(src["spools"]), "updated": 0}}
    own = state["spools"]
    by_id = {sp["id"]: sp for sp in own}
    taken, idmap, added, updated = set(), {}, 0, 0
    for sp in src["spools"]:
        t = by_id.get(sp["id"])
        if t is None or t["id"] in taken:
            cand = [x for x in own if x["id"] not in taken and _same(x, sp) and (x.get("slot") is None or x.get("slot") == sp["slot"])]
            cand.sort(key=lambda x: (x.get("slot") is None or x.get("slot") != sp["slot"], -(x.get("last_seen") or 0)))
            t = cand[0] if cand else None
        if t is None:
            new = dict(sp, slot=None)
            if new["id"] in by_id:
                new["id"] = uuid.uuid4().hex[:12]
            own.append(new)
            by_id[new["id"]] = new
            taken.add(new["id"])
            idmap[sp["id"]] = new["id"]
            added += 1
            continue
        taken.add(t["id"])
        idmap[sp["id"]] = t["id"]
        if (sp.get("last_seen") or 0) > (t.get("last_seen") or 0):
            keep = {"id": t["id"], "slot": t.get("slot"), "added": min(t.get("added") or sp["added"], sp["added"] or t.get("added") or 0)}
            t.clear()
            t.update(sp, **keep)
            updated += 1
    seen = {(h.get("job"), h.get("start")) for h in state.get("history", [])}
    for h in src["history"]:
        if (h["job"], h["start"]) not in seen:
            state.setdefault("history", []).append(dict(h, used={idmap.get(k, k): g for k, g in h["used"].items()}))
    state["history"] = sorted(state.get("history", []), key=lambda h: h.get("end") or 0)[-HISTORY:]
    return {"note": "Spulen zusammengeführt", "imported": {"mode": mode, "total": len(src["spools"]), "added": added, "updated": updated}}


def export_state(state, now=None):
    """Ganzer Stand zum Herunterladen: (Dateiname, JSON-Bytes)."""
    now = now or time.time()
    out = {"format": EXPORT_FORMAT, "version": 1, "exported": round(now)}
    out.update({k: state.get(k) for k in ("flush", "purge_g", "low_g", "spools", "history")})
    out["host"] = state.get("host")
    name = "spools-" + time.strftime("%Y-%m-%d", time.localtime(now)) + ".json"
    return name, json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode()


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


def api_export(path=None):
    with _lock:
        return export_state(load(path))


def api_post(req, path=None):
    with _lock:
        state = load(path)
        msg = update(state, req)
        save(state, path)
        return dict(view(state), **(msg if isinstance(msg, dict) else {"note": msg}))
