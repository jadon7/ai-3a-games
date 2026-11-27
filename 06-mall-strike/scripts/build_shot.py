"""Assemble the full 20 s FPS shot on top of mall.blend.
Run: Blender -b blend/mall.blend -P scripts/build_shot.py"""
import bpy, sys, os, math, random, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix, Euler, Quaternion
from lib import *
import fps_rig as fr
import viewmodel as VMOD
from gpu_setup import enable_gpu

random.seed(11)
enable_gpu()
PREF = bpy.context.preferences.edit
PREF.keyframe_new_interpolation_type = "LINEAR"


def action_fcurves(ob):
    ad = ob.animation_data
    if not ad or not ad.action:
        return []
    a = ad.action
    try:
        return list(a.fcurves)
    except AttributeError:
        pass
    out = []
    for layer in a.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out += list(cb.fcurves)
    return out
sc = bpy.context.scene
sc.render.fps = 30
F0, F1 = 1, 600
sc.frame_start, sc.frame_end = F0, F1
EV = {"fps": 30, "frames": F1, "shots": [], "enemy_shots": [], "hits": [], "kills": [], "frame": {}}

# ------------------------------------------------------------------ environment tweaks
for n in ("Slab_-1", "Slab_1"):
    pass
M_CEIL = principled("ceiling_white", (0.86, 0.86, 0.85), rough=0.85, noise_rough=0.05)
for o in bpy.data.objects:
    if o.name.startswith(("Slab_", "Bridge_", "UpCeil_")) and o.type == "MESH":
        o.data.materials.clear(); o.data.materials.append(M_CEIL)
haze = bpy.data.materials.get("haze")
if haze:
    pv = next(n for n in haze.node_tree.nodes if n.type == "PRINCIPLED_VOLUME")
    pv.inputs["Density"].default_value = 0.0055

# ------------------------------------------------------------------ helpers
def smooth(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def piecewise(keys, f):
    """keys: list of (frame, value(tuple)); smooth interpolation."""
    if f <= keys[0][0]: return Vector(keys[0][1])
    for (fa, va), (fb, vb) in zip(keys, keys[1:]):
        if fa <= f <= fb:
            t = (f - fa) / (fb - fa)
            return Vector(va).lerp(Vector(vb), t)
    return Vector(keys[-1][1])


def path_pos(keys, f):
    """Linear path with constant speed per segment."""
    return piecewise(keys, f)


C_FX = coll("FX")
C_EN = coll("Enemies")

# ------------------------------------------------------------------ player camera + viewmodel
cam_d = bpy.data.cameras.new("PlayerCam"); cam_d.lens = 18; cam_d.clip_start = 0.01; cam_d.sensor_width = 36
cam = bpy.data.objects.new("PlayerCam", cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam.rotation_mode = "XYZ"
VMR = VMOD.build(cam)
vm, rifle, parm, reticle = VMR["vm"], VMR["rifle"], VMR["arm"], VMR["reticle"]
ik_l = bpy.data.objects["IK_L"]
IK_L_REST = ik_l.location.copy()

# player path (x, y) keyframes
P_PATH = [(1, (-3.6, -0.5)), (95, (-3.4, 4.1)), (140, (-3.4, 4.9)), (200, (-3.6, 8.0)), (250, (-3.8, 9.0)),
          (305, (-4.0, 12.4)), (350, (-4.0, 13.2)), (430, (-3.8, 16.6)), (480, (-3.6, 17.2)), (600, (-3.2, 21.4))]

# push props that sit on the walking path out of the way
def _seg_dist(p, a, b):
    ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length, a + ab * t
_pts = [Vector((xy[0], xy[1], 0)) for _, xy in P_PATH]
for o in list(bpy.data.objects):
    if o.type == "EMPTY" and o.instance_collection and o.users_collection and o.users_collection[0].name == "Props":
        p = Vector((o.location.x, o.location.y, 0))
        best = min((_seg_dist(p, a, b) for a, b in zip(_pts, _pts[1:])), key=lambda t: t[0])
        if best[0] < 0.95:
            away = (p - best[1]); away = away.normalized() if away.length > 1e-3 else Vector((1, 0, 0))
            o.location.x, o.location.y = (best[1] + away * 1.0).x, (best[1] + away * 1.0).y
            print("moved prop", o.name, tuple(round(v, 2) for v in o.location))
EYE = 1.66

# ------------------------------------------------------------------ enemies
ENEMY_DEFS = {
    "E1": dict(tag="enemy_b", mode="run", path=[(88, (12.6, 20.3, 0.0)), (163, (4.0, 13.0, 0.0))], hit=133, chest=1.3),
    "E2": dict(tag="enemy_a", mode="run", path=[(175, (12.5, 28.2, 5.0)), (300, (-6.2, 27.7, 5.0))], hit=238, chest=1.3),
    "E3": dict(tag="enemy_b", mode="shoot", path=[(1, (2.55, 19.95, 0.0)), (600, (2.55, 19.95, 0.0))], hit=338, chest=0.95,
               face=(-4.0, 12.8), vis=285),
    "E4": dict(tag="enemy_a", mode="run", path=[(432, (-13.6, 19.6, 0.0)), (448, (-11.2, 19.5, 0.0)), (480, (-6.4, 16.6, 0.0))],
               hit=461, chest=1.3),
}
_char_cache = {}


def make_enemy(name, d):
    tag = d["tag"]
    if tag not in _char_cache:
        arm, mesh, acts = fr.import_character(tag, ["anim_loop_model_url.glb", "anim_react_model_url.glb"], C_EN, 1.8, name=f"{tag}_src")
        if len(mesh.data.vertices) > 200000:
            dec = mesh.modifiers.new("dec", "DECIMATE"); dec.ratio = 0.14
            with bpy.context.temp_override(object=mesh, active_object=mesh):
                bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
                bpy.ops.object.modifier_apply(modifier="dec")
        _char_cache[tag] = (arm, mesh, acts)
        arm.name, mesh.name = name + "_rig", name + "_mesh"
        return arm, mesh, acts
    a0, m0, acts = _char_cache[tag]
    arm = a0.copy(); C_EN.objects.link(arm); arm.name = name + "_rig"
    if arm.animation_data:
        arm.animation_data_clear()
    mesh = m0.copy(); C_EN.objects.link(mesh); mesh.name = name + "_mesh"
    if mesh.animation_data:
        mesh.animation_data_clear()
    mesh.parent = arm
    for m in mesh.modifiers:
        if m.type == "ARMATURE": m.object = arm
    return arm, mesh, acts


def nla_strip(arm, action, start, a0, a1, name, repeat=1.0, scale=1.0, blend_in=0.0):
    ad = arm.animation_data or arm.animation_data_create()
    tr = ad.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, int(start), action)
    try:
        st.action_slot = action.slots[0]
    except Exception:
        pass
    st.action_frame_start, st.action_frame_end = a0, a1
    st.scale = scale
    st.repeat = repeat
    st.blend_in = blend_in
    st.extrapolation = "HOLD_FORWARD"
    st.use_auto_blend = False
    return st


ENEMIES = {}
for name, d in ENEMY_DEFS.items():
    arm, mesh, acts = make_enemy(name, d)
    arm.rotation_mode = "XYZ"
    hit = d["hit"]
    # tint E3 jacket a bit so he reads as a different person
    if name == "E3":
        for slot in mesh.material_slots:
            m = slot.material
            mm = m.copy(); slot.link = "OBJECT"; slot.material = mm
            b = next((n for n in mm.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if b and b.inputs["Base Color"].is_linked:
                src = b.inputs["Base Color"].links[0].from_socket
                hs = mm.node_tree.nodes.new("ShaderNodeHueSaturation")
                hs.inputs["Hue"].default_value = 0.42; hs.inputs["Saturation"].default_value = 0.55; hs.inputs["Value"].default_value = 0.8
                mm.node_tree.links.new(src, hs.inputs["Color"]); mm.node_tree.links.new(hs.outputs[0], b.inputs["Base Color"])
    # ----- motion
    path = d["path"]
    if d["mode"] == "run":
        run = acts["run"]
        nla_strip(arm, run, 1, 1, 38, "run", repeat=40)
        fall_st = nla_strip(arm, acts["fall"], hit, 14, 91, "fall", scale=0.75, blend_in=4)
    else:
        sh = acts["shoot"]
        nla_strip(arm, sh, 1, 40, 272, "shoot", repeat=4)
        fall_st = nla_strip(arm, acts["fall"], hit, 30, 91, "fall", scale=0.75, blend_in=4)
    d["arm"], d["mesh"] = arm, mesh
    # measure hips offset of the looping action in object space (in-place run keeps hips ~0.9 m ahead)
    arm.location = (0, 0, 0); arm.rotation_euler = (0, 0, 0)
    probe = 300 if d["mode"] == "shoot" else 20
    sc.frame_set(probe)
    hp = arm.matrix_world @ arm.pose.bones["mixamorig:Hips"].head
    off = Vector((hp.x, hp.y, 0))
    d["hip_off"] = off
    print("HIP OFFSET", name, tuple(round(v, 3) for v in off))
    # root keyframes (stop at hit)
    prev = None
    for f in range(F0, F1 + 1, 1):
        ff = min(f, hit)
        p = path_pos(path, ff)
        if f < path[0][0]:
            p = Vector(path[0][1])
        nxt = path_pos(path, min(ff + 2, path[-1][0])) if ff < path[-1][0] else None
        if d.get("face"):
            fd = Vector((d["face"][0] - p.x, d["face"][1] - p.y, 0))
        elif nxt is not None and (nxt - p).length > 1e-4:
            fd = nxt - p
        else:
            fd = prev if prev is not None else Vector((-1, 0, 0))
        prev = fd
        yaw = fr.yaw_to_face(arm, fd)
        arm.location = p - Matrix.Rotation(yaw, 3, "Z") @ off
        arm.rotation_euler = (0, 0, yaw)
        if f % 2 == 1 or f in (hit, hit - 1, hit + 1):
            arm.keyframe_insert("location", frame=f); arm.keyframe_insert("rotation_euler", frame=f)
    # hide before entrance (E1 starts inside store anyway); hide E4 before it appears
    vis_from = path[0][0] - 2 if d["mode"] == "run" else d.get("vis", F0)
    for o in (arm, mesh):
        o.hide_render = True; o.keyframe_insert("hide_render", frame=F0)
        o.hide_render = False; o.keyframe_insert("hide_render", frame=max(F0, vis_from))
    ENEMIES[name] = d

# ----- enemy rifles: chest-mounted, IK both hands
for name, d in ENEMIES.items():
    arm = d["arm"]
    fwd, up, left = fr.char_basis(arm)
    right = -left
    r = bpy.data.objects.new(name + "_rifle", rifle.data); C_EN.objects.link(r)
    r.scale = (fr.RIFLE_SCALE,) * 3
    # desired rifle frame in armature rest space (unscaled armature units * 1.8 => metres)
    sp = arm.data.bones["mixamorig:Spine2"]
    chest = sp.head_local * 1.8
    if d["mode"] == "shoot":
        rf = (fwd).normalized(); ru = up
        org = chest + fwd * 0.28 + up * 0.10 + right * 0.10
    else:
        rf = (fwd * 0.85 - up * 0.35 + left * 0.38).normalized()
        ru = (up - up.project(rf)).normalized()
        org = chest + fwd * 0.22 - up * 0.02 + right * 0.06
    rr = rf.cross(ru)
    Rm = Matrix((rr, rf, ru)).transposed()  # rifle local X=right, Y=fwd, Z=up
    rest_rifle = Matrix.Translation(org) @ Rm.to_4x4()
    bone_rest = Matrix.Translation(sp.head_local * 1.8) @ sp.matrix_local.to_3x3().normalized().to_4x4()
    con = r.constraints.new("CHILD_OF"); con.target = arm; con.subtarget = "mixamorig:Spine2"
    con.use_scale_x = con.use_scale_y = con.use_scale_z = False
    con.inverse_matrix = Matrix.Identity(4)
    basis = bone_rest.inverted() @ rest_rifle
    loc, rot, _ = basis.decompose()
    r.rotation_mode = "QUATERNION"
    r.location = loc; r.rotation_quaternion = rot
    d["rifle"], d["rifle_con"] = r, con
    vis_from = d["path"][0][0] - 2 if d["mode"] == "run" else d.get("vis", F0)
    r.hide_render = True; r.keyframe_insert("hide_render", frame=F0)
    r.hide_render = False; r.keyframe_insert("hide_render", frame=max(F0, vis_from))
    # IK targets parented to rifle
    def tgt(nm, p_r, fd_r, pd_r, side):
        e = bpy.data.objects.new(f"{name}_{nm}", None); C_EN.objects.link(e); e.parent = r
        fdv, pdv = Vector(fd_r).normalized(), Vector(pd_r).normalized()
        wrist = Vector(p_r) * 1.0 - (pdv * 0.045 + fdv * 0.075) / fr.RIFLE_SCALE
        q = fr.hand_target_rotation(arm, f"mixamorig:{side}Hand", fdv, pdv)
        e.location = wrist
        e.rotation_mode = "QUATERNION"; e.rotation_quaternion = q
        return e
    # NB: target orientation must be world-space; compensate parent rotation at runtime via COPY_ROTATION in world space
    tr_ = tgt("IKR", fr.P_GRIP, (-0.05, 0.9, 0.15), (-1, 0, -0.1), "Right")
    tl_ = tgt("IKL", fr.P_HANDGUARD, (0.75, 0.6, 0.05), (0, -0.1, 1), "Left")
    pr_ = bpy.data.objects.new(f"{name}_poleR", None); C_EN.objects.link(pr_); pr_.parent = arm
    pr_.location = (chest + right * 0.6 - up * 0.5 - fwd * 0.2) / 1.8
    pl_ = bpy.data.objects.new(f"{name}_poleL", None); C_EN.objects.link(pl_); pl_.parent = arm
    pl_.location = (chest + left * 0.6 - up * 0.6 + fwd * 0.1) / 1.8
    ikr, crr = fr.add_arm_ik(arm, "Right", tr_, pr_)
    ikl, crl = fr.add_arm_ik(arm, "Left", tl_, pl_)
    # child objects of the rifle inherit the rifle rotation; the hand rotation we computed is rifle-relative,
    # so copy rotation must be taken in the rifle's space: use target LOCAL space mixing
    for crc in (crr, crl):
        crc.target_space = "WORLD"; crc.owner_space = "WORLD"
    d["iks"] = [ikr, ikl, crr, crl]

# The IK target empties carry rifle-relative rotations; convert to world by making them proper children:
bpy.context.view_layer.update()
for name, d in ENEMIES.items():
    for side in ("IKR", "IKL"):
        e = bpy.data.objects[f"{name}_{side}"]
        # e.rotation is rifle-local "hand-in-rifle" rotation already (parent applies rifle rot) => fine
        pass

# ----- deaths: release rifle, disable IK
def bake_world(obj, f):
    sc.frame_set(f)
    return obj.matrix_world.copy()


for name, d in ENEMIES.items():
    hit = d["hit"]
    r, con = d["rifle"], d["rifle_con"]
    for c_ in d["iks"]:
        c_.influence = 1.0; c_.keyframe_insert("influence", frame=hit + 1)
        c_.influence = 0.0; c_.keyframe_insert("influence", frame=hit + 5)
    mw = bake_world(r, hit + 2)
    off_loc, off_rot = r.location.copy(), r.rotation_quaternion.copy()
    PREF.keyframe_new_interpolation_type = "CONSTANT"
    con.influence = 1.0; con.keyframe_insert("influence", frame=hit + 2)
    con.influence = 0.0; con.keyframe_insert("influence", frame=hit + 3)
    r.keyframe_insert("location", frame=F0); r.keyframe_insert("rotation_quaternion", frame=F0)
    r.keyframe_insert("location", frame=hit + 2); r.keyframe_insert("rotation_quaternion", frame=hit + 2)
    PREF.keyframe_new_interpolation_type = "LINEAR"
    loc, rot, _ = mw.decompose()
    # basis before release is ignored (constraint at 1); after release basis = world
    r.location = loc; r.rotation_quaternion = rot
    r.keyframe_insert("location", frame=hit + 3); r.keyframe_insert("rotation_quaternion", frame=hit + 3)
    floor_z = d["path"][0][1][2] + 0.035
    drop = loc.copy(); drop.z = floor_z
    drop += Vector((random.uniform(-0.4, 0.4), random.uniform(-0.4, 0.4), 0))
    r.location = drop
    r.rotation_quaternion = Euler((math.radians(90 + random.uniform(-8, 8)), 0, random.uniform(0, 6.28))).to_quaternion()
    r.keyframe_insert("location", frame=hit + 14); r.keyframe_insert("rotation_quaternion", frame=hit + 14)
    r.location = drop + Vector((0.05, 0.02, 0)); r.keyframe_insert("location", frame=hit + 18)
    d["drop"] = drop

# ------------------------------------------------------------------ player shots & look
SHOTS = {  # player bursts: frames
    "E1": [128, 130, 133, 135, 138],
    "E2": [232, 234, 236, 239, 241, 244],
    "E3": [333, 335, 338, 340, 343],
    "E4": [455, 457, 459, 461, 463, 466],
}
HITS = {"E1": [133, 135], "E2": [236, 239], "E3": [338, 340], "E4": [459, 461]}
E3_FIRE = [318, 320, 323, 325, 328, 331, 334]
RELOAD = (505, 562)


def enemy_chest(name, f):
    d = ENEMIES[name]
    p = path_pos(d["path"], min(f, d["hit"]))
    if f < d["path"][0][0]:
        p = Vector(d["path"][0][1])
    return p + Vector((0, 0, d["chest"]))


LOOK = [  # (frame, kind, data) kinds: 'pt' world point, 'en' enemy name
    (1, "pt", (2.5, 30.0, 2.2)), (70, "pt", (4.5, 26.0, 2.0)), (100, "en", "E1"), (150, "pt", (2.0, 26.0, 3.0)),
    (195, "pt", (3.0, 28.0, 6.4)), (212, "en", "E2"), (262, "pt", (-9.0, 22.0, 1.8)), (300, "pt", (2.5, 21.0, 1.3)),
    (312, "en", "E3"), (360, "pt", (-1.0, 30.0, 1.8)), (420, "pt", (-4.0, 26.0, 1.7)), (440, "en", "E4"),
    (482, "pt", (-1.0, 32.0, 1.6)), (600, "pt", (0.5, 40.0, 1.9)),
]
BLEND = 16


def look_point(f):
    """World point the player looks at, blending between segments."""
    seg = 0
    for i, (fa, k, dta) in enumerate(LOOK):
        if f >= fa: seg = i
    def val(i):
        fa, k, dta = LOOK[i]
        if k == "pt": return Vector(dta)
        return enemy_chest(dta, f) + Vector((0, 0, 0.05))
    cur = val(seg)
    if seg > 0 and f - LOOK[seg][0] < BLEND:
        w = smooth((f - LOOK[seg][0]) / BLEND)
        return val(seg - 1).lerp(cur, w), LOOK[seg]
    return cur, LOOK[seg]


def ads_weight(f):
    wins = [(108, 150), (222, 256), (322, 352)]
    a = 0.0
    for (s, e) in wins:
        a = max(a, smooth((f - s) / 7.0) * (1 - smooth((f - e) / 8.0)))
    return a


def all_player_shots():
    out = []
    for k, v in SHOTS.items():
        out += [(f, k) for f in v]
    return sorted(out)


PSHOTS = all_player_shots()


def recoil(f):
    """pitch up (rad), yaw, VM kick back (m), VM pitch"""
    p = y = kb = kp = 0.0
    for (fs, k) in PSHOTS:
        dt = f - fs
        if 0 <= dt < 14:
            e = math.exp(-dt / 3.0)
            rnd = random.Random(fs)
            p += math.radians(0.75) * e
            y += math.radians(rnd.uniform(-0.35, 0.35)) * e
            kb += 0.028 * math.exp(-dt / 1.6)
            kp += math.radians(2.2) * math.exp(-dt / 2.0)
    return p, y, kb, kp


def incoming_shake(f):
    s = Vector((0, 0, 0))
    for fs in E3_FIRE:
        dt = f - fs - 1
        if 0 <= dt < 8:
            rnd = random.Random(fs * 7)
            s += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * math.radians(0.35) * math.exp(-dt / 2.5)
    return s


cam_pos_cache = {}
prev_yaw = None
ammo = 30
for f in range(F0, F1 + 1):
    xy = path_pos(P_PATH, f)
    # speed for bob
    xy2 = path_pos(P_PATH, min(f + 1, F1))
    spd = (xy2 - xy).length * 30.0
    a = ads_weight(f)
    phase = f / 16.5 * math.pi
    bob = 0.014 * math.sin(2 * phase) * min(1.0, spd / 1.2) * (1 - 0.6 * a)
    sway = 0.009 * math.sin(phase) * min(1.0, spd / 1.2) * (1 - 0.6 * a)
    pos = Vector((xy.x, xy.y, EYE + bob))
    tgt, seg = look_point(f)
    d = (tgt - pos).normalized()
    yaw = math.atan2(d.y, d.x)
    pitch = math.asin(max(-1, min(1, d.z)))
    rp, ry, kb, kp = recoil(f)
    sh = incoming_shake(f)
    # micro hand-held noise
    nz_y = 0.0035 * math.sin(f * 0.37) + 0.002 * math.sin(f * 0.91 + 1.3)
    nz_p = 0.003 * math.sin(f * 0.29 + 0.7) + 0.0015 * math.sin(f * 1.13)
    yaw_f = yaw + ry + sh.x + nz_y * (1 - 0.5 * a)
    pitch_f = pitch + rp + sh.y + nz_p * (1 - 0.5 * a)
    # camera: Blender camera looks -Z; build rotation from yaw/pitch
    fwd = Vector((math.cos(pitch_f) * math.cos(yaw_f), math.cos(pitch_f) * math.sin(yaw_f), math.sin(pitch_f)))
    right = Vector((math.sin(yaw_f), -math.cos(yaw_f), 0))
    pos_s = pos + right * sway
    q = fwd.to_track_quat("-Z", "Y")
    roll = math.radians(0.6) * math.sin(phase) * min(1.0, spd / 1.2) * (1 - a)
    q = q @ Quaternion((0, 0, 1), roll)
    cam.location = pos_s
    cam.rotation_euler = q.to_euler("XYZ", cam.rotation_euler)
    cam.keyframe_insert("location", frame=f); cam.keyframe_insert("rotation_euler", frame=f)
    cam_d.lens = lerp(18.0, 34.0, a); cam_d.keyframe_insert("lens", frame=f)
    # viewmodel pose
    dyaw = 0.0 if prev_yaw is None else (yaw - prev_yaw + math.pi) % (2 * math.pi) - math.pi
    prev_yaw = yaw
    hl, hr = VMOD.HIP["loc"], VMOD.HIP["rot"]
    al, ar = VMOD.ADS["loc"], VMOD.ADS["rot"]
    loc = hl.lerp(al, a)
    rot = Vector(hr[:]).lerp(Vector(ar[:]), a)
    inertia = max(-0.08, min(0.08, -dyaw * 2.2)) * (1 - 0.7 * a)
    loc = loc + Vector((inertia * 0.25, bob * 0.8 + 0.006 * math.sin(2 * phase) * (1 - a), kb))
    rot = rot + Vector((kp + bob * 0.6, inertia * 0.5, inertia * 0.8 + sway * 2.0))
    # reload: rifle tilts right/down, left hand goes to magazine and back
    rl = 0.0
    if RELOAD[0] <= f <= RELOAD[1]:
        t = (f - RELOAD[0]) / (RELOAD[1] - RELOAD[0])
        rl = smooth(t / 0.2) * (1 - smooth((t - 0.8) / 0.2))
        loc = loc + Vector((-0.03, -0.04, 0.04)) * rl
        rot = rot + Vector((math.radians(-8), math.radians(-25), math.radians(12))) * rl
        # hand path: handguard -> magazine (pull) -> below -> magazine (insert) -> handguard
        mag = Vector(fr.P_MAG) + Vector((-0.03, 0.0, -0.05))
        below = mag + Vector((-0.05, -0.05, -0.35))
        if t < 0.25: hp = IK_L_REST.lerp(mag, smooth(t / 0.25))
        elif t < 0.45: hp = mag.lerp(below, smooth((t - 0.25) / 0.2))
        elif t < 0.65: hp = below.lerp(mag, smooth((t - 0.45) / 0.2))
        else: hp = mag.lerp(IK_L_REST, smooth((t - 0.65) / 0.35))
        ik_l.location = hp
    else:
        ik_l.location = IK_L_REST
    ik_l.keyframe_insert("location", frame=f)
    vm.location = loc; vm.rotation_euler = Euler(rot)
    vm.keyframe_insert("location", frame=f); vm.keyframe_insert("rotation_euler", frame=f)
    reticle.hide_render = a < 0.7; reticle.keyframe_insert("hide_render", frame=f)
    # ammo
    if any(fs == f for fs, _ in PSHOTS): ammo -= 1
    if f == RELOAD[0] + 40: ammo = 30
    EV["frame"][f] = dict(ads=round(a, 3), yaw=round(math.degrees(yaw_f), 2), pitch=round(math.degrees(pitch_f), 2),
                          x=round(pos.x, 3), y=round(pos.y, 3), ammo=ammo, reload=round(rl, 3))
    cam_pos_cache[f] = (pos_s.copy(), fwd.copy())



# ------------------------------------------------------------------ FX materials
def fx_mat(name, color, strength, alpha_noise=True, emissive_mode=True):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    oi = nt.nodes.new("ShaderNodeObjectInfo")
    # radial falloff * noise
    sub = nt.nodes.new("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"; sub.inputs[1].default_value = (0.5, 0.5, 0)
    nt.links.new(tc.outputs["UV"], sub.inputs[0])
    ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"; nt.links.new(sub.outputs[0], ln.inputs[0])
    rad = nt.nodes.new("ShaderNodeMapRange"); rad.inputs[1].default_value = 0.5; rad.inputs[2].default_value = 0.05
    nt.links.new(ln.outputs[1], rad.inputs[0])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 4.5; nz.inputs["Detail"].default_value = 6
    nz.noise_dimensions = "4D"
    nt.links.new(tc.outputs["UV"], nz.inputs["Vector"]); nt.links.new(oi.outputs["Random"], nz.inputs["W"])
    nr = nt.nodes.new("ShaderNodeMapRange"); nr.inputs[1].default_value = 0.35; nr.inputs[2].default_value = 0.7
    nt.links.new(nz.outputs[0], nr.inputs[0])
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
    nt.links.new(rad.outputs[0], mul.inputs[0]); nt.links.new(nr.outputs[0], mul.inputs[1])
    mul2 = nt.nodes.new("ShaderNodeMath"); mul2.operation = "MULTIPLY"
    nt.links.new(mul.outputs[0], mul2.inputs[0]); nt.links.new(oi.outputs["Alpha"], mul2.inputs[1])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    if emissive_mode:
        sh = nt.nodes.new("ShaderNodeEmission"); sh.inputs[0].default_value = (*color, 1); sh.inputs[1].default_value = strength
    else:
        sh = nt.nodes.new("ShaderNodeBsdfPrincipled"); sh.inputs["Base Color"].default_value = (*color, 1)
        sh.inputs["Roughness"].default_value = 1.0
        sh.inputs["Subsurface Weight"].default_value = 0.0
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(mul2.outputs[0], mix.inputs[0]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(sh.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


M_FLASH = fx_mat("muzzle_flash", (1.0, 0.55, 0.18), 60.0)
M_BLOOD = fx_mat("blood_mist", (0.16, 0.012, 0.01), 0, emissive_mode=False)
M_DUST = fx_mat("impact_dust", (0.55, 0.52, 0.48), 0, emissive_mode=False)
M_SPARK = emissive("spark", (1.0, 0.7, 0.3), 80)
M_BRASS = principled("brass", (0.85, 0.62, 0.3), rough=0.25, metal=1.0)
M_HOLE = principled("bullet_hole", (0.02, 0.018, 0.016), rough=0.9)


def card(name, size, mat, parent=None, c=C_FX):
    me = bpy.data.meshes.new(name)
    s = size / 2
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    me.uv_layers.new(); uv = me.uv_layers[0].data
    for i, (u, v) in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))): uv[i].uv = (u, v)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); c.objects.link(ob)
    if parent: ob.parent = parent
    ob.visible_shadow = False
    return ob


def key_vis(ob, frames_on, f_all=(F0, F1)):
    """Scale-based visibility with constant interpolation."""
    ob.scale = (0, 0, 0); ob.keyframe_insert("scale", frame=f_all[0])
    for f, s in frames_on:
        ob.scale = (s, s, s); ob.keyframe_insert("scale", frame=f)
    for fc in ob.animation_data.action.fcurves if hasattr(ob.animation_data.action, "fcurves") else []:
        for k in fc.keyframe_points: k.interpolation = "CONSTANT"


def set_constant(ob):
    for fc in action_fcurves(ob):
        for k in fc.keyframe_points: k.interpolation = "CONSTANT"


# ------------------------------------------------------------------ player muzzle flash + light
def make_flash(parent, muzzle_local, name, scale_mul=1.0, light_power=900):
    root = bpy.data.objects.new(name, None); C_FX.objects.link(root); root.parent = parent
    root.location = muzzle_local
    root.rotation_mode = "XYZ"
    cards = []
    # side cards (cross) along barrel axis (+Y local of rifle)
    for i, rot in enumerate(((0, 0, 0), (0, math.pi / 2, 0))):
        cd = card(f"{name}_c{i}", 1.0, M_FLASH, root)
        cd.rotation_euler = rot  # planes containing the barrel (+Y) axis
        cd.scale = (0.5, 1.0, 1.0)
        cd.location = (0, 0.5, 0)
        cards.append(cd)
    front = card(f"{name}_front", 0.55, M_FLASH, root)
    front.rotation_euler = (math.pi / 2, 0, 0)
    front.location = (0, 0.05, 0)
    cards.append(front)
    for cd in cards:
        cd.visible_diffuse = cd.visible_glossy = False
    ld = bpy.data.lights.new(name + "_L", "POINT"); ld.energy = 0; ld.color = (1.0, 0.62, 0.3); ld.shadow_soft_size = 0.05
    lo = bpy.data.objects.new(name + "_L", ld); C_FX.objects.link(lo); lo.parent = parent
    lo.location = muzzle_local + Vector((0, 0.3, 0.02))
    try:
        ex = bpy.data.collections.new(name + "_exclude")
        ex.objects.link(parent)
        for ch in parent.children:
            if ch.type == "MESH": ex.objects.link(ch)
        lo.light_linking.receiver_collection = ex
        for co in ex.collection_objects:
            co.light_linking.link_state = "EXCLUDE"
        print("light linking ok", name)
    except Exception as exn:
        print("light linking failed", exn)
    try:
        lo.visible_volume_scatter = False
    except Exception as ex:
        print("vol vis", ex)
    return root, ld


PREF.keyframe_new_interpolation_type = "CONSTANT"
fl_root, fl_light = make_flash(rifle, fr.P_MUZZLE + Vector((0, 0.01, 0)), "PFlash")
# rifle is scaled 0.855; flash size ~0.22m long => local 0.26
fl_root.scale = (0, 0, 0); fl_root.keyframe_insert("scale", frame=F0)
fl_light.energy = 0; fl_light.keyframe_insert("energy", frame=F0)
for (fs, k) in PSHOTS:
    rnd = random.Random(fs)
    s = rnd.uniform(0.2, 0.3)
    fl_root.scale = (s, s * rnd.uniform(0.9, 1.4), s); fl_root.rotation_euler = (0, rnd.uniform(0, 6.28), 0)
    fl_root.keyframe_insert("scale", frame=fs - 0.49); fl_root.keyframe_insert("rotation_euler", frame=fs - 0.49)
    fl_root.scale = (0, 0, 0); fl_root.keyframe_insert("scale", frame=fs + 0.49)
    fl_light.energy = rnd.uniform(220, 320); fl_light.keyframe_insert("energy", frame=fs - 0.49)
    fl_light.energy = 0; fl_light.keyframe_insert("energy", frame=fs + 0.49)
set_constant(fl_root)
set_constant(fl_light)

# E3 muzzle flash
e3r = ENEMIES["E3"]["rifle"]
e3_root, e3_light = make_flash(e3r, fr.P_MUZZLE + Vector((0, 0.01, 0)), "E3Flash")
e3_root.scale = (0, 0, 0); e3_root.keyframe_insert("scale", frame=F0)
e3_light.energy = 0; e3_light.keyframe_insert("energy", frame=F0)
for fs in E3_FIRE:
    rnd = random.Random(fs + 99)
    s = rnd.uniform(0.35, 0.5)
    e3_root.scale = (s, s, s); e3_root.rotation_euler = (0, rnd.uniform(0, 6.28), 0)
    e3_root.keyframe_insert("scale", frame=fs - 0.49); e3_root.keyframe_insert("rotation_euler", frame=fs - 0.49)
    e3_root.scale = (0, 0, 0); e3_root.keyframe_insert("scale", frame=fs + 0.49)
    e3_light.energy = 1200; e3_light.keyframe_insert("energy", frame=fs - 0.49)
    e3_light.energy = 0; e3_light.keyframe_insert("energy", frame=fs + 0.49)
set_constant(e3_root)
set_constant(e3_light)

PREF.keyframe_new_interpolation_type = "LINEAR"
# ------------------------------------------------------------------ shell casings (world space ballistic)
bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.0048, depth=0.045)
casing_src = bpy.context.active_object; casing_src.name = "Casing_src"
link(casing_src, C_FX); casing_src.data.materials.append(M_BRASS); casing_src.hide_render = True
for i, (fs, k) in enumerate(PSHOTS):
    sc.frame_set(fs)
    ep = rifle.matrix_world @ fr.P_EJECT
    R = rifle.matrix_world.to_3x3().normalized()
    rnd = random.Random(fs * 3)
    v = R @ Vector((rnd.uniform(2.2, 3.0), rnd.uniform(-0.6, -0.2), rnd.uniform(0.8, 1.5)))
    cs = bpy.data.objects.new(f"Casing{i}", casing_src.data); C_FX.objects.link(cs)
    cs.rotation_mode = "XYZ"
    cs.hide_render = True; cs.keyframe_insert("hide_render", frame=F0)
    cs.hide_render = False; cs.keyframe_insert("hide_render", frame=fs)
    cs.hide_render = True; cs.keyframe_insert("hide_render", frame=fs + 12)
    spin = Vector((rnd.uniform(20, 40), rnd.uniform(-10, 10), rnd.uniform(-30, 30)))
    for j in range(0, 12):
        t = j / 30.0
        p = ep + v * t + Vector((0, 0, -4.9 * t * t))
        cs.location = p
        cs.rotation_euler = (spin * t)[:]
        cs.keyframe_insert("location", frame=fs + j); cs.keyframe_insert("rotation_euler", frame=fs + j)
    EV["shots"].append(dict(f=fs, target=k))

# ------------------------------------------------------------------ hits: blood mist / impacts
def puff(name, pos, mat, f, size0, size1, life, alpha0=1.0, rise=0.0, drift=Vector((0, 0, 0))):
    cd = card(name, 1.0, mat)
    cd.rotation_mode = "QUATERNION"
    cd.color = (1, 1, 1, 0)
    cd.scale = (0, 0, 0); cd.keyframe_insert("scale", frame=F0); cd.keyframe_insert("color", frame=F0)
    cd.keyframe_insert("scale", frame=f - 0.5); cd.keyframe_insert("color", frame=f - 0.5)
    for j in range(0, life + 1):
        ff = f + j
        t = j / life
        s = lerp(size0, size1, 1 - (1 - t) ** 2)
        cp, _ = cam_pos_cache.get(ff, cam_pos_cache[F1])
        p = pos + drift * t + Vector((0, 0, rise * t))
        cd.location = p
        cd.rotation_quaternion = (cp - p).to_track_quat("Z", "Y")
        cd.scale = (s, s, s)
        cd.color = (1, 1, 1, alpha0 * (1 - t) ** 1.5)
        cd.keyframe_insert("location", frame=ff); cd.keyframe_insert("rotation_quaternion", frame=ff)
        cd.keyframe_insert("scale", frame=ff); cd.keyframe_insert("color", frame=ff)
    cd.scale = (0, 0, 0); cd.keyframe_insert("scale", frame=f + life + 1)
    return cd


hit_list = []
for name, frames in HITS.items():
    for k_, fh in enumerate(frames):
        cp, cf = cam_pos_cache[fh]
        ch = enemy_chest(name, fh)
        rnd = random.Random(fh)
        off = Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), rnd.uniform(-0.15, 0.2)))
        hp = ch + off + (cp - ch).normalized() * 0.1
        back = (ch - cp).normalized()
        puff(f"Blood{name}{k_}", hp, M_BLOOD, fh, 0.12, 0.65, 9, 0.95, drift=back * 0.25)
        puff(f"Blood2{name}{k_}", hp + back * 0.15, M_BLOOD, fh + 1, 0.08, 0.45, 7, 0.8, drift=back * 0.45 + Vector((0, 0, -0.1)))
        EV["hits"].append(dict(f=fh, enemy=name))
    EV["kills"].append(dict(f=frames[-1] + 1, enemy=name))

# misses: ray cast for non-hit shots and E3's shots near player
dg = bpy.context.evaluated_depsgraph_get()
for (fs, k) in PSHOTS:
    if fs in HITS.get(k, []):
        continue
    sc.frame_set(fs)
    dg = bpy.context.evaluated_depsgraph_get()
    cp, cf = cam_pos_cache[fs]
    rnd = random.Random(fs * 13)
    tgt = enemy_chest(k, fs) + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(-0.3, 0.6)))
    dirv = (tgt - cp).normalized()
    hit, loc, nrm, idx, ob, mat = sc.ray_cast(dg, cp + dirv * 1.0, dirv, distance=80)
    if not hit or (ob and ob.name.startswith(("E1", "E2", "E3", "E4"))):
        continue
    puff(f"Dust{fs}", loc + nrm * 0.05, M_DUST, fs + 1, 0.1, 0.7, 14, 0.8, rise=0.15, drift=nrm * 0.3)
    hole = card(f"Hole{fs}", 0.035, M_HOLE); hole.rotation_mode = "QUATERNION"
    hole.location = loc + nrm * 0.003; hole.rotation_quaternion = nrm.to_track_quat("Z", "Y")
    hole.hide_render = True; hole.keyframe_insert("hide_render", frame=F0)
    hole.hide_render = False; hole.keyframe_insert("hide_render", frame=fs + 1)
    sp_ = card(f"Spark{fs}", 0.08, M_SPARK); sp_.rotation_mode = "QUATERNION"
    sp_.location = loc + nrm * 0.02; sp_.rotation_quaternion = (cp - loc).to_track_quat("Z", "Y")
    sp_.hide_render = True; sp_.keyframe_insert("hide_render", frame=F0)
    sp_.hide_render = False; sp_.keyframe_insert("hide_render", frame=fs + 1)
    sp_.hide_render = True; sp_.keyframe_insert("hide_render", frame=fs + 3)

# E3 incoming rounds hit near the player (column / floor / bench)
for i, fs in enumerate(E3_FIRE):
    sc.frame_set(fs)
    dg = bpy.context.evaluated_depsgraph_get()
    cp, cf = cam_pos_cache[fs]
    src = enemy_chest("E3", fs) + Vector((0, 0, 0.25))
    rnd = random.Random(fs * 5)
    aim = cp + Vector((rnd.uniform(-1.6, 1.6), rnd.uniform(-0.5, 0.5), rnd.uniform(-1.6, 0.4)))
    dirv = (aim - src).normalized()
    hit, loc, nrm, idx, ob, mat = sc.ray_cast(dg, src + dirv * 1.2, dirv, distance=40)
    EV["enemy_shots"].append(dict(f=fs, enemy="E3"))
    if not hit:
        continue
    if (loc - cp).length < 0.8:
        continue
    puff(f"InDust{fs}", loc + nrm * 0.05, M_DUST, fs + 1, 0.1, 0.8, 16, 0.85, rise=0.2, drift=nrm * 0.4)
    sp_ = card(f"InSpark{fs}", 0.1, M_SPARK); sp_.rotation_mode = "QUATERNION"
    sp_.location = loc + nrm * 0.02; sp_.rotation_quaternion = (cp - loc).to_track_quat("Z", "Y")
    sp_.hide_render = True; sp_.keyframe_insert("hide_render", frame=F0)
    sp_.hide_render = False; sp_.keyframe_insert("hide_render", frame=fs + 1)
    sp_.hide_render = True; sp_.keyframe_insert("hide_render", frame=fs + 3)
    hole = card(f"InHole{fs}", 0.04, M_HOLE); hole.rotation_mode = "QUATERNION"
    hole.location = loc + nrm * 0.003; hole.rotation_quaternion = nrm.to_track_quat("Z", "Y")
    hole.hide_render = True; hole.keyframe_insert("hide_render", frame=F0)
    hole.hide_render = False; hole.keyframe_insert("hide_render", frame=fs + 1)

# ------------------------------------------------------------------ export enemy screen data for HUD (minimap)
for f in range(F0, F1 + 1):
    ens = {}
    for name, d in ENEMIES.items():
        p = enemy_chest(name, f)
        alive = f <= d["hit"]
        visible_from = d["path"][0][0] if d["mode"] == "run" else 300
        ens[name] = dict(x=round(p.x, 2), y=round(p.y, 2), alive=alive, active=f >= visible_from)
    EV["frame"][f]["enemies"] = ens

# ------------------------------------------------------------------ render settings
sc.view_settings.exposure = -0.3
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.45
sc.cycles.samples = 64
sc.cycles.adaptive_threshold = 0.025
sc.render.use_persistent_data = True
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, 100
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_depth = "8"
sc.render.image_settings.compression = 40
sc.render.filepath = os.path.join(ROOT, "renders", "f_")
sc.frame_set(F0)
json.dump(EV, open(os.path.join(ROOT, "renders", "events.json"), "w"))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blend", "shot.blend"), compress=True)
print("SHOT SAVED")
