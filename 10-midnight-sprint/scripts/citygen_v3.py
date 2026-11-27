"""城市生成的通用积木：网格构建器、沿赛道扫掠、楼群、路灯、招牌等。"""
import bpy, math, random, json, os
from mathutils import Vector, Matrix
from common import *
import mats
from track import *


def get_col(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


class MB:
    """简单网格构建器：每个四边形独立顶点，带 UV、第二套随机 UV、材质号。"""

    def __init__(self):
        self.v = []; self.f = []; self.uv = []; self.rnd = []; self.mi = []

    def quad(self, p0, p1, p2, p3, uv=((0, 0), (1, 0), (1, 1), (0, 1)), mi=0, rnd=(0.0, 0.0)):
        i = len(self.v)
        self.v += [tuple(p0), tuple(p1), tuple(p2), tuple(p3)]
        self.f.append((i, i + 1, i + 2, i + 3))
        self.uv += list(uv)
        self.rnd += [rnd] * 4
        self.mi.append(mi)

    def box(self, c, size, yaw=0.0, mi=0, rnd=(0.0, 0.0), uvscale=1.0):
        """c 为中心，size=(sx,sy,sz)，绕 Z 转 yaw。"""
        cx, cy, cz = c; sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        ca, sa = math.cos(yaw), math.sin(yaw)

        def P(x, y, z):
            return (cx + x * ca - y * sa, cy + x * sa + y * ca, cz + z)

        s = uvscale
        faces = [
            ((-sx, -sy, -sz), (sx, -sy, -sz), (sx, -sy, sz), (-sx, -sy, sz), size[0], size[2]),   # -Y
            ((sx, sy, -sz), (-sx, sy, -sz), (-sx, sy, sz), (sx, sy, sz), size[0], size[2]),       # +Y
            ((sx, -sy, -sz), (sx, sy, -sz), (sx, sy, sz), (sx, -sy, sz), size[1], size[2]),       # +X
            ((-sx, sy, -sz), (-sx, -sy, -sz), (-sx, -sy, sz), (-sx, sy, sz), size[1], size[2]),   # -X
            ((-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz), size[0], size[1]),       # +Z
            ((-sx, sy, -sz), (sx, sy, -sz), (sx, -sy, -sz), (-sx, -sy, -sz), size[0], size[1]),   # -Z
        ]
        for a, b, c2, d, w, h in faces:
            self.quad(P(*a), P(*b), P(*c2), P(*d), ((0, 0), (w * s, 0), (w * s, h * s), (0, h * s)), mi, rnd)

    def cyl(self, p0, p1, r, n=8, mi=0, rnd=(0.0, 0.0), r1=None):
        p0 = Vector(p0); p1 = Vector(p1)
        ax = (p1 - p0)
        ln = ax.length
        if ln < 1e-6:
            return
        ax.normalize()
        ref = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
        a = ax.cross(ref).normalized(); b = ax.cross(a)
        r1 = r if r1 is None else r1
        for i in range(n):
            t0 = 2 * math.pi * i / n; t1 = 2 * math.pi * (i + 1) / n
            d0 = a * math.cos(t0) + b * math.sin(t0); d1 = a * math.cos(t1) + b * math.sin(t1)
            self.quad(p0 + d0 * r, p0 + d1 * r, p1 + d1 * r1, p1 + d0 * r1,
                      ((i / n, 0), ((i + 1) / n, 0), ((i + 1) / n, ln), (i / n, ln)), mi, rnd)

    def build(self, name, materials, col, smooth=False):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        uvl = me.uv_layers.new(name="UVMap")
        flat = [c for uv in self.uv for c in uv]
        uvl.data.foreach_set("uv", flat)
        rl = me.uv_layers.new(name="rnd")
        rl.data.foreach_set("uv", [c for r in self.rnd for c in r])
        for m in materials:
            me.materials.append(m)
        me.polygons.foreach_set("material_index", self.mi)
        if smooth:
            me.polygons.foreach_set("use_smooth", [True] * len(self.f))
        me.update()
        ob = bpy.data.objects.new(name, me)
        col.objects.link(ob)
        return ob


def frange(a, b, step):
    n = max(1, int(math.ceil((b - a) / step)))
    return [a + (b - a) * i / n for i in range(n + 1)]


def sweep(track, s0, s1, prof, name, materials, col, step=2.0, uv="profile", zoff=0.0, mi_fn=None, absz=False):
    """沿赛道把横截面折线 prof(s) → [(d, z), ...] 扫成面。法线 = 折线方向 × 行进方向
    （面朝上的平面：折线从左(+d)往右(-d)走）。uv='lateral'：u=d, v=s；否则 u=折线累计长度。"""
    mb = MB()
    ss = frange(s0, s1, step)
    rings = []
    for s in ss:
        x, y, z, h, _ = track.pose(s)
        pr = prof(s)
        pts = [(x - d * math.sin(h), y + d * math.cos(h), (0.0 if absz else z) + pz + zoff) for d, pz in pr]
        rings.append((s, pr, pts))
    for (sa, pa, A), (sb, pb, B) in zip(rings[:-1], rings[1:]):
        acc = 0.0
        for j in range(len(pa) - 1):
            seg = math.hypot(pa[j + 1][0] - pa[j][0], pa[j + 1][1] - pa[j][1])
            if uv == "lateral":
                uvs = ((pa[j][0], sa), (pa[j + 1][0], sa), (pb[j + 1][0], sb), (pb[j][0], sb))
            else:
                uvs = ((acc, sa), (acc + seg, sa), (acc + seg, sb), (acc, sb))
            mb.quad(A[j], A[j + 1], B[j + 1], B[j], uvs, mi_fn(j) if mi_fn else 0)
            acc += seg
    return mb.build(name, materials, col)


def in_gaps(a, b, gaps):
    for g0, g1 in gaps:
        if a < g1 and b > g0:
            return (g0, g1)
    return None


# ---------------- 招牌 ----------------
class Signs:
    def __init__(self, col):
        self.col = col
        self.man = json.load(open(A("signs", "manifest.json")))
        self.by_kind = {}
        for i, m in enumerate(self.man):
            self.by_kind.setdefault(m["kind"], []).append(i)
        self.mats = {}
        self.mb = MB()
        self.slots = []
        self.backs = MB()

    def slot(self, idx):
        if idx not in self.mats:
            m = self.man[idx]
            st = {"blade": 2.4, "horiz": 2.4, "square": 2.2, "board": 1.3, "chevron": 3.0, "roadsign": 0.45, "banner": 2.6}[m["kind"]]
            if m.get("lightbox"):
                st *= 0.55
            self.mats[idx] = len(self.slots)
            self.slots.append(mats.sign(m["file"], st))
        return self.mats[idx]

    def pick(self, kind, rng):
        return rng.choice(self.by_kind[kind])

    def aspect(self, idx):
        return self.man[idx]["w"] / self.man[idx]["h"]

    def facing(self, track, s, d, z, width, height, idx, side, flip=False):
        """贴在立面上、朝向道路的牌子。s 为中心里程，d 为横向位置（含左右符号），z 为底边高。"""
        a = track.xyz(s - width / 2, d, z); b = track.xyz(s + width / 2, d, z)
        a2 = (a[0], a[1], a[2] + height); b2 = (b[0], b[1], b[2] + height)
        mi = self.slot(idx)
        left_to_right = (side > 0) != flip   # 左侧墙：观看者的右手边是 s 增加方向
        if left_to_right:
            self.mb.quad(a, b, b2, a2, ((0, 0), (1, 0), (1, 1), (0, 1)), mi)
        else:
            self.mb.quad(b, a, a2, b2, ((0, 0), (1, 0), (1, 1), (0, 1)), mi)

    def blade(self, track, s, d_wall, z, width, height, idx, side):
        """垂直于立面、伸向道路的竖招牌，正面朝来车方向。"""
        d0 = d_wall - side * 0.25
        d1 = d_wall - side * (0.25 + width)
        dl, dr = (max(d0, d1), min(d0, d1))   # 视野里左→右 = d 递减
        a = track.xyz(s, dl, z); b = track.xyz(s, dr, z)
        a2 = (a[0], a[1], a[2] + height); b2 = (b[0], b[1], b[2] + height)
        mi = self.slot(idx)
        self.mb.quad(a, b, b2, a2, ((0, 0), (1, 0), (1, 1), (0, 1)), mi)
        # 背面（顺行看不到，逆光时挡一下）和支架
        c = track.xyz(s + 0.12, (dl + dr) / 2, z + height / 2)
        self.backs.box(c, (0.12, width + 0.1, height + 0.1), yaw=track.heading(s))
        arm0 = track.xyz(s + 0.12, d_wall, z + height * 0.9); arm1 = track.xyz(s + 0.12, d0, z + height * 0.9)
        self.backs.cyl(arm0, arm1, 0.04, 4)

    def build(self):
        ob = self.mb.build("signs", self.slots, self.col)
        self.backs.build("sign_backs", [mats.flat("sign_back", (0.02, 0.02, 0.025), 0.5, 0.6)], self.col)
        return ob


# ---------------- 楼群 ----------------
STYLES = {
    "tower": dict(w=(26, 46), h=(55, 170), depth=34, gap=(0.0, 3.0), mats=["ft_007", "ft_008", "ft_009", "ft_010", "ft_011", "ft_013", "ft_016"], board=0.16, shop=0.10, blade=0.0, crown=0.0),
    "mid": dict(w=(16, 30), h=(24, 70), depth=26, gap=(0.0, 2.0), mats=["ft_012", "ft_013", "ft_015", "ft_016", "ft_017", "ft_009", "ft_020"], board=0.12, shop=0.28, blade=0.10, crown=0.0),
    "shop": dict(w=(9, 18), h=(11, 38), depth=18, gap=(0.0, 0.6), mats=["ft_018", "ft_019", "ft_020", "ft_017", "ft_018", "ft_020"], board=0.10, shop=0.50, blade=0.42, crown=0.0),
    "far": dict(w=(30, 60), h=(60, 240), depth=40, gap=(4.0, 30.0), mats=["ft_007", "ft_008", "ft_010", "ft_011", "ft_012", "ft_015"], board=0.0, shop=0.0, blade=0.0, crown=0.0),
}
LED_COLS = [(0.1, 0.9, 1.0), (1.0, 0.15, 0.5), (1.0, 0.75, 0.2), (0.6, 0.35, 1.0), (0.95, 0.97, 1.0)]


class City:
    def __init__(self, col_name="CITY"):
        self.col = get_col(col_name)
        self.signs = Signs(self.col)
        self.bld = MB()
        self.led = MB()
        self.bmats = {}
        self.bslots = []
        self.roof = self._slot("roof")
        self.n_bld = 0
        self.lamp_mesh = {}
        self.lamp_light = {}
        self.misc = {}      # 名称 → MB，按材质分组的零碎几何

    def _slot(self, name):
        if name not in self.bmats:
            self.bmats[name] = len(self.bslots)
            self.bslots.append(mats.get(name))
        return self.bmats[name]

    def mbuf(self, matname):
        if matname not in self.misc:
            self.misc[matname] = MB()
        return self.misc[matname]

    # ---- 楼 ----
    def box_building(self, p0, p1, out, depth, h, z0, mi, rnd, led_prob=0.0, rng=None):
        """p0→p1 是临街立面的底边（沿行进方向），out 是背离道路的单位向量。"""
        p0 = Vector(p0); p1 = Vector(p1); o = Vector((out[0], out[1], 0)) * depth
        w = (p1 - p0).length
        b0 = p0 + o; b1 = p1 + o
        zt = h
        up = lambda p, z: (p.x, p.y, z)
        # 临街面
        self.bld.quad(up(p0, z0), up(p1, z0), up(p1, zt), up(p0, zt), ((0, z0), (w, z0), (w, zt), (0, zt)), mi, rnd)
        # 背面
        self.bld.quad(up(b1, z0), up(b0, z0), up(b0, zt), up(b1, zt), ((0, z0), (w, z0), (w, zt), (0, zt)), mi, rnd)
        # 两个侧面
        self.bld.quad(up(b0, z0), up(p0, z0), up(p0, zt), up(b0, zt), ((0, z0), (depth, z0), (depth, zt), (0, zt)), mi, rnd)
        self.bld.quad(up(p1, z0), up(b1, z0), up(b1, zt), up(p1, zt), ((0, z0), (depth, z0), (depth, zt), (0, zt)), mi, rnd)
        # 屋顶
        self.bld.quad(up(p0, zt), up(p1, zt), up(b1, zt), up(b0, zt), ((0, 0), (w, 0), (w, depth), (0, depth)), self.roof, rnd)
        self.n_bld += 1
        if rng and rng.random() < led_prob:
            ci = rng.randrange(len(LED_COLS))
            t = 0.35
            n = (p0 - p1).normalized()
            inn = -Vector((out[0], out[1], 0)) * 0.12
            # 顶边灯带
            self.led.quad(up(p0 + inn, zt - t), up(p1 + inn, zt - t), up(p1 + inn, zt), up(p0 + inn, zt), mi=ci)
            if rng.random() < 0.6:   # 两条竖向灯带
                for p in (p0, p1):
                    q = p + inn + (n * t if p is p1 else -n * t)
                    a = p + inn
                    lo = z0 + rng.uniform(6, 20)
                    self.led.quad(up(a, lo), up(q, lo), up(q, zt), up(a, zt), mi=ci)
        if h > 85 and rng:
            for p in (p0, b1):
                self.mbuf("emit_red").box((p.x - out[0] * 0.8, p.y - out[1] * 0.8, zt + 0.5), (0.7, 0.7, 1.0))

    def buildings(self, track, s0, s1, side, setback, style, rng, gaps=(), signs=True, z0=-0.6, hscale=1.0):
        st = STYLES[style]
        s = s0
        while s < s1 - 4:
            w = rng.uniform(*st["w"])
            d = side * setback
            k = track.pose(min(max(s + w / 2, 0), track.length))[4]
            scale = 1 - k * d
            if scale < 0.3:
                s += 4; continue
            ds = w / scale
            if s + ds > s1:
                ds = s1 - s
                w = ds * scale
                if w < 6:
                    break
            g = in_gaps(s, s + ds, gaps)
            if g:
                if g[0] - s > 8:          # 缺口前还能塞一栋窄一点的
                    ds = g[0] - s; w = ds * scale
                else:
                    s = g[1]; continue
            p0 = track.xyz(s, d); p1 = track.xyz(s + ds, d)
            hm = track.heading(s + ds / 2)
            out = (-math.sin(hm) * side, math.cos(hm) * side)
            h = rng.uniform(*st["h"]) * hscale
            if style in ("tower", "far") and rng.random() < 0.12:
                h *= 1.5
            mi = self._slot(rng.choice(st["mats"]))
            rnd = (rng.random(), rng.random())
            self.box_building((p0[0], p0[1], 0), (p1[0], p1[1], 0), out, st["depth"], h, z0, mi, rnd, st["crown"], rng)
            # 退台：上面再叠一截
            if h > 45 and rng.random() < 0.45:
                ins = 0.18
                q0 = Vector((p0[0], p0[1], 0)).lerp(Vector((p1[0], p1[1], 0)), ins) + Vector((out[0], out[1], 0)) * 4
                q1 = Vector((p0[0], p0[1], 0)).lerp(Vector((p1[0], p1[1], 0)), 1 - ins) + Vector((out[0], out[1], 0)) * 4
                self.box_building(q0, q1, out, st["depth"] - 10, h * rng.uniform(1.12, 1.4), h - 0.1, mi, rnd, st["crown"], rng)
            if signs:
                self._signs_for(track, s, ds, d, side, h, st, rng)
            s += ds + rng.uniform(*st["gap"])

    def _signs_for(self, track, s, ds, d, side, h, st, rng):
        sg = self.signs
        dw = d - side * 0.18
        # 店招：沿立面每隔一段放一块横牌
        if rng.random() < st["shop"]:
            x = s + 1.0
            while x < s + ds - 5:
                idx = sg.pick("horiz", rng)
                wd = min(rng.uniform(4.5, 7.5), s + ds - x - 0.8)
                if wd < 3:
                    break
                sg.facing(track, x + wd / 2, dw, rng.uniform(4.0, 4.6), wd, wd / sg.aspect(idx), idx, side)
                x += wd + rng.uniform(4.0, 14.0)
        # 竖招牌
        if st["blade"] > 0:
            x = s + rng.uniform(1.0, 5.0)
            while x < s + ds - 1:
                if rng.random() < st["blade"]:
                    idx = sg.pick("blade", rng)
                    hh = rng.uniform(4.0, 7.0)
                    z = rng.uniform(5.2, max(5.4, min(h - hh - 1, 15)))
                    sg.blade(track, x, d, z, hh / 4.0, hh, idx, side)
                if rng.random() < 0.10:
                    idx = sg.pick("square", rng)
                    sz = rng.uniform(1.6, 2.6)
                    sg.blade(track, x + 1.5, d, rng.uniform(5.5, 9.0), sz, sz, idx, side)
                x += rng.uniform(8.0, 16.0)
        # 大广告屏
        if h > 22 and ds > 14 and rng.random() < st["board"]:
            idx = sg.pick("board", rng)
            wd = min(ds - 3, rng.uniform(11, 20))
            hh = wd / sg.aspect(idx)
            z = rng.uniform(8.5, max(9.0, min(h - hh - 2, 26)))
            sg.facing(track, s + ds / 2, dw, z, wd, hh, idx, side)
            self.mbuf("sign_frame").box(track.xyz(s + ds / 2, dw + side * 0.08, z + hh / 2), (wd + 0.5, 0.2, hh + 0.5), yaw=track.heading(s + ds / 2))

    # ---- 路灯 ----
    def _lamp(self, kind):
        if kind in self.lamp_mesh:
            return self.lamp_mesh[kind], self.lamp_light[kind]
        P = {"cool": dict(h=9.0, arm=2.6, col=(1.0, 0.62, 0.32), w=14000.0),
             "warm": dict(h=7.0, arm=1.8, col=(1.0, 0.60, 0.30), w=6000.0),
             "bridge": dict(h=10.0, arm=3.0, col=(0.72, 0.88, 1.0), w=16000.0)}[kind]
        mb = MB()
        hgt, arm = P["h"], P["arm"]
        mb.cyl((0, 0, 0), (0, 0, hgt), 0.13, 8, r1=0.08)
        mb.cyl((0, 0, 0), (0, 0, 0.9), 0.2, 8, r1=0.16)
        mb.cyl((0, 0, hgt), (arm, 0, hgt + 0.35), 0.06, 6)
        mb.box((arm + 0.35, 0, hgt + 0.33), (1.0, 0.36, 0.12))
        mb.quad((arm - 0.1, -0.15, hgt + 0.265), (arm + 0.8, -0.15, hgt + 0.265), (arm + 0.8, 0.15, hgt + 0.265), (arm - 0.1, 0.15, hgt + 0.265), mi=1)
        em = mats.emit(f"lamp_emit_{kind}", P["col"], 40.0, sample=False)
        ob = mb.build(f"lampmesh_{kind}", [mats.flat("lamp_pole", (0.05, 0.055, 0.06), 0.45, 0.8), em], self.col)
        me = ob.data
        bpy.data.objects.remove(ob)
        ld = bpy.data.lights.new(f"lamp_{kind}", "SPOT")
        ld.energy = P["w"]; ld.color = P["col"]
        ld.spot_size = math.radians(128); ld.spot_blend = 0.7; ld.shadow_soft_size = 0.25
        self.lamp_mesh[kind] = (me, P); self.lamp_light[kind] = ld
        return self.lamp_mesh[kind], ld

    def lamp(self, track, s, d, side, kind="cool", light=True, dz=0.0):
        (me, P), ld = self._lamp(kind)
        x, y, z = track.xyz(s, d)
        z += dz(s) if callable(dz) else dz
        h = track.heading(s)
        ob = bpy.data.objects.new("lamp", me)
        self.col.objects.link(ob)
        ob.location = (x, y, z)
        yaw = h - side * math.pi / 2     # 灯臂指向道路中心
        ob.rotation_euler = (0, 0, yaw)
        if light:
            lo = bpy.data.objects.new("lampL", ld)
            self.col.objects.link(lo)
            ax = P["arm"] + 0.35
            lo.location = (x + ax * math.cos(yaw), y + ax * math.sin(yaw), z + P["h"] + 0.2)
        return ob

    def lamps(self, track, s0, s1, side, d, spacing, kind="cool", gaps=(), phase=0.0, light_every=1, dz=0.0, alt=None):
        s = s0 + phase
        i = 0
        while s < s1:
            if not in_gaps(s - 1, s + 1, gaps):
                self.lamp(track, s, side * d, side, alt if (alt and i % 3 == 2) else kind, light=(i % light_every == 0), dz=dz)
                i += 1
            s += spacing

    # ---- 收尾 ----
    def finish(self):
        self.bld.build("buildings", self.bslots, self.col)
        self.led.build("bld_leds", [mats.emit(f"led_{i}", c, 4.0, sample=False) for i, c in enumerate(LED_COLS)], self.col)
        self.signs.build()
        for mname, mb in self.misc.items():
            if mb.f:
                mb.build(f"misc_{mname}", [mats.get(mname)], self.col)
        print(f"@@ buildings={self.n_bld} sign_quads={len(self.signs.mb.f)} sign_mats={len(self.signs.slots)}")
