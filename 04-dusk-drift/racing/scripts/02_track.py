# 赛道几何：路面、路肩、草地、砾石区、护栏、轮胎墙
import bpy, bmesh, math, os, sys, importlib

ROOT = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import track_def as T
importlib.reload(T)

HW = T.HALF_W
L = T.total_length()


def get_coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def wipe_coll(name):
    c = bpy.data.collections.get(name)
    if c:
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)
    return get_coll(name)


COLL = wipe_coll("Track")


def new_obj(name, verts, faces, uvs=None, coll=COLL, smooth=True):
    """uvs: 每个顶点一个 (u, v)（米制），自动展开到 loop。"""
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if uvs is not None:
        uvl = me.uv_layers.new(name="UVm")
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                uvl.data[li].uv = uvs[vi]
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def ribbon(name, s0, s1, d_fn, z_fn=None, ds=1.0, close_ends=False, uv_scale=1.0):
    """沿中心线从 s0 到 s1 的条带。d_fn(s) -> [d0, d1, ...] 横向偏移列表（从右到左递增或任意）。
    z_fn(s, i) -> 高度。UV = (d, s)。"""
    n = max(1, int(round((s1 - s0) / ds)))
    verts, uvs, faces = [], [], []
    cols = None
    for i in range(n + 1):
        s = s0 + (s1 - s0) * i / n
        ds_list = d_fn(s)
        cols = len(ds_list)
        for j, d in enumerate(ds_list):
            x, y, hd = T.offset_point(s, d)
            z = z_fn(s, j) if z_fn else 0.0
            verts.append((x, y, z))
            uvs.append((d * uv_scale, s * uv_scale))
    for i in range(n):
        for j in range(cols - 1):
            a = i * cols + j
            b = a + 1
            c = a + cols + 1
            d_ = a + cols
            faces.append((a, d_, c, b))
    return new_obj(name, verts, faces, uvs)


def smoothstep(a, b, x):
    if a == b:
        return 0.0 if x < a else 1.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ 路面
S0, S1 = -40.0, L + 40.0
nd = 12
track = ribbon("TrackSurface", S0, S1,
               lambda s: [-HW + (2 * HW) * j / nd for j in range(nd + 1)],
               ds=1.0)

# ------------------------------------------------------------------ 主弯与路肩范围
segs = T.seg_ranges()
main = [r for r in segs if r[0][0] == 'A' and abs(r[0][1] - T.MAIN_R) < 1e-6][0]
MC0, MC1 = main[1], main[2]          # 主弯起止弧长
print("main corner s:", MC0, MC1)

KERB_W = 1.3


def kerb(name, s0, s1, side):
    """side=+1 左侧（弯外侧），-1 右侧（弯内侧）。路肩：从路缘向外 1.3m，锯齿略抬高。"""
    def d_fn(s):
        base = side * HW
        return [base, base + side * 0.25, base + side * (KERB_W - 0.2), base + side * KERB_W] if side > 0 else \
               [base + side * KERB_W, base + side * (KERB_W - 0.2), base + side * 0.25, base]

    def z_fn(s, j):
        # 两端渐入
        t = smoothstep(s0, s0 + 4, s) * (1 - smoothstep(s1 - 4, s1, s))
        prof = [0.0, 0.025, 0.055, 0.0] if side > 0 else [0.0, 0.055, 0.025, 0.0]
        return prof[j] * t + 0.002
    return ribbon(name, s0, s1, d_fn, z_fn, ds=0.5)


kerbs = [
    kerb("Kerb_In", MC0 - 8, MC1 + 6, -1),          # 弯内侧（右）
    kerb("Kerb_OutEntry", MC0 - 45, MC0 + 6, +1),   # 入弯外侧（左）
    kerb("Kerb_OutExit", MC1 - 28, MC1 + 55, +1),   # 出弯外侧（左）
]

# ------------------------------------------------------------------ 护栏/缓冲区的横向位置函数
def left_barrier_d(s):
    """左侧（主弯外侧）护栏离中心线的距离：直道 9.5m，主弯外扩到 31m 留出砾石缓冲区。"""
    base = HW + 4.0
    bulge = 22.0 * smoothstep(MC0 - 55, MC0 + 15, s) * (1 - smoothstep(MC1 - 5, MC1 + 60, s))
    return base + bulge


def right_barrier_d(s):
    """右侧（主弯内侧）护栏：直道 -9.5m，主弯内场退到 -17m。"""
    base = -(HW + 4.0)
    dip = -7.5 * smoothstep(MC0 - 30, MC0 + 10, s) * (1 - smoothstep(MC1 - 10, MC1 + 30, s))
    return base + dip


# ------------------------------------------------------------------ 砾石缓冲区（主弯外侧）
G0, G1 = MC0 - 40, MC1 + 50


def gravel_d(s):
    inner = HW + 2.6
    outer = left_barrier_d(s) - 1.6
    t = smoothstep(G0, G0 + 14, s) * (1 - smoothstep(G1 - 14, G1, s))
    outer = inner + (outer - inner) * t
    k = 8
    return [inner + (outer - inner) * j / k for j in range(k + 1)]


gravel = ribbon("GravelTrap", G0, G1, gravel_d, lambda s, j: 0.012, ds=1.0)

# ------------------------------------------------------------------ 草地（大平面，细分用于近处位移）
def grid_plane(name, cx, cy, size, n, z):
    verts, faces, uvs = [], [], []
    for i in range(n + 1):
        for j in range(n + 1):
            x = cx - size / 2 + size * j / n
            y = cy - size / 2 + size * i / n
            verts.append((x, y, z))
            uvs.append((x, y))
    for i in range(n):
        for j in range(n):
            a = i * (n + 1) + j
            faces.append((a, a + 1, a + n + 2, a + n + 1))
    return new_obj(name, verts, faces, uvs, smooth=False)


grass = grid_plane("GrassGround", 20.0, -120.0, 1400.0, 140, -0.02)

# ------------------------------------------------------------------ 波形护栏（Armco）
def armco(name, s0, s1, d_fn, rails=2, face_sign=+1, ds=1.0):
    """W 形波形梁，rails 层。face_sign：波峰朝向（+1 朝中心线左侧法线正方向）。
    返回 (梁物体, 立柱位置列表)。"""
    # W 形截面 (横向凸出 dx, 高度 dz)，单层高 0.31m
    prof = [(0.0, 0.0), (0.035, 0.03), (0.08, 0.075), (0.08, 0.105), (0.02, 0.155),
            (0.08, 0.205), (0.08, 0.235), (0.035, 0.28), (0.0, 0.31)]
    n = max(1, int(round((s1 - s0) / ds)))
    verts, faces, uvs = [], [], []
    base_z = 0.30
    P = len(prof)
    for r in range(rails):
        off = len(verts)
        for i in range(n + 1):
            s = s0 + (s1 - s0) * i / n
            d = d_fn(s)
            for (dx, dz) in prof:
                x, y, hd = T.offset_point(s, d - face_sign * dx)
                verts.append((x, y, base_z + r * 0.33 + dz))
                uvs.append((dz + r * 0.33, s))
        for i in range(n):
            for j in range(P - 1):
                a = off + i * P + j
                faces.append((a, a + P, a + P + 1, a + 1))
    ob = new_obj(name, verts, faces, uvs)
    posts = []
    sp = 3.8
    k = int((s1 - s0) / sp)
    for i in range(k + 1):
        s = s0 + i * sp
        x, y, hd = T.offset_point(s, d_fn(s) + face_sign * 0.09)
        posts.append((x, y, hd))
    return ob, posts


def make_posts(name, posts, h=1.0, w=0.09, dep=0.12):
    verts, faces = [], []
    for (x, y, hd) in posts:
        c, s_ = math.cos(hd), math.sin(hd)
        base = len(verts)
        for dz in (-0.05, h):
            for (lx, ly) in ((-w / 2, -dep / 2), (w / 2, -dep / 2), (w / 2, dep / 2), (-w / 2, dep / 2)):
                verts.append((x + lx * c - ly * s_, y + lx * s_ + ly * c, dz))
        b = base
        faces += [(b, b + 1, b + 5, b + 4), (b + 1, b + 2, b + 6, b + 5), (b + 2, b + 3, b + 7, b + 6),
                  (b + 3, b, b + 4, b + 7), (b + 4, b + 5, b + 6, b + 7)]
    return new_obj(name, verts, faces, smooth=False)


arm_l, posts_l = armco("Armco_L", S0, S1, left_barrier_d, rails=3, face_sign=+1)
arm_r, posts_r = armco("Armco_R", S0, S1, right_barrier_d, rails=2, face_sign=-1)
post_l = make_posts("ArmcoPosts_L", posts_l, h=1.32)
post_r = make_posts("ArmcoPosts_R", posts_r, h=1.0)

# ------------------------------------------------------------------ 轮胎墙（主弯外侧，护栏前）
def tyre_mesh():
    me = bpy.data.meshes.get("TyreMesh")
    if me:
        return me
    bm = bmesh.new()
    R_out, R_in, W = 0.31, 0.19, 0.20
    seg = 28
    # 截面：带圆角的轮胎断面（r, z）
    prof = [(R_in, -W * 0.42), (R_in + 0.03, -W * 0.5), (R_out - 0.045, -W * 0.5), (R_out - 0.01, -W * 0.40),
            (R_out, -W * 0.22), (R_out, W * 0.22), (R_out - 0.01, W * 0.40), (R_out - 0.045, W * 0.5),
            (R_in + 0.03, W * 0.5), (R_in, W * 0.42)]
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = [bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for (r, z) in prof]
        rings.append(ring)
    P = len(prof)
    for i in range(seg):
        r0, r1 = rings[i], rings[(i + 1) % seg]
        for j in range(P):
            bm.faces.new((r0[j], r1[j], r1[(j + 1) % P], r0[(j + 1) % P]))
    me = bpy.data.meshes.new("TyreMesh")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return me


TY_COLL = wipe_coll("TyreWall")
tm = tyre_mesh()
ty_s0, ty_s1 = MC0 - 20, MC1 + 30
s = ty_s0
count = 0
import random
rng = random.Random(7)
while s < ty_s1:
    d = left_barrier_d(s) - 0.45
    x, y, hd = T.offset_point(s, d)
    # 外侧路径更长，按实际步长 0.63m 推进
    x2, y2, _ = T.offset_point(s + 0.5, left_barrier_d(s + 0.5) - 0.45)
    seg_len = math.hypot(x2 - x, y2 - y) / 0.5
    for row in range(2):
        xr, yr, _ = T.offset_point(s + (0.31 / seg_len if row else 0.0), d - row * 0.56)
        for lvl in range(4):
            ob = bpy.data.objects.new("Tyre", tm)
            ob.location = (xr + rng.uniform(-0.015, 0.015), yr + rng.uniform(-0.015, 0.015), 0.10 + lvl * 0.205)
            ob.rotation_euler = (rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), rng.uniform(0, 6.28))
            ob.pass_index = (count // 6) % 2   # 用于红白分组上色
            TY_COLL.objects.link(ob)
            count += 1
    s += 0.63 / seg_len
print("tyres:", count)

# 记录供其它脚本使用
sc = bpy.context.scene
sc["MC0"] = MC0
sc["MC1"] = MC1
print("TRACK_OK", len(bpy.data.objects))
