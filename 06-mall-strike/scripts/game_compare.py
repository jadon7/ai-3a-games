"""Side-by-side: final video frame vs real-time game frame at the same camera. Run with the scratch venv python."""
import subprocess, sys, os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VID = os.path.join(ROOT, "output", "COD风格枪战_成片_1080p.mp4")
OUT = os.path.join(ROOT, "process", "game")
pairs = [(25, "game_f025"), (132, "game_f132"), (330, "game_f330"), (455, "game_f455")]
F = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 30)
rows = []
for f, g in pairs:
    vp = os.path.join(OUT, f"video_f{f:03d}.jpg")
    if not os.path.exists(vp):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", VID, "-vf", f"select=eq(n\\,{f - 1})", "-vframes", "1", "-q:v", "2", vp], check=True)
    gp = os.path.join(OUT, g + ".jpg")
    if not os.path.exists(gp):
        continue
    a = Image.open(vp).convert("RGB").resize((960, 540), Image.LANCZOS)
    b = Image.open(gp).convert("RGB").resize((960, 540), Image.LANCZOS)
    row = Image.new("RGB", (1930, 540), (12, 12, 12))
    row.paste(a, (0, 0)); row.paste(b, (970, 0))
    d = ImageDraw.Draw(row)
    for x, t in ((14, f"视频 第 {f} 帧 · Cycles 离线渲染（约 22 秒/帧）"), (984, "游戏 · 实时渲染（60 FPS）")):
        tw = d.textlength(t, font=F)
        d.rectangle((x - 6, 490, x + tw + 10, 532), fill=(0, 0, 0))
        d.text((x + 2, 493), t, font=F, fill=(255, 214, 90))
    rows.append(row)
H = sum(r.height for r in rows) + 10 * (len(rows) - 1)
img = Image.new("RGB", (1930, H), (12, 12, 12))
y = 0
for r in rows:
    img.paste(r, (0, y)); y += r.height + 10
dst = os.path.join(ROOT, "process", "游戏vs视频_同机位对比.jpg")
img.save(dst, quality=90)
print("WROTE", dst, img.size)
