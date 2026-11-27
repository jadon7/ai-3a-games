"""二次元天空/筋斗云测试：Blender -b assets/clouds/clouds.blend -P tests/anime_test.py -- <start|end|up|jdy|jdyside> [pct=50] [frame=1] [out=名字]"""
import bpy, sys, os, math, time
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'common'))
import scene_common as sc

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['start']
view = args[0]
kv = dict(a.split('=', 1) for a in args[1:] if '=' in a)
pct = int(kv.get('pct', 50)); frame = int(kv.get('frame', 1)); name = kv.get('out', 'sky_' + view)
scene = bpy.context.scene
sc.setup_anime(scene, pct=pct)
scene.frame_set(frame)


def mat_color(nm, col):
    m = bpy.data.materials.new(nm); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Roughness'].default_value = 0.9
    return m


bpy.ops.mesh.primitive_plane_add(size=60000, location=(0, 0, -0.5))
bpy.context.object.data.materials.append(mat_color('g', (0.10, 0.30, 0.10)))
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
w = bpy.context.object; w.scale = (3000, 160, 1); w.data.materials.append(mat_color('w', (0.03, 0.20, 0.45)))
cam_d = bpy.data.cameras.new('Cam'); cam = bpy.data.objects.new('Cam', cam_d)
scene.collection.objects.link(cam); scene.camera = cam
cam_d.clip_start = 0.1; cam_d.clip_end = 40000; cam_d.lens = 28


def aim(loc, tgt, lens=28):
    cam.location = loc
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam_d.lens = lens


root = bpy.data.objects.get('JDY_ROOT')
scene.frame_set(frame)
if view == 'start':
    aim((-1500, 0, 140), (-900, 30, 190), 24)
elif view == 'end':
    aim((1050, -260, 200), (1330, 60, 430), 28)
elif view == 'up':
    aim((1330, 60, 180), (1332, 62, 420), 24)
elif view == 'side':
    aim((0, -200, 60), (400, 3000, 700), 30)
elif view == 'jdy':
    root.location = (0, 0, 60)
    aim((-3.6, -2.6, 61.5), (0.0, 0, 59.9), 40)
elif view == 'jdyside':
    root.location = (0, 0, 60)
    aim((0.6, -4.6, 60.5), (-0.1, 0, 59.75), 40)
elif view == 'jdyfront':
    root.location = (0, 0, 60)
    aim((3.6, 2.4, 60.9), (0.0, 0, 59.75), 40)
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = os.path.join(HERE, name + '.png')
for rep in range(int(kv.get('reps', 1))):
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print('RENDER_TIME %s rep%d pct=%d %.2fs' % (name, rep, pct, time.time() - t0), flush=True)
