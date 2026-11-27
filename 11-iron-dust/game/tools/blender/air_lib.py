# air_lib.py -- shared helpers for build_air.py (IRON DUST "Operation Descent" models).
# Authoring space = Blender: +Z up, nose/front = +Y, right = +X  (glTF/Godot: +Y up, front = -Z).
# Everything is authored in WORLD rest coordinates and assigned to a joint; the lib converts to
# joint-local space, bakes vertex colours (R = shade/AO, G = dust) and exports a .glb.
import bpy, bmesh, math, random
from math import sin, cos, pi, radians, sqrt
from mathutils import Vector as V, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

MATS = {
    'A': (0.36, 0.40, 0.36), 'B': (0.20, 0.22, 0.24), 'C': (0.70, 0.22, 0.08),
    'F': (0.09, 0.09, 0.10), 'W': (0.28, 0.30, 0.34), 'T': (0.015, 0.015, 0.015),
    'H': (0.90, 0.68, 0.05), 'G': (0.25, 0.95, 1.00),
}


def lerp(a, b, t):
    return a + (b - a) * t


def P(axis, a, u, v):
    """point from axis coordinate a and in-plane (u,v): x->(y,z)  y->(x,z)  z->(x,y)"""
    if axis == 'x':
        return V((a, u, v))
    if axis == 'y':
        return V((u, a, v))
    return V((u, v, a))


def newell(pts):
    n = V((0, 0, 0))
    k = len(pts)
    for i in range(k):
        a = pts[i]
        b = pts[(i + 1) % k]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    l = n.length
    return n / l if l > 1e-12 else V((0, 0, 1))


def frame(d):
    d = V(d).normalized()
    ref = V((0, 0, 1)) if abs(d.z) < 0.9 else V((0, 1, 0))
    x = (ref - d * ref.dot(d)).normalized()
    y = d.cross(x)
    return d, x, y


class Geo:
    def __init__(s, v=None, f=None, ok=False):
        s.v = v or []
        s.f = f or []
        s.ok = ok          # True = winding known good (skip recalc)

    def __add__(s, o):
        n = len(s.v)
        return Geo(s.v + o.v, s.f + [tuple(i + n for i in f) for f in o.f], s.ok and o.ok)

    def tf(s, M):
        return Geo([M @ p for p in s.v], list(s.f), s.ok)

    def moved(s, d):
        d = V(d)
        return Geo([p + d for p in s.v], list(s.f), s.ok)

    def rotz(s, ang, c=(0, 0, 0)):
        c = V(c)
        M = Matrix.Translation(c) @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Translation(-c)
        return s.tf(M)

    def mirrored(s):
        return Geo([V((-p.x, p.y, p.z)) for p in s.v], [tuple(reversed(f)) for f in s.f], s.ok)

    def sub(s, idx):
        """sub-geo from face indices (compacts verts)"""
        mp = {}
        vs = []
        fs = []
        for i in idx:
            nf = []
            for vi in s.f[i]:
                if vi not in mp:
                    mp[vi] = len(vs)
                    vs.append(s.v[vi])
                nf.append(mp[vi])
            fs.append(tuple(nf))
        return Geo(vs, fs, s.ok)


def merge(geos):
    g = Geo(ok=True)
    for x in geos:
        g = g + x
    return g


def fix(geo, recalc=True, flip=False):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in geo.v]
    for f in geo.f:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if flip:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.verts.index_update()
    out = Geo([v.co.copy() for v in bm.verts], [tuple(v.index for v in f.verts) for f in bm.faces], True)
    bm.free()
    return out


def orient(geo, fn):
    """flip faces so that normal . fn(face_centre) >= 0"""
    fs = []
    for f in geo.f:
        pts = [geo.v[i] for i in f]
        c = sum(pts, V((0, 0, 0))) / len(pts)
        fs.append(f if newell(pts).dot(fn(c)) >= 0 else tuple(reversed(f)))
    geo.f = fs
    geo.ok = True
    return geo


# ---------------------------------------------------------------- primitives
_BOXF = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]


def box(c, s):
    cx, cy, cz = c
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    v = [V((cx + sx * hx, cy + sy * hy, cz + sz * hz)) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    return Geo(v, list(_BOXF), True)


def bx(x0, x1, y0, y1, z0, z1):
    return box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)))


def obb(c, ax, ay, s):
    """oriented box: centre, x dir, y dir (z = x cross y), size"""
    ax = V(ax).normalized()
    ay = V(ay)
    ay = (ay - ax * ay.dot(ax)).normalized()
    az = ax.cross(ay)
    c = V(c)
    g = box((0, 0, 0), s)
    return Geo([c + ax * p.x + ay * p.y + az * p.z for p in g.v], list(g.f), True)


def rect_ring(axis, a, cu, cv, w, h, ch=0.0):
    """rectangle (4 pts) or chamfered rectangle (8 pts) in the plane perpendicular to axis.
    ch = chamfer or (bottom chamfer, top chamfer). 8-pt face order k: 0 bottom, 1 lower-right,
    2 right, 3 upper-right, 4 top, 5 upper-left, 6 left, 7 lower-left."""
    hw, hh = w / 2, h / 2
    if not ch:
        pts = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    else:
        cb, ct = ch if isinstance(ch, tuple) else (ch, ch)
        cb = max(min(cb, hw * 0.96, hh * 0.96), 1e-3)
        ct = max(min(ct, hw * 0.96, hh * 0.96), 1e-3)
        pts = [(-hw + cb, -hh), (hw - cb, -hh), (hw, -hh + cb), (hw, hh - ct),
               (hw - ct, hh), (-hw + ct, hh), (-hw, hh - ct), (-hw, -hh + cb)]
    return [P(axis, a, cu + u, cv + v) for u, v in pts]


def circ_ring(axis, a, cu, cv, r, n, ph=0.0, rv=None):
    rv = r if rv is None else rv
    return [P(axis, a, cu + r * cos(ph + 2 * pi * i / n), cv + rv * sin(ph + 2 * pi * i / n)) for i in range(n)]


def ring3(c, d, r, n, ph=0.0):
    """circle of n points about direction d (CCW about d)"""
    d, x, y = frame(d)
    c = V(c)
    return [c + (x * cos(ph + 2 * pi * i / n) + y * sin(ph + 2 * pi * i / n)) * r for i in range(n)]


def loft(rings, cap0=True, cap1=True, loop=False):
    n = len(rings[0])
    m = len(rings)
    vs = []
    for r in rings:
        vs += [V(p) for p in r]
    fs = []
    for i in range(m if loop else m - 1):
        j = (i + 1) % m
        for k in range(n):
            k2 = (k + 1) % n
            fs.append((i * n + k, i * n + k2, j * n + k2, j * n + k))
    if not loop:
        if cap0:
            fs.append(tuple(range(n - 1, -1, -1)))
        if cap1:
            fs.append(tuple(range((m - 1) * n, m * n)))
    return Geo(vs, fs)


def prism(pts, axis, a0, a1, s1=1.0, d1=(0, 0), cap0=True, cap1=True):
    r0 = [P(axis, a0, u, v) for u, v in pts]
    r1 = [P(axis, a1, u * s1 + d1[0], v * s1 + d1[1]) for u, v in pts]
    return loft([r0, r1], cap0, cap1)


def frust(axis, a0, a1, s0, s1, ch0=0.0, ch1=None):
    """s = (cu, cv, w, h)"""
    ch1 = ch0 if ch1 is None else ch1
    return loft([rect_ring(axis, a0, s0[0], s0[1], s0[2], s0[3], ch0),
                 rect_ring(axis, a1, s1[0], s1[1], s1[2], s1[3], ch1)])


def obox(c, s, ch, axis='y'):
    """box with the 4 edges parallel to `axis` chamfered"""
    cx, cy, cz = c
    if axis == 'y':
        return frust('y', cy - s[1] / 2, cy + s[1] / 2, (cx, cz, s[0], s[2]), (cx, cz, s[0], s[2]), ch)
    if axis == 'x':
        return frust('x', cx - s[0] / 2, cx + s[0] / 2, (cy, cz, s[1], s[2]), (cy, cz, s[1], s[2]), ch)
    return frust('z', cz - s[2] / 2, cz + s[2] / 2, (cx, cy, s[0], s[1]), (cx, cy, s[0], s[1]), ch)


def cyl(p0, p1, r0, r1=None, n=8, cap0=True, cap1=True, ph=0.0):
    p0 = V(p0)
    p1 = V(p1)
    r1 = r0 if r1 is None else r1
    d = p1 - p0
    g = loft([ring3(p0, d, r0, n, ph), ring3(p1, d, r1, n, ph)], cap0, cap1)
    g.ok = True      # rings CCW about the progression direction -> outward normals
    return g


def pipe(pts, r, n=6):
    return merge([cyl(pts[i], pts[i + 1], r, n=n) for i in range(len(pts) - 1)])


def sweep_ring(c, d, r_in, r_out, t, n, a0=None, a1=None, ph=0.0):
    """annulus (rectangular section) about axis d through c; full ring unless a0/a1 given"""
    full = a0 is None
    d, x, y = frame(d)
    c = V(c)
    rings = []
    for i in range(n if full else n + 1):
        a = ph + (2 * pi * i / n if full else a0 + (a1 - a0) * i / n)
        rd = x * cos(a) + y * sin(a)
        rings.append([c + rd * r_in - d * t / 2, c + rd * r_out - d * t / 2,
                      c + rd * r_out + d * t / 2, c + rd * r_in + d * t / 2])
    return loft(rings, not full, not full, loop=full)


def wing(secs):
    """secs: list of (le, te, thickness). hex airfoil sections lofted.
    ring pts: 0 le, 1 upper 28%, 2 upper 72%, 3 te, 4 lower 72%, 5 lower 28%"""
    le0, te0 = V(secs[0][0]), V(secs[0][1])
    le1 = V(secs[1][0])
    up = (te0 - le0).cross(le1 - le0).normalized()
    rings = []
    for le, te, t in secs:
        le = V(le)
        te = V(te)
        a = le.lerp(te, 0.28)
        b = le.lerp(te, 0.72)
        rings.append([le, a + up * t / 2, b + up * t / 2, te, b - up * t / 2, a - up * t / 2])
    return rings


def slab(q, u0=0.0, u1=1.0, v0=0.0, v1=1.0, t=0.05, inside=None, out=None, flat=False, sink=None):
    """panel sitting on quad q=(a,b,c,d) (u: a->b, v: a->d), raised t along the outward normal.
    flat=True -> single floating quad."""
    a, b, c, d = [V(p) for p in q]

    def pt(u, v):
        return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + c * u) * v
    p = [pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)]
    n = newell(p)
    cen = sum(p, V((0, 0, 0))) / 4
    ref = V(out) if out is not None else (cen - V(inside))
    if n.dot(ref) < 0:
        n = -n
        p = [p[0], p[3], p[2], p[1]]
    if flat:
        return Geo([x + n * t for x in p], [(0, 1, 2, 3)], True)
    sink = t * 0.5 if sink is None else sink
    lo = [x - n * sink for x in p]
    hi = [x + n * t for x in p]
    return Geo(lo + hi, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], True)


def tiles(q, nu, nv, gu=0.12, gv=0.12, t=0.05, inside=None, out=None, flat=False, u0=0.0, u1=1.0, v0=0.0, v1=1.0,
          skip=None, sink=None):
    gs = []
    for i in range(nu):
        for j in range(nv):
            if skip and skip(i, j):
                continue
            ua = lerp(u0, u1, (i + gu / 2) / nu)
            ub = lerp(u0, u1, (i + 1 - gu / 2) / nu)
            va = lerp(v0, v1, (j + gv / 2) / nv)
            vb = lerp(v0, v1, (j + 1 - gv / 2) / nv)
            gs.append(slab(q, ua, ub, va, vb, t, inside, out, flat, sink))
    return merge(gs)


def xq(x, y0, y1, z0, z1):
    return (V((x, y0, z0)), V((x, y1, z0)), V((x, y1, z1)), V((x, y0, z1)))


def yq(y, x0, x1, z0, z1):
    return (V((x0, y, z0)), V((x1, y, z0)), V((x1, y, z1)), V((x0, y, z1)))


def zq(z, x0, x1, y0, y1):
    return (V((x0, y0, z)), V((x1, y0, z)), V((x1, y1, z)), V((x0, y1, z)))


class Loft:
    def __init__(s, rings, cap0=True, cap1=True, loop=False):
        s.rings = [[V(p) for p in r] for r in rings]
        s.geo = loft(s.rings, cap0, cap1, loop)
        s.n = len(s.rings[0])

    def quad(s, i, k):
        r0 = s.rings[i]
        r1 = s.rings[i + 1]
        k2 = (k + 1) % s.n
        return (r0[k], r0[k2], r1[k2], r1[k])

    def inside(s, i):
        pts = s.rings[i] + s.rings[i + 1]
        return sum(pts, V((0, 0, 0))) / len(pts)

    def slab(s, i, k, u0=0.0, u1=1.0, v0=0.0, v1=1.0, t=0.05, flat=False):
        return slab(s.quad(i, k), u0, u1, v0, v1, t, inside=s.inside(i), flat=flat)

    def tiles(s, i, k, nu, nv, **kw):
        return tiles(s.quad(i, k), nu, nv, inside=s.inside(i), **kw)


# ---------------------------------------------------------------- model
class Bucket:
    def __init__(s):
        s.v = []
        s.f = []
        s.var = []
        s.dust = []
        s.col = None


class Model:
    def __init__(s, name, ao_dist=2.0, ground=False, seed=7, rays=12):
        s.name = name
        s.nodes = {}
        s.order = []
        s.buckets = {}
        s.iso = {}          # node -> isolated AO group
        s.origin = {}       # obj override name -> world origin
        s.soot = []         # (pos, radius, strength)
        s.dustfn = None
        s.ao_dist = ao_dist
        s.ground = ground
        s.rays = rays
        s.rng = random.Random(seed)
        s.joint(name, parent=False)

    # -- nodes
    def joint(s, name, parent=None, loc=(0, 0, 0), aim=None, rot=None, soot=None, iso=None):
        """world-space rest location; aim = world direction the node's local -Z (glTF -Y) points to"""
        assert '.' not in name and '-' not in name and name not in s.nodes, name
        if parent is None:
            parent = s.name
        q = Quaternion()
        if aim is not None:
            q = V((0, 0, -1)).rotation_difference(V(aim).normalized())
        if rot is not None:
            q = rot
        W = Matrix.Translation(V(loc)) @ q.to_matrix().to_4x4()
        s.nodes[name] = (parent if parent else None, W)
        s.order.append(name)
        if soot:
            s.soot.append((V(loc), soot[0], soot[1]))
        if iso:
            s.iso[name] = iso
        return name

    # -- geometry
    def add(s, geo, mat, node=None, fv=False, recalc=True, flip=False, obj=None, dust=0.0, origin=None):
        assert mat in MATS, mat
        node = node or s.name
        assert node in s.nodes, node
        if (recalc and not geo.ok) or flip:
            geo = fix(geo, recalc and not geo.ok, flip)
        key = (node, mat, obj)
        b = s.buckets.get(key)
        if b is None:
            b = s.buckets[key] = Bucket()
            if obj and origin is not None:
                s.origin[obj] = V(origin)
        off = len(b.v)
        b.v.extend(geo.v)
        pv = s.rng.uniform(-0.06, 0.06)
        pd = s.rng.uniform(0.04, 0.15) + dust
        for f in geo.f:
            b.f.append(tuple(i + off for i in f))
            b.var.append(s.rng.uniform(-0.06, 0.06) if fv else pv)
            b.dust.append(pd + (s.rng.uniform(-0.03, 0.03) if fv else 0.0))
        return geo

    def sym(s, geo, mat, nR=None, nL=None, **kw):
        """add geo (authored on +X / right) and its mirror"""
        s.add(geo, mat, nR, **kw)
        s.add(geo.mirrored(), mat, nL, **kw)

    def tris(s):
        return sum(len(f) - 2 for b in s.buckets.values() for f in b.f)

    # -- vertex colours
    def _colors(s):
        K = s.rays
        D = s.ao_dist
        eps = D * 0.012
        dirs = []
        for i in range(K):
            u = (i + 0.5) / K
            ph = i * 2.399963
            dirs.append((sqrt(u) * cos(ph), sqrt(u) * sin(ph), sqrt(1 - u)))
        groups = {}
        for (node, mat, obj), b in s.buckets.items():
            gv, gf = groups.setdefault(s.iso.get(node, '_static'), ([], []))
            off = len(gv)
            gv.extend(b.v)
            gf.extend(tuple(i + off for i in f) for f in b.f)
        if s.ground:
            gv, gf = groups.setdefault('_static', ([], []))
            off = len(gv)
            gv.extend([V((-999, -999, 0)), V((999, -999, 0)), V((999, 999, 0)), V((-999, 999, 0))])
            gf.append((off, off + 1, off + 2, off + 3))
        trees = {g: BVHTree.FromPolygons(v, f) for g, (v, f) in groups.items()}
        Z0 = V((0, 0, 0))
        for (node, mat, obj), b in s.buckets.items():
            tree = trees[s.iso.get(node, '_static')]
            b.col = []
            for fi, f in enumerate(b.f):
                pts = [b.v[i] for i in f]
                n = newell(pts)
                c = sum(pts, Z0) / len(pts)
                t1 = n.orthogonal().normalized()
                t2 = n.cross(t1)
                wd = [t1 * dx + t2 * dy + n * dz for dx, dy, dz in dirs]
                var = b.var[fi]
                dbase = b.dust[fi] + 0.03 * max(n.z, 0.0)
                under = 1.0 - 0.16 * max(-n.z, 0.0)
                fc = []
                for p in pts:
                    sp = p + (c - p) * 0.22 + n * eps
                    occ = 0.0
                    for w in wd:
                        h = tree.ray_cast(sp, w, D)
                        if h[0] is not None:
                            occ += 1.0 - h[3] / D
                    ao = 1.0 - occ / K
                    r = (0.45 + 0.55 * ao ** 1.3) * under * (1.0 + var)
                    g = dbase + 0.12 * (1.0 - ao)
                    if s.dustfn:
                        g += s.dustfn(p, n)
                    for sp_, sr, ss in s.soot:
                        dd = (p - sp_).length
                        if dd < sr:
                            g += ss * (1.0 - dd / sr) ** 1.5
                    fc.append((min(max(r, 0.3), 1.0), min(max(g, 0.0), 1.0), 0.0, 1.0))
                b.col.append(fc)

    # -- build blender scene
    def build(s):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        col = bpy.context.scene.collection
        used = sorted({k[1] for k in s.buckets})
        mats = {}
        for k in used:
            m = bpy.data.materials.new(k)
            m.diffuse_color = (*MATS[k], 1.0)
            try:
                m.use_nodes = True
            except Exception:
                pass
            nt = m.node_tree
            if nt:
                bs = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                if bs:
                    bs.inputs['Base Color'].default_value = (*MATS[k], 1.0)
                    bs.inputs['Roughness'].default_value = 0.75
                    bs.inputs['Metallic'].default_value = 0.0
                    if k == 'G':
                        try:
                            bs.inputs['Emission Color'].default_value = (*MATS[k], 1.0)
                            bs.inputs['Emission Strength'].default_value = 2.0
                        except Exception:
                            pass
            mats[k] = m
        objs = {}
        for name in s.order:
            par, W = s.nodes[name]
            o = bpy.data.objects.new(name, None)
            o.empty_display_size = 0.5
            col.objects.link(o)
            o.rotation_mode = 'QUATERNION'
            L = (s.nodes[par][1].inverted() @ W) if par else W
            if par:
                o.parent = objs[par]
            loc, rot, scl = L.decompose()
            o.location = loc
            o.rotation_quaternion = rot
            objs[name] = o
        s._colors()
        for (node, mat, obj), b in s.buckets.items():
            name = '%s_m%s' % (obj or node, mat)
            assert '.' not in name and name not in objs, name
            Winv = s.nodes[node][1].inverted()
            org = Winv @ s.origin[obj] if obj in s.origin else V((0, 0, 0))
            me = bpy.data.meshes.new(name)
            me.from_pydata([tuple((Winv @ p) - org) for p in b.v], [], b.f)
            me.update()
            assert len(me.polygons) == len(b.f)
            me.materials.append(mats[mat])
            ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
            flat = [0.0] * (len(me.loops) * 4)
            for poly, fc in zip(me.polygons, b.col):
                for li, c in zip(poly.loop_indices, fc):
                    flat[li * 4:li * 4 + 4] = c
            ca.data.foreach_set('color', flat)
            me.color_attributes.active_color = ca
            me.color_attributes.render_color_index = 0
            me.shade_smooth()
            me.set_sharp_from_angle(angle=radians(33))
            o = bpy.data.objects.new(name, me)
            col.objects.link(o)
            o.parent = objs[node]
            o.location = org
            objs[name] = o
            assert o.name == name and me.name == name, (o.name, me.name)
        bpy.context.view_layer.update()
        return objs

    def export(s, path):
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
            export_normals=True, export_texcoords=False, export_materials='EXPORT',
            export_vertex_color='ACTIVE', export_all_vertex_colors=False,
            export_active_vertex_color_when_no_material=True,
            export_animations=False, export_skins=False, export_morph=False, export_extras=False,
            export_cameras=False, export_lights=False)
        vs = [p for b in s.buckets.values() for p in b.v]
        lo = [min(p[i] for p in vs) for i in range(3)]
        hi = [max(p[i] for p in vs) for i in range(3)]
        print('BUILT %s tris=%d size(godot X,Y,Z)=%.1f x %.1f x %.1f  min(bl)=%s max(bl)=%s' % (
            s.name, s.tris(), hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1],
            ['%.1f' % x for x in lo], ['%.1f' % x for x in hi]))


# ---------------------------------------------------------------- compound helpers
def hollow_end(m, node, ring, d, lip=0.14, depth=1.0, shrink=0.75, mo='A', mi='T', **kw):
    """open end of a tube: lip annulus (mo) + inner walls and back plate (mi). d = outward direction of the opening"""
    d = V(d).normalized()
    ring = [V(p) for p in ring]
    n = len(ring)
    c = sum(ring, V((0, 0, 0))) / n
    r1 = [c + (p - c) * (1 - lip) for p in ring]
    r2 = [c + (p - c) * (1 - lip) * shrink - d * depth for p in ring]
    lipg = Geo(ring + r1, [(k, (k + 1) % n, (k + 1) % n + n, k + n) for k in range(n)])
    orient(lipg, lambda fc: d)
    wall = Geo(r1 + r2, [(k, (k + 1) % n, (k + 1) % n + n, k + n) for k in range(n)])
    orient(wall, lambda fc: (c - fc) - d * (c - fc).dot(d))
    cap = Geo(list(r2), [tuple(range(n))])
    orient(cap, lambda fc: d)
    m.add(lipg, mo, node, **kw)
    m.add(wall + cap, mi, node, **kw)


def nozzle(m, node, exit_c, d, r_exit, r_throat, length, n=12, mo='F', mi='T', lip=0.1, depth=0.75, ph=0.0, bulge=0.75):
    """engine bell. exit_c = centre of exit plane, d = exhaust direction."""
    d = V(d).normalized()
    e = V(exit_c)
    thr = e - d * length
    outer = loft([ring3(thr, d, r_throat, n, ph), ring3(e - d * length * 0.5, d, lerp(r_throat, r_exit, bulge), n, ph),
                  ring3(e, d, r_exit, n, ph), ring3(e, d, r_exit * (1 - lip), n, ph)], cap0=True, cap1=False)
    outer.ok = True
    inner = loft([ring3(e, d, r_exit * (1 - lip), n, ph), ring3(e - d * length * depth, d, r_throat * 0.8, n, ph)],
                 cap0=False, cap1=True)
    inner.ok = True
    m.add(outer, mo, node)
    m.add(inner, mi, node, dust=0.5)


def greebles(m, mat_choices, o, u, v, count, smin, smax, hmin, hmax, node=None, seed=1, mode='box'):
    """scatter boxes on the parallelogram o + s*u + t*v, raised along n = u x v (pass u,v so that u x v points out)"""
    rng = random.Random(seed)
    o, u, v = V(o), V(u), V(v)
    n = u.cross(v).normalized()
    ul, vl = u.length, v.length
    un, vn = u / ul, v / vl
    acc = {}
    for i in range(count):
        su = rng.uniform(smin, smax)
        sv = rng.uniform(smin, smax)
        if rng.random() < 0.4:
            su *= 2.2
        elif rng.random() < 0.4:
            sv *= 1.8
        su = min(su, ul * 0.9)
        sv = min(sv, vl * 0.9)
        h = rng.uniform(hmin, hmax)
        cu = rng.uniform(su / 2, ul - su / 2)
        cv = rng.uniform(sv / 2, vl - sv / 2)
        c = o + un * cu + vn * cv + n * (h / 2 - 0.05 * h)
        mat = rng.choice(mat_choices)
        acc.setdefault(mat, []).append(obb(c, un, vn, (su, sv, h)))
    for mat, gs in acc.items():
        for g in gs:
            m.add(g, mat, node)
