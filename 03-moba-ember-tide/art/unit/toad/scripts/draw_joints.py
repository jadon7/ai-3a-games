#!/usr/bin/env python3
"""把跟踪点画到静止姿势的正面、侧面图上。用法: python3 draw_joints.py <pose_check 的输出目录> <输出.jpg>"""
import sys, json, numpy as np
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1:3]
sk = json.load(open("/Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model/toad_skeleton.json"))
proj = np.load(f"{d}/toad_restj.npy"); names = [j["name"] for j in sk["joints"]]; grp = [j["group"] for j in sk["joints"]]
col = {"M": (255, 255, 0), "L": (255, 60, 60), "R": (60, 140, 255)}
try: font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 17)
except Exception: font = ImageFont.load_default()
tiles = []
for vi, v in enumerate(("front", "side")):
    im = Image.open(f"{d}/toad_rest_{v}.png").convert("RGB").resize((1280, 1440)); W, H = im.size; dr = ImageDraw.Draw(im)
    for k, n in enumerate(names):
        x, y = proj[vi, k, 0] * W, proj[vi, k, 1] * H
        dr.ellipse([x - 6, y - 6, x + 6, y + 6], fill=col[grp[k]], outline=(0, 0, 0)); dr.text((x + 8, y - 9 + (k % 2) * 8), n, fill=(255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    tiles.append(im)
sh = Image.new("RGB", (2560, 1440)); sh.paste(tiles[0], (0, 0)); sh.paste(tiles[1], (1280, 0)); sh = sh.crop((0, 760, 2560, 1440)); sh.save(out, quality=90); print(sh.size)
