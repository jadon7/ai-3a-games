"""写实 ENV 自检：四个镜头机位（带占位云雾，不保存）。一次只跑一个进程，分辨率 ≤ 960x402。
  Blender -b -P render_real_tests.py -- blend=env_real.blend views=A,B,C,D res=960x402 spp=48 tag=v1 [nocloud] [nohaze] [twice]"""
import bpy, sys, os, math, time
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'common'))
import scene_common as sc
ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = {'blend': 'env_real.blend', 'views': 'A,B,C,D', 'res': '960x402', 'spp': '48', 'tag': 'v0', 'haze': '0.00010', 'hazetop': '700'}
flags = set()
for a in ARGV:
    if '=' in a:
        k, v = a.split('=', 1); opt[k] = v
    else:
        flags.add(a)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
with bpy.data.libraries.load(os.path.join(HERE, opt['blend']), link=False) as (src, dst):
    dst.collections = ['ENV']
scene.collection.children.link(dst.collections[0])
w, h = [int(x) for x in opt['res'].split('x')]
sc.setup_render(scene, res=(w, h), samples=int(opt['spp']), motion_blur=False, vol_bounces=3)
sc.setup_world(scene)
sd = sc.SUN_DIR
HX, HY = math.cos(math.radians(25)), math.sin(math.radians(25))
hero = bpy.data.objects.get('ENV_HeroPine')
bpy.context.view_layer.update()
hp = hero.matrix_world @ Vector(hero.data.vertices[0].co) if hero else Vector((98, -37, 94))
print('HERO PINE world', [round(v, 1) for v in hp], flush=True)
cC = Vector((85, -32, 98))
VIEWS = {
    'A': ((-900, -260, 150), (-900 + 850, -260 + 500, 150 + 55), 50),
    'B': ((-190, -10, 112), (-80, 190, 128), 85),
    'B2': ((-60, 12, 105), (60, -245, 150), 85),
    'C': (tuple(cC), (85 + 175 * math.cos(math.radians(13)), -32 + 175 * math.sin(math.radians(13)), 98 + 175 * math.tan(math.radians(3.0))), 35),
    'D': ((700, 45, 110), (700 + HX * 1390, 45 + HY * 1390, 110 + 1390 * math.tan(math.radians(11.6))), 135),
    'pine': ((hp.x - 9.5, hp.y + 7.0, hp.z + 3.4), (hp.x, hp.y + 0.5, hp.z + 4.0), 35),
    'pine2': ((hp.x - 2.0, hp.y + 11.0, hp.z + 5.0), (hp.x, hp.y, hp.z + 4.6), 50),
    'G': ((120, -8, 105), (262, 10, 150), 35),
}
for a in ARGV:
    if a.startswith('cam='):
        nm, p, t, f = a[4:].split(':')
        VIEWS[nm] = (tuple(float(v) for v in p.split(',')), tuple(float(v) for v in t.split(',')), float(f))
cd = bpy.data.cameras.new('testcam'); cd.clip_start, cd.clip_end = 0.3, 60000.0; cd.sensor_width = 36.0
cam = bpy.data.objects.new('testcam', cd); scene.collection.objects.link(cam); scene.camera = cam


def vol_mat(name, density, color=(1, 1, 1, 1), aniso=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); vs = nt.nodes.new('ShaderNodeVolumeScatter')
    vs.inputs['Color'].default_value = color; vs.inputs['Anisotropy'].default_value = aniso; vs.inputs['Density'].default_value = density
    nt.links.new(vs.outputs[0], out.inputs['Volume'])
    return m


def box(name, lo, hi, mat):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.object; ob.name = name
    ob.scale = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    ob.location = ((hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2)
    ob.data.materials.append(mat)


if 'nocloud' not in flags:
    box('TEST_cloud', (-30000, -30000, -150), (30000, 30000, 0), vol_mat('TEST_cloudmat', 0.03, aniso=0.5))
if 'nohaze' not in flags:
    box('TEST_haze', (-32000, -32000, -150), (32000, 32000, float(opt['hazetop'])), vol_mat('TEST_hazemat', float(opt['haze']), (0.80, 0.88, 1.0, 1), aniso=0.55))
scene.render.image_settings.file_format = 'PNG'
for v in opt['views'].split(','):
    pos, tgt, focal = VIEWS[v]
    cam.location = pos
    cam.rotation_euler = (Vector(tgt) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
    cd.lens = focal
    scene.render.filepath = os.path.join(ROOT, 'tests', f'real_env_{opt["tag"]}_{v}.png')
    t = time.time(); bpy.ops.render.render(write_still=True)
    print(f'RENDERED {v} {time.time() - t:.1f}s', flush=True)
    if 'twice' in flags:
        t = time.time(); bpy.ops.render.render(write_still=True)
        print(f'RENDERED {v} again {time.time() - t:.1f}s', flush=True)
