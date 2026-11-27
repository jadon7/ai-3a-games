# 把 motion.py 的运动数据烘焙成关键帧，并架设三个机位
import bpy, math, os, sys, importlib
from mathutils import Vector, Matrix

ROOT = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import track_def as T
importlib.reload(T)
import motion as M
importlib.reload(M)

sc = bpy.context.scene
D = bpy.data.objects
NF = M.NF
sc.frame_start, sc.frame_end = 1, NF


def clear_anim(o):
    if o.animation_data:
        o.animation_data_clear()


def set_linear(o):
    ad = o.animation_data
    if not ad or not ad.action:
        return
    act = ad.action
    fcs = []
    try:
        fcs = list(act.fcurves)
    except Exception:
        try:
            for layer in act.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        fcs.extend(bag.fcurves)
        except Exception as e:
            print("fcurve access failed", e)
    for fc in fcs:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'


STATES = {}
for tag, plan in M.PLANS.items():
    root = D.get(tag + "_ROOT")
    if root is None:
        print("skip (no rig):", tag)
        continue
    dims = dict(M.DIMS[tag])
    dims['wb'] = root.get("wheelbase", dims['wb'])
    dims['rf'] = root.get("r_front", dims['rf'])
    dims['rr'] = root.get("r_rear", dims['rr'])
    st, s0 = M.simulate(tag, plan, dims)
    STATES[tag] = st
    body = D[tag + "_BODY"]
    steer = {k: D[f"{tag}_W_{k}_STEER"] for k in ('FL', 'FR', 'RL', 'RR')}
    spin = {k: D[f"{tag}_W_{k}_SPIN"] for k in ('FL', 'FR', 'RL', 'RR')}
    for o in [root, body] + list(steer.values()) + list(spin.values()):
        clear_anim(o)
        o.rotation_mode = 'XYZ'
    base_body_z = 0.30
    for f in range(0, NF + 2):
        c = st[M.frame_index(f)]
        root.location = (c['x'], c['y'], 0.0)
        root.rotation_euler = (0.0, 0.0, c['yaw'])
        root.keyframe_insert("location", frame=f)
        root.keyframe_insert("rotation_euler", frame=f)
        body.location = (0.0, 0.0, base_body_z + c['heave'])
        body.rotation_euler = (c['roll'], c['pitch'], 0.0)
        body.keyframe_insert("location", frame=f)
        body.keyframe_insert("rotation_euler", frame=f)
        for k in ('FL', 'FR'):
            steer[k].rotation_euler = (0.0, 0.0, c['steer'])
            steer[k].keyframe_insert("rotation_euler", frame=f)
        for k in ('FL', 'FR', 'RL', 'RR'):
            spin[k].rotation_euler = (0.0, c['wheel'][k], 0.0)
            spin[k].keyframe_insert("rotation_euler", frame=f)
    for o in [root, body] + list(steer.values()) + list(spin.values()):
        set_linear(o)
    print("baked", tag, "s0=%.1f" % s0)

# ----------------------------------------------------------------------------- 机位
seg = [r for r in T.seg_ranges() if r[0][0] == 'A' and abs(r[0][1] - T.MAIN_R) < 1e-6][0]
MC0, MC1 = seg[1], seg[2]
x0, y0, hd0, _ = T.sample(MC0)
ARC_C = Vector((x0 + math.sin(hd0) * T.MAIN_R, y0 - math.cos(hd0) * T.MAIN_R, 0.0))   # 右转弯心
print("arc center", tuple(round(v, 2) for v in ARC_C))


def radial(angle_deg, radius, z):
    a = math.radians(angle_deg)
    return Vector((ARC_C.x + radius * math.cos(a), ARC_C.y + radius * math.sin(a), z))


CAM_COLL = bpy.data.collections.get("Cameras") or bpy.data.collections.new("Cameras")
if CAM_COLL.name not in [c.name for c in sc.collection.children]:
    sc.collection.children.link(CAM_COLL)
for o in list(CAM_COLL.objects):
    bpy.data.objects.remove(o, do_unlink=True)


def make_cam(name, pos, lens, fstop):
    cam = bpy.data.cameras.new(name)
    cam.sensor_width = 36.0
    cam.lens = lens
    cam.clip_start = 0.1
    cam.clip_end = 3000
    cam.dof.use_dof = True
    cam.dof.aperture_fstop = fstop
    cam.dof.aperture_blades = 9
    ob = bpy.data.objects.new(name, cam)
    ob.location = pos
    ob.rotation_mode = 'XYZ'
    CAM_COLL.objects.link(ob)
    return ob


def hero_pos(f, sub=0, tag='E30'):
    c = STATES[tag][M.frame_index(f, sub)]
    return Vector((c['x'], c['y'], 0.0)), c


def track_shot(cam, f0, f1, target_fn, lag=0.10, noise_deg=0.02, seed=0.0, lens_fn=None, roll_deg=0.0):
    """摄像机跟拍：目标点经过一阶滞后（模拟摄影师反应）+ 细微抖动，逐帧打关键帧。"""
    # 预滚 1 秒让滞后滤波收敛
    aim = None
    dt = 1.0 / (M.FPS * M.SUB)
    a = 1 - math.exp(-dt / lag) if lag > 0 else 1.0
    pre = 24
    for f in range(f0 - pre, f1 + 2):
        for k in range(M.SUB):
            ff = max(0, min(NF + 1, f))
            tgt = target_fn(ff, k if 0 <= f <= NF else 0)
            aim = tgt.copy() if aim is None else aim + (tgt - aim) * a
        if f < f0 - 1:
            continue
        d = aim - cam.location
        q = d.to_track_quat('-Z', 'Y')
        e = q.to_euler('XYZ')
        t = f / M.FPS
        n1 = M.jitter(t, seed, (1, 0.5, 0.25), (0.9, 2.3, 5.1))
        n2 = M.jitter(t, seed + 3.3, (1, 0.5, 0.25), (1.1, 2.9, 6.3))
        e.x += math.radians(noise_deg) * n2
        e.z += math.radians(noise_deg) * n1
        e.y += math.radians(roll_deg)
        cam.rotation_euler = e
        cam.keyframe_insert("rotation_euler", frame=f)
        cam.data.dof.focus_distance = max(1.0, (target_fn(max(0, min(NF + 1, f)), 0) - cam.location).length)
        cam.data.dof.keyframe_insert("focus_distance", frame=f)
        if lens_fn:
            cam.data.lens = lens_fn(f)
            cam.data.keyframe_insert("lens", frame=f)
    set_linear(cam)


# 镜头分段
SHOT_A = (1, 40)
SHOT_B = (41, 82)
SHOT_B2 = (83, 124)
SHOT_C = (125, NF)

# A：弯外侧正对来车方向的长焦
camA = make_cam("Cam_A", radial(26.6, 82.5, 2.0), 400.0, 5.6)
track_shot(camA, SHOT_A[0], SHOT_A[1],
           lambda f, k: hero_pos(f, k)[0] + Vector((0, 0, 0.75)), lag=0.16, noise_deg=0.012, seed=1.0)

# B：弯外侧靠出口方向，车冲着镜头横着过来
camB = make_cam("Cam_B", radial(4.0, 82.5, 2.2), 200.0, 5.6)
track_shot(camB, SHOT_B[0], SHOT_B[1],
           lambda f, k: hero_pos(f, k)[0] + Vector((0, 0, 0.65)), lag=0.13, noise_deg=0.02, seed=2.0,
           lens_fn=lambda f: 330.0 - 95.0 * max(0.0, min(1.0, (f - 46) / 36.0)))

# B2：内场弯心内侧，顺光近距离摇摄漂移高潮
camB2 = make_cam("Cam_B2", radial(33.0, 28.3, 1.65), 85.0, 4.0)
_zoomB2 = {}
_z = None
for _f in range(SHOT_B2[0] - 24, SHOT_B2[1] + 3):
    _ff = max(0, min(NF + 1, _f))
    _d = (hero_pos(_ff)[0] - camB2.location).length
    _want = max(55.0, min(135.0, 3.7 * _d))
    _z = _want if _z is None else _z + (_want - _z) * (1 - math.exp(-(1.0 / M.FPS) / 0.25))
    _zoomB2[_f] = _z
track_shot(camB2, SHOT_B2[0], SHOT_B2[1],
           lambda f, k: hero_pos(f, k)[0] + Vector((0, 0, 0.62)), lag=0.085, noise_deg=0.04, seed=5.0,
           lens_fn=lambda f: _zoomB2[f])

# C：出弯内侧低机位摇摄
xc, yc, hdc = T.offset_point(MC1 + 34.0, -(T.HALF_W + 1.6))
camC = make_cam("Cam_C", Vector((xc, yc, 0.55)), 50.0, 4.0)
# 摄影师随距离变焦：让主角在画面里大小大致稳定（带滞后）
_zoomC = {}
_z = None
for _f in range(SHOT_C[0] - 24, NF + 2):
    _ff = max(0, min(NF + 1, _f))
    _d = (hero_pos(_ff)[0] - camC.location).length
    _want = max(38.0, min(150.0, 3.5 * _d))
    _z = _want if _z is None else _z + (_want - _z) * (1 - math.exp(-(1.0 / M.FPS) / 0.22))
    _zoomC[_f] = _z
track_shot(camC, SHOT_C[0], SHOT_C[1],
           lambda f, k: hero_pos(f, k)[0] + Vector((0, 0, 0.6)), lag=0.09, noise_deg=0.05, seed=3.0,
           lens_fn=lambda f: _zoomC[f])

# 时间线标记绑定机位
for m in list(sc.timeline_markers):
    sc.timeline_markers.remove(m)
for name, cam, f in (("A", camA, SHOT_A[0]), ("B", camB, SHOT_B[0]), ("B2", camB2, SHOT_B2[0]), ("C", camC, SHOT_C[0])):
    mk = sc.timeline_markers.new(name, frame=f)
    mk.camera = cam
sc.camera = camA
sc["shots"] = str({"A": SHOT_A, "B": SHOT_B, "B2": SHOT_B2, "C": SHOT_C})
sc["camB2_xy"] = (camB2.location.x, camB2.location.y)
print("cams:", [(c.name, tuple(round(v, 1) for v in c.location)) for c in (camA, camB, camB2, camC)])
print("ANIM_OK")
