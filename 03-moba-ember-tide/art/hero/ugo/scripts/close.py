"""近景检查图：在指定的中心点、指定的取景大小下，从几个角度渲染一个 GLB（或 .blend）。
用法: Blender -b --factory-startup -P close.py -- <in.glb> <输出前缀> <cx,cy,cz> <取景大小> <角度列表 "0:8,90:8"> [边长=640]
角度写成“水平角:俯角”，水平角 0 是从 -Y 往 +Y 看。
"""
import bpy, sys, math, os
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]
src, prefix, c, scale, spec = a[0], a[1], Vector([float(x) for x in a[2].split(",")]), float(a[3]), a[4]
res = int(a[5]) if len(a) > 5 else 640
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
for o in sc.objects:
    if o.type == "MESH" and o.name.startswith("Icosphere"): o.hide_render = True
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = scale; cam.data.clip_end = 100
files = []
for i, v in enumerate(spec.split(",")):
    az, el = (v.split(":") + ["8"])[:2]; az = math.radians(float(az)); el = math.radians(float(el))
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.location = c + d * 6; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
    f = f"{prefix}_{i}.png"; sc.render.filepath = f; bpy.ops.render.render(write_still=True); files.append(f)
print("FILES", " ".join(files))
