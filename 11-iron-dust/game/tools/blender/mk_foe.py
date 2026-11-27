# mk_foe.py -- enemy tactical-frame part library (IRON DUST). Original designs.
# Blender authoring space: +Z up, +Y front, +X = mech's right. Parts are authored for the right
# side and mirrored for the left.
#
# Enemy design language: rounded armour volumes (super-ellipse lofts), hollow bell shins, spikes,
# ribbed power cables and a single round sensor behind a slit; the EX ace frame is the faceted,
# bladed counterpart.  Style keys per frame (see build_foes.FRAMES):
#   leg   : flare | hover | bulb | blade        chest : cuirass | bulwark | cowl | keel
#   head  : sallet | pot | cowl | crest         arm   : round | heavy | gauntlet | angular
#   sh_R / sh_L : spike | slab | spike2 | ball | fin                back : pack | heavy | hump | wing
from math import radians as rad, sin, cos, pi, atan2, sqrt
from mathutils import Vector
from mk_geo import Rig, S, xf, I4, frame_m


def sfx(s):
    return 'R' if s > 0 else 'L'


# =============================================================================================
# TOOLKIT
# =============================================================================================
def _sp(v, k):
    return (abs(v) ** k) * (1.0 if v >= 0 else -1.0)


def ring(hw, hf, hb=None, cx=0.0, cy=0.0, e=2.5, n=16, ph=None):
    """Super-ellipse outline: half width hw (u), front depth hf (+v), rear depth hb (-v)."""
    hb = hf if hb is None else hb
    ph = pi / n if ph is None else ph
    k = 2.0 / e
    out = []
    for i in range(n):
        c, s = cos(ph + 2 * pi * i / n), sin(ph + 2 * pi * i / n)
        out.append((cx + hw * _sp(c, k), cy + (hf if s >= 0 else hb) * _sp(s, k)))
    return out


def _n7(s, e=2.5):
    s = list(s)
    if len(s) < 4 or s[3] is None:
        s = s[:3] + [s[2]] + s[4:]
    while len(s) < 6:
        s.append(0.0)
    if len(s) < 7:
        s.append(e)
    return s


def st_at(st, t, j, e=2.5):
    """Field j (1 hw, 2 hf, 3 hb, 4 cx, 5 cy, 6 e) of a loft station list at t."""
    st = [_n7(s, e) for s in st]
    for a, b in zip(st, st[1:]):
        if min(a[0], b[0]) - 1e-9 <= t <= max(a[0], b[0]) + 1e-9:
            k = (t - a[0]) / (b[0] - a[0]) if abs(b[0] - a[0]) > 1e-9 else 0.0
            return a[j] + (b[j] - a[j]) * k
    return (st[0] if abs(t - st[0][0]) < abs(t - st[-1][0]) else st[-1])[j]


def loft(p, mat, st, axis='Z', n=16, e=2.5, bv=0.0, grooves=(), gd=0.045, gw=0.07, pos=(0, 0, 0), rot=(0, 0, 0),
         lip0=None, lip1=None, ph=None):
    """Rounded loft. st = [(t, hw, hf, hb, cx, cy, e)] (trailing fields optional).
    axis Z: (u, v) = (x, y);  Y: (x, z);  X: (y, z).  bv chamfers the two ends, lip = (wall, depth) hollows an end,
    grooves = recessed panel lines at the given t."""
    st = [_n7(s, e) for s in st]
    st0 = [list(a) for a in st]

    def shrink(a, d, t=None):
        return [a[0] if t is None else t, a[1] - d, a[2] - d, a[3] - d] + a[4:]

    def at(t):
        return [t] + [st_at(st0, t, j) for j in range(1, 7)]
    sg0 = 1.0 if st[1][0] > st[0][0] else -1.0
    sg1 = 1.0 if st[-1][0] > st[-2][0] else -1.0
    head, tail = [], []
    if lip0:
        head = [shrink(at(st[0][0] + sg0 * lip0[1]), lip0[0] * 1.3), shrink(st[0], lip0[0])]
    elif bv > 0:
        head = [shrink(st[0], bv)]
        st[0] = shrink(st[0], 0.0, st[0][0] + sg0 * bv)
    if lip1:
        tail = [shrink(st[-1], lip1[0]), shrink(at(st[-1][0] - sg1 * lip1[1]), lip1[0] * 1.3)]
    elif bv > 0:
        tail = [shrink(st[-1], bv)]
        st[-1] = shrink(st[-1], 0.0, st[-1][0] - sg1 * bv)
    seq = list(head)
    for i, a in enumerate(st):
        seq.append(a)
        if i + 1 < len(st):
            b = st[i + 1]
            sg = 1.0 if b[0] > a[0] else -1.0
            lo, hi = min(a[0], b[0]), max(a[0], b[0])
            for g in sorted([g for g in grooves if lo + gw < g < hi - gw], reverse=sg < 0):
                for tt, dd in ((g - sg * gw / 2, 0.0), (g - sg * gw / 2, gd), (g + sg * gw / 2, gd), (g + sg * gw / 2, 0.0)):
                    k = (tt - a[0]) / (b[0] - a[0])
                    seq.append(shrink([a[j] + (b[j] - a[j]) * k for j in range(7)], dd, tt))
    seq.extend(tail)

    def mp(u, v, t):
        if axis == 'Z':
            return (u, v, t)
        if axis == 'Y':
            return (u, t, v)
        return (t, u, v)
    rings = []
    for t, hw, hf, hb, cx, cy, ee in seq:
        rings.append([mp(u, v, t) for u, v in ring(max(0.01, hw), max(0.01, hf), max(0.01, hb), cx, cy, ee, n, ph)])
    p._rings(mat, rings, xf(pos, rot))


def skin_plate(p, mat, st, rows, lift=0.05, th=0.16, m=4, side='F', e=2.5, ch=0.05):
    """Applique plate hugging one side of a Z-loft (same station list).  rows = [(z, a0, a1)] with a = x for the
    front/back sides ('F', 'B') and a = y for the outer/inner sides ('X', 'N')."""
    st = [_n7(s, e) for s in st]
    full = []
    for (z0, a0, a1), (z1, b0, b1) in zip(rows, rows[1:]):
        full.append((z0, a0, a1))
        for t in sorted([q[0] for q in st if min(z0, z1) + 0.02 < q[0] < max(z0, z1) - 0.02], reverse=z1 < z0):
            k = (t - z0) / (z1 - z0)
            full.append((t, a0 + (b0 - a0) * k, a1 + (b1 - a1) * k))
    full.append(rows[-1])
    rings = []
    for z, a0, a1 in full:
        hw, hf, hb, cx, cy, ee = (st_at(st, z, j) for j in (1, 2, 3, 4, 5, 6))

        def f(a, d=0.0):
            if side in 'FB':
                u = min(0.995, abs((a - cx) / hw))
                r = (hf if side == 'F' else hb) * (1.0 - u ** ee) ** (1.0 / ee) + lift - d
                return (a, cy + r if side == 'F' else cy - r, z)
            u = min(0.995, abs((a - cy) / (hf if a >= cy else hb)))
            r = hw * (1.0 - u ** ee) ** (1.0 / ee) + lift - d
            return (cx + r if side == 'X' else cx - r, a, z)
        c = ch if a1 > a0 else -ch
        mid = [a0 + (a1 - a0) * k / m for k in range(1, m)]
        outer = [f(a0, ch), f(a0 + c)] + [f(a) for a in mid] + [f(a1 - c), f(a1, ch)]
        inner = [f(a, th) for a in [a1] + mid[::-1] + [a0]]
        rings.append(outer + inner)
    p._rings(mat, rings, I4)


def arc_plate(q, mat, st, xr, bulge, th=0.18, y0=0.0, m=6, ch=0.06):
    """Free-hanging curved plate: hinge along X, hangs -Z, outward +Y. st = [(z, x0, x1, yoff)];
    outer surface y = y0 + yoff + bulge * (1 - (x / xr)^2), wall th toward -Y. m = 2 gives a creased, angular plate."""
    rings = []
    for z, x0, x1, yo in st:
        def f(x, d=0.0):
            return (x, y0 + yo + bulge * (1.0 - (x / xr) ** 2) - d, z)
        mid = [x0 + (x1 - x0) * k / m for k in range(1, m)]
        outer = [f(x0, ch), f(x0 + ch)] + [f(x) for x in mid] + [f(x1 - ch), f(x1, ch)]
        inner = [f(x, th) for x in [x1] + mid[::-1] + [x0]]
        rings.append(outer + inner)
    q._rings(mat, rings, I4)


def sweep(p, mat, pts, radii, n=6):
    """Round section swept along a polyline (parallel-transport frames)."""
    pts = [Vector(q) for q in pts]
    m = len(pts)
    if isinstance(radii, (int, float)):
        radii = [radii] * m
    nrm = None
    rings = []
    for i in range(m):
        t = (pts[min(i + 1, m - 1)] - pts[max(i - 1, 0)]).normalized()
        nrm = t.orthogonal().normalized() if nrm is None else (nrm - t * nrm.dot(t)).normalized()
        b = t.cross(nrm)
        rings.append([tuple(pts[i] + (nrm * cos(2 * pi * k / n) + b * sin(2 * pi * k / n)) * radii[i]) for k in range(n)])
    p._rings(mat, rings, I4)


def spline(ctrl, step=0.14):
    c = [Vector(q) for q in ctrl]
    c = [c[0] * 2 - c[1]] + c + [c[-1] * 2 - c[-2]]
    out = []
    for i in range(1, len(c) - 2):
        p0, p1, p2, p3 = c[i - 1], c[i], c[i + 1], c[i + 2]
        k = max(2, int((p2 - p1).length / step))
        for j in range(k):
            t = j / k
            out.append(0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(c[-2])
    return out


def cable(p, mat, ctrl, r, n=6, step=0.14, rib=0.76, sock=None):
    """Ribbed power cable through the control points; optional socket collars at both ends."""
    pts = spline(ctrl, step)
    sweep(p, mat, pts, [r if i % 2 == 0 else r * rib for i in range(len(pts))], n)
    if sock:
        for a, b in ((pts[0], pts[1]), (pts[-1], pts[-2])):
            d = (b - a).normalized()
            p.rod(sock, a - d * 0.1, a + d * 0.16, r * 1.4, n=8)


def spike(p, mat, base, d, r, h, n=8, collar=None):
    """Ogive spike standing on 'base' along direction d."""
    rot = tuple(Vector((0, 0, 1)).rotation_difference(Vector(d).normalized()).to_euler('XYZ'))
    p.lathe(mat, [(r, -0.05), (r, 0.0), (0.86 * r, 0.26 * h), (0.56 * r, 0.62 * h), (0.2 * r, 0.93 * h), (0.0, h)], base, 'Z', rot, n)
    if collar:
        p.lathe(collar, [(1.34 * r, -0.06), (1.34 * r, 0.08 * r + 0.05), (1.04 * r, 0.16 * r + 0.1)], base, 'Z', rot, n)


def shell_dome(p, mat, r, h, th=0.12, base=0.0, pos=(0, 0, 0), axis='Z', rot=(0, 0, 0), n=16, m=4, scale=(1, 1, 1), flare=0.0):
    """Hollow dome (open underneath): apex at z = h, rim at z = -base."""
    prof = [(0.0, h - th)]
    for k in range(m - 1, 0, -1):
        a = (pi / 2) * k / m
        prof.append(((r - th) * cos(a), (h - th) * sin(a)))
    prof.append((r - th, 0.0))
    if base > 0:
        prof.append((r - th + flare, -base))
        prof.append((r + flare, -base))
    prof.append((r, 0.0))
    for k in range(1, m):
        a = (pi / 2) * k / m
        prof.append((r * cos(a), h * sin(a)))
    prof.append((0.0, h))
    p.lathe(mat, prof, pos, axis, rot, n, scale)


def band(p, mat, r, z0, z1, t=0.06, pos=(0, 0, 0), axis='Z', rot=(0, 0, 0), n=16, scale=(1, 1, 1)):
    """Raised hoop around a round part."""
    p.lathe(mat, [(r - 0.04, z0), (r + t, z0), (r + t, z1), (r - 0.04, z1)], pos, axis, rot, n, scale)


def lens(p, pos, r, axis='Y', d=0.12, rim='F', rot=(0, 0, 0)):
    """Round sensor: bezel + glowing lens facing +axis."""
    p.cyl(rim, r * 1.4, d, pos, axis=axis, rot=rot, n=10)
    q = p.at(pos, rot)
    off = {'X': (d / 2, 0, 0), 'Y': (0, d / 2, 0), 'Z': (0, 0, d / 2)}[axis]
    q.cyl('T', r * 1.12, 0.02, off, axis=axis, n=10)
    q.dome('G', r, r * 0.5, off, axis=axis, n=10, m=2)


def vent(R, parent, pos, normal, down, w, h, mirror=False, flap='A', d=0.11):
    """Hinged overdrive flap (node vent_N: local X hinge, +Y outward, flap toward -Z) over a glowing recess."""
    R.vent_n += 1
    nm = 'vent_%d' % R.vent_n
    ya = Vector(normal).normalized()
    za = -Vector(down)
    za = (za - ya * za.dot(ya)).normalized()
    xa = ya.cross(za)
    M = frame_m(Vector(pos) + ya * d, xa, ya, za)
    st = R.pen(parent, mirror, M)
    st.box('T', (w + 0.1, d, h + 0.1), (0, -d / 2 - 0.04, -h / 2), bv=0)
    ns = max(2, int(h / 0.16))
    for i in range(ns):
        st.box('G', (w * 0.82, 0.03, h / ns * 0.45), (0, -0.035, -h * (i + 0.5) / ns), bv=0)
    R.joint(nm, parent, M=M, mirror=mirror)
    fp = R.pen(nm, mirror)
    fp.box(flap, (w + 0.16, 0.06, h + 0.14), (0, 0.02, -h / 2 - 0.01), bv=0.02)
    fp.cyl(flap, 0.05, w * 0.8, (0, 0.03, 0.05), axis='X', n=6)
    return nm


def ring_bolts(p, mat, c, axis, r, n, br=0.06, ph=0.0, h=0.05):
    """n bolts on a circle of radius r around c, heads facing +axis."""
    for i in range(n):
        a = ph + 2 * pi * i / n
        if axis == 'X':
            p.bolt(mat, (c[0], c[1] + r * cos(a), c[2] + r * sin(a)), (1, 0, 0), r=br, h=h)
        elif axis == 'Y':
            p.bolt(mat, (c[0] + r * cos(a), c[1], c[2] + r * sin(a)), (0, 1, 0), r=br, h=h)
        else:
            p.bolt(mat, (c[0] + r * cos(a), c[1] + r * sin(a), c[2]), (0, 0, 1), r=br, h=h)


def _pw(pts, x):
    """Piecewise-linear lookup in [(x, y)]."""
    if not pts:
        return 0.0
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / max(1e-9, x1 - x0)
    return pts[-1][1]


def inset(st, d, e=2.5):
    """Station list shrunk by d: the dark inner shell that shows in the seams between cut plates."""
    return [[a[0], a[1] - d, a[2] - d, a[3] - d] + a[4:] for a in (_n7(q, e) for q in st)]


def grid_plate(p, mat, f, a0, a1, t0, t1, top=(), bot=(), left=(), right=(), lift=0.0, th=0.1, da=16.0, dt=0.55, tks=()):
    """Solid plate cut out of a parametric surface f(a, t, d) -> point (d = offset along the normal).
    Region a0..a1 x t0..t1.  top / bot = [(u, dt)] offsets of the t0 / t1 edges across the plate (u 0..1) and
    left / right = [(v, da)] offsets of the a0 / a1 edges along it: they step the seams in trapezoids."""
    nu = max(1, int(abs(a1 - a0) / da + 0.999))
    bu = sorted(set([0.0, 1.0] + [round(u, 4) for u, _ in list(top) + list(bot)]))
    us = sorted(set(bu + [q for q in (round(i / nu, 4) for i in range(nu + 1)) if min(abs(q - b) for b in bu) > 0.6 / nu]))
    nv = max(1, int(abs(t1 - t0) / dt + 0.999))
    vs = [round(i / nv, 4) for i in range(nv + 1)] + [round(v, 4) for v, _ in list(left) + list(right)]
    bk = [round((q - t0) / (t1 - t0), 4) for q in tks if min(t0, t1) + 0.03 < q < max(t0, t1) - 0.03]
    vs = sorted(set([0.0, 1.0] + bk + [q for q in vs if not bk or min(abs(q - b) for b in bk) > 0.5 / nv]))

    def pt(u, v, d):
        t = (t0 + _pw(top, u)) * (1 - v) + (t1 + _pw(bot, u)) * v
        return f((a0 + _pw(left, v)) * (1 - u) + (a1 + _pw(right, v)) * u, t, d)
    nU, nV = len(us), len(vs)
    N = nU * nV
    verts = [pt(u, v, lift) for v in vs for u in us] + [pt(u, v, lift - th) for v in vs for u in us]
    faces = []
    for j in range(nV - 1):
        for i in range(nU - 1):
            a = j * nU + i
            faces.append((a, a + 1, a + nU + 1, a + nU))
            faces.append((N + a, N + a + nU, N + a + nU + 1, N + a + 1))
    for i in range(nU - 1):
        a = i
        faces.append((a, N + a, N + a + 1, a + 1))
        a = (nV - 1) * nU + i
        faces.append((a, a + 1, N + a + 1, N + a))
    for j in range(nV - 1):
        a = j * nU
        faces.append((a, a + nU, N + a + nU, N + a))
        a = j * nU + nU - 1
        faces.append((a, N + a, N + a + nU, a + nU))
    p.emit(mat, verts, faces)


def loft_f(st, e=2.5, axis='Z'):
    """Surface function of a loft for grid_plate: a = angle in degrees (0 = +u / outboard, 90 = +v / front)."""
    st = [_n7(q, e) for q in st]

    def f(a, t, d):
        hw, hf, hb, cx, cy, ee = (st_at(st, t, j) for j in (1, 2, 3, 4, 5, 6))
        c, sn_ = cos(rad(a)), sin(rad(a))
        u = cx + (hw + d) * _sp(c, 2.0 / ee)
        v = cy + ((hf if sn_ >= 0 else hb) + d) * _sp(sn_, 2.0 / ee)
        return (u, v, t) if axis == 'Z' else ((u, t, v) if axis == 'Y' else (t, u, v))
    return f


def panel(p, mat, st, a0, a1, t0, t1, e=2.5, axis='Z', **kw):
    """Armour plate cut out of the surface of a loft (same station list)."""
    grid_plate(p, mat, loft_f(st, e, axis), a0, a1, t0, t1, tks=[q[0] for q in st], **kw)


def shell(p, st, zs, sectors, e=2.5, gap=0.1, lift=0.0, th=0.1):
    """Tile a loft with cut plates.  zs = tier boundaries along the axis, sectors = [(a0, a1, (mat per tier), tab)];
    tab = [(u, dt)] is the trapezoid step shared by the seams between that sector's tiers."""
    f = loft_f(st, e)
    tk = [q[0] for q in st]
    sg = 1.0 if zs[-1] > zs[0] else -1.0
    for a0, a1, mats, tab in sectors:
        for k in range(len(zs) - 1):
            if mats[k] is None:
                continue
            grid_plate(p, mats[k], f, a0, a1, zs[k] + (sg * gap / 2 if k > 0 else 0.0), zs[k + 1] - (sg * gap / 2 if k < len(zs) - 2 else 0.0),
                       top=tab if (tab and k > 0) else (), bot=tab if (tab and k < len(zs) - 2) else (), lift=lift, th=th, tks=tk)


def dome_f(r, h, base, flare, pos):
    """Surface function of a shell_dome: a = longitude (deg), t >= 0 latitude (deg), t in [-1, 0) down the skirt."""
    def f(a, t, d):
        if t >= 0:
            rr, z = (r + d) * cos(rad(min(t, 89.9))), (h + d) * sin(rad(min(t, 89.9)))
        else:
            rr, z = r + d + flare * (-t), t * base
        return (pos[0] + rr * cos(rad(a)), pos[1] + rr * sin(rad(a)), pos[2] + z)
    return f


def lamp(p, pos, nrm, up, w=0.3, h=0.12):
    """Flush indicator light: glowing bar (w across, h along 'up') in a dark bezel on a surface with normal nrm."""
    n = Vector(nrm).normalized()
    u = Vector(up)
    u = (u - n * u.dot(n)).normalized()
    q = p.__class__(p.rig, p.joint, p.mirror, p.M @ frame_m(Vector(pos), n.cross(u), n, u))
    q.box('T', (w + 0.1, 0.1, h + 0.1), (0, -0.01, 0), bv=0)
    q.box('G', (w, 0.06, h), (0, 0.025, 0), bv=0)


def groove_fill(p, st, t, e=2.5, n=16, d=0.03, w=0.1):
    """Dark floor inside a loft groove at t (deep, readable panel line)."""
    loft(p, 'T', [[t - w / 2] + [st_at(st, t, j, e) - (d if j < 4 else 0.0) for j in (1, 2, 3, 4, 5)],
                  [t + w / 2] + [st_at(st, t, j, e) - (d if j < 4 else 0.0) for j in (1, 2, 3, 4, 5)]], n=n, e=e)


def gtube(p, mat, st, grooves=(), **kw):
    """Pen.tube with wide, deep grooves whose floor is dark (key T): heavy panel lines on faceted parts."""
    kw.setdefault('gd', 0.06)
    kw.setdefault('gw', 0.11)
    p.tube(mat, st, grooves=grooves, **kw)
    ss = sorted(st, key=lambda q: q[0])
    d = 0.55 * kw['gd']
    for g in grooves:
        for a, b in zip(ss, ss[1:]):
            if a[0] < g < b[0]:
                k = (g - a[0]) / (b[0] - a[0])
                v = [a[i] + (b[i] - a[i]) * k for i in range(7)]
                p.tube('T', [(g - 0.09, v[1] - d, v[2] - d, v[3], v[4], v[5], v[6]), (g + 0.09, v[1] - d, v[2] - d, v[3], v[4], v[5], v[6])],
                       axis=kw.get('axis', 'Z'))


def seam(p, pts, nrm, w=0.08):
    """Stepped dark panel line through pts on a flat face."""
    for a, b in zip(pts, pts[1:]):
        p.line('T', a, b, nrm, w=w)


def derive(P):
    P = dict(P)
    lg = P['lg'] = P['leg_w'] * 1.12
    P.setdefault('ah', 1.05 + 0.3 * P['leg_w'])
    P['hip_z'] = P['ah'] + P['shin'] + P['thigh']
    P['z0'] = 0.6 * lg
    P.setdefault('wz', P['z0'] + 0.5)
    P.setdefault('zb', 1.35)
    P['zt'] = P['zb'] + P['torso_h']
    P['cz'] = P['zb'] + P['torso_h'] / 2
    P.setdefault('shx', P['torso_w'] / 2 + 1.0)
    P.setdefault('shz', P['cz'] + P['torso_h'] * 0.2)
    P.setdefault('UA', 3.3)
    P.setdefault('FA', 3.2)
    P.setdefault('sh_R', P.get('sh'))
    P.setdefault('sh_L', P.get('sh'))
    P['yf'] = 1.0 * lg + 0.42
    P['yb'] = -(0.72 * lg + 0.42)
    P['xo'] = P['hip_w'] + 0.9 * lg + 0.12
    if P['chest'] in ('cuirass', 'bulwark'):
        P['waist_r'] = (0.31 * P['torso_w'] - 0.1, 0.39 * P['torso_d'] - 0.06, 0.39 * P['torso_d'] - 0.2)
    elif P['chest'] == 'cowl':
        P['waist_r'] = (1.5, 1.45, 1.4)
    return P


# =============================================================================================
# PELVIS + SKIRTS
# =============================================================================================
def skirt(q, w, l, P, where, ob=1):
    """Local: hinge along X at origin, plate hangs -Z, outward normal +Y. ob = sign of outboard X."""
    fam = P['fam']
    xr = 0.54 * w
    if fam == 'ex':
        def yo(z):
            return 0.12 * min(1.0, -z / (0.7 * l))
        rows = [(0.02, -0.5, 0.5), (-0.42 * l, -0.5, 0.52), (-0.7 * l, -0.4, 0.46), (-1.0 * l, -0.02, 0.3), (-1.16 * l, 0.14, 0.22)]
        st = [(z, min(a * ob, b * ob) * w, max(a * ob, b * ob) * w, yo(z)) for z, a, b in rows]
        arc_plate(q, 'A', st, xr, 0.13 * w, th=0.2, y0=0.22, m=2)
        st2 = [(z, min(a * ob, b * ob) * w, max(a * ob, b * ob) * w, yo(z) + 0.06)
               for z, a, b in ((-0.16 * l, -0.34, 0.36), (-0.42 * l, -0.34, 0.4), (-0.66 * l, -0.24, 0.36), (-0.95 * l, 0.04, 0.26))]
        arc_plate(q, 'C' if where == 'F' else 'B', st2, xr, 0.13 * w, th=0.12, y0=0.22, m=2, ch=0.04)
        q.bolts('F', [(-0.38 * w, 0.24, -0.1 * l), (0.38 * w, 0.24, -0.1 * l)], (0, 1, 0), r=0.055)
    else:
        def yo(z):
            return 0.14 * min(1.0, -z / (0.85 * l))
        st = [(0.02, -0.46 * w, 0.46 * w, 0.0), (-0.1 * l, -0.5 * w, 0.5 * w, yo(-0.1 * l)), (-0.66 * l, -0.52 * w, 0.52 * w, yo(-0.66 * l)),
              (-0.88 * l, -0.45 * w, 0.45 * w, 0.14), (-0.98 * l, -0.31 * w, 0.31 * w, 0.14), (-1.02 * l, -0.26 * w, 0.26 * w, 0.08)]
        arc_plate(q, 'A', st, xr, 0.17 * w, th=0.2, y0=0.22, m=6)
        if P.get('skirt_heavy'):
            for ix in (-1, 1):
                for iz in range(3):
                    zz = -0.26 * l - iz * 0.22 * l
                    yy = 0.22 + yo(zz) + 0.17 * w * (1.0 - (0.21 * w / xr) ** 2)
                    q.box('B', (0.34 * w, 0.14, 0.17 * l), (ix * 0.21 * w, yy, zz), (rad(-3), 0, ix * rad(-10)), bv=0.035)
            for ix in (-0.4, 0.0, 0.4):
                q.bolt('F', (ix * w, 0.22 + 0.14 + 0.17 * w * (1.0 - (ix * w / xr) ** 2), -0.9 * l), (0, 1, 0), r=0.07)
        else:
            st2 = [(z, a * w, b * w, yo(z) + 0.06) for z, a, b in ((-0.2 * l, -0.26, 0.26), (-0.3 * l, -0.36, 0.36), (-0.66 * l, -0.38, 0.38),
                                                                   (-0.84 * l, -0.3, 0.3), (-0.9 * l, -0.2, 0.2))]
            arc_plate(q, 'B', st2, xr, 0.17 * w, th=0.12, y0=0.22, m=4, ch=0.04)
    if fam != 'ex':
        def sy(x, z):
            return 0.22 + yo(z) + 0.17 * w * (1.0 - (x / xr) ** 2) + 0.005
        xa, z1, z2 = [-0.43, -0.26, -0.1, 0.0, 0.2, 0.43], -0.09 * l, -0.15 * l
        seam(q, [(x * w * ob, sy(x * w, z1 if x < -0.05 else z2), z1 if x < -0.05 else z2) for x in xa], (0, 1, 0), w=0.07)
    # hinge + actuator
    q.cyl('F', 0.11, 0.72 * w, (0, 0.08, 0.0), axis='X', n=8)
    for ix in (-1, 1):
        q.box('F', (0.14, 0.3, 0.3), (ix * 0.26 * w, 0.06, 0.02), bv=0.02)


def build_pelvis(R, P):
    lg, hw, sk, fam = P['lg'], P['hip_w'], P['skirt'], P['fam']
    z0, wz, yf, yb, xo = P['z0'], P['wz'], P['yf'], P['yb'], P['xo']
    ex = fam == 'ex'
    R.joint('frame')
    R.joint('pelvis', 'frame', (0, 0, P['hip_z']))
    p = R.pen('pelvis')
    p.tube('F', [S(-1.0, 0.62, 0.55, 0.2), S(-0.35, 0.95, 0.9, 0.25), S(wz, 1.1, 0.95, 0.25)])
    p.cyl('F', 0.4 * lg, 2 * hw - 0.6 * lg, axis='X', n=10)
    for ix in (-1, 1):
        p.cyl('F', 0.66 * lg, 0.3, (ix * (hw - 0.62 * lg - 0.1), 0, 0), axis='X', n=12)
    cyv, hv = (yf + yb) / 2, (yf - yb) / 2
    zm = (z0 + wz) / 2
    # girdle
    if ex:
        gtube(p, 'A', [S(z0 - 0.1, xo - 0.14, hv - 0.14, 0.5, 0, cyv), S(z0 + 0.06, xo, hv, 0.62, 0, cyv), S(wz - 0.1, xo, hv, 0.62, 0, cyv),
                     S(wz + 0.04, xo - 0.2, hv - 0.2, 0.5, 0, cyv)], grooves=[zm + 0.02], gd=0.04)
        for ix in (-1, 1):
            p.prism('C', [(yf - 0.5, z0 + 0.1), (yf + 0.12, z0 + 0.1), (yf + 0.12, wz - 0.12), (yf - 0.3, wz - 0.12)], 0.5, 'YZ',
                    (ix * (xo - 0.95), 0, 0), bv=0.03)
    else:
        loft(p, 'A', [(z0 - 0.12, xo - 0.18, yf - 0.16, -yb - 0.16), (z0 + 0.06, xo, yf, -yb), (wz - 0.1, xo, yf, -yb),
                      (wz + 0.04, xo - 0.24, yf - 0.24, -yb - 0.24)], n=20, e=P.get('girdle_e', 4.0), grooves=[zm + 0.02], gd=0.04)
        groove_fill(p, [(z0 + 0.06, xo, yf, -yb), (wz - 0.1, xo, yf, -yb)], zm + 0.02, e=P.get('girdle_e', 4.0), n=20, d=0.025)
        wr = P['waist_r']
        loft(p, 'A', [(wz - 0.04, wr[0] + 0.4, wr[1] + 0.24, wr[2] + 0.3), (wz + 0.42, wr[0] + 0.27, wr[1] + 0.2, wr[2] + 0.24)], n=18, e=2.9,
             bv=0.04, lip1=(0.1, 0.4))
        loft(p, 'B', [(wz + 0.3, wr[0] + 0.36, wr[1] + 0.26, wr[2] + 0.3), (wz + 0.44, wr[0] + 0.32, wr[1] + 0.25, wr[2] + 0.29)], n=18, e=2.9, bv=0.02)
        for ix in (-1, 1):
            lamp(p, (ix * 0.62 * xo, yf * (1.0 - 0.62 ** 4) ** 0.25 + 0.0, zm - 0.14), (0, 1, 0), (0, 0, 1), 0.36, 0.1)
    p.box('C', (0.8, 0.16, wz - z0 - 0.08), (0, yf + 0.04, zm), bv=0.04)
    p.box('T', (0.4, 0.06, 0.16), (0, yf + 0.12, zm), bv=0)
    # crotch block
    cp = [(0.6, z0), (yf + 0.02, z0), (yf + 0.28, -0.35), (yf - 0.05, -1.4), (0.45, -1.3), (0.55, -0.3)]
    p.prism('A', cp, 1.12, 'YZ', bv=0.07, far=0.8, near=0.8)
    fa = atan2(0.26, z0 + 0.35)
    p.box('B', (0.56, 0.12, (z0 + 0.35) * 0.72), (0, yf + 0.2, (z0 - 0.35) / 2), (fa, 0, 0), bv=0.03)
    p.box('F', (0.7, 0.3, 0.3), (0, yf - 0.1, -1.36), bv=0.05)
    rp = [(-0.55, z0), (yb + 0.05, z0), (yb - 0.12, -0.4), (yb + 0.3, -1.2), (-0.4, -1.0)]
    p.prism('B', rp, 1.2, 'YZ', bv=0.06, far=0.84, near=0.84)
    p.cyl('T', 0.22, 0.3, (0, yb - 0.0, -0.42), axis='Y', n=8)
    for s in (1, -1):
        X = sfx(s)
        mir = s < 0
        m = R.pen('pelvis', mir)
        m.box('F', (0.16, 0.2, 0.3), (0.82, yf + 0.03, z0 + 0.02), bv=0.03)
        # hip fender cap over the leg root
        m.box('B', (0.14, hv * 0.9, 0.3), (xo + 0.0, cyv, z0 + 0.22), bv=0.04)
        wf = (hw + 0.9 * lg - 0.62) * (0.8 + 0.2 * sk)
        lf = 2.5 * sk ** 0.9
        cx = 0.62 + wf / 2
        R.joint('skirt_F' + X, 'pelvis', (cx, yf, z0 + 0.1), mirror=mir)
        skirt(R.pen('skirt_F' + X, mir).at(rot=(rad(13), 0, 0)), wf, lf, P, 'F', 1)
        ws = (yf - yb) * (0.86 + 0.16 * sk) + 0.2
        ls = 2.6 * sk ** 0.9
        R.joint('skirt_S' + X, 'pelvis', (xo + 0.05, cyv + 0.05, z0 + 0.16), mirror=mir)
        skirt(R.pen('skirt_S' + X, mir).at(rot=(rad(8), 0, -pi / 2)), ws, ls, P, 'S', 1)
        wr = wf * 0.96
        lr = 2.2 * sk ** 0.9
        R.joint('skirt_B' + X, 'pelvis', (0.66 + wr / 2, yb, z0 + 0.1), mirror=mir)
        skirt(R.pen('skirt_B' + X, mir).at(rot=(rad(10), 0, pi)), wr, lr, P, 'B', -1)


# =============================================================================================
# LEGS
# =============================================================================================
def build_leg(R, P, s):
    X = sfx(s)
    mir = s < 0
    hip, knee, ankle = 'hip_' + X, 'knee_' + X, 'ankle_' + X
    R.joint(hip, 'pelvis', (P['hip_w'], 0, 0), mirror=mir)
    R.joint(knee, hip, (0, 0, -P['thigh']))
    R.joint(ankle, knee, (0, 0, -P['shin']))
    R.joint('sole_' + X, ankle, (0, 0, -P['ah']))
    if P['leg'] == 'blade':
        leg_ex(R, P, X, mir, hip, knee, ankle)
    else:
        leg_ef(R, P, X, mir, hip, knee, ankle)


def leg_frame(R, P, mir, hip, knee, ankle, kn=12):
    w, th, sn, ah = P['lg'], P['thigh'], P['shin'], P['ah']
    p, k, f = R.pen(hip, mir), R.pen(knee, mir), R.pen(ankle, mir)
    p.ball('F', 0.6 * w, n=10, m=6)
    p.cyl('F', 0.4 * w, 0.5 * w, (-0.62 * w, 0, 0), axis='X', n=10)
    p.tube('F', [S(-0.3, 0.44 * w, 0.48 * w, 0.15 * w), S(-th + 0.25, 0.4 * w, 0.44 * w, 0.13 * w)])
    k.cyl('F', 0.56 * w, 1.56 * w, axis='X', n=kn)
    for ix in (-1, 1):
        k.cyl('B', 0.46 * w, 0.14, (ix * (0.78 * w + 0.05), 0, 0), axis='X', n=kn - 2)
        k.box('T', (0.06, 0.78 * w, 0.1), (ix * (0.78 * w + 0.12), 0, 0), bv=0)
        k.cyl('F', 0.12 * w, 0.1, (ix * (0.78 * w + 0.13), 0, 0), axis='X', n=6)
    k.tube('F', [S(-0.3, 0.42 * w, 0.48 * w, 0.15 * w), S(-sn + 0.3, 0.4 * w, 0.44 * w, 0.13 * w)])
    f.cyl('F', 0.5 * w, 1.5 * w, axis='X', n=10)
    for ix in (-1, 1):
        f.cyl('B', 0.56 * w, 0.12, (ix * 0.78 * w, 0, 0), axis='X', n=10)
        f.bolt('F', (ix * (0.78 * w + 0.05), 0, 0), (ix, 0, 0), r=0.12 * w, h=0.05)
    f.box('F', (1.0 * w, 1.2 * w, ah * 0.72), (0, -0.05 * w, -ah * 0.5), bv=0.06)
    return p, k, f


def leg_ef(R, P, X, mir, hip, knee, ankle):
    w, th, sn, ah = P['lg'], P['thigh'], P['shin'], P['ah']
    kind = P['leg']
    hov, bulb = kind == 'hover', kind == 'bulb'
    tb = P.get('thigh_b', 1.0)
    fl = P.get('flare', 1.0)
    fw = P.get('foot_w', 1.0) * w
    p, k, f = leg_frame(R, P, mir, hip, knee, ankle)
    tabf = [(0, 0), (0.22, 0), (0.36, -0.22), (0.64, -0.22), (0.78, 0), (1, 0)]
    tabo = [(0, 0), (0.38, 0), (0.56, 0.2), (1, 0.2)]
    # ---------------- thigh: cut plates over a dark inner shell; the lower rear is left open for the knee rams
    E = 2.6
    ts = [(-0.5, 0.58 * w, 0.6 * w, 0.5 * w, 0.0, 0.08 * w), (-1.05, 0.9 * w * tb, 0.96 * w * tb, 0.8 * w * tb, 0.05 * w, 0.12 * w),
          (-th * 0.52, 0.95 * w * tb, 1.02 * w * tb, 0.84 * w * tb, 0.05 * w, 0.12 * w), (-th + 1.0, 0.8 * w, 0.84 * w, 0.72 * w, 0.0, 0.1 * w),
          (-th + 0.52, 0.6 * w, 0.64 * w, 0.55 * w, 0.0, 0.06 * w)]
    loft(p, 'T', inset(ts, 0.09, E), n=14, e=E)
    zsp = -th * 0.5 - 0.12
    shell(p, ts, [-0.5, zsp, -th + 0.52], [(41, 139, ('A', 'B'), tabf), (-46, 35, ('A', 'A'), tabo), (145, 226, ('A', 'A'), None),
                                          (232, 308, ('B', None), None)], E)
    # hip guard: covers the hip joint from the front and the outside, swings with the thigh
    hg = [(0.5 * w, 0.52 * w, 0.58 * w, 0.5 * w, 0.0, 0.05 * w), (0.1 * w, 0.84 * w, 0.9 * w, 0.78 * w, 0.03 * w, 0.1 * w),
          (-0.56, 0.74 * w, 0.78 * w, 0.66 * w, 0.02 * w, 0.1 * w)]
    panel(p, 'A', hg, -38, 142, 0.5 * w, -0.52, e=E, bot=[(0, 0), (0.3, 0), (0.4, -0.16), (0.6, -0.16), (0.7, 0), (1, 0)])
    zc = zsp - 0.56
    xs = st_at(ts, zc, 4, E) + st_at(ts, zc, 1, E)
    p.cyl('B', 0.3 * w, 0.22, (xs - 0.02, 0.12 * w, zc), axis='X', n=10)
    p.box('T', (0.06, 0.48 * w, 0.08), (xs + 0.1, 0.12 * w, zc), bv=0)
    zl = -1.25
    lamp(p, (st_at(ts, zl, 4, E) + st_at(ts, zl, 1, E), 0.12 * w, zl), (1, 0, 0.08), (0, 0, 1), 0.12, 0.36)
    yr = 0.12 * w - 0.84 * w * tb
    for ix in (-1, 1):
        p.piston((ix * 0.27 * w, yr + 0.04, zsp - 0.1), (ix * 0.27 * w, -0.56 * w, -th + 0.22), r=0.1 * w)
    p.box('F', (0.9 * w, 0.3 * w, 0.3), (0, yr + 0.12, zsp - 0.05), bv=0.03)

    # ---------------- knee cap (rides on the shin)
    kc = [(0.28 * w, 0.56 * w, 0.84 * w, 0.52 * w, 0, 0.1), (0.8 * w, 0.76 * w, 1.08 * w, 0.64 * w, 0, 0.1),
          (1.08 * w, 0.68 * w, 0.92 * w, 0.56 * w, 0, 0.1), (1.26 * w, 0.4 * w, 0.52 * w, 0.32 * w, 0, 0.1)]
    loft(k, 'A', kc, axis='Y', n=14, e=2.8, bv=0.05)
    loft(k, 'B', [(0.5 * w, 0.72 * w, 1.02 * w, 0.62 * w, 0, 0.1), (0.68 * w, 0.8 * w, 1.12 * w, 0.68 * w, 0, 0.1)], axis='Y', n=14, e=2.8, bv=0.03)
    if hov:
        spike(k, 'B', (0, 1.16 * w, 0.2), (0, 1, 0.45), 0.24 * w, 0.8 * w, n=8, collar='B')
    else:
        k.box('B', (0.5 * w, 0.16, 0.6 * w), (0, 1.24 * w, 0.12), bv=0.04, tx=0.6)
    lamp(k, (0, 1.225 * w, 0.1 + 0.6 * w), (0, 0.91, 0.41), (0, 0, 1), 0.34 * w, 0.1)
    # ---------------- shin: hollow bell flared to the front and outside, two tiers of plates with stepped seams
    EB = 2.7
    bs = [(-0.72, 0.7 * w, 0.78 * w, 0.64 * w, 0.0, 0.06 * w),
          (-1.35, 1.0 * w, 1.08 * w, 0.94 * w, 0.02 * w, 0.06 * w),
          (-sn * 0.56, 1.12 * w, 1.2 * w, 1.08 * w, 0.05 * w, 0.02 * w),
          (-sn + 0.8, (1.12 + 0.22 * fl) * w, (1.2 + 0.24 * fl) * w, 1.1 * w, 0.1 * w * fl, 0.0),
          (-sn + 0.25, (1.14 + 0.3 * fl) * w, (1.22 + 0.34 * fl) * w, 1.08 * w, 0.13 * w * fl, 0.0)]
    loft(k, 'T', inset(bs, 0.09, EB), n=16, e=EB, lip1=(0.1, 1.0))
    zmid = -sn * 0.56 + 0.12
    shell(k, bs, [-0.72, zmid, -sn + 0.25], [(43, 137, ('A', 'C' if P.get('shin_c', True) else 'B'), tabf), (-41, 37, ('A', 'A'), tabo),
                                            (143, 221, ('A', 'A'), tabo), (227, 313, ('B', 'B'), None)], EB)
    loft(k, 'B', [[-sn + 0.56] + [st_at(bs, -sn + 0.56, j, EB) + (0.045 if j < 4 else 0.0) for j in (1, 2, 3, 4, 5)],
                  [-sn + 0.3] + [st_at(bs, -sn + 0.3, j, EB) + (0.045 if j < 4 else 0.0) for j in (1, 2, 3, 4, 5)]], n=20, e=EB, bv=0.02)
    # calf thruster nacelle
    ny = 0.02 * w - 1.08 * w
    loft(k, 'B', [(-sn * 0.34, 0.3 * w, 0.2 * w, 0.2 * w, 0, ny + 0.06 * w), (-sn * 0.5, 0.56 * w, 0.4 * w, 0.46 * w, 0, ny - 0.1 * w),
                  (-sn + 1.0, 0.64 * w, 0.4 * w, 0.62 * w, 0, ny - 0.14 * w), (-sn + 0.6, 0.56 * w, 0.4 * w, 0.5 * w, 0, ny - 0.12 * w)],
         n=12, e=2.8, bv=0.04)
    R.nozzle('noz_leg_' + X, knee, (0, ny - 0.36 * w, -sn + 0.5), (rad(-40), 0, 0), 0.46 * w, 0.8 * w, mirror=False, n=10)
    for i in range(3):
        k.box('T', (0.6 * w, 0.08, 0.07), (0, ny - 0.62 * w, -sn * 0.5 - 0.12 - i * 0.16), bv=0)
    lamp(k, (0, ny - 0.72 * w, -sn + 1.12), (0, -1, 0.1), (0, 0, 1), 0.4 * w, 0.1)
    cable(k, 'F', [(0.3 * w, -0.4 * w, -0.2), (0.56 * w, -1.0 * w, -0.95), (0.4 * w, ny - 0.12 * w, -sn * 0.42)], 0.1 * w, sock='B')
    # outer overdrive vent (hinged at the top, lies on the straight upper bell), inner louvre
    z0v, z1v = -1.45, zmid + 0.1

    def xout(z):
        return st_at(bs, z, 4, EB) + st_at(bs, z, 1, EB)
    slope = (xout(z1v) - xout(z0v)) / (z0v - z1v)
    vent(R, knee, (xout(z0v) - 0.03, 0.08 * w, z0v), (1, 0, slope), (0, 0, -1), 0.72 * w, (z0v - z1v) * 0.86, mirror=mir, d=0.08)
    zc = -sn * 0.56 - 0.5
    xi = st_at(bs, zc, 4, EB) - st_at(bs, zc, 1, EB)
    k.louvre('B', (xi + 0.02, 0.0, zc), (0, 0, pi / 2), 0.8 * w, 0.6, n=4, d=0.09)
    lamp(k, (xout(-sn + 0.86) + 0.0, 0.3 * w, -sn + 0.86), (1, 0.15, 0.3), (0, 0, 1), 0.12, 0.3)

    # ---------------- foot
    g = -ah
    hy = -1.05 * w
    f.tube('F', [S(hy - 0.6 * w, 0.84 * fw, 0.14, 0.06, cv=g + 0.14), S(hy, 1.1 * fw, 0.14, 0.06, cv=g + 0.14),
                 S(1.6 * w, 1.2 * fw, 0.14, 0.06, cv=g + 0.14), S(3.2 * w, 0.84 * fw, 0.14, 0.06, cv=g + 0.14)], axis='Y')
    tc = [(1.05 * w, 1.14 * fw, 0.92, 0.08, 0, g + 0.34), (1.9 * w, 1.16 * fw, 0.86, 0.08, 0, g + 0.34),
          (2.7 * w, 1.0 * fw, 0.6, 0.08, 0, g + 0.34), (3.16 * w, 0.7 * fw, 0.28, 0.06, 0, g + 0.32)]
    loft(f, 'A', tc, axis='Y', n=14, e=3.0, bv=0.05, grooves=[2.2 * w], gd=0.06, gw=0.1)
    loft(f, 'T', [(2.2 * w - 0.07, 1.1 * fw - 0.03, 0.73, 0.04, 0, g + 0.34), (2.2 * w + 0.07, 1.1 * fw - 0.03, 0.73, 0.04, 0, g + 0.34)], axis='Y', n=14, e=3.0)
    loft(f, 'B', [(2.82 * w, 0.96 * fw, 0.54, 0.09, 0, g + 0.34), (3.2 * w, 0.7 * fw, 0.3, 0.07, 0, g + 0.32)], axis='Y', n=14, e=3.0, bv=0.03)
    f.prism('B', [(hy + 0.1 * w, g + 0.26), (1.25 * w, g + 0.26), (1.25 * w, g + 1.16), (0.55 * w, -0.16), (-0.7 * w, -0.1), (hy + 0.1 * w, g + 0.8)],
            2.1 * fw, 'YZ', bv=0.06, far=0.9, near=0.9)
    f.prism('A', [(hy + 0.1 * w, g + 0.26), (hy - 0.68 * w, g + 0.26), (hy - 0.82 * w, g + 0.6), (hy - 0.44 * w, g + 1.24), (hy + 0.1 * w, g + 1.3)],
            1.8 * fw, 'YZ', bv=0.06, far=0.88, near=0.88)
    q = f.at((0, 0.7 * w, 0.34), (rad(24), 0, 0))
    arc_plate(q, 'A', [(0.0, -0.5 * w, 0.5 * w, 0.0), (-0.3, -0.62 * w, 0.62 * w, 0.02), (-0.95, -0.66 * w, 0.66 * w, 0.02),
                       (-1.1, -0.5 * w, 0.5 * w, -0.03)], 0.66 * w, 0.16 * w, th=0.16, y0=0.1, m=4)
    for ix in (-1, 1):
        f.piston((ix * 0.42 * w, hy - 0.2 * w, g + 0.9), (ix * 0.42 * w, -0.5 * w, 0.1), r=0.085 * w, split=0.5)
        f.box('A', (0.14, 1.6 * w, 0.56), (ix * 1.1 * fw, 0.2 * w, g + 0.58), bv=0.04, ty=0.7)
        f.box('T', (0.06, 0.9 * w, 0.08), (ix * (1.1 * fw + 0.06), 0.2 * w, g + 0.58), bv=0)
    if hov:
        for ix in (-1, 1):
            f.box('B', (0.4 * w, 1.7 * w, 0.5), (ix * 1.3 * fw, 0.5 * w, g + 0.5), bv=0.06, ty=0.8)
    if bulb:
        for ix in (-0.5, 0.5):
            spike(f, 'B', (ix * fw, 2.95 * w, g + 0.52), (0.12 * ix, 1, -0.1), 0.22 * w, 1.0 * w, n=6, collar='B')


def leg_ex(R, P, X, mir, hip, knee, ankle):
    w, th, sn, ah = P['lg'], P['thigh'], P['shin'], P['ah']
    p, k, f = leg_frame(R, P, mir, hip, knee, ankle, kn=10)
    # ---------------- thigh: faceted, hip flare
    gtube(p, 'A', [S(-0.6, 0.56 * w, 0.5 * w, 0.2 * w, cv=0.12 * w), S(-1.1, 0.86 * w, 0.76 * w, 0.3 * w, cv=0.2 * w),
                 S(-th * 0.55, 0.82 * w, 0.74 * w, 0.28 * w, cv=0.2 * w), S(-th + 0.9, 0.68 * w, 0.6 * w, 0.22 * w, cv=0.14 * w),
                 S(-th + 0.55, 0.52 * w, 0.48 * w, 0.18 * w, cv=0.1 * w)], grooves=[-th * 0.4], bv=0.03)
    p.prism('C', [(-0.4 * w, -0.95), (0.4 * w, -0.95), (0.52 * w, -1.6), (0.0, -th * 0.86), (-0.52 * w, -1.6)], 0.2, 'XZ', (0, 0.96 * w + 0.02, 0), bv=0.04)
    p.prism('B', [(-0.2 * w, -1.25), (0.2 * w, -1.25), (0.26 * w, -1.6), (0.0, -th * 0.7), (-0.26 * w, -1.6)], 0.1, 'XZ', (0, 0.96 * w + 0.14, 0), bv=0.02)
    p.prism('B', [(-0.35 * w, -1.2), (0.62 * w, -0.9), (0.72 * w, -th * 0.5), (0.3 * w, -th * 0.74), (-0.35 * w, -th * 0.62)], 0.14, 'YZ',
            (0.86 * w + 0.04, 0, 0), bv=0.03)
    for zz in (-1.5, -1.75, -2.0):
        p.line('T', (0.86 * w + 0.11, -0.15 * w, zz), (0.86 * w + 0.11, 0.5 * w, zz + 0.12), (1, 0, 0), w=0.07)
    lamp(p, (0.86 * w + 0.1, 0.2 * w, -th * 0.6), (1, 0, 0), (0, 0, 1), 0.1, 0.3)
    for ix in (-1, 1):
        p.piston((ix * 0.25 * w, -0.66 * w, -0.9), (ix * 0.25 * w, -0.5 * w, -th + 0.22), r=0.085 * w)
    p.hatch((-0.82 * w, 0.2 * w, -th * 0.52), (-1, 0, 0), (0, 0, 1), 0.6 * w, 1.0)
    # ---------------- knee blade
    kp = [(0.4 * w, 1.75), (1.05 * w, 0.75), (1.5 * w, -0.1), (1.26 * w, -1.05), (0.8 * w, -1.1), (0.86 * w, -0.2), (0.6 * w, 0.4)]
    k.prism('A', kp, 1.1 * w, 'YZ', bv=0.05, far=0.5, near=0.5, c=(1.0 * w, 0.2))
    k.prism('C', [(0.42 * w, 1.72), (0.3 * w, 2.25), (0.86 * w, 1.0)], 0.12, 'YZ', bv=0.02)
    k.bolts('F', [(-0.36 * w, 1.2 * w, -0.6), (0.36 * w, 1.2 * w, -0.6)], (0, 1, 0), r=0.055 * w)
    # ---------------- shin
    gtube(k, 'A', [S(-0.85, 0.6 * w, 0.66 * w, 0.22 * w, cv=0.05 * w), S(-1.5, 0.84 * w, 0.96 * w, 0.3 * w, cv=0.08 * w),
                 S(-sn * 0.55, 0.9 * w, 1.06 * w, 0.32 * w, cv=0.0), S(-sn + 0.95, 1.0 * w, 1.2 * w, 0.34 * w, cv=-0.08 * w),
                 S(-sn + 0.4, 0.86 * w, 1.04 * w, 0.3 * w, cv=-0.08 * w)], grooves=[-sn * 0.36, -sn + 1.2], bv=0.03)
    sp = [(-0.28 * w, -1.2), (0.28 * w, -1.2), (0.48 * w, -2.0), (0.28 * w, -sn + 1.25), (0.0, -sn + 0.55), (-0.28 * w, -sn + 1.25), (-0.48 * w, -2.0)]
    k.prism('C', sp, 0.24, 'XZ', (0, 1.1 * w + 0.04, 0), (rad(-2), 0, 0), bv=0.05)
    k.prism('B', [(x * 0.5, z * 0.8 - 0.6) for x, z in sp], 0.1, 'XZ', (0, 1.1 * w + 0.19, 0), (rad(-2), 0, 0), bv=0.02)
    lamp(k, (0, 1.1 * w + 0.15, -1.38), (0, 1, 0), (0, 0, 1), 0.3 * w, 0.1)
    # calf blade housing + thruster
    yb_ = -1.0 * w
    k.prism('B', [(yb_ + 0.2, -1.2), (yb_ - 0.5, -1.7), (yb_ - 1.0, -sn * 0.62), (yb_ - 0.8, -sn + 0.8), (yb_ + 0.2, -sn + 0.6)], 1.0 * w, 'YZ',
            bv=0.05, far=0.5, near=0.5, c=(yb_, -sn * 0.55))
    k.prism('C', [(yb_ - 0.45, -1.62), (yb_ - 1.5, -1.3), (yb_ - 1.02, -sn * 0.6), (yb_ - 0.92, -sn * 0.45)], 0.1, 'YZ', bv=0.02)
    R.nozzle('noz_leg_' + X, knee, (0, yb_ - 0.62, -sn + 0.86), (rad(-42), 0, 0), 0.42 * w, 0.75 * w, mirror=False, n=10)
    vent(R, knee, (0.92 * w, 0.3 * w, -sn * 0.6), (1, 0, 0), (0, -1, 0), 0.9, 0.62 * w, mirror=mir)
    k.louvre('B', (-0.92 * w, 0.0, -sn * 0.47), (0, 0, pi / 2), 0.8 * w, 0.6, n=4, d=0.09)
    for yy in (-0.5 * w, 0.5 * w):
        k.bolt('F', (1.0 * w, yy, -sn + 0.8), (1, 0, 0), r=0.06 * w)
    # ---------------- foot: wedge toe, spur heel
    g = -ah
    hy = -0.8 * w
    f.tube('F', [S(hy - 0.3 * w, 0.6 * w, 0.12, 0.05, cv=g + 0.12), S(hy + 0.3 * w, 0.92 * w, 0.12, 0.05, cv=g + 0.12),
                 S(1.5 * w, 1.0 * w, 0.12, 0.05, cv=g + 0.12), S(3.3 * w, 0.3 * w, 0.12, 0.05, cv=g + 0.12)], axis='Y')
    f.prism('B', [(hy + 0.05 * w, g + 0.22), (1.5 * w, g + 0.22), (1.5 * w, g + 0.7), (0.8 * w, -0.25), (-0.7 * w, -0.2), (hy + 0.05 * w, -0.6)],
            1.84 * w, 'YZ', bv=0.05, far=0.9, near=0.9)
    f.prism('A', [(1.45 * w, g + 0.22), (3.35 * w, g + 0.22), (3.2 * w, g + 0.42), (2.2 * w, g + 0.9), (1.45 * w, g + 1.0)], 1.9 * w, 'YZ',
            bv=0.05, far=0.5, near=0.5, c=(1.45 * w, g + 0.4))
    f.prism('C', [(2.1 * w, g + 0.94), (3.28 * w, g + 0.4), (3.5 * w, g + 0.3), (3.3 * w, g + 0.56), (2.3 * w, g + 1.06)], 0.16, 'YZ', bv=0.03)
    f.prism('B', [(hy, g + 1.0), (hy - 0.6 * w, g + 1.3), (hy - 1.3 * w, g + 0.0), (hy - 0.95 * w, g + 0.0), (hy - 0.45 * w, g + 0.6), (hy, g + 0.45)],
            0.7 * w, 'YZ', bv=0.04)
    for ix in (-1, 1):
        f.box('A', (0.1, 1.5 * w, 0.42), (ix * 0.95 * w, 0.35 * w, g + 0.5), bv=0.03, ty=0.7)
        f.bolt('F', (ix * (0.95 * w + 0.05), 0.35 * w, g + 0.5), (ix, 0, 0), r=0.06)
        f.piston((ix * 0.4 * w, hy - 0.2 * w, g + 0.85), (ix * 0.4 * w, -0.5 * w, 0.05), r=0.08 * w, split=0.5)
    q = f.at((0, 0.72 * w, 0.4), (rad(26), 0, 0))
    arc_plate(q, 'A', [(0.0, -0.4 * w, 0.4 * w, 0.0), (-0.3, -0.6 * w, 0.6 * w, 0.02), (-0.9, -0.62 * w, 0.62 * w, 0.02), (-1.25, -0.1 * w, 0.1 * w, 0.0)],
              0.62 * w, 0.16 * w, th=0.16, y0=0.1, m=2)


# =============================================================================================
def build_frame(P):
    import mk_foe_top as top
    P = derive(P)
    R = Rig(seed=P.get('seed', 1))
    build_pelvis(R, P)
    for s in (-1, 1):
        build_leg(R, P, s)
    top.build_torso(R, P)
    for s in (-1, 1):
        top.build_arm(R, P, s)
    top.build_back(R, P)
    return R, P
