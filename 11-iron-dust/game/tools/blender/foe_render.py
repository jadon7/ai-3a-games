# foe_render.py -- preview renders for the enemy frames / equipment with per-frame palettes (built on mk_render.py).
#   blender -b --factory-startup -P foe_render.py -- sheet   <id> <out.png> [pal]
#   blender -b --factory-startup -P foe_render.py -- close   <id> <out.png> [zc] [width] [pal]
#   blender -b --factory-startup -P foe_render.py -- zoom    <id> <out.png> <zc> <width> <angle> [pal]
#   blender -b --factory-startup -P foe_render.py -- lineup  <out.png> [pal] [id ...]
#   blender -b --factory-startup -P foe_render.py -- loadout <id> <out.png> item:mount,item:mount,... [pal]
#   blender -b --factory-startup -P foe_render.py -- equip   <out.png>
# Frames are read from tools/blender/out (override with --dir <dir>). 'pal' = use the suggested palette instead of the neutral one.
import bpy, sys, os
from math import radians as rad
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import mk_render as MR
from mk_geo import MAT_COL, reset_scene

DIR = os.path.join(HERE, 'out')
MODELS = os.path.normpath(os.path.join(HERE, '..', '..', 'models'))

# suggested game palettes (A, B, C armour colours + glow)
PALS = {
    'hound': {'A': (0.40, 0.19, 0.12), 'B': (0.14, 0.13, 0.13), 'C': (0.62, 0.54, 0.38), 'G': (1.0, 0.22, 0.10)},
    'mauler': {'A': (0.21, 0.23, 0.19), 'B': (0.36, 0.14, 0.09), 'C': (0.68, 0.50, 0.12), 'G': (1.0, 0.20, 0.10)},
    'revenant': {'A': (0.10, 0.10, 0.12), 'B': (0.40, 0.07, 0.07), 'C': (0.70, 0.66, 0.58), 'G': (1.0, 0.25, 0.05)},
    'ripper': {'A': (0.40, 0.29, 0.13), 'B': (0.13, 0.12, 0.11), 'C': (0.50, 0.12, 0.08), 'G': (1.0, 0.40, 0.10)},
}


def shade(mats, pal):
    """mk_render.fix_materials for one imported file, with its own palette."""
    attr = None
    for me in bpy.data.meshes:
        if me.color_attributes:
            attr = me.color_attributes[0].name
            break
    for m in mats:
        key = MR.base_name(m.name)
        if key not in MAT_COL:
            continue
        c = pal.get(key, MAT_COL[key])
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
        # paint -> chipped bare metal where B (edge wear) is high, armour keys only
        base = nt.nodes.new('ShaderNodeMix')
        base.data_type = 'RGBA'
        base.inputs['A'].default_value = (c[0], c[1], c[2], 1)
        base.inputs['B'].default_value = (0.42, 0.43, 0.45, 1)
        if key in 'ABC':
            wm = nt.nodes.new('ShaderNodeMath')
            wm.operation = 'MULTIPLY'
            wm.inputs[1].default_value = 0.55
            nt.links.new(sep.outputs[2], wm.inputs[0])
            nt.links.new(wm.outputs[0], base.inputs['Factor'])
        else:
            base.inputs['Factor'].default_value = 0.0
        mixd = nt.nodes.new('ShaderNodeMix')
        mixd.data_type = 'RGBA'
        nt.links.new(base.outputs['Result'], mixd.inputs['A'])
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


def load(path, pal):
    before = set(bpy.data.materials)
    objs, new = MR.import_glb(path)
    shade([m for m in bpy.data.materials if m not in before], pal)
    return objs, new


def place(fid, x, ang, pal, pose=False, equip=None, pairs=()):
    objs, new = load(os.path.join(DIR, fid + '.glb'), PALS[fid] if pal else {})
    for pr in pairs:
        it, mt = pr.split(':')
        lib = os.path.join(DIR, 'equip_e.glb') if it in ('g_brg', 'g_armgun', 'm_claw_L', 'm_claw_R', 's_spike') else os.path.join(MODELS, 'equip.glb')
        eq, enew = load(lib, PALS[fid] if pal else {})
        o = eq[it]
        o.parent = objs[mt]
        o.matrix_parent_inverse.identity()
        o.location = (0, 0, 0)
        o.rotation_mode = 'XYZ'
        o.rotation_euler = (0, 0, 0)
        for e in enew:
            if e.parent is None and e is not o:
                e.location = (0, 0, -900)
    if pose:
        MR.apply_pose(objs)
    root = objs['frame']
    root.rotation_mode = 'XYZ'
    root.rotation_euler = (0, 0, rad(ang))
    root.location = (x, 0, 0)
    return objs


def main():
    global DIR
    a = sys.argv[sys.argv.index('--') + 1:]
    if '--dir' in a:
        i = a.index('--dir')
        DIR = os.path.abspath(a[i + 1])
        del a[i:i + 2]
    pal = 'pal' in a
    a = [x for x in a if x != 'pal']
    reset_scene()
    cmd = a[0]
    if cmd == 'sheet':
        for x, ang in ((-19.0, 148), (0.0, -90), (19.0, -32)):
            place(a[1], x, ang, pal)
        MR.setup_world((2000, 880))
        MR.ground()
        MR.add_cam((0, 0, 9.6), 58.0, pitch=7.0)
        MR.render(a[2])
    elif cmd == 'close':
        zc = float(a[3]) if len(a) > 3 else 10.0
        width = float(a[4]) if len(a) > 4 else 27.0
        for x, ang in ((-7.0, -38), (7.0, 142)):
            place(a[1], x, ang, pal)
        MR.setup_world((1900, 1400))
        MR.ground()
        MR.add_cam((0, 0, zc), width, pitch=12.0)
        MR.render(a[2])
    elif cmd == 'zoom':
        place(a[1], 0.0, float(a[5]), pal)
        MR.setup_world((1400, 1400))
        MR.ground()
        MR.add_cam((0, 0, float(a[3])), float(a[4]), pitch=10.0)
        MR.render(a[2])
    elif cmd == 'lineup':
        ids = a[2:] or ['hound', 'mauler', 'ripper', 'revenant']
        sp = 15.5
        n = len(ids)
        for i, f in enumerate(ids):
            place(f, -(i - (n - 1) / 2) * sp, -28, pal)
        MR.setup_world((2200, 860))
        MR.ground()
        MR.add_cam((0, 0, 10.2), sp * n + 2, pitch=6.0)
        MR.render(a[1])
    elif cmd == 'loadout':
        pairs = a[3].split(',')
        for x, ang, pose in ((-19.0, -40, False), (0.0, 35, True), (19.0, 150, False)):
            place(a[1], x, ang, pal, pose, pairs=pairs)
        MR.setup_world((2000, 960))
        MR.ground()
        MR.add_cam((0, 0, 10.2), 60.0, pitch=8.0)
        MR.render(a[2])
    elif cmd == 'equip':
        objs, new = load(os.path.join(DIR, 'equip_e.glb'), {})
        tops = sorted([o for o in new if o.parent is None], key=lambda o: o.name)
        MR.setup_world((2200, 640), bg=0.4)
        cw = 8.6
        for i, o in enumerate(tops):
            o.rotation_mode = 'XYZ'
            o.rotation_euler = (0, 0, rad(-125) if o.name.startswith('s_') else (rad(70) if o.name.startswith('m_') else rad(-62)))
            o.location = ((i - (len(tops) - 1) / 2) * cw, 0, 2.2 if o.name.startswith('m_') else (0.4 if o.name.startswith('s_') else -0.6))
        MR.add_cam((0, 0, 0.3), len(tops) * cw + 1, pitch=14.0)
        MR.render(a[1])


if __name__ == '__main__':
    main()
