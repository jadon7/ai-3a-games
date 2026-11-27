#!/usr/bin/env python3
"""原创 HUD：速度表、转速条、氮气条、名次、计时、小地图、事件提示、倒计时、结算。
Hud(telemetry.json).render(frame) → RGBA uint8 (1080p)。内部按 2 倍画再缩小，边缘更干净。"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 2
W, H = 1920, 1080
CY = (25, 240, 224); MG = (255, 45, 120); WH = (244, 246, 255); YL = (255, 210, 30); DK = (8, 10, 18)
NUM = "BarlowCondensed-ExtraBoldItalic.ttf"; LAB = "BarlowCondensed-SemiBoldItalic.ttf"; BLD = "BarlowCondensed-BoldItalic.ttf"
CN = "ZCOOLQingKeHuangYou-Regular.ttf"
RIVAL_COL = {"rival_green": (70, 255, 120), "rival_purple": (175, 110, 255), "rival_yellow": (255, 205, 40)}
_fc = {}


def font(name, size):
    k = (name, int(size * S))
    if k not in _fc:
        _fc[k] = ImageFont.truetype(os.path.join(ROOT, "assets", "fonts", name), k[1])
    return _fc[k]


def ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def P(*v):
    return [(x * S, y * S) for x, y in v]


class Layer:
    """一组 HUD 元素；画完按整体透明度合到底图上。"""

    def __init__(self):
        self.im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def para(self, x, y, w, h, fill, skew=None, outline=None, width=1):
        sk = h * 0.28 if skew is None else skew
        pts = P((x + sk, y), (x + w + sk, y), (x + w, y + h), (x, y + h))
        self.d.polygon(pts, fill=fill, outline=outline, width=int(width * S))

    def text(self, x, y, s, fnt, fill, anchor="ls", shadow=True):
        if shadow:
            self.d.text(((x + 2) * S, (y + 2) * S), s, font=fnt, fill=(0, 0, 0, min(160, fill[3] if len(fill) > 3 else 160)), anchor=anchor)
        self.d.text((x * S, y * S), s, font=fnt, fill=fill, anchor=anchor)

    def width(self, s, fnt):
        return self.d.textlength(s, font=fnt) / S

    def line(self, pts, fill, width):
        self.d.line(P(*pts), fill=fill, width=int(width * S), joint="curve")

    def fade(self, a):
        if a < 0.999:
            al = self.im.getchannel("A").point(lambda v: int(v * max(0.0, a)))
            self.im.putalpha(al)
        return self


def A(col, a):
    return (*col, int(max(0, min(255, a))))


class Hud:
    def __init__(self, path=None):
        d = json.load(open(path or os.path.join(ROOT, "out", "telemetry.json")))
        self.meta, self.fr = d["meta"], d["frames"]
        m = self.meta
        self.F_GO, self.F_FIN, self.F_OUT, self.F_END = m["F_GO"], m["F_FIN"], m["F_OUT"], m["F_END"]
        tr = np.array(m["track"])
        self.tr = tr
        self.mx0, self.mx1 = -60.0, float(tr[:, 0].max()) + 40.0
        self.my0, self.my1 = float(tr[:, 1].min()) - 70.0, 70.0
        self.events = m["events"]
        # 累计分数
        pts = {"overtake": 500, "nitro": 0}
        self.score_at = []
        acc = 0
        ev = {e["f"]: e for e in self.events}
        for fr in self.fr:
            e = ev.get(fr["f"])
            if e:
                acc += self.ev_points(e)
            self.score_at.append(acc)
        self.max_kmh = m.get("top_kmh", 337.0)

    @staticmethod
    def ev_points(e):
        if e["type"] == "overtake":
            return 500
        if e["type"] == "near":
            return 250 if e.get("oncoming") else 150
        if e["type"] == "drift":
            return int(e["score"])
        return 0

    # ---- 小地图坐标 ----
    def mp(self, x, y, box):
        bx, by, bw, bh = box
        u = (x - self.mx0) / (self.mx1 - self.mx0); v = (y - self.my0) / (self.my1 - self.my0)
        return (bx + u * bw, by + bh - v * bh)

    def render(self, f):
        t = self.fr[f - 1]
        base = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        F_GO, F_FIN, F_OUT = self.F_GO, self.F_FIN, self.F_OUT
        # ---------- 电影黑边 ----------
        bar = 0.0
        if f < F_GO:
            bar = 1.0 - ease((f - (F_GO - 20)) / 18.0)
        elif f >= F_OUT:
            bar = ease((f - F_OUT) / 14.0)
        if bar > 0.001:
            L = Layer()
            hb = 104 * bar
            L.d.rectangle((0, 0, W * S, hb * S), fill=(0, 0, 0, 255))
            L.d.rectangle((0, (H - hb) * S, W * S, H * S), fill=(0, 0, 0, 255))
            base.alpha_composite(L.im)
        # ---------- 片头标题 ----------
        if 8 <= f <= 74:
            a = min(1.0, (f - 8) / 10.0) * min(1.0, (74 - f) / 10.0)
            L = Layer()
            x0 = 110 - (1 - ease((f - 8) / 14.0)) * 50
            L.text(x0 + 24, 946, "MIDNIGHT SPRINT", font(NUM, 40), A(CY, 255))
            L.text(x0 + 306, 944, "DOWNTOWN AVE  »  HARBOR BRIDGE   ·   1.9 KM   ·   4 RACERS", font(LAB, 24), A(WH, 200))
            base.alpha_composite(L.fade(a).im)
        # ---------- 主 HUD ----------
        ha = 0.0
        if f >= F_GO - 40:
            ha = ease((f - (F_GO - 40)) / 26.0)
        if f > F_FIN + 6:
            ha = 1.0 - ease((f - F_FIN - 6) / 12.0)
        if ha > 0.01:
            base.alpha_composite(self.gauges(t, f).fade(ha).im)
            base.alpha_composite(self.topbar(t, f).fade(ha).im)
            base.alpha_composite(self.minimap(t, f).fade(ha).im)
            ev = self.popups(t, f)
            if ev is not None:
                base.alpha_composite(ev.fade(ha).im)
        # ---------- 倒计时 ----------
        cd = self.countdown(f)
        if cd is not None:
            base.alpha_composite(cd.im)
        # ---------- 冲线和结算 ----------
        fin = self.finish(t, f)
        if fin is not None:
            base.alpha_composite(fin.im)
        return np.asarray(base.resize((W, H), Image.LANCZOS))

    # ---- 右下：速度 / 挡位 / 转速 / 氮气 ----
    def gauges(self, t, f):
        L = Layer()
        nit = t["nitro_env"]
        kmh = int(round(t["kmh"]))
        x1 = 1856
        # 底板
        L.para(1408, 868, 470, 168, A(DK, 120), skew=30)
        L.para(1408, 868, 470, 3, A(CY if nit < 0.3 else MG, 230), skew=30)
        # 速度数字
        col = WH if nit < 0.3 else tuple(int(WH[i] * (1 - nit * 0.5) + CY[i] * nit * 0.5) for i in range(3))
        L.text(x1 - 64, 986, f"{kmh}", font(NUM, 132), A(col, 255), anchor="rs")
        L.text(x1 - 58, 986, "KM/H", font(LAB, 28), A(WH, 210), anchor="ls")
        if nit > 0.3:
            L.text(x1 - 58, 952, "N2O", font(BLD, 30), A(MG, 255), anchor="ls")
        # 挡位
        L.para(1446, 892, 72, 92, A(DK, 190), skew=16, outline=A(YL, 255), width=2)
        L.text(1490, 974, "N" if t["t"] <= 0 and t["rpm"] < 1500 else str(t["gear"]), font(NUM, 84), A(YL, 255), anchor="ms", shadow=False)
        L.text(1466, 886, "GEAR", font(LAB, 17), A(WH, 170), anchor="ls", shadow=False)
        # 转速条
        n = 30
        frac = max(0.0, min(1.0, (t["rpm"] - 1000) / 7400.0))
        bx0, bw, gap = 1432, 12.2, 2.3
        for i in range(n):
            on = (i + 0.5) / n <= frac
            c = WH if i < n * 0.66 else (CY if i < n * 0.86 else MG)
            hh = 14 + 10 * (i / n)
            L.para(bx0 + i * (bw + gap), 1012 - hh, bw, hh, A(c, 255 if on else 46), skew=4)
        # 氮气条
        lv = t["nitro"]
        L.para(1426, 1020, 436, 13, A(DK, 170), skew=4)
        fillc = CY if not t["nitro_on"] else (MG if (f // 2) % 2 == 0 else WH)
        if lv > 0.01:
            L.para(1428, 1022, 432 * lv, 9, A(fillc, 255), skew=3)
        L.text(1420, 1033, "NITRO", font(BLD, 20), A(CY if not t["nitro_on"] else MG, 255), anchor="rs")
        return L

    # ---- 顶部：名次 / 路段 / 进度 / 计时 / 分数 ----
    def topbar(self, t, f):
        L = Layer()
        m = self.meta
        rank = t["rank"] if t["t"] > 0.4 else 4
        # 名次
        L.para(56, 54, 250, 118, A(DK, 120), skew=24)
        L.para(56, 54, 6, 118, A(MG, 255), skew=24)
        L.text(98, 84, "POS", font(BLD, 24), A(WH, 200), anchor="ls")
        L.text(98, 164, f"{rank}", font(NUM, 96), A(YL if rank == 1 else WH, 255), anchor="ls")
        w = L.width(f"{rank}", font(NUM, 96))
        L.text(104 + w, 164, "/4", font(NUM, 50), A(WH, 190), anchor="ls")
        # 路段名
        sec = m["sections"][0]
        for s_ in m["sections"]:
            if t["s"] >= s_[2]:
                sec = s_
        L.text(86, 208, sec[1], font(CN, 30), A(CY, 255), anchor="ls")
        w = L.width(sec[1], font(CN, 30))
        L.text(96 + w, 207, sec[0], font(BLD, 28), A(WH, 220), anchor="ls")
        # 进度条
        prog = max(0.0, min(1.0, (t["s"] - m["START_S"]) / (m["FINISH_S"] - m["START_S"])))
        L.para(84, 222, 420, 7, A(DK, 170), skew=2)
        L.para(84, 222, 420 * prog, 7, A(CY, 255), skew=2)
        for s_ in m["sections"][1:]:
            u = (s_[2] - m["START_S"]) / (m["FINISH_S"] - m["START_S"])
            L.para(84 + 420 * u, 219, 2, 13, A(WH, 200), skew=0)
        L.text(516, 232, f"{int(prog * 100)}%", font(BLD, 24), A(WH, 220), anchor="ls")
        # 计时
        tt = max(0.0, min(t["t"], m["T_FIN"]))
        mm, ss = int(tt // 60), tt % 60
        L.para(1560, 54, 300, 84, A(DK, 120), skew=20)
        L.para(1854, 54, 6, 84, A(CY, 255), skew=20)
        L.text(1846, 84, "TIME", font(BLD, 22), A(WH, 190), anchor="rs")
        L.text(1846, 130, f"{mm:02d}:{ss:05.2f}", font(NUM, 56), A(WH, 255), anchor="rs")
        sc_ = self.score_at[f - 1] + (int(t["drift_score"]) if t["drifting"] else 0)
        L.text(1836, 170, f"SCORE  {sc_:,}", font(BLD, 28), A(YL, 255), anchor="rs")
        return L

    # ---- 左下：小地图 ----
    def minimap(self, t, f):
        L = Layer()
        box = (86, 892, 372, 124)
        L.para(60, 872, 420, 164, A(DK, 120), skew=30)
        L.para(60, 872, 420, 3, A(CY, 230), skew=30)
        tr = self.tr
        pts = [self.mp(x, y, box) for x, y in tr]
        L.line(pts, A(WH, 120), 5)
        k = int(max(1, min(len(pts) - 1, t["s"] / 6.0)))
        L.line(pts[:k + 1], A(CY, 255), 5)
        # 终点
        kf = int(self.meta["FINISH_S"] / 6.0)
        fx, fy = pts[min(kf, len(pts) - 1)]
        for i in range(2):
            for j in range(3):
                if (i + j) % 2 == 0:
                    L.d.rectangle(((fx - 4 + i * 4) * S, (fy - 14 + j * 4) * S, (fx + i * 4) * S, (fy - 10 + j * 4) * S), fill=A(WH, 255))
        L.d.line(P((fx - 4, fy - 14), (fx - 4, fy + 2)), fill=A(WH, 255), width=S)
        for name, (rx, ry) in zip(self.meta["rival_names"], t["rivals"]):
            px, py = self.mp(rx, ry, box)
            L.d.ellipse(((px - 6) * S, (py - 6) * S, (px + 6) * S, (py + 6) * S), fill=A(RIVAL_COL.get(name, WH), 255), outline=A(DK, 255), width=S)
        px, py = self.mp(t["x"], t["y"], box)
        yaw = -t["yaw"]
        tri = [(11, 0), (-7, 6.5), (-3.5, 0), (-7, -6.5)]
        c, s_ = math.cos(yaw), math.sin(yaw)
        L.d.polygon(P(*[(px + a * c - b * s_, py + a * s_ + b * c) for a, b in tri]), fill=A(WH, 255), outline=A(CY, 255), width=S)
        return L

    # ---- 事件提示 ----
    def popups(self, t, f):
        DUR = 54
        act = [e for e in self.events if 0 <= f - e["f"] < DUR]
        live_drift = t["drift_hold"] > 0 and t["drift_score"] > 60
        if not act and not live_drift:
            return None
        L = Layer()
        for k, e in enumerate(reversed(act[-3:])):
            dt = f - e["f"]
            a = min(1.0, dt / 4.0) * min(1.0, (DUR - dt) / 10.0)
            xo = (1 - ease(dt / 9.0)) * 90
            y = 262 + k * 74
            if e["type"] == "overtake":
                cn, en, pts_, col = "超车", f"OVERTAKE   P{e['rank']}", "+500", YL
            elif e["type"] == "near":
                cn, en, pts_, col = ("对向擦身", "ONCOMING NEAR MISS", "+250", MG) if e.get("oncoming") else ("擦身而过", "NEAR MISS", "+150", CY)
            elif e["type"] == "nitro":
                cn, en, pts_, col = "氮气加速", "NITRO BOOST", "", MG
            else:
                cn, en, pts_, col = "漂移结算", "DRIFT BANKED", f"+{e['score']:,}", MG
            fe, fcn = font(NUM, 46), font(CN, 30)
            wen = L.width(en, fe); wcn = L.width(cn, fcn); wp = L.width(pts_, fe) if pts_ else 0
            tw = wcn + 18 + wen + (28 + wp if pts_ else 0)
            x = 960 - tw / 2 + xo
            ly = Layer()
            ly.para(x - 34, y - 46, tw + 68, 60, A(DK, 150), skew=16)
            ly.para(x - 34, y - 46, 6, 60, A(col, 255), skew=16)
            ly.text(x, y, cn, fcn, A(col, 255))
            ly.text(x + wcn + 18, y + 2, en, fe, A(WH, 255))
            if pts_:
                ly.text(x + wcn + 18 + wen + 28, y + 2, pts_, fe, A(col, 255))
            L.im.alpha_composite(ly.fade(a).im)
        if live_drift:
            a = min(1.0, t["drift_hold"] / 10.0)
            pulse = 1.0 + 0.06 * math.sin(f * 1.3) if t["drifting"] else 1.0
            ly = Layer()
            ly.text(952, 944, "DRIFT", font(BLD, 30), A(WH, 230), anchor="rs")
            ly.text(966, 943, "漂移", font(CN, 26), A(MG, 230), anchor="ls")
            ly.text(960, 1006, f"{int(t['drift_score']):,}", font(NUM, 70 * pulse), A(MG, 255), anchor="ms")
            L.im.alpha_composite(ly.fade(a).im)
        return L

    # ---- 倒计时 ----
    def countdown(self, f):
        F_GO = self.F_GO
        for label, start, col in (("GO!", F_GO, CY),):
            dur = 30 if label != "GO!" else 34
            if start <= f < start + dur:
                u = (f - start) / dur
                sc_ = 1.5 - 0.5 * ease(u * 4.0)
                a = 1.0 - max(0.0, (u - 0.62) / 0.38)
                L = Layer()
                size = (300 if label != "GO!" else 260) * sc_
                L.text(960, 520, label, font(NUM, size), A(col, 255), anchor="ms")
                # 外圈刻度
                if label != "GO!":
                    r = 230
                    for i in range(48):
                        if i / 48 >= u:
                            ang = -math.pi / 2 + i / 48 * 2 * math.pi
                            p0 = (960 + r * math.cos(ang), 420 + r * math.sin(ang))
                            p1 = (960 + (r + 16) * math.cos(ang), 420 + (r + 16) * math.sin(ang))
                            L.d.line(P(p0, p1), fill=A(col, 220), width=3 * S)
                return L.fade(a)
        return None

    # ---- 冲线 / 结算 ----
    def finish(self, t, f):
        F_FIN, F_OUT = self.F_FIN, self.F_OUT
        if F_FIN <= f < F_OUT + 6:
            u = (f - F_FIN) / 20.0
            a = min(1.0, (f - F_FIN) / 3.0) * min(1.0, (F_OUT + 6 - f) / 6.0)
            L = Layer()
            sc_ = 1.35 - 0.35 * ease(u * 2.5)
            L.text(960, 500, "FINISH", font(NUM, 230 * sc_), A(WH, 255), anchor="ms")
            L.text(960, 566, "冲线", font(CN, 54), A(MG, 255), anchor="ms")
            return L.fade(a)
        if f >= F_OUT + 10:
            # 结算信息做成底部一条横栏，不挡画面中间的车
            dt = f - (F_OUT + 10)
            a = min(1.0, dt / 8.0)
            xo = (1 - ease(dt / 14.0)) * 90
            L = Layer()
            x = 84 - xo
            L.para(x, 842, 1560, 116, A(DK, 165), skew=34)
            L.para(x, 842, 8, 116, A(YL, 255), skew=34)
            L.text(x + 62, 944, "1ST", font(NUM, 116), A(YL, 255))
            L.text(x + 268, 898, "PLACE", font(NUM, 44), A(WH, 255))
            L.text(x + 268, 942, "第一名", font(CN, 38), A(WH, 255))
            tt = self.meta["T_FIN"]
            cols = [("TIME", "用时", f"{int(tt // 60):02d}:{tt % 60:05.2f}"), ("TOP SPEED", "最高时速", f"{int(self.max_kmh)} KM/H"),
                    ("SCORE", "得分", f"{self.score_at[-1]:,}"), ("OVERTAKES", "超车", f"{sum(1 for e in self.events if e['type'] == 'overtake')}")]
            for k, (lab, cn, val) in enumerate(cols):
                ra = min(1.0, max(0.0, (dt - 8 - k * 5) / 8.0))
                if ra <= 0:
                    continue
                cx = x + 500 + k * 268
                ly = Layer()
                ly.para(cx - 22, 862, 3, 78, A(WH, 90), skew=22)
                ly.text(cx, 892, lab, font(BLD, 26), A(WH, 215))
                wl = ly.width(lab, font(BLD, 26))
                ly.text(cx + wl + 10, 891, cn, font(CN, 21), A(CY, 235))
                ly.text(cx, 942, val, font(NUM, 46), A(WH, 255))
                L.im.alpha_composite(ly.fade(ra).im)
            return L.fade(a)
        return None


if __name__ == "__main__":
    import sys
    h = Hud()
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for f in [int(x) for x in sys.argv[2:]]:
        im = Image.fromarray(h.render(f))
        bg = Image.new("RGBA", im.size, (40, 44, 60, 255))
        bg.alpha_composite(im)
        bg.convert("RGB").save(os.path.join(out, f"hud_{f:04d}.jpg"), quality=90)
        print("ok", f)
