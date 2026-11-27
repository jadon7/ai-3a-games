"""把 render.py 出的格子拼成一张图：每段动作一块，一行一个角色，从左到右是时间。左边写角色名，上面写动作名和抽的时刻。
用法: /opt/homebrew/opt/python@3.14/bin/python3.14 tools/retarget/sheet.py <render 的输出目录> <输出.jpg> <动作,动作…> <角色名|角色名…> [视角数=1] [每行加的注（|分隔，可省）]
"""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

d, out, clips, labels = sys.argv[1], sys.argv[2], sys.argv[3].split(","), sys.argv[4].split("|")
nv = int(sys.argv[5]) if len(sys.argv) > 5 else 1; notes = sys.argv[6].split("|") if len(sys.argv) > 6 else []
F = lambda s: ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", s)
blocks = []
for clip in clips:
    rows = []
    for ai, lab in enumerate(labels):
        for v in range(nv):
            fs = sorted(glob.glob(os.path.join(d, clip, f"{ai}_{v}_*.png")))
            if not fs: continue
            ims = [Image.open(f).convert("RGB") for f in fs]; w, h = ims[0].size
            row = Image.new("RGB", (230 + w * len(ims), h), (238, 238, 236)); dr = ImageDraw.Draw(row)
            for k, im in enumerate(ims): row.paste(im, (230 + k * w, 0))
            if v == 0:
                dr.text((10, 14), lab, fill=(20, 20, 20), font=F(22))
                if ai < len(notes) and notes[ai]:
                    y = 50
                    for line in notes[ai].split("\\n"): dr.text((10, y), line, fill=(70, 70, 70), font=F(15)); y += 22
            rows.append(row)
    if not rows: continue
    W = max(r.size[0] for r in rows); head = Image.new("RGB", (W, 40), (40, 44, 48)); ImageDraw.Draw(head).text((12, 6), clip, fill=(255, 255, 255), font=F(24))
    blk = Image.new("RGB", (W, 40 + sum(r.size[1] for r in rows)), (255, 255, 255)); blk.paste(head, (0, 0)); y = 40
    for r in rows: blk.paste(r, (0, y)); y += r.size[1]
    blocks.append(blk)
W = max(b.size[0] for b in blocks); sh = Image.new("RGB", (W, sum(b.size[1] for b in blocks) + 8 * len(blocks)), (255, 255, 255)); y = 0
for b in blocks: sh.paste(b, (0, y)); y += b.size[1] + 8
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True); sh.save(out, quality=88); print(out, sh.size)
