"""塞伦专用的检查渲染：读一个 GLB（原样的 Tripo 模型也行），按包围盒居中，从几个方向各渲一张，拼成一张图。
用法: Blender -b --factory-startup -P art/hero/seren/look.py -- <模型.glb> <输出.png> [边长=640] [方位:仰角,…=0:5,45:15,90:5,180:5,0:70]
"""
import bpy, sys, math, os
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]; res = int(argv[2]) if len(argv) > 2 else 640
spec = argv[3] if len(argv) > 3 else "0:5,45:15,90:5,180:5,0:70"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene; bpy.context.view_layer.update()
for o in sc.objects:
    if o.type == "MESH" and o.name.startswith("Icosphere"): o.hide_render = True
pts = []
for o in sc.objects:
    if o.type == "MESH" and not o.name.startswith("Icosphere"):
        for v in o.data.vertices: pts.append(o.matrix_world @ v.co)
mn = Vector([min(p[i] for p in pts) for i in range(3)]); mx = Vector([max(p[i] for p in pts) for i in range(3)]); c = (mn + mx) / 2; size = mx - mn
if len(argv) > 4:                                                # 近看：第 5 个参数 "x,y,z,画面宽" 指定看哪里、看多大
    _v = [float(t) for t in argv[4].split(",")]; c = Vector(_v[:3]); size = Vector((_v[3] / 1.08,) * 3)
print("BOUNDS", [round(v, 3) for v in mn], [round(v, 3) for v in mx], "size", [round(v, 3) for v in size])
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True
bg = next(n for n in wd.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs[0].default_value = (0.42, 0.43, 0.45, 1); bg.inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = max(size) * 1.08; cam.data.clip_end = 100
files = []
for i, v in enumerate(spec.split(",")):
    az, el = [math.radians(float(x)) for x in v.split(":")]
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.location = c + d * max(size) * 4; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
    f = out.replace(".png", f"_{i}.png"); sc.render.filepath = f; bpy.ops.render.render(write_still=True); files.append(f)
try:
    from PIL import Image
except ImportError:
    Image = None
if Image:
    ims = [Image.open(f) for f in files]; W = sum(im.size[0] for im in ims); sheet = Image.new("RGB", (W, res), (100, 100, 100)); x = 0
    for im in ims: sheet.paste(im.convert("RGB"), (x, 0)); x += im.size[0]
    sheet.save(out)
print("FILES", " ".join(files))
