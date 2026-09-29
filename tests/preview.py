"""Prüft tools/gcode_preview.py: Extrusion relativ/absolut, Zusammenfassen gerader Bahnen, Bögen, Schichten,
Linienart und Werkzeug. Aufruf: python tests/preview.py"""
import json
import os
import struct
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import gcode_preview as gp  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER " + name + (": " + str(detail) if detail else ""))


def parse(data):
    n = struct.unpack("<I", data[5:9])[0]
    head = json.loads(data[9:9 + n])
    off = 9 + n + (-(9 + n)) % 4
    c = head["count"]
    q = struct.unpack("<%dH" % (4 * c), data[off:off + 8 * c])
    a = struct.unpack("<%dB" % (2 * c), data[off + 8 * c:off + 10 * c])
    v = struct.unpack("<%dB" % c, data[off + 10 * c:off + 11 * c])
    return head, q, a, v


GCODE = """M83
T0
;LAYER_CHANGE
;Z:0.2
;TYPE:Outer wall
G1 X0 Y0 F3000
G1 X10 Y0 E1
G1 X20 Y0 E1
G1 X20 Y10 E1
G1 X30 Y10 F9000
;TYPE:Sparse infill
G1 X30 Y20 E-0.5
G1 X30 Y20 E0.5
G1 X30 Y30 E1
;LAYER_CHANGE
;Z:0.4
T1
;TYPE:Top surface
G1 X0 Y0 F9000
G3 X10 Y0 I5 J0 E2
M82
G92 E0
G1 X0 Y10 E1
G1 X0 Y20 E1
G1 X0 Y30 E0.5
"""
with tempfile.NamedTemporaryFile("w", suffix=".gcode", delete=False) as f:
    f.write(GCODE)
data = gp.build_preview(f.name)
os.unlink(f.name)
head, q, a, v = parse(data)
check("Kennung GCPV3", data[:5] == b"GCPV3")
# Vorschub je Bahn: Wand mit F3000 (50 mm/s), Füllung erbt F9000 der Fahrt davor (150 mm/s); Fahrgeschwindigkeit 150 mm/s
mm_s = [x * head["speed_unit"] for x in v]
check("Vorschub der Wand 50 mm/s, der Füllung 150 mm/s", mm_s[0] == 50 and mm_s[2] == 150, mm_s)
check("Fahrgeschwindigkeit im Kopf", head["travel"] == 150, head.get("travel"))
check("zwei Schichten", [l[0] for l in head["layers"]] == [0.2, 0.4], head["layers"])
check("Werkzeuge 0 und 1", head["tools"] == [0, 1], head["tools"])
kinds = [head["types"][a[2 * i]] for i in range(head["count"])]
tools = [a[2 * i + 1] for i in range(head["count"])]
# Schicht 1: 0→20 (zusammengefasst) + 20→(20,10) Wand, Füllung 30,10→30,30 (Rückzug/Zurückschieben ohne Bewegung zählt nicht)
l2 = head["layers"][1][1]
check("gerade Wandbahnen zusammengefasst", kinds[:l2].count("Outer wall") == 2, kinds[:l2])
check("Füllung ohne Fahrweg", kinds[:l2].count("Sparse infill") == 1, kinds[:l2])
check("Bogen in Stücke zerlegt", kinds[l2:].count("Top surface") > 4 and all(t == 1 for t in tools[l2:]), kinds[l2:])
bb = head["bbox"]
check("Bereich stimmt (Bogen geht bis y = -5)", abs(bb[0]) < 1e-6 and abs(bb[3] - 30) < 1e-6 and bb[1] < -4.9 and abs(bb[4] - 30) < 1e-6, bb)
# absolute Extrusion nach M82/G92: 0→1→2 (vorwärts) und 2→0,5 wäre Rückzug → keine Bahn
check("absolute Extrusion: Rückzug erzeugt keine Bahn", kinds[l2:].count("Top surface") and head["count"] == len(kinds))
xs = [head["bbox"][0] + v / 65535 * (head["bbox"][3] - head["bbox"][0]) for v in q[0::2]]
check("Koordinaten zurückgerechnet (x = 0 … 30)", min(xs) < 0.01 and max(xs) > 29.99, (min(xs), max(xs)))
print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
