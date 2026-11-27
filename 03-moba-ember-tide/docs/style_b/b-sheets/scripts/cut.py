"""把纯灰底的设定图抠出来：从图的四边往里漫水，和底色接近的连通区域算背景。返回 RGBA（原图大小）。"""
import numpy as np
from PIL import Image, ImageFilter

def cutout(path, T=26, work=700):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    s = work / max(W, H)
    sm = im.resize((max(1, int(W * s)), max(1, int(H * s))), Image.LANCZOS)
    a = np.asarray(sm).astype(np.float32)
    h, w, _ = a.shape
    # 底色随位置有一点渐变：用四条边各自的中位色按位置插值成一张底色图
    top = np.median(a[:6], axis=0); bot = np.median(a[-6:], axis=0)     # (w,3)
    yy = np.linspace(0, 1, h)[:, None, None]
    bg = top[None] * (1 - yy) + bot[None] * yy
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    # 灰底的饱和度低：彩色像素直接算前景
    mx = a.max(-1); mn = a.min(-1); sat = (mx - mn)
    cand = (d < T) & (sat < 28)
    seed = np.zeros_like(cand); seed[0, :] = cand[0, :]; seed[-1, :] = cand[-1, :]; seed[:, 0] = cand[:, 0]; seed[:, -1] = cand[:, -1]
    m = seed.copy()
    for _ in range(4000):
        g = m.copy()
        g[1:] |= m[:-1]; g[:-1] |= m[1:]; g[:, 1:] |= m[:, :-1]; g[:, :-1] |= m[:, 1:]
        g &= cand
        if (g == m).all(): break
        m = g
    fg = ~m
    mask = Image.fromarray((fg * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.2))
    mask = mask.point(lambda v: 0 if v < 90 else (255 if v > 165 else int((v - 90) * 255 / 75)))
    out = im.copy(); out.putalpha(mask)
    bb = mask.getbbox()
    return out.crop(bb) if bb else out

def lum_stats(rgba):
    a = np.asarray(rgba).astype(np.float32) / 255
    m = a[..., 3] > 0.9
    rgb = a[..., :3][m]
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    L = lin @ np.array([0.2126, 0.7152, 0.0722])
    Ls = np.where(L <= 0.0031308, L * 12.92, 1.055 * L ** (1 / 2.4) - 0.055)       # 换回感知亮度（0 黑 1 白），和 b-concept 的量法一样用 sRGB 编码后的相对亮度
    mx = rgb.max(-1); mn = rgb.min(-1); l = (mx + mn) / 2
    sat = np.where(mx == mn, 0, (mx - mn) / (1 - np.abs(2 * l - 1) + 1e-6))
    p = lambda v, q: float(np.percentile(v, q))
    return dict(p10=p(Ls, 10), p50=p(Ls, 50), p90=p(Ls, 90), span=p(Ls, 90) - p(Ls, 10), sat90=p(sat, 90), sat50=p(sat, 50))
