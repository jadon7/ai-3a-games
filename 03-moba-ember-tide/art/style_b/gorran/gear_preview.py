"""单独看武器：把战锤和塔盾按设计图的摆法（盾正对镜头，锤头朝上、侧面对镜头）渲染几个角度，和 art/style_b/concept/gorran-p1-game-v2.png 对着看。
B：材质按游戏里 B 的处理渲（金属 0、粗糙 1：明暗和高光都画在贴图里了）。
用法: Blender -b --factory-startup -P art/style_b/gorran/gear_preview.py -- out.png [每格边长=720] [角度 "0:4,35:15,180:8,0:60"]
"""
import bpy, sys, os, math, importlib.util
import numpy as np
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index("--") + 1:]; out = argv[0]; res = int(argv[1]) if len(argv) > 1 else 720
views = argv[2] if len(argv) > 2 else "0:4,35:15,180:8,0:60"
here = os.path.dirname(os.path.abspath(__file__))
sp = importlib.util.spec_from_file_location("gear", os.path.join(here, "gear.py")); gear = importlib.util.module_from_spec(sp); sp.loader.exec_module(gear)
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
sh = bpy.data.objects.new("shield", gear.make_shield()); hm = bpy.data.objects.new("hammer", gear.make_hammer())
for o in (sh, hm): sc.collection.objects.link(o)
sh.data.transform(Matrix.Translation((-0.2, 0, 0.31)) @ Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1))))       # 盾面 +Z → 朝镜头（-Y），高 +Y → 朝上
hm.data.transform(Matrix.Translation((0.27, 0, 0.26)) @ Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))      # 锤头 +Y → 朝上，喇叭口（-Z）→ 朝右
tot = 0
for o in (sh, hm):
    o.data.calc_loop_triangles(); n = len(o.data.loop_triangles); tot += n
    co = [v.co for v in o.data.vertices]; print("PART", o.name, "tris", n, "size", [round(max(c[i] for c in co) - min(c[i] for c in co), 3) for i in range(3)])
print("TOTAL tris", tot)
for m in bpy.data.materials:
    b_ = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.use_nodes else None
    if b_: b_.inputs["Metallic"].default_value = 0.0; b_.inputs["Roughness"].default_value = 1.0
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = 0.98; c = Vector((0.03, 0, 0.3)); files = []
for i, v in enumerate(views.split(",")):
    az, el = [math.radians(float(x)) for x in v.split(":")]; d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.location = c + d * 6; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
    f = f"{os.path.splitext(out)[0]}_{i}.png"; sc.render.filepath = f; bpy.ops.render.render(write_still=True); files.append(f)
cols = min(2, len(files)); rows = (len(files) + cols - 1) // cols; buf = np.zeros((res * rows, res * cols, 4), np.float32); buf[..., 3] = 1
for k, f in enumerate(files):
    im = bpy.data.images.load(f); a = np.empty(res * res * 4, np.float32); im.pixels.foreach_get(a); r, cc = k // cols, k % cols
    buf[(rows - 1 - r) * res:(rows - r) * res, cc * res:(cc + 1) * res] = a.reshape(res, res, 4); bpy.data.images.remove(im); os.remove(f)
sheet = bpy.data.images.new("sheet", res * cols, res * rows, alpha=False); sheet.pixels.foreach_set(buf.ravel()); sheet.filepath_raw = out; sheet.file_format = "PNG"; sheet.save()
# 贴图也存一份出来看
for nm in ("weapon_gorran", "weapon_gorran_ember"):
    im = bpy.data.images.get(nm)
    if im: im.filepath_raw = os.path.join(os.path.dirname(out), nm + ".png"); im.file_format = "PNG"; im.save()
print("SHEET", out)
