"""岚 · 汐刃 B 风格（路子一 卡通厚涂）的武器：一对骨白色新月钩刃。给 tools/blender/hero_build.py 的 rig 一步用（gear 里 type 是 script，左右手各调一次）。

为什么用脚本建、不用 Tripo（换画风 B · b-lan 定的）：
  · 旧刀（art/models_src/blade_lan_raw.glb）是图转 3D 的写实骨刀：满身尖刺、镂空、裂纹，B 的规矩不要尖刺和磨损，换材质也救不回形状。
  · B 要的就是“圆润概括、一块清楚的颜色”：新月刃是一条弧加一个厚度，脚本建出来轮廓干净、面数小（一把约 1600 个三角形），颜色完全照设定图控制。
  · 不花 Tripo 额度，图转 3D 常见的背面碎片也不用清。
设计：`art/style_b/concept/lan-p1-game.png` 里岚手上的刀——骨白的新月刃从拳眼往上弯，刃口内侧一道青色细光纹，柄缠深蓝布条，柄尾一个小钩。
STYLE.md 身份表：“双手各一把骨白色新月形弯钩刃，刃口一道青色细光纹，柄缠深蓝布条”。

握持坐标（hero_build.py 约定）：原点是手握的位置，+Y 是刀身从拳眼（食指一侧）伸出去的方向，-Z 是顺着前臂往外（刃口朝这边），X 是厚度。
和旧刀的朝向一致（旧刀 build.json 的 tip=+Y、spine=+Z：刀背朝 +Z，刀尖往刀背一侧弯成钩），所以旧动作里刀怎么挥，新刀就怎么挥。
单位：角色身高是 1。全长约 0.43（旧刀 0.42）。

贴图：一张 256×256 的小图，手绘式的明暗直接画进去（B 的贴图带光影、低频、不画磨损）：
  刃（左边 3/4）：横着是刃口 → 刀背，竖着是刀根 → 刀尖。骨白，刃口一线最亮，往刀背渐暗、偏暖；刃口内侧一道青色细线（游戏的着色器认青色，自己会亮）。
  柄（右下）：深蓝布条斜着缠，缠带的边亮一线。
  骨件（右上）：护手、柄尾钩、刀背上的小鳍，上亮下暗的骨白。
"""
import bpy, bmesh, math
import numpy as np

TEX = 256
BONE_HI, BONE, BONE_LO = np.array((0.9, 0.86, 0.75)), np.array((0.8, 0.74, 0.62)), np.array((0.6, 0.53, 0.42))      # 骨白三档：亮、中、暗（偏暖）。STYLE.md 身份表里的“骨白”
# 为什么比设定图上的骨白暗一档：游戏给 B 的材质整体提亮 1.4（hero.ts 的 tune，为了补 Tripo 贴图比设定图暗的那两成），武器贴图也吃这一下。
# 贴图改成直接写 sRGB 以后，照设定图的原色（0.97 / 0.9 / 0.7）在游戏里整片冲成发青的白、从刃口到刀背的明暗也没了；
# 按身上骨甲在贴图里的亮度（p75 179,163,146、p90 205,193,174）压一档、偏暖一点（天光是冷青的，朝上的刀面在游戏里会偏青，贴图暖一点才回到骨白）。
# 游戏里近景量的中位数（b-polish）：刀 211,219,197 / 234,236,211，前臂骨甲 205,203,186，设定图上的刀 200,193,172 / 202,203,181
CYAN = np.array((0.36, 0.96, 0.93))                                                                                       # 阵营青，比 #7FE9E4 饱和一点，游戏里自己发光
WRAP, WRAP_HI, WRAP_LO = np.array((0.12, 0.19, 0.33)), np.array((0.22, 0.32, 0.5)), np.array((0.05, 0.08, 0.16))      # 深蓝布条（和岚身上的海军蓝一家）。比原来暗、灰一点：原来的 0.13,0.22,0.42 在游戏里是一截宝蓝（61,91,153），身上的海军蓝是 35,56,91–48,101,140


def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def _mix(a, b, t): return a * (1 - t[..., None]) + b * t[..., None]


def _texture():
    img = np.zeros((TEX, TEX, 3), np.float32)
    yy, xx = np.mgrid[0:TEX, 0:TEX].astype(np.float32) + 0.5
    # ---- 刃：x 0..192 是 s（0 刃口，1 刀背），y 0..256 是 t（0 刀根，1 刀尖）
    s = xx[:, :192] / 192.0; t = yy[:, :192] / TEX
    col = _mix(np.broadcast_to(BONE_HI, s.shape + (3,)), BONE, _ss(0.05, 0.55, s))      # 刃口亮 → 中间
    col = _mix(col, BONE_LO, _ss(0.55, 1.0, s) * 0.85)                                      # → 刀背暗
    col = _mix(col, BONE_HI, (1 - _ss(0.0, 0.06, s)) * 0.6)                                 # 刃口一线磨亮
    col = _mix(col, BONE_LO, _ss(0.75, 1.0, t) * _ss(0.3, 1.0, s) * 0.35)                   # 刀尖的刀背一侧再暗一点，钩的形状更清楚
    col = _mix(col, BONE, (1 - _ss(0.0, 0.1, t)) * 0.4)                                     # 刀根并进护手
    line = np.exp(-((s - 0.24) / 0.03) ** 2) * _ss(0.06, 0.16, t) * (1 - _ss(0.8, 0.93, t))   # 刃口内侧一道青色细线，从刀根走到快到刀尖
    col = _mix(col, CYAN, np.clip(line * 1.15, 0, 1))
    img[:, :192] = col
    # ---- 柄（x 192..256, y 0..128）：u 是绕柄一圈，v 是柄长。布条斜着缠，一条宽 0.18 个柄长
    u = (xx[:128, 192:] - 192) / 64.0; v = yy[:128, 192:] / 128.0
    ph = (v * 5.5 + u) % 1.0
    band = _mix(np.broadcast_to(WRAP, u.shape + (3,)), WRAP_HI, _ss(0.55, 0.85, ph) * (1 - _ss(0.88, 0.97, ph)))      # 每一圈布条靠上的边亮一线
    band = _mix(band, WRAP_LO, _ss(0.9, 1.0, ph) * 0.9 + (1 - _ss(0.0, 0.08, ph)) * 0.5)                               # 两圈之间的缝暗
    img[:128, 192:] = band
    # ---- 骨件（x 192..256, y 128..256）：v 0 暗 → 1 亮
    v2 = (yy[128:, 192:] - 128) / 128.0
    img[128:, 192:] = _mix(_mix(np.broadcast_to(BONE_LO, v2.shape + (3,)), BONE, _ss(0.0, 0.5, v2)), BONE_HI, _ss(0.6, 1.0, v2) * 0.8)
    return img


def _material():
    m = bpy.data.materials.get("weapon_b")
    if m: return m
    arr = _texture(); img = bpy.data.images.new("weapon_lan_b", TEX, TEX, alpha=False)
    # 直接写 sRGB 的色值：bpy.data.images.new 建的是 8 位、sRGB 的图，pixels 原样存、原样导出（不做色彩换算，只有 float_buffer 的图才是线性的）。
    # b-lan 第一版先换成线性再写，导出的图暗了一截、暗部更艳：刀背 179,173,153 成了 127,120,93，缠柄的海军蓝 33,56,107 成了 4,11,39（几乎是黑的），青线 92,245,237 成了 27,231,219（w-unit 发现，b-polish 改）
    img.pixels.foreach_set(np.concatenate([arr, np.ones((TEX, TEX, 1), np.float32)], axis=2).astype(np.float32).ravel())
    img.file_format = "PNG"; img.pack()
    m = bpy.data.materials.new("weapon_b"); m.use_nodes = True      # 以 weapon 开头：游戏靠它认武器（刀光、刀尖）；以 _b 结尾：卡通厚涂的材质处理
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"); tx = m.node_tree.nodes.new("ShaderNodeTexImage"); tx.image = img
    m.node_tree.links.new(tx.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.65; b.inputs["Metallic"].default_value = 0.0
    return m


class _Mesh:
    def __init__(self):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.verify(); self.uvof = {}

    def v(self, co, uv):
        vv = self.bm.verts.new(co); self.uvof[vv] = uv; return vv

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


def _arc(y0, z0, phi0, R, L, n):
    """一条圆弧中线（在 YZ 平面里）：起点 (y0,z0)，起始方向和 +Y 的夹角 phi0（往 -Z 偏为正），每走一段转 1/R 弧度（R 为正往 +Z 弯，为负往 -Z 弯），总长 L。
    返回点、切线、法线（切线往左转 90 度：朝 +Y 走时法线是 +Z）"""
    tan = [(math.cos(phi0 - L * i / n / R), -math.sin(phi0 - L * i / n / R)) for i in range(n + 1)]
    nor = [(-tz, ty) for ty, tz in tan]
    pts = [(y0, z0)]
    for i in range(1, n + 1):                                         # 梯形积分，够准
        d = L / n; pts.append((pts[-1][0] + d * (tan[i - 1][0] + tan[i][0]) / 2, pts[-1][1] + d * (tan[i - 1][1] + tan[i][1]) / 2))
    return pts, tan, nor


def _crescent(m, y0, z0, phi0, R, L, wfun, T, uv_rect, n=26, M=7, tip_extra=0.012):
    """新月形的刃：中线是一段弧，横截面是两头尖、刀背一侧厚的透镜。s=-1 是刃口（-Z 一侧，外弧），s=+1 是刀背（+Z 一侧，内弧）。
    uv_rect=(u0,v0,u1,v1)：s 从刃口到刀背映射到 u，t 从刀根到刀尖映射到 v。"""
    pts, tan, nor = _arc(y0, z0, phi0, R, L, n); u0, v0, u1, v1 = uv_rect
    ss = [-1 + 2 * k / M for k in range(M + 1)]
    th = lambda s: T * math.sqrt(max(0.0, 1 - s * s)) ** 0.8 * (0.3 + 0.7 * (1 + s) / 2)      # 刃口薄、刀背厚，两头收成尖（刀背一侧靠光滑着色看起来是圆的）
    rings = []
    for i in range(n + 1):
        t = i / n; w = wfun(t); (py, pz), (ny, nz) = pts[i], nor[i]; ring = []
        for k, s in enumerate(ss):                                    # 正面：刃口 → 刀背
            ring.append(m.v((th(s) * (1 - 0.5 * t), py + ny * s * w, pz + nz * s * w), (u0 + (u1 - u0) * (s + 1) / 2, v0 + (v1 - v0) * t)))
        for s in ss[-2:0:-1]:                                          # 背面：刀背 → 刃口（两头的点和正面共用）
            ring.append(m.v((-th(s) * (1 - 0.5 * t), py + ny * s * w, pz + nz * s * w), (u0 + (u1 - u0) * (s + 1) / 2, v0 + (v1 - v0) * t)))
        rings.append(ring)
    m.ring_strip(rings)
    m.f(rings[0][::-1])                                                # 刀根封口（藏在护手里）
    (py, pz), (ty, tz) = pts[-1], tan[-1]; tip = m.v((0, py + ty * tip_extra, pz + tz * tip_extra), (u0 + (u1 - u0) * 0.5, v1))
    last = rings[-1]
    for k in range(len(last)): m.f([last[k], last[(k + 1) % len(last)], tip])
    return pts


def _tube(m, y0, y1, r0, r1, uv_rect, seg=10, rows=4, sx=1.0, z=0.0):
    """沿 Y 的一段圆管（柄、护手）。sx 把截面在 X 方向压扁"""
    u0, v0, u1, v1 = uv_rect; rings = []
    for j in range(rows + 1):
        t = j / rows; y = y0 + (y1 - y0) * t; r = r0 + (r1 - r0) * t; ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg; ring.append(m.v((math.cos(a) * r * sx, y, z + math.sin(a) * r), (u0 + (u1 - u0) * k / seg, v0 + (v1 - v0) * t)))
        rings.append(ring)
    m.ring_strip(rings)
    for ring, rev in ((rings[0], True), (rings[-1], False)):
        c = m.v((0, ring[0].co.y, z), (u0 + (u1 - u0) * 0.5, v0 if rev else v1)); [m.f([c, ring[(k + 1) % seg], ring[k]] if rev else [c, ring[k], ring[(k + 1) % seg]]) for k in range(seg)]


def make_blade():
    m = _Mesh()
    BLADE, HANDLE = (0.0, 0.0, 0.75, 1.0), (0.75, 0.0, 1.0, 0.5)
    BONE_LOW, BONE_UP = (0.75, 0.5, 1.0, 0.75), (0.75, 0.75, 1.0, 1.0)
    _tube(m, -0.058, 0.05, 0.0118, 0.0112, HANDLE, seg=10, rows=5)                                   # 柄：缠深蓝布条，拳头握在正中（原点）
    _tube(m, 0.044, 0.056, 0.0175, 0.021, BONE_LOW, seg=12, rows=1, sx=0.75)                         # 护手：一圈骨，扁一点
    _tube(m, 0.056, 0.07, 0.021, 0.016, BONE_UP, seg=12, rows=2, sx=0.75)
    # 主刃：从护手往上，起始略偏刃口一侧（-Z），一路往刀背一侧（+Z）弯成新月，最宽处在三成的地方
    wmain = lambda t: 0.058 * (1 - t) ** 0.6 * (0.66 + 0.95 * t) + 0.0015      # 第二轮加宽（0.048 → 0.058）：游戏的俯视镜头里刀常是侧着的，窄了只剩一条细弧
    A0 = (0.062, -0.006, 0.55, 0.21, 0.37); _crescent(m, *A0, wmain, 0.0105, BLADE)
    # 刀背上两片小骨鳍（朝刀柄方向翘），和身上骨甲的鳍是一家（设定图里刀背上也是两三个小倒刺）；圆头，不是尖刺
    pts, tan, nor = _arc(*A0, 26)
    for t_, size in ((0.07, 1.0), (0.36, 0.8)):
        i = round(t_ * 26); (py, pz), (ny, nz), (ty, tz) = pts[i], nor[i], tan[i]; w = wmain(t_) * 0.8
        d = (ny * 0.85 - ty * 0.55, nz * 0.85 - tz * 0.55); phi = math.atan2(-d[1], d[0])
        _crescent(m, py + ny * w, pz + nz * w, phi, 0.06, 0.045 * size, lambda t, s_=size: (0.012 * (1 - t) ** 0.55 + 0.0015) * s_, 0.006 * size, BONE_UP, n=8, M=5, tip_extra=0.004)
    # 柄尾的小钩：往刃口一侧（-Z）弯下去
    _tube(m, -0.07, -0.058, 0.0125, 0.0145, BONE_LOW, seg=10, rows=1)
    _crescent(m, -0.066, -0.002, math.pi - 0.2, 0.048, 0.05, lambda t: 0.0105 * (1 - t) ** 0.7 + 0.001, 0.006, BONE_UP, n=10, M=5, tip_extra=0.005)
    return m.finish("blade_b")
