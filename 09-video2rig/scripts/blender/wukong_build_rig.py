"""孙悟空（写实版）专用：从影片角色文件整理出管线要的 assets/model/wukong_rigged.glb。

用法: Blender -b --factory-startup <wukong_real_final.blend> -P scripts/blender/wukong_build_rig.py -- <输出 glb> <站姿 npz>

做的事：
  1. 去掉披风（Alembic 缓存）和三个粒子毛发系统、清掉动作，骨架回到静止姿态（"左手搭凉棚、右手持棒"）。
  2. 身体减面到约 20 万三角形；金箍棒转到世界坐标、全部权重给 mixamorig:RightHand，合进身体网格。
  3. 把两条手臂摆成 A 字（大臂向外下 45°，肘微屈）后"应用为静止姿态"：管线的自由度范围是按 T/A 字静止姿态定的。
     骨骼名、层级、每根骨骼的局部坐标系和原骨架的"摆好的姿态"刚性一致（apply pose as rest），所以之后在
     A 字骨架上解出来的动作，按世界朝向直接对应回原骨架。
  4. 原来的凉棚站姿相对新静止姿态的局部旋转存成 <站姿 npz>（names/quats/loc），渲染视频参考图时用。
  5. 整体缩放到身高 1.0（管线的双机位取景按身高 1 定），导出 GLB。
"""
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
out_glb, out_stance = args[0], args[1]
TARGET_TRIS = 200_000

scene = bpy.context.scene
arm = bpy.data.objects["WK_Armature"]
body = bpy.data.objects["WK_Body"]
staff = bpy.data.objects["WK_Staff"]
root = bpy.data.objects["WK_ROOT"]

# 1) 清理
bpy.data.objects.remove(bpy.data.objects["WK_Cape"], do_unlink=True)
for m in [m for m in body.modifiers if m.type == "PARTICLE_SYSTEM"]:
    body.modifiers.remove(m)
if arm.animation_data:
    arm.animation_data.action = None
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
arm.data.pose_position = "POSE"
scene.frame_set(1)
bpy.context.view_layer.update()
for o in list(scene.objects):
    if o not in (arm, body, staff, root):
        print("REMOVE", o.name, o.type)
        bpy.data.objects.remove(o, do_unlink=True)

# 只保留身体网格实际用到的材质槽（毛发材质只给粒子用）
used = {p.material_index for p in body.data.polygons}
print("BODY material slots used:", sorted(used), [m.name for m in body.data.materials])

# 2a) 身体减面
tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
bpy.context.view_layer.objects.active = body
for o in scene.objects:
    o.select_set(o is body)
dec = body.modifiers.new("dec", "DECIMATE")
dec.ratio = TARGET_TRIS / tris
dec.use_collapse_triangulate = True
bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
assert body.modifiers[0].name == "dec"
bpy.ops.object.modifier_apply(modifier="dec")
print("DECIMATE", tris, "->", sum(len(p.vertices) - 2 for p in body.data.polygons), flush=True)

# 2b) 金箍棒并进身体
mw = staff.matrix_world.copy()
staff.parent = None
staff.matrix_world = mw
staff.data = staff.data.copy()
staff.data.transform(body.matrix_world.inverted() @ mw)
staff.matrix_world = body.matrix_world.copy()
vg = staff.vertex_groups.new(name="mixamorig:RightHand")
vg.add(list(range(len(staff.data.vertices))), 1.0, "REPLACE")
for o in scene.objects:
    o.select_set(o in (body, staff))
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
print("JOINED tris", sum(len(p.vertices) - 2 for p in body.data.polygons), "verts", len(body.data.vertices), flush=True)

# 3) A 字
orig_local = {b.name: b.matrix_local.copy() for b in arm.data.bones}
P = "mixamorig:"
# 角色面朝 +X、左手边 +Y（影片文件里的朝向）；自己在骨架空间里确认一遍
lf = arm.data.bones[P + "LeftFoot"].head_local
la = arm.data.bones[P + "LeftArm"].head_local
ra = arm.data.bones[P + "RightArm"].head_local
left = (la - ra)
left.z = 0
left.normalize()
up = Vector((0, 0, 1))
fwd = left.cross(up).normalized()            # up × fwd = left
assert (up.cross(fwd) - left).length < 1e-3, (fwd, left)
print("FRAME left", tuple(round(v, 3) for v in left), "fwd", tuple(round(v, 3) for v in fwd))


def aim(pb, target):
    bpy.context.view_layer.update()
    M = pb.matrix.copy()
    head = M.to_translation()
    d = (pb.tail - pb.head).normalized()
    R = d.rotation_difference(target.normalized()).to_matrix().to_4x4()
    pb.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ M
    bpy.context.view_layer.update()


bpy.context.view_layer.objects.active = arm
for side, s in (("Left", 1), ("Right", -1)):
    out = left * s
    upper = (out * math.cos(math.radians(45)) - up * math.sin(math.radians(45)) + fwd * 0.12).normalized()
    # 肘微屈 15°：前臂在"大臂 + 前方"构成的平面里往前弯（真实的屈肘方向）
    axis = upper.cross(fwd).normalized()
    fore = (Matrix.Rotation(math.radians(-15), 3, axis) @ upper).normalized()
    if fore.dot(fwd) < upper.dot(fwd):
        fore = (Matrix.Rotation(math.radians(15), 3, axis) @ upper).normalized()
    pbs = arm.pose.bones
    aim(pbs[P + side + "Arm"], upper)
    aim(pbs[P + side + "ForeArm"], fore)
    aim(pbs[P + side + "Hand"], fore)
    print("APOSE", side, "upper", tuple(round(v, 3) for v in upper), "fore", tuple(round(v, 3) for v in fore))

# 3b) 修权重：原模型左手搭在额头上，手掌和额头的网格粘在一起、权重互相掺着，手一离开额头就拉出一张膜。
#     做法：同时带"左手系"和"头 / 脖子"权重的顶点，按多的一方全归一方；之后 A 字姿态下仍被拉长 2.5 倍以上、
#     且碰到左手或头的三角面直接删掉（只是训练用的网格，额头 / 掌心留几个小洞看不出来）。
def fix_head_hand_weights():
    import bmesh
    me = body.data
    gname = {g.index: g.name for g in body.vertex_groups}
    hand = {i for i, nm in gname.items() if nm.startswith(P + "LeftHand")}
    headg = {i for i, nm in gname.items() if nm.split(":")[-1] in ("Head", "Neck", "HeadTop_End")}
    hg = body.vertex_groups[P + "Head"]
    nfix = 0
    for v in me.vertices:
        hw = {g.group: g.weight for g in v.groups if g.group in hand}
        dw = {g.group: g.weight for g in v.groups if g.group in headg}
        if not hw or not dw:
            continue
        nfix += 1
        if sum(dw.values()) >= sum(hw.values()):
            for gi in hw:
                body.vertex_groups[gi].remove([v.index])
            hg.add([v.index], sum(hw.values()), "ADD")
        else:
            best = max(hw, key=hw.get)
            for gi in dw:
                body.vertex_groups[gi].remove([v.index])
            body.vertex_groups[best].add([v.index], sum(dw.values()), "ADD")
    bpy.context.view_layer.update()
    n = len(me.vertices)
    rest = np.empty(n * 3)
    me.vertices.foreach_get("co", rest)
    rest = rest.reshape(n, 3)
    dg_ = bpy.context.evaluated_depsgraph_get()
    posed = np.empty(n * 3)
    body.evaluated_get(dg_).data.vertices.foreach_get("co", posed)
    posed = posed.reshape(n, 3)
    touch = np.zeros(n, bool)
    for v in me.vertices:
        if any(g.group in hand or g.group in headg for g in v.groups if g.weight > 0):
            touch[v.index] = True
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    kill = []
    for f in bm.faces:
        ids = [vv.index for vv in f.verts]
        if not touch[ids].any():
            continue
        for k in range(len(ids)):
            a_, b_ = ids[k], ids[(k + 1) % len(ids)]
            if np.linalg.norm(posed[a_] - posed[b_]) > 2.5 * np.linalg.norm(rest[a_] - rest[b_]) + 2e-3:
                kill.append(f)
                break
    bmesh.ops.delete(bm, geom=kill, context="FACES_ONLY")
    bm.to_mesh(me)
    bm.free()
    me.update()
    print("WEIGHTFIX mixed verts", nfix, "faces deleted", len(kill), flush=True)
    bpy.context.view_layer.update()


fix_head_hand_weights()

# 网格烘成 A 字形状，再把 A 字设为静止姿态
dg = bpy.context.evaluated_depsgraph_get()
for m in body.modifiers:
    print("MOD", m.type, m.name, m.show_viewport)
new_me = bpy.data.meshes.new_from_object(body.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
old_me = body.data
body.data = new_me
bpy.data.meshes.remove(old_me)
print("BAKED mesh verts", len(new_me.vertices), "vgroups(obj)", len(body.vertex_groups),
      "has weights", any(len(v.groups) for v in new_me.vertices[:1000]))
for o in scene.objects:
    o.select_set(o is arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.context.view_layer.update()

# 4) 原站姿（相对新静止姿态的局部旋转）
names = [b.name for b in arm.data.bones]
for b in arm.data.bones:            # 父在前
    pb = arm.pose.bones[b.name]
    pb.rotation_mode = "QUATERNION"
    pb.matrix = orig_local[b.name]
    bpy.context.view_layer.update()
quats = np.array([list(arm.pose.bones[n].rotation_quaternion) for n in names])
loc = np.array(list(arm.pose.bones[P + "Hips"].location))
err = max((arm.pose.bones[n].matrix.to_translation() - orig_local[n].to_translation()).length for n in names)
print("STANCE max head err", err, "hips loc", loc.round(5))
np.savez(out_stance, names=np.array(names), quats=quats, loc=loc)
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()

# 5) 缩放到身高 1 并导出
vs = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices])
h = float(vs[:, 2].max() - vs[:, 2].min())
# 骨架不能挂在别的物体下面：prep_rig.py 只会把"没有父级"的物体挂到它的摆正根节点上
mwa = arm.matrix_world.copy()
arm.parent = None
arm.matrix_world = Matrix.Scale(1 / h, 4) @ mwa
bpy.data.objects.remove(root, do_unlink=True)
bpy.context.view_layer.update()
print("HEIGHT", round(h, 4), "-> scale", round(1 / h, 4), "tris", sum(len(p.vertices) - 2 for p in body.data.polygons))
for o in scene.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", use_selection=True, export_animations=False,
                          export_skins=True, export_apply=False)
print("EXPORTED", out_glb, flush=True)
