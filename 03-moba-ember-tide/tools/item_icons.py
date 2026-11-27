#!/usr/bin/env python3
"""第九轮装备图标：把即梦出的 3×2 图标合集（主目录 art/ui/raw/items9/libs_s1..s6.png）切成 public/assets/ui/item/<id>.webp（128 像素，和阶段 8 的十二件一样）。
旧的十二件（blade bow edge great tome orb staff plate cloak heart boots charm）沿用 tools/ui_cut.py 切出来的那一份，这里不动。
用法: python3 tools/item_icons.py [总览图输出路径]
"""
import os, sys
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = "/Users/jadon7/Documents/SynologyDrive/code/moba/art/ui/raw/items9"      # 原图只在主目录（不进 git）
OUT = os.path.join(ROOT, "public/assets/ui/item")
# 每张合集从左到右、从上到下是哪几件；None 是没用上的备选
SHEETS = {
    "libs_s1": ["fang", "vial", "coral", "zeal", "vamp", "forge"],
    "libs_s2": ["rod", "mail", "scale", "conch", "boots_as", "boots_ar"],
    "libs_s3": ["boots_mr", "boots_ap", "boots_cd", "furnace", "thorn", "bulwark"],
    "libs_s4": ["tide", "trinity", "anchor", "ambush", "hunter", "reaper"],
    "libs_s5": ["ember", "abyss", "inferno", "harpoon", "fury", "locket"],
    "libs_s6": ["horn", "banner", None, None, None, None],
}
def cells(path, cols=3, rows=2, pad=0.035):
    im = Image.open(path).convert("RGB"); w, h = im.width / cols, im.height / rows
    for r in range(rows):
        for c in range(cols):
            s = min(w, h) * (1 - pad * 2); cx, cy = (c + 0.5) * w, (r + 0.5) * h
            yield im.crop((int(cx - s / 2), int(cy - s / 2), int(cx + s / 2), int(cy + s / 2)))
made = []
for sheet, ids in SHEETS.items():
    for name, im in zip(ids, cells(f"{RAW}/{sheet}.png")):
        if not name: continue
        p = os.path.join(OUT, name + ".webp"); im.resize((128, 128), Image.LANCZOS).save(p, quality=88, method=6); made.append(p)
print(len(made), "张，合计", round(sum(os.path.getsize(p) for p in made) / 1e3), "KB")
if len(sys.argv) > 1:      # 总览：全部装备图标按商店的顺序排一张
    ids = sorted(f[:-5] for f in os.listdir(OUT) if f.endswith(".webp"))
    sh = Image.new("RGB", (96 * 11, 96 * ((len(ids) + 10) // 11)), (12, 16, 18))
    for i, n in enumerate(ids): sh.paste(Image.open(os.path.join(OUT, n + ".webp")).resize((92, 92)), (i % 11 * 96 + 2, i // 11 * 96 + 2))
    sh.save(sys.argv[1], quality=88)
