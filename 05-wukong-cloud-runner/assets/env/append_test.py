"""验收：空场景里 append 集合 ENV，再渲染（证明主线程的用法可行），并计时。
Blender -b -P append_test.py -- views=b res=1920x1080 spp=64 tag=final [origin]"""
import bpy, sys, os, math, time
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'common'))
import scene_common as sc
ARGV = sys.argv[sys.argv.index('--') + 1:]
opt = {'views': 'b', 'res': '1920x1080', 'spp': '64', 'tag': 'append'}
for a in ARGV:
    if '=' in a:
        k, v = a.split('=', 1); opt[k] = v
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
t = time.time()
blend = os.path.join(HERE, 'env.blend')
with bpy.data.libraries.load(blend, link=False) as (src, dst):
    dst.collections = ['ENV']
scene.collection.children.link(dst.collections[0])
print('APPEND', round(time.time() - t, 1), 's; objects', len(bpy.data.objects), flush=True)
w, h = [int(x) for x in opt['res'].split('x')]
sc.setup_render(scene, res=(w, h), samples=int(opt['spp']), motion_blur=False)
sc.setup_world(scene)
cd = bpy.data.cameras.new('c'); cd.clip_end = 60000; cam = bpy.data.objects.new('c', cd)
scene.collection.objects.link(cam); scene.camera = cam
sd = sc.SUN_DIR
V = {'a': ((-1500, -200, 90), (2200, 900, 150), 85), 'b': ((0, -25, 70), (1000, 325, 95), 50),
     'c': ((800, 0, 120), (800 + sd.x * 3000, sd.y * 3000, 420), 60), 'o': ((40, -40, 30), (0, 0, 5), 35)}
scene.render.image_settings.file_format = 'PNG'
for v in opt['views'].split(','):
    pos, tgt, f = V[v]
    cam.location = pos; cam.rotation_euler = (Vector(tgt) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler(); cd.lens = f
    scene.render.filepath = os.path.join(ROOT, 'tests', f'env_{opt["tag"]}_{v}.png')
    t = time.time(); bpy.ops.render.render(write_still=True)
    print(f'RENDERED {v} {time.time() - t:.1f}s (含首帧场景同步)', flush=True)
    t = time.time(); bpy.ops.render.render(write_still=True)
    print(f'RENDERED {v} again {time.time() - t:.1f}s (persistent data, 纯渲染)', flush=True)
