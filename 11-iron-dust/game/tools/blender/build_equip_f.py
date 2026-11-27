# build_equip_f.py -- generates equip_f.glb: new equipment for the friendly frames (IRON DUST). Original designs.
# Run:  blender -b --factory-startup -P build_equip_f.py -- [--out <dir>]
# Conventions are those of build_equip.py (whose helpers are imported, the file itself is not modified):
#   hand guns   +Y = barrel / front (glTF -Z), +Z = top, grip at the origin, child marker <item>_muzzle
#   arm items   mount_arm_L (shield hard-point): body toward -X (outboard of the left arm), forearm axis = Z, hand at -Z
#   melee       mount_blade_L like m_pile: body behind the forearm (-Y), working end toward -Z
#   shields     root + <item>_core / _upper / _lower pieces, plate faces -X, origin at the arm bracket
import bpy, sys, os, json
from math import radians as rad, sin, cos, pi
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
from mk_geo import S, xf, I4, reset_scene, bake_colors, build_objects, export_glb
import build_equip as be
from build_equip import R, item, muzzle, grip, slots
import build_mechs

OUT = build_mechs.OUT          # tools/blender/out unless --out / MK_OUT says otherwise


def hose(p, pts, r=0.1, mat='F', n=6, rings=None):
    for a, b in zip(pts, pts[1:]):
        p.rod(mat, a, b, r, n=n)
    for a in pts[1:-1]:
        p.ball(mat, r * 1.08, a, n=n, m=3)
    if rings:
        for a, b in zip(pts, pts[1:]):
            mid = tuple((a[i] + b[i]) / 2 for i in range(3))
            d = tuple(b[i] - a[i] for i in range(3))
            L = max(1e-6, sum(c * c for c in d) ** 0.5)
            u = tuple(c / L for c in d)
            p.rod(rings, tuple(mid[i] - u[i] * 0.09 for i in range(3)), tuple(mid[i] + u[i] * 0.09 for i in range(3)), r * 1.3, n=n)


# ============================== hand weapons ==============================
def g_sniper():
    """Very long-barrel sniper rifle: big optic + rangefinder, armoured action, folded bipod, two-chamber brake."""
    p = item('g_sniper')
    grip(p)
    z = 0.98
    # receiver + armoured action cover
    p.tube('W', [S(-1.9, 0.36, 0.5, 0.12, cv=z), S(2.3, 0.36, 0.5, 0.12, cv=z)], axis='Y', grooves=[0.9])
    p.box('B', (0.82, 1.5, 0.6), (0, -0.55, z - 0.02), bv=0.05)
    p.bolts('F', [(0.42, -1.1, z), (0.42, 0.0, z), (-0.42, -1.1, z), (-0.42, 0.0, z)], (1, 0, 0), r=0.055)
    p.box('T', (0.06, 0.7, 0.22), (0.39, 1.4, z + 0.12), bv=0.0)
    p.cyl('F', 0.07, 0.34, (0.5, 0.6, z + 0.2), axis='X', n=6)
    # box magazine ahead of the trigger guard
    p.box('F', (0.42, 0.8, 1.25), (0, 1.5, -0.02), (rad(-8), 0, 0), bv=0.04)
    p.box('B', (0.46, 0.84, 0.16), (0, 1.58, -0.6), (rad(-8), 0, 0), bv=0.02)
    # skeleton stock, cheek rest, butt pad, folded rear monopod
    p.prism('W', [(-1.9, 1.45), (-3.5, 1.4), (-3.5, 0.2), (-3.1, 0.15), (-2.7, 0.78), (-1.9, 0.6)], 0.46, 'YZ', bv=0.05)
    p.box('T', (0.52, 0.14, 1.3), (0, -3.55, 0.8), bv=0.02)
    p.box('B', (0.52, 1.1, 0.2), (0, -2.5, 1.5), bv=0.035)
    p.rod('F', (0, -3.1, 0.2), (0, -2.25, 0.4), 0.07, n=5)
    p.box('F', (0.2, 0.2, 0.14), (0, -2.2, 0.42), bv=0.0)
    # barrel shroud with cooling slots, long free-floating barrel, bands
    p.tube('W', [S(2.3, 0.44, 0.5, 0.14, cv=z), S(5.3, 0.36, 0.4, 0.12, cv=z)], axis='Y')
    slots(p, 0.41, 2.6, 5.0, z, n=5, h=0.16)
    p.box('B', (0.5, 2.4, 0.1), (0, 3.8, z + 0.48), bv=0.02)
    p.cyl('T', 0.17, 4.5, (0, 7.5, z), axis='Y', n=10)
    for y in (5.9, 7.3, 8.7):
        p.cyl('F', 0.24, 0.22, (0, y, z), axis='Y', n=10)
    p.cyl('W', 0.25, 0.9, (0, 9.3, z), axis='Y', n=10)
    # two-chamber muzzle brake
    p.tube('W', [S(9.7, 0.3, 0.26, 0.08, cv=z), S(10.6, 0.36, 0.3, 0.08, cv=z)], axis='Y', bv=0.02)
    for y in (9.95, 10.3):
        p.box('T', (0.78, 0.17, 0.22), (0, y, z), bv=0.0)
    p.cyl('T', 0.19, 0.06, (0, 10.62, z), axis='Y', n=10)
    # optic: long tube, objective bell with lens, eyepiece, mounts on a rail
    zs = 2.0
    p.box('F', (0.24, 2.7, 0.1), (0, 0.3, 1.52), bv=0.02)
    for y in (-0.5, 1.0):
        p.box('F', (0.22, 0.3, 0.5), (0, y, 1.68), bv=0.02)
    p.cyl('W', 0.29, 2.7, (0, 0.3, zs), axis='Y', n=12)
    p.cyl('W', 0.4, 0.74, (0, 1.95, zs), axis='Y', n=12, bv=0.03)
    p.cyl('T', 0.34, 0.06, (0, 2.33, zs), axis='Y', n=12)
    p.dome('G', 0.3, 0.08, (0, 2.35, zs), axis='Y', n=12, m=2)
    p.cyl('F', 0.24, 0.34, (0, -1.2, zs), axis='Y', n=10)
    p.cyl('B', 0.34, 0.3, (0, 0.2, zs), axis='Y', n=12, bv=0.02)
    p.cyl('F', 0.1, 0.2, (0, 0.2, zs + 0.38), n=6)
    # rangefinder / sensor block on the right of the optic, data cable
    p.box('B', (0.38, 1.0, 0.42), (0.52, 1.0, zs - 0.12), bv=0.04)
    p.cyl('T', 0.13, 0.05, (0.52, 1.51, zs - 0.12), axis='Y', n=8)
    p.dome('G', 0.1, 0.03, (0.52, 1.53, zs - 0.12), axis='Y', n=8, m=2)
    hose(p, [(0.52, 0.5, zs - 0.2), (0.56, 0.1, 1.5), (0.42, -0.3, 1.2)], 0.05, n=5)
    p.box('C', (0.84, 0.3, 0.1), (0, -1.6, 1.3), bv=0.0)
    # folded bipod under the shroud
    p.box('F', (0.5, 0.44, 0.3), (0, 4.8, 0.52), bv=0.03)
    for s_ in (-1, 1):
        p.rod('F', (s_ * 0.26, 4.8, 0.46), (s_ * 0.36, 7.2, 0.56), 0.07, n=5)
        p.rod('F', (s_ * 0.36, 7.2, 0.56), (s_ * 0.36, 7.9, 0.56), 0.05, n=5)
        p.box('F', (0.16, 0.34, 0.22), (s_ * 0.36, 8.0, 0.56), bv=0.02)
    p.box('F', (0.9, 0.14, 0.14), (0, 6.2, 0.6), bv=0.0)
    p.rod('F', (0, 6.2, 0.62), (0, 6.2, z - 0.1), 0.05, n=4)
    muzzle('g_sniper', (0, 10.7, z))


def g_cbeam():
    """Cable-fed heavy beam rifle: capacitor drum under the fore-end, ringed emitter, armoured cable stub at the stock."""
    p = item('g_cbeam')
    grip(p)
    z = 1.12
    # main housing
    p.tube('W', [S(-2.2, 0.5, 0.56, 0.18, cv=z), S(-1.8, 0.64, 0.74, 0.2, cv=z), S(2.2, 0.64, 0.74, 0.2, cv=z), S(2.6, 0.5, 0.56, 0.18, cv=z)],
           axis='Y', grooves=[0.2])
    p.box('B', (1.4, 2.2, 0.3), (0, -0.4, z + 0.76), bv=0.05, ty=0.86)
    for i in range(6):
        p.box('F', (1.46, 0.07, 0.22), (0, -1.2 + i * 0.32, z + 0.82), bv=0.0)
    for s_ in (-1, 1):
        p.box('B', (0.12, 2.0, 0.7), (s_ * 0.66, -0.5, z + 0.05), bv=0.04)
        p.bolts('F', [(s_ * 0.72, -1.3, z + 0.05), (s_ * 0.72, 0.3, z + 0.05)], (s_, 0, 0), r=0.065)
        for i in range(4):
            p.line('T', (s_ * 0.645, 1.0 + i * 0.26, z - 0.3), (s_ * 0.645, 1.0 + i * 0.26, z + 0.3), (s_, 0, 0), w=0.1)
    # capacitor drum under the fore-end
    dy, dz = 1.5, 0.1
    p.cyl('B', 0.82, 1.3, (0, dy, dz), axis='X', n=14, bv=0.04)
    for s_ in (-1, 1):
        p.cyl('F', 0.9, 0.14, (s_ * 0.4, dy, dz), axis='X', n=14)
        p.cyl('F', 0.3, 0.12, (s_ * 0.7, dy, dz), axis='X', n=8)
        p.cyl('G', 0.16, 0.05, (s_ * 0.76, dy, dz), axis='X', n=8)
    p.box('F', (0.6, 0.7, 0.4), (0, dy, 0.62), bv=0.04)
    p.box('H', (1.0, 0.3, 0.06), (0, dy + 0.5, dz + 0.72), (rad(34), 0, 0), bv=0.0)
    # emitter: focusing rings, lens, three field prongs
    p.cyl('T', 0.32, 3.0, (0, 4.0, z), axis='Y', n=12)
    for i in range(4):
        p.cyl('W', 0.5 - i * 0.03, 0.26, (0, 2.9 + i * 0.62, z), axis='Y', n=12, bv=0.025)
    p.lathe('W', [(0.0, 0.0), (0.4, 0.0), (0.56, 0.5), (0.44, 0.54), (0.34, 0.2), (0.0, 0.2)], (0, 5.2, z), axis='Y', n=12)
    p.dome('G', 0.3, 0.12, (0, 5.4, z), axis='Y', n=12, m=2)
    for i in range(3):
        a = pi / 2 + i * 2 * pi / 3
        p.rod('F', (cos(a) * 0.62, 2.7, z + sin(a) * 0.62), (cos(a) * 0.52, 5.9, z + sin(a) * 0.52), 0.07, n=5)
        p.box('F', (0.18, 0.2, 0.18), (cos(a) * 0.52, 5.95, z + sin(a) * 0.52), bv=0.0)
    # sight unit + carry handle
    p.box('W', (0.4, 1.0, 0.44), (0.42, 1.2, z + 0.98), bv=0.05)
    p.cyl('T', 0.15, 0.05, (0.42, 1.71, z + 1.0), axis='Y', n=8)
    p.dome('G', 0.12, 0.04, (0.42, 1.73, z + 1.0), axis='Y', n=8, m=2)
    p.rod('F', (-0.3, -1.0, z + 0.9), (-0.3, -0.8, z + 1.4), 0.07, n=5)
    p.rod('F', (-0.3, 0.6, z + 0.9), (-0.3, 0.4, z + 1.4), 0.07, n=5)
    p.rod('F', (-0.3, -0.85, z + 1.4), (-0.3, 0.45, z + 1.4), 0.1, n=6)
    # stock block with the armoured power-cable stub (plugs into the frame's pack)
    p.box('B', (0.9, 0.6, 1.0), (0, -2.5, z - 0.05), bv=0.06)
    p.box('T', (0.7, 0.12, 0.9), (0, -2.86, z - 0.05), bv=0.02)
    p.cyl('F', 0.34, 0.3, (0.0, -2.5, z + 0.6), n=10)
    hose(p, [(0.0, -2.5, z + 0.7), (0.12, -2.75, z + 1.25), (0.4, -3.3, z + 1.55), (0.72, -3.95, z + 1.5)], 0.2, n=8, rings='B')
    p.rod('F', (0.72, -3.95, z + 1.5), (0.84, -4.2, z + 1.46), 0.27, n=8)
    p.rod('T', (0.84, -4.2, z + 1.46), (0.86, -4.25, z + 1.455), 0.18, n=8)
    p.box('C', (0.94, 0.26, 0.12), (0, -2.5, z - 0.6), bv=0.0)
    muzzle('g_cbeam', (0, 6.05, z))


# ============================== wire anchor ==============================
def h_anchor():
    """Forearm wire-anchor launcher (mounts on mount_arm_L): winch drum, launch tube along the forearm toward the hand."""
    p = item('h_anchor')
    xc = -0.82
    # bracket on the hard-point
    p.box('F', (0.4, 0.9, 1.3), (-0.2, 0, 0), bv=0.05)
    p.cyl('F', 0.34, 0.14, (-0.05, 0, 0), axis='X', n=10)
    # armoured housing along the forearm
    p.tube('W', [S(-1.5, 0.4, 0.5, 0.14, xc, 0.0), S(-1.1, 0.5, 0.62, 0.16, xc, 0.0), S(0.5, 0.5, 0.62, 0.16, xc, 0.0), S(0.8, 0.42, 0.5, 0.14, xc, 0.0)],
           bv=0.04)
    p.box('B', (0.14, 0.9, 1.2), (xc - 0.5, 0, -0.3), bv=0.045, by=0.8)
    p.bolts('F', [(xc - 0.57, 0.3, 0.1), (xc - 0.57, -0.3, 0.1), (xc - 0.57, 0.3, -0.7), (xc - 0.57, -0.3, -0.7)], (-1, 0, 0), r=0.055)
    p.box('H', (0.1, 0.94, 0.14), (xc - 0.5, 0, -1.0), bv=0.0)
    # winch drum with wound cable (elbow end)
    p.cyl('F', 0.3, 1.36, (xc, 0, 1.3), axis='Y', n=10)
    p.cyl('T', 0.5, 0.86, (xc, 0, 1.3), axis='Y', n=12)
    for s_ in (-1, 1):
        p.cyl('B', 0.62, 0.12, (xc, s_ * 0.5, 1.3), axis='Y', n=12, bv=0.025)
        p.box('F', (0.3, 0.14, 0.7), (xc, s_ * 0.62, 0.9), bv=0.03)
    p.cyl('C', 0.2, 0.1, (xc, 0.72, 1.3), axis='Y', n=8)
    # launch tube + three guide rails, gas bottle
    zt = -2.3
    p.cyl('W', 0.36, 1.0, (xc, 0, -1.9), n=12, bv=0.03)
    p.cyl('F', 0.42, 0.16, (xc, 0, -1.5), n=12)
    p.cyl('F', 0.42, 0.14, (xc, 0, zt - 0.03), n=12)
    p.cyl('T', 0.28, 0.06, (xc, 0, zt - 0.1), n=12)
    for i in range(3):
        a = pi / 2 + i * 2 * pi / 3
        p.rod('F', (xc + cos(a) * 0.4, sin(a) * 0.4, -1.5), (xc + cos(a) * 0.34, sin(a) * 0.34, zt - 0.36), 0.05, n=4)
    p.cyl('C', 0.2, 1.1, (xc + 0.06, -0.66, -0.5), n=8)
    p.dome('C', 0.2, 0.14, (xc + 0.06, -0.66, 0.05), n=8, m=2)
    p.rod('F', (xc + 0.06, -0.66, -1.05), (xc, -0.3, -1.5), 0.06, n=5)
    # wire guide from the drum into the tube
    p.rod('T', (xc - 0.2, 0, 0.9), (xc - 0.1, 0, 0.7), 0.05, n=4)
    R.joint('h_anchor_muzzle', 'h_anchor', (xc, 0, zt - 0.2))


def h_hook():
    """Wire-anchor hook head: three-prong claw, ~1.2 m. Origin at the tail (wire eye), pointing +Y like a gun barrel."""
    p = item('h_hook')
    p.cyl('F', 0.09, 0.14, (0, 0.05, 0), axis='X', n=8)                       # wire eye
    p.lathe('W', [(0.0, 0.08), (0.1, 0.08), (0.16, 0.2), (0.16, 0.5), (0.22, 0.56), (0.22, 0.7), (0.12, 0.82), (0.0, 0.84)], axis='Y', n=9)
    p.cyl('H', 0.18, 0.1, (0, 0.34, 0), axis='Y', n=9)
    p.lathe('W', [(0.0, 0.82), (0.07, 0.84), (0.05, 1.12), (0.0, 1.22)], axis='Y', n=6)       # centre spike
    for i in range(3):
        a = pi / 2 + i * 2 * pi / 3
        q = p.at(rot=(0, a - pi / 2, 0))
        # claw prong in the local YZ plane: sweeps out from the hub, hooks forward and back in
        q.prism('W', [(0.5, 0.14), (0.72, 0.2), (0.9, 0.44), (1.08, 0.5), (1.22, 0.36), (1.0, 0.3), (0.88, 0.24), (0.66, 0.06), (0.46, 0.04)],
                0.11, 'YZ', bv=0.02)
        q.box('F', (0.14, 0.14, 0.12), (0, 0.6, 0.2), bv=0.0)


# ============================== melee ==============================
def m_lance():
    """Thermal lance: long shaft with a three-emitter head, forearm clamp housing. Same mount / axes as m_pile."""
    p = item('m_lance')
    yc = -0.86
    # forearm clamp housing + bracket
    p.tube('W', [S(-1.2, 0.5, 0.46, 0.16, cv=yc), S(-0.9, 0.62, 0.56, 0.18, cv=yc), S(1.3, 0.62, 0.56, 0.18, cv=yc), S(1.6, 0.5, 0.46, 0.16, cv=yc)],
           grooves=[0.2])
    p.tube('H', [S(0.7, 0.64, 0.58, 0.18, cv=yc), S(1.0, 0.64, 0.58, 0.18, cv=yc)])
    p.box('F', (0.8, 0.3, 1.6), (0, -0.1, 0.4), bv=0.04)
    p.hatch((0, yc - 0.565, 0.0), (0, -1, 0), (0, 0, 1), 0.8, 0.9)
    for s_ in (-1, 1):
        p.cyl('F', 0.2, 2.0, (s_ * 0.72, yc, 0.2), n=8)
        p.cyl('B', 0.24, 0.2, (s_ * 0.72, yc, 0.9), n=8)
        p.line('T', (s_ * 0.625, yc - 0.3, -0.5), (s_ * 0.625, yc + 0.3, -0.5), (s_, 0, 0), w=0.18)
    # shaft, butt weight, collars
    p.cyl('F', 0.15, 9.2, (0, yc, -1.2), n=8)
    p.cyl('B', 0.3, 0.6, (0, yc, 3.3), n=10, bv=0.04)
    p.cyl('F', 0.2, 0.16, (0, yc, 3.66), n=8)
    for zz in (2.2, -1.9, -3.3, -4.7):
        p.cyl('W', 0.23, 0.3, (0, yc, zz), n=8)
    p.cyl('C', 0.2, 0.5, (0, yc, -2.6), n=8)
    # head: manifold block and three parallel emitters (tip at z = -8.3: clears the ground with the arm hanging)
    zh = -5.8
    p.lathe('W', [(0.0, 0.0), (0.2, 0.0), (0.5, -0.3), (0.56, -0.8), (0.44, -0.9), (0.0, -0.9)][::-1], (0, yc, zh), n=6, ph=pi / 6)
    p.cyl('B', 0.6, 0.16, (0, yc, zh - 0.55), n=6, ph=pi / 6)
    for i in range(3):
        a = pi / 2 + i * 2 * pi / 3
        ex, ey = cos(a) * 0.3, yc + sin(a) * 0.3
        p.cyl('W', 0.2, 0.36, (ex, ey, zh - 1.02), n=8)
        p.cyl('K', 0.15, 1.1, (ex, ey, zh - 1.7), n=8, r2=0.17)
        p.cyl('W', 0.19, 0.14, (ex, ey, zh - 1.75), n=8)
        p.lathe('K', [(0.0, -0.26), (0.11, -0.08), (0.15, 0.0), (0.0, 0.0)], (ex, ey, zh - 2.25), n=8)
    p.rod('F', (0, yc, zh - 0.9), (0, yc, zh - 1.9), 0.06, n=5)


# ============================== shield ==============================
def curved_plate(p, mat, y0, y1, zfun, xs, th, bulge, hw, yo, n=10, bv=0.05, off=0.0):
    """Strip curved about Z, convex toward -X: x = xs - bulge * (1 - (y / hw)^2) - off. zfun(y) -> (z low, z high)."""
    rings = []
    for i in range(n + 1):
        y = y0 + (y1 - y0) * i / n
        x = xs - bulge * (1 - (y / hw) ** 2) - off
        zl, zh = zfun(y)
        rings.append([(x - th / 2, y + yo, zl), (x + th / 2, y + yo, zl), (x + th / 2, y + yo, zh), (x - th / 2, y + yo, zh)])
    p._rings(mat, rings, None, bv)


def s_guard():
    """Large curved guard shield: three break-away pieces wrapping the left side."""
    name = 's_guard'
    R.joint(name, None, (be._n[0] * be.SPACING, 0, 0))
    be._n[0] += 1
    th, hw, bulge, yo = 0.36, 2.7, 1.0, 0.3
    xs = -0.5 - th / 2
    gap = 0.05

    def surf(y):
        return xs - bulge * (1 - (y / hw) ** 2) - th / 2

    zf = {
        'upper': lambda y: (1.45 + gap, 4.1 - 1.2 * abs(y / hw) ** 2.6),
        'core': lambda y: (-1.45 + gap, 1.45 - gap),
        'lower': lambda y: (-4.7 + 1.5 * abs(y / hw) ** 2.0, -1.45 - gap),
    }
    for key, jz in (('core', 0.0), ('upper', 1.5), ('lower', -1.5)):
        jn = '%s_%s' % (name, key)
        jp = (0, 0, 0) if key == 'core' else (xs, yo, jz)
        R.joint(jn, name, jp)
        p = R.pen(jn).at((-jp[0], -jp[1], -jp[2]))
        f = zf[key]
        curved_plate(p, 'A', -hw, hw, f, xs, th, bulge, hw, yo, n=12, bv=0.06)
        # raised centre band and two flank strakes (second layer)
        zl0, zh0 = f(0.0)
        curved_plate(p, 'B', -0.8, 0.8, lambda y: (zl0 + 0.18, zh0 - 0.18), xs, 0.12, bulge, hw, yo, n=4, bv=0.035, off=th / 2 + 0.03)
        for s_ in (-1, 1):
            ya, yb = s_ * 1.5, s_ * 2.3
            zla, zha = f(yb)
            curved_plate(p, 'B', min(ya, yb), max(ya, yb), lambda y: (zla + 0.3, zha - 0.3), xs, 0.1, bulge, hw, yo, n=3, bv=0.03, off=th / 2 + 0.02)
            for zz in (zla + 0.16, zha - 0.16):
                p.bolt('F', (surf(s_ * 2.45), s_ * 2.45 + yo, zz), (-1, s_ * 0.6, 0), r=0.08)
        # inner frame rib
        curved_plate(p, 'F', -1.9, 1.9, lambda y: ((zl0 + zh0) / 2 - 0.22, (zl0 + zh0) / 2 + 0.22), xs, 0.14, bulge, hw, yo, n=6, bv=0.0, off=-(th / 2 + 0.05))
        if key == 'core':
            p.cyl('C', 0.5, 0.16, (surf(0.0) - 0.14, yo, 0.0), axis='X', n=10, bv=0.03)
            p.cyl('T', 0.26, 0.06, (surf(0.0) - 0.23, yo, 0.0), axis='X', n=10)
            p.box('F', (0.4, 1.0, 1.3), (-0.2, 0, 0), bv=0.05)
            p.cyl('F', 0.34, 0.14, (-0.05, 0, 0), axis='X', n=10)
            for s_ in (-1, 1):
                p.rod('F', (-0.3, 0.3 * s_, 0.5 * s_), (xs - 0.5, yo + 0.9 * s_, 0.9 * s_), 0.09, n=5)
                p.handhold('F', (xs - bulge * 0.55 + 0.5, yo + s_ * 1.5, 0.0), (0, 0, pi / 2), w=0.8, h=0.16)
        if key == 'upper':
            p.box('T', (0.12, 1.3, 0.2), (surf(0.0) - 0.1, yo, 3.5), bv=0.0)            # vision slot
            p.box('G', (0.06, 0.5, 0.07), (surf(0.0) - 0.15, yo, 3.5), bv=0.0)
        if key == 'lower':
            for s_ in (-1, 1):
                p.box('H', (0.1, 0.8, 0.3), (surf(s_ * 0.5) - 0.03, yo + s_ * 0.5, -3.75), (0, 0, s_ * -0.2), bv=0.0)
            p.box('F', (0.3, 0.5, 0.5), (xs - bulge + 0.4, yo, -4.35), bv=0.04)             # ground spike block


# =========================================================================
def main():
    reset_scene()
    for fn in (g_sniper, g_cbeam, h_anchor, h_hook, m_lance, s_guard):
        fn()
    bake_colors(R, ground=False, flat_dust=0.1, maxd=1.6)
    for j in R.joints.values():
        if j.parent is None:
            j.local = I4.copy()
    build_objects(R)
    os.makedirs(OUT, exist_ok=True)
    export_glb(os.path.join(OUT, 'equip_f.glb'))
    per = {}
    for (jn, mat), b in R.bufs.items():
        top = jn
        while R.joints[top].parent is not None:
            top = R.joints[top].parent.name
        per[top] = per.get(top, 0) + sum(len(f) - 2 for f in b['f'])
    print('BUILD equip_f', json.dumps(dict(out=OUT, tris=R.tris, joints=len(R.joints), meshes=len(R.bufs), per_item=per)))


if __name__ == '__main__':
    main()
