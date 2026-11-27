#!/usr/bin/env python3
"""整张地图的地面贴图（阶段 2.5）。

样板间（60 米）是一张图一次重绘出来的。整张地图 156 米，一张 4K 不够细，所以分成 3×3 个区，每个区还是 60 米、
还是一次重绘一张 4K（和样板间同样的比例尺，约 48 像素/米），相邻的区重叠 8 米。
为什么分开画也能接上：
  · 每个区的输入都是同一套程序算出来的布局图，石板、河床、广场的位置在重叠的地方本来就是同一份；
  · 画完以后把两米半以上的大色块拉回布局图的颜色，各区的色调就一致了；
  · 重叠的 8 米里羽化过渡，接的是笔触，不是结构。

用法：
  python3 tools/map_ground.py jobs <输出.json> [区名 ...]   生成重绘任务（不给区名就是全部九个）
  python3 tools/map_ground.py build [预览.jpg]              拼出 public/assets/map/ground/ 下的分块贴图、总览图、草地蒙版
布局图：art/map/region/r_i_j.jpg（引擎导出，见 PLAN.md）。重绘结果：art/map/paint/r_i_j.png。
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG = os.path.join(ROOT, "art/map/region"); PAINT = os.path.join(ROOT, "art/map/paint"); OUT = os.path.join(ROOT, "public/assets/map")
W_HALF, REGION_M, CENTERS = 100.0, 60.0, [-52.0, 0.0, 52.0]
CH, CHUNK_PX = 8, 1024                         # 地面网格是 8×8 块，每块 25 米，一块一张 1024 像素的贴图（约 41 像素/米）
PPM = CHUNK_PX / (2 * W_HALF / CH)
FEATHER_M = 7.0
# 我方一侧的色调对齐到用户验收过的样板间：同一个位置，样板间的草是 (115,120,51)、石板 (122,121,80)，照布局图的颜色画出来是 (124,136,64)、(138,139,91)，偏亮偏绿
GRADE_ME = np.array([0.91, 0.875, 0.84], np.float32)

# ---------------------------------------------------------------- 提示词
HEAD = "把第一张图（布局图）重绘成游戏的地面贴图。后面的图只是画风参考：学它们的笔触、颜色和质感，不要照搬它们的构图和内容。视角是正上方垂直俯视，没有透视，画面里没有任何立起来的东西（没有墙、没有建筑、没有树、没有石堆），没有投影，光照均匀。严格保持布局图的整体布局：每条石板路、每处同心圆铺地、河床、广场的位置、宽度、走向和颜色分区都不能变，不要增加任何布局图里没有的东西。"
P = {
 "grass": "草地：黄绿色的短草，细腻的草叶笔触，很缓的明暗变化，零星几朵很小的白花。布局图里是草地的地方只画草地，不要画土路、小溪、石圈。",
 "soil": "红土地：赭红色的干土，表面有细小的石子和浅浅的龟裂，稀稀地长着一丛丛暗红褐色的干草，很缓的明暗变化。布局图里是红土的地方只画红土，不要画土路、小溪、石圈、岩浆或发光的裂缝。",
 "slab_me": "石板路：一块块橄榄灰色的是老旧的石板，角磨圆了，有缺口和裂纹，表面有风化的斑驳和薄薄的青苔，颜色偏暖偏绿、和草地接近，不要画得发白，也不要发棕发红。石板和草地是长在一起的：草和青苔从缝里、从边上爬上石板，路边的石板半埋在草里、只露出一部分，石板和草地之间没有生硬的边界线，路两边也没有裸露的泥土。布局图里石板上发绿的斑，就是被草和苔盖住的地方。",
 "slab_foe": "红土地上的石板路：一块块暖灰色的老旧石板，角磨圆了，有缺口和裂纹，颜色偏暖偏暗；缝里和边上是红土和枯草，路边的石板半埋在土里、只露出一部分，石板和红土之间没有生硬的边界线。布局图里石板上发红的斑，就是被土和枯草盖住的地方。",
 "pad": "同心圆：防御塔脚下的圆形铺地，正中一块圆石，外面一圈大石板，再一圈窄的收边石，保持这几圈和每圈的分块，圈外的石板散进地面里。",
 "river": "河床：那条很宽的灰蓝色带子是干的河床，没有水，宽度和布局图完全一样：深色的细沙上嵌着一块挨一块的圆润的大扁石，石头表面光滑；路穿过河床的那一段，方正的石板照样铺过去，颜色偏冷偏暗。河岸是窄窄一条深色的湿苔，和岸上的地面柔和过渡。",
 "island": "河床鼓成圆形的地方，正中那块灰绿色的圆是一整块露出来的平整岩石，表面有风化的纹路、浅浅的裂缝和几片青苔，不要画成铺地或图案。",
 "camp_me": "草地上那几块边缘模糊的土黄色斑块是被踩秃的泥土地：干燥、压实，有细小的石子和稀疏的草根，和周围的草地柔和过渡，不要画成沙坑、石圈或铺地。",
 "camp_foe": "红土地上那几块边缘模糊、颜色更深更褐的斑块是被踩实的硬土，有细小的石子，和周围柔和过渡，不要画成坑、石圈或铺地。",
 "plaza_me": "基地广场：那一大片扇形的浅色区域是石板铺成的广场。石板是围着一个圆心一圈一圈铺开的弧形大石板，浅灰白色，平整、干净，接缝细而清楚，偶尔有裂纹和磨损；每隔几圈有一圈青灰色的石板，保持这些圈和每圈的分块。靠近广场边缘的地方，缝里长出少量青苔和小草。广场上只有石板，不要画水槽、水池、发光的线、徽记或建筑的底座。角上那个小一些的同心圆是一个圆形的台面，同样是浅色石板。",
 "plaza_foe": "基地广场：那一大片扇形的深色区域是石板铺成的广场。石板是围着一个圆心一圈一圈铺开的弧形大石板，深灰色的玄武岩，平整，接缝细而清楚，有裂纹和磨损；每隔几圈有一圈赤陶色的石板，保持这些圈和每圈的分块。广场上只有石板，不要画岩浆、发光的线、火、徽记或建筑的底座。角上那个小一些的同心圆是一个圆形的台面，同样是深色石板。",
 "out": "画面最外侧那一圈颜色发暗、夹着石块颜色的区域是地图外面的荒地：粗糙的野草和露出地面的岩石，画得简单一些。",
}
TAIL = "画风：Dota 2 现在的地图那样的厚涂写实手绘地表，笔触清楚，细节丰富但整体干净，色调和布局图一致。无文字，无水印。"
SPLIT = "河床的左下一侧全是黄绿色的草地，右上一侧全是赭红色的土地，两种地面只隔着河床相接，不要互相混进去。"
ALL_FOE = "除了河床和石板，整张图的地面都是赭红色的土地。"
ME, FOE = "art/map/style/ground_me.jpg", "art/map/style/ground_foe.jpg"
# 每个区里有什么（按布局看的）
REGIONS = {
 "r_0_0": (["grass", "soil", "slab_me", "slab_foe", "pad", "river", "island", "camp_me", "camp_foe", "out"], SPLIT, [ME, FOE]),
 "r_1_0": (["soil", "slab_foe", "pad", "river", "island", "camp_foe", "out"], ALL_FOE, [FOE]),
 "r_2_0": (["soil", "slab_foe", "pad", "plaza_foe", "camp_foe", "out"], ALL_FOE, [FOE, "art/map/style/plaza_foe.jpg"]),
 "r_0_1": (["grass", "slab_me", "pad", "river", "island", "camp_me", "out"], "", [ME]),
 "r_1_1": (["grass", "soil", "slab_me", "slab_foe", "pad", "river"], SPLIT, [ME, FOE]),
 "r_2_1": (["soil", "slab_foe", "pad", "river", "island", "camp_foe", "out"], ALL_FOE, [FOE]),
 "r_0_2": (["grass", "slab_me", "pad", "plaza_me", "camp_me", "out"], "", [ME, "art/map/style/plaza_me.jpg"]),
 "r_1_2": (["grass", "slab_me", "pad", "river", "island", "camp_me", "out"], "", [ME]),
 "r_2_2": (["grass", "soil", "slab_me", "slab_foe", "pad", "river", "island", "camp_me", "camp_foe", "out"], SPLIT, [ME, FOE]),
}

def jobs(out, names):
    js = []
    for n in names or list(REGIONS):
        parts, split, refs = REGIONS[n]
        js.append({"name": f"map-ground-v1-{n}", "out": f"art/map/paint/{n}.png", "model": "jm_image_model_oa_it", "ratio": "1:1", "resolution": "4K",
                   "prompt": HEAD + split + "".join(P[k] for k in parts) + TAIL, "ref_files": [f"art/map/region/{n}.jpg"] + refs})
    json.dump(js, open(out, "w"), ensure_ascii=False, indent=1); print("写了", len(js), "个任务到", out)

# ---------------------------------------------------------------- 拼接
def blur(a, r):
    """大半径的模糊：先缩小再模糊再放大，省时间"""
    h, w = a.shape[:2]; k = max(1, int(r // 4))
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).resize((max(w // k, 1), max(h // k, 1)), Image.BILINEAR).filter(ImageFilter.GaussianBlur(r / k))
    return np.asarray(im.resize((w, h), Image.BILINEAR)).astype(np.float32) / 255.0

def load_region(n):
    """读一个区：重绘的图缩到统一的比例尺，大色块拉回布局图。返回 (图, 左上角在整张画布上的像素坐标)"""
    i, j = int(n[2]), int(n[4]); px = int(round(REGION_M * PPM))
    t = np.asarray(Image.open(os.path.join(PAINT, n + ".png")).convert("RGB").resize((px, px), Image.LANCZOS)).astype(np.float32) / 255.0
    g = np.asarray(Image.open(os.path.join(REG, n + ".jpg")).convert("RGB").resize((px, px), Image.LANCZOS)).astype(np.float32) / 255.0
    R = 2.5 * PPM
    t = np.clip(t * np.clip((blur(g, R) + 0.02) / (blur(t, R) + 0.02), 0.72, 1.38), 0, 1)
    # 布局图上是干净石板、河床、广场的地方（颜色发灰），重绘有时会盖上太多的苔，整块发绿发褐。
    # 这些地方把颜色的鲜艳程度收掉四分之一多，石板还是石板；布局图上本来就是草、苔、土的地方不动
    gmx, gmn = g.max(axis=2), g.min(axis=2); gs = 1 - np.clip(((gmx - gmn) / np.maximum(gmx, 1e-3) - 0.30) / 0.12, 0, 1)
    gs = blur(np.dstack([gs] * 3), 3)[..., :1]
    lum = (t @ np.array([0.3, 0.59, 0.11], np.float32))[..., None]
    t = lum + (t - lum) * (1 - 0.27 * gs)
    x0 = int(round((CENTERS[i] - REGION_M / 2 + W_HALF) * PPM)); y0 = int(round((CENTERS[j] - REGION_M / 2 + W_HALF) * PPM))
    # 权重：和别的区相邻的边上羽化，靠地图外面的边不羽化
    fe = FEATHER_M * PPM; ramp = np.clip((np.minimum(np.arange(px), px - 1 - np.arange(px)) - 0.5 * PPM) / fe, 0, 1).astype(np.float32); ramp = ramp * ramp * (3 - 2 * ramp)
    wx, wy = ramp.copy(), ramp.copy()
    if i == 0: wx[:px // 2] = 1
    if i == 2: wx[px // 2:] = 1
    if j == 0: wy[:px // 2] = 1
    if j == 2: wy[px // 2:] = 1
    return t, (wy[:, None] * wx[None, :]) + 1e-4, x0, y0

def build(preview=None):
    names = [n for n in REGIONS if os.path.exists(os.path.join(PAINT, n + ".png"))]
    print("已经画好的区：", names)
    S = int(round(2 * W_HALF * PPM))                                          # 整张画布的边长（像素）
    guide = Image.open(os.path.join(ROOT, "art/map/guide/all.png")).convert("RGB")
    regs = [load_region(n) for n in names]
    os.makedirs(os.path.join(OUT, "ground"), exist_ok=True)
    over = Image.new("RGB", (2048, 2048)); mask = Image.new("L", (4096, 4096)); k_over = 2048 / S; k_mask = 4096 / S; index = []
    for cj in range(CH):
        for ci in range(CH):
            X0, Y0 = ci * CHUNK_PX, cj * CHUNK_PX
            # 底：布局图放大（墙外面、还没画的区就是它）
            gk = guide.size[0] / S
            base = np.asarray(guide.crop((int(X0 * gk), int(Y0 * gk), int((X0 + CHUNK_PX) * gk), int((Y0 + CHUNK_PX) * gk))).resize((CHUNK_PX, CHUNK_PX), Image.BICUBIC)).astype(np.float32) / 255.0
            acc = np.zeros_like(base); ws = np.zeros((CHUNK_PX, CHUNK_PX), np.float32)
            for t, w, x0, y0 in regs:
                px = t.shape[0]; ax0, ay0, ax1, ay1 = max(X0, x0), max(Y0, y0), min(X0 + CHUNK_PX, x0 + px), min(Y0 + CHUNK_PX, y0 + px)
                if ax1 <= ax0 or ay1 <= ay0: continue
                ww = w[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0]
                acc[ay0 - Y0:ay1 - Y0, ax0 - X0:ax1 - X0] += t[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0] * ww[..., None]; ws[ay0 - Y0:ay1 - Y0, ax0 - X0:ax1 - X0] += ww
            cover = np.clip(ws / 0.5, 0, 1)[..., None]                         # 画过的地方用画的；画的范围的最外沿过渡回布局图
            full = base * (1 - cover) + (acc / np.maximum(ws, 1e-4)[..., None]) * cover
            # 河道左下是我方：乘上对齐样板间的色调，隔着河道过渡到对方一侧不变
            xs = (X0 + np.arange(CHUNK_PX) + 0.5) / PPM - W_HALF; zs = (Y0 + np.arange(CHUNK_PX) + 0.5) / PPM - W_HALF
            u = (xs[None, :] - zs[:, None]) / np.sqrt(2.0); t = np.clip((u + 3) / 6, 0, 1); me = (1 - t * t * (3 - 2 * t))[..., None]
            full = full * (1 - me * (1 - GRADE_ME))
            # 石板的边再清楚一点（样板间多画过一遍细节，这里用锐化补一部分）；草地不动，不然一地碎笔触
            mx0, mn0 = full.max(axis=2), full.min(axis=2); stone = 1 - np.clip(((mx0 - mn0) / np.maximum(mx0, 1e-3) - 0.26) / 0.14, 0, 1)
            soft = np.asarray(Image.fromarray((np.clip(full, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))).astype(np.float32) / 255.0
            full = full + (full - soft) * 0.5 * stone[..., None]
            # 石板和缝之间的深浅拉开一点（半米大小的明暗），石板面才从草里“立”出来；同样只动石头
            wide = blur(np.clip(full, 0, 1), 0.5 * PPM)
            full = full + (full - wide) * 0.16 * stone[..., None]
            im = Image.fromarray((np.clip(full, 0, 1) * 255).astype(np.uint8))
            cp = os.path.join(OUT, "ground", f"c_{ci}_{cj}.webp")
            if cover.max() > 0.01: im.save(cp, quality=88, method=5); index.append(f"c_{ci}_{cj}")      # 只存画到了的块；全在墙外的块游戏里用总览就够了
            elif os.path.exists(cp): os.remove(cp)
            over.paste(im.resize((int(round(CHUNK_PX * k_over)),) * 2, Image.LANCZOS), (int(round(X0 * k_over)), int(round(Y0 * k_over))))
            # 哪里是草（或红土）：颜色鲜艳的是草和土，灰的是石头
            mx, mn = full.max(axis=2), full.min(axis=2); sat = (mx - mn) / np.maximum(mx, 1e-3)
            mask.paste(Image.fromarray((np.clip((sat - 0.3) / 0.14, 0, 1) * 255).astype(np.uint8)).resize((int(round(CHUNK_PX * k_mask)),) * 2, Image.BILINEAR), (int(round(X0 * k_mask)), int(round(Y0 * k_mask))))
        print("第", cj, "行拼好了", flush=True)
    over.save(os.path.join(OUT, "ground_all.webp"), quality=88, method=6); os.makedirs(os.path.join(ROOT, "art/map"), exist_ok=True); mask.save(os.path.join(ROOT, "art/map/ground_mask.png"), optimize=True); mask.resize((2048, 2048), Image.LANCZOS).save(os.path.join(OUT, "ground_mask.webp"), quality=88, method=6)      # 阶段 8：游戏里用 2048 的 WebP（0.4 MB），4096 的原图留在 art/map/
    json.dump({"chunks": index, "chunkPx": CHUNK_PX, "regions": names}, open(os.path.join(OUT, "ground", "index.json"), "w"))
    tot = sum(os.path.getsize(os.path.join(OUT, "ground", f)) for f in os.listdir(os.path.join(OUT, "ground")))
    print("分块贴图", len(index), "张，共", tot // 1024, "KB；总览", os.path.getsize(os.path.join(OUT, "ground_all.webp")) // 1024, "KB；蒙版", os.path.getsize(os.path.join(OUT, "ground_mask.webp")) // 1024, "KB")
    if preview: over.resize((1400, 1400), Image.LANCZOS).save(preview, quality=88)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "jobs": jobs(sys.argv[2], sys.argv[3:])
    else: build(sys.argv[2] if len(sys.argv) > 2 else None)
