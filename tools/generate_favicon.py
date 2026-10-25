#!/usr/bin/env python3
"""Draws favicon.png and apple-touch-icon.png (the target logo) to match favicon.svg.
    pip install pillow numpy
    python3 tools/generate_favicon.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SS = 8  # supersampling


def render(size):
    n = size * SS
    k = n / 64.0

    def circle_ring(draw, r, w, fill=255):
        c = 32 * k
        draw.ellipse([c - (r + w / 2) * k, c - (r + w / 2) * k, c + (r + w / 2) * k, c + (r + w / 2) * k], fill=fill)
        draw.ellipse([c - (r - w / 2) * k, c - (r - w / 2) * k, c + (r - w / 2) * k, c + (r - w / 2) * k], fill=0)

    # gradient layer (top-left light blue -> bottom-right violet)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    t = (xx + yy) / (2 * n)
    c0, c1 = np.array([143, 192, 255], np.float32), np.array([155, 107, 255], np.float32)
    grad = (c0[None, None, :] * (1 - t[..., None]) + c1[None, None, :] * t[..., None]).astype(np.uint8)

    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    bg = Image.new("L", (n, n), 0)
    ImageDraw.Draw(bg).rounded_rectangle([0, 0, n - 1, n - 1], radius=14 * k, fill=255)
    img.paste((11, 16, 32, 255), mask=bg)

    ring = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(ring)
    circle_ring(d, 21, 5)
    for (x0, y0, x1, y1) in [(32, 4, 32, 14), (32, 50, 32, 60), (4, 32, 14, 32), (50, 32, 60, 32)]:
        d.line([x0 * k, y0 * k, x1 * k, y1 * k], fill=255, width=int(4 * k))
        for (px, py) in [(x0, y0), (x1, y1)]:
            d.ellipse([px * k - 2 * k, py * k - 2 * k, px * k + 2 * k, py * k + 2 * k], fill=255)
    img.paste(Image.fromarray(grad, "RGB"), mask=ring)

    white = Image.new("L", (n, n), 0)
    circle_ring(ImageDraw.Draw(white), 11, 4.5)
    img.paste((255, 255, 255, 255), mask=white)

    dot = Image.new("L", (n, n), 0)
    ImageDraw.Draw(dot).ellipse([28 * k, 28 * k, 36 * k, 36 * k], fill=255)
    img.paste((255, 90, 122, 255), mask=dot)
    return img.resize((size, size), Image.LANCZOS)


render(64).save(os.path.join(ROOT, "favicon.png"), optimize=True)
render(180).save(os.path.join(ROOT, "apple-touch-icon.png"), optimize=True)
print("wrote favicon.png and apple-touch-icon.png")
