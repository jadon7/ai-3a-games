"""把跟踪点画到静止姿势的正面、侧面图上。用法: python3 draw_joints.py <目录> <name>"""
import sys, json, numpy as np
from PIL import Image, ImageDraw
d, name = sys.argv[1:3]
sk = json.load(open(f"/Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model/{name}_skeleton.json"))
proj = np.load(f"{d}/{name}_t_restj.npy"); names = [j["name"] for j in sk["joints"]]; grp = [j["group"] for j in sk["joints"]]
col = {"M": (255, 255, 0), "L": (255, 60, 60), "R": (60, 140, 255)}
tiles = []
for vi, v in enumerate(("front", "side")):
    im = Image.open(f"{d}/{name}_t_restj_{v}.png").convert("RGB").resize((1280, 1440)); W, H = im.size; dr = ImageDraw.Draw(im)
    for k, n in enumerate(names):
        x, y = proj[vi, k, 0] * W, proj[vi, k, 1] * H
        dr.ellipse([x - 7, y - 7, x + 7, y + 7], fill=col[grp[k]], outline=(0, 0, 0)); dr.text((x + 9, y - 6), n, fill=(0, 0, 0))
    tiles.append(im)
sh = Image.new("RGB", (2560, 1440)); sh.paste(tiles[0], (0, 0)); sh.paste(tiles[1], (1280, 0)); sh = sh.crop((0, 380, 2560, 1440)); sh.save(f"{d}/{name}_t_joints.jpg", quality=90); print(sh.size)
