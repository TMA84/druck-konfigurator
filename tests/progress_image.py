"""Fortschrittsbild für Home Assistant (tools/progress_image.py): PNG gültig, Schichten kommen dazu, Farben der Slots,
nur bei neuer Schicht ein neues Bild. Aufruf: python tests/progress_image.py"""
import os
import struct
import sys
import tempfile
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import gcode_preview as gp  # noqa: E402
import progress_image as pi  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FEHLER", name, detail)


# kleiner G-Code: zwei Quadrate (T0 und T1), 10 Schichten
lines = ["M83"]
for li in range(10):
    z = round(0.2 * (li + 1), 2)
    lines += [";Z:%s" % z, "G1 Z%s F600" % z]
    for tool, ox in ((0, 0), (1, 30)):
        lines += ["T%d" % tool, ";TYPE:Outer wall", "G1 X%d Y0 F3000" % ox]
        lines += ["G1 X%d Y0 E1" % (ox + 20), "G1 X%d Y20 E1" % (ox + 20), "G1 X%d Y20 E1" % ox, "G1 X%d Y0 E1" % ox]
with tempfile.NamedTemporaryFile("w", suffix=".gcode", delete=False) as g:
    g.write("\n".join(lines) + "\n")
prev = os.path.join(tempfile.mkdtemp(), "Test_Platte1.preview")
with open(prev, "wb") as out:
    out.write(gp.build_preview(g.name))
os.unlink(g.name)

r = pi.Renderer(prev, ["#FF0000", "#0000FF"])
check("Vorschau gelesen: 10 Schichten", len(r.layers) == 10, len(r.layers))


def decode(png):
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    w, h = struct.unpack(">II", png[16:24])
    i, idat = 8, b""
    while i < len(png):
        n = struct.unpack(">I", png[i:i + 4])[0]
        if png[i + 4:i + 8] == b"IDAT":
            idat += png[i + 8:i + 8 + n]
        i += 12 + n
    raw = zlib.decompress(idat)
    rows = [raw[y * (w * 3 + 1) + 1:(y + 1) * (w * 3 + 1)] for y in range(h)]
    return w, h, rows


def count(rows, pred):
    return sum(1 for row in rows for x in range(0, len(row), 3) if pred(row[x], row[x + 1], row[x + 2]))


reddish = lambda r_, g, b: r_ > 120 and g < 90 and b < 90
blueish = lambda r_, g, b: b > 120 and r_ < 90 and g < 90
w, h, rows0 = decode(r.png())
check("PNG 640 × 480", (w, h) == (640, 480))
check("vor der 1. Schicht nichts gedruckt", count(rows0, reddish) == 0 and count(rows0, blueish) == 0)
r.draw_to(2)
_, _, rows3 = decode(r.png())
r.draw_to(9)
_, _, rows10 = decode(r.png())
check("Slotfarben: T0 rot, T1 blau", count(rows10, reddish) > 50 and count(rows10, blueish) > 50, (count(rows10, reddish), count(rows10, blueish)))
check("mehr Schichten → mehr gedruckt", count(rows10, reddish) > count(rows3, reddish) > 0, (count(rows3, reddish), count(rows10, reddish)))
check("schon gezeichnete Schicht: nichts zu tun", r.draw_to(5) is False)

check("Schicht des Druckers → Vorschau", pi.preview_layer({"layer": 0, "layers": 10}, 10) == -1 and pi.preview_layer({"layer": 5, "layers": 10}, 10) == 4
      and pi.preview_layer({"layer": 21, "layers": 21}, 10) == 9)

imgs = pi.ProgressImages(lambda name: prev if name == "Test_Platte1" else None)
st = {"job": {"name": "Test_Platte1", "layer": 3, "layers": 10}, "ace": [{"slots": [{"colour": "#00FF00"}, {"colour": "#FFFF00"}]}]}
a = imgs(st)
check("erstes Bild", a and a[:4] == b"\x89PNG")
check("gleiche Schicht: kein neues Bild", imgs(st) is None)
st["job"]["layer"] = 4
check("neue Schicht: neues Bild", imgs(st) is not None)
check("fremder Druck (keine Vorschau): kein Bild", imgs({"job": {"name": "Fremd", "layer": 1, "layers": 2}}) is None)
check("kein Druck: kein Bild", imgs({"job": None}) is None and imgs(None) is None)
_, _, rg = decode(imgs.r.png())
check("Farben aus der ACE (grün/gelb)", count(rg, lambda r_, g, b: g > 120 and r_ < 90) > 20, count(rg, lambda r_, g, b: g > 120 and r_ < 90))

print("%d/%d bestanden" % (passed, passed + failed))
sys.exit(1 if failed else 0)
