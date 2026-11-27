"""录像的每一帧顶上加一条字：动作名和“从左到右”是谁。用法: python3.14 tools/retarget/label_frames.py <帧目录> <一行字>"""
import sys, glob
from PIL import Image, ImageDraw, ImageFont
d, text = sys.argv[1], sys.argv[2]; F = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 24)
for f in sorted(glob.glob(d + "/*.png")):
    im = Image.open(f).convert("RGB"); dr = ImageDraw.Draw(im); dr.rectangle((0, 0, im.size[0], 40), fill=(40, 44, 48)); dr.text((14, 6), text, fill=(255, 255, 255), font=F); im.save(f)
