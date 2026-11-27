"""环境测试：几个机位的静帧。 blender -b --factory-startup -P test_env.py -- <outdir>"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector
from common import *
import env

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
env.setup_render(scn, spp=48, res=(1280, 720), mblur=False)
meshes = env.build_env()
cg = coll("CG")
env.link_env_light(meshes, cg)
env.build_world(scn)
cam = env.make_bodycam(scn, coll("Rig"))

# 一个测试用的手电
sd = bpy.data.lights.new("spot", "SPOT"); sp = bpy.data.objects.new("spot", sd); coll("Rig").objects.link(sp)
sd.energy = 4000; sd.spot_size = math.radians(14); sd.spot_blend = 0.6; sd.shadow_soft_size = 0.01
sd2 = bpy.data.lights.new("spill", "SPOT"); sp2 = bpy.data.objects.new("spill", sd2); coll("Rig").objects.link(sp2)
sd2.energy = 350; sd2.spot_size = math.radians(60); sd2.spot_blend = 0.5; sd2.shadow_soft_size = 0.01
sp.parent = cam; sp2.parent = cam
sp.location = (0, 0.25, -0.5); sp2.location = (0, 0.25, -0.5)

# 测试球放进 CG 集合看环境光匹配
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.15, location=(20.5, 2.0, 1.2))
s = bpy.context.active_object; move_to(s, cg)
m = bpy.data.materials.new("grey"); m.use_nodes = True; bsdf_of(m).inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1)
s.data.materials.append(m)

views = [
    ((24.6, 2.3, 1.77), (16.9, 2.0, 1.5)),
    ((22.5, 2.0, 1.77), (16.9, 2.0, 1.4)),
    ((20.0, 2.2, 1.77), (16.9, 2.0, 1.3)),
    ((22.5, 2.6, 1.77), (18.4, 0.0, 1.3)),
    ((18.5, 3.0, 1.77), (25.0, 2.5, 1.5)),
    ((21.0, 4.0, 1.77), (16.9, 2.0, 1.3)),
]
scn.render.image_settings.file_format = "JPEG"
for i, (p, t) in enumerate(views):
    cam.location = p
    cam.rotation_euler = look_at_euler(p, t)
    scn.view_settings.exposure = -0.8
    scn.render.filepath = os.path.join(out, f"env_{i}.jpg")
    bpy.ops.render.render(write_still=True)
print("DONE")
