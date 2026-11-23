"""Makes og-image.png (1200x630), the picture shown when the site is shared or listed.
Run from the repo root:  python3 tools/seo/og-image.py"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
BG1, BG2 = (10, 10, 13), (28, 20, 52)
MINT, BRAND, BRAND2 = (237, 242, 255), (106, 168, 255), (155, 107, 255)
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

img = Image.new("RGB", (W, H), BG1)
px = img.load()
for y in range(H):                                  # a diagonal dark-to-purple wash
    for x in range(W):
        t = min(1, max(0, (x / W) * 0.6 + (y / H) * 0.4))
        px[x, y] = tuple(int(BG1[i] + (BG2[i] - BG1[i]) * t) for i in range(3))

glow = Image.new("RGB", (W, H), (0, 0, 0))
ImageDraw.Draw(glow).ellipse((-200, 120, 520, 760), fill=(60, 50, 140))
img = Image.blend(img, Image.composite(glow, img, glow.convert("L").filter(ImageFilter.GaussianBlur(120))), 0.35)
d = ImageDraw.Draw(img)

# the four arenas, 2x2, on the right
names = ["alley", "glacier", "dock", "cave"]
tw, th, gap = 262, 164, 16
x0, y0 = 612, (H - (2 * th + gap)) // 2
for i, n in enumerate(names):
    t = Image.open(f"assets/thumbs/{n}.png").convert("RGB").resize((tw, th), Image.LANCZOS)
    mask = Image.new("L", (tw, th), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, tw, th), 16, fill=255)
    x, y = x0 + (i % 2) * (tw + gap), y0 + (i // 2) * (th + gap)
    d.rounded_rectangle((x - 2, y - 2, x + tw + 2, y + th + 2), 18, outline=(255, 255, 255, 40), width=2)
    img.paste(t, (x, y), mask)

# the name: ARENA in white, DUELS in the brand gradient
d = ImageDraw.Draw(img)
big = ImageFont.truetype(BOLD, 112)
d.text((64, 150), "ARENA", font=big, fill=MINT)
grad = Image.new("RGB", (460, 140))
gd = ImageDraw.Draw(grad)
for x in range(460):
    t = x / 459
    gd.line([(x, 0), (x, 140)], fill=tuple(int(BRAND[i] + (BRAND2[i] - BRAND[i]) * t) for i in range(3)))
mask = Image.new("L", (460, 140), 0)
ImageDraw.Draw(mask).text((0, 0), "DUELS", font=big, fill=255)
img.paste(grad, (64, 268), mask)

d.text((68, 440), "Free browser arena shooter", font=ImageFont.truetype(BOLD, 34), fill=MINT)
d.text((68, 492), "No download. Play with friends or bots.", font=ImageFont.truetype(REG, 26), fill=(160, 166, 190))
img.save("og-image.png", optimize=True)
print("wrote og-image.png", img.size)
