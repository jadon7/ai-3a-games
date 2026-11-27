# KHAMSIN 武器建模工具库（Blender 无界面脚本用）
# 坐标：Blender X = 右，Y = 枪口方向（f），Z = 上（u）。导出 glTF 后变成 (x, u, -f)，即游戏里的 -Z 朝前。
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

X = Vector((1, 0, 0)); F = Vector((0, 1, 0)); U = Vector((0, 0, 1))
FINE = 2   # 圆柱 / 车削件的分段倍数、滚花齿数倍数
rad = math.radians

PREVIEW = {   # 预览渲染用的近似材质：(基色, 金属度, 粗糙度, 自发光)
    'metal': ((0.060, 0.062, 0.068), 0.85, 0.36, None), 'metalBare': ((0.32, 0.32, 0.34), 1.0, 0.28, None),
    'poly': ((0.028, 0.028, 0.030), 0.0, 0.55, None), 'tan': ((0.33, 0.24, 0.13), 0.0, 0.58, None),
    'dark': ((0.006, 0.006, 0.007), 0.0, 0.6, None), 'rubber': ((0.012, 0.012, 0.013), 0.0, 0.8, None),
    'glove': ((0.035, 0.035, 0.037), 0.0, 0.75, None), 'sleeve': ((0.40, 0.34, 0.24), 0.0, 0.9, None), 'plate': ((0.16, 0.13, 0.09), 0.2, 0.5, None),
    'glow': ((0.1, 0.6, 0.8), 0.0, 0.5, (0.3, 1.6, 2.2)), 'red': ((0.8, 0.1, 0.05), 0.0, 0.5, (3.0, 0.4, 0.15)), 'coil': ((0.05, 0.2, 0.3), 0.0, 0.4, (0.1, 0.5, 0.7)),
    'shell': ((0.35, 0.03, 0.02), 0.0, 0.5, None), 'brass': ((0.75, 0.55, 0.22), 1.0, 0.3, None), 'glass': ((0.02, 0.05, 0.06), 0.0, 0.05, None),
    'tanMetal': ((0.36, 0.27, 0.16), 0.55, 0.42, None), 'gloveFab': ((0.30, 0.235, 0.15), 0.0, 0.85, None),
}
WEAR = {'metal': 1.0, 'metalBare': 0.5, 'tanMetal': 1.0, 'poly': 0.45, 'tan': 0.6, 'plate': 0.8, 'glove': 0.0, 'gloveFab': 0.0, 'sleeve': 0.0, 'rubber': 0.15, 'dark': 0.0}
_mats = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


def get_mat(name):
    if name in _mats: return _mats[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    col, metal, rough, emit = PREVIEW.get(name, ((0.5, 0.5, 0.5), 0, 0.5, None))
    b = m.node_tree.nodes.get('Principled BSDF')
    if b:
        b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
        if emit:
            b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = 1.0
    _mats[name] = m
    return m


def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None); e.empty_display_size = 0.01; e.location = loc
    bpy.context.scene.collection.objects.link(e)
    if parent: e.parent = parent
    return e


def obj(name, bm, material, parent=None, bevel=0.0007, seg=1, ang=32, sharp=50):
    me = bpy.data.meshes.new(name)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(get_mat(material))
    ob['bevel'] = bevel; ob['seg'] = seg; ob['ang'] = ang; ob['sharp'] = sharp; ob['wear'] = WEAR.get(material, 0.0)
    if parent: ob.parent = parent
    return ob


def apply_mods(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)


def cut(ob, cutter_bm, solver='EXACT'):
    """从 ob 上布尔减去 cutter_bm。"""
    # 切刀用与目标相同的材质：Blender 的布尔会把切刀材质带到新切出来的面上
    c = obj('_cut', cutter_bm, ob.data.materials[0].name if ob.data.materials else 'dark')
    m = ob.modifiers.new('b', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c
    try: m.material_mode = 'INDEX'
    except Exception: pass
    try: m.solver = solver
    except Exception: pass
    apply_mods(ob)
    bpy.data.objects.remove(c)
    return ob


def join(dst, src):
    me = bpy.data.meshes.new('_t'); src.to_mesh(me); src.free(); dst.from_mesh(me); bpy.data.meshes.remove(me)
    return dst


def xform(bm, M):
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts); return bm


# ---------------- 基本体 ----------------
def box(sx, sy, sz, loc=(0, 0, 0), rot=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    M = Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((sx, sy, sz, 1))
    return xform(bm, M)


def loft(sections, cap=True):
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in sec] for sec in sections]; n = len(sections[0])
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(n):
            j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap: bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    return bm


def octs(f, w, u0, u1, ct, cb=None, x=0.0):
    """八角截面（位于 f 处的 X-U 平面）：半宽 w，底 u0 顶 u1，上/下倒角 ct/cb。"""
    cb = ct if cb is None else cb
    return [Vector((x - w + cb, f, u0)), Vector((x + w - cb, f, u0)), Vector((x + w, f, u0 + cb)), Vector((x + w, f, u1 - ct)),
            Vector((x + w - ct, f, u1)), Vector((x - w + ct, f, u1)), Vector((x - w, f, u1 - ct)), Vector((x - w, f, u0 + cb))]


def rrect(c, ax, ay, hw, hh, r, n=3):
    """圆角矩形截面：中心 c，平面由 ax/ay 张成。"""
    pts = []; r = min(r, hw - 1e-5, hh - 1e-5)
    for cx, cy, a0 in ((hw - r, hh - r, 0), (-(hw - r), hh - r, 90), (-(hw - r), -(hh - r), 180), (hw - r, -(hh - r), 270)):
        for k in range(n + 1):
            a = rad(a0 + 90 * k / n); pts.append(Vector(c) + ax * (cx + r * math.cos(a)) + ay * (cy + r * math.sin(a)))
    return pts


def ellipse(c, ax, ay, a, b, n=16, p=2.0):
    """超椭圆截面。"""
    pts = []
    for k in range(n):
        t = 2 * math.pi * k / n; ct, st = math.cos(t), math.sin(t)
        pts.append(Vector(c) + ax * (a * math.copysign(abs(ct) ** (2 / p), ct)) + ay * (b * math.copysign(abs(st) ** (2 / p), st)))
    return pts


def prism(pts_fu, width, x=0.0):
    """侧面轮廓 [(f,u)] 沿 X 挤出。"""
    bm = bmesh.new()
    a = [bm.verts.new((x - width / 2, f, u)) for f, u in pts_fu]; b = [bm.verts.new((x + width / 2, f, u)) for f, u in pts_fu]; n = len(a)
    bm.faces.new(a); bm.faces.new(b[::-1])
    for i in range(n):
        j = (i + 1) % n; bm.faces.new((a[i], b[i], b[j], a[j]))
    return bm


def strip(path_fu, width, thick, x=0.0):
    """沿 F-U 平面内的折线扫出一条带子（扳机护圈、扳机等）。"""
    P = [Vector((0, f, u)) for f, u in path_fu]; L = []; R = []
    for i, p in enumerate(P):
        d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized(); nrm = Vector((0, -d.z, d.y))
        L.append(p + nrm * thick / 2); R.append(p - nrm * thick / 2)
    return prism([(q.y, q.z) for q in L + R[::-1]], width, x)


def lathe(profile, seg=20, x=0.0, u=0.0, cap=True):
    """绕平行于 F 的轴 (x,u) 车削：profile = [(f, r)]。"""
    if seg > 8: seg *= FINE   # 圆件加密：近看不出多边形轮廓（六角 / 八角件保持原样）
    bm = bmesh.new(); rings = []
    for f, r in profile:
        rings.append([bm.verts.new((x + r * math.cos(2 * math.pi * k / seg), f, u + r * math.sin(2 * math.pi * k / seg))) for k in range(seg)])
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg; bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap: bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    return bm


def tube(a, b, r0, r1=None, seg=14, cap=True):
    """两点之间的圆台。"""
    if seg > 8: seg *= FINE
    a = Vector(a); b = Vector(b); r1 = r0 if r1 is None else r1
    d = (b - a).normalized(); t = d.orthogonal().normalized(); s = d.cross(t)
    bm = bmesh.new(); rings = []
    for c, r in ((a, r0), (b, r1)):
        rings.append([bm.verts.new(c + (t * math.cos(2 * math.pi * k / seg) + s * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)])
    for i in range(seg):
        j = (i + 1) % seg; bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    if cap: bm.faces.new(rings[0][::-1]); bm.faces.new(rings[1])
    return bm


def stadium(center, normal, along, length, height, depth, n=5):
    """跑道形切刀（M-LOK 槽）：沿 normal 方向贯穿 depth。"""
    c = Vector(center); nrm = Vector(normal).normalized(); al = Vector(along).normalized(); up = nrm.cross(al).normalized()
    r = height / 2; h = length / 2 - r; ring = []
    for k in range(n + 1):
        a = -math.pi / 2 + math.pi * k / n; ring.append(al * (h + r * math.cos(a)) + up * (r * math.sin(a)))
    for k in range(n + 1):
        a = math.pi / 2 + math.pi * k / n; ring.append(al * (-h + r * math.cos(a)) + up * (r * math.sin(a)))
    return loft([[c + p - nrm * depth / 2 for p in ring], [c + p + nrm * depth / 2 for p in ring]])


def rail(f0, f1, origin_xu=(0.0, 0.060), ang=0.0, pitch=0.0105, tl=0.0058):
    """皮卡汀尼导轨（底座 + 燕尾齿）。origin_xu 为导轨底面中心，ang 为绕 F 轴的旋转（0 = 朝上）。"""
    ax = Vector((math.cos(ang), 0, math.sin(ang))); up = Vector((-math.sin(ang), 0, math.cos(ang))); o = Vector((origin_xu[0], 0, origin_xu[1]))
    sec = [(-0.0078, 0.0028), (-0.0107, 0.0052), (-0.0107, 0.0062), (-0.0085, 0.0085), (0.0085, 0.0085), (0.0107, 0.0062), (0.0107, 0.0052), (0.0078, 0.0028)]
    base = [(-0.0078, 0.0), (0.0078, 0.0), (0.0078, 0.0030), (-0.0078, 0.0030)]
    P = lambda a, b, f: o + ax * a + up * b + F * f
    bm = loft([[P(a, b, f0) for a, b in base], [P(a, b, f1) for a, b in base]])
    f = f0 + 0.003
    while f + tl < f1 - 0.002:
        join(bm, loft([[P(a, b, f) for a, b in sec], [P(a, b, f + tl) for a, b in sec]])); f += pitch
    return bm


def orient(bm, origin, direction):
    """把沿 F 轴建好的零件转到 direction 方向并移到 origin。"""
    q = F.rotation_difference(Vector(direction).normalized())
    return xform(bm, Matrix.Translation(Vector(origin)) @ q.to_matrix().to_4x4())


def gear(length, r_out, r_in, teeth, f0=0.0):
    """滚花柱（旋钮、灯头防滑圈）：轴为 F，原点在轴上，f0..f0+length；外径在 r_out / r_in 之间交替成方齿。"""
    teeth *= FINE; bm = bmesh.new(); n = teeth * 4; rings = []
    for f in (f0, f0 + length):
        ring = []
        for k in range(n):
            r = r_out if (k % 4) < 2 else r_in; a = 2 * math.pi * (k + 0.5) / n
            ring.append(bm.verts.new((r * math.cos(a), f, r * math.sin(a))))
        rings.append(ring)
    for i in range(n):
        j = (i + 1) % n; bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[1])
    return bm


def cyl(length, r, seg=14, f0=0.0, r1=None):
    """沿 F 轴的圆柱 / 圆台，原点在轴上。"""
    return tube((0, f0, 0), (0, f0 + length, 0), r, r1, seg=seg)


def hexp(length, r, f0=0.0):
    """沿 F 轴的六棱柱。"""
    return tube((0, f0, 0), (0, f0 + length, 0), r, seg=6)


# ---------------- 收尾：倒角、法线、AO ----------------
def finish(objs, long=0.015, iters=2, wide=True):
    """long / iters：逐顶点 AO 采样用的大面加密阈值与轮数（机甲这类大件要调大）；wide=False 时不把两段倒角加宽成三段。"""
    for ob in objs:
        if ob.type != 'MESH': continue
        bv = ob.get('bevel', 0)
        if bv > 0:
            sg = int(ob.get('seg', 1))
            if wide and sg >= 2 and bv >= 0.001: sg = 3; bv *= 1.3   # 主体件：更宽、三段的圆倒角，高光过渡更顺
            m = ob.modifiers.new('bev', 'BEVEL'); m.width = bv; m.segments = sg; m.limit_method = 'ANGLE'; m.angle_limit = rad(ob.get('ang', 32)); m.use_clamp_overlap = True
            apply_mods(ob)
        me = ob.data; bm = bmesh.new(); bm.from_mesh(me); lim = rad(ob.get('sharp', 50))
        # 加密大平面：逐顶点 AO 需要足够的采样点，否则布尔切出的长三角形会把暗部拖成大片
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        for _ in range(iters):
            le = [e for e in bm.edges if e.calc_length() > long]
            if not le: break
            bmesh.ops.subdivide_edges(bm, edges=le, cuts=1); bmesh.ops.triangulate(bm, faces=bm.faces[:])
        for e in bm.edges:
            e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim)
        for fc in bm.faces: fc.smooth = True
        bm.to_mesh(me); bm.free()
        wn = ob.modifiers.new('wn', 'WEIGHTED_NORMAL'); wn.keep_sharp = True; wn.weight = 50; wn.mode = 'FACE_AREA'


def bake_ao(objs, dist=0.035, rays=20, seed=7, off=0.0006):
    """逐顶点 AO → 顶点色 R；G = 棱边磨损权重（按材质）。"""
    rnd = random.Random(seed); dirs = []
    for i in range(rays):
        u1 = (i + rnd.random()) / rays; u2 = rnd.random(); r = math.sqrt(u1); ph = 2 * math.pi * u2
        dirs.append((r * math.cos(ph), r * math.sin(ph), math.sqrt(max(0.0, 1 - u1))))
    verts = []; polys = []
    bpy.context.view_layer.update()
    for ob in objs:
        if ob.type != 'MESH': continue
        base = len(verts); mw = ob.matrix_world
        verts.extend([mw @ v.co for v in ob.data.vertices]); polys.extend([[base + i for i in p.vertices] for p in ob.data.polygons])
    bvh = BVHTree.FromPolygons(verts, polys)
    for ob in objs:
        if ob.type != 'MESH': continue
        me = ob.data; mw = ob.matrix_world; nm = mw.to_3x3(); wear = float(ob.get('wear', 0.0))
        ca = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = ca
        try: me.color_attributes.render_color_index = list(me.color_attributes).index(ca)
        except Exception: pass
        ta = me.attributes.get('tint')
        for v in me.vertices:
            n = (nm @ v.normal).normalized(); p = mw @ v.co + n * off
            t = n.orthogonal().normalized(); s = n.cross(t); occ = 0.0
            for dx, dy, dz in dirs:
                d = t * dx + s * dy + n * dz; h = bvh.ray_cast(p, d, dist)
                if h[0] is not None: occ += 1.0 - 0.6 * (h[3] / dist)
            ao = max(0.0, 1.0 - occ / rays)
            ca.data[v.index].color = (ao, 0.0, 0.0, 1.0 - (ta.data[v.index].value if ta else 0.0))   # A = 1 - 染色权重（手套掌面）
        # 棱边凸度 / 缝隙凹度：邻接顶点落在切平面下方越多越凸（倒角棱），落在上方则是凹缝
        bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table(); bm.normal_update()
        for v in bm.verts:
            acc = 0.0; cnt = 0
            for e in v.link_edges:
                dv = e.other_vert(v).co - v.co; L = dv.length
                if L > 1e-9: acc -= v.normal.dot(dv) / L; cnt += 1
            conv = acc / cnt if cnt else 0.0
            c = ca.data[v.index].color
            ca.data[v.index].color = (c[0], min(1.0, max(0.0, conv * 2.4)) * wear, min(1.0, max(0.0, -conv * 2.4)), c[3])
        bm.free()


def stats(objs):
    v = sum(len(o.data.vertices) for o in objs if o.type == 'MESH'); t = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == 'MESH')
    return v, t


def export_glb(path):
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    want = dict(filepath=path, export_format='GLB', export_apply=True, export_yup=True, export_normals=True, export_texcoords=False, export_materials='EXPORT',
                export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_cameras=False, export_lights=False,
                export_animations=False, export_extras=False, use_selection=False, export_image_format='NONE')
    kw = {k: v for k, v in want.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)


# ---------------- 预览渲染 ----------------
def setup_render(hdri=None, res=(1100, 620), samples=32):
    sc = bpy.context.scene
    ok = False
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try: sc.render.engine = eng; ok = True; break
        except TypeError: pass
    if not ok: sc.render.engine = 'CYCLES'
    if sc.render.engine == 'CYCLES':
        sc.cycles.samples = samples; sc.cycles.use_denoising = True
    else:
        try: sc.eevee.taa_render_samples = samples
        except Exception: pass
        for k in ('use_gtao', 'use_raytracing'):
            try: setattr(sc.eevee, k, True)
            except Exception: pass
    sc.render.resolution_x, sc.render.resolution_y = res; sc.render.film_transparent = False
    try: sc.view_settings.view_transform = 'AgX'
    except Exception: pass
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; nt = w.node_tree; bg = nt.nodes.get('Background')
    if hdri:
        try:
            env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(hdri); nt.links.new(env.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0
        except Exception as e:
            print('hdri failed', e); bg.inputs['Color'].default_value = (0.45, 0.5, 0.6, 1)
    else:
        bg.inputs['Color'].default_value = (0.45, 0.5, 0.6, 1)
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.0; sun.angle = rad(2)
    so = bpy.data.objects.new('sun', sun); so.rotation_euler = (rad(48), rad(8), rad(-50)); sc.collection.objects.link(so)
    return sc.render.engine


def shoot(path, loc, look, fov=60.0, ortho=None, flip_up=False):
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co)
    cam.clip_start = 0.005; cam.clip_end = 50; cam.sensor_fit = 'VERTICAL'
    if ortho: cam.type = 'ORTHO'; cam.ortho_scale = ortho
    else: cam.angle_y = rad(fov)
    co.location = loc; d = Vector(look) - Vector(loc); co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co; sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(co)
