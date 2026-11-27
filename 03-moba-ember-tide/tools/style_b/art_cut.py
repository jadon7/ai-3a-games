#!/usr/bin/env python3
"""换画风 B · b-art：把即梦出的 B 风格原图（主目录 art/style_b/ui/raw/，不进 git）切成游戏里用的图，覆盖 public/assets/ui/ 里第九轮的暗调写实版。
文件名、尺寸照旧（做法照第九轮的 art/ui/art4_cut.py、tools/item_icons.py、tools/ui_cut.py）：
  竖版海报 splash/<id>.webp 1200×1600；头像 face/<id>.webp 256×256（从竖版原图裁脸）；横版 wide/<id>.webp 1920×1080
  技能图标 skill/<id>_<p|q|w|e|r>.webp 160×160；装备 item/<id>.webp 128×128；增益 buff/<id>.webp、recall.webp、gold.webp 128×128；emblem.webp 1024×1024
图标原图是 3 列 2 行的合集，格子之间是纯黑的粗线，按黑线找格子（第九轮 art4 的 bands：图标本身可能有深色底，只认亮度 < 6 的纯黑）。
用法: python3.14 tools/style_b/art_cut.py [只做这几类，逗号分开：splash,face,wide,skill,item,misc]
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance
RAW = "/Users/jadon7/Documents/SynologyDrive/code/moba/art/style_b/ui/raw"          # 原图只在主目录
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "public/assets/ui")
ONLY = set(sys.argv[1].split(",")) if len(sys.argv) > 1 else None

# 竖版：原图、裁切框（左、上、宽，占原图宽的比例，高按 3:4 推；None 是整张）。岚用 l4（l3 往后拉远一点，鱼鳍尖冠上面留出天空；l3 尖冠顶到上边）
SPLASH = {h: (f"splash_{h}_a.png", None) for h in ["torg", "moko", "osen", "vero", "kaz", "hedda", "ugo", "seren"]}
SPLASH.update({"lan": ("splash_lan_l4.png", None), "gorran": ("splash_gorran_libs.png", None)})
# 头像：中心（占宽、占高）、裁多宽（占宽）、从哪张原图裁（不写就是竖版那张）。缩到顶栏四五十像素时靠头上的标志认人：
# 岚的鱼鳍兜帽（从脸更大的 l3 裁）、奥森的烛台鹿角、卡兹的耳簇、乌戈的灯球、塞伦的螺壳盔都要裁进来
FACE = {"lan": (0.55, 0.27, 0.36, "splash_lan_l3.png"), "gorran": (0.50, 0.17, 0.32), "torg": (0.28, 0.27, 0.44), "moko": (0.53, 0.14, 0.40),
        "osen": (0.38, 0.15, 0.52), "vero": (0.30, 0.25, 0.36), "kaz": (0.33, 0.29, 0.50), "hedda": (0.47, 0.16, 0.32), "ugo": (0.60, 0.21, 0.66), "seren": (0.52, 0.15, 0.44)}
# 横版：原图、裁切框（同上，按 16:9）。岚的两张横版尖冠都顶到上边，选背景更干净的 l2（选人页的背景本来就裁掉上沿）
WIDE = {h: (f"wide_{h}_a.png", None) for h in ["torg", "moko", "osen", "vero", "kaz", "hedda", "ugo", "seren"]}
WIDE.update({"lan": ("wide_lan_l2.png", None), "gorran": ("wide_gorran_l1.png", None)})
# 技能图标：每个技能取哪张合集的第几格（从左到右、从上到下 0..5）；每张合集多出的格子是备选
def _sk(h, src, keys, cells): return {k: (src, i) for k, i in zip(keys, cells)}
SKILL = {
    "lan": _sk("lan", "skill_lan_l1.png", "pqwr", [0, 1, 2, 3]),
    "gorran": _sk("gorran", "skill_gorran_l2.png", "qwer", [0, 1, 2, 3]),        # Q 砧撞用铁砧肩甲（第 0 格），塔盾冲锋（第 4 格）和 W 的盾缩小了分不开
    "torg": _sk("torg", "skill_torg_a.png", "pqwr", [0, 1, 2, 3]),
    "moko": _sk("moko", "skill_moko_a.png", "qwer", [0, 1, 2, 3]),
    "osen": _sk("osen", "skill_osen_a.png", "qwer", [0, 1, 2, 3]),
    "vero": _sk("vero", "skill_vero_a.png", "qwer", [0, 1, 2, 3]),
    "kaz": _sk("kaz", "skill_kaz_a.png", "pqwer", [0, 1, 2, 3, 4]),
    "hedda": _sk("hedda", "skill_hedda_a.png", "pqwer", [0, 1, 2, 5, 4]),       # E 护火用“手护着一团火”（第 5 格），两个小人剪影那格像界面图标、不像技能
    "ugo": _sk("ugo", "skill_ugo_a.png", "pqwer", [0, 1, 2, 3, 4]),
    "seren": _sk("seren", "skill_seren_a.png", "pqwer", [0, 1, 2, 3, 4]),
}
# 装备：每张合集从左到右、从上到下是哪几件；None 是没用上的备选（顺序和 art/style_b/ui/make_jobs.py 的 ITEM_IDS 一致）
ITEMS = {"item_a_a.png": ["blade", "bow", "fang", "tome", "vial", "charm"], "item_b_a.png": ["coral", "plate", "cloak", "boots", "edge", "great"],
         "item_c_a.png": ["zeal", "vamp", None, "orb", "rod", "heart"], "item_d_a.png": ["mail", "scale", "conch", "boots_as", "boots_ar", "boots_mr"],
         "item_e_a.png": ["boots_ap", "boots_cd", "furnace", "thorn", "bulwark", "tide"], "item_f_a.png": [None, "anchor", "ambush", "hunter", "reaper", "staff"],
         "item_g_a.png": ["ember", "abyss", "inferno", "harpoon", "fury", "locket"], "item_h_a.png": ["horn", "banner", None, None, None, None],
         # 补的一张：第一版的炉火刻印画成了带火的短棒、缩小了和黑铁法杖分不开，换成圆印章；炉心三锻的锤头像缠着布，换成三色分段的锤头
         "item_x_a.png": ["forge", None, "trinity", None, None, None]}
# 增益和杂项：合集里每格存成哪个文件（相对 public/assets/ui，不带扩展名）和多大。emblem.webp 现在代码里没有用到，照旧换掉（装备合集 h 的第 2 格）
MISC = {"misc_a.png": [("buff/blue", (128, 128)), ("buff/red", (128, 128)), ("buff/beast", (128, 128)), ("buff/troll", (128, 128)), ("recall", (128, 128)), ("gold", (128, 128))],
        "item_h_a.png": [None, None, ("emblem", (1024, 1024)), None, None, None]}

made = []
def save(im, rel, size, q=88):
    p = f"{OUT}/{rel}.webp"; os.makedirs(os.path.dirname(p), exist_ok=True)
    im.convert("RGB").resize(size, Image.LANCZOS).save(p, quality=q, method=6); made.append(p)

def box(im, b, aspect):
    if not b: return im
    l, t, w = b; W = im.width * w; H = W / aspect
    return im.crop((int(im.width * l), int(im.height * t), int(im.width * l + W), int(im.height * t + H)))

def bands(frac, n):
    """frac：每一列（行）里纯黑像素的比例。返回 n 段图标的 (起, 止)，找不到黑线就均分。"""
    L = len(frac); runs = []; s = None
    for i, v in enumerate(list(frac) + [0]):
        if v > 0.85 and s is None: s = i
        if v <= 0.85 and s is not None:
            if i - s >= 3: runs.append((s, i - 1))
            s = None
    lo = runs[0][1] + 1 if runs and runs[0][0] == 0 else 0
    hi = runs[-1][0] - 1 if runs and runs[-1][1] == L - 1 else L - 1
    edges = [lo]
    for k in range(1, n):
        c = lo + (hi - lo) * k / n; near = [r for r in runs if abs((r[0] + r[1]) / 2 - c) < L / n / 4]
        r = min(near, key=lambda r: abs((r[0] + r[1]) / 2 - c)) if near else (int(c), int(c))
        edges += [r[0] - 1, r[1] + 1]
    edges.append(hi)
    return [(edges[2 * i], edges[2 * i + 1]) for i in range(n)]

_cells = {}
def cells(name, cols=3, rows=2, inset=0.03):
    """合集切成正方形格子；inset 是每格四边往里收多少（去掉黑线边上残留的一圈和画出来的内框）。"""
    if name in _cells: return _cells[name]
    im = Image.open(f"{RAW}/{name}").convert("RGB"); black = np.asarray(im.convert("L")) < 8
    xs = bands(black.mean(0), cols); ys = bands(black.mean(1), rows); out = []
    for r in range(rows):
        for c in range(cols):
            x0, x1 = xs[c]; y0, y1 = ys[r]; s = min(x1 - x0, y1 - y0) * (1 - inset * 2); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            out.append(im.crop((int(cx - s / 2), int(cy - s / 2), int(cx + s / 2), int(cy + s / 2))))
    _cells[name] = out; return out

def want(k): return ONLY is None or k in ONLY

if want("splash") or want("face"):
    for hid, (src, b) in SPLASH.items():
        im = Image.open(f"{RAW}/{src}").convert("RGB")
        if want("splash"): save(box(im, b, 3 / 4), "splash/" + hid, (1200, 1600))
        if want("face") and hid in FACE:
            cx, cy, k, *src2 = FACE[hid]; fim = Image.open(f"{RAW}/{src2[0]}").convert("RGB") if src2 else im; s = fim.width * k
            x0 = max(0, min(fim.width - s, fim.width * cx - s / 2)); y0 = max(0, min(fim.height - s, fim.height * cy - s / 2))
            f = fim.crop((int(x0), int(y0), int(x0 + s), int(y0 + s))).resize((256, 256), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.2, 40, 2))
            save(f, "face/" + hid, (256, 256))
if want("wide"):
    for hid, (src, b) in WIDE.items(): save(box(Image.open(f"{RAW}/{src}").convert("RGB"), b, 16 / 9), "wide/" + hid, (1920, 1080), q=82)   # 亮的卡通背景细节多，q88 比旧版大一半；选人页压暗、载入页模糊着用，q82 看不出差别
if want("skill"):
    for hid, order in SKILL.items():
        for key, (src, i) in order.items(): save(cells(src)[i], f"skill/{hid}_{key}", (160, 160))
if want("item"):
    for src, ids in ITEMS.items():
        for name, im in zip(ids, cells(src)):
            if name: save(im, "item/" + name, (128, 128))
if want("misc"):
    for src, lst in MISC.items():
        for spec, im in zip(lst, cells(src)):
            if spec: save(im, spec[0], spec[1])
print(len(made), "张，合计", round(sum(os.path.getsize(p) for p in made) / 1e6, 2), "MB")
