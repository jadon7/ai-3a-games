"""把摆正后的模型的蒙皮导出来（每个顶点的静止位置、受哪几根骨骼管、各占多少），给 scripts/lib.py 在 Python 里算“蒙皮以后的网格”用：
这样不开 Blender 也能知道某个姿势下脚掌、肚子、下巴有没有陷进地里，求解的时候可以直接加“网格不许到地面以下”的约束。
用法: BL -b --factory-startup V2R/assets/model/beast.blend -P scripts/export_skin.py -- <输出 skin.npz>"""
import bpy, json, sys
import numpy as np
out = sys.argv[sys.argv.index("--") + 1]
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
sk = json.load(open("/Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model/beast_skeleton.json")); idx = {b["name"]: i for i, b in enumerate(sk["bones"])}
for pb in arm.pose.bones: pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); m = ev.to_mesh(); M = np.array(ev.matrix_world)
nv = len(m.vertices); co = np.zeros(nv * 3); m.vertices.foreach_get("co", co); co = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
no = np.zeros(nv * 3); m.vertices.foreach_get("normal", no); no = no.reshape(-1, 3) @ np.linalg.inv(M[:3, :3])      # 法线按逆转置变换
no /= np.linalg.norm(no, axis=1, keepdims=True) + 1e-9
vg = {g.index: g.name for g in body.vertex_groups}; B = np.zeros((nv, 4), int); W = np.zeros((nv, 4))
for v in body.data.vertices:
    gs = sorted([(g.weight, idx[vg[g.group]]) for g in v.groups if vg[g.group] in idx and g.weight > 0], reverse=True)[:4]; s = sum(w for w, _ in gs) or 1.0
    for k, (w, b) in enumerate(gs): B[v.index, k], W[v.index, k] = b, w / s
np.savez(out, co=co, normal=no, bones=B, weights=W)
print("SKIN", nv, "顶点；高度", round(float(co[:, 2].min()), 4), "~", round(float(co[:, 2].max()), 4), "；没有权重的顶点", int((W.sum(1) == 0).sum()))
