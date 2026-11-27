"""无界面渲染一个 GLB 的预览图，机位模拟 MOBA 俯视。
用法: Blender -b --factory-startup -P tools/blender/preview.py -- in.glb out.png [俯仰角=55] [分辨率=900]
"""
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
pitch = float(argv[2]) if len(argv) > 2 else 55.0
res = int(argv[3]) if len(argv) > 3 else 900
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
tris = 0; mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for o in meshes:
    o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
size = mx - mn; center = (mn + mx) / 2
print("MESHES", len(meshes), "TRIS", tris, "SIZE", [round(v, 3) for v in size], "MIN", [round(v, 3) for v in mn])
for o in meshes:
    for s in o.material_slots:
        m = s.material
        if m and m.node_tree:
            print("MAT", m.name, [(n.type, getattr(getattr(n, "image", None), "size", [0, 0])[:]) for n in m.node_tree.nodes if n.type == "TEX_IMAGE"])
sc = bpy.context.scene
try: sc.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    try: sc.render.engine = "BLENDER_EEVEE"
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.render.film_transparent = False
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.34, 0.38, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun)
sun.data.energy = 3.0; sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
r = max(size) * 1.25
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = r * 1.15
p = math.radians(pitch)
cam.location = center + Vector((0, -math.cos(p), math.sin(p))) * r * 3
cam.rotation_euler = (math.radians(90) - p, 0, 0)
sc.render.filepath = out; sc.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
