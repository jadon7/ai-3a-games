"""把 Tripo 绑好骨的 GLB 整理成可用的工程：摆正、落地、搭棚、导出骨架 JSON、自检 FK。

用法: Blender -b --factory-startup -P scripts/blender/prep_rig.py -- <rigged.glb> <name>
产出: assets/model/<name>.blend, assets/model/<name>_skeleton.json, out/inspect/<name>_*.png

两种骨架：
  - Mixamo 命名的双足：按骨骼名查表（v2r/profiles.py 的 MixamoBiped）。
  - 其它（Tripo 的四足等，命名不固定）：读 assets/model/<name>_rigmap.json，里面写明每根骨骼的角色。
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_common as bc  # noqa: E402
from v2r import profiles  # noqa: E402
from v2r import skeleton as sk  # noqa: E402

src, name = bc.script_args()[:2]
out_blend = os.path.join(bc.ROOT, "assets/model", f"{name}.blend")
out_json = os.path.join(bc.ROOT, "assets/model", f"{name}_skeleton.json")
rigmap_path = os.path.join(bc.ROOT, "assets/model", f"{name}_rigmap.json")
inspect_dir = os.path.join(bc.ROOT, "out/inspect")
os.makedirs(inspect_dir, exist_ok=True)
rigmap = json.load(open(rigmap_path, encoding="utf-8")) if os.path.exists(rigmap_path) else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene

# 1) 删掉没蒙皮的杂物（Tripo 的绑骨结果里带一个 Icosphere）
arm, mesh = bc.character()
for o in list(scene.objects):
    if o.type == "MESH" and o is not mesh:
        print("REMOVE junk mesh:", o.name)
        bpy.data.objects.remove(o, do_unlink=True)

# 1b) 映射文件里要求的骨架修补：改父级（挂错地方的骨骼）、把根骨骼缩短到躯干里（让整体旋转的支点在身体中心）
if rigmap:
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for child, parent in rigmap.get("reparent", {}).items():
        eb[child].use_connect = False
        eb[child].parent = eb[parent]
        print("REPARENT", child, "->", parent)
    if rigmap.get("root_bone_length"):
        rb = next(b for b in eb if b.parent is None)
        for c in rb.children:
            c.use_connect = False
        d = (rb.tail - rb.head).normalized()
        rb.head = rb.tail - d * rigmap["root_bone_length"]
        print("ROOT bone shortened, head now", [round(v, 3) for v in rb.head])
    bpy.ops.object.mode_set(mode="OBJECT")

# 2) 摆正：转到面朝 -Y；脚落到 z=0，根骨骼对准原点
bones = arm.data.bones
names = [b.name for b in bones]
mw = arm.matrix_world
if rigmap:
    role_side = {n: tuple(rigmap["bones"].get(n, (None, 0))) for n in names}
    fwd = Vector(rigmap["forward"])
else:
    assert profiles.MixamoBiped.match(names), "不是 Mixamo 双足骨架，需要写 assets/model/<name>_rigmap.json"
    role_side = profiles.MixamoBiped.roles(names)
    fwd = Vector(profiles.MixamoBiped.forward(lambda n: mw @ bones[n].head_local, names))


def bone_by(role, side):
    return next(bones[n] for n in names if role_side[n] == (role, side))


fwd.z = 0
fwd.normalize()
yaw = math.atan2(-fwd.x, -fwd.y)          # 绕 Z 转 yaw 之后 fwd 指向 -Y
# 验证方向：atan2 的写法容易写反，直接算一遍
test = Vector((fwd.x * math.cos(yaw) - fwd.y * math.sin(yaw), fwd.x * math.sin(yaw) + fwd.y * math.cos(yaw), 0))
if test.y > -0.99:
    yaw = -yaw
    test = Vector((fwd.x * math.cos(yaw) - fwd.y * math.sin(yaw), fwd.x * math.sin(yaw) + fwd.y * math.cos(yaw), 0))
print("FORWARD(before)", [round(v, 3) for v in fwd], "yaw_deg", round(math.degrees(yaw), 1), "after", [round(v, 3) for v in test])

root = bpy.data.objects.new("v2r_root", None)
scene.collection.objects.link(root)
for o in (arm, mesh):
    if o.parent is None:
        o.parent = root
root.rotation_euler = (0, 0, yaw)
bpy.context.view_layer.update()


def mesh_verts():
    return np.array([(mesh.matrix_world @ v.co)[:] for v in mesh.data.vertices])


verts = mesh_verts()
size_ref = float(verts[:, 2].max() - verts[:, 2].min())            # 双足：身高
if rigmap and rigmap.get("target_length"):                          # 四足：按身长缩放到统一大小
    length = float(verts[:, 1].max() - verts[:, 1].min())
    k = rigmap["target_length"] / length
    root.scale = (k, k, k)
    bpy.context.view_layer.update()
    verts = mesh_verts()
    size_ref = float(rigmap["target_length"])
    print("SCALE x%.3f (身长 %.3f -> %.3f)" % (k, length, size_ref))
hips_w = arm.matrix_world @ bone_by("root", 0).head_local
root.location = (-hips_w.x, -hips_w.y, -float(verts[:, 2].min()))
bpy.context.view_layer.update()
verts = mesh_verts()
print("MESH_BBOX min", verts.min(0).round(3), "max", verts.max(0).round(3))
probe = next(n for n in names if role_side[n][1] == 1 and role_side[n][0])
assert (arm.matrix_world @ bones[probe].head_local).x > 0, "角色的左侧应该在 +X 一侧"

# 3) 搭棚
bc.build_studio(scene)

# 4) 导出骨架
mw = arm.matrix_world
bone_list = []
order = {n: i for i, n in enumerate(names)}
for b in bones:
    role, side = role_side[b.name]
    L = mw @ b.matrix_local
    bone_list.append({
        "name": b.name,
        "parent": order[b.parent.name] if b.parent else -1,
        "matrix": [list(r) for r in L],
        "head": list(mw @ b.head_local),
        "tail": list(mw @ b.tail_local),
        "role": role,
        "side": side,
        "thumb": (not rigmap) and profiles.MixamoBiped.is_thumb(b.name),
    })
heads = {b["name"]: np.array(b["head"]) for b in bone_list}
tails = {b["name"]: np.array(b["tail"]) for b in bone_list}
if rigmap:
    # 每个顶点在各骨骼上的权重，用来从网格上找标记点（鼻尖、角、下巴）
    gname = {g.index: g.name for g in mesh.vertex_groups}
    wmap = {}
    for v in mesh.data.vertices:
        for g in v.groups:
            wmap.setdefault(gname[g.group], {})[v.index] = g.weight
    joints = []
    for j in rigmap["joints"]:
        b = j["bone"]
        if "region" in j:                                   # 标记点：这几根骨骼管的顶点里，沿指定方向最突出的那一小撮的平均位置
            w = np.zeros(len(verts))
            for rb in j["region"]:
                for vi, wt in wmap.get(rb, {}).items():
                    w[vi] += wt
            idx = np.where(w > 0.5)[0]
            score = verts[idx] @ (np.array(j["axis"], dtype=float) / np.linalg.norm(j["axis"]))
            pick = idx[np.argsort(-score)[:max(3, int(len(idx) * j["top"]))]]
            off = verts[pick].mean(0) - heads[b]
        elif j.get("at") == "tail":
            off = tails[b] - heads[b]
        else:
            off = np.zeros(3)
        joints.append({"name": j["name"], "bone": b, "group": j["group"], "offset": [float(x) for x in off]})
    profile = profiles.profile_from_rigmap(rigmap, size_ref)
else:
    joints = profiles.MixamoBiped.joints(names, heads, tails)
    profile = None
data = {
    "name": name,
    "bones": bone_list,
    "joints": joints,
    "camera": {"ortho_h": sk.ORTHO_H, "ortho_w": sk.ORTHO_W, "z_center": sk.Z_CENTER, "views": list(sk.VIEWS)},
}
if profile:
    data["profile"] = profile
with open(out_json, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False)
skel = sk.Skeleton.load(out_json)
print("SKELETON bones", skel.n, "joints", skel.K, "dofs", skel.D, "scale", round(skel.scale, 4), "kind", skel.kind)
for k, nm in enumerate(skel.dof_names):
    print("  DOF %-26s axis=(%+.2f,%+.2f,%+.2f) range=[%+4.0f,%+4.0f]°" % (
        nm, *skel.dof_axis[k], math.degrees(skel.dof_lo[k]), math.degrees(skel.dof_hi[k])))
for k, nm in enumerate(skel.joint_names):
    print("  JOINT %-16s rest=(%+.3f,%+.3f,%+.3f)" % (nm, *skel.joint_rest[k]))

# 5) 自检：我的 FK 和投影公式，是否和 Blender 实际算出来的一致
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402

rng = np.random.default_rng(0)
worst_fk, worst_proj = 0.0, 0.0
for trial in range(20):
    params = sk.sample_pose(skel, rng)
    quats, loc, joints_mine = bc.pose_from_params(skel, params)
    bc.set_pose(arm, skel, quats, loc)
    joints_bl = bc.read_joints(arm, skel)
    worst_fk = max(worst_fk, float(np.abs(joints_bl - joints_mine).max()))
    proj = sk.project(joints_bl)
    for vi, v in enumerate(sk.VIEWS):
        cam = scene.objects[f"cam_{v}"]
        scene.camera = cam
        for k in range(skel.K):
            c = world_to_camera_view(scene, cam, Vector(joints_bl[k]))
            worst_proj = max(worst_proj, abs(c.x - proj[vi, k, 0]), abs((1 - c.y) - proj[vi, k, 1]))
print("SELFTEST fk_max_err(world units)=%.6f  proj_max_err(normalized)=%.6f" % (worst_fk, worst_proj))
assert worst_fk < 1e-4 and worst_proj < 1e-4, "FK 或投影公式和 Blender 不一致"

# 6) 渲染几张检查图：静止姿态、每组自由度拉到头的姿态、两个随机姿势，看蒙皮有没有问题
zero = lambda: {"theta": np.zeros(skel.D), "ypr": np.zeros(3), "t": np.zeros(3)}  # noqa: E731
tests = [("rest", zero())]


def extreme(tag, picks):
    """picks: [(自由度名里含的字符串, 'lo' | 'hi' | 0~1 的比例)]"""
    p = zero()
    for k, nm in enumerate(skel.dof_names):
        for key, which in picks:
            if key in nm:
                p["theta"][k] = skel.dof_lo[k] if which == "lo" else skel.dof_hi[k] if which == "hi" else which
    tests.append((tag, p))


if skel.kind == "biped":
    extreme("fist", [(".curl", "hi"), (".thumb", "hi")])
else:
    extreme("legs_fwd", [(".fwd", "hi")])
    extreme("legs_back", [(".fwd", "lo")])
    extreme("fold", [("Limb_1.pitch", "lo"), ("bone_11.pitch", "hi"), ("bone_17.pitch", "hi"),
                     ("Limb_2.pitch", "lo"), ("bone_33.pitch", "lo")])
    extreme("out", [(".out", "hi"), ("tailA_yaw", "hi"), ("tailB_yaw", "hi"), ("spine_yaw", "hi")])
    extreme("neck", [("bone_4.pitch", "lo"), ("Head_0.pitch", "lo"), ("tailA_pitch", "lo"), ("tailB_pitch", "lo"), ("spine_pitch", "lo")])
tests += [("pose1", sk.sample_pose(skel, np.random.default_rng(3))), ("pose2", sk.sample_pose(skel, np.random.default_rng(11))),
          ("pose3", sk.sample_pose(skel, np.random.default_rng(5)))]
for tag, params in tests:
    quats, loc, _ = bc.pose_from_params(skel, params)
    bc.set_pose(arm, skel, quats, loc)
    bc.render_views(scene, os.path.join(inspect_dir, f"{name}_{tag}_{{view}}.png"))

# 7) 回到静止姿态并存盘
quats, loc, _ = bc.pose_from_params(skel, zero())
bc.set_pose(arm, skel, quats, loc)
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
print("SAVED", out_blend, out_json)
