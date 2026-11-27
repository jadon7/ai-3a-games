"""赫达 · 缚钳 B 风格（路子一 卡通厚涂）的两件硬东西，都用代码建：

换画风 B（w-gh）怎么做的：**形状照第九轮（art/hero/hedda/gear.py），贴图按 B 重画**。
  · 对过 B 的设定图（art/style_b/concept/hedda-p1-sheet-v2.png 正面、hedda-p1-back.png 背面）：圆筒炉身、几道铁箍和铆钉、背面竖铁条、
    右后腰一扇透火光的小炉门、左上方斜伸出去的方烟囱——和第九轮脚本建的炉子是同一个东西，大小也一样（量过：炉底在身高 0.53、炉顶 0.91、半径约 0.13）。
    所以形状不重做，只把烟囱加粗一点（B 的烟囱更粗壮）。
  · 火钳设定图里没画（空手），形状照第九轮：两根并拢的方柄、皮缠带、圆铆钉、一对鼓出去的钳爪。它本来就是“几根杆子加一对爪”，没有尖刺镂空。
    更要紧的是第九轮的动作（fix_tongs.py）是按这把钳子的握点、长度、朝向修过的，钳钩（Q）也从钳口飞出去——形状不变，这些都不用重调。
  · 贴图全部换成 B 的：旧版的铁板接缝、煤灰、锈、划痕全去掉，只留大块的冷暖明暗；箍的外沿一道干净的亮边；钳口前端烧成饱和的橙红（自发光）。
  · 颜色照 B 设定图量的炉子（中间 61,64,80、暗 42,42,56、亮边 130,140,165）乘 0.85：游戏里 B 的着色提亮 1.4，Tripo 出的身体贴图也比设定图暗两成，
    炉子要和身体一个亮度。皮带、皮缠带照设定图的焦褐（围裙 92,58,44）。
  · 材质名：火钳 weapon_b、weapon_hot_b（以 weapon 开头，游戏靠它认武器、钳钩飞出去时把它藏起来）；炉子 forge_b、forge_fire_b
    （不以 weapon 开头：游戏会把 weapon 材质当武器找刀尖）。都以 _b 结尾，走 hero/hero.ts 里 B 的着色。

  make_tongs  长柄火钳。给 tools/blender/hero_build.py 的 rig 一步用（build.json 的 gear 里 type 是 script）。
              握持坐标：原点是右手握的位置，+Y 是钳口那一端，X 是钳口张开的方向，Z 是厚度。总长 1.25（身高是 1），
              握点在离柄尾 0.37 的地方（柄尾在 Y=-0.4625，钳口尖在 Y=+0.7875）。
  make_forge  背上的熔炉和烟囱。给 art/style_b/hedda/add_forge.py 用（它把炉子摆到背上、合进身体的网格、只蒙在 Spine2 上）。
              炉子自己的坐标：Z 朝上（炉底在 Z=0），+Y 朝背后（Y=0 是贴着后背的那一面），+X 是角色的左手边。单位是身高 1。
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix

TEX = 1024; PAD = 6
REG = {"iron": (0, 256, 640, 1024), "edge": (640, 768, 1024, 1024), "dark": (640, 512, 1024, 768),
       "wrap": (0, 0, 320, 256), "strap": (320, 0, 640, 256), "rivet": (640, 256, 1024, 512), "spare": (640, 0, 1024, 256)}      # 像素范围 (x0, y0, x1, y1)，第 0 行在最下面
IRON, EDGE, DARK, WRAP, STRAP, RIVET, HOT, FIRE = range(8)
REG_OF = {IRON: "iron", EDGE: "edge", DARK: "dark", WRAP: "wrap", STRAP: "strap", RIVET: "rivet"}
S_TEX = 780.0            # 一个单位长度对应多少像素


# ============================== 贴图 ==============================
def _vnoise(h, w, cell, rng):
    g = rng.random((h // cell + 3, w // cell + 3)).astype(np.float32)
    ys = np.arange(h) / cell; xs = np.arange(w) / cell; y0 = ys.astype(int); x0 = xs.astype(int)
    fy = ys - y0; fx = xs - x0; fy = (fy * fy * (3 - 2 * fy))[:, None]; fx = (fx * fx * (3 - 2 * fx))[None, :]
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
def _fbm(h, w, cells, amps, rng, gain=2.0):
    out = sum(a * _vnoise(h, w, c, rng) for c, a in zip(cells, amps)) / sum(amps)
    return np.clip((out - 0.5) * gain + 0.5, 0, 1)
def _ss(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def _mix(a, b, t): return a * (1 - t[..., None]) + np.asarray(b, np.float32) * t[..., None]
def _flat(h, w, c): return np.broadcast_to(np.asarray(c, np.float32), (h, w, 3)).copy()


def _atlas():
    """B：每一块都是干净的大块颜色（手绘、低频），没有旧版的接缝、煤灰、锈、划痕"""
    rng = np.random.default_rng(8); img = np.zeros((TEX, TEX, 3), np.float32)
    def blk(nm): x0, y0, x1, y1 = REG[nm]; return y1 - y0, x1 - x0, (slice(y0, y1), slice(x0, x1))
    # 铁：深蓝灰，几块很大、很淡的明暗（炉身的 v 是高度：上面略亮、下面略暗，像顶光）
    h, w, sl = blk("iron"); n = _fbm(h, w, (200, 90), (0.6, 0.4), rng, 1.4); yy = np.mgrid[0:h, 0:w][0].astype(np.float32) / h
    img[sl] = _mix(_flat(h, w, (0.17, 0.18, 0.235)), (0.25, 0.27, 0.34), np.clip(0.3 + 0.35 * (n - 0.5) + 0.3 * (yy - 0.5), 0, 1))
    # 箍的外沿、钳子的棱：一道干净的亮边（王者式金属的高光带）
    h, w, sl = blk("edge"); n = _fbm(h, w, (40, 16), (0.6, 0.4), rng, 1.3)
    img[sl] = _mix(_flat(h, w, (0.27, 0.3, 0.38)), (0.33, 0.36, 0.45), n)      # 第一版 0.38–0.62 进游戏铁箍一圈圈发白，炉子像一只箍了白圈的铝桶（第九轮也栽在这），压到比炉身亮一档就够
    # 暗处（缝、内壁、炉盖里面）：深蓝灰，不是黑
    h, w, sl = blk("dark"); n = _fbm(h, w, (40, 16), (0.6, 0.4), rng, 1.3)
    img[sl] = _mix(_flat(h, w, (0.09, 0.095, 0.13)), (0.12, 0.125, 0.165), n)
    # 铆钉：锥尖对着这一块的正中，尖上亮、往外暗
    h, w, sl = blk("rivet"); yy, xx = np.mgrid[0:h, 0:w]; d = np.hypot(xx - w / 2 + 8, yy - h / 2 - 8) / (min(w, h) / 2)
    img[sl] = _mix(_flat(h, w, (0.42, 0.46, 0.55)), (0.13, 0.14, 0.19), _ss(0.05, 0.85, d))
    # 皮缠带：焦褐，一圈圈斜着缠，每圈靠上的边亮一线、圈和圈之间一道暗缝
    h, w, sl = blk("wrap"); yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); band = 34.0; ph = ((yy + xx * 0.45) % band) / band
    col = _mix(_flat(h, w, (0.3, 0.19, 0.14)), (0.44, 0.29, 0.2), _ss(0.45, 0.85, ph) * (1 - _ss(0.88, 0.96, ph)))
    img[sl] = _mix(col, (0.16, 0.1, 0.08), _ss(0.92, 1.0, ph) * 0.9 + (1 - _ss(0.0, 0.06, ph)) * 0.5)
    # 皮带：焦褐，中间略亮、两边略暗，两道浅色缝线
    h, w, sl = blk("strap"); yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); v = yy / h
    col = _flat(h, w, (0.3, 0.19, 0.14)) * (0.75 + 0.3 * np.sin(np.pi * v))[..., None]
    stitch = ((np.abs(v - 0.12) < 0.012) | (np.abs(v - 0.88) < 0.012)) & ((xx % 14) < 8); col[stitch] = col[stitch] * 0.4 + np.array((0.5, 0.38, 0.28)) * 0.6
    img[sl] = col
    h, w, sl = blk("spare"); img[sl] = 0.15
    return np.clip(img, 0, 1)


def _hot_tex(n=64):
    """钳口：根部是铁色，往前烧成饱和的橙红（v 从 0 到 1）。带自发光，B 的亮地面上要看得出“烧红了”"""
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / (n - 1)
    col = _mix(_flat(n, n, (0.2, 0.19, 0.24)), (0.62, 0.16, 0.07), _ss(0.08, 0.6, yy))
    return np.clip(_mix(col, (0.98, 0.45, 0.12), _ss(0.6, 1.0, yy) * 0.9), 0, 1)


def _fire_tex(n=64):
    """炉门里的火：下面亮金，往上变橙、变红（炉心金 #FFC864），中间偏下一团最亮。不加杂点"""
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / (n - 1)
    col = _mix(_flat(n, n, (1.0, 0.8, 0.4)), (1.0, 0.5, 0.13), _ss(0.15, 0.6, yy))
    col = _mix(col, (0.85, 0.25, 0.06), _ss(0.62, 1.0, yy))
    return np.clip(_mix(col, (1.0, 0.93, 0.62), (1 - _ss(0.0, 0.42, np.hypot(xx - 0.5, yy - 0.35))) * 0.5), 0, 1)


def _image(name, arr):
    if name in bpy.data.images: return bpy.data.images[name]
    h, w = arr.shape[:2]; img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(np.concatenate([arr, np.ones((h, w, 1), np.float32)], axis=2).ravel()); img.file_format = "PNG"; img.pack(); return img


def _mat(name, img, rough, metal, emit=0.0):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"); t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img
    m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if emit > 0:
        ems = b.inputs.get("Emission Color") or b.inputs.get("Emission"); m.node_tree.links.new(t.outputs["Color"], ems)
        if b.inputs.get("Emission Strength"): b.inputs["Emission Strength"].default_value = emit
    return m


def materials(kind):
    atlas = _image("hedda_iron_b", _atlas())
    if kind == "tongs": return [_mat("weapon_b", atlas, 0.55, 0.8), _mat("weapon_hot_b", _image("hedda_hot_b", _hot_tex()), 0.6, 0.3, 0.5)]
    return [_mat("forge_b", atlas, 0.6, 0.8), _mat("forge_fire_b", _image("hedda_fire_b", _fire_tex()), 0.7, 0.0, 1.0)]


# ============================== 搭建的小工具 ==============================
class Build:
    """每个面记：用哪块贴图（cat）、贴图坐标是不是已经定好（done）"""
    def __init__(self):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.verify()
        self.cat = self.bm.faces.layers.int.new("cat"); self.done = self.bm.faces.layers.int.new("done")
        self.r = np.random.default_rng(1)

    def face(self, vs, cat, out=None, uvs=None):
        """out：一个点，面要背对它（法线朝外）。uvs：每个顶点在这一块贴图里的位置（0..1），不给就最后统一投"""
        f = self.bm.faces.new(vs); f[self.cat] = cat; f.normal_update()
        if out is not None and f.normal.dot(f.calc_center_median() - Vector(out)) < 0:
            f.normal_flip(); f.normal_update()
            if uvs is not None: uvs = [uvs[0]] + uvs[1:][::-1]
        if uvs is not None: self.set_uv(f, uvs, cat)
        return f

    def set_uv(self, f, uvs, cat):
        if cat in (HOT, FIRE):
            for l, (u, v) in zip(f.loops, uvs): l[self.uv].uv = (0.02 + 0.96 * u, 0.02 + 0.96 * v)
        else:
            x0, y0, x1, y1 = REG[REG_OF[cat]]
            for l, (u, v) in zip(f.loops, uvs): l[self.uv].uv = ((x0 + PAD + u * (x1 - x0 - 2 * PAD)) / TEX, (y0 + PAD + v * (y1 - y0 - 2 * PAD)) / TEX)
        f[self.done] = 1

    def tube(self, rings, cats, centers=None, cap0=None, cap1=None, closed=True, vlen=None, u_rep=1.0):
        """一串截面（每个截面是一圈点，点数相同）连成管子。cats：每一段用哪块贴图（一个数就全用它）。
        贴图：u 绕一圈（u_rep 圈重复几次），v 顺着管子按长度走（vlen 给了就把整条管子拉满这一块）。cap0、cap1：两头封口用哪块贴图"""
        R = [[self.bm.verts.new(Vector(p)) for p in ring] for ring in rings]; n = len(rings[0])
        C = [Vector(c) for c in centers] if centers else [sum((Vector(p) for p in ring), Vector()) / n for ring in rings]
        acc = [0.0]
        for k in range(1, len(C)): acc.append(acc[-1] + (C[k] - C[k - 1]).length)
        tot = acc[-1] or 1.0; faces = []
        for k in range(len(R) - 1):
            ct = cats if isinstance(cats, int) else cats[k]
            for i in range(n if closed else n - 1):
                j = (i + 1) % n
                if ct in (HOT, FIRE): v0, v1 = acc[k] / tot, acc[k + 1] / tot
                else:
                    x0, y0, x1, y1 = REG[REG_OF[ct]]; hpx = y1 - y0 - 2 * PAD
                    if vlen: v0, v1 = acc[k] / tot, acc[k + 1] / tot
                    else:
                        base = self.r.random() * 0.3 if k == 0 else 0
                        v0 = min(acc[k] * S_TEX / hpx, 1.0); v1 = min(acc[k + 1] * S_TEX / hpx, 1.0)
                u0, u1 = i / n * u_rep, (i + 1) / n * u_rep; u0 -= math.floor(u0) if u_rep > 1 else 0; u1 = u0 + u_rep / n if u_rep > 1 else u1
                u0, u1 = min(u0, 1.0), min(u1, 1.0)
                cen = (C[k] + C[k + 1]) / 2
                faces.append(self.face([R[k][i], R[k][j], R[k + 1][j], R[k + 1][i]], ct, out=cen, uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)]))
        for ring, c, ct, other in ((R[0], C[0], cap0, C[min(1, len(C) - 1)]), (R[-1], C[-1], cap1, C[max(len(C) - 2, 0)])):
            if ct is not None: faces.append(self.face(list(ring), ct, out=other))
        return faces

    def box(self, lo, hi, cat, M=None):
        lo = Vector(lo); hi = Vector(hi); c = (lo + hi) / 2
        P = lambda x, y, z: (M @ Vector((x, y, z))) if M else Vector((x, y, z))
        r0 = [P(lo.x, lo.y, lo.z), P(hi.x, lo.y, lo.z), P(hi.x, lo.y, hi.z), P(lo.x, lo.y, hi.z)]
        r1 = [P(lo.x, hi.y, lo.z), P(hi.x, hi.y, lo.z), P(hi.x, hi.y, hi.z), P(lo.x, hi.y, hi.z)]
        cen = P(*c); return self.tube([r0, r1], cat, centers=[P(c.x, lo.y, c.z), P(c.x, hi.y, c.z)], cap0=cat, cap1=cat)

    def rivet(self, at, nrm, r=0.0055, h=0.004, seg=5):
        n = Vector(nrm).normalized(); t = n.orthogonal().normalized(); b = n.cross(t); at = Vector(at) - n * 0.001
        tip = self.bm.verts.new(at + n * h); ring = [self.bm.verts.new(at + (t * math.cos(2 * math.pi * i / seg) + b * math.sin(2 * math.pi * i / seg)) * r) for i in range(seg)]
        for i in range(seg):
            j = (i + 1) % seg; a0 = 2 * math.pi * i / seg; a1 = 2 * math.pi * j / seg
            self.face([ring[i], ring[j], tip], RIVET, out=at - n * h, uvs=[(0.5 + 0.45 * math.cos(a0), 0.5 + 0.45 * math.sin(a0)), (0.5 + 0.45 * math.cos(a1), 0.5 + 0.45 * math.sin(a1)), (0.5, 0.5)])

    def finish(self, name, kind):
        bm = self.bm; bm.normal_update()
        for f in bm.faces:                                       # 没定贴图坐标的面（封口、盒子）：按法线最大的那个轴平着投到自己那一块上，随便挪个位置
            if f[self.done]: continue
            c = f[self.cat]; ax = max(range(3), key=lambda i: abs(f.normal[i])); a, b = [i for i in range(3) if i != ax]
            p = [(l.vert.co[a], l.vert.co[b]) for l in f.loops]; u0 = min(q[0] for q in p); v0 = min(q[1] for q in p)
            if c in (HOT, FIRE): uvs = [(0.5, 0.9)] * len(p)
            else:
                x0, y0, x1, y1 = REG[REG_OF[c]]; W = x1 - x0 - 2 * PAD; H = y1 - y0 - 2 * PAD
                du = max(q[0] for q in p) - u0; dv = max(q[1] for q in p) - v0; k = min(1.0, W / max(du * S_TEX, 1e-6), H / max(dv * S_TEX, 1e-6))
                ou = self.r.random() * max(0.0, 1 - du * S_TEX * k / W); ov = self.r.random() * max(0.0, 1 - dv * S_TEX * k / H)
                uvs = [(ou + (q[0] - u0) * S_TEX * k / W, ov + (q[1] - v0) * S_TEX * k / H) for q in p]
            self.set_uv(f, uvs, c)
        mats = materials(kind)
        for f in bm.faces: f.material_index = 1 if f[self.cat] in (HOT, FIRE) else 0; f.smooth = False
        for lay in (self.cat, self.done): bm.faces.layers.int.remove(lay)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        me = bpy.data.meshes.new(name)
        for m in mats: me.materials.append(m)
        bm.to_mesh(me); bm.free(); me.uv_layers[0].name = "UVMap"; me.update()      # 贴图坐标层和身体的同名，合并网格时才会并到同一层
        me.calc_loop_triangles(); print("GEAR", name, "tris", len(me.loop_triangles), "verts", len(me.vertices))
        return me


def _ring_rect(c, a, b, ha, hb, bev=0.0):
    """以 c 为中心、在 a、b 两个方向上的半宽 ha、hb 的一圈（bev>0 时切掉四个角，八个点）"""
    c = Vector(c); a = Vector(a).normalized(); b = Vector(b).normalized()
    if bev <= 0: return [c - a * ha - b * hb, c + a * ha - b * hb, c + a * ha + b * hb, c - a * ha + b * hb]
    return [c - a * (ha - bev) - b * hb, c + a * (ha - bev) - b * hb, c + a * ha - b * (hb - bev), c + a * ha + b * (hb - bev),
            c + a * (ha - bev) + b * hb, c - a * (ha - bev) + b * hb, c - a * ha + b * (hb - bev), c - a * ha - b * (hb - bev)]


def _ring_ell(c, a, b, ra, rb, seg=8, ph=0.0):
    c = Vector(c); a = Vector(a); b = Vector(b)
    return [c + a * ra * math.cos(ph + 2 * math.pi * i / seg) + b * rb * math.sin(ph + 2 * math.pi * i / seg) for i in range(seg)]


# ============================== 长柄火钳 ==============================
TONG_LEN = 1.25; TONG_GRIP = 0.37
Y_TAIL = -TONG_GRIP * TONG_LEN; Y_TIP = Y_TAIL + TONG_LEN; Y_PIV = Y_TIP - 0.31


def make_tongs():
    g = Build(); X = Vector((1, 0, 0)); Y = Vector((0, 1, 0)); Z = Vector((0, 0, 1))
    # 柄尾的铁环（在钳口张开的那个平面里）
    Rr, rr = 0.028, 0.0095; cy = Y_TAIL + Rr + rr; seg = 14; pseg = 6
    rings = []; cens = []
    for i in range(seg + 1):
        a = -math.pi / 2 + 2 * math.pi * i / seg; c = Vector((Rr * math.cos(a), cy + Rr * math.sin(a), 0)); o = Vector((math.cos(a), math.sin(a), 0))
        rings.append(_ring_ell(c, o, Z, rr, rr, pseg)); cens.append(c)
    g.tube(rings, EDGE, centers=cens)
    # 两根方柄，并拢成一束（各 0.018 × 0.022），从环上面一直到铆钉
    y0 = cy + Rr - 0.004
    for sx in (-1, 1):
        ys = [y0, Y_PIV - 0.25, Y_PIV - 0.06, Y_PIV + 0.004]; hw = [0.0108, 0.0112, 0.0138, 0.0155]; xs = [0.0122, 0.0126, 0.015, 0.0145]
        g.tube([_ring_rect((sx * x, y, 0), X, Z, w, 0.0135, 0.003) for y, w, x in zip(ys, hw, xs)], IRON, centers=[(sx * x, y, 0) for y, x in zip(ys, xs)], cap0=DARK, cap1=DARK)
    # 下段的皮缠带（把两根柄裹成一束）和两头的铁箍
    w0, w1 = y0 + 0.012, 0.125
    ys = np.linspace(w0, w1, 9); g.tube([_ring_ell((0, y, 0), X, Z, 0.0325 + 0.0014 * math.sin(k * 2.1), 0.0205, 10, 0.3) for k, y in enumerate(ys)], WRAP, centers=[(0, y, 0) for y in ys], vlen=True, u_rep=1.0)
    for ya, yb in ((w0 - 0.016, w0 + 0.004), (w1 - 0.004, w1 + 0.016)):
        g.tube([_ring_rect((0, ya, 0), X, Z, 0.035, 0.0228, 0.007), _ring_rect((0, yb, 0), X, Z, 0.035, 0.0228, 0.007)], EDGE, centers=[(0, ya, 0), (0, yb, 0)], cap0=DARK, cap1=DARK)
    # 铆在一起的地方：两片叠着的圆凸台、一颗六角的铆钉（两面都露头）
    for z0, z1 in ((-0.021, 0.0), (0.0, 0.021)):
        g.tube([_ring_ell((0, Y_PIV, z0), X, Y, 0.04, 0.044, 12), _ring_ell((0, Y_PIV, z1), X, Y, 0.04, 0.044, 12)], IRON, centers=[(0, Y_PIV, z0), (0, Y_PIV, z1)], cap0=IRON, cap1=IRON)
    for s in (-1, 1):
        g.tube([_ring_ell((0, Y_PIV, s * 0.020), X, Y, 0.017, 0.017, 6), _ring_ell((0, Y_PIV, s * 0.031), X, Y, 0.015, 0.015, 6)], EDGE, centers=[(0, Y_PIV, s * 0.020), (0, Y_PIV, s * 0.031)], cap1=EDGE)
    # 两片钳爪：从铆钉往外鼓出去、再往里收，尖上往外翘一点，围出一个上面开口的圆。前半段换成烧红的材质
    path = [(0.010, 0.0), (0.040, 0.030), (0.072, 0.072), (0.092, 0.122), (0.095, 0.170), (0.083, 0.214), (0.062, 0.252), (0.047, 0.279), (0.046, 0.298), (0.055, 0.310)]
    for sx in (-1, 1):
        P = [Vector((sx * x, Y_PIV + y, 0)) for x, y in path]; rings = []; m = len(P)
        for k in range(m):
            t = (P[min(k + 1, m - 1)] - P[max(k - 1, 0)]).normalized(); nrm = Z.cross(t).normalized()
            f = k / (m - 1); rings.append(_ring_rect(P[k], nrm, Z, 0.0185 - 0.0065 * f, 0.0195 - 0.006 * f, 0.005))
        cats = [IRON if k < 4 else HOT for k in range(m - 1)]
        g.tube(rings, cats, centers=P, cap1=HOT)
    me = g.finish("hedda_tongs", "tongs"); return me


# ============================== 背上的熔炉和烟囱 ==============================
FORGE_R = 0.122; FORGE_H = 0.372


def make_forge(seg=20):
    g = Build(); R = FORGE_R; c0 = Vector((0, R, 0))
    ring = lambda z, r, ph=0.0: [Vector((r * math.cos(ph + 2 * math.pi * i / seg), R + r * math.sin(ph + 2 * math.pi * i / seg), z)) for i in range(seg)]
    ax = lambda z: Vector((0, R, z))
    # 炉身：从下往上（z, 半径, 这一段的贴图）。铁箍凸出来一点，外沿磨亮
    prof = [(0.0, 0.112, DARK), (0.006, 0.127, EDGE), (0.032, 0.127, DARK), (0.034, 0.121, IRON), (0.128, 0.121, EDGE), (0.130, 0.126, EDGE), (0.148, 0.126, DARK),
            (0.150, 0.121, IRON), (0.236, 0.121, DARK), (0.238, 0.136, EDGE), (0.264, 0.136, DARK), (0.266, 0.131, IRON), (0.326, 0.131, DARK), (0.328, 0.139, EDGE),
            (0.354, 0.139, EDGE), (0.362, 0.126, DARK), (0.366, 0.113, None)]
    rings = [ring(z, r) for z, r, _ in prof]; cats = [c for _, _, c in prof[:-1]]
    g.tube(rings, cats, centers=[ax(z) for z, _, _ in prof], cap0=DARK)
    # 炉盖：中间微微拱起，正中一个小提手
    g.tube([ring(0.366, 0.113), ring(0.374, 0.085), ring(0.379, 0.03)], [IRON, IRON], centers=[ax(0.366), ax(0.374), ax(0.379)], cap1=IRON)
    g.tube([_ring_ell(ax(0.379), Vector((1, 0, 0)), Vector((0, 1, 0)), 0.02, 0.02, 6), _ring_ell(ax(0.392), Vector((1, 0, 0)), Vector((0, 1, 0)), 0.016, 0.016, 6)], EDGE, centers=[ax(0.379), ax(0.392)], cap1=EDGE)
    # 背面三条竖着的铁条（从底箍到上面的炉箍），每条上下各两颗铆钉
    for a_deg in (55, 90, 125):
        a = math.radians(a_deg); n = Vector((math.cos(a), math.sin(a), 0)); t = Vector((0, 0, 1)).cross(n)
        M = Matrix((t, n, Vector((0, 0, 1)))).transposed().to_4x4(); M.translation = c0 + n * 0.121
        g.box((-0.011, -0.002, 0.03), (0.011, 0.0065, 0.242), IRON, M)
        for z in (0.06, 0.1, 0.17, 0.215): g.rivet(c0 + n * 0.1275 + Vector((0, 0, z)), n, r=0.006, h=0.0045)
    # 铆钉：每道箍上一圈（贴着后背的那一侧不要）
    for z, r, k in ((0.019, 0.127, 12), (0.139, 0.126, 12), (0.251, 0.136, 16), (0.341, 0.139, 16)):
        for i in range(k):
            a = 2 * math.pi * (i + 0.5) / k
            if math.sin(a) < -0.55: continue
            n = Vector((math.cos(a), math.sin(a), 0)); g.rivet(Vector((0, R, z)) + n * r, n, r=0.0068, h=0.005)
    # 炉门：右后腰（角色的右手边是 -X），方框里两列三排的炉栅，后面透出炉火
    phi = math.atan2(0.42, -0.91)                               # 门的朝向：右边偏后
    nd = Vector((math.cos(phi), math.sin(phi), 0)); td = Vector((0, 0, 1)).cross(nd).normalized(); up = Vector((0, 0, 1))
    zc, hw, hh = 0.09, 0.036, 0.045; base = c0 + nd * (R + 0.002) + up * zc
    q = [base - td * hw - up * hh, base + td * hw - up * hh, base + td * hw + up * hh, base - td * hw + up * hh]
    g.face([g.bm.verts.new(p) for p in q], FIRE, out=c0 + up * zc, uvs=[(0.1, 0.05), (0.9, 0.05), (0.9, 0.95), (0.1, 0.95)])
    Fm = Matrix((td, nd, up)).transposed().to_4x4(); Fm.translation = c0 + nd * R + up * zc       # 门自己的坐标：x 横、y 朝外、z 竖
    for lo, hi in (((-hw - 0.012, 0.0, -hh - 0.012), (hw + 0.012, 0.012, -hh)), ((-hw - 0.012, 0.0, hh), (hw + 0.012, 0.012, hh + 0.012)),
                   ((-hw - 0.012, 0.0, -hh), (-hw, 0.012, hh)), ((hw, 0.0, -hh), (hw + 0.012, 0.012, hh))):
        g.box(lo, hi, EDGE, Fm)                                  # 门框
    g.box((-0.0035, 0.002, -hh), (0.0035, 0.009, hh), DARK, Fm)                     # 一根竖栏
    for zz in (-hh / 3, hh / 3): g.box((-hw, 0.002, zz - 0.003), (hw, 0.009, zz + 0.003), DARK, Fm)      # 两根横栏
    g.box((hw + 0.012, 0.002, -0.01), (hw + 0.02, 0.014, 0.01), EDGE, Fm)            # 门闩
    # 烟囱（B：截面半宽 0.025 → 0.03，B 的设定图里烟囱更粗壮）：方的，从炉盖的左后方斜着伸出去（往左、往后歪），顶上一圈略宽的帽檐，口里是黑的
    B = Vector((0.07, R + 0.012, 0.30)); T = Vector((0.142, R + 0.05, 0.488)); d = (T - B).normalized()
    a = Vector((1, 0, 0)); a = (a - d * a.dot(d)).normalized(); b = d.cross(a)
    P = lambda t: B + (T - B) * t
    cs = [(0.0, 0.03), (0.86, 0.03)]
    g.tube([_ring_rect(P(t), a, b, w, w, 0.003) for t, w in cs], IRON, centers=[P(t) for t, _ in cs])
    z_lid = 0.372; t_lid = (z_lid - B.z) / (T.z - B.z)
    g.tube([_ring_rect(P(t_lid - 0.02), a, b, 0.039, 0.039, 0.005), _ring_rect(P(t_lid + 0.06), a, b, 0.037, 0.037, 0.005)], EDGE, centers=[P(t_lid - 0.02), P(t_lid + 0.06)], cap1=DARK)      # 根上的套箍
    g.tube([_ring_rect(P(0.84), a, b, 0.036, 0.036, 0.005), _ring_rect(P(0.86), a, b, 0.04, 0.04, 0.005), _ring_rect(P(1.0), a, b, 0.04, 0.04, 0.005)], [EDGE, IRON], centers=[P(0.84), P(0.86), P(1.0)])      # 帽檐
    g.tube([_ring_rect(P(1.0), a, b, 0.04, 0.04, 0.005), _ring_rect(P(1.0), a, b, 0.027, 0.027, 0.003), _ring_rect(P(0.93), a, b, 0.027, 0.027, 0.003)], [EDGE, DARK], centers=[P(1.0), P(0.999), P(0.93)], cap1=DARK)      # 口
    for t in (0.35, 0.62):                                       # 烟囱上两道细箍
        g.tube([_ring_rect(P(t), a, b, 0.0325, 0.0325, 0.003), _ring_rect(P(t + 0.04), a, b, 0.0325, 0.0325, 0.003)], EDGE, centers=[P(t), P(t + 0.04)])
    return g.finish("hedda_forge", "forge")
