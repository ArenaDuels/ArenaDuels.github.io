# Renders assets/thumbs/glacier.png from the arena file and its textures.
# Run from the project root:  python3 tools/glacier/thumb.py
import json, os, subprocess, numpy as np
from PIL import Image, ImageDraw
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
A = json.loads(subprocess.check_output(['node', '-e', 'import("./js/arenas/glacier.js").then(m=>console.log(JSON.stringify(m.default)))'], cwd=ROOT))
SS = 3                      # supersampling
W, H = 480 * SS, 300 * SS
names = list(A['textures'].keys())

def mean_color(n):
    im = np.asarray(Image.open(os.path.join(ROOT, 'assets', 'textures', 'glacier', f'{n}.jpg')).convert('RGB')).astype(float)
    return tuple(im.reshape(-1, 3).mean(0))
base = {n: mean_color(n) for n in names}
# beacon is dark with glowing lines: show it as the glowing thing it is
base['beacon'] = (40, 200, 215)
base['floor'] = (214, 226, 236)
base['mast'] = (214, 70, 60)

def shade(c, k):
    return tuple(int(max(0, min(255, v * k))) for v in c)

half = A['floorSize'] / 2
VS = 1.0                    # vertical exaggeration (heights are small next to 112m)
def proj(x, y, z, s, ox, oy):
    return (ox + (x - z) * 0.866 * s, oy + (x + z) * 0.5 * s - y * s * VS)

# fit the drawing to the canvas
pts = []
for x in (-half, half):
    for z in (-half, half):
        for y in (0, A['wallHeight'] + 2):
            pts.append(proj(x, y, z, 1, 0, 0))
pts.append(proj(0, 18, 0, 1, 0, 0))
minx, maxx = min(p[0] for p in pts), max(p[0] for p in pts)
miny, maxy = min(p[1] for p in pts), max(p[1] for p in pts)
margin = 14 * SS
s = min((W - 2 * margin) / (maxx - minx), (H - 2 * margin) / (maxy - miny))
ox = W / 2 - (minx + maxx) / 2 * s
oy = H / 2 - (miny + maxy) / 2 * s
P = lambda x, y, z: proj(x, y, z, s, ox, oy)

img = Image.new('RGB', (W, H), (16, 22, 32))
d = ImageDraw.Draw(img)

# floor
floor = [P(-half, 0, -half), P(half, 0, -half), P(half, 0, half), P(-half, 0, half)]
d.polygon(floor, fill=tuple(int(v) for v in base['floor']))
# faint grid so the size reads
for i in range(-int(half), int(half) + 1, 14):
    d.line([P(i, 0, -half), P(i, 0, half)], fill=shade(base['floor'], 0.93), width=SS)
    d.line([P(-half, 0, i), P(half, 0, i)], fill=shade(base['floor'], 0.93), width=SS)
# ice patches
for f in A.get('floors', []):
    x0, x1, z0, z1 = f['x'] - f['w'] / 2, f['x'] + f['w'] / 2, f['z'] - f['d'] / 2, f['z'] + f['d'] / 2
    d.polygon([P(x0, 0, z0), P(x1, 0, z0), P(x1, 0, z1), P(x0, 0, z1)], fill=tuple(int(v) for v in base['ice']), outline=shade(base['ice'], 0.8))

def box(minx_, maxx_, minz_, maxz_, top, color, line=None):
    line = line or shade(color, 0.42)
    topf = [P(minx_, top, minz_), P(maxx_, top, minz_), P(maxx_, top, maxz_), P(minx_, top, maxz_)]
    left = [P(minx_, 0, maxz_), P(maxx_, 0, maxz_), P(maxx_, top, maxz_), P(minx_, top, maxz_)]    # +z face
    right = [P(maxx_, 0, minz_), P(maxx_, 0, maxz_), P(maxx_, top, maxz_), P(maxx_, top, minz_)]   # +x face
    d.polygon(left, fill=shade(color, 0.74), outline=line)
    d.polygon(right, fill=shade(color, 0.56), outline=line)
    d.polygon(topf, fill=shade(color, 1.05), outline=line)

# the two far walls (the near two would hide the map)
wall = tuple(int(v) for v in base['wall'])
t = 0.6
wh = A['wallHeight']
box(-half - t / 2, half + t / 2, -half - t / 2, -half + t / 2, wh, wall)   # far wall along z
box(-half - t / 2, -half + t / 2, -half - t / 2, half + t / 2, wh, wall)   # far wall along x

# props, far to near
props = sorted(A['props'], key=lambda p: (p['x'] + p['z'] + (p['w'] + p['d']) * 0.0, p['h']))
for p in props:
    c = tuple(int(v) for v in base.get(p['type'], (150, 150, 150)))
    box(p['x'] - p['w'] / 2, p['x'] + p['w'] / 2, p['z'] - p['d'] / 2, p['z'] + p['d'] / 2, p['h'], c)


out = img.resize((480, 300), Image.LANCZOS)
out.save(os.path.join(ROOT, 'assets', 'thumbs', 'glacier.png'), optimize=True)
print('thumb', out.size)
