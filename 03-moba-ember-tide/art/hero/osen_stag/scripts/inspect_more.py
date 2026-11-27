"""补充看骨架：每根骨骼的头尾坐标；某几根骨骼管的顶点沿身体前后的分布。
用法: Blender -b --factory-startup -P inspect_more.py -- <rigged.glb> [骨骼名 ...]"""
import sys, bpy, numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
mesh = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
print("OBJECTS", [(o.name, o.type, tuple(round(v, 3) for v in o.scale), tuple(round(v, 3) for v in o.rotation_euler)) for o in sc.objects])
mw = arm.matrix_world
for b in arm.data.bones:
    h, t = mw @ b.head_local, mw @ b.tail_local
    print("B %-22s parent=%-22s head=(%+.3f,%+.3f,%+.3f) tail=(%+.3f,%+.3f,%+.3f) len=%.3f connect=%s" % (b.name, b.parent.name if b.parent else "-", *h, *t, (t - h).length, b.use_connect))
V = np.array([(mesh.matrix_world @ v.co)[:] for v in mesh.data.vertices])
gname = {g.index: g.name for g in mesh.vertex_groups}
W = {n: np.zeros(len(V)) for n in gname.values()}
for v in mesh.data.vertices:
    for g in v.groups: W[gname[g.group]][v.index] = g.weight
print("VERTS", len(V), "tris", sum(len(p.vertices) - 2 for p in mesh.data.polygons), "materials", [s.material.name for s in mesh.material_slots])
for bn in argv[1:]:
    w = W[bn]; idx = np.where(w > 0.3)[0]
    print("== ", bn, "verts>0.3:", len(idx))
    ys = np.linspace(V[:, 1].min(), V[:, 1].max(), 13)
    for a, b_ in zip(ys[:-1], ys[1:]):
        sel = idx[(V[idx, 1] >= a) & (V[idx, 1] < b_)]
        if len(sel): print("   y[%+.2f,%+.2f] n=%5d x[%+.2f,%+.2f] z[%.2f,%.2f] w_mean=%.2f" % (a, b_, len(sel), V[sel, 0].min(), V[sel, 0].max(), V[sel, 2].min(), V[sel, 2].max(), w[sel].mean()))
# 每个顶点最大权重属于哪根骨骼：按区域统计（看挂件跟谁走）
names = list(W); M = np.stack([W[n] for n in names], 1); top = M.argmax(1)
def region(tag, cond):
    sel = np.where(cond)[0]
    if not len(sel): print("REGION", tag, "空"); return
    cnt = np.bincount(top[sel], minlength=len(names)); order = np.argsort(-cnt)[:5]
    print("REGION %-10s n=%5d  " % (tag, len(sel)) + ", ".join(f"{names[i]}:{cnt[i]}" for i in order if cnt[i]))
x, y, z = V.T
region("吊炉", (y < -0.20) & (z < 0.36) & (z > 0.15) & (np.abs(x) < 0.08))
region("尾巴", (y > 0.38) & (z > 0.30))
region("左卷轴钥匙", (x > 0.15) & (np.abs(y) < 0.2) & (z > 0.25) & (z < 0.5))
region("右侧挂件", (x < -0.15) & (np.abs(y) < 0.2) & (z > 0.25) & (z < 0.5))
region("鞍布下摆", (np.abs(y) < 0.25) & (z > 0.17) & (z < 0.30))
region("鹿角", (z > 0.85))
region("胡须", (y < -0.36) & (z > 0.5) & (z < 0.72))
# 鹿角左右最外、最高的点；鼻尖
hd = np.where(W["tripo::Head_0"] > 0.5)[0]
for tag, ax in (("左角外", (1, 0, 0.3)), ("右角外", (-1, 0, 0.3)), ("左角高", (0.4, 0, 1)), ("右角高", (-0.4, 0, 1)), ("鼻尖", (0, -1, 0)), ("最高", (0, 0, 1))):
    s = V[hd] @ (np.array(ax, float) / np.linalg.norm(ax)); pick = hd[np.argsort(-s)[:max(3, int(len(hd) * 0.004))]]
    print("MARK %-6s (%+.3f,%+.3f,%+.3f) n=%d" % (tag, *V[pick].mean(0), len(pick)))
