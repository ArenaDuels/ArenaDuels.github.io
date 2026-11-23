"""Seamless procedural textures for the Dock arena (planked pier, sea, concrete, sheds).

The crates are Glacier's (assets/textures/glacier/crate.jpg), so no crate is made here.
Run:  python3 tools/dock/texgen.py assets/textures/dock
"""
import os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name, path):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# Both neighbours are called texgen.py, so load them under their own names. The alley one
# imports the glacier one by its plain name, so glacier goes in first.
sys.path.insert(0, os.path.join(HERE, "..", "glacier"))
import texgen as _glacier  # noqa: E402
sys.modules.pop("texgen")
N, grid, fbm, mix, col, smoothstep, grime, finish, corrugated = (
    _glacier.N, _glacier.grid, _glacier.fbm, _glacier.mix, _glacier.col, _glacier.smoothstep,
    _glacier.grime, _glacier.finish, _glacier.corrugated)
sys.modules["texgen"] = _glacier
_alley = _load("alley_texgen", os.path.join(HERE, "..", "alley", "texgen.py"))
sys.modules.pop("texgen")


def tex_planks(rng):
    """Weathered pier decking: 16 planks across the tile, butt joints, grain, nails, salt and wet patches."""
    x, y = grid()
    pw = N // 16
    a = np.zeros((N, N, 3), np.float32)
    h = np.zeros((N, N), np.float32)
    grain_noise = fbm(N, 3, 5, rng)
    for r in range(16):
        y0, y1 = r * pw, (r + 1) * pw
        joints = sorted(set(int(v) for v in rng.integers(40, N - 40, size=2)))
        edges = [0] + joints + [N]
        for s0, s1 in zip(edges[:-1], edges[1:]):
            tone = rng.random()
            base = mix(col(112, 88, 62), col(158, 132, 98), tone)
            seg = np.zeros((N, N), bool)
            seg[y0:y1, s0:s1] = True
            a[seg] = base[seg]
            # grain running along the plank
            gy = (y - y0) / pw
            g = 0.5 + 0.5 * np.sin((gy * 9 + grain_noise * 14 + tone * 6) * np.pi)
            a[seg] *= (0.86 + 0.22 * g[seg])[:, None]
            h[seg] = (0.62 + 0.12 * g[seg] + 0.1 * tone)
            # nails near the ends of each plank
            for nx in (s0 + 10, s1 - 10):
                for ny in (y0 + 8, y1 - 8):
                    dd = (x - nx) ** 2 + (y - ny) ** 2
                    m = dd < 5
                    a[m] = np.array([52, 50, 48], np.float32)
                    h[m] = 0.3
    gap = ((np.mod(y, pw) < 2.5)).astype(np.float32)
    a = mix(a, col(28, 24, 20), gap * 0.9)
    h = h - gap * 0.35
    wet = smoothstep(0.55, 0.78, fbm(N, 4, 5, rng))
    a = a * (1 - 0.35 * wet)[:, :, None]
    salt = smoothstep(0.62, 0.85, fbm(N, 7, 4, rng)) * (1 - wet)
    a = mix(a, col(196, 190, 176), salt * 0.3)
    a = mix(a, col(60, 50, 40), grime(N, rng, 1.0, 5) * 0.3)
    return finish(a, h, rng, 4.0)


def tex_water(rng):
    """Open sea: criss-crossing swell with thin bright crests, seamless."""
    x, y = grid()
    ridge = np.zeros((N, N), np.float32)
    swell = np.zeros((N, N), np.float32)
    # (kx, ky) are whole numbers of waves across the tile, so it tiles
    for kx, ky, amp in [(5, 2, 1.0), (-3, 6, 0.8), (9, 4, 0.5), (2, -11, 0.4), (14, 7, 0.25)]:
        ph = rng.random() * 2 * np.pi
        arg = 2 * np.pi * (kx * x + ky * y) / N + ph
        ridge += amp * (1 - np.abs(np.sin(arg / 2)))     # sharp crests, round troughs
        swell += amp * np.sin(arg)
    ridge /= ridge.max()
    swell = (swell - swell.min()) / (swell.max() - swell.min())
    tint = fbm(N, 3, 4, rng)
    a = mix(col(12, 66, 98), col(36, 124, 148), 0.6 * swell + 0.4 * tint)
    crest = smoothstep(0.58, 0.9, ridge)
    a = mix(a, col(200, 232, 240), crest * 0.35)
    a = mix(a, col(8, 40, 66), smoothstep(0.55, 0.85, tint) * 0.3)
    return finish(a, 0.5 * swell + 0.5 * ridge, rng, 2.0)


def tex_shed(rng):
    return corrugated(rng, (108, 126, 140), (150, 164, 176))


TEXTURES = {
    "floor": tex_planks,
    "apron": _alley.tex_floor,
    "paint_yellow": lambda r: _alley.tex_paint(r, (226, 182, 34)),
    "quay": _alley.tex_dock,
    "rail": _alley.tex_pole,
    "shed": tex_shed,
    "water": tex_water,
}
BUMPED = {"floor", "apron", "quay", "shed", "water"}


def save(out_dir, seed=9090):
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
