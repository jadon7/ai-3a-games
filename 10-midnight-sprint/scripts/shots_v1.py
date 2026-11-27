"""生成整段比赛：车辆动画、相机、特效 → blend/race.blend + out/telemetry.json
blender -b --factory-startup -P shots.py
"""
import bpy, sys, os, math, json, random
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shotlib import *
import mats
from mathutils import Vector, Euler, Quaternion

FPS = 30
INTRO = 135                # 片头帧数，之后一帧发车
F_GO = INTRO + 1
rng = random.Random(3)
sc = open_city()
sc.render.fps = FPS
D2R = math.pi / 180


# =============== 关键帧工具 ===============
def fcurve(idb, path, index, frames, values, interp=1):
    ad = idb.animation_data or idb.animation_data_create()
    if ad.action is None:
        ad.action = bpy.data.actions.new(idb.name + "_A")
    fc = ad.action.fcurve_ensure_for_datablock(idb, path, index=index)
    n = len(frames)
    if len(fc.keyframe_points) < n:
        fc.keyframe_points.add(n - len(fc.keyframe_points))
    co = np.empty(2 * n, dtype=np.float64)
    co[0::2] = frames; co[1::2] = values
    fc.keyframe_points.foreach_set("co", co)
    fc.keyframe_points.foreach_set("interpolation", [interp] * n)
    fc.update()
    return fc


def bake_vec(ob, path, frames, arr, interp=1):
    arr = np.asarray(arr)
    for i in range(arr.shape[1]):
        fcurve(ob, path, i, frames, arr[:, i], interp)


def keys_fn(keys, smooth_=True):
    xs = [k[0] for k in keys]; ys = [k[1] for k in keys]

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = int(np.searchsorted(xs, x)) - 1
        t = (x - xs[i]) / (xs[i + 1] - xs[i])
        if smooth_:
            t = t * t * (3 - 2 * t)
        return ys[i] + (ys[i + 1] - ys[i]) * t

    return f


def lowpass(arr, tau, dt=1.0 / FPS):
    out = np.empty_like(arr, dtype=np.float64)
    a = 1 - math.exp(-dt / tau)
    acc = arr[0]
    for i, v in enumerate(arr):
        acc += (v - acc) * a
        out[i] = acc
    return out


def movavg(arr, n=5):
    k = np.ones(n) / n
    return np.convolve(np.pad(arr, (n // 2, n // 2), mode="edge"), k, mode="valid")


# =============== 主角车速度模拟 ===============
NITRO = [(642.0, 770.0), (S_T1 + 35.0, FINISH_S - 15.0)]


def in_nitro(s):
    return any(a <= s < b for a, b in NITRO)


def vlimit(s):
    if s < 548:
        return 66.0
    if s < 620:
        return 29.5
    if s < 928:
        return 62.0
    if s < S_V1 - 6:
        return 54.0
    if s < S_T1 + 25:
        return 73.0
    if s < FINISH_S + 40:
        return 94.0
    return max(40.0, 94.0 - (s - FINISH_S - 40) * 0.30)


DS = 0.5
S_SIM_END = FINISH_S + 520
grid = np.arange(START_S, S_SIM_END, DS)
va = np.array([vlimit(s) for s in grid])
AB = 17.0
for i in range(len(grid) - 2, -1, -1):
    va[i] = min(va[i], math.sqrt(va[i + 1] ** 2 + 2 * AB * DS))
dt = 1 / 240
t = 0.0; s = START_S; v = 0.0
ts, ss, vs = [0.0], [s], [0.0]
while s < S_SIM_END - 2:
    a0, vtop = (17.5, 106.0) if in_nitro(s) else (12.6, 82.0)
    a = a0 * max(0.0, 1 - (v / vtop) ** 1.6) + 0.3
    vmax = float(np.interp(s, grid, va))
    v2 = v + a * dt
    if v2 > vmax:
        v2 = max(vmax, v - AB * dt)
    v = v2; s += v * dt; t += dt
    ts.append(t); ss.append(s); vs.append(v)
ts, ss, vs = np.array(ts), np.array(ss), np.array(vs)
T_FIN = float(np.interp(FINISH_S, ss, ts))
F_FIN = F_GO + int(math.ceil(T_FIN * FPS))
F_END = F_FIN + 105
frames = np.arange(1, F_END + 1)
tf = (frames - F_GO) / FPS
NF = len(frames)
print(f"@@ race time {T_FIN:.2f}s  finish frame {F_FIN}  end {F_END}  total {F_END / FPS:.1f}s")
s_h = np.where(tf <= 0, START_S, np.interp(np.maximum(tf, 0), ts, ss))
t_of_s = lambda s_: float(np.interp(s_, ss, ts))

# =============== 走线 ===============
hero_lat = keys_fn([(60, -2.0), (110, -2.0), (170, -5.3), (245, -5.3), (290, -1.9), (400, -1.9), (470, 1.0), (548, 3.6),
                    (588, -2.2), (634, 2.0), (700, 0.4), (760, 1.7), (860, 1.7), (926, -2.6),
                    (1040, 2.2), (1142, -1.0), (1250, -1.8), (1300, -1.8), (1336, 1.7), (1420, 1.7), (1492, -1.8),
                    (1668, -1.8), (1722, -5.3), (1800, -5.3), (1876, -1.8), (2600, -1.8)])
hero_drift = keys_fn([(538, 0), (556, -15), (574, -31), (598, -27), (616, -12), (632, 5), (652, 0),
                      (S_B1 - 12, 0), (S_B1 + 30, 8), (S_V1 - 45, 8), (S_V1 - 4, 0)])
RIV = {
    "rival_green": dict(
        gap=[(60, 8.0), (200, 15), (350, 23), (540, 26), (640, 29), (900, 31), (1150, 27), (1450, 24), (1650, 21), (1800, 11), (1900, 1.0), (1950, -6), (1995, -11), (2600, -55)],
        lat=[(60, 2.0), (300, 2.0), (430, 1.0), (548, 3.2), (588, -2.0), (634, 1.7), (720, -1.6), (926, -2.4), (1040, 2.0), (1146, -1.0), (1262, -1.0), (1302, 1.8), (2600, 1.8)],
        drift=0.75),
    "rival_purple": dict(
        gap=[(60, 8.0), (250, 11), (450, 12.5), (560, 11), (640, 10), (740, 5.5), (800, 0.0), (860, -6), (1000, -17), (1500, -48), (2600, -120)],
        lat=[(60, -2.0), (430, -2.0), (548, 3.0), (588, -2.1), (634, 1.5), (700, -1.6), (926, -2.6), (1040, 1.8), (1146, -1.2), (1210, 1.7), (2600, 1.7)],
        drift=0.6),
    "rival_yellow": dict(
        gap=[(60, 0.0), (130, 2.5), (250, 3.0), (330, 1.0), (380, -2.0), (460, -8), (560, -14), (900, -34), (2600, -150)],
        lat=[(60, 2.0), (470, 2.0), (548, 3.0), (588, -2.0), (634, 1.5), (700, -1.6), (926, -2.6), (1040, 1.8), (1146, -1.2), (1210, 1.7), (2600, 1.7)],
        drift=0.5),
}
# 同向车流：(主角到达时的里程, 车道, 车速)；对向车流车速为负
TRAFFIC = [(305, -5.4, 16), (420, -5.4, 14), (505, -5.4, 13), (712, -4.9, 13), (885, -4.9, 12),
           (1262, -5.2, 18), (1347, -1.75, 17), (1652, -5.4, 20), (1742, -1.8, 19), (1852, -9.0, 18), (1930, -9.0, 20),
           (182, 5.4, -18), (332, 5.4, -17), (452, 5.4, -19), (505, 5.4, -16), (692, 4.9, -15), (792, 4.9, -14), (902, 4.9, -15),
           (1302, 5.2, -19), (1505, 5.2, -18), (1642, 5.4, -21), (1762, 9.0, -20), (1882, 5.4, -22), (1962, 9.0, -20)]
TRAFFIC_MODELS = ["traffic_sedan", "traffic_wagon", "traffic_hatch", "traffic_compact", "traffic_minivan", "traffic_pickup", "traffic_sport", "traffic_coupe"]


# =============== 车辆姿态计算与烘焙 ===============
def car_motion(s_arr, d_arr, drift_arr, wheelbase, r_f, r_r):
    """由每帧的 (里程, 横向位置, 漂移角) 算出位置、朝向、车身侧倾俯仰、转向、车轮转角。"""
    n = len(s_arr)
    pos = np.zeros((n, 3)); hv = np.zeros(n); slope = np.zeros(n)
    for i in range(n):
        x, y, z, h, _ = T.pose(s_arr[i])
        pos[i] = (x - d_arr[i] * math.sin(h), y + d_arr[i] * math.cos(h), z)
        hv[i] = h
        slope[i] = T.slope(s_arr[i])
    ds = np.gradient(s_arr); dd = np.gradient(d_arr)
    dirn = np.where(ds < -1e-6, -1.0, 1.0)
    lat_ang = np.where(np.abs(ds) > 1e-4, np.arctan2(dd, np.abs(ds)), 0.0)
    hv = hv + np.where(dirn < 0, math.pi, 0.0) + lat_ang * dirn
    hv = movavg(hv, 3)
    v = np.abs(ds) * FPS
    a_long = movavg(np.gradient(v) * FPS, 7)
    a_lat = movavg(v * np.gradient(hv) * FPS, 7)
    yaw = hv + drift_arr
    pitch = -np.arctan(slope) * dirn
    roll_b = np.clip(a_lat * 0.0034 + drift_arr * 0.05, -0.085, 0.085)
    pitch_b = np.clip(-a_long * 0.0023, -0.034, 0.04)
    kappa = np.where(v > 0.5, np.gradient(hv) * FPS / np.maximum(v, 0.5), 0.0)
    steer = np.clip(np.arctan(wheelbase * kappa) * 1.3 - drift_arr * 0.85, -0.62, 0.62)
    steer = movavg(steer, 3)
    dist = np.cumsum(np.abs(ds))
    return dict(pos=pos, yaw=yaw, pitch=pitch, roll_b=roll_b, pitch_b=pitch_b, steer=steer, v=v, a_long=a_long, a_lat=a_lat,
                wf=dist / r_f, wr=dist / r_r, hv=hv)


def bake_car(car, m, frs=None):
    frs = frames if frs is None else frs
    root = car["root"]; body = car["body"]
    root.rotation_mode = "XYZ"; body.rotation_mode = "XYZ"
    bake_vec(root, "location", frs, m["pos"])
    fcurve(root, "rotation_euler", 1, frs, m["pitch"]); fcurve(root, "rotation_euler", 2, frs, m["yaw"])
    fcurve(body, "rotation_euler", 0, frs, m["roll_b"]); fcurve(body, "rotation_euler", 1, frs, m["pitch_b"])
    for q in ("FL", "FR"):
        fcurve(car["steer"][q], "rotation_euler", 2, frs, m["steer"])
        fcurve(car["spin"][q], "rotation_euler", 1, frs, m["wf"])
    for q in ("RL", "RR"):
        fcurve(car["spin"][q], "rotation_euler", 1, frs, m.get("wr_spin", m["wr"]))


def dup_car(car, inst):
    col = bpy.data.collections.new(f"{car['col'].name}_{inst}")
    sc.collection.children.link(col)
    mp = {}
    for o in car["col"].objects:
        n = o.copy()
        col.objects.link(n)
        mp[o] = n
    for o, n in mp.items():
        if o.parent in mp:
            n.parent = mp[o.parent]
    d = dict(col=col, root=mp[car["root"]], body=mp[car["body"]], name=car["name"],
             spin={q: mp[o] for q, o in car["spin"].items()}, steer={q: mp[o] for q, o in car["steer"].items()})
    return d


# ---- 主角 ----
hero = load_car("hero")
add_headlights(hero, power=2600)
hr = hero["root"]
d_h = np.array([hero_lat(s) for s in s_h])
dr_h = np.array([hero_drift(s) for s in s_h]) * D2R
mh = car_motion(s_h, d_h, dr_h, hr["wheelbase"], hr["r_front"], hr["r_rear"])
# 起步和漂移时后轮空转
slip = 1.0 + 1.6 * np.clip(1 - np.maximum(tf, 0) / 1.3, 0, 1) * (tf > 0) + 0.8 * np.clip(np.abs(dr_h) / 0.5, 0, 1)
mh["wr_spin"] = np.cumsum(np.abs(np.gradient(s_h)) * slip) / hr["r_rear"]
# 片头：原地轰油门，车身轻微抖动
rev = np.zeros(NF)
for a, b in ((20, 44), (58, 76), (96, 112), (118, 134)):
    for f in range(a, b):
        u = (f - a) / (b - a)
        rev[f - 1] = math.sin(u * math.pi) ** 0.6
mh["pitch_b"] = mh["pitch_b"] - rev * 0.012 * (1 + 0.5 * np.sin(frames * 2.1))
mh["roll_b"] = mh["roll_b"] + rev * 0.006 * np.sin(frames * 2.7)
bake_car(hero, mh)
v_h = mh["v"]
nitro_on = np.array([in_nitro(s) and tf[i] > 0 for i, s in enumerate(s_h)], dtype=float)
nitro_env = lowpass(nitro_on, 0.16)

# ---- 对手 ----
rivals = {}
for name, cfg in RIV.items():
    car = load_car(name)
    add_headlights(car, power=1300)
    gap, lat = keys_fn(cfg["gap"]), keys_fn(cfg["lat"])
    s_r = s_h + np.array([gap(s) for s in s_h])
    d_r = np.array([lat(s) for s in s_h])
    dr_r = np.array([hero_drift(s) for s in s_r]) * D2R * cfg["drift"]
    m = car_motion(s_r, d_r, dr_r, car["root"]["wheelbase"], car["root"]["r_front"], car["root"]["r_rear"])
    bake_car(car, m)
    rivals[name] = dict(car=car, s=s_r, d=d_r, m=m)

# ---- 路人车 ----
traffic_base = {n: load_car(n) for n in TRAFFIC_MODELS}
for c in traffic_base.values():       # 模板本体挪到看不见的地方
    c["root"].location = (0, 0, -200)


def hue_variation(car):
    for o in car["col"].objects:
        for sl in getattr(o, "material_slots", []):
            mt = sl.material
            if mt and "__Body" in mt.name and not mt.get("hue_done"):
                nt = mt.node_tree
                b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
                if b.inputs["Base Color"].links:
                    src = b.inputs["Base Color"].links[0].from_socket
                    hs = nt.nodes.new("ShaderNodeHueSaturation")
                    oi = nt.nodes.new("ShaderNodeObjectInfo")
                    nt.links.new(oi.outputs["Random"], hs.inputs["Hue"])
                    hs.inputs["Saturation"].default_value = 0.85
                    hs.inputs["Value"].default_value = 1.0
                    nt.links.new(src, hs.inputs["Color"])
                    nt.links.new(hs.outputs["Color"], b.inputs["Base Color"])
                mt["hue_done"] = 1


for c in traffic_base.values():
    hue_variation(c)

tl_data = bpy.data.lights.new("traffic_head", "SPOT")
tl_data.energy = 2400; tl_data.color = (1.0, 0.93, 0.8); tl_data.spot_size = math.radians(75); tl_data.spot_blend = 0.6; tl_data.shadow_soft_size = 0.08
traffic = []
for i, (sm, lane, vt) in enumerate(TRAFFIC):
    base = traffic_base[TRAFFIC_MODELS[(i * 3 + 1) % len(TRAFFIC_MODELS)]]
    car = dup_car(base, f"t{i}")
    s_t = sm + vt * (tf - t_of_s(sm))
    d_t = np.full(NF, lane)
    m = car_motion(s_t, d_t, np.zeros(NF), car["root"]["wheelbase"], car["root"]["r_front"], car["root"]["r_rear"])
    bake_car(car, m)
    lo = bpy.data.objects.new(f"thead{i}", tl_data)
    car["col"].objects.link(lo)
    lo.parent = car["body"]
    lo.location = (car["root"]["front_x"], 0, 0.62)
    lo.rotation_euler = (0, math.radians(-90 + 5), 0)
    traffic.append(dict(car=car, s=s_t, d=d_t))

# ---- 路边停放的车 ----
n_parked = 0
r2 = random.Random(21)
for side in (-1, 1):
    s = -70.0
    while s < 536:
        if abs(s - 200) < 13 or abs(s - 400) < 13 or abs(s - (START_S + 9)) < 4 or (side < 0 and START_S - 16 < s < START_S + 22):
            s += 6.0; continue
        if r2.random() < 0.62:
            base = traffic_base[r2.choice(TRAFFIC_MODELS)]
            car = dup_car(base, f"p{n_parked}")
            x, y, z = T.xyz(s, side * (8.45 + r2.uniform(-0.12, 0.12)))
            car["root"].location = (x, y, z)
            car["root"].rotation_euler = (0, 0, T.heading(s) + (math.pi if side > 0 else 0) + r2.uniform(-0.03, 0.03))
            n_parked += 1
        s += r2.uniform(5.6, 7.5)
print("@@ traffic", len(traffic), "parked", n_parked)

# =============== 碰撞自检 ===============
racers = [("hero", s_h, d_h)] + [(n, r["s"], r["d"]) for n, r in rivals.items()]
others = [(f"traffic{i}", t_["s"], t_["d"]) for i, t_ in enumerate(traffic)]
worst = []
for i, (na, sa, da) in enumerate(racers):
    for nb, sb, db in racers[i + 1:] + others:
        ok = (np.abs(sa - sb) > 4.9) | (np.abs(da - db) > 2.15)
        bad = np.where(~ok)[0]
        if len(bad):
            worst.append((na, nb, int(frames[bad[0]]), int(frames[bad[-1]]), float(sa[bad[0]])))
for w in worst:
    print("@@ COLLISION", w)
if not worst:
    print("@@ no collisions")

# =============== 主角车附加：底盘灯、轮廓光、氮气火焰、尾灯拖影 ===============
hcol = hero["col"]


def add_light(name, kind, parent, loc, rot, energy, color, size=1.0, size_y=None, spot=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy; ld.color = color
    if kind == "AREA":
        ld.shape = "RECTANGLE" if size_y else "SQUARE"
        ld.size = size
        if size_y:
            ld.size_y = size_y
    elif kind == "SPOT":
        ld.spot_size = spot or 1.2; ld.shadow_soft_size = size
    else:
        ld.shadow_soft_size = size
    lo = bpy.data.objects.new(name, ld)
    hcol.objects.link(lo)
    lo.parent = parent
    lo.location = loc; lo.rotation_euler = rot
    return lo


under = add_light("hero_underglow", "AREA", hero["body"], (0.0, 0, 0.16), (0, 0, 0), 520.0, (0.0, 1.0, 0.85), size=3.6, size_y=1.5)
under.visible_glossy = False
rim = add_light("hero_rim", "AREA", hero["root"], (-2.6, 0, 3.4), (0, math.radians(-28), 0), 300.0, (0.78, 0.88, 1.0), size=3.0)
rim.visible_glossy = False
tail_x = hr["rear_x"]
tx, ty, tz = hr["tail_pos"]

# 氮气火焰
mf, nt, out = new_mat("nitro_flame")
tcn = N(nt, "ShaderNodeTexCoord")
sx = N(nt, "ShaderNodeSeparateXYZ"); L(nt, tcn.outputs["Generated"], sx.inputs[0])
cr = mats.ramp(nt, sx.outputs["X"], [(0.0, (0.0, 0.0, 0.0)), (0.25, (1.0, 0.05, 0.5)), (0.6, (0.12, 0.3, 1.0)), (0.9, (0.25, 0.55, 1.0)), (1.0, (0.5, 0.8, 1.0))])
al = mats.ramp(nt, sx.outputs["X"], [(0.0, (0, 0, 0)), (0.35, (0.5, 0.5, 0.5)), (1.0, (1, 1, 1))])
em = N(nt, "ShaderNodeEmission", inputs={"Strength": 7.0}); L(nt, cr, em.inputs["Color"])
tr = N(nt, "ShaderNodeBsdfTransparent")
mx = N(nt, "ShaderNodeMixShader"); L(nt, al, mx.inputs[0]); L(nt, tr.outputs[0], mx.inputs[1]); L(nt, em.outputs[0], mx.inputs[2])
L(nt, mx.outputs[0], out.inputs["Surface"])
mf.cycles.emission_sampling = "NONE"
mbf = __import__("citygen").MB()
mbf.cyl((-1.0, 0, 0), (0, 0, 0), 0.015, 10, r1=0.085)
flame_ob = mbf.build("flame_mesh", [mf], hcol, smooth=True)
flame_me = flame_ob.data
bpy.data.objects.remove(flame_ob)
flames = []
flick = np.array([1.0 + 0.22 * math.sin(f * 2.9) + 0.14 * math.sin(f * 7.3 + 1.0) for f in frames])
for sgn in (1, -1):
    fo = bpy.data.objects.new("hero_flame", flame_me)
    hcol.objects.link(fo)
    fo.parent = hero["body"]
    fo.location = (tail_x + 0.22, sgn * 0.115, 0.665)
    fcurve(fo, "scale", 0, frames, np.maximum(0.001, nitro_env * 1.5 * flick))
    fcurve(fo, "scale", 1, frames, np.maximum(0.001, nitro_env * 0.8))
    fcurve(fo, "scale", 2, frames, np.maximum(0.001, nitro_env * 0.8))
    flames.append(fo)
glow = add_light("hero_nitro_glow", "POINT", hero["body"], (tail_x - 0.9, 0, 0.7), (0, 0, 0), 0.0, (0.45, 0.55, 1.0), size=0.3)
fcurve(glow.data, "energy", 0, frames, nitro_env * 110.0 * flick)

# 尾灯拖影：贴在车后的发光带，长度随车速和氮气变化
mt, nt, out = new_mat("tail_trail")
tcn = N(nt, "ShaderNodeTexCoord")
sx = N(nt, "ShaderNodeSeparateXYZ"); L(nt, tcn.outputs["Generated"], sx.inputs[0])
al = mats.ramp(nt, sx.outputs["X"], [(0.0, (0, 0, 0)), (0.55, (0.10, 0.10, 0.10)), (0.93, (0.8, 0.8, 0.8)), (1.0, (0.35, 0.35, 0.35))])
ed = mats.M(nt, "SUBTRACT", 1.0, mats.M(nt, "MULTIPLY", mats.M(nt, "ABSOLUTE", mats.M(nt, "SUBTRACT", sx.outputs["Y"], 0.5)), 2.0))
alpha = mats.M(nt, "MULTIPLY", al, mats.M(nt, "POWER", ed, 0.7))
cr = mats.ramp(nt, sx.outputs["X"], [(0.0, (1.0, 0.05, 0.25)), (0.7, (1.0, 0.06, 0.04)), (1.0, (1.0, 0.25, 0.1))])
em = N(nt, "ShaderNodeEmission", inputs={"Strength": 11.0}); L(nt, cr, em.inputs["Color"])
tr = N(nt, "ShaderNodeBsdfTransparent")
mx = N(nt, "ShaderNodeMixShader"); L(nt, alpha, mx.inputs[0]); L(nt, tr.outputs[0], mx.inputs[1]); L(nt, em.outputs[0], mx.inputs[2])
L(nt, mx.outputs[0], out.inputs["Surface"])
mt.cycles.emission_sampling = "NONE"
mbt = __import__("citygen").MB()
mbt.quad((-1, -0.5, 0), (0, -0.5, 0), (0, 0.5, 0), (-1, 0.5, 0))
tro = mbt.build("trail_mesh", [mt], hcol)
trail_me = tro.data
bpy.data.objects.remove(tro)
speed_f = np.clip((v_h - 46.0) / 38.0, 0, 1)
trail_len = lowpass(0.02 + speed_f * 4.5 + nitro_env * 11.0, 0.12)
for sgn in (1, -1):
    to = bpy.data.objects.new("hero_trail", trail_me)
    hcol.objects.link(to)
    to.parent = hero["body"]
    to.location = (tx - 0.04, sgn * ty, tz)
    fcurve(to, "scale", 0, frames, trail_len)
    fcurve(to, "scale", 1, frames, 0.10 + 0.07 * nitro_env)
    to.visible_shadow = False

# 刹车灯
brake = (mh["a_long"] < -5.0).astype(float)
brake_env = lowpass(brake, 0.06)
for o in hcol.objects:
    for sl in getattr(o, "material_slots", []):
        m_ = sl.material
        if m_ and m_.name in ("hero__TailLight", "hero__RedTintGlass") and not m_.get("anim"):
            b = next(n for n in m_.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            base = b.inputs["Emission Strength"].default_value
            idx = list(b.inputs).index(b.inputs["Emission Strength"])
            fcurve(m_.node_tree, f'nodes["{b.name}"].inputs[{idx}].default_value', 0, frames, base * (0.8 + 1.9 * brake_env))
            m_["anim"] = 1

# =============== 漂移轮胎烟 ===============
ms, nt, out = new_mat("tire_smoke")
tcn = N(nt, "ShaderNodeTexCoord")
oi = N(nt, "ShaderNodeObjectInfo")
gr = N(nt, "ShaderNodeTexGradient"); gr.gradient_type = "SPHERICAL"
uvn = N(nt, "ShaderNodeUVMap"); uvn.uv_map = "UVMap"
suv = N(nt, "ShaderNodeSeparateXYZ"); L(nt, uvn.outputs[0], suv.inputs[0])
L(nt, mats.comb(nt, mats.M(nt, "MULTIPLY_ADD", suv.outputs["X"], 2.0, -1.0), mats.M(nt, "MULTIPLY_ADD", suv.outputs["Y"], 2.0, -1.0), 0.0), gr.inputs["Vector"])
nz = N(nt, "ShaderNodeTexNoise", inputs={"Scale": 2.6, "Detail": 4.0, "Roughness": 0.6})
va_ = N(nt, "ShaderNodeVectorMath"); va_.operation = "ADD"
L(nt, tcn.outputs["Generated"], va_.inputs[0]); L(nt, oi.outputs["Location"], va_.inputs[1])
L(nt, va_.outputs[0], nz.inputs["Vector"])
dens = mats.M(nt, "MULTIPLY", mats.M(nt, "POWER", gr.outputs["Fac"], 1.4), mats.M(nt, "MULTIPLY_ADD", nz.outputs["Fac"], 1.3, 0.1, clamp=True))
alpha = mats.M(nt, "MULTIPLY", dens, oi.outputs["Alpha"], clamp=True)
df = N(nt, "ShaderNodeBsdfDiffuse", inputs={"Color": (0.72, 0.74, 0.8, 1)})
tl = N(nt, "ShaderNodeBsdfTranslucent", inputs={"Color": (0.72, 0.74, 0.8, 1)})
m1 = N(nt, "ShaderNodeMixShader", inputs={0: 0.5}); L(nt, df.outputs[0], m1.inputs[1]); L(nt, tl.outputs[0], m1.inputs[2])
tr = N(nt, "ShaderNodeBsdfTransparent")
mx = N(nt, "ShaderNodeMixShader"); L(nt, alpha, mx.inputs[0]); L(nt, tr.outputs[0], mx.inputs[1]); L(nt, m1.outputs[0], mx.inputs[2])
L(nt, mx.outputs[0], out.inputs["Surface"])
mbs = __import__("citygen").MB()
mbs.quad((-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0))
so = mbs.build("smoke_mesh", [ms], hcol)
smoke_me = so.data
bpy.data.objects.remove(so)
smoke_col = bpy.data.collections.new("SMOKE"); sc.collection.children.link(smoke_col)
puffs = []


def emit_smoke(m, root, drift_arr, every, strength, launch=False):
    cnt = 0
    wb = root["wheelbase"]; trk = root["track"]
    for i in range(NF):
        amt = min(1.0, abs(drift_arr[i]) / 0.42) if abs(drift_arr[i]) > 0.2 else 0.0
        if launch and 0 < tf[i] < 1.5:
            amt = max(amt, 1.0 - tf[i] / 1.5)
        if amt < 0.2 or m["v"][i] < 3.0 or i % every:
            continue
        yaw = m["yaw"][i]
        for sgn in (1, -1):
            lx, ly = -wb / 2 - 0.2, sgn * trk / 2
            px = m["pos"][i][0] + lx * math.cos(yaw) - ly * math.sin(yaw)
            py = m["pos"][i][1] + lx * math.sin(yaw) + ly * math.cos(yaw)
            puffs.append((int(frames[i]), (px, py, m["pos"][i][2] + 0.25), amt * strength, (rng.uniform(-1, 1), rng.uniform(-1, 1))))
            cnt += 1
    return cnt


n1 = emit_smoke(mh, hr, dr_h, 2, 1.0, launch=True)
for name, r in rivals.items():
    dr = np.array([hero_drift(s) for s in r["s"]]) * D2R * RIV[name]["drift"]
    emit_smoke(r["m"], r["car"]["root"], dr, 5, 0.8, launch=False)
print("@@ smoke puffs", len(puffs))

# =============== 相机 ===============
def new_cam(name):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    sc.collection.objects.link(cam)
    cam.data.sensor_width = 36.0
    cam.data.clip_start = 0.15; cam.data.clip_end = 8000
    cam.rotation_mode = "XYZ"
    return cam


def look_euler(pos, target, roll=0.0, prev=None):
    q = (Vector(target) - Vector(pos)).to_track_quat("-Z", "Y")
    if roll:
        q = q @ Quaternion((0, 0, 1), roll)
    return q.to_euler("XYZ", prev) if prev is not None else q.to_euler("XYZ")


def fov_lens(fov_deg):
    return 18.0 / math.tan(math.radians(fov_deg) / 2)


# ---- 追尾相机 ----
cam_chase = new_cam("cam_chase")
cyaw = lowpass(mh["hv"], 0.20)
accel_n = lowpass(mh["a_long"], 0.25)
vn = np.clip(v_h / 94.0, 0, 1)
dist = 7.3 + 1.3 * vn + 0.045 * np.clip(accel_n, -18, 18) + 1.9 * nitro_env
height = 2.05 - 0.28 * vn + 0.12 * nitro_env
fov = 70.0 + 15.0 * vn ** 1.2 + 12.0 * nitro_env
shake_amp = 0.0016 + 0.0042 * vn ** 2 + 0.006 * nitro_env
cz = lowpass(mh["pos"][:, 2], 0.10)
cpos = np.zeros((NF, 3)); crot = np.zeros((NF, 3))
prev = None
for i in range(NF):
    c, s_ = math.cos(cyaw[i]), math.sin(cyaw[i])
    px, py, pz = mh["pos"][i]
    bob = 0.035 * vn[i] * math.sin(frames[i] * 1.3) * math.sin(frames[i] * 0.37)
    cpos[i] = (px - c * dist[i], py - s_ * dist[i], cz[i] + height[i] + bob)
    tgt = (px + c * 5.0, py + s_ * 5.0, pz + 1.0)
    rollc = float(np.clip(-mh["a_lat"][i] * 0.0018, -0.06, 0.06))
    e = look_euler(cpos[i], tgt, rollc, prev)
    f = frames[i]
    e.x += shake_amp[i] * (math.sin(f * 5.1) + 0.6 * math.sin(f * 11.7 + 2.0))
    e.z += shake_amp[i] * (math.sin(f * 4.3 + 1.0) + 0.6 * math.sin(f * 9.1))
    crot[i] = e; prev = e
bake_vec(cam_chase, "location", frames, cpos)
bake_vec(cam_chase, "rotation_euler", frames, crot)
fcurve(cam_chase.data, "lens", 0, frames, [fov_lens(a) for a in fov])

# ---- 片头 1：长焦低机位横移，背景虚成光斑 ----
cam_i1 = new_cam("cam_intro1")
I1 = np.arange(1, 76)
p_i1 = np.zeros((len(I1), 3)); r_i1 = np.zeros((len(I1), 3))
prev = None
hx, hy, hz = T.xyz(START_S, -2.0)
for k, f in enumerate(I1):
    u = k / (len(I1) - 1)
    p = T.xyz(START_S + 9.5 - 5.0 * u, -12.6 + 0.6 * u, 0.62 + 0.10 * u)
    p_i1[k] = p
    e = look_euler(p, (hx + 0.9 - 0.5 * u, hy, hz + 0.58), 0.0, prev)
    r_i1[k] = e; prev = e
bake_vec(cam_i1, "location", I1, p_i1); bake_vec(cam_i1, "rotation_euler", I1, r_i1)
cam_i1.data.lens = 72.0
cam_i1.data.dof.use_dof = True; cam_i1.data.dof.aperture_fstop = 1.4
cam_i1.data.dof.focus_object = hero["body"]

# ---- 片头 2：车后升起，接入追尾视角 ----
cam_i2 = new_cam("cam_intro2")
I2 = np.arange(76, INTRO + 1)
p_i2 = np.zeros((len(I2), 3)); r_i2 = np.zeros((len(I2), 3))
prev = None
end_p = cpos[INTRO - 1]
for k, f in enumerate(I2):
    u = k / (len(I2) - 1)
    ue = u * u * (3 - 2 * u)
    sp = T.xyz(START_S - 4.6, -2.0 - 1.2, 0.38)
    p = Vector(sp).lerp(Vector(end_p), ue)
    p_i2[k] = p
    tgt = Vector(T.xyz(START_S + 1.0, -2.0, 0.7)).lerp(Vector(T.xyz(START_S + 5.0, -2.0, 1.0)), ue)
    e = look_euler(p, tgt, 0.0, prev)
    r_i2[k] = e; prev = e
bake_vec(cam_i2, "location", I2, p_i2); bake_vec(cam_i2, "rotation_euler", I2, r_i2)
fcurve(cam_i2.data, "lens", 0, I2, [28.0 + (fov_lens(fov[INTRO - 1]) - 28.0) * (k / (len(I2) - 1)) ** 2 for k in range(len(I2))])
cam_i2.data.dof.use_dof = True; cam_i2.data.dof.aperture_fstop = 2.8
cam_i2.data.dof.focus_object = hero["body"]

# ---- 片尾：冲线后的低机位环绕 ----
cam_out = new_cam("cam_outro")
F_OUT = F_FIN + 14
O = np.arange(F_OUT, F_END + 1)
p_o = np.zeros((len(O), 3)); r_o = np.zeros((len(O), 3))
prev = None
for k, f in enumerate(O):
    i = f - 1
    u = k / (len(O) - 1)
    ang = math.radians(-38 - 100 * u)        # 相对车头方向的方位角：从右前方绕到右后方
    rad = 6.2 - 0.8 * u
    yaw = mh["yaw"][i]
    px, py, pz = mh["pos"][i]
    p = (px + rad * math.cos(yaw + ang), py + rad * math.sin(yaw + ang), pz + 0.55 + 0.5 * u)
    p_o[k] = p
    e = look_euler(p, (px, py, pz + 0.6), 0.0, prev)
    r_o[k] = e; prev = e
bake_vec(cam_out, "location", O, p_o); bake_vec(cam_out, "rotation_euler", O, r_o)
cam_out.data.lens = 32.0
cam_out.data.dof.use_dof = True; cam_out.data.dof.aperture_fstop = 2.8
cam_out.data.dof.focus_object = hero["body"]

CUTS = [(1, cam_i1), (76, cam_i2), (F_GO, cam_chase), (F_OUT, cam_out)]
for f, cam in CUTS:
    mk = sc.timeline_markers.new(cam.name, frame=int(f))
    mk.camera = cam
sc.camera = cam_i1


def cam_at(f):
    c = CUTS[0][1]
    for f0, cam in CUTS:
        if f >= f0:
            c = cam
    return c


# ---- 烟雾物体（朝向当前相机）----
for k, (f0, p, strength, rv) in enumerate(puffs):
    life = 26
    po = bpy.data.objects.new("puff", smoke_me)
    smoke_col.objects.link(po)
    po.visible_shadow = False
    frs = np.arange(f0, f0 + life + 1)
    u = (frs - f0) / life
    sz = 0.6 + 2.7 * u ** 0.6
    loc = np.column_stack([p[0] + rv[0] * 0.5 * u, p[1] + rv[1] * 0.5 * u, p[2] + 0.2 + 1.3 * u])
    bake_vec(po, "location", frs, loc)
    for a in range(3):
        fcurve(po, "scale", a, frs, sz)
    fcurve(po, "color", 3, frs, 0.42 * strength * np.sin(np.clip(u * 1.15, 0, 1) * math.pi) ** 0.8 * (1 - u * 0.3))
    fcurve(po, "hide_render", 0, [f0 - 1, f0, f0 + life, f0 + life + 1], [1, 0, 0, 1], interp=0)
    fcurve(po, "hide_viewport", 0, [f0 - 1, f0, f0 + life, f0 + life + 1], [1, 0, 0, 1], interp=0)
    cam = cam_at(f0 + life // 2)
    con = po.constraints.new("COPY_ROTATION")
    con.target = cam

# =============== 渲染设置和保存 ===============
sc.frame_start = 1; sc.frame_end = int(F_END)
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.55
sc.render.motion_blur_position = "CENTER"
sc["F_GO"] = F_GO; sc["F_FIN"] = int(F_FIN); sc["F_OUT"] = int(F_OUT); sc["F_END"] = int(F_END)

# =============== 遥测（给 HUD 和音效用） ===============
GEAR_TOP = [16.0, 29.0, 42.0, 55.0, 69.0, 84.0, 100.0]


def gear_rpm(v_):
    g = 0
    while g < len(GEAR_TOP) - 1 and v_ > GEAR_TOP[g] * 0.97:
        g += 1
    lo = 0.0 if g == 0 else GEAR_TOP[g - 1] * 0.97
    u = (v_ - lo) / (GEAR_TOP[g] - lo)
    return g + 1, 2600 + 5600 * (0.28 + 0.72 * max(0.0, min(1.0, u)))


tele = []
nit_level = 1.0
all_r = [("hero", s_h)] + [(n, r["s"]) for n, r in rivals.items()]
drift_score = 0.0
for i in range(NF):
    g, rpm = gear_rpm(v_h[i])
    if tf[i] <= 0:
        g, rpm = 1, 1400 + 5200 * rev[i]
    if nitro_on[i]:
        nit_level = max(0.0, nit_level - (1 / FPS) / (2.2 if s_h[i] < 1000 else 5.4))
    else:
        nit_level = min(1.0, nit_level + (1 / FPS) * (0.06 + 0.9 * min(1.0, abs(dr_h[i]) / 0.4)))
    rank = 1 + sum(1 for n, s_ in all_r[1:] if s_[i] > s_h[i])
    drifting = abs(dr_h[i]) > 0.1 and v_h[i] > 8
    drift_score = drift_score + abs(dr_h[i]) * v_h[i] * 1.6 if drifting else (drift_score if (i and tele[-1]["drift_hold"] > 0) else 0.0)
    hold = 36 if drifting else max(0, (tele[-1]["drift_hold"] - 1) if i else 0)
    tele.append(dict(f=int(frames[i]), t=float(tf[i]), s=float(s_h[i]), v=float(v_h[i]), kmh=float(v_h[i] * 3.6), gear=g, rpm=float(rpm),
                     nitro=float(nit_level), nitro_on=bool(nitro_on[i]), nitro_env=float(nitro_env[i]), rank=rank,
                     drift=float(dr_h[i]), drift_score=float(drift_score), drift_hold=int(hold), drifting=bool(drifting),
                     a_long=float(mh["a_long"][i]), brake=float(brake_env[i]),
                     cam=cam_at(frames[i]).name, x=float(mh["pos"][i][0]), y=float(mh["pos"][i][1]), yaw=float(mh["yaw"][i]),
                     rivals=[[float(r["m"]["pos"][i][0]), float(r["m"]["pos"][i][1])] for r in rivals.values()],
                     fov=float(fov[i])))
# 事件：超车、擦身而过、氮气点火、漂移结算
events = []
for i in range(1, NF):
    if tele[i]["rank"] < tele[i - 1]["rank"] and tf[i] > 0:
        events.append(dict(f=int(frames[i]), type="overtake", rank=tele[i]["rank"]))
    if tele[i]["nitro_on"] and not tele[i - 1]["nitro_on"]:
        events.append(dict(f=int(frames[i]), type="nitro"))
    if tele[i - 1]["drifting"] and not tele[i]["drifting"] and tele[i - 1]["drift_score"] > 300:
        events.append(dict(f=int(frames[i]), type="drift", score=int(tele[i - 1]["drift_score"])))
for k, t_ in enumerate(traffic):
    rel = t_["s"] - s_h
    j = int(np.argmin(np.abs(rel)))
    if abs(rel[j]) < 6 and tf[j] > 0 and frames[j] < F_FIN:
        gap = abs(float(t_["d"][j] - d_h[j]))
        if gap < 4.3:
            events.append(dict(f=int(frames[j]), type="near", gap=gap, oncoming=bool(TRAFFIC[k][2] < 0), side=float(np.sign(t_["d"][j] - d_h[j]))))
events.sort(key=lambda e: e["f"])
for i in range(NF):
    tele[i]["d"] = float(d_h[i])
print("@@ events", [(e["f"], e["type"]) for e in events])
poly = [[float(T.pose(s_)[0]), float(T.pose(s_)[1])] for s_ in np.arange(0, S_END + 60, 6.0)]
meta = dict(fps=FPS, F_GO=F_GO, F_FIN=int(F_FIN), F_OUT=int(F_OUT), F_END=int(F_END), T_FIN=T_FIN, START_S=START_S, FINISH_S=FINISH_S,
            track=poly, rival_names=list(rivals.keys()), nitro_zones=NITRO, events=events,
            sections=[["DOWNTOWN AVE", "市中心大道", 0.0], ["NEON STREET", "不夜街", S_C1 - 20], ["CURVE 7", "七号弯", S_B1], ["RIVERSIDE TUNNEL", "滨江隧道", S_V1 + 20], ["HARBOR BRIDGE", "滨江大桥", S_T1 + 20]],
            top_kmh=float(v_h.max() * 3.6))
os.makedirs(os.path.join(ROOT, "out"), exist_ok=True)
json.dump(dict(meta=meta, frames=tele), open(os.path.join(ROOT, "out", "telemetry.json"), "w"))
bpy.ops.file.pack_all()
out = os.path.join(ROOT, "blend", "race.blend")
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print("@@ saved", out, "objects", len(bpy.data.objects))
