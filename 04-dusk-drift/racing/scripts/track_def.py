# 赛道几何定义（纯数学，无 bpy 依赖）：中心线、宽度、采样函数
# 坐标：Z 向上，单位米。车辆大体沿 +X 方向驶来，然后右转（顺时针）驶向 -Y。
import math

TRACK_W = 11.0          # 路面宽度
HALF_W = TRACK_W / 2.0

# 中心线分段： (类型, 参数)
#  'S', 长度            直线
#  'A', 半径, 角度(度)   圆弧，负角度 = 右转
# 起点在 (-230, 0)，朝向 +X
SEGMENTS = [
    ('S', 150.0),          # 进弯前长直道
    ('A', 260.0, -9.0),    # 很缓的右弯折，避免死直
    ('S', 40.0),
    ('A', 48.0, -95.0),    # 主弯：漂移发生处（半径 48m，转 95 度）
    ('S', 70.0),
    ('A', 120.0, 28.0),    # 出弯后缓左
    ('S', 160.0),
]
MAIN_R = 48.0
START = (-230.0, 0.0)
START_HEADING = 0.0  # 弧度，+X


def build_centerline(step=1.0):
    """返回 [(x, y, heading, s, curvature)]，等弧长采样。"""
    pts = []
    x, y = START
    hd = START_HEADING
    s = 0.0
    for seg in SEGMENTS:
        if seg[0] == 'S':
            L = seg[1]
            n = max(1, int(round(L / step)))
            ds = L / n
            for i in range(n):
                pts.append((x, y, hd, s, 0.0))
                x += math.cos(hd) * ds
                y += math.sin(hd) * ds
                s += ds
        else:
            R, ang = seg[1], math.radians(seg[2])
            L = abs(R * ang)
            n = max(1, int(round(L / step)))
            ds = L / n
            k = (1.0 / R) * (1 if ang > 0 else -1)
            for i in range(n):
                pts.append((x, y, hd, s, k))
                # 精确圆弧步进
                dth = k * ds
                if abs(dth) < 1e-9:
                    x += math.cos(hd) * ds
                    y += math.sin(hd) * ds
                else:
                    x += (math.sin(hd + dth) - math.sin(hd)) / k
                    y += (-math.cos(hd + dth) + math.cos(hd)) / k
                hd += dth
                s += ds
    pts.append((x, y, hd, s, 0.0))
    return pts


_CL = None


def centerline():
    global _CL
    if _CL is None:
        _CL = build_centerline(0.5)
    return _CL


def total_length():
    return centerline()[-1][3]


_SEGTAB = None


def _segtab():
    """各分段的解析起点：[(s0, s1, x0, y0, hd0, k)]"""
    global _SEGTAB
    if _SEGTAB is None:
        tab = []
        x, y = START
        hd = START_HEADING
        s = 0.0
        for seg in SEGMENTS:
            if seg[0] == 'S':
                L, k = seg[1], 0.0
            else:
                ang = math.radians(seg[2])
                L = abs(seg[1] * ang)
                k = (1.0 / seg[1]) * (1 if ang > 0 else -1)
            tab.append((s, s + L, x, y, hd, k))
            if k == 0.0:
                x += math.cos(hd) * L
                y += math.sin(hd) * L
            else:
                x += (math.sin(hd + k * L) - math.sin(hd)) / k
                y += (-math.cos(hd + k * L) + math.cos(hd)) / k
                hd += k * L
            s += L
        tab.append((s, s + 1e9, x, y, hd, 0.0))      # 末端直线外推
        _SEGTAB = tab
    return _SEGTAB


def sample(s):
    """按弧长 s 解析求中心线上的 (x, y, heading, curvature)。"""
    tab = _segtab()
    if s < 0:
        _, _, x, y, hd, _k = tab[0]
        return (x + math.cos(hd) * s, y + math.sin(hd) * s, hd, 0.0)
    for (s0, s1, x, y, hd, k) in tab:
        if s <= s1:
            u = s - s0
            if k == 0.0:
                return (x + math.cos(hd) * u, y + math.sin(hd) * u, hd, 0.0)
            return (x + (math.sin(hd + k * u) - math.sin(hd)) / k,
                    y + (-math.cos(hd + k * u) + math.cos(hd)) / k,
                    hd + k * u, k)
    raise ValueError(s)


def offset_point(s, d):
    """中心线 s 处、向左偏移 d 米（负值向右）的点。返回 (x, y, heading)。"""
    x, y, hd, k = sample(s)
    nx, ny = -math.sin(hd), math.cos(hd)   # 左法线
    return (x + nx * d, y + ny * d, hd)


def seg_ranges():
    """各分段的 (类型, s_start, s_end)。"""
    out = []
    s = 0.0
    for seg in SEGMENTS:
        if seg[0] == 'S':
            L = seg[1]
        else:
            L = abs(seg[1] * math.radians(seg[2]))
        out.append((seg, s, s + L))
        s += L
    return out


if __name__ == "__main__":
    for seg, a, b in seg_ranges():
        pa = sample(a)
        pb = sample(b)
        print(seg, "s %.1f-%.1f" % (a, b), "from (%.1f, %.1f) hd %.1f" % (pa[0], pa[1], math.degrees(pa[2])),
              "to (%.1f, %.1f) hd %.1f" % (pb[0], pb[1], math.degrees(pb[2])))
    print("total", total_length())
