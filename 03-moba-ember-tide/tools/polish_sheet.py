#!/usr/bin/env python3
# 第九轮 polish-lib 的对比图（用 /opt/homebrew/opt/python@3.14/bin/python3.14 跑，本机的 python3 没有 Pillow）。
#   ab   <输出.jpg> <标题> <改前帧目录> <改后帧目录> <帧号,帧号,…> [裁剪 x,y,w,h] [每格宽=480]   上一行改前、下一行改后，每格标对局时间（帧号 / 30）
#   pair <输出.jpg> <标题> <改前图> <改后图> [裁剪 x,y,w,h] [每张宽=960]                          两张并排（改前左、改后右）
#   grid <输出.jpg> <标题> <列数> <图:说明> …  [--w=每格宽]                                        总表：一格一张图，下面一行说明
import sys, os
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for f in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()

BG, INK, MUTE, A, B = (12, 15, 17), (236, 232, 220), (150, 160, 158), (226, 120, 100), (110, 190, 245)

def crop(im, c):
    if not c: return im
    x, y, w, h = [int(v) for v in c.split(",")]
    return im.crop((x, y, x + w, y + h))

def fit(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)

def tag(d, xy, s, col, f, pad=6):
    x, y = xy; bb = d.textbbox((x + pad, y + pad), s, font=f)
    d.rectangle((bb[0] - pad, bb[1] - pad + 1, bb[2] + pad, bb[3] + pad), fill=(0, 0, 0))
    d.text((x + pad, y + pad), s, font=f, fill=col)

def ab(out, title, da, db, idx, c=None, cw=480):
    idx = [int(i) for i in idx.split(",")]; rows = []
    for d0 in (da, db):
        rows.append([fit(crop(Image.open(f"{d0}/f_{i:03d}.jpg").convert("RGB"), c), cw) for i in idx])
    ch = rows[0][0].height; lw, th, gap = 92, 54, 4
    W = lw + len(idx) * (cw + gap); H = th + 2 * (ch + gap) + 8
    im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im); ft, fs, fl = font(26), font(17), font(24)
    d.text((14, 12), title, font=ft, fill=INK)
    for r, (row, lab, col) in enumerate(zip(rows, ("改前", "改后"), (A, B))):
        y = th + r * (ch + gap); d.text((16, y + ch // 2 - 14), lab, font=fl, fill=col)
        for k, (fr, i) in enumerate(zip(row, idx)):
            x = lw + k * (cw + gap); im.paste(fr, (x, y)); tag(d, (x, y), f"{i / 30:.2f}s", INK, fs, 4)
    im.save(out, quality=90); print(out, im.size)

def pair(out, title, a, b, c=None, cw=960):
    ims = [fit(crop(Image.open(p).convert("RGB"), c), cw) for p in (a, b)]; ch = max(i.height for i in ims); th, gap = 54, 8
    im = Image.new("RGB", (2 * cw + gap, th + ch), BG); d = ImageDraw.Draw(im); ft, fl = font(26), font(22)
    d.text((14, 12), title, font=ft, fill=INK)
    for k, (fr, lab, col) in enumerate(zip(ims, ("改前", "改后"), (A, B))):
        x = k * (cw + gap); im.paste(fr, (x, th)); tag(d, (x, th), lab, col, fl)
    im.save(out, quality=90); print(out, im.size)

def grid(out, title, cols, items, cw=640):
    cells = []
    for it in items:
        p, _, cap = it.partition(":"); cells.append((fit(Image.open(p).convert("RGB"), cw), cap))
    th, cap, gap = 56, 40, 6; rows = (len(cells) + cols - 1) // cols
    rh = [max(c[0].height for c in cells[r * cols:(r + 1) * cols]) for r in range(rows)]      # 每一行按这一行最高的那张算，不留大块空白
    im = Image.new("RGB", (cols * (cw + gap), th + sum(h + cap + gap for h in rh)), BG); d = ImageDraw.Draw(im); ft, fc = font(26), font(19)
    d.text((14, 12), title, font=ft, fill=INK)
    for k, (fr, c) in enumerate(cells):
        r = k // cols; x, y = (k % cols) * (cw + gap), th + sum(h + cap + gap for h in rh[:r]); im.paste(fr, (x, y)); d.text((x + 8, y + rh[r] + 8), c, font=fc, fill=INK)
    im.save(out, quality=90); print(out, im.size)

if __name__ == "__main__":
    m, a = sys.argv[1], sys.argv[2:]
    if m == "ab": ab(a[0], a[1], a[2], a[3], a[4], a[5] if len(a) > 5 and a[5] else None, int(a[6]) if len(a) > 6 else 480)
    elif m == "pair": pair(a[0], a[1], a[2], a[3], a[4] if len(a) > 4 and a[4] else None, int(a[5]) if len(a) > 5 else 960)
    elif m == "grid":
        w = next((int(x[4:]) for x in a if x.startswith("--w=")), 640); rest = [x for x in a if not x.startswith("--w=")]
        grid(rest[0], rest[1], int(rest[2]), rest[3:], w)
