# ck_ao.py -- baked occlusion: how much of the open surround each point of the cabin can see.
# The cabin is lit mostly by what it reflects (it is nearly all metal), and a reflection probe knows nothing of
# what stands in the way: the floor under the instrument cluster mirrors the sky as brightly as the top of an
# arm rest. So the occlusion is worked out here, once, and written into the vertex colours; the game multiplies
# it into every material (scripts/cockpit.gd, shaders/brushed.gdshader).
#   1. long edges are cut so that large faces have vertices to carry the value (no face edge over MAX_EDGE)
#   2. per face corner: rays over the hemisphere about the face normal, against all the cabin's geometry;
#      a hit counts the more the nearer it is, nothing beyond REACH counts
#   3. the result multiplies the corner's colour (white, or the paint colour of the 'paint' material)
import bpy, bmesh, time
from math import sqrt, sin, cos, pi
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

MAX_EDGE = 0.065      # m
REACH = 0.55          # m: occluders further than this do not count
RAYS = 28
LIFT = 0.006          # start of a ray above the surface (labels and dial faces lie up to 5 mm above their plates)
FLOOR = 0.10          # darkest value written
GAMMA = 1.25


def _dirs(n):
    """cosine-weighted directions about +Z"""
    out = []
    for i in range(n):
        u = (i + 0.5) / n
        phi = i * 2.399963229728653
        r = sqrt(u)
        out.append(Vector((r * cos(phi), r * sin(phi), sqrt(1.0 - u))))
    return out


def _frame(n):
    a = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
    t = n.cross(a).normalized()
    return t, n.cross(t)


def tessellate(objs):
    added = 0
    for o in objs:
        me = o.data
        if 'Color' not in me.color_attributes:
            ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
            ca.data.foreach_set('color', [1.0] * (4 * len(me.loops)))
        me.color_attributes.active_color = me.color_attributes['Color']
        me.color_attributes.render_color_index = list(me.color_attributes.keys()).index('Color')
        bm = bmesh.new()
        bm.from_mesh(me)
        n0 = len(bm.faces)
        lim = MAX_EDGE / max(o.matrix_world.to_scale().x, 1e-6)
        for _ in range(7):
            long = [e for e in bm.edges if e.calc_length() > lim]
            if not long:
                break
            bmesh.ops.subdivide_edges(bm, edges=long, cuts=1)
        added += len(bm.faces) - n0
        bm.to_mesh(me)
        bm.free()
        me.update()
    return added


def bake(objs):
    t0 = time.time()
    objs = [o for o in objs if o.type == 'MESH']
    bpy.context.view_layer.update()
    added = tessellate(objs)
    # all the cabin's geometry in world space
    verts, polys = [], []
    for o in objs:
        M = o.matrix_world
        off = len(verts)
        verts.extend(M @ v.co for v in o.data.vertices)
        polys.extend(tuple(i + off for i in p.vertices) for p in o.data.polygons)
    tree = BVHTree.FromPolygons(verts, polys, all_triangles=False)
    dirs = _dirs(RAYS)
    nray = 0
    lo, total, cnt = 1.0, 0.0, 0
    for o in objs:
        me = o.data
        M = o.matrix_world
        N = M.to_3x3().inverted().transposed()
        col = me.color_attributes['Color'].data
        cache = {}
        wv = [M @ v.co for v in me.vertices]
        for p in me.polygons:
            n = (N @ p.normal).normalized()
            key_n = (round(n.x, 2), round(n.y, 2), round(n.z, 2))
            t, b = None, None
            for li in p.loop_indices:
                vi = me.loops[li].vertex_index
                k = (vi, key_n)
                ao = cache.get(k)
                if ao is None:
                    if t is None:
                        t, b = _frame(n)
                    # a little toward the middle of the face, so that a corner shared with a wall is not inside it
                    org = wv[vi] + n * LIFT
                    occ = 0.0
                    for d in dirs:
                        w = t * d.x + b * d.y + n * d.z
                        hit = tree.ray_cast(org, w, REACH)
                        if hit[0] is not None:
                            occ += 1.0 - hit[3] / REACH
                    nray += RAYS
                    ao = max(FLOOR, (1.0 - occ / RAYS) ** GAMMA)
                    cache[k] = ao
                c = col[li].color
                col[li].color = (c[0] * ao, c[1] * ao, c[2] * ao, 1.0)
                lo = min(lo, ao)
                total += ao
                cnt += 1
        me.update()
    print('BUILD occlusion: +%d faces from cutting, %d rays, mean %.3f, min %.3f, %.1f s' % (
        added, nray, total / max(cnt, 1), lo, time.time() - t0))
