"""把沉钟长锤的几张预览图和设计图拼成两张对比图。用法: python montage.py <chk 目录> <设计图>"""
import sys
from PIL import Image
d, concept = sys.argv[1], sys.argv[2]
g = lambda n: Image.open(f"{d}/gear_{n}.png").convert("RGB")
c = Image.open(concept).convert("RGB"); c = c.resize((int(c.width * 1200 / c.height), 1200))
a, b = g("full_a"), g("full_b")
s = Image.new("RGB", (c.width + a.width + b.width, 1200), (40, 40, 40)); s.paste(c, (0, 0)); s.paste(a, (c.width, 0)); s.paste(b, (c.width + a.width, 0)); s.save(f"{d}/gear_sheet_full.jpg", quality=90)
names = ["bell_a", "bell_low", "bell_top", "mid", "butt", "butt_b"]; t = Image.new("RGB", (800 * 3, 800 * 2))
for i, n in enumerate(names): t.paste(g(n), ((i % 3) * 800, (i // 3) * 800))
t = t.resize((1800, 1200)); t.save(f"{d}/gear_sheet_close.jpg", quality=90); print(s.size, t.size)
