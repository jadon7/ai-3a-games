"""赛道中心线：由直线和圆弧拼成，沿里程 s 取位置/朝向/高度。
约定：s 沿行驶方向增加；横向偏移 d 左正右负；朝向 h 为与 +X 的夹角（弧度）。"""
import math
import numpy as np


class Track:
    def __init__(self, segs, origin=(0.0, 0.0), heading=0.0, ds=0.5, zfunc=None):
        x, y = origin
        h = heading
        xs, ys, hs, ks = [], [], [], []
        for seg in segs:
            if seg[0] == "line":
                n = max(1, int(round(seg[1] / ds)))
                step = seg[1] / n
                for _ in range(n):
                    xs.append(x); ys.append(y); hs.append(h); ks.append(0.0)
                    x += step * math.cos(h); y += step * math.sin(h)
            else:
                R, ang = seg[1], math.radians(seg[2])
                length = R * abs(ang)
                n = max(1, int(round(length / ds)))
                dh = ang / n
                chord = 2 * R * math.sin(abs(dh) / 2)
                for _ in range(n):
                    xs.append(x); ys.append(y); hs.append(h); ks.append(math.copysign(1.0 / R, ang))
                    x += chord * math.cos(h + dh / 2); y += chord * math.sin(h + dh / 2)
                    h += dh
        xs.append(x); ys.append(y); hs.append(h); ks.append(0.0)
        self.x = np.array(xs); self.y = np.array(ys); self.h = np.array(hs); self.k = np.array(ks)
        d = np.hypot(np.diff(self.x), np.diff(self.y))
        self.s = np.concatenate([[0.0], np.cumsum(d)])
        self.length = float(self.s[-1])
        self.zfunc = zfunc or (lambda s: 0.0)

    def _i(self, s, arr):
        return float(np.interp(s, self.s, arr))

    def pose(self, s):
        """返回 (x, y, z, heading, curvature)。超出两端时沿端点方向直线外推。"""
        if s < 0 or s > self.length:
            e = 0 if s < 0 else -1
            ds = s if s < 0 else s - self.length
            h = float(self.h[e])
            return (float(self.x[e]) + ds * math.cos(h), float(self.y[e]) + ds * math.sin(h), self.zfunc(s), h, 0.0)
        return (self._i(s, self.x), self._i(s, self.y), self.zfunc(s), self._i(s, self.h), self._i(s, self.k))

    def xyz(self, s, d=0.0, dz=0.0):
        x, y, z, h, _ = self.pose(s)
        return (x - d * math.sin(h), y + d * math.cos(h), z + dz)

    def heading(self, s):
        return self.pose(s)[3]

    def slope(self, s, eps=1.0):
        return (self.zfunc(s + eps) - self.zfunc(s - eps)) / (2 * eps)


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------------- 这条赛道 ----------------
SEGS = [("line", 560), ("arc", 32, -90), ("line", 330), ("arc", 130, 90), ("line", 420), ("line", 600)]
S_A1 = 560.0                              # 大道结束，进右弯
S_C1 = S_A1 + 32 * math.pi / 2            # 弯出口，霓虹街开始
S_B1 = S_C1 + 330.0                       # 霓虹街结束，进大左弯
S_V1 = S_B1 + 130 * math.pi / 2           # 大左弯结束，下穿隧道段开始
S_T1 = S_V1 + 420.0                       # 隧道段结束，上桥
S_END = S_T1 + 600.0
START_S = 60.0
FINISH_S = S_T1 + 430.0

TUN_DEPTH = 6.8
RAMP_IN = (S_V1 + 15.0, S_V1 + 105.0)     # 下坡
RAMP_OUT = (S_V1 + 315.0, S_V1 + 405.0)   # 上坡
TUN_COVER = (S_V1 + 92.0, S_V1 + 328.0)   # 有顶的部分


def zprofile(s):
    return -TUN_DEPTH * (smooth(RAMP_IN[0], RAMP_IN[1], s) - smooth(RAMP_OUT[0], RAMP_OUT[1], s))


def main_track():
    return Track(SEGS, zfunc=zprofile)


def half_width(s):
    """路缘到中线的距离。大道 9.6，霓虹街 7.0，弯道/隧道 7.6，大桥 11.2。"""
    if s < S_A1:
        return 9.6
    if s < S_C1:
        return 9.6 + (7.0 - 9.6) * smooth(S_A1, S_C1, s)
    if s < S_B1:
        return 7.0
    if s < S_B1 + 40:
        return 7.0 + 0.6 * smooth(S_B1, S_B1 + 40, s)
    if s < S_T1 - 30:
        return 7.6
    if s < S_T1 + 30:
        return 7.6 + (11.2 - 7.6) * smooth(S_T1 - 30, S_T1 + 30, s)
    return 11.2


if __name__ == "__main__":
    t = main_track()
    for name, s in [("A1", S_A1), ("C1", S_C1), ("B1", S_B1), ("V1", S_V1), ("T1", S_T1), ("END", S_END), ("FINISH", FINISH_S)]:
        print(name, round(s, 1), [round(v, 2) for v in t.pose(s)])
