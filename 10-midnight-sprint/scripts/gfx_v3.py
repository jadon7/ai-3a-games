#!/usr/bin/env python3
"""手绘涂鸦风特效层（原创图形）。所有元素锚定在三维世界里（车轮、排气口、路面），逐帧投影到画面。
Gfx().render(frame) → 预乘 alpha 的 RGBA uint8 (H, W, 4)。
风格：粗墨线描边、平涂、网点、套印错位、一拍三的抖动。"""
import json, math, os, sys
import numpy as np
import skia

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from track import main_track

INK = (18, 14, 32); WHITE = (252, 250, 242); YEL = (255, 222, 0); PINK = (255, 40, 135); CYAN = (0, 229, 255)
RED = (255, 70, 50); LILAC = (255, 176, 222); MINT = (150, 255, 210); PURPLE = (170, 90, 255); LIME = (190, 255, 60); ORANGE = (255, 150, 30)
PAL_HERO = dict(hi=WHITE, lo=LILAC, dot=PINK, ink=INK)
PAL_RIV = [dict(hi=(215, 255, 200), lo=(120, 235, 140), dot=(30, 150, 70), ink=INK),      # 绿车
           dict(hi=(240, 220, 255), lo=PURPLE, dot=(90, 30, 190), ink=INK),                # 紫车
           dict(hi=(255, 250, 200), lo=(255, 205, 60), dot=ORANGE, ink=INK)]               # 黄车
T = main_track()


def C(col, a=255):
    return skia.Color(int(col[0]), int(col[1]), int(col[2]), int(max(0, min(255, a))))


def rng_for(*keys):
    h = 1469598103934665603
    for k in keys:
        h = (h ^ (int(k) & 0xFFFFFFFF)) * 1099511628211 % (1 << 64)
    return np.random.default_rng(h % (1 << 32))


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def overshoot(t):
    t = max(0.0, min(1.0, t))
    return 1 + 1.7 * (t - 1) ** 3 + 0.7 * (t - 1) ** 2 if t < 1 else 1.0


class Gfx:
    def __init__(self, path=None, W=1920, H=1080):
        d = json.load(open(path or os.path.join(ROOT, "out", "telemetry.json")))
        self.meta, self.fr = d["meta"], d["frames"]
        self.W, self.H = W, H
        self.NF = len(self.fr)
        self.car = self.meta["car"]
        m = self.meta
        self.F_GO, self.F_FIN, self.F_OUT = m["F_GO"], m["F_FIN"], m["F_OUT"]
        self.tf_cn = skia.Typeface.MakeFromFile(os.path.join(ROOT, "assets", "fonts", "ZCOOLKuaiLe-Regular.ttf"))
        self.tf_num = skia.Typeface.MakeFromFile(os.path.join(ROOT, "assets", "fonts", "BarlowCondensed-ExtraBoldItalic.ttf"))
        self.pos = np.array([f["pos"] for f in self.fr]); self.yaw = np.array([f["yaw"] for f in self.fr])
        self.v = np.array([f["v"] for f in self.fr]); self.drift = np.array([f["drift"] for f in self.fr])
        self.nit = np.array([f["nitro_env"] for f in self.fr]); self.s = np.array([f["s"] for f in self.fr])
        self.dlat = np.array([f["d"] for f in self.fr]); self.t = np.array([f["t"] for f in self.fr])
        self.gear = np.array([f["gear"] for f in self.fr])
        self._build_particles()

    # ---------- 几何 ----------
    def car_pt(self, i, lx, ly, lz):
        i = max(0, min(self.NF - 1, i))
        c, s = math.cos(self.yaw[i]), math.sin(self.yaw[i])
        p = self.pos[i]
        return np.array([p[0] + lx * c - ly * s, p[1] + lx * s + ly * c, p[2] + lz])

    def car_pt_f(self, fi, lx, ly, lz):
        """帧号可以是小数：在相邻两帧之间插值。"""
        fi = max(0.0, min(self.NF - 1.001, fi))
        i0 = int(fi); u = fi - i0
        p = self.pos[i0] * (1 - u) + self.pos[i0 + 1] * u
        yw = self.yaw[i0] * (1 - u) + self.yaw[i0 + 1] * u
        c, s_ = math.cos(yw), math.sin(yw)
        return np.array([p[0] + lx * c - ly * s_, p[1] + lx * s_ + ly * c, p[2] + lz])

    def cam(self, f):
        t = self.fr[f - 1]
        return np.array(t["cam_p"]), np.array(t["cam_r"]).reshape(3, 3), t["lens"] / 36.0 * self.W

    def to_cam(self, P, cam):
        Cp, R, _ = cam
        return (np.asarray(P) - Cp) @ R          # 相机空间：-Z 朝前

    def proj(self, P, cam, near=0.35):
        pc = self.to_cam(P, cam)
        if pc[2] > -near:
            return None
        fpx = cam[2]
        return (self.W / 2 + fpx * pc[0] / -pc[2], self.H / 2 - fpx * pc[1] / -pc[2], -pc[2])

    def proj_seg(self, A, B, cam, near=0.6):
        """投影线段，对近裁剪面做裁剪。返回 ((x,y,depth),(x,y,depth)) 或 None。"""
        a, b = self.to_cam(A, cam), self.to_cam(B, cam)
        if a[2] > -near and b[2] > -near:
            return None
        if a[2] > -near:
            u = (-near - b[2]) / (a[2] - b[2]); a = b + (a - b) * u
        if b[2] > -near:
            u = (-near - a[2]) / (b[2] - a[2]); b = a + (b - a) * u
        fpx = cam[2]
        f2 = lambda p: (self.W / 2 + fpx * p[0] / -p[2], self.H / 2 - fpx * p[1] / -p[2], -p[2])
        return f2(a), f2(b)

    def car_box(self, i, cam):
        c = self.car
        pts = []
        for lx in (c["rear_x"], c["front_x"]):
            for ly in (-c["width"] / 2, c["width"] / 2):
                for lz in (0.0, c["height"]):
                    p = self.proj(self.car_pt(i, lx, ly, lz), cam)
                    if p:
                        pts.append(p)
        if len(pts) < 4:
            return None
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        return min(xs), min(ys), max(xs), max(ys)

    # ---------- 预先生成所有粒子（确定性） ----------
    def _build_particles(self):
        car = self.car
        wb, trk = car["wheelbase"], car["track"]
        self.puffs = []
        r = np.random.default_rng(11)

        def spawn(i, p0, vel_car, amt, pal, big=1.0, side=0.0):
            yw = self.yaw[i]
            lat = np.array([-math.sin(yw), math.cos(yw), 0.0]) * side * r.uniform(2.2, 4.4)     # 往车的外侧推
            self.puffs.append(dict(f0=i + 1, life=int(r.uniform(18, 27)), p0=p0, pal=pal, seed=int(r.integers(1 << 30)),
                                   vel=np.array([vel_car[0] * 0.62 + r.uniform(-0.8, 0.8), vel_car[1] * 0.62 + r.uniform(-0.8, 0.8), r.uniform(0.6, 1.5)]) + lat,
                                   s0=r.uniform(0.22, 0.36) * big, s1=r.uniform(0.75, 1.25) * big * (0.7 + 0.5 * amt)))

        for i in range(self.NF):
            f = i + 1
            if f < self.F_GO - 100 or f > self.F_FIN + 5:
                continue
            t = self.t[i]
            amt = min(1.0, abs(self.drift[i]) / 0.42) if abs(self.drift[i]) > 0.17 else 0.0
            if 0 < t < 1.5:
                amt = max(amt, 1.0 - t / 1.5)
            rev = (self.fr[i]["rpm"] > 4200 and t <= 0)        # 片头轰油门时排气口冒小烟
            vel = (self.pos[min(i + 1, self.NF - 1)] - self.pos[i]) * self.meta["fps"]
            if amt > 0.2 and i % 2 == 0:
                for sgn in (1, -1):
                    spawn(i, self.car_pt(i, -wb / 2 - 0.25, sgn * trk / 2, 0.3), vel, amt, PAL_HERO, side=sgn)
            elif rev and i % 5 == 0:
                spawn(i, self.car_pt(i, car["rear_x"] - 0.1, r.choice([-0.12, 0.12]), 0.6), vel, 0.3, PAL_HERO, big=0.45)
            # 换挡回火的小烟
            if i > 0 and self.gear[i] > self.gear[i - 1] and t > 0:
                spawn(i, self.car_pt(i, car["rear_x"] - 0.1, 0.0, 0.62), vel * 1.2, 0.2, PAL_HERO, big=0.5)
            # 对手过弯的烟
            for k, (rv, rd) in enumerate(zip(self.fr[i]["riv3"], self.fr[i]["riv_drift"])):
                if abs(rd) > 0.2 and i % 6 == 0 and rv[4] > 5:
                    c_, s_ = math.cos(rv[3]), math.sin(rv[3])
                    for sgn in (1, -1):
                        lx, ly = -1.5, sgn * 0.8
                        p0 = np.array([rv[0] + lx * c_ - ly * s_, rv[1] + lx * s_ + ly * c_, rv[2] + 0.3])
                        spawn(i, p0, np.array([c_, s_, 0]) * rv[4], 0.6, PAL_RIV[k % 3], big=0.55, side=sgn)
        # 路面排线
        self.lines = []
        r = np.random.default_rng(23)
        for i in range(self.NF):
            f = i + 1
            if f < self.F_GO or f > self.F_FIN + 20 or self.v[i] < 28:
                continue
            vn = min(1.0, self.v[i] / 94.0); nit = self.nit[i]
            n = int(1 + 3.5 * vn + 5 * nit + r.random())
            for _ in range(n):
                s0 = self.s[i] + r.uniform(10, 70)
                d = self.dlat[i] + r.uniform(-9, 9)
                if abs(d - self.dlat[i]) < 1.3:
                    d += 1.6 * (1 if r.random() < 0.5 else -1)
                L = r.uniform(5, 13) * (0.6 + vn)
                if nit > 0.3:
                    col = [YEL, CYAN, WHITE, PINK][int(r.integers(4))]
                else:
                    col = [PINK, WHITE, RED, PINK][int(r.integers(4))]
                self.lines.append(dict(f0=f, life=int(r.uniform(7, 12)), a=np.array(T.xyz(s0, d, 0.03)), b=np.array(T.xyz(s0 + L, d, 0.03)), col=col, w=r.uniform(0.07, 0.16)))
        self.lines_by_f = {}
        for ln in self.lines:
            for f in range(ln["f0"], ln["f0"] + ln["life"]):
                self.lines_by_f.setdefault(f, []).append(ln)
        self.puffs_by_f = {}
        for p in self.puffs:
            for f in range(p["f0"], p["f0"] + p["life"]):
                self.puffs_by_f.setdefault(f, []).append(p)
        # 涂鸦字和小图形事件
        ev = self.meta["events"]
        self.tags = []
        nit_n = 0
        for e in ev:
            if e["type"] == "nitro":
                self.tags.append(dict(f0=e["f"], dur=30, text=("冲!", "飙!")[nit_n % 2], size=250, side=(-1, 1)[nit_n % 2], fill=YEL, drop=PINK))
                nit_n += 1
            elif e["type"] == "overtake":
                self.tags.append(dict(f0=e["f"], dur=24, text="超!", size=170, side=1, fill=CYAN, drop=INK))
            elif e["type"] == "drift":
                pass
        # 漂移开始的那一帧
        for i in range(1, self.NF):
            if abs(self.drift[i]) > 0.3 and abs(self.drift[i - 1]) <= 0.3 and self.v[i] > 8:
                self.tags.append(dict(f0=i + 1, dur=28, text="漂!", size=220, side=-1, fill=YEL, drop=PINK))
        self.tags.append(dict(f0=self.F_GO, dur=24, text="走!", size=190, side=1, fill=YEL, drop=PINK))
        self.nitro_starts = [e["f"] for e in ev if e["type"] == "nitro"]
        self.nears = [e for e in ev if e["type"] == "near"]
        self.overtakes = [e for e in ev if e["type"] == "overtake"]
        self.shifts = [i + 1 for i in range(1, self.NF) if self.gear[i] > self.gear[i - 1] and self.t[i] > 0]

    # ---------- 画笔 ----------
    @staticmethod
    def fill(col, a=255):
        return skia.Paint(AntiAlias=True, Style=skia.Paint.kFill_Style, Color=C(col, a))

    @staticmethod
    def stroke(col, w, a=255, wobble=None):
        p = skia.Paint(AntiAlias=True, Style=skia.Paint.kStroke_Style, Color=C(col, a), StrokeWidth=float(w),
                       StrokeCap=skia.Paint.kRound_Cap, StrokeJoin=skia.Paint.kRound_Join)
        if wobble:
            p.setPathEffect(skia.DiscretePathEffect.Make(wobble[0], wobble[1], int(wobble[2])))
        return p

    def halftone(self, cv, path, col, step, radius, ox=0.0, oy=0.0, a=255, fade=None):
        """在 path 内铺网点。fade=(x0,y0,x1,y1) 时点的大小沿这个方向从 0 渐变到满。"""
        b = path.getBounds()
        cv.save()
        cv.clipPath(path, skia.ClipOp.kIntersect, True)
        pt = self.fill(col, a)
        y = b.top() - step
        row = 0
        while y < b.bottom() + step:
            x = b.left() - step + (step / 2 if row % 2 else 0)
            while x < b.right() + step:
                rr = radius
                if fade:
                    fx0, fy0, fx1, fy1 = fade
                    den = (fx1 - fx0) ** 2 + (fy1 - fy0) ** 2 + 1e-6
                    u = ((x - fx0) * (fx1 - fx0) + (y - fy0) * (fy1 - fy0)) / den
                    rr = radius * max(0.0, min(1.0, u))
                if rr > 0.4:
                    cv.drawCircle(x + ox, y + oy, rr, pt)
                x += step
            y += step * 0.866
            row += 1
        cv.restore()

    def spray(self, cv, cx, cy, radius, n, col, r, a=230):
        pt = self.fill(col, a)
        for _ in range(n):
            ang = r.uniform(0, 2 * math.pi); rad = radius * (0.75 + 0.6 * r.random() ** 0.5)
            cv.drawCircle(cx + rad * math.cos(ang), cy + rad * math.sin(ang), r.uniform(1.0, 3.6), pt)

    def splat_path(self, cx, cy, R, r):
        n = 18
        rad = [R * (0.62 + 0.5 * r.random() ** 1.5) for _ in range(n)]
        pts = [(cx + rad[k] * math.cos(k / n * 2 * math.pi), cy + rad[k] * 0.78 * math.sin(k / n * 2 * math.pi)) for k in range(n)]
        path = skia.Path()
        mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        path.moveTo(*mid(pts[-1], pts[0]))
        for k in range(n):
            path.quadTo(pts[k][0], pts[k][1], *mid(pts[k], pts[(k + 1) % n]))
        path.close()
        for _ in range(9):                                  # 甩出去的小墨点
            ang = r.uniform(0, 2 * math.pi); d = R * r.uniform(1.0, 1.5)
            path.addCircle(cx + d * math.cos(ang), cy + d * 0.78 * math.sin(ang), R * r.uniform(0.03, 0.09))
        return path

    def star_path(self, cx, cy, r_out, r_in, n, rot=0.0, jitter=0.0, r=None):
        p = skia.Path()
        for k in range(2 * n):
            rad = r_out if k % 2 == 0 else r_in
            if r is not None and jitter:
                rad *= 1 + r.uniform(-jitter, jitter)
            ang = rot + k * math.pi / n
            x, y = cx + rad * math.cos(ang), cy + rad * math.sin(ang)
            p.moveTo(x, y) if k == 0 else p.lineTo(x, y)
        p.close()
        return p

    def outlined(self, cv, path, fill, ink_w, ink=INK, drop=None, drop_off=(7, 7), boil=0):
        wob = (9.0, ink_w * 0.22, boil) if boil else None
        if drop is not None:
            cv.save(); cv.translate(*drop_off)
            cv.drawPath(path, self.stroke(ink, ink_w, wobble=wob)); cv.drawPath(path, self.fill(drop))
            cv.restore()
        cv.drawPath(path, self.stroke(ink, ink_w, wobble=wob))
        cv.drawPath(path, self.fill(fill))

    # ---------- 各种元素 ----------
    def draw_puff(self, cv, p, f, cam):
        age = (f - p["f0"]) / p["life"]
        tsec = (f - p["f0"]) / self.meta["fps"]
        P = p["p0"] + p["vel"] * tsec * np.array([1.0 - 0.45 * age, 1.0 - 0.45 * age, 1.0])
        pr = self.proj(P, cam, near=1.6)
        if pr is None or pr[2] > 160:
            return
        x, y, depth = pr
        size = p["s0"] + (p["s1"] - p["s0"]) * ease_out(age * 1.3)
        R = min(size * cam[2] / depth, 125.0)
        if depth < 5.5:
            R *= max(0.0, (depth - 2.6) / 2.9)
        pop = max(0.0, (age - 0.72) / 0.28)          # 结尾：散成几个小泡
        R *= 1 - 0.45 * pop
        if R < 3 or R > 900 or x < -R * 2 or x > self.W + R * 2 or y < -R * 2 or y > self.H + R * 2:
            return
        pal = p["pal"]
        rb = rng_for(p["seed"], f // 3)             # 一拍三的抖动
        rs = rng_for(p["seed"])                     # 固定的团块布局
        n = 6
        cs = []
        for k in range(n):
            ang = k / n * 2 * math.pi + rs.uniform(-0.3, 0.3)
            rad = R * (0.42 + 0.22 * rs.random()) * (1 + 0.9 * pop)
            cr = R * (0.44 + 0.2 * rs.random()) * (1 - 0.55 * pop)
            cs.append((x + rad * math.cos(ang) + rb.uniform(-1, 1) * R * 0.05, y + rad * math.sin(ang) * 0.82 + rb.uniform(-1, 1) * R * 0.05, cr))
        if pop < 0.5:
            cs.append((x, y, R * 0.62))
        ink_w = max(2.2, min(9.0, R * 0.085))
        a = 255 if pop < 0.4 else int(255 * (1 - (pop - 0.4) / 0.6) ** 0.7)
        cv.saveLayerAlpha(None, a)
        for cx, cy, cr in cs:
            cv.drawCircle(cx, cy, cr + ink_w, self.fill(pal["ink"]))
        body = skia.Path()
        for cx, cy, cr in cs:
            body.addCircle(cx, cy, cr)
        cv.drawPath(body, self.fill(pal["lo"]))
        cv.save(); cv.clipPath(body, skia.ClipOp.kIntersect, True)
        for cx, cy, cr in cs:                      # 高光：往左上偏一点的小一号圆
            cv.drawCircle(cx - cr * 0.20, cy - cr * 0.24, cr * 0.80, self.fill(pal["hi"]))
        cv.restore()
        self.halftone(cv, body, pal["dot"], max(7.0, R * 0.13), max(1.6, R * 0.034), a=235, fade=(x - R * 0.2, y - R * 0.3, x + R * 0.7, y + R * 0.9))
        cv.restore()

    def draw_lines(self, cv, f, cam):
        for ln in self.lines_by_f.get(f, ()):
            seg = self.proj_seg(ln["a"], ln["b"], cam, near=1.2)
            if seg is None:
                continue
            (x0, y0, d0), (x1, y1, d1) = seg
            if max(d0, d1) > 240:
                continue
            ph = (f - ln["f0"] + 0.5) / ln["life"]
            k = math.sin(math.pi * ph) ** 0.6
            w0 = max(1.2, min(11.0, ln["w"] * cam[2] / d0)) * k
            w1 = max(1.0, min(11.0, ln["w"] * cam[2] / d1)) * k
            dx, dy = x1 - x0, y1 - y0
            L = math.hypot(dx, dy)
            if L < 6:
                continue
            nx, ny = -dy / L, dx / L
            path = skia.Path()
            path.moveTo(x0 + nx * w0 / 2, y0 + ny * w0 / 2); path.lineTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2)
            path.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2); path.lineTo(x0 - nx * w0 / 2, y0 - ny * w0 / 2); path.close()
            cv.drawPath(path, self.fill(ln["col"], 235))

    def draw_ribbons(self, cv, f, cam):
        i = f - 1
        nit = self.nit[i]
        if nit < 0.05:
            return
        car = self.car
        K = 12
        rb = rng_for(77, f // 2)
        for sgn in (1, -1):
            pts = []
            for k in range(K + 1):
                P = self.car_pt(i - k, car["rear_x"] + 0.15, sgn * car["width"] * 0.36, 0.45)
                pc = self.to_cam(P, cam)
                pts.append((pc, k))
            # 逐段裁剪并投影
            scr = []
            for (pa, ka), (pb, kb) in zip(pts[:-1], pts[1:]):
                near = 1.3
                if pa[2] > -near:
                    break
                fpx = cam[2]
                scr.append((self.W / 2 + fpx * pa[0] / -pa[2], self.H / 2 - fpx * pa[1] / -pa[2], -pa[2], ka))
                if pb[2] > -near:
                    u = (-near - pa[2]) / (pb[2] - pa[2]); pm = pa + (pb - pa) * u
                    scr.append((self.W / 2 + fpx * pm[0] / near, self.H / 2 - fpx * pm[1] / near, near, ka + u))
                    break
            else:
                pa, ka = pts[-1]
                if pa[2] <= -1.3:
                    scr.append((self.W / 2 + cam[2] * pa[0] / -pa[2], self.H / 2 - cam[2] * pa[1] / -pa[2], -pa[2], ka))
            if len(scr) < 3:
                continue
            def edges(wmul, teeth):
                Lp, Rp = [], []
                for j, (x, y, depth, k) in enumerate(scr):
                    a_ = scr[max(0, j - 1)]; b_ = scr[min(len(scr) - 1, j + 1)]
                    dx, dy = b_[0] - a_[0], b_[1] - a_[1]
                    n_ = math.hypot(dx, dy) + 1e-6
                    nx, ny = -dy / n_, dx / n_
                    taper = max(0.0, 1 - k / K) ** 0.6
                    grow = min(1.0, k * 0.55)
                    hw = min(0.30 * wmul * taper * grow * nit * cam[2] / depth, 78 * wmul)
                    Lp.append((x + nx * hw, y + ny * hw)); Rp.append((x - nx * hw, y - ny * hw))
                    if teeth and j < len(scr) - 1 and hw > 3:          # 外侧每段中间加一个火焰尖
                        nxt = scr[j + 1]
                        mx, my = (x + nxt[0]) / 2, (y + nxt[1]) / 2
                        th = hw * (1.9 + 0.5 * rb.random())
                        back = 0.25 * (nxt[0] - x), 0.25 * (nxt[1] - y)
                        if sgn > 0:
                            Lp.append((mx + nx * th + back[0], my + ny * th + back[1])); Lp.append((mx + nx * hw * 0.8, my + ny * hw * 0.8))
                        else:
                            Rp.append((mx - nx * th + back[0], my - ny * th + back[1])); Rp.append((mx - nx * hw * 0.8, my - ny * hw * 0.8))
                path = skia.Path()
                path.moveTo(*Lp[0])
                for q in Lp[1:]:
                    path.lineTo(*q)
                for q in reversed(Rp):
                    path.lineTo(*q)
                path.close()
                return path

            outer = edges(1.0, True)
            cv.drawPath(outer, self.stroke(INK, 8, wobble=(16.0, 1.8, f // 3)))
            cv.drawPath(outer, self.fill(YEL))
            self.halftone(cv, outer, ORANGE, 13, 4.2, a=255, fade=(scr[0][0], scr[0][1], scr[-1][0], scr[-1][1]))
            cv.drawPath(edges(0.50, False), self.fill(PINK))
            cv.drawPath(edges(0.17, False), self.fill(WHITE))

    def draw_exhaust_stars(self, cv, f, cam):
        i = f - 1
        nit = self.nit[i]
        pops = [s for s in self.shifts if 0 <= f - s < 4]
        if nit < 0.05 and not pops:
            return
        ex = self.car["exhaust"]
        rb = rng_for(5, f // 2)
        for sgn in (1, -1):
            pr = self.proj(self.car_pt(i, ex[0] - 0.05, sgn * ex[1], ex[2]), cam)
            if not pr:
                continue
            x, y, depth = pr
            base = cam[2] / depth
            amp = max(nit, 0.75 if pops else 0.0)
            ro = (0.34 + 0.16 * rb.random()) * base * amp
            rot = rb.uniform(0, math.pi)
            p1 = self.star_path(x, y, ro, ro * 0.22, 4, rot)
            self.outlined(cv, p1, CYAN if nit > 0.05 else YEL, max(2.5, ro * 0.12))
            p2 = self.star_path(x, y, ro * 0.55, ro * 0.16, 4, rot + math.pi / 4)
            cv.drawPath(p2, self.fill(WHITE))

    def draw_burst(self, cv, f, cam):
        for f0 in self.nitro_starts + [self.F_FIN]:
            dt = f - f0
            if not (0 <= dt < 13):
                continue
            i = f - 1
            box = self.car_box(i, cam)
            if not box:
                continue
            cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            wcar = box[2] - box[0]
            u = dt / 12.0
            Ro = wcar * (0.50 + (0.75 if f0 == self.F_FIN else 0.95) * ease_out(u * 1.6))
            rb = rng_for(9, f0, f // 2)
            n = 15
            outer = self.star_path(cx, cy, Ro, Ro * 0.72, n, rot=0.2 * dt, jitter=0.12, r=rb)
            if dt >= 2:                                   # 中间掏空，变成向外扩的锯齿环
                Ri = Ro * (0.42 + 0.50 * (dt - 2) / 10.0)
                inner = self.star_path(cx, cy, Ri, Ri * 0.74, n, rot=0.2 * dt + 0.2, jitter=0.1, r=rb)
                shape = skia.Op(outer, inner, skia.PathOp.kDifference_PathOp)
            else:
                shape = outer
            a = int(255 * (1 - max(0.0, (u - 0.6) / 0.4)))
            cv.saveLayerAlpha(None, a)
            self.outlined(cv, shape, WHITE if dt < 2 else YEL, 9, drop=PINK, drop_off=(10, 10))
            self.halftone(cv, shape, ORANGE, 17, 5.0, fade=(cx, cy - Ro, cx, cy + Ro))
            cv.restore()
            # 放射墨线
            pt = self.stroke(WHITE, 5)
            for k in range(22):
                ang = rb.uniform(0, 2 * math.pi)
                r0 = Ro * rb.uniform(1.05, 1.25); r1 = r0 + Ro * rb.uniform(0.12, 0.4)
                cv.drawLine(cx + r0 * math.cos(ang), cy + r0 * math.sin(ang), cx + r1 * math.cos(ang), cy + r1 * math.sin(ang), pt)

    def glyph_path(self, text, size, tf=None):
        font = skia.Font(tf or self.tf_cn, size)
        path = skia.Path()
        x = 0.0
        for ch in text:
            g = font.unicharToGlyph(ord(ch))
            gp = font.getPath(g)
            if gp is not None:
                gp.offset(x, 0)
                path.addPath(gp)
            x += font.getWidths([g])[0] * 0.92
        b = path.getBounds()
        path.offset(-b.centerX(), -b.centerY())
        return path

    def stamp(self, cv, f, seed, text, size, x, y, sc, alpha, fill, drop, rot_deg, dt, drips=3, tf=None):
        """一块涂鸦字：泼溅底 + 贴纸白边 + 粗墨线 + 套印错位的底色 + 网点 + 高光线 + 滴漆。"""
        rb = rng_for(31, seed, f // 3)
        path = self.glyph_path(text, size, tf)
        b = path.getBounds()
        rs = rng_for(41, seed)
        dp = skia.Path()
        for k in range(drips):
            dx = b.left() + b.width() * rs.uniform(0.10, 0.90)
            dl = size * rs.uniform(0.18, 0.42) * min(1.0, dt / 10.0)
            dw = size * rs.uniform(0.035, 0.055)
            dp.addRoundRect(skia.Rect.MakeLTRB(dx - dw, b.bottom() - size * 0.22, dx + dw, b.bottom() + dl), dw, dw)
            dp.addCircle(dx, b.bottom() + dl, dw * 1.35)
        shape = (skia.Op(path, dp, skia.PathOp.kUnion_PathOp) or path) if drips else path
        m = skia.Matrix()
        m.setRotate(rot_deg + rb.uniform(-2.2, 2.2))
        m.postScale(sc, sc)
        m.postTranslate(x + rb.uniform(-3, 3), y + rb.uniform(-3, 3))
        shape.transform(m)
        sb = shape.getBounds()
        cv.saveLayerAlpha(None, int(255 * max(0.0, min(1.0, alpha))))
        sp_grow = min(1.0, (dt + 1) / 4.0)
        splat = self.splat_path(sb.centerX() + size * 0.04, sb.centerY() + size * 0.05, max(sb.width(), sb.height() * 1.2) * 0.54 * sp_grow, rng_for(47, seed))
        cv.drawPath(splat, self.fill(drop if drop != INK else PINK, 235))
        self.spray(cv, sb.centerX(), sb.centerY(), max(sb.width(), sb.height()) * 0.72, 60, fill, rng_for(43, seed), a=220)
        ink_w = size * 0.075
        off = (size * 0.06, size * 0.07)
        cv.save(); cv.translate(*off)
        cv.drawPath(shape, self.stroke(WHITE, ink_w * 2.3)); cv.restore()
        cv.drawPath(shape, self.stroke(WHITE, ink_w * 2.3))
        self.outlined(cv, shape, fill, ink_w, drop=drop, drop_off=off, boil=f // 3 + 1)
        dotc = ORANGE if fill == YEL else (WHITE if fill == PINK else (0, 150, 220))
        self.halftone(cv, shape, dotc, size * 0.07, size * 0.026, a=255, fade=(sb.centerX(), sb.top() + sb.height() * 0.45, sb.centerX(), sb.bottom()))
        cv.save(); cv.clipPath(shape, skia.ClipOp.kIntersect, True)
        cv.translate(-size * 0.022, -size * 0.026)
        cv.drawPath(shape, self.stroke(WHITE, size * 0.022, a=235))
        cv.restore()
        cv.restore()

    def draw_tags(self, cv, f, cam):
        i = f - 1
        box = self.car_box(i, cam)
        for tg in self.tags:
            dt = f - tg["f0"]
            if not (0 <= dt < tg["dur"]):
                continue
            if box:
                cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
                wcar = box[2] - box[0]
            else:
                cx, cy, wcar = self.W / 2, self.H * 0.6, 300
            out = max(0.0, (dt - (tg["dur"] - 6)) / 6.0)
            sc = overshoot(dt / 7.0) * (1 - 0.5 * out)
            size = tg["size"]
            x = cx + tg["side"] * (wcar * 0.62 + size * 0.75)
            y = cy - size * 0.55 - dt * 1.2
            x = max(size * 0.9, min(self.W - size * 0.9, x)); y = max(size * 0.9 + 110, min(self.H - size * 1.1 - 120, y))
            self.stamp(cv, f, tg["f0"], tg["text"], size, x, y, sc, 1 - out, tg["fill"], tg["drop"], -9 * tg["side"], dt)

    def draw_outro(self, cv, f, cam):
        """片尾：屏幕右上盖一个“赢！”，车尾甩出一串星星和彩纸。"""
        f0 = self.F_OUT + 6
        if f < f0:
            return
        dt = f - f0
        i = f - 1
        # 星星拖尾：过去若干帧里车尾经过的位置
        car = self.car
        for k in range(1, 30):
            # 星星留在世界里：按“出生帧”取随机数，这样它们不会跟着车跑
            born = (f * 3 - k) // 1
            rs = rng_for(111, born)
            if rs.random() < 0.3:
                continue
            # 相对车身往后飘（不完全留在原地，否则一帧就甩出画面）
            P = self.car_pt(i, car["rear_x"] - 0.25 - 0.24 * k, rs.uniform(-1.0, 1.0), rs.uniform(0.2, 1.25) + 0.015 * k)
            pr = self.proj(P, cam, near=1.0)
            if not pr or pr[2] > 60:
                continue
            ro = rs.uniform(0.12, 0.28) * cam[2] / pr[2] * max(0.0, 1 - k / 30.0) ** 0.7
            if ro < 3:
                continue
            rb = rng_for(113, born, f // 3)
            col = [YEL, PINK, CYAN, WHITE][int(rs.integers(4))]
            if rs.random() < 0.6:
                self.outlined(cv, self.star_path(pr[0], pr[1], ro, ro * 0.42, 5, rot=rb.uniform(0, 6.28)), col, max(2.0, ro * 0.16))
            else:
                self.outlined(cv, self.star_path(pr[0], pr[1], ro, ro * 0.28, 4, rot=rb.uniform(0, 1.6)), col, max(2.0, ro * 0.16))
        if dt < 64:
            out = max(0.0, (dt - 54) / 10.0)
            self.stamp(cv, f, 3001, "赢!", 250, self.W - 330, 300, overshoot(dt / 7.0) * (1 - 0.3 * out), 1 - out, YEL, PINK, 8, dt, drips=3)

    def draw_intro(self, cv, f):
        """片头：涂鸦片名和倒计时。"""
        if 8 <= f <= 74:
            dt = f - 8
            out = max(0.0, (f - 66) / 8.0)
            self.stamp(cv, f, 1001, "午夜冲刺", 140, 470, 742, overshoot(dt / 9.0) * (1 - 0.3 * out), 1 - out, YEL, PINK, -5, dt, drips=4)
        for k, (txt, col, drop) in enumerate((("3", CYAN, INK), ("2", PINK, INK), ("1", YEL, PINK))):
            f0 = self.F_GO - 90 + 30 * k
            dt = f - f0
            if 0 <= dt < 28:
                out = max(0.0, (dt - 21) / 7.0)
                # 片头第一个镜头里主角车在画面中间，数字放到右上，不压车身
                px, py, sz = (1560, 330, 330) if self.fr[f - 1]["cam"] == "cam_intro1" else (1520, 310, 340)
                self.stamp(cv, f, 2000 + k, txt, sz, px, py, overshoot(dt / 6.0) * (1 + 0.25 * out), 1 - out, col, drop, (-7, 6, -4)[k], dt, drips=2, tf=self.tf_num)

    def draw_bolts(self, cv, f, cam):
        i = f - 1
        box = self.car_box(i, cam)
        if not box:
            return
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        wcar = box[2] - box[0]
        for e in self.nears:
            dt = f - e["f"]
            if not (0 <= dt < 13):
                continue
            side = -e.get("side", 1.0)                   # 路人车在车的哪一侧（屏幕上左右）
            rb = rng_for(51, e["f"], f // 3)
            sc = overshoot(dt / 5.0) * (1 - max(0.0, (dt - 9) / 4.0))
            x = cx + side * (wcar * 0.75 + 90); y = cy - 30
            S = 120 * sc
            pts = [(0.15, -1.0), (0.62, -1.0), (0.2, -0.12), (0.7, -0.12), (-0.35, 1.0), (-0.02, 0.12), (-0.5, 0.12)]
            path = skia.Path()
            for k, (px, py) in enumerate(pts):
                X, Y = x + side * px * S * 0.8 + rb.uniform(-2, 2), y + py * S + rb.uniform(-2, 2)
                path.moveTo(X, Y) if k == 0 else path.lineTo(X, Y)
            path.close()
            col = PINK if e.get("oncoming") else CYAN
            self.outlined(cv, path, col, 8, drop=INK, drop_off=(6, 6))
            for k in range(3):                           # 旁边三道小短线
                ang = (-0.5 + k * 0.5) + (0 if side > 0 else math.pi)
                r0, r1 = S * 1.05, S * 1.45
                cv.drawLine(x + r0 * math.cos(ang), y + r0 * math.sin(ang), x + r1 * math.cos(ang), y + r1 * math.sin(ang), self.stroke(WHITE, 6))
        for e in self.overtakes:
            dt = f - e["f"]
            if not (0 <= dt < 16):
                continue
            rb = rng_for(53, e["f"], f // 3)
            a = 1 - max(0.0, (dt - 11) / 5.0)
            x0 = cx - wcar * 0.9 - 260 + dt * 16; y = cy + 10
            cv.saveLayerAlpha(None, int(255 * a))
            for k in range(3):                           # 三个手绘箭头
                xx = x0 + k * 62
                S = 52 + 8 * k
                path = skia.Path()
                for j, (px, py) in enumerate([(-0.5, -1), (0.1, -1), (0.75, 0), (0.1, 1), (-0.5, 1), (0.15, 0)]):
                    X, Y = xx + px * S + rb.uniform(-2, 2), y + py * S + rb.uniform(-2, 2)
                    path.moveTo(X, Y) if j == 0 else path.lineTo(X, Y)
                path.close()
                self.outlined(cv, path, YEL, 7, drop=PINK, drop_off=(5, 5))
            cv.restore()

    def draw_swoosh(self, cv, f, cam):
        i = f - 1
        dr = self.drift[i]
        if abs(dr) < 0.15 or self.v[i] < 8:
            return
        car = self.car
        sgn = 1 if dr < 0 else -1                        # 右弯时车尾往左甩
        rb = rng_for(61, f // 3)
        amt = min(1.0, abs(dr) / 0.45)
        for k in range(3):
            pts = []
            for u in np.linspace(0, 1, 9):
                lx = car["rear_x"] - 0.15 - 0.4 * k - 1.1 * u * (0.6 + 0.3 * k)
                ly = sgn * (0.3 + 1.3 * u + 0.25 * k) * (0.7 + 0.4 * amt)
                pr = self.proj(self.car_pt(i, lx, ly, 0.25 + 0.5 * math.sin(u * math.pi)), cam, near=1.2)
                if pr:
                    pts.append(pr)
            if len(pts) < 4:
                continue
            path = skia.Path(); path.moveTo(pts[0][0], pts[0][1])
            for q in pts[1:]:
                path.lineTo(q[0] + rb.uniform(-1.5, 1.5), q[1] + rb.uniform(-1.5, 1.5))
            w = min(9.0, max(3.0, (0.05 - 0.01 * k) * cam[2] / pts[0][2])) * amt
            cv.drawPath(path, self.stroke(INK, w + 6)); cv.drawPath(path, self.stroke((WHITE, PINK, YEL)[k], w))

    def draw_ticks(self, cv, f, cam):
        """车身周围的手绘短线：猛加速、点火、漂移时出现。"""
        i = f - 1
        t = self.fr[i]
        amt = max(min(1.0, max(0.0, t["a_long"] - 7.5) / 5.0), self.nit[i] * 0.9, min(1.0, abs(self.drift[i]) / 0.5) * 0.7)
        if amt < 0.25 or t["t"] <= 0:
            return
        box = self.car_box(i, cam)
        if not box:
            return
        x0, y0, x1, y1 = box
        w, h = x1 - x0, y1 - y0
        rb = rng_for(71, f // 2)
        n = int(4 + 7 * amt)
        for _ in range(n):
            side = rb.choice([-1, 1])
            px = (x0 - 16 - rb.uniform(0, w * 0.2)) if side < 0 else (x1 + 16 + rb.uniform(0, w * 0.2))
            py = y0 + h * rb.uniform(0.05, 0.9)
            ln = rb.uniform(18, 46) * (0.6 + amt)
            ang = math.radians(rb.uniform(55, 80)) * (1 if side > 0 else -1) + math.pi / 2
            ex, ey = px + side * ln * 0.45, py + ln
            path = skia.Path(); path.moveTo(px, py); path.quadTo(px + side * ln * 0.5, py + ln * 0.35, ex, ey)
            cv.drawPath(path, self.stroke(INK, 8)); cv.drawPath(path, self.stroke(WHITE, 4.5))

    def draw_tip_trails(self, cv, f, cam):
        i = f - 1
        amt = max(min(1.0, (self.v[i] - 50.0) / 25.0), self.nit[i])
        if amt < 0.15 or self.t[i] <= 0 or abs(self.drift[i]) > 0.12:
            return
        car = self.car
        rb = rng_for(63, f // 2)
        K = 4
        for sgn in (1, -1):
            pts = []
            for k in range(K + 1):
                pr = self.proj(self.car_pt(i - k, car["rear_x"] + 0.25, sgn * car["width"] * 0.47, car["height"] * 0.93), cam, near=1.4)
                if pr is None or pr[2] < 4.5:
                    break
                pts.append(pr)
            if len(pts) < 3:
                continue
            path = skia.Path(); path.moveTo(pts[0][0], pts[0][1])
            for q in pts[1:]:
                path.lineTo(q[0] + rb.uniform(-2, 2), q[1] + rb.uniform(-2, 2))
            w = max(2.5, min(7.0, 0.035 * cam[2] / pts[0][2])) * (0.6 + 0.4 * amt)
            cv.drawPath(path, self.stroke(INK, w + 4.5))
            cv.drawPath(path, self.stroke(WHITE, w))

    def draw_sparkles(self, cv, f, cam):
        i = f - 1
        amt = min(1.0, abs(self.drift[i]) / 0.4) if abs(self.drift[i]) > 0.17 else 0.0
        if 0 < self.t[i] < 1.5:
            amt = max(amt, 1.0 - self.t[i] / 1.5)
        if amt < 0.2:
            return
        car = self.car
        rb = rng_for(67, f // 2)
        for _ in range(int(3 + 4 * amt)):
            sgn = rb.choice([-1, 1])
            pr = self.proj(self.car_pt(i, -car["wheelbase"] / 2 - rb.uniform(0.2, 1.6), sgn * (car["track"] / 2 + rb.uniform(0.0, 1.3)), rb.uniform(0.1, 1.1)), cam, near=1.2)
            if not pr:
                continue
            ro = rb.uniform(0.10, 0.22) * cam[2] / pr[2]
            col = [YEL, WHITE, PINK, CYAN][int(rb.integers(4))]
            self.outlined(cv, self.star_path(pr[0], pr[1], ro, ro * 0.3, 4, rot=rb.uniform(0, 1.5)), col, max(2.0, ro * 0.16))

    def draw_edge_lines(self, cv, f):
        i = f - 1
        t = self.fr[i]
        if t["cam"] != "cam_chase":
            return
        vn = min(1.0, self.v[i] / 94.0)
        amt = min(1.0, self.nit[i] * 1.0 + max(0.0, vn - 0.62) * 1.1)
        if amt < 0.08:
            return
        rb = rng_for(81, f // 2)
        cx, cy = self.W / 2, self.H * 0.47
        Rm = math.hypot(self.W, self.H) / 2
        n = int(8 + 34 * amt)
        for _ in range(n):
            ang = rb.uniform(0, 2 * math.pi)
            r0 = Rm * rb.uniform(0.62, 1.0); ln = Rm * rb.uniform(0.08, 0.3) * (0.6 + amt)
            wid = rb.uniform(3, 9) * (0.6 + 0.6 * amt)
            c, s = math.cos(ang), math.sin(ang)
            xa, ya = cx + c * r0, cy + s * r0 * 0.8
            xb, yb = cx + c * (r0 + ln), cy + s * (r0 + ln) * 0.8
            nx, ny = -s, c
            path = skia.Path()
            path.moveTo(xa, ya); path.lineTo(xb + nx * wid, yb + ny * wid); path.lineTo(xb - nx * wid, yb - ny * wid); path.close()
            col = WHITE if rb.random() < 0.6 else (CYAN if self.nit[i] > 0.3 else PINK)
            cv.drawPath(path, self.fill(col, 235))

    def draw_finish(self, cv, f, cam):
        dt = f - self.F_FIN
        if not (0 <= dt < 34):
            return
        rs = rng_for(91)
        for k in range(26):
            ang = rs.uniform(0, 2 * math.pi); sp = rs.uniform(18, 46); r0 = rs.uniform(60, 200)
            x = self.W / 2 + math.cos(ang) * (r0 + sp * dt); y = self.H * 0.55 + math.sin(ang) * (r0 + sp * dt) * 0.7 + 0.35 * dt * dt
            size = rs.uniform(18, 44) * (1 - 0.4 * dt / 34)
            col = [YEL, PINK, CYAN, WHITE][k % 4]
            rb = rng_for(93, k, f // 3)
            if k % 3 == 0:
                self.outlined(cv, self.star_path(x, y, size, size * 0.42, 5, rot=rb.uniform(0, 6.28)), col, 5)
            elif k % 3 == 1:
                path = skia.Path(); path.addRect(skia.Rect.MakeXYWH(-size * 0.5, -size * 0.22, size, size * 0.44))
                m = skia.Matrix(); m.setRotate(rb.uniform(0, 360)); m.postTranslate(x, y); path.transform(m)
                self.outlined(cv, path, col, 5)
            else:
                path = skia.Path(); path.moveTo(x - size, y)
                path.cubicTo(x - size * 0.5, y - size, x, y + size, x + size, y - size * 0.2)
                cv.drawPath(path, self.stroke(INK, 11)); cv.drawPath(path, self.stroke(col, 6))

    # ---------- 合成一帧 ----------
    def render(self, f):
        surf = skia.Surface(self.W, self.H)
        cv = surf.getCanvas()
        cv.clear(skia.ColorTRANSPARENT)
        cam = self.cam(f)
        self.draw_intro(cv, f)
        if self.fr[f - 1]["cam"] == "cam_outro":
            self.draw_outro(cv, f, cam)
        if self.F_GO - 60 <= f <= self.F_FIN + 40 and self.fr[f - 1]["cam"] == "cam_chase":
            self.draw_lines(cv, f, cam)
            self.draw_edge_lines(cv, f)
        if self.fr[f - 1]["cam"] == "cam_chase":
            self.draw_ribbons(cv, f, cam)
        ps = self.puffs_by_f.get(f, ())
        if ps:
            def depth(p):
                tsec = (f - p["f0"]) / self.meta["fps"]
                pc = self.to_cam(p["p0"] + p["vel"] * tsec, cam)
                return pc[2]
            for p in sorted(ps, key=depth):
                self.draw_puff(cv, p, f, cam)
        if self.fr[f - 1]["cam"] == "cam_chase":
            self.draw_swoosh(cv, f, cam)
            self.draw_tip_trails(cv, f, cam)
            self.draw_sparkles(cv, f, cam)
            self.draw_exhaust_stars(cv, f, cam)
            self.draw_ticks(cv, f, cam)
            self.draw_burst(cv, f, cam)
            self.draw_bolts(cv, f, cam)
            self.draw_tags(cv, f, cam)
            self.draw_finish(cv, f, cam)
        return surf.toarray(colorType=skia.kRGBA_8888_ColorType)


if __name__ == "__main__":
    import cv2
    g = Gfx()
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    bgdir = sys.argv[2] if len(sys.argv) > 2 and os.path.isdir(sys.argv[2]) else None
    frames = [int(x) for x in sys.argv[(3 if bgdir else 2):]]
    for f in frames:
        ov = g.render(f).astype(np.float32) / 255.0
        bg = None
        if bgdir:
            p = os.path.join(bgdir, f"f{f:04d}.png")
            if os.path.exists(p):
                bg = cv2.cvtColor(cv2.resize(cv2.imread(p), (g.W, g.H), interpolation=cv2.INTER_CUBIC), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        if bg is None:
            bg = np.full((g.H, g.W, 3), 0.12, np.float32)
        img = bg * (1 - ov[..., 3:4]) + ov[..., :3]
        cv2.imwrite(os.path.join(out, f"gfx_{f:04d}.jpg"), cv2.cvtColor((np.clip(img, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])
        print("ok", f)
