"""披风布料解算调参：假人躯干 + 披风，烘焙后渲染几帧侧视图。
用法：Blender -b -P cape_test.py -- <wind> <turb> <tag>
"""
import bpy, sys, os, math, time
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
sys.path.insert(0, os.path.join(HERE, '..', 'assets', 'char'))
import scene_common as sc
import char_lib as cl

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
wind_s = float(argv[0]) if argv else 900.0
turb_s = float(argv[1]) if len(argv) > 1 else 45.0
tag = argv[2] if len(argv) > 2 else 'a'
mass = float(argv[3]) if len(argv) > 3 else 0.02
grav = float(argv[4]) if len(argv) > 4 else 1.0
norender = len(argv) > 5

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, 120
# 假人：前倾的躯干椭球 + 头
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0.05, 0, 0.95))
torso = bpy.context.object; torso.scale = (0.2, 0.22, 0.38); torso.rotation_euler = (0, math.radians(25), 0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.13, location=(0.28, 0, 1.38))
head = bpy.context.object
cape = cl.make_cape((-0.02, 0.2, 1.25), (-0.02, -0.2, 1.25))
scene.collection.objects.link(cape)
cape.data.materials.append(cl.cape_material())
wind, turb = cl.add_cloth(cape, collider=torso, wind_strength=wind_s, turb_strength=turb_s, frames=(1, 120))
bpy.context.view_layer.objects.active = cape
cs_ = cape.modifiers['Cloth'].settings
cs_.mass = mass
cs_.effector_weights.gravity = grav
print('WIND', wind.field.type, wind.field.strength, wind.field.flow, tuple(wind.matrix_world.col[2])[:3], 'TURB', turb.field.type, turb.field.strength)
t0 = time.time()
# 逐帧推进（后台模式下最稳的烘焙方式）
for f in range(1, 121):
    scene.frame_set(f)
print('SIM %.1fs' % (time.time() - t0))

import numpy as np
dg = bpy.context.evaluated_depsgraph_get()
ev = cape.evaluated_get(dg)
co = np.array([v.co[:] for v in ev.data.vertices])
print('CAPE bbox', co.min(0).round(2), co.max(0).round(2))
if norender:
    raise SystemExit
sc.setup_render(scene, res=(640, 400), samples=24, motion_blur=False)
sc.setup_world(scene)
cam_d = bpy.data.cameras.new('c'); cam_d.lens = 50
cam = bpy.data.objects.new('c', cam_d); scene.collection.objects.link(cam); scene.camera = cam
for name, pos in (('side', Vector((-0.5, -4.2, 1.2))), ('back', Vector((-4.5, -1.6, 1.9)))):
    tgt = Vector((-0.5, 0, 0.95))
    cam.location = pos
    cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
    for f in (60, 90, 120):
        scene.frame_set(f)
        scene.render.filepath = os.path.join(sc.ROOT, 'tests', f'cape_{tag}_{name}_{f:03d}.png')
        bpy.ops.render.render(write_still=True)
import numpy as np
dg = bpy.context.evaluated_depsgraph_get()
ev = cape.evaluated_get(dg)
co = np.array([v.co[:] for v in ev.data.vertices])
print('CAPE bbox', co.min(0), co.max(0))
