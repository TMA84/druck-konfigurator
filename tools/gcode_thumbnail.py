"""Vorschaubild in den G-Code schreiben, wenn OrcaSlicer keins eingebettet hat.

Das Display des Druckers zeigt nach dem Hochladen das Bild aus dem G-Code („; thumbnail begin 230x110 …“, Kobra S1:
thumbnails = 230x110/PNG im Profil). OrcaSlicer zeichnet es mit OpenGL – auf der Kommandozeile im Container entsteht
keins (2026-10-02: Drucker zeigte nach dem Hochladen kein Modell). Das Tool zeichnet es deshalb selbst aus der
Schichtvorschau (tools/progress_image.py: schräg von oben, Farben der Filamente, durchsichtiger Hintergrund) und setzt
es wie Orca nach dem Kopfblock ein. Größen und Format aus „; thumbnails = …“ im G-Code; nur PNG.
"""
import base64
import os
import re
import shutil
import tempfile

import progress_image

MAX_SIDE = 600
_SIZE_RE = re.compile(r"(\d+)x(\d+)(?:/(\w+))?")


def wanted_sizes(text):
    """Aus „; thumbnails = 230x110/PNG, 96x96/PNG“ → [(230, 110), …] (nur PNG, plausible Größen)."""
    m = re.search(r"^; thumbnails = (.*)$", text, re.M)
    out = []
    for w, h, fmt in _SIZE_RE.findall(m.group(1) if m else ""):
        w, h = int(w), int(h)
        if (fmt or "PNG").upper() == "PNG" and 8 <= w <= MAX_SIDE and 8 <= h <= MAX_SIDE and (w, h) not in out:
            out.append((w, h))
    return out


def _tail(path, n=200000):
    with open(path, "rb") as f:
        f.seek(max(0, os.path.getsize(path) - n))
        return f.read().decode("utf-8", "replace")


def block(png, w, h):
    b64 = base64.b64encode(png).decode()
    lines = ["; " + b64[i:i + 78] for i in range(0, len(b64), 78)]
    return "\n".join([";", "; thumbnail begin %dx%d %d" % (w, h, len(b64))] + lines + ["; thumbnail end", ";"]) + "\n"


def add_thumbnails(gcode, preview):
    """Bild(er) einsetzen, falls Orca keins geschrieben hat. gcode, preview: Pfade. True, wenn eingesetzt."""
    with open(gcode, "rb") as f:
        raw = f.read(65536)
    head = raw.decode("utf-8", "replace")
    if "; thumbnail begin" in head or "; thumbnail_PNG begin" in head or "; THUMBNAIL_BLOCK_START" in head:
        return False
    tail = _tail(gcode)
    sizes = wanted_sizes(tail)
    if not sizes:
        return False
    cols = re.search(r"^; filament_colour = (.*)$", tail, re.M)
    colours = [c.strip() for c in cols.group(1).split(";")] if cols else None
    blocks = ["; THUMBNAIL_BLOCK_START\n"]
    for w, h in sizes:
        r = progress_image.Renderer(preview, colours, size=(w, h), alpha=True, frame=False, shade=(0.8, 0.4))
        r.draw_to(len(r.layers) - 1)
        blocks.append(block(r.png(), w, h))
    blocks.append("; THUMBNAIL_BLOCK_END\n")
    text = "".join(blocks)
    # wie Orca: direkt nach dem Kopfblock (Zeile „; HEADER_BLOCK_END“), sonst ganz vorne – Position in Bytes
    i = raw.find(b"; HEADER_BLOCK_END")
    nl = raw.find(b"\n", i) if i >= 0 else -1
    prefix = raw[:nl + 1] if nl >= 0 else b""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(gcode), suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as out, open(gcode, "rb") as src:
            out.write(prefix)
            out.write(text.encode())
            src.seek(len(prefix))
            shutil.copyfileobj(src, out, 1024 * 1024)
        os.replace(tmp, gcode)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return True
