"""写实云测试：Blender -b assets/clouds/clouds_real.blend -P tests/real_cloud_test.py -- <A|B|D|J|T> [key=value ...]
key: pct=50 samples=24 vb=4 frame=1 reps=1 out=名字 haze=1 sea=1 mist=1 jdy=0/1 pillars=1 sigma= hsig= hg= jsig= trail=1"""
import bpy, sys, os, math, time
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'common'))
sys.path.insert(0, os.path.join(ROOT, 'assets', 'clouds'))
import scene_common as sc

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['A']
view = args[0]
kv = dict(a.split('=', 1) for a in args[1:] if '=' in a)
pct = int(kv.get('pct', 50)); samples = int(kv.get('samples', 24)); frame = int(kv.get('frame', 1))
vb = int(kv.get('vb', 4)); name = kv.get('out', 'real_cloud_' + view)
scene = bpy.context.scene
sc.setup_render(scene, res=(1920, 804), pct=pct, samples=samples, vol_bounces=vb, motion_blur=False)
sc.setup_world(scene)
if 'noise' in kv:
    scene.cycles.adaptive_threshold = float(kv['noise'])
if 'biased' in kv:
    scene.cycles.volume_biased = bool(int(kv['biased']))
    scene.cycles.volume_step_rate = float(kv.get('step', 2.0))


def show(coll, on):
    c = bpy.data.collections.get(coll)
    if c:
        c.hide_render = not on


show('HAZE', int(kv.get('haze', 1)) == 1)
show('CLOUDSEA', int(kv.get('sea', 1)) == 1)
show('JDY', int(kv.get('jdy', 1 if view in ('B', 'J', 'T') else 0)) == 1)
if int(kv.get('mist', 1)) == 0 and 'CloudSea_Mist' in bpy.data.objects:
    bpy.data.objects['CloudSea_Mist'].hide_render = True
for m in bpy.data.materials:
    if m.name == 'WK_CloudSea' and 'sigma' in kv:
        m.node_tree.nodes['SIGMA'].inputs[1].default_value = float(kv['sigma'])
    if m.name == 'WK_JDY' and 'jsig' in kv:
        m.node_tree.nodes['SIGMA'].inputs[1].default_value = float(kv['jsig'])
    if m.name == 'WK_Mist' and 'msig' in kv:
        m.node_tree.nodes['SIGMA'].inputs[1].default_value = float(kv['msig'])
    if m.name in ('WK_Haze', 'WK_Haze_Low'):
        n = m.node_tree.nodes['HAZE_SCATTER']
        if 'hsig' in kv and m.name == 'WK_Haze':
            n.inputs['Density'].default_value = float(kv['hsig'])
        if 'lsig' in kv and m.name == 'WK_Haze_Low':
            n.inputs['Density'].default_value = float(kv['lsig'])
        if 'hg' in kv:
            for s in n.inputs:
                if s.name == 'Anisotropy':
                    s.default_value = float(kv['hg'])

cam_d = bpy.data.cameras.new('TestCam'); cam = bpy.data.objects.new('TestCam', cam_d)
scene.collection.objects.link(cam); scene.camera = cam
cam_d.sensor_width = 36.0; cam_d.clip_start = 0.1; cam_d.clip_end = 200000.0


def aim(loc, direction, lens):
    cam.location = loc
    cam.rotation_euler = Vector(direction).normalized().to_track_quat('-Z', 'Y').to_euler()
    cam_d.lens = lens


c25, s25 = math.cos(math.radians(25)), math.sin(math.radians(25))
root = bpy.data.objects.get('JDY_ROOT')
if view == 'A':
    aim((-900, -260, 150), (0.85, 0.5, -0.10), 50)
elif view == 'D':
    aim((700, 45, 110), (c25, s25, -0.03), 135)
elif view in ('B', 'J', 'T'):
    root.location = (-300, 0, 85)
    if view == 'B':
        p = Vector((-5.5, -2.6, 1.7)); tgt = Vector((0.6, 0.0, 0.5)); lens = 85
        cam_d.dof.use_dof = True; cam_d.dof.focus_distance = 6.2; cam_d.dof.aperture_fstop = 2.8
    elif view == 'J':
        p = Vector((-5.0, -3.3, 1.0)); tgt = Vector((-0.2, 0.0, -0.35)); lens = 85
    else:
        p = Vector((-26.0, -16.0, 5.0)); tgt = Vector((-14.0, 0.0, -0.5)); lens = 50
    if 'cam' in kv:
        p = Vector([float(t) for t in kv['cam'].split(',')])
    if 'lens' in kv:
        lens = float(kv['lens'])
    aim(Vector(root.location) + p, tgt - p, lens)

if int(kv.get('pillars', 1)) == 1:
    m = bpy.data.materials.new('ph'); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (0.10, 0.10, 0.09, 1); b.inputs['Roughness'].default_value = 0.9
    P = [(-700, 110, 220, 30), (-500, -95, 180, 26), (-250, 140, 300, 40), (0, -120, 240, 34), (250, 100, 210, 30),
         (450, -150, 330, 45), (-150, 320, 380, 60), (300, 420, 420, 70), (-420, 520, 300, 50)]
    for t, lat, h, r in ((300, 110, 260, 32), (520, -90, 200, 28), (800, 130, 340, 44), (1100, -120, 250, 34),
                         (1500, 150, 300, 40), (1900, -140, 380, 50), (1300, 380, 440, 70), (900, -420, 360, 60),
                         (2600, 200, 420, 70), (3400, -300, 480, 90), (4500, 500, 520, 120), (6000, -700, 600, 160),
                         (2300, -500, 400, 70), (3000, 700, 460, 90)):
        P.append((600 + c25 * t - s25 * lat, s25 * t + c25 * lat, h, r))
    for (x, y, h, r) in P:
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=r, depth=h + 60, location=(x, y, h / 2 - 30))
        bpy.context.object.data.materials.append(m)

if int(kv.get('trail', 1 if view == 'T' else 0)):
    import trail_lib
    cd = bpy.data.curves.new('Path', 'CURVE'); cd.dimensions = '3D'
    sp = cd.splines.new('POLY'); npt = 400
    sp.points.add(npt - 1)
    for i in range(npt):
        sp.points[i].co = (-700 + i * 2.0, 0.0, 85.0, 1.0)
    path = bpy.data.objects.new('Path', cd); scene.collection.objects.link(path)
    speed = float(kv.get('speed', 45.0))
    f_hit = 1 + 400.0 / speed * 24.0          # 悟空到达 x=-300 的帧
    frame = int(round(f_hit))
    t0 = time.time()
    trail_lib.add_vapor_trail(scene, path, speed, frame - 4, frame + 4, 24, 1, name='TestTrail')
    print('TRAIL_BAKE 9 frames %.1fs' % (time.time() - t0), flush=True)

scene.frame_set(frame)
if 'TestTrail_far' in bpy.data.objects:
    v = bpy.data.objects['TestTrail_far'].data
    v.grids.load()
    print('TRAIL_SEQ frame', frame, '->', os.path.basename(v.grids.frame_filepath), 'expected index 5', flush=True)
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = os.path.join(HERE, name + '.png')
for rep in range(int(kv.get('reps', 1))):
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print('RENDER_TIME %s rep%d %dx%d s=%d vb=%d %.1fs' % (name, rep, 1920 * pct // 100, 804 * pct // 100, samples, vb, time.time() - t0), flush=True)
