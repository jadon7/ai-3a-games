#!/usr/bin/env python3
# 并排图（iti-fx2 的证据）。拼图用 /opt/homebrew/opt/python@3.14/bin/python3.14。
#
# 1) 和 Codex 那一版同一时刻并排（上一行 Codex，下一行这一版）：
#    compare.py rows <输出.jpg> <标题> <每格宽> <裁剪x0,y0,x1,y1|""> <秒,秒,...> <行名=来源> <行名=来源> ...
#    来源可以是 mp4（rec.mjs 录的：开头 0.3 秒静止，30 帧，第 t 秒是第 8+round(30t) 帧）或者 rec.mjs 的逐帧目录（按 stats.json 找最近的帧）
# 2) 一对一对（左参考、右这一版），每对一个说明：
#    compare.py pairs <输出.jpg> <标题> <每格高> <左图|来源@秒[@裁剪]>::<右图|来源@秒[@裁剪]>::<说明> ...
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
def font(sz): return ImageFont.truetype(FONT, sz)
_cache = {}

def frame(src, t):
    """取某个来源第 t 秒的那一帧"""
    if src.endswith(".mp4"):
        if src not in _cache:
            d = tempfile.mkdtemp(prefix="cmp_", dir=os.environ.get("CMP_TMP", "/tmp"))
            env = dict(os.environ, DYLD_LIBRARY_PATH="/opt/homebrew/Cellar/x265/4.2/lib")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-i", src, "-q:v", "3", os.path.join(d, "f_%04d.jpg")], env=env, check=True)
            _cache[src] = d
        d = _cache[src]; n = len([f for f in os.listdir(d) if f.endswith(".jpg")])
        i = max(1, min(n, 8 + round(30 * t) + 1))      # ffmpeg 从 1 数
        return Image.open(os.path.join(d, f"f_{i:04d}.jpg")).convert("RGB")
    fr = json.load(open(os.path.join(src, "stats.json")))["frames"]
    i = min(range(len(fr)), key=lambda k: abs(fr[k]["t"] - t))
    return Image.open(os.path.join(src, f"f_{i:04d}.jpg")).convert("RGB")

def crop(im, c):
    if not c: return im
    x0, y0, x1, y1 = [float(v) for v in c.split(",")]; W, H = im.size
    return im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))

def label(im, txt, sz):
    d = ImageDraw.Draw(im); f = font(sz); w = d.textlength(txt, font=f)
    d.rectangle((0, 0, w + 12, sz + 8), fill=(0, 0, 0)); d.text((6, 3), txt, fill=(255, 235, 120), font=f)

def rows(out, title, cw, c, times, specs):
    times = [float(t) for t in times.split(",")]
    lines = [s.split("=", 1) for s in specs]
    cells = []
    for name, src in lines:
        row = []; ts = times
        if "@" in src: src, tt = src.split("@"); ts = [float(t) for t in tt.split(",")]      # 这一行用自己的时刻（按阶段对齐的并排）
        for t in ts:
            im = crop(frame(src, t), c); im = im.resize((cw, int(im.height * cw / im.width)), Image.LANCZOS)
            label(im, f"{t:.2f}s", max(14, cw // 18)); row.append(im)
        cells.append((name, row))
    ch = cells[0][1][0].height; lw = 150; th = 50
    ncol = max(len(row) for _, row in cells)
    img = Image.new("RGB", (lw + ncol * (cw + 4), th + len(cells) * (ch + 4)), (16, 18, 22))
    d = ImageDraw.Draw(img); d.text((10, 10), title, fill=(255, 255, 255), font=font(28))
    for r, (name, row) in enumerate(cells):
        y = th + r * (ch + 4)
        for k, line in enumerate(name.split("\\n")): d.text((10, y + 10 + k * 30), line, fill=(255, 220, 140), font=font(24))
        for k, im in enumerate(row): img.paste(im, (lw + k * (cw + 4), y))
    img.save(out, quality=88); print(out, img.size)

def load(spec, h):
    if "@" in spec:
        p = spec.split("@"); im = crop(frame(p[0], float(p[1])), p[2] if len(p) > 2 else "")
    else: im = Image.open(spec).convert("RGB")
    return im.resize((int(im.width * h / im.height), h), Image.LANCZOS)

def pairs(out, title, h, specs):
    rowsim = []
    for s in specs:
        a, b, cap = s.split("::")
        A, B = load(a, h), load(b, h)
        label(A, os.environ.get("LEFT", "王者参考"), 22); label(B, os.environ.get("RIGHT", "这一版"), 22)
        rowsim.append((A, B, cap))
    W = max(A.width + B.width for A, B, _ in rowsim) + 8; capH = 40; th = 50
    img = Image.new("RGB", (W, th + len(rowsim) * (h + capH + 10)), (16, 18, 22)); d = ImageDraw.Draw(img)
    d.text((10, 10), title, fill=(255, 255, 255), font=font(28))
    for r, (A, B, cap) in enumerate(rowsim):
        y = th + r * (h + capH + 10)
        d.text((10, y + 6), cap, fill=(255, 220, 140), font=font(24))
        img.paste(A, (0, y + capH)); img.paste(B, (A.width + 8, y + capH))
    img.save(out, quality=88); print(out, img.size)

if __name__ == "__main__":
    if sys.argv[1] == "rows": rows(sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5], sys.argv[6], sys.argv[7:])
    else: pairs(sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5:])
