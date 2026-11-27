# 新车导入辅助（在 MCP 的 Blender 里用）：列出网格、按位置自动分出四个车轮、调用 carlib.build_rig
import bpy, re, sys, importlib
from mathutils import Vector

RACING = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing/scripts"
if RACING not in sys.path:
    sys.path.insert(0, RACING)
import carlib
importlib.reload(carlib)


def meshes_under(o):
    return [c for c in [o] + carlib.descendants(o) if c.type == 'MESH']


def wbox(objs):
    ms = [m for o in objs for m in meshes_under(o)]
    return carlib.world_bbox(ms)


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons) if o.type == 'MESH' else 0


def mats(o):
    return sorted({s.material.name for s in o.material_slots if s.material})


def report(top, pattern=None, min_tris=0, limit=200):
    """列出 top 下的网格：名字、中心、尺寸、三角面、材质"""
    rows = []
    for m in meshes_under(top):
        if pattern and not re.search(pattern, m.name + ' ' + (m.parent.name if m.parent else '') + ' ' + ' '.join(mats(m)), re.I):
            continue
        t = tris(m)
        if t < min_tris:
            continue
        mn, mx = carlib.world_bbox([m])
        c = (mn + mx) / 2; d = mx - mn
        rows.append((m.name, m.parent.name if m.parent else '', tuple(round(v, 3) for v in c), tuple(round(v, 3) for v in d), t, mats(m), m.hide_render))
    rows.sort(key=lambda r: -r[4])
    for r in rows[:limit]:
        print(r)
    mn, mx = wbox([top])
    print('TOTAL meshes', len(meshes_under(top)), 'tris', sum(tris(m) for m in meshes_under(top)), 'bbox', tuple(round(v, 3) for v in mn), tuple(round(v, 3) for v in mx))


def quadrant(o, front_axis='-Y', ctr=(0, 0)):
    """按网格中心位置判断属于哪个车轮：返回 FL/FR/RL/RR（front_axis 是模型车头方向）"""
    mn, mx = carlib.world_bbox(meshes_under(o)); c = (mn + mx) / 2
    c.x -= ctr[0]; c.y -= ctr[1]
    s = -1 if front_axis[0] == '-' else 1
    ax = front_axis[1]
    if ax == 'Y':
        fwd = c.y * s; left = -c.x * s     # 车头 -Y 时左侧为 +X
    else:
        fwd = c.x * s; left = c.y * s
    return ('F' if fwd > 0 else 'R') + ('L' if left > 0 else 'R')


def auto_wheels(objs_spin, objs_fixed=(), front_axis='-Y', ctr=None):
    if ctr is None:
        mn, mx = wbox(list(objs_spin)); ctr = ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2)
    w = {k: {'spin': [], 'fixed': []} for k in ('FL', 'FR', 'RL', 'RR')}
    for o in objs_spin:
        w[quadrant(o, front_axis, ctr)]['spin'].append(o)
    for o in objs_fixed:
        w[quadrant(o, front_axis, ctr)]['fixed'].append(o)
    for k, v in w.items():
        mn, mx = wbox(v['spin'])
        print(k, 'spin', len(v['spin']), 'fixed', len(v['fixed']), 'center', tuple(round(x, 3) for x in (mn + mx) / 2), 'size', tuple(round(x, 3) for x in (mx - mn)))
    return w


def split_quadrants(o, cx, cy):
    """一个网格同时包含四个车轮时，按面中心所在象限（世界 X/Y 相对 cx, cy）拆成 4 个物体，返回列表"""
    import bmesh
    out = []
    Mw = o.matrix_world
    for sx in (-1, 1):
        for sy in (-1, 1):
            me = o.data.copy()
            bm = bmesh.new(); bm.from_mesh(me)
            kill = []
            for f in bm.faces:
                c = Mw @ f.calc_center_median()
                if (c.x - cx) * sx < 0 or (c.y - cy) * sy < 0:
                    kill.append(f)
            bmesh.ops.delete(bm, geom=kill, context='FACES')
            bm.to_mesh(me); bm.free()
            if not len(me.polygons):
                bpy.data.meshes.remove(me); continue
            n = bpy.data.objects.new(o.name + f'_q{sx:+d}{sy:+d}', me)
            for c in o.users_collection:
                c.objects.link(n)
            n.parent = o.parent; n.matrix_parent_inverse = o.matrix_parent_inverse.copy(); n.matrix_basis = o.matrix_basis.copy()
            out.append(n)
    bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    return out


def _islands(bm):
    seen = set(); out = []
    for f in bm.faces:
        if f.index in seen:
            continue
        st = [f]; isl = []
        seen.add(f.index)
        while st:
            g = st.pop(); isl.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index); st.append(h)
        out.append(isl)
    return out


def wheel_islands(top, front_axis='-Y', tire_hint=None, dry=False, centers=None, lat_half=0.30):
    """车轮和车身合在同一网格里时：按连通块找出 4 个轮胎，再把落在轮胎圆柱里的连通块拆出来。
    返回 (wheels dict, 轮心列表)。tire_hint(dims) 可自定义轮胎判断。"""
    import bmesh
    from mathutils import Vector as V
    ms = meshes_under(top)
    data = []
    for m in ms:
        bm = bmesh.new(); bm.from_mesh(m.data); bm.faces.ensure_lookup_table()
        Mw = m.matrix_world
        isl = []
        for faces in _islands(bm):
            vs = {v for f in faces for v in f.verts}
            co = [Mw @ v.co for v in vs]
            mn = V((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
            mx = V((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
            isl.append(([f.index for f in faces], mn, mx))
        data.append((m, bm, isl))
    lat = 0 if front_axis[1] == 'Y' else 1     # 横向轴（车轴方向）
    lon = 1 - lat
    def is_tire(d):
        if tire_hint:
            return tire_hint(d)
        dl, dn, dz = d[lat], d[lon], d.z
        return 0.45 < dz < 0.85 and abs(dn - dz) < 0.04 * dz and 0.12 < dl < 0.5
    tires = []
    for m, bm, isl in data:
        for fi, mn, mx in isl:
            d = mx - mn
            if is_tire(d) and len(fi) > 60:
                tires.append(((mn + mx) / 2, d, m.name))
    # 合并同一轮子的重复（内外胎面）
    wc = []
    for c, d, n in sorted(tires, key=lambda t: -t[1].z):
        if all((c - c2).length > 0.25 for c2, _ in wc):
            wc.append((c, d))
    if centers:
        wc = [(V(c), V((2 * r, 2 * r, 2 * r))) for c, r in centers]
    print('tire candidates', len(tires), 'wheels', [(tuple(round(v, 3) for v in c), round(d.z / 2, 3)) for c, d in wc])
    if len(wc) != 4:
        for c, d, n in tires:
            print('  cand', n, tuple(round(v, 3) for v in c), tuple(round(v, 3) for v in d))
        return None, wc
    if dry:
        return None, wc
    ctr = sum((c for c, _ in wc), V()) / 4
    out = {k: {'spin': [], 'fixed': []} for k in ('FL', 'FR', 'RL', 'RR')}
    for m, bm, isl in data:
        groups = {}
        for fi, mn, mx in isl:
            c = (mn + mx) / 2; d = mx - mn
            for wcen, wd in wc:
                r = wd.z / 2
                if abs(c[lon] - wcen[lon]) < r * 1.02 and abs(c.z - wcen.z) < r * 1.02 and d[lon] <= wd[lon] * 1.03 and d.z <= wd.z * 1.03 \
                        and abs(c[lat] - wcen[lat]) < lat_half and d[lat] < 2 * lat_half:
                    off = V((c[lon] - wcen[lon], c.z - wcen.z)).length
                    role = 'fixed' if off > 0.28 * r and max(d[lon], d.z) < 1.2 * r else 'spin'
                    q = quadrant_pt(wcen - ctr, front_axis)
                    groups.setdefault((q, role), []).extend(fi)
                    break
        if not groups:
            bm.free(); continue
        for (q, role), fis in groups.items():
            me = m.data.copy()
            b2 = bmesh.new(); b2.from_mesh(me); b2.faces.ensure_lookup_table()
            keep = set(fis)
            bmesh.ops.delete(b2, geom=[f for f in b2.faces if f.index not in keep], context='FACES')
            b2.to_mesh(me); b2.free()
            n = bpy.data.objects.new(f'{m.name}_{q}_{role}', me)
            for cl in m.users_collection:
                cl.objects.link(n)
            n.parent = m.parent; n.matrix_parent_inverse = m.matrix_parent_inverse.copy(); n.matrix_basis = m.matrix_basis.copy()
            for i, s in enumerate(m.material_slots):
                if s.link == 'OBJECT':
                    n.material_slots[i].link = 'OBJECT'; n.material_slots[i].material = s.material
            out[q][role].append(n)
        # 原网格删去这些面
        allf = {f for fis in groups.values() for f in fis}
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in allf], context='FACES')
        bm.to_mesh(m.data); bm.free(); m.data.update()
    bpy.context.view_layer.update()
    for k, v in out.items():
        print(k, 'spin', len(v['spin']), 'fixed', len(v['fixed']))
    return out, wc


def quadrant_pt(c, front_axis='-Y'):
    s = -1 if front_axis[0] == '-' else 1
    if front_axis[1] == 'Y':
        fwd = c.y * s; left = -c.x * s
    else:
        fwd = c.x * s; left = c.y * s
    return ('F' if fwd > 0 else 'R') + ('L' if left > 0 else 'R')


def recenter(tag, k, to_body=(), ref=None):
    """把误分进车轮的物体移回车身，并按轮胎（ref 网格，默认最大的那块）重新定轮心"""
    steer = bpy.data.objects[f'{tag}_W_{k}_STEER']; spin = bpy.data.objects[f'{tag}_W_{k}_SPIN']
    body = bpy.data.objects[f'{tag}_BODY']
    for o in to_body:
        carlib.reparent_keep_world(o, body)
    ms = meshes_under(spin)
    ref = ref or max(ms, key=lambda m: m.dimensions.length)
    mn, mx = carlib.world_bbox([ref]); c = (mn + mx) / 2
    kids = [(o, o.matrix_world.copy()) for o in steer.children]
    steer.matrix_world.translation = c
    bpy.context.view_layer.update()
    for o, mw in kids:
        o.matrix_world = mw
    bpy.context.view_layer.update()
    root = bpy.data.objects[f'{tag}_ROOT']
    lc = root.matrix_world.inverted() @ c
    print(tag, k, 'new center (car space)', tuple(round(v, 4) for v in lc), 'radius', round((mx.z - mn.z) / 2, 4))


def rig(tag, top, wheels, front_axis='-Y'):
    fd = {'-Y': (0, -1, 0), '+Y': (0, 1, 0), '-X': (-1, 0, 0), '+X': (1, 0, 0)}[front_axis]
    orig = carlib.world_bbox
    carlib.world_bbox = lambda objs: orig([m for o in objs for m in meshes_under(o)])
    try:
        top.name = tag + '_src'
        root, info = carlib.build_rig(tag, top, wheels, fd)
    finally:
        carlib.world_bbox = orig
    print(tag, 'wheelbase', round(info['wheelbase'], 4), 'track', round(info['track'], 4), 'radius', {k: round(v, 4) for k, v in info['radius'].items()})
    return root
