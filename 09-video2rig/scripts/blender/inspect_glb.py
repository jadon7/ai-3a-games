"""导入一个 GLB，打印网格/骨架信息，并渲染正面+侧面预览图。

用法: Blender -b --factory-startup -P scripts/blender/inspect_glb.py -- <in.glb> <out.png>
"""
import sys
import math
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
print("OBJECTS", [(o.name, o.type) for o in bpy.context.scene.objects])

lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for m in meshes:
    print("MESH", m.name, "verts", len(m.data.vertices), "faces", len(m.data.polygons),
          "mats", [s.material.name if s.material else None for s in m.material_slots],
          "vgroups", len(m.vertex_groups), "mods", [(md.type, md.name) for md in m.modifiers])
    for c in m.bound_box:
        w = m.matrix_world @ Vector(c)
        lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
        hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
print("BBOX_MIN", [round(v, 3) for v in lo], "BBOX_MAX", [round(v, 3) for v in hi], "SIZE", [round(v, 3) for v in (hi - lo)])

for a in arms:
    print("ARMATURE", a.name, "bones", len(a.data.bones), "scale", [round(v, 4) for v in a.scale],
          "rot", [round(math.degrees(v), 1) for v in a.rotation_euler], "loc", [round(v, 3) for v in a.location])
    for b in a.data.bones:
        h = a.matrix_world @ b.head_local
        t = a.matrix_world @ b.tail_local
        print("  BONE %-28s parent=%-24s head=(%.3f,%.3f,%.3f) tail=(%.3f,%.3f,%.3f) len=%.3f deform=%s" % (
            b.name, b.parent.name if b.parent else "-", h.x, h.y, h.z, t.x, t.y, t.z, (t - h).length, b.use_deform))

# 预览渲染：正交正面 + 侧面
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
center = (lo + hi) / 2
size = max((hi - lo).z, (hi - lo).x, (hi - lo).y) * 1.15
world = bpy.data.worlds.new("w")
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.5, 0.5, 0.5, 1)
bg.inputs[1].default_value = 1.0
sc.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 2.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-30))
sc.collection.objects.link(sun)


def cam(name, loc, rot):
    c = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    c.data.type = "ORTHO"
    c.data.ortho_scale = size
    c.location = loc
    c.rotation_euler = rot
    sc.collection.objects.link(c)
    return c


d = size * 3
cams = [
    cam("front", (center.x, center.y - d, center.z), (math.radians(90), 0, 0)),
    cam("side", (center.x - d, center.y, center.z), (math.radians(90), 0, math.radians(-90))),
]
if arms:
    for a in arms:
        a.show_in_front = True
        a.data.display_type = "STICK"
sc.render.resolution_x = sc.render.resolution_y = 640
sc.render.image_settings.file_format = "PNG"
paths = []
for c in cams:
    sc.camera = c
    sc.render.filepath = out.replace(".png", f"_{c.name}.png")
    bpy.ops.render.render(write_still=True)
    paths.append(sc.render.filepath)
print("RENDERED", paths)
