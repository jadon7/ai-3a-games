"""摩珂 · 引潮人 B 风格（路子一 卡通厚涂）的武器：螺号月灯杖。给 tools/blender/hero_build.py 的 rig 一步用（gear 里 type 是 script，右手）。

为什么用脚本建、不用 Tripo（w-mu 定的，照 docs/style_b/HERO_B.md 的“武器”一节判断）：
  · 旧杖（art/models_src/weapon_moko_raw.glb）是图转 3D 的写实杖：满身绳结、几十片贝壳碎片、铃铛串、裂纹浮木，B 的规矩不要碎零件和磨损，换材质也救不回形状。
  · 拆开看是几块整形：一根杖身（圆管）、杖顶一只海螺（车床转出来的纺锤形加一道螺旋）、一弯月牙（一条弧加一个厚度，和岚的新月刃同一个做法）、一颗灯球、两只小铃。
    都是“一条中线加一个截面”能扫出来的，脚本建轮廓干净、面数小（约 3000 个三角形）、颜色完全照 STYLE.md 的色板、不花额度、没有图转 3D 的背面碎片。
  · 摩珂的设定图里是空手（b-sheets 没画杖），所以形状照旧杖的设计概括：杖顶螺号、旁边一弯铜绿月牙、月牙里吊一颗潮青色的灯（发光只在灯上，STYLE.md 1.5“发光克制”）。

握持坐标（hero_build.py 约定）：原点是手握的位置，+Y 是杖身从拳眼（食指一侧）伸出去的方向（杖头朝这边），-Z 顺着前臂往外，X 是掌心法线方向。
单位：角色身高是 1。全长 1.2、握在 0.455（和旧杖 build.json 的 length / grip 一样，旧动作里杖怎么拄、怎么挥，新杖照样）。
月牙和灯挂在杖身的 +X 一侧；装到手上以后朝哪边由 build.json 的 rot 定（在游戏的俯视镜头里看）。

贴图：一张 256×256 的小图，手绘式的明暗直接画进去（B 的贴图带光影、低频、不画磨损）：
  杖身（x 0..64）：暖褐浮木，竖着几道低频的木纹，往上略亮。
  海螺（x 64..160）：珍珠白底，沿螺旋一圈圈浅褐的带子，口子里是珊瑚粉。u 是绕一圈，v 是从底到螺尖，螺旋的相位按同样的 u、v 算，和网格的螺纹对得上。
  铜绿青铜（x 160..224, y 0..128）：月牙、杖尾的铜箍、吊链。上亮下暗，STYLE.md 的铜绿色板。
  麻绳（x 160..224, y 128..256）：杖身上缠的三道绳，斜纹。
  灯（x 224..256, y 0..128）：潮青，靠上一块白的高光，三道细细的铜丝笼（游戏的着色器认青色，灯自己会亮）。
  铃（x 224..256, y 128..256）：暖黄铜。
"""
import bpy, bmesh, math
import numpy as np

TEX = 256
WOOD_HI, WOOD, WOOD_LO = np.array((0.90, 0.77, 0.58)), np.array((0.76, 0.60, 0.43)), np.array((0.56, 0.42, 0.29))        # 浮木：浅暖褐（第一版 0.62,0.45,0.30 在游戏里是一根深红褐的棍子，压在一身浅青绿上太重）
PEARL_HI, PEARL, PEARL_LO = np.array((0.99, 0.96, 0.90)), np.array((0.93, 0.87, 0.78)), np.array((0.76, 0.66, 0.56))      # 海螺：珍珠白（摩珂主色之一）
BAND = np.array((0.80, 0.62, 0.48))                                                                                         # 海螺的螺旋带：浅褐
CORAL, CORAL_LO = np.array((0.98, 0.80, 0.74)), np.array((0.90, 0.62, 0.58))                                                 # 海螺口子里：浅珊瑚粉（第一版 0.97,0.66,0.60 在俯视里是一颗红球，抢了灯的戏）
BR_HI, BR, BR_MID, BR_LO = np.array((0.49, 0.86, 0.74)), np.array((0.40, 0.73, 0.58)), np.array((0.25, 0.52, 0.44)), np.array((0.25, 0.43, 0.35))      # 铜绿青铜：STYLE.md 2.1 的 #7CDCBD / #65B993 / #418571 / #406E5A
ROPE, ROPE_HI, ROPE_LO = np.array((0.84, 0.76, 0.56)), np.array((0.95, 0.89, 0.70)), np.array((0.58, 0.49, 0.33))            # 麻绳：和腰上的绳一家
LAMP, LAMP_HI, CAGE = np.array((0.36, 0.95, 0.92)), np.array((0.88, 1.0, 0.98)), np.array((0.22, 0.42, 0.36))              # 灯：潮青（阵营色），高光白；铜丝笼压暗、不发光
GOLD_HI, GOLD, GOLD_LO = np.array((0.98, 0.85, 0.50)), np.array((0.85, 0.66, 0.32)), np.array((0.55, 0.38, 0.18))           # 铃：暖黄铜

LENGTH, GRIP = 1.2, 0.455
Y0, Y1 = -GRIP * LENGTH, (1 - GRIP) * LENGTH                                                                                # 杖尾 -0.546，杖顶 0.654（螺尖）


def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def _mix(a, b, t): return a * (1 - t[..., None]) + b * t[..., None]


def _grad(lo, mid, hi, v):
    """v 0 → 1：暗 → 中 → 亮"""
    return _mix(_mix(np.broadcast_to(lo, v.shape + (3,)), mid, _ss(0.0, 0.5, v)), hi, _ss(0.5, 1.0, v))


CONCH_TURNS = 3.2                                                                                                           # 螺旋转几圈（从体螺层到螺尖）
MOUTH_U = 0.75                                                                                                              # 海螺的口子在 u 的哪里：_sweep 的截面 a = 2πu，u 0.75 朝 +X（月牙那一侧）


def _conch_phase(u, v):
    """海螺螺纹的相位（贴图和网格共用一个式子）：沿螺旋往上走一圈加 1"""
    return v * CONCH_TURNS + u


def _texture():
    img = np.zeros((TEX, TEX, 3), np.float32)
    yy, xx = np.mgrid[0:TEX, 0:TEX].astype(np.float32) + 0.5
    # ---- 杖身（x 0..64）：u 绕一圈，v 杖长（0 杖尾 → 1 杖顶）
    u = xx[:, :64] / 64.0; v = yy[:, :64] / TEX
    grain = 0.5 + 0.5 * np.sin(u * 2 * np.pi * 3 + np.sin(v * 9.0) * 1.3)                    # 几道竖着的低频木纹，稍微扭一点
    col = _mix(np.broadcast_to(WOOD, u.shape + (3,)), WOOD_LO, _ss(0.62, 1.0, grain) * 0.55)
    col = _mix(col, WOOD_HI, _ss(0.0, 0.35, grain) * 0.35 + _ss(0.4, 1.0, v) * 0.18)         # 往上略亮（光从上面来）
    img[:, :64] = col
    # ---- 海螺（x 64..160）：u 绕一圈，v 从底（0）到螺尖（1）
    u = (xx[:, 64:160] - 64) / 96.0; v = yy[:, 64:160] / TEX
    ph = _conch_phase(u, v) % 1.0
    col = _grad(PEARL_LO, PEARL, PEARL_HI, np.clip(0.25 + 0.75 * ph, 0, 1))                  # 每一圈螺层靠上（新长的一侧）亮，螺缝暗
    band = np.exp(-((ph - 0.42) / 0.09) ** 2) * _ss(0.12, 0.25, v)                            # 一道浅褐的螺旋带
    col = _mix(col, BAND, band * 0.75)
    col = _mix(col, PEARL_LO, (1 - _ss(0.0, 0.12, ph)) * 0.6)                                 # 螺缝
    mouth = np.exp(-((u - MOUTH_U) / 0.085) ** 2) * _ss(0.04, 0.12, v) * (1 - _ss(0.36, 0.46, v))  # 口子（u = MOUTH_U 那一侧，下半截）：珊瑚粉，中间深
    col = _mix(col, _mix(np.broadcast_to(CORAL, u.shape + (3,)), CORAL_LO, np.exp(-((u - MOUTH_U) / 0.05) ** 2) * 0.7), mouth)
    col = _mix(col, PEARL_HI, (1 - _ss(0.0, 0.05, v)) * 0.5)                                  # 底下的水管口
    img[:, 64:160] = col
    # ---- 铜绿青铜（x 160..224, y 0..128）：v 0 暗 → 1 亮（第二轮整体提一档：月牙在游戏里背光时是一条墨绿）
    v2 = yy[:128, 160:224] / 128.0; u2 = (xx[:128, 160:224] - 160) / 64.0
    col = _mix(_grad(BR_MID, BR, BR_HI * 0.6 + BR * 0.4, v2), BR_HI, _ss(0.78, 0.95, v2) * (1 - _ss(0.95, 1.0, v2)) * 0.9)      # 靠上一道亮带（金属的高光，干净利落）
    col = _mix(col, BR_LO, (1 - _ss(0.0, 0.08, u2)) * 0.4 + _ss(0.92, 1.0, u2) * 0.4)
    img[:128, 160:224] = col
    # ---- 麻绳（x 160..224, y 128..256）：斜纹
    u3 = (xx[128:, 160:224] - 160) / 64.0; v3 = (yy[128:, 160:224] - 128) / 128.0
    ph3 = (v3 * 6.0 + u3 * 1.0) % 1.0
    col = _mix(np.broadcast_to(ROPE, u3.shape + (3,)), ROPE_HI, _ss(0.45, 0.75, ph3) * (1 - _ss(0.8, 0.95, ph3)) * 0.7)
    col = _mix(col, ROPE_LO, _ss(0.9, 1.0, ph3) * 0.8 + (1 - _ss(0.0, 0.1, ph3)) * 0.5)
    img[128:, 160:224] = col
    # ---- 灯（x 224..256, y 0..128）：u 经度，v 纬度（0 底 → 1 顶）
    u4 = (xx[:128, 224:] - 224) / 32.0; v4 = yy[:128, 224:] / 128.0
    col = _mix(np.broadcast_to(LAMP, u4.shape + (3,)), LAMP_HI, np.exp(-(((v4 - 0.72) / 0.12) ** 2 + ((u4 - 0.35) / 0.12) ** 2)) * 0.9)   # 靠上一块白的高光
    cage = np.maximum(np.exp(-((((u4 * 3) % 1.0) - 0.5) / 0.06) ** 2), np.exp(-((v4 - 0.5) / 0.025) ** 2)) * _ss(0.08, 0.18, v4) * (1 - _ss(0.86, 0.95, v4))
    col = _mix(col, CAGE, cage * 0.9)                                                         # 三道竖的铜丝加一道腰线
    img[:128, 224:] = col
    # ---- 铃（x 224..256, y 128..256）
    v5 = (yy[128:, 224:] - 128) / 128.0
    img[128:, 224:] = _mix(_grad(GOLD_LO, GOLD, GOLD_HI, v5), GOLD_LO, (1 - _ss(0.0, 0.2, v5)) * 0.6)
    return img


def _material():
    m = bpy.data.materials.get("weapon_b")
    if m: return m
    arr = _texture(); img = bpy.data.images.new("weapon_moko_b", TEX, TEX, alpha=False)
    lin = np.where(arr <= 0.04045, arr / 12.92, ((arr + 0.055) / 1.055) ** 2.4)              # Blender 的 pixels 是线性的：sRGB 色值先换成线性
    img.pixels.foreach_set(np.concatenate([lin, np.ones((TEX, TEX, 1), np.float32)], axis=2).astype(np.float32).ravel())
    img.file_format = "PNG"; img.pack()
    m = bpy.data.materials.new("weapon_b"); m.use_nodes = True                                # 以 weapon 开头：游戏靠它认武器（出手点、杖头）；以 _b 结尾：卡通厚涂的材质处理
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

    def finish(self, name):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts[:], dist=1e-6)      # 每一圈接缝处多放的那个顶点并回去（贴图坐标存在每个角上，不受影响）；不并的话法线在接缝断开，杖身上一条竖的亮线
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free(); me.uv_layers[0].name = "UVMap"      # 和身体的贴图坐标层同名，合并网格时才会并到同一层
        me.materials.append(_material()); return me


def _frames(P):
    """沿一条中线（N×3）的平行移动标架：切线 T，法线 N、副法线 Bn（不扭）"""
    P = np.asarray(P, float); T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1)[:, None]
    ref = np.array([1.0, 0, 0]) if abs(T[0] @ np.array([1.0, 0, 0])) < 0.9 else np.array([0, 0, 1.0])
    N = [np.cross(T[0], ref)]; N[0] /= np.linalg.norm(N[0])
    for i in range(1, len(P)):
        n = N[-1] - T[i] * (N[-1] @ T[i]); N.append(n / np.linalg.norm(n))
    N = np.array(N); return T, N, np.cross(T, N)


def _sweep(m, P, rad, uv_rect, seg=10, sq=1.0, cap0=True, cap1=True, rfun=None, u_wrap=1.0):
    """沿中线扫一根管子。rad 是每个点的半径（列表）；sq 把截面沿副法线方向压扁；rfun(i, a) 可以按角度再乘一个系数（海螺的螺纹、口子）。
    uv：u 绕一圈（u0..u1），v 沿中线（v0..v1）。每一圈多放一个顶点接缝，贴图不会从 1 跳回 0。"""
    P = np.asarray(P, float); T, N, Bn = _frames(P); u0, v0, u1, v1 = uv_rect; n = len(P); rings = []
    for i in range(n):
        t = i / (n - 1); ring = []
        for k in range(seg + 1):
            a = 2 * math.pi * k / seg; r = rad[i] * (rfun(i, a) if rfun else 1.0)
            co = P[i] + (N[i] * math.cos(a) + Bn[i] * math.sin(a) * sq) * r
            ring.append(m.v(tuple(co), (u0 + (u1 - u0) * (k / seg) * u_wrap, v0 + (v1 - v0) * t)))
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(seg): m.f([a[k], a[k + 1], b[k + 1], b[k]])
    for ring, on, end in ((rings[0], cap0, 0), (rings[-1], cap1, n - 1)):
        if not on: continue
        c = m.v(tuple(P[end] + (T[end] * (-0.3 if end == 0 else 0.3) * rad[end] if rad[end] > 1e-4 else 0)), (u0 + (u1 - u0) * 0.5, v0 if end == 0 else v1))
        for k in range(seg): m.f([c, ring[k + 1], ring[k]] if end == 0 else [c, ring[k], ring[k + 1]])
    return rings


def _sphere(m, c, r, uv_rect, seg=14, rows=9):
    u0, v0, u1, v1 = uv_rect; rings = []
    for j in range(1, rows):
        lat = -math.pi / 2 + math.pi * j / rows; ring = []
        for k in range(seg + 1):
            a = 2 * math.pi * k / seg
            ring.append(m.v((c[0] + r * math.cos(lat) * math.cos(a), c[1] + r * math.sin(lat), c[2] + r * math.cos(lat) * math.sin(a)), (u0 + (u1 - u0) * k / seg, v0 + (v1 - v0) * j / rows)))
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(seg): m.f([a[k], a[k + 1], b[k + 1], b[k]])
    bot = m.v((c[0], c[1] - r, c[2]), (u0 + (u1 - u0) * 0.5, v0)); top = m.v((c[0], c[1] + r, c[2]), (u0 + (u1 - u0) * 0.5, v1))
    for k in range(seg): m.f([bot, rings[0][k + 1], rings[0][k]]); m.f([top, rings[-1][k], rings[-1][k + 1]])


WOOD_UV, CONCH_UV, BRONZE_UV, ROPE_UV, LAMP_UV, GOLD_UV = (0, 0, 0.25, 1), (0.25, 0, 0.625, 1), (0.625, 0, 0.875, 0.5), (0.625, 0.5, 0.875, 1), (0.875, 0, 1, 0.5), (0.875, 0.5, 1, 1)


def _shaft_x(y):
    """杖身的中线：一根略弯的浮木（左右各晃一点，不是笔直的棍子）"""
    t = (y - Y0) / (Y1 - Y0); return 0.006 * math.sin(t * 5.0 + 0.4), 0.005 * math.sin(t * 3.3 + 1.7)


SR0, SR1 = 0.0185, 0.004                                                                     # 杖身半径：杖尾 0.0185，往上加粗 0.004（第一版 0.015 在游戏镜头里细成一根线）


def make_staff():
    m = _Mesh()
    YC0 = Y1 - 0.215                                                                           # 海螺的底（杖身插进去的地方）：海螺长 0.215，和旧杖杖顶那只差不多大（第一版 0.15 在游戏镜头里只是一个点）
    # ---- 杖身：杖尾铜箍上面到海螺底，往上略粗
    ys = np.linspace(Y0 + 0.035, YC0 + 0.02, 22)
    P = [(_shaft_x(y)[0], y, _shaft_x(y)[1]) for y in ys]
    rad = [SR0 + SR1 * (y - Y0) / (Y1 - Y0) for y in ys]
    _sweep(m, P, rad, (WOOD_UV[0], 0.0, WOOD_UV[2], 0.86), seg=10, cap0=False, cap1=False)
    # ---- 杖尾的铜箍：一段圆头的铜套
    ys = np.linspace(Y0, Y0 + 0.045, 6); P = [(_shaft_x(y)[0], y, _shaft_x(y)[1]) for y in ys]
    rad = [0.015, 0.0205, 0.0225, 0.0225, 0.023, 0.022]
    _sweep(m, P, rad, BRONZE_UV, seg=10, cap1=False)
    # ---- 三道麻绳：握的地方（被手挡住大半）、月牙下面、海螺下面
    for yc, h in ((0.0, 0.10), (YC0 - 0.165, 0.035), (YC0 - 0.025, 0.03)):
        ys = np.linspace(yc - h / 2, yc + h / 2, 4); P = [(_shaft_x(y)[0], y, _shaft_x(y)[1]) for y in ys]
        r0 = SR0 + SR1 * (yc - Y0) / (Y1 - Y0) + 0.004
        _sweep(m, P, [r0 * 0.93, r0, r0, r0 * 0.93], ROPE_UV, seg=12)
    # ---- 海螺：纺锤形，底下一截细的水管，最粗在三成处，往上一圈圈收成螺尖；口子朝 +X（月牙那一侧）
    n = 26; ts = np.linspace(0, 1, n); H = Y1 - YC0
    cx, cz = _shaft_x(YC0)
    P = [(cx + 0.006 * t, YC0 + H * t, cz) for t in ts]                                        # 稍微往月牙那边歪一点
    prof = lambda t: (0.026 + 0.046 * math.sin(min(t / 0.30, 1) * math.pi / 2) ** 0.8) if t < 0.30 else 0.072 * (1 - (t - 0.30) / 0.70) ** 1.25 + 0.0015
    rad = [prof(t) for t in ts]

    def rfun(i, a):
        t = ts[i]; u = a / (2 * math.pi); ph = (t * CONCH_TURNS + u) % 1.0
        k = 1.0 - 0.13 * (1 - ph) ** 2 * (0.4 + 0.6 * min(1, t / 0.3))                         # 螺纹：每一圈螺层鼓、螺缝凹（和贴图同一个相位）
        am = 2 * math.pi * MOUTH_U; da = math.atan2(math.sin(a - am), math.cos(a - am))                 # 离口子有多远（_sweep 的截面：a 0 朝 -Z、π/2 朝 -X、3π/2 朝 +X）
        lip = math.exp(-(da / 0.55) ** 2) * max(0.0, min(1, (t - 0.03) / 0.08)) * max(0.0, 1 - (t - 0.18) / 0.2) if t < 0.38 else 0.0
        return k * (1 + 0.22 * lip)                                                            # 口子的唇往外翻
    _sweep(m, P, rad, CONCH_UV, seg=16, rfun=rfun, cap1=False)
    # ---- 月牙：挂在杖身 +X 一侧，上角接在海螺下面的杖身上，往外、往下弯成一个 C，开口朝杖身
    cy = YC0 - 0.105; R = 0.09                                                                 # 月牙那个圆的圆心高度、半径（圆心在杖身外侧）
    ccx = cx + 0.074
    angs = np.linspace(math.radians(118), math.radians(-120), 30)                              # 从上角（靠杖身）绕外侧转到下角
    P = [(ccx + R * math.cos(a) * 0.95, cy + R * math.sin(a), cz) for a in angs]
    wfun = lambda t: 0.0045 + 0.019 * math.sin(math.pi * t) ** 0.85                            # 两角尖、中间最宽
    # 月牙是扁的：截面在 XY 平面里宽（往圆外侧偏），Z 方向薄
    T, Nn, Bn = _frames(P); rings = []; segs = 10
    for i, p in enumerate(P):
        t = i / (len(P) - 1); w = wfun(t); out = np.array([math.cos(angs[i]), math.sin(angs[i]), 0.0]); ring = []
        for k in range(segs + 1):
            a = 2 * math.pi * k / segs; co = np.array(p) + out * (w * math.cos(a) + w * 0.55) + np.array([0, 0, 1.0]) * (0.0085 * math.sin(a))
            ring.append(m.v(tuple(co), (BRONZE_UV[0] + (BRONZE_UV[2] - BRONZE_UV[0]) * t, BRONZE_UV[1] + (BRONZE_UV[3] - BRONZE_UV[1]) * (0.5 + 0.5 * math.cos(a)))))
        rings.append(ring)
    for a_, b_ in zip(rings[:-1], rings[1:]):
        for k in range(segs): m.f([a_[k], a_[k + 1], b_[k + 1], b_[k]])
    for ring, end in ((rings[0], 0), (rings[-1], 1)):
        c = m.v(tuple(np.mean([v_.co[:] for v_ in ring[:-1]], axis=0)), (BRONZE_UV[0] + 0.01, BRONZE_UV[1] + 0.2))
        for k in range(segs): m.f([c, ring[k + 1], ring[k]] if end == 0 else [c, ring[k], ring[k + 1]])
    # 月牙上角和杖身之间一小段铜的连杆
    top = P[0]; _sweep(m, [(cx + 0.012, top[1] + 0.004, cz), (top[0], top[1], cz)], [0.007, 0.006], BRONZE_UV, seg=8)
    # ---- 灯：从月牙上角吊下来一截短链，挂一颗潮青色的灯球，正好在 C 的怀里
    lamp_c = (ccx - 0.006, cy - 0.006, cz); lr = 0.036
    hang = (lamp_c[0], cy + R * 0.95 - 0.006, cz)                                              # 从月牙最高处的内沿竖着吊下来
    _sweep(m, [hang, (lamp_c[0], lamp_c[1] + lr + 0.002, cz)], [0.0035, 0.0035], BRONZE_UV, seg=6)
    _sphere(m, (lamp_c[0], lamp_c[1] + lr + 0.006, cz), 0.009, BRONZE_UV, seg=8, rows=5)        # 灯顶的铜帽
    _sphere(m, lamp_c, lr, LAMP_UV, seg=16, rows=10)
    # ---- 两只小铃：吊在月牙下角
    bot = P[-1]
    for dx, dy, r in ((0.004, -0.03, 0.0125), (-0.018, -0.022, 0.011)):
        c = (bot[0] + dx, bot[1] + dy, cz)
        _sweep(m, [(bot[0] + dx * 0.4, bot[1] + 0.004, cz), (c[0], c[1] + r, cz)], [0.0025, 0.0025], BRONZE_UV, seg=5)
        _sphere(m, c, r, GOLD_UV, seg=10, rows=7)
    return m.finish("staff_b")
