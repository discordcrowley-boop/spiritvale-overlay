# Dev-only: renders assets/icon.png (256x256). Not shipped.
import math
import os
from PIL import Image, ImageDraw, ImageFilter

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

d.rounded_rectangle([40, 40, S - 40, S - 40], radius=220, fill=(12, 16, 22, 255))

glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
g = ImageDraw.Draw(glow)
g.ellipse([230, 230, S - 230, S - 230], outline=(90, 255, 200, 255), width=70)
glow = glow.filter(ImageFilter.GaussianBlur(40))
img.alpha_composite(glow)

d = ImageDraw.Draw(img)
d.ellipse([250, 250, S - 250, S - 250], outline=(110, 255, 205, 255), width=46)

# Veil: a soft crescent sweeping over the ring.
veil = Image.new("RGBA", (S, S), (0, 0, 0, 0))
v = ImageDraw.Draw(veil)
v.ellipse([330, 300, S - 250, S - 300], fill=(150, 120, 255, 210))
v.ellipse([400, 250, S - 170, S - 330], fill=(0, 0, 0, 0))
veil = veil.filter(ImageFilter.GaussianBlur(3))
img.alpha_composite(veil)

d = ImageDraw.Draw(img)
cx, cy = S // 2, S // 2
for i in range(3):
    a = math.radians(-60 + i * 30)
    r = 150 + i * 18
    x, y = cx + r * math.cos(a), cy + r * math.sin(a)
    d.ellipse([x - 16, y - 16, x + 16, y + 16], fill=(230, 255, 245, 255))

out = os.path.join(os.path.dirname(__file__), "..", "assets", "icon.png")
img.resize((256, 256), Image.LANCZOS).save(out)
print("wrote", os.path.abspath(out))
