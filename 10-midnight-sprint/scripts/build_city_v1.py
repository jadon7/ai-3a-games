"""生成整条赛道的城市场景 → blend/city.blend
blender -b --factory-startup -P build_city.py
"""
import bpy, sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import mats
from track import *
from citygen import *

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
T = main_track()
city = City()
col = city.col
rng = random.Random(11)
PI = math.pi

AVE = Track([("line", 1000)], origin=(-160, 0), heading=0)            # 大道：x = s - 160
STR = Track([("line", 640)], origin=(592, 280), heading=-PI / 2)      # 南北街：y = 280 - s
AVE_X = lambda x: x + 160
STR_Y = lambda y: 280 - y

# ---------------- 路面 ----------------
m_plain = mats.wet_asphalt("asphalt_plain")
m_A = mats.wet_asphalt("asphalt_A", lanes=dict(lw=3.6, n=2, center="double"))
m_B = mats.wet_asphalt("asphalt_B", lanes=dict(lw=3.3, n=2, center="double"), puddle=0.4)
m_C = mats.wet_asphalt("asphalt_C", lanes=dict(lw=3.5, n=2, center="double"), puddle=0.34)
m_T = mats.wet_asphalt("asphalt_T", lanes=dict(lw=3.5, n=2, center="double"), puddle=0.12, wet=0.35)
m_D = mats.wet_asphalt("asphalt_D", lanes=dict(lw=3.6, n=3, center="double"), puddle=0.36)


def road(track, s0, s1, mat, name, hw=None, zoff=0.0, step=2.0):
    f = (lambda s: [(hw, 0.0), (-hw, 0.0)]) if hw else (lambda s: [(half_width(s), 0.0), (-half_width(s), 0.0)])
    return sweep(track, s0, s1, f, name, [mat], col, step=step, uv="lateral", zoff=zoff)


road(T, -160, S_A1, m_A, "road_A", step=4)
road(T, S_A1, S_C1, m_plain, "road_corner", step=1.0)
road(T, S_C1, S_B1, m_B, "road_B", step=4)
road(T, S_B1, RAMP_IN[0] + 60, m_C, "road_curve", step=2)
road(T, RAMP_IN[0] + 60, RAMP_OUT[1] - 60, m_T, "road_tunnel", step=2)
road(T, RAMP_OUT[1] - 60, S_T1 - 30, m_C, "road_exit", step=2)
road(T, S_T1 - 30, S_END + 260, m_D, "road_D", step=4)
# 路口垫片和延伸段（略低，避免和主路面重叠闪烁）
mb = MB()
mb.quad((556, -9.6, -0.012), (604, -9.6, -0.012), (604, 9.6, -0.012), (556, 9.6, -0.012))
mb.quad((585, -36, -0.02), (599, -36, -0.02), (599, -9.6, -0.02), (585, -9.6, -0.02))
mb.build("road_pads", [m_plain], col)
road(AVE, AVE_X(604), 1000, m_A, "road_AVE_ext", hw=9.6, zoff=-0.012, step=6)
road(STR, 0, STR_Y(9.6), m_B, "road_STR_ext", hw=7.0, zoff=-0.012, step=6)


# ---------------- 人行道 ----------------
def sidewalk(track, s0, s1, side, c_fn, w_fn, gaps=(), name="sw", step=3.0):
    cuts = sorted(g for g in gaps if g[1] > s0 and g[0] < s1)
    spans = []
    a = s0
    for g0, g1 in cuts:
        if g0 > a:
            spans.append((a, g0))
        a = max(a, g1)
    if a < s1:
        spans.append((a, s1))
    for i, (a, b) in enumerate(spans):
        if side > 0:
            prof = lambda s: [(c_fn(s) + w_fn(s), 0.15), (c_fn(s), 0.15), (c_fn(s), 0.0)]
            mi = lambda j: (0, 1)[j]
        else:
            prof = lambda s: [(-c_fn(s), 0.0), (-c_fn(s), 0.15), (-(c_fn(s) + w_fn(s)), 0.15)]
            mi = lambda j: (1, 0)[j]
        sweep(track, a, b, prof, f"{name}_{i}", [mats.get("sidewalk"), mats.get("curb")], col, step=step, mi_fn=mi)


CROSS_A = [200.0, 400.0]
CROSS_B = [S_C1 + 165.0]
gapsA = [(c - 9, c + 9) for c in CROSS_A]
gapsB = [(c - 7.5, c + 7.5) for c in CROSS_B]


def w_right(s):
    """右侧人行道宽度：大道 5，弯内侧放宽成小广场，霓虹街 3.5。"""
    if s < S_A1 - 20:
        return 5.0
    if s < S_C1 + 20:
        t = smooth(S_A1 - 20, (S_A1 + S_C1) / 2, s) - smooth((S_A1 + S_C1) / 2, S_C1 + 20, s)
        base = 5.0 + (3.5 - 5.0) * smooth(S_A1 - 20, S_C1 + 20, s)
        return base + 11.0 * t
    return 3.5


def w_left(s):
    return 5.0 if s < S_A1 + 5 else 3.5


SW_END = RAMP_IN[0] + 2
sidewalk(T, -160, SW_END, -1, half_width, w_right, gapsA + gapsB, "sw_R")
sidewalk(T, -160, 558, +1, half_width, w_left, gapsA, "sw_L_A")
sidewalk(T, S_C1, SW_END, +1, half_width, w_left, gapsB, "sw_L_B")
c96 = lambda s: 9.6
c70 = lambda s: 7.0
w50 = lambda s: 5.0
w35 = lambda s: 3.5
sidewalk(AVE, AVE_X(558), AVE_X(585), +1, c96, w50, name="sw_ave_nw")
sidewalk(AVE, AVE_X(599), 1000, +1, c96, w50, name="sw_ave_ne")
sidewalk(AVE, AVE_X(599), 1000, -1, c96, w50, name="sw_ave_se")
sidewalk(STR, 0, STR_Y(14.6), -1, c70, w35, name="sw_str_nw")
sidewalk(STR, 0, STR_Y(14.6), +1, c70, w35, name="sw_str_ne")
sidewalk(STR, STR_Y(-14.6), STR_Y(-32), +1, c70, w35, name="sw_str_se")

# ---------------- 楼群 ----------------
city.buildings(T, -160, 548, -1, 14.6, "tower", rng, gapsA)
city.buildings(T, -160, 576, +1, 14.6, "tower", rng, gapsA)
city.buildings(T, S_C1 + 16, S_B1, -1, 10.5, "shop", rng, gapsB)
city.buildings(T, S_C1 + 12, S_B1, +1, 10.5, "shop", rng, gapsB)
city.buildings(AVE, AVE_X(603), 1000, +1, 14.6, "tower", rng)
city.buildings(AVE, AVE_X(603), 1000, -1, 14.6, "tower", rng)
city.buildings(STR, 0, STR_Y(50), -1, 10.5, "mid", rng)
city.buildings(STR, 0, STR_Y(50), +1, 10.5, "mid", rng)
city.buildings(T, S_B1, S_V1 + 12, -1, 11.1, "mid", rng)
city.buildings(T, S_B1, S_V1 + 12, +1, 11.1, "mid", rng)
city.buildings(T, S_V1 + 12, S_T1 + 30, -1, 22.0, "tower", rng, signs=False)
city.buildings(T, S_V1 + 12, S_T1 + 30, +1, 22.0, "tower", rng, signs=False)


# ---------------- 横街 ----------------
def cross_street(main, s_c, side, main_hw, main_sw, length=190.0, half=5.5, style="mid", lamp_kind="cool"):
    ox, oy, _ = main.xyz(s_c, side * main_hw)
    h = main.heading(s_c) + side * PI / 2
    ct = Track([("line", length)], origin=(ox, oy), heading=h)
    road(ct, -1.0, length, m_plain, "road_cross", hw=half, zoff=-0.012, step=10)
    cc = lambda s: half
    sidewalk(ct, 0, length, +1, cc, w35, name="sw_cross")
    sidewalk(ct, 0, length, -1, cc, w35, name="sw_cross")
    start = main_sw + 36
    r2 = random.Random(int(s_c * 7 + side * 3))
    city.buildings(ct, start, length, +1, half + 3.5, style, r2)
    city.buildings(ct, start, length, -1, half + 3.5, style, r2)
    # 尽头挡一栋高楼，免得看穿到天边
    e = ct.xyz(length + 4, 0)
    hh = ct.heading(length)
    p0 = ct.xyz(length + 4, 34); p1 = ct.xyz(length + 4, -34)
    city.box_building(p0, p1, (math.cos(hh), math.sin(hh)), 30, r2.uniform(70, 150), -0.5, city._slot("ft_008"), (r2.random(), r2.random()), 1.0, r2)
    city.lamps(ct, 30, length, +1, half + 0.8, 44, lamp_kind)
    # 封路挡板（红白水马）
    mbr, mbw = city.mbuf("barrier_red"), city.mbuf("barrier_white")
    n = int((2 * half + 4) / 2.1)
    for i in range(n):
        s = s_c - (n - 1) * 1.05 + i * 2.1
        p = main.xyz(s, side * (main_hw + 0.55), 0.42)
        (mbr if i % 2 == 0 else mbw).box(p, (1.9, 0.5, 0.84), yaw=main.heading(s))
    return ct


for c in CROSS_A:
    cross_street(T, c, +1, 9.6, 5.0)
    cross_street(T, c, -1, 9.6, 5.0)
for c in CROSS_B:
    cross_street(T, c, +1, 7.0, 3.5, half=4.0, style="shop", lamp_kind="warm")
    cross_street(T, c, -1, 7.0, 3.5, half=4.0, style="shop", lamp_kind="warm")

# ---------------- 路灯 ----------------
hwA = lambda s: half_width(s) + 0.9
city.lamps(T, -150, 550, +1, 10.5, 38, "cool", gapsA, phase=0)
city.lamps(T, -150, 550, -1, 10.5, 38, "cool", gapsA, phase=19)
city.lamps(T, S_C1 + 8, S_B1, +1, 7.8, 27, "warm", gapsB, phase=0)
city.lamps(T, S_C1 + 8, S_B1, -1, 7.8, 27, "warm", gapsB, phase=13)
city.lamps(T, S_B1 + 5, RAMP_IN[0], +1, 8.4, 30, "cool", phase=0)
city.lamps(T, S_B1 + 5, RAMP_IN[0], -1, 8.4, 30, "cool", phase=15)
city.lamps(AVE, AVE_X(612), 1000, +1, 10.5, 44, "cool")
city.lamps(AVE, AVE_X(612), 1000, -1, 10.5, 44, "cool", phase=22)
city.lamps(STR, 20, STR_Y(24), +1, 7.8, 40, "warm")
city.lamps(STR, 20, STR_Y(24), -1, 7.8, 40, "warm", phase=20)
# 坡道两侧挡墙顶上的路灯
wall_top = lambda s: 1.1 - zprofile(s)
for a_, b_ in ((RAMP_IN[0] + 6, TUN_COVER[0] - 6), (TUN_COVER[1] + 8, S_T1 + 44)):
    city.lamps(T, a_, b_, +1, 8.4, 26, "cool", phase=0, dz=wall_top)
    city.lamps(T, a_, b_, -1, 8.4, 26, "cool", phase=13, dz=wall_top)
BR0 = S_T1 + 50
city.lamps(T, BR0, S_END + 200, +1, 12.3, 36, "bridge", phase=0)
city.lamps(T, BR0, S_END + 200, -1, 12.3, 36, "bridge", phase=18)


# ---------------- 弯道外侧的流动箭头墙 ----------------
def chevron_wall(s0, s1, side, off, matname, tex, spacing=5.0, width=4.6):
    mbc = MB()
    mbr, mbw = city.mbuf("barrier_red"), city.mbuf("barrier_white")
    s = s0
    i = 0
    while s < s1:
        d = side * (half_width(s) + off)
        k = T.pose(s)[4]
        ds = spacing / max(0.4, 1 - k * d)
        a = T.xyz(s - 0 + 0.2 * ds / spacing, d, 0.62); b = T.xyz(s + ds * (width / spacing), d, 0.62)
        a2 = (a[0], a[1], a[2] + 1.5); b2 = (b[0], b[1], b[2] + 1.5)
        u0, u1 = (0, 1) if side > 0 else (1, 0)
        if side > 0:
            mbc.quad(a, b, b2, a2, ((u0, 0), (u1, 0), (u1, 1), (u0, 1)))
        else:
            mbc.quad(b, a, a2, b2, ((0, 0), (1, 0), (1, 1), (0, 1)))
        mid = T.xyz(s + ds * 0.5 * width / spacing, d + side * 0.3, 0.31)
        (mbr if i % 2 == 0 else mbw).box(mid, (width, 0.6, 0.62), yaw=T.heading(s + ds * 0.5))
        city.mbuf("sign_frame").box(T.xyz(s + ds * 0.5 * width / spacing, d + side * 0.07, 1.37), (width + 0.1, 0.1, 1.6), yaw=T.heading(s + ds * 0.5))
        s += ds
        i += 1
    mbc.build("chevrons_" + matname, [mats.chevron(matname, tex)], col)


chevron_wall(S_A1 - 22, S_C1 + 14, +1, 1.6, "chev_orange", "chevron_r.png")
chevron_wall(S_B1 + 10, S_V1 - 10, -1, 0.5, "chev_cyan", "chevron_c.png", spacing=9.0, width=4.2)

# ---------------- 弯心的 LED 广告塔 ----------------
sg = city.signs
cx, cy = 560.0 + 3.0, -32.0 + 3.0
tw, th = 9.0, 5.06
for lvl in range(3):
    z = 4.0 + lvl * (th + 0.5)
    for k, (dx, dy) in enumerate(((0, 1), (1, 0), (0, -1), (-1, 0))):
        idx = sg.by_kind["board"][(lvl * 4 + k) % len(sg.by_kind["board"])]
        mi = sg.slot(idx)
        c = Vector((cx + dx * tw / 2, cy + dy * tw / 2, z))
        t = Vector((-dy, dx, 0)) * (tw / 2)
        sg.mb.quad(c + t, c - t, c - t + Vector((0, 0, th)), c + t + Vector((0, 0, th)), mi=mi)
city.mbuf("sign_frame").box((cx, cy, 11.0), (tw - 0.3, tw - 0.3, 22.0))
for dx in (-1, 1):
    for dy in (-1, 1):
        city.led.box((cx + dx * tw / 2, cy + dy * tw / 2, 12.5), (0.25, 0.25, 19.0), mi=0)


# ---------------- 龙门架：起点 / 终点 / 路牌 ----------------
def gantry(s, banner=None, signs_idx=None, height=7.2, name="gantry"):
    hw = half_width(s)
    hd = T.heading(s)
    mbm = city.mbuf("metal_dark")
    for side in (1, -1):
        p = T.xyz(s, side * (hw + 1.0))
        mbm.box((p[0], p[1], p[2] + (height + 2.0) / 2), (0.7, 0.7, height + 2.0), yaw=hd)
    c = T.xyz(s, 0)
    span = 2 * (hw + 1.0)
    mbm.box((c[0], c[1], c[2] + height + 1.0), (0.6, span, 2.0), yaw=hd)
    if banner is not None:
        idx = next(i for i, m in enumerate(sg.man) if m["file"] == banner)
        w = span - 1.2
        hh = w / sg.aspect(idx)
        sg.facing(T, s, 0.0, 0.0, 0.0, 0.0, idx, 1) if False else None
        mi = sg.slot(idx)
        for off, order in ((-0.36, 1), (0.36, -1)):
            a = T.xyz(s + off, order * w / 2, height + 1.0 - hh / 2); b = T.xyz(s + off, -order * w / 2, height + 1.0 - hh / 2)
            sg.mb.quad(a, b, (b[0], b[1], b[2] + hh), (a[0], a[1], a[2] + hh), mi=mi)
        # 横梁下面一排射灯的发光片
        for i in range(8):
            d = -w / 2 + (i + 0.5) * w / 8
            p = T.xyz(s, d, height - 0.06)
            city.mbuf("emit_white").box(p, (0.5, 0.9, 0.06), yaw=hd)
    if signs_idx:
        n = len(signs_idx)
        for i, name_ in enumerate(signs_idx):
            idx = next(j for j, m in enumerate(sg.man) if m["file"] == name_)
            w = 6.2; hh = w / sg.aspect(idx)
            d = (i - (n - 1) / 2) * 7.0
            a = T.xyz(s - 0.36, d + w / 2, height + 1.0 - hh / 2); b = T.xyz(s - 0.36, d - w / 2, height + 1.0 - hh / 2)
            sg.mb.quad(a, b, (b[0], b[1], b[2] + hh), (a[0], a[1], a[2] + hh), mi=sg.slot(idx))


mats._cache["emit_white"] = mats.emit("emit_white", (0.9, 0.95, 1.0), 30.0, sample=True)
gantry(START_S + 9.0, banner="banner_start.png")
gantry(FINISH_S, banner="banner_finish.png", height=7.6)
gantry(300.0, signs_idx=["roadsign_00.png", "roadsign_02.png"])
gantry(S_B1 + 60.0, signs_idx=["roadsign_03.png", "roadsign_01.png"])
gantry(S_T1 + 70.0, signs_idx=["roadsign_01.png", "roadsign_04.png", "roadsign_00.png"])


# ---------------- 红绿灯 ----------------
def traffic_light(track, s, side, hw, reach=6.5):
    hd = track.heading(s)
    mbm = city.mbuf("metal_dark")
    p = track.xyz(s, side * (hw + 0.7))
    mbm.cyl((p[0], p[1], p[2]), (p[0], p[1], p[2] + 6.6), 0.14, 8, r1=0.1)
    q = track.xyz(s, side * (hw - reach), 6.4)
    mbm.cyl((p[0], p[1], p[2] + 6.4), q, 0.07, 6)
    for f in (0.45, 0.95):
        c = track.xyz(s, side * (hw + 0.7 - (reach + 0.7) * f), 6.0)
        mbm.box(c, (0.32, 0.36, 1.05), yaw=hd)
        for k, (mname, zz) in enumerate((("tl_red_off", 0.33), ("tl_yel_off", 0.0), ("tl_green", -0.33))):
            e = track.xyz(s - 0.17, side * (hw + 0.7 - (reach + 0.7) * f), 6.0 + zz)
            city.mbuf(mname).box(e, (0.02, 0.24, 0.24), yaw=hd)


mats._cache["tl_red_off"] = mats.flat("tl_red_off", (0.08, 0.01, 0.01), 0.3)
mats._cache["tl_yel_off"] = mats.flat("tl_yel_off", (0.08, 0.06, 0.01), 0.3)
mats._cache["tl_green"] = mats.emit("tl_green", (0.1, 1.0, 0.45), 40.0, sample=False)
for c in CROSS_A:
    traffic_light(T, c - 10.5, -1, 9.6)
    traffic_light(T, c - 10.5, +1, 9.6)
traffic_light(T, S_A1 - 4, -1, 9.6)
for c in CROSS_B:
    traffic_light(T, c - 9, -1, 7.0, reach=5.0)
    traffic_light(T, c - 9, +1, 7.0, reach=5.0)

# ---------------- 斑马线和起跑格 ----------------
mbz = MB()


def zebra(s_c, hw, length=3.2):
    d = -hw + 0.6
    while d < hw - 0.9:
        a = T.xyz(s_c - length / 2, d + 0.5, 0.004); b = T.xyz(s_c - length / 2, d, 0.004)
        c2 = T.xyz(s_c + length / 2, d, 0.004); e = T.xyz(s_c + length / 2, d + 0.5, 0.004)
        mbz.quad(a, b, c2, e)
        d += 1.1


for c in CROSS_A:
    zebra(c - 12.5, 9.6); zebra(c + 12.5, 9.6)
for c in CROSS_B:
    zebra(c - 10.5, 7.0); zebra(c + 10.5, 7.0)
zebra(S_A1 - 6, 9.6)
# 起跑线：两排黑白格
for row in range(2):
    d = -7.2
    i = 0
    while d < 7.2 - 0.01:
        if (i + row) % 2 == 0:
            s0 = START_S + 7.0 + row * 0.6
            a = T.xyz(s0, d + 0.6, 0.004); b = T.xyz(s0, d, 0.004); c2 = T.xyz(s0 + 0.6, d, 0.004); e = T.xyz(s0 + 0.6, d + 0.6, 0.004)
            mbz.quad(a, b, c2, e)
        d += 0.6; i += 1
# 终点线
for row in range(3):
    d = -10.8
    i = 0
    while d < 10.8 - 0.01:
        if (i + row) % 2 == 0:
            s0 = FINISH_S - 0.9 + row * 0.6
            a = T.xyz(s0, d + 0.6, 0.004); b = T.xyz(s0, d, 0.004); c2 = T.xyz(s0 + 0.6, d, 0.004); e = T.xyz(s0 + 0.6, d + 0.6, 0.004)
            mbz.quad(a, b, c2, e)
        d += 0.6; i += 1
mbz.build("road_paint", [mats.get("paint_white")], col)

# ---------------- 霓虹街上空的串灯 ----------------
mats._cache["bulb_warm"] = mats.emit("bulb_warm", (1.0, 0.62, 0.25), 30.0, sample=False)
mats._cache["bulb_pink"] = mats.emit("bulb_pink", (1.0, 0.2, 0.5), 30.0, sample=False)
mats._cache["bulb_cyan"] = mats.emit("bulb_cyan", (0.2, 0.9, 1.0), 30.0, sample=False)
s = S_C1 + 22
i = 0
while s < S_B1 - 10:
    if not in_gaps(s - 1, s + 1, gapsB):
        zs = rng.uniform(8.5, 11.0)
        skew = rng.uniform(-5, 5)
        mname = ("bulb_warm", "bulb_pink", "bulb_warm", "bulb_cyan")[i % 4]
        nb = 17
        prev = None
        for k in range(nb + 1):
            t = k / nb
            d = -10.3 + 20.6 * t
            z = zs - 4 * 1.6 * t * (1 - t)
            p = T.xyz(s + skew * (t - 0.5), d, z)
            if 0 < k < nb:
                city.mbuf(mname).box(p, (0.2, 0.2, 0.26))
            if prev:
                city.mbuf("metal_dark").cyl(prev, p, 0.012, 3)
            prev = p
    s += rng.uniform(14, 22)
    i += 1

# ---------------- 下穿隧道 ----------------
TH = 5.6
hwt = 7.6
zr = zprofile
m_tile, m_tdark, m_conc = mats.get("tunnel_tile"), mats.get("tunnel_dark"), mats.get("concrete")
c0, c1 = TUN_COVER
sweep(T, c0, c1, lambda s: [(hwt + 0.6, TH), (hwt + 0.6, 0.35), (hwt, 0.35), (hwt, 0.0)], "tun_wall_L", [m_tile, m_tdark], col, mi_fn=lambda j: (0, 1, 1)[j])
sweep(T, c0, c1, lambda s: [(-hwt, 0.0), (-hwt, 0.35), (-(hwt + 0.6), 0.35), (-(hwt + 0.6), TH)], "tun_wall_R", [m_tile, m_tdark], col, mi_fn=lambda j: (1, 1, 0)[j])
sweep(T, c0, c1, lambda s: [(-(hwt + 0.6), TH), (hwt + 0.6, TH)], "tun_ceiling", [m_tdark], col)
mats._cache["tun_strip"] = mats.emit("tun_strip", (1.0, 0.56, 0.2), 22.0, sample=True)
mats._cache["tun_accent"] = mats.emit("tun_accent", (0.15, 0.85, 1.0), 10.0, sample=False)
mats._cache["tun_panel"] = mats.emit("tun_panel", (1.0, 0.8, 0.55), 55.0, sample=True)
for side in (1, -1):
    d = side * (hwt + 0.56)
    pr = (lambda s, d=d: [(d, 4.75), (d, 4.55)]) if side > 0 else (lambda s, d=d: [(d, 4.55), (d, 4.75)])
    sweep(T, c0 + 2, c1 - 2, pr, "tun_strip", [mats._cache["tun_strip"]], col, step=4)
    pr2 = (lambda s, d=d: [(d, 1.16), (d, 1.08)]) if side > 0 else (lambda s, d=d: [(d, 1.08), (d, 1.16)])
    sweep(T, c0 + 2, c1 - 2, pr2, "tun_accent", [mats._cache["tun_accent"]], col, step=4)
s = c0 + 5
while s < c1 - 3:
    for d in (-3.7, 3.7):
        city.mbuf("tun_panel").box(T.xyz(s, d, TH - 0.05), (2.2, 0.6, 0.08), yaw=T.heading(s))
    s += 8.0

# 敞开段挡墙（墙顶绝对高度 +1.1）
TOP = 1.1


def wall_prof(side):
    if side > 0:
        return lambda s: [(hwt + 1.0, TOP - zr(s)), (hwt + 0.6, TOP - zr(s)), (hwt + 0.6, 0.35), (hwt, 0.35), (hwt, 0.0)]
    return lambda s: [(-hwt, 0.0), (-hwt, 0.35), (-(hwt + 0.6), 0.35), (-(hwt + 0.6), TOP - zr(s)), (-(hwt + 1.0), TOP - zr(s))]


mats._cache["ramp_led"] = mats.emit("ramp_led", (0.15, 0.85, 1.0), 14.0, sample=False)
for a, b, nm in ((RAMP_IN[0] - 2, c0, "in"), (c1, RAMP_OUT[1] + 2, "out")):
    for side in (1, -1):
        sweep(T, a, b, wall_prof(side), f"ramp_wall_{nm}", [m_conc], col)
        d = side * (hwt + 0.57)
        pr = (lambda s, d=d: [(d, TOP - zr(s) - 0.18), (d, TOP - zr(s) - 0.30)]) if side > 0 else (lambda s, d=d: [(d, TOP - zr(s) - 0.30), (d, TOP - zr(s) - 0.18)])
        sweep(T, a, b, pr, f"ramp_led_{nm}", [mats._cache["ramp_led"]], col)
        # 墙外侧也封一下
        od = side * (hwt + 1.0)
        pr3 = (lambda s, od=od: [(od, -0.2 - zr(s)), (od, TOP - zr(s))]) if side > 0 else (lambda s, od=od: [(od, TOP - zr(s)), (od, -0.2 - zr(s))])
        sweep(T, a, b, pr3, f"ramp_wall_out_{nm}", [m_conc], col)
# 洞口门脸
mbp = MB()
for sp, sgn in ((c0, -1), (c1, 1)):
    zt = zr(sp) + TH
    L_ = T.xyz(sp, hwt + 1.0, 0); R_ = T.xyz(sp, -(hwt + 1.0), 0)
    a, b = (L_, R_) if sgn < 0 else (R_, L_)
    mbp.quad((a[0], a[1], zt), (b[0], b[1], zt), (b[0], b[1], 1.7), (a[0], a[1], 1.7), ((0, 0), (17, 0), (17, 2.5), (0, 2.5)))
mbp.build("tun_portal", [m_conc], col)
idx = next(i for i, m in enumerate(sg.man) if m["file"] == "tunnel_name.png")
w = 12.0; hh = w / sg.aspect(idx)
a = T.xyz(c0 - 0.06, w / 2, 0); b = T.xyz(c0 - 0.06, -w / 2, 0)
zc = (zr(c0) + TH + 1.7) / 2
sg.mb.quad((a[0], a[1], zc - hh / 2), (b[0], b[1], zc - hh / 2), (b[0], b[1], zc + hh / 2), (a[0], a[1], zc + hh / 2), mi=sg.slot(idx))
# 隧道顶盖（地面广场）
sweep(T, c0, c1, lambda s: [(hwt + 1.0, 0.0), (-(hwt + 1.0), 0.0)], "tun_lid", [mats.get("sidewalk")], col, step=20, absz=True)

# ---------------- 地面 ----------------
mats._cache["ground"] = mats.textured("ground", "concrete_tiles_02", scale=0.3, coat=0.3, tint=0.35)
mbg = MB()


def gquad(x0, x1, y0, y1, z=-0.03):
    mbg.quad((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))


tx0 = T.pose(RAMP_IN[0] - 2)[0]; tx1 = T.pose(RAMP_OUT[1] + 2)[0]
ty = -492.0
SHORE = T.pose(S_T1)[0] + 48.0
gquad(-460, tx0, -820, 460)
gquad(tx0, tx1, ty + hwt + 1.0, 460)
gquad(tx0, tx1, -820, ty - hwt - 1.0)
gquad(tx1, SHORE, -820, 460)
mbg.build("ground", [mats._cache["ground"]], col)
mbw = MB()
mbw.quad((SHORE - 60, -3200, -15), (4200, -3200, -15), (4200, 2400, -15), (SHORE - 60, 2400, -15))
mbw.build("water", [mats.get("water")], col)
mbs = MB()
mbs.quad((SHORE, 460, -15), (SHORE, -820, -15), (SHORE, -820, -0.03), (SHORE, 460, -0.03), ((0, 0), (1280, 0), (1280, 15), (0, 15)))
mbs.build("seawall", [m_conc], col)

# ---------------- 大桥 ----------------
hwb = 11.2
BRS, BRE = S_T1 + 40, S_END + 260
m_bconc = mats.get("concrete")
sweep(T, BRS, BRE, lambda s: [(hwb + 3.2, -1.6), (hwb + 3.2, 0.2), (hwb + 0.5, 0.2), (hwb + 0.5, 0.85), (hwb + 0.3, 0.85), (hwb, 0.0)], "bridge_side_L", [m_bconc], col, step=8)
sweep(T, BRS, BRE, lambda s: [(-hwb, 0.0), (-(hwb + 0.3), 0.85), (-(hwb + 0.5), 0.85), (-(hwb + 0.5), 0.2), (-(hwb + 3.2), 0.2), (-(hwb + 3.2), -1.6)], "bridge_side_R", [m_bconc], col, step=8)
sweep(T, SHORE - 2, BRE, lambda s: [(-(hwb + 3.2), -1.6), (hwb + 3.2, -1.6)], "bridge_under", [m_bconc], col, step=40)
mats._cache["rail_led"] = mats.emit("rail_led", (1.0, 0.15, 0.55), 12.0, sample=False)
mats._cache["rail_led2"] = mats.emit("rail_led2", (0.15, 0.85, 1.0), 12.0, sample=False)
for side in (1, -1):
    d = side * (hwb + 3.05)
    pr = (lambda s, d=d: [(d, 1.36), (d, 1.26)]) if side > 0 else (lambda s, d=d: [(d, 1.26), (d, 1.36)])
    sweep(T, BRS, BRE, pr, "rail", [mats.get("metal_light")], col, step=8)
    pr2 = (lambda s, d=d: [(d, 1.24), (d, 1.16)]) if side > 0 else (lambda s, d=d: [(d, 1.16), (d, 1.24)])
    sweep(T, BRS, BRE, pr2, "rail_led", [mats._cache["rail_led" if side > 0 else "rail_led2"]], col, step=8)
    s = BRS
    while s < BRE:
        city.mbuf("metal_light").box(T.xyz(s, d, 0.2 + 0.55), (0.08, 0.08, 1.1), yaw=0)
        s += 3.0
# 桥塔和拉索
mats._cache["cable"] = mats.emit("cable", (0.75, 0.85, 1.0), 0.9, sample=False)
mats._cache["pylon_led"] = mats.emit("pylon_led", (0.15, 0.85, 1.0), 6.0, sample=False)
mats._cache["pylon_led2"] = mats.emit("pylon_led2", (1.0, 0.15, 0.55), 6.0, sample=False)
PYLONS = [S_T1 + 150.0, S_T1 + 340.0, S_T1 + 530.0]
for pi_, sp in enumerate(PYLONS):
    led = "pylon_led" if pi_ % 2 == 0 else "pylon_led2"
    for side in (1, -1):
        d = side * (hwb + 5.2)
        p = T.xyz(sp, d)
        city.mbuf("concrete").box((p[0], p[1], 32.0), (3.4, 2.6, 94.0))
        for e in (-1.76, 1.76):
            q = T.xyz(sp + e, d)
            city.mbuf(led).box((q[0], q[1], 40.0), (0.08, 0.22, 74.0))
        q = T.xyz(sp, d - side * 1.36)
        city.mbuf(led).box((q[0], q[1], 40.0), (0.22, 0.08, 74.0))
        for dirn in (1, -1):
            for k in range(1, 8):
                top = T.xyz(sp + dirn * 1.0, d - side * 0.6, 79.0 - (k - 1) * 6.0)
                bot = T.xyz(sp + dirn * k * 13.0, side * (hwb + 3.3), 1.3)
                city.mbuf("cable").cyl(top, bot, 0.085, 4)
    c = T.xyz(sp, 0)
    city.mbuf("concrete").box((c[0], c[1], 76.0), (3.0, 2 * (hwb + 5.2), 4.0))
    city.mbuf("concrete").box((c[0], c[1], 24.0), (2.4, 2 * (hwb + 5.2), 2.6))
    city.mbuf(led).box((c[0] - 1.25, c[1], 22.8), (0.08, 2 * hwb, 0.3))

# ---------------- 远处天际线 ----------------
r3 = random.Random(5)


import numpy as np
_pts = [T.pose(s_)[:2] for s_ in np.arange(-220, S_END + 320, 8.0)]
_pts += [AVE.pose(s_)[:2] for s_ in np.arange(0, 1000, 8.0)] + [STR.pose(s_)[:2] for s_ in np.arange(0, 640, 8.0)]
_pts = np.array(_pts)
n_far = [0, 0]


def far_tower(x, y, w, d, h, yaw=0.0):
    """远景楼：离任何一条路的中线太近就不放，避免挡在赛道上。"""
    dist = float(np.min(np.hypot(_pts[:, 0] - x, _pts[:, 1] - y)))
    if dist < max(w, d) + 58.0:
        n_far[1] += 1
        return
    n_far[0] += 1
    hd = yaw
    t = Vector((math.cos(hd), math.sin(hd), 0)) * (w / 2)
    p0 = Vector((x, y, 0)) - t; p1 = Vector((x, y, 0)) + t
    out = (-math.sin(hd), math.cos(hd))
    mi = city._slot(r3.choice(["ft_007", "ft_008", "ft_010", "ft_011", "ft_012", "ft_015"]))
    city.box_building(p0, p1, out, d, h, -16.0, mi, (r3.random(), r3.random()), 0.3, r3)


ex = T.pose(S_END)[0]
for i in range(90):       # 桥对岸的终点城区
    x = r3.uniform(ex + 280, ex + 1100); y = ty + r3.uniform(-900, 900)
    if abs(y - ty) < 60:
        continue
    far_tower(x, y, r3.uniform(30, 60), r3.uniform(30, 50), r3.uniform(70, 300) * (1.25 if abs(y - ty) < 300 else 1.0), yaw=-PI / 2)
for i in range(70):       # 两岸
    x = r3.uniform(SHORE + 80, ex + 400)
    for sgn in (1, -1):
        y = ty + sgn * r3.uniform(520, 1100)
        far_tower(x, y, r3.uniform(30, 70), r3.uniform(30, 50), r3.uniform(50, 220), yaw=0 if sgn < 0 else PI)
for i in range(110):      # 西岸：片尾回头看时的背景
    x = r3.uniform(SHORE - 520, SHORE - 60); y = ty + r3.uniform(-1300, 1300)
    if abs(y - ty) < 60:
        continue
    far_tower(x, y, r3.uniform(30, 60), r3.uniform(30, 50), r3.uniform(70, 260), yaw=PI / 2)
for i in range(60):       # 起点背后和外圈
    a = r3.uniform(0, 2 * PI); rr = r3.uniform(520, 900)
    x = 300 + rr * math.cos(a); y = -200 + rr * math.sin(a)
    if x > SHORE - 100:
        continue
    far_tower(x, y, r3.uniform(30, 60), r3.uniform(30, 50), r3.uniform(80, 260), yaw=a + PI / 2)

# ---------------- 收尾 ----------------
print("@@ far towers placed/skipped", n_far)
city.finish()
mats.setup_world(sc, strength=0.28, rot_deg=0.0)
sc["track_len"] = T.length
bpy.ops.file.pack_all()
out = os.path.join(ROOT, "blend", "city.blend")
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print("@@ saved", out, "objects", len(bpy.data.objects), "lights", len([o for o in bpy.data.objects if o.type == "LIGHT"]))
