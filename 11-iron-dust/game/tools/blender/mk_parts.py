# mk_parts.py -- parametric tactical-frame part library (IRON DUST, friendly "TF" frames). Original designs.
# Blender authoring space: +Z up, +Y front, +X = mech's right. Parts are authored for the right
# side and mirrored for the left.
#
# Style keys:  leg   std | heavy | slim | flare        chest  slab | keel
#              head  visor | turret | cluster | scope   sh     block | heavy | slim | cap
#              back  twin | heavy | wing | tank
# Material keys: A/B/C armour colours, F frame, T dark recess, G glow, H hazard, W weapon metal.
# Armour plates carry real bevels (bv) so mk_geo.bake_colors can mark their edges for paint wear.
import random
import bmesh
from math import radians as rad, sin, cos, pi, atan2
from mathutils import Vector
from mk_geo import Rig, S, xf, frame_m


def sfx(s):
    return 'R' if s > 0 else 'L'


# =============================================================================================
# shared detail helpers
# =============================================================================================
def spts(pts, k, kz=None, c=None):
    """Scale a 2D outline about its centroid (or c)."""
    n = len(pts)
    if c is None:
        c = (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
    kz = k if kz is None else kz
    return [(c[0] + (a - c[0]) * k, c[1] + (b - c[1]) * kz) for a, b in pts]


def hose(p, pts, r=0.06, mat='F', n=5):
    """Cable / hydraulic line through a list of points."""
    for a, b in zip(pts, pts[1:]):
        p.rod(mat, a, b, r, n=n)
    for a in pts[1:-1]:
        p.ball(mat, r * 1.08, a, n=n, m=3)


def lens(p, pos, r, d=0.24, rim='F', g='G', n=12, rot=(0, 0, 0)):
    """Round sensor facing local +Y: rim barrel, dark throat, glowing glass."""
    q = p.at(pos, rot)
    q.cyl(rim, r * 1.3, d, (0, 0, 0), axis='Y', n=n, bv=0.02)
    q.cyl('T', r * 1.08, 0.05, (0, d / 2, 0), axis='Y', n=n)
    q.dome(g, r, r * 0.32, (0, d / 2 + 0.03, 0), axis='Y', n=n, m=2)


def jcap(p, mat, x, r, ix, y=0.0, z=0.0, h=0.15):
    """Round joint cover on a +-X face with a maintenance slot."""
    p.cyl(mat, r, h, (x, y, z), axis='X', n=12, bv=0.03)
    p.box('F', (0.08, r * 1.3, r * 0.26), (x + ix * h * 0.5, y, z), bv=0)


def nozzle(R, name, parent, pos=(0, 0, 0), rot=(0, 0, 0), r=0.5, length=None, mirror=False, n=12, mat='F', plug=True, M=None):
    """Thruster bell. Joint-local -Z (glTF -Y) is the exhaust direction; origin at exit-plane centre."""
    L = length if length else r * 1.5
    if M is not None:
        R.joint(name, parent, M=M, mirror=mirror)
    else:
        R.joint(name, parent, pos, rot, mirror)
    p = R.pen(name, mirror)
    p.lathe(mat, [(0.86 * r, 0.0), (r, 0.0), (1.0 * r, 0.1 * L), (0.93 * r, 0.36 * L), (0.68 * r, 0.8 * L), (0.6 * r, L), (0.0, L)], n=n)
    p.lathe(mat, [(0.99 * r, 0.1 * L), (1.08 * r, 0.1 * L), (1.08 * r, 0.2 * L), (0.97 * r, 0.22 * L)], n=n)
    p.lathe(mat, [(0.7 * r, 0.64 * L), (0.84 * r, 0.64 * L), (0.84 * r, 0.8 * L), (0.68 * r, 0.8 * L)], n=n)
    # small verniers (plug=False) keep one material: one draw call each instead of two
    p.lathe('T' if plug else mat, [(0.0, 0.66 * L), (0.42 * r, 0.66 * L), (0.86 * r, 0.0)], n=n)
    if plug:
        p.lathe(mat, [(0.0, 0.16 * L), (0.2 * r, 0.42 * L), (0.24 * r, 0.68 * L)], n=6)
        for i in range(3):
            a = i * 2 * pi / 3 + 0.5
            p.rod(mat, (cos(a) * 0.95 * r, sin(a) * 0.95 * r, 0.26 * L), (cos(a) * 0.74 * r, sin(a) * 0.74 * r, 0.98 * L), 0.05 * r + 0.015, n=4)
    return p


def vent(R, parent, pos, normal, down, w, h, mirror=False, flap='A', d=0.11):
    """Hinged overdrive flap (the game opens every vent_n node). Node-local (Blender): X hinge, +Y outward,
    flap toward -Z. Dark housing + glow strips stay on the parent joint; the flap is the vent node's only mesh."""
    R.vent_n += 1
    nm = 'vent_%d' % R.vent_n
    ya = Vector(normal).normalized()
    za = -Vector(down)
    za = (za - ya * za.dot(ya)).normalized()
    xa = ya.cross(za)
    M = frame_m(Vector(pos) + ya * d, xa, ya, za)
    st = R.pen(parent, mirror, M)
    st.box('T', (w, 0.03, h), (0, -d + 0.015, -h / 2), bv=0)
    rim = 0.05
    st.box('F', (w + rim, d - 0.03, rim), (0, -d / 2 - 0.015, 0.0), bv=0)
    st.box('F', (w + rim, d - 0.03, rim), (0, -d / 2 - 0.015, -h), bv=0)
    st.box('F', (rim, d - 0.03, h), (w / 2, -d / 2 - 0.015, -h / 2), bv=0)
    st.box('F', (rim, d - 0.03, h), (-w / 2, -d / 2 - 0.015, -h / 2), bv=0)
    ns = max(2, int(h / 0.16))
    for i in range(ns):
        z = -h * (i + 0.5) / ns
        st.box('G', (w * 0.82, 0.03, h / ns * 0.45), (0, -d + 0.045, z), bv=0)
    R.joint(nm, parent, M=M, mirror=mirror)
    fp = R.pen(nm, mirror)
    fp.box(flap, (w + 0.12, 0.06, h + 0.1), (0, 0.0, -h / 2 - 0.01), bv=0.02)
    fp.cyl(flap, 0.04, w * 0.8, (0, 0.0, 0.03), axis='X', n=6)
    return nm


# ---------------------------------------------------------------------------------------------
# aircraft-style surface language: stepped plates, dark seams, indicator lamps
# ---------------------------------------------------------------------------------------------
def face(p, pos, nrm, up=(0, 0, 1)):
    """Pen whose local +Y is the surface normal, +Z the 'up' direction on the surface, origin at pos."""
    ya = Vector(nrm).normalized()
    za = Vector(up)
    za = (za - ya * za.dot(ya)).normalized()
    xa = ya.cross(za)
    return p.rig.pen(p.joint, p.mirror, p.M @ frame_m(pos, xa, ya, za))


def _area2(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))


def _inset(pts, d):
    """Miter-offset a clockwise (x, z) outline inward by d."""
    n = len(pts)
    out = []
    for i in range(n):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
        e1 = Vector((b[0] - a[0], b[1] - a[1]))
        e2 = Vector((c[0] - b[0], c[1] - b[1]))
        if e1.length < 1e-9 or e2.length < 1e-9:
            out.append(b)
            continue
        e1.normalize()
        e2.normalize()
        n1 = Vector((e1.y, -e1.x))
        n2 = Vector((e2.y, -e2.x))
        k = d / max(0.35, 1.0 + n1.dot(n2))
        out.append((b[0] + (n1.x + n2.x) * k, b[1] + (n1.y + n2.y) * k))
    return out


def plate(q, mat, pts, th=0.09, bv=0.03, y0=0.0):
    """Armour plate on a surface (q = face pen, normal +Y): outline (x, z), bevelled rim, no hidden back face.
    The rim strips are narrow, so the bake marks them for edge wear."""
    pts = [p for i, p in enumerate(pts) if (Vector(p) - Vector(pts[i - 1])).length > 1e-5]
    if _area2(pts) > 0:
        pts = pts[::-1]
    n = len(pts)
    ins = _inset(pts, bv)
    v = [(x, y0, z) for x, z in pts] + [(x, y0 + th - bv, z) for x, z in pts] + [(x, y0 + th, z) for x, z in ins]
    f = [tuple(range(2 * n, 3 * n))]
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, n + j, n + i))
        f.append((n + i, n + j, 2 * n + j, 2 * n + i))
    q.emit(mat, v, f, None, 0.0, recalc=False)


def _step(x0, x1, zs, at, nw, nd):
    xc = x0 + (x1 - x0) * at
    s = abs(nd) * 0.6
    return [(x0, zs), (xc - nw / 2 - s, zs), (xc - nw / 2, zs - nd), (xc + nw / 2, zs - nd), (xc + nw / 2 + s, zs), (x1, zs)]


def stepped(q, mat, w, h, th=0.09, bv=0.03, zs=0.0, at=0.5, nw=None, nd=None, mat2=None, back='T', gap=0.08, cut=0.0, x=0.0, z=0.0):
    """Panel w x h on a surface (q = face pen), split by a seam that steps through a trapezoid tab:
    two bevelled plates over a dark backing, so the seam is a real, deep, dark groove."""
    nw = w * 0.3 if nw is None else nw
    nd = min(h * 0.16, 0.24) if nd is None else nd
    x0, x1, z0, z1 = x - w / 2, x + w / 2, z - h / 2, z + h / 2
    g = gap / 2
    seam = _step(x0, x1, z + zs, at, nw, nd)
    c = cut
    top = [(x0, z1 - c), (x0 + c, z1), (x1 - c, z1), (x1, z1 - c)] + [(sx, sz + g) for sx, sz in reversed(seam)]
    bot = [(sx, sz - g) for sx, sz in seam] + [(x1, z0 + c), (x1 - c, z0), (x0 + c, z0), (x0, z0 + c)]
    if back:
        q.box(back, (w - 0.05, 0.03, h - 0.05), (x, 0.012, z), bv=0)
    plate(q, mat, top, th, bv)
    plate(q, mat2 or mat, bot, th, bv)


def lamp(q, x=0.0, z=0.0, w=0.3, h=0.1, bezel='T', y=0.0):
    """Flush indicator / navigation lamp on a surface (q = face pen)."""
    if bezel:
        q.box(bezel, (w + 0.09, 0.04, h + 0.09), (x, y + 0.012, z), bv=0)
    q.box('G', (w, 0.04, h), (x, y + 0.04, z), bv=0)


def jline(q, x0, x1, z, at=0.5, nw=0.3, nd=0.12, w=0.07, mat='T', y=0.0):
    """Heavy dark panel line across the surface (q = face pen) with a trapezoid step in it."""
    pts = _step(x0, x1, z, at, nw, nd)
    for a, b in zip(pts, pts[1:]):
        q.line(mat, (a[0], y, a[1]), (b[0], y, b[1]), (0, 1, 0), w=w, h=0.022)


def frame_line(q, w, h, x=0.0, z=0.0, lw=0.07, mat='T', cut=0.0):
    """Heavy dark outline of a hatch w x h (optionally with cut corners) on the surface."""
    c = cut
    x0, x1, z0, z1 = x - w / 2, x + w / 2, z - h / 2, z + h / 2
    pts = [(x0 + c, z1), (x1 - c, z1), (x1, z1 - c), (x1, z0 + c), (x1 - c, z0), (x0 + c, z0), (x0, z0 + c), (x0, z1 - c)]
    pts = [p for i, p in enumerate(pts) if (Vector(p) - Vector(pts[i - 1])).length > 1e-5]
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        q.line(mat, (a[0], 0, a[1]), (b[0], 0, b[1]), (0, 1, 0), w=lw, h=0.022)


def derive(P):
    P = dict(P)
    lw = P['leg_w']
    lg = P['lg'] = lw * P.get('girth', 1.0)
    P.setdefault('ah', 1.22 + 0.36 * lw)           # ankle height: tall, chunky feet
    P['hip_z'] = P['ah'] + P['shin'] + P['thigh']
    P['z0'] = 0.6 * lg
    P['wz'] = P['z0'] + 0.55
    P.setdefault('zb', 1.3)                         # chest bottom above the waist joint (short abdomen)
    P['zt'] = P['zb'] + P['torso_h']
    P['cz'] = P['zb'] + P['torso_h'] / 2
    P['shx'] = P['torso_w'] / 2 + 0.9
    P['shz'] = P['cz'] + P['torso_h'] * 0.2
    P['UA'] = P.get('ua', 3.3)
    P['FA'] = P.get('fa', 3.2)
    P['yf'] = 1.0 * lg + 0.42
    P['yb'] = -(0.72 * lg + 0.42)
    P['xo'] = P['hip_w'] + 0.8 * lg + 0.08
    P['ka'] = min(1.2, max(0.9, (P['torso_w'] / 5.4) ** 0.7))      # trunk / waist-collar scale
    return P


# =============================================================================================
# LEG
# =============================================================================================
def build_leg(R, P, s):
    X = sfx(s)
    mir = s < 0
    w, th, sn, ah = P['lg'], P['thigh'], P['shin'], P['ah']
    kind = P['leg']
    slim, heavy, flare = kind == 'slim', kind == 'heavy', kind == 'flare'
    lean = slim or flare
    q = 0.9 if lean else 1.0
    hip, knee, ankle = 'hip_' + X, 'knee_' + X, 'ankle_' + X
    R.joint(hip, 'pelvis', (P['hip_w'], 0, 0), mirror=mir)
    R.joint(knee, hip, (0, 0, -th))
    R.joint(ankle, knee, (0, 0, -sn))
    R.joint('sole_' + X, ankle, (0, 0, -ah))

    # ---------------- thigh ----------------
    p = R.pen(hip, mir)
    p.ball('F', 0.58 * w, n=12, m=6)
    p.cyl('F', 0.4 * w, 0.5 * w, (-0.62 * w, 0, 0), axis='X', n=10)
    p.tube('F', [S(-0.3, 0.42 * w, 0.46 * w, 0.14 * w), S(-th + 0.25, 0.4 * w, 0.44 * w, 0.13 * w)])
    hx = (0.84 if heavy else 0.76) * w * q
    p.tube('A', [S(-0.5, 0.54 * w * q, 0.5 * w, 0.14 * w, cv=0.16 * w), S(-1.0, hx, 0.76 * w, 0.15 * w, cv=0.18 * w, c2=0.24 * w),
                 S(-th * 0.62, hx * 1.03, 0.78 * w, 0.15 * w, cv=0.18 * w, c2=0.24 * w), S(-th + 0.95, 0.72 * w * q, 0.68 * w, 0.14 * w, cv=0.14 * w, c2=0.2 * w),
                 S(-th + 0.6, 0.58 * w * q, 0.54 * w, 0.14 * w, cv=0.1 * w)], bv=0.05)
    yfr = 0.95 * w
    if lean:
        pts = [(-0.34 * w, -0.95), (0.34 * w, -0.95), (0.5 * w, -1.5), (0.3 * w, -th * 0.7), (0.0, -th * 0.84),
               (-0.3 * w, -th * 0.7), (-0.5 * w, -1.5)]
    else:
        pts = [(-0.44 * w, -0.95), (0.44 * w, -0.95), (0.6 * w, -1.45), (0.56 * w, -th * 0.7), (0.3 * w, -th * 0.82),
               (-0.3 * w, -th * 0.82), (-0.56 * w, -th * 0.7), (-0.6 * w, -1.45)]
    p.prism('A', pts, 0.22, 'XZ', (0, yfr + 0.03, 0), bv=0.06)
    p.box('B', (0.62 * w * q, 0.1, 0.34), (0, yfr + 0.15, -1.32), bv=0.03, bx=0.82)
    p.line('F', (-0.5 * w * q, yfr + 0.14, -th * 0.56), (0.5 * w * q, yfr + 0.14, -th * 0.56), (0, 1, 0), w=0.05)
    p.bolts('F', [(-0.4 * w * q, yfr + 0.14, -th * 0.64), (0.4 * w * q, yfr + 0.14, -th * 0.64)], (0, 1, 0), r=0.05 * w)
    # outer service hatch + hand-hold, inner panel outline
    xs = hx * 1.03
    hy = [(-0.3 * w, -1.35), (0.52 * w, -1.35), (0.52 * w, -th * 0.6), (0.3 * w, -th * 0.7), (-0.3 * w, -th * 0.7)]
    oq = face(p, (xs, 0.12 * w, -th * 0.52), (1, 0, 0))
    stepped(oq, 'B', 0.86 * w, th * 0.42, th=0.09, zs=0.05, at=0.42, nd=0.14, cut=0.12 * w)
    # hip-joint guard: armour cap in front of the hip ball, under the front skirt
    p.prism('A', [(0.48 * w, 0.3), (0.92 * w, 0.16), (1.0 * w, -0.5), (0.8 * w, -0.84), (0.48 * w, -0.62)], 1.44 * w * q, 'YZ', bv=0.055, far=0.84, near=0.84)
    jline(face(p, (0, 0.98 * w, -0.2), (0, 1, 0.1)), -0.4 * w * q, 0.4 * w * q, 0.0, nw=0.26 * w, nd=0.1, w=0.06)
    # rear thigh plate above the knee rams (seen by the chase camera)
    rq = face(p, (0, 0.18 * w - 0.78 * w, -th * 0.36), (0, -1, 0))
    stepped(rq, 'A', 0.9 * w * q, th * 0.22, th=0.08, zs=0.02, at=0.5, nd=0.1, cut=0.1 * w)
    p.handhold('F', (xs + 0.04, 0.32 * w, -1.72), (0, 0, -pi / 2), w=0.4 * w, h=0.1)
    p.bolts('F', [(xs + 0.04, 0.6 * w, -th * 0.56), (xs + 0.04, 0.0, -th * 0.64)], (1, 0, 0), r=0.05 * w)
    p.hatch((-xs, 0.2 * w, -th * 0.5), (-1, 0, 0), (0, 0, 1), 0.7 * w, 1.1, mat='F')
    if heavy:
        p.box('A', (0.22, 1.25 * w, th * 0.46), (xs + 0.14, 0.2 * w, -th * 0.5), bv=0.06, ty=0.8, by=0.86)
        for yy in (-0.24 * w, 0.64 * w):
            for zz in (-th * 0.36, -th * 0.64):
                p.bolt('F', (xs + 0.25, yy, zz), (1, 0, 0), r=0.07)
    if flare:
        # slim thigh: long outer strake
        p.prism('B', [(-0.5 * w, -0.8), (0.3 * w, -0.8), (0.42 * w, -th * 0.5), (0.0, -th + 0.9), (-0.4 * w, -th * 0.6)], 0.12, 'YZ',
                (xs + 0.06, 0.1 * w, 0), bv=0.035)
    # rear knee-drive pistons, bracket, hamstring line
    for ix in (-1, 1):
        p.piston((ix * 0.27 * w, -0.72 * w, -th * 0.5), (ix * 0.27 * w, -0.52 * w, -th + 0.2), r=0.11 * w)
    p.box('F', (0.9 * w, 0.36 * w, 0.32), (0, -0.62 * w, -th * 0.5 + 0.04), bv=0.03)
    hose(p, [(0.0, -0.66 * w, -th * 0.52), (0.0, -0.76 * w, -th * 0.74), (0.0, -0.54 * w, -th + 0.35)], 0.055 * w)

    # ---------------- knee + shin ----------------
    k = R.pen(knee, mir)
    k.cyl('F', 0.56 * w, 1.56 * w, axis='X', n=12)
    for ix in (-1, 1):
        jcap(k, 'B', ix * (0.78 * w + 0.06), 0.48 * w, ix)
    k.tube('F', [S(-0.3, 0.42 * w, 0.48 * w, 0.15 * w), S(-sn + 0.3, 0.4 * w, 0.44 * w, 0.13 * w)])
    for ix in (-1, 1):
        k.piston((ix * 0.78 * w * q, 0.12 * w, -1.3), (ix * 0.72 * w, 0.3 * w, -0.3), r=0.06 * w, eyes=False)
    hose(k, [(0.22 * w, -0.5 * w, 0.3), (0.26 * w, -0.72 * w, -0.2), (0.22 * w, -0.6 * w, -0.95)], 0.065 * w)
    hose(k, [(-0.2 * w, -0.5 * w, 0.3), (-0.26 * w, -0.68 * w, -0.25), (-0.2 * w, -0.6 * w, -0.95)], 0.05 * w)
    # knee guard: rises in front of the thigh, rides on the shin
    # (the rear of the block is sunk into the knee drum and the shin top so it never reads as a floating plate)
    if slim:
        kp = [(0.9 * w, 1.55), (1.1 * w, 1.15), (1.42 * w, 0.2), (1.36 * w, -0.7), (1.02 * w, -1.05), (0.64 * w, -1.0), (0.38 * w, -0.5), (0.38 * w, 0.3), (0.74 * w, 0.62)]
        kw = 0.98 * w
    elif flare:
        kp = [(0.88 * w, 1.3), (1.14 * w, 1.12), (1.38 * w, 0.2), (1.32 * w, -0.75), (1.0 * w, -1.1), (0.64 * w, -1.05), (0.38 * w, -0.5), (0.38 * w, 0.3), (0.74 * w, 0.62)]
        kw = 1.06 * w
    elif heavy:
        kp = [(0.9 * w, 1.0), (1.22 * w, 0.95), (1.56 * w, 0.3), (1.56 * w, -0.7), (1.15 * w, -1.1), (0.72 * w, -1.0), (0.38 * w, -0.5), (0.38 * w, 0.3), (0.76 * w, 0.6)]
        kw = 1.42 * w
    else:
        kp = [(0.9 * w, 1.05), (1.16 * w, 0.95), (1.47 * w, 0.25), (1.47 * w, -0.62), (1.1 * w, -1.0), (0.7 * w, -0.95), (0.38 * w, -0.5), (0.38 * w, 0.3), (0.74 * w, 0.62)]
        kw = 1.26 * w
    k.prism('B', kp, kw, 'YZ', bv=0.06, far=0.84, near=0.84)
    ky = kp[2][0]
    kq = face(k, (0, ky - 0.01, -0.14), (0, 1, 0))
    lamp(kq, 0, 0, w=kw * 0.28, h=0.1)
    jline(kq, -0.3 * kw, 0.3 * kw, 0.3, nw=kw * 0.22, nd=0.1, w=0.06)
    k.bolts('F', [(-0.36 * kw, ky - 0.1 * w, -0.5), (0.36 * kw, ky - 0.1 * w, -0.5)], (0, 1, 0), r=0.055 * w)
    if heavy:
        for ix in (-1, 1):
            k.box('A', (0.16, 0.7 * w, 0.9), (ix * (kw * 0.5 + 0.02), 1.08 * w, -0.2), bv=0.04, ty=0.7)
    # shin armour shell
    if heavy:
        st = [S(-0.72, 0.7 * w, 0.76 * w, 0.14 * w, cv=0.04 * w, c2=0.22 * w), S(-1.3, 0.96 * w, 1.02 * w, 0.16 * w, cv=0.06 * w, c2=0.28 * w),
              S(-sn * 0.56, 1.06 * w, 1.16 * w, 0.18 * w, cv=0.0, c2=0.3 * w), S(-sn + 0.72, 1.16 * w, 1.3 * w, 0.2 * w, cv=-0.06 * w, c2=0.34 * w),
              S(-sn + 0.38, 1.06 * w, 1.18 * w, 0.18 * w, cv=-0.06 * w, c2=0.3 * w)]
    elif slim:
        st = [S(-0.8, 0.52 * w, 0.6 * w, 0.14 * w, cv=0.06 * w, c2=0.2 * w), S(-1.45, 0.76 * w, 0.88 * w, 0.2 * w, cv=0.08 * w, c2=0.26 * w),
              S(-sn * 0.52, 0.86 * w, 1.02 * w, 0.24 * w, cv=0.02 * w, c2=0.3 * w), S(-sn + 0.85, 0.94 * w, 1.12 * w, 0.26 * w, cv=-0.04 * w, c2=0.32 * w),
              S(-sn + 0.5, 0.8 * w, 0.96 * w, 0.22 * w, cv=-0.04 * w, c2=0.28 * w)]
    elif flare:
        st = [S(-0.8, 0.52 * w, 0.6 * w, 0.14 * w, cv=0.05 * w, c2=0.18 * w), S(-1.5, 0.76 * w, 0.88 * w, 0.18 * w, cv=0.04 * w, c2=0.26 * w),
              S(-sn * 0.55, 0.88 * w, 1.12 * w, 0.2 * w, cv=-0.12 * w, c2=0.3 * w), S(-sn + 0.95, 1.12 * w, 1.64 * w, 0.22 * w, cv=-0.46 * w, c2=0.44 * w),
              S(-sn + 0.5, 1.02 * w, 1.5 * w, 0.2 * w, cv=-0.46 * w, c2=0.36 * w)]
    else:
        st = [S(-0.78, 0.6 * w, 0.66 * w, 0.14 * w, cv=0.06 * w, c2=0.2 * w), S(-1.38, 0.86 * w, 0.96 * w, 0.16 * w, cv=0.08 * w, c2=0.26 * w),
              S(-sn * 0.58, 0.98 * w, 1.1 * w, 0.18 * w, cv=0.02 * w, c2=0.3 * w), S(-sn + 0.78, 1.1 * w, 1.28 * w, 0.2 * w, cv=-0.06 * w, c2=0.34 * w),
              S(-sn + 0.42, 1.0 * w, 1.16 * w, 0.18 * w, cv=-0.06 * w, c2=0.3 * w)]
    k.tube('A', st, bv=0.055)
    yF = st[2][5] + st[2][2]          # front face (y) at mid shin
    hxm = st[2][1]                    # half width at mid shin
    yR = st[2][5] - st[2][2]          # rear face at mid shin
    # front shin plate (second layer) with a dark inset strip
    if lean:
        sp = [(-0.3 * w, -1.3), (0.3 * w, -1.3), (0.5 * w, -1.95), (0.32 * w, -sn + 1.35), (0.0, -sn + 0.85), (-0.32 * w, -sn + 1.35), (-0.5 * w, -1.95)]
    else:
        sp = [(-0.42 * w, -1.3), (0.42 * w, -1.3), (0.6 * w, -1.8), (0.56 * w, -sn + 1.5), (0.36 * w, -sn + 1.0),
              (-0.36 * w, -sn + 1.0), (-0.56 * w, -sn + 1.5), (-0.6 * w, -1.8)]
    k.prism('A', sp, 0.24, 'XZ', (0, yF + 0.06, 0), bv=0.06)
    k.prism('B', spts(sp, 0.42, 0.6), 0.1, 'XZ', (0, yF + 0.19, 0), bv=0.03)
    k.bolts('F', [(-0.3 * w * q, yF + 0.18, -1.5), (0.3 * w * q, yF + 0.18, -1.5)], (0, 1, 0), r=0.05 * w)
    if heavy:
        for iz in range(2):
            k.box('A', (0.9 * w, 0.1, 0.14), (0, yF + 0.2, -1.62 - iz * 0.24), bv=0.03)
    # panel lines on the flanks
    for ix in (-1, 1):
        k.line('T', (ix * (hxm + 0.005), -0.55 * w, -sn * 0.36), (ix * (hxm + 0.005), 0.62 * w, -sn * 0.36), (ix, 0, 0), w=0.07, h=0.02)
    lamp(face(k, (hxm * 0.92, 0.12 * w, -1.5), (1, 0, 0.12)), w=0.34 * w, h=0.08)
    if flare:
        # flared calf: hem band, twin fins, thruster recessed under the bell
        zc = -sn + 0.72
        k.tube('B', [S(-sn + 0.52, 1.04 * w, 1.52 * w, 0.2 * w, cv=-0.46 * w, c2=0.36 * w), S(-sn + 0.3, 1.1 * w, 1.6 * w, 0.22 * w, cv=-0.48 * w, c2=0.4 * w)], bv=0.04)
        for ix in (-1, 1):
            k.prism('B', [(-1.2 * w, -sn * 0.4), (-1.75 * w, -sn * 0.62), (-2.5 * w, -sn + 0.7), (-2.1 * w, -sn + 0.55), (-1.5 * w, -sn + 1.4)], 0.12, 'YZ',
                    (ix * 0.62 * w, 0, 0), bv=0.035)
        k.box('F', (0.9 * w, 0.5 * w, 0.4), (0, -1.5 * w, -sn + 0.85), bv=0.04)
        nozzle(R, 'noz_leg_' + X, knee, (0, -1.55 * w, -sn + 0.4), (rad(-38), 0, 0), 0.5 * w, 0.8 * w, n=12)
        # stepped plate + status lamp on the rear slope of the bell
        ay, az, by_, bz = -1.24 * w, -sn * 0.55, -2.1 * w, -sn + 0.95
        sl = ((by_ - ay) ** 2 + (bz - az) ** 2) ** 0.5
        fq = face(k, (0, (ay + by_) / 2, (az + bz) / 2), (0, bz - az, -(by_ - ay)), up=(0, ay - by_, az - bz))
        stepped(fq, 'A', 1.0 * w, sl * 0.56, th=0.08, zs=0.02, nd=0.1, cut=0.1 * w, z=-0.06 * sl)
        lamp(fq, 0, sl * 0.36, w=0.4 * w, h=0.09)
        vent(R, knee, (hxm + 0.04, 0.1 * w, -sn * 0.6), (1, 0, 0), (0, -1, 0), 0.9, 0.6 * w, mirror=mir)
        k.louvre('B', (-hxm - 0.02, -0.2 * w, -sn * 0.52), (0, 0, pi / 2), 0.8 * w, 0.6, n=4, d=0.09)
    else:
        # calf thruster housing
        yb = yR + 0.02
        zc = -sn * 0.6
        cp = [(yb + 0.25, -1.4), (yb - 0.42, -1.85), (yb - 0.72, zc), (yb - 0.68, zc - 0.5), (yb - 0.2, zc - 0.95), (yb + 0.25, zc - 0.95)]
        k.prism('B', cp, 1.2 * w * q, 'YZ', bv=0.06, far=0.88, near=0.88)
        # calf status lamp + hatch outline on the housing's rear face
        cq = face(k, (0, yb - 0.705, zc - 0.25), (0, -1, 0))
        lamp(cq, 0, 0.1, w=0.42 * w * q, h=0.09)
        jline(cq, -0.4 * w * q, 0.4 * w * q, -0.12, nw=0.24 * w, nd=0.08, w=0.06)
        k.line('F', (-0.45 * w * q, yb - 0.58, -1.9), (0.45 * w * q, yb - 0.58, -1.9), (0, -0.83, 0.55), w=0.06)
        nozzle(R, 'noz_leg_' + X, knee, (0, yb - 0.5, zc - 0.78), (rad(-44), 0, 0), 0.44 * w, 0.75 * w, n=10)
        k.handhold('F', (0, yb - 0.62, zc + 0.5), (0, 0, pi), w=0.5 * w, h=0.1)
        # flank plate framing the overdrive vent
        vz, vy = -sn * 0.62, -0.06 * w
        op = [(vy - 0.56 * w, vz + 0.52), (vy - 0.36 * w, vz + 0.78), (vy + 0.36 * w, vz + 0.78), (vy + 0.56 * w, vz + 0.52),
              (vy + 0.56 * w, vz - 0.52), (vy + 0.36 * w, vz - 0.78), (vy - 0.36 * w, vz - 0.78), (vy - 0.56 * w, vz - 0.52)]
        k.prism('B', op, 0.12, 'YZ', (hxm + 0.01, 0, 0), (0, -0.07, 0), bv=0.04)
        k.bolts('F', [(hxm + 0.07, vy - 0.42 * w, vz + 0.5), (hxm + 0.07, vy + 0.42 * w, vz + 0.5),
                      (hxm + 0.09, vy - 0.42 * w, vz - 0.5), (hxm + 0.09, vy + 0.42 * w, vz - 0.5)], (1, 0, 0), r=0.045 * w)
        vent(R, knee, (hxm + 0.06, 0.25 * w, -sn * 0.62), (1, 0, 0), (0, -1, 0), 0.9, 0.62 * w, mirror=mir)
        k.louvre('B', (-hxm - 0.0, 0.0, -sn * 0.47), (0, 0, pi / 2), 0.8 * w, 0.6, n=4, d=0.09)
        if not slim:
            # ankle cuff
            s3, s4 = st[3], st[4]
            k.tube('B', [S(-sn + 0.5, s4[1] + 0.03, s4[2] + 0.03, 0.18 * w, cv=s4[5], c2=0.3 * w),
                         S(-sn + 0.18, s3[1] + 0.03, s3[2] + 0.03, 0.2 * w, cv=s3[5], c2=0.34 * w)], bv=0.045)
        else:
            for ix in (-1, 1):
                k.prism('C', [(0.2 * w, -sn + 1.5), (-0.7 * w, -sn + 1.2), (-0.7 * w, -sn + 0.7), (0.2 * w, -sn + 0.95)], 0.07, 'YZ',
                        (ix * (st[3][1] + 0.0), 0, 0), bv=0.02)
    for yy in (-0.5 * w, 0.5 * w):
        k.bolt('F', (st[3][1] + 0.0, yy + st[3][5], -sn + 0.95), (1, 0, 0), r=0.055 * w)

    # ---------------- foot ----------------
    f = R.pen(ankle, mir)
    g = -ah
    fw = 1.1 if heavy else (0.9 if lean else 1.0)
    f.cyl('F', 0.5 * w, 1.5 * w, axis='X', n=12)
    for ix in (-1, 1):
        jcap(f, 'B', ix * 0.8 * w, 0.5 * w, ix)
    f.box('F', (1.0 * w, 1.3 * w, ah * 0.72), (0, -0.05 * w, -ah * 0.5), bv=0.06)
    heel_y = -(0.85 if lean else 1.0) * w
    toe_y = (2.9 if lean else 2.75) * w
    sh_ = 0.13
    zs = g + 2 * sh_              # top of the sole
    f.tube('F', [S(heel_y - 0.62 * w, 0.86 * w * fw, sh_, 0.05, cv=g + sh_), S(heel_y, 1.1 * w * fw, sh_, 0.05, cv=g + sh_),
                 S(1.4 * w, 1.16 * w * fw, sh_, 0.05, cv=g + sh_), S(toe_y, 0.86 * w * fw, sh_, 0.05, cv=g + sh_)], axis='Y')
    # mid foot
    mp = [(heel_y + 0.05 * w, zs - 0.02), (1.36 * w, zs - 0.02), (1.36 * w, zs + 0.7 * w), (0.8 * w, -0.22), (-0.72 * w, -0.16), (heel_y + 0.05 * w, -0.55)]
    f.prism('B', mp, 2.04 * w * fw, 'YZ', bv=0.06, far=0.92, near=0.92)
    # toe block
    if lean:
        for ix in (-1, 1):
            f.tube('A', [S(1.44 * w, 0.47 * w, 0.34 * w, 0.14 * w, ix * 0.52 * w, zs + 0.34 * w, 0.04),
                         S(2.25 * w, 0.44 * w, 0.28 * w, 0.14 * w, ix * 0.5 * w, zs + 0.28 * w, 0.04),
                         S(toe_y - 0.02, 0.28 * w, 0.12 * w, 0.06 * w, ix * 0.46 * w, zs + 0.12 * w, 0.03)], axis='Y', bv=0.04)
        f.box('F', (0.3 * w, 1.0 * w, 0.4 * w), (0, 2.0 * w, zs + 0.2 * w), bv=0.03)
    else:
        f.tube('B', [S(1.44 * w, 1.06 * w * fw, 0.38 * w, 0.18 * w, cv=zs + 0.38 * w, c2=0.04),
                     S(2.15 * w, 1.02 * w * fw, 0.33 * w, 0.18 * w, cv=zs + 0.33 * w, c2=0.04),
                     S(toe_y - 0.02, 0.8 * w * fw, 0.16 * w, 0.08 * w, cv=zs + 0.16 * w, c2=0.03)], axis='Y', bv=0.05)
        f.box('A', (1.24 * w * fw, 0.6 * w, 0.1), (0, 1.86 * w, zs + 0.71 * w), (rad(-7), 0, 0), bv=0.03)
        f.bolts('F', [(-0.4 * w * fw, 1.86 * w, zs + 0.76 * w), (0.4 * w * fw, 1.86 * w, zs + 0.76 * w)], (0, 0, 1), r=0.05 * w)
    # heel
    if lean:
        hp = [(heel_y, zs + 0.7), (heel_y - 0.5 * w, zs + 0.92), (heel_y - 1.2 * w, zs - 0.02), (heel_y - 0.85 * w, zs - 0.02),
              (heel_y - 0.42 * w, zs + 0.36), (heel_y, zs + 0.2)]
        f.prism('B', hp, 0.74 * w, 'YZ', bv=0.045)
        lamp(face(f, (0, heel_y - 0.85 * w, zs + 0.45), (0, -0.94, 0.7 * w), up=(0, 0.7 * w, 0.94)), w=0.36 * w, h=0.08, bezel='F')
    else:
        hp = [(heel_y, zs - 0.02), (heel_y - 0.62 * w, zs - 0.02), (heel_y - 0.7 * w, zs + 0.3), (heel_y - 0.3 * w, zs + 0.82), (heel_y, zs + 0.82)]
        f.prism('A' if heavy else 'B', hp, 1.5 * w * fw, 'YZ', bv=0.06, far=0.9, near=0.9)
        hq = face(f, (0, heel_y - 0.5 * w, zs + 0.56), (0, -0.52, 0.4 * w), up=(0, 0.4 * w, 0.52))
        lamp(hq, 0, 0.0, w=0.5 * w * fw, h=0.09, bezel='F')
        jline(hq, -0.6 * w * fw, 0.6 * w * fw, -0.2, nw=0.3 * w, nd=0.07, w=0.06, mat='F')
    # side guards
    for ix in (-1, 1):
        if heavy:
            f.box('A', (0.4 * w, 1.7 * w, 0.46), (ix * 1.2 * w * fw, 0.3 * w, zs + 0.2), bv=0.06, ty=0.8)
            f.bolt('F', (ix * (1.2 * w * fw + 0.2 * w), 0.3 * w, zs + 0.22), (ix, 0, 0), r=0.08)
        else:
            f.box('A', (0.12, 1.5 * w, 0.46), (ix * 1.03 * w * fw, 0.3 * w, zs + 0.26), bv=0.04, ty=0.7)
            f.bolt('F', (ix * (1.03 * w * fw + 0.06), 0.3 * w, zs + 0.26), (ix, 0, 0), r=0.06)
    # front ankle guard (tucks under the shin cuff)
    f.box('A', (1.36 * w * q, 0.22, 1.15), (0, 0.92 * w, 0.12), (0.42, 0, 0), bv=0.06, tx=0.8)
    f.box('B', (0.7 * w * q, 0.1, 0.5), (0, 0.98 * w + 0.07, -0.02), (0.42, 0, 0), bv=0.03, tx=0.8)
    f.bolts('F', [(-0.46 * w * q, 1.05 * w, -0.2), (0.46 * w * q, 1.05 * w, -0.2)], (0, 0.9, 0.43), r=0.05 * w)
    # Achilles pistons
    for ix in (-1, 1):
        f.piston((ix * 0.42 * w, heel_y - 0.25 * w, zs + 0.6), (ix * 0.42 * w, -0.5 * w, 0.05), r=0.115 * w, split=0.5)
    f.box('F', (1.1 * w, 0.2 * w, 0.24), (0, heel_y - 0.2 * w, zs + 0.62), bv=0.03)


# =============================================================================================
# PELVIS + SKIRTS
# =============================================================================================
def skirt_plate(q, w, l, kind, ob, trim=None, tk=0.26, lamp_=False):
    """Local: hinge along X at origin, plate hangs -Z, outward normal +Y. ob = sign of outboard X."""
    if kind == 'heavy':
        pts = [(-0.5, 0), (0.5, 0), (0.5, -0.78), (0.36, -1.0), (-0.36, -1.0), (-0.5, -0.78)]
    elif kind == 'slim':
        pts = [(-0.5, 0), (0.5, 0), (0.5, -0.5), (0.1, -1.0), (-0.3, -1.0), (-0.5, -0.78)]
    elif kind == 'flare':
        pts = [(-0.5, 0), (0.5, 0), (0.5, -0.42), (0.2, -1.08), (-0.14, -1.08), (-0.5, -0.66)]
    else:
        pts = [(-0.5, 0), (0.5, 0), (0.5, -0.62), (0.22, -1.0), (-0.36, -1.0), (-0.5, -0.84)]
    pts = [(x * w * ob, z * l) for x, z in pts]
    y1 = tk + 0.03
    q.prism('A', pts, tk, 'XZ', (0, tk / 2 + 0.03, -0.05), bv=0.065)
    # hinge + actuator
    q.cyl('F', 0.11, 0.72 * w, (0, 0.06, 0.0), axis='X', n=8)
    for ix in (-1, 1):
        q.box('F', (0.14, 0.3, 0.3), (ix * 0.26 * w, 0.02, 0.02), bv=0.02)
    # top reinforcement band
    q.box('B', (0.9 * w, 0.1, 0.15 * l), (0, y1 + 0.03, -0.05 - 0.1 * l), bv=0.03)
    # raised second layer
    wide = kind in ('heavy', 'std')
    pw_, ph_ = (0.62 if wide else 0.5) * w, 0.44 * l
    sq = q.at((0.0 if wide else -0.05 * w * ob, y1, -0.05 - 0.52 * l))
    stepped(sq, 'B', pw_, ph_, th=0.1, bv=0.035, zs=0.04 * l, at=0.5 + 0.14 * ob, nw=0.26 * pw_, nd=0.07 * l, cut=0.09 * w)
    if kind == 'heavy':
        q.box('B', (0.74 * w, 0.14, 0.09 * l), (0, y1 + 0.04, -0.93 * l), bv=0.035)
    if lamp_:
        lamp(q.at((0, y1 + 0.08, -0.05 - 0.1 * l)), w=0.26 * w, h=0.07)
    q.bolts('F', [(-0.4 * w, y1, -0.26 * l), (0.4 * w, y1, -0.26 * l)], (0, 1, 0), r=0.055)
    q.piston((0, y1 + 0.1, -0.04), (0, y1 + 0.12, -0.3 * l), r=0.05, eyes=False)
    q.box('F', (0.2, 0.16, 0.14), (0, y1 + 0.07, -0.03), bv=0.02)
    if trim:
        q.box(trim, (0.09, tk + 0.05, 0.3 * l), (ob * 0.5 * w, tk / 2 + 0.03, -0.34 * l), bv=0.0)


def build_pelvis(R, P):
    lw, hw, sk = P['lg'], P['hip_w'], P['skirt']
    z0, zt, yf, yb, xo = P['z0'], P['wz'], P['yf'], P['yb'], P['xo']
    kind = P['leg']
    R.joint('frame')
    R.joint('pelvis', 'frame', (0, 0, P['hip_z']))
    p = R.pen('pelvis')
    p.tube('F', [S(-1.0, 0.62, 0.55, 0.2), S(-0.35, 0.95, 0.9, 0.25), S(zt, 1.1, 0.95, 0.25)])
    p.cyl('F', 0.4 * lw, 2 * hw - 0.6 * lw, axis='X', n=10)
    for ix in (-1, 1):
        p.cyl('F', 0.66 * lw, 0.3, (ix * (hw - 0.62 * lw - 0.1), 0, 0), axis='X', n=12)
    # crotch block + armoured cod plate
    cw = 1.16
    cp = [(0.7, z0 - 0.02), (yf - 0.1, z0 - 0.06), (yf + 0.14, -0.4), (yf - 0.16, -1.38), (0.5, -1.25), (0.62, -0.3)]
    p.prism('B', cp, cw, 'YZ', bv=0.06, far=0.84, near=0.84)
    a1 = atan2(0.24, z0 + 0.34)
    p.box('A', (0.7, 0.12, (z0 + 0.3) * 0.86), (0, yf + 0.03, (z0 - 0.46) / 2), (-a1, 0, 0), bv=0.035, bx=0.8)
    p.box('T', (0.44, 0.08, 0.2), (0, yf + 0.075, z0 - 0.42), (-a1, 0, 0), bv=0)
    p.box('G', (0.3, 0.06, 0.08), (0, yf + 0.1, z0 - 0.42), (-a1, 0, 0), bv=0)
    for i in range(3):
        p.line('T', (-0.24, yf + 0.0 - i * 0.1, -0.7 - i * 0.2), (0.24, yf + 0.0 - i * 0.1, -0.7 - i * 0.2), (0, 0.95, -0.3), w=0.07)
    if P.get('hazard', True):
        p.box('H', (0.72, 0.1, 0.15), (0, yf - 0.1, -1.12), (rad(20), 0, 0), bv=0)
    rp = [(-0.6, z0 - 0.02), (yb + 0.1, z0 - 0.06), (yb - 0.06, -0.4), (yb + 0.3, -1.1), (-0.45, -0.95)]
    p.prism('B', rp, 1.2, 'YZ', bv=0.06, far=0.86, near=0.86)
    p.cyl('T', 0.2, 0.3, (0, yb + 0.0, -0.4), axis='Y', n=8)
    # belt: front / rear bars and hip fenders
    p.box('B', (2.1, yf - 0.55, zt - z0 + 0.06), (0, (yf + 0.55) / 2 - 0.02, (z0 + zt) / 2 - 0.03), bv=0.06, ty=0.9)
    p.box('B', (2.1, -yb - 0.5, zt - z0 + 0.06), (0, (yb - 0.5) / 2 + 0.02, (z0 + zt) / 2 - 0.03), bv=0.06, ty=0.9)
    p.box('F', (0.56, 0.12, 0.26), (0, yf + 0.0, (z0 + zt) / 2), bv=0.03)
    p.box('G', (0.3, 0.05, 0.07), (0, yf + 0.06, (z0 + zt) / 2), bv=0)
    # armoured waist collar: the trunk's lower ring turns inside it, so the waist joint is never bare
    ka = P['ka']
    p.rtube('B', [(zt - 0.04, 1.5 * ka, 1.3 * ka), (zt + 0.22, 1.5 * ka, 1.3 * ka), (zt + 0.36, 1.4 * ka, 1.2 * ka)], n=12, ph=pi / 12)
    for i in range(12):
        a = i * pi / 6
        p.line('T', (1.5 * ka * cos(a), 1.3 * ka * sin(a), zt + 0.0), (1.5 * ka * cos(a), 1.3 * ka * sin(a), zt + 0.2), (cos(a), sin(a) * 1.15, 0), w=0.06, h=0.02)
    # rear belt status lamps (chase-camera side)
    rb = face(p, (0, yb + 0.01, (z0 + zt) / 2), (0, -1, 0))
    lamp(rb, 0, 0, w=0.46, h=0.08)
    for ix in (-1, 1):
        lamp(rb, ix * 0.72, 0, w=0.1, h=0.2)
    for s in (1, -1):
        m = R.pen('pelvis', s < 0)
        hu = (xo - 0.95) / 2
        cu = (xo + 0.95) / 2
        hv = (yf - yb) / 2 - 0.1
        cv = (yf + yb) / 2
        m.tube('A', [S(z0, hu, hv, 0.2, cu, cv), S(zt - 0.14, hu, hv, 0.2, cu, cv), S(zt + 0.02, hu - 0.14, hv - 0.14, 0.16, cu, cv)], bv=0.05)
        m.bolts('F', [(cu - 0.3 * hu, cv + 0.4 * hv, zt + 0.02), (cu - 0.3 * hu, cv - 0.4 * hv, zt + 0.02)], (0, 0, 1), r=0.07)
        m.box('B', (0.12, hv * 1.0, 0.26), (xo + 0.02, cv, z0 + 0.3), bv=0.03)
        m.hatch((cu + 0.2 * hu, cv, zt + 0.02), (0, 0, 1), (0, 1, 0), hu * 0.9, hv * 0.9, mat='F')
        m.box('F', (0.16, 0.2, 0.3), (0.8, yf + 0.05, z0 + 0.1), bv=0.03)          # tow lug
        hose(m, [(0.72, 0.5, zt - 0.1), (1.0, 0.62, zt + 0.2), (0.95, 0.5, zt + 0.5)], 0.06)
        X = sfx(s)
        mir = s < 0
        # skirts on their own hinges
        wf = (hw + 0.8 * lw - 0.6) * (0.8 + 0.2 * sk)
        lf = 2.05 * sk ** 0.85
        cx = 0.64 + wf / 2
        R.joint('skirt_F' + X, 'pelvis', (cx, yf, z0 + 0.1), mirror=mir)
        skirt_plate(R.pen('skirt_F' + X, mir).at(rot=(rad(13), 0, 0)), wf, lf, kind, 1, P.get('trim_f'))
        ws = (yf - yb) * (0.86 + 0.16 * sk) + 0.25
        ls = 2.2 * sk ** 0.85
        R.joint('skirt_S' + X, 'pelvis', (xo + 0.06, (yf + yb) / 2 + 0.05, z0 + 0.18), mirror=mir)
        skirt_plate(R.pen('skirt_S' + X, mir).at(rot=(rad(6), 0, -pi / 2)), ws, ls, kind, 1, P.get('trim_s'), tk=0.2, lamp_=True)
        wr = wf * 0.94
        lr = 1.85 * sk ** 0.85
        R.joint('skirt_B' + X, 'pelvis', (0.68 + wr / 2, yb, z0 + 0.1), mirror=mir)
        skirt_plate(R.pen('skirt_B' + X, mir).at(rot=(rad(10), 0, pi)), wr, lr, kind, -1, None, lamp_=True)


# =============================================================================================
# TORSO
# =============================================================================================
def build_torso(R, P):
    tw, thh, td = P['torso_w'], P['torso_h'], P['torso_d']
    zb, zt, cz, shz = P['zb'], P['zt'], P['cz'], P['shz']
    keel = P['chest'] == 'keel'
    yF = td / 2
    R.joint('waist', 'pelvis', (0, 0, P['wz']))
    t = R.pen('waist')
    ka = P['ka']
    if P.get('armoured', True):
        # Fully armoured trunk: two overlapping "lobster" rings that turn and tilt inside the pelvis collar,
        # a flared rib band under the chest, belly plate under the cockpit, flank and lumbar plates.
        t.rtube('F', [(-0.12, 1.1 * ka, 0.96 * ka), (0.5, 1.1 * ka, 0.96 * ka)], n=12, ph=pi / 12)
        t.rtube('B', [(0.02, 1.2 * ka, 1.04 * ka), (0.12, 1.27 * ka, 1.1 * ka), (0.5, 1.3 * ka, 1.13 * ka), (0.58, 1.22 * ka, 1.06 * ka)], n=12, ph=pi / 12)
        t.rtube('A', [(0.5, 1.3 * ka, 1.13 * ka), (0.6, 1.4 * ka, 1.2 * ka), (0.98, 1.44 * ka, 1.24 * ka), (1.06, 1.34 * ka, 1.16 * ka)], n=12, ph=pi / 12)
        t.tube('B', [S(0.96, 1.36 * ka, 1.18 * ka, 0.3), S(zb + 0.08, 0.36 * tw + 0.03, 0.4 * td + 0.03, 0.3)], bv=0.04)
        bw_ = (0.2 if keel else 0.28) * tw * 1.12
        bp = [(yF + 0.2, zb + 0.16), (yF + 0.12, zb - 0.3), (1.3 * ka + 0.12, 0.62), (1.26 * ka + 0.02, 0.42), (0.9 * ka, 0.42), (0.9 * ka, zb + 0.16)]
        t.prism('A', bp, bw_, 'YZ', bv=0.05, far=0.8, near=0.8)
        bq = face(t, (0, yF + 0.15, zb - 0.08), (0, 1, 0.17))
        lamp(bq, 0, 0.0, w=0.26, h=0.08)
        jline(bq, -0.3 * bw_, 0.3 * bw_, -0.16, nw=0.2 * bw_, nd=0.07, w=0.06)
        for ix in (-1, 1):
            fx = 1.4 * ka + 0.05
            t.box('A', (0.3, 1.7 * ka, zb - 0.3), (ix * fx, 0.0, (zb + 0.46) / 2), (0, ix * rad(-8), 0), bv=0.05, by=0.8)
            fq = face(t, (ix * (fx + 0.15), 0.0, (zb + 0.46) / 2), (ix, 0, 0.14))
            jline(fq, -0.62 * ka, 0.62 * ka, 0.12, nw=0.36, nd=0.14)
            t.bolts('F', [(ix * (fx + 0.17), 0.6 * ka, zb * 0.74), (ix * (fx + 0.17), -0.6 * ka, zb * 0.74)], (ix, 0, 0), r=0.055)
        # lumbar plate with a status lamp (the chase camera looks straight at it under the pack)
        ly = 1.3 * ka + 0.12
        t.prism('B', [(-0.86 * ka, zb + 0.12), (-(ly + 0.02), zb - 0.25), (-ly, 0.5), (-0.9 * ka, 0.4)], 1.5 * ka, 'YZ', bv=0.05, far=0.82, near=0.82)
        rq = face(t, (0, -(ly + 0.0), (zb + 0.25) / 2), (0, -1, 0))
        frame_line(rq, 0.84 * ka, zb * 0.36, cut=0.08, lw=0.06)
        lamp(rq, 0, 0, w=0.34, h=0.09)
    else:
        # light frame: exposed spine, pistons and hoses between a few plates
        t.cyl('F', 1.15, 0.3, (0, 0, 0.12), n=14)
        t.cyl('B', 1.26, 0.12, (0, 0, 0.2), n=14, bv=0.025)
        t.tube('F', [S(0.3, 0.72, 0.62, 0.2), S(zb + 0.2, 0.86, 0.72, 0.2)])
        for ix in (-1, 1):
            for iy in (-1, 1):
                t.piston((ix * 0.86, iy * 0.5, 0.42), (ix * 1.12, iy * 0.66, zb + 0.02), r=0.08)
        aw_ = 1.3 if keel else 1.9
        t.prism('B', [(0.55, zb + 0.05), (1.12, zb - 0.02), (1.22, zb - 0.46), (0.95, zb - 0.64), (0.55, zb - 0.62)], aw_, 'YZ', bv=0.05, far=0.9, near=0.9)
        t.prism('A', [(0.55, zb - 0.72), (1.14, zb - 0.7), (1.08, 0.42), (0.55, 0.38)], aw_ * 0.86, 'YZ', bv=0.05, far=0.9, near=0.9)
        t.line('T', (-0.3 * aw_, 1.2, zb - 0.26), (0.3 * aw_, 1.2, zb - 0.26), (0, 1, 0.1), w=0.07)
        t.box('B', (1.3, 0.4, zb - 0.5), (0, -0.78, (zb + 0.5) / 2), bv=0.05, tx=1.1)
        lamp(face(t, (0, -0.98, (zb + 0.5) / 2), (0, -1, 0)), w=0.3, h=0.08)
        for ix in (-1, 1):
            kx = 1.1 if keel else 1.3
            t.box('A', (0.26, 1.15, zb - 0.62), (ix * kx, 0.05, (zb + 0.5) / 2), (0, ix * rad(-10), 0), bv=0.05, by=0.75)
            t.bolt('F', (ix * (kx + 0.15), 0.05, zb * 0.62), (ix, 0, 0), r=0.06)
            hose(t, [(ix * 0.5, 0.76, 0.5), (ix * 0.66, 0.96, zb * 0.55), (ix * 0.6, 0.86, zb + 0.05)], 0.055)

    # ---- chest core
    t.tube('B', [S(zb, 0.36 * tw, 0.4 * td, 0.3), S(zb + 0.32 * thh, 0.455 * tw, 0.47 * td, 0.32), S(zt - 0.28, 0.455 * tw, 0.45 * td, 0.32),
                 S(zt, 0.38 * tw, 0.36 * td, 0.26)], bv=0.05)
    prow = P.get('prow', 0.8)
    # cockpit block
    cwid = (0.2 if keel else 0.28) * tw
    kf = 0.72 if keel else 0.9
    cpts = [(yF - 0.35, zt + 0.14), (yF + 0.42 * prow / 0.8, zt - 0.24), (yF + prow, cz + 0.22), (yF + prow - 0.08, zb + 0.6),
            (yF + 0.16, zb + 0.02), (yF - 0.35, zb + 0.02)]
    t.prism('B', cpts, cwid, 'YZ', bv=0.06, far=kf, near=kf)
    # upper slope hatch plate (accent) and front hatch
    dy, dz = cpts[1][0] - cpts[0][0], cpts[1][1] - cpts[0][1]
    ang = atan2(dz, dy)
    my, mz = (cpts[0][0] + cpts[1][0]) / 2, (cpts[0][1] + cpts[1][1]) / 2
    t.box('C', (cwid * 0.58, 0.52, 0.09), (0, my + 0.02, mz + 0.03), (ang, 0, 0), bv=0.025)
    ny, nz = (cpts[2][0] + cpts[3][0]) / 2, (cpts[2][1] + cpts[3][1]) / 2
    fh = cpts[2][1] - cpts[3][1]
    t.box('A', (cwid * 0.66, 0.12, fh * 0.9), (0, ny - 0.03, nz), bv=0.035, tx=0.86)
    t.box('T', (cwid * 0.4, 0.06, 0.2), (0, ny + 0.04, nz + fh * 0.2), bv=0)
    t.box('G', (cwid * 0.28, 0.05, 0.08), (0, ny + 0.065, nz + fh * 0.2), bv=0)
    t.handhold('F', (0, ny + 0.04, nz - fh * 0.2), (0, 0, 0), w=cwid * 0.4, h=0.1)
    # pectoral blocks
    pfar = P.get('pec_far', 0.84)
    pshift = P.get('pec_shift', -0.18)
    for s in (1, -1):
        m = R.pen('waist', s < 0)
        ppts = [(yF - 0.4, zt + 0.04), (yF + 0.26, zt - 0.3), (yF + 0.52, cz + 0.2), (yF + 0.44, zb + 0.72),
                (yF + 0.0, zb + 0.22), (yF - 0.45, zb + 0.22)]
        x0 = cwid / 2 + 0.07
        x1 = 0.5 * tw
        m.prism('A', ppts, x1 - x0, 'YZ', ((x0 + x1) / 2, 0, 0), bv=0.065, far=pfar, near=1.0, shift=(pshift, 0.0), c=(yF - 0.3, cz))
        pcx = (x0 + x1) / 2
        k_ = 0.5 * (1 + pfar)
        fa = atan2(ppts[2][1] - ppts[3][1], ppts[2][0] - ppts[3][0])
        ly, lz = (ppts[2][0] + ppts[3][0]) / 2, (ppts[2][1] + ppts[3][1]) / 2
        vy = ly * k_ + (yF - 0.3) * (1 - k_) + pshift * 0.5
        vh = (ppts[2][1] - ppts[3][1]) * 0.62
        if not keel:
            # framed intake with accent surround
            m.louvre('F', (pcx - 0.05, vy + 0.03, lz), (fa - pi / 2, 0, -0.5 * (1 - pfar) + pshift * 0.12), (x1 - x0) * 0.6, vh, n=4, d=0.12, frame='C')
        else:
            for i in range(3):
                m.box('T', ((x1 - x0) * 0.5, 0.07, 0.11), (pcx - 0.1, vy + 0.0, lz + 0.26 - i * 0.24), (fa - pi / 2, 0, pshift * 0.6), bv=0)
            m.box('C', ((x1 - x0) * 0.56, 0.05, 0.07), (pcx - 0.1, vy + 0.02, lz + 0.44), (fa - pi / 2, 0, pshift * 0.6), bv=0)
        # upper slope
        ua = atan2(ppts[1][1] - ppts[0][1], ppts[1][0] - ppts[0][0])
        uy, uz = (ppts[0][0] + ppts[1][0]) / 2, (ppts[0][1] + ppts[1][1]) / 2
        if P.get('era'):
            # heavy applique plate + lifting lug; bull-bar brackets (the bar itself is added below)
            m.box('B', ((x1 - x0) * 0.74, 0.5, 0.12), (x0 + (x1 - x0) * 0.46, uy + pshift * 0.2, uz + 0.04), (ua, 0, 0), bv=0.04)
            m.cyl('F', 0.13, 0.12, (x0 + (x1 - x0) * 0.46, uy - 0.1 + pshift * 0.2, uz + 0.18), axis='X', n=8)
            uq = face(m, (x0 + (x1 - x0) * 0.46, uy + pshift * 0.2, uz + 0.1), (0, -sin(ua), cos(ua)), up=(0, -cos(ua), -sin(ua)))
            jline(uq, -(x1 - x0) * 0.34, (x1 - x0) * 0.34, -0.12, at=0.35, nw=0.3, nd=0.08, w=0.06)
            lamp(uq, (x1 - x0) * 0.22, 0.12, w=0.24, h=0.07)
            for bxk in (0.3, 0.84):
                m.box('F', (0.16, 0.6, 0.2), (x0 + (x1 - x0) * bxk, yF + 0.72 + pshift * bxk * 0.6, cz - 0.42), bv=0.03)
        else:
            uq = face(m, (x0 + (x1 - x0) * 0.4, uy + pshift * 0.22, uz - 0.03), (0, -sin(ua), cos(ua)), up=(0, -cos(ua), -sin(ua)))
            stepped(uq, 'B', (x1 - x0) * 0.6, 0.5, th=0.09, zs=0.03, at=0.4, nd=0.11, cut=0.08)
            lamp(uq, -(x1 - x0) * 0.16, 0.12, w=0.22, h=0.07, y=0.09)
            m.bolts('F', [(x1 - 0.5, uy - 0.2 + pshift * 0.5, uz + 0.08)], (0, 0.5, 0.86), r=0.06)
        # flank plate + armpit louvre (light frames keep open ribs instead)
        if not keel or P.get('armoured', True):
            m.box('A', (0.3, 0.62 * td, 0.44 * thh), (0.455 * tw + 0.08, -0.05, zb + 0.3 * thh), bv=0.055, by=0.8)
            m.louvre('B', (0.455 * tw + 0.24, -0.05, zb + 0.3 * thh), (0, 0, -pi / 2), 0.34 * td, 0.22 * thh, n=3, d=0.1)
            fq = face(m, (0.455 * tw + 0.23, -0.05, zb + 0.3 * thh), (1, 0, 0))
            jline(fq, -0.28 * td, 0.28 * td, 0.17 * thh, at=0.6, nw=0.3, nd=0.08, w=0.06)
            lamp(fq, 0.2 * td, -0.16 * thh, w=0.26, h=0.07)
        else:
            for i in range(3):
                m.prism('B', [(yF * 0.9, 0), (-yF * 0.5, 0.25), (-yF * 0.5, 0.05), (yF * 0.75, -0.22)], 0.14, 'YZ',
                        (0.36 * tw - i * 0.2, 0.0, zb + 0.14 - i * 0.36), (0, rad(-12), 0), bv=0.035)
        # collar guard + shoulder deck
        chx = P.get('head_hw', 0.95) + 0.3
        ch = P.get('collar_h', 0.55)
        m.box('B', (0.42, 0.62 * td, ch), (chx, -0.06 * td, zt + ch / 2 - 0.02), bv=0.06, ty=0.72, tx=0.8)
        m.box('B', (1.12, 0.74 * td, 0.34), (tw / 2 - 0.68, -0.02, zt + 0.1), bv=0.06, ty=0.9)
        m.cyl('F', 0.09, 0.3, (tw / 2 - 0.3, 0.2 * td, zt + 0.32), axis='Y', n=6)
        # shoulder-deck navigation lamp (top face, rear outer corner) and a stepped seam across the deck
        dq = face(m, (tw / 2 - 0.68, -0.02, zt + 0.27), (0, 0, 1), up=(0, 1, 0))
        lamp(dq, -0.3, -0.28 * td, w=0.3, h=0.09)
        jline(dq, -0.5, 0.5, 0.2 * td, at=0.4, nw=0.24, nd=0.08, w=0.06)
        if P.get('armoured', True):
            # collar cheek closes the neck from the side; lamp on the collar's outer face
            lamp(face(m, (chx + 0.2, -0.2 * td, zt + ch * 0.5), (1, 0, 0.2)), w=0.3, h=0.08)
        else:
            hose(m, [(0.34, -0.2, zt + 0.02), (0.5, -0.5, zt + 0.3), (0.3, -0.62, zt + 0.5)], 0.05)
    if P.get('era'):
        t.rod('F', (-0.44 * tw, yF + 1.0, cz - 0.42), (0.44 * tw, yF + 1.0, cz - 0.42), 0.14, n=8)
        for ix in (-1, 1):
            t.ball('F', 0.17, (ix * 0.44 * tw, yF + 1.0, cz - 0.42), n=8, m=4)
    hw_ = P.get('head_hw', 0.95) + 0.3
    t.box('B', (2 * hw_, 0.36, 0.5), (0, -0.34 * td, zt + 0.2), bv=0.06)
    nq = face(t, (0, -0.34 * td - 0.18, zt + 0.24), (0, -1, 0))
    lamp(nq, 0, 0.04, w=0.44, h=0.09)
    jline(nq, -hw_ * 0.8, hw_ * 0.8, -0.1, nw=0.3, nd=0.07, w=0.06)
    if P.get('armoured', True):
        # gorget: armoured neck ring closed at the front, under the chin
        gy = 0.25 * td + 0.1
        t.prism('B', [(gy - 0.4, zt + 0.34), (gy + 0.0, zt + 0.3), (gy + 0.22, zt + 0.0), (gy - 0.4, zt + 0.0)], 2 * hw_ - 0.36, 'YZ', bv=0.045, far=0.86, near=0.86)
        t.rtube('B', [(zt + 0.02, 0.78, 0.78), (zt + 0.3, 0.74, 0.74)], pos=(0, P.get('head_y', 0.3) - 0.05, 0), n=12)
    t.box('A', (0.56 * tw, 0.24, 0.5 * thh), (0, -0.46 * td - 0.02, cz + 0.2), bv=0.055)
    t.cyl('F', 0.6, 0.3, (0, P.get('head_y', 0.3) - 0.05, zt + 0.08), n=12)
    zdeck = zt + 0.27
    # shoulder stubs
    for ix in (-1, 1):
        t.cyl('F', 0.7, 1.1, (ix * (tw / 2 + 0.3), 0, shz), axis='X', n=12)
        t.cyl('B', 0.86, 0.2, (ix * (tw / 2 + 0.06), 0, shz), axis='X', n=12, bv=0.03)
    # back hard-points (pedestal + ring)
    mz = zt + 0.75
    sdx = tw / 2 - 0.35
    for s in (1, -1):
        m = R.pen('waist', s < 0)
        my = -0.12 * td
        m.tube('F', [S(zdeck - 0.1, 0.42, 0.5, 0.12, sdx, my), S(mz - 0.14, 0.34, 0.4, 0.1, sdx, my)])
        m.cyl('F', 0.42, 0.14, (sdx, my, mz - 0.07), n=10)
        for i in range(4):
            a = pi / 4 + i * pi / 2
            m.bolt('B', (sdx + 0.3 * cos(a), my + 0.3 * sin(a), mz), (0, 0, 1), r=0.05, h=0.03)
        R.joint('mount_back_' + sfx(s), 'waist', (sdx, my, mz), mirror=s < 0)
    # front braking verniers under the pectorals
    for s in (1, -1):
        pos = (0.5 * (0.13 * tw + 0.5 * tw) - 0.1, yF + 0.08 + pshift * 0.5, zb + 0.34)
        nozzle(R, 'noz_front_' + sfx(s), 'waist', pos, (rad(36), 0, 0), 0.2, 0.34, mirror=s < 0, n=8, plug=False)

    R.joint('head', 'waist', (0, P.get('head_y', 0.3), zt + P.get('head_z', 0.2)))
    build_head(R, P)


# =============================================================================================
# HEADS  (faceted helmets around a sensor core: visor band / lens clusters -- no crests, no faces)
# Shape language shared with the Sparta frames: sloped crown, raked brow over a recessed sensor band,
# chamfered cheeks, jaw guard. Every helmet is a set of hard-faceted lofts (shell / skull below).
# =============================================================================================
def _facet_fix(verts, faces, bv, ang):
    """Weld coincident points, drop collapsed faces, bevel every edge sharper than `ang` (rad) and split the result
    into one island per face, so each facet shades flat however shallow the fold between two facets is."""
    bm = bmesh.new()
    key, idx = {}, []
    for v in verts:
        k = (round(v[0], 5), round(v[1], 5), round(v[2], 5))
        if k not in key:
            key[k] = bm.verts.new(v)
        idx.append(key[k])
    for f in faces:
        vs = []
        for i in f:
            if idx[i] not in vs:
                vs.append(idx[i])
        if len(vs) >= 3:
            try:
                bm.faces.new(vs)
            except ValueError:
                pass
    bm.normal_update()
    dead = [f for f in bm.faces if f.calc_area() < 1e-7]
    if dead:
        bmesh.ops.delete(bm, geom=dead, context='FACES_ONLY')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bv > 0.0:
        es = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > ang]
        if es:
            bmesh.ops.bevel(bm, geom=es, offset=bv, offset_type='OFFSET', segments=1, profile=0.5,
                            affect='EDGES', clamp_overlap=True)
        bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges[:])
    ov, of = [], []
    for f in bm.faces:
        if len(f.verts) < 3:
            continue
        of.append(tuple(range(len(ov), len(ov) + len(f.verts))))
        ov.extend(v.co.copy() for v in f.verts)
    bm.free()
    return ov, of


def hring(z, pts):
    """Helmet station at height z: right-half plan outline [(x, y) or (x, y, dz)] running from the front
    centre-line (x = 0) to the rear centre-line (x = 0)."""
    return [(p[0], p[1], z + (p[2] if len(p) > 2 else 0.0)) for p in pts]


def shell(p, mat, st, bv=0.035, ang=0.2):
    """Hard-faceted loft through stations of 3D points (see hring); the left half is mirrored from the right.
    A station whose points all lie on the centre-line closes the loft in a ridge."""
    rings = [list(r) + [(-x, y, z) for x, y, z in reversed(r[1:-1])] for r in st]
    n = len(rings[0])
    v = [q for r in rings for q in r]
    f = [tuple(range(n)), tuple(range((len(rings) - 1) * n, len(rings) * n))]
    for k in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            f.append((k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i))
    v, f = _facet_fix(v, f, bv, ang)
    p.emit(mat, v, f, None, 0.0, recalc=False)


def skull(p, mat, st, rim=0.9, zc=None, bv=0.035, ang=0.2, yc=0.0):
    """Helmet bowl: shell() through `st`, whose first station is the (non-planar) lower edge of the helmet.
    The edge gets a rolled-in rim and a flat ceiling inside, so the bowl has wall thickness when seen from below."""
    e = st[0]
    zc = max(q[2] for q in e) + 0.03 if zc is None else zc
    inner = [(x * rim, yc + (y - yc) * rim, z) for x, y, z in e]
    shell(p, mat, [[(x, y, zc) for x, y, z in inner], inner] + list(st), bv, ang)


def head_visor(h):
    """Kestrel: sallet-style trooper helm -- chamfered crown with a sensor keel, rim sweeping down to the nape,
    wrap-around visor slit between a raked brow and a wedge bevor, toed-in cheek guards."""
    h.cyl('F', 0.56, 0.4, (0, -0.05, 0.05), n=10)
    # dark sensor core; the visor band glows all round it and shows through the slit between brow and bevor
    h.tube('T', [S(0.3, 0.66, 0.7, 0.22), S(1.0, 0.66, 0.7, 0.22)])
    h.tube('G', [S(0.76, 0.68, 0.72, 0.22), S(0.89, 0.68, 0.72, 0.22)])
    # bevor: jaw guard, two flat faces meeting in a prow
    shell(h, 'B', [hring(0.17, [(0, 0.82), (0.5, 0.6), (0.58, -0.4), (0, -0.66)]),
                   hring(0.38, [(0, 1.04), (0.62, 0.74), (0.7, -0.5), (0, -0.84)]),
                   hring(0.7, [(0, 0.9), (0.64, 0.7), (0.72, -0.5), (0, -0.84)])], bv=0.04)
    # skull: upright sides, chamfered crown, flat top; the rim drops from the brow line to the nape
    skull(h, 'A', [hring(0, [(0, 0.94, 0.94), (0.56, 0.84, 0.94), (0.8, 0.36, 0.9), (0.8, -0.5, 0.62), (0.48, -1.02, 0.4), (0, -1.02, 0.4)]),
                   hring(0, [(0, 0.94, 1.1), (0.56, 0.84, 1.1), (0.82, 0.36, 1.16), (0.82, -0.5, 1.16), (0.5, -1.04, 1.1), (0, -1.04, 1.1)]),
                   hring(0, [(0, 0.6, 1.36), (0.36, 0.54, 1.36), (0.6, 0.2, 1.4), (0.6, -0.42, 1.4), (0.36, -0.8, 1.36), (0, -0.8, 1.36)]),
                   hring(0, [(0, 0.38, 1.45), (0.24, 0.34, 1.45), (0.38, 0.1, 1.46), (0.38, -0.34, 1.46), (0.22, -0.58, 1.44), (0, -0.58, 1.44)])], bv=0.04)
    # cheek guards: toed-in plates hanging from the rim, lower lobes reaching forward beside the bevor
    for ix in (-1, 1):
        h.prism('A', [(0.5, 0.92), (0.76, 0.62), (0.7, 0.3), (0.3, 0.16), (-0.42, 0.24), (-0.5, 0.6), (-0.3, 0.92)], 0.12, 'YZ',
                (ix * 0.82, 0, 0), (0, 0, ix * 0.12), bv=0.035)
    # raked brow over the slit
    shell(h, 'B', [hring(0.9, [(0, 1.1), (0.64, 0.94), (0.86, 0.42), (0.6, 0.36), (0, 0.5)]),
                   hring(1.2, [(0, 0.84), (0.5, 0.74), (0.72, 0.42), (0.5, 0.4), (0, 0.5)])], bv=0.03)
    # dorsal sensor keel with a forward camera
    h.prism('C', [(0.5, 1.4), (0.34, 1.54), (-0.56, 1.6), (-0.72, 1.5), (-0.72, 1.38), (0.5, 1.38)], 0.36, 'YZ', bv=0.03, far=0.7, near=0.7)
    face(h, (0, 0.43, 1.475), (0, 1, 1)).box('T', (0.16, 0.03, 0.1), (0, 0.012, 0), bv=0.0)
    # left ear sensor, right rear whip antenna
    h.cyl('B', 0.27, 0.16, (-0.86, -0.12, 0.9), axis='X', n=10, bv=0.03)
    h.cyl('T', 0.15, 0.05, (-0.95, -0.12, 0.9), axis='X', n=8)
    h.box('F', (0.2, 0.24, 0.3), (0.6, -0.66, 1.22), bv=0.03)
    h.rod('F', (0.6, -0.66, 1.32), (0.68, -0.9, 2.5), 0.035, n=4, r2=0.015)
    h.louvre('B', (0, -1.05, 0.72), (0, 0, pi), 0.64, 0.3, n=3, d=0.08)
    lamp(face(h, (0, -1.045, 0.98), (0, -1, 0)), w=0.36, h=0.06)
    return (0, 0.9, 0.825)


def head_turret(h):
    """Bastion: low, wide glacis helm -- sloped faces all round a flat roof, heavy arrowhead brow slab and jaw
    mantlet, an offset three-lens cluster in the slot between them."""
    h.cyl('F', 1.05, 0.3, (0, 0, 0.05), n=14)
    # sensor core + lens cluster (big lens on the frame's left)
    h.tube('T', [S(0.2, 0.96, 0.9, 0.24, cv=0.1), S(0.9, 0.96, 0.9, 0.24, cv=0.1)])
    lens(h, (-0.5, 1.1, 0.64), 0.19, d=0.2)
    lens(h, (0.02, 1.08, 0.54), 0.11, d=0.16)
    lens(h, (0.36, 1.08, 0.74), 0.09, d=0.16)
    # jaw mantlet
    shell(h, 'B', [hring(0.12, [(0, 1.0), (0.8, 0.84), (1.06, 0.1), (1.0, -0.7), (0, -0.9)]),
                   hring(0.27, [(0, 1.36), (0.98, 1.1), (1.22, 0.2), (1.14, -0.8), (0, -1.04)]),
                   hring(0.4, [(0, 1.3), (0.96, 1.06), (1.2, 0.2), (1.12, -0.8), (0, -1.04)])], bv=0.04)
    # skull: glacis straight from the brow edge, short upright belt at the sides and nape, flat roof
    skull(h, 'A', [hring(0, [(0, 1.24, 0.9), (0.9, 1.04, 0.9), (1.26, 0.5, 0.84), (1.26, -0.5, 0.5), (0.8, -1.24, 0.36), (0, -1.24, 0.36)]),
                   hring(0, [(0, 1.24, 0.9), (0.9, 1.04, 0.9), (1.28, 0.5, 0.9), (1.28, -0.5, 0.82), (0.82, -1.26, 0.8), (0, -1.26, 0.8)]),
                   hring(1.17, [(0, 0.74), (0.56, 0.66), (0.86, 0.3), (0.86, -0.4), (0.56, -0.84), (0, -0.84)])], bv=0.045, rim=0.86, zc=0.9)
    # brow slab
    shell(h, 'B', [hring(0.86, [(0, 1.4), (1.0, 1.14), (1.3, 0.56), (1.0, 0.5), (0, 0.6)]),
                   hring(1.06, [(0, 1.08), (0.82, 0.9), (1.1, 0.56), (0.9, 0.52), (0, 0.6)])], bv=0.035)
    # cheek slabs, roof hatch, periscope blocks
    for ix in (-1, 1):
        h.box('B', (0.16, 1.1, 0.46), (ix * 1.31, -0.1, 0.6), bv=0.05, ty=0.8)
        h.bolts('F', [(ix * 1.39, 0.3, 0.6), (ix * 1.39, -0.5, 0.6)], (ix, 0, 0), r=0.06)
    h.cyl('B', 0.42, 0.1, (0.3, -0.2, 1.2), n=10, bv=0.025)
    h.handhold('F', (0.3, -0.2, 1.25), (pi / 2, 0, 0), w=0.4, h=0.1)
    for i in range(3):
        h.box('B', (0.26, 0.2, 0.16), (-0.5 + i * 0.36, 0.52, 1.22), bv=0.03)
        h.box('T', (0.2, 0.03, 0.09), (-0.5 + i * 0.36, 0.63, 1.23), bv=0.0)
    h.box('F', (0.2, 0.24, 0.3), (0.76, -0.82, 1.02), bv=0.03)
    h.rod('F', (0.76, -0.82, 1.12), (0.82, -1.0, 2.4), 0.035, n=4, r2=0.015)
    h.louvre('B', (0, -1.27, 0.5), (0, 0, pi), 1.0, 0.24, n=3, d=0.08)
    lamp(face(h, (0, -1.265, 0.72), (0, -1, 0)), w=0.5, h=0.06)
    for ix in (-1, 1):
        lamp(face(h, (ix * 1.39, -0.1, 0.62), (ix, 0, 0)), w=0.3, h=0.07)
    return (-0.5, 1.24, 0.64)


def head_cluster(h):
    """Shrike: narrow raptor helm -- ridged crown running forward into a beak over the lens cluster, short jaw
    wedge, swept cheek blades, comb jammer and swept blade aerial."""
    h.cyl('F', 0.46, 0.4, (0, -0.1, 0.05), n=10)
    # sensor core + asymmetric lens cluster under the beak
    h.tube('T', [S(0.4, 0.34, 0.94, 0.05, cv=0.04), S(1.0, 0.34, 0.94, 0.05, cv=0.04)])
    lens(h, (0.1, 1.04, 0.74), 0.14, d=0.14)
    lens(h, (-0.19, 1.04, 0.84), 0.07, d=0.12)
    lens(h, (-0.19, 1.04, 0.64), 0.07, d=0.12)
    # mask cheeks framing the lens window
    for ix in (-1, 1):
        h.prism('B', [(ix * 0.3, 1.1), (ix * 0.44, 0.98), (ix * 0.58, 0.3), (ix * 0.3, 0.3)], 0.38, 'XY', (0, 0, 0.73), bv=0.03)
    # jaw wedge
    shell(h, 'B', [hring(0.16, [(0, 0.5), (0.26, 0.4), (0.4, -0.2), (0, -0.6)]),
                   hring(0.4, [(0, 1.02), (0.4, 0.7), (0.52, -0.3), (0, -0.9)]),
                   hring(0.56, [(0, 0.94), (0.4, 0.68), (0.52, -0.3), (0, -0.9)])], bv=0.035)
    # skull: arrowhead plan, roof planes meeting in a ridge
    skull(h, 'A', [hring(0, [(0, 1.36, 0.9), (0.36, 0.86, 0.96), (0.62, 0.1, 0.84), (0.6, -0.66, 0.52), (0.28, -1.2, 0.5), (0, -1.26, 0.5)]),
                   hring(0, [(0, 1.3, 1.02), (0.36, 0.84, 1.1), (0.64, 0.1, 1.06), (0.62, -0.66, 0.96), (0.28, -1.22, 0.9), (0, -1.28, 0.9)]),
                   hring(0, [(0, 0.9, 1.2), (0.12, 0.7, 1.26), (0.2, 0.1, 1.38), (0.2, -0.58, 1.34), (0.12, -0.96, 1.12), (0, -1.02, 1.08)]),
                   hring(0, [(0, 0.9, 1.2), (0, 0.7, 1.3), (0, 0.1, 1.42), (0, -0.58, 1.38), (0, -0.96, 1.16), (0, -1.02, 1.08)])], bv=0.035)
    # side lenses on the beak's flanks (one high on the right, one low on the left)
    lens(h, (0.24, 1.08, 1.0), 0.06, d=0.14, rot=(0, 0, -0.96))
    lens(h, (-0.5, 0.52, 0.94), 0.06, d=0.14, rot=(0, 0, 1.2))
    # swept cheek blades with intake slots
    for ix in (-1, 1):
        h.prism('B', [(0.5, 0.86), (0.62, 0.56), (0.2, 0.3), (-0.8, 0.48), (-1.05, 0.84)], 0.1, 'YZ', (ix * 0.6, 0, 0), (0, 0, ix * 0.06), bv=0.03)
        h.box('T', (0.05, 0.5, 0.1), (ix * 0.655, -0.3, 0.62), (0, 0, ix * 0.06), bv=0.0)
    # swept blade aerial (right), comb jammer (left rear)
    h.prism('C', [(-0.2, 1.12), (-2.3, 2.0), (-2.5, 1.9), (-1.1, 1.04)], 0.07, 'YZ', (0.4, 0, 0), bv=0.02)
    h.box('F', (0.14, 0.5, 0.2), (0.4, -0.6, 1.14), bv=0.02)
    for i in range(3):
        h.rod('F', (-0.4, -0.5 - i * 0.26, 1.16), (-0.5, -0.9 - i * 0.3, 1.95 - i * 0.2), 0.03, n=4, r2=0.014)
    h.box('F', (0.16, 0.8, 0.16), (-0.4, -0.75, 1.14), bv=0.02)
    lamp(face(h, (0, -1.285, 0.72), (0, -1, 0)), w=0.26, h=0.06)
    return (0.12, 1.16, 0.74)


def head_scope(h):
    """Heron: slim marksman's helm -- crown rising to the rear, long brow peak over a narrow sensor slit, jaw wedge,
    a faceted long-range scope housing in place of the right cheek guard and a tall mast aerial."""
    h.cyl('F', 0.5, 0.4, (0, -0.05, 0.05), n=10)
    h.tube('T', [S(0.3, 0.54, 0.68, 0.2), S(1.0, 0.54, 0.68, 0.2)])
    h.box('G', (0.66, 0.05, 0.08), (0, 0.69, 0.84), bv=0.0)
    h.box('G', (0.16, 0.05, 0.08), (-0.2, 0.69, 0.76), bv=0.0)
    # jaw wedge
    shell(h, 'B', [hring(0.16, [(0, 0.56), (0.3, 0.46), (0.44, -0.3), (0, -0.56)]),
                   hring(0.42, [(0, 0.94), (0.46, 0.7), (0.6, -0.4), (0, -0.8)]),
                   hring(0.72, [(0, 0.84), (0.48, 0.66), (0.62, -0.4), (0, -0.8)])], bv=0.04)
    # skull: one sloping top plane, rising to the rear
    skull(h, 'A', [hring(0, [(0, 0.9, 0.94), (0.46, 0.8, 0.94), (0.7, 0.3, 0.9), (0.7, -0.5, 0.6), (0.4, -0.94, 0.4), (0, -0.94, 0.4)]),
                   hring(0, [(0, 0.9, 1.06), (0.46, 0.8, 1.06), (0.72, 0.3, 1.12), (0.72, -0.5, 1.2), (0.42, -0.96, 1.2), (0, -0.96, 1.2)]),
                   hring(0, [(0, 0.56, 1.25), (0.26, 0.5, 1.26), (0.46, 0.2, 1.32), (0.46, -0.44, 1.45), (0.26, -0.74, 1.51), (0, -0.74, 1.51)])], bv=0.04)
    # long brow peak
    shell(h, 'B', [hring(0.9, [(0, 1.22), (0.56, 1.0), (0.74, 0.4), (0.5, 0.36), (0, 0.5)]),
                   hring(1.06, [(0, 0.94), (0.46, 0.82), (0.66, 0.4), (0.46, 0.4), (0, 0.5)])], bv=0.03)
    # left cheek guard
    h.prism('A', [(0.4, 0.92), (0.56, 0.56), (0.4, 0.24), (-0.36, 0.28), (-0.44, 0.92)], 0.1, 'YZ', (-0.71, 0, 0), (0, 0, -0.1), bv=0.03)
    # long-range scope (right): faceted sleeve, round objective under a hood
    sx, sz = 0.92, 0.9
    h.tube('B', [S(-0.66, 0.2, 0.2, 0.08, sx, sz), S(-0.5, 0.27, 0.27, 0.11, sx, sz), S(0.9, 0.27, 0.27, 0.11, sx, sz), S(1.02, 0.32, 0.32, 0.13, sx, sz),
                 S(1.36, 0.32, 0.32, 0.13, sx, sz)], axis='Y', bv=0.03)
    h.cyl('F', 0.3, 0.12, (sx, -0.3, sz), axis='Y', n=8, ph=pi / 8)
    h.cyl('F', 0.3, 0.12, (sx, 0.55, sz), axis='Y', n=8, ph=pi / 8)
    h.cyl('T', 0.27, 0.05, (sx, 1.37, sz), axis='Y', n=12)
    h.dome('G', 0.23, 0.08, (sx, 1.39, sz), axis='Y', n=12, m=2)
    h.prism('B', [(0.9, 0.28), (1.5, 0.32), (1.5, 0.38), (0.9, 0.38)], 0.5, 'YZ', (sx, 0, sz), bv=0.02, far=0.7)
    h.box('F', (0.3, 0.5, 0.3), (0.7, 0.0, sz - 0.02), bv=0.03)
    h.cyl('F', 0.12, 0.3, (sx, -0.78, sz), axis='Y', n=8)
    # left ear disc, mast aerial + whip
    h.cyl('B', 0.3, 0.14, (-0.74, -0.1, 0.92), axis='X', n=10, bv=0.03)
    h.cyl('T', 0.14, 0.05, (-0.82, -0.1, 0.92), axis='X', n=8)
    h.box('F', (0.2, 0.3, 0.3), (-0.5, -0.66, 1.28), bv=0.03)
    h.prism('B', [(-0.56, 1.3), (-0.72, 3.5), (-0.84, 3.5), (-0.84, 1.3)], 0.06, 'YZ', (-0.5, 0, 0), bv=0.015)
    h.rod('F', (-0.36, -0.86, 1.3), (-0.32, -1.1, 2.3), 0.03, n=4, r2=0.014)
    h.box('B', (0.6, 0.16, 0.36), (0, -0.98, 0.9), bv=0.04, ty=0.8)
    lamp(face(h, (0, -0.965, 0.6), (0, -1, 0)), w=0.36, h=0.07)
    h.prism('C', [(0.5, 1.26), (0.5, 1.31), (-0.7, 1.55), (-0.7, 1.5)], 0.28, 'YZ', bv=0.02, far=0.7, near=0.7)
    return (sx, 1.45, sz)


# Rig.add() draws one shade-variation number per primitive from the frame's random stream. The helmets use a
# stream of their own and the frame's stream is then advanced by what the previous (boxy) heads used to draw,
# so everything built after the head (arms, backpack) keeps exactly the variation it had before the helmets.
_HEAD_DRAWS = {'visor': 25, 'turret': 43, 'cluster': 35, 'scope': 25}


def build_head(R, P):
    kind = P['head']
    hs = P.get('head_s', {'visor': 1.14, 'turret': 1.0, 'cluster': 1.16, 'scope': 1.12}[kind])
    h = R.pen('head').at(scale=hs)
    body_rng = R.rng
    R.rng = random.Random(P.get('seed', 1) * 131 + 17)
    eye = {'visor': head_visor, 'turret': head_turret, 'cluster': head_cluster, 'scope': head_scope}[kind](h)
    R.rng = body_rng
    for _ in range(_HEAD_DRAWS[kind]):
        R.rng.uniform(0.94, 1.06)
    R.joint('eye', 'head', tuple(c * hs for c in eye))


# =============================================================================================
# ARMS + PAULDRONS
# =============================================================================================
def build_arm(R, P, s):
    X = sfx(s)
    mir = s < 0
    aw, sw = P['arm_w'] * 1.02, P['sh_w']
    UA, FA = P['UA'], P['FA']
    sh, el, pa = 'sh_' + X, 'el_' + X, 'pauldron_' + X
    R.joint(pa, 'waist', (P['shx'], 0, P['shz']), mirror=mir)
    R.joint(sh, 'waist', (P['shx'], 0, P['shz']), mirror=mir)
    R.joint(el, sh, (0, 0, -UA))
    # ---- upper arm
    a = R.pen(sh, mir)
    a.ball('F', 0.62 * aw, n=10, m=6)
    a.cyl('F', 0.5 * aw, 0.7, (-0.4, 0, 0), axis='X', n=10)
    a.tube('F', [S(-0.3, 0.4 * aw, 0.42 * aw, 0.13 * aw), S(-UA + 0.2, 0.36 * aw, 0.4 * aw, 0.12 * aw)])
    a.tube('A', [S(-0.5, 0.5 * aw, 0.55 * aw, 0.16 * aw), S(-0.9, 0.66 * aw, 0.72 * aw, 0.2 * aw), S(-UA + 0.85, 0.63 * aw, 0.69 * aw, 0.2 * aw),
                 S(-UA + 0.55, 0.5 * aw, 0.55 * aw, 0.16 * aw)], bv=0.045)
    stepped(face(a, (0.655 * aw, 0, -UA * 0.52), (1, 0, 0)), 'B', 0.86 * aw, 1.2, th=0.1, zs=0.06, at=0.56, nd=0.13, cut=0.09)
    jline(face(a, (0, -0.7 * aw, -UA * 0.36), (0, -1, 0)), -0.36 * aw, 0.36 * aw, 0.0, nw=0.2 * aw, nd=0.08, w=0.06)
    a.box('B', (0.8 * aw, 0.12, 0.9), (0, 0.72 * aw + 0.02, -UA * 0.52), bv=0.035, tx=0.8)
    a.line('F', (-0.4 * aw, 0.72 * aw + 0.085, -UA * 0.52), (0.4 * aw, 0.72 * aw + 0.085, -UA * 0.52), (0, 1, 0), w=0.05)
    a.piston((0, -0.74 * aw - 0.08, -0.75), (0, -0.6 * aw, -UA + 0.15), r=0.08 * aw)
    hose(a, [(-0.3 * aw, -0.5 * aw, -UA + 1.1), (-0.42 * aw, -0.72 * aw, -UA + 0.6), (-0.3 * aw, -0.56 * aw, -UA + 0.1)], 0.05 * aw)
    # ---- elbow + forearm
    e = R.pen(el, mir)
    e.cyl('F', 0.5 * aw, 1.4 * aw, axis='X', n=10)
    for ix in (-1, 1):
        jcap(e, 'B', ix * (0.7 * aw + 0.05), 0.42 * aw, ix, h=0.13)
    e.prism('B', [(-0.45 * aw, 0.6), (-0.95 * aw, 0.3), (-1.04 * aw, -0.5), (-0.62 * aw, -0.66)], 0.92 * aw, 'YZ', bv=0.045, far=0.84, near=0.84)
    e.tube('A', [S(-0.45, 0.55 * aw, 0.62 * aw, 0.18 * aw), S(-1.0, 0.77 * aw, 0.87 * aw, 0.24 * aw), S(-FA + 0.5, 0.81 * aw, 0.91 * aw, 0.24 * aw),
                 S(-FA + 0.15, 0.66 * aw, 0.74 * aw, 0.2 * aw)], bv=0.05)
    stepped(face(e, (0, 0.895 * aw, -FA * 0.52), (0, 1, 0)), 'B', 0.84 * aw, 1.16, th=0.11, zs=0.08, at=0.45, nd=0.13, cut=0.09)
    # rear forearm: status lamp under the elbow guard, stepped seam (chase-camera side)
    eq = face(e, (0, -0.885 * aw, -FA * 0.5), (0, -1, 0))
    lamp(eq, 0, FA * 0.5 - 1.12, w=0.4 * aw, h=0.08)
    jline(eq, -0.42 * aw, 0.42 * aw, 0.1, nw=0.24 * aw, nd=0.1, w=0.06)
    e.box('A', (0.98 * aw, 0.2, 0.5), (0, 0.74 * aw, -FA + 0.02), (rad(-14), 0, 0), bv=0.045, bx=0.8)
    e.hatch((-0.81 * aw, 0, -FA * 0.55), (-1, 0, 0), (0, 0, 1), 0.9 * aw, 1.0, mat='T', lw=0.065)
    xo = 0.8 * aw
    yr = -0.9 * aw
    # hard-points
    e.box('B', (0.14, 0.9 * aw, 1.3), (xo + 0.04, 0, -FA * 0.55), bv=0.035)
    for yy in (-0.3 * aw, 0.3 * aw):
        for zz in (-FA * 0.55 - 0.45, -FA * 0.55 + 0.45):
            e.bolt('F', (xo + 0.11, yy, zz), (1, 0, 0), r=0.06)
    e.box('B', (0.72 * aw, 0.14, 1.0), (0, yr - 0.04, -FA + 0.75), bv=0.035)
    e.box('F', (0.3 * aw, 0.1, 0.5), (0, yr - 0.12, -FA + 0.75), bv=0.02)
    # wrist cuff + fist
    e.tube('B', [S(-FA + 0.2, 0.7 * aw, 0.78 * aw, 0.2 * aw), S(-FA + 0.02, 0.74 * aw, 0.82 * aw, 0.2 * aw)], bv=0.035)
    e.cyl('F', 0.42 * aw, 0.36, (0, 0, -FA - 0.02), n=10)
    hz = -FA - 0.62
    e.box('F', (0.86 * aw, 0.92 * aw, 0.8), (0, 0, hz), bv=0.07)
    e.box('B', (0.16, 0.86 * aw, 0.64), (0.47 * aw, 0, hz + 0.06), bv=0.045)
    for i in range(3):
        yy = (-0.24 + i * 0.24) * aw
        e.line('T', (-0.4 * aw, yy, hz - 0.4), (0.3 * aw, yy, hz - 0.4), (0, 0, -1), w=0.04)
        e.line('T', (-0.43 * aw, yy, hz - 0.36), (-0.43 * aw, yy, hz + 0.2), (-1, 0, 0), w=0.04)
    e.box('F', (0.5 * aw, 0.24, 0.3), (-0.12 * aw, 0.5 * aw, hz + 0.16), bv=0.04)
    R.joint('mount_hand_' + X, el, (0, 0, hz), (rad(-90), 0, 0))
    R.joint('mount_arm_' + X, el, (xo + 0.12, 0, -FA * 0.55), mirror=mir)
    R.joint('mount_blade_' + X, el, (0, yr - 0.17, -FA + 0.75))

    # ---- pauldron
    p = R.pen(pa, mir)
    kind = P['sh']
    hz_m = 'H' if P.get('hazard', True) else 'C'
    if kind == 'block':
        cx = 0.3
        dz = -0.1 * sw
        p = p.at((0, 0, dz))
        hd = 0.52 * sw                 # half depth
        p.tube('A', [S(-0.36 * sw, 0.45 * sw, hd - 0.04 * sw, 0.08 * sw, cx), S(0.3 * sw, 0.48 * sw, hd, 0.1 * sw, cx),
                     S(0.56 * sw, 0.36 * sw, hd - 0.14 * sw, 0.1 * sw, cx - 0.1)], bv=0.06)
        tq = face(p, (cx - 0.1, 0, 0.56 * sw - 0.01), (0, 0, 1), up=(0, 1, 0))
        stepped(tq, 'B', 0.62 * sw, 0.66 * sw, th=0.1, zs=-0.14 * sw, nw=0.2 * sw, nd=0.07 * sw, cut=0.07 * sw)
        lamp(tq, 0.0, -0.27 * sw, w=0.22 * sw, h=0.045 * sw, y=0.1)
        lamp(face(p, (cx, -hd, 0.33 * sw), (0, -1, 0)), w=0.3 * sw, h=0.045 * sw)
        # dark lower hem
        p.tube('B', [S(-0.5 * sw, 0.4 * sw, hd - 0.1 * sw, 0.08 * sw, cx + 0.02), S(-0.35 * sw, 0.44 * sw, hd - 0.05 * sw, 0.08 * sw, cx)], bv=0.04)
        xs = cx + 0.48 * sw
        # outer slab, cut lower corner, hanging over the upper arm
        op = [(-hd * 0.96, 0.3 * sw), (hd * 0.96, 0.3 * sw), (hd * 0.96, -0.36 * sw), (hd * 0.5, -0.66 * sw), (-hd * 0.7, -0.66 * sw), (-hd * 0.96, -0.46 * sw)]
        p.prism('A', op, 0.22, 'YZ', (xs + 0.13, 0, 0), (0, rad(-6), 0), bv=0.065)
        oq = face(p.at((xs + 0.27, 0, -0.14 * sw), (0, rad(-6), 0)), (0, 0, 0), (1, 0, 0))
        stepped(oq, 'B', hd * 1.24, 0.5 * sw, th=0.08, zs=0.03 * sw, at=0.6, nw=0.4 * hd, nd=0.06 * sw, cut=0.07 * sw)
        lamp(oq, 0.42 * hd, 0.17 * sw, w=0.18 * sw, h=0.04 * sw, y=0.08)
        p.box('C', (0.25, 0.12, 0.5 * sw), (xs + 0.15, hd * 0.96 - 0.16, -0.06 * sw), (0, rad(-6), 0), bv=0.0)
        for yy in (-0.4 * sw, 0.4 * sw):
            p.bolt('F', (xs + 0.24, yy, 0.2 * sw), (1, 0, 0.1), r=0.06)
        for yy in (-0.28 * sw, 0.28 * sw):
            p.cyl('F', 0.11, 0.1, (cx + 0.2 * sw, yy, 0.56 * sw + 0.13), axis='Y', n=8)
        # front face: recessed panel with marker lamp, panel lines; rear: grille
        p.box('B', (0.5 * sw, 0.08, 0.26 * sw), (cx - 0.02, hd + 0.01, 0.06 * sw), bv=0.025)
        p.box('G', (0.16 * sw, 0.04, 0.05 * sw), (cx - 0.14 * sw, hd + 0.05, 0.12 * sw), bv=0)
        jline(face(p, (cx, hd - 0.03 * sw, -0.17 * sw), (0, 1, 0.05)), -0.36 * sw, 0.36 * sw, 0.0, at=0.62, nw=0.16 * sw, nd=0.05 * sw, w=0.06)
        p.louvre('B', (cx, -hd, 0.0), (0, 0, pi), 0.52 * sw, 0.3 * sw, n=3, d=0.1, frame='F')
        p.box('B', (0.34, 0.42 * sw, 0.34 * sw), (xs + 0.34, -0.22 * sw, 0.08 * sw), bv=0.045)
        nozzle(R, 'noz_sh_' + X, pa, (xs + 0.54, -0.22 * sw, 0.06 * sw + dz), (0, rad(-75), 0), 0.15 * sw, 0.2 * sw, mirror=mir, n=8, plug=False)
        vent(R, pa, (cx - 0.14 * sw, 0.3 * sw, 0.56 * sw + 0.09 + dz), (0, 0, 1), (0, -1, 0), 0.36 * sw, 0.3 * sw, mirror=mir)
        if P.get('pod') and s > 0:
            sensor_pod(p, (cx + 0.2 * sw, -0.26 * sw, 0.56 * sw + 0.08))
    elif kind == 'heavy':
        sw = sw * 0.9
        cx = 0.34
        dz = -0.08 * sw
        p = p.at((0, 0, dz))
        hd = 0.6 * sw
        p.tube('A', [S(-0.4 * sw, 0.5 * sw, hd - 0.04 * sw, 0.09 * sw, cx), S(0.34 * sw, 0.54 * sw, hd, 0.11 * sw, cx),
                     S(0.62 * sw, 0.4 * sw, hd - 0.16 * sw, 0.11 * sw, cx - 0.1)], bv=0.065)
        tq = face(p, (cx - 0.1, 0, 0.62 * sw - 0.01), (0, 0, 1), up=(0, 1, 0))
        stepped(tq, 'B', 0.72 * sw, 0.82 * sw, th=0.12, zs=-0.2 * sw, nw=0.24 * sw, nd=0.07 * sw, cut=0.08 * sw)
        lamp(tq, 0.0, -0.33 * sw, w=0.24 * sw, h=0.04 * sw, y=0.12)
        lamp(face(p, (cx, -hd, 0.36 * sw), (0, -1, 0)), w=0.34 * sw, h=0.04 * sw)
        p.tube('B', [S(-0.54 * sw, 0.45 * sw, hd - 0.1 * sw, 0.09 * sw, cx + 0.02), S(-0.39 * sw, 0.49 * sw, hd - 0.05 * sw, 0.09 * sw, cx)], bv=0.04)
        for yy in (-0.3 * sw, 0.3 * sw):
            p.cyl('F', 0.15, 0.12, (cx + 0.26 * sw, yy, 0.62 * sw + 0.2), axis='Y', n=8)
        xs = cx + 0.54 * sw
        # tall outer slab with cut corners, one clean raised panel, hazard foot
        op = [(-hd, 0.36 * sw), (hd, 0.36 * sw), (hd, -0.5 * sw), (hd * 0.6, -0.86 * sw), (-hd * 0.6, -0.86 * sw), (-hd, -0.5 * sw)]
        p.prism('A', op, 0.3, 'YZ', (xs + 0.18, 0, 0), (0, rad(-9), 0), bv=0.07)
        oq = face(p.at((xs + 0.39, 0, -0.16 * sw), (0, rad(-9), 0)), (0, 0, 0), (1, 0, 0))
        stepped(oq, 'B', hd * 1.3, 0.56 * sw, th=0.1, zs=0.04 * sw, at=0.6, nw=0.4 * hd, nd=0.06 * sw, cut=0.08 * sw)
        lamp(oq, 0.46 * hd, 0.2 * sw, w=0.16 * sw, h=0.035 * sw, y=0.1)
        p.box(hz_m, (0.33, 1.1 * hd, 0.18), (xs + 0.19 + 0.115 * sw, 0, -0.74 * sw), (0, rad(-9), 0), bv=0.0)
        p.box('C', (0.1, 0.3 * sw, 0.1 * sw), (xs + 0.39 - 0.02 * sw, -0.34 * sw, 0.22 * sw), (0, rad(-9), 0), bv=0.0)
        for yy in (-0.84 * hd, 0.84 * hd):
            for zz in (-0.38 * sw, 0.24 * sw):
                p.bolt('F', (xs + 0.32 - zz * 0.158, yy, zz), (1, 0, 0.16), r=0.08)
        # ram plate: thick wedge bumper on the front face
        rp = [(hd - 0.04, 0.32 * sw), (hd + 0.32, 0.18 * sw), (hd + 0.42, -0.3 * sw), (hd + 0.2, -0.48 * sw), (hd - 0.04, -0.42 * sw)]
        p.prism('B', rp, 0.9 * sw, 'YZ', (cx + 0.02, 0, 0), bv=0.065, far=0.9, near=0.9)
        p.box('H', (0.62 * sw, 0.08, 0.15), (cx + 0.02, hd + 0.385, -0.1 * sw), (rad(-10), 0, 0), bv=0.0)
        p.bolts('F', [(cx + 0.02 - 0.34 * sw, hd + 0.33, 0.1 * sw), (cx + 0.02 + 0.34 * sw, hd + 0.33, 0.1 * sw)], (0, 1, 0.3), r=0.08)
        p.louvre('B', (cx, -hd, 0.0), (0, 0, pi), 0.6 * sw, 0.3 * sw, n=4, d=0.12, frame='F')
        p.box('B', (0.36, 0.44 * sw, 0.3 * sw), (xs + 0.44, -0.3 * sw, 0.12 * sw), (0, rad(-9), 0), bv=0.045)
        nozzle(R, 'noz_sh_' + X, pa, (xs + 0.66, -0.3 * sw, 0.08 * sw + dz), (0, rad(-75), 0), 0.13 * sw, 0.18 * sw, mirror=mir, n=8, plug=False)
        vent(R, pa, (cx - 0.1, 0.1 * sw, 0.62 * sw + 0.11 + dz), (0, 0, 1), (0, -1, 0), 0.4 * sw, 0.34 * sw, mirror=mir)
    elif kind == 'slim':
        cx = 0.3
        pts = [(-0.3 * sw, -0.14 * sw), (-0.3 * sw, 0.3 * sw), (0.0, 0.5 * sw), (0.45 * sw, 0.42 * sw), (0.78 * sw, 0.0),
               (0.72 * sw, -0.4 * sw), (0.45 * sw, -0.22 * sw)]
        p.prism('A', [(x + cx, z) for x, z in pts], 0.96 * sw, 'XZ', bv=0.065, far=0.78, near=0.78)
        p.prism('B', [(x * 0.7 + cx + 0.08, z * 0.62 + 0.06 * sw) for x, z in pts], 1.0 * sw, 'XZ', bv=0.03, far=0.6, near=0.6)
        # rear thruster pod
        p.tube('B', [S(-0.3 * sw, 0.3 * sw, 0.3 * sw, 0.1 * sw, 0.5, 0.1 * sw), S(-1.05 * sw, 0.26 * sw, 0.26 * sw, 0.1 * sw, 0.55, 0.14 * sw),
                     S(-1.2 * sw, 0.2 * sw, 0.2 * sw, 0.08 * sw, 0.55, 0.14 * sw)], axis='Y', bv=0.03)
        p.cyl('T', 0.15 * sw, 0.06, (0.55, -1.2 * sw - 0.02, 0.14 * sw), axis='Y', n=8)
        p.box('C', (0.1, 0.6 * sw, 0.24 * sw), (cx + 0.69 * sw, 0.02 * sw, -0.04 * sw), (0, rad(-12), 0), bv=0.025)
        # jammer vane
        p.prism('B', [(0.15 * sw, 0.44 * sw), (-1.05 * sw, 0.98 * sw), (-1.25 * sw, 0.88 * sw), (-0.6 * sw, 0.4 * sw)], 0.1, 'YZ', (cx + 0.1, 0, 0), bv=0.03)
        # navigation lamps: rear pod top and the pauldron's rear upper facet
        lamp(face(p, (0.55, -0.8 * sw, 0.14 * sw + 0.265 * sw), (0, 0, 1), up=(0, 1, 0)), w=0.2 * sw, h=0.05 * sw)
        lamp(face(p, (cx + 0.2 * sw, -0.34 * sw, 0.4 * sw), (0.1, -0.3, 1), up=(0, 1, 0.3)), w=0.22 * sw, h=0.05 * sw)
        jline(face(p, (cx + 0.66 * sw, 0, -0.16 * sw), (1, 0, 0.3)), -0.3 * sw, 0.3 * sw, 0.06 * sw, nw=0.14 * sw, nd=0.05 * sw, w=0.06)
        p.box('B', (0.26, 0.3 * sw, 0.24 * sw), (cx + 0.6 * sw, 0.3 * sw, -0.24 * sw), bv=0.035)
        nozzle(R, 'noz_sh_' + X, pa, (cx + 0.6 * sw + 0.16, 0.3 * sw, -0.26 * sw), (0, rad(-75), 0), 0.11 * sw, 0.16 * sw, mirror=mir, n=8, plug=False)
        vent(R, pa, (cx + 0.2 * sw, 0.2 * sw, 0.46 * sw + 0.02), (0.18, 0, 1), (0, -1, 0), 0.34 * sw, 0.36 * sw, mirror=mir, d=0.09)
    else:  # cap (heron): compact shoulder cap with a long tapering outer guard
        cx = 0.28
        dz = -0.06 * sw
        p = p.at((0, 0, dz))
        p.tube('A', [S(-0.3 * sw, 0.44 * sw, 0.5 * sw, 0.14 * sw, cx), S(0.22 * sw, 0.47 * sw, 0.54 * sw, 0.22 * sw, cx),
                     S(0.52 * sw, 0.3 * sw, 0.36 * sw, 0.15 * sw, cx - 0.1)], bv=0.06)
        tq = face(p, (cx - 0.1, 0, 0.52 * sw - 0.01), (0, 0, 1), up=(0, 1, 0))
        stepped(tq, 'B', 0.48 * sw, 0.6 * sw, th=0.1, zs=-0.12 * sw, nw=0.16 * sw, nd=0.06 * sw, cut=0.06 * sw)
        lamp(tq, 0.0, -0.24 * sw, w=0.18 * sw, h=0.04 * sw, y=0.1)
        lamp(face(p, (cx + 0.1, -0.74 * sw, 0.0), (0, -1, 0)), w=0.1, h=0.2 * sw)
        xs = cx + 0.47 * sw
        gp = [(0.5 * sw, 0.3 * sw), (-0.5 * sw, 0.3 * sw), (-0.42 * sw, -0.5 * sw), (-0.06 * sw, -1.25 * sw), (0.34 * sw, -0.5 * sw)]
        p.prism('B', gp, 0.16, 'YZ', (xs + 0.1, 0, 0), (0, rad(-7), 0), bv=0.05)
        p.prism('A', spts(gp, 0.6, 0.62, c=(0.0, -0.1 * sw)), 0.08, 'YZ', (xs + 0.2, 0, 0), (0, rad(-7), 0), bv=0.025)
        p.box('C', (0.07, 0.5 * sw, 0.1), (xs + 0.2, 0.0, 0.2 * sw), (0, rad(-7), 0), bv=0.0)
        p.louvre('B', (cx, 0.54 * sw, -0.04 * sw), (0, 0, 0), 0.46 * sw, 0.24 * sw, n=3, d=0.09, frame='F')
        p.box('B', (0.3, 0.36 * sw, 0.3 * sw), (cx + 0.1, -0.56 * sw, 0.0), bv=0.04)
        p.box('B', (0.3, 0.36 * sw, 0.28 * sw), (xs + 0.22, -0.26 * sw, 0.12 * sw), bv=0.04)
        nozzle(R, 'noz_sh_' + X, pa, (xs + 0.4, -0.26 * sw, 0.1 * sw + dz), (0, rad(-75), 0), 0.12 * sw, 0.17 * sw, mirror=mir, n=8, plug=False)
        vent(R, pa, (cx - 0.1, 0.16 * sw, 0.52 * sw + 0.09 + dz), (0, 0, 1), (0, -1, 0), 0.34 * sw, 0.3 * sw, mirror=mir)


def sensor_pod(p, base):
    """Kestrel: large scan pod on the right shoulder -- armoured drum with a big round lens."""
    bx, by, bz = base
    cz = bz + 1.1
    cy = by + 0.15
    # turntable + trunnion
    p.cyl('F', 0.46, 0.2, (bx, by, bz + 0.06), n=10)
    p.box('F', (0.6, 0.8, 0.42), (bx, by, bz + 0.3), bv=0.05)
    # armoured housing
    p.tube('B', [S(-0.95, 0.62, 0.56, 0.12, bx, cz), S(-0.7, 0.72, 0.66, 0.14, bx, cz), S(0.75, 0.72, 0.66, 0.14, bx, cz), S(0.95, 0.62, 0.56, 0.12, bx, cz)],
           axis='Y', pos=(0, cy, 0), bv=0.05)
    p.box('A', (1.2, 1.3, 0.14), (bx, cy + 0.0, cz + 0.7), bv=0.045, ty=0.86)
    p.box('A', (0.14, 1.1, 0.8), (bx + 0.76, cy, cz), bv=0.045, ty=0.8)
    p.bolts('F', [(bx + 0.84, cy - 0.36, cz + 0.2), (bx + 0.84, cy + 0.36, cz + 0.2)], (1, 0, 0), r=0.055)
    # main lens barrel
    p.cyl('F', 0.6, 0.5, (bx, cy + 1.1, cz), axis='Y', n=14, bv=0.035)
    p.cyl('T', 0.5, 0.06, (bx, cy + 1.35, cz), axis='Y', n=14)
    p.dome('G', 0.43, 0.12, (bx, cy + 1.37, cz), axis='Y', n=14, m=2)
    # rangefinder + lamp on the inboard side, rear cable, whip
    p.box('B', (0.3, 1.0, 0.34), (bx - 0.86, cy + 0.2, cz + 0.1), bv=0.04)
    p.cyl('T', 0.11, 0.05, (bx - 0.86, cy + 0.71, cz + 0.1), axis='Y', n=8)
    p.dome('G', 0.09, 0.03, (bx - 0.86, cy + 0.73, cz + 0.1), axis='Y', n=8, m=2)
    p.cyl('F', 0.3, 0.2, (bx, cy - 1.02, cz), axis='Y', n=10)
    hose(p, [(bx - 0.2, cy - 1.1, cz - 0.1), (bx - 0.4, cy - 1.25, bz + 0.3), (bx - 0.5, by - 0.9, bz - 0.1)], 0.07)
    p.rod('F', (bx + 0.5, cy - 0.7, cz + 0.7), (bx + 0.58, cy - 0.9, cz + 2.0), 0.03, n=4, r2=0.014)


# =============================================================================================
# BACKPACK
# =============================================================================================
def pack_rear(b, y, zc, w, h, hz_m=None, th=0.11):
    """Backpack rear face (what the chase camera sees): stepped armour plates over a dark backing,
    corner navigation lamps, status lamp, grab handle, optional hazard foot."""
    bq = face(b, (0, y, zc), (0, -1, 0))
    stepped(bq, 'A', w, h, th=th, zs=0.14 * h, nw=0.34 * w, nd=0.12 * h, cut=0.1 * min(w, h))
    for ix in (-1, 1):
        lamp(bq, ix * (w * 0.5 - 0.24), h * 0.33, w=0.1, h=min(0.3, 0.2 * h), y=th)
    lamp(bq, 0, -0.08 * h, w=0.4, h=0.09, y=th)
    bq.handhold('F', (0, th, 0.31 * h), (0, 0, 0), w=0.6, h=0.12)
    if hz_m:
        bq.box(hz_m, (w * 0.5, 0.05, 0.13), (0, th + 0.02, -0.36 * h), bv=0)


def pod_rear(m, x, y, z, w, h):
    pq = face(m, (x, y, z), (0, -1, 0))
    frame_line(pq, w, h, lw=0.055, cut=0.06)
    lamp(pq, 0, 0, w=w * 0.5, h=0.08)


def pod_top(m, x, y, z, w, d, nrm=(0, -0.1, 1)):
    tq = face(m, (x, y, z), nrm, up=(0, 1, 0))
    stepped(tq, 'B', w, d, th=0.11, zs=0.0, nd=0.1, cut=0.07)
    lamp(tq, 0, -d * 0.3, w=w * 0.34, h=0.07, y=0.11)


def pod_side(m, x, y, z, L):
    sq = face(m, (x, y, z), (1, 0, 0))
    jline(sq, -L / 2, L / 2, 0.12, nw=0.34, nd=0.13)
    lamp(sq, L * 0.36, -0.14, w=0.26, h=0.08)


def build_back(R, P):
    tw, thh, td = P['torso_w'], P['torso_h'], P['torso_d']
    kind = P['back']
    R.joint('back', 'waist', (0, -td / 2, P['cz']))
    b = R.pen('back')
    hz_m = 'H' if P.get('hazard', True) else 'C'
    if kind == 'twin':
        b.tube('B', [S(-1.4, 0.22 * tw, 0.34 * thh, 0.25, cv=0.1), S(-0.95, 0.28 * tw, 0.44 * thh, 0.3, cv=0.05), S(0.0, 0.29 * tw, 0.48 * thh, 0.3, cv=0.05)],
               axis='Y', bv=0.05)
        for i in range(5):
            b.box('B', (0.08, 0.9, 0.3), (-0.5 + i * 0.25, -0.6, 0.48 * thh + 0.16), bv=0.0)
        b.box('F', (1.3, 1.0, 0.1), (0, -0.6, 0.48 * thh + 0.06), bv=0.0)
        pack_rear(b, -1.4, 0.1, 0.4 * tw, 0.6 * thh, hz_m)
        for s in (1, -1):
            m = R.pen('back', s < 0)
            px = 0.29 * tw + 0.02
            m.tube('A', [S(-2.3, 0.4, 0.2 * thh, 0.14, px, -0.02), S(-1.95, 0.56, 0.32 * thh, 0.2, px, 0.05), S(-0.5, 0.6, 0.35 * thh, 0.2, px, 0.1)],
                   axis='Y', bv=0.05)
            pod_top(m, px, -1.58, 0.1 + 0.35 * thh - 0.105 - 0.01, 0.92, 0.56)
            pod_side(m, px + 0.59, -1.25, 0.08, 1.2)
            pod_rear(m, px, -2.3, -0.02, 0.6, 0.3 * thh)
            m.cyl('F', 0.26, 0.5 * thh, (px + 0.72, -0.5, 0.0), n=8)
            m.cyl('B', 0.3, 0.1, (px + 0.72, -0.5, 0.2 * thh), n=8)
            nozzle(R, 'noz_back_' + sfx(s), 'back', (px, -2.1, -0.34 * thh - 0.22), (rad(-50), 0, 0), 0.62, 1.1, mirror=s < 0, n=12)
            vent(R, 'back', (px, -0.66, 0.1 + 0.35 * thh), (0, 0, 1), (0, -1, 0), 0.8, 0.6, mirror=s < 0)
        b.box('F', (0.3, 0.3, 0.3), (-0.2 * tw, -0.9, 0.48 * thh + 0.1), bv=0.03)
        b.rod('F', (-0.2 * tw, -0.9, 0.48 * thh + 0.2), (-0.22 * tw, -1.2, 0.48 * thh + 2.0), 0.035, n=4, r2=0.015)
    elif kind == 'heavy':
        sc = tw / 6.6
        b.tube('B', [S(-2.1, 0.3 * tw, 0.4 * thh, 0.3, cv=0.2), S(-1.5, 0.37 * tw, 0.52 * thh, 0.35, cv=0.15), S(0.0, 0.38 * tw, 0.56 * thh, 0.35, cv=0.15)],
               axis='Y', bv=0.055)
        for i in range(7):
            b.box('B', (0.08, 1.3, 0.34), (-0.75 + i * 0.25, -0.85, 0.15 + 0.56 * thh + 0.16), bv=0.0)
        b.box('F', (1.9, 1.4, 0.1), (0, -0.85, 0.15 + 0.56 * thh + 0.04), bv=0.0)
        pack_rear(b, -2.1, 0.2 + 0.2 * thh, 0.54 * tw, 0.36 * thh, hz_m, th=0.12)
        frame_line(face(b, (0, -2.1, 0.2 - 0.16 * thh), (0, -1, 0)), 0.36, 0.3 * thh, lw=0.06, cut=0.06)
        for s in (1, -1):
            m = R.pen('back', s < 0)
            X = sfx(s)
            ox = 0.4 * tw + 0.25
            m.tube('A', [S(-2.75, 0.5, 0.26 * thh, 0.16, 0.9 * sc, -0.12 * thh), S(-2.3, 0.66, 0.36 * thh, 0.2, 0.9 * sc, -0.1 * thh),
                         S(-1.2, 0.7, 0.4 * thh, 0.2, 0.9 * sc, -0.08 * thh)], axis='Y', bv=0.05)
            m.tube('A', [S(-2.0, 0.42, 0.24 * thh, 0.14, ox, 0.0), S(-1.6, 0.52, 0.3 * thh, 0.18, ox, 0.05),
                         S(-0.3, 0.55, 0.34 * thh, 0.18, ox, 0.1)], axis='Y', bv=0.05)
            pod_side(m, ox + 0.54, -1.05, 0.08, 1.2)
            pod_top(m, ox, -1.6, 0.05 + 0.3 * thh - 0.02, 0.9, 0.56, nrm=(0, -0.05, 1))
            pod_rear(m, ox, -2.0, 0.0, 0.62, 0.36 * thh)
            pod_rear(m, 0.9 * sc, -2.75, -0.12 * thh, 0.76, 0.4 * thh)
            lamp(face(m, (0.9 * sc, -2.52, 0.2 * thh), (0, -0.67, 0.74), up=(0, 0.74, 0.67)), w=0.5, h=0.09)
            # propellant bottle
            m.cyl('F', 0.36, 0.6 * thh, (ox, -0.75, 0.5 * thh), n=10)
            m.dome('F', 0.36, 0.2, (ox, -0.75, 0.8 * thh), n=10, m=2)
            m.cyl('B', 0.4, 0.12, (ox, -0.75, 0.6 * thh), n=10)
            hose(m, [(ox - 0.3, -0.75, 0.3 * thh), (ox - 0.6, -0.8, 0.5 * thh), (ox - 1.0, -0.8, 0.56 * thh)], 0.07)
            nozzle(R, 'noz_back_' + X, 'back', (0.9 * sc, -2.6, -0.46 * thh - 0.3), (rad(-50), 0, 0), 0.7, 1.2, mirror=s < 0, n=12)
            nozzle(R, 'noz_back_2' + X, 'back', (ox, -1.85, -0.3 * thh - 0.25), (rad(-50), 0, 0), 0.52, 0.95, mirror=s < 0, n=12)
            vent(R, 'back', (0.9 * sc + 0.3, -1.05, 0.15 + 0.56 * thh), (0, 0, 1), (0, -1, 0), 0.8, 0.6, mirror=s < 0)
    elif kind == 'wing':
        b.tube('B', [S(-1.2, 0.2 * tw, 0.3 * thh, 0.2, cv=0.1), S(-0.8, 0.26 * tw, 0.4 * thh, 0.25, cv=0.05), S(0.0, 0.27 * tw, 0.42 * thh, 0.25, cv=0.05)],
               axis='Y', bv=0.05)
        pack_rear(b, -1.2, 0.1, 0.36 * tw, 0.52 * thh, None, th=0.1)
        for i in range(4):
            b.box('B', (0.07, 0.7, 0.24), (-0.3 + i * 0.2, -0.5, 0.42 * thh + 0.15), bv=0.0)
        b.box('F', (0.9, 0.8, 0.08), (0, -0.5, 0.42 * thh + 0.06), bv=0.0)
        for s in (1, -1):
            m = R.pen('back', s < 0)
            X = sfx(s)
            mir = s < 0
            m.tube('A', [S(-1.8, 0.34, 0.2 * thh, 0.12, 0.95, -0.2 * thh), S(-1.45, 0.46, 0.27 * thh, 0.16, 0.95, -0.18 * thh),
                         S(-0.6, 0.5, 0.3 * thh, 0.16, 0.95, -0.14 * thh)], axis='Y', bv=0.045)
            nozzle(R, 'noz_back_' + X, 'back', (0.95, -1.66, -0.44 * thh - 0.3), (rad(-50), 0, 0), 0.5, 0.9, mirror=mir, n=12)
            vent(R, 'back', (0.6, -0.95, 0.05 + 0.36 * thh + 0.02), (0, -0.2, 1), (0, -1, 0), 0.5, 0.45, mirror=mir)
            # binder hinge arm + wing binder
            hx = 0.27 * tw + 1.15          # hinge well outboard: the wing clears a pod on the shoulder mount
            hy_, hzz = -0.95, 0.3 * thh
            m.cyl('F', 0.3, hx - 0.27 * tw + 0.2, ((hx + 0.27 * tw) / 2 - 0.1, hy_, hzz), axis='X', n=10)
            m.box('B', (0.4, 0.8, 0.7), (0.27 * tw + 0.1, hy_ + 0.1, hzz), bv=0.05)
            m.box('B', (0.5, 0.5, 0.5), (hx - 0.45, hy_, hzz), bv=0.05)
            bn = 'binder_' + X
            R.joint(bn, 'back', (hx, hy_, hzz), mirror=mir)
            wg = R.pen(bn, mir).at(rot=(rad(17), rad(18), 0))
            wg.cyl('F', 0.36, 0.5, (0, 0, 0), axis='X', n=10)
            wg.box('F', (0.44, 0.7, 0.9), (0, -0.1, 0.4), bv=0.05)
            wp = [(0.42, 0.5), (0.62, 1.7), (0.5, 3.4), (0.05, 5.2), (-0.5, 6.3), (-0.72, 5.2), (-0.86, 3.3), (-1.42, 2.3), (-1.3, 0.9), (-0.7, 0.3)]
            wg.prism('A', wp, 0.4, 'YZ', bv=0.05, far=0.7, near=0.7, c=(-0.3, 2.6))
            for sx in (1, -1):
                # stepped plates and a navigation lamp on both faces of the wing
                stepped(face(wg, (sx * 0.2, -0.32, 2.4), (sx, 0, 0)), 'B', 1.0, 1.6, th=0.07, zs=0.12, nd=0.16, cut=0.2)
                lamp(face(wg, (sx * 0.2, -0.32, 4.3), (sx, 0, 0)), w=0.34, h=0.09)
            wg.prism('C', [(0.3, 4.6), (-0.02, 5.3), (-0.5, 5.3), (-0.66, 4.6)], 0.34, 'YZ', bv=0.02, far=0.8, near=0.8)
            pod_rear(m, 0.95, -1.8, -0.2 * thh, 0.5, 0.3 * thh)
            wg.rod('F', (0, 0.42, 0.6), (0, 0.44, 4.3), 0.07, n=5)
            wg.tube('B', [S(-0.2, 0.3, 0.42, 0.12, cv=-1.25), S(0.5, 0.36, 0.5, 0.14, cv=-1.3), S(1.5, 0.3, 0.4, 0.12, cv=-1.45)], bv=0.035)
            Mn = wg.M @ xf((0, -1.3, -0.25), (rad(-60), 0, 0))
            nozzle(R, 'noz_binder_' + X, bn, r=0.3, length=0.55, mirror=mir, n=10, plug=False, M=Mn)
    else:  # tank (heron): central propellant tank, twin nozzles, long stabiliser binders
        b.tube('B', [S(-1.1, 0.19 * tw, 0.28 * thh, 0.2, cv=0.0), S(-0.75, 0.25 * tw, 0.38 * thh, 0.25, cv=0.0), S(0.0, 0.26 * tw, 0.42 * thh, 0.25, cv=0.05)],
               axis='Y', bv=0.05)
        for i in range(4):
            b.box('B', (0.07, 0.6, 0.22), (-0.3 + i * 0.2, -0.42, 0.42 * thh + 0.14), bv=0.0)
        # tank cradle + tank (axis runs back and slightly up)
        tk = b.at((0, -0.9, 0.12 * thh), (rad(-14), 0, 0))
        tr = 0.9
        tk.box('F', (1.2, 1.4, 0.5), (0, -0.7, -0.75), bv=0.05)
        tk.lathe('B', [(0.0, 0.0), (0.5 * tr, 0.0), (0.86 * tr, 0.22), (tr, 0.6), (tr, 3.5), (0.86 * tr, 3.9), (0.5 * tr, 4.14), (0.0, 4.2)],
                 (0, 0.3, 0), axis='Y', rot=(0, 0, pi), n=14)
        for yy in (-0.9, -2.3, -3.1):
            tk.cyl('A', tr + 0.05, 0.22, (0, yy, 0), axis='Y', n=14, bv=0.03)
        tk.cyl('F', 0.26, 0.2, (0, -3.95, 0), axis='Y', n=8)
        tk.cyl('F', 0.16, 0.2, (0.3, -2.0, tr - 0.02), n=8)
        hose(tk, [(0.5, -1.2, -0.5), (0.9, -0.9, -0.7), (1.0, -0.2, -0.6)], 0.08)
        hose(tk, [(-0.5, -1.2, -0.5), (-0.9, -0.9, -0.7), (-1.0, -0.2, -0.6)], 0.08)
        # tank lamps: top (the chase camera looks down on it), both flanks, rear boss; filler hatch outline
        tq = face(tk, (0, -1.6, tr - 0.01), (0, 0, 1), up=(0, 1, 0))
        frame_line(tq, 0.6, 0.6, lw=0.06, cut=0.12)
        lamp(tq, 0, -1.2, w=0.44, h=0.1)
        for ix in (-1, 1):
            lamp(face(tk, (ix * (tr - 0.01), -3.3, 0.1), (ix, 0, 0)), w=0.4, h=0.09)
        lamp(face(tk, (0, -4.05, 0), (0, -1, 0)), w=0.2, h=0.2)
        for s in (1, -1):
            m = R.pen('back', s < 0)
            X = sfx(s)
            mir = s < 0
            m.tube('A', [S(-1.7, 0.34, 0.2 * thh, 0.12, 1.0, -0.24 * thh), S(-1.35, 0.46, 0.27 * thh, 0.16, 1.0, -0.22 * thh),
                         S(-0.5, 0.5, 0.3 * thh, 0.16, 1.0, -0.18 * thh)], axis='Y', bv=0.045)
            nozzle(R, 'noz_back_' + X, 'back', (1.0, -1.56, -0.5 * thh - 0.3), (rad(-50), 0, 0), 0.5, 0.9, mirror=mir, n=12)
            vent(R, 'back', (0.72, -0.6, 0.42 * thh + 0.02), (0, 0, 1), (0, -1, 0), 0.44, 0.4, mirror=mir)
            hx = 0.26 * tw + 0.75
            hy_, hzz = -0.75, 0.1 * thh
            m.cyl('F', 0.26, hx - 0.26 * tw + 0.2, ((hx + 0.26 * tw) / 2 - 0.1, hy_, hzz), axis='X', n=10)
            m.box('B', (0.4, 0.7, 0.6), (0.26 * tw + 0.1, hy_ + 0.05, hzz), bv=0.05)
            bn = 'binder_' + X
            R.joint(bn, 'back', (hx, hy_, hzz), mirror=mir)
            # rest: swept down and back, splayed outward so the game's boost fold (binder pitches ~31 deg) clears the legs
            wg = R.pen(bn, mir).at(rot=(rad(142), rad(-16), 0))
            wg.cyl('F', 0.3, 0.46, (0, 0, 0), axis='X', n=10)
            wg.box('F', (0.36, 0.6, 0.8), (0, 0.0, 0.4), bv=0.05)
            fp = [(0.4, 0.5), (0.5, 2.0), (0.34, 4.6), (0.0, 6.6), (-0.3, 6.9), (-0.52, 4.6), (-0.6, 2.0), (-0.5, 0.5)]
            wg.prism('B', fp, 0.3, 'YZ', bv=0.05, far=0.6, near=0.6, c=(0.0, 3.0))
            for sx in (1, -1):
                stepped(face(wg, (sx * 0.15, -0.05, 2.5), (sx, 0, 0)), 'A', 0.62, 2.2, th=0.07, zs=0.2, nw=0.22, nd=0.18, cut=0.12)
                lamp(face(wg, (sx * 0.15, -0.06, 4.35), (sx, 0, 0)), w=0.28, h=0.09)
            pod_rear(m, 1.0, -1.7, -0.24 * thh, 0.5, 0.3 * thh)
            wg.prism('C', [(0.2, 5.0), (0.05, 5.8), (-0.36, 5.8), (-0.44, 5.0)], 0.2, 'YZ', bv=0.02, far=0.8, near=0.8)
            wg.rod('F', (0, 0.3, 0.6), (0, 0.24, 4.4), 0.06, n=5)


# =============================================================================================
def build_frame(P):
    P = derive(P)
    R = Rig(seed=P.get('seed', 1))
    build_pelvis(R, P)
    for s in (-1, 1):
        build_leg(R, P, s)
    build_torso(R, P)
    for s in (-1, 1):
        build_arm(R, P, s)
    build_back(R, P)
    return R, P
