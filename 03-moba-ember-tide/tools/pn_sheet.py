#!/usr/bin/env python3
# 第九轮 polish-new 的证据拼图：改前（主目录 5190 录的）一行、改后（自己 5218 录的）一行，同一个技能、同一组帧号（两边都是对局时间匀速的 30 帧，帧号对得上）。
# 用法（拼图要用 /opt/homebrew/opt/python@3.14/bin/python3.14，本机 python3 是 3.15、没有 Pillow）：
#   python3.14 pn_sheet.py compare <改前根目录> <改后根目录> <输出目录> <spec.json>   每个技能一张 连续帧_<英雄>_<技能>.jpg（8 帧以上，上改前、下改后）
#   python3.14 pn_sheet.py table   <改后根目录> <输出.jpg> <标题> <spec.json> [改前根目录]   每个技能一格代表帧；给了改前根目录就每格左改前、右改后
#   spec: [{"hero":"seren","job":"A","title":"普攻","a":0,"b":30,"n":8,"crop":"x0,y0,x1,y1","rep":9,"tag":"可选，文件名后缀"}, ...]
import sys, os, json
from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
F = lambda s: ImageFont.truetype(FONT, s)
BG = (14, 16, 18)

def frames(root, hero, job):
    d = os.path.join(root, hero, job)
    return sorted(f for f in os.listdir(d) if f.endswith(".jpg")) if os.path.isdir(d) else []

def load(root, hero, job, i, crop):
    fs = frames(root, hero, job)
    i = max(0, min(len(fs) - 1, i))
    im = Image.open(os.path.join(root, hero, job, fs[i])).convert("RGB")
    return im.crop(crop) if crop else im

def compare(before, after, out, spec):
    os.makedirs(out, exist_ok=True)
    for s in spec:
        n, a, b = s.get("n", 8), s["a"], s["b"]
        crop = tuple(map(int, s["crop"].split(","))) if s.get("crop") else None
        idx = [round(a + (b - a) * k / max(1, n - 1)) for k in range(n)]
        cw = s.get("cw", 360)
        sample = load(after, s["hero"], s["job"], idx[0], crop); ch = round(cw * sample.height / sample.width)
        top, lab = 54, 64
        W, H = lab + n * cw, top + 2 * ch + 6
        sheet = Image.new("RGB", (W, H), BG); dr = ImageDraw.Draw(sheet)
        dr.text((12, 12), f"{s['title']}（30 帧一秒；上一行改前 phase9，下一行改后；格子左上角是离出手过了几秒）", fill=(235, 235, 235), font=F(26))
        for row, (root, name) in enumerate([(before, "改前"), (after, "改后")]):
            y = top + row * (ch + 6)
            dr.text((10, y + ch // 2 - 16), name, fill=(255, 210, 120) if row else (170, 180, 190), font=F(26))
            for k, i in enumerate(idx):
                im = load(root, s["hero"], s["job"], i, crop).resize((cw, ch), Image.LANCZOS)
                x = lab + k * cw; sheet.paste(im, (x, y))
                dr.rectangle([x + 4, y + 4, x + 74, y + 30], fill=(0, 0, 0)); dr.text((x + 8, y + 5), f"{i / 30:.2f}s", fill=(255, 255, 255), font=F(19))
        p = os.path.join(out, f"连续帧_{s['hero']}_{s['job']}{s.get('tag', '')}.jpg"); sheet.save(p, quality=86); print(p, sheet.size)

def table(after, outp, title, spec, before=None):
    cols = 3 if before else 4
    cw = 400 if before else 600
    cells = []
    for s in spec:
        crop = tuple(map(int, s["crop"].split(","))) if s.get("crop") else None
        r = s.get("rep", (s["a"] + s["b"]) // 2)
        cells.append((s, [load(before, s["hero"], s["job"], r, crop)] if before else [], load(after, s["hero"], s["job"], r, crop), r))
    ch = round(cw * cells[0][2].height / cells[0][2].width)
    pair = 2 if before else 1
    cellW = cw * pair + (6 if before else 0)
    rows = (len(cells) + cols - 1) // cols
    top, lab = 56, 34
    W, H = cols * cellW + (cols - 1) * 10, top + rows * (ch + lab + 10)
    sheet = Image.new("RGB", (W, H), BG); dr = ImageDraw.Draw(sheet)
    dr.text((12, 12), title, fill=(235, 235, 235), font=F(28))
    for k, (s, bl, im, r) in enumerate(cells):
        x, y = (k % cols) * (cellW + 10), top + (k // cols) * (ch + lab + 10)
        dr.text((x + 4, y + 4), f"{s['title']}（{r / 30:.2f}s）", fill=(235, 225, 200), font=F(22))
        if before:
            sheet.paste(bl[0].resize((cw, ch), Image.LANCZOS), (x, y + lab)); sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x + cw + 6, y + lab))
            for xx, t, c in [(x, "改前", (170, 180, 190)), (x + cw + 6, "改后", (255, 210, 120))]:
                dr.rectangle([xx + 4, y + lab + 4, xx + 62, y + lab + 32], fill=(0, 0, 0)); dr.text((xx + 9, y + lab + 5), t, fill=c, font=F(20))
        else:
            sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y + lab))
    sheet.save(outp, quality=86); print(outp, sheet.size)

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "compare": compare(sys.argv[2], sys.argv[3], sys.argv[4], json.load(open(sys.argv[5])))
    elif cmd == "table": table(sys.argv[2], sys.argv[3], sys.argv[4], json.load(open(sys.argv[5])), sys.argv[6] if len(sys.argv) > 6 else None)
