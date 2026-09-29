"""G-Code (OrcaSlicer) → kompakte Vorschau für die Schichtansicht im Tool.

Nur Extrusionsbahnen (keine Fahrwege), je Bahn Linienart (;TYPE:) und Werkzeug (T<n>). Aufeinanderfolgende,
fast gerade Bahnen gleicher Art werden zusammengefasst – so schrumpft ein 50-MB-G-Code auf wenige MB.
G2/G3 (Bögen) werden in kurze Stücke zerlegt. Relative (M83) und absolute (M82) Extrusion, G92.

Format (little endian):  b"GCPV2" · uint32 Länge des JSON-Kopfs · JSON · Auffüllung auf 4 Byte
                         · uint16[4·n] (x0, y0, x1, y1 – auf bbox skaliert, ~0,004 mm bei 250 mm) · uint8[2·n] (Art, Werkzeug)
JSON: {"count": n, "types": [...], "layers": [[z, erste Bahn], ...], "bbox": [x0, y0, z0, x1, y1, z1], "tools": [...]}
"""
import json
import math
import re
import struct
from array import array

TYPES = ["Outer wall", "Inner wall", "Overhang wall", "Sparse infill", "Internal solid infill", "Solid infill",
         "Top surface", "Bottom surface", "Bridge", "Internal Bridge", "Gap infill", "Support", "Support interface",
         "Support transition", "Prime tower", "Brim", "Skirt", "Ironing", "Custom", "Other"]
TYPE_INDEX = {t.lower(): i for i, t in enumerate(TYPES)}
WORD = re.compile(r"([XYZEIJ])(-?\d*\.?\d+)")
MERGE_COS = 0.9995        # fast gerade: Winkel < ~1,8°
ARC_STEP_MM = 1.0


def build_preview(path):
    segs, attrs, layers = array("f"), array("B"), []
    x = y = z = 0.0
    e_abs, relative, tool, kind, layer_z = 0.0, True, 0, TYPE_INDEX["other"], None
    tools = set()
    bb = [math.inf, math.inf, math.inf, -math.inf, -math.inf, -math.inf]
    last = None  # (ende_x, ende_y, dx, dy, art, werkzeug) der letzten Bahn – zum Zusammenfassen

    def add(x0, y0, x1, y1):
        nonlocal last
        dx, dy = x1 - x0, y1 - y0
        ln = math.hypot(dx, dy)
        if ln < 1e-6:
            return
        if last and last[4] == kind and last[5] == tool and abs(last[0] - x0) < 1e-4 and abs(last[1] - y0) < 1e-4:
            lx, ly = last[2], last[3]
            if (lx * dx + ly * dy) / (math.hypot(lx, ly) * ln) > MERGE_COS:
                segs[-2], segs[-1] = x1, y1
                last = (x1, y1, segs[-2] - segs[-4], segs[-1] - segs[-3], kind, tool)
                return
        segs.extend((x0, y0, x1, y1))
        attrs.extend((kind, tool))
        last = (x1, y1, dx, dy, kind, tool)
        bb[0], bb[1], bb[3], bb[4] = min(bb[0], x0, x1), min(bb[1], y0, y1), max(bb[3], x0, x1), max(bb[4], y0, y1)
        bb[2], bb[5] = min(bb[2], z), max(bb[5], z)

    with open(path, "r", errors="replace") as f:
        for raw in f:
            c = raw[0] if raw else ""
            if c == ";":
                if raw.startswith(";TYPE:"):
                    kind = TYPE_INDEX.get(raw[6:].strip().lower(), TYPE_INDEX["other"])
                    last = None
                elif raw.startswith(";Z:"):
                    try:
                        nz = float(raw[3:])
                    except ValueError:
                        continue
                    if layer_z is None or abs(nz - layer_z) > 1e-6:
                        layer_z = nz
                        layers.append([round(nz, 4), len(attrs) // 2])
                        last = None
                continue
            line = raw.split(";", 1)[0].strip()
            if not line:
                continue
            if line[0] == "T" and line[1:].isdigit():
                tool = int(line[1:]) & 0xFF
                tools.add(tool)
                last = None
                continue
            cmd = line.split(" ", 1)[0]
            if cmd == "M83":
                relative = True
            elif cmd == "M82":
                relative = False
            elif cmd == "G92":
                m = re.search(r"E(-?\d*\.?\d+)", line)
                if m:
                    e_abs = float(m.group(1))
            elif cmd in ("G0", "G1", "G2", "G3"):
                w = {k: float(v) for k, v in WORD.findall(line)}
                nx, ny, nz = w.get("X", x), w.get("Y", y), w.get("Z", z)
                de = 0.0
                if "E" in w:
                    de = w["E"] if relative else w["E"] - e_abs
                    if not relative:
                        e_abs = w["E"]
                z = nz
                if de > 0 and (nx != x or ny != y):
                    if cmd in ("G2", "G3") and ("I" in w or "J" in w):
                        cx, cy = x + w.get("I", 0.0), y + w.get("J", 0.0)
                        r = math.hypot(x - cx, y - cy)
                        a0, a1 = math.atan2(y - cy, x - cx), math.atan2(ny - cy, nx - cx)
                        sweep = a1 - a0
                        if cmd == "G2" and sweep >= 0:
                            sweep -= 2 * math.pi
                        if cmd == "G3" and sweep <= 0:
                            sweep += 2 * math.pi
                        n = max(2, int(abs(sweep) * r / ARC_STEP_MM))
                        px, py = x, y
                        for i in range(1, n + 1):
                            a = a0 + sweep * i / n
                            qx, qy = (cx + r * math.cos(a), cy + r * math.sin(a)) if i < n else (nx, ny)
                            add(px, py, qx, qy)
                            px, py = qx, qy
                    else:
                        add(x, y, nx, ny)
                else:
                    last = None if (nx != x or ny != y) else last
                x, y = nx, ny
    n = len(attrs) // 2
    if not n:
        bb = [0, 0, 0, 0, 0, 0]
    # auf 16 bit je Koordinate verkleinern (x und y je auf die bbox skaliert)
    sx, sy = max(bb[3] - bb[0], 1e-6), max(bb[4] - bb[1], 1e-6)
    q = array("H", (int(round((v - (bb[0] if i % 2 == 0 else bb[1])) / (sx if i % 2 == 0 else sy) * 65535)) for i, v in enumerate(segs)))
    head = json.dumps({"count": n, "types": TYPES, "layers": layers, "bbox": [round(v, 3) for v in bb],
                       "tools": sorted(tools)}).encode()
    pad = (-(5 + 4 + len(head))) % 4
    return b"GCPV2" + struct.pack("<I", len(head)) + head + b" " * pad + q.tobytes() + attrs.tobytes()
