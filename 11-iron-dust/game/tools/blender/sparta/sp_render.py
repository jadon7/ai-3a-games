# sp_render.py -- preview renders for the converted frames (wraps ../mk_render_f.py with palettes for the new ids).
#   blender -b --factory-startup -P sp_render.py -- views <in.glb> <out.png>          front / side / rear three-quarter
#   blender -b --factory-startup -P sp_render.py -- pose <in.glb> <out.png>           the game's standard pose test
#   blender -b --factory-startup -P sp_render.py -- close <in.glb> <out.png> [zc] [width]
#   blender -b --factory-startup -P sp_render.py -- loadout <in.glb> <equipA.glb;equipB.glb> <out.png> item:mount,...
#   blender -b --factory-startup -P sp_render.py -- rifle <equip_s.glb> <out.png>
#   blender -b --factory-startup -P sp_render.py -- sheet <in.glb> <out prefix>       _front / _side / _back / _34 / _pose .png
#   blender -b --factory-startup -P sp_render.py -- one <in.glb> <out.png> <yaw deg> [pose]
#   blender -b --factory-startup -P sp_render.py -- equip_m <equip_m.glb> <out.png>
#   blender -b --factory-startup -P sp_render.py -- knee <in.glb> <out.png>           legs of the joint test pose, close
import bpy, sys, os
from math import radians as rad
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
if TOOLS not in sys.path:
    sys.path.insert(0, TOOLS)
import mk_render_f as F
from mk_geo import MAT_COL, reset_scene
from mk_render import setup_world, add_cam, ground
from mk_render import render as _render


def render(path):
    # Blender resolves a relative render path against the drive root, not the working directory
    _render(os.path.abspath(path))


F.render = render

# suggested palettes matching the source renders (dark gunmetal armour, mint-green visor, red accent)
F.PALS.update({
    'sparta': dict(A=(0.20, 0.21, 0.23), B=(0.105, 0.11, 0.125), C=(0.52, 0.40, 0.14), G=(0.25, 1.0, 0.55)),
    'phalanx': dict(A=(0.17, 0.18, 0.20), B=(0.09, 0.095, 0.11), C=(0.62, 0.07, 0.07), G=(0.25, 1.0, 0.55)),
    # enemy frames: navy / green / red with a purple eye (mech 3), gunmetal with red spikes and a pink eye (mech 4)
    'brute': dict(A=(0.13, 0.16, 0.25), B=(0.21, 0.33, 0.16), C=(0.60, 0.08, 0.07), G=(0.75, 0.2, 1.0)),
    'reaver': dict(A=(0.24, 0.25, 0.27), B=(0.11, 0.115, 0.13), C=(0.55, 0.09, 0.07), G=(1.0, 0.18, 0.45)),
})

# joint test pose: both knees bent 60 deg (hip +30, knee -60, ankle +30 keeps the soles flat), right arm raised
# forward, left arm raised out to the side; the pauldrons follow the arms the way mech_model.gd drives them
# (0.32 x shoulder pitch, 0.5 x shoulder roll)
KNEE = rad(60)
BENT = {'hip_L': (KNEE / 2, 0, 0), 'knee_L': (-KNEE, 0, 0), 'ankle_L': (KNEE / 2, 0, 0),
        'hip_R': (KNEE / 2, 0, 0), 'knee_R': (-KNEE, 0, 0), 'ankle_R': (KNEE / 2, 0, 0),
        'skirt_FL': (KNEE / 2, 0, 0), 'skirt_FR': (KNEE / 2, 0, 0),      # the game swings the front skirts with the thighs
        'sh_R': (1.5, 0, 0), 'el_R': (0.4, 0, 0), 'pauldron_R': (1.5 * 0.32, 0, 0),
        'sh_L': (0.5, 1.1, 0), 'el_L': (0.6, 0, 0), 'pauldron_L': (0.5 * 0.32, 1.1 * 0.5, 0)}


def bent_pose(objs):
    import math
    for n, r in BENT.items():
        o = objs[n]
        o.rotation_mode = 'XYZ'
        o.rotation_euler = r
    th = -objs['knee_L'].location.z
    sh = -objs['ankle_L'].location.z
    objs['pelvis'].location.z -= (th + sh) * (1.0 - math.cos(KNEE / 2))


def one(glb, out, ang, pose=False, res=(1000, 1200), span=22.0, zc=9.9, pitch=6.0):
    reset_scene()
    objs, new = F.load(glb)
    if pose:
        bent_pose(objs)
    F.place(objs['frame'], 0.0, ang)
    setup_world(res)
    ground()
    add_cam((0, 0, zc), span, pitch=pitch)
    render(out)


def sheet(glb, prefix):
    """<prefix>_front / _side / _back / _34 .png at rest and <prefix>_pose.png (three views of the joint test pose)"""
    for tag, ang in (('front', 0), ('side', -90), ('back', 180), ('34', -32)):
        one(glb, '%s_%s.png' % (prefix, tag), ang)
    reset_scene()
    for x, ang in ((-17.0, -35), (0.0, -90), (17.0, 150)):
        objs, new = F.load(glb)
        bent_pose(objs)
        F.place(objs['frame'], x, ang)
    setup_world((2200, 1000))
    ground()
    add_cam((0, 0, 9.4), 52.0, pitch=7.0)
    render(prefix + '_pose.png')


def knee_close(glb, out):
    """the joint test pose seen close: legs from the side, from the rear three-quarter and from the front three-quarter"""
    reset_scene()
    for x, ang in ((-13.0, -90), (0.0, 150), (13.0, -35)):
        objs, new = F.load(glb)
        bent_pose(objs)
        F.place(objs['frame'], x, ang)
    setup_world((2200, 900))
    ground()
    add_cam((0, 0, 5.2), 40.0, pitch=7.0)
    render(out)


def equip_m(glb, out):
    """every item of equip_m.glb: left column three-quarter front, right column side view"""
    reset_scene()
    pal = dict(MAT_COL, **F.PALS['brute'])
    lay = [('g_m3bazooka', 7.5), ('g_m4tube', 1.0), ('b_m4tube', -3.0), ('m_m4saber', -7.5)]
    for yaw, x in ((-50, -9.0), (-90, 8.0)):
        objs, new = F.load(glb, pal)
        tops = {o.name.split('.')[0]: o for o in new if o.parent is None}
        for nm, z in lay:
            o = tops[nm]
            o.rotation_mode = 'XYZ'
            if nm.startswith('m_'):
                o.rotation_euler = (0, rad(90), rad(yaw + 90))      # blade laid horizontally
                o.location = (x - 3.0, 0, z)
            else:
                o.rotation_euler = (0, 0, rad(yaw))
                o.location = (x, 0, z)
    setup_world((2000, 1200), bg=0.4)
    add_cam((1.0, 0, 1.0), 40.0, pitch=10.0)
    render(out)


def views(glb, out):
    reset_scene()
    for x, ang in ((-30.0, 0), (-10.0, -32), (10.0, -90), (30.0, 150)):
        objs, new = F.load(glb)
        F.place(objs['frame'], x, ang)
    setup_world((2400, 860))
    ground()
    add_cam((0, 0, 9.9), 80.0, pitch=7.0)
    render(out)


def rifle(glb, out):
    reset_scene()
    objs, new = F.load(glb, dict(MAT_COL, **F.PALS['phalanx']))
    for x, z, rot in ((-5.5, 2.5, (0, 0, rad(-90))), (5.0, 2.5, (0, 0, rad(-50))), (-5.5, -2.5, (0, 0, rad(90))), (5.0, -3.0, (rad(-90), 0, rad(-90)))):
        if x != -5.5 or z != 2.5:
            o2, n2 = F.load(glb, dict(MAT_COL, **F.PALS['phalanx']))
            o = [o for o in n2 if o.parent is None][0]
        else:
            o = [o for o in new if o.parent is None][0]
        o.rotation_mode = 'XYZ'
        o.rotation_euler = rot
        o.location = (x, 0, z)
    setup_world((1800, 1000), bg=0.4)
    add_cam((0, 0, 0.6), 22.0, pitch=10.0)
    render(out)


if __name__ == '__main__':
    a = sys.argv[sys.argv.index('--') + 1:]
    if a[0] == 'views':
        views(a[1], a[2])
    elif a[0] == 'pose':
        F.frame_sheet(a[1], a[2], pose=True)
    elif a[0] == 'close':
        F.closeup(a[1], a[2], float(a[3]) if len(a) > 3 else 10.3, float(a[4]) if len(a) > 4 else 27.0)
    elif a[0] == 'loadout':
        F.loadout(a[1], [e for e in a[2].split(';') if e and os.path.exists(e)], a[3], a[4].split(','))
    elif a[0] == 'rifle':
        rifle(a[1], a[2])
    elif a[0] == 'sheet':
        sheet(a[1], a[2])
    elif a[0] == 'one':
        one(a[1], a[2], float(a[3]), pose=len(a) > 4 and a[4] == 'pose')
    elif a[0] == 'equip_m':
        equip_m(a[1], a[2])
    elif a[0] == 'knee':
        knee_close(a[1], a[2])
