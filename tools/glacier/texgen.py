"""Seamless procedural textures for the Glacier arena.

Every texture is built from periodic noise and periodic patterns, so it tiles with no
visible seam. Each function returns (albedo, height): albedo is HxWx3 floats 0..255,
height is HxW floats 0..1 (saved as the bump map).
"""
import numpy as np
from PIL import Image

N = 512


# ----------------------------------------------------------------- building blocks

def grid(n=N):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    return x, y


def periodic_noise(n, cells, rng):
    """Smooth value noise that wraps around: cells x cells random values, interpolated."""
    g = rng.random((cells, cells)).astype(np.float32)
    xs = np.arange(n, dtype=np.float32) * cells / n
    i0 = np.floor(xs).astype(int)
    f = xs - i0
    i1 = (i0 + 1) % cells
    i0 = i0 % cells
    t = f * f * (3 - 2 * f)
    a = g[:, i0] * (1 - t) + g[:, i1] * t            # (cells, n): along x
    return a[i0, :] * (1 - t)[:, None] + a[i1, :] * t[:, None]  # (n, n): along y


def fbm(n, base, octaves, rng, persistence=0.5):
    total = np.zeros((n, n), np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        total += amp * periodic_noise(n, base * 2 ** o, rng)
        norm += amp
        amp *= persistence
    total /= norm
    lo, hi = total.min(), total.max()
    return (total - lo) / (hi - lo)                  # 0..1


def blur(a, sigma):
    """Gaussian blur that wraps around (done in the frequency domain)."""
    n = a.shape[0]
    f = np.fft.fftfreq(n)
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k)).astype(np.float32)


def voronoi(n, cells, rng, jitter=0.9):
    """Periodic Voronoi: returns (F1, F2, id) distances in pixels."""
    pts = []
    step = n / cells
    for j in range(cells):
        for i in range(cells):
            pts.append(((i + 0.5 + (rng.random() - 0.5) * jitter) * step, (j + 0.5 + (rng.random() - 0.5) * jitter) * step))
    pts = np.array(pts, np.float32)
    x, y = grid(n)
    d = np.empty((n, n, len(pts)), np.float32)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(x - px)
        dx = np.minimum(dx, n - dx)
        dy = np.abs(y - py)
        dy = np.minimum(dy, n - dy)
        d[:, :, k] = np.sqrt(dx * dx + dy * dy)
    part = np.partition(d, 1, axis=2)
    return part[:, :, 0], part[:, :, 1], np.argmin(d, axis=2)


def mix(a, b, t):
    t = np.asarray(t, np.float32)
    if t.ndim == 2:
        t = t[:, :, None]
    return a * (1 - t) + b * t


def col(r, g, b, n=N):
    return np.broadcast_to(np.array([r, g, b], np.float32), (n, n, 3)).copy()


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def stripes(coord, period, width, soft=1.0):
    """1 inside periodic stripes of `width` px every `period` px (wraps if period divides n)."""
    m = np.mod(coord, period)
    return smoothstep(0, soft, m) * (1 - smoothstep(width - soft, width, m))


def discs(n, centers, radius, soft=1.0):
    """Wrapped soft discs (rivets, bolts)."""
    x, y = grid(n)
    out = np.zeros((n, n), np.float32)
    for cx, cy in centers:
        dx = np.abs(x - cx)
        dx = np.minimum(dx, n - dx)
        dy = np.abs(y - cy)
        dy = np.minimum(dy, n - dy)
        out = np.maximum(out, 1 - smoothstep(radius - soft, radius + soft, np.sqrt(dx * dx + dy * dy)))
    return out


def grime(n, rng, strength=1.0, base=3):
    """Dirty/worn patches 0..1."""
    return smoothstep(0.45, 0.8, fbm(n, base, 5, rng)) * strength


def streaks(n, rng, count=28, length=0.35, strength=1.0):
    """Vertical rain-stain streaks (wrapping), 0..1."""
    out = np.zeros((n, n), np.float32)
    x, y = grid(n)
    for _ in range(count):
        cx = rng.random() * n
        w = 1 + rng.random() * 3
        y0 = rng.random() * n
        ln = n * length * (0.3 + rng.random() * 0.7)
        dx = np.abs(x - cx)
        dx = np.minimum(dx, n - dx)
        dy = np.mod(y - y0, n)
        out = np.maximum(out, np.exp(-(dx / w) ** 2) * (1 - smoothstep(0, ln, dy)) * (0.4 + 0.6 * rng.random()))
    return out * strength


def scratches(n, rng, count=60, strength=1.0):
    out = np.zeros((n, n), np.float32)
    x, y = grid(n)
    for _ in range(count):
        cx, cy = rng.random() * n, rng.random() * n
        ang = rng.random() * np.pi
        ln = 8 + rng.random() * 34
        dx = np.mod(x - cx + n / 2, n) - n / 2
        dy = np.mod(y - cy + n / 2, n) - n / 2
        along = dx * np.cos(ang) + dy * np.sin(ang)
        across = -dx * np.sin(ang) + dy * np.cos(ang)
        out = np.maximum(out, np.exp(-(across / 0.7) ** 2) * (1 - smoothstep(ln * 0.5, ln, np.abs(along))) * (0.25 + 0.75 * rng.random()))
    return out * strength


def finish(albedo, height, rng, grain=4.0):
    albedo = albedo + (rng.random((N, N, 1)).astype(np.float32) - 0.5) * grain
    return np.clip(albedo, 0, 255), np.clip(height, 0, 1)


# ----------------------------------------------------------------------- textures

def tex_floor(rng):
    """Packed snow: soft drifts, wind ripples, trampled dirty patches, sparkle."""
    base = fbm(N, 3, 6, rng)
    warp = fbm(N, 4, 3, rng)
    x, y = grid()
    ripples = 0.5 + 0.5 * np.sin(2 * np.pi * (14 * x / N + 5 * y / N) + warp * 14)   # whole numbers of waves, so it wraps
    shade = 0.55 * base + 0.25 * ripples * smoothstep(0.35, 0.7, fbm(N, 2, 3, rng)) + 0.2 * fbm(N, 12, 3, rng)
    a = mix(col(160, 188, 212), col(238, 245, 250), shade)
    dirt = grime(N, rng, 1.0, 3) * smoothstep(0.5, 0.9, fbm(N, 5, 4, rng))
    a = mix(a, col(150, 152, 150), dirt * 0.55)
    sparkle = (rng.random((N, N)) > 0.9985).astype(np.float32)
    a = mix(a, col(255, 255, 255), blur(sparkle, 0.7) * 6)
    h = 0.6 * base + 0.4 * ripples * 0.5 + 0.2 * fbm(N, 16, 3, rng)
    return finish(a, h, rng, 3.0)


def tex_ice(rng):
    """Frozen lake: deep blue with a web of cracks, frost patches, trapped bubbles."""
    base = fbm(N, 3, 5, rng)
    a = mix(col(88, 150, 192), col(176, 218, 240), base)
    f1, f2, _ = voronoi(N, 7, rng, 0.95)
    edge = f2 - f1
    crack = 1 - smoothstep(0.0, 3.0, edge)
    wide = 1 - smoothstep(0.0, 9.0, edge)
    a = mix(a, col(215, 236, 248), wide * 0.35)
    a = mix(a, col(244, 250, 255), crack * 0.85)
    # fine dark hairline cracks from a second, denser cell pattern
    g1, g2, _ = voronoi(N, 15, rng, 1.0)
    hair = 1 - smoothstep(0.0, 1.6, g2 - g1)
    a = mix(a, col(52, 100, 140), hair * 0.35 * smoothstep(0.35, 0.65, fbm(N, 4, 3, rng)))
    frost = smoothstep(0.58, 0.85, fbm(N, 5, 5, rng))
    a = mix(a, col(238, 246, 252), frost * 0.55)
    bubbles = discs(N, [(rng.random() * N, rng.random() * N) for _ in range(60)], 2.2, 1.0)
    a = mix(a, col(235, 247, 255), blur(bubbles, 0.8) * 1.5)
    h = 0.55 * base + 0.45 * (1 - crack)
    h = h - 0.25 * crack
    return finish(a, h, rng, 3.0)


def tex_wall(rng):
    """Glacier cliff: crisp strata of blue-white ice, vertical crevasses, snow at the foot."""
    x, y = grid()
    warp = fbm(N, 3, 4, rng)
    v = y / N
    layer = v * 9 + (warp - 0.5) * 1.6 + (fbm(N, 7, 3, rng) - 0.5) * 0.5
    strata = smoothstep(0.35, 0.65, np.abs(np.mod(layer, 1.0) - 0.5) * 2)   # hard-edged bands
    base = fbm(N, 4, 5, rng)
    a = mix(col(70, 128, 184), col(206, 232, 248), 0.5 * strata + 0.5 * base)
    deep = smoothstep(0.52, 0.78, fbm(N, 3, 4, rng))
    a = mix(a, col(36, 84, 148), deep * 0.55)
    # vertical crevasses: thin dark blue cracks that wander
    crev = np.zeros((N, N), np.float32)
    for _ in range(9):
        cx = rng.random() * N
        wob = fbm(N, 5, 3, rng)
        path = cx + (wob - 0.5) * 60 + np.sin(y / N * 2 * np.pi * (1 + int(rng.integers(0, 3)))) * 14
        dx = np.abs(x - path)
        dx = np.minimum(dx, N - dx)
        top = rng.random() * N
        length = 0.3 + rng.random() * 0.45
        mask = 1 - smoothstep(0, length * N, np.mod(y - top, N))
        crev = np.maximum(crev, np.exp(-(dx / 2.2) ** 2) * mask)
    a = mix(a, col(18, 48, 96), crev * 0.8)
    a = mix(a, col(250, 252, 255), smoothstep(0.78, 1.0, fbm(N, 14, 4, rng)) * 0.5)
    # snow drifted against the foot, a bright lip at the top
    foot = smoothstep(0.80, 0.97, v + (fbm(N, 6, 3, rng) - 0.5) * 0.12)
    a = mix(a, col(236, 243, 250), foot)
    a = mix(a, col(246, 251, 255), (1 - smoothstep(0.0, 0.05, v)) * 0.6)
    h = 0.45 * base + 0.35 * strata + 0.3 * foot - crev * 0.4
    return finish(a, h, rng, 3.0)


def tex_lab(rng):
    """Insulated white wall panels, a band of windows, an orange stripe, rivets."""
    x, y = grid()
    a = mix(col(214, 220, 224), col(240, 243, 245), fbm(N, 5, 4, rng))
    # 4 panels across, 8 rows down
    cw, ch = N / 4, N / 8
    seam_v = stripes(x + 1, cw, 3)
    seam_h = stripes(y + 1, ch, 3)
    seam = np.maximum(seam_v, seam_h)
    a = mix(a, col(120, 128, 134), seam * 0.85)
    # window band across rows 3-4 (0.375..0.5 of the height)
    wy0, wy1 = ch * 3 + 10, ch * 4 - 8
    in_band = ((y > wy0) & (y < wy1)).astype(np.float32)
    window_cols = stripes(x - 18, cw, cw - 36, 2.0)
    win = in_band * window_cols
    glass = mix(col(28, 52, 70), col(88, 140, 168), (y - wy0) / (wy1 - wy0))
    reflect = smoothstep(0.35, 0.65, 0.5 + 0.5 * np.sin((x + y * 0.7) * 0.05)) * 0.18
    glass = glass + reflect[:, :, None] * 255 * 0.5
    a = mix(a, glass, win)
    frame = np.maximum(0, in_band * stripes(x - 14, cw, cw - 28, 2.0) - win)
    a = mix(a, col(96, 104, 110), frame)
    # orange safety stripe under the windows
    stripe_y = stripes(y - (ch * 5 + 6), ch, 10, 1.5) * (np.abs(((y - ch * 5) // 1)) >= 0) * ((y > ch * 5) & (y < ch * 5 + 20))
    a = mix(a, col(226, 120, 36), stripe_y)
    # rivets at panel corners
    pts = [(i * cw + 8, j * ch + 8) for i in range(4) for j in range(8)] + [(i * cw + cw - 8, j * ch + 8) for i in range(4) for j in range(8)]
    a = mix(a, col(150, 156, 160), discs(N, pts, 2.2, 0.8) * 0.9)
    a = mix(a, col(150, 156, 150), streaks(N, rng, 26, 0.45, 1.0) * 0.28)
    a = mix(a, col(176, 178, 174), grime(N, rng, 1.0, 4) * 0.28)
    h = 0.85 - seam * 0.45 - win * 0.35 - frame * 0.2 + stripe_y * 0.05
    h = h + (discs(N, pts, 2.2, 0.8)) * 0.15
    return finish(a, h, rng, 3.0)


def tex_bunker(rng):
    """Poured concrete with formwork panel seams, tie-holes, stains and snow dust."""
    x, y = grid()
    base = fbm(N, 6, 6, rng)
    a = mix(col(120, 122, 124), col(168, 170, 172), base)
    pw = N / 2
    seam = np.maximum(stripes(x + 1, pw, 3), stripes(y + 1, pw, 3))
    a = mix(a, col(70, 72, 74), seam * 0.8)
    holes = [(pw * i + pw / 2 + dx, pw * j + pw / 2 + dy) for i in range(2) for j in range(2) for dx in (-90, 90) for dy in (-90, 90)]
    holes_mask = discs(N, holes, 5.5, 1.0)
    a = mix(a, col(40, 42, 44), holes_mask * 0.9)
    a = mix(a, col(88, 90, 92), streaks(N, rng, 40, 0.6, 1.0) * 0.55)
    a = mix(a, col(96, 100, 92), grime(N, rng, 1.0, 5) * 0.4)
    spots = smoothstep(0.7, 0.9, fbm(N, 22, 3, rng))
    a = mix(a, col(60, 60, 62), spots * 0.4)
    a = mix(a, col(230, 236, 242), smoothstep(0.62, 0.9, fbm(N, 9, 5, rng)) * 0.2)
    h = 0.55 * base + 0.2 * fbm(N, 28, 2, rng) - seam * 0.45 - holes_mask * 0.4
    return finish(a, h + 0.3, rng, 5.0)


def tex_tower(rng):
    """Blue-grey steel plating: riveted panels, rust bleeding from the rivets, hazard band."""
    x, y = grid()
    base = fbm(N, 5, 5, rng)
    a = mix(col(58, 70, 84), col(100, 114, 128), base)
    pw, ph = N / 2, N / 2
    seam = np.maximum(stripes(x + 1, pw, 4), stripes(y + 1, ph, 4))
    a = mix(a, col(24, 30, 38), seam * 0.9)
    pts = []
    for i in range(2):
        for j in range(2):
            for k in range(6):
                t = (k + 0.5) / 6
                pts += [(i * pw + 14, j * ph + t * ph), (i * pw + pw - 14, j * ph + t * ph)]
    rivets = discs(N, pts, 3.0, 0.8)
    a = mix(a, col(140, 152, 164), rivets * 0.9)
    rust = streaks(N, rng, 44, 0.5, 1.0) * smoothstep(0.3, 0.7, fbm(N, 6, 4, rng) + 0.2)
    a = mix(a, col(150, 76, 36), rust * 0.65)
    a = mix(a, col(120, 62, 32), grime(N, rng, 1.0, 4) * 0.35)
    # hazard band along the bottom
    x2, y2 = grid()
    band = (y2 > N - 56).astype(np.float32)
    hz = (np.mod(x2 + y2, 64) < 32).astype(np.float32)
    a = mix(a, mix(col(230, 188, 28), col(26, 26, 28), hz), band * 0.95)
    a = mix(a, col(18, 18, 20), (np.abs(y2 - (N - 56)) < 2.5) * 0.9)
    a = mix(a, col(185, 190, 196), scratches(N, rng, 26, 1.0) * 0.4)
    h = 0.6 + 0.2 * base - seam * 0.5 + rivets * 0.2
    return finish(a, h, rng, 3.0)


def tex_deck(rng):
    """Dark steel diamond-plate with worn bright edges (also used for the stair treads)."""
    x, y = grid()
    cell = 32
    u = np.mod(x, cell) - cell / 2
    v = np.mod(y, cell) - cell / 2
    even = ((x // cell + y // cell) % 2) == 0
    # each lozenge is a short bar along +45 deg (even cells) or -45 deg (odd cells)
    along = np.where(even, (u + v), (u - v)) * 0.7071
    across = np.where(even, (u - v), (u + v)) * 0.7071
    bar = (1 - smoothstep(2.5, 5.0, np.abs(across))) * (1 - smoothstep(9.0, 12.0, np.abs(along)))
    base = fbm(N, 5, 5, rng)
    a = mix(col(46, 52, 60), col(78, 86, 96), base)
    a = mix(a, col(124, 134, 146), bar * 0.85)
    wear = smoothstep(0.55, 0.85, fbm(N, 7, 4, rng))
    a = mix(a, col(158, 166, 176), bar * wear * 0.6)
    a = mix(a, col(24, 26, 30), smoothstep(0.55, 0.85, fbm(N, 4, 4, rng)) * 0.4)
    a = mix(a, col(120, 66, 36), grime(N, rng, 1.0, 5) * 0.28)
    edge = np.minimum(np.minimum(x, N - 1 - x), np.minimum(y, N - 1 - y))
    a = mix(a, col(220, 176, 30), (edge < 6) * 0.55)
    a = mix(a, col(160, 166, 174), scratches(N, rng, 28, 1.0) * 0.35)
    h = 0.3 + 0.6 * bar + 0.1 * base
    return finish(a, h, rng, 3.0)


def tex_crate(rng):
    """Wooden crate face: plank frame, X brace, steel corner plates."""
    x, y = grid()
    plank_h = N / 8
    wood = fbm(N, 8, 5, rng)
    grain = 0.5 + 0.5 * np.sin(2 * np.pi * 73 * y / N + wood * 18)
    a = mix(col(120, 82, 46), col(188, 140, 86), 0.5 * wood + 0.3 * grain + 0.2 * fbm(N, 20, 3, rng))
    # horizontal planks with seams
    plank_id = (y // plank_h).astype(int)
    tone = rng.random(16)[plank_id % 16].astype(np.float32)
    a = a * (0.84 + 0.3 * tone)[:, :, None]
    gap = stripes(y + 1, plank_h, 3)
    a = mix(a, col(40, 26, 14), gap * 0.9)
    # frame (border) and diagonal braces, darker, as in a shipping crate
    bw = 40
    border = ((x < bw) | (x > N - 1 - bw) | (y < bw) | (y > N - 1 - bw)).astype(np.float32)
    d1 = np.abs((x - y) * 0.7071)
    d2 = np.abs((x + y - N) * 0.7071)
    brace = (1 - smoothstep(14, 17, np.minimum(d1, d2))) * (1 - border)
    a = mix(a, a * 0.72 + np.array([6, 4, 2], np.float32), np.maximum(border, brace) * 0.9)
    edge = np.maximum(np.abs(np.abs(x - N / 2) - (N / 2 - bw)) < 2.0, np.abs(np.abs(y - N / 2) - (N / 2 - bw)) < 2.0) * border
    a = mix(a, col(36, 24, 14), edge * 0.8)
    # steel corner plates + bolts
    plates = ((x < 70) | (x > N - 71)) & ((y < 70) | (y > N - 71))
    a = mix(a, col(72, 76, 82), plates.astype(np.float32) * 0.9)
    bolts = discs(N, [(30, 30), (N - 31, 30), (30, N - 31), (N - 31, N - 31), (58, 58), (N - 59, 58), (58, N - 59), (N - 59, N - 59)], 4.0, 0.8)
    a = mix(a, col(150, 154, 160), bolts)
    a = mix(a, col(60, 40, 24), grime(N, rng, 1.0, 5) * 0.35)
    a = mix(a, col(238, 244, 250), smoothstep(0.7, 0.95, fbm(N, 12, 4, rng)) * (1 - plates) * 0.4)  # snow dust
    h = 0.6 + 0.2 * grain - gap * 0.4 - (np.maximum(border, brace)) * 0.05 + plates * 0.15 + bolts * 0.2
    return finish(a, h, rng, 4.0)


def tex_berg(rng):
    """Rough ice blocks: faceted crystal cells, frost, deep blue cracks."""
    f1, f2, ident = voronoi(N, 9, rng, 1.0)
    shade = rng.random(81)[ident % 81].astype(np.float32)
    base = fbm(N, 4, 5, rng)
    a = mix(col(120, 176, 214), col(214, 238, 252), 0.55 * shade + 0.45 * base)
    edge = f2 - f1
    a = mix(a, col(246, 252, 255), (1 - smoothstep(0, 5, edge)) * 0.8)
    g1, g2, _ = voronoi(N, 19, rng, 1.0)
    a = mix(a, col(48, 96, 150), (1 - smoothstep(0, 1.8, g2 - g1)) * 0.38)
    a = mix(a, col(250, 253, 255), smoothstep(0.62, 0.9, fbm(N, 13, 5, rng)) * 0.6)
    a = mix(a, col(70, 120, 170), streaks(N, rng, 20, 0.4, 1.0) * 0.18)
    h = 0.5 * shade + 0.3 * base + 0.3 * smoothstep(0, 6, edge)
    return finish(a, h, rng, 3.0)


def tex_mast(rng):
    """Red-and-white painted steel in horizontal bands (4 bands per tile)."""
    x, y = grid()
    band = np.mod(y // (N / 4), 2).astype(np.float32)      # 0 white, 1 red
    paint = mix(col(236, 238, 240), col(196, 44, 38), band)
    wear = fbm(N, 7, 5, rng)
    a = paint * (0.86 + 0.16 * wear[:, :, None])
    chips = smoothstep(0.8, 0.95, fbm(N, 16, 4, rng))
    a = mix(a, col(120, 124, 130), chips * 0.5)             # bare steel showing through
    a = mix(a, col(150, 80, 40), chips * smoothstep(0.4, 0.8, fbm(N, 5, 3, rng)) * 0.6)  # rust on it
    a = mix(a, col(70, 74, 80), streaks(N, rng, 36, 0.55, 1.0) * 0.28)
    seam = stripes(y + 1, N / 4, 3)
    a = mix(a, col(40, 40, 44), seam * 0.5)
    # vertical weld lines
    weld = stripes(x + 2, N / 2, 4)
    a = mix(a, col(60, 60, 64), weld * 0.45)
    h = 0.6 + 0.2 * wear - chips * 0.2 - seam * 0.2
    return finish(a, h, rng, 3.0)


def tex_beacon(rng):
    """Dark panels with glowing cyan circuit lines (the emissive landmark spire)."""
    x, y = grid()
    base = fbm(N, 6, 4, rng)
    a = mix(col(14, 20, 30), col(28, 38, 52), base)
    seam = np.maximum(stripes(x + 1, N / 2, 4), stripes(y + 1, N / 2, 4))
    a = mix(a, col(6, 8, 12), seam * 0.9)
    glow = np.zeros((N, N), np.float32)
    # horizontal glowing bars
    for k, off in enumerate((N * 0.16, N * 0.34, N * 0.66, N * 0.84)):
        bar = (np.abs(y - off) < 4).astype(np.float32)
        gap = (np.mod(x + k * 64, 128) < 88).astype(np.float32)
        glow = np.maximum(glow, bar * gap)
    # vertical traces with nodes
    for cx in (N * 0.12, N * 0.38, N * 0.62, N * 0.88):
        trace = (np.abs(x - cx) < 2.2) * (np.mod(y + cx, 256) < 170)
        glow = np.maximum(glow, trace.astype(np.float32) * 0.8)
    nodes = discs(N, [(cx, cy) for cx in (N * 0.12, N * 0.38, N * 0.62, N * 0.88) for cy in (N * 0.16, N * 0.5, N * 0.84)], 7.0, 1.5)
    glow = np.maximum(glow, nodes)
    halo = blur(glow, 6.0) * 1.8
    a = a + glow[:, :, None] * np.array([40, 255, 255], np.float32) * 0.95
    a = a + halo[:, :, None] * np.array([0, 90, 110], np.float32)
    h = 0.5 + 0.2 * base - seam * 0.4 + glow * 0.2
    return finish(a, h, rng, 2.0)


def corrugated(rng, base_a, base_b, name_rust=0.55):
    """Shipping-container steel: vertical ribs, a flat frame, rust, scratches, a stencilled plate."""
    x, y = grid()
    period = 32
    ribs = 0.5 + 0.5 * np.cos(2 * np.pi * x / period)       # 1 at crest
    frame_top = (y < 30)
    frame_bot = (y > N - 31)
    frame = (frame_top | frame_bot).astype(np.float32)
    shade = (0.78 + 0.22 * ribs)
    shade = np.where(frame > 0, 0.95, shade)
    base = fbm(N, 6, 5, rng)
    a = mix(col(*base_a), col(*base_b), base) * shade[:, :, None]
    # darker valleys between ribs
    a = a * (1 - 0.22 * (1 - ribs) ** 3 * (1 - frame))[:, :, None]
    # frame edges
    a = mix(a, a * 0.55, ((np.abs(y - 30) < 2) | (np.abs(y - (N - 31)) < 2)).astype(np.float32))
    # rust & grime
    rust = grime(N, rng, 1.0, 4) * smoothstep(0.35, 0.75, fbm(N, 7, 4, rng))
    a = mix(a, col(132, 70, 34), rust * name_rust)
    a = mix(a, col(40, 36, 32), streaks(N, rng, 36, 0.55, 1.0) * 0.45)
    a = mix(a, col(214, 218, 222), scratches(N, rng, 24, 1.0) * 0.3)
    # a white stencilled plate (3 text-like lines) so the sides don't look blank
    px0, py0, pw, ph = 72, 150, 180, 80
    plate = ((x > px0) & (x < px0 + pw) & (y > py0) & (y < py0 + ph)).astype(np.float32)
    a = mix(a, col(228, 226, 218), plate * 0.88)
    lines = np.zeros((N, N), np.float32)
    for k in range(3):
        yy = py0 + 14 + k * 22
        segs = rng.integers(3, 6)
        xx = px0 + 12
        for _ in range(segs):
            wseg = int(rng.integers(14, 38))
            lines[yy:yy + 9, xx:xx + wseg] = 1
            xx += wseg + 8
            if xx > px0 + pw - 20:
                break
    a = mix(a, col(36, 36, 40), lines * plate * 0.85)
    a = mix(a, col(60, 56, 50), grime(N, rng, 1.0, 6) * plate * 0.4)
    # door latch rods on the right third
    rod = ((np.abs(x - 400) < 3) | (np.abs(x - 424) < 3)) & (y > 40) & (y < N - 40)
    a = mix(a, col(150, 154, 158), rod.astype(np.float32) * 0.7)
    h = 0.3 + 0.5 * ribs * (1 - frame) + 0.45 * frame - rust * 0.08 + 0.15 * rod
    return finish(a, h, rng, 3.0)


def tex_container_red(rng):
    return corrugated(rng, (122, 34, 26), (186, 62, 44))


def tex_container_blue(rng):
    return corrugated(rng, (28, 62, 108), (60, 108, 164))


def tex_container_yellow(rng):
    return corrugated(rng, (170, 124, 24), (228, 184, 52), 0.45)


TEXTURES = {
    "floor": tex_floor, "ice": tex_ice, "wall": tex_wall, "lab": tex_lab, "bunker": tex_bunker,
    "tower": tex_tower, "deck": tex_deck, "crate": tex_crate, "berg": tex_berg, "mast": tex_mast,
    "beacon": tex_beacon,
    "container_red": tex_container_red, "container_blue": tex_container_blue, "container_yellow": tex_container_yellow,
}
# the three container colours share one bump map (the ribs are the same)
SHARED_BUMP = {"container_red": "container", "container_blue": "container", "container_yellow": "container"}


def save(out_dir, seed=2026):
    import os
    os.makedirs(out_dir, exist_ok=True)
    written = {}
    for i, (name, fn) in enumerate(TEXTURES.items()):
        rng = np.random.default_rng(seed + i * 101)
        albedo, height = fn(rng)
        Image.fromarray(albedo.astype(np.uint8), "RGB").save(f"{out_dir}/{name}.jpg", quality=90, subsampling=0)
        bump_name = SHARED_BUMP.get(name, name)
        if name == bump_name or bump_name == "container" and name == "container_red":
            bump = Image.fromarray((height * 255).astype(np.uint8), "L").resize((256, 256), Image.LANCZOS)
            bump.save(f"{out_dir}/{bump_name}_h.png", optimize=True)
        written[name] = albedo
    return written


if __name__ == "__main__":
    import sys
    save(sys.argv[1] if len(sys.argv) > 1 else "out")
