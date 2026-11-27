# 换画风 B · b-walls：墙、石头、树皮用的干净平铺贴图（代码画，不花积分）。
# 画风 B 的石头是“干净的大色块 + 很淡的大斑 + 偶尔一两道浅裂纹”，不要 A 那种满面的凿痕、苔斑、脏。
# 贴图只管明暗的起伏（颜色在材质里给），所以基本是灰的，平均亮度写进 MEAN 里给材质用；青铜和暗铁带一点锈色。
# 白噪声在频域里滤一遍再变回来，天生首尾相接（平铺没有接缝）。
# 用法: /opt/homebrew/opt/python@3.14/bin/python3.14 tools/bwalls_tex.py <输出目录>（默认 public/assets/slice/tex）
import sys, json
import numpy as np
from PIL import Image

N = 1024
out = sys.argv[1] if len(sys.argv) > 1 else "public/assets/slice/tex"
fy, fx = np.meshgrid(np.fft.fftfreq(N) * N, np.fft.fftfreq(N) * N, indexing="ij")


def band(seed, lo, hi, ax=1.0, ay=1.0):
    """频率在 lo..hi（每张图几个周期）之间的平铺噪声，归一到标准差 1。ax、ay 拉长某个方向（树皮的竖纹）"""
    r = np.random.default_rng(seed)
    f = np.sqrt((fx * ax) ** 2 + (fy * ay) ** 2)
    w = np.exp(-((np.log(np.maximum(f, 1e-6)) - np.log(np.sqrt(lo * hi))) ** 2) / (2 * (np.log(hi / lo) / 2.6) ** 2))
    w[0, 0] = 0
    z = np.real(np.fft.ifft2(np.fft.fft2(r.standard_normal((N, N))) * w))
    return z / (z.std() + 1e-9)


def soft(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def cracks(seed, n, width, depth):
    """几道很浅的裂纹：随机游走的折线，先在四倍大的画布上画（越界的部分从另一边回来，不留接缝），再缩小、模糊一点，边是软的"""
    from PIL import ImageDraw, ImageFilter
    r = np.random.default_rng(seed)
    S = 2
    im = Image.new("L", (N * S, N * S), 0)
    d = ImageDraw.Draw(im)
    for _ in range(n):
        x, y, a = r.uniform(0, N), r.uniform(0, N), r.uniform(0, 2 * np.pi)
        steps = int(r.uniform(14, 30))
        pts = [(x, y)]
        for i in range(steps):
            a += r.normal(0, 0.45)
            x += np.cos(a) * 9
            y += np.sin(a) * 9
            pts.append((x, y))
        for i in range(len(pts) - 1):
            k = 1 - i / len(pts)                     # 越往后越细越浅
            w = max(1, int(width * S * (0.35 + 0.65 * k)))
            for ox in (-N, 0, N):
                for oy in (-N, 0, N):
                    d.line([((pts[i][0] + ox) * S, (pts[i][1] + oy) * S), ((pts[i + 1][0] + ox) * S, (pts[i + 1][1] + oy) * S)], fill=int(255 * (0.35 + 0.65 * k)), width=w)
    im = im.filter(ImageFilter.GaussianBlur(S * 1.2)).resize((N, N), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255 * depth


def facets(seed, n, amp, edge):
    """凿出来的大面：平铺的泰森多边形，每个面明暗差一点（像厚涂里一笔一个面），面和面交界处一道很细的暗线（凿痕）。按周期算距离，不留接缝"""
    r = np.random.default_rng(seed)
    pts = r.uniform(0, N, (n, 2))
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    d1 = np.full((N, N), 1e9, np.float32); d2 = np.full((N, N), 1e9, np.float32); idx = np.zeros((N, N), np.int32)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(xx - px); dx = np.minimum(dx, N - dx); dy = np.abs(yy - py); dy = np.minimum(dy, N - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d)); idx = np.where(closer, i, idx); d1 = np.where(closer, d, d1)
    shade = r.uniform(-1, 1, n)[idx] * amp
    seam = (1 - soft(d2 - d1, 0, 5)) * edge          # 两个最近点的距离差小 = 在交界上
    return shade - seam


def save(name, rgb):
    rgb = np.clip(rgb, 0, 1)
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), "RGB").save(f"{out}/{name}.webp", quality=88, method=6)
    lum = (rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722).mean()
    return round(float(lum), 3)


def grey(v):
    return np.stack([v, v, v], -1)


MEAN = {}
# 石头（墙、台阶、城墙）：一两米大的淡斑 ±5%，半米的笔触 ±2.5%，两三道浅裂纹。我方偏冷一点点，对方的玄武岩多一层细的暗纹
for team, seed, crack_n in (("me", 11, 3), ("foe", 23, 4)):
    big = band(seed, 1.2, 3.0) * 0.05
    mid = band(seed + 1, 5, 12) * 0.025
    fine = band(seed + 2, 28, 60) * (0.008 if team == "me" else 0.014)
    v = 0.72 + big + mid + fine - cracks(seed + 3, crack_n, 3.5, 0.09)
    if team == "foe":
        v -= soft(band(seed + 4, 6, 14), 1.4, 2.2) * 0.05      # 玄武岩上几块更暗的斑
        v += facets(seed + 5, 70, 0.045, 0.06)                  # 设计稿 B 对方的石头看得出一面一面凿出来的
    rgb = grey(v)
    rgb[..., 2] += (big * 0.15) if team == "me" else 0.0       # 亮斑偏暖、暗斑偏冷一点（厚涂的冷暖）
    rgb[..., 0] -= (big * 0.1) if team == "me" else 0.0
    MEAN[f"stone_{team}_b"] = save(f"stone_{team}_b", rgb)
# 大石头：和墙一样干净，斑大一点、浅裂纹多一道
for team, seed in (("me", 31), ("foe", 37)):
    v = 0.7 + band(seed, 1.0, 2.6) * 0.065 + band(seed + 1, 4, 10) * 0.03 + band(seed + 2, 24, 50) * 0.01 - cracks(seed + 3, 4, 4, 0.1) + facets(seed + 4, 40, 0.035, 0.03)
    MEAN[f"rock_{team}_b"] = save(f"rock_{team}_b", grey(v))
# 我方青铜：亮一点的铜绿斑（发白的青），零星几点铁锈（橙褐）。颜色在材质里，这里是相对的明暗和少量色相
v = 0.62 + band(41, 2, 6) * 0.05 + band(42, 10, 24) * 0.02
patina = soft(band(43, 2, 6), 0.2, 1.8) * 0.08
rust = soft(band(44, 8, 20), 2.4, 3.0)
rgb = grey(v + patina)
rgb = rgb * (1 - rust[..., None] * 0.55) + np.stack([0.62, 0.34, 0.18])[None, None, :] * rust[..., None] * 0.55
MEAN["bronze_me_b"] = save("bronze_me_b", rgb)
# 对方暗铁：平平的深色，零星几块暗红的锈
v = 0.5 + band(51, 2, 6) * 0.04 + band(52, 12, 30) * 0.015
rust = soft(band(53, 5, 14), 2.3, 3.0)
rgb = grey(v)
rgb = rgb * (1 - rust[..., None] * 0.5) + np.stack([0.5, 0.26, 0.2])[None, None, :] * rust[..., None] * 0.5
MEAN["iron_foe_b"] = save("iron_foe_b", rgb)
# 树皮：竖着的长条纹（三向投影的侧面 v 轴就是竖直方向），很淡
v = 0.55 + band(61, 6, 18, ax=0.18, ay=1.0) * 0.06 + band(62, 20, 50, ax=0.25, ay=1.0) * 0.025
MEAN["bark_b"] = save("bark_b", grey(v))
print(json.dumps(MEAN, ensure_ascii=False))
