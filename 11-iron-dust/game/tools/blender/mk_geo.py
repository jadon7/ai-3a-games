# mk_geo.py -- shared geometry kit for IRON DUST model generation (Blender 5.x, headless).
# Authoring space is Blender: +Z up, +Y front, +X = the mech's right. glTF export maps
# (x, y, z) -> (x, z, -y), i.e. Godot: +Y up, front -Z, right +X.
import bpy, bmesh, math, random
from math import radians, sin, cos, pi
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

MAT_COL = {
    'A': (0.40, 0.37, 0.27), 'B': (0.13, 0.14, 0.14), 'C': (0.62, 0.22, 0.06),
    'F': (0.055, 0.06, 0.065), 'W': (0.09, 0.095, 0.105), 'T': (0.008, 0.008, 0.01),
    'H': (0.75, 0.55, 0.05), 'G': (0.3, 1.0, 0.7), 'K': (1.0, 0.4, 0.08),
}

I4 = Matrix.Identity(4)
MIR = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))
AXM = {
    'Z': Matrix.Identity(4),
    'X': Euler((0.0, pi / 2, 0.0)).to_matrix().to_4x4(),
    'Y': Euler((-pi / 2, 0.0, 0.0)).to_matrix().to_4x4(),
}


def xf(pos=(0, 0, 0), rot=(0, 0, 0)):
    return Matrix.Translation(Vector(pos)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()


def frame_m(pos, xa, ya, za):
    m = Matrix.Identity(4)
    for i, a in enumerate((xa, ya, za)):
        m[0][i], m[1][i], m[2][i] = a[0], a[1], a[2]
    m[0][3], m[1][3], m[2][3] = pos[0], pos[1], pos[2]
    return m


def S(t, hu, hv, c=0.12, cu=0.0, cv=0.0, c2=None):
    """Tube station: t along axis, half sizes, chamfer (+v corners), centre offset, chamfer of -v corners."""
    return (t, hu, hv, c, cu, cv, c if c2 is None else c2)


def _bm_fix(verts, faces, bv):
    bm = bmesh.new()
    vv = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vv[i] for i in f])
        except ValueError:
            pass
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bv > 0.0:
        es = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > 0.7]
        if es:
            bmesh.ops.bevel(bm, geom=es, offset=bv, offset_type='OFFSET', segments=1, profile=0.5,
                            affect='EDGES', clamp_overlap=True)
        bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges[:])
    bm.verts.index_update()
    ov = [v.co.copy() for v in bm.verts]
    of = [tuple(v.index for v in f.verts) for f in bm.faces if len(f.verts) >= 3]
    bm.free()
    return ov, of


class Joint:
    def __init__(self, name, parent, local):
        self.name = name
        self.parent = parent
        self.local = local
        self.world = (parent.world @ local) if parent else local.copy()


class Rig:
    def __init__(self, seed=1):
        self.joints = {}
        self.bufs = {}
        self.rng = random.Random(seed)
        self.vent_n = 0
        self.tris = 0

    def joint(self, name, parent=None, pos=(0, 0, 0), rot=(0, 0, 0), mirror=False, M=None):
        m = M.copy() if M is not None else xf(pos, rot)
        if mirror:
            m = MIR @ m @ MIR
        assert name not in self.joints, name
        assert '.' not in name and '-' not in name
        j = Joint(name, self.joints[parent] if parent else None, m)
        self.joints[name] = j
        return j

    def pen(self, joint, mirror=False, M=None):
        return Pen(self, joint, mirror, M if M is not None else I4)

    def add(self, joint, mat, verts, faces):
        assert joint in self.joints, joint
        b = self.bufs.setdefault((joint, mat), {'v': [], 'f': [], 'var': []})
        off = len(b['v'])
        b['v'].extend(verts)
        var = self.rng.uniform(0.94, 1.06)
        for f in faces:
            b['f'].append(tuple(i + off for i in f))
            b['var'].append(var)
            self.tris += len(f) - 2

    # -- compound helpers that create joints ---------------------------------
    def nozzle(self, name, parent, pos, rot, r, length=None, mirror=False, n=12, mat='F', collar=True):
        """Joint whose Blender-local -Z (glTF -Y) is the exhaust direction; origin at exit-plane centre."""
        L = length if length else r * 1.5
        self.joint(name, parent, pos, rot, mirror)
        p = self.pen(name, mirror)
        p.lathe(mat, [(0.84 * r, 0.0), (r, 0.0), (0.97 * r, 0.22 * L), (0.66 * r, 0.78 * L), (0.6 * r, L), (0.0, L)], n=n)
        p.lathe('T', [(0.0, 0.62 * L), (0.4 * r, 0.62 * L), (0.84 * r, 0.0)], n=n)
        if collar:
            p.lathe(mat, [(0.74 * r, 0.62 * L), (0.86 * r, 0.62 * L), (0.86 * r, 0.76 * L), (0.7 * r, 0.76 * L)], n=n)
            for k in range(3):
                a = k * 2 * pi / 3 + 0.5
                p.rod(mat, (cos(a) * 0.9 * r, sin(a) * 0.9 * r, 0.3 * L), (cos(a) * 0.72 * r, sin(a) * 0.72 * r, 0.98 * L), 0.05 * r + 0.015, n=4)
        return p

    def vent(self, parent, pos, normal, down, w, h, mirror=False, flap='A', d=0.11, name=None):
        """Hinged overdrive flap. Node-local (Blender): X hinge, +Y outward, flap toward -Z.
        Housing + glow strips stay on the parent joint; the flap is the vent node's child."""
        self.vent_n += 1
        nm = name or ('vent_%d' % self.vent_n)
        ya = Vector(normal).normalized()
        za = -Vector(down)
        za = (za - ya * za.dot(ya)).normalized()
        xa = ya.cross(za)
        M = frame_m(Vector(pos) + ya * d, xa, ya, za)
        st = self.pen(parent, mirror, M)
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
        self.joint(nm, parent, M=M, mirror=mirror)
        fp = self.pen(nm, mirror)
        fp.box(flap, (w + 0.12, 0.05, h + 0.1), (0, 0.0, -h / 2 - 0.01), bv=0.018)
        fp.cyl('F', 0.035, w * 0.8, (0, 0.0, 0.03), axis='X', n=6)
        return nm


class Pen:
    """Emits primitives into one joint's local space, optionally X-mirrored (author for the right side)."""

    def __init__(self, rig, joint, mirror, M):
        self.rig, self.joint, self.mirror, self.M = rig, joint, mirror, M

    def at(self, pos=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
        return Pen(self.rig, self.joint, self.mirror, self.M @ xf(pos, rot) @ Matrix.Scale(scale, 4))

    def on(self, joint):
        return Pen(self.rig, joint, self.mirror, I4)

    def emit(self, mat, verts, faces, M=None, bv=0.0, recalc=True):
        if recalc or bv > 0.0:
            verts, faces = _bm_fix(verts, faces, bv)
        T = (self.M @ M) if M is not None else self.M
        vs = [T @ Vector(v) for v in verts]
        if self.mirror:
            vs = [Vector((-v.x, v.y, v.z)) for v in vs]
            faces = [tuple(reversed(f)) for f in faces]
        self.rig.add(self.joint, mat, vs, faces)

    # -- primitives ------------------------------------------------------------
    def box(self, mat, size, pos=(0, 0, 0), rot=(0, 0, 0), bv=0.04, tx=1.0, ty=1.0, bx=1.0, by=1.0, sh=(0, 0)):
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        v = [(-hx * bx, -hy * by, -hz), (hx * bx, -hy * by, -hz), (hx * bx, hy * by, -hz), (-hx * bx, hy * by, -hz),
             (-hx * tx + sh[0], -hy * ty + sh[1], hz), (hx * tx + sh[0], -hy * ty + sh[1], hz),
             (hx * tx + sh[0], hy * ty + sh[1], hz), (-hx * tx + sh[0], hy * ty + sh[1], hz)]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self.emit(mat, v, f, xf(pos, rot), bv)

    def prism(self, mat, pts, depth, plane='YZ', pos=(0, 0, 0), rot=(0, 0, 0), bv=0.04, far=1.0, near=1.0,
              shift=(0, 0), c=None):
        n = len(pts)
        if c is None:
            c = (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)

        def mp(a, b, t):
            if plane == 'YZ':
                return (t, a, b)
            if plane == 'XZ':
                return (a, t, b)
            return (a, b, t)
        v = []
        for a, b in pts:
            v.append(mp(c[0] + (a - c[0]) * near, c[1] + (b - c[1]) * near, -depth / 2))
        rings = 2
        if abs(near - 1.0) > 1e-6 and abs(far - 1.0) > 1e-6:
            # lens: full-size profile on the centre plane, tapering to both caps
            for a, b in pts:
                v.append(mp(a + shift[0] / 2, b + shift[1] / 2, 0.0))
            rings = 3
        for a, b in pts:
            v.append(mp(c[0] + (a - c[0]) * far + shift[0], c[1] + (b - c[1]) * far + shift[1], depth / 2))
        f = [tuple(range(n)), tuple(range((rings - 1) * n, rings * n))]
        for k in range(rings - 1):
            for i in range(n):
                j = (i + 1) % n
                f.append((k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i))
        self.emit(mat, v, f, xf(pos, rot), bv)

    def _rings(self, mat, rings, M, bv=0.0):
        n = len(rings[0])
        v = []
        for r in rings:
            v.extend(r)
        f = [tuple(range(n)), tuple(range((len(rings) - 1) * n, len(rings) * n))]
        for k in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                f.append((k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i))
        self.emit(mat, v, f, M, bv)

    def tube(self, mat, st, axis='Z', pos=(0, 0, 0), rot=(0, 0, 0), grooves=(), gd=0.045, gw=0.07, bv=0.0):
        st = sorted(st, key=lambda s: s[0])

        def interp(t):
            for a, b in zip(st, st[1:]):
                if a[0] <= t <= b[0]:
                    k = (t - a[0]) / max(1e-9, b[0] - a[0])
                    return tuple(a[i] + (b[i] - a[i]) * k for i in range(7))
            return None
        seq = [(s, 0.0) for s in st]
        for g in grooves:
            for tt, dd in ((g - gw / 2, 0.0), (g - gw / 2, gd), (g + gw / 2, gd), (g + gw / 2, 0.0)):
                s = interp(tt)
                if s is not None:
                    seq.append(((tt,) + s[1:], dd))
        # stable order: by t, groove sub-order preserved by insertion index
        seq = [x for _, x in sorted(enumerate(seq), key=lambda e: (round(e[1][0][0], 6), e[0]))]

        def mp(u, v, t):
            if axis == 'Z':
                return (u, v, t)
            if axis == 'Y':
                return (u, t, v)
            return (t, u, v)
        rings = []
        for (t, hu, hv, c, cu, cv, c2), dd in seq:
            hu, hv = max(0.01, hu - dd), max(0.01, hv - dd)
            c = max(0.012, min(c, hu * 0.95, hv * 0.95))
            c2 = max(0.012, min(c2, hu * 0.95, hv * 0.95))
            pts = [(hu - c, hv), (hu, hv - c), (hu, -hv + c2), (hu - c2, -hv), (-hu + c2, -hv), (-hu, -hv + c2),
                   (-hu, hv - c), (-hu + c, hv)]
            rings.append([mp(cu + a, cv + b, t) for a, b in pts])
        self._rings(mat, rings, xf(pos, rot), bv)

    def rtube(self, mat, st, axis='Z', pos=(0, 0, 0), rot=(0, 0, 0), n=12, ph=0.0):
        """Round loft. st = [(t, ru, rv, cu, cv)]"""
        def mp(u, v, t):
            if axis == 'Z':
                return (u, v, t)
            if axis == 'Y':
                return (u, t, v)
            return (t, u, v)
        rings = []
        for s in st:
            t, ru, rv = s[0], s[1], s[2]
            cu = s[3] if len(s) > 3 else 0.0
            cv = s[4] if len(s) > 4 else 0.0
            rings.append([mp(cu + ru * cos(ph + 2 * pi * i / n), cv + rv * sin(ph + 2 * pi * i / n), t) for i in range(n)])
        self._rings(mat, rings, xf(pos, rot))

    def cyl(self, mat, r, h, pos=(0, 0, 0), axis='Z', rot=(0, 0, 0), n=10, r2=None, bv=0.0, ph=0.0):
        r2 = r if r2 is None else r2
        rings = [[(r * cos(ph + 2 * pi * i / n), r * sin(ph + 2 * pi * i / n), -h / 2) for i in range(n)],
                 [(r2 * cos(ph + 2 * pi * i / n), r2 * sin(ph + 2 * pi * i / n), h / 2) for i in range(n)]]
        self._rings(mat, rings, xf(pos, rot) @ AXM[axis], bv)

    def rod(self, mat, p0, p1, r, n=6, r2=None):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        if L < 1e-6:
            return
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        M = Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4()
        r2 = r if r2 is None else r2
        rings = [[(r * cos(2 * pi * i / n), r * sin(2 * pi * i / n), -L / 2) for i in range(n)],
                 [(r2 * cos(2 * pi * i / n), r2 * sin(2 * pi * i / n), L / 2) for i in range(n)]]
        self._rings(mat, rings, M)

    def lathe(self, mat, prof, pos=(0, 0, 0), axis='Z', rot=(0, 0, 0), n=12, scale=(1, 1, 1), ph=0.0):
        """prof = [(r, z)] traversed bottom -> outside -> top for outward normals. r == 0 ends make poles."""
        v, f, idx = [], [], []
        for r, z in prof:
            if r <= 1e-6:
                idx.append([len(v)])
                v.append((0.0, 0.0, z * scale[2]))
            else:
                idx.append(list(range(len(v), len(v) + n)))
                for i in range(n):
                    a = ph + 2 * pi * i / n
                    v.append((r * cos(a) * scale[0], r * sin(a) * scale[1], z * scale[2]))
        for k in range(len(prof) - 1):
            a, b = idx[k], idx[k + 1]
            for i in range(n):
                j = (i + 1) % n
                if len(a) == 1 and len(b) == 1:
                    continue
                if len(a) == 1:
                    f.append((a[0], b[j], b[i]))
                elif len(b) == 1:
                    f.append((a[i], a[j], b[0]))
                else:
                    f.append((a[i], a[j], b[j], b[i]))
        self.emit(mat, v, f, xf(pos, rot) @ AXM[axis], 0.0, recalc=False)

    def ball(self, mat, r, pos=(0, 0, 0), n=10, m=5, rot=(0, 0, 0)):
        rr = (r, r, r) if isinstance(r, (int, float)) else r
        prof = [(sin(pi * k / m) if 0 < k < m else 0.0, -cos(pi * k / m)) for k in range(m + 1)]
        self.lathe(mat, prof, pos, 'Z', rot, n, scale=rr)

    def dome(self, mat, r, h, pos=(0, 0, 0), axis='Z', rot=(0, 0, 0), n=12, m=3, base=0.0):
        """Hemispherical cap: flat base at z=0 (radius r), apex at z=h. Optional cylindrical skirt 'base' below."""
        prof = [(0.0, -base), (r, -base)] if base > 0 else [(0.0, 0.0)]
        for k in range(m):
            a = (pi / 2) * k / m
            prof.append((r * cos(a), h * sin(a)))
        prof.append((0.0, h))
        self.lathe(mat, prof, pos, axis, rot, n)

    def bolt(self, mat, p, nrm, r=0.07, h=0.05):
        nrm = Vector(nrm).normalized()
        p = Vector(p)
        self.rod(mat, p - nrm * 0.03, p + nrm * h, r, n=6)

    def bolts(self, mat, pts, nrm, r=0.07, h=0.05):
        for p in pts:
            self.bolt(mat, p, nrm, r, h)

    def piston(self, p0, p1, r=0.12, mat='F', split=0.55, eyes=True):
        p0, p1 = Vector(p0), Vector(p1)
        mid = p0 + (p1 - p0) * split
        self.rod(mat, p0, mid, r, n=8)
        self.rod(mat, mid - (p1 - p0).normalized() * 0.04, mid + (p1 - p0).normalized() * 0.05, r * 1.25, n=8)
        self.rod(mat, mid, p1, r * 0.55, n=6)
        if eyes:
            self.cyl(mat, r * 1.15, r * 2.6, tuple(p0), axis='X', n=6)
            self.cyl(mat, r * 0.95, r * 2.2, tuple(p1), axis='X', n=6)

    def louvre(self, mat, pos, rot, w, h, n=4, d=0.1, frame=None):
        """Local: face normal +Y, w along X, h along Z."""
        q = self.at(pos, rot)
        q.box('T', (w, 0.04, h), (0, 0.0, 0), bv=0)
        for i in range(n):
            z = -h / 2 + h * (i + 0.5) / n
            q.box(mat, (w, d, 0.04), (0, d * 0.45, z), (radians(-32), 0, 0), bv=0)
        if frame:
            t = 0.07
            q.box(frame, (w + 2 * t, d * 0.9, t), (0, d * 0.4, h / 2 + t / 2), bv=0)
            q.box(frame, (w + 2 * t, d * 0.9, t), (0, d * 0.4, -h / 2 - t / 2), bv=0)
            q.box(frame, (t, d * 0.9, h), (w / 2 + t / 2, d * 0.4, 0), bv=0)
            q.box(frame, (t, d * 0.9, h), (-w / 2 - t / 2, d * 0.4, 0), bv=0)

    def handhold(self, mat, pos, rot, w=0.5, h=0.14, r=0.03):
        """Local: bar along X standing off +Y."""
        q = self.at(pos, rot)
        q.rod(mat, (-w / 2, h, 0), (w / 2, h, 0), r, n=5)
        q.rod(mat, (-w / 2, -0.02, 0), (-w / 2, h, 0), r, n=5)
        q.rod(mat, (w / 2, -0.02, 0), (w / 2, h, 0), r, n=5)

    def line(self, mat, p0, p1, nrm, w=0.05, h=0.018):
        """Thin inlay strip (panel line / trim) lying on a surface with normal nrm."""
        p0, p1, nrm = Vector(p0), Vector(p1), Vector(nrm).normalized()
        d = p1 - p0
        L = d.length
        d = d.normalized()
        side = nrm.cross(d).normalized()
        M = frame_m((p0 + p1) / 2, d, side, nrm)
        hx, hy = L / 2, w / 2
        v = [(-hx, -hy, -0.08), (hx, -hy, -0.08), (hx, hy, -0.08), (-hx, hy, -0.08),
             (-hx, -hy, h), (hx, -hy, h), (hx, hy, h), (-hx, hy, h)]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self.emit(mat, v, f, M, 0.0)

    def hatch(self, pos, nrm, up, w, h, mat='T', bolts=True, lw=0.045):
        """Rectangular panel-line outline (+ corner bolts) on a flat face."""
        n = Vector(nrm).normalized()
        u = Vector(up)
        u = (u - n * u.dot(n)).normalized()
        r = u.cross(n)
        c = Vector(pos)
        cs = [c + r * (sx * w / 2) + u * (sz * h / 2) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        for i in range(4):
            self.line(mat, cs[i], cs[(i + 1) % 4], n, w=lw)
        if bolts:
            for cc in cs:
                self.bolt('F', c + (cc - c) * 0.74, n, r=0.045, h=0.03)

    def plate(self, mat, pts, nrm_axis, off, th=0.06, bv=0.02, **kw):
        """Raised hatch/applique: 2D polygon in a plane, thin."""
        self.prism(mat, pts, th, plane=nrm_axis, pos=off, bv=bv, **kw)


# ---------------------------------------------------------------------------------------------
# Vertex colour bake:  R = shade (AO-ish), G = dust
# ---------------------------------------------------------------------------------------------
def _hemi_dirs(k=16):
    out = []
    ga = pi * (3 - math.sqrt(5))
    for i in range(k):
        u = (i + 0.5) / k
        r = math.sqrt(u)
        z = math.sqrt(1 - u)
        a = i * ga
        out.append((r * cos(a), r * sin(a), z))
    return out


def bake_colors(rig, dust_h=None, ground=True, maxd=2.2, k=16, flat_dust=None, edge_w=0.2):
    """Vertex colour: R = shade (AO), G = dust, B = edge wear.
    B marks narrow, unoccluded faces (bevel strips, corner facets): the game's armour shader chips the paint there."""
    wv, wp = [], []
    for (jn, mat), b in rig.bufs.items():
        Mw = rig.joints[jn].world
        off = len(wv)
        b['wv'] = [Mw @ v for v in b['v']]
        wv.extend(b['wv'])
        wp.extend(tuple(i + off for i in f) for f in b['f'])
    if ground:
        o = len(wv)
        wv.extend([Vector((-40, -40, -0.02)), Vector((40, -40, -0.02)), Vector((40, 40, -0.02)), Vector((-40, 40, -0.02))])
        wp.append((o, o + 1, o + 2, o + 3))
    bvh = BVHTree.FromPolygons([tuple(v) for v in wv], wp, all_triangles=False, epsilon=0.0)
    dirs = _hemi_dirs(k)
    rng = random.Random(7)
    for (jn, mat), b in rig.bufs.items():
        cols = []
        v = b['wv']
        for fi, f in enumerate(b['f']):
            pts = [v[i] for i in f]
            n = Vector((0, 0, 0))
            for i in range(len(pts)):
                p, q = pts[i], pts[(i + 1) % len(pts)]
                n.x += (p.y - q.y) * (p.z + q.z)
                n.y += (p.z - q.z) * (p.x + q.x)
                n.z += (p.x - q.x) * (p.y + q.y)
            area = n.length * 0.5
            if n.length < 1e-12:
                n = Vector((0, 0, 1))
            n.normalize()
            longest = max((pts[i] - pts[(i + 1) % len(pts)]).length for i in range(len(pts)))
            narrow = 1.0 if (longest > 1e-6 and area / longest < edge_w) else 0.0
            c = sum(pts, Vector((0, 0, 0))) / len(pts)
            t1 = n.orthogonal().normalized()
            t2 = n.cross(t1)
            wd = [t1 * d[0] + t2 * d[1] + n * d[2] for d in dirs]
            hemi = 0.84 + 0.16 * n.z
            var = b['var'][fi]
            for p in pts:
                o = p + (c - p) * 0.12 + n * 0.035
                occ = 0.0
                for d in wd:
                    hit = bvh.ray_cast(o, d, maxd)
                    if hit[0] is not None:
                        occ += (1.0 - hit[3] / maxd) ** 1.5
                ao = 1.0 - min(1.0, 1.5 * occ / k)
                shade = (0.43 + 0.52 * ao * hemi) * var
                if flat_dust is not None:
                    dust = flat_dust + rng.uniform(-0.03, 0.03)
                else:
                    hz = min(1.0, max(0.0, p.z / dust_h))
                    hz = hz * hz * (3 - 2 * hz)
                    dust = 0.92 + (0.05 - 0.92) * hz
                    dust += 0.22 * max(0.0, n.z) * (0.4 + 0.6 * (1 - hz)) + 0.1 * max(0.0, n.z)
                    dust += (1.0 - ao) * 0.12 + rng.uniform(-0.03, 0.03)
                edge = narrow * min(1.0, max(0.0, (ao - 0.5) / 0.3))
                cols.append((min(1.0, max(0.0, shade)), min(1.0, max(0.0, dust)), edge, 1.0))
        b['col'] = cols


# ---------------------------------------------------------------------------------------------
# Blender scene output
# ---------------------------------------------------------------------------------------------
def reset_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for d in list(coll):
            coll.remove(d)


def get_mat(key):
    m = bpy.data.materials.get(key)
    if m is None:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        c = MAT_COL[key]
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1.0)
            bsdf.inputs['Metallic'].default_value = 0.5 if key in 'FWT' else 0.2
            bsdf.inputs['Roughness'].default_value = 0.6
            if key in 'GK':
                bsdf.inputs['Emission Color'].default_value = (c[0], c[1], c[2], 1.0)
                bsdf.inputs['Emission Strength'].default_value = 2.0
        m.diffuse_color = (c[0], c[1], c[2], 1.0)
    assert m.name == key
    return m


def build_objects(rig, sharp_deg=37.0):
    col = bpy.context.scene.collection
    objs = {}
    for name, j in rig.joints.items():
        o = bpy.data.objects.new(name, None)
        assert o.name == name, (o.name, name)
        o.empty_display_size = 0.25
        col.objects.link(o)
        if j.parent:
            o.parent = objs[j.parent.name]
        loc, rot, scl = j.local.decompose()
        o.location = loc
        o.rotation_mode = 'XYZ'
        o.rotation_euler = rot.to_euler('XYZ')
        objs[name] = o
    for (jn, mat), b in rig.bufs.items():
        if not b['f']:
            continue
        name = '%s_m%s' % (jn, mat)
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in b['v']], [], b['f'])
        me.update()
        nl = len(me.loops)
        if me.validate(verbose=False):
            print('WARNING: mesh validate changed', name, nl, '->', len(me.loops))
        me.materials.append(get_mat(mat))
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        me.set_sharp_from_angle(angle=radians(sharp_deg))
        if 'col' in b and len(b['col']) == len(me.loops):
            ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
            flat = [x for c in b['col'] for x in c]
            ca.data.foreach_set('color', flat)
            me.color_attributes.active_color = ca
            me.color_attributes.render_color_index = 0
        else:
            print('WARNING: no colours for', name)
        o = bpy.data.objects.new(name, me)
        assert o.name == name, (o.name, name)
        col.objects.link(o)
        o.parent = objs[jn]
        objs[name] = o
    bpy.context.view_layer.update()
    return objs


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
        export_animations=False, export_skins=False, export_morph=False, export_cameras=False,
        export_lights=False, export_extras=False, export_materials='EXPORT', export_normals=True,
        export_texcoords=False, export_tangents=False, export_vertex_color='ACTIVE',
        export_active_vertex_color_when_no_material=True, export_all_vertex_colors=False)
