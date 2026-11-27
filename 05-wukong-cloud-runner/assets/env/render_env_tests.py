"""ENV 自检渲染：打开 env.blend，加相机 / 天空 / 占位云雾（不保存），输出 tests/env_*.png。

  Blender -b -P render_env_tests.py -- blend=env.blend views=a,b,c res=960x540 spp=48 tag=v1 [nocloud] [nohaze]
"""
import bpy, sys, os, math, time
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'common'))
import scene_common as sc  # noqa

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = {'blend': 'env.blend', 'views': 'a,b,c', 'res': '960x540', 'spp': '48', 'tag': 'v0'}
flags = set()
for a in ARGV:
    if '=' in a:
        k, v = a.split('=', 1); opt[k] = v
    else:
        flags.add(a)

blend = opt['blend'] if os.path.isabs(opt['blend']) else os.path.join(HERE, opt['blend'])
bpy.ops.wm.open_mainfile(filepath=blend)
scene = bpy.context.scene
w, h = [int(x) for x in opt['res'].split('x')]
sc.setup_render(scene, res=(w, h), samples=int(opt['spp']), motion_blur=False, vol_bounces=3)
sc.setup_world(scene)

sd = sc.SUN_DIR
VIEWS = {
    # name: (位置, 朝向点或方向, 焦距)
    'a': ((-1500, -200, 90), (2200, 900, 150), 85),
    'b': ((0, -25, 70), (0 + 1000, -25 + 350, 95), 50),
    'c': ((800, 0, 120), (800 + sd.x * 3000, sd.y * 3000, 120 + 3000 * 0.10), 60),
    'd': ((-2300, 40, 130), (0, 250, 100), 35),
    'e': ((150, 20, 60), (330, 150, 150), 28),
    'f': ((-600, -40, 100), (1500, 500, 160), 135),
    'g': ((300, 0, 250), (300 + sd.x * 4000, sd.y * 4000, 200), 50),
}
for a in ARGV:
    if a.startswith('cam='):   # cam=name:x,y,z:tx,ty,tz:focal
        nm, p, t, f = a[4:].split(':')
        VIEWS[nm] = (tuple(float(v) for v in p.split(',')), tuple(float(v) for v in t.split(',')), float(f))

cam_d = bpy.data.cameras.new('testcam')
cam_d.clip_start, cam_d.clip_end = 0.5, 60000.0
cam_d.sensor_width = 36.0
cam = bpy.data.objects.new('testcam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam


def vol_mat(name, density, color=(1, 1, 1, 1), aniso=0.0, height_fade=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    vs = nt.nodes.new('ShaderNodeVolumeScatter')
    vs.inputs['Color'].default_value = color
    vs.inputs['Anisotropy'].default_value = aniso
    vs.inputs['Density'].default_value = density
    if height_fade:
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(geo.outputs['Position'], sep.inputs[0])
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs[1].default_value, mr.inputs[2].default_value = height_fade
        mr.inputs[3].default_value, mr.inputs[4].default_value = density, 0.0
        nt.links.new(sep.outputs[2], mr.inputs[0])
        nt.links.new(mr.outputs[0], vs.inputs['Density'])
    nt.links.new(vs.outputs[0], out.inputs['Volume'])
    return m


def box(name, lo, hi, mat):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.object
    ob.name = name
    ob.scale = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    ob.location = ((hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2)
    ob.data.materials.append(mat)
    return ob


if 'nocloud' not in flags:
    box('TEST_cloud', (-30000, -30000, -150), (30000, 30000, 0), vol_mat('TEST_cloudmat', 0.03, aniso=0.5))
if 'nohaze' not in flags:
    box('TEST_haze', (-32000, -32000, -150), (32000, 32000, float(opt.get('hazetop', 700))), vol_mat('TEST_hazemat', float(opt.get('haze', 0.00012)), (0.80, 0.88, 1.0, 1), aniso=0.55))

scene.render.image_settings.file_format = 'PNG'
for v in opt['views'].split(','):
    pos, tgt, focal = VIEWS[v]
    cam.location = pos
    d = Vector(tgt) - Vector(pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam_d.lens = focal
    out = os.path.join(ROOT, 'tests', f'env_{opt["tag"]}_{v}.png')
    scene.render.filepath = out
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'RENDERED {v} -> {out}  {time.time() - t:.1f}s', flush=True)
