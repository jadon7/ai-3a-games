# build_equip_e.py -- enemy equipment library (equip_e.glb) for IRON DUST.  Original designs.
# Run:  blender -b --factory-startup -P build_equip_e.py -- [--out <dir>]      (default: tools/blender/out)
# Same conventions as build_equip.py: +Y = barrel/front (glTF -Z), +Z = top, +X = right; hand weapons have the
# grip at the origin and a '<item>_muzzle' marker; shields are three pieces (_core, _upper, _lower) whose plate
# faces -X; arm blades hang along -Z from the forearm's rear hard-point.
import bpy, sys, os, json
from math import radians as rad, sin, cos, pi
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import build_equip as BE
from build_equip import R, item, muzzle, grip, slots, shield
from mk_geo import S, xf, I4, reset_scene, bake_colors, build_objects, export_glb
from mk_foe import spike, cable, band

OUT = os.path.join(HERE, 'out')


def g_brg():
    """Battle rifle: underslung grenade tube and a bayonet blade below the barrel."""
    p = item('g_brg')
    grip(p)
    z = 0.98
    p.tube('W', [S(-1.7, 0.38, 0.52, 0.12, cv=z), S(2.0, 0.38, 0.52, 0.12, cv=z)], axis='Y', grooves=[0.35])
    p.box('B', (0.86, 1.5, 0.52), (0, -0.75, z + 0.02), bv=0.05)
    for sx in (-1, 1):
        p.bolts('F', [(sx * 0.43, -1.35, z), (sx * 0.43, -0.15, z)], (sx, 0, 0), r=0.06)
        p.box('F', (0.08, 1.4, 0.14), (sx * 0.41, 1.1, z + 0.3), bv=0.0)
    p.box('T', (0.06, 0.6, 0.22), (0.39, 0.95, z + 0.02), bv=0.0)
    p.box('F', (0.16, 0.3, 0.12), (0.42, 0.3, z + 0.2), bv=0.0)
    p.cyl('F', 0.07, 0.3, (0.52, 0.3, z + 0.2), axis='X', n=6)
    # stock
    p.prism('W', [(-1.7, 1.45), (-3.1, 1.3), (-3.1, 0.42), (-2.7, 0.36), (-2.1, 0.82), (-1.7, 0.82)], 0.52, 'YZ', bv=0.05)
    p.box('T', (0.58, 0.12, 0.92), (0, -3.14, 0.86), bv=0.02)
    p.box('B', (0.56, 0.9, 0.2), (0, -2.3, 1.42), bv=0.03)
    p.cyl('F', 0.1, 0.56, (0, -2.75, 0.3), axis='X', n=6)
    # curved magazine
    p.box('F', (0.4, 0.74, 1.0), (0, 1.14, -0.02), (rad(-8), 0, 0), bv=0.04)
    p.box('F', (0.4, 0.7, 0.7), (0, 1.33, -0.76), (rad(-22), 0, 0), bv=0.04)
    p.box('B', (0.44, 0.74, 0.14), (0, 1.5, -1.1), (rad(-22), 0, 0), bv=0.02)
    p.box('F', (0.52, 0.9, 0.46), (0, 1.1, 0.56), bv=0.04)
    # handguard, rail, barrel, brake
    p.tube('W', [S(2.0, 0.44, 0.48, 0.14, cv=z), S(4.3, 0.38, 0.4, 0.12, cv=z)], axis='Y')
    slots(p, 0.42, 2.2, 4.1, z + 0.05, n=5, h=0.14)
    p.box('B', (0.5, 2.0, 0.1), (0, 3.1, z + 0.47), bv=0.02)
    for y in (2.4, 2.9, 3.4, 3.9):
        p.box('T', (0.3, 0.26, 0.04), (0, y, z + 0.53), bv=0.0)
    p.cyl('T', 0.2, 2.0, (0, 5.2, z), axis='Y', n=10)
    p.cyl('W', 0.3, 0.7, (0, 6.1, z), axis='Y', n=10)
    for y in (5.92, 6.18):
        p.box('T', (0.64, 0.1, 0.16), (0, y, z), bv=0.0)
    p.box('F', (0.2, 0.3, 0.4), (0, 4.75, z + 0.3), bv=0.02)
    p.box('F', (0.1, 0.16, 0.3), (0, 4.75, z + 0.6), bv=0.0)
    # optic
    p.box('F', (0.22, 1.6, 0.12), (0, 0.2, z + 0.56), bv=0.02)
    p.cyl('W', 0.26, 1.5, (0, 0.2, z + 0.92), axis='Y', n=10)
    p.cyl('W', 0.32, 0.3, (0, 0.82, z + 0.92), axis='Y', n=10)
    p.cyl('T', 0.24, 0.06, (0, 0.98, z + 0.92), axis='Y', n=10)
    p.cyl('G', 0.17, 0.04, (0, 1.0, z + 0.92), axis='Y', n=10)
    for s in (-1, 1):
        p.box('F', (0.1, 0.16, 0.34), (0, 0.2 + s * 0.5, z + 0.68), bv=0.0)
    p.box('F', (0.14, 0.2, 0.3), (0, -1.3, z + 0.64), bv=0.02)
    # underslung grenade launcher
    zg = -0.02
    p.cyl('W', 0.33, 2.3, (0, 3.0, zg), axis='Y', n=12)
    for y in (2.2, 3.85):
        p.cyl('F', 0.38, 0.18, (0, y, zg), axis='Y', n=12)
    p.cyl('C', 0.35, 0.22, (0, 3.2, zg), axis='Y', n=12)
    p.cyl('T', 0.27, 0.06, (0, 4.16, zg), axis='Y', n=12)
    p.box('F', (0.5, 0.56, 0.5), (0, 1.9, zg + 0.08), (rad(10), 0, 0), bv=0.05)
    p.box('F', (0.3, 0.5, 0.3), (0, 2.6, 0.42), bv=0.03)
    p.box('F', (0.3, 0.4, 0.3), (0, 3.7, 0.42), bv=0.03)
    p.rod('F', (0, 1.75, -0.2), (0, 1.5, -0.42), 0.05, n=5)
    # bayonet: lug + blade between barrel and launcher
    p.box('F', (0.26, 0.9, 0.3), (0, 4.75, 0.76), bv=0.04)
    p.prism('W', [(4.25, 0.74), (6.8, 0.74), (7.6, 0.6), (7.0, 0.36), (4.25, 0.3)], 0.14, 'YZ', bv=0.03)
    p.prism('K', [(4.4, 0.3), (7.0, 0.36), (7.64, 0.6), (7.72, 0.52), (7.04, 0.24), (4.4, 0.18)], 0.06, 'YZ', bv=0.0)
    for sx in (-1, 1):
        p.line('T', (sx * 0.071, 4.6, 0.58), (sx * 0.071, 6.7, 0.58), (sx, 0, 0), w=0.1)
    muzzle('g_brg', (0, 6.48, z))
    R.joint('g_brg_muzzle2', 'g_brg', (0, 4.2, zg))


def g_armgun():
    """Three-tube launcher worn over the forearm: gripped like a gun, tubes above the fist, saddle over the arm."""
    p = item('g_armgun')
    grip(p)
    tubes = [(-0.43, 1.02), (0.43, 1.02), (0.0, 1.72)]
    for x, z in tubes:
        p.cyl('W', 0.38, 4.2, (x, 1.3, z), axis='Y', n=12)
        p.cyl('F', 0.42, 0.22, (x, 3.24, z), axis='Y', n=12)
        p.cyl('T', 0.3, 0.06, (x, 3.42, z), axis='Y', n=12)
        p.cyl('F', 0.3, 0.24, (x, -0.9, z), axis='Y', n=10)
        p.cyl('T', 0.2, 0.06, (x, -1.03, z), axis='Y', n=8)
    for y in (0.1, 2.3):
        p.tube('F', [S(y - 0.15, 0.9, 0.84, 0.34, cv=1.32), S(y + 0.15, 0.9, 0.84, 0.34, cv=1.32)], axis='Y')
    # armoured hood + stripe + sight
    p.prism('B', [(-0.7, 2.14), (2.9, 2.14), (3.1, 2.0), (3.1, 1.86), (-0.7, 1.86)], 1.3, 'YZ', bv=0.04, far=0.86, near=0.86)
    p.box('C', (1.16, 0.4, 0.06), (0, 2.3, 2.17), bv=0.0)
    p.box('F', (0.26, 0.7, 0.3), (-0.4, 0.4, 2.3), bv=0.03)
    p.cyl('T', 0.11, 0.06, (-0.4, 0.77, 2.32), axis='Y', n=8)
    p.cyl('G', 0.08, 0.04, (-0.4, 0.79, 2.32), axis='Y', n=8)
    for sx in (-1, 1):
        p.box('B', (0.12, 2.6, 0.5), (sx * 0.92, 1.2, 1.3), bv=0.04)
        p.bolts('F', [(sx * 0.98, 0.3, 1.3), (sx * 0.98, 2.1, 1.3)], (sx, 0, 0), r=0.07)
    # saddle over the forearm + feed box
    p.prism('B', [(-3.0, 1.66), (-0.9, 1.72), (-0.7, 1.86), (-0.9, 1.94), (-3.0, 1.84)], 1.7, 'YZ', bv=0.04, far=0.9, near=0.9)
    for sx in (-1, 1):
        p.box('B', (0.14, 1.9, 0.52), (sx * 0.84, -1.95, 1.5), (0, sx * rad(-12), 0), bv=0.04)
        p.bolts('F', [(sx * 0.93, -1.3, 1.5), (sx * 0.93, -2.6, 1.5)], (sx, 0, 0), r=0.06)
        p.rod('F', (sx * 0.5, -0.9, 1.9), (sx * 0.5, -0.2, 1.9), 0.07, n=5)
    p.box('W', (1.0, 1.0, 0.56), (0, -2.1, 2.16), bv=0.06)
    p.box('H', (1.02, 0.2, 0.12), (0, -2.1, 2.2), bv=0.0)
    p.hatch((0, -2.1, 2.44), (0, 0, 1), (0, 1, 0), 0.7, 0.7)
    cable(p, 'F', [(0.2, -1.6, 2.3), (0.3, -1.2, 2.5), (0.2, -0.8, 2.2)], 0.1, n=6)
    p.box('F', (0.3, 0.3, 0.6), (0, 0.1, 0.5), bv=0.04)
    muzzle('g_armgun', (0, 3.5, 1.25))


def m_claw(name, mirror):
    """Twin long claw blades on the forearm's rear hard-point (authored for the right arm)."""
    R.joint(name, None, (BE._n[0] * BE.SPACING, 0, 0))
    BE._n[0] += 1
    p = R.pen(name, mirror)
    p.box('W', (1.04, 0.5, 1.5), (0, -0.28, 0.36), bv=0.06)
    p.box('F', (1.18, 0.4, 0.24), (0, -0.22, 0.98), bv=0.03)
    p.box('B', (0.56, 0.58, 0.9), (0, -0.34, 0.32), bv=0.04)
    p.line('T', (0, -0.64, 0.0), (0, -0.64, 0.64), (0, -1, 0), w=0.08)
    for sx in (-1, 1):
        p.bolts('F', [(sx * 0.52, -0.28, 0.02), (sx * 0.52, -0.28, 0.7)], (sx, 0, 0), r=0.07)
    p.cyl('F', 0.2, 1.36, (0, -0.5, -0.46), axis='X', n=8)
    p.piston((0, -0.66, 1.0), (0, -0.62, -0.3), r=0.08)
    for sx in (-1, 1):
        q = p.at((sx * 0.38, 0, -0.45), (0, sx * rad(-3.5), 0))
        q.box('F', (0.3, 0.56, 0.56), (0, -0.44, 0.0), bv=0.04)
        q.box('B', (0.34, 0.3, 0.3), (0, -0.74, -0.1), bv=0.03)
        q.prism('W', [(-0.12, -0.1), (-0.1, -3.2), (-0.34, -4.25), (-0.66, -3.1), (-0.84, -0.6), (-0.62, -0.1)], 0.13, 'YZ', bv=0.03)
        q.prism('K', [(-0.8, -0.6), (-0.62, -3.1), (-0.35, -4.3), (-0.48, -4.42), (-0.82, -3.16), (-1.0, -0.56)], 0.05, 'YZ', bv=0.0)
        q.line('T', (0.066, -0.36, -0.6), (0.066, -0.34, -3.0), (1, 0, 0), w=0.09)
        q.line('T', (-0.066, -0.36, -0.6), (-0.066, -0.34, -3.0), (-1, 0, 0), w=0.09)


def s_spike():
    """Round-shouldered enemy shield with a central horn and studs."""
    def deco(key, p, x, cy, cz):
        if key == 'core':
            p.cyl('C', 0.8, 0.16, (x - 0.14, cy, 0.1), axis='X', n=12)
            p.cyl('B', 0.56, 0.16, (x - 0.24, cy, 0.1), axis='X', n=12)
            spike(p, 'B', (x - 0.3, cy, 0.1), (-1, 0, 0), 0.4, 1.5, n=8)
            for i in range(6):
                a = i * pi / 3 + pi / 6
                p.bolt('F', (x - 0.22, cy + 0.68 * cos(a), 0.1 + 0.68 * sin(a)), (-1, 0, 0), r=0.07)
        if key == 'upper':
            for s in (-1, 1):
                spike(p, 'B', (x - 0.08, cy + s * 1.0, 2.2), (-1, 0, 0.12), 0.2, 0.62, n=6, collar='B')
            p.box('T', (0.1, 1.5, 0.2), (x - 0.11, cy, 2.72), bv=0.0)
        if key == 'lower':
            spike(p, 'B', (x - 0.08, cy, -2.5), (-1, 0, -0.12), 0.2, 0.62, n=6, collar='B')
            p.box('C', (0.14, 0.9, 0.3), (x - 0.02, cy, -3.4), bv=0.0)
    shield('s_spike', {
        'upper': (1.22, [(-1.0, 3.05), (1.0, 3.05), (1.66, 2.5), (1.9, 1.75), (1.9, 1.26), (-1.9, 1.26), (-1.9, 1.75), (-1.66, 2.5)]),
        'core': (0.0, [(1.9, 1.2), (1.9, -0.6), (1.72, -1.15), (-1.72, -1.15), (-1.9, -0.6), (-1.9, 1.2)]),
        'lower': (-1.18, [(1.7, -1.21), (1.3, -2.6), (0.5, -3.75), (-0.5, -3.75), (-1.3, -2.6), (-1.7, -1.21)]),
    }, 0.34, deco)


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = os.path.abspath(args[args.index('--out') + 1]) if '--out' in args else OUT
    reset_scene()
    g_brg()
    g_armgun()
    m_claw('m_claw_L', True)
    m_claw('m_claw_R', False)
    s_spike()
    bake_colors(R, ground=False, flat_dust=0.1, maxd=1.6)
    for j in R.joints.values():
        if j.parent is None:
            j.local = I4.copy()
    build_objects(R)
    os.makedirs(out, exist_ok=True)
    export_glb(os.path.join(out, 'equip_e.glb'))
    per = {}
    for (jn, mat), b in R.bufs.items():
        top = jn
        while R.joints[top].parent is not None:
            top = R.joints[top].parent.name
        per[top] = per.get(top, 0) + sum(len(f) - 2 for f in b['f'])
    print('BUILD equip_e', json.dumps(dict(tris=R.tris, joints=len(R.joints), meshes=len(R.bufs), per_item=per)))


if __name__ == '__main__':
    main()
