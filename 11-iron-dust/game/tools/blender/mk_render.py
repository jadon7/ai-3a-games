# mk_render.py -- preview renders of exported .glb files (EEVEE, background mode).
#   blender -b --factory-startup -P mk_render.py -- frame <in.glb> <out.png> [pose]
#   blender -b --factory-startup -P mk_render.py -- lineup <out.png> <a.glb> <b.glb> ...
#   blender -b --factory-startup -P mk_render.py -- equip <equip.glb> <out_prefix>
import bpy, sys, os, math
from math import radians as rad
from mathutils import Vector, Euler
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
from mk_geo import MAT_COL, reset_scene

PAL = dict(MAT_COL)


def base_name(n):
    return n.split('.')[0]


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    return {base_name(o.name): o for o in new}, new


def fix_materials():
    attr = None
    for me in bpy.data.meshes:
        if me.color_attributes:
            attr = me.color_attributes[0].name
            break
    for m in bpy.data.materials:
        key = base_name(m.name)
        if key not in PAL:
            continue
        c = PAL[key]
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(bsdf.outputs[0], out.inputs[0])
        bsdf.inputs['Roughness'].default_value = 0.55
        bsdf.inputs['Metallic'].default_value = 0.35 if key in 'FWT' else 0.1
        if key in 'GK':
            bsdf.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1)
            bsdf.inputs['Emission Color'].default_value = (c[0], c[1], c[2], 1)
            bsdf.inputs['Emission Strength'].default_value = 3.0
            continue
        va = nt.nodes.new('ShaderNodeVertexColor')
        if attr:
            va.layer_name = attr
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(va.outputs['Color'], sep.inputs[0])
        mixd = nt.nodes.new('ShaderNodeMix')
        mixd.data_type = 'RGBA'
        mixd.inputs['A'].default_value = (c[0], c[1], c[2], 1)
        mixd.inputs['B'].default_value = (0.42, 0.34, 0.24, 1)
        mul = nt.nodes.new('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = 0.55
        nt.links.new(sep.outputs[1], mul.inputs[0])
        nt.links.new(mul.outputs[0], mixd.inputs['Factor'])
        ao = nt.nodes.new('ShaderNodeMix')
        ao.data_type = 'RGBA'
        ao.blend_type = 'MULTIPLY'
        ao.inputs['Factor'].default_value = 1.0
        nt.links.new(mixd.outputs['Result'], ao.inputs['A'])
        pw = nt.nodes.new('ShaderNodeMath')
        pw.operation = 'POWER'
        pw.inputs[1].default_value = 1.6
        nt.links.new(sep.outputs[0], pw.inputs[0])
        comb = nt.nodes.new('ShaderNodeCombineColor')
        for i in range(3):
            nt.links.new(pw.outputs[0], comb.inputs[i])
        nt.links.new(comb.outputs[0], ao.inputs['B'])
        nt.links.new(ao.outputs['Result'], bsdf.inputs['Base Color'])


def setup_world(res, bg=0.33):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (bg, bg * 1.03, bg * 1.08, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    sc.world = w
    for name, rot, e in (('key', (rad(-52), 0, rad(35)), 3.4), ('fill', (rad(60), 0, rad(120)), 1.0), ('rim', (rad(-110), 0, rad(20)), 0.8)):
        l = bpy.data.lights.new(name, 'SUN')
        l.energy = e
        l.angle = rad(3)
        o = bpy.data.objects.new(name, l)
        o.rotation_euler = rot
        sc.collection.objects.link(o)
    try:
        sc.eevee.use_shadows = True
    except Exception:
        pass


def add_cam(center, width, pitch=8.0, dist=120.0):
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = width
    cam.clip_end = 500
    o = bpy.data.objects.new('cam', cam)
    p = rad(pitch)
    d = Vector((0, math.cos(p), math.sin(p)))
    o.location = Vector(center) + d * dist
    o.rotation_euler = Euler((rad(90) - p, 0, rad(180)), 'XYZ')
    sc.collection.objects.link(o)
    sc.camera = o
    return o


def ground(size=200, z=0.0):
    me = bpy.data.meshes.new('ground')
    me.from_pydata([(-size, -size, z), (size, -size, z), (size, size, z), (-size, size, z)], [], [(0, 1, 2, 3)])
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.3, 0.3, 0.31, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    me.materials.append(m)
    o = bpy.data.objects.new('ground', me)
    bpy.context.scene.collection.objects.link(o)


POSE = {
    'hip_L': (0.65, 0, 0), 'knee_L': (-0.75, 0, 0), 'ankle_L': (0.1, 0, 0), 'hip_R': (-0.4, 0, 0), 'knee_R': (-0.25, 0, 0), 'ankle_R': (0.6, 0, 0),
    'skirt_FL': (0.6, 0, 0), 'skirt_BR': (-0.35, 0, 0), 'skirt_SL': (0, -0.25, 0), 'skirt_SR': (0, 0.2, 0),
    'sh_R': (0.9, 0, 0), 'el_R': (0.5, 0, 0), 'pauldron_R': (0.45, 0, 0), 'sh_L': (-0.2, 0.3, 0), 'el_L': (0.6, 0, 0),
    'binder_L': (rad(30), 0, 0), 'binder_R': (rad(30), 0, 0), 'waist': (0, 0, 0.2), 'head': (0, 0, -0.3),
}


def apply_pose(objs):
    for n, r in POSE.items():
        if n in objs:
            o = objs[n]
            o.rotation_mode = 'XYZ'
            e = o.rotation_euler
            o.rotation_euler = (e.x + r[0], e.y + r[1], e.z + r[2])
    for n, o in objs.items():
        if n.startswith('vent_') and o.type == 'EMPTY':
            o.rotation_mode = 'QUATERNION'
            o.rotation_quaternion = o.rotation_quaternion @ Euler((rad(35), 0, 0)).to_quaternion()


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDERED', path)


def frame_sheet(glb, out, pose=False):
    reset_scene()
    views = [(-9.5, -32), (9.5, -90), (28.5, 180)] if not pose else [(-9.5, -35), (9.5, 150), (28.5, -90)]
    xs = [-19.0, 0.0, 19.0]
    for i, (_, ang) in enumerate(views):
        objs, new = import_glb(glb)
        root = objs['frame']
        if pose:
            apply_pose(objs)
        root.rotation_mode = 'XYZ'
        root.rotation_euler = (0, 0, rad(ang))
        root.location = (xs[i], 0, 0)
    fix_materials()
    setup_world((2000, 880))
    ground()
    add_cam((0, 0, 9.6), 58.0, pitch=7.0)
    render(out)


def closeup(glb, out, zc=10.0, width=27.0):
    reset_scene()
    for x, ang in ((-7.0, -38), (7.0, 142)):
        objs, new = import_glb(glb)
        root = objs['frame']
        root.rotation_mode = 'XYZ'
        root.rotation_euler = (0, 0, rad(ang))
        root.location = (x, 0, 0)
    fix_materials()
    setup_world((1900, 1400))
    ground()
    add_cam((0, 0, zc), width, pitch=12.0)
    render(out)


def loadout(glb, equip, out, pairs):
    reset_scene()
    for x, ang, pose in ((-19.0, -40, False), (0.0, 35, True), (19.0, 150, False)):
        objs, new = import_glb(glb)
        eq, enew = import_glb(equip)
        used = set()
        for pr in pairs:
            it, mt = pr.split(':')
            o = eq[it]
            o.parent = objs[mt]
            o.matrix_parent_inverse.identity()
            o.location = (0, 0, 0)
            o.rotation_mode = 'XYZ'
            o.rotation_euler = (0, 0, 0)
            used.add(o)
        for o in enew:
            if o.parent is None and o not in used:
                o.location = (0, 0, -900)
        if pose:
            apply_pose(objs)
        root = objs['frame']
        root.rotation_mode = 'XYZ'
        root.rotation_euler = (0, 0, rad(ang))
        root.location = (x, 0, 0)
    fix_materials()
    setup_world((2000, 960))
    ground()
    add_cam((0, 0, 10.2), 60.0, pitch=8.0)
    render(out)


def lineup(out, glbs):
    reset_scene()
    n = len(glbs)
    sp = 15.0
    for i, g in enumerate(glbs):
        objs, new = import_glb(g)
        root = objs['frame']
        root.rotation_mode = 'XYZ'
        root.rotation_euler = (0, 0, rad(-25))
        root.location = ((i - (n - 1) / 2) * sp, 0, 0)
    fix_materials()
    setup_world((2200, 760))
    ground()
    add_cam((0, 0, 9.6), sp * n + 2, pitch=6.0)
    render(out)


def equip_sheets(glb, prefix):
    reset_scene()
    objs, new = import_glb(glb)
    tops = sorted([o for o in new if o.parent is None], key=lambda o: o.name)
    groups = {'guns': [o for o in tops if o.name.startswith('g_')], 'back': [o for o in tops if o.name.startswith('b_')],
              'misc': [o for o in tops if o.name.startswith(('s_', 'm_'))]}
    fix_materials()
    setup_world((2000, 1100), bg=0.4)
    for o in tops:
        o.location = (0, 0, -500)
    for gname, items in groups.items():
        cols = 4
        cw, ch = {'guns': (11.0, 6.5), 'back': (14.0, 6.5), 'misc': (9.0, 12.5)}[gname]
        zoff = 4.0 if gname == 'misc' else -0.5
        rows = (len(items) + cols - 1) // cols
        for i, o in enumerate(items):
            r, c = divmod(i, cols)
            o.rotation_mode = 'XYZ'
            if o.name.startswith('s_'):
                o.rotation_euler = (0, 0, rad(-125))
            elif o.name.startswith('m_'):
                o.rotation_euler = (0, 0, rad(70))
            else:
                o.rotation_euler = (rad(0), 0, rad(-62))
            o.location = ((c - (cols - 1) / 2) * cw, 0, -(r - (rows - 1) / 2) * ch + zoff)
        cam = add_cam((0, 0, 0.5), cols * cw + 1, pitch=14.0)
        bpy.context.scene.render.resolution_y = int(2000 * (rows * ch + 1) / (cols * cw + 1))
        render('%s_%s.png' % (prefix, gname))
        bpy.data.objects.remove(cam, do_unlink=True)
        for o in items:
            o.location = (0, 0, -500)


if __name__ == '__main__':
    a = sys.argv[sys.argv.index('--') + 1:]
    if a[0] == 'frame':
        frame_sheet(a[1], a[2], pose=len(a) > 3 and a[3] == 'pose')
    elif a[0] == 'close':
        closeup(a[1], a[2], float(a[3]) if len(a) > 3 else 10.0, float(a[4]) if len(a) > 4 else 27.0)
    elif a[0] == 'loadout':
        loadout(a[1], a[2], a[3], a[4].split(','))
    elif a[0] == 'lineup':
        lineup(a[1], a[2:])
    elif a[0] == 'equip':
        equip_sheets(a[1], a[2])
