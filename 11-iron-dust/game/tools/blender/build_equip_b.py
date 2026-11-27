# build_equip_b.py -- beam weapons library (equip_b.glb) for IRON DUST.  Original designs.
# Run:  blender -b --factory-startup -P build_equip_b.py -- [--out <dir>]      (default: tools/blender/out)
# Same conventions as build_equip.py: +Y = barrel/front (glTF -Z), +Z = top, +X = right; hand weapons have the
# grip at the origin and a '<item>_muzzle' marker.
import bpy, sys, os, json
from math import radians as rad, sin, cos, pi
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import build_equip as BE
from build_equip import R, item, muzzle, grip
from mk_geo import S, xf, I4, reset_scene, bake_colors, build_objects, export_glb

OUT = os.path.join(HERE, 'out')


def g_bmg():
    """Beam machine gun: fires a five-bolt burst, then has to shed its heat.
    Reads from the side as: box stock - receiver with a row of five charge cells - cell pack ahead of the
    trigger - long slotted barrel shroud with a radiator slung under it - flared emitter.  Armour-coloured
    shroud / stock / pack over a dark frame; the sight lens, the cells and the emitter core glow."""
    p = item('g_bmg')
    grip(p)
    z = 1.02                                   # bore axis
    # ---- receiver: dark frame, sloped rear deck ----
    p.prism('W', [(-1.9, 0.5), (-1.9, 1.36), (-1.25, 1.64), (1.75, 1.64), (2.25, 1.42), (2.25, 0.5)], 0.8, 'YZ', bv=0.06)
    p.box('F', (0.84, 1.5, 0.12), (0, 0.2, 0.5), bv=0.02)                       # lower rail the grip hangs from
    for sx in (-1, 1):
        # five charge cells in a dark window: one per bolt of the burst
        p.box('T', (0.06, 1.62, 0.4), (sx * 0.4, -0.55, 1.06), bv=0.0)
        for i in range(5):
            p.box('G', (0.06, 0.2, 0.26), (sx * 0.42, -1.15 + i * 0.3, 1.06), bv=0.0)
        p.box('F', (0.1, 1.74, 0.07), (sx * 0.41, -0.55, 1.3), bv=0.0)
        p.box('F', (0.1, 1.74, 0.07), (sx * 0.41, -0.55, 0.82), bv=0.0)
        # trunnion bolt, selector, forward bracket that carries the shroud
        p.cyl('F', 0.17, 0.1, (sx * 0.42, -1.55, 0.86), axis='X', n=10)
        p.box('T', (0.12, 0.24, 0.05), (sx * 0.45, -1.55, 0.86), (rad(35), 0, 0), bv=0.0)
        p.box('B', (0.1, 1.05, 0.8), (sx * 0.43, 1.62, 1.04), bv=0.03)
        p.bolts('F', [(sx * 0.48, 1.3, 1.3), (sx * 0.48, 1.3, 0.78), (sx * 0.48, 1.95, 1.3), (sx * 0.48, 1.95, 0.78)], (sx, 0, 0), r=0.06)
    # vent on the deck behind the sight, charging lug on the right
    p.box('T', (0.44, 0.9, 0.06), (0, 1.15, 1.64), bv=0.0)
    for i in range(4):
        p.box('F', (0.44, 0.06, 0.08), (0, 0.82 + i * 0.22, 1.66), bv=0.0)
    p.box('F', (0.16, 0.34, 0.14), (0.46, 0.75, 1.42), bv=0.02)
    p.cyl('F', 0.08, 0.3, (0.58, 0.75, 1.42), axis='X', n=6)
    # ---- cell pack ahead of the trigger guard ----
    p.box('B', (0.9, 1.5, 0.26), (0, 1.62, 0.44), bv=0.04)
    p.box('A', (0.8, 1.2, 1.0), (0, 1.7, -0.14), bv=0.07)
    p.box('F', (0.66, 1.02, 0.16), (0, 1.7, -0.68), bv=0.03)
    p.box('C', (0.84, 0.16, 0.7), (0, 2.12, -0.14), bv=0.0)
    for sx in (-1, 1):
        for i in range(3):
            p.box('T', (0.05, 0.62, 0.07), (sx * 0.4, 1.52, -0.36 + i * 0.2), bv=0.0)
        p.bolts('F', [(sx * 0.46, 1.1, 0.44), (sx * 0.46, 2.14, 0.44)], (sx, 0, 0), r=0.06)
    p.box('F', (0.3, 0.2, 0.3), (0, 1.02, 0.2), bv=0.03)                        # pack release
    # ---- stock: neck, armour box, stepped butt pad ----
    p.prism('W', [(-1.9, 1.3), (-2.5, 1.3), (-2.5, 0.62), (-1.9, 0.62)], 0.5, 'YZ', bv=0.04)
    p.prism('A', [(-2.3, 1.56), (-4.05, 1.56), (-4.05, 0.3), (-3.45, 0.3), (-2.75, 0.6), (-2.3, 0.6)], 0.7, 'YZ', bv=0.06)
    p.box('F', (0.82, 0.42, 1.5), (0, -4.22, 0.83), bv=0.08)
    p.box('T', (0.7, 0.1, 1.3), (0, -4.46, 0.83), bv=0.03)
    p.box('B', (0.5, 1.3, 0.14), (0, -3.1, 1.6), bv=0.03)                       # cheek rest
    p.cyl('F', 0.16, 0.78, (0, -3.55, 0.6), axis='X', n=8)                     # sling pin
    for sx in (-1, 1):
        p.hatch((sx * 0.355, -3.2, 1.12), (sx, 0, 0), (0, 0, 1), 1.1, 0.5, bolts=False)
        p.box('T', (0.05, 0.3, 0.14), (sx * 0.35, -2.75, 0.84), bv=0.0)
        p.bolt('F', (sx * 0.36, -2.55, 1.36), (sx, 0, 0), r=0.07)
    # ---- sight: tube on two rings, wide objective, lens looking down the barrel ----
    zs = 2.16
    p.box('B', (0.32, 2.0, 0.12), (0, -0.35, 1.7), bv=0.02)
    for y in (-0.95, 0.15):
        p.box('F', (0.2, 0.26, 0.3), (0, y, 1.84), bv=0.02)
        p.cyl('F', 0.33, 0.24, (0, y, zs), axis='Y', n=12)
    p.cyl('W', 0.27, 1.9, (0, -0.4, zs), axis='Y', n=12)
    p.cyl('W', 0.3, 0.5, (0, 0.8, zs), axis='Y', n=12, r2=0.42)
    p.cyl('W', 0.42, 0.3, (0, 1.2, zs), axis='Y', n=12)
    p.cyl('T', 0.36, 0.06, (0, 1.36, zs), axis='Y', n=12)
    p.cyl('G', 0.3, 0.04, (0, 1.38, zs), axis='Y', n=12)
    p.cyl('F', 0.34, 0.34, (0, -1.5, zs), axis='Y', n=12)                      # eyepiece
    p.cyl('T', 0.26, 0.05, (0, -1.69, zs), axis='Y', n=12)
    p.cyl('F', 0.13, 0.2, (0, -0.4, zs + 0.34), axis='Z', n=8)                 # elevation drum
    p.cyl('F', 0.13, 0.2, (0.34, -0.4, zs), axis='X', n=8)                     # windage drum
    p.box('B', (0.2, 0.7, 0.16), (-0.3, 0.3, zs + 0.2), (0, rad(-40), 0), bv=0.02)   # range sensor on the left
    p.cyl('G', 0.06, 0.04, (-0.37, 0.66, zs + 0.27), axis='Y', n=6)
    # ---- barrel shroud: armour shell, two long slots a side, three clamp bands ----
    y0, y1 = 2.25, 6.9
    p.tube('A', [S(y0, 0.47, 0.5, 0.17, cv=z), S(y1, 0.43, 0.45, 0.16, cv=z)], axis='Y')
    for y, hu, hv in ((y0 + 0.12, 0.51, 0.54), (4.55, 0.49, 0.515), (y1 - 0.1, 0.47, 0.49)):
        p.tube('B', [S(y - 0.11, hu, hv, 0.17, cv=z), S(y + 0.11, hu, hv, 0.17, cv=z)], axis='Y')
    for sx in (-1, 1):
        for a, b in ((2.75, 4.2), (4.9, 6.45)):
            p.line('T', (sx * 0.455, a, z + 0.04), (sx * 0.44, b, z + 0.04), (sx, 0, 0), w=0.27)
            p.line('F', (sx * 0.46, a + 0.1, z + 0.04), (sx * 0.445, b - 0.1, z + 0.04), (sx, 0, 0), w=0.08)
    p.box('B', (0.34, 3.9, 0.08), (0, 4.5, z + 0.5), bv=0.02)                   # top strip
    for y in (2.9, 3.6, 5.3, 6.0):
        p.box('T', (0.22, 0.3, 0.03), (0, y, z + 0.545), bv=0.0)
    # front sight: a raked blade between two ears
    p.prism('F', [(6.4, z + 0.44), (6.85, z + 0.44), (6.77, z + 0.86), (6.63, z + 0.86)], 0.1, 'YZ', bv=0.0)
    for sx in (-1, 1):
        p.prism('B', [(6.35, z + 0.44), (6.9, z + 0.44), (6.85, z + 0.7), (6.55, z + 0.7)], 0.06, 'YZ', pos=(sx * 0.16, 0, 0), bv=0.0)
    # ---- radiator slung under the shroud: what lets the gun shed a burst's heat ----
    zr = 0.3
    p.box('F', (0.26, 3.1, 0.2), (0, 5.1, zr), bv=0.04)
    for i in range(11):
        p.box('W', (0.62, 0.07, 0.4), (0, 3.85 + i * 0.25, zr), bv=0.0)
    p.box('B', (0.5, 0.3, 0.34), (0, 3.5, zr + 0.06), bv=0.04)
    p.box('B', (0.42, 0.22, 0.3), (0, 6.68, zr + 0.04), bv=0.04)
    for y in (3.5, 6.68):
        p.box('F', (0.2, 0.2, 0.26), (0, y, zr + 0.3), bv=0.02)
    for sx in (-1, 1):
        p.rod('F', (sx * 0.2, 2.5, 0.52), (sx * 0.2, 3.4, zr + 0.04), 0.05, n=5)       # coolant lines from the pack
    # ---- barrel and emitter ----
    p.cyl('W', 0.25, 0.75, (0, 7.25, z), axis='Y', n=12)
    for y in (7.07, 7.27):
        p.cyl('F', 0.3, 0.08, (0, y, z), axis='Y', n=12)
    # flared bell (profile runs along the barrel: r, y)
    p.lathe('W', [(0.0, 0.0), (0.26, 0.0), (0.3, 0.14), (0.47, 0.6), (0.47, 0.68), (0.37, 0.68), (0.2, 0.26), (0.0, 0.26)],
            (0, 7.6, z), axis='Y', n=12)
    p.cyl('G', 0.17, 0.05, (0, 7.89, z), axis='Y', n=10)
    for k in range(3):
        a = pi / 2 + k * 2 * pi / 3
        p.box('F', (0.07, 0.5, 0.12), (0.42 * cos(a), 7.95, z + 0.42 * sin(a)), (0, -a + pi / 2, 0), bv=0.0)
    muzzle('g_bmg', (0, 8.33, z))


ITEMS = {'g_bmg': ['g_bmg_muzzle']}


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = os.path.abspath(args[args.index('--out') + 1]) if '--out' in args else OUT
    reset_scene()
    g_bmg()
    bake_colors(R, ground=False, flat_dust=0.1, maxd=1.6)
    for j in R.joints.values():
        if j.parent is None:
            j.local = I4.copy()
    build_objects(R)
    os.makedirs(out, exist_ok=True)
    export_glb(os.path.join(out, 'equip_b.glb'))
    per = {}
    for (jn, mat), b in R.bufs.items():
        top = jn
        while R.joints[top].parent is not None:
            top = R.joints[top].parent.name
        per[top] = per.get(top, 0) + sum(len(f) - 2 for f in b['f'])
    print('BUILD equip_b', json.dumps(dict(tris=R.tris, joints=len(R.joints), meshes=len(R.bufs), per_item=per)))


if __name__ == '__main__':
    main()
