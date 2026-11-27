"""小兵的武器 · 换画风 B（路子一 卡通厚涂）：近战兵的单刃斧和圆盾、远程兵的法杖。给 tools/blender/hero_build.py 的 rig 一步用（gear 里 type 是 script）。

为什么用脚本建（照 b-lan 定的做法，HERO_B.md“武器”一节）：形状都是“一条轮廓加一个厚度”，脚本建轮廓干净、面数小（小兵满屏几十个，面数要省）、颜色完全照设定图、不花额度。
旧的小兵武器（tools/blender/unit_gear.py）是四个纯色块拼的，斧刃骨白、盾心和杖头一点青光；B 的贴图要带手绘的明暗，所以重做一张 256 的小图。

设计（设定图 art/style_b/concept/minion-melee-p1-sheet.png、minion-ranged-p1-sheet.png 里没画武器，照身上的配色和 STYLE.md 路子一定）：
  · 斧：浅钢灰的斧头（和身上的盔甲同一种钢，刃口一线亮），暖棕木柄，握手处缠深棕皮条，柄尾一颗钢球。圆润、厚，不要尖刺。
  · 盾：圆盾，盾面是一整块青蓝（和布片、盔缨同一块颜色 = 换色区，对方那一队换成余烬红），一圈钢边，正中一个钢的盾心。俯视镜头里最大的一块队伍色。
  · 法杖：暖棕木杖，钢箍，杖头三片钢托着一颗青蓝的圆珠（也是换色区）。小兵不发光（STYLE.md 3.1 第 6 条），珠子靠手绘的高光显得亮。
颜色：钢、皮、木照设定图上取的色；青蓝取设定图布片的颜色（约 70,140,170），游戏的 tune() 在对方那一队把“G、B 明显高于 R”的颜色换成余烬色。

握持坐标（hero_build.py 约定）：原点是手握的位置，+Y 是杆身从拳眼（食指一侧）伸出去的方向，-Z 是顺着前臂往外（斧刃朝这边），X 是厚度。
盾自己的坐标：盾面朝 +Z，原点在盾的背面中心（mount 是 forearm，绑在前臂外侧）。单位：角色身高是 1。
"""
import bpy, bmesh, math
import numpy as np

TEX = 256
# 设定图上取的色（sRGB 0–1）
STEEL_HI, STEEL, STEEL_LO = np.array((0.93, 0.95, 0.96)), np.array((0.64, 0.68, 0.72)), np.array((0.38, 0.41, 0.46))      # 浅钢灰三档（盔甲）
WOOD_HI, WOOD, WOOD_LO = np.array((0.74, 0.50, 0.30)), np.array((0.58, 0.37, 0.21)), np.array((0.36, 0.22, 0.13))          # 暖棕木
LEA_HI, LEA, LEA_LO = np.array((0.50, 0.32, 0.20)), np.array((0.36, 0.22, 0.14)), np.array((0.20, 0.12, 0.08))             # 深棕皮条
TEAL_HI, TEAL, TEAL_LO = np.array((0.50, 0.78, 0.86)), np.array((0.27, 0.55, 0.67)), np.array((0.15, 0.33, 0.45))         # 青蓝（换色区，设定图布片约 70,140,170）


def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def _mix(a, b, t): return a * (1 - t[..., None]) + b * t[..., None]


def _texture():
    """四块 128×128：左下钢（u 横着是“中心 → 外沿”，v 是“背光 → 受光”）；右下木（u 绕柄一圈，v 柄长）；左上青蓝（同钢的排法）；右上皮条（斜缠）"""
    img = np.zeros((TEX, TEX, 3), np.float32)
    yy, xx = np.mgrid[0:128, 0:128].astype(np.float32) + 0.5; u = xx / 128.0; v = yy / 128.0
    def plate(HI, MID, LO, edge_hi):
        c = _mix(np.broadcast_to(LO, u.shape + (3,)), MID, _ss(0.0, 0.55, v))       # 背光一侧暗 → 中间
        c = _mix(c, HI, _ss(0.6, 1.0, v) * 0.45)                                     # 受光一侧亮（大块明暗画进贴图，B 的做法；第二轮从 0.75 压到 0.45，游戏里斧面整块发白）
        c = _mix(c, HI, np.exp(-((u - 0.9) / 0.05) ** 2) * edge_hi)                  # 外沿一线高光（斧刃磨亮、盾面边缘）
        return c
    img[0:128, 0:128] = plate(STEEL_HI, STEEL, STEEL_LO, 0.85)
    img[128:256, 0:128] = plate(TEAL_HI, TEAL, TEAL_LO, 0.35)
    # 木：竖着几道低频的木纹，绕柄一圈有明暗（u=0.25 一侧亮）
    shade = 0.5 + 0.5 * np.cos((u - 0.25) * 2 * math.pi)
    grain = 0.5 + 0.5 * np.sin(u * 2 * math.pi * 3 + np.sin(v * 7.0) * 0.8)
    w = _mix(np.broadcast_to(WOOD_LO, u.shape + (3,)), WOOD, _ss(0.0, 0.6, shade)); w = _mix(w, WOOD_HI, _ss(0.6, 1.0, shade) * 0.7); w = _mix(w, WOOD_LO, grain * 0.18)
    img[0:128, 128:256] = w
    # 皮条：斜着缠，每一圈靠上的边亮一线、两圈之间的缝暗
    ph = (v * 6.0 + u) % 1.0
    l_ = _mix(np.broadcast_to(LEA, u.shape + (3,)), LEA_HI, _ss(0.55, 0.85, ph) * (1 - _ss(0.88, 0.97, ph)))
    l_ = _mix(l_, LEA_LO, _ss(0.9, 1.0, ph) * 0.9 + (1 - _ss(0.0, 0.08, ph)) * 0.5)
    l_ = _mix(l_, LEA_LO, (1 - _ss(-0.2, 0.6, shade)) * 0.35)
    img[128:256, 128:256] = l_
    return img


def _material():
    m = bpy.data.materials.get("weapon_b")
    if m: return m
    arr = _texture(); img = bpy.data.images.new("weapon_unit_b", TEX, TEX, alpha=False)
    # 直接写 sRGB 的色值：bpy.data.images.new 建的是 8 位、sRGB 的图，pixels 原样存、原样导出（第一版照岚的 gear.py 先换成线性再写，导出的图暗了一大截：青蓝 70,140,170 变成 15,66,101，对方那一队的换色也认不出来）
    img.pixels.foreach_set(np.concatenate([arr, np.ones((TEX, TEX, 1), np.float32)], axis=2).astype(np.float32).ravel())
    img.file_format = "PNG"; img.pack()
    m = bpy.data.materials.new("weapon_b"); m.use_nodes = True      # 以 weapon 开头：游戏靠它认武器；以 _b 结尾：卡通厚涂的材质处理
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"); tx = m.node_tree.nodes.new("ShaderNodeTexImage"); tx.image = img
    m.node_tree.links.new(tx.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.7; b.inputs["Metallic"].default_value = 0.0
    return m


# 贴图坐标的四块（u0, v0, u1, v1）。Blender 的 v 从下往上，图的第 0 行在最下面
STEEL_R, TEAL_R, WOOD_R, LEA_R = (0.0, 0.0, 0.5, 0.5), (0.0, 0.5, 0.5, 1.0), (0.5, 0.0, 1.0, 0.5), (0.5, 0.5, 1.0, 1.0)
def _uv(rect, s, t): return (rect[0] + (rect[2] - rect[0]) * (0.02 + 0.96 * s), rect[1] + (rect[3] - rect[1]) * (0.02 + 0.96 * t))


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

    def strip(self, rings, closed=True):
        for a, b in zip(rings[:-1], rings[1:]):
            n = len(a)
            for k in range(n if closed else n - 1):
                k2 = (k + 1) % n; self.f([a[k], a[k2], b[k2], b[k]])

    def finish(self, name):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free(); me.uv_layers[0].name = "UVMap"      # 和身体的贴图坐标层同名，合并网格时才会并到同一层
        me.materials.append(_material()); return me


def _lathe(m, prof, rect, seg=12, axis="y", at=(0.0, 0.0, 0.0), sx=1.0):
    """绕轴转一圈的回转体。prof 是 [(沿轴的位置, 半径)]，两头半径为 0 时自动收成尖（封口）。贴图：u 绕一圈，v 沿轮廓"""
    rings = []; n = len(prof)
    for j, (h, r) in enumerate(prof):
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg; c, s = math.cos(a) * r, math.sin(a) * r
            p = (c * sx, h, s) if axis == "y" else (c * sx, s, h)
            uv = _uv(rect, k / seg, j / (n - 1)) if rect in (WOOD_R, LEA_R) else _uv(rect, 0.6, 0.3 + 0.65 * j / (n - 1))      # 木、皮条：绕一圈有明暗、斜缠；钢：沿轮廓往上越来越亮（绕一圈不变，不然有一道接缝）
            ring.append(m.v((p[0] + at[0], p[1] + at[1], p[2] + at[2]), uv))
        rings.append(ring)
    m.strip(rings)
    for ring, rev in ((rings[0], True), (rings[-1], False)):
        cx = sum(v.co.x for v in ring) / seg; cy = sum(v.co.y for v in ring) / seg; cz = sum(v.co.z for v in ring) / seg
        c = m.v((cx, cy, cz), _uv(rect, 0.5, 0.0 if rev else 1.0))
        for k in range(seg): m.f([c, ring[(k + 1) % seg], ring[k]] if rev else [c, ring[k], ring[(k + 1) % seg]])


def _lens(m, outline, T, rect, M=6, back=0.35, light=(0.6, 0.8)):
    """一块透镜截面的厚板（斧头）：outline 是 YZ 平面里一圈逆时针的轮廓点，从中心往外 M 圈，中心厚 T、外沿收薄到 back*T（刃口一侧再薄）。
    贴图：u 是“中心 → 外沿”，v 按这一点朝受光方向（light，YZ 里的方向）有多正，正的一侧亮"""
    n = len(outline); cy = sum(p[0] for p in outline) / n; cz = sum(p[1] for p in outline) / n; ln = math.hypot(*light); L = (light[0] / ln, light[1] / ln)
    def ring(j, side):
        t = j / M; out = []
        for (py, pz) in outline:
            y = cy + (py - cy) * t; z = cz + (pz - cz) * t; dy, dz = py - cy, pz - cz; dl = math.hypot(dy, dz) or 1
            edge = 1.0 if pz > cz else 0.55                                                           # 靠柄的一侧（+Z）厚，刃口一侧（-Z）薄
            th = (T * (1 - t ** 4) ** 0.5 * (1 - back) + T * back * (1 - t) * edge) if t < 1 else 0.0004
            out.append(m.v((side * th * 0.5, y, z), _uv(rect, t, 0.5 + 0.5 * (dy * L[0] + dz * L[1]) / dl)))
        return out
    front = [ring(j, 1) for j in range(M + 1)]; back_ = [ring(j, -1) for j in range(M)] + [front[-1]]
    cf = m.v((T * 0.5, cy, cz), _uv(rect, 0.0, 0.5)); cb = m.v((-T * 0.5, cy, cz), _uv(rect, 0.0, 0.5))
    for k in range(n): m.f([cf, front[0][k], front[0][(k + 1) % n]]); m.f([cb, back_[0][(k + 1) % n], back_[0][k]])
    m.strip(front); m.strip([r[::-1] for r in back_])


def make_axe():
    m = _Mesh()
    _lathe(m, [(-0.135, 0.0), (-0.135, 0.012), (-0.128, 0.02), (-0.115, 0.021), (-0.104, 0.014), (-0.1, 0.013)], STEEL_R, seg=12)      # 柄尾一颗钢球
    _lathe(m, [(-0.1, 0.0135), (0.05, 0.0135)], LEA_R, seg=10)                                                                          # 握手处缠皮条
    _lathe(m, [(0.05, 0.0125), (0.33, 0.0115), (0.338, 0.0)], WOOD_R, seg=10)                                                           # 木柄
    _lathe(m, [(0.205, 0.0), (0.205, 0.016), (0.215, 0.021), (0.335, 0.021), (0.345, 0.016), (0.345, 0.0)], STEEL_R, seg=10, sx=1.25)   # 斧头套在柄上的那一段
    # 斧刃：颈窄、刃口宽的一把单刃斧，上下两个角往外翘（第二轮：第一版是一块圆鼓鼓的扇形，游戏里近看像一只白色的布袋，认不出是斧头）
    pts = []
    for i in range(17):                                                                  # 刃口：外凸的弧，从下角到上角
        a = -1.05 + 2.1 * i / 16; pts.append((0.277 + math.sin(a) * 0.128, -0.118 - math.cos(a) * 0.046))
    pts += [(0.405, -0.128), (0.392, -0.11), (0.366, -0.08), (0.338, -0.045), (0.322, -0.018), (0.318, 0.004),      # 上角 → 往里收的弧 → 颈
            (0.238, 0.004), (0.234, -0.018), (0.218, -0.045), (0.19, -0.08), (0.164, -0.11), (0.151, -0.128)]      # 颈 → 往外翘的下角
    pts = pts[::-1] if sum((pts[i][0] - pts[i - 1][0]) * (pts[i][1] + pts[i - 1][1]) for i in range(len(pts))) > 0 else pts
    _lens(m, pts, 0.022, STEEL_R, M=8, back=0.45, light=(0.7, -0.7))
    return m.finish("axe_b")


def make_shield():
    """圆盾：盾面朝 +Z，原点在盾的背面中心。青蓝的盾面微微鼓起，一圈厚的钢边，正中一个钢的盾心"""
    m = _Mesh(); R = 0.19; seg = 28
    # 盾面：从正中往外的一圈圈，鼓起 0.03；贴图 u 中心 → 外沿，v 按朝受光方向（左上）亮
    rings = []
    for j in range(1, 7):
        t = j / 6; r = R * 0.92 * t; z = 0.022 + 0.03 * (1 - t * t); ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg; ring.append(m.v((math.cos(a) * r, math.sin(a) * r, z), _uv(TEAL_R, t * 0.8, 0.85 - 0.3 * t)))
        rings.append(ring)
    c = m.v((0, 0, 0.052), _uv(TEAL_R, 0.0, 0.5))
    for k in range(seg): m.f([c, rings[0][k], rings[0][(k + 1) % seg]])
    m.strip(rings)
    # 钢边：一圈圆滚滚的环（截面是圆），把盾面的外沿包住
    rr = 0.02; rim = []
    for i in range(9):
        b = 2 * math.pi * i / 8; ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg; r = R * 0.94 + math.cos(b) * rr; ring.append(m.v((math.cos(a) * r, math.sin(a) * r, 0.02 + math.sin(b) * rr * 0.9), _uv(STEEL_R, 0.5 + 0.38 * max(0.0, math.sin(b)), 0.45 + 0.45 * max(0.0, math.sin(b)))))
        rim.append(ring)
    m.strip(rim[:-1] + [rim[0]])
    # 背面：一块平板，把边和盾面之间封住
    bk = [m.v((math.cos(2 * math.pi * k / seg) * R * 0.94, math.sin(2 * math.pi * k / seg) * R * 0.94, 0.0), _uv(STEEL_R, 0.3, 0.2)) for k in range(seg)]
    cb = m.v((0, 0, 0.0), _uv(STEEL_R, 0.0, 0.2))
    for k in range(seg): m.f([cb, bk[(k + 1) % seg], bk[k]])
    # 盾心：一个钢的圆包
    _lathe(m, [(0.0, 0.0)] + [(0.034 * math.sin(math.pi / 2 * i / 6), 0.058 * math.cos(math.pi / 2 * i / 6)) for i in range(7)], STEEL_R, seg=16, axis="z", at=(0.0, 0.0, 0.04))
    return m.finish("shield_b")


def make_staff():
    """法杖：暖棕木杖，握手处缠皮条，上端钢箍，三片钢托着一颗青蓝的圆珠（换色区）"""
    m = _Mesh()
    _lathe(m, [(-0.34, 0.0), (-0.34, 0.012), (-0.33, 0.016), (-0.31, 0.016), (-0.3, 0.012)], STEEL_R, seg=10)          # 杖尾钢箍
    _lathe(m, [(-0.3, 0.0125), (-0.06, 0.0125)], WOOD_R, seg=10)
    _lathe(m, [(-0.06, 0.0135), (0.07, 0.0135)], LEA_R, seg=10)                                                       # 握手处缠皮条
    _lathe(m, [(0.07, 0.0125), (0.43, 0.0135)], WOOD_R, seg=10)
    _lathe(m, [(0.43, 0.0), (0.43, 0.017), (0.44, 0.021), (0.47, 0.021), (0.48, 0.017), (0.485, 0.0)], STEEL_R, seg=10)      # 上端钢箍
    for i in range(3):                                                                                                 # 三片弯的钢托，从箍上伸出去抱住珠子
        a = 2 * math.pi * i / 3 + 0.3; ca, sa = math.cos(a), math.sin(a); prof = []
        for j in range(7):
            t = j / 6; r = 0.018 + 0.03 * math.sin(t * math.pi * 0.85); h = 0.475 + 0.085 * t; prof.append((r * ca, h, r * sa, 0.009 * (1 - 0.6 * t) + 0.002))
        rings = []
        for j, (px, py, pz, w) in enumerate(prof):
            ring = [m.v((px + ca * math.cos(2 * math.pi * k / 6) * w * 0.6, py + math.sin(2 * math.pi * k / 6) * w, pz + sa * math.cos(2 * math.pi * k / 6) * w * 0.6), _uv(STEEL_R, 0.5 + 0.4 * j / 6, 0.5 + 0.4 * math.sin(2 * math.pi * k / 6))) for k in range(6)]
            rings.append(ring)
        m.strip(rings)
    # 珠子：受光的左上半亮、右下半暗，一点高光（手绘在贴图里，不发光）
    cy = 0.535; r = 0.043; rings = []
    for j in range(1, 10):
        th = math.pi * j / 10; ring = []
        for k in range(16):
            a = 2 * math.pi * k / 16; x, y, z = math.sin(th) * math.cos(a), math.cos(th), math.sin(th) * math.sin(a)
            lit = 0.5 + 0.5 * (0.5 * x + 0.75 * y + 0.43 * z); ring.append(m.v((x * r, cy + y * r * 1.08, z * r), _uv(TEAL_R, 0.15 + 0.6 * (1 - lit) * 0.9, lit)))
        rings.append(ring)
    top = m.v((0, cy + r * 1.08, 0), _uv(TEAL_R, 0.1, 1.0)); bot = m.v((0, cy - r * 1.08, 0), _uv(TEAL_R, 0.6, 0.0))
    for k in range(16): m.f([top, rings[0][(k + 1) % 16], rings[0][k]]); m.f([bot, rings[-1][k], rings[-1][(k + 1) % 16]])
    m.strip(rings)
    return m.finish("staff_b")
