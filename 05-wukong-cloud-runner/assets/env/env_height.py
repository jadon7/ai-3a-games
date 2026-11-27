"""env_height.py —— 二次元山水世界的地形函数（纯 numpy，不依赖 bpy）。

env.blend 里的地形网格就是用这里的 ground_height 采样生成的（内圈 3.5 m 网格，线性插值误差 < 0.3 m，
悬崖面上误差更大，不要贴着崖面飞）。

用法：
    import sys; sys.path.insert(0, ROOT + '/assets/env'); import env_height as EH
    yc = EH.river_center(x)                 # 江心线 y
    w  = EH.river_halfwidth(x)              # 水面半宽（江 45 m，湖心 x=800 处 260 m）
    z  = EH.ground_height(x, y)             # 地表高度；水域返回负值（河床），水面在 z=0
    xb, yb = EH.band_center(x)              # 花坡贴地走廊中线（左岸离江心 190 m）

注意：峰柱（峰林、湖中孤峰）、树、楼阁不在 ground_height 里，它们是独立物体；
      留空走廊见 build_env.py 顶部 CORRIDOR 常量。
"""
import numpy as np

_R = np.random.default_rng(20261121)
_T2 = _R.random((64, 64))

BAND_D = 190.0          # 花坡贴地走廊中线：离江心线 190 m（左岸，y > yc）
FALL_X = 150.0          # 瀑布位置
PAGODA_X = -300.0       # 楼阁位置


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def vnoise2(x, y):
    x, y = np.broadcast_arrays(np.asarray(x, float), np.asarray(y, float))
    xf, yf = np.floor(x), np.floor(y)
    fx, fy = x - xf, y - yf
    x0, y0 = xf.astype(np.int64) % 64, yf.astype(np.int64) % 64
    x1, y1 = (x0 + 1) % 64, (y0 + 1) % 64
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    return (_T2[x0, y0] * (1 - ux) + _T2[x1, y0] * ux) * (1 - uy) + (_T2[x0, y1] * (1 - ux) + _T2[x1, y1] * ux) * uy


def fbm2(x, y, octaves=3):
    s, a, tot, f = 0.0, 1.0, 0.0, 1.0
    for o in range(octaves):
        s = s + a * vnoise2(x * f + 13.7 * o, y * f + 7.3 * o)
        tot += a
        a *= 0.5
        f *= 2.0
    return s / tot


def river_center(x):
    return 110.0 * np.sin((np.asarray(x, float) + 200.0) / 430.0)


def river_halfwidth(x):
    x = np.asarray(x, float)
    lake = sstep(500.0, 720.0, x) * (1.0 - sstep(880.0, 1100.0, x))
    return 45.0 + 215.0 * lake


def band_center(x):
    """花坡贴地走廊中线上的点 (x, y)。"""
    x = np.asarray(x, float)
    return x, river_center(x) + BAND_D


def cliff_height(x):
    """右岸悬崖顶高度（90~220 m），瀑布处有个缺口。"""
    x = np.asarray(x, float)
    H = np.clip(155.0 + 75.0 * (2.0 * vnoise2(x / 330.0 + 5.2, 0.37) - 1.0), 92.0, 218.0)
    return H - 5.0 * np.exp(-((x - FALL_X) / 10.0) ** 2)


def cliff_params(x):
    """悬崖脚的退让 s（滩地宽）和崖面水平进深 wc。"""
    x = np.asarray(x, float)
    s = 4.0 + 10.0 * vnoise2(x / 48.0, 3.1)
    wc = 24.0 + 9.0 * vnoise2(x / 120.0, 9.4)
    return s, wc


def _softclip(u):
    return np.where(u < 0.8, u, 0.8 + 0.2 * np.tanh((u - 0.8) / 0.2))


def ground_height(x, y):
    x, y = np.broadcast_arrays(np.asarray(x, float), np.asarray(y, float))
    yc = river_center(x)
    w = river_halfwidth(x)
    d = y - yc
    ad = np.abs(d)
    bed = -0.6 - 3.5 * np.clip(1.0 - (ad / w) ** 2, 0.0, 1.0)

    # ---- 左岸：桃花坡（坡度 0.14~0.24，离江 500 m 处约 110 m），再往外是峰林的丘陵底
    tL = np.maximum(d - w, 0.0)
    slope = 0.215 + 0.035 * (2.0 * vnoise2(x / 420.0 + 1.7, 0.9) - 1.0)
    zL = -0.6 + 1.9 * sstep(0.0, 7.0, tL) + slope * 470.0 * _softclip(tL / 470.0)
    zL = zL + 6.5 * (2.0 * fbm2(x / 250.0 + 3.1, y / 250.0 + 8.4, 2) - 1.0) * sstep(20.0, 140.0, tL)
    zL = zL + 18.0 * (2.0 * fbm2(x / 400.0 + 9.1, y / 400.0 + 2.2, 3) - 1.0) * sstep(480.0, 700.0, tL)
    sz = sstep(-900.0, -1150.0, x)          # 起点峰林区：地面更高更崎岖
    zL = zL + sz * 45.0 * sstep(40.0, 260.0, tL) * (0.4 + 0.6 * fbm2(x / 180.0 + 4.0, y / 180.0 + 1.0, 3))

    # ---- 右岸：贴江的层理悬崖 + 崖顶草甸
    tR = np.maximum(-d - w, 0.0)
    H = cliff_height(x)
    s, wc = cliff_params(x)
    u = np.clip((tR - s) / wc, 0.0, 1.0)
    back = np.maximum(tR - s - wc, 0.0)
    calm = 1.0 - np.exp(-((x - FALL_X) / 32.0) ** 2)          # 瀑布上游的溪沟附近不起伏
    top = H + 10.0 * (2.0 * fbm2(x / 220.0 + 6.6, y / 220.0 + 1.9, 2) - 1.0) * sstep(0.0, 90.0, back) * calm
    top = top + 0.02 * np.minimum(back, 600.0)
    top = top + 5.0 * np.exp(-((x - FALL_X) / 10.0) ** 2) * sstep(200.0, 330.0, back)   # 溪沟向后逐渐消失
    zR = np.where(tR < s, -0.6 + 1.2 * sstep(0.0, np.maximum(s, 1e-3), tR),
                  np.where(u < 1.0, 0.6 + (H - 0.6) * u ** 0.8, top))

    return np.where(ad < w, bed, np.where(d > 0, zL, zR))


if __name__ == '__main__':
    xs = np.array([-1500, -850, -400, 0, 150, 800, 1200.0])
    print('yc', river_center(xs))
    print('w ', river_halfwidth(xs))
    print('band z', ground_height(*band_center(xs)))
    print('cliff H', cliff_height(xs))
    print('left 500m', ground_height(xs, river_center(xs) + 500))
