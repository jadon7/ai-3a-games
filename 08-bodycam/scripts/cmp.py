"""把游戏截图和影片成片帧并排对比。 .venv/bin/python scripts/cmp.py <tag> <mode> <frames,...> [film_dir=renders/vfull]"""
import sys, os
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tag, mode, frames = sys.argv[1], sys.argv[2], [int(v) for v in sys.argv[3].split(",")]
film = sys.argv[4] if len(sys.argv) > 4 else ("renders/vfull" if mode == "day" else "renders/vdusk")
W = 800; H = 450
sheet = Image.new("RGB", (W * 2, H * len(frames)))
for i, f in enumerate(frames):
    a = Image.open(os.path.join(ROOT, film, f"v_{f:04d}.jpg")).convert("RGB").resize((W, H), Image.LANCZOS)
    p = os.path.join(ROOT, "game", "_shots", f"{tag}_{mode}_{f:04d}.png")
    b = Image.open(p).convert("RGB").resize((W, H), Image.LANCZOS) if os.path.exists(p) else Image.new("RGB", (W, H), (60, 0, 0))
    ImageDraw.Draw(a).text((6, 4), f"FILM {f}", fill=(255, 255, 0)); ImageDraw.Draw(b).text((6, 4), f"GAME {f}", fill=(0, 255, 255))
    sheet.paste(a, (0, i * H)); sheet.paste(b, (W, i * H))
out = os.path.join(ROOT, "renders", "test", f"cmp_{tag}_{mode}.jpg")
sheet.save(out, quality=88); print(out)
