# eqb_render.py -- preview sheet for an item of equip_b.glb: right side, left side, top, front, three-quarter.
#   blender -b --factory-startup -P eqb_render.py -- <equip_b.glb> <out.png> [pal: reaver|ace|captured]
import bpy, sys, os
from math import radians as rad
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import mk_render_f as F
from mk_geo import MAT_COL, reset_scene
from mk_render import setup_world, add_cam, render

PALS = {
    'reaver': dict(A=(0.24, 0.25, 0.27), B=(0.11, 0.115, 0.13), C=(0.55, 0.09, 0.07), G=(1.0, 0.18, 0.45)),
    'ace': dict(A=(0.72, 0.64, 0.76), B=(0.70, 0.70, 0.74), C=(0.88, 0.88, 0.90), G=(1.0, 0.6, 0.95)),
    'captured': dict(A=(0.52, 0.52, 0.48), B=(0.18, 0.19, 0.21), C=(0.82, 0.40, 0.08), G=(0.25, 0.85, 1.0)),
}


def main():
    a = sys.argv[sys.argv.index('--') + 1:]
    pal = dict(MAT_COL, **PALS[a[2] if len(a) > 2 else 'reaver'])
    reset_scene()
    # (x, z, euler ZYX: tilt about X, 0, yaw)
    # the camera looks from +Y, so screen right is -X.  Top row: right side, left side.  Bottom row: top, front, 3/4
    lay = [(10.0, 3.3, (0, 0, rad(90))), (-10.0, 3.3, (0, 0, rad(-90))), (10.0, -4.6, (rad(-90), 0, rad(90))),
           (-2.6, -5.2, (0, 0, 0)), (-9.4, -5.0, (rad(-24), 0, rad(42)))]
    for x, z, rot in lay:
        objs, new = F.load(a[0], pal)
        o = [o for o in new if o.parent is None][0]
        o.rotation_mode = 'ZYX'
        o.rotation_euler = rot
        o.location = (x, 0, z)
    setup_world((2400, 1040), bg=0.42)
    add_cam((0.0, 0, 0.0), 40.0, pitch=0.0)
    render(os.path.abspath(a[1]))


if __name__ == '__main__':
    main()
