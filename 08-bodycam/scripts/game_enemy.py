"""把影片里的敌人（含 IK 持枪、动捕倒地、贴地修正）烘焙成纯骨骼动画片段，导出 glTF 给游戏用。
blender -b blend/shot.blend -P scripts/game_enemy.py
片段（都相对"站立点"，角色面朝 Blender 的 -Y）：
  aim    —— 持枪瞄准的站姿（影片第 2–72 帧）
  fall_r —— 中弹后向自己右侧倒地并贴地（影片第 116–206 帧）
"""
import bpy, sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix, Quaternion
from common import ROOT
import timeline as TL

scn = bpy.context.scene
ecoll = bpy.data.collections["Enemy"]
arm = next(o for o in ecoll.all_objects if o.type == "ARMATURE")
eroot = bpy.data.objects["EnemyRoot"]
GROUND_Z = 0.40

scn.frame_set(1); bpy.context.view_layer.update()
REL = eroot.matrix_world.inverted() @ arm.matrix_world
bones = list(arm.data.bones)
rest = {b.name: b.matrix_local.copy() for b in bones}
parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
order = []
def walk(b):
    order.append(b.name)
    for c in b.children:
        walk(c)
for b in bones:
    if b.parent is None:
        walk(b)


def sample_now():
    ew = eroot.matrix_world
    yaw = ew.to_euler("XYZ").z
    ref = Matrix.Translation((ew.translation.x, ew.translation.y, GROUND_Z)) @ Matrix.Rotation(yaw, 4, "Z")
    K = REL.inverted() @ ref.inverted() @ ew @ REL
    D = {pb.name: K @ pb.matrix for pb in arm.pose.bones}
    fr = {}
    for bn in order:
        p = parent[bn]
        if p is None:
            basis = rest[bn].inverted() @ D[bn]
        else:
            basis = (rest[p].inverted() @ rest[bn]).inverted() @ (D[p].inverted() @ D[bn])
        l, q, s = basis.decompose()
        fr[bn] = (l, q)
    return fr


def sample(frames):
    out = []
    for f in frames:
        scn.frame_set(f)
        out.append(sample_now())
    return out


# ---------------- 游戏里玩家能走到门口近看敌人：把左手挪到护木下面托枪（影片里敌人始终在 8 米外，左手是空悬在胸前的）
def fix_left_hand():
    gun = next(o for o in ecoll.all_objects if o.name.startswith("Gun_"))
    lh_t = bpy.data.objects.get("LH_T")
    if lh_t is None:
        print("LH_T missing"); return
    scn.frame_set(60); bpy.context.view_layer.update()
    gmw = gun.matrix_world.copy(); inv = gmw.inverted()
    def pts_of(e):
        return [inv @ (m.matrix_world @ Vector(c)) for m in ([e] if e.type == "MESH" else []) + list(e.children_recursive) if m.type == "MESH" for c in m.bound_box]
    pts = pts_of(gun)
    mn = Vector([min(p[i] for p in pts) for i in range(3)]); mx = Vector([max(p[i] for p in pts) for i in range(3)])
    dim = mx - mn; cen = (mn + mx) / 2
    la = max(range(3), key=lambda i: dim[i])
    cen_of = lambda e: sum(pts_of(e), Vector()) / max(1, len(pts_of(e)))
    stock = next(o for o in gun.children if o.name.startswith("Stock")); mag = next(o for o in gun.children if o.name.startswith("Magazine"))
    sc, mc = cen_of(stock), cen_of(mag)
    sgn = 1.0 if cen[la] - sc[la] > 0 else -1.0
    d = cen - mc; d[la] = 0
    ua = max(range(3), key=lambda i: abs(d[i])); us = 1.0 if d[ua] > 0 else -1.0
    p = cen.copy(); butt = mn[la] if sgn > 0 else mx[la]
    p[la] = butt + sgn * dim[la] * float(os.environ.get("GF_LH_ALONG", "0.60")); p[ua] = cen[ua] - us * dim[ua] * float(os.environ.get("GF_LH_DOWN", "0.16"))
    target = gmw @ p
    M = lh_t.matrix_world.copy(); old = M.translation.copy(); M.translation = target; lh_t.matrix_world = M
    bpy.context.view_layer.update()
    print("LH_T moved", [round(v, 3) for v in old], "->", [round(v, 3) for v in target])
if os.environ.get("GF_LH_FIX", "1") == "1":
    fix_left_hand()
if os.environ.get("GF_PREVIEW"):
    import math as _m
    scn.render.engine = "BLENDER_WORKBENCH"; scn.display.shading.light = "STUDIO"; scn.display.shading.color_type = "TEXTURE"
    scn.render.resolution_x = 640; scn.render.resolution_y = 640; scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = "JPEG"; scn.render.use_compositing = False
    cd = bpy.data.cameras.new("PC"); cd.lens = 50; cam = bpy.data.objects.new("PC", cd); scn.collection.objects.link(cam); scn.camera = cam
    for f in (60, 90):
        scn.frame_set(f)
        c = eroot.matrix_world.translation + Vector((0, 0, 1.15))
        for name, off in (("front", Vector((2.6, 0.0, 0.5))), ("side", Vector((0.3, -2.6, 0.3))), ("sideL", Vector((0.3, 2.6, 0.3)))):
            cam.location = c + off; cam.rotation_euler = (c - cam.location).normalized().to_track_quat("-Z", "Y").to_euler()
            scn.render.filepath = os.path.join(os.environ["GF_PREVIEW"], f"lh_{name}_{f}.jpg"); bpy.ops.render.render(write_still=True)
    print("PREVIEW DONE"); sys.exit(0)


def probe(tag):
    gun = next(o for o in ecoll.all_objects if o.name.startswith("Gun_"))
    rh = next(pb for pb in arm.pose.bones if "RightHand" in pb.name and pb.name.split(":")[-1].startswith("RightHand_"))
    lh = next(pb for pb in arm.pose.bones if pb.name.split(":")[-1].startswith("LeftHand_"))
    ew = eroot.matrix_world.inverted()
    f3 = lambda v: [round(x, 3) for x in v]
    print("PROBE", tag, "gun", f3((ew @ gun.matrix_world).translation), "rh", f3((ew @ arm.matrix_world @ rh.matrix).translation), "lh", f3((ew @ arm.matrix_world @ lh.matrix).translation),
          "rh_scale", f3(rh.matrix.to_scale()), "arm_scale", f3(arm.matrix_world.to_scale()), "muz", f3((ew @ bpy.data.objects["E_Muzzle"].matrix_world).translation))
scn.frame_set(60); bpy.context.view_layer.update(); probe("orig@60")

CLIPS = {
    "aim": sample(range(2, TL.E_FALL)),
    "fall_r": sample(range(TL.E_FALL, TL.E_FALL + 92)),
}

# ---------------- 低姿持枪（ready）：把 GunAim 绕握把转到枪口朝左下，两只手由 IK 跟过去
scn.frame_set(60); bpy.context.view_layer.update()
ga0 = bpy.data.objects["GunAim"]
aim_basis0 = ga0.matrix_basis.copy(); aim_world0 = ga0.matrix_world.copy()
ga0.animation_data_clear(); ga0.matrix_basis = aim_basis0
_R = eroot.matrix_world.to_3x3().normalized()
_fwd = (_R @ Vector((0, -1, 0))).normalized(); _up = Vector((0, 0, 1)); _right = _fwd.cross(_up).normalized()
_piv = bpy.data.objects["RH_T"].matrix_world.translation.copy()
RDY = [float(v) for v in os.environ.get("GF_READY", "-38,24,-0.05,-0.02,0.03").split(",")]     # 俯仰、偏航（度），下移、后移、向左（米）
_rot = Matrix.Rotation(math.radians(RDY[1]), 4, _up) @ Matrix.Rotation(math.radians(RDY[0]), 4, _right)
_off = _up * RDY[2] + _fwd * RDY[3] - _right * RDY[4]
ga0.matrix_world = Matrix.Translation(_piv + _off) @ _rot @ Matrix.Translation(-_piv) @ aim_world0
bpy.context.view_layer.update()
CLIPS["ready"] = [sample_now(), sample_now()]
ready_basis0 = ga0.matrix_basis.copy()
if os.environ.get("GF_PREVIEW_READY"):
    scn.render.engine = "BLENDER_WORKBENCH"; scn.display.shading.light = "STUDIO"; scn.display.shading.color_type = "TEXTURE"
    scn.render.resolution_x = 640; scn.render.resolution_y = 640; scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = "JPEG"; scn.render.use_compositing = False
    cd = bpy.data.cameras.new("PC"); cd.lens = 50; cam = bpy.data.objects.new("PC", cd); scn.collection.objects.link(cam); scn.camera = cam
    c = eroot.matrix_world.translation + Vector((0, 0, 1.15))
    for name, off in (("front", _fwd * 2.6 + _up * 0.4), ("right", _right * 2.6 + _up * 0.3), ("left", -_right * 2.6 + _up * 0.3)):
        cam.location = c + off; cam.rotation_euler = (c - cam.location).normalized().to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = os.path.join(os.environ["GF_PREVIEW_READY"], f"ready_{name}.jpg"); bpy.ops.render.render(write_still=True)
    print("PREVIEW READY DONE"); sys.exit(0)
ga0.matrix_basis = aim_basis0
bpy.context.view_layer.update()

# ---------------- 动捕重定向：走、跑、待机、跪姿（只有下半身会在游戏里用到，上半身由 aim/ready 覆盖）
from retarget import Retargeter
from common import ASSETS, import_gltf, coll
for o in ecoll.all_objects:
    if o.animation_data and o is not arm:
        o.animation_data_clear()
if eroot.animation_data:
    eroot.animation_data_clear()
if arm.animation_data:
    arm.animation_data.action = None
eroot.location = (0, 0, 0); eroot.rotation_euler = (0, 0, 0)
# 目标骨架先摆回"瞄准站姿"（IK 不参与：约束先静音）
for pb in arm.pose.bones:
    for c in pb.constraints:
        c.mute = True
AIMF = CLIPS["aim"][58]
for pb in arm.pose.bones:
    l, q = AIMF[pb.name]; pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = q; pb.location = l
bpy.context.view_layer.update()
SRC = coll("SrcTmp")
src = None; src_actions = {}
for g in ("anim_react_model_url.glb", "anim_loop_model_url.glb"):
    nw, ac = import_gltf(os.path.join(ASSETS, "cod_enemy_b", g), SRC)
    for a in ac:
        src_actions[a.name.split(".")[0]] = a
    arms_ = [o for o in nw if o.type == "ARMATURE"]
    if src is None:
        src = arms_[0]
        for o in nw:
            if o.type == "MESH":
                bpy.data.objects.remove(o)
    else:
        for nm in [o.name for o in nw]:
            o = bpy.data.objects.get(nm)
            if o is not None:
                bpy.data.objects.remove(o)
print("SRC actions", {k: tuple(round(x, 1) for x in v.frame_range) for k, v in src_actions.items()}, "fps", scn.render.fps)
bpy.context.view_layer.update()
rt = Retargeter(src, arm)
sm, tm = rt.sm, rt.tm
MW = arm.matrix_world.copy()
h_s = (src.matrix_world @ src.data.bones[sm["Hips"]].head_local).z
# 目标髋高：静止姿态下髋到脚踝的高度差 + 站立时脚踝离地高度（取瞄准站姿里较低的那只脚）
def aim_world(bn):
    return MW @ arm.pose.bones[bn].matrix
ank_ref = min(aim_world(tm["LeftFoot"]).translation.z, aim_world(tm["RightFoot"]).translation.z)
toe_ref = min(aim_world(tm["LeftToeBase"]).translation.z, aim_world(tm["RightToeBase"]).translation.z)
# 目标髋高：按腿长比例换算（这套骨架的静止姿态不是站立的 T 形，不能直接量）
_J = lambda n: aim_world(tm[n]).translation
_S = lambda n: src.matrix_world @ src.data.bones[sm[n]].head_local
leg_t = (_J("LeftUpLeg") - _J("LeftLeg")).length + (_J("LeftLeg") - _J("LeftFoot")).length
leg_s = (_S("LeftUpLeg") - _S("LeftLeg")).length + (_S("LeftLeg") - _S("LeftFoot")).length
hips_h = h_s * leg_t / leg_s
print("HEIGHTS src hips", round(h_s, 3), "leg src/tgt", round(leg_s, 3), round(leg_t, 3), "aim ankle/toe", round(ank_ref, 3), round(toe_ref, 3), "aim hips", round(_J("Hips").z, 3), "-> hips_h", round(hips_h, 3))
rt.set_heights(h_s, hips_h)
BASE4 = {bn: Matrix.Translation(l) @ q.to_matrix().to_4x4() for bn, (l, q) in AIMF.items()}


def read_src(name, frames):
    a = src_actions[name]
    ad = src.animation_data or src.animation_data_create(); ad.action = a
    try:
        ad.action_slot = a.slots[0]
    except Exception as e:
        print("slot", e)
    scn.frame_set(frames[0]); mw = src.matrix_world
    pl = (mw @ src.pose.bones[sm["LeftArm"]].matrix).translation; pr = (mw @ src.pose.bones[sm["RightArm"]].matrix).translation
    r_ = (pr - pl); r_.z = 0; r_.normalize()
    f_ = Vector((0, 0, 1)).cross(r_).normalized()
    Qa = f_.rotation_difference(Vector((0, -1, 0))).to_matrix()
    h0 = (mw @ src.pose.bones[sm["Hips"]].matrix).translation.copy(); h0t = rt.hips_target(h0)
    out = []
    for k in frames:
        scn.frame_set(k)
        R, hips = rt.read_source(); hp = rt.hips_target(hips)
        out.append(({n: Qa @ r for n, r in R.items()}, Qa @ Vector((hp.x - h0t.x, hp.y - h0t.y, hp.z))))
    return out


def retarget_clip(name, frames, center=True, ground=True, hold_xy=False):
    raw = read_src(name, frames)
    if center:
        mx_ = sum(r[1].x for r in raw) / len(raw); my_ = sum(r[1].y for r in raw) / len(raw)
        raw = [(R, Vector((h.x - mx_, h.y - my_, h.z))) for R, h in raw]
    feet = (tm["LeftFoot"], tm["RightFoot"]); toes = (tm["LeftToeBase"], tm["RightToeBase"])
    def solve_all(dz):
        res = []; lifts = []; stance = []
        for R, h in raw:
            sol = rt.solve(R, Vector((h.x, h.y, h.z + dz)), BASE4)
            pa = rt.last_pose_arm
            az = [(MW @ pa[b]).translation for b in feet]; tz = [(MW @ pa[b]).translation for b in toes]
            lifts.append(min(min(a.z - ank_ref for a in az), min(t.z - toe_ref for t in tz)))
            lo = 0 if az[0].z < az[1].z else 1
            stance.append((lo, az[lo].y))
            res.append(sol)
        return res, lifts, stance
    res, lifts, stance = solve_all(0.0)
    dz = -min(lifts) if ground is True else (-lifts[0] if ground == "first" else float(ground or 0.0))
    if abs(dz) > 1e-4:
        res, lifts, stance = solve_all(dz)
    # 原地循环的"自然速度"：支撑脚相对身体向后移动的速度
    v = [ (stance[i + 1][1] - stance[i][1]) * 30.0 for i in range(len(stance) - 1) if stance[i + 1][0] == stance[i][0] ]
    sp = sum(x for x in v if x > 0) / max(1, len([x for x in v if x > 0]))
    out = []
    for sol in res:
        fr = {}
        for bn in order:
            if bn in sol:
                loc, q = sol[bn]
                fr[bn] = (loc if loc is not None else AIMF[bn][0], q)
            else:
                fr[bn] = AIMF[bn]
        out.append(fr)
    print("RETARGET", name, "frames", len(out), "ground dz", round(dz, 3), "lift range", round(min(lifts) , 3), round(max(lifts), 3), "stance speed m/s", round(sp, 2))
    return out, sp, dz


CLIP_INFO = {}
def fr_range(name, a=None, b=None):
    f0, f1 = src_actions[name].frame_range
    f0 = int(round(f0)) if a is None else a; f1 = int(round(f1)) if b is None else b
    return list(range(f0, f1 + 1))
for cname, sname, a, b in (("walk", "walk", None, None), ("run", "run", None, None), ("idle", "idle", 30, 150), ("kneel_down", "shoot", 1, 60), ("kneel", "shoot", 70, 190)):
    frs = fr_range(sname, a, b)
    if cname in ("walk", "run"):
        frs = frs[:-1]          # 循环片段：最后一帧和第一帧重合，去掉
    if cname == "kneel":
        continue
    CLIPS[cname], sp, dz_ = retarget_clip(sname, frs, center=cname != "kneel_down", ground=True if cname in ("walk", "run", "idle") else "first")
    CLIP_INFO[cname] = {"frames": len(CLIPS[cname]), "speed": round(sp, 3)}
    if cname == "kneel_down":
        # 跪住的那段和跪下去的那段共用同一个基准（同一次读取里取后半段），否则两段之间会跳
        full, _, _ = retarget_clip("shoot", list(range(1, 191)), center=False, ground=dz_)
        CLIPS["kneel_down"] = full[:60]; CLIPS["kneel"] = full[69:190]
        CLIP_INFO["kneel_down"] = {"frames": 60, "speed": 0}; CLIP_INFO["kneel"] = {"frames": len(CLIPS["kneel"]), "speed": 0}
# 跪姿两个片段共用同一个平移基准（否则跪下去和跪住之间会跳）
for o in list(SRC.objects):
    bpy.data.objects.remove(o)
bpy.data.collections.remove(SRC)
for a in list(src_actions.values()):
    bpy.data.actions.remove(a)
for pb in arm.pose.bones:
    for c in pb.constraints:
        c.mute = False
print("SAMPLED", {k: len(v) for k, v in CLIPS.items()})

# ---------------- 清理成干净的骨架：去掉约束和辅助物体，根节点归零
scn.frame_set(1)
for pb in arm.pose.bones:
    for c in list(pb.constraints):
        pb.constraints.remove(c)
keep = set(ecoll.all_objects)
ga = bpy.data.objects.get("GunAim"); ga_basis = aim_basis0.copy()
gr = bpy.data.objects.new("GunReady", None); ecoll.objects.link(gr); gr.empty_display_size = 0.03
gr.parent = ga.parent; gr.parent_type = ga.parent_type; gr.parent_bone = ga.parent_bone; gr.rotation_mode = "QUATERNION"
gr.matrix_parent_inverse = ga.matrix_parent_inverse.copy(); gr.matrix_basis = ready_basis0
# 枪管方向的第二个参考点：和枪口同一条轴线、靠后 0.45 米
emz_ = bpy.data.objects["E_Muzzle"]; gun_ = emz_.parent
gb = bpy.data.objects.new("E_Breech", None); ecoll.objects.link(gb); gb.empty_display_size = 0.02; gb.parent = gun_
_gp = [gun_.matrix_world.inverted() @ (m.matrix_world @ Vector(c)) for m in gun_.children_recursive if m.type == "MESH" for c in m.bound_box]
_mn = Vector([min(p[i] for p in _gp) for i in range(3)]); _mx = Vector([max(p[i] for p in _gp) for i in range(3)]); _la = max(range(3), key=lambda i: (_mx - _mn)[i])
_bl = emz_.location.copy(); _mid = (_mn[_la] + _mx[_la]) / 2
_bl[_la] = emz_.location[_la] + (0.6 * (_mx - _mn)[_la]) * (-1 if emz_.location[_la] > _mid else 1)
gb.location = _bl
keep |= {gr, gb}
for o in list(bpy.data.objects):
    if o not in keep or o.name in ("RH_T", "LH_T") or o.name.endswith("FootT"):      # GunAim 要留着：步枪挂在它下面（它挂在胸骨上）
        bpy.data.objects.remove(o)
scn.frame_set(1)
for o in ecoll.all_objects:
    if o.animation_data:
        o.animation_data_clear()
if ga:
    ga.matrix_basis = ga_basis
    print("GunAim kept, parent bone:", ga.parent_bone, "children:", [c.name for c in ga.children])
eroot.location = (0, 0, 0); eroot.rotation_euler = (0, 0, 0)
arm.animation_data_create()
hips = next(b.name for b in bones if "Hips" in b.name)
roots = {bn for bn in order if parent[bn] is None} | {hips}
prev = {}
for name, frames in CLIPS.items():
    arm.animation_data.action = None
    for i, fr in enumerate(frames):
        for pb in arm.pose.bones:
            l, q = fr[pb.name]
            pq = prev.get(pb.name)
            if pq is not None and q.dot(pq) < 0:
                q = -q
            prev[pb.name] = q.copy()
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q; pb.keyframe_insert("rotation_quaternion", frame=i + 1)
            if pb.name in roots:
                pb.location = l; pb.keyframe_insert("location", frame=i + 1)
    act = arm.animation_data.action
    act.name = name; act.use_fake_user = True
    tr = arm.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 1, act)
    try:
        st.action_slot = act.slots[0]
    except Exception as e:
        print("slot", e)
    arm.animation_data.action = None
    prev = {}
arm.animation_data.action = bpy.data.actions["aim"]
try:
    arm.animation_data.action_slot = bpy.data.actions["aim"].slots[0]
except Exception as e:
    print("slot2", e)
scn.frame_set(59); bpy.context.view_layer.update(); probe("baked@59")
arm.animation_data.action = None
# ---------------- 减面：原模型 11 万面，在游戏里（多数时候 8 米开外）远超需要，而且密集小三角形在 MSAA 下很费
import bmesh
tot0 = tot1 = 0
RATIO = float(os.environ.get("GF_ENEMY_RATIO", "0.3"))
for o in [o for o in ecoll.all_objects if o.type == "MESH"]:
    n0 = sum(len(p.vertices) - 2 for p in o.data.polygons); tot0 += n0
    if n0 > 1500 and not o.data.shape_keys:
        if o.data.users > 1:
            o.data = o.data.copy()
        bpy.context.view_layer.objects.active = o
        for x in bpy.context.selected_objects:
            x.select_set(False)
        o.hide_set(False); o.select_set(True)
        m = o.modifiers.new("Dec", "DECIMATE"); m.ratio = RATIO; m.use_collapse_triangulate = True
        try:
            bpy.ops.object.modifier_move_to_index(modifier="Dec", index=0)
            bpy.ops.object.modifier_apply(modifier="Dec")
        except Exception as e:
            print("decimate failed", o.name, e); o.modifiers.remove(m)
    tot1 += sum(len(p.vertices) - 2 for p in o.data.polygons)
print("DECIMATE", tot0, "->", tot1)
print("ACTIONS", [(a.name, tuple(a.frame_range)) for a in bpy.data.actions if a.name in CLIPS])
scn.render.fps = 30
out_dir = os.path.join(ROOT, "assets", "_enemy_export")
os.makedirs(out_dir, exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for o in ecoll.all_objects:
    o.hide_set(False); o.hide_render = False; o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(out_dir, "scene.gltf"), export_format="GLTF_SEPARATE", use_selection=False,
    export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_frame_range=False,
    export_skins=True, export_yup=True, export_apply=False, export_texture_dir="textures", export_optimize_animation_size=True,
)
json.dump(CLIP_INFO, open(os.path.join(out_dir, "clips.json"), "w"), indent=1)
print("EXPORTED", out_dir, os.listdir(out_dir)[:6], CLIP_INFO)
