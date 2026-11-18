"""Seamless procedural textures for the Backstreets (alley) arena.

Reuses the building blocks from the Glacier generator. Each texture function returns
(albedo, height). Run:  python3 tools/alley/texgen.py assets/textures/alley
"""
import os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "glacier"))
from texgen import (N, grid, fbm, blur, voronoi, mix, col, smoothstep, stripes, discs, grime,  # noqa: E402
                    streaks, scratches, finish, tex_crate, corrugated)

PX = N / 8.0  # pixels per metre for the 8 m building tiles


def rect(x, y, x0, y0, x1, y1):
    return ((x >= x0) & (x < x1) & (y >= y0) & (y < y1)).astype(np.float32)


# ------------------------------------------------------------------- facades

def brick_base(rng, c1, c2, mortar, bw=16, bh=8):
    x, y = grid()
    row = (y // bh).astype(int)
    off = (row % 2) * (bw // 2)
    colx = ((x + off) // bw).astype(int)
    rnd = rng.random((N // bh, N // bw)).astype(np.float32)
    tint = rnd[row % (N // bh), colx % (N // bw)]
    a = mix(np.array(c1, np.float32), np.array(c2, np.float32), tint[:, :, None] if False else tint)
    m = ((np.mod(x + off, bw) < 1.6) | (np.mod(y, bh) < 1.6)).astype(np.float32)
    a = mix(a, col(*mortar), m * 0.95)
    a = a * (0.9 + 0.2 * fbm(N, 6, 4, rng))[:, :, None]
    h = 0.75 - m * 0.55 + tint * 0.12
    return a, h


def windows(a, h, rng, glass_a, glass_b, frame, sill, lit_chance=0.25, shutters=None, arched=False):
    """2x2 grid of windows per tile (each cell is 4 m)."""
    x, y = grid()
    ww, wh = 92, 132
    for j in range(2):
        for i in range(2):
            cx, cy = 128 + 256 * i, 118 + 256 * j
            x0, x1, y0, y1 = cx - ww // 2, cx + ww // 2, cy - wh // 2, cy + wh // 2
            fr = rect(x, y, x0 - 9, y0 - 9, x1 + 9, y1 + 9)
            gl = rect(x, y, x0, y0, x1, y1)
            lit = rng.random() < lit_chance
            t = np.clip((y - y0) / wh, 0, 1)
            if lit:
                g = mix(col(250, 214, 140), col(206, 150, 78), t)
            else:
                g = mix(col(*glass_a), col(*glass_b), t)
                streak = np.exp(-((x - x0 - ww * 0.3 + (y - y0) * 0.35) / 7.0) ** 2) * 0.35
                g = mix(g, col(190, 210, 228), streak * gl)
            # mullion cross
            mull = (rect(x, y, cx - 2, y0, cx + 2, y1) + rect(x, y, x0, cy - 2, x1, cy + 2)).clip(0, 1)
            a = mix(a, col(*frame), fr)
            a = mix(a, g, gl)
            a = mix(a, col(*frame), mull * gl)
            if shutters:
                for sx in (x0 - 9 - 34, x1 + 9):
                    s = rect(x, y, sx, y0 - 9, sx + 34, y1 + 9)
                    slats = stripes(y, 8, 5, 1.0)
                    a = mix(a, col(*shutters), s)
                    a = a * (1 - 0.25 * s * (1 - slats))[:, :, None]
                    h = h + s * 0.15
            # sill + lintel
            sl = rect(x, y, x0 - 16, y1 + 9, x1 + 16, y1 + 19)
            li = rect(x, y, x0 - 14, y0 - 22, x1 + 14, y0 - 9)
            a = mix(a, col(*sill), np.maximum(sl, li))
            h = h + fr * (-0.30) + gl * (-0.10) + np.maximum(sl, li) * 0.35
    return a, h


def tex_brick(rng, c1=(150, 60, 44), c2=(190, 96, 66), mortar=(176, 170, 158), lit=0.25):
    a, h = brick_base(rng, c1, c2, mortar)
    # soot streaks and damp
    a = mix(a, col(40, 34, 30), streaks(N, rng, 30, 0.5, 1.0) * 0.4)
    a = mix(a, col(84, 70, 60), grime(N, rng, 1.0, 4) * 0.35)
    a, h = windows(a, h, rng, (40, 58, 82), (22, 30, 46), (214, 208, 196), (190, 184, 172), lit)
    return finish(a, h, rng, 3.0)


def tex_wall(rng):
    a, h = brick_base(rng, (96, 62, 52), (130, 86, 70), (140, 134, 126))
    a = mix(a, col(30, 28, 26), streaks(N, rng, 40, 0.6, 1.0) * 0.5)
    a = mix(a, col(60, 54, 48), grime(N, rng, 1.0, 3) * 0.45)
    a, h = windows(a, h, rng, (34, 46, 62), (18, 24, 36), (60, 56, 52), (120, 114, 104), 0.2)
    return finish(a, h, rng, 3.0)


def tex_stucco(rng):
    base = fbm(N, 4, 6, rng)
    a = mix(col(214, 196, 160), col(236, 222, 190), base)
    dirt = grime(N, rng, 1.0, 3) * smoothstep(0.4, 0.8, fbm(N, 6, 4, rng))
    a = mix(a, col(150, 130, 100), dirt * 0.5)
    a = mix(a, col(70, 60, 50), streaks(N, rng, 34, 0.55, 1.0) * 0.35)
    # a few crumbled patches showing brick underneath
    f1, f2, _ = voronoi(N, 5, rng, 1.0)
    crack = 1 - smoothstep(0.0, 1.6, f2 - f1)
    a = mix(a, col(120, 104, 86), crack * 0.35)
    # horizontal band between floors
    x, y = grid()
    band = rect(x, y, 0, 244, N, 268) + rect(x, y, 0, 500, N, 512) + rect(x, y, 0, 0, N, 12)
    band = band.clip(0, 1)
    a = mix(a, col(190, 172, 140), band)
    h = 0.55 * base + 0.2 * (1 - crack) + band * 0.25
    a, h = windows(a, h, rng, (52, 72, 88), (28, 38, 50), (240, 234, 220), (210, 200, 180), 0.25, shutters=(70, 96, 78))
    return finish(a, h, rng, 3.0)


def tex_brownstone(rng):
    x, y = grid()
    # big ashlar blocks
    bw, bh = 64, 40
    row = (y // bh).astype(int)
    off = (row % 2) * (bw // 2)
    cx = ((x + off) // bw).astype(int)
    rnd = rng.random((N // bh + 1, N // bw)).astype(np.float32)
    tint = rnd[row % (N // bh), cx % (N // bw)]
    a = mix(col(104, 82, 70), col(142, 112, 92), tint)
    m = ((np.mod(x + off, bw) < 2.5) | (np.mod(y, bh) < 2.5)).astype(np.float32)
    a = mix(a, col(60, 50, 44), m * 0.9)
    a = a * (0.88 + 0.24 * fbm(N, 5, 5, rng))[:, :, None]
    a = mix(a, col(28, 26, 24), streaks(N, rng, 34, 0.6, 1.0) * 0.4)
    h = 0.7 - m * 0.5 + tint * 0.1
    a, h = windows(a, h, rng, (36, 48, 66), (16, 22, 34), (46, 40, 36), (196, 184, 164), 0.3)
    return finish(a, h, rng, 3.0)


# -------------------------------------------------------------------- ground

def tex_floor(rng):
    """Pavement: 2 m concrete slabs, stains, cracks, gum."""
    x, y = grid()
    s = 128
    ix, iy = (x // s).astype(int), (y // s).astype(int)
    rnd = rng.random((N // s, N // s)).astype(np.float32)
    tint = rnd[iy % (N // s), ix % (N // s)]
    base = fbm(N, 5, 5, rng)
    a = mix(col(150, 150, 146), col(184, 182, 176), 0.5 * tint + 0.5 * base)
    joint = ((np.mod(x, s) < 3) | (np.mod(y, s) < 3)).astype(np.float32)
    a = mix(a, col(62, 62, 60), joint * 0.85)
    dirt = grime(N, rng, 1.0, 4) * smoothstep(0.4, 0.85, fbm(N, 7, 4, rng))
    a = mix(a, col(96, 92, 84), dirt * 0.5)
    f1, f2, _ = voronoi(N, 6, rng, 1.0)
    crack = (1 - smoothstep(0.0, 1.3, f2 - f1)) * smoothstep(0.55, 0.8, fbm(N, 3, 3, rng))
    a = mix(a, col(50, 48, 46), crack * 0.7)
    gum = discs(N, [(rng.random() * N, rng.random() * N) for _ in range(40)], 2.4, 0.8)
    a = mix(a, col(88, 84, 80), gum * 0.6)
    h = 0.6 + 0.2 * base - joint * 0.4 - crack * 0.3
    return finish(a, h, rng, 4.0)


def tex_road(rng):
    """Asphalt: speckle, cracks, repair patches, oil stains."""
    base = fbm(N, 4, 6, rng)
    a = mix(col(52, 54, 58), col(86, 88, 92), base)
    speck = rng.random((N, N)).astype(np.float32)
    a = mix(a, col(150, 150, 152), (speck > 0.985).astype(np.float32) * 0.55)
    a = mix(a, col(24, 24, 26), (speck < 0.03).astype(np.float32) * 0.5)
    f1, f2, _ = voronoi(N, 5, rng, 1.0)
    crack = (1 - smoothstep(0.0, 1.8, f2 - f1)) * smoothstep(0.45, 0.75, fbm(N, 3, 3, rng))
    a = mix(a, col(18, 18, 20), crack * 0.85)
    x, y = grid()
    for _ in range(3):  # repair patches
        px, py = int(rng.integers(0, N - 140)), int(rng.integers(0, N - 100))
        pw, ph = int(rng.integers(60, 140)), int(rng.integers(40, 100))
        a = mix(a, col(36, 38, 42), rect(x, y, px, py, px + pw, py + ph) * 0.7)
    oil = smoothstep(0.62, 0.85, fbm(N, 5, 4, rng))
    a = mix(a, col(20, 22, 30), oil * 0.55)
    h = 0.5 + 0.25 * base + (speck > 0.985) * 0.2 - crack * 0.4
    return finish(a, h.astype(np.float32), rng, 5.0)


def tex_paint(rng, rgb):
    base = fbm(N, 6, 4, rng)
    a = mix(col(*[v * 0.84 for v in rgb]), col(*rgb), smoothstep(0.2, 0.8, base))
    wear = smoothstep(0.6, 0.85, fbm(N, 9, 4, rng))
    a = mix(a, col(110, 110, 108), wear * 0.55)
    return finish(a, 0.5 + 0.1 * base, rng, 3.0)


# ------------------------------------------------------------------ props

def tex_dock(rng):
    """Poured concrete with board-form lines and tie holes."""
    x, y = grid()
    base = fbm(N, 4, 6, rng)
    a = mix(col(120, 120, 116), col(168, 166, 160), base)
    boards = (np.mod(y, 64) < 2.5).astype(np.float32)
    a = mix(a, col(80, 80, 78), boards * 0.7)
    ties = discs(N, [(cx, cy) for cx in range(32, N, 128) for cy in range(32, N, 64)], 4, 1.0)
    a = mix(a, col(60, 60, 58), ties * 0.8)
    a = mix(a, col(40, 40, 38), streaks(N, rng, 30, 0.6, 1.0) * 0.45)
    a = mix(a, col(88, 84, 76), grime(N, rng, 1.0, 4) * 0.4)
    h = 0.6 + 0.2 * base - boards * 0.25 - ties * 0.4
    return finish(a, h, rng, 4.0)


def tex_escape(rng):
    """Fire-escape steel: grating with rust."""
    x, y = grid()
    holes = stripes(x, 16, 11, 1.0) * stripes(y, 16, 11, 1.0)
    a = mix(col(70, 74, 78), col(26, 28, 32), holes)
    rust = grime(N, rng, 1.0, 5) * smoothstep(0.35, 0.75, fbm(N, 7, 4, rng))
    a = mix(a, col(120, 62, 30), rust * (1 - holes) * 0.7)
    a = mix(a, col(200, 204, 208), scratches(N, rng, 30, 1.0) * 0.25 * (1 - holes))
    h = 0.8 - holes * 0.6
    return finish(a, h, rng, 3.0)


def tex_pole(rng):
    x, y = grid()
    a = mix(col(34, 38, 44), col(74, 80, 88), np.exp(-((np.mod(x, 128) - 40) / 22.0) ** 2))
    a = mix(a, col(110, 60, 30), grime(N, rng, 1.0, 5) * 0.3)
    return finish(a, 0.5 + 0 * a[:, :, 0], rng, 3.0)


def tex_dumpster(rng):
    return corrugated(rng, (28, 80, 52), (52, 128, 84))


def vehicle(rng, rgb, glass=(26, 34, 46), glass_frac=0.4, stripe=None, light=(250, 240, 210)):
    """A tile as tall as the vehicle: skirt at the bottom, paint, a glass band at the top.
    Image row 0 is the top of the block."""
    x, y = grid()
    g0 = int(N * glass_frac)
    skirt0 = int(N * 0.88)
    base = fbm(N, 6, 4, rng)
    paint = mix(col(*[v * 0.88 for v in rgb]), col(*rgb), smoothstep(0.2, 0.8, base))
    # gloss gradient: lighter just under the glass
    gloss = np.exp(-((y - g0 - 30) / 70.0) ** 2) * 0.22
    a = paint * (1 + gloss[:, :, None])
    a = mix(a, col(*glass), (y < g0).astype(np.float32))
    shine = np.exp(-((x * 0.6 + y - 120) % 340 - 20) ** 2 / 600.0) * (y < g0)
    a = mix(a, col(120, 142, 168), shine * 0.35)
    # window pillar every half tile
    pil = ((np.abs(np.mod(x, N / 2) - N / 4) < 5) & (y < g0)).astype(np.float32)
    a = mix(a, paint[0, 0][None, None, :] * 0.8 + 0, pil)
    # door seams + handles
    seam = ((np.abs(np.mod(x, N / 2)) < 2) & (y >= g0) & (y < skirt0)).astype(np.float32)
    a = mix(a, col(20, 20, 22), seam * 0.7)
    handle = rect(x, y, N / 2 - 60, g0 + 40, N / 2 - 30, g0 + 50)
    a = mix(a, col(210, 210, 214), handle)
    # skirt
    a = mix(a, col(24, 24, 26), (y >= skirt0).astype(np.float32))
    if stripe:
        sy0, sy1 = int(N * 0.62), int(N * 0.70)
        a = mix(a, col(*stripe), rect(x, y, 0, sy0, N, sy1))
    # dust
    a = mix(a, col(120, 112, 100), grime(N, rng, 1.0, 5) * 0.25)
    a = mix(a, col(30, 28, 26), streaks(N, rng, 22, 0.35, 1.0) * 0.2)
    h = 0.5 + 0.15 * seam - 0.1 * pil
    return finish(a, h, rng, 2.0)


TEXTURES = {
    "floor": tex_floor, "road": tex_road,
    "paint_yellow": lambda r: tex_paint(r, (226, 182, 34)),
    "paint_white": lambda r: tex_paint(r, (232, 232, 226)),
    "wall": tex_wall, "brick": tex_brick, "stucco": tex_stucco, "brownstone": tex_brownstone,
    "dock": tex_dock, "escape": tex_escape, "pole": tex_pole,
    "crate": tex_crate, "dumpster": tex_dumpster,
    "car_red": lambda r: vehicle(r, (170, 34, 36)),
    "car_blue": lambda r: vehicle(r, (36, 74, 150)),
    "car_yellow": lambda r: vehicle(r, (232, 184, 30), stripe=(24, 24, 26)),
    "car_silver": lambda r: vehicle(r, (168, 174, 182)),
    "van_white": lambda r: vehicle(r, (224, 224, 220), glass_frac=0.3, stripe=(40, 90, 160)),
    "bus": lambda r: vehicle(r, (214, 168, 28), glass_frac=0.42, stripe=(24, 24, 26)),
}
BUMPED = {"floor", "road", "wall", "brick", "stucco", "brownstone", "dock", "escape", "crate", "dumpster"}


def save(out_dir, seed=4242):
    os.makedirs(out_dir, exist_ok=True)
    for i, (name, fn) in enumerate(TEXTURES.items()):
        rng = np.random.default_rng(seed + i * 101)
        albedo, height = fn(rng)
        Image.fromarray(albedo.astype(np.uint8), "RGB").save(f"{out_dir}/{name}.jpg", quality=88, subsampling=0)
        if name in BUMPED:
            Image.fromarray((height * 255).astype(np.uint8), "L").resize((256, 256), Image.LANCZOS).save(f"{out_dir}/{name}_h.png", optimize=True)
        print("wrote", name)


if __name__ == "__main__":
    save(sys.argv[1] if len(sys.argv) > 1 else "out")
