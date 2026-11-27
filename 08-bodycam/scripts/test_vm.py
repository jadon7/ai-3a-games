"""第一人称机位测试。 blender -b --factory-startup -P test_vm.py -- <outdir>"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector
from common import *
import env, viewmodel

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
env.setup_render(scn, spp=64, res=(1280, 720), mblur=False)
meshes = env.build_env()
cg = coll("CG"); rig = coll("Rig")
env.link_env_light(meshes, cg)
env.build_world(scn)

torso = empty("Torso", rig)
cam = env.make_bodycam(scn, rig)
cam.parent = torso
vm, info = viewmodel.build_viewmodel(cg, torso)
viewmodel.add_weapon_light(vm, info, rig)

torso.location = (22.6, 2.2, 0.42 + 1.52)
torso.rotation_euler = (0, 0, math.radians(90 + 4))   # +Y 朝向 -X

tests = [
    ((0.02, -0.50, 0.21), 90, (0, 0, 0)),
    ((0.02, -0.46, 0.17), 86, (0, 0, 0)),
    ((0.03, -0.42, 0.14), 84, (0, 0, 0)),
    ((0.0, -0.40, -0.06), 96, (0, 0, 0)),
]
scn.render.image_settings.file_format = "JPEG"
scn.view_settings.exposure = -0.8
for i, (p, pitch, vmoff) in enumerate(tests):
    cam.location = p
    cam.rotation_euler = (math.radians(pitch), 0, 0)
    vm.location = vmoff
    scn.render.filepath = os.path.join(out, f"vm_{i}.jpg")
    bpy.ops.render.render(write_still=True)
print("DONE")
