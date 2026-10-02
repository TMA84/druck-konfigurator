"""Bild des Druckfortschritts für Home Assistant (MQTT-Kamera, tools/ha_mqtt.py) – ohne Zusatzpakete.

Aus der Schichtvorschau des laufenden Drucks (GCPV3, tools/gcode_preview.py): schräge Ansicht von oben (isometrisch),
gedruckte Schichten in der Farbe ihres ACE-Slots (nach Höhe abgedunkelt, damit man Tiefe sieht), die aktuelle Schicht
heller, dazu der Umriss des ganzen Modells. Gezeichnet wird schrittweise: kommt eine Schicht dazu, nur die neuen Bahnen.
Nur für Drucke aus dem Tool (nur dann gibt es die Vorschau). Ein eigener kleiner PNG-Schreiber (zlib) – im Container
gibt es kein Pillow.
"""
import json
import math
import os
import struct
import zlib
from array import array

W, H = 640, 480
MARGIN = 24
BG = (29, 32, 38)
BED = (70, 76, 88)
GHOST = (96, 104, 118)
DEFAULT_COLOURS = [(242, 166, 64), (90, 170, 240), (120, 200, 120), (220, 110, 110)]
COS30, SIN30 = math.cos(math.pi / 6), 0.5


def read_preview(path):
    """GCPV3/GCPV2 → (Kopf, Koordinaten uint16 [x0,y0,x1,y1]…, Werkzeug je Bahn)."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"GCPV":
        raise ValueError("keine Schichtvorschau")
    n_head = struct.unpack_from("<I", data, 5)[0]
    head = json.loads(data[9:9 + n_head])
    off = 9 + n_head
    off += (-off) % 4
    n = head["count"]
    q = array("H")
    q.frombytes(data[off:off + 8 * n])
    attrs = data[off + 8 * n:off + 10 * n]
    tools = attrs[1::2]
    return head, q, tools


def _colour(hexstr):
    try:
        h = hexstr.lstrip("#")
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except (ValueError, AttributeError, TypeError):
        return None


class Renderer:
    """Ein Druck (Vorschau-Datei): Projektion einmal berechnen, dann Schicht für Schicht dazuzeichnen."""

    def __init__(self, path, colours=None, size=(W, H), alpha=False, frame=True, shade=(0.5, 0.5)):
        """size: Bildgröße; alpha: durchsichtiger Hintergrund (Vorschaubild im G-Code); frame: Bett und Umriss zeichnen."""
        self.path, (self.w, self.h), self.alpha, self.shade = path, size, alpha, shade   # Helligkeit unten, Zuwachs bis oben
        W_, H_ = self.w, self.h
        head, q, tools = read_preview(path)
        self.head, self.tools = head, tools
        bb = head["bbox"]
        self.layers = head["layers"]               # [[z, erste Bahn], …]
        self.n = head["count"]
        x0, y0, z0, x1, y1, z1 = bb
        sx, sy = (x1 - x0) / 65535.0, (y1 - y0) / 65535.0
        # Eckpunkte des Modells → Maßstab, damit alles ins Bild passt
        corners = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        proj = lambda x, y, z: ((x - y) * COS30, -(x + y) * SIN30 * 0.9 - z)
        pts = [proj(*c) for c in corners]
        u0, u1 = min(p[0] for p in pts), max(p[0] for p in pts)
        v0, v1 = min(p[1] for p in pts), max(p[1] for p in pts)
        m = MARGIN if frame else 2
        k = min((W_ - 2 * m) / max(u1 - u0, 1e-6), (H_ - 2 * m) / max(v1 - v0, 1e-6))
        ou, ov = (W_ - k * (u1 - u0)) / 2 - k * u0, (H_ - k * (v1 - v0)) / 2 - k * v0
        self.to_px = lambda x, y, z: (ou + k * (x - y) * COS30, ov + k * (-(x + y) * SIN30 * 0.9 - z))
        self.bb, self.sx, self.sy, self.q = bb, sx, sy, q
        self.colours = [c for c in (_colour(c) for c in (colours or [])) if c] or DEFAULT_COLOURS
        self.zmax = max(z1, 1e-6)
        self.bpp = 4 if alpha else 3
        self.px = bytearray((b"\0\0\0\0" if alpha else bytes(BG)) * (W_ * H_))
        self.drawn = -1                              # bis zu dieser Schicht gezeichnet
        if frame:
            self._frame(corners)

    def _set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * self.bpp
            self.px[i:i + self.bpp] = bytes(c) + (b"\xff" if self.alpha else b"")

    def _line(self, a, b, c):
        (x0, y0), (x1, y1) = a, b
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        if n > 4000:
            return
        dx, dy = (x1 - x0) / n, (y1 - y0) / n
        for i in range(n + 1):
            self._set(int(x0 + dx * i), int(y0 + dy * i), c)

    def _frame(self, corners):
        # Bett-Umriss unter dem Modell und die Kanten des Hüllquaders (Umriss des ganzen Modells)
        x0, y0, z0, x1, y1, z1 = self.bb
        p = lambda x, y, z: self.to_px(x, y, z)
        for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
            self._line(p(a[0], a[1], 0), p(b[0], b[1], 0), BED)
            self._line(p(a[0], a[1], z1), p(b[0], b[1], z1), GHOST)
        for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
            self._line(p(x, y, 0), p(x, y, z1), GHOST)

    def draw_to(self, layer):
        """Schichten bis einschließlich layer (Index der Vorschau) zeichnen; die aktuelle hell."""
        layer = max(-1, min(layer, len(self.layers) - 1))
        if layer <= self.drawn:
            return False
        q, sx, sy, (bx, by) = self.q, self.sx, self.sy, (self.bb[0], self.bb[1])
        for li in range(self.drawn + 1, layer + 1):
            z = self.layers[li][0]
            a = self.layers[li][1]
            b = self.layers[li + 1][1] if li + 1 < len(self.layers) else self.n
            shade = self.shade[0] + self.shade[1] * (z / self.zmax)
            bright = li == layer
            for s in range(a, b):
                c = self.colours[self.tools[s] % len(self.colours)]
                c = tuple(min(255, max(45, int(v * (1.25 if bright else shade)))) for v in c)
                j = 4 * s
                self._line(self.to_px(bx + q[j] * sx, by + q[j + 1] * sy, z), self.to_px(bx + q[j + 2] * sx, by + q[j + 3] * sy, z), c)
        self.drawn = layer
        return True

    def png(self):
        row = self.w * self.bpp
        rows = b"".join(b"\x00" + bytes(self.px[y * row:(y + 1) * row]) for y in range(self.h))
        chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6 if self.alpha else 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))


def preview_layer(job, n):
    """Schicht des Druckers (1-basiert, eigene Zählung) → Schicht der Vorschau (wie js/live-ui.js)."""
    L, T = int(job.get("layer") or 0), int(job.get("layers") or 0)
    if L < 1:
        return -1
    return min(n - 1, max(0, round(L / T * n) - 1)) if T > 0 else min(n - 1, max(0, L - 1))


class ProgressImages:
    """Für ha_mqtt: aus dem Druckerstand das Bild – nur wenn sich die Schicht geändert hat (sonst None)."""

    def __init__(self, find_preview):
        self.find_preview = find_preview
        self.r, self.key = None, None

    def __call__(self, st):
        job = (st or {}).get("job") or {}
        if not job.get("name"):
            return None
        path = self.find_preview(job["name"])
        if not path or not os.path.exists(path):
            return None
        layer = preview_layer(job, len(self.r.layers)) if self.r and self.r.path == path else None
        # neue Datei – oder dieselbe noch einmal gedruckt (Schicht fällt zurück): neu zeichnen
        if not self.r or self.r.path != path or (layer is not None and layer < self.r.drawn):
            slots = [s for box in (st.get("ace") or []) for s in (box.get("slots") or [])]
            self.r, self.key = Renderer(path, [s.get("colour") for s in slots]), None
            layer = preview_layer(job, len(self.r.layers))
        key = (path, layer)
        if key == self.key:
            return None
        self.r.draw_to(layer)
        self.key = key
        return self.r.png()
