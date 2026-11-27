"""看一眼脚本建的武器：Blender -b --factory-startup -P art/hero_iti/gear_preview.py -- <输出前缀>
出三张：顺着厚度看（刀面的轮廓）、斜着、正对刃口。坐标轴：+Y 拳眼方向，+Z 朝前臂（画一根灰棍当前臂，看反握的角度）。"""
import bpy, sys, os, math, importlib.util, bmesh
from mathutils import Vector
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sp = importlib.util.spec_from_file_location("g", os.path.join(os.path.dirname(os.path.abspath(__file__)), "gear.py")); g = importlib.util.module_from_spec(sp); sp.loader.exec_module(g)
me = g.make_blade(); o = bpy.data.objects.new("blade", me); bpy.context.scene.collection.objects.link(o)
me.calc_loop_triangles(); print("TRIS", len(me.loop_triangles))
co = [v.co for v in me.vertices]; print("BBOX", [round(min(c[i] for c in co), 3) for i in range(3)], [round(max(c[i] for c in co), 3) for i in range(3)])
bpy.ops.mesh.primitive_cylinder_add(radius=0.022, depth=0.16, location=(0, 0, 0.09)); fa = bpy.context.object      # 前臂（从拳心往 +Z）
mat = bpy.data.materials.new("arm"); mat.diffuse_color = (0.5, 0.5, 0.5, 1); fa.data.materials.append(mat)
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = 700; sc.render.resolution_y = 700; sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 3.0
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 0.42
c = Vector((0, -0.09, 0.05))
for i, d in enumerate((Vector((1, 0, 0)), Vector((0.7, -0.3, -0.65)).normalized(), Vector((0, -0.6, -0.8)).normalized())):
    cam.location = c + d * 2; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (d + Vector((0, 0.3, 0.8))).to_track_quat("Z", "Y").to_euler()
    sc.render.filepath = f"{out}_{i}.png"; bpy.ops.render.render(write_still=True)
print("DONE")
