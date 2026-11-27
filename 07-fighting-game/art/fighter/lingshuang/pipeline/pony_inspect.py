"""看马尾：静止姿势下脑后那一束的顶点（按位置圈），各吃哪些骨骼的权重。用法: Blender -b --factory-startup -P pony_inspect.py -- <rigged.glb>"""
import bpy, sys
import numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0]); sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE"); body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups))
co = np.array([body.matrix_world @ v.co for v in body.data.vertices]); B = arm.data.bones; W = arm.matrix_world
for b in ("Head", "HeadTop_End", "Neck", "Spine2", "Spine1", "Hips"):
    bb = B.get("mixamorig:" + b)
    if bb: print("BONE", b, [round(x, 3) for x in W @ bb.head_local])
gn = {g.index: g.name.replace("mixamorig:", "") for g in body.vertex_groups}
# 每个高度一层，打印这一层最靠后（+Y）的顶点 y 和身体后背的 y
for z in np.arange(0.40, 1.0, 0.04):
    s = (co[:, 2] > z) & (co[:, 2] < z + 0.04) & (np.abs(co[:, 0]) < 0.06)
    if s.sum(): ys = np.sort(co[s, 1]); print(f"z {z:.2f} n {s.sum():5d} y 分位 50/90/99/max {np.percentile(ys,50):.3f} {np.percentile(ys,90):.3f} {np.percentile(ys,99):.3f} {ys.max():.3f}")
def wsum(sel):
    acc = {}
    for i in np.nonzero(sel)[0]:
        for g in body.data.vertices[i].groups:
            acc[gn[g.group]] = acc.get(gn[g.group], 0) + g.weight
    t = sum(acc.values()); return {k: round(v / t, 3) for k, v in sorted(acc.items(), key=lambda kv: -kv[1])[:6]}
for z0, z1 in ((0.70, 0.76), (0.76, 0.82), (0.82, 0.88), (0.88, 0.94), (0.94, 1.0)):
    for y0 in (0.06, 0.09, 0.11):
        s = (co[:, 1] > y0) & (co[:, 2] > z0) & (co[:, 2] < z1)
        print(f"W z {z0}-{z1} y>{y0} n {s.sum()} x [{co[s,0].min() if s.sum() else 0:.3f},{co[s,0].max() if s.sum() else 0:.3f}]", wsum(s))
