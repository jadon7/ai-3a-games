#!/usr/bin/env python3
"""把站姿的正面、侧面两张渲染图拼成视频模型用的参考图（1280×720：左半边正面，右半边侧面，中间一条 2 像素的黑线）。
用法: python3 tools/hero_refsheet.py <正面.png> <侧面.png> <输出.png>
正面、侧面由 tools/blender/hero_ref.py 渲染（各 640×720）。输出一般放到 video2rig 的 assets/ref/<名字>_ref.png。
"""
import sys
from PIL import Image
f, s, out = sys.argv[1:4]
a, b = Image.open(f).convert("RGB").resize((640, 720)), Image.open(s).convert("RGB").resize((640, 720))
r = Image.new("RGB", (1280, 720), (0, 0, 0)); r.paste(a, (0, 0)); r.paste(b, (640, 0))
for x in (639, 640):
    for y in range(720): r.putpixel((x, y), (0, 0, 0))
r.save(out); print("写好了", out, r.size)
