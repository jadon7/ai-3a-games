"""看一眼脚本建的武器：Blender -b --factory-startup -P art/style_b/moko/gear_preview.py -- <输出前缀>
出两张：侧面（顺着厚度方向看，看月牙的侧边）和斜 45 度（看厚度）。"""
import bpy, sys, os, math, importlib.util
from mathutils import Vector
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sp = importlib.util.spec_from_file_location("g", os.path.join(os.path.dirname(os.path.abspath(__file__)), "gear.py")); g = importlib.util.module_from_spec(sp); sp.loader.exec_module(g)
me = g.make_staff(); o = bpy.data.objects.new("blade", me); bpy.context.scene.collection.objects.link(o)
me.calc_loop_triangles(); print("TRIS", len(me.loop_triangles))
co = [v.co for v in me.vertices]; print("BBOX", [round(min(c[i] for c in co), 3) for i in range(3)], [round(max(c[i] for c in co), 3) for i in range(3)])
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = 700; sc.render.resolution_y = 700; sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 3.0
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.35
c = Vector((0.03, 0.05, 0.0))
for i, d in enumerate((Vector((1, 0, 0)), Vector((0.7, 0.25, -0.67)).normalized(), Vector((0, 0, 1)))):      # 侧面（看轮廓）、斜着、正对刃口
    cam.location = c + d * 2; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler() if abs(d.y) < 0.9 and abs(d.z) < 0.9 else (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (d + Vector((0, 0.8, 0.3))).to_track_quat("Z", "Y").to_euler()
    sc.render.filepath = f"{out}_{i}.png"; bpy.ops.render.render(write_still=True)
print("DONE")
