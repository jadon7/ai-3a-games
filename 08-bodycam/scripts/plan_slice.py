"""把扫描场景切成平面图数据：各高度的水平截线、地面高度图、天花高度图。
blender -b --factory-startup -P scripts/plan_slice.py -- <gltf> <out.npz> [scale]
"""
import bpy, sys, numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
scale = float(argv[2]) if len(argv) > 2 else 1.0
for o in bpy.context.scene.objects:
    if o.parent is None:
        o.scale = [s * scale for s in o.scale]
bpy.context.view_layer.update()
V = []; T = []
off = 0
for o in bpy.context.scene.objects:
    if o.type != "MESH": continue
    me = o.data; me.calc_loop_triangles()
    co = np.empty(len(me.vertices) * 3, np.float64); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    M = np.array(o.matrix_world)
    co = co @ M[:3, :3].T + M[:3, 3]
    tri = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get("vertices", tri)
    V.append(co); T.append(tri.reshape(-1, 3) + off); off += len(co)
V = np.concatenate(V); T = np.concatenate(T)
print("VERTS", len(V), "TRIS", len(T), "BBOX", V.min(0).round(2), V.max(0).round(2))
np.savez_compressed(argv[1], V=V.astype(np.float32), T=T)
