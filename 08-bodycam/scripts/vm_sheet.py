"""把逐帧截图裁出一块、拼成一张图看动作。
  .venv/bin/python scripts/vm_sheet.py <_shots 里的前缀> <输出名> [--crop x0,y0,x1,y1] [--cols 6] [--w 320] [--step 1] [--from 0] [--n 36]
"""
import sys, os, glob, argparse
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('prefix'); ap.add_argument('out')
ap.add_argument('--crop', default='480,270,1440,1080'); ap.add_argument('--cols', type=int, default=6); ap.add_argument('--w', type=int, default=320)
ap.add_argument('--step', type=int, default=1); ap.add_argument('--from', dest='start', type=int, default=0); ap.add_argument('--n', type=int, default=36)
a = ap.parse_args()
files = sorted(glob.glob(os.path.join(ROOT, 'game', '_shots', a.prefix + '_[0-9][0-9][0-9][0-9].jpg')))[a.start::a.step][:a.n]
x0, y0, x1, y1 = map(int, a.crop.split(',')); h = round(a.w * (y1 - y0) / (x1 - x0)); rows = (len(files) + a.cols - 1) // a.cols
sheet = Image.new('RGB', (a.cols * a.w, rows * h))
for i, f in enumerate(files):
    im = Image.open(f).crop((x0, y0, x1, y1)).resize((a.w, h), Image.LANCZOS)
    ImageDraw.Draw(im).text((4, 3), os.path.basename(f)[-8:-4], fill=(255, 255, 0))
    sheet.paste(im, ((i % a.cols) * a.w, (i // a.cols) * h))
out = os.path.join(ROOT, 'game', '_shots', a.out + '.jpg'); sheet.save(out, quality=88); print(out, len(files), sheet.size)
