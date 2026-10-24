"""Sicherung und Umzug: alles, was der Server dauerhaft braucht, als EINE Datei – und wieder einspielen.

Wofür: Umzug Mac ↔ Home-Assistant-Add-on, Sicherung vor Experimenten.
  GET  /api/backup                         → Sicherung als JSON-Datei (build)
  POST /api/backup {mode: merge|replace, data: <Sicherung>}  → einspielen (restore)

Format: JSON mit format/version – kein ZIP. Alles, was hineingehört, ist ohnehin JSON (wenige 100 KB); ohne
Dateien im Archiv gibt es keine Pfade (Path-Traversal) und kein Entpacken (ZIP-Bombe). Aufbau:
  {format: "druckwerkstatt-backup", version: 1, exported: <Unix-Zeit>,
   server: {spools: <wie GET /api/spools/export, ohne host>, prefs: {ovDefaults: {…}}},
   browser: {profiles, settings, last}}      ← hängt die Seite an (js/backup-ui.js), der Server prüft nur die Form

Drin: Spulen mit Druckhistorie und Preisen (tools/spools.py), eigene Standardwerte je Drucker/Filament (tools/prefs.py),
aus dem Browser die eigenen Filamentprofile, ausgewählte Einstellungen (Kosten, Preise, Slots, Spülmenge, Drucker-Adressen)
und die letzte Auswahl.
Nicht drin:
  - Warteschlange und geplanter Druck: kurzlebig und an Slice-Aufträge (G-Code im Zwischenspeicher) gebunden. Ein
    eingespielter Plan würde auf dem neuen Server von selbst einen Druck starten – die Bestätigung „Bett frei“ galt
    aber dem alten Moment. Beides bleibt auf dem Zielserver unverändert.
  - Zwischenspeicher: Slice-Aufträge, Vorschauen gestarteter Drucke (DATA_DIR/printed), laufender Zähler (track).
  - Geheimnisse: PIN, MQTT-Zugang, erlaubte Servernamen kommen nur aus der Umgebung und stehen in keiner Datei.
  - Das geladene Projekt (IndexedDB des Browsers): groß, mit Netzen – dafür gibt es den 3MF-Export.

Einspielen: erst ALLES prüfen (spools.validate_import, prefs.clean_defaults), dann die neuen Stände im Speicher bauen,
beide als .tmp schreiben und erst danach umbenennen – bei einem Fehler bleibt alles, wie es war.
  replace: Spulen, Historie und Standardwerte wie in der Datei (host und laufender Zähler bleiben die dieses Servers).
  merge:   Spulen wie spools.import_state(merge), Standardwerte: Einträge der Datei kommen dazu bzw. gewinnen.
"""
import copy
import json
import os
import time

import prefs
import spools

FORMAT = "druckwerkstatt-backup"
VERSION = 1
MAX_BYTES = 8 * 1024 * 1024        # Obergrenze der Anfrage (tools/serve.py); 500 Spulen + 500 Drucke ≈ 0,5 MB
MAX_BROWSER_BYTES = 2 * 1024 * 1024
MAX_DEPTH = 40                     # tiefer verschachtelt ist keine Sicherung (Schutz vor RecursionError)


class BackupError(ValueError):
    """Ungültige Sicherung – Meldung (deutsch) geht so an die Seite."""


def build(now=None, spool_path=None, prefs_path=None):
    """Sicherung des Servers: (Dateiname, JSON-Bytes). Die Seite hängt ihren Teil (browser) an."""
    now = now or time.time()
    with spools._lock:
        sp = json.loads(spools.export_state(spools.load(spool_path), now)[1])
    sp.pop("host", None)   # Adresse gehört zum Server (KONFIGURATOR_PRINTER bzw. Drucker-Verbindung), nicht zur Sicherung
    out = {"format": FORMAT, "version": VERSION, "exported": round(now),
           "server": {"spools": sp, "prefs": prefs.api_get(prefs_path)}}
    name = "druckwerkstatt-sicherung-" + time.strftime("%Y-%m-%d", time.localtime(now)) + ".json"
    return name, json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode()


def parse(raw):
    """Anfrage (Bytes) → JSON-Objekt; zu tief verschachtelt oder kaputt → BackupError."""
    try:
        data = json.loads(raw or b"{}")
    except RecursionError:
        raise BackupError("Sicherung zu tief verschachtelt") from None
    except ValueError:
        raise BackupError("Keine gültige JSON-Datei") from None
    if not isinstance(data, dict):
        raise BackupError("JSON-Objekt erwartet")
    return data


def _depth(v, limit):
    """Verschachtelungstiefe ohne Rekursion (bis limit+1)."""
    stack, deepest = [(v, 1)], 0
    while stack:
        x, d = stack.pop()
        deepest = max(deepest, d)
        if deepest > limit:
            return deepest
        if isinstance(x, dict):
            stack.extend((y, d + 1) for y in x.values())
        elif isinstance(x, list):
            stack.extend((y, d + 1) for y in x)
    return deepest


def validate(data):
    """Sicherung prüfen → {spools: <bereinigt oder None>, prefs: <bereinigt oder None>}. Fehler → BackupError (deutsch)."""
    if not isinstance(data, dict):
        raise BackupError("Keine Sicherung der Druckwerkstatt (JSON-Objekt erwartet)")
    if data.get("format") != FORMAT:
        raise BackupError("Keine Sicherung der Druckwerkstatt")
    v = data.get("version")
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        raise BackupError("Sicherung ohne gültige Version")
    if v > VERSION:
        raise BackupError("Sicherung aus einer neueren Version der Druckwerkstatt – bitte zuerst aktualisieren")
    if _depth(data, MAX_DEPTH) > MAX_DEPTH:
        raise BackupError("Sicherung zu tief verschachtelt")
    server = data.get("server")
    if not isinstance(server, dict):
        raise BackupError("Sicherung ohne Serverteil")
    unknown = set(server) - {"spools", "prefs"}
    if unknown:
        raise BackupError("Unbekannter Teil in der Sicherung: %s" % ", ".join(sorted(str(k)[:30] for k in unknown)))
    browser = data.get("browser")
    if browser is not None:
        if not isinstance(browser, dict):
            raise BackupError("Browserteil der Sicherung ungültig")
        if len(json.dumps(browser, ensure_ascii=False).encode()) > MAX_BROWSER_BYTES:
            raise BackupError("Browserteil der Sicherung zu groß (höchstens 2 MB)")
    out = {"spools": None, "prefs": None}
    if server.get("spools") is not None:
        sp = server["spools"]
        if not isinstance(sp, dict):
            raise BackupError("Spulen: kein Objekt")
        try:
            spools.validate_import(dict(sp, format=spools.EXPORT_FORMAT))
        except ValueError as e:
            raise BackupError("Spulen: " + str(e)) from None
        out["spools"] = {k: x for k, x in sp.items() if k not in ("host", "track", "plans")}
    if server.get("prefs") is not None:
        pr = server["prefs"]
        if not isinstance(pr, dict) or set(pr) - set(prefs.KEYS):
            raise BackupError("Standardwerte: unbekannter Inhalt")
        try:
            out["prefs"] = {k: prefs.clean_defaults(pr.get(k) or {}) for k in prefs.KEYS}
        except prefs.PrefsError as e:
            raise BackupError("Standardwerte: " + str(e)) from None
    if out["spools"] is None and out["prefs"] is None:
        raise BackupError("Die Sicherung enthält nichts für den Server")
    return out


def _tmp_write(path, obj, indent=None):
    """Neuen Stand neben die Datei schreiben (noch nicht umbenannt) – Pfad der .tmp-Datei."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".restore.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=indent)
            f.flush()
            os.fsync(f.fileno())
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return tmp


def restore(data, mode, spool_path=None, prefs_path=None):
    """Sicherung einspielen (Regeln oben). Gibt eine Zusammenfassung zurück; bei einem Fehler ändert sich nichts."""
    if mode not in ("merge", "replace"):
        raise BackupError("Art „merge“ oder „replace“ angeben")
    src = validate(data)
    spool_path = spool_path or spools.data_file()
    prefs_path = prefs_path or prefs.data_file()
    res = {"mode": mode}
    with spools._lock, prefs._lock:
        writes = []
        if src["spools"] is not None:
            state = copy.deepcopy(spools.load(spool_path))
            r = spools.import_state(state, src["spools"], mode)["imported"]
            res["spools"] = {k: r[k] for k in ("total", "added", "updated")}
            res["spools"]["history"] = len(state.get("history") or [])
            writes.append((spool_path, state, 1))
        if src["prefs"] is not None:
            cur = prefs.load(prefs_path)
            for k in prefs.KEYS:
                merged = dict(cur.get(k) or {}, **src["prefs"][k]) if mode == "merge" else src["prefs"][k]
                try:
                    cur[k] = prefs.clean_defaults(merged)
                except prefs.PrefsError as e:   # z. B. zusammen mehr als MAX_ENTRIES
                    raise BackupError("Standardwerte: " + str(e)) from None
            res["prefs"] = {"entries": len(cur.get("ovDefaults") or {})}
            writes.append((prefs_path, cur, None))
        tmps = []
        try:
            for path, obj, indent in writes:
                tmps.append((_tmp_write(path, obj, indent), path))
        except OSError as e:
            for tmp, _ in tmps:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
            raise BackupError("Sicherung nicht gespeichert: " + str(e)) from None
        for tmp, path in tmps:   # erst jetzt: beide Stände sind vollständig geschrieben
            os.replace(tmp, path)
    res["note"] = "Sicherung eingespielt"
    return res
