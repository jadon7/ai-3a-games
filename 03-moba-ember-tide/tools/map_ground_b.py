#!/usr/bin/env python3
"""地面贴图按画风 B 重画（换画风 B · b-toon）。管线和 tools/map_ground.py（阶段 2.5）一样，只换了这几样：
  · 布局图换成 B 配色导出的（art/map/region_b/，导出时网址不带 toon=0，slice/guide.ts、world/guide.ts 里的 B 色表）；
  · 画风参考换成 B 设计稿的裁片（art/map/style_b/，从 art/concepts22/env_me_b.png、env_foe_b.png 裁的，只裁地面、不带墙和塔）；
  · 提示词：明快干净的卡通厚涂，石板是干净的大块、苔少，草地是一整片明亮的绿，河床只画河底；
  · 拼接：不再给我方乘偏黄的色调（GRADE_ME 是 A 版对齐样板间用的），石板的锐化和局部对比减半（B 要干净，不要碎）。
整张图的底（城墙外、九个区没画到的地方）用 B 配色的全图布局图 art/map/guide_b/all.png。
不进 git 的东西（布局图、重画结果、参考图）都在主目录的 art/ 下，所以路径写死主目录；输出写到运行这个脚本的仓库（worktree）的 public/assets/map/。

用法：
  python3 tools/map_ground_b.py jobs <输出.json> [区名 ...]   生成重画任务（jimeng_i2i.py 的格式，不给区名就是全部九个）
  python3 tools/map_ground_b.py build [预览.jpg]              拼出 public/assets/map/ground/ 下的分块贴图、总览图、草地蒙版
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

MAIN = "/Users/jadon7/Documents/SynologyDrive/code/moba"                     # 主目录（art/ 只在这里）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # 输出到这个仓库
REG = os.path.join(MAIN, "art/map/region_b"); PAINT = os.path.join(MAIN, "art/map/paint_b"); OUT = os.path.join(ROOT, "public/assets/map")
GUIDE = os.path.join(MAIN, "art/map/guide_b/all.png"); MASK = os.path.join(MAIN, "art/map/b/ground_mask.png")
W_HALF, REGION_M, CENTERS = 100.0, 60.0, [-52.0, 0.0, 52.0]
CH, CHUNK_PX = 8, 1024
PPM = CHUNK_PX / (2 * W_HALF / CH)
FEATHER_M = 7.0
POOL = 0.03      # 一二十米大的冷暖光斑（亮处偏暖黄、暗处偏冷）的幅度，按 sRGB 乘：B 的草地不是一块平涂的绿。原来在着色里每个像素现算，拉远了掉帧，烘进贴图不花钱
EDGE_PX, EDGE_DARK, EDGE_LIT, EDGE_CAST = 4, 0.2, 0.05, 0.16      # 石板厚度的那道暗边：宽几个像素（41 像素/米，4 像素约 10 厘米）、压暗多少、受光边提亮多少、落在草上的小影子多深

# ---------------------------------------------------------------- 提示词
HEAD = "把第一张图（布局图）重绘成游戏的地面贴图。后面的图只是画风参考：学它们的画风、颜色和笔触（明快干净的卡通厚涂），不要照搬它们的构图和内容，也不要画它们里面的墙、塔和建筑。视角是正上方垂直俯视，没有透视，画面里没有任何立起来的东西（没有墙、没有建筑、没有树、没有石堆），没有投影，光照均匀。严格保持布局图的整体布局：每条石板路、每处同心圆铺地、河床、广场的位置、宽度、走向和颜色分区都不能变，不要增加任何布局图里没有的东西。"
P = {
 "grass": "草地：一整片明亮清爽的嫩绿色草地，大块的平涂加几笔概括的草叶笔触，颜色干净，只有很缓、很大块的明暗变化；不要细碎的杂色斑点，不要小花，不要枯黄的斑块。布局图里是草地的地方只画草地，不要画土路、小溪、石圈。",
 "soil": "红土地：干净的橙红色土地，大块平涂，零星几笔简单的小草叶，很缓的明暗变化；不要龟裂，不要碎石子，不要杂乱的干草堆。布局图里是红土的地方只画红土，不要画土路、小溪、石圈、岩浆或发光的裂缝。",
 "slab_me": "石板路：一块块干净的浅米灰色大石板，形状圆润、边角圆滑，表面平整，只有一两笔很淡的笔触，没有青苔、没有裂纹、没有风化的斑驳；石板之间的缝里长着亮绿色的短草，路边的几块石板散进草地里。",
 "slab_foe": "红土地上的石板路：一块块干净的暖灰色大石板，形状圆润、边角圆滑，表面平整，没有裂纹和斑驳；缝里和路边是红土和几根橙色的小草，路边的几块石板散进红土里。",
 "pad": "同心圆：防御塔脚下的圆形铺地，正中一块圆石，外面一圈大石板，再一圈窄的收边石，保持这几圈和每圈的分块，石板干净圆润，圈外的石板散进地面里。",
 "river": "河床：那条很宽的灰蓝色带子是浅水下面的河底（水面另外做，这里只画河底，不要画水面、反光、波纹和白色的亮点）：一块挨一块的浅灰蓝色圆润大扁石，石头干净光滑，缝里是青灰色的细沙，宽度和布局图完全一样；路穿过河床的那一段，方正的石板照样铺过去。河岸是窄窄一条湿润的深色边，和岸上的地面柔和过渡。",
 "island": "河床鼓成圆形的地方，正中那块灰绿色的圆是一整块露出来的平整岩石，干净圆润，几笔简单的纹路，不要画成铺地或图案。",
 "camp_me": "草地上那几块边缘模糊的土黄色斑块是被踩秃的亮黄土地，干净平整，和周围的草地柔和过渡，不要画成沙坑、石圈或铺地。",
 "camp_foe": "红土地上那几块边缘模糊、颜色更深的斑块是被踩实的深红土，干净平整，和周围柔和过渡，不要画成坑、石圈或铺地。",
 "plaza_me": "基地广场：那一大片扇形的浅色区域是石板铺成的广场。石板是围着一个圆心一圈一圈铺开的弧形大石板，浅米灰色，平整干净，接缝细而清楚；每隔几圈有一圈青灰色的石板，保持这些圈和每圈的分块。广场上只有石板，不要画水槽、水池、发光的线、徽记或建筑的底座。角上那个小一些的同心圆是一个圆形的台面，同样是浅色石板。",
 "plaza_foe": "基地广场：那一大片扇形的深色区域是石板铺成的广场。石板是围着一个圆心一圈一圈铺开的弧形大石板，暖调的深灰色，平整干净，接缝细而清楚；每隔几圈有一圈赤陶色的石板，保持这些圈和每圈的分块。广场上只有石板，不要画岩浆、发光的线、火、徽记或建筑的底座。角上那个小一些的同心圆是一个圆形的台面，同样是深色石板。",
 "out": "画面最外侧那一圈颜色发暗的区域是地图外面的野地：深一档的草地（红土一侧是深一档的红土）和几块圆润的灰色岩石，画得简单概括。",
}
TAIL = "画风：王者荣耀峡谷那样明快干净的卡通厚涂游戏美术，贴图简洁，大色块概括，边缘干净，颜色明亮清爽，色调和布局图一致。不要写实的照片质感，不要破败、杂乱、细碎的纹理，不要黑色粗描边。无文字，无水印。"
SPLIT = "河床的左下一侧全是嫩绿色的草地，右上一侧全是橙红色的土地，两种地面只隔着河床相接，不要互相混进去。"
ALL_FOE = "除了河床和石板，整张图的地面都是橙红色的土地。"
STY = os.path.join(MAIN, "art/map/style_b")
ME, FOE = os.path.join(STY, "ground_me.jpg"), os.path.join(STY, "ground_foe.jpg")
REGIONS = {
 "r_0_0": (["grass", "soil", "slab_me", "slab_foe", "pad", "river", "island", "camp_me", "camp_foe", "out"], SPLIT, [ME, FOE]),
 "r_1_0": (["soil", "slab_foe", "pad", "river", "island", "camp_foe", "out"], ALL_FOE, [FOE]),
 "r_2_0": (["soil", "slab_foe", "pad", "plaza_foe", "camp_foe", "out"], ALL_FOE, [FOE]),
 "r_0_1": (["grass", "slab_me", "pad", "river", "island", "camp_me", "out"], "", [ME]),
 "r_1_1": (["grass", "soil", "slab_me", "slab_foe", "pad", "river"], SPLIT, [ME, FOE]),
 "r_2_1": (["soil", "slab_foe", "pad", "river", "island", "camp_foe", "out"], ALL_FOE, [FOE]),
 "r_0_2": (["grass", "slab_me", "pad", "plaza_me", "camp_me", "out"], "", [ME]),
 "r_1_2": (["grass", "slab_me", "pad", "river", "island", "camp_me", "out"], "", [ME]),
 "r_2_2": (["grass", "soil", "slab_me", "slab_foe", "pad", "river", "island", "camp_me", "camp_foe", "out"], SPLIT, [ME, FOE]),
}

def jobs(out, names, model="jm_image_model_oa_it", tag="v1"):
    js = []
    for n in names or list(REGIONS):
        parts, split, refs = REGIONS[n]
        # jimeng_i2i.py 的路径按主目录算相对路径
        rel = lambda p: os.path.relpath(p, MAIN)
        js.append({"name": f"b-ground-{tag}-{n}", "out": rel(os.path.join(PAINT, n + ".png")), "model": model, "ratio": "1:1", "resolution": "4K",
                   "prompt": HEAD + split + "".join(P[k] for k in parts) + TAIL, "ref_files": [rel(os.path.join(REG, n + ".jpg"))] + [rel(r) for r in refs]})
    json.dump(js, open(out, "w"), ensure_ascii=False, indent=1); print("写了", len(js), "个任务到", out)

# ---------------------------------------------------------------- 拼接（同 map_ground.py，改动见开头）
def blur(a, r):
    h, w = a.shape[:2]; k = max(1, int(r // 4))
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).resize((max(w // k, 1), max(h // k, 1)), Image.BILINEAR).filter(ImageFilter.GaussianBlur(r / k))
    return np.asarray(im.resize((w, h), Image.BILINEAR)).astype(np.float32) / 255.0

def load_region(n):
    i, j = int(n[2]), int(n[4]); px = int(round(REGION_M * PPM))
    t = np.asarray(Image.open(os.path.join(PAINT, n + ".png")).convert("RGB").resize((px, px), Image.LANCZOS)).astype(np.float32) / 255.0
    g = np.asarray(Image.open(os.path.join(REG, n + ".jpg")).convert("RGB").resize((px, px), Image.LANCZOS)).astype(np.float32) / 255.0
    R = 2.5 * PPM
    t = np.clip(t * np.clip((blur(g, R) + 0.02) / (blur(t, R) + 0.02), 0.72, 1.38), 0, 1)
    # 布局图上是石板、河床、广场的地方（颜色发灰），重画偶尔会盖上苔、发绿发褐：收掉一部分鲜艳程度（B 的石板本来就干净，收得比 A 版多一点）
    gmx, gmn = g.max(axis=2), g.min(axis=2); gs = 1 - np.clip(((gmx - gmn) / np.maximum(gmx, 1e-3) - 0.30) / 0.12, 0, 1)
    gs = blur(np.dstack([gs] * 3), 3)[..., :1]
    lum = (t @ np.array([0.3, 0.59, 0.11], np.float32))[..., None]
    t = lum + (t - lum) * (1 - 0.35 * gs)
    x0 = int(round((CENTERS[i] - REGION_M / 2 + W_HALF) * PPM)); y0 = int(round((CENTERS[j] - REGION_M / 2 + W_HALF) * PPM))
    fe = FEATHER_M * PPM; ramp = np.clip((np.minimum(np.arange(px), px - 1 - np.arange(px)) - 0.5 * PPM) / fe, 0, 1).astype(np.float32); ramp = ramp * ramp * (3 - 2 * ramp)
    wx, wy = ramp.copy(), ramp.copy()
    if i == 0: wx[:px // 2] = 1
    if i == 2: wx[px // 2:] = 1
    if j == 0: wy[:px // 2] = 1
    if j == 2: wy[px // 2:] = 1
    return t, (wy[:, None] * wx[None, :]) + 1e-4, x0, y0

_rng = np.random.default_rng(1717); POOL_G = [(28.0, _rng.random((12, 12)).astype(np.float32)), (11.0, _rng.random((24, 24)).astype(np.float32))]
def pool_noise(xs, zs):
    """世界坐标上的平滑值噪声（两层，格子 28 米和 11 米），0～1。xs、zs 是一维的世界坐标，返回 [z, x] 的二维"""
    out = np.zeros((len(zs), len(xs)), np.float32)
    for (cell, g), wgt in zip(POOL_G, (0.65, 0.35)):
        n = g.shape[0]; fx = (xs + W_HALF) / cell; fz = (zs + W_HALF) / cell
        ix, iz = np.floor(fx).astype(int), np.floor(fz).astype(int); tx, tz = fx - ix, fz - iz
        tx, tz = tx * tx * (3 - 2 * tx), tz * tz * (3 - 2 * tz)
        a = g[np.ix_(iz % n, ix % n)]; b = g[np.ix_(iz % n, (ix + 1) % n)]; c = g[np.ix_((iz + 1) % n, ix % n)]; d = g[np.ix_((iz + 1) % n, (ix + 1) % n)]
        out += wgt * ((a * (1 - tx) + b * tx) * (1 - tz)[:, None] + (c * (1 - tx) + d * tx) * tz[:, None])
    return out

def build(preview=None):
    names = [n for n in REGIONS if os.path.exists(os.path.join(PAINT, n + ".png"))]
    print("已经画好的区：", names)
    S = int(round(2 * W_HALF * PPM))
    guide = Image.open(GUIDE).convert("RGB")
    regs = [load_region(n) for n in names]
    os.makedirs(os.path.join(OUT, "ground"), exist_ok=True)
    over = Image.new("RGB", (2048, 2048)); mask = Image.new("L", (4096, 4096)); k_over = 2048 / S; k_mask = 4096 / S; index = []
    for cj in range(CH):
        for ci in range(CH):
            X0, Y0 = ci * CHUNK_PX, cj * CHUNK_PX
            gk = guide.size[0] / S
            base = np.asarray(guide.crop((int(X0 * gk), int(Y0 * gk), int((X0 + CHUNK_PX) * gk), int((Y0 + CHUNK_PX) * gk))).resize((CHUNK_PX, CHUNK_PX), Image.BICUBIC)).astype(np.float32) / 255.0
            acc = np.zeros_like(base); ws = np.zeros((CHUNK_PX, CHUNK_PX), np.float32)
            for t, w, x0, y0 in regs:
                px = t.shape[0]; ax0, ay0, ax1, ay1 = max(X0, x0), max(Y0, y0), min(X0 + CHUNK_PX, x0 + px), min(Y0 + CHUNK_PX, y0 + px)
                if ax1 <= ax0 or ay1 <= ay0: continue
                ww = w[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0]
                acc[ay0 - Y0:ay1 - Y0, ax0 - X0:ax1 - X0] += t[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0] * ww[..., None]; ws[ay0 - Y0:ay1 - Y0, ax0 - X0:ax1 - X0] += ww
            cover = np.clip(ws / 0.5, 0, 1)[..., None]
            full = base * (1 - cover) + (acc / np.maximum(ws, 1e-4)[..., None]) * cover
            # 冷暖光斑
            xs = (X0 + np.arange(CHUNK_PX) + 0.5) / PPM - W_HALF; zs = (Y0 + np.arange(CHUNK_PX) + 0.5) / PPM - W_HALF
            w = np.clip((pool_noise(xs, zs) - 0.25) / 0.5, 0, 1); w = (w * w * (3 - 2 * w))[..., None]
            full = full * (np.array([1 - POOL, 1 - POOL * 0.6, 1.0], np.float32) * (1 - w) + np.array([1 + POOL, 1 + POOL * 0.7, 1 - POOL * 0.2], np.float32) * w)
            # 石板有厚度（B 的石板是一块块略高出地面的，背光的那条边是一道干净的暗边，地上还有一小条影子）：
            # 太阳从 -x、-z 那边照过来（world/main.ts 的 sunDir），所以石板朝 +x+z 的边压暗、朝 -x-z 的边提亮一点，石板往 +x+z 那边的草上落一小条影子
            mxe, mne = full.max(axis=2), full.min(axis=2); se = 1 - np.clip(((mxe - mne) / np.maximum(mxe, 1e-3) - 0.36) / 0.12, 0, 1)
            se = np.asarray(Image.fromarray((se * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255
            def sh(a, d):      # 整张往 +x+z 挪 d 个像素（d 为负就是往回挪）；边上用最外一圈像素补，不能用 np.roll（会把对边卷过来，块的接缝上多出一条暗线）
                p = np.pad(a, abs(d), mode="edge"); n = a.shape[0]; o = abs(d) - d
                return p[o:o + n, o:o + n]
            rim = se * (1 - sh(se, -EDGE_PX)); lit = se * (1 - sh(se, EDGE_PX)); cast = (1 - se) * sh(se, EDGE_PX + 1)
            full = full * (1 - EDGE_DARK * rim[..., None]) * (1 - EDGE_CAST * cast[..., None]) + EDGE_LIT * lit[..., None]
            # 石板的边清楚一点、石板和缝的深浅拉开一点，只动石头；B 只要 A 版的一半，多了就碎
            mx0, mn0 = full.max(axis=2), full.min(axis=2); stone = 1 - np.clip(((mx0 - mn0) / np.maximum(mx0, 1e-3) - 0.26) / 0.14, 0, 1)
            soft = np.asarray(Image.fromarray((np.clip(full, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))).astype(np.float32) / 255.0
            full = full + (full - soft) * 0.25 * stone[..., None]
            wide = blur(np.clip(full, 0, 1), 0.5 * PPM)
            full = full + (full - wide) * 0.08 * stone[..., None]
            im = Image.fromarray((np.clip(full, 0, 1) * 255).astype(np.uint8))
            cp = os.path.join(OUT, "ground", f"c_{ci}_{cj}.webp")
            if cover.max() > 0.01: im.save(cp, quality=88, method=5); index.append(f"c_{ci}_{cj}")
            elif os.path.exists(cp): os.remove(cp)
            over.paste(im.resize((int(round(CHUNK_PX * k_over)),) * 2, Image.LANCZOS), (int(round(X0 * k_over)), int(round(Y0 * k_over))))
            # 哪里是草（或红土）：颜色鲜艳的是草和土，灰的是石头。B 的石板是米灰（饱和度约 0.13～0.3），草约 0.6，红土约 0.7
            mx, mn = full.max(axis=2), full.min(axis=2); sat = (mx - mn) / np.maximum(mx, 1e-3)
            mask.paste(Image.fromarray((np.clip((sat - 0.34) / 0.14, 0, 1) * 255).astype(np.uint8)).resize((int(round(CHUNK_PX * k_mask)),) * 2, Image.BILINEAR), (int(round(X0 * k_mask)), int(round(Y0 * k_mask))))
        print("第", cj, "行拼好了", flush=True)
    over.save(os.path.join(OUT, "ground_all.webp"), quality=88, method=6); os.makedirs(os.path.dirname(MASK), exist_ok=True); mask.save(MASK, optimize=True); mask.resize((2048, 2048), Image.LANCZOS).save(os.path.join(OUT, "ground_mask.webp"), quality=88, method=6)
    json.dump({"chunks": index, "chunkPx": CHUNK_PX, "regions": names}, open(os.path.join(OUT, "ground", "index.json"), "w"))
    tot = sum(os.path.getsize(os.path.join(OUT, "ground", f)) for f in os.listdir(os.path.join(OUT, "ground")))
    print("分块贴图", len(index), "张，共", tot // 1024, "KB；总览", os.path.getsize(os.path.join(OUT, "ground_all.webp")) // 1024, "KB；蒙版", os.path.getsize(os.path.join(OUT, "ground_mask.webp")) // 1024, "KB")
    if preview: over.resize((1400, 1400), Image.LANCZOS).save(preview, quality=88)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "jobs":
        a = sys.argv[3:]; model = next((x.split("=", 1)[1] for x in a if x.startswith("model=")), "jm_image_model_oa_it"); tag = next((x.split("=", 1)[1] for x in a if x.startswith("tag=")), "v1")
        jobs(sys.argv[2], [x for x in a if "=" not in x], model, tag)
    else: build(sys.argv[2] if len(sys.argv) > 2 else None)
