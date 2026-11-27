"""单独看沉钟长锤：数三角形，渲染几个角度（整件两面、钟的近景、柄尾的近景）。
用法: Blender -b --factory-startup -P art/hero/torg/gear_preview.py -- <输出前缀>
"""
import bpy, sys, os, math, importlib.util
from mathutils import Vector, Matrix
here = os.path.dirname(os.path.abspath(__file__)); prefix = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sp = importlib.util.spec_from_file_location("gear_torg", os.path.join(here, "gear.py")); gear = importlib.util.module_from_spec(sp); sp.loader.exec_module(gear)
me = gear.make_hammer(); sc = bpy.context.scene
ob = bpy.data.objects.new("hammer", me); sc.collection.objects.link(ob)
me.calc_loop_triangles(); ys = [v.co.y for v in me.vertices]
by = {}
for t in me.loop_triangles: by[me.materials[t.material_index].name] = by.get(me.materials[t.material_index].name, 0) + 1
print("TRIS", len(me.loop_triangles), by, "verts", len(me.vertices), "长", round(max(ys) - min(ys), 4), "y", round(min(ys), 4), round(max(ys), 4),
      "最大半径", round(max(math.hypot(v.co.x, v.co.z) for v in me.vertices), 4), "uv 层", [u.name for u in me.uv_layers], "材质", [m.name for m in me.materials])
ob.matrix_world = Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Translation((0, gear.GRIP - gear.LEN / 2, 0))      # 竖起来，钟朝上，中点在原点
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.36, 0.36, 0.37, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 3.0
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"
shots = [("full_a", 0, 5, 1.22, 0.0, 380, 1200), ("full_b", 90, 5, 1.22, 0.0, 380, 1200), ("bell_a", 20, 12, 0.36, 0.42, 800, 800), ("bell_low", 200, -28, 0.36, 0.40, 800, 800),
         ("bell_top", 120, 50, 0.36, 0.45, 800, 800), ("mid", 60, 8, 0.40, -0.02, 800, 800), ("butt", 0, 10, 0.36, -0.44, 800, 800), ("butt_b", 90, 10, 0.36, -0.44, 800, 800)]
for name, az, el, scale, zc, rx, ry in shots:
    az = math.radians(az); el = math.radians(el); d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))); c = Vector((0, 0, zc))
    cam.data.ortho_scale = scale; cam.location = c + d * 4; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
    sc.render.resolution_x = rx; sc.render.resolution_y = ry; sc.render.filepath = f"{prefix}_{name}.png"; bpy.ops.render.render(write_still=True)
me.materials[1].node_tree.nodes  # 贴图另存一份，方便直接看
img = bpy.data.images["weapon_torg"]; img.filepath_raw = f"{prefix}_tex.png"; img.save()
print("DONE")
