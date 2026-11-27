"""单独看赫达 B 的熔炉和火钳：Blender -b --factory-startup -P art/style_b/hedda/gear_preview.py -- <输出.png> [每格边长=600]
炉子按背在身上的朝向摆（+Y 朝背后），火钳竖着放在旁边；渲正面（看得到烟囱从左肩上伸出去）、背面（炉门在右下）、斜上方三格。
材质按游戏里 B 的处理渲（金属 0、粗糙 1：明暗和高光都画在贴图里了），和 hedda-p1-back.png 对着看。"""
import bpy, sys, os, importlib.util
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index("--") + 1:]; out = argv[0]; res = int(argv[1]) if len(argv) > 1 else 600
here = os.path.dirname(os.path.abspath(__file__))
sp = importlib.util.spec_from_file_location("gear", os.path.join(here, "gear.py")); gear = importlib.util.module_from_spec(sp); sp.loader.exec_module(gear)
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
fo = bpy.data.objects.new("forge", gear.make_forge()); to = bpy.data.objects.new("tongs", gear.make_tongs())
for o in (fo, to): sc.collection.objects.link(o)
fo.data.transform(Matrix.Translation((0, 0, 0.52)) @ Matrix.Scale(1.05, 4))                        # 炉底在身高 0.52（add_forge.py 的 Z0），放大 1.05
to.data.transform(Matrix.Translation((-0.36, 0.1, 0.46)) @ Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1))))      # 钳口朝上
for o in (fo, to):
    o.data.calc_loop_triangles(); co = [v.co for v in o.data.vertices]
    print("PART", o.name, "tris", len(o.data.loop_triangles), "z", round(min(c.z for c in co), 3), round(max(c.z for c in co), 3))
for m in bpy.data.materials:
    b_ = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.use_nodes else None
    if b_: b_.inputs["Metallic"].default_value = 0.0; b_.inputs["Roughness"].default_value = 1.0
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
next(n for n in w.node_tree.nodes if n.type == "BACKGROUND").inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 3.0
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = 0.8; c = Vector((-0.1, 0.13, 0.62))
for i, d in enumerate((Vector((0, -1, 0.15)), Vector((0, 1, 0.15)), Vector((0.5, 0.8, 0.9)))):
    d = d.normalized(); cam.location = c + d * 3; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (d + Vector((0.4, 0, 0.8))).to_track_quat("Z", "Y").to_euler()
    sc.render.filepath = f"{out}_{i}.png"; bpy.ops.render.render(write_still=True)
print("DONE")
