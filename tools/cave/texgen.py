"""Seamless procedural textures for the Cave arena (dark rock, glowing crystal and pools).
Run:  python3 tools/cave/texgen.py assets/textures/cave
"""
import os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "glacier"))
import texgen as G  # noqa: E402
N, grid, fbm, mix, col, smoothstep, grime, finish, voronoi, discs, streaks = (
    G.N, G.grid, G.fbm, G.mix, G.col, G.smoothstep, G.grime, G.finish, G.voronoi, G.discs, G.streaks)


def strata(rng, dark, light, bands=7, wobble=5.0):
    """Layered rock: horizontal bands bent by noise, whole-number band count so it tiles."""
    x, y = grid()
    bend = fbm(N, 3, 5, rng)
    s = 0.5 + 0.5 * np.sin(2 * np.pi * (bands * y / N + wobble * (bend - 0.5)))
    t = 0.55 * s + 0.45 * fbm(N, 6, 5, rng)
    return mix(col(*dark), col(*light), t), t


def tex_wall(rng):
    a, t = strata(rng, (34, 30, 32), (84, 76, 70))
    f1, f2, _ = voronoi(N, 6, rng, 1.0)
    crack = 1 - smoothstep(0.0, 1.6, f2 - f1)
    a = mix(a, col(10, 9, 10), crack * 0.7)
    moss = smoothstep(0.62, 0.85, fbm(N, 5, 4, rng))
    a = mix(a, col(38, 58, 40), moss * 0.35)
    a = mix(a, col(20, 22, 26), grime(N, rng, 1.0, 4) * 0.35)
    return finish(a, 0.55 * t + 0.3 * (1 - crack), rng, 3.0)


def tex_rock(rng):
    """Boulders: chunky faceted cells, lighter than the walls so cover reads."""
    f1, f2, ids = voronoi(N, 5, rng, 1.0)
    cell = (np.sin(ids * 12.9898) * 43758.5453) % 1.0 if ids is not None else rng.random((N, N))
    a = mix(col(78, 72, 68), col(132, 122, 112), 0.65 * cell + 0.35 * fbm(N, 5, 5, rng))
    edge = 1 - smoothstep(0.0, 2.2, f2 - f1)
    a = mix(a, col(18, 16, 16), edge * 0.8)
    a = mix(a, col(36, 52, 40), smoothstep(0.65, 0.88, fbm(N, 4, 4, rng)) * 0.3)
    return finish(a, 0.5 + 0.4 * cell - 0.4 * edge, rng, 3.0)


def tex_floor(rng):
    """Cave floor: dark gravel, pebbles, damp patches."""
    base = fbm(N, 5, 6, rng)
    a = mix(col(46, 42, 40), col(82, 74, 66), base)
    pebbles = discs(N, [(rng.random() * N, rng.random() * N) for _ in range(160)], 3.5, 0.9)
    a = mix(a, col(112, 104, 94), pebbles * 0.5)
    speck = rng.random((N, N)).astype(np.float32)
    a = mix(a, col(18, 16, 16), (speck < 0.06).astype(np.float32) * 0.5)
    wet = smoothstep(0.58, 0.8, fbm(N, 4, 5, rng))
    a = a * (1 - 0.4 * wet)[:, :, None]
    return finish(a, 0.45 + 0.3 * base + 0.2 * pebbles, rng, 4.0)


def tex_ceiling(rng):
    a, t = strata(rng, (18, 17, 20), (48, 44, 46), bands=5, wobble=7.0)
    f1, f2, _ = voronoi(N, 4, rng, 1.0)
    a = mix(a, col(6, 6, 8), (1 - smoothstep(0.0, 2.0, f2 - f1)) * 0.6)
    return finish(a, 0.5 * t + 0.3, rng, 3.0)


def tex_slab(rng):
    """Old carved flagstones on the central plateau, with moss."""
    x, y = grid()
    s = 128
    ix, iy = (x // s).astype(int), (y // s).astype(int)
    tone = rng.random((N // s, N // s)).astype(np.float32)[iy % (N // s), ix % (N // s)]
    base = fbm(N, 5, 5, rng)
    a = mix(col(86, 86, 82), col(128, 126, 118), 0.5 * tone + 0.5 * base)
    joint = ((np.mod(x, s) < 3) | (np.mod(y, s) < 3)).astype(np.float32)
    a = mix(a, col(22, 22, 22), joint * 0.9)
    # a worn carved ring in each slab
    cx, cy = (np.mod(x, s) - s / 2), (np.mod(y, s) - s / 2)
    ring = np.exp(-((np.hypot(cx, cy) - 34) / 3.0) ** 2)
    a = mix(a, col(54, 54, 52), ring * 0.55)
    moss = smoothstep(0.55, 0.82, fbm(N, 6, 5, rng))
    a = mix(a, col(40, 76, 46), moss * 0.55)
    return finish(a, 0.6 + 0.2 * base - joint * 0.4 - ring * 0.15, rng, 3.0)


def tex_crystal(rng):
    """Glowing crystal: bright faceted cells (this texture is also the emissive map)."""
    f1, f2, ids = voronoi(N, 6, rng, 1.0)
    cell = (np.sin(ids * 78.233) * 43758.5453) % 1.0 if ids is not None else rng.random((N, N))
    a = mix(col(36, 170, 214), col(170, 250, 255), 0.35 + 0.65 * cell)
    edge = 1 - smoothstep(0.0, 1.8, f2 - f1)
    a = mix(a, col(230, 255, 255), edge * 0.55)
    return finish(a, 0.5 + 0.4 * cell, rng, 2.0)


def tex_pool(rng):
    """A shallow glowing pool (emissive too)."""
    x, y = grid()
    w = np.zeros((N, N), np.float32)
    for kx, ky, amp in [(3, 2, 1.0), (-2, 5, 0.7), (6, -3, 0.4)]:
        ph = rng.random() * 2 * np.pi
        w += amp * np.sin(2 * np.pi * (kx * x + ky * y) / N + ph)
    w = (w - w.min()) / (w.max() - w.min())
    a = mix(col(14, 96, 118), col(70, 210, 214), 0.6 * w + 0.4 * fbm(N, 4, 4, rng))
    a = mix(a, col(200, 255, 255), smoothstep(0.82, 0.96, w) * 0.4)
    return finish(a, w, rng, 2.0)


TEXTURES = {
    "floor": tex_floor, "wall": tex_wall, "rock": tex_rock, "ceiling": tex_ceiling,
    "slab": tex_slab, "crystal": tex_crystal, "pool": tex_pool,
}
BUMPED = {"floor", "wall", "rock", "ceiling", "slab", "crystal"}


def save(out_dir, seed=7070):
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
