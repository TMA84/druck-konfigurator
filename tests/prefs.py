"""Standardwerte auf dem Server (tools/prefs.py): speichern, laden, Prüfung. Aufruf: python tests/prefs.py"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import prefs  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER", name, detail)


def fails(name, fn, text):
    try:
        fn()
        check(name, False, "kein Fehler")
    except prefs.PrefsError as e:
        check(name, text in str(e), e)


path = os.path.join(tempfile.mkdtemp(), "prefs.json")
check("leer am Anfang", prefs.api_get(path) == {"ovDefaults": {}})
v = {"kobra_s1|abs": {"bed": 105, "fan": 5, "seam": "Hinten", "retr_len": 1.3}, "kobra_s1|sl_pla_plus2": {"nozzle": 215}}
r = prefs.api_post({"key": "ovDefaults", "value": v}, path)
check("gespeichert und zurückgegeben", r["ovDefaults"] == v, r)
check("nach Neustart gelesen", prefs.api_get(path)["ovDefaults"]["kobra_s1|abs"]["retr_len"] == 1.3)
check("ersetzen: Eintrag gelöscht", prefs.api_post({"key": "ovDefaults", "value": {"kobra_s1|abs": {"bed": 100}}}, path)["ovDefaults"] == {"kobra_s1|abs": {"bed": 100}})
check("leere Felder fallen weg", prefs.api_post({"key": "ovDefaults", "value": {"kobra_s1|abs": {}}}, path)["ovDefaults"] == {})
check("weitere Orca-Einstellung (x:…) erlaubt", prefs.api_post({"key": "ovDefaults", "value": {"kobra_s1|asa": {"x:support_type": "normal(auto)", "x:elefant_foot_compensation": 0.15}}}, path)["ovDefaults"]["kobra_s1|asa"]["x:support_type"] == "normal(auto)")
fails("unbekannte Einstellung", lambda: prefs.api_post({"key": "x", "value": {}}, path), "Unbekannte")
fails("Schlüssel ohne Drucker|Filament", lambda: prefs.api_post({"key": "ovDefaults", "value": {"abs": {"bed": 1}}}, path), "Ungültiger Eintrag")
fails("Feldname mit Sonderzeichen", lambda: prefs.api_post({"key": "ovDefaults", "value": {"kobra_s1|abs": {"bed;rm": 1}}}, path), "Ungültiges Feld")
fails("Wert als Objekt", lambda: prefs.api_post({"key": "ovDefaults", "value": {"kobra_s1|abs": {"bed": {"x": 1}}}}, path), "Ungültiger Wert")
fails("zu langer Text", lambda: prefs.api_post({"key": "ovDefaults", "value": {"kobra_s1|abs": {"seam": "x" * 100}}}, path), "Ungültiger Wert")
print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
