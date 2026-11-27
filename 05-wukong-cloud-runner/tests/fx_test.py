"""特效库测试：Blender -b -P tests/fx_test.py -- <trail|petals|water|speed|burst|all> [frame=45] [pct=50] [check=1] [seq=1]
用一个沿直线 60 m/s 运动的占位方块验证；check=1 时再“从头步进到该帧”渲一次，对比两张图是否一致。"""
import bpy, sys, os, math, time
import numpy as np
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'common'))
sys.path.insert(0, os.path.join(ROOT, 'assets', 'fx'))
import scene_common as sc
import fx_lib

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['all']
which = args[0]
kv = dict(a.split('=', 1) for a in args[1:] if '=' in a)
F = int(kv.get('frame', 45)); pct = int(kv.get('pct', 50)); check = int(kv.get('check', 0))
SPEED = 60.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
sc.setup_anime(scene, pct=pct)
fps = scene.render.fps
scene.frame_start, scene.frame_end = 1, 240
# 背景色
scene.world.node_tree.nodes  # 环境光已由 setup_anime 建好


def mat_color(name, col, emit=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Roughness'].default_value = 0.9
    return m


water = which in ('water',)
H = 0.7 if water else 2.0
bpy.ops.mesh.primitive_plane_add(size=6000, location=(0, 0, 0))
g = bpy.context.object
g.data.materials.append(mat_color('ground', (0.05, 0.22, 0.50) if water else (0.20, 0.50, 0.16)))

# 路径：直线，点距 2 m
cd = bpy.data.curves.new('Path', 'CURVE'); cd.dimensions = '3D'
sp = cd.splines.new('POLY'); npt = 400
sp.points.add(npt - 1)
for i in range(npt):
    sp.points[i].co = (-100 + i * 2.0, 0.0, H, 1.0)
path = bpy.data.objects.new('Path', cd); scene.collection.objects.link(path)

bpy.ops.mesh.primitive_cube_add(size=1.2)
cube = bpy.context.object; cube.data.materials.append(mat_color('cube', (0.9, 0.5, 0.1)))
cam_d = bpy.data.cameras.new('Cam'); cam = bpy.data.objects.new('Cam', cam_d)
scene.collection.objects.link(cam); scene.camera = cam
cam_d.lens = 28; cam_d.clip_start = 0.1; cam_d.clip_end = 40000

P, S = fx_lib.path_points(path)
jroot = None
if int(kv.get('sky', 0)):
    blend = os.path.join(ROOT, 'assets', 'clouds', 'clouds.blend')
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        dst.collections = [c for c in src.collections if c in ('SKY', 'JDY')]
    for c in dst.collections:
        scene.collection.children.link(c)
    jroot = bpy.data.objects.get('JDY_ROOT')
    cube.scale = (0.5, 0.5, 1.0)


def place(f):
    s = SPEED * (f - 1) / fps
    pos, tan, side = fx_lib.sample_path(P, S, [s])
    p = Vector(pos[0]); t = Vector(tan[0]); sd = Vector(side[0])
    cube.location = p + Vector((0, 0, 0.6)) if jroot else p
    if jroot:
        jroot.location = p
    cl = p - t * 9.0 + Vector((0, 0, 3.2)) - sd * 2.2
    if which == 'trail':
        cl = p - t * 15.0 + Vector((0, 0, 4.5)) - sd * 10.0
    if which == 'water':
        cl = p - t * 13.0 + Vector((0, 0, 6.5)) - sd * 1.5
    if which == 'burst':
        cl = p - t * 60.0 + Vector((0, 0, 14.0)) - sd * 20
    if 'foam' in kv:
        cl = p - t * 75.0 + Vector((0, 0, 30.0)) - sd * 6
    cam.location = cl
    look = (p + t * (-5.0 if which == 'trail' else 4.0) + Vector((0, 0, 0.5))) - cl
    if 'foam' in kv:
        look = (p - t * 35.0) - cl
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()


tests = ['trail', 'petals', 'water', 'speed', 'burst'] if which == 'all' else [which]
t0 = time.time()
if 'trail' in tests:
    fx_lib.add_cloud_trail(scene, path, SPEED, 1, 240)
if 'petals' in tests:
    fx_lib.add_petals(scene, path, SPEED, 1, 240)
if 'water' in tests:
    fx_lib.add_water_spray(scene, path, SPEED, 1, 240)
if 'speed' in tests:
    fx_lib.add_speed_lines(scene, cam, 1, 240, intensity=[(1, 0.0), (20, 1.0), (240, 1.0)])
if 'burst' in tests:
    pos, tan, side = fx_lib.sample_path(P, S, [SPEED * (F - 12 - 1) / fps])
    fx_lib.add_cloud_burst(scene, tuple(pos[0]), F - 12, direction=tuple(tan[0]))
print('FX build %.2fs' % (time.time() - t0), flush=True)

scene.render.image_settings.file_format = 'PNG'


def render(f, name):
    scene.frame_set(f)
    place(f)
    scene.render.filepath = os.path.join(HERE, name + '.png')
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print('RENDER_TIME %s f=%d %.2fs' % (name, f, time.time() - t), flush=True)


nm = kv.get('out', 'fx_' + which)
render(F, nm)
if int(kv.get('seq', 0)):
    for f in (F + 8, F + 16):
        render(f, '%s_f%03d' % (nm, f))
if check:
    for f in range(1, F + 1):
        scene.frame_set(f); place(f)
    render(F, nm + '_seq')
    a = bpy.data.images.load(os.path.join(HERE, nm + '.png'), check_existing=False)
    b = bpy.data.images.load(os.path.join(HERE, nm + '_seq.png'), check_existing=False)
    pa = np.array(a.pixels[:]); pb = np.array(b.pixels[:])
    d = np.abs(pa - pb)
    print('STATELESS_CHECK %s  max diff %.4f  mean diff %.6f' % (nm, d.max(), d.mean()), flush=True)
if 'save' in kv:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, nm + '_scene.blend'))
