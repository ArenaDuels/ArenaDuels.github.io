#!/usr/bin/env python3
"""
Generates the seamless textures for every map (Classic Box, Foundry, Ruins, Neon Grid, Mansion).

    pip install numpy scipy pillow
    python3 tools/generate_textures.py

Writes, per map, into assets/textures/<map>/:
    <name>.jpg      colour (512x512, tiles seamlessly)
    <name>_h.png    height map used as a bump map (256x256) — only for
                    textures that have surface relief

Everything is procedural and seeded, so re-running gives the same images.
Tweak the colours/patterns below and re-run to restyle a map.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

S = 512
Y, X = np.mgrid[0:S, 0:S].astype(np.float32)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "textures")


# ------------------------------------------------------------------ helpers
def fbm(beta=2.0, seed=0):
    """Seamless noise in 0..1. Higher beta = smoother/blobbier, lower = grainier."""
    r = np.random.default_rng(seed)
    w = r.standard_normal((S, S)).astype(np.float32)
    f = np.fft.fftfreq(S)
    fx, fy = np.meshgrid(f, f)
    rad = np.sqrt(fx ** 2 + fy ** 2)
    rad[0, 0] = 1.0
    spec = np.fft.fft2(w) / (rad ** (beta / 2))
    spec[0, 0] = 0
    n = np.real(np.fft.ifft2(spec))
    lo, hi = np.percentile(n, [1, 99])
    return np.clip((n - lo) / (hi - lo), 0, 1).astype(np.float32)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def wrapd(a, period):
    """Distance from a to the nearest multiple of `period`."""
    d = np.mod(a, period)
    return np.minimum(d, period - d)


def mix(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


def rgb(r, g, b):
    return np.array([r, g, b], np.float32)


def voronoi(n, seed):
    r = np.random.default_rng(seed)
    pts = r.random((n, 2)) * S
    d1 = np.full((S, S), 1e9, np.float32)
    d2 = np.full((S, S), 1e9, np.float32)
    ident = np.zeros((S, S), np.int32)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(X - px); dx = np.minimum(dx, S - dx)
        dy = np.abs(Y - py); dy = np.minimum(dy, S - dy)
        d = np.hypot(dx, dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        ident = np.where(closer, i, ident)
        d1 = np.where(closer, d, d1)
    return d1, d2, ident


def block_rows(seed, row_heights, wmin, wmax):
    """Running-bond masonry. Returns (block id, distance to nearest block edge in px)."""
    r = np.random.default_rng(seed)
    rows, tot = [], 0
    while tot < S:
        h = int(r.choice(row_heights))
        if S - tot - h < min(row_heights):
            h = S - tot
        rows.append(h)
        tot += h
    bid = np.zeros((S, S), np.int32)
    edge = np.zeros((S, S), np.float32)
    y0, counter = 0, 0
    for h in rows:
        widths, tw = [], 0
        while tw < S:
            w = int(r.integers(wmin, wmax + 1))
            if S - tw - w < wmin:
                w = S - tw
            widths.append(w)
            tw += w
        edges = np.concatenate([[0], np.cumsum(widths)])
        off = int(r.integers(0, S))
        xs = np.mod(np.arange(S) - off, S)
        idx = np.searchsorted(edges, xs, side="right") - 1
        left = xs - edges[idx]
        right = edges[idx + 1] - xs
        yy = np.arange(y0, y0 + h)
        top = yy - y0
        bot = y0 + h - yy
        e = np.minimum(np.minimum(left[None, :], right[None, :]), np.minimum(top[:, None], bot[:, None]))
        edge[y0:y0 + h] = e
        bid[y0:y0 + h] = counter + idx[None, :]
        counter += len(widths)
        y0 += h
    return bid, edge


def circle(cx, cy, r):
    dx = np.abs(X - cx); dx = np.minimum(dx, S - dx)
    dy = np.abs(Y - cy); dy = np.minimum(dy, S - dy)
    return smooth(r + 1.0, r - 1.0, np.hypot(dx, dy))


def scratches(seed, n=40, length=(30, 120)):
    r = np.random.default_rng(seed)
    img = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(img)
    for _ in range(n):
        x, y = r.integers(10, S - 10), r.integers(10, S - 10)
        a = r.uniform(0, np.pi)
        l = r.uniform(*length)
        d.line([(x, y), (min(S - 2, max(1, x + np.cos(a) * l)), min(S - 2, max(1, y + np.sin(a) * l)))],
               fill=int(r.integers(60, 200)), width=1)
    return np.asarray(img, np.float32) / 255.0


def save(folder, name, color, height=None):
    path = os.path.join(OUT, folder)
    os.makedirs(path, exist_ok=True)
    img = Image.fromarray((np.clip(color, 0, 1) * 255).astype(np.uint8))
    img.save(os.path.join(path, name + ".jpg"), quality=90, subsampling=0, optimize=True)
    if height is not None:
        h = Image.fromarray((np.clip(height, 0, 1) * 255).astype(np.uint8))
        h.resize((256, 256), Image.LANCZOS).save(os.path.join(path, name + "_h.png"), optimize=True)
    print("  wrote", folder + "/" + name)


# ===================================================================== FOUNDRY
def foundry_floor():
    cell = 64
    cx = (X % cell) / cell - 0.5
    cy = (Y % cell) / cell - 0.5
    sgn = np.where(((X // cell).astype(int) + (Y // cell).astype(int)) % 2 == 0, 1.0, -1.0)
    ang = sgn * np.pi / 4
    a = cx * np.cos(ang) + cy * np.sin(ang)
    b = -cx * np.sin(ang) + cy * np.cos(ang)
    h = np.clip(1 - ((a / 0.40) ** 2 + (b / 0.105) ** 2), 0, 1) ** 0.6
    grime, fine = fbm(2.2, 1), fbm(0.8, 2)
    rust = smooth(0.58, 0.74, fbm(2.8, 3)) * smooth(0.3, 0.7, fine)
    base = (0.16 + 0.15 * h) * (0.6 + 0.55 * grime)
    col = base[..., None] * rgb(0.92, 0.96, 1.06)
    col = mix(col, rgb(0.42, 0.20, 0.09) * (0.6 + 0.6 * fine[..., None]), 0.8 * rust)
    col += (scratches(4)[..., None] * 0.10)
    return col, np.clip(0.12 + 0.7 * h + 0.18 * fine, 0, 1)


def foundry_wall():
    rib = 0.5 + 0.5 * np.cos(2 * np.pi * X / 32)
    pi_, pj = (X // 256).astype(int), (Y // 256).astype(int)
    tones = 0.85 + 0.3 * np.random.default_rng(10).random((2, 2))
    tone = tones[pj, pi_]
    streak = ndi.uniform_filter1d(fbm(1.2, 11), size=90, axis=0, mode="wrap")
    streak = (streak - streak.min()) / (streak.max() - streak.min())
    rustm = smooth(0.5, 0.72, streak * 0.75 + fbm(2.6, 12) * 0.45)
    seam = smooth(5, 1.5, np.minimum(wrapd(X, 256), wrapd(Y, 256)))
    base = rgb(0.32, 0.35, 0.34) * (0.5 + 0.5 * rib[..., None]) * tone[..., None]
    base *= (1 - 0.6 * seam[..., None])
    riv = np.zeros((S, S), np.float32)
    for xs in (14, 242, 270, 498):
        riv = np.maximum(riv, smooth(5, 2.5, np.hypot(X - xs, (Y % 32) - 16)))
    for ys in (14, 242, 270, 498):
        riv = np.maximum(riv, smooth(5, 2.5, np.hypot((X % 32) - 16, Y - ys)))
    base = mix(base, rgb(0.55, 0.57, 0.56), 0.7 * riv)
    col = mix(base, rgb(0.45, 0.22, 0.09) * (0.65 + 0.5 * fbm(0.9, 13)[..., None]), 0.85 * rustm)
    col *= 0.7 + 0.5 * fbm(2.0, 14)[..., None]
    return col, np.clip(0.15 + 0.5 * rib - 0.25 * seam + 0.3 * riv + 0.1 * fbm(0.9, 13), 0, 1)


def foundry_crate():
    border = np.minimum(np.minimum(X, S - 1 - X), np.minimum(Y, S - 1 - Y))
    frame = smooth(52, 44, border)
    brace = np.maximum(smooth(24, 14, np.abs(X - Y) / 1.414), smooth(24, 14, np.abs(X + Y - S) / 1.414)) * (1 - frame)
    chips = smooth(0.55, 0.7, fbm(1.5, 20))
    wear = fbm(2.4, 21)
    paint = rgb(0.78, 0.42, 0.12)
    panel = paint * (0.75 + 0.35 * wear[..., None])
    col = mix(panel, paint * 0.62, np.maximum(frame, brace) * 0.7)
    col = mix(col, rgb(0.12, 0.11, 0.10), 0.85 * chips * (0.4 + 0.6 * np.maximum(frame, brace)))
    for cx_ in (28, S - 29):
        for cy_ in (28, S - 29):
            col = mix(col, rgb(0.5, 0.5, 0.48), 0.8 * circle(cx_, cy_, 9))
    col += scratches(22, 30)[..., None] * 0.12
    return col, np.clip(0.3 + 0.35 * frame + 0.3 * brace - 0.25 * chips, 0, 1)


def foundry_column():
    seam = smooth(4, 1, wrapd(Y, 128))
    weld = smooth(5, 1.5, wrapd(X, 256))
    brushed = ndi.uniform_filter1d(fbm(0.8, 30), size=40, axis=1, mode="wrap")
    brushed = (brushed - brushed.min()) / (brushed.max() - brushed.min())
    plate = (Y // 128).astype(int) * 2 + (X // 256).astype(int)
    tone = (0.85 + 0.3 * np.random.default_rng(31).random(8))[plate]
    col = rgb(0.30, 0.33, 0.38) * (0.7 + 0.4 * brushed[..., None]) * tone[..., None]
    col *= (1 - 0.65 * np.maximum(seam, weld)[..., None])
    riv = np.zeros((S, S), np.float32)
    for yy in (14, 114, 142, 242, 270, 370, 398, 498):
        riv = np.maximum(riv, smooth(5, 2.5, np.hypot(wrapd(X, 32) - 16 + 16 * 0, Y - yy)))
    col = mix(col, rgb(0.55, 0.57, 0.6), 0.5 * riv)
    rust = smooth(0.58, 0.75, fbm(2.8, 32)) * (0.4 + 0.6 * seam)
    col = mix(col, rgb(0.40, 0.19, 0.08), 0.7 * rust)
    col *= 0.75 + 0.4 * fbm(2.2, 33)[..., None]
    return col, np.clip(0.4 - 0.3 * np.maximum(seam, weld) + 0.3 * riv + 0.15 * brushed, 0, 1)


def foundry_plinth():
    r = np.random.default_rng(40)
    joint = smooth(4, 1, np.minimum(wrapd(X, 256), wrapd(Y, 256)))
    speck = fbm(0.6, 41)
    stain = smooth(0.6, 0.78, fbm(2.6, 42))
    slab = (0.78 + 0.3 * r.random((2, 2)))[(Y // 256).astype(int), (X // 256).astype(int)]
    col = rgb(0.40, 0.40, 0.38) * (0.7 + 0.5 * speck[..., None]) * slab[..., None]
    col *= (1 - 0.7 * joint[..., None])
    col = mix(col, rgb(0.10, 0.09, 0.08), 0.55 * stain)
    col *= 0.8 + 0.35 * fbm(2.2, 43)[..., None]
    return col, np.clip(0.55 + 0.25 * speck - 0.4 * joint, 0, 1)


def foundry_barrier():
    stripe = (((X + Y) // 48).astype(int) % 2).astype(np.float32)
    band = np.maximum(smooth(104, 96, Y), smooth(S - 104, S - 96, Y))  # bottom + top bands (v=0 is the floor)
    hazard = mix(rgb(0.92, 0.72, 0.05), rgb(0.06, 0.06, 0.06), stripe)
    concrete = rgb(0.46, 0.46, 0.44) * (0.7 + 0.5 * fbm(0.7, 50)[..., None]) * (0.8 + 0.3 * fbm(2.4, 51)[..., None])
    col = mix(concrete, hazard * (0.8 + 0.3 * fbm(1.5, 52)[..., None]), band)
    col = mix(col, rgb(0.08, 0.07, 0.06), 0.6 * smooth(0.62, 0.8, fbm(2.8, 53)) * (1 - band))
    edge = smooth(100, 92, Y) * smooth(S - 100, S - 92, S - Y) * 0
    return col, None


def foundry_furnace():
    d1, d2, ident = voronoi(48, 60)
    crack = smooth(9, 0, d2 - d1)
    crust = rgb(0.10, 0.07, 0.06) * (0.6 + 0.9 * fbm(1.2, 61)[..., None])
    heat = smooth(0.45, 0.8, fbm(2.4, 62))
    glow = np.clip(crack * 1.2 + heat * 0.18, 0, 1)
    hot = mix(rgb(1.0, 0.30, 0.04), rgb(1.0, 0.86, 0.35), glow ** 2)
    col = mix(crust, hot, glow)
    return col, None


# ======================================================================= RUINS
def ruins_floor():
    d1, d2, ident = voronoi(26, 100)
    joint = smooth(6, 2, d2 - d1)               # 1 in the joints
    r = np.random.default_rng(101)
    tone = (0.82 + 0.3 * r.random(26))[ident]
    sand = rgb(0.80, 0.68, 0.48)
    paver = rgb(0.66, 0.55, 0.40) * tone[..., None] * (0.8 + 0.4 * fbm(1.0, 102)[..., None])
    col = mix(paver, rgb(0.42, 0.34, 0.24), joint * 0.85)
    drift = smooth(0.5, 0.72, fbm(2.8, 103))
    col = mix(col, sand * (0.9 + 0.2 * fbm(0.6, 104)[..., None]), 0.8 * drift)
    col *= 0.85 + 0.25 * fbm(2.2, 105)[..., None]
    return col, np.clip(0.75 - 0.5 * joint + 0.15 * drift + 0.1 * fbm(0.8, 106), 0, 1)


def ruins_wall():
    bid, edge = block_rows(110, [44, 52, 60, 68, 76], 90, 190)
    r = np.random.default_rng(111)
    tone = (0.82 + 0.34 * r.random(bid.max() + 1))[bid]
    mortar = smooth(4, 1.2, edge)
    chip = smooth(0.62, 0.78, fbm(1.4, 112)) * smooth(18, 2, edge)
    wear = fbm(2.4, 113)
    stone = rgb(0.74, 0.60, 0.42) * tone[..., None] * (0.75 + 0.4 * wear[..., None]) * (0.9 + 0.2 * fbm(0.7, 114)[..., None])
    col = mix(stone, rgb(0.40, 0.33, 0.25), mortar * 0.9)
    col = mix(col, stone * 0.55, chip * 0.7)
    d1, d2, _ = voronoi(70, 115)
    col *= (1 - 0.35 * smooth(2.5, 0.5, d2 - d1) * smooth(0.55, 0.75, fbm(2.0, 116)))[..., None]   # hairline cracks
    return col, np.clip(0.85 - 0.6 * mortar + 0.15 * wear - 0.2 * chip, 0, 1)


def ruins_pillar():
    flute = 0.5 + 0.5 * np.cos(2 * np.pi * X / 32)
    seam = smooth(3.5, 1, wrapd(Y, 128))
    drum = (0.88 + 0.2 * np.random.default_rng(120).random(4))[(Y // 128).astype(int)]
    stain = ndi.uniform_filter1d(fbm(1.2, 121), size=100, axis=0, mode="wrap")
    stain = (stain - stain.min()) / (stain.max() - stain.min())
    col = rgb(0.84, 0.78, 0.64) * (0.55 + 0.5 * flute[..., None]) * drum[..., None]
    col *= (1 - 0.55 * seam[..., None])
    col = mix(col, rgb(0.36, 0.34, 0.20), 0.45 * smooth(0.6, 0.8, stain))
    col *= 0.8 + 0.3 * fbm(2.2, 122)[..., None]
    chip = smooth(0.66, 0.8, fbm(1.4, 123))
    col = mix(col, col * 0.6, chip * 0.6)
    return col, np.clip(0.2 + 0.7 * flute - 0.2 * seam - 0.15 * chip, 0, 1)


def ruins_temple():
    bid, edge = block_rows(130, [128], 112, 200)
    r = np.random.default_rng(131)
    tone = (0.84 + 0.28 * r.random(bid.max() + 1))[bid]
    joint = smooth(5, 1.5, edge)
    worn = fbm(2.6, 132)
    stone = rgb(0.64, 0.60, 0.52) * tone[..., None] * (0.75 + 0.45 * worn[..., None]) * (0.9 + 0.2 * fbm(0.7, 133)[..., None])
    moss_m = np.clip(smooth(0.55, 0.8, fbm(2.4, 134)) * 0.8 + joint * smooth(0.4, 0.6, fbm(1.6, 135)), 0, 1)
    col = mix(stone, rgb(0.20, 0.17, 0.12), joint * 0.85)
    col = mix(col, rgb(0.24, 0.38, 0.14) * (0.7 + 0.6 * fbm(0.8, 136)[..., None]), moss_m * 0.75)
    return col, np.clip(0.8 - 0.55 * joint + 0.15 * worn, 0, 1)


def ruins_obelisk():
    r = np.random.default_rng(140)
    base = rgb(0.075, 0.075, 0.095) * (0.6 + 0.8 * fbm(2.0, 141)[..., None])
    vein = smooth(0.7, 0.86, fbm(1.6, 142))
    base = mix(base, rgb(0.16, 0.15, 0.2), vein * 0.6)
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    for (y0, y1) in ((80, 150), (300, 370)):
        d.rectangle([0, y0 - 6, S, y0 - 3], fill=255)
        d.rectangle([0, y1 + 3, S, y1 + 6], fill=255)
        for gx in range(0, S, 32):
            for _ in range(int(r.integers(2, 5))):
                kind = int(r.integers(0, 4))
                x0 = gx + int(r.integers(4, 12)); x1 = gx + int(r.integers(20, 28))
                ya = int(r.integers(y0 + 4, y0 + 30)); yb = int(r.integers(y0 + 36, y1 - 4))
                if kind == 0:
                    d.line([(x0, ya), (x1, yb)], fill=255, width=2)
                elif kind == 1:
                    d.ellipse([x0, ya, x1, ya + (x1 - x0)], outline=255, width=2)
                elif kind == 2:
                    d.line([((x0 + x1) // 2, y0 + 4), ((x0 + x1) // 2, y1 - 4)], fill=255, width=2)
                    d.line([(x0, (y0 + y1) // 2), (x1, (y0 + y1) // 2)], fill=255, width=2)
                else:
                    d.polygon([(x0, yb), (x1, yb), ((x0 + x1) // 2, ya)], outline=255)
    d.rectangle([S // 2 - 3, 0, S // 2 + 3, S], fill=170)
    glyph = np.asarray(m.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255.0
    gold = rgb(0.95, 0.72, 0.22)
    col = mix(base, gold * (0.8 + 0.3 * fbm(0.9, 143)[..., None]), np.clip(glyph * 1.2, 0, 1))
    return col, None


# ================================================================ NEON GRID
def traces(seed, n=70):
    r = np.random.default_rng(seed)
    img = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(img)
    for _ in range(n):
        x = int(r.integers(1, S // 16 - 1)) * 16
        y = int(r.integers(1, S // 16 - 1)) * 16
        for _ in range(int(r.integers(2, 6))):
            dx, dy = [(1, 0), (-1, 0), (0, 1), (0, -1)][int(r.integers(0, 4))]
            ln = int(r.integers(1, 5)) * 16
            nx = int(np.clip(x + dx * ln, 8, S - 8)); ny = int(np.clip(y + dy * ln, 8, S - 8))
            d.line([(x, y), (nx, ny)], fill=int(r.integers(120, 255)), width=2)
            x, y = nx, ny
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=255)
    return np.asarray(img, np.float32) / 255.0


CYAN = rgb(0.0, 0.85, 1.0)
MAGENTA = rgb(1.0, 0.1, 0.65)


def neon_floor():
    base = rgb(0.025, 0.032, 0.055) * (0.8 + 0.5 * fbm(2.0, 200)[..., None])
    panel = (((X // 128).astype(int) + (Y // 128).astype(int)) % 2).astype(np.float32)
    base = base * (0.9 + 0.2 * panel[..., None])
    thin = smooth(2.2, 0.8, np.minimum(wrapd(X, 128), wrapd(Y, 128)))
    thick = smooth(5, 2, np.minimum(wrapd(X, 512), wrapd(Y, 512)))
    tr = traces(201) * smooth(0.0, 1.0, fbm(1.6, 202) * 1.4)
    glow = np.clip(thin * 0.45 + thick * 1.0 + tr * 0.55, 0, 1)
    col = base + CYAN * glow[..., None]
    return np.clip(col, 0, 1), None


def neon_wall():
    pw, ph = 256, 128
    bev = np.minimum(np.minimum(wrapd(X, pw), wrapd(Y, ph)), 10)
    base = rgb(0.035, 0.045, 0.085) * (0.75 + 0.5 * fbm(2.0, 210)[..., None])
    inset = smooth(2, 5, np.minimum(wrapd(X, pw), wrapd(Y, ph)))
    base = base * (0.6 + 0.4 * inset[..., None])
    row = (Y // ph).astype(int)
    strip_c = np.where(row % 2 == 0, 0.0, 1.0)[..., None]
    sy = np.abs((Y % ph) - 92)
    strip = (smooth(4, 1.5, sy) + 0.35 * smooth(18, 2, sy))
    strip_col = mix(CYAN, MAGENTA, strip_c)
    led = np.zeros((S, S), np.float32)
    for lx in range(24, S, 64):
        led = np.maximum(led, circle(lx, 38 + 128 * 0, 3))
        for ly in (38, 166, 294, 422):
            led = np.maximum(led, circle(lx, ly, 2.5))
    col = base + strip_col * strip[..., None] * 0.9 + rgb(0.2, 1.0, 0.5) * led[..., None] * 0.5
    return np.clip(col, 0, 1), np.clip(0.3 + 0.7 * inset, 0, 1)


def neon_platform():
    base = rgb(0.06, 0.06, 0.08) * (0.8 + 0.4 * fbm(1.8, 220)[..., None])
    diag = np.maximum(smooth(2.2, 0.8, np.abs(np.mod(X + Y, 128) - 64) - 62 + 0),
                      smooth(2.2, 0.8, np.abs(np.mod(X - Y, 128) - 64) - 62 + 0))
    diag = np.maximum(smooth(2.5, 0.8, wrapd(X + Y, 128)), smooth(2.5, 0.8, wrapd(X - Y, 128)))
    seam = smooth(5, 2, np.minimum(wrapd(X, 256), wrapd(Y, 256)))
    glow = np.clip(diag * 0.3 + seam * 1.0, 0, 1)
    col = base + MAGENTA * glow[..., None]
    return np.clip(col, 0, 1), None


def neon_core():
    r = np.random.default_rng(230)
    col = np.zeros((S, S, 3), np.float32) + rgb(0.015, 0.025, 0.04)
    col *= (0.8 + 0.5 * fbm(2.0, 231)[..., None])
    stream = np.zeros((S, S), np.float32)
    for x in range(8, S, 16):
        y = int(r.integers(0, S))
        while y < S + S:
            seg = int(r.integers(10, 80)); gap = int(r.integers(8, 70))
            br = float(r.uniform(0.35, 1.0))
            ys = np.arange(y, y + seg) % S
            stream[ys, x:x + 3] = np.maximum(stream[ys, x:x + 3], br)
            y += seg + gap
            if y > S * 2:
                break
    scan = 0.85 + 0.15 * (np.mod(Y, 4) < 2)
    ring = np.maximum(smooth(6, 1, wrapd(Y, 256)), 0.25 * smooth(30, 2, wrapd(Y, 256)))
    teal = mix(CYAN, rgb(0.7, 1.0, 1.0), stream ** 3)
    col = col + teal * (stream * 0.9)[..., None] * scan[..., None] + CYAN * ring[..., None]
    return np.clip(col, 0, 1), None


def neon_pylon():
    base = rgb(0.04, 0.04, 0.07) * (0.8 + 0.4 * fbm(2.0, 240)[..., None])
    x = np.abs(X - S / 2)
    core = smooth(20, 4, x)
    halo = smooth(90, 10, x) * 0.35
    gap = 1 - smooth(10, 3, wrapd(Y - 64, 128))
    seg = np.clip(core * gap + halo * (0.5 + 0.5 * gap), 0, 1)
    edge = smooth(5, 1.5, np.minimum(X, S - 1 - X))
    col = base + CYAN * seg[..., None] + rgb(0.0, 0.5, 0.7) * edge[..., None] * 0.6
    return np.clip(col, 0, 1), None


# ============================================================== CLASSIC BOX
TEAL = rgb(0.05, 0.66, 0.58)


def classic_floor():
    tone = (0.88 + 0.22 * np.random.default_rng(300).random((4, 4)))[(Y // 128).astype(int), (X // 128).astype(int)]
    grout = smooth(3.5, 1.0, np.minimum(wrapd(X, 128), wrapd(Y, 128)))
    wear = fbm(2.4, 301)
    col = rgb(0.60, 0.62, 0.64) * tone[..., None] * (0.78 + 0.4 * wear[..., None]) * (0.92 + 0.16 * fbm(0.6, 302)[..., None])
    col *= (1 - 0.55 * grout[..., None])
    col += scratches(303, 70, (20, 90))[..., None] * 0.07
    return col, np.clip(0.8 - 0.5 * grout + 0.1 * fbm(0.7, 304), 0, 1)


def classic_wall():
    # row 0 of the image is the TOP of the wall: kick-plate and stripe sit at the bottom
    seam = smooth(3.5, 1.0, wrapd(X, 256))
    panel_tone = (0.9 + 0.15 * np.random.default_rng(310).random(2))[(X // 256).astype(int)]
    col = rgb(0.82, 0.84, 0.86) * panel_tone[..., None] * (0.88 + 0.2 * fbm(2.4, 311)[..., None])
    col *= (1 - 0.5 * seam[..., None])
    stripe = smooth(396, 392, Y) * smooth(356, 360, Y) * 0 + ((Y > 348) & (Y < 392)).astype(np.float32)
    col = mix(col, TEAL * (0.9 + 0.15 * fbm(1.2, 312)[..., None]), stripe)
    kick = (Y > 440).astype(np.float32)
    col = mix(col, rgb(0.20, 0.22, 0.25) * (0.8 + 0.4 * fbm(1.0, 313)[..., None]), kick)
    col = mix(col, col * 0.7, ((Y > 392) & (Y <= 440)).astype(np.float32) * 0.0)
    for bx in (16, 240, 272, 496):
        for by in (16, 256, 496):
            col = mix(col, rgb(0.55, 0.57, 0.6), 0.7 * circle(bx, by, 4))
    col *= 0.9 + 0.2 * smooth(0.6, 0.85, fbm(2.6, 314))[..., None] * 0 + 0.0
    return col, np.clip(0.8 - 0.4 * seam + 0.2 * stripe - 0.15 * kick, 0, 1)


def classic_barrier():
    diag = (((X + Y) // 40).astype(int) % 2).astype(np.float32)
    top = (Y < 72).astype(np.float32)
    bottom = (Y > S - 40).astype(np.float32)
    concrete = rgb(0.56, 0.57, 0.58) * (0.78 + 0.4 * fbm(2.2, 320)[..., None]) * (0.9 + 0.2 * fbm(0.6, 321)[..., None])
    col = mix(concrete, mix(TEAL, rgb(0.92, 0.94, 0.95), diag) * (0.85 + 0.2 * fbm(1.4, 322)[..., None]), top)
    col = mix(col, TEAL * 0.8, bottom)
    seam = smooth(3, 1, wrapd(X, 256)) * (1 - top)
    col *= (1 - 0.4 * seam[..., None])
    return col, None


def classic_pillar():
    band = (((Y // 128).astype(int)) % 2).astype(np.float32)
    seam = smooth(3.5, 1.0, wrapd(Y, 128))
    brushed = ndi.uniform_filter1d(fbm(0.8, 330), size=36, axis=1, mode="wrap")
    brushed = (brushed - brushed.min()) / (brushed.max() - brushed.min())
    col = mix(rgb(0.78, 0.80, 0.83), TEAL * 0.9, band) * (0.75 + 0.35 * brushed[..., None])
    col *= (1 - 0.6 * seam[..., None])
    riv = np.zeros((S, S), np.float32)
    for yy in (10, 118, 138, 246, 266, 374, 394, 502):
        riv = np.maximum(riv, smooth(5, 2.5, np.hypot(wrapd(X, 32) - 0, Y - yy) * 0 + np.hypot((X % 32) - 16, Y - yy)))
    col = mix(col, rgb(0.55, 0.57, 0.6), 0.6 * riv)
    return col, np.clip(0.5 - 0.3 * seam + 0.25 * riv + 0.12 * brushed, 0, 1)


def classic_crate():
    border = np.minimum(np.minimum(X, S - 1 - X), np.minimum(Y, S - 1 - Y))
    frame = smooth(50, 42, border)
    brace = np.maximum(smooth(22, 12, np.abs(X - Y) / 1.414), smooth(22, 12, np.abs(X + Y - S) / 1.414)) * (1 - frame)
    wear = fbm(2.4, 340)
    panel = rgb(0.84, 0.86, 0.88) * (0.82 + 0.3 * wear[..., None])
    col = mix(panel, TEAL * (0.85 + 0.2 * fbm(1.2, 341)[..., None]), np.maximum(frame, brace * 0.85))
    for cx_ in (26, S - 27):
        for cy_ in (26, S - 27):
            col = mix(col, rgb(0.85, 0.87, 0.9), 0.85 * circle(cx_, cy_, 8))
    stencil = ((np.abs(X - S / 2) < 34) & (np.abs(Y - S / 2) < 34) & ~((np.abs(X - S / 2) < 22) & (np.abs(Y - S / 2) < 22))).astype(np.float32)
    col = mix(col, rgb(0.9, 0.92, 0.94), stencil * 0.0)
    col += scratches(342, 24)[..., None] * 0.1
    return col, np.clip(0.3 + 0.35 * frame + 0.3 * brace, 0, 1)


# ================================================================== MANSION
def mansion_floor():
    d1, d2, ident = voronoi(170, 400)
    tone = (0.8 + 0.4 * np.random.default_rng(401).random(170))[ident]
    gap = smooth(5, 1.5, d2 - d1)
    col = rgb(0.52, 0.48, 0.42) * tone[..., None] * (0.8 + 0.35 * fbm(1.0, 402)[..., None])
    col = mix(col, rgb(0.12, 0.11, 0.09), gap * 0.85)
    col = mix(col, rgb(0.20, 0.30, 0.12), 0.35 * gap * smooth(0.55, 0.75, fbm(2.2, 403)))
    return col, np.clip(0.85 - 0.7 * gap + 0.1 * fbm(0.8, 404), 0, 1)


def mansion_marble():
    check = (((X // 128).astype(int) + (Y // 128).astype(int)) % 2).astype(np.float32)
    ridged = 1 - np.abs(2 * fbm(1.7, 410) - 1)
    vein = smooth(0.86, 0.97, ridged)
    white = rgb(0.92, 0.91, 0.88) * (0.92 + 0.1 * fbm(2.4, 411)[..., None])
    black = rgb(0.07, 0.07, 0.09) * (0.85 + 0.4 * fbm(2.4, 412)[..., None])
    col = mix(white, black, check)
    col = mix(col, np.where(check[..., None] > 0.5, rgb(0.55, 0.55, 0.58), rgb(0.62, 0.62, 0.64)), vein * 0.55)
    grout = smooth(2.2, 0.6, np.minimum(wrapd(X, 128), wrapd(Y, 128)))
    col = mix(col, rgb(0.45, 0.40, 0.30), grout * 0.7)
    return col, np.clip(0.9 - 0.6 * grout, 0, 1)


def mansion_carpet():
    fibre = 0.82 + 0.3 * fbm(0.5, 420)
    weave = 0.94 + 0.06 * np.sin(X * 1.6) * np.sin(Y * 1.6)
    red = rgb(0.42, 0.04, 0.08) * (fibre * weave)[..., None]
    gold = rgb(0.80, 0.62, 0.22)
    border = ((np.abs(X - 33) < 8) | (np.abs(X - (S - 33)) < 8)).astype(np.float32)
    thin = ((np.abs(X - 56) < 2.5) | (np.abs(X - (S - 56)) < 2.5)).astype(np.float32)
    col = mix(red, gold * (0.85 + 0.2 * fibre[..., None]), np.maximum(border, thin))
    img = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(img)
    for cy in (128, 384):
        d.polygon([(S // 2, cy - 92), (S // 2 + 70, cy), (S // 2, cy + 92), (S // 2 - 70, cy)], outline=255, width=7)
        d.polygon([(S // 2, cy - 46), (S // 2 + 35, cy), (S // 2, cy + 46), (S // 2 - 35, cy)], fill=255)
    motif = np.asarray(img.filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255.0
    col = mix(col, gold * (0.85 + 0.2 * fibre[..., None]), motif * 0.9)
    return col, None


def mansion_grass():
    base = rgb(0.13, 0.34, 0.10) * (0.7 + 0.6 * fbm(2.4, 430)[..., None])
    dry = smooth(0.6, 0.8, fbm(2.8, 431))
    base = mix(base, rgb(0.30, 0.38, 0.12), dry * 0.5)
    blades = ndi.uniform_filter1d(fbm(0.4, 432), size=7, axis=0, mode="wrap")
    blades = (blades - blades.min()) / (blades.max() - blades.min())
    col = base * (0.7 + 0.6 * blades[..., None])
    return col, np.clip(0.4 + 0.5 * blades, 0, 1)


def mansion_wall():
    # image row 0 = top of the wall; wainscot paneling is at the bottom
    wood_grain = ndi.uniform_filter1d(fbm(0.9, 440), size=50, axis=1, mode="wrap")
    wood_grain = (wood_grain - wood_grain.min()) / (wood_grain.max() - wood_grain.min())
    plaster = rgb(0.90, 0.85, 0.74) * (0.88 + 0.16 * fbm(2.6, 441)[..., None])
    # subtle damask lattice on the plaster
    lattice = np.maximum(smooth(2.2, 0.6, wrapd(X + Y, 128)), smooth(2.2, 0.6, wrapd(X - Y, 128))) * 0.07
    plaster = plaster * (1 - lattice[..., None])
    wood = rgb(0.30, 0.18, 0.10) * (0.7 + 0.5 * wood_grain[..., None])
    wain = (Y > 300).astype(np.float32)
    px, py = wrapd(X, 256), Y - 300
    panel = ((px > 28) & (px < 228 - 0) & (py > 26) & (Y < S - 26)).astype(np.float32)
    panel_in = ((px > 48) & (px < 208) & (py > 46) & (Y < S - 46)).astype(np.float32)
    wood = wood * (1 + 0.28 * panel_in[..., None] - 0.22 * (panel - panel_in)[..., None])
    col = mix(plaster, wood, wain)
    rail = ((Y > 286) & (Y <= 300)).astype(np.float32)
    col = mix(col, rgb(0.72, 0.58, 0.25), rail)
    cornice = (Y < 26).astype(np.float32)
    col = mix(col, plaster * 0.82, cornice)
    col = mix(col, rgb(0.72, 0.58, 0.25), ((Y > 22) & (Y < 28)).astype(np.float32))
    h = np.clip(0.55 + 0.25 * panel_in - 0.2 * (panel - panel_in) + 0.2 * rail, 0, 1)
    return col, h


def mansion_hedge():
    d1, d2, ident = voronoi(520, 450)
    tone = np.random.default_rng(451).random(520)[ident]
    leaf = rgb(0.08, 0.25, 0.07) + tone[..., None] * rgb(0.09, 0.28, 0.08)
    shade = smooth(0, 9, d1)
    col = leaf * (0.62 + 0.75 * (1 - shade)[..., None]) * (0.8 + 0.4 * fbm(2.4, 452)[..., None])
    col = mix(col, rgb(0.02, 0.06, 0.03), smooth(1.5, 0, d2 - d1) * 0.7)
    return col, np.clip(1 - shade * 0.8 + 0.1 * fbm(0.8, 453), 0, 1)


def mansion_column():
    flute = 0.5 + 0.5 * np.cos(2 * np.pi * X / 64)
    ridged = 1 - np.abs(2 * fbm(1.8, 460) - 1)
    vein = smooth(0.88, 0.98, ridged)
    col = rgb(0.93, 0.92, 0.88) * (0.82 + 0.2 * flute[..., None]) * (0.9 + 0.12 * fbm(2.4, 461)[..., None])
    col = mix(col, rgb(0.62, 0.62, 0.66), vein * 0.45)
    band = smooth(5, 1.5, wrapd(Y, 256))
    col = mix(col, rgb(0.76, 0.62, 0.28), band * 0.9)
    return col, np.clip(0.4 + 0.5 * flute, 0, 1)


def mansion_wood():
    noise = fbm(1.4, 470)
    rings = 0.5 + 0.5 * np.sin(2 * np.pi * (Y / 64 + 2.2 * noise))
    streak = ndi.uniform_filter1d(fbm(0.7, 471), size=70, axis=1, mode="wrap")
    streak = (streak - streak.min()) / (streak.max() - streak.min())
    plank = smooth(3, 0.8, wrapd(Y, 128))
    col = rgb(0.34, 0.20, 0.11) * (0.62 + 0.35 * rings[..., None]) * (0.8 + 0.4 * streak[..., None])
    col *= (1 - 0.6 * plank[..., None])
    return col, np.clip(0.5 + 0.3 * rings - 0.4 * plank, 0, 1)


def mansion_stone():
    bid, edge = block_rows(480, [128], 120, 210)
    tone = (0.85 + 0.25 * np.random.default_rng(481).random(bid.max() + 1))[bid]
    joint = smooth(4.5, 1.2, edge)
    wear = fbm(2.6, 482)
    col = rgb(0.70, 0.69, 0.65) * tone[..., None] * (0.78 + 0.4 * wear[..., None]) * (0.92 + 0.14 * fbm(0.7, 483)[..., None])
    col = mix(col, rgb(0.26, 0.25, 0.22), joint * 0.85)
    col = mix(col, rgb(0.28, 0.38, 0.18), 0.4 * smooth(0.66, 0.82, fbm(2.2, 484)) * (0.4 + 0.6 * joint))
    return col, np.clip(0.8 - 0.55 * joint + 0.15 * wear, 0, 1)


# ===================================================================== main
JOBS = {
    "foundry": [("floor", foundry_floor), ("wall", foundry_wall), ("crate", foundry_crate),
                ("column", foundry_column), ("plinth", foundry_plinth), ("barrier", foundry_barrier),
                ("furnace", foundry_furnace)],
    "ruins": [("floor", ruins_floor), ("wall", ruins_wall), ("pillar", ruins_pillar),
              ("temple", ruins_temple), ("obelisk", ruins_obelisk)],
    "neon": [("floor", neon_floor), ("wall", neon_wall), ("platform", neon_platform),
             ("core", neon_core), ("pylon", neon_pylon)],
    "classic": [("floor", classic_floor), ("wall", classic_wall), ("barrier", classic_barrier),
                ("pillar", classic_pillar), ("crate", classic_crate)],
    "mansion": [("floor", mansion_floor), ("marble", mansion_marble), ("carpet", mansion_carpet),
                ("grass", mansion_grass), ("wall", mansion_wall), ("hedge", mansion_hedge),
                ("column", mansion_column), ("wood", mansion_wood), ("stone", mansion_stone)],
}

if __name__ == "__main__":
    for folder, jobs in JOBS.items():
        print(folder)
        for name, fn in jobs:
            color, height = fn()
            save(folder, name, color, height)
