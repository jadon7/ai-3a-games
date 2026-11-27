"""构建敌人：配件挂骨骼、双手 IK 持枪瞄准、重定向动捕倒地，烘焙成整段表演，存为 blend/enemy.blend。
blender -b --factory-startup -P enemy_build.py [-- preview_dir]
规范朝向：角色面朝 -Y，站在原点，脚踩 z=0。
"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix, Quaternion
from common import *
from retarget import Retargeter, bone_map, rot_of, short
import timeline as TL

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.render.fps = 30
scn.frame_start, scn.frame_end = 1, TL.F_END

C = coll("Enemy")
new, acts = import_gltf(os.path.join(ASSETS, "enemy_operator", "scene.gltf"), C)
tgt = next(o for o in new if o.type == "ARMATURE")
orig_action = tgt.animation_data.action
top = next(o for o in new if o.parent is None)
tm = bone_map(tgt)
meshes = [o for o in new if o.type == "MESH"]
for o in meshes:
    for m in o.modifiers:
        if m.type == "ARMATURE":
            m.show_viewport = False

# ---------- A. 读取原始待机动画（24fps）
IDLE = {}
f0, f1 = int(orig_action.frame_range[0]) + 1, int(orig_action.frame_range[1])
for k in range(f0, f1 + 1):
    scn.frame_set(k)
    IDLE[k] = {pb.name: pb.matrix_basis.copy() for pb in tgt.pose.bones}
IDLE_N = f1 - f0
scn.frame_set(f0)
bpy.context.view_layer.update()
acc_tops = [o for o in new if o.type == "EMPTY" and o.parent and o.parent.name.startswith("GLTF_SceneRootNode")
            and not o.name.startswith("Armature")]
acc_mw = {o.name: o.matrix_world.copy() for o in acc_tops}
bone_w = {n: (tgt.matrix_world @ tgt.pose.bones[bn].matrix).copy() for n, bn in tm.items()}
hips_h = bone_w["Hips"].translation.z
print("ACC", [o.name for o in acc_tops], "hips_h", round(hips_h, 3))


def idle_basis(f):
    t = ((f - 1) * 24.0 / 30.0) % (IDLE_N - 1)
    k = f0 + int(t); a = t - int(t)
    A, B = IDLE[k], IDLE[k + 1]
    out = {}
    for n in A:
        la, qa, sa = A[n].decompose(); lb, qb, sb = B[n].decompose()
        out[n] = (la.lerp(lb, a), qa.slerp(qb, a))
    return out


# 角色朝向（待机帧）
left_w, right_w = bone_w["LeftArm"].translation, bone_w["RightArm"].translation
up = Vector((0, 0, 1))
rgt = (right_w - left_w); rgt.z = 0; rgt.normalize()
fwd = up.cross(rgt).normalized()
print("TGT idle fwd", [round(v, 2) for v in fwd])

# ---------- B. 配件：清动画，按就近骨骼绑定
for o in new:
    if o is not tgt and o.animation_data:
        o.animation_data_clear()
tgt.animation_data.action = None
# 回到待机首帧姿态
for pb in tgt.pose.bones:
    pb.matrix_basis = IDLE[f0][pb.name]
bpy.context.view_layer.update()

gun = None
for o in acc_tops:
    if o.name.startswith("Plane"):
        for ch in list(o.children_recursive):
            if ch in meshes:
                meshes.remove(ch)
            bpy.data.objects.remove(ch)
        bpy.data.objects.remove(o)
        continue
    if o.name.startswith("Gun"):
        bname = tm["RightHand"]; gun = o
    else:
        p = acc_mw[o.name].translation
        best, bd = None, 1e9
        for n in ("Hips", "Spine", "Spine1", "Spine2"):
            d = (bone_w[n].translation - p).length
            if d < bd:
                best, bd = n, d
        bname = tm[best]
    o.parent = tgt; o.parent_type = "BONE"; o.parent_bone = bname
    bpy.context.view_layer.update()
    o.matrix_world = acc_mw[o.name]
bpy.context.view_layer.update()

# 枪的局部轴：枪口方向、朝上方向
gun_mw = acc_mw[gun.name]
gmeshes = [o for o in gun.children_recursive if o.type == "MESH"]
pts = []
for o in gmeshes:
    for corner in o.bound_box:
        pts.append(gun_mw.inverted() @ (o.matrix_world @ Vector(corner)))
gmn = Vector((min(p[i] for p in pts) for i in range(3))); gmx = Vector((max(p[i] for p in pts) for i in range(3)))
gdim = gmx - gmn
long_ax = max(range(3), key=lambda i: gdim[i])
stock = next(o for o in gun.children if o.name.startswith("Stock"))
mag = next(o for o in gun.children if o.name.startswith("Magazine"))
def child_center(e):
    ps = [gun_mw.inverted() @ (m.matrix_world @ Vector(c)) for m in e.children_recursive if m.type == "MESH" for c in m.bound_box]
    return sum(ps, Vector()) / len(ps)
sc_, mc_ = child_center(stock), child_center(mag)
gcen = (gmn + gmx) / 2
muz_l = Vector((0, 0, 0)); muz_l[long_ax] = 1.0 if (gcen[long_ax] - sc_[long_ax]) > 0 else -1.0
d = gcen - mc_; d[long_ax] = 0
up_ax = max(range(3), key=lambda i: abs(d[i]))
up_l = Vector((0, 0, 0)); up_l[up_ax] = 1.0 if d[up_ax] > 0 else -1.0
muzzle_tip_l = gcen.copy(); muzzle_tip_l[long_ax] = gmx[long_ax] if muz_l[long_ax] > 0 else gmn[long_ax]
muzzle_tip_l[up_ax] += up_l[up_ax] * gdim[up_ax] * 0.18
butt_l = gcen.copy(); butt_l[long_ax] = gmn[long_ax] if muz_l[long_ax] > 0 else gmx[long_ax]
butt_l[up_ax] += up_l[up_ax] * gdim[up_ax] * 0.12
gscale = gun_mw.to_scale().x
print("GUN dims(local)", [round(v, 3) for v in gdim], "scale", round(gscale, 4), "muz", list(muz_l), "up", list(up_l))

# 枪口标记
emz = bpy.data.objects.new("E_Muzzle", None); C.objects.link(emz); emz.empty_display_size = 0.02
emz.parent = gun; emz.location = muzzle_tip_l

# ---------- E. IK：GunAim 挂在胸骨上，手跟枪走
def noscale(m):
    l, q, s = m.decompose()
    return Matrix.Translation(l) @ q.to_matrix().to_4x4()

gun_aim = bpy.data.objects.new("GunAim", None); C.objects.link(gun_aim); gun_aim.empty_display_size = 0.05
gun_aim.parent = tgt; gun_aim.parent_type = "BONE"; gun_aim.parent_bone = tm["Spine2"]
bpy.context.view_layer.update()
gun_aim.rotation_mode = "QUATERNION"
gun_aim.matrix_world = noscale(gun_mw)
bpy.context.view_layer.update()
low_ready_local = gun_aim.matrix_basis.copy()

rh_t = bpy.data.objects.new("RH_T", None); C.objects.link(rh_t); rh_t.parent = gun_aim
lh_t = bpy.data.objects.new("LH_T", None); C.objects.link(lh_t); lh_t.parent = gun_aim
bpy.context.view_layer.update()
rh_t.matrix_world = noscale(bone_w["RightHand"]); lh_t.matrix_world = noscale(bone_w["LeftHand"])
bpy.context.view_layer.update()

# 战斗姿态：上身前倾、屈膝（绕角色"右"轴转；负角度=前倾）
ADJ = {"Spine": -9, "Spine1": -7, "Spine2": -4, "Neck": 9,
       "LeftUpLeg": 27, "RightUpLeg": 23, "LeftLeg": -52, "RightLeg": -44, "LeftFoot": 25, "RightFoot": 21}
ADJ_Q = {}
for _n, _deg in ADJ.items():
    _Rw = bone_w[_n].to_3x3().normalized()
    _a = (_Rw.inverted() @ rgt).normalized()
    ADJ_Q[tm[_n]] = Quaternion(_a, math.radians(_deg))


def adjust(pose):
    for bn, qa in ADJ_Q.items():
        l, q = pose[bn]
        pose[bn] = (l, q @ qa)


_p0 = {n: (m.decompose()[0], m.decompose()[1]) for n, m in IDLE[f0].items()}
adjust(_p0)
for pb in tgt.pose.bones:
    pb.rotation_quaternion = _p0[pb.name][1]
bpy.context.view_layer.update()
shoulder_adj = (tgt.matrix_world @ tgt.pose.bones[tm["RightArm"]].matrix).translation.copy()

# 瞄准姿态：枪托抵右肩，枪口朝前
gun_rot_l = noscale(gun_mw).to_3x3()
muz_w0 = (gun_rot_l @ muz_l).normalized(); up_w0 = (gun_rot_l @ up_l).normalized()
# 目标：枪口 -> fwd，枪上 -> up（略微内倾）
aim_dir = (fwd + Vector((0, 0, -0.02))).normalized()
side = aim_dir.cross(up).normalized()
aim_up = side.cross(aim_dir).normalized()
src_basis = Matrix((muz_w0.cross(up_w0).normalized(), muz_w0, muz_w0.cross(up_w0).cross(muz_w0).normalized())).transposed()
dst_basis = Matrix((aim_dir.cross(aim_up).normalized(), aim_dir, aim_up)).transposed()
R_aim = dst_basis @ src_basis.inverted()
gun_rot_aim = R_aim @ gun_rot_l
butt_w_off = gun_rot_aim @ (butt_l * gscale)
shoulder = shoulder_adj
butt_target = shoulder - rgt * 0.035 + fwd * 0.075 - up * 0.045
aim_pos = butt_target - butt_w_off
aim_world = Matrix.Translation(aim_pos) @ gun_rot_aim.to_4x4()
gun_aim.matrix_world = aim_world
bpy.context.view_layer.update()
aim_local = gun_aim.matrix_basis.copy()

def add_ik(hand, target):
    pb = tgt.pose.bones[tm[hand]]
    ik = pb.constraints.new("IK"); ik.name = "IKHand"
    ik.target = target; ik.chain_count = 2; ik.use_tail = False; ik.use_stretch = False
    cr = pb.constraints.new("COPY_ROTATION"); cr.name = "RotHand"; cr.target = target
    cr.target_space = "WORLD"; cr.owner_space = "WORLD"
    return ik, cr
cons = add_ik("RightHand", rh_t) + add_ik("LeftHand", lh_t)

# ---------- C/D. 导入动捕源并烘焙
SRC = coll("SrcTmp")
src = None; src_actions = {}
for g in ("anim_react_model_url.glb", "anim_loop_model_url.glb"):
    nw, ac = import_gltf(os.path.join(ASSETS, "cod_enemy_b", g), SRC)
    for a in ac:
        src_actions[a.name.split(".")[0]] = a
    for o in nw:
        if o.type == "MESH":
            bpy.data.objects.remove(o)
        elif o.type == "ARMATURE":
            if src is None:
                src = o
            else:
                bpy.data.objects.remove(o)
print("SRC actions", {k: tuple(v.frame_range) for k, v in src_actions.items()})
bpy.context.view_layer.update()
rt = Retargeter(src, tgt)
sm = rt.sm
h_s = (src.matrix_world @ src.data.bones[sm["Hips"]].head_local).z
rt.set_heights(h_s, hips_h)
# 把源朝向转到规范 -Y
sf = rt.src_fwd.copy(); sf.z = 0; sf.normalize()
Q = sf.rotation_difference(Vector((0, -1, 0))).to_matrix()
# 目标当前待机朝向 -> 规范 -Y（给 EnemyRoot 用）
Qt = fwd.rotation_difference(Vector((0, -1, 0))).to_matrix().to_4x4()
print("h_s", round(h_s, 3), "src_fwd", [round(v, 2) for v in sf])


def read_action(name, frames, mirror=False):
    ad = src.animation_data or src.animation_data_create()
    a = src_actions[name]
    ad.action = a
    try:
        ad.action_slot = a.slots[0]
    except Exception as e:
        print("slot", e)
    out = {}
    # 以动作首帧的实际朝向（双肩连线）为准，把它转到规范 -Y
    scn.frame_set(frames[0])
    mw = src.matrix_world
    pl = (mw @ src.pose.bones[sm["LeftArm"]].matrix).translation
    pr = (mw @ src.pose.bones[sm["RightArm"]].matrix).translation
    r_ = (pr - pl); r_.z = 0; r_.normalize()
    f_ = Vector((0, 0, 1)).cross(r_).normalized()
    Qa = f_.rotation_difference(Vector((0, -1, 0))).to_matrix()
    h0 = (mw @ src.pose.bones[sm["Hips"]].matrix).translation.copy()
    print("ACTION", name, "posed fwd", [round(v, 2) for v in f_])
    Mx = Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, 1)))
    def swap(n):
        if n.startswith("Left"): return "Right" + n[4:]
        if n.startswith("Right"): return "Left" + n[5:]
        return n
    for k in frames:
        scn.frame_set(k)
        R, hips = rt.read_source()
        hp = rt.hips_target(hips)
        h0t = rt.hips_target(h0)
        rel = Qa @ Vector((hp.x - h0t.x, hp.y - h0t.y, hp.z))
        if mirror:
            Rm = {}
            for n, r in R.items():
                Dc = Qa @ (r @ rt.Rs_rest[n].inverted()) @ Qa.inverted()
                n2 = swap(n)
                Rm[n2] = (Mx @ Dc @ Mx) @ Qa @ rt.Rs_rest[n2]
            out[k] = (Rm, Vector((-rel.x, rel.y, rel.z)))
        else:
            out[k] = ({n: Qa @ r for n, r in R.items()}, rel)
    return out

FALL_K0 = 4
fall_len = int(src_actions["fall"].frame_range[1])
FALL = read_action("fall", list(range(1, fall_len + 1)), mirror=True)

# 重定向时 Rs_rest 也要带 Q（D = Q Rs_pose (Q Rs_rest)^-1 会把 Q 消掉，所以单独把整体转 Q）
# 这里采用：D = (Q Rs_pose) (Rs_rest)^-1 ，即姿态整体被 Q 旋转，符合"转到规范朝向"的目的。

finger_base = {n: m for n, m in IDLE[f0].items()}
base4 = {n: m for n, m in IDLE[f0].items()}

# 最终表演烘焙
tgt.animation_data_create()
root = bpy.data.objects.new("EnemyRoot", None); C.objects.link(root); root.empty_display_size = 0.3
root.rotation_mode = "XYZ"
top.parent = root
# 规范化：让待机朝向 = -Y
root_fix = bpy.data.objects.new("EnemyFix", None); C.objects.link(root_fix)
root_fix.parent = root; root_fix.matrix_basis = Qt
top.parent = root_fix
bpy.context.view_layer.update()
# 注意：重定向结果是在"世界=规范"下求的，而骨架现在多了一层 Qt。重建 Retargeter 的世界矩阵。
rt.MW = tgt.matrix_world.copy(); rt.MWr = rot_of(rt.MW)
rt.G = rt.Fs @ (Qt.to_3x3() @ rt.Ft).inverted()
rt.Rt_rest = {n: rot_of(tgt.matrix_world @ tgt.data.bones[rt.tm[n]].matrix_local) for n in rt.names}
for n in rt.names:
    from retarget import CHILD
    c = CHILD.get(n)
    if c and c in rt.sm and c in rt.tm:
        ds = (src.matrix_world @ src.data.bones[rt.sm[c]].head_local) - (src.matrix_world @ src.data.bones[rt.sm[n]].head_local)
        dt = (tgt.matrix_world @ tgt.data.bones[rt.tm[c]].head_local) - (tgt.matrix_world @ tgt.data.bones[rt.tm[n]].head_local)
        dt = rt.G @ dt
        rt.C[n] = dt.normalized().rotation_difference(ds.normalized()).to_matrix()
    else:
        rt.C[n] = Matrix.Identity(3)
for n, p in (("LeftHand", "LeftForeArm"), ("RightHand", "RightForeArm"), ("Head", "Neck"),
             ("LeftToeBase", "LeftFoot"), ("RightToeBase", "RightFoot")):
    rt.C[n] = rt.C[p]

hips_bn = tm["Hips"]
body_bns = {rt.tm[n] for n in rt.names}
spine1_bn = tm["Spine1"]

def smooth(x):
    x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)

for f in range(1, TL.F_END + 1):
    ib = idle_basis(f)
    pose = {n: (l.copy(), q.copy()) for n, (l, q) in ib.items()}
    adjust(pose)
    if f >= TL.E_FALL:
        k = min(fall_len, FALL_K0 + (f - TL.E_FALL))
        Rs, hips = FALL[k]
        sol = rt.solve(Rs, hips, base4)
        w = smooth((f - TL.E_FALL) / 5.0)
        for bn, (loc, q) in sol.items():
            li, qi = pose[bn]
            qn = qi.slerp(q, w)
            ln = li.lerp(loc, w) if loc is not None else li
            pose[bn] = (ln, qn)
    # 第一次中弹：躯干一震
    df = f - TL.E_HIT1
    if 0 <= df < 7 and f < TL.E_FALL + 3:
        amp = [0.0, 1.0, 0.8, 0.5, 0.3, 0.15, 0.05][df]
        l, q = pose[spine1_bn]
        tw = Quaternion((0, 1, 0), math.radians(-16 * amp)) @ Quaternion((1, 0, 0), math.radians(-9 * amp))
        pose[spine1_bn] = (l, q @ tw)
    for pb in tgt.pose.bones:
        l, q = pose[pb.name]
        pb.rotation_quaternion = q
        pb.keyframe_insert("rotation_quaternion", frame=f)
        if pb.name == hips_bn or pb.parent is None:
            pb.location = l
            pb.keyframe_insert("location", frame=f)
tgt.animation_data.action.name = "EnemyPerf"

# IK 权重、GunAim
gun_aim.matrix_basis = aim_local
for con in cons:
    for f, v in ((1, 1.0), (TL.E_FALL, 1.0), (TL.E_FALL + 4, 0.0)):
        con.influence = v
        con.keyframe_insert("influence", frame=f)
# 开火后坐：GunAim 沿枪轴小幅后顶
al, aq, _ = aim_local.decompose()
gun_aim.location = al; gun_aim.rotation_quaternion = aq
gun_aim.keyframe_insert("location", frame=1); gun_aim.keyframe_insert("rotation_quaternion", frame=1)
back_l = (aim_local.to_3x3() @ (muz_l * -1.0)).normalized()  # 在父空间里的枪后方向（近似）
for s in TL.E_SHOTS:
    if s >= TL.E_FALL:
        continue
    gun_aim.location = al; gun_aim.keyframe_insert("location", frame=s - 1)
    gun_aim.location = al + back_l * (0.018 / tgt.matrix_world.to_scale().x); gun_aim.keyframe_insert("location", frame=s)
    gun_aim.location = al; gun_aim.keyframe_insert("location", frame=s + 2)

# 清理源
for o in list(SRC.objects):
    bpy.data.objects.remove(o)
bpy.data.collections.remove(SRC)
for o in meshes:
    for m in o.modifiers:
        if m.type == "ARMATURE":
            m.show_viewport = True
scn["enemy_hips_h"] = hips_h
os.makedirs(os.path.join(ROOT, "blend"), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blend", "enemy.blend"))
print("SAVED enemy.blend")

# ---------- 预览
if argv:
    outdir = argv[0]
    w = bpy.data.worlds.new("w"); scn.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.85, 0.9, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); scn.collection.objects.link(sun)
    sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.ops.mesh.primitive_plane_add(size=8)
    scn.render.engine = "BLENDER_EEVEE"; scn.render.resolution_x = 400; scn.render.resolution_y = 400
    scn.render.image_settings.file_format = "JPEG"; scn.view_settings.view_transform = "Standard"
    cd = bpy.data.cameras.new("C"); cd.lens = 35; cam = bpy.data.objects.new("C", cd); scn.collection.objects.link(cam); scn.camera = cam
    for vname, pos in (("front", (0.4, -4.8, 1.3)), ("side", (4.8, 0.6, 1.3))):
        cam.location = pos; cam.rotation_euler = look_at_euler(pos, (0, 0.5, 0.85))
        for f in (60, 87, 110, 112, 118, 124, 130, 138, 146, 156, 170, 200):
            scn.frame_set(f)
            scn.render.filepath = os.path.join(outdir, f"en_{vname}_{f:03d}.jpg")
            bpy.ops.render.render(write_still=True)
    print("PREVIEW DONE")
