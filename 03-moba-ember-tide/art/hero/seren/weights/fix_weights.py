"""塞伦专用：改 Tripo 绑骨的权重，写一份新的模型给 hero_build.py 的 rig 一步当输入（build.json 的 raw）。

为什么：Tripo 给两片扇贝肩甲的权重是混的（平均上臂 0.6、锁骨 0.24，另外头 0.07、脊柱 0.1），
转头、弯腰时肩甲会被拽变形，抬臂时一片壳的上下两半转的角度不一样。brief 要求肩甲只跟上臂走、螺壳盔只跟头走。
做法：
  肩甲：认出肩甲的顶点（见 pad_select.py 的判定，这里重写了一遍，在 Tripo 原始坐标里先摆正再判），整片换成同一组权重：
        上臂 ARM、锁骨 1-ARM。整片用同一组权重，壳就是硬的（只整体转），抬臂时转的角度是上臂的 ARM 倍，顶上不容易插进盔里。
        和没选中的部分（挂钩、和手臂接的那一圈）之间按距离过渡 BLEND 米，免得接缝处撕开。
  盔：  高过 z=0.82（摆正后的坐标，身高 1）的顶点全给头。下巴以上本来就该全跟头走。
用法: Blender -b --factory-startup -P art/hero/seren/weights/fix_weights.py -- <tripo_rigged.glb> <输出.glb> [ARM=0.85]
"""
import bpy, bmesh, sys, math, numpy as np
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]; ARM = float(argv[2]) if len(argv) > 2 else 0.85; BLEND = 0.015
MX = "mixamorig:"
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
o = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
for x in list(sc.objects):
    if x not in (arm, o): bpy.data.objects.remove(x, do_unlink=True)
B = arm.data.bones
# ---- 和 hero_build.py 的 rig 一步一样摆正（只用来算坐标，不改模型）----
toe = B[MX + "LeftToeBase"].head_local - B[MX + "LeftFoot"].head_local
yaw = -math.pi / 2 - math.atan2(toe.y, toe.x); R = Matrix.Rotation(round(yaw / (math.pi / 2)) * (math.pi / 2), 4, "Z")
hp = R @ B[MX + "Hips"].head_local; T = Matrix.Translation((-hp.x, -hp.y, 0)); M = T @ R
to_arm = arm.matrix_world.inverted() @ o.matrix_world
V = np.array([list(M @ (to_arm @ v.co)) for v in o.data.vertices])
bone = lambda n: (np.array(M @ B[MX + n].head_local), np.array(M @ B[MX + n].tail_local))
mat = np.zeros(len(V), int)
for p in o.data.polygons:
    for vi in p.vertices: mat[vi] = p.material_index
bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
isl = -np.ones(len(V), int); k = 0
for v in bm.verts:
    if isl[v.index] >= 0: continue
    st = [v]; isl[v.index] = k
    while st:
        x = st.pop()
        for e in x.link_edges:
            y = e.other_vert(x)
            if isl[y.index] < 0: isl[y.index] = k; st.append(y)
    k += 1
def seg_dist(P, a, b):
    d = b - a; t = np.clip(((P - a) @ d) / (d @ d), 0, 1); return np.linalg.norm(P - (a + t[:, None] * d), axis=1)
gi = {g.name: g.index for g in o.vertex_groups}
W = np.zeros((len(V), len(o.vertex_groups)))
for v in o.data.vertices:
    for g in v.groups: W[v.index, g.group] = g.weight
W0 = W.copy()
for side, sx in (("Left", 1), ("Right", -1)):
    a, b = bone(side + "Arm"); d = seg_dist(V, a, b)
    cand = (mat == 0) & (V[:, 0] * sx > 0.072) & (V[:, 2] > 0.6) & (V[:, 2] < 0.86) & (d > 0.04)
    pad = np.zeros(len(V), bool)
    for i in np.unique(isl[cand]):
        m = isl == i
        if cand[m].mean() > 0.5 and V[m, 2].mean() < 0.82: pad |= m & (V[:, 0] * sx > 0.062) & (V[:, 2] < 0.84)
    kd = KDTree(int(pad.sum())); [kd.insert(V[i], int(i)) for i in np.where(pad)[0]]; kd.balance()
    for _ in range(3):                                           # 补洞：只往肩外侧、离上臂轴线够远的地方补，不碰躯干
        add = [i for i in np.where((~pad) & (mat == 0) & (V[:, 0] * sx > 0.08) & (V[:, 2] > 0.62) & (V[:, 2] < 0.83) & (d > 0.034))[0] if kd.find(V[i])[2] < 0.008]
        pad[add] = True
        kd = KDTree(int(pad.sum())); [kd.insert(V[i], int(i)) for i in np.where(pad)[0]]; kd.balance()
    target = np.zeros(W.shape[1]); target[gi[MX + side + "Arm"]] = ARM; target[gi[MX + side + "Shoulder"]] = 1 - ARM
    # 选中的整片用 target；没选中、但离肩甲很近的（挂钩、接缝）按距离从 target 过渡回原来的权重
    near = np.where((~pad) & (mat == 0) & (V[:, 0] * sx > 0.05) & (V[:, 2] > 0.58) & (V[:, 2] < 0.86))[0]
    blended = 0
    for i in near:
        dist = kd.find(V[i])[2]
        if dist < BLEND:
            k_ = (1 - dist / BLEND) ** 2; W[i] = W0[i] * (1 - k_) + target * k_; blended += 1
    W[pad] = target
    print(f"PAD {side}: {pad.sum()} 个顶点换成 上臂 {ARM} / 锁骨 {1 - ARM:.2f}，边上过渡 {blended} 个；原来平均 上臂 {W0[pad, gi[MX + side + 'Arm']].mean():.2f} 锁骨 {W0[pad, gi[MX + side + 'Shoulder']].mean():.2f}")
# ---- 盔 ----
helm = (mat == 0) & (V[:, 2] > 0.82)
hz = (mat == 0) & (V[:, 2] > 0.80) & (V[:, 2] <= 0.82)
th = np.zeros(W.shape[1]); th[gi[MX + "Head"]] = 1.0
print("HELM", helm.sum(), "个顶点全给头；原来头权重 < 0.99 的", int((W0[helm, gi[MX + "Head"]] < 0.99).sum()))
W[helm] = th
for i in np.where(hz)[0]:
    k_ = (V[i, 2] - 0.80) / 0.02; W[i] = W[i] * (1 - k_) + th * k_
# ---- 写回 ----
W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
changed = np.where(np.abs(W - W0).max(1) > 1e-6)[0]
for i in changed:
    for g in o.vertex_groups:
        if W0[i, g.index] > 0 or W[i, g.index] > 0:
            if W[i, g.index] > 1e-5: g.add([int(i)], float(W[i, g.index]), "REPLACE")
            else: g.remove([int(i)])
print("CHANGED", len(changed))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=False, export_skins=True, export_yup=True, export_apply=False)
print("SAVED", dst)
