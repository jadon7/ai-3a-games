# mk_render_f.py -- preview renders for the friendly frames (wraps mk_render.py: per-frame palettes,
# edge-wear preview from vertex colour B, several equipment libraries in one loadout).
#   blender -b --factory-startup -P mk_render_f.py -- frame <in.glb> <out.png> [pose]
#   blender -b --factory-startup -P mk_render_f.py -- close <in.glb> <out.png> [zc] [width]
#   blender -b --factory-startup -P mk_render_f.py -- loadout <in.glb> <equipA.glb;equipB.glb> <out.png> item:mount,item:mount
#   blender -b --factory-startup -P mk_render_f.py -- lineup <out.png> <a.glb> <b.glb> ...
#   blender -b --factory-startup -P mk_render_f.py -- equip <equip_f.glb> <out.png>
import bpy, sys, os, math
from math import radians as rad
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
from mk_geo import MAT_COL, reset_scene
from mk_render import import_glb, setup_world, add_cam, ground, apply_pose, render, base_name

# suggested palettes (A, B, C armour keys + glow) -- the game applies its own colours per key
PALS = {
    'kestrel': dict(A=(0.46, 0.50, 0.40), B=(0.17, 0.22, 0.17), C=(0.80, 0.36, 0.08), G=(0.25, 0.85, 1.0)),
    'bastion': dict(A=(0.76, 0.76, 0.72), B=(0.33, 0.36, 0.40), C=(0.78, 0.56, 0.08), G=(0.35, 1.0, 0.6)),
    'shrike': dict(A=(0.10, 0.11, 0.13), B=(0.22, 0.23, 0.26), C=(0.70, 0.50, 0.12), G=(0.72, 0.36, 1.0)),
    'heron': dict(A=(0.47, 0.62, 0.52), B=(0.13, 0.15, 0.30), C=(0.86, 0.83, 0.74), G=(0.2, 1.0, 0.85)),
}


def pal_for(path):
    stem = os.path.splitext(os.path.basename(path))[0]
    pal = dict(MAT_COL)
    pal.update(PALS.get(stem, {}))
    return pal


def skin(mats, pal):
    attr = None
    for me in bpy.data.meshes:
        if me.color_attributes:
            attr = me.color_attributes[0].name
            break
    for m in mats:
        key = base_name(m.name)
        if key not in pal:
            continue
        c = pal[key]
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
        # dust (G)
        mixd = nt.nodes.new('ShaderNodeMix')
        mixd.data_type = 'RGBA'
        mixd.inputs['A'].default_value = (c[0], c[1], c[2], 1)
        mixd.inputs['B'].default_value = (0.42, 0.34, 0.24, 1)
        mul = nt.nodes.new('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = 0.38
        nt.links.new(sep.outputs[1], mul.inputs[0])
        nt.links.new(mul.outputs[0], mixd.inputs['Factor'])
        # edge wear (B): bare metal where the bake marked a bevel
        mixe = nt.nodes.new('ShaderNodeMix')
        mixe.data_type = 'RGBA'
        mixe.inputs['B'].default_value = (0.5, 0.5, 0.52, 1)
        wm = nt.nodes.new('ShaderNodeMath')
        wm.operation = 'MULTIPLY'
        wm.inputs[1].default_value = 0.55 if key in 'ABCH' else 0.25
        nt.links.new(sep.outputs[2], wm.inputs[0])
        nt.links.new(wm.outputs[0], mixe.inputs['Factor'])
        nt.links.new(mixd.outputs['Result'], mixe.inputs['A'])
        # shade (R)
        ao = nt.nodes.new('ShaderNodeMix')
        ao.data_type = 'RGBA'
        ao.blend_type = 'MULTIPLY'
        ao.inputs['Factor'].default_value = 1.0
        nt.links.new(mixe.outputs['Result'], ao.inputs['A'])
        pw = nt.nodes.new('ShaderNodeMath')
        pw.operation = 'POWER'
        pw.inputs[1].default_value = 1.6
        nt.links.new(sep.outputs[0], pw.inputs[0])
        comb = nt.nodes.new('ShaderNodeCombineColor')
        for i in range(3):
            nt.links.new(pw.outputs[0], comb.inputs[i])
        nt.links.new(comb.outputs[0], ao.inputs['B'])
        nt.links.new(ao.outputs['Result'], bsdf.inputs['Base Color'])


def load(path, pal=None):
    before = set(bpy.data.materials)
    objs, new = import_glb(path)
    skin([m for m in bpy.data.materials if m not in before], pal or pal_for(path))
    return objs, new


def place(root, x, ang):
    root.rotation_mode = 'XYZ'
    root.rotation_euler = (0, 0, rad(ang))
    root.location = (x, 0, 0)


def frame_sheet(glb, out, pose=False):
    reset_scene()
    views = [-32, -90, 180] if not pose else [-35, 150, -90]
    for x, ang in zip((-19.0, 0.0, 19.0), views):
        objs, new = load(glb)
        if pose:
            apply_pose(objs)
        place(objs['frame'], x, ang)
    setup_world((2000, 880))
    ground()
    add_cam((0, 0, 9.9), 58.0, pitch=7.0)
    render(out)


def closeup(glb, out, zc=10.3, width=27.0):
    reset_scene()
    for x, ang in ((-7.0, -38), (7.0, 142)):
        objs, new = load(glb)
        place(objs['frame'], x, ang)
    setup_world((1900, 1400))
    ground()
    add_cam((0, 0, zc), width, pitch=12.0)
    render(out)


# the game's standing pose: right arm holds the gun level, left arm carries the shield / arm gear, knees slightly bent
READY = {'sh_R': (0.45, 0, 0.1), 'el_R': (1.05, 0, 0), 'sh_L': (0.3, 0, -0.2), 'el_L': (0.9, 0, 0)}


def ready_pose(objs):
    for n, r in READY.items():
        if n in objs:
            o = objs[n]
            o.rotation_mode = 'XYZ'
            e = o.rotation_euler
            o.rotation_euler = (e.x + r[0], e.y + r[1], e.z + r[2])
    if 'pauldron_R' in objs:
        objs['pauldron_R'].rotation_mode = 'XYZ'
        objs['pauldron_R'].rotation_euler = (0.45 * 0.32, 0, 0.05)
    if 'pauldron_L' in objs:
        objs['pauldron_L'].rotation_mode = 'XYZ'
        objs['pauldron_L'].rotation_euler = (0.3 * 0.32, 0, -0.1)


def loadout(glb, equips, out, pairs):
    reset_scene()
    pal = pal_for(glb)
    for x, ang, pose in ((-20.0, -40, False), (0.0, 35, True), (20.0, 150, False)):
        objs, new = load(glb)
        eq, enew = {}, []
        for e in equips:
            a, b = load(e, pal)
            eq.update(a)
            enew.extend(b)
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
        else:
            ready_pose(objs)
        place(objs['frame'], x, ang)
    setup_world((2000, 960))
    ground()
    add_cam((0, 0, 10.2), 64.0, pitch=8.0)
    render(out)


def lineup(out, glbs, ang=-25, pitch=6.0):
    reset_scene()
    n = len(glbs)
    sp = 16.0
    for i, g in enumerate(glbs):
        objs, new = load(g)
        place(objs['frame'], (i - (n - 1) / 2) * sp, ang)
    setup_world((2200, 900))
    ground()
    add_cam((0, 0, 10.0), sp * n + 2, pitch=pitch)
    render(out)


def equip_sheet(glb, out):
    reset_scene()
    objs, new = load(glb, dict(MAT_COL, A=(0.76, 0.76, 0.72), B=(0.33, 0.36, 0.40)))
    tops = {o.name: o for o in new if o.parent is None}
    setup_world((2000, 1280), bg=0.4)
    # (name, x, z, rot euler)
    lay = [('g_sniper', -7.0, 7.4, (0, 0, rad(-62))), ('g_cbeam', 8.0, 7.2, (0, 0, rad(-62))),
           ('h_anchor', -13.0, -2.6, (0, rad(90), rad(-60))), ('h_hook', -8.5, -3.0, (0, 0, rad(-62))),
           ('s_guard', -2.0, -1.6, (0, 0, rad(-125))), ('m_lance', 5.5, -3.0, (0, rad(-78), rad(20)))]
    for o in tops.values():
        o.location = (0, 0, -500)
    for nm, x, z, rot in lay:
        if nm in tops:
            o = tops[nm]
            o.rotation_mode = 'XYZ'
            o.rotation_euler = rot
            o.location = (x, 0, z)
    add_cam((0, 0, 2.2), 34.0, pitch=14.0)
    render(out)


if __name__ == '__main__':
    a = sys.argv[sys.argv.index('--') + 1:]
    if a[0] == 'frame':
        frame_sheet(a[1], a[2], pose=len(a) > 3 and a[3] == 'pose')
    elif a[0] == 'close':
        closeup(a[1], a[2], float(a[3]) if len(a) > 3 else 10.3, float(a[4]) if len(a) > 4 else 27.0)
    elif a[0] == 'loadout':
        loadout(a[1], [e for e in a[2].split(';') if e and os.path.exists(e)], a[3], a[4].split(','))
    elif a[0] == 'lineup':
        lineup(a[1], a[2:])
    elif a[0] == 'lineupr':          # rear three-quarter, seen from above like the chase camera
        lineup(a[1], a[2:], ang=152, pitch=20.0)
    elif a[0] == 'equip':
        equip_sheet(a[1], a[2])
