# 环境布置：树木实例、广告围挡、近景草丛
import bpy, bmesh, math, os, sys, importlib, random
from mathutils import Vector, Matrix

ROOT = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import track_def as T
importlib.reload(T)
sc = bpy.context.scene
D = bpy.data.objects
HW = T.HALF_W
seg = [r for r in T.seg_ranges() if r[0][0] == 'A' and abs(r[0][1] - T.MAIN_R) < 1e-6][0]
MC0, MC1 = seg[1], seg[2]


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def left_barrier_d(s):
    return HW + 4.0 + 22.0 * smoothstep(MC0 - 55, MC0 + 15, s) * (1 - smoothstep(MC1 - 5, MC1 + 60, s))


def right_barrier_d(s):
    return -(HW + 4.0) - 7.5 * smoothstep(MC0 - 30, MC0 + 10, s) * (1 - smoothstep(MC1 - 10, MC1 + 30, s))


def coll(name, hide_render=False):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        sc.collection.children.link(c)
    c.hide_render = hide_render
    return c


def wipe(c):
    for o in list(c.objects):
        bpy.data.objects.remove(o, do_unlink=True)


# 杂物
if "棱角球" in D:
    D["棱角球"].hide_render = True
    D["棱角球"].hide_viewport = True

# ----------------------------------------------------------------------------- 树
SRC = coll("TreeSrc", hide_render=True)
TREES = coll("Trees")
wipe(TREES)
species = {}
for nm in ("jacaranda_tree_LOD0", "fir_tree_01_a_LOD0", "fir_tree_01_b_LOD0", "fir_tree_01_c_LOD0", "tree_small_02_LOD0"):
    o = D.get(nm)
    if o is None:
        continue
    if not o.get("_centered"):
        bb = [Vector(c) for c in o.bound_box]
        cx = (min(v.x for v in bb) + max(v.x for v in bb)) / 2
        cy = (min(v.y for v in bb) + max(v.y for v in bb)) / 2
        zmin = min(v.z for v in bb)
        o.data.transform(Matrix.Translation((-cx, -cy, -zmin - 0.08)))
        o.data.update()
        o["_centered"] = True
    for c in list(o.users_collection):
        c.objects.unlink(o)
    SRC.objects.link(o)
    o.location = (0, 0, 0)
    species[nm] = o
print("species:", list(species))
# 关掉源集合在视图层里的显示
try:
    lc = bpy.context.view_layer.layer_collection.children.get("TreeSrc")
    if lc:
        lc.exclude = True
except Exception as e:
    print("layer exclude:", e)

rng = random.Random(11)
JAC, FA, FB, FC, SM = "jacaranda_tree_LOD0", "fir_tree_01_a_LOD0", "fir_tree_01_b_LOD0", "fir_tree_01_c_LOD0", "tree_small_02_LOD0"


def place(sp, x, y, scale=1.0, rot=None):
    src = species.get(sp)
    if src is None:
        return
    o = bpy.data.objects.new("Tree", src.data)
    o.location = (x, y, 0.0)
    o.rotation_euler = (rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), rng.uniform(0, 6.283) if rot is None else rot)
    sx = scale * rng.uniform(0.92, 1.08)
    o.scale = (sx, sx, scale * rng.uniform(0.9, 1.12))
    TREES.objects.link(o)


def along(points, n, jitter, mix, scale=(0.8, 1.25)):
    """沿折线撒 n 棵树。mix: [(物种, 权重)]"""
    segs = []
    total = 0.0
    for a, b in zip(points[:-1], points[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        segs.append((a, b, L)); total += L
    names = [m[0] for m in mix]; wts = [m[1] for m in mix]
    for i in range(n):
        u = (i + rng.uniform(0.15, 0.85)) / n * total
        for a, b, L in segs:
            if u <= L:
                t = u / L
                x = a[0] + (b[0] - a[0]) * t + rng.uniform(-jitter, jitter)
                y = a[1] + (b[1] - a[1]) * t + rng.uniform(-jitter, jitter)
                sp = rng.choices(names, wts)[0]
                sc_ = rng.uniform(*scale)
                if sp == SM:
                    sc_ *= 1.6
                place(sp, x, y, sc_)
                break
            u -= L


# 东侧（主弯外侧/出弯直道左侧护栏之后）——镜头 C 的背景，面向夕阳被照亮
along([(100, 30), (104, -20), (100, -60), (82, -105), (70, -150), (66, -200)], 15, 5.0, [(JAC, 3), (FA, 2), (FB, 2), (FC, 1)])
along([(122, 20), (126, -40), (112, -100), (96, -160), (90, -210)], 12, 8.0, [(JAC, 2), (FA, 3), (FB, 2)], scale=(0.95, 1.4))
along([(92, -10), (92, -70), (74, -120), (62, -170)], 9, 3.0, [(SM, 3), (FC, 1)], scale=(0.7, 1.1))
# 内场（主弯内侧）——镜头 B 的背景，逆光剪影 + 在赛道上投下长影
along([(-60, -34), (-66, -62), (-58, -96), (-44, -124)], 8, 6.0, [(JAC, 3), (FA, 2), (FB, 2)], scale=(0.85, 1.2))
along([(-84, -30), (-90, -70), (-76, -112)], 6, 7.0, [(JAC, 2), (FA, 2), (FB, 2)], scale=(0.95, 1.35))
# 进弯直道两侧——镜头 A 的背景
along([(-230, 30), (-150, 28), (-80, 30), (-20, 34), (30, 44)], 11, 5.0, [(JAC, 2), (FA, 2), (FB, 2), (SM, 1)])
along([(-230, -34), (-160, -32), (-100, -36), (-66, -42)], 7, 5.0, [(JAC, 2), (FA, 2), (FB, 1)])
# 出弯直道右侧（西侧）远处
along([(-6, -120), (-10, -160), (-4, -200)], 4, 5.0, [(JAC, 2), (FA, 1)])
print("trees:", len(TREES.objects))

# ----------------------------------------------------------------------------- 广告围挡
BOARDS = coll("Boards")
wipe(BOARDS)


def flat_mat(name, color, rough=0.45, emit=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = 0.1
    b.inputs["Coat Roughness"].default_value = 0.3
    # 脏旧感：噪声明暗 + 轻微起伏
    nt = m.node_tree
    for n in [n for n in nt.nodes if n.type in ('TEX_NOISE', 'MAP_RANGE', 'MIX', 'BUMP', 'TEX_COORD')]:
        nt.nodes.remove(n)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.7
    nz.inputs["Detail"].default_value = 5.0
    nz.inputs["Roughness"].default_value = 0.65
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs[1].default_value = 0.3; mr.inputs[2].default_value = 0.72
    mr.inputs[3].default_value = 0.62; mr.inputs[4].default_value = 1.0
    nt.links.new(nz.outputs[0], mr.inputs[0])
    mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'
    mx.inputs[0].default_value = 1.0
    mx.inputs[6].default_value = (color[0] * 0.8, color[1] * 0.8, color[2] * 0.8, 1.0)
    nt.links.new(mr.outputs[0], mx.inputs[7])
    nt.links.new(mx.outputs[2], b.inputs["Base Color"])
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.12
    bp.inputs["Distance"].default_value = 0.01
    nt.links.new(nz.outputs[0], bp.inputs["Height"])
    nt.links.new(bp.outputs[0], b.inputs["Normal"])
    return m


BRANDS = [
    ("KESTREL", (0.80, 0.80, 0.78), (0.42, 0.02, 0.02)),
    ("NORDWIND", (0.85, 0.65, 0.05), (0.02, 0.05, 0.20)),
    ("VELOCE", (0.02, 0.02, 0.02), (0.80, 0.60, 0.04)),
    ("HALDEN", (0.80, 0.80, 0.78), (0.03, 0.03, 0.035)),
    ("ORBIT", (0.55, 0.03, 0.03), (0.78, 0.78, 0.75)),
    ("DASHI", (0.82, 0.82, 0.78), (0.0, 0.22, 0.19)),
    ("MERIDIAN", (0.03, 0.06, 0.22), (0.72, 0.73, 0.74)),
    ("CORSA 76", (0.82, 0.82, 0.80), (0.75, 0.25, 0.02)),
]
post_mat = flat_mat("M_BoardPost", (0.25, 0.26, 0.27), 0.6)


def board(s, d, face_left, brand_i, bottom=1.05, w=6.0, h=1.0):
    name, tcol, bcol = BRANDS[brand_i % len(BRANDS)]
    x, y, hd = T.offset_point(s, d)
    rz = hd if not face_left else hd + math.pi      # face_left: 板面朝 +d（朝左）
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, 0, h), (-w / 2, 0, h))]
    bm.faces.new(vs)
    # 背面略厚 + 两根立柱
    for px in (-w / 2 + 0.5, w / 2 - 0.5):
        m = Matrix.Translation((px, 0.05, (h - bottom) / 2))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m @ Matrix.Diagonal((0.07, 0.07, h + bottom, 1.0)))
    me = bpy.data.meshes.new("Board")
    bm.to_mesh(me); bm.free()
    me.materials.append(flat_mat("M_Board_" + name, bcol))
    me.materials.append(post_mat)
    for p in me.polygons[1:]:
        p.material_index = 1
    ob = bpy.data.objects.new("Board_" + name, me)
    ob.location = (x, y, bottom)
    ob.rotation_euler = (0, 0, rz)
    BOARDS.objects.link(ob)
    cu = bpy.data.curves.new("BoardTxt", 'FONT')
    cu.body = name
    cu.size = h * 0.62
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.space_character = 1.12
    to = bpy.data.objects.new("BoardTxt_" + name, cu)
    cu.materials.append(flat_mat("M_BoardTxt_" + name, tcol))
    to.parent = ob
    to.location = (0, -0.012, h * 0.5)
    to.rotation_euler = (math.radians(90), 0, 0)
    BOARDS.objects.link(to)
    return ob


bi = 0
cam_gap = sc.get("camB2_xy")


def near_cam(s_, d_):
    x, y, _ = T.offset_point(s_, d_)
    for cn, rad in (("Cam_A", 16.0), ("Cam_B", 16.0), ("Cam_B2", 10.0), ("Cam_C", 6.0)):
        c = D.get(cn)
        if c and math.hypot(x - c.location.x, y - c.location.y) < rad:
            return True
    return False


# 内场一侧（右侧护栏后，朝向赛道 = 朝左）：每 4 块同一品牌
s = MC0 - 72
k = 0
while s < MC1 + 24:
    dd = right_barrier_d(s) - 0.35
    # 内侧半径更小，板间距按实际弧长折算
    scale_len = 1.0
    x0_, y0_, _ = T.offset_point(s, dd)
    x1_, y1_, _ = T.offset_point(s + 1.0, right_barrier_d(s + 1.0) - 0.35)
    scale_len = max(0.3, math.hypot(x1_ - x0_, y1_ - y0_))
    if not near_cam(s, dd):
        board(s, dd, True, k // 4, bottom=1.0, w=6.2, h=0.95)
        bi += 1
    k += 1
    s += 6.3 / scale_len
# 外侧（左侧护栏后，朝向赛道 = 朝右）：出弯直道 + 进弯直道 + 主弯外侧
for (a_, b_) in ((MC1 - 10, MC1 + 110), (96, MC0 - 58), (MC0 - 30, MC1 - 14)):
    s = a_
    while s < b_:
        dd = left_barrier_d(s) + 0.35
        x0_, y0_, _ = T.offset_point(s, dd)
        x1_, y1_, _ = T.offset_point(s + 1.0, left_barrier_d(s + 1.0) + 0.35)
        scale_len = max(0.3, math.hypot(x1_ - x0_, y1_ - y0_))
        if not near_cam(s, dd):
            board(s, dd, False, 3 + k // 4, bottom=1.34, w=6.2, h=0.95)
            bi += 1
        k += 1
        s += 6.3 / scale_len
print("boards:", bi)

# ----------------------------------------------------------------------------- 近景草丛（镜头 C 周围）
GR = coll("GrassBlades")
wipe(GR)
rng2 = random.Random(5)
bm = bmesh.new()
uv_layer = bm.loops.layers.uv.new("UVm")
nblades = 0


def blades(s0, s1, d_near, d_far, density):
    global nblades
    # 内侧半径小，按平均弧长折算面积
    xa, ya, _ = T.offset_point(s0, (d_near + d_far) / 2)
    xb, yb, _ = T.offset_point(s0 + 1.0, (d_near + d_far) / 2)
    k_len = math.hypot(xb - xa, yb - ya)
    area = (s1 - s0) * k_len * abs(d_far - d_near)
    n = int(area * density)
    for i in range(n):
        s_ = rng2.uniform(s0, s1)
        d_ = rng2.uniform(min(d_near, d_far), max(d_near, d_far))
        x, y, hd = T.offset_point(s_, d_)
        hgt = rng2.uniform(0.035, 0.085) * (1.0 + 0.6 * math.sin(s_ * 0.9) * math.sin(d_ * 2.3))
        wdt = rng2.uniform(0.004, 0.008)
        ang = rng2.uniform(0, 6.283)
        lean = rng2.uniform(0.0, 0.035)
        la = rng2.uniform(0, 6.283)
        ca, sa = math.cos(ang), math.sin(ang)
        lx, ly = math.cos(la) * lean, math.sin(la) * lean
        shade = rng2.uniform(0.0, 1.0)
        pts = []
        for (t, wf) in ((0.0, 1.0), (0.55, 0.8), (1.0, 0.08)):
            cx, cy, cz = x + lx * t * t, y + ly * t * t, -0.02 + hgt * t
            pts.append(((cx - ca * wdt * wf, cy - sa * wdt * wf, cz), (cx + ca * wdt * wf, cy + sa * wdt * wf, cz)))
        v = [[bm.verts.new(p[0]), bm.verts.new(p[1])] for p in pts]
        for k in range(2):
            f = bm.faces.new((v[k][0], v[k][1], v[k + 1][1], v[k + 1][0]))
            for lp in f.loops:
                lp[uv_layer].uv = (shade, 0.5)
            f.smooth = True
    nblades += n


# 出弯内侧（镜头 C 脚下）
blades(MC1 + 6, MC1 + 62, -(HW + 0.06), -(HW + 4.6), 520)
# 主弯内场：路肩外沿到内侧护栏（镜头 B2 的前景）
blades(MC0 + 14, MC1 + 6, -(HW + 1.36), -(HW + 11.3), 330)
me = bpy.data.meshes.new("GrassBlades")
bm.to_mesh(me); bm.free()
gm = bpy.data.materials.get("M_GrassBlade") or bpy.data.materials.new("M_GrassBlade")
gm.use_nodes = True
nt = gm.node_tree
bs = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "UVm"
sp = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(uvn.outputs[0], sp.inputs[0])
mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = 'RGBA'
nt.links.new(sp.outputs[0], mix.inputs[0])
mix.inputs[6].default_value = (0.035, 0.10, 0.012, 1)
mix.inputs[7].default_value = (0.11, 0.21, 0.03, 1)
nt.links.new(mix.outputs[2], bs.inputs["Base Color"])
bs.inputs["Roughness"].default_value = 0.72
try:
    bs.inputs["Subsurface Weight"].default_value = 0.0
    bs.inputs["Transmission Weight"].default_value = 0.0
    bs.inputs["Sheen Weight"].default_value = 0.0
    bs.inputs["Specular IOR Level"].default_value = 0.12
except KeyError:
    pass
me.materials.append(gm)
gob = bpy.data.objects.new("GrassBlades", me)
GR.objects.link(gob)
print("grass blades:", nblades)
print("DRESSING_OK")
