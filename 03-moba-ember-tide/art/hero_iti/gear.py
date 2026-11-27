"""伊缇 · 绯刃 的武器：一对反握的直刃短刀（左右手各一把，同一个形状）。给 tools/blender/hero_build.py 的 rig 一步用（build.json 的 gear 里 type 是 script）。

照 art/style_b/lan/gear.py 写（岚的新月刃），形状换成武器设定图 art/hero_iti/concept/iti-weapon-v2.png 里的直刃：
  · 单刃、刀背笔直，刃口一侧在刀尖前斜着收上去，刀尖落在刀背一侧（切先式的直刀）。设定图任务说“动作图里刀会变弯”，以武器图为准：直的。
  · 刀身暗铁带一点紫褐，刃口一侧磨出一条亮一点的斜面，刃口一整条绯红细光边（设定图任务第 9 条：刃口要“全把最亮”）。
  · 赤金椭圆护手，深绯红缠柄，柄尾一个赤金环（设定图里环下面还有一束绯红短穗；穗子做成硬的会像一根棍，不做）。
用脚本建、不走 Tripo 的理由同岚（HERO_B.md“武器”一节）：一条轮廓加一个厚度，轮廓干净、面数小、颜色照设定图、不花额度。

握持坐标（hero_build.py 约定）：原点是手握的位置，+Y 是从拳眼（食指一侧）伸出去的方向，-Z 是顺着前臂往外（指尖那边），X 是厚度（掌心朝向）。
**反握**：刀身从小指一侧（-Y）伸出去，再朝前臂（+Z）斜 TILT 度——刀贴着小臂往后，这是反握短刀的样子（刃朝小臂后方）。
刃口朝外（离开前臂的一侧），刀背贴着前臂：刀背在 +Z、+Y 一侧，刃口在 -Z、-Y 一侧。柄尾的赤金环在拳眼一侧（+Y）露出来。
单位：角色身高是 1。刀身 0.24、全长约 0.36（设定图任务第 9 条：反握短刃达不到“武器不少于身高三分之一”，靠刃口的亮边和刀光补；这里已经往长里做了一点）。

贴图：一张 256×256 的小图，明暗直接画进去（B 的贴图带光影、低频、不画磨损）。**颜色直接写 sRGB，不要先转线性**（岚第一版踩过：暗了一截、暗部更艳）。
颜色照设定图量的中位数压一档、偏暖一点（游戏给 B 的材质整体提亮 1.4，HERO_B.md“武器”一节）：
  设定图：刀身 96,71,81；刃口斜面 143,91,99；刃口光边 249,149,152（外圈 230,40,60 的红晕）；护手 199,131,96；缠柄 113,35,54。
"""
import bpy, bmesh, math
import numpy as np

TEX = 256
TILT = 40                                    # 刀身从“垂直于前臂”（纯 -Y）朝前臂（+Z）斜多少度。0 是冰锥式的握法，90 是整把贴在前臂上
ROLL = 50                                    # 刀面绕刀自己的长轴转多少度。0 时刀面和掌心平行，反握垂在身侧时从上往下看只剩一条线（游戏是俯视）；照岚的做法（build.json 的 rot 55）转一下，俯视里看得到刀面
BLADE_L, BLADE_W, SPINE_T = 0.24, 0.034, 0.0095      # 刀身长、根部宽（刀背到刃口）、刀背厚
TIP_L = 0.055                                # 刃口一侧在刀尖前多长一段斜着收到刀背上
HANDLE = (-0.048, 0.034)                     # 柄沿刀轴的范围（原点是拳心；刀身那一头是正）
GUARD = (0.034, 0.044)

IRON_HI, IRON, IRON_LO = np.array((0.47, 0.32, 0.35)), np.array((0.31, 0.235, 0.27)), np.array((0.19, 0.145, 0.175))      # 暗铁三档（带紫褐）
EDGE, EDGE_CORE = np.array((0.93, 0.22, 0.32)), np.array((1.0, 0.6, 0.6))                                                # 刃口：绯红的光边，最外一线发白
GOLD_HI, GOLD, GOLD_LO = np.array((0.86, 0.63, 0.4)), np.array((0.64, 0.41, 0.25)), np.array((0.36, 0.19, 0.11))         # 赤金
WRAP, WRAP_HI, WRAP_LO = np.array((0.36, 0.1, 0.16)), np.array((0.53, 0.17, 0.25)), np.array((0.17, 0.04, 0.08))       # 深绯红缠柄


def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def _mix(a, b, t): return a * (1 - t[..., None]) + b * t[..., None]


def _texture():
    img = np.zeros((TEX, TEX, 3), np.float32)
    yy, xx = np.mgrid[0:TEX, 0:TEX].astype(np.float32) + 0.5
    # ---- 刀身：x 0..192 是 s（0 刃口，1 刀背），y 0..256 是 t（0 刀根，1 刀尖）
    s = xx[:, :192] / 192.0; t = yy[:, :192] / TEX
    col = _mix(np.broadcast_to(IRON, s.shape + (3,)), IRON_LO, _ss(0.45, 1.0, s) * 0.8)        # 刀面中间 → 刀背暗
    col = _mix(col, IRON_HI, (1 - _ss(0.2, 0.36, s)) * 0.9)                                     # 刃口一侧磨出来的斜面亮一档（设定图里那条粉亮的斜面）
    col = _mix(col, IRON_HI * 1.1, np.exp(-((s - 0.62) / 0.05) ** 2) * 0.35 * _ss(0.1, 0.4, t))  # 刀面上一道顺着刀身的高光（卡通的“钢”）
    col = _mix(col, IRON, (1 - _ss(0.0, 0.08, t)) * 0.5)                                         # 刀根并进护手
    edge = 1 - _ss(0.15, 0.26, s)                                                                 # 刃口的绯红光边，整条都有（刀尖那段也是）。第一版只占刀宽的一成，俯视镜头里一点都看不出红，加宽到两成多
    col = _mix(col, EDGE, edge)
    col = _mix(col, EDGE_CORE, 1 - _ss(0.0, 0.08, s))
    img[:, :192] = col
    # ---- 柄（x 192..256, y 0..128）：u 绕柄一圈，v 柄长。缠带斜着绕
    u = (xx[:128, 192:] - 192) / 64.0; v = yy[:128, 192:] / 128.0
    ph = (v * 6.0 + u) % 1.0
    band = _mix(np.broadcast_to(WRAP, u.shape + (3,)), WRAP_HI, _ss(0.5, 0.82, ph) * (1 - _ss(0.86, 0.96, ph)))
    band = _mix(band, WRAP_LO, _ss(0.9, 1.0, ph) * 0.9 + (1 - _ss(0.0, 0.08, ph)) * 0.5)
    img[:128, 192:] = band
    # ---- 赤金（x 192..256, y 128..256）：v 0 暗 → 1 亮
    v2 = (yy[128:, 192:] - 128) / 128.0
    img[128:, 192:] = _mix(_mix(np.broadcast_to(GOLD_LO, v2.shape + (3,)), GOLD, _ss(0.0, 0.5, v2)), GOLD_HI, _ss(0.6, 1.0, v2) * 0.85)
    return img


def _material():
    m = bpy.data.materials.get("weapon_b")
    if m: return m
    arr = _texture(); img = bpy.data.images.new("weapon_iti_b", TEX, TEX, alpha=False)
    # 直接写 sRGB 的色值：bpy.data.images.new 建的是 8 位 sRGB 的图，pixels 原样存、原样导出（只有 float_buffer 的图才是线性的）
    img.pixels.foreach_set(np.concatenate([arr, np.ones((TEX, TEX, 1), np.float32)], axis=2).astype(np.float32).ravel())
    img.file_format = "PNG"; img.pack()
    m = bpy.data.materials.new("weapon_b"); m.use_nodes = True      # weapon 开头：游戏靠它认武器（刀光、刀尖）；_b 结尾：卡通厚涂的材质处理
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"); tx = m.node_tree.nodes.new("ShaderNodeTexImage"); tx.image = img
    m.node_tree.links.new(tx.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.6; b.inputs["Metallic"].default_value = 0.0
    return m


class _Mesh:
    def __init__(self):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.verify(); self.uvof = {}
        tr = math.radians(TILT)
        self.A = np.array((0.0, -math.cos(tr), math.sin(tr)))        # 刀轴（指向刀尖）
        P0 = np.array((0.0, -math.sin(tr), -math.cos(tr))); X0 = np.array((1.0, 0.0, 0.0)); rr = math.radians(ROLL)
        self.P = P0 * math.cos(rr) + X0 * math.sin(rr)               # 刃口方向（在刀面里、垂直于刀轴、大致离开前臂）
        self.X = -P0 * math.sin(rr) + X0 * math.cos(rr)              # 厚度（刀面的法线）。转的是整把刀（柄、护手、环一起），绕刀轴，刀尖的位置不变

    def v(self, u, w, x, uv):
        """u 沿刀轴、w 朝刃口、x 厚度 → 握持坐标"""
        co = self.A * u + self.P * w + self.X * x
        vv = self.bm.verts.new(co.tolist()); self.uvof[vv] = uv; return vv

    def f(self, vs):
        try: fc = self.bm.faces.new(vs)
        except ValueError: return None
        for l in fc.loops: l[self.uv].uv = self.uvof[l.vert]
        fc.smooth = True; return fc

    def ring_strip(self, rings, closed=True):
        for a, b in zip(rings[:-1], rings[1:]):
            n = len(a)
            for k in range(n if closed else n - 1):
                k2 = (k + 1) % n; self.f([a[k], a[k2], b[k2], b[k]])

    def finish(self, name):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts[:], dist=1e-6)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free(); me.uv_layers[0].name = "UVMap"      # 和身体的贴图坐标层同名，合并网格时才会并到同一层
        me.materials.append(_material()); return me


def _blade(m, u0, uv_rect, n=18, M=8):
    """直刃：刀背是 w = -BLADE_W/2 那条直线（贴着刀轴偏刀背一侧），刃口在 w = +BLADE_W/2；刀尖前 TIP_L 那段刃口斜着弧上去，在刀背上收成尖。
    横截面：刀背厚、往刃口磨薄（刃口一侧最后两成是一条更陡的斜面），两面对称。s=0 刃口、s=1 刀背映射到贴图的 u。"""
    U0, V0, U1, V1 = uv_rect; L = BLADE_L
    def width(t):                                     # 刀背到刃口的宽度，t 0 刀根 → 1 刀尖
        u = t * L; w = BLADE_W * (1 - 0.12 * t)
        if u > L - TIP_L: k = (u - (L - TIP_L)) / TIP_L; w *= math.sqrt(max(0.0, 1 - k ** 1.6))      # 刀尖前那段：刃口弧着收上去
        return max(w, 0.0008)
    def thick(s):                                     # s 0 刃口 → 1 刀背
        return SPINE_T / 2 * (0.12 + 0.88 * (_ss(0.0, 0.32, np.array(s)) * 0.55 + 0.45 * s))
    ss = [k / M for k in range(M + 1)]
    rings = []
    for i in range(n + 1):
        t = i / n; w = width(t); u = u0 + t * L; ring = []
        tk = 1 - 0.55 * t                             # 越往刀尖越薄
        for s in ss:                                  # 正面：刃口 → 刀背
            ring.append(m.v(u, w / 2 - s * w, float(thick(s)) * tk, (U0 + (U1 - U0) * s, V0 + (V1 - V0) * t)))
        for s in ss[-2:0:-1]:                         # 背面：刀背 → 刃口（两头的点共用）
            ring.append(m.v(u, w / 2 - s * w, -float(thick(s)) * tk, (U0 + (U1 - U0) * s, V0 + (V1 - V0) * t)))
        rings.append(ring)
    m.ring_strip(rings)
    m.f(rings[0][::-1])                               # 刀根封口（藏在护手里）
    tip = m.v(u0 + L + 0.004, -BLADE_W / 2 * (1 - 0.12), 0.0, (U0 + (U1 - U0) * 0.9, V1))
    last = rings[-1]
    for k in range(len(last)): m.f([last[k], last[(k + 1) % len(last)], tip])


def _tube(m, u0, u1, r0, r1, uv_rect, seg=12, rows=4, sw=1.0, sx=1.0, w0=0.0):
    """沿刀轴的一段圆管（柄、护手）。sw / sx 把截面在刃口方向、厚度方向压扁；w0 截面中心朝刃口偏多少"""
    U0, V0, U1, V1 = uv_rect; rings = []
    for j in range(rows + 1):
        t = j / rows; u = u0 + (u1 - u0) * t; r = r0 + (r1 - r0) * t; ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg; ring.append(m.v(u, w0 + math.sin(a) * r * sw, math.cos(a) * r * sx, (U0 + (U1 - U0) * k / seg, V0 + (V1 - V0) * t)))
        rings.append(ring)
    m.ring_strip(rings)
    for ring, rev, u in ((rings[0], True, u0), (rings[-1], False, u1)):
        c = m.v(u, w0, 0.0, (U0 + (U1 - U0) * 0.5, V0 if rev else V1)); [m.f([c, ring[(k + 1) % seg], ring[k]] if rev else [c, ring[k], ring[(k + 1) % seg]]) for k in range(seg)]


def _ring(m, u_c, R, r, uv_rect, seg=16, sides=6):
    """柄尾的赤金环：环面在“刀轴 × 刃口方向”那个平面里（和刀面同一个平面，俯视、侧视都看得到一点）"""
    U0, V0, U1, V1 = uv_rect; rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg; cu, cw = u_c + math.cos(a) * R, math.sin(a) * R; ring = []
        for k in range(sides):
            b = 2 * math.pi * k / sides; rr = R + math.cos(b) * r
            ring.append(m.v(u_c + math.cos(a) * rr, math.sin(a) * rr, math.sin(b) * r, (U0 + (U1 - U0) * k / sides, V0 + (V1 - V0) * (0.3 + 0.7 * (0.5 + 0.5 * math.sin(b))))))
        rings.append(ring)
    rings.append(rings[0]); m.ring_strip(rings)


def make_blade():
    m = _Mesh()
    BLADE, HANDLE_UV, GOLD_UV = (0.0, 0.0, 0.75, 1.0), (0.75, 0.0, 1.0, 0.5), (0.75, 0.5, 1.0, 1.0)
    _tube(m, HANDLE[0], HANDLE[1], 0.0115, 0.0122, HANDLE_UV, seg=10, rows=6, sw=1.15)                    # 柄：深绯红缠柄，截面略扁（沿刀面方向宽一点，和刀身一致）
    _tube(m, GUARD[0], GUARD[1], 0.024, 0.024, GOLD_UV, seg=14, rows=1, sw=1.25, sx=0.62)                 # 护手：赤金椭圆盘（设定图里是一枚椭圆的盘）
    _tube(m, HANDLE[0] - 0.008, HANDLE[0], 0.0135, 0.0128, GOLD_UV, seg=10, rows=1, sw=1.15)               # 柄尾的赤金箍
    _ring(m, HANDLE[0] - 0.008 - 0.014, 0.0115, 0.0034, GOLD_UV)                                            # 柄尾的环
    _blade(m, GUARD[1] - 0.002, BLADE)
    return m.finish("blade_b")
