# ck_kit.py -- geometry kit for the first-person cockpit (Blender 5.x, headless).
# Authoring space is Blender: the pilot's eye is the origin, looking along +Y, +Z up, +X right.
# glTF export maps (x, y, z) -> (x, z, -y): Godot eye at the origin looking along -Z, +Y up.
#
# Everything is authored in WORLD coordinates through a Pen (a transform stack); the kit converts
# to the owning node's local space when it emits.  One mesh node can hold several materials.
# Sharp edges are made by splitting vertices per primitive, so every polygon is smooth shaded and
# no custom normals are needed.
import bpy, bmesh, math
from math import sin, cos, pi, radians, atan2, sqrt
from mathutils import Vector, Matrix, Euler

I4 = Matrix.Identity(4)


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def RX(a):
    return Matrix.Rotation(a, 4, 'X')


def RY(a):
    return Matrix.Rotation(a, 4, 'Y')


def RZ(a):
    return Matrix.Rotation(a, 4, 'Z')


def xf(pos=(0, 0, 0), rot=(0, 0, 0)):
    return Matrix.Translation(Vector(pos)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()


def frame(pos, xa, ya, za):
    m = Matrix.Identity(4)
    for i, a in enumerate((xa, ya, za)):
        m[0][i], m[1][i], m[2][i] = a[0], a[1], a[2]
    m[0][3], m[1][3], m[2][3] = pos[0], pos[1], pos[2]
    return m


def frame_x(pos, xdir, yhint):
    """Orthonormal frame whose X runs along xdir and whose Y is as close to yhint as possible."""
    x = Vector(xdir).normalized()
    y = Vector(yhint)
    y = (y - x * y.dot(x)).normalized()
    z = x.cross(y)
    return frame(pos, x, y, z)


def frame_z(pos, zdir, xhint=(1, 0, 0)):
    z = Vector(zdir).normalized()
    x = Vector(xhint)
    if abs(x.dot(z)) > 0.999:
        x = Vector((0, 1, 0))
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    return frame(pos, x, y, z)


def panel_frame(pos, yaw=0.0, tilt=0.0, roll=0.0):
    """Panel convention: local X = right (seen by the viewer), local Z = up along the face,
    local -Y = face normal (toward the viewer).  tilt > 0 leans the top away from the viewer."""
    return T(*pos) @ RZ(yaw) @ RX(-tilt) @ RY(roll)


AX = {'Z': I4, 'X': RY(pi / 2), 'Y': RX(-pi / 2)}

# ------------------------------------------------------------------------------------------
# 2D outline helpers (lists of (a, b)), counter-clockwise
# ------------------------------------------------------------------------------------------


def circle(r, n=24, ph=0.0, c=(0, 0), ry=None):
    ry = r if ry is None else ry
    return [(c[0] + r * cos(ph + 2 * pi * i / n), c[1] + ry * sin(ph + 2 * pi * i / n)) for i in range(n)]


def rrect(hx, hz, c=0.01, seg=1, c2=None):
    """Rectangle with chamfered (seg=1) or rounded corners.  c2 = radius of the two lower corners."""
    c2 = c if c2 is None else c2
    out = []
    for (sx, sz, a0, rr) in ((1, -1, -pi / 2, c2), (1, 1, 0.0, c), (-1, 1, pi / 2, c), (-1, -1, pi, c2)):
        cx, cz = sx * (hx - rr), sz * (hz - rr)
        if rr <= 1e-6:
            out.append((sx * hx, sz * hz))
            continue
        for k in range(seg + 1):
            a = a0 + (pi / 2) * k / seg
            out.append((cx + rr * cos(a), cz + rr * sin(a)))
    return out


def poly_area(p):
    return 0.5 * sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))


def offset_poly(p, d):
    """Inset (d > 0) / outset (d < 0) a polygon by mitred offset.  Keeps the vertex count."""
    if abs(d) < 1e-9:
        return list(p)
    sgn = 1.0 if poly_area(p) > 0 else -1.0
    n = len(p)
    out = []
    for i in range(n):
        a, b, c = Vector(p[i - 1]), Vector(p[i]), Vector(p[(i + 1) % n])
        d1, d2 = (b - a), (c - b)
        if d1.length < 1e-9 or d2.length < 1e-9:
            out.append((b.x, b.y))
            continue
        d1.normalize()
        d2.normalize()
        n1 = Vector((-d1.y, d1.x)) * sgn
        n2 = Vector((-d2.y, d2.x)) * sgn
        k = 1.0 + n1.dot(n2)
        m = (n1 + n2) / max(k, 0.2)
        q = b + m * d
        out.append((q.x, q.y))
    return out


def move_poly(p, dx=0.0, dz=0.0, rot=0.0, sx=1.0):
    c, s = cos(rot), sin(rot)
    q = [((a * sx) * c - b * s + dx, (a * sx) * s + b * c + dz) for a, b in p]
    if sx < 0:
        q.reverse()
    return q


# ------------------------------------------------------------------------------------------
def _finish(verts, faces, bevel=0.0, segs=1, sharp=30.0, recalc=True, bevel_min=0.5):
    """Fix winding, bevel the hard edges, split the edges sharper than `sharp` degrees."""
    bm = bmesh.new()
    vv = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vv[i] for i in f])
        except ValueError:
            pass
    bm.normal_update()
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bevel > 0.0:
        es = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > bevel_min]
        if es:
            bmesh.ops.bevel(bm, geom=es, offset=bevel, offset_type='OFFSET', segments=segs, profile=0.5,
                            affect='EDGES', clamp_overlap=True)
        bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])
    if sharp is not None:
        thr = radians(sharp)
        es = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > thr]
        if es:
            bmesh.ops.split_edges(bm, edges=es)
    bm.verts.index_update()
    ov = [v.co.copy() for v in bm.verts]
    of = [tuple(v.index for v in f.verts) for f in bm.faces if len(f.verts) >= 3]
    bm.free()
    return ov, of


class Node:
    def __init__(self, name, parent, world, is_mesh):
        self.name, self.parent, self.world, self.is_mesh = name, parent, world.copy(), is_mesh
        self.inv = world.inverted()


class Kit:
    def __init__(self):
        self.nodes = {}
        self.order = []
        self.bufs = {}       # (mesh node, material) -> {'v': [], 'f': [], 'col': [], 'uv': []}
        self.tris = 0

    # -- nodes ---------------------------------------------------------------------------
    def _add_node(self, name, parent, world, is_mesh):
        assert name not in self.nodes, name
        if world is None:
            world = self.nodes[parent].world if parent else I4
        nd = Node(name, parent, world, is_mesh)
        self.nodes[name] = nd
        self.order.append(name)
        return nd

    def empty(self, name, parent=None, world=None):
        return self._add_node(name, parent, world, False)

    def mesh(self, name, parent=None, world=None):
        return self._add_node(name, parent, world, True)

    def pen(self, mesh_name, M=None, mirror=False):
        assert self.nodes[mesh_name].is_mesh, mesh_name
        return Pen(self, mesh_name, M if M is not None else I4, mirror)

    def add(self, node, mat, verts, faces, col=None, uvs=None):
        b = self.bufs.setdefault((node, mat), {'v': [], 'f': [], 'col': [], 'uv': []})
        off = len(b['v'])
        b['v'].extend(verts)
        for i, f in enumerate(faces):
            b['f'].append(tuple(j + off for j in f))
            b['col'].append(col)
            if uvs is not None:
                b['uv'].append(uvs[i])
            self.tris += len(f) - 2

    # -- Blender scene ---------------------------------------------------------------------
    def build(self, mats):
        col = bpy.context.scene.collection
        objs = {}
        per_node = {}
        for (node, mat), b in self.bufs.items():
            per_node.setdefault(node, []).append((mat, b))
        stats = {}
        for name in self.order:
            nd = self.nodes[name]
            data = None
            if nd.is_mesh:
                parts = per_node.get(name)
                assert parts, 'mesh node without geometry: ' + name
                verts, faces, midx, cols, uvs = [], [], [], [], []
                has_col = any(c is not None for _, b in parts for c in b['col'])
                has_uv = any(b['uv'] for _, b in parts)
                me = bpy.data.meshes.new(name)
                for si, (mat, b) in enumerate(parts):
                    me.materials.append(mats[mat])
                    off = len(verts)
                    verts.extend(tuple(v) for v in b['v'])
                    for fi, f in enumerate(b['f']):
                        faces.append(tuple(j + off for j in f))
                        midx.append(si)
                        c = b['col'][fi] or (1.0, 1.0, 1.0)
                        cols.extend([(c[0], c[1], c[2], 1.0)] * len(f))
                        if has_uv:
                            uvs.extend(b['uv'][fi] if b['uv'] else [(0.0, 0.0)] * len(f))
                me.from_pydata(verts, [], faces)
                me.update()
                nl = len(me.loops)
                if me.validate(verbose=False):
                    print('WARNING: validate changed mesh', name, nl, '->', len(me.loops))
                    has_col = has_col and len(me.loops) == nl
                    has_uv = has_uv and len(me.loops) == nl
                me.polygons.foreach_set('material_index', midx[:len(me.polygons)])
                me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
                if has_col:
                    ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
                    ca.data.foreach_set('color', [x for c in cols for x in c])
                    me.color_attributes.active_color = ca
                    me.color_attributes.render_color_index = 0
                if has_uv:
                    uv = me.uv_layers.new(name='UVMap')
                    uv.data.foreach_set('uv', [x for c in uvs for x in c])
                me.update()
                data = me
                stats[name] = sum(len(p.vertices) - 2 for p in me.polygons)
            o = bpy.data.objects.new(name, data)
            assert o.name == name, (o.name, name)
            o.empty_display_size = 0.03
            col.objects.link(o)
            objs[name] = o
        for name in self.order:
            nd = self.nodes[name]
            o = objs[name]
            if nd.parent:
                o.parent = objs[nd.parent]
                local = self.nodes[nd.parent].inv @ nd.world
            else:
                local = nd.world
            loc, rot, scl = local.decompose()
            o.rotation_mode = 'QUATERNION'
            o.location = loc
            o.rotation_quaternion = rot
        bpy.context.view_layer.update()
        return objs, stats


class Pen:
    def __init__(self, kit, node, M, mirror=False):
        self.kit, self.node, self.M, self.mirror = kit, node, M, mirror

    def at(self, pos=(0, 0, 0), rot=(0, 0, 0)):
        return Pen(self.kit, self.node, self.M @ xf(pos, rot), self.mirror)

    def mul(self, M):
        return Pen(self.kit, self.node, self.M @ M, self.mirror)

    def on(self, node):
        return Pen(self.kit, node, self.M, self.mirror)

    def mir(self, flag=True):
        return Pen(self.kit, self.node, self.M, flag)

    def w(self, p):
        """Local point -> world point (respecting the mirror)."""
        q = self.M @ Vector(p)
        if self.mirror:
            q.x = -q.x
        return q

    # ------------------------------------------------------------------------------------
    def raw(self, mat, verts, faces, col=None, uvs=None):
        """Emit as is (no winding fix, shared vertices stay shared = smooth)."""
        inv = self.kit.nodes[self.node].inv
        vs = [self.M @ Vector(v) for v in verts]
        if self.mirror:
            vs = [Vector((-v.x, v.y, v.z)) for v in vs]
            faces = [tuple(reversed(f)) for f in faces]
            if uvs is not None:
                uvs = [list(reversed(u)) for u in uvs]
        vs = [inv @ v for v in vs]
        self.kit.add(self.node, mat, vs, faces, col, uvs)

    def emit(self, mat, verts, faces, bevel=0.0, segs=1, sharp=30.0, recalc=True, col=None, M=None):
        v, f = _finish(verts, faces, bevel, segs, sharp, recalc)
        if M is not None:
            v = [M @ p for p in v]
        self.raw(mat, v, f, col)

    # -- primitives ------------------------------------------------------------------------
    def box(self, mat, size, pos=(0, 0, 0), rot=(0, 0, 0), bv=0.0, segs=1, sharp=30.0, col=None,
            tx=1.0, ty=1.0, sh=(0.0, 0.0)):
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
             (-hx * tx + sh[0], -hy * ty + sh[1], hz), (hx * tx + sh[0], -hy * ty + sh[1], hz),
             (hx * tx + sh[0], hy * ty + sh[1], hz), (-hx * tx + sh[0], hy * ty + sh[1], hz)]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self.emit(mat, v, f, bv, segs, sharp, True, col, xf(pos, rot))

    @staticmethod
    def _map(plane):
        if plane == 'XZ':
            return lambda a, b, t: (a, t, b)
        if plane == 'XY':
            return lambda a, b, t: (a, b, t)
        return lambda a, b, t: (t, a, b)

    def prism(self, mat, pts, t0, t1, plane='XZ', bv=0.0, segs=1, sharp=30.0, col=None, pos=(0, 0, 0), rot=(0, 0, 0)):
        """Polygon extruded along the plane normal from t0 to t1."""
        mp = self._map(plane)
        n = len(pts)
        v = [mp(a, b, t0) for a, b in pts] + [mp(a, b, t1) for a, b in pts]
        f = [tuple(range(n)), tuple(range(n, 2 * n))]
        for i in range(n):
            j = (i + 1) % n
            f.append((i, j, n + j, n + i))
        self.emit(mat, v, f, bv, segs, sharp, True, col, xf(pos, rot))

    def loft(self, mat, rings, cap0=True, cap1=True, sharp=30.0, col=None, recalc=True, M=None):
        n = len(rings[0])
        v = []
        for r in rings:
            assert len(r) == n
            v.extend(r)
        f = []
        if cap0:
            f.append(tuple(range(n)))
        if cap1:
            f.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
        for k in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                f.append((k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i))
        self.emit(mat, v, f, 0.0, 1, sharp, recalc, col, M)

    def steps(self, mat, outline, st, plane='XZ', cap0=True, cap1=True, sharp=30.0, col=None, pos=(0, 0, 0), rot=(0, 0, 0)):
        """Loft of inset copies of one outline.  st = [(inset, t)]: inset > 0 shrinks, t along the normal."""
        mp = self._map(plane)
        rings = []
        for ins, t in st:
            o = offset_poly(outline, ins)
            rings.append([mp(a, b, t) for a, b in o])
        self.loft(mat, rings, cap0, cap1, sharp, col, True, xf(pos, rot))

    def plate(self, mat, outline, t0, t1, ch=0.002, plane='XZ', col=None, pos=(0, 0, 0), rot=(0, 0, 0), back=True, sharp=30.0):
        """Flat plate between t0 (back) and t1 (front face) with a chamfer around the front face."""
        s = 1.0 if t1 > t0 else -1.0
        self.steps(mat, outline, [(0, t0), (0, t1 - s * ch), (ch, t1)], plane, back, True, sharp, col, pos, rot)

    def lathe(self, mat, prof, n=16, axis='Z', pos=(0, 0, 0), rot=(0, 0, 0), sharp=35.0, ph=0.0, closed=False,
              scale=(1, 1, 1), facet=False, col=None, arc=None):
        """prof = [(r, h)], bottom -> outside -> top for outward normals; r == 0 makes a pole.
        Smooth around the axis; profile corners sharper than `sharp` are split."""
        pr = list(prof)
        if closed:
            pr = pr + [pr[0]]
        m = len(pr)
        segd = []
        for k in range(m - 1):
            d = Vector((pr[k + 1][0] - pr[k][0], pr[k + 1][1] - pr[k][1]))
            segd.append(d.normalized() if d.length > 1e-9 else Vector((0, 0)))
        thr = radians(sharp)
        v, f = [], []
        full = arc is None
        cnt = n if full else n + 1

        def ring(r, h):
            if r <= 1e-7:
                v.append((0.0, 0.0, h * scale[2]))
                return [len(v) - 1]
            ids = []
            for i in range(cnt):
                a = ph + ((2 * pi * i / n) if full else (arc * i / n))
                ids.append(len(v))
                v.append((r * cos(a) * scale[0], r * sin(a) * scale[1], h * scale[2]))
            return ids
        def soft(k0, k1):
            if segd[k0].length == 0 or segd[k1].length == 0:
                return True
            return segd[k0].angle(segd[k1]) <= thr
        prev = None
        first = None
        for k in range(m - 1):
            if prev is None:
                a = ring(*pr[k])
                first = a
            else:
                a = prev if soft(k - 1, k) else ring(*pr[k])
            if closed and k == m - 2 and soft(m - 2, 0):
                b = first
            else:
                b = ring(*pr[k + 1])
            lim = n if full else n
            for i in range(lim):
                j = (i + 1) % cnt if full else i + 1
                if len(a) == 1 and len(b) == 1:
                    continue
                if len(a) == 1:
                    f.append((a[0], b[j], b[i]))
                elif len(b) == 1:
                    f.append((a[i], a[j], b[0]))
                else:
                    f.append((a[i], a[j], b[j], b[i]))
            prev = b
        M = xf(pos, rot) @ AX[axis]
        if facet:
            self.emit(mat, v, f, 0.0, 1, 30.0, False, col, M)
        else:
            self.raw(mat, [M @ Vector(p) for p in v], f, col)

    def cyl(self, mat, r, h, pos=(0, 0, 0), axis='Z', rot=(0, 0, 0), n=12, r2=None, ch=0.0, cap0=True, cap1=True,
            ph=0.0, facet=False, col=None):
        r2 = r if r2 is None else r2
        pr = []
        if cap0:
            pr.append((0.0, -h / 2))
        if ch > 0:
            pr += [(r - ch, -h / 2), (r, -h / 2 + ch), (r2, h / 2 - ch), (r2 - ch, h / 2)]
        else:
            pr += [(r, -h / 2), (r2, h / 2)]
        if cap1:
            pr.append((0.0, h / 2))
        self.lathe(mat, pr, n, axis, pos, rot, ph=ph, facet=facet, col=col)

    def rod(self, mat, p0, p1, r, n=8, r2=None, caps=True, col=None, ch=0.0):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        if L < 1e-7:
            return
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        M = Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4()
        r2 = r if r2 is None else r2
        pr = []
        if caps:
            pr.append((0.0, -L / 2))
        if ch > 0:
            pr += [(r - ch, -L / 2), (r, -L / 2 + ch), (r2, L / 2 - ch), (r2 - ch, L / 2)]
        else:
            pr += [(r, -L / 2), (r2, L / 2)]
        if caps:
            pr.append((0.0, L / 2))
        self.mul(M).lathe(mat, pr, n, col=col)

    def ball(self, mat, r, pos=(0, 0, 0), n=12, m=6, scale=(1, 1, 1), col=None, rot=(0, 0, 0)):
        prof = [(r * sin(pi * k / m) if 0 < k < m else 0.0, -r * cos(pi * k / m)) for k in range(m + 1)]
        self.lathe(mat, prof, n, 'Z', pos, rot, sharp=80.0, scale=scale, col=col)

    def dome(self, mat, r, h, pos=(0, 0, 0), axis='Z', rot=(0, 0, 0), n=12, m=3, col=None, skirt=0.0):
        prof = []
        if skirt > 0:
            prof.append((r, -skirt))
        for k in range(m):
            a = (pi / 2) * k / m
            prof.append((r * cos(a), h * sin(a)))
        prof.append((0.0, h))
        self.lathe(mat, prof, n, axis, pos, rot, sharp=80.0, col=col)

    def torus(self, mat, R, r, pos=(0, 0, 0), axis='Z', rot=(0, 0, 0), n=24, m=8, col=None, arc=None, ph=0.0):
        prof = [(R + r * cos(-pi + 2 * pi * k / m), r * sin(-pi + 2 * pi * k / m)) for k in range(m)]
        # traverse so that the outside goes up: start at the inner point, go round under -> outside -> top
        self.lathe(mat, prof, n, axis, pos, rot, sharp=80.0, closed=True, col=col, arc=arc, ph=ph)

    def ring(self, mat, r_out, r_in, t0, t1, ch=0.0, pos=(0, 0, 0), axis='Z', rot=(0, 0, 0), n=24, col=None, ph=0.0):
        """Flat washer / tube section between heights t0 < t1."""
        if ch > 0:
            pr = [(r_in, t0), (r_out, t0), (r_out, t1 - ch), (r_out - ch, t1), (r_in + ch, t1), (r_in, t1 - ch)]
        else:
            pr = [(r_in, t0), (r_out, t0), (r_out, t1), (r_in, t1)]
        self.lathe(mat, pr, n, axis, pos, rot, closed=True, col=col, ph=ph)

    def disc(self, mat, r, pos=(0, 0, 0), axis='Z', rot=(0, 0, 0), n=16, col=None, ph=0.0, r_in=0.0):
        """Single-sided disc facing the axis direction."""
        if r_in > 0:
            self.lathe(mat, [(r_in, 0.0), (r, 0.0)], n, axis, pos, rot, col=col, ph=ph)
            return
        v = [(r * cos(ph + 2 * pi * i / n), r * sin(ph + 2 * pi * i / n), 0.0) for i in range(n)]
        M = xf(pos, rot) @ AX[axis]
        self.raw(mat, [M @ Vector(p) for p in v], [tuple(range(n))], col)

    def quad(self, mat, pts, col=None):
        """Single-sided polygon; counter-clockwise seen from its front."""
        self.raw(mat, [Vector(p) for p in pts], [tuple(range(len(pts)))], col)

    def pipe(self, mat, pts, r, n=8, bend=0.0, bseg=4, caps=True, col=None, closed=False):
        """Round tube along a polyline; interior corners are filleted with radius `bend`."""
        P = [Vector(p) for p in pts]
        if bend > 0 and len(P) > 2:
            Q = [P[0]] if not closed else []
            rng = range(1, len(P) - 1) if not closed else range(len(P))
            for i in rng:
                a, b, c = P[i - 1], P[i], P[(i + 1) % len(P)]
                d1, d2 = (a - b), (c - b)
                l1, l2 = d1.length, d2.length
                if l1 < 1e-7 or l2 < 1e-7:
                    Q.append(b)
                    continue
                d1.normalize()
                d2.normalize()
                ang = d1.angle(d2)
                if ang > pi - 0.02:
                    Q.append(b)
                    continue
                tl = min(bend / math.tan(ang / 2), l1 * 0.49, l2 * 0.49)
                p_a, p_c = b + d1 * tl, b + d2 * tl
                for k in range(bseg + 1):
                    t = k / bseg
                    Q.append((1 - t) ** 2 * p_a + 2 * t * (1 - t) * b + t * t * p_c)
            if not closed:
                Q.append(P[-1])
            P = Q
        m = len(P)
        tang = []
        for i in range(m):
            if closed:
                d = P[(i + 1) % m] - P[i - 1]
            else:
                d = (P[min(i + 1, m - 1)] - P[max(i - 1, 0)])
            tang.append(d.normalized())
        ref = tang[0].orthogonal().normalized()
        v, f = [], []
        for i in range(m):
            t = tang[i]
            ref = (ref - t * ref.dot(t))
            if ref.length < 1e-6:
                ref = t.orthogonal()
            ref.normalize()
            bn = t.cross(ref)
            for k in range(n):
                a = 2 * pi * k / n
                v.append(P[i] + (ref * cos(a) + bn * sin(a)) * r)
        segs = m if closed else m - 1
        for i in range(segs):
            i2 = (i + 1) % m
            for k in range(n):
                k2 = (k + 1) % n
                f.append((i * n + k, i * n + k2, i2 * n + k2, i2 * n + k))
        self.raw(mat, v, f, col)
        if caps and not closed:
            c0 = [P[0] + (v[k] - P[0]) for k in range(n)]
            self.raw(mat, c0, [tuple(reversed(range(n)))], col)
            c1 = [v[(m - 1) * n + k] for k in range(n)]
            self.raw(mat, c1, [tuple(range(n))], col)

    def rloft(self, mat, st, n=14, axis='Z', pos=(0, 0, 0), rot=(0, 0, 0), ph=0.0, cap0=True, cap1=True, sharp=50.0,
              col=None, fn=None):
        """Round loft.  st = [(t, ru, rv, cu, cv)]; fn(a, t) -> radius multiplier for organic shapes."""
        rings = []
        for s in st:
            t, ru, rv = s[0], s[1], s[2]
            cu = s[3] if len(s) > 3 else 0.0
            cv = s[4] if len(s) > 4 else 0.0
            r = []
            for i in range(n):
                a = ph + 2 * pi * i / n
                k = fn(a, t) if fn else 1.0
                r.append((cu + ru * k * cos(a), cv + rv * k * sin(a), t))
            rings.append(r)
        self.loft(mat, rings, cap0, cap1, sharp, col, True, xf(pos, rot) @ AX[axis])

    def pillow(self, mat, hx, hy, h, rc=0.02, re=0.012, bulge=0.006, m=4, ne=3, npf=4, col=None, pos=(0, 0, 0),
               rot=(0, 0, 0), tuck=0.004, lean=(0.0, 0.0), top_scale=(1.0, 1.0)):
        """Padded cushion: rounded-rectangle plan (half sizes hx, hy), base on z=0, crown at z = h + bulge."""
        def rr(d, z, k, rnd=0.0):
            x, y = max(hx - d, 1e-4), max(hy - d, 1e-4)
            r = max(min(rc - d, x, y), 1e-4)
            r = r + (min(x, y) - r) * rnd               # toward a stadium outline: no creased diagonals on the crown
            sx = 1.0 + (top_scale[0] - 1.0) * k
            sy = 1.0 + (top_scale[1] - 1.0) * k
            out = []
            for (qx, qy, a0) in ((1, -1, -pi / 2), (1, 1, 0.0), (-1, 1, pi / 2), (-1, -1, pi)):
                cx, cy = qx * (x - r), qy * (y - r)
                for j in range(m + 1):
                    a = a0 + (pi / 2) * j / m
                    out.append(((cx + r * cos(a)) * sx + lean[0] * k, (cy + r * sin(a)) * sy + lean[1] * k, z))
            return out
        hmin = min(hx, hy)
        rings = [rr(tuck, 0.0, 0.0), rr(0.0, tuck * 2.0, tuck * 2.0 / h)]
        for j in range(ne + 1):
            a = (pi / 2) * j / ne
            z = h - re + re * sin(a)
            rings.append(rr(re * (1 - cos(a)), z, z / h, 0.25 * j / ne))
        for j in range(1, npf + 1):
            t = j / npf
            rings.append(rr(re + t * (hmin - re) * 0.93, h + bulge * sin(t * pi / 2), 1.0, 0.25 + 0.75 * t))
        self.loft(mat, rings, True, True, 62.0, col, True, xf(pos, rot))

    def drilled(self, mat, nx, ny, cell, hole_r, th, margin=0.006, hn=8, col=None, pos=(0, 0, 0), rot=(0, 0, 0)):
        """Plate in the local XY plane with a grid of real through holes."""
        v, f = [], []
        W, H = nx * cell, ny * cell
        x0, y0 = -W / 2, -H / 2

        def cellfaces(cx, cy, z, flip):
            base = len(v)
            h = cell / 2
            sq = [(h, 0), (h, h), (0, h), (-h, h), (-h, 0), (-h, -h), (0, -h), (h, -h)]
            for (a, b) in sq:
                v.append((cx + a, cy + b, z))
            for k in range(hn):
                an = 2 * pi * k / hn
                v.append((cx + hole_r * cos(an), cy + hole_r * sin(an), z))
            for k in range(8):
                k2 = (k + 1) % 8
                q = (base + k, base + k2, base + 8 + (k2 * hn // 8), base + 8 + (k * hn // 8))
                f.append(tuple(reversed(q)) if flip else q)
            return base
        for iy in range(ny):
            for ix in range(nx):
                cx, cy = x0 + (ix + 0.5) * cell, y0 + (iy + 0.5) * cell
                bt = cellfaces(cx, cy, th / 2, False)
                bb = cellfaces(cx, cy, -th / 2, True)
                for k in range(hn):
                    k2 = (k + 1) % hn
                    f.append((bt + 8 + k, bt + 8 + k2, bb + 8 + k2, bb + 8 + k))
        v2, f2 = _finish(v, f, 0.0, 1, 30.0, False)
        self.raw(mat, [xf(pos, rot) @ p for p in v2], f2, col)
        # frame around the grid (solid margin) -- four bars
        q = self.at(pos, rot)
        if margin > 0:
            q.box(mat, (W + 2 * margin, margin, th), (0, H / 2 + margin / 2, 0), col=col)
            q.box(mat, (W + 2 * margin, margin, th), (0, -H / 2 - margin / 2, 0), col=col)
            q.box(mat, (margin, H, th), (W / 2 + margin / 2, 0, 0), col=col)
            q.box(mat, (margin, H, th), (-W / 2 - margin / 2, 0, 0), col=col)

    def sheet(self, mat, verts, faces, th=0.02, down=(0, 0, -1), sharp=30.0, col=None):
        """Thick sheet from an open surface (faces counter-clockwise seen from the front): front + back + rim."""
        dn = Vector(down).normalized() * th
        V = [Vector(v) for v in verts]
        n = len(V)
        allv = V + [v + dn for v in V]
        F = [tuple(f) for f in faces] + [tuple(n + i for i in reversed(f)) for f in faces]
        cnt = {}
        for f in faces:
            for i in range(len(f)):
                a, b = f[i], f[(i + 1) % len(f)]
                cnt[(a, b)] = cnt.get((a, b), 0) + 1
        for (a, b) in list(cnt.keys()):
            if (b, a) not in cnt:
                F.append((b, a, n + a, n + b))
        self.emit(mat, allv, F, 0.0, 1, sharp, False, col)

    # -- small hardware ------------------------------------------------------------------------
    def screw(self, mat, pos, nrm=(0, -1, 0), r=0.0035, h=0.0018, dark='rubber_black'):
        """Socket-head screw: origin on the surface, head standing along nrm."""
        q = self.mul(frame_z(pos, nrm))
        q.lathe(mat, [(r, 0.0), (r, h * 0.55), (r * 0.72, h), (0.0, h)], 6, facet=True)
        if dark:
            q.disc(dark, r * 0.42, (0, 0, h + 0.0002), n=6)

    def screws(self, mat, pts, nrm=(0, -1, 0), r=0.0035, h=0.0018, dark='rubber_black'):
        for p in pts:
            self.screw(mat, p, nrm, r, h, dark)
