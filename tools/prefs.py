"""Einstellungen, die für alle Browser gelten sollen (Mac, iPhone, Home Assistant): eigene Standardwerte je Drucker und
Filament („Als Standard merken“, js/overrides-ui.js). Bisher lagen sie nur im Browser.

Stand: $DATA_DIR/prefs.json (bzw. $PREFS_FILE): {"ovDefaults": {"kobra_s1|abs": {"bed": 105, "fan": 5, …}, …}}
GET  /api/prefs                        → {ovDefaults}
POST /api/prefs {key: "ovDefaults", value: {…}}  → ersetzt den Eintrag (geprüft: Schlüssel, Zahlen/kurze Texte, Größe)
"""
import json
import os
import re
import threading

KEYS = ("ovDefaults",)
MAX_ENTRIES = 200          # Drucker × Filamente
MAX_FIELDS = 120         # alle Felder des Dialogs (berechnete und weitere Orca-Einstellungen)
_KEY_RE = re.compile(r"^[\w.\-]{1,40}\|[\w.\-+ ]{1,60}$")
_FIELD_RE = re.compile(r"^(x:)?[a-z_]{1,40}$")   # x:<orca_key> = weitere Orca-Einstellung (js/orca-extra.js)
_lock = threading.Lock()


class PrefsError(Exception):
    pass


def data_file():
    if os.environ.get("PREFS_FILE"):
        return os.environ["PREFS_FILE"]
    d = os.environ.get("DATA_DIR") or os.path.join(os.path.expanduser("~"), ".druck-konfigurator")
    return os.path.join(d, "prefs.json")


def load(path=None):
    try:
        with open(path or data_file(), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save(state, path=None):
    p = path or data_file()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, p)


def clean_defaults(v):
    """{"drucker|filament": {feld: Zahl oder kurzer Text}} – alles andere fällt weg bzw. ist ein Fehler."""
    if not isinstance(v, dict) or len(v) > MAX_ENTRIES:
        raise PrefsError("Ungültige Standardwerte")
    out = {}
    for key, fields in v.items():
        if not isinstance(key, str) or not _KEY_RE.match(key) or not isinstance(fields, dict) or len(fields) > MAX_FIELDS:
            raise PrefsError("Ungültiger Eintrag: %s" % str(key)[:60])
        f = {}
        for k, val in fields.items():
            if not isinstance(k, str) or not _FIELD_RE.match(k):
                raise PrefsError("Ungültiges Feld: %s" % str(k)[:30])
            if isinstance(val, bool) or not (isinstance(val, (int, float)) or (isinstance(val, str) and len(val) <= 30)):
                raise PrefsError("Ungültiger Wert für %s" % k)
            f[k] = val
        if f:
            out[key] = f
    return out


def api_get(path=None):
    with _lock:
        d = load(path)
        return {k: d.get(k) or {} for k in KEYS}


def api_post(req, path=None):
    key = req.get("key")
    if key not in KEYS:
        raise PrefsError("Unbekannte Einstellung")
    value = clean_defaults(req.get("value") or {})
    with _lock:
        d = load(path)
        d[key] = value
        save(d, path)
        return {k: d.get(k) or {} for k in KEYS}
