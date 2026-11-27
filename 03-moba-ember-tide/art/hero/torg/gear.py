"""托尔格 · 沉钟的武器：沉钟长锤。给 tools/blender/hero_build.py 的 rig 一步用（build.json 的 gear 里 type 是 script、func 是 make_hammer）。
设计图 art/hero/torg/weapon_concept.png：长柄的一头是一口青铜钟（钟口朝着柄），另一头是一个铁环；柄上有缠绳、铁箍、挂着的链子。

握持坐标：原点是右手握的位置，+Y 是杆身从拳眼伸出去的方向（钟在 +Y 一头，铁环在 -Y 一头）。单位和角色一样（身高为 1）。
两个材质：
  weapon_glow  钟口里的青光（一张小的放射渐变贴图，自发光）
  weapon       其余全部。一张程序画的贴图（512×1024），从下到上分成：绳子、铁、带铆钉的铁箍、木柄、青铜钟身、几块零碎的色块
材质的顺序是先 weapon_glow 后 weapon：游戏里把“离手最远的武器顶点”当锤头，后面的材质说了算，要让它落在钟顶上。
单独看效果：Blender -b --factory-startup -P art/hero/torg/gear_preview.py
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector

LEN = 1.15            # 总长（铁环底到钟顶的钮）
GRIP = 0.48           # 右手握在离铁环底多远的地方：木柄的正中略偏钟一点（左手在站姿里握 0.325 附近，两只手之间是那段粗缠绳）
SHAFT_R = 0.023       # 木柄的半径
MOUTH = 0.90          # 钟口所在的位置（离铁环底）
TW, TH = 512, 1024
# 贴图里每一块占哪几行（从下往上）
R_ROPE, R_IRON, R_BAND, R_WOOD, R_BRONZE, R_INNER, R_SWATCH = (0, 96), (96, 160), (160, 224), (224, 544), (544, 960), (960, 992), (992, 1024)
SW_CREAM, SW_STUD, SW_LIT, SW_LINK = 0, 1, 2, 3          # 零碎色块：藤壶的骨白、铆钉的亮铁、被青光照着的铁、链子
M_GLOW, M_MAIN = 0, 1
# 钟身外轮廓：(离钟口的距离, 半径, 贴图纵向 0..1)。三道细箍把钟身分成口沿、下腹、月相带、上腹、肩
BELL = [(0.004, 0.0985, 0.00), (0.000, 0.1070, 0.02), (0.006, 0.1150, 0.04), (0.031, 0.1150, 0.13), (0.036, 0.1045, 0.16),
        (0.043, 0.1030, 0.19), (0.047, 0.1068, 0.21), (0.052, 0.1018, 0.235), (0.084, 0.0965, 0.37), (0.088, 0.0997, 0.39),
        (0.093, 0.0952, 0.41), (0.128, 0.0893, 0.57), (0.132, 0.0925, 0.59), (0.137, 0.0878, 0.61), (0.196, 0.0780, 0.86),
        (0.206, 0.0690, 0.92), (0.210, 0.0330, 1.00)]
HOOPS = [(0.085, 0.045), (0.21, 0.012), (0.39, 0.012), (0.59, 0.012)]        # 贴图上箍的位置（纵向中心、半宽），给画贴图用
MOON_T = 0.49                                                             # 月相带的纵向中心
BARN = [(0.07, 0.30), (0.31, 0.74), (0.45, 0.29), (0.64, 0.73), (0.88, 0.31)]      # 藤壶长在哪几处（绕钟身一圈的位置 0..1、贴图纵向）


def _barnacles():
    """每一簇藤壶里各个的位置和大小：(横向 0..1, 纵向 0..1, 半径)。每簇头两个是立体的，其余只画在贴图上"""
    rng = np.random.default_rng(3); out = []
    for uc, tc in BARN:
        out.append([((uc + rng.normal(0, 0.022)) % 1.0, tc + rng.normal(0, 0.038), rng.uniform(0.013, 0.024)) for _ in range(6)])
    return out


# ------------------------------------------------------------------ 贴图
def _c(*v): return np.array(v, dtype=np.float32)
def _mix(a, b, t): return a * (1 - t[..., None]) + b * t[..., None]
def _ss(e0, e1, x): t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def _noise(rng, h, w, cv, cu):
    """柔和的噪声（0..1），横向首尾能接上（贴图横向是绕杆身一圈）"""
    g = rng.random((cv + 2, cu)).astype(np.float32); g = np.concatenate([g, g[:, :1]], 1)
    y = np.linspace(0, cv, h, endpoint=False); x = np.linspace(0, cu, w, endpoint=False)
    y0 = y.astype(int); x0 = x.astype(int); fy = (y - y0).astype(np.float32); fx = (x - x0).astype(np.float32)
    fy = (fy * fy * (3 - 2 * fy))[:, None]; fx = (fx * fx * (3 - 2 * fx))[None, :]
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def _fbm(rng, h, w, cv, cu, octaves=3):
    out = np.zeros((h, w), np.float32); amp = 1.0; tot = 0.0
    for o in range(octaves): out += amp * _noise(rng, h, w, cv * 2 ** o, cu * 2 ** o); tot += amp; amp *= 0.5
    return out / tot


def _grid(h, w):
    return np.linspace(0, 1, h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32), np.ones((h, 1), np.float32) * np.linspace(0, 1, w, endpoint=False, dtype=np.float32)[None, :]


def _blob(t, u, tc, uc, rt, ru):
    """到 (tc, uc) 的椭圆距离（1 是边缘），横向绕回"""
    du = np.abs(u - uc); du = np.minimum(du, 1 - du)
    return np.sqrt(((t - tc) / rt) ** 2 + (du / ru) ** 2)


def _paint_bronze(rng, h, w):
    t, u = _grid(h, w)
    n1 = _fbm(rng, h, w, 5, 6); n2 = _fbm(rng, h, w, 3, 4); n3 = _fbm(rng, h, w, 12, 16, 2); streak = _fbm(rng, h, w, 2, 26, 2)
    col = _mix(_c(0.19, 0.18, 0.15), _c(0.36, 0.32, 0.23), _ss(0.25, 0.75, n1))          # 发暗的青铜
    col = _mix(col, _c(0.47, 0.38, 0.22), _ss(0.60, 0.88, n3) * 0.55)                     # 磨出来的铜色
    # 铜绿：大块的斑，加上往下淌的痕迹；越靠钟口越多
    pat = _ss(0.50, 0.70, n2 * 0.62 + streak * 0.46 + (1 - t) * 0.10)
    col = _mix(col, _mix(_c(0.22, 0.39, 0.35), _c(0.33, 0.51, 0.45), n3), pat * 0.88)
    col = _mix(col, _c(0.36, 0.23, 0.15), _ss(0.70, 0.85, _fbm(rng, h, w, 9, 12, 2)) * 0.5)   # 一点锈
    # 口沿的厚箍：比钟身暗、偏铁色，上下两条棱磨亮
    rim = _ss(0.035, 0.045, t) * (1 - _ss(0.125, 0.135, t))
    col = _mix(col, _mix(_c(0.17, 0.18, 0.18), _c(0.30, 0.31, 0.29), n1), rim * 0.75)
    for tc, hw in HOOPS:
        d = np.abs(t - tc)
        col = _mix(col, _c(0.10, 0.11, 0.10), (_ss(hw + 0.022, hw + 0.004, d) - _ss(hw + 0.004, hw - 0.002, d)).clip(0, 1) * 0.6)   # 箍两边的凹缝发暗
        col = _mix(col, _c(0.20, 0.36, 0.32), _ss(hw + 0.03, hw + 0.006, d) * (1 - _ss(hw + 0.004, hw - 0.002, d)) * _ss(0.3, 0.7, n2) * 0.6)   # 缝里积的铜绿
        edge = _ss(0.006, 0.0, np.abs(d - hw * 0.8)) if hw > 0.02 else _ss(hw * 0.9, 0.0, d)
        col = _mix(col, _c(0.56, 0.50, 0.36), edge * 0.55)                                 # 箍的棱被磨亮
    # 月相带：正中一个满月，两边各两弯月牙，绕钟身三组
    rt, ru = 0.064, 0.0235
    for g in range(3):
        for k in (-2, -1, 0, 1, 2):
            uc = (g + 0.5) / 3 + k * 0.058; d = _blob(t, u, MOON_T, uc % 1.0, rt, ru)
            shape = _ss(1.0, 0.86, d)
            if k: shape = shape * _ss(0.80, 0.98, _blob(t, u, MOON_T, (uc - np.sign(k) * (0.7 if abs(k) == 1 else 0.4) * ru) % 1.0, rt, ru))   # 月牙：圆减去一个偏过去的圆
            if not k: col = _mix(col, _c(0.10, 0.11, 0.10), _ss(1.28, 1.02, d) * (1 - _ss(1.0, 0.86, d)) * 0.55)      # 满月外面一圈暗边
            col = _mix(col, _mix(_c(0.30, 0.50, 0.45), _c(0.40, 0.60, 0.54), n3), shape * 0.95)
            col = _mix(col, _c(0.55, 0.68, 0.60), shape * _ss(0.40, 0.95, (t - MOON_T) / rt) * 0.35)      # 上缘一点高光，像浮雕
    # 藤壶：几簇骨白的小圆点，中间一个黑洞
    for cluster in _barnacles():
        for u2, t2, r in cluster:
            d = _blob(t, u, t2, u2, r, r * 0.37)
            col = _mix(col, _mix(_c(0.46, 0.44, 0.36), _c(0.64, 0.61, 0.50), n3), _ss(1.0, 0.75, d)); col = _mix(col, _c(0.13, 0.12, 0.10), _ss(0.42, 0.25, d))
    col = col * (0.90 + 0.16 * t[..., None])                                              # 朝上的肩比钟口亮一点
    col = _mix(col, _c(0.50, 0.56, 0.48), _ss(0.84, 0.87, t) * (1 - _ss(0.91, 0.94, t)) * 0.45)   # 肩上的斜面
    return col


def _paint_wood(rng, h, w):
    t, u = _grid(h, w)
    grain = _fbm(rng, h, w, 2, 7, 4); g2 = _fbm(rng, h, w, 4, 46, 1); big = _fbm(rng, h, w, 5, 5, 2)      # 木纹：几道宽窄不一的长条，不是等距的细条纹
    col = _mix(_c(0.16, 0.13, 0.105), _c(0.33, 0.27, 0.20), _ss(0.25, 0.8, grain * 0.55 + big * 0.45))      # 泡过水的深色木头
    col = _mix(col, _c(0.08, 0.07, 0.06), _ss(0.22, 0.12, g2) * 0.65)                      # 几道竖着的裂纹
    col = _mix(col, _c(0.36, 0.36, 0.33), _ss(0.60, 0.85, _fbm(rng, h, w, 6, 4, 2)) * 0.4)      # 发灰的地方
    col = _mix(col, _c(0.17, 0.29, 0.26), _ss(0.66, 0.84, _fbm(rng, h, w, 4, 6, 2)) * 0.45)     # 沾上的铜绿
    strip = (_ss(0.03, 0.045, t) * (1 - _ss(0.275, 0.29, t)) + _ss(0.765, 0.78, t) * (1 - _ss(0.87, 0.885, t))).clip(0, 1)      # 铁条只钉在下半截和铁套下面那一小段
    for uc in (0.25, 0.75):                                                               # 两道竖着的铁条，一路铆钉
        du = np.abs(u - uc)
        col = _mix(col, _c(0.18, 0.31, 0.28), _ss(0.085, 0.045, du) * _ss(0.35, 0.7, big) * 0.6 * strip)      # 铁条两边渗出来的铜绿
        col = _mix(col, _mix(_c(0.20, 0.20, 0.21), _c(0.33, 0.32, 0.31), grain), _ss(0.046, 0.040, du) * strip)
        col = _mix(col, _c(0.07, 0.07, 0.07), _ss(0.052, 0.045, du) * (1 - _ss(0.044, 0.038, du)) * 0.8 * strip)
        for k in range(18):
            d = _blob(t, u, (k + 0.5) / 18, uc, 0.0075, 0.034)
            col = _mix(col, _c(0.08, 0.08, 0.08), _ss(1.5, 1.0, d) * 0.7 * strip); col = _mix(col, _c(0.43, 0.42, 0.39), _ss(1.0, 0.6, d) * strip)
    return col


def _paint_iron(rng, h, w, band):
    t, u = _grid(h, w)
    n1 = _fbm(rng, h, w, 2, 10); n2 = _fbm(rng, h, w, 3, 14, 2)
    col = _mix(_c(0.20, 0.20, 0.21), _c(0.36, 0.35, 0.34), _ss(0.2, 0.8, n1))
    col = _mix(col, _c(0.40, 0.26, 0.17), _ss(0.60, 0.80, n2) * 0.6)                       # 锈
    col = _mix(col, _c(0.20, 0.35, 0.32), _ss(0.66, 0.82, _fbm(rng, h, w, 2, 8, 2)) * 0.55)    # 铜绿
    if band:
        e = np.minimum(t, 1 - t)
        col = _mix(col, _c(0.55, 0.54, 0.50), _ss(0.16, 0.06, e) * 0.7)                    # 上下两条棱磨亮
        for k in range(8):
            d = _blob(t, u, 0.5, (k + 0.5) / 8, 0.17, 0.021)
            col = _mix(col, _c(0.08, 0.08, 0.08), _ss(1.5, 1.0, d) * 0.7); col = _mix(col, _c(0.56, 0.55, 0.50), _ss(1.0, 0.55, d))
    return col


def _paint_rope(rng, h, w, turns=4):
    t, u = _grid(h, w); tt = (t * turns) % 1.0
    strand = 0.5 + 0.5 * np.sin(2 * math.pi * (u * 22 + tt * 0.8)); n = _fbm(rng, h, w, 6, 30, 2)
    col = _mix(_c(0.21, 0.17, 0.12), _c(0.52, 0.44, 0.31), _ss(0.1, 0.9, strand) * 0.6 + n * 0.4)
    col = col * (0.50 + 0.55 * np.sin(math.pi * tt))[..., None]                            # 每一圈中间亮、圈和圈之间的缝暗
    col = _mix(col, _c(0.24, 0.34, 0.27), _ss(0.6, 0.85, _fbm(rng, h, w, 2, 6, 2)) * 0.4)       # 一点青苔
    return col


def _paint_inner(rng, h, w):
    t, u = _grid(h, w); n = _fbm(rng, h, w, 2, 12, 2)
    return _mix(_mix(_c(0.13, 0.14, 0.13), _c(0.24, 0.24, 0.20), n), _c(0.16, 0.62, 0.60), _ss(0.1, 1.0, t) * 0.8)


def _texture():
    img = bpy.data.images.get("weapon_torg")
    if img: return img
    rng = np.random.default_rng(7); px = np.zeros((TH, TW, 4), np.float32); px[..., 3] = 1
    for (r0, r1), fn in ((R_ROPE, _paint_rope), (R_IRON, lambda g, h, w: _paint_iron(g, h, w, False)), (R_BAND, lambda g, h, w: _paint_iron(g, h, w, True)),
                         (R_WOOD, _paint_wood), (R_BRONZE, _paint_bronze), (R_INNER, _paint_inner)):
        px[r0:r1, :, :3] = fn(rng, r1 - r0, TW)
    n = _fbm(rng, 32, TW, 2, 16, 2)[..., None]
    for i, (a, b) in enumerate(((_c(0.50, 0.47, 0.38), _c(0.70, 0.66, 0.54)), (_c(0.42, 0.41, 0.38), _c(0.58, 0.57, 0.52)), (_c(0.12, 0.30, 0.30), _c(0.16, 0.50, 0.49)), (_c(0.22, 0.22, 0.23), _c(0.40, 0.38, 0.35)))):
        x0 = i * TW // 4; x1 = (i + 1) * TW // 4; px[R_SWATCH[0]:R_SWATCH[1], x0:x1, :3] = a * (1 - n[:, x0:x1]) + b * n[:, x0:x1]
    img = bpy.data.images.new("weapon_torg", TW, TH, alpha=False); img.pixels.foreach_set(np.clip(px, 0, 1).ravel()); img.file_format = "PNG"; img.pack()
    return img


def _glow_texture():
    img = bpy.data.images.get("weapon_torg_glow")
    if img: return img
    n = 64; y, x = np.mgrid[0:n, 0:n].astype(np.float32); r = np.clip(np.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2), 0, 1)
    px = np.ones((n, n, 4), np.float32); px[..., :3] = _mix(_mix(_c(0.82, 1.0, 0.97), _c(0.22, 0.95, 0.90), _ss(0.0, 0.55, r)), _c(0.06, 0.55, 0.58), _ss(0.55, 1.0, r))
    img = bpy.data.images.new("weapon_torg_glow", n, n, alpha=False); img.pixels.foreach_set(px.ravel()); img.file_format = "PNG"; img.pack()
    return img


def _material(name, img, glow=False):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img
    m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.72; b.inputs["Metallic"].default_value = 0.0
    if glow:
        # 只给一点自发光：游戏里的着色器本来就会让贴图里的青色自己亮（和头盔的舷窗一个亮法），这里再给满就过曝了；留 0.4 是让钟口朝下背光时也看得见
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = 0.4
    return m


# ------------------------------------------------------------------ 网格
def _vv(reg, t, pad=2.5): return (reg[0] + pad + (reg[1] - reg[0] - 2 * pad) * t) / TH
def _sw(i, fu=0.5, fv=0.5): return ((i + 0.15 + 0.7 * fu) / 4, _vv(R_SWATCH, fv, 6))


class _B:
    """边建边记贴图坐标；每个面都按“背离哪个点”定正反面，不靠事后猜"""
    def __init__(self): self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.verify()

    def face(self, verts, uvs, away=None, mat=M_MAIN, flip=False, normal=None):
        """建一个面。正反面：给 normal 就朝着它；否则背离 away 这个点"""
        c = sum((v.co for v in verts), Vector()) / len(verts)
        n = Vector(); k = len(verts)
        for i in range(k): n += verts[i].co.cross(verts[(i + 1) % k].co)
        want = normal if normal is not None else c - away
        if (n.dot(want) < 0) != flip: verts = verts[::-1]; uvs = uvs[::-1]
        try: f = self.bm.faces.new(verts)
        except ValueError: return None
        f.material_index = mat; f.smooth = True; m = dict(zip(verts, uvs))
        for l in f.loops: l[self.uv].uv = m[l.vert]
        return f

    def lathe(self, prof, seg, reg, urep=1.0, u0=0.0, a0=0.0, flip=False, mat=M_MAIN, sharp=None):
        """绕 Y 轴转一圈。prof: [(y, 半径, 贴图纵向 0..1)]。返回首尾两圈顶点。sharp 给角度（度）时，比它尖的棱不做平滑"""
        rings = [[self.bm.verts.new((r * math.cos(a0 + 2 * math.pi * i / seg), y, r * math.sin(a0 + 2 * math.pi * i / seg))) for i in range(seg)] for y, r, _ in prof]
        faces = []
        for k in range(len(prof) - 1):
            dy = prof[k + 1][0] - prof[k][0]; dr = prof[k + 1][1] - prof[k][1]; v0 = _vv(reg, prof[k][2]); v1 = _vv(reg, prof[k + 1][2])
            for i in range(seg):
                j = (i + 1) % seg; ua = u0 + urep * i / seg; ub = u0 + urep * (i + 1) / seg; am = a0 + 2 * math.pi * (i + 0.5) / seg
                want = Vector((math.cos(am) * dy, -dr, math.sin(am) * dy))
                faces.append(self.face([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], [(ua, v0), (ub, v0), (ub, v1), (ua, v1)], None, mat, flip, want))
        if sharp: self.sharpen(faces, sharp)
        return rings[0], rings[-1]

    def cap(self, ring, toward, uvc, uvr=0.02):
        """用一个多边形把一圈封上，面朝 toward 那个点的反方向（也就是背离它）"""
        k = len(ring); uvs = [(uvc[0] + uvr * math.cos(2 * math.pi * i / k), uvc[1] + uvr * 0.5 * math.sin(2 * math.pi * i / k)) for i in range(k)]
        return self.face(list(ring), uvs, toward)

    def sharpen(self, faces, deg):
        fs = {f for f in faces if f}
        for e in {e for f in fs for e in f.edges}:
            if len(e.link_faces) == 2 and all(f in fs for f in e.link_faces) and e.calc_face_angle(0) > math.radians(deg): e.smooth = False

    def torus(self, center, ax_a, ax_b, R, rho, seg, sec, reg, wobble=None, urep=1.0, u0=0.0):
        """圆环：中心线在 ax_a、ax_b 张成的平面里"""
        n = ax_a.cross(ax_b).normalized(); rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg; out = ax_a * math.cos(a) + ax_b * math.sin(a); k = wobble[i] if wobble else 1.0; c = center + out * R
            rings.append((c, [self.bm.verts.new(c + (out * math.cos(2 * math.pi * j / sec) + n * math.sin(2 * math.pi * j / sec)) * rho * k) for j in range(sec)]))
        for i in range(seg):
            c0, r0 = rings[i]; c1, r1 = rings[(i + 1) % seg]; ua = u0 + urep * i / seg; ub = u0 + urep * (i + 1) / seg
            for j in range(sec):
                j2 = (j + 1) % sec; va = _vv(reg, j / sec); vb = _vv(reg, (j + 1) / sec)
                self.face([r0[j], r1[j], r1[j2], r0[j2]], [(ua, va), (ub, va), (ub, vb), (ua, vb)], (c0 + c1) / 2)

    def link(self, c, a, b, hl=0.018, hw=0.0105, th=0.0046, u0=0.0):
        """一节链环：长轴 a、宽轴 b（都是单位向量），八个点围成的长圆环，截面是三角形"""
        n = a.cross(b).normalized(); k = hl - hw; rings = []
        for e in (1, -1):
            for q in ((67.5, 22.5, -22.5, -67.5) if e > 0 else (-67.5, -22.5, 22.5, 67.5)):
                cq = math.cos(math.radians(q)); sq = math.sin(math.radians(q)); p = c + a * (e * (k + hw * cq)) + b * (hw * sq); o = a * (e * cq) + b * sq
                rings.append((p, [self.bm.verts.new(p + (o * math.cos(w) + n * math.sin(w)) * th) for w in (0, 2.094, 4.189)]))
        for i in range(8):
            p0, r0 = rings[i]; p1, r1 = rings[(i + 1) % 8]; ua = u0 + 0.025 * i; ub = ua + 0.025
            for j in range(3):
                j2 = (j + 1) % 3; va = _vv(R_IRON, 0.15 + 0.7 * j / 3); vb = _vv(R_IRON, 0.15 + 0.7 * (j + 1) / 3)
                self.face([r0[j], r1[j], r1[j2], r0[j2]], [(ua, va), (ub, va), (ub, vb), (ua, vb)], (p0 + p1) / 2)

    def chain(self, pts, twist=0.0, closed=False, **kw):
        """沿一串点摆链环：相邻两节互相垂直地套着。closed 是首尾相接的一圈"""
        m = len(pts)
        for i, p in enumerate(pts):
            a = ((pts[(i + 1) % m] - pts[(i - 1) % m]) if closed else (pts[min(i + 1, m - 1)] - pts[max(i - 1, 0)])).normalized()
            ref = Vector((0, 1, 0)) if abs(a.y) < 0.9 else Vector((1, 0, 0)); b = a.cross(ref).normalized()
            if i % 2: b = a.cross(b).normalized()
            if twist: b = (b * math.cos(twist) + a.cross(b) * math.sin(twist)).normalized()
            self.link(p, a, b, u0=(i * 0.137) % 0.8, **kw)

    def stud(self, base, out, size, hgt):
        """铆钉：四棱锥，底在 base，尖朝 out"""
        t1 = out.cross(Vector((0, 1, 0))).normalized(); t2 = out.cross(t1).normalized()
        q = [self.bm.verts.new(base + (t1 * sx + t2 * sy) * size) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]; tip = self.bm.verts.new(base + out * hgt)
        fs = [self.face([q[i], q[(i + 1) % 4], tip], [_sw(SW_STUD, 0.1, 0.2), _sw(SW_STUD, 0.9, 0.2), _sw(SW_STUD, 0.5, 0.9)], base - out * 0.01) for i in range(4)]
        self.sharpen(fs, 20)

    def barnacle(self, base, out, r, hgt):
        """藤壶：一个矮的五边台，顶上一个黑洞（顶面指到链子那块暗色上）"""
        t1 = out.cross(Vector((0, 1, 0))).normalized(); t2 = out.cross(t1).normalized(); lo = []; hi = []
        for i in range(5):
            a = 2 * math.pi * i / 5; d = t1 * math.cos(a) + t2 * math.sin(a); lo.append(self.bm.verts.new(base + d * r - out * 0.002)); hi.append(self.bm.verts.new(base + d * r * 0.5 + out * hgt))
        for i in range(5):
            j = (i + 1) % 5; self.face([lo[i], lo[j], hi[j], hi[i]], [_sw(SW_CREAM, 0.1, 0.1), _sw(SW_CREAM, 0.9, 0.1), _sw(SW_CREAM, 0.7, 0.9), _sw(SW_CREAM, 0.3, 0.9)], base - out * 0.01)
        self.face(hi, [(0.05 + 0.01 * i, _vv(R_IRON, 0.1)) for i in range(5)], base - out * 0.01)


def make_hammer():
    B = _B(); Y = lambda s: s - GRIP                      # s 是离铁环底的距离，握的位置挪到原点
    ax = lambda s: Vector((0, Y(s), 0))
    rng = np.random.default_rng(11)

    # ---- 柄尾的铁环（环面朝 ±X，从握着的手背一侧看是个圆）和环座 ----
    B.torus(ax(0.0415), Vector((0, 1, 0)), Vector((0, 0, 1)), 0.032, 0.0095, 12, 5, R_IRON, wobble=[float(x) for x in rng.uniform(0.86, 1.14, 12)], urep=0.9)
    a, b = B.lathe([(Y(0.066), 0.012, 0.0), (Y(0.074), 0.0255, 0.25), (Y(0.118), 0.0300, 0.75), (Y(0.126), 0.0265, 1.0)], 8, R_IRON, a0=math.pi / 8, urep=0.6, u0=0.2, sharp=28)
    B.cap(a, ax(0.2), (0.5, _vv(R_IRON, 0.5)))
    for sgn in (1, -1): B.stud(Vector((0, Y(0.096), sgn * 0.0275)), Vector((0, 0, sgn)), 0.009, 0.009)      # 环座两面各一颗方钉
    # ---- 木柄：从环座一直插进钟里。略微不直、粗细有一点变化 ----
    B.lathe([(Y(s), SHAFT_R * k, (s - 0.12) / 0.74) for s, k in ((0.12, 0.97), (0.30, 1.0), (0.50, 0.985), (0.68, 1.03), (0.86, 1.04))], 10, R_WOOD)
    # ---- 两道带铆钉的铁箍 ----
    for s0, s1, r in ((0.126, 0.158, 0.0272), (0.200, 0.232, 0.0265)):
        B.lathe([(Y(s0), SHAFT_R * 0.99, 0.0), (Y(s0 + 0.003), r, 0.08), (Y(s1 - 0.003), r, 0.92), (Y(s1), SHAFT_R * 0.99, 1.0)], 10, R_BAND, sharp=35)
    # ---- 粗的缠绳，六圈，正好在两只手之间（右手握在它上面、左手握在它下面）；再往上两道细绳 ----
    turns = 6
    # 每一圈各自从贴图里一圈的缝开始，所以逐圈建
    for k in range(turns):
        s0 = 0.355 + k * 0.012; t0 = (k % 4) / 4
        B.lathe([(Y(s0), 0.0240 if k else SHAFT_R * 0.99, t0 + 0.004), (Y(s0 + 0.006), 0.0292, t0 + 0.125), (Y(s0 + 0.012), 0.0240 if k < turns - 1 else SHAFT_R * 0.99, t0 + 0.246)], 10, R_ROPE, u0=0.13 * k)
    for s0 in (0.652, 0.668):
        B.lathe([(Y(s0), SHAFT_R, 0.004), (Y(s0 + 0.0045), 0.0262, 0.125), (Y(s0 + 0.009), SHAFT_R, 0.246)], 10, R_ROPE, u0=s0)
    # ---- 柄和钟之间的铁套（带两块铆着的方铁片），上面是插进钟里的鼓形座 ----
    B.lathe([(Y(0.762), SHAFT_R, 0.0), (Y(0.766), 0.0318, 0.08), (Y(0.812), 0.0318, 0.92), (Y(0.816), SHAFT_R * 1.03, 1.0)], 10, R_BAND, sharp=35)
    for sgn in (1, -1):
        c = Vector((sgn * 0.0318, Y(0.789), 0)); o = Vector((sgn, 0, 0)); q = []
        for dy, dz in ((-0.017, -0.012), (0.017, -0.012), (0.017, 0.012), (-0.017, 0.012)): q.append((B.bm.verts.new(c + Vector((0, dy, dz))), B.bm.verts.new(c + Vector((0, dy * 0.85, dz * 0.85)) + o * 0.006)))
        fs = [B.face([q[i][0], q[(i + 1) % 4][0], q[(i + 1) % 4][1], q[i][1]], [_sw(SW_STUD, 0, 0), _sw(SW_STUD, 1, 0), _sw(SW_STUD, 1, 0.5), _sw(SW_STUD, 0, 0.5)], c - o * 0.01) for i in range(4)]
        fs.append(B.face([p[1] for p in q], [(0.27, _vv(R_BAND, 0.2)), (0.48, _vv(R_BAND, 0.2)), (0.48, _vv(R_BAND, 0.8)), (0.27, _vv(R_BAND, 0.8))], c - o * 0.01)); B.sharpen(fs, 30)
    B.lathe([(Y(0.812), 0.0275, 0.1), (Y(0.850), 0.0275, 0.9)], 10, R_IRON, urep=0.7)
    B.lathe([(Y(0.846), SHAFT_R * 1.03, 0.0), (Y(0.852), 0.0385, 0.12), (Y(0.866), 0.0425, 0.5), (Y(0.882), 0.0405, 0.88), (Y(0.890), 0.0300, 1.0)], 10, R_BAND, sharp=40)
    # ---- 钟：口朝着柄。钟身（青铜）、钟顶的钮、口沿上一圈铆钉、几只藤壶 ----
    SEG = 20
    lo, hi = B.lathe([(Y(MOUTH + y), r, t) for y, r, t in BELL], SEG, R_BRONZE, sharp=50)
    top = MOUTH + BELL[-1][0]
    a, b = B.lathe([(Y(top - 0.002), 0.0345, 0.0), (Y(top + 0.007), 0.0345, 0.2), (Y(top + 0.011), 0.0215, 0.3), (Y(top + 0.020), 0.0200, 0.5), (Y(top + 0.024), 0.0300, 0.6), (Y(top + 0.032), 0.0300, 0.85), (Y(top + 0.036), 0.0190, 1.0)], 10, R_BAND, sharp=40)
    B.cap(b, ax(0.5), (0.5, _vv(R_IRON, 0.5)))
    for k in range(10):
        a_ = 2 * math.pi * (k + 0.5) / 10; o = Vector((math.cos(a_), 0, math.sin(a_))); B.stud(o * 0.1150 + ax(MOUTH + 0.0185), o, 0.0075, 0.0085)
    for cluster in _barnacles():
        for u2, t2, r in cluster[:2]:
            k = max(i for i in range(len(BELL) - 1) if BELL[i][2] <= t2); f = (t2 - BELL[k][2]) / (BELL[k + 1][2] - BELL[k][2])
            y = BELL[k][0] + (BELL[k + 1][0] - BELL[k][0]) * f; rr = BELL[k][1] + (BELL[k + 1][1] - BELL[k][1]) * f; a_ = 2 * math.pi * u2
            o = Vector((math.cos(a_), 0, math.sin(a_))); B.barnacle(o * rr + ax(MOUTH + y), (o + Vector((0, 0.18, 0))).normalized(), r * 0.30, r * 0.20)
    # ---- 钟口里的青光：从口沿内侧收到鼓形座上的一圈斜面，侧面看是口沿下面露出来的一道光 ----
    g_out = [B.bm.verts.new((0.0990 * math.cos(2 * math.pi * i / SEG), Y(MOUTH + 0.005), 0.0990 * math.sin(2 * math.pi * i / SEG))) for i in range(SEG)]
    g_mid = [B.bm.verts.new((0.0700 * math.cos(2 * math.pi * i / SEG), Y(MOUTH - 0.020), 0.0700 * math.sin(2 * math.pi * i / SEG))) for i in range(SEG)]
    g_in = [B.bm.verts.new((0.0380 * math.cos(2 * math.pi * i / SEG), Y(MOUTH - 0.026), 0.0380 * math.sin(2 * math.pi * i / SEG))) for i in range(SEG)]
    guv = lambda i, rad: (0.5 + 0.5 * rad * math.cos(2 * math.pi * i / SEG), 0.5 + 0.5 * rad * math.sin(2 * math.pi * i / SEG))
    for ra, rb, fa, fb in ((g_out, g_mid, 0.96, 0.55), (g_mid, g_in, 0.55, 0.12)):
        for i in range(SEG):
            j = (i + 1) % SEG; B.face([ra[i], ra[j], rb[j], rb[i]], [guv(i, fa), guv(j, fa), guv(j, fb), guv(i, fb)], ax(MOUTH + 0.2), M_GLOW)
    # ---- 链子：绕在钟下面的脖子上一圈（斜着挂），两段从钟口垂下来；柄上再挂一段 ----
    N = 10; Rn = 0.0445; tilt = math.radians(14)
    B.chain([Vector((Rn * math.cos(2 * math.pi * i / N), Y(0.830) + math.sin(tilt) * Rn * math.cos(2 * math.pi * i / N + 0.6), Rn * math.sin(2 * math.pi * i / N))) for i in range(N)], closed=True, hl=0.0175)
    for a_ in (1.15, 4.2):
        o = Vector((math.cos(a_), 0, math.sin(a_)))
        B.chain([o * (0.088 - 0.012 * i) + ax(MOUTH - 0.004 - 0.021 * i) for i in range(3)], hl=0.0165, hw=0.0095, th=0.0042)
    o = Vector((0.5, 0, -0.866)).normalized()
    B.chain([o * (SHAFT_R + 0.013 + 0.004 * math.sin(i * 1.3)) + ax(0.700 - 0.026 * i) + o.cross(Vector((0, 1, 0))) * 0.004 * math.sin(i * 2.1) for i in range(4)], hl=0.0170, hw=0.0098, th=0.0043)
    B.stud(o * SHAFT_R + ax(0.714), o, 0.008, 0.012)                                      # 挂链子的钉

    bm = B.bm; bm.normal_update()
    me = bpy.data.meshes.new("torg_hammer"); bm.to_mesh(me); bm.free(); me.uv_layers[0].name = "UVMap"      # 和身体的贴图坐标层同名，合并网格时才会并到同一层
    me.materials.append(_material("weapon_glow", _glow_texture(), True)); me.materials.append(_material("weapon", _texture()))
    me.update(); return me
