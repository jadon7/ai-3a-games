"""把姿势检查图（每个姿势正面、侧面各一张，640x720）裁掉上面的空白，拼成总览。
用法: python3 psheet.py <目录> <前缀，如 wolf_t_> <输出.jpg> <列数> <tag1> <tag2> ..."""
import sys, os
from PIL import Image, ImageDraw
d, pre, out, cols = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]); tags = sys.argv[5:]
Y0, Y1 = 290, 700
tiles = []
for t in tags:
    a = Image.open(os.path.join(d, f"{pre}{t}_front.png")).convert("RGB").crop((120, Y0, 520, Y1))
    b = Image.open(os.path.join(d, f"{pre}{t}_side.png")).convert("RGB").crop((0, Y0, 640, Y1))
    im = Image.new("RGB", (a.size[0] + b.size[0], Y1 - Y0)); im.paste(a, (0, 0)); im.paste(b, (a.size[0], 0))
    ImageDraw.Draw(im).text((8, 6), t, fill=(255, 0, 0)); tiles.append(im)
w, h = tiles[0].size; rows = (len(tiles) + cols - 1) // cols
sh = Image.new("RGB", (cols * w, rows * h), (40, 40, 40))
for k, im in enumerate(tiles): sh.paste(im, ((k % cols) * w, (k // cols) * h))
sh.save(out, quality=90); print(sh.size)
