#!/usr/bin/env python3
# 特效第二轮（fx2b）的证据：从 fx2_cap.mjs 截的帧（raw/before_<英雄>、raw/after_<英雄>）拼出
#   对比_<英雄>_<键>.jpg        改前一行、改后一行的连续帧（每个技能挑 10 个时刻）
#   录像/<英雄>_<键>_改前.mp4、_改后.mp4、_对比.mp4（左改前右改后，按真实速度）
#   总表.jpg                   每个技能改后最好看的一帧
# 用法: python3 tools/fx2_evidence.py <证据目录（docs/round9/fx2b）>
import sys, os, subprocess, json, shutil
from PIL import Image, ImageDraw, ImageFont
root = sys.argv[1]; raw = os.path.join(root, "raw"); here = os.path.dirname(os.path.abspath(__file__)); os.makedirs(os.path.join(root, "录像"), exist_ok=True)
NAME = {"moko": "摩珂", "osen": "奥森"}
SK = {  # (英雄, 键): (技能名, 裁剪 x0,y0,x1,y1, 连续帧的时刻, 总表用的时刻)
  ("moko", "Q"): ("潮愈", (180, 40, 1100, 600), "0.35,0.5,0.62,0.78,0.86,0.94,1.1,1.18,1.36,1.62", 1.2),
  ("moko", "W"): ("水泡", (240, 40, 1040, 600), "0.5,0.6,0.68,0.78,0.9,1.2,2.03,2.12,2.24,2.45", 0.78),
  ("moko", "E"): ("回流", (60, 80, 1260, 620), "0.3,0.62,0.72,0.82,0.92,1.02,1.1,1.2,1.4,1.75", 0.92),
  ("moko", "R"): ("月潮", (60, 0, 1220, 700), "0.5,0.75,0.9,1.05,1.25,1.6,2.5,4.0,5.5,6.6", 1.05),
  ("osen", "Q"): ("烛焰", (100, 60, 1280, 620), "0.62,0.75,0.85,0.92,0.97,1.02,1.08,1.16,1.3,1.6", 1.0),
  ("osen", "W"): ("蜡封", (330, 60, 1230, 620), "0.62,0.8,1.0,1.2,1.38,1.44,1.52,1.7,3.1,3.6", 1.52),
  ("osen", "E"): ("熄灯", (330, 40, 1230, 640), "0.55,0.6,0.66,0.72,0.82,1.2,2.4,3.6,4.7,5.1", 2.4),
  ("osen", "R"): ("千烛祷", (200, 0, 1240, 660), "0.9,1.25,1.5,1.72,1.95,2.3,2.8,3.3,3.8,4.2", 3.82),
}
def font(sz):
    for f in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
def label(path, text):
    im = Image.new("RGBA", (150, 52), (0, 0, 0, 0)); d = ImageDraw.Draw(im); d.rounded_rectangle((0, 0, 149, 51), 8, fill=(0, 0, 0, 170)); d.text((16, 6), text, fill=(255, 255, 255, 255), font=font(30)); im.save(path)
lab = {k: os.path.join(raw, f"_lab_{k}.png") for k in ("改前", "改后")}
for k, p in lab.items(): label(p, k)
cells = []
for (h, key), (nm, box, ts, best) in SK.items():
    b, a = os.path.join(raw, f"before_{h}", key), os.path.join(raw, f"after_{h}", key)
    if not (os.path.exists(b) and os.path.exists(a)): print("缺", h, key); continue
    title = f"{NAME[h]} {key} {nm}：上一行改前、下一行改后（固定机位，按对局时间取帧，左上角是按键后的秒数）"
    subprocess.run(["python3", os.path.join(here, "fx2_sheet.py"), os.path.join(root, f"对比_{h}_{key}.jpg"), title, ",".join(map(str, box)), "330", f"改前={b}@{ts}", f"改后={a}@{ts}"], check=True)
    for tag, src in (("改前", b + ".mp4"), ("改后", a + ".mp4")): shutil.copyfile(src, os.path.join(root, "录像", f"{h}_{key}_{tag}.mp4"))
    x0, y0, x1, y1 = box; w, hh = (x1 - x0) // 2 * 2, (y1 - y0) // 2 * 2
    fc = f"[0:v]crop={w}:{hh}:{x0}:{y0},scale=-2:540[a];[1:v]crop={w}:{hh}:{x0}:{y0},scale=-2:540[b];[a][2:v]overlay=10:10[a2];[b][3:v]overlay=10:10[b2];[a2][b2]hstack=inputs=2:shortest=1,format=yuv420p[v]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", b + ".mp4", "-i", a + ".mp4", "-i", lab["改前"], "-i", lab["改后"], "-filter_complex", fc, "-map", "[v]", "-c:v", "libx264", "-crf", "21", "-movflags", "+faststart", os.path.join(root, "录像", f"{h}_{key}_对比.mp4")], check=True)
    times = json.load(open(os.path.join(a, "times.json"))); i = min(range(len(times)), key=lambda k: abs(times[k] - best))
    cells.append((f"{NAME[h]} {key} {nm}（{times[i]:.2f}s）", Image.open(os.path.join(a, f"f_{i:03d}.jpg")).crop(box)))
# 总表：每格按各自的裁剪，等比缩进 640×400 的格子
CW, CH, LH, G = 640, 400, 40, 8
sheet = Image.new("RGB", (4 * (CW + G) + G, 56 + 2 * (CH + LH + G) + G), (14, 16, 18)); d = ImageDraw.Draw(sheet); d.text((12, 12), "摩珂、奥森全部技能改后的代表帧（测试场、固定机位）", fill=(232, 236, 232), font=font(30))
for k, (t, im) in enumerate(cells):
    x, y = G + (k % 4) * (CW + G), 56 + G + (k // 4) * (CH + LH + G); sc = min(CW / im.width, CH / im.height); im2 = im.resize((round(im.width * sc), round(im.height * sc)), Image.LANCZOS)
    sheet.paste(im2, (x + (CW - im2.width) // 2, y + (CH - im2.height) // 2)); d.text((x + 4, y + CH + 6), t, fill=(225, 232, 228), font=font(24))
sheet.save(os.path.join(root, "总表.jpg"), quality=90); print("总表", sheet.size)
