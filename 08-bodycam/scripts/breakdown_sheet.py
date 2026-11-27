"""把剖视图、原始渲染、成片帧拼成一张带标注的制作拆解图。
  .venv/bin/python scripts/breakdown_sheet.py <exr_dir> <graded_frame.jpg> <frame_no> <out.jpg>
"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import post

exr_dir, graded, fno, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
F = lambda s: ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", s)
W, H = 2400, 1240
canvas = Image.new("RGB", (W, H), (22, 24, 28))
d = ImageDraw.Draw(canvas)

# 左：剖视图
lay = Image.open(os.path.join(ROOT, "renders", "breakdown", "layout_a.jpg")).convert("RGB")
lw = 1500; lh = lw * 9 // 16
lay = lay.resize((lw, lh), Image.LANCZOS)
ox, oy = 40, 150
canvas.paste(lay, (ox, oy))
s = lw / 1920.0


def label(text, pt, txt_xy, sub=None):
    px, py = ox + pt[0] * s, oy + pt[1] * s
    tx, ty = txt_xy
    d.line([(px, py), (tx, ty + 18)], fill=(255, 214, 60), width=3)
    d.ellipse((px - 7, py - 7, px + 7, py + 7), outline=(255, 214, 60), width=3)
    f = F(30)
    w = max(d.textlength(text, font=f), d.textlength(sub, font=F(21)) if sub else 0)
    d.rounded_rectangle((tx - 12, ty - 6, tx + w + 12, ty + 42 + (30 if sub else 0)), 8, fill=(18, 18, 20), outline=(255, 214, 60), width=2)
    d.text((tx, ty), text, font=f, fill=(255, 255, 255))
    if sub:
        d.text((tx, ty + 38), sub, font=F(21), fill=(190, 195, 205))


d.text((40, 36), "制作拆解：整段枪战是在 Blender 里搭出来的 3D 场景", font=F(46), fill=(255, 255, 255))
d.text((42, 98), "把房间的外墙和天花板设成“从外面看是透明的”，就能看到镜头里的全部东西其实只有这些", font=F(25), fill=(170, 176, 188))
label("照片扫描的废弃厂房", (1480, 300), (1010, 180), "真实建筑的 3D 扫描，墙面地面都是实拍照片")
label("敌人：带骨骼的角色模型", (740, 370), (70, 300), "站姿是手调的，倒地动作来自动作捕捉")
label("第一人称只有一双手臂和枪", (1230, 625), (850, 880), "连同相机一起移动，没有身体")
label("门外：全景照片当背景", (600, 430), (70, 620), "地面也是把全景照片投影上去的")

# 右：原始渲染 vs 成片
rw = 780; rh = rw * 9 // 16
lin = post.read_exr(post.frame_path(exr_dir, fno))
raw = (post.srgb(np.clip(lin * 1.1, 0, 1)) * 255).astype(np.uint8)
raw = Image.fromarray(raw).resize((rw, rh), Image.LANCZOS)
fin = Image.open(graded).convert("RGB").resize((rw, rh), Image.LANCZOS)
rx = 1580
canvas.paste(raw, (rx, 150)); canvas.paste(fin, (rx, 150 + rh + 90))
d.text((rx, 150 + rh + 8), "① 渲染出来的原始画面（干净、没有任何瑕疵）", font=F(26), fill=(255, 214, 60))
d.text((rx, 150 + rh + 90 + rh + 8), "② 模拟随身记录仪：自动曝光、噪点、过曝泛光、", font=F(26), fill=(255, 214, 60))
d.text((rx, 150 + rh + 90 + rh + 44), "    镜头畸变、低码率压缩、时间戳", font=F(26), fill=(255, 214, 60))
canvas.save(out, quality=92)
print("saved", out)
