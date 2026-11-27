"""云测试渲染：Blender -b assets/clouds/clouds.blend -P tests/cloud_test.py -- <view> [key=value ...]
view: a | b | c | wide
key: pct=50 samples=64 frame=1 vb=8 out=名字 pillars=1 haze=1 sea=1 jdy=1 step=1.0 sigma=... jsig=... haze_mul=1
"""
import bpy, sys, os, math, time
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'common'))
import scene_common as sc

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['a']
view = args[0]
kv = dict(a.split('=', 1) for a in args[1:] if '=' in a)
pct = int(kv.get('pct', 50)); samples = int(kv.get('samples', 64)); frame = int(kv.get('frame', 1))
vb = int(kv.get('vb', 8)); name = kv.get('out', 'cloud_' + view)

scene = bpy.context.scene
sc.setup_render(scene, pct=pct, samples=samples, vol_bounces=vb, motion_blur=False)
sc.setup_world(scene)
scene.cycles.volume_step_rate = float(kv.get('step', 1.0))
if 'maxsteps' in kv:
    scene.cycles.volume_max_steps = int(kv['maxsteps'])
if 'noise' in kv:
    scene.cycles.adaptive_threshold = float(kv['noise'])
if 'biased' in kv and hasattr(scene.cycles, 'volume_biased'):
    scene.cycles.volume_biased = bool(int(kv['biased']))
scene.frame_set(frame)


def show(coll, on):
    c = bpy.data.collections.get(coll)
    if c:
        c.hide_render = not on


show('HAZE', int(kv.get('haze', 1)) == 1)
show('CLOUDSEA', int(kv.get('sea', 1)) == 1)
show('JDY', int(kv.get('jdy', 1 if view.startswith('c') else 0)) == 1)

for m in bpy.data.materials:
    if m.name == 'WK_CloudSea' and 'sigma' in kv:
        m.node_tree.nodes['SIGMA'].inputs[1].default_value = float(kv['sigma'])
    if m.name == 'WK_JDY' and 'jsig' in kv:
        m.node_tree.nodes['SIGMA'].inputs[1].default_value = float(kv['jsig'])
    if m.name.startswith('WK_Haze') and 'haze_mul' in kv:
        n = m.node_tree.nodes['HAZE_SCATTER']
        n.inputs['Density'].default_value *= float(kv['haze_mul'])
    if 'diam' in kv and m.name in ('WK_CloudSea', 'WK_JDY'):
        for n in m.node_tree.nodes:
            if n.type == 'VOLUME_SCATTER' and 'Diameter' in n.inputs:
                n.inputs['Diameter'].default_value = float(kv['diam'])

if int(kv.get('core', 1)) == 0 and 'CloudSea_Core' in bpy.data.objects:
    bpy.data.objects['CloudSea_Core'].hide_render = True
if int(kv.get('near', 1)) == 0 and 'CloudSea_Near' in bpy.data.objects:
    bpy.data.objects['CloudSea_Near'].hide_render = True
cam_d = bpy.data.cameras.new('TestCam')
cam = bpy.data.objects.new('TestCam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
cam_d.sensor_width = 36.0
cam_d.clip_start = 0.1
cam_d.clip_end = 200000.0


def aim(loc, direction, lens):
    cam.location = loc
    cam.rotation_euler = Vector(direction).normalized().to_track_quat('-Z', 'Y').to_euler()
    cam_d.lens = lens


if view == 'a':
    aim((-1500, -200, 90), (1, 0.3, -0.02), 85)
elif view == 'b':
    aim((0, -25, 70), (1, 0.35, -0.06), 50)
elif view == 'wide':
    aim((-2000, -400, 260), (1, 0.42, -0.08), 35)
elif view == 'c':
    root = bpy.data.objects['JDY_ROOT']
    root.location = (0, 0, 85)
    p = Vector((-5.0, -1.6, 3.0))
    if 'cam' in kv:
        p = Vector([float(t) for t in kv['cam'].split(',')])
    tgt = Vector((0.2, 0.0, -0.35))
    aim(root.location + p, tgt - p, float(kv.get('lens', 42)))
elif view == 'cbody':
    root = bpy.data.objects['JDY_ROOT']
    root.location = (0, 0, 85)
    p = Vector((0.6, -7.5, 0.9))
    aim(root.location + p, Vector((-0.2, 0, -0.3)) - p, 50)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.22, depth=1.7, location=(0, 0, 85 + 0.85 - 0.1))
    mm = bpy.data.materials.new('man'); mm.use_nodes = True
    next(n for n in mm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.35, 0.12, 0.05, 1)
    bpy.context.object.data.materials.append(mm)
elif view == 'cside':
    root = bpy.data.objects['JDY_ROOT']
    root.location = (0, 0, 85)
    p = Vector((-2.0, -9.0, 1.2))
    aim(root.location + p, Vector((-3.5, 0, -0.4)) - p, 50)

if int(kv.get('pillars', 1)) == 1 and not view.startswith('c'):
    m = bpy.data.materials.new('ph'); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (0.16, 0.15, 0.13, 1); b.inputs['Roughness'].default_value = 0.9
    for (x, y, h, r) in ((500, 180, 190, 35), (820, 330, 260, 45), (1300, -260, 210, 40), (1900, 520, 330, 60),
                         (2600, 250, 280, 55), (3600, 900, 380, 80), (5200, 1700, 420, 110), (7000, 2600, 500, 150),
                         (4200, -700, 300, 70), (9000, 3800, 600, 220), (400, -160, 150, 28)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=r, depth=h + 60, location=(x, y, h / 2 - 30))
        o = bpy.context.object; o.data.materials.append(m)

scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = os.path.join(HERE, name + '.png')
for rep in range(int(kv.get('reps', 2))):
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print('RENDER_TIME %s rep%d %dx%d s=%d vb=%d  %.1fs' % (name, rep, scene.render.resolution_x * pct // 100,
          scene.render.resolution_y * pct // 100, samples, vb, time.time() - t0), flush=True)
