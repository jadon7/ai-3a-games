"""导入绑好骨的 GLB，统计每根骨骼的蒙皮权重，并把骨架画在侧面 / 顶面 / 正面三张正交渲染图上。

用法: Blender -b --factory-startup -P scripts/blender/inspect_weights.py -- <rigged.glb> <out_prefix>
"""
import math
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
mesh = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
for o in list(sc.objects):
    if o.type == "MESH" and o is not mesh:
        bpy.data.objects.remove(o, do_unlink=True)

V = np.array([(mesh.matrix_world @ v.co)[:] for v in mesh.data.vertices])
print("MESH_BBOX", V.min(0).round(3), V.max(0).round(3))
gname = {g.index: g.name for g in mesh.vertex_groups}
wsum = {n: 0.0 for n in gname.values()}
cnt = {n: 0 for n in gname.values()}
cen = {n: np.zeros(3) for n in gname.values()}
lo = {n: np.full(3, 1e9) for n in gname.values()}
hi = {n: np.full(3, -1e9) for n in gname.values()}
for v in mesh.data.vertices:
    for g in v.groups:
        n = gname[g.group]
        wsum[n] += g.weight
        cen[n] += g.weight * V[v.index]
        if g.weight > 0.3:
            cnt[n] += 1
            lo[n] = np.minimum(lo[n], V[v.index])
            hi[n] = np.maximum(hi[n], V[v.index])
mw = arm.matrix_world
for b in arm.data.bones:
    n = b.name
    w = wsum.get(n, 0.0)
    c = cen[n] / w if w > 1e-6 else np.zeros(3)
    h = mw @ b.head_local
    box = "box x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]" % (lo[n][0], hi[n][0], lo[n][1], hi[n][1], lo[n][2], hi[n][2]) if cnt.get(n) else "-"
    print("W %-24s parent=%-22s wsum=%8.1f n>0.3=%5d centroid=(%+.3f,%+.3f,%+.3f) head=(%+.3f,%+.3f,%+.3f) %s" % (
        n, b.parent.name if b.parent else "-", w, cnt.get(n, 0), *c, h.x, h.y, h.z, box))

# 三张正交渲染
sc.render.engine = "BLENDER_EEVEE"
world = bpy.data.worlds.new("w"); world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.6, 0.6, 0.6, 1); bg.inputs[1].default_value = 1.0
sc.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 2.5
sun.rotation_euler = (math.radians(50), 0, math.radians(120)); sc.collection.objects.link(sun)
c0 = (V.min(0) + V.max(0)) / 2
size = float((V.max(0) - V.min(0)).max()) * 1.12
views = {"side": ((c0[0], c0[1] - 5, c0[2]), (math.radians(90), 0, 0)),          # 沿 +Y 看：画面右 = +X
         "top": ((c0[0], c0[1], c0[2] + 5), (0, 0, 0)),                           # 俯视：画面右 = +X，上 = +Y
         "front": ((c0[0] + 5, c0[1], c0[2]), (math.radians(90), 0, math.radians(90)))}   # 沿 -X 看
sc.render.resolution_x = sc.render.resolution_y = 1100
sc.render.image_settings.file_format = "PNG"
from bpy_extras.object_utils import world_to_camera_view
import json
lines = {}
for name, (loc, rot) in views.items():
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.type = "ORTHO"; cam.data.ortho_scale = size; cam.location = loc; cam.rotation_euler = rot
    sc.collection.objects.link(cam); sc.camera = cam
    sc.render.filepath = f"{out}_{name}.png"
    bpy.ops.render.render(write_still=True)
    bpy.context.view_layer.update()
    segs = []
    for b in arm.data.bones:
        h = world_to_camera_view(sc, cam, mw @ b.head_local); t = world_to_camera_view(sc, cam, mw @ b.tail_local)
        segs.append((b.name, h.x, 1 - h.y, t.x, 1 - t.y))
    lines[name] = segs
with open(f"{out}_bones2d.json", "w") as f:
    json.dump(lines, f)
print("RENDERED", out)
