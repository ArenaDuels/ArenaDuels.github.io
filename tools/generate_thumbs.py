#!/usr/bin/env python3
"""
Draws the map-picker thumbnails (assets/thumbs/<id>.png) for every map
as isometric views built from the real map data and textures.

    pip install pillow      (and Node.js, to read the map definitions)
    python3 tools/generate_thumbs.py
"""
import json, math, os, subprocess
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MAPS = ["classic", "foundry", "ruins", "neon", "mansion"]
W, H, SS = 480, 300, 2          # output size, supersampling factor


def load_arenas():
    js = ("import('./js/arenas.js').then(m=>{const o={};for(const a of m.ARENA_LIST)"
          "o[a.id]=a;console.log(JSON.stringify(o))})")
    out = subprocess.check_output(["node", "-e", js], cwd=ROOT)
    return json.loads(out)


def mean_color(path):
    im = Image.open(os.path.join(ROOT, path.replace("./", ""))).convert("RGB")
    return tuple(im.resize((1, 1), Image.LANCZOS).getpixel((0, 0)))


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c)


def lift(c, amt):
    return tuple(min(255, int(v + (255 - v) * amt)) for v in c)


def render(a):
    img = Image.new("RGB", (W * SS, H * SS))
    d = ImageDraw.Draw(img)
    bg = a["bgColor"]
    top_c = ((bg >> 16) & 255, (bg >> 8) & 255, bg & 255)
    for y in range(H * SS):                       # soft vertical gradient background
        t = y / (H * SS)
        d.line([(0, y), (W * SS, y)], fill=shade(top_c, 1.35 - 0.55 * t))

    size = a["floorSize"]
    half = size / 2
    k = 0.93 * W * SS / (1.732 * size)
    cx, cy = W * SS / 2, H * SS * 0.60

    def P(x, y, z):
        return (cx + (x - z) * 0.866 * k, cy + (x + z) * 0.5 * k - y * k)

    col = {t: mean_color(p) for t, p in a["textures"].items()}
    glow = a.get("glow", {})

    def tint(t):
        c = col.get(t, (120, 120, 120))
        return lift(c, 0.25 * min(1, glow.get(t, 0))) if t in glow else c

    # floor + faint tile grid
    fc = tint("floor")
    d.polygon([P(-half, 0, -half), P(half, 0, -half), P(half, 0, half), P(-half, 0, half)], fill=shade(fc, 1.05))
    step = a.get("tile", {}).get("floor", 4)
    g = -half
    while g <= half + 0.01:
        d.line([P(g, 0, -half), P(g, 0, half)], fill=shade(fc, 0.8), width=SS)
        d.line([P(-half, 0, g), P(half, 0, g)], fill=shade(fc, 0.8), width=SS)
        g += step

    for f in a.get("floors", []):                  # lawns, marble, carpet runners...
        c = mean_color(a["textures"][f["type"]]) if f["type"] in a["textures"] else (120, 120, 120)
        x0, x1, z0, z1 = f["x"] - f["w"] / 2, f["x"] + f["w"] / 2, f["z"] - f["d"] / 2, f["z"] + f["d"] / 2
        d.polygon([P(x0, 0, z0), P(x1, 0, z0), P(x1, 0, z1), P(x0, 0, z1)], fill=c)

    boxes = []
    for w, h, dd, x, y, z in a["walls"]:
        if x < -1 or z < -1:                      # only the far walls, so you can see inside
            boxes.append(("wall", x - w / 2, x + w / 2, z - dd / 2, z + dd / 2, h))
    for p in a["props"]:
        boxes.append((p["type"], p["x"] - p["w"] / 2, p["x"] + p["w"] / 2, p["z"] - p["d"] / 2, p["z"] + p["d"] / 2, p["h"]))
    boxes.sort(key=lambda b: ((b[1] + b[2]) / 2 + (b[3] + b[4]) / 2, b[5]))

    for t, x0, x1, z0, z1, h in boxes:
        c = tint(t)
        edge = shade(c, 0.45)
        # +z face (left), +x face (right), then top
        left = [P(x0, 0, z1), P(x1, 0, z1), P(x1, h, z1), P(x0, h, z1)]
        right = [P(x1, 0, z1), P(x1, 0, z0), P(x1, h, z0), P(x1, h, z1)]
        top = [P(x0, h, z0), P(x1, h, z0), P(x1, h, z1), P(x0, h, z1)]
        d.polygon(left, fill=shade(c, 0.72), outline=edge)
        d.polygon(right, fill=shade(c, 0.52), outline=edge)
        d.polygon(top, fill=lift(c, 0.12), outline=edge)
        if t in glow and glow[t] >= 0.7:           # glowing surfaces get a bright rim
            d.line(top + [top[0]], fill=lift(c, 0.55), width=SS)

    img = img.resize((W, H), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.2, 60, 2))
    out = os.path.join(ROOT, "assets", "thumbs")
    os.makedirs(out, exist_ok=True)
    img.save(os.path.join(out, a["id"] + ".png"), optimize=True)
    print("  wrote thumbs/" + a["id"] + ".png")


if __name__ == "__main__":
    arenas = load_arenas()
    for m in MAPS:
        render(arenas[m])
