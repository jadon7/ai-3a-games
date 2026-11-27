"""定妆测试：湿地面 + 霓虹灯板 + 四辆车。
blender -b --factory-startup -P lookdev.py -- <out.png> [samples]
"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import mats

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
samples = int(argv[1]) if len(argv) > 1 else 64

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
setup_cycles(sc, samples=samples, res=(1920, 1080), pct=67)

mats.setup_world(sc, strength=0.35)

# 地面
bpy.ops.mesh.primitive_plane_add(size=200)
g = bpy.context.object
g.data.materials.append(mats.wet_asphalt("wet_asphalt_test", lanes=None))

# 霓虹灯板
panels = [((6, 9, 3), (0, 90, -90), (10, 3), (1.0, 0.05, 0.45), 40),
          ((-4, 9, 4), (0, 90, -90), (8, 4), (0.0, 0.8, 1.0), 30),
          ((-12, -10, 3), (0, 90, 90), (9, 3), (1.0, 0.45, 0.05), 25),
          ((14, -9, 5), (0, 90, 90), (6, 6), (0.5, 0.2, 1.0), 30)]
for i, (loc, rot, size, col, st) in enumerate(panels):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    p = bpy.context.object
    p.scale = (size[1], size[0], 1)
    p.rotation_euler = [math.radians(a) for a in rot]
    p.data.materials.append(emission_mat(f"neon{i}", col, st, sample=True))

# 车
layout = [("hero", (0, 0), 0), ("rival_purple", (-1.5, 4.2), 4), ("rival_yellow", (-7.5, -1.0), -3), ("rival_black", (-8.5, 4.6), 2)]
cars = {}
for n, (x, y), yaw in layout:
    c = load_car(n)
    c["root"].location = (x, y, 0)
    c["root"].rotation_euler = (0, 0, math.radians(yaw))
    add_headlights(c)
    cars[n] = c
cars["hero"]["steer"]["FL"].rotation_euler = (0, 0, math.radians(18))
cars["hero"]["steer"]["FR"].rotation_euler = (0, 0, math.radians(18))

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 35
cam.data.sensor_width = 36
cam.location = (6.2, -3.4, 0.75)
tgt = Vector((-1.0, 1.2, 0.55))
cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.dof.use_dof = True
cam.data.dof.focus_distance = (Vector((0.5, 0, 0.6)) - cam.location).length
cam.data.dof.aperture_fstop = 2.8

sc.render.filepath = out
sc.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)

# 第二个机位：车尾（追尾视角）
cam.location = (-7.0, 0.0, 1.5)
tgt = Vector((2.0, 0.0, 0.7))
cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.lens = 24
cam.data.dof.use_dof = False
for n in ("rival_yellow", "rival_black"):
    cars[n]["root"].location.x += 20
sc.render.filepath = out.replace(".png", "_rear.png")
bpy.ops.render.render(write_still=True)
