# KHAMSIN 真人士兵建模的公共部分：基本体、人体载入与重摆姿势、蒙皮权重、渲染、GLB 后处理
# 只被 build_soldier.py 引用；不依赖 khlib（那边在同时改动）。
import bpy, bmesh, math, json, struct, random
import numpy as np
from mathutils import Vector, Matrix, Euler, Quaternion, noise
from mathutils.bvhtree import BVHTree

rad = math.radians
X = Vector((1, 0, 0)); F = Vector((0, 1, 0)); U = Vector((0, 0, 1))

# 游戏骨架（src/game/actors.js 的 BONES，游戏坐标 x 右 / y 上 / -z 前）
BONES = [('hips', -1, 0, 0.98, 0), ('spine', 0, 0, 1.10, 0), ('head', 1, 0, 1.56, 0),
         ('armL', 1, -0.21, 1.46, 0), ('foreL', 3, -0.23, 1.18, 0), ('armR', 1, 0.21, 1.46, 0), ('foreR', 5, 0.23, 1.18, 0),
         ('legL', 0, -0.1, 0.94, 0), ('shinL', 7, -0.1, 0.50, 0), ('legR', 0, 0.1, 0.94, 0), ('shinR', 9, 0.1, 0.50, 0), ('gun', 1, 0.085, 1.365, -0.2),
         ('footL', 8, -0.1, 0.09, 0), ('footR', 10, 0.1, 0.09, 0)]   # 脚踝关节：追加在末尾，前 12 根的序号不变
BI = {b[0]: i for i, b in enumerate(BONES)}
def g2b(x, y, z): return Vector((x, -z, y))           # 游戏坐标 → Blender 坐标（X 右 / Y 前 / Z 上）
def bone_pos(name): b = BONES[BI[name]]; return g2b(b[2], b[3], b[4])

# 顶点色 R 通道里的调色板槽位（slot / 16）。前 11 个与 actors.js 的 PAL 键同名，后面是新增的
SLOTS = ['cloth', 'vest', 'pouch', 'helmet', 'pad', 'dark', 'boot', 'glove', 'face', 'accent', 'gunTan', 'skin', 'eye', 'iris', 'lens', 'strap']
SI = {n: i for i, n in enumerate(SLOTS)}
# 每个槽位的（法线贴图权重 A，建议粗糙度 B）
SURF = {'cloth': (1.0, 0.9), 'vest': (1.0, 0.85), 'pouch': (1.0, 0.85), 'helmet': (0.35, 0.6), 'pad': (0.3, 0.55), 'dark': (0.2, 0.5), 'boot': (0.45, 0.6), 'glove': (0.7, 0.7),
        'face': (1.0, 0.9), 'accent': (0.6, 0.7), 'gunTan': (0.2, 0.5), 'skin': (0.0, 0.52), 'eye': (0.0, 0.2), 'iris': (0.0, 0.15), 'lens': (0.0, 0.12), 'strap': (0.8, 0.75)}
# 预览渲染用的近似颜色（按阵营）
PREV = {
    'friend': {'cloth': (0.36, 0.30, 0.21), 'vest': (0.30, 0.25, 0.17), 'pouch': (0.26, 0.21, 0.14), 'helmet': (0.33, 0.28, 0.20), 'pad': (0.065, 0.06, 0.055), 'dark': (0.03, 0.03, 0.035), 'boot': (0.21, 0.16, 0.11), 'glove': (0.09, 0.08, 0.07),
               'face': (0.34, 0.30, 0.23), 'accent': (0.07, 0.30, 0.52), 'gunTan': (0.33, 0.26, 0.17), 'skin': (0.66, 0.40, 0.27), 'eye': (0.62, 0.60, 0.57), 'iris': (0.12, 0.07, 0.04), 'lens': (0.03, 0.035, 0.04), 'strap': (0.10, 0.09, 0.075)},
    'enemy': {'cloth': (0.19, 0.175, 0.16), 'vest': (0.10, 0.10, 0.11), 'pouch': (0.08, 0.08, 0.09), 'helmet': (0.09, 0.09, 0.10), 'pad': (0.07, 0.07, 0.075), 'dark': (0.03, 0.03, 0.035), 'boot': (0.05, 0.05, 0.055), 'glove': (0.06, 0.06, 0.065),
              'face': (0.42, 0.10, 0.07), 'accent': (0.75, 0.07, 0.04), 'gunTan': (0.075, 0.075, 0.08), 'skin': (0.60, 0.37, 0.25), 'eye': (0.62, 0.60, 0.57), 'iris': (0.10, 0.06, 0.035), 'lens': (0.03, 0.035, 0.04), 'strap': (0.05, 0.05, 0.055)},
    'sniper': {'cloth': (0.21, 0.24, 0.16), 'vest': (0.12, 0.14, 0.08), 'pouch': (0.10, 0.12, 0.07), 'helmet': (0.20, 0.23, 0.15), 'pad': (0.05, 0.05, 0.05), 'dark': (0.03, 0.03, 0.035), 'boot': (0.05, 0.05, 0.045), 'glove': (0.06, 0.065, 0.05),
               'face': (0.17, 0.20, 0.13), 'accent': (0.8, 0.55, 0.06), 'gunTan': (0.13, 0.15, 0.09), 'skin': (0.60, 0.37, 0.25), 'eye': (0.62, 0.60, 0.57), 'iris': (0.10, 0.06, 0.035), 'lens': (0.03, 0.035, 0.04), 'strap': (0.07, 0.08, 0.05)},
}
def sstep(a, b, x): t = min(1.0, max(0.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t


def reset(): bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------- 基本体（返回 bmesh） ----------------
def xform(bm, M): bmesh.ops.transform(bm, matrix=M, verts=bm.verts); return bm
def join(dst, src):
    me = bpy.data.meshes.new('_t'); src.to_mesh(me); src.free(); dst.from_mesh(me); bpy.data.meshes.remove(me); return dst
def box(sx, sy, sz, loc=(0, 0, 0), rot=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    return xform(bm, Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((sx, sy, sz, 1)))
def loft(sections, cap=True, close=False):
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in sec] for sec in sections]; n = len(sections[0])
    pairs = list(zip(rings[:-1], rings[1:])) + ([(rings[-1], rings[0])] if close else [])
    for a, b in pairs:
        for i in range(n):
            j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap and not close: bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    return bm
def strip(rows):
    """开放曲面：rows = [[点…]…]，不闭合。"""
    bm = bmesh.new(); R = [[bm.verts.new(p) for p in r] for r in rows]
    for a, b in zip(R[:-1], R[1:]):
        for i in range(len(a) - 1): bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    return bm
def rrect(c, ax, ay, hw, hh, r, n=3):
    pts = []; r = min(r, hw - 1e-5, hh - 1e-5)
    for cx, cy, a0 in ((hw - r, hh - r, 0), (-(hw - r), hh - r, 90), (-(hw - r), -(hh - r), 180), (hw - r, -(hh - r), 270)):
        for k in range(n + 1):
            a = rad(a0 + 90 * k / n); pts.append(Vector(c) + ax * (cx + r * math.cos(a)) + ay * (cy + r * math.sin(a)))
    return pts
def ellipse(c, ax, ay, a, b, n=16, p=2.0, a0=0.0):
    pts = []
    for k in range(n):
        t = a0 + 2 * math.pi * k / n; ct, st = math.cos(t), math.sin(t)
        pts.append(Vector(c) + ax * (a * math.copysign(abs(ct) ** (2 / p), ct)) + ay * (b * math.copysign(abs(st) ** (2 / p), st)))
    return pts
def tube(a, b, r0, r1=None, seg=10, cap=True):
    a = Vector(a); b = Vector(b); r1 = r0 if r1 is None else r1
    d = (b - a).normalized(); t = d.orthogonal().normalized(); s = d.cross(t)
    return loft([[c + (t * math.cos(2 * math.pi * k / seg) + s * math.sin(2 * math.pi * k / seg)) * r for k in range(seg)] for c, r in ((a, r0), (b, r1))], cap)
def sphere(c, rx, ry, rz, seg=12, rings=8):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    return xform(bm, Matrix.Translation(c) @ Matrix.Diagonal((rx, ry, rz, 1)))
def catmull(P, n=5):
    P = [Vector(p) for p in P]; Q = [P[0]] + P + [P[-1]]; pts = []
    for i in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts.append(P[-1]); return pts
def sweep(path, w, th, zdir, n=8, taper=1.0, p=2.4, tip=True, sub=4):
    """沿路径放样超椭圆截面（手指、带子、围巾卷）。zdir 用来定截面朝向。"""
    C = catmull(path, sub); N = len(C); secs = []; zdir = Vector(zdir)
    def frame(i):
        tg = (C[min(i + 1, N - 1)] - C[max(i - 1, 0)]).normalized(); side = tg.cross(zdir).normalized(); return tg, side.cross(tg).normalized(), side
    for i, c in enumerate(C):
        tg, up, side = frame(i); k = 1 - (1 - taper) * i / (N - 1); secs.append(ellipse(c, up, side, w * k, th * k, n, p))
    if tip:
        tg, up, side = frame(N - 1)
        for s_, e in ((0.9, 0.32), (0.66, 0.62), (0.3, 0.8)): secs.append(ellipse(C[-1] + tg * (w * e), up, side, w * taper * s_, th * taper * s_, n, 2.1))
    return loft(secs)


# ---------------- 对象与收尾 ----------------
def mesh_obj(name, bm, smooth=True):
    me = bpy.data.meshes.new(name); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces: f.smooth = smooth
    bm.to_mesh(me); bm.free(); ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob
def apply_mods(ob):
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)
def hard(ob, bevel=0.002, seg=1, ang=35, sharp=45, subd=0.0):
    """硬表面收尾：倒角 + 锐边标记 + 面积加权法线。"""
    if bevel > 0:
        m = ob.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = seg; m.limit_method = 'ANGLE'; m.angle_limit = rad(ang); m.use_clamp_overlap = True; apply_mods(ob)
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me); lim = rad(sharp)
    if subd > 0:
        for _ in range(2):
            long = [e for e in bm.edges if e.calc_length() > subd]
            if not long: break
            bmesh.ops.subdivide_edges(bm, edges=long, cuts=1)
    for e in bm.edges: e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim)
    for f in bm.faces: f.smooth = True
    bm.to_mesh(me); bm.free()
    wn = ob.modifiers.new('wn', 'WEIGHTED_NORMAL'); wn.keep_sharp = True; wn.weight = 50; wn.mode = 'FACE_AREA'; apply_mods(ob)
    return ob


# ---------------- 蒙皮权重：分段刚性权重 + 网格上的拉普拉斯平滑 ----------------
def edges_np(bm): return np.array([[e.verts[0].index, e.verts[1].index] for e in bm.edges], dtype=np.int64)
def smooth_f(V, E, iters, lam=0.5, lock=None):
    """网格图上的均匀拉普拉斯平滑（V：n × k）。lock：保持不动的顶点序号。"""
    n = V.shape[0]; deg = np.zeros(n); np.add.at(deg, E[:, 0], 1); np.add.at(deg, E[:, 1], 1); deg = np.maximum(deg, 1)[:, None]
    for _ in range(iters):
        acc = np.zeros_like(V); np.add.at(acc, E[:, 0], V[E[:, 1]]); np.add.at(acc, E[:, 1], V[E[:, 0]])
        Vn = (1 - lam) * V + lam * acc / deg
        if lock is not None and len(lock): Vn[lock] = V[lock]
        V = Vn
    return V
def smooth_w(W, E, iters, lam=0.5, lock=None):
    W = smooth_f(W, E, iters, lam, lock); return W / np.maximum(W.sum(1, keepdims=True), 1e-9)
def prune4(W, mn=0.02):
    W = W.copy(); idx = np.argsort(-W, axis=1)[:, 4:]; np.put_along_axis(W, idx, 0, axis=1); W[W < mn] = 0
    return W / np.maximum(W.sum(1, keepdims=True), 1e-9)
def set_groups(ob, W):
    """把权重矩阵（n × 骨骼数）写成顶点组（名字 = 骨骼名）。"""
    ob.vertex_groups.clear(); gs = [ob.vertex_groups.new(name=b[0]) for b in BONES]
    for j in range(W.shape[1]):
        nz = np.nonzero(W[:, j] > 0)[0]
        for i in nz: gs[j].add([int(i)], float(W[i, j]), 'REPLACE')
def get_groups(ob):
    n = len(ob.data.vertices); W = np.zeros((n, len(BONES))); names = {g.index: BI[g.name] for g in ob.vertex_groups if g.name in BI}
    for v in ob.data.vertices:
        for g in v.groups:
            if g.group in names: W[v.index, names[g.group]] = g.weight
    return W
def rigid(ob, bone):
    W = np.zeros((len(ob.data.vertices), len(BONES))); W[:, BI[bone]] = 1; set_groups(ob, W); return ob
def bind_from(ob, src_co, src_W, k=4):
    """按最近的源顶点（k 个，距离反比）取权重：贴身装备跟着衣服一起变形。"""
    from mathutils.kdtree import KDTree
    kd = KDTree(len(src_co))
    for i, c in enumerate(src_co): kd.insert(c, i)
    kd.balance(); W = np.zeros((len(ob.data.vertices), src_W.shape[1]))
    for v in ob.data.vertices:
        for c, i, d in kd.find_n(v.co, k): W[v.index] += src_W[i] / (d + 0.004)
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9); set_groups(ob, prune4(W)); return ob


def ensure_groups(ob):
    for b in BONES:
        if b[0] not in ob.vertex_groups: ob.vertex_groups.new(name=b[0])
def bm_set_w(bm, W):
    dl = bm.verts.layers.deform.verify()
    for v in bm.verts:
        d = v[dl]; d.clear()
        for j in np.nonzero(W[v.index] > 0)[0]: d[int(j)] = float(W[v.index, j])
def bm_get_w(bm):
    dl = bm.verts.layers.deform.verify(); W = np.zeros((len(bm.verts), len(BONES)))
    for v in bm.verts:
        for j, w in v[dl].items():
            if j < len(BONES): W[v.index, j] = w
    return W
def skinned_obj(name, bm, slot='cloth', smooth=True, recalc=True):
    """bmesh（带 deform 层）→ 对象，建好全部顶点组。"""
    me = bpy.data.meshes.new(name)
    if recalc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces: f.smooth = smooth
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ensure_groups(ob); bm.to_mesh(me); bm.free(); ob['slot'] = slot
    return ob
def part(name, bm, slot, bone=None, bevel=0.0, seg=1, smooth=True, sharp=45, ang=35):
    """刚性零件：整体绑到一根骨骼；bevel > 0 时按硬表面收尾。"""
    ob = mesh_obj(name, bm, smooth); ob['slot'] = slot
    if bevel > 0 or not smooth: hard(ob, bevel, seg, ang, sharp)
    if bone: rigid(ob, bone)
    return ob
def set_attr(ob, name, vals, typ='FLOAT'):
    me = ob.data; a = me.attributes.get(name) or me.attributes.new(name, typ, 'POINT')
    a.data.foreach_set('value', [float(v) if typ == 'FLOAT' else int(v) for v in vals])
def get_attr(ob, name, default):
    a = ob.data.attributes.get(name); n = len(ob.data.vertices)
    if a is None: return np.full(n, default, dtype=float)
    out = np.zeros(n); a.data.foreach_get('value', out); return out
def join_objs(objs, name):
    for o in objs:
        if 'slot' in o and o.data.attributes.get('slot') is None: set_attr(o, 'slot', [SI[o['slot']]] * len(o.data.vertices), 'INT')
        if o.data.attributes.get('shade') is None: set_attr(o, 'shade', [1.0] * len(o.data.vertices))
        ensure_groups(o)
    a = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=a, selected_editable_objects=objs, selected_objects=objs, object=a): bpy.ops.object.join()
    a.name = name; a.data.name = name
    return a


class Surf:
    """对象表面的射线投影（BVH）。keep(面) 为 False 的面不参与。"""
    def __init__(self, ob, keep=None):
        me = ob.data; vs = [v.co.copy() for v in me.vertices]; ps = [list(p.vertices) for p in me.polygons if keep is None or keep(p)]
        self.bvh = BVHTree.FromPolygons(vs, ps)
    def ray(self, o, d, dist=3.0):
        h = self.bvh.ray_cast(Vector(o), Vector(d).normalized(), dist); return (h[0], h[1]) if h[0] is not None else (None, None)
    def front(self, x, z): return self.ray((x, 1.2, z), (0, -1, 0))
    def back(self, x, z): return self.ray((x, -1.2, z), (0, 1, 0))
    def side(self, sg, y, z): return self.ray((sg * 1.2, y, z), (-sg, 0, 0))
    def down(self, x, y): return self.ray((x, y, 2.6), (0, 0, -1))
    def radial(self, cx, cy, z, ang, r=1.0):
        d = Vector((math.cos(ang), math.sin(ang), 0)); return self.ray((cx + d.x * r, cy + d.y * r, z), -d)
    def near(self, p):
        h = self.bvh.find_nearest(Vector(p)); return h[0], h[1]


def sheet(name, rows, slot, out, thick=0.0, bevel=0.0, seg=1, close=False, rim_only=False, subd=0):
    """由点阵生成的片状零件（贴身面板、带子）。out(面心) 给出外侧方向，用来统一法线；thick > 0 时向外加厚。"""
    bm = bmesh.new(); R = [[bm.verts.new(p) for p in r] for r in rows]
    for a, b in zip(R[:-1], R[1:]):
        n = len(a)
        for i in range(n if close else n - 1): j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.normal_update(); sgn = sum(f.normal.dot(out(f.calc_center_median())) for f in bm.faces)
    if sgn < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    for f in bm.faces: f.smooth = True
    bm.to_mesh(me); bm.free(); ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob['slot'] = slot
    if subd:
        m = ob.modifiers.new('ss', 'SUBSURF'); m.levels = subd; apply_mods(ob)
    if thick > 0:
        m = ob.modifiers.new('sol', 'SOLIDIFY'); m.thickness = thick; m.offset = 1.0; m.use_rim = True; m.use_rim_only = rim_only; apply_mods(ob)
    if bevel > 0: hard(ob, bevel, seg, 40, 50)
    return ob
def out_from(cx, cy):
    return lambda c: Vector((c.x - cx, c.y - cy, 0))


# ---------------- 骨架 ----------------
def make_rig():
    """所有骨骼全部朝上、roll=0：骨骼局部轴 = 游戏坐标轴，导出的关节静止旋转为单位四元数。"""
    arm = bpy.data.armatures.new('rig'); ob = bpy.data.objects.new('rig', arm); bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.mode_set(mode='EDIT'); eb = {}
    for name, par, x, y, z in BONES:
        b = arm.edit_bones.new(name); b.head = g2b(x, y, z); b.tail = b.head + Vector((0, 0, 0.08)); b.roll = 0.0; eb[name] = b
        if par >= 0: b.parent = eb[BONES[par][0]]; b.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones: pb.rotation_mode = 'QUATERNION'
    return ob
def skin_to(ob, rig):
    ob.parent = rig; m = ob.modifiers.new('arm', 'ARMATURE'); m.object = rig; return ob
def grot(x, y, z):
    """three.js 的 Euler(x,y,z,'XYZ')（游戏轴）→ 骨骼局部四元数。"""
    return (Matrix.Rotation(x, 3, 'X') @ Matrix.Rotation(y, 3, 'Y') @ Matrix.Rotation(z, 3, 'Z')).to_quaternion()


# ---------------- 逐顶点 AO ----------------
def limb_groups(W):
    """遮挡分组：0 躯干与头，1/2 右/左臂，3/4 右/左腿。静止姿势里手臂贴着身侧、两腿并拢，不同分组之间不算遮挡。"""
    dom = np.argmax(W, axis=1); g = np.zeros(len(dom), dtype=int)
    for names, k in ((('armR', 'foreR'), 1), (('armL', 'foreL'), 2), (('legR', 'shinR', 'footR'), 3), (('legL', 'shinL', 'footL'), 4)):
        for nm in names: g[dom == BI[nm]] = k
    return g
def bake_ao(objs, dist=0.07, rays=24, seed=7, targets=None):
    """逐顶点 AO。返回 {对象名: np.array}。"""
    rnd = random.Random(seed); dirs = []
    for i in range(rays):
        u1 = (i + rnd.random()) / rays; u2 = rnd.random(); r = math.sqrt(u1); ph = 2 * math.pi * u2
        dirs.append((r * math.cos(ph), r * math.sin(ph), math.sqrt(max(0.0, 1 - u1))))
    verts = []; polys = []; pgrp = []; out = {}; vgs = {}
    for ob in objs:
        base = len(verts); verts.extend([v.co.copy() for v in ob.data.vertices]); vg = limb_groups(get_groups(ob)); vgs[ob.name] = vg
        for p in ob.data.polygons: polys.append([base + i for i in p.vertices]); pgrp.append(vg[p.vertices[0]])
    bvh = BVHTree.FromPolygons(verts, polys)
    for ob in (targets or objs):
        me = ob.data; ao = np.ones(len(me.vertices)); vg = vgs[ob.name]
        for v in me.vertices:
            n = v.normal; p = v.co + n * 0.002; t = n.orthogonal().normalized(); s = n.cross(t); occ = 0.0; g = vg[v.index]
            for dx, dy, dz in dirs:
                d = t * dx + s * dy + n * dz; h = bvh.ray_cast(p, d, dist)
                if h[0] is not None and pgrp[h[2]] == g: occ += 1.0 - 0.6 * (h[3] / dist)
            ao[v.index] = max(0.0, 1.0 - occ / rays)
        E = np.array([[e.vertices[0], e.vertices[1]] for e in me.edges], dtype=np.int64)
        if len(E): ao = smooth_f(ao[:, None], E, 2)[:, 0]      # 去掉采样噪点
        out[ob.name] = ao
    return out


# ---------------- 预览渲染 ----------------
def setup_render(hdri=None, res=(900, 1100), samples=24):
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'):
        try: sc.render.engine = eng; break
        except TypeError: pass
    try: sc.eevee.taa_render_samples = samples
    except Exception: pass
    for k in ('use_gtao', 'use_raytracing', 'use_shadows'):
        try: setattr(sc.eevee, k, True)
        except Exception: pass
    sc.render.resolution_x, sc.render.resolution_y = res
    try: sc.view_settings.view_transform = 'AgX'
    except Exception: pass
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; nt = w.node_tree; bg = nt.nodes.get('Background'); ok = False
    if hdri:
        try:
            env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(hdri); nt.links.new(env.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0; ok = True
        except Exception as e: print('hdri failed', e)
    if not ok: bg.inputs['Color'].default_value = (0.5, 0.54, 0.6, 1)
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; sun.angle = rad(3)
    so = bpy.data.objects.new('sun', sun); so.rotation_euler = (rad(52), rad(0), rad(150)); sc.collection.objects.link(so)
    return sc.render.engine
def shoot(path, loc, look, fov=40.0, ortho=None, res=None):
    sc = bpy.context.scene
    if res: sc.render.resolution_x, sc.render.resolution_y = res
    cam = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co)
    cam.clip_start = 0.01; cam.clip_end = 80; cam.sensor_fit = 'VERTICAL'
    if ortho: cam.type = 'ORTHO'; cam.ortho_scale = ortho
    else: cam.angle_y = rad(fov)
    co.location = loc; d = Vector(look) - Vector(loc); co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co; sc.render.filepath = path; bpy.ops.render.render(write_still=True); bpy.data.objects.remove(co)
_pm = {}
def preview_mat(attr='Prev'):
    """预览材质：基色取自颜色属性 attr，粗糙度取自 'Col' 的 B 通道。"""
    if attr in _pm: return _pm[attr]
    m = bpy.data.materials.new('prev_' + attr); m.use_nodes = True; nt = m.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = attr; nt.links.new(a.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.7
    _pm[attr] = m; return m


# ---------------- GLB 后处理：关节顺序改成 BONES 的顺序 ----------------
def glb_read(path):
    d = open(path, 'rb').read(); assert d[:4] == b'glTF'; jl = struct.unpack('<I', d[12:16])[0]; js = json.loads(d[20:20 + jl]); o = 20 + jl
    bl = struct.unpack('<I', d[o:o + 4])[0]; return js, bytearray(d[o + 8:o + 8 + bl])
def glb_write(path, js, bn):
    j = json.dumps(js, separators=(',', ':')).encode(); j += b' ' * ((4 - len(j) % 4) % 4); bn = bytes(bn) + b'\0' * ((4 - len(bn) % 4) % 4)
    open(path, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + 8 + len(j) + 8 + len(bn)) + struct.pack('<I', len(j)) + b'JSON' + j + struct.pack('<I', len(bn)) + b'BIN\0' + bn)
CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc_view(js, bn, ai):
    a = js['accessors'][ai]; bv = js['bufferViews'][a['bufferView']]; fmt, sz = CT[a['componentType']]; nc = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', sz * nc)
    assert stride == sz * nc, 'interleaved buffers not supported'
    arr = np.frombuffer(bn, dtype=np.dtype('<' + fmt), count=a['count'] * nc, offset=off).reshape(a['count'], nc)
    return arr, off
def glb_reorder_joints(path):
    js, bn = glb_read(path); order = [b[0] for b in BONES]
    for sk in js.get('skins', []):
        names = [js['nodes'][j]['name'] for j in sk['joints']]
        if names == order: continue
        remap = np.array([order.index(n) for n in names], dtype=np.int64)      # 旧关节号 → 新关节号
        ibm, off = acc_view(js, bn, sk['inverseBindMatrices']); new = np.zeros_like(ibm)
        for old, nw in enumerate(remap): new[nw] = ibm[old]
        bn[off:off + new.nbytes] = new.astype(ibm.dtype).tobytes()
        sk['joints'] = [sk['joints'][names.index(n)] for n in order]
        si = js['skins'].index(sk); done = set()
        for nd in js['nodes']:
            if nd.get('skin') != si or 'mesh' not in nd: continue
            for pr in js['meshes'][nd['mesh']]['primitives']:
                ai = pr['attributes'].get('JOINTS_0')
                if ai is None or ai in done: continue
                done.add(ai); J, off = acc_view(js, bn, ai); bn[off:off + J.nbytes] = remap[J].astype(J.dtype).tobytes()
    glb_write(path, js, bn)


# ---------------- UV、顶点色、导出 ----------------
def box_uv(ob, k=2.0):
    """按面法线主轴做立方体投影（与 actors.js 里 add() 的写法一致：游戏坐标，每米 k 个单位）。逐面写 UV，轴向交界处由导出器拆点。"""
    me = ob.data; uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap'); me.uv_layers.active = uv
    vs = me.vertices; lp = me.loops; data = uv.data
    for p in me.polygons:
        n = p.normal; gnx, gny, gnz = abs(n.x), abs(n.z), abs(n.y)
        m = 0 if (gnx >= gny and gnx >= gnz) else (1 if gnz >= gny else 2)
        for li in p.loop_indices:
            c = vs[lp[li].vertex_index].co; gx, gy, gz = c.x, c.z, -c.y
            data[li].uv = ((gz, gy), (gx, gy), (gx, gz))[m][0] * k, ((gz, gy), (gx, gy), (gx, gz))[m][1] * k
def write_col(ob, ao):
    """Col：R = (槽位 + 0.5) / 16，G = AO × 明暗，B = 建议粗糙度，A = 布纹法线权重。"""
    me = ob.data; slot = get_attr(ob, 'slot', 0).astype(int); shade = get_attr(ob, 'shade', 1.0)
    ca = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for i in range(len(me.vertices)):
        nw, rg = SURF[SLOTS[slot[i]]]; ca.data[i].color = ((slot[i] + 0.5) / 16.0, min(1.0, max(0.0, (0.28 + 0.72 * ao[i]) * shade[i])), rg, nw)
    me.color_attributes.active_color = ca
    try: me.color_attributes.render_color_index = list(me.color_attributes).index(ca)
    except Exception: pass
def write_prev(ob, variant):
    me = ob.data; col = me.color_attributes['Col']; pv = me.color_attributes.get('Prev') or me.color_attributes.new('Prev', 'FLOAT_COLOR', 'POINT'); P = PREV[variant]
    for i in range(len(me.vertices)):
        c = col.data[i].color; b = P[SLOTS[int(c[0] * 16)]]; pv.data[i].color = (b[0] * c[1], b[1] * c[1], b[2] * c[1], 1)
    if not me.materials: me.materials.append(preview_mat('Prev'))
def export_glb(path, objs):
    for o in bpy.data.objects: o.select_set(o in objs)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    want = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True, export_normals=True, export_texcoords=True, export_materials='NONE',
                export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_cameras=False, export_lights=False,
                export_animations=False, export_skins=True, export_all_influences=False, export_def_bones=False, export_extras=False, export_morph=False, export_image_format='NONE')
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in props})
    glb_reorder_joints(path)
