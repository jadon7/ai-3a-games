"""统计扇贝肩甲和螺壳盔的顶点吃哪些骨骼的权重（读摆正后的 seren_rigged.glb 或 Tripo 原始模型）。
用法: Blender -b --factory-startup -P art/hero/seren/weights/pad_stats.py -- <glb> [out.npz]
肩甲的顶点：在上臂骨骼周围、离骨骼轴线比手臂皮肤远（>0.045）的那一圈，或者高过肩关节的；盔：高过 z=0.80 且不在脖子以下。"""
import bpy, sys, numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
B = arm.data.bones; to_arm = arm.matrix_world.inverted() @ body.matrix_world
V = np.array([list(to_arm @ v.co) for v in body.data.vertices]); names = [g.name for g in body.vertex_groups]
W = np.zeros((len(V), len(names)))
for v in body.data.vertices:
    for g in v.groups: W[v.index, g.group] = g.weight
mats = np.array([0] * len(V))
for p in body.data.polygons:
    for vi in p.vertices: mats[vi] = p.material_index
def seg_dist(P, a, b):
    a = np.array(a); b = np.array(b); d = b - a; t = np.clip(((P - a) @ d) / (d @ d), 0, 1); return np.linalg.norm(P - (a + t[:, None] * d), axis=1), t
res = {}
for side, sx in (("Left", 1), ("Right", -1)):
    ua = B["mixamorig:" + side + "Arm"]; sh = B["mixamorig:" + side + "Shoulder"]
    dist, t = seg_dist(V, ua.head_local, ua.tail_local)
    pad = (mats == 0) & (V[:, 0] * sx > 0.06) & (V[:, 2] > 0.58) & (V[:, 2] < 0.86) & ((dist > 0.045) | ((V[:, 2] > ua.head_local.z + 0.02) & (V[:, 0] * sx > 0.07)))
    res[side] = pad
    s = W[pad].sum(0); top = np.argsort(-s)[:6]
    print(f"PAD {side}: {pad.sum()} 个顶点  " + "  ".join(f"{names[i].replace('mixamorig:','')} {s[i] / pad.sum():.2f}" for i in top if s[i] > 0))
    for lim in (0.3, 0.6):
        print(f"   上臂权重 < {lim} 的: {(W[pad, names.index('mixamorig:' + side + 'Arm')] < lim).sum()}")
helm = (mats == 0) & (V[:, 2] > 0.80) & (np.abs(V[:, 0]) < 0.2)
s = W[helm].sum(0); top = np.argsort(-s)[:5]
print(f"HELM: {helm.sum()} 个顶点  " + "  ".join(f"{names[i].replace('mixamorig:','')} {s[i] / helm.sum():.2f}" for i in top if s[i] > 0))
print("   头权重 < 0.95 的:", (W[helm, names.index('mixamorig:Head')] < 0.95).sum(), " 最低 z:", round(float(V[helm, 2].min()), 3))
if len(argv) > 1: np.savez(argv[1], V=V, W=W, names=np.array(names), padL=res["Left"], padR=res["Right"], helm=helm)
