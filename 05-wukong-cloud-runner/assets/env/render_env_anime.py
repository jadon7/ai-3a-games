"""二次元 ENV 自检渲染（EEVEE）：模拟追尾镜头。
  Blender -b -P render_env_anime.py -- blend=env.blend views=a,b,c,d,e res=960x540 tag=t1 [spp=16]"""
import bpy, sys, os, math, time
import numpy as np
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'common')); sys.path.insert(0, HERE)
import scene_common as sc
import env_height as EH
ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = {'blend': 'env.blend', 'views': 'a,b,c,d,e', 'res': '960x540', 'tag': 't', 'spp': '16', 'frame': '1'}
for a in ARGV:
    if '=' in a:
        k, v = a.split('=', 1); opt[k] = v
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
t = time.time()
with bpy.data.libraries.load(os.path.join(HERE, opt['blend']), link=False) as (src, dst):
    dst.collections = ['ENV']
scene.collection.children.link(dst.collections[0])
print('APPEND', round(time.time() - t, 1), 's', flush=True)
w, h = [int(x) for x in opt['res'].split('x')]
sc.setup_anime(scene, res=(w, h), samples=int(opt['spp']), motion_blur=('mb' in ARGV))
scene.frame_set(int(opt['frame']))
# 测试用天空穹顶（不保存）
bpy.ops.mesh.primitive_uv_sphere_add(radius=14000, segments=48, ring_count=24)
sky = bpy.context.object; sky.name = 'TEST_Sky'
for prop in ('visible_shadow',):
    if hasattr(sky, prop):
        setattr(sky, prop, False)
m = bpy.data.materials.new('TEST_SkyMat'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
geo = nt.nodes.new('ShaderNodeNewGeometry'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Position'], sep.inputs[0])
mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs[1].default_value = 0.0; mr.inputs[2].default_value = 9000.0
nt.links.new(sep.outputs[2], mr.inputs[0])
cr = nt.nodes.new('ShaderNodeValToRGB'); cr.color_ramp.elements[0].color = (*sc.A_SKY_HORIZON, 1); cr.color_ramp.elements[1].color = (*sc.A_SKY_ZENITH, 1)
nt.links.new(mr.outputs[0], cr.inputs[0])
em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(cr.outputs[0], em.inputs['Color'])
o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], o.inputs['Surface'])
sky.data.materials.append(m)
cd = bpy.data.cameras.new('c'); cd.clip_start = 0.3; cd.clip_end = 40000; cam = bpy.data.objects.new('c', cd)
scene.collection.objects.link(cam); scene.camera = cam


def p_air(x):
    tt = (x + 1500.0) / 650.0
    y0 = float(EH.river_center(-1500.0)) + 40; y1 = float(EH.river_center(-850.0)) + 190
    return Vector((x, y0 + (y1 - y0) * tt, 240 - 90 * tt))


def p_band(x):
    y = float(EH.river_center(x)) + EH.BAND_D
    return Vector((x, y, float(EH.ground_height(x, y)) + 1.4))


def p_river(x):
    return Vector((x, float(EH.river_center(x)), 1.4))


def chase(pf, x, lens=35, back=7.0, up=2.5, ahead=45.0):
    return pf(x - back) + Vector((0, 0, up)), pf(x + ahead) + Vector((0, 0, 0.5)), lens


V = {'a': chase(p_air, -1250), 'a2': chase(p_air, -980), 'b': chase(p_band, -520), 'b2': chase(p_band, -150),
     'c': chase(p_river, 70), 'c2': chase(p_river, 330), 'd': chase(p_river, 640), 'd2': chase(p_river, 820),
     'e': (Vector((-2100, 650, 820)), Vector((300, 0, 0)), 28), 'e2': (Vector((1500, 900, 520)), Vector((300, -50, 0)), 30),
     'w': (Vector((75, float(EH.river_center(75.0)) + 25, 14)), Vector((150, float(EH.river_center(150.0)) - 60, 55)), 35),
     'p': chase(p_band, -690, up=6.0), 's': chase(p_air, -1500),
     'g': chase(p_river, -420), 'h': (Vector((-560, 60, 60)), Vector((-300, -220, 190)), 40)}
scene.render.image_settings.file_format = 'PNG'
for v in opt['views'].split(','):
    pos, tgt, f = V[v]
    cam.location = pos; cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler(); cd.lens = f
    scene.render.filepath = os.path.join(ROOT, 'tests', f'env_{opt["tag"]}_{v}.png')
    t = time.time(); bpy.ops.render.render(write_still=True)
    print(f'RENDERED {v} {time.time() - t:.1f}s', flush=True)
    if 'twice' in ARGV:
        scene.frame_set(scene.frame_current + 1)
        t = time.time(); bpy.ops.render.render(write_still=True)
        print(f'RENDERED {v} next-frame {time.time() - t:.1f}s', flush=True)
