"""查“游戏里的蒙皮法线”和“变形后真实的表面法线”差多少。
游戏（three.js）里法线是跟着骨骼线性混合的：一个顶点同时受躯干和上臂管、上臂又转了 170 度时，混出来的法线会朝里，边缘光就把那一片打成浅蓝色。
Blender 渲染时法线是按变形后的网格重新算的，所以管线的检查图里看不出来。
用法: Blender -b --factory-startup <mandrill.blend> -P normal_check.py -- <动作.npz> <帧号> <输出前缀>
打印法线差超过 90 度的顶点有多少、主要受哪些骨骼管，并把这些顶点涂红渲染正面、侧面两张（<前缀>_front.png、_side.png）。
"""
import bpy, sys, os
import numpy as np
from mathutils import Quaternion, Vector
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, os.path.join(V2R, "scripts/blender"))
import bl_common as bc  # noqa: E402
npz, frame, out = sys.argv[sys.argv.index("--") + 1:][:3]; frame = int(frame)
sc = bpy.context.scene; arm, mesh = bc.character(); PB = arm.pose.bones
m = np.load(npz, allow_pickle=True); names = [str(x) for x in m["names"]]; skel_root = next(b.name for b in arm.data.bones if b.parent is None)
for pb in PB: pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.context.view_layer.update()
me = mesh.data; n = len(me.vertices)
rest_co = np.array([v.co[:] for v in me.vertices]); rest_no = np.array([v.normal[:] for v in me.vertices])
for i, nm in enumerate(names):
    if nm in PB: PB[nm].rotation_quaternion = Quaternion(m["quats"][frame, i])
PB[skel_root].location = Vector(m["loc"][frame]); bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); ev = mesh.evaluated_get(dg); em = ev.to_mesh()
true_no = np.array([v.normal[:] for v in em.vertices]); ev.to_mesh_clear()
# 线性混合的法线：每根骨骼的 (姿势矩阵 × 静止矩阵的逆) 的旋转部分，按权重加起来
R = {}
for pb in PB:
    M = np.array(pb.matrix) @ np.linalg.inv(np.array(pb.bone.matrix_local)); R[pb.name] = M[:3, :3]
gname = {g.index: g.name for g in mesh.vertex_groups}; lbs = np.zeros((n, 3)); W = [dict() for _ in range(n)]
for v in me.vertices:
    for g in v.groups:
        if g.weight > 0 and gname[g.group] in R: lbs[v.index] += g.weight * (R[gname[g.group]] @ rest_no[v.index]); W[v.index][gname[g.group]] = g.weight
ln = np.linalg.norm(lbs, axis=1); lbs /= np.maximum(ln, 1e-9)[:, None]
dot = np.sum(lbs * true_no, axis=1); bad = dot < 0.0; mid = (dot >= 0.0) & (dot < 0.5)
print(f"NORMALS 第 {frame} 帧: 法线差超过 90 度的顶点 {int(bad.sum())}/{n}（{bad.mean() * 100:.1f}%），60~90 度的 {int(mid.sum())}（{mid.mean() * 100:.1f}%）；混合后法线长度不到 0.5 的 {(ln < 0.5).sum()}")
from collections import Counter
c = Counter()
for i in np.where(bad)[0]:
    key = "+".join(sorted(k.split(":")[-1] for k, w in W[i].items() if w > 0.15)); c[key] += 1
print("BAD 顶点的骨骼组合:", c.most_common(8))
attr = me.color_attributes.new("ncol", "FLOAT_COLOR", "POINT"); col = np.tile(np.array([0.5, 0.5, 0.5, 1.0]), (n, 1)); col[mid] = (1, 0.7, 0, 1); col[bad] = (1, 0, 0, 1)
attr.data.foreach_set("color", col.ravel())
mat = bpy.data.materials.new("n"); mat.use_nodes = True; nt = mat.node_tree; bsdf = next(x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"); a_ = nt.nodes.new("ShaderNodeVertexColor"); a_.layer_name = "ncol"
nt.links.new(a_.outputs[0], bsdf.inputs["Base Color"]); me.materials.clear(); me.materials.append(mat)
bc.setup_render(sc); bc.render_views(sc, out + "_{view}.png"); print("RENDERED", out)
