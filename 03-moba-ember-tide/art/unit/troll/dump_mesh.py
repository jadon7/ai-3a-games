"""把巨魔摆正以后的静止网格倒出来：每个顶点的世界坐标（脚踩 z=0、面朝 -Y、身高 1）和它主要跟哪根骨骼。
resolve.py 的 --sole 用它在脚底取“不许入地”的点（光约束脚踝、脚尖这几个关节不够：脚一翘，脚跟或脚尖的肉就戳进地里了）。
用法: Blender -b --factory-startup V2R/assets/model/troll.blend -P art/unit/troll/dump_mesh.py -- <输出.npz>"""
import bpy, sys
import numpy as np
out = sys.argv[sys.argv.index("--") + 1]
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE"); body = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
arm.data.pose_position = "REST"; bpy.context.view_layer.update()
M = body.matrix_world; names = [g.name for g in body.vertex_groups]
V = np.array([list(M @ v.co) for v in body.data.vertices]); dom = []
for v in body.data.vertices:
    g = max(v.groups, key=lambda x: x.weight) if v.groups else None; dom.append(names[g.group] if g else "")
np.savez(out, verts=V, bone=np.array(dom)); print("DUMPED", len(V), "verts  z", V[:, 2].min().round(4), V[:, 2].max().round(4), " y", V[:, 1].min().round(3), V[:, 1].max().round(3), " x", V[:, 0].min().round(3), V[:, 0].max().round(3))
