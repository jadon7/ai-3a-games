# air_preview.py -- re-imports a .glb and renders a 2x2 contact sheet (EEVEE, headless).
# usage: blender -b --factory-startup -P air_preview.py -- <glb> <out.png> [view=az,el ...] [pose=node:X:deg ...] [res=WxH]
# pose axes are GODOT local axes (X, Y, Z). Preview shading multiplies base colour by COLOR_0.R and tints by COLOR_0.G.
import bpy, sys, os, math
import numpy as np
from mathutils import Vector, Quaternion
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from air_lib import MATS

argv = sys.argv[sys.argv.index('--') + 1:]
glb, out = argv[0], argv[1]
views = []
poses = []
res = (800, 560)
zoom = 0.56
for a in argv[2:]:
    k, v = a.split('=', 1)
    if k == 'view':
        views.append(tuple(float(x) for x in v.split(',')))
    elif k == 'pose':
        n, ax, d = v.split(':')
        poses.append((n, ax, float(d)))
    elif k == 'zoom':
        zoom = float(v)
    elif k == 'res':
        res = tuple(int(x) for x in v.split('x'))
if not views:
    views = [(35, 22), (215, 18), (30, -35), (90, 4)]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene
AX = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 0, 1)), 'Z': Vector((0, -1, 0))}   # godot local axis -> blender local axis
for n, ax, d in poses:
    o = bpy.data.objects[n]
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = o.rotation_quaternion @ Quaternion(AX[ax], math.radians(d))
bpy.context.view_layer.update()

# preview materials
cname = None
for o in bpy.data.objects:
    if o.type == 'MESH' and o.data.color_attributes:
        cname = o.data.color_attributes[0].name
        break
for mat in bpy.data.materials:
    base = tuple(mat.diffuse_color)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    bs = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    base = (*MATS.get(mat.name[:1], (0.5, 0.5, 0.5)), 1.0)
    nt.nodes.clear()
    outn = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = cname or 'Color'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(at.outputs['Color'], sep.inputs[0])
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1.0
    mul.inputs[6].default_value = base
    nt.links.new(sep.outputs[0], mul.inputs[7])
    dm = nt.nodes.new('ShaderNodeMath')
    dm.operation = 'MULTIPLY'
    dm.inputs[1].default_value = 0.75
    nt.links.new(sep.outputs[1], dm.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    nt.links.new(dm.outputs[0], mix.inputs[0])
    nt.links.new(mul.outputs[2], mix.inputs[6])
    mix.inputs[7].default_value = (0.42, 0.33, 0.22, 1)
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.8
    if mat.name.startswith('G'):
        b.inputs['Emission Color'].default_value = base
        b.inputs['Emission Strength'].default_value = 1.0
    nt.links.new(b.outputs[0], outn.inputs[0])
    mat.use_backface_culling = True

# bounds
lo = Vector((1e9,) * 3)
hi = Vector((-1e9,) * 3)
for o in bpy.data.objects:
    if o.type == 'MESH':
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
cen = (lo + hi) / 2
rad = (hi - lo).length / 2

world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
bg.inputs[0].default_value = (0.62, 0.68, 0.76, 1)
bg.inputs[1].default_value = 0.7


def sun(name, az, el, st):
    l = bpy.data.lights.new(name, 'SUN')
    l.energy = st
    o = bpy.data.objects.new(name, l)
    sc.collection.objects.link(o)
    d = Vector((math.cos(math.radians(el)) * math.sin(math.radians(az)), math.cos(math.radians(el)) * math.cos(math.radians(az)), math.sin(math.radians(el))))
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')


sun('key', 60, 48, 2.6)
sun('fill', 250, -40, 1.0)
cam = bpy.data.cameras.new('cam')
cam.angle = math.radians(38)
cam.clip_start = max(rad * 0.01, 0.05)
cam.clip_end = rad * 20
co = bpy.data.objects.new('cam', cam)
sc.collection.objects.link(co)
sc.camera = co
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = res
sc.render.image_settings.file_format = 'PNG'
try:
    sc.view_settings.view_transform = 'Standard'
except Exception:
    pass
tiles = []
ok = True
for i, (az, el) in enumerate(views):
    d = Vector((math.cos(math.radians(el)) * math.sin(math.radians(az)), math.cos(math.radians(el)) * math.cos(math.radians(az)), math.sin(math.radians(el))))
    co.location = cen + d * (rad / math.sin(math.atan(math.tan(cam.angle / 2) * min(1.0, res[1] / res[0]))) * zoom)
    co.rotation_mode = 'QUATERNION'
    co.rotation_quaternion = d.to_track_quat('Z', 'Y')
    p = out[:-4] + '_v%d.png' % i
    sc.render.filepath = p
    try:
        bpy.ops.render.render(write_still=True)
        tiles.append(p)
    except Exception as e:
        print('RENDER FAILED', e)
        ok = False
        break
if ok and tiles:
    W, H = res
    cols = 2 if len(tiles) > 1 else 1
    rows = (len(tiles) + cols - 1) // cols
    sheet = np.zeros((rows * H, cols * W, 4), dtype=np.float32)
    sheet[..., 3] = 1
    for i, p in enumerate(tiles):
        im = bpy.data.images.load(p)
        a = np.empty(W * H * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        a = a.reshape(H, W, 4)
        r, c = i // cols, i % cols
        sheet[(rows - 1 - r) * H:(rows - r) * H, c * W:(c + 1) * W] = a
    im = bpy.data.images.new('sheet', cols * W, rows * H)
    im.pixels.foreach_set(sheet.ravel())
    im.filepath_raw = out
    im.file_format = 'PNG'
    im.save()
    for p in tiles:
        os.remove(p)
    print('SHEET', out)
