"""修 dragon 的 Tripo 四足绑骨（只给 dragon 用）。

Tripo 这次给 dragon 的四足绑骨有三处毛病（inspect_weights.py 的输出能看出来）：
  1. 右后腿整条没有骨骼：大腿的皮挂在 Root 上，右后脚挂在左后腿的 1_Left_Limb_2 上（左脚一动右脚跟着动）。
  2. 前脚的趾骨串了边：右前脚的 bone_16 管着一部分左前脚的趾头；前脚趾骨 0_*_Limb_4 还沾着后脚的皮。
  3. 后腿只有三节（大腿、小腿、跖），脚掌和跖骨是一整块，没法踩平。
修法：
  A. 先把 +X（左）半边洗干净：左半边顶点上属于右侧骨骼的权重换成对应的左侧骨骼；后半身（y > -0.10）顶点上属于前腿骨骼的权重归给左后腿的跖骨。
  B. 左后腿加一节脚掌骨 1_Left_Limb_3（跖骨里 z 很低的那部分皮按高度平滑地分给它）。
  C. 按左后腿镜像出右后腿四节骨骼 1_Right_Limb_0..3，再把 -X（右）半边每个顶点的权重换成它镜像点（左半边）的权重，骨骼名左右对调。
用法: Blender -b --factory-startup -P scripts/blender/dragon_fix_rig.py -- <tripo 绑骨.glb> <输出.glb>
"""
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
mesh = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
for o in list(sc.objects):
    if o.type == "MESH" and o is not mesh:
        bpy.data.objects.remove(o, do_unlink=True)
assert arm.matrix_world.is_identity or True

# 左 <-> 右 骨骼对照（右翅膀比左翅膀多一个分叉 Spine_6..8，没有对应，就当成中线骨骼不换）
PAIRS = [("tripo::0_Left_Limb_%d" % k, "tripo::0_Right_Limb_%d" % k) for k in range(5)]
PAIRS += [("bone_17", "bone_9"), ("bone_23", "bone_15"), ("bone_24", "bone_16")]
PAIRS += [("bone_25", "tripo::Spine_3"), ("bone_26", "tripo::Spine_4"), ("bone_27", "tripo::Spine_5"),
          ("bone_28", "bone_34"), ("bone_29", "bone_35"), ("bone_30", "bone_36")]
PAIRS += [("tripo::1_Left_Limb_%d" % k, "tripo::1_Right_Limb_%d" % k) for k in range(4)]
L2R = dict(PAIRS)
R2L = {r: l for l, r in PAIRS}
FRONT = {n for p in PAIRS[:8] for n in p}
EPS = 0.004

# ---------- 骨骼：左后腿加脚掌骨；镜像出右后腿 ----------
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones
inv = arm.matrix_world.inverted()
mw = arm.matrix_world
l2 = eb["tripo::1_Left_Limb_2"]
# 跖骨：飞节 -> 脚踝（原来的尾巴歪到腿后面的空中去了，改成竖直向下到脚踝）
ankle_w = Vector((0.092, 0.050, 0.032))
toe_w = Vector((0.105, -0.022, 0.006))
l2.tail = inv @ ankle_w
l3 = eb.new("tripo::1_Left_Limb_3")
l3.head = inv @ ankle_w
l3.tail = inv @ toe_w
l3.parent = l2
l3.roll = 0.0
for k in range(4):
    lb = eb["tripo::1_Left_Limb_%d" % k]
    rb = eb.new("tripo::1_Right_Limb_%d" % k)
    h, t = mw @ lb.head, mw @ lb.tail
    rb.head = inv @ Vector((-h.x, h.y, h.z))
    rb.tail = inv @ Vector((-t.x, t.y, t.z))
    rb.roll = -lb.roll
    rb.parent = eb["tripo::Root"] if k == 0 else eb["tripo::1_Right_Limb_%d" % (k - 1)]
bpy.ops.object.mode_set(mode="OBJECT")

# ---------- 权重 ----------
V = np.array([(mesh.matrix_world @ v.co)[:] for v in mesh.data.vertices])
nv = len(V)
groups = {g.name: g for g in mesh.vertex_groups}
for n in [*L2R.keys(), *L2R.values()]:
    if n not in groups:
        groups[n] = mesh.vertex_groups.new(name=n)
gname = {g.index: g.name for g in mesh.vertex_groups}
W = [dict() for _ in range(nv)]
for v in mesh.data.vertices:
    for g in v.groups:
        if g.weight > 1e-4:
            W[v.index][gname[g.group]] = g.weight


def add(d, n, w):
    d[n] = d.get(n, 0.0) + w


# A. 洗左半边
for i in range(nv):
    x, y, z = V[i]
    if x <= EPS:
        continue
    d = {}
    for n, w in W[i].items():
        if n in R2L:
            n = R2L[n]
        if y > -0.10 and n in FRONT:
            n = "tripo::1_Left_Limb_2"
        add(d, n, w)
    W[i] = d

# B. 左后腿脚掌：跖骨上的权重按高度分给脚掌骨（z 0.05 以上全归跖骨，0.02 以下全归脚掌）
for i in range(nv):
    x, y, z = V[i]
    if x <= EPS or "tripo::1_Left_Limb_2" not in W[i]:
        continue
    w = W[i].pop("tripo::1_Left_Limb_2")
    f = float(np.clip((0.05 - z) / 0.03, 0.0, 1.0))
    f = f * f * (3 - 2 * f)
    if f < 1:
        add(W[i], "tripo::1_Left_Limb_2", w * (1 - f))
    if f > 0:
        add(W[i], "tripo::1_Left_Limb_3", w * f)

# C. 右半边 = 镜像点的权重（左右骨骼对调）
left_idx = np.where(V[:, 0] > EPS)[0]
kd = KDTree(len(left_idx))
for j, i in enumerate(left_idx):
    kd.insert(Vector(V[i]), j)
kd.balance()
dists = []
for i in range(nv):
    x, y, z = V[i]
    if x >= -EPS:
        continue
    co, j, dist = kd.find(Vector((-x, y, z)))
    dists.append(dist)
    W[i] = {L2R.get(n, n): w for n, w in W[left_idx[j]].items()}
# 中线附近的顶点：只把串边的前腿 / 后腿权重挪走
for i in range(nv):
    if abs(V[i, 0]) <= EPS:
        d = {}
        for n, w in W[i].items():
            if V[i, 1] > -0.10 and n in FRONT:
                n = "tripo::Root"
            add(d, n, w)
        W[i] = d
print("MIRROR nearest dist: mean %.4f p95 %.4f max %.4f" % (np.mean(dists), np.percentile(dists, 95), np.max(dists)))

# 归一化并写回
for g in mesh.vertex_groups:
    g.remove(range(nv))
for i in range(nv):
    s = sum(W[i].values())
    if s <= 0:
        W[i] = {"tripo::Root": 1.0}
        s = 1.0
    for n, w in W[i].items():
        groups[n].add([i], w / s, "REPLACE")

for n in ["tripo::1_Left_Limb_%d" % k for k in range(4)] + ["tripo::1_Right_Limb_%d" % k for k in range(4)]:
    idx = [i for i in range(nv) if W[i].get(n, 0) > 0.3]
    P = V[idx] if idx else np.zeros((1, 3))
    print("FIXED %-24s n>0.3=%5d x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (n, len(idx), *P[:, 0].min(keepdims=True), *P[:, 0].max(keepdims=True), *P[:, 1].min(keepdims=True), *P[:, 1].max(keepdims=True), *P[:, 2].min(keepdims=True), *P[:, 2].max(keepdims=True)))

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=False, export_skins=True,
                          export_animations=False, export_yup=True)
print("EXPORTED", dst)
