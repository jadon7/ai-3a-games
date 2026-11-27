"""导入一个 glTF 场景，打印尺寸，渲染俯视图和室内四向视图用于评估。
blender -b --factory-startup -P inspect_env.py -- <gltf> <out_prefix> [scale]
"""
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
scale = float(argv[2]) if len(argv) > 2 else 1.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scn = bpy.context.scene

meshes = [o for o in scn.objects if o.type == "MESH"]
roots = [o for o in scn.objects if o.parent is None]
for r in roots:
    r.scale = [s * scale for s in r.scale]
bpy.context.view_layer.update()

mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
print("NMESH", len(meshes), "FACES", sum(len(o.data.polygons) for o in meshes))
print("BBOX_MIN", [round(v, 2) for v in mn], "BBOX_MAX", [round(v, 2) for v in mx], "DIMS", [round(v, 2) for v in (mx - mn)])
for o in meshes[:12]:
    print("  OBJ", o.name, [round(v, 2) for v in o.dimensions], "mats", [m.name for m in o.data.materials][:4])
for m in bpy.data.materials:
    if m.use_nodes:
        print("  MAT", m.name, [n.type for n in m.node_tree.nodes])

# 白色环境光
w = bpy.data.worlds.new("w"); scn.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.0

scn.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"; prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type == "METAL")
scn.cycles.device = "GPU"
scn.cycles.samples = 24
scn.cycles.use_denoising = True
scn.render.resolution_x = 1280; scn.render.resolution_y = 720
scn.view_settings.view_transform = "Standard"

cen = (mn + mx) / 2
dims = mx - mn

# 俯视正交，裁掉天花板
cam_d = bpy.data.cameras.new("top"); cam = bpy.data.objects.new("top", cam_d); scn.collection.objects.link(cam)
cam_d.type = "ORTHO"; cam_d.ortho_scale = max(dims.x, dims.y * 16 / 9) * 1.05
cam.location = (cen.x, cen.y, mx.z + 5)
cut = mn.z + dims.z * 0.6
cam_d.clip_start = (mx.z + 5) - cut; cam_d.clip_end = 1000
scn.camera = cam
scn.render.filepath = out + "_top.jpg"; scn.render.image_settings.file_format = "JPEG"
bpy.ops.render.render(write_still=True)

# 室内视图
cam_d2 = bpy.data.cameras.new("in"); cam2 = bpy.data.objects.new("in", cam_d2); scn.collection.objects.link(cam2)
cam_d2.lens = 14; cam_d2.clip_start = 0.05
scn.camera = cam2
eye = Vector((cen.x, cen.y, mn.z + min(1.4, dims.z * 0.45)))
for i, ang in enumerate((0, 90, 180, 270)):
    cam2.location = eye
    cam2.rotation_euler = (math.radians(88), 0, math.radians(ang))
    scn.render.filepath = f"{out}_in{i}.jpg"
    bpy.ops.render.render(write_still=True)
print("DONE")
