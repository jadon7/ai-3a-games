"""把绑好骨的 GLB 的顶点位置、每根骨骼的权重、骨骼头尾存成 npz，给 numpy 分析用（哪块肉归哪根骨骼）。
用法: Blender -b --factory-startup -P dump_weights.py -- <rigged.glb> <out.npz>
"""
import sys
import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
mesh = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
V = np.array([(mesh.matrix_world @ v.co)[:] for v in mesh.data.vertices])
names = [b.name for b in arm.data.bones]
gi = {g.index: names.index(g.name) for g in mesh.vertex_groups if g.name in names}
W = np.zeros((len(V), len(names)), dtype=np.float32)
for v in mesh.data.vertices:
    for g in v.groups:
        if g.group in gi: W[v.index, gi[g.group]] += g.weight
mw = arm.matrix_world
heads = np.array([(mw @ b.head_local)[:] for b in arm.data.bones]); tails = np.array([(mw @ b.tail_local)[:] for b in arm.data.bones])
parents = np.array([names.index(b.parent.name) if b.parent else -1 for b in arm.data.bones])
mesh.data.calc_loop_triangles()
tris = np.array([t.vertices[:] for t in mesh.data.loop_triangles])
np.savez(argv[1], V=V, W=W, names=np.array(names), heads=heads, tails=tails, parents=parents, tris=tris)
print("DUMPED", argv[1], V.shape, W.shape, "objects:", [(o.name, o.type) for o in sc.objects], "mats:", [s.material.name for s in mesh.material_slots if s.material])
