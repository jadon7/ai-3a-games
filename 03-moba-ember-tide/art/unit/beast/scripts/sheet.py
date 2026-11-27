"""把 tools/anim_sheet.mjs 截的图拼成大一点的图（共用的 asheet.py 一行排满，动物太小看不清脚）。
用法: python3 sheet.py <截图目录> <动作> <视角> <输出.jpg> [列数=5] [y0=0.28] [y1=0.82]   y0、y1 是裁掉上下空白以后留下的范围（占边长的比例）"""
import sys, glob
from PIL import Image, ImageDraw
d, act, view, out = sys.argv[1:5]; cols = int(sys.argv[5]) if len(sys.argv) > 5 else 5; y0 = float(sys.argv[6]) if len(sys.argv) > 6 else 0.28; y1 = float(sys.argv[7]) if len(sys.argv) > 7 else 0.82
fs = sorted(glob.glob(f"{d}/{act}_{view}_*.jpg")); ims = [Image.open(f).convert("RGB") for f in fs]; w, h = ims[0].size; a, b = int(h * y0), int(h * y1)
rows = (len(ims) + cols - 1) // cols; sh = Image.new("RGB", (cols * w, rows * (b - a)), (20, 24, 29))
for k, im in enumerate(ims):
    c = im.crop((0, a, w, b)); ImageDraw.Draw(c).text((6, 4), f"{act} {k}/{len(ims)}", fill=(255, 90, 90)); sh.paste(c, ((k % cols) * w, (k // cols) * (b - a)))
sh.thumbnail((2000, 2000)); sh.save(out, quality=88); print(sh.size)
