"""葛隆 · 砧卫的武器：锻炉战锤（右手）、炉门塔盾（左前臂）。给 tools/blender/hero_build.py 的 rig 一步用（gear 里 type 是 script）。
设计图是 art/hero/gorran/weapon_concept.png：炭黑的铁、铆钉、磨亮的边，炉栅和锤头的缝里透出琥珀色的火光。

两个函数各返回一个网格，单位和角色一样（身高为 1）：
  make_hammer  握持坐标：原点是手握的位置，+Y 是锤头那一端，-Z 是顺着前臂往外（喇叭口的大锤面朝这边），X 是掌心的法线方向。
  make_shield  盾自己的坐标：宽沿 X、高沿 +Y、盾面朝 +Z，原点在盾背面的正中。装到前臂上以后怎么转由 build.json 的 rot 定。

材质两个：weapon（铁、皮、铜，共用一张 512 的贴图，分六块：铁板、磨亮的边、暗处、铜铆钉、烤热的铁、皮缠带）
和 weapon_ember（炉火，单独一张小贴图，带自发光）。面数：锤 500 个三角形，盾约 1300 个，合计不到 2000。
"""
import bpy, bmesh, math, random, os, json
import numpy as np
from mathutils import Vector, Matrix

TEX = 512; PAD = 8
REG = {"iron": (0, 128, 384, 512), "edge": (384, 384, 512, 512), "dark": (384, 256, 512, 384),
       "brass": (384, 128, 512, 256), "warm": (384, 0, 512, 128), "leather": (0, 0, 384, 128)}      # 每一块在贴图上的像素范围（x0, y0, x1, y1），第 0 行在最下面
IRON, EDGE, DARK, BRASS, WARM, LEATHER, EMBER = range(7)
REG_OF = {IRON: "iron", EDGE: "edge", DARK: "dark", BRASS: "brass", WARM: "warm", LEATHER: "leather"}
S_TEX = 580.0            # 一个单位长度对应多少像素（盾高 0.62，正好占满铁板那一块）


# ============================== 贴图 ==============================
def _vnoise(h, w, cell, rng):
    g = rng.random((h // cell + 3, w // cell + 3)).astype(np.float32)
    ys = np.arange(h) / cell; xs = np.arange(w) / cell; y0 = ys.astype(int); x0 = xs.astype(int)
    fy = ys - y0; fx = xs - x0; fy = (fy * fy * (3 - 2 * fy))[:, None]; fx = (fx * fx * (3 - 2 * fx))[None, :]
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
def _fbm(h, w, cells, amps, rng, gain=2.2):
    out = sum(a * _vnoise(h, w, c, rng) for c, a in zip(cells, amps)) / sum(amps)
    return np.clip((out - 0.5) * gain + 0.5, 0, 1)
def _sstep(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def _mix(a, b, t): return a * (1 - t[..., None]) + np.asarray(b, np.float32) * t[..., None]
def _plates(h, w, n, rng):
    """把一块贴图分成 n 个不规则的多边形小块（像一块块锻打拼起来的铁板）。返回：每个像素离最近的接缝有多远（像素）、它属于第几块"""
    pts = rng.random((n, 2)) * (w, h); yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xx[..., None] - pts[:, 0]) ** 2 + (yy[..., None] - pts[:, 1]) ** 2); cell = np.argmin(d, axis=2); d.sort(axis=2)
    return d[..., 1] - d[..., 0], cell
def _scratches(col, rng, count, lo, hi, lmin=12, lmax=70):
    h, w = col.shape[:2]
    for _ in range(count):
        x, y = rng.random() * w, rng.random() * h; ang = rng.random() * math.pi; n = int(lmin + rng.random() * (lmax - lmin)); d = lo + rng.random() * (hi - lo)
        t = np.arange(n); xi = np.clip((x + math.cos(ang) * t).astype(int), 0, w - 1); yi = np.clip((y + math.sin(ang) * t).astype(int), 0, h - 1)
        col[yi, xi] = np.clip(col[yi, xi] + d * np.sin(np.pi * t / n)[:, None], 0, 1)


def _atlas():
    rng = np.random.default_rng(11); img = np.zeros((TEX, TEX, 3), np.float32)
    def block(name):
        x0, y0, x1, y1 = REG[name]; return y1 - y0, x1 - x0, (slice(y0, y1), slice(x0, x1))
    # 铁板：炭黑，大块的明暗、细颗粒、几处磨亮、几处锈、划痕、小坑
    h, w, sl = block("iron"); n = _fbm(h, w, (90, 30, 10), (0.5, 0.3, 0.2), rng, 1.7); fine = _fbm(h, w, (4, 2), (0.6, 0.4), rng, 1.5)
    col = np.asarray((0.19, 0.183, 0.18), np.float32)[None, None, :] * (0.86 + 0.46 * (n - 0.5) + 0.14 * (fine - 0.5))[..., None]      # 颜色照设计图量的：中性偏暖的炭黑
    seam, cell = _plates(h, w, 30, rng); keep = _sstep(0.38, 0.62, _fbm(h, w, (40, 14), (0.6, 0.4), rng))       # 锻打的接缝：断断续续的直线裂纹，缝里暗、缝边磨亮一线
    col *= (1 + (rng.random(30).astype(np.float32)[cell] - 0.5) * 0.14)[..., None]                                # 每一小块的明暗略有不同
    col *= (1 - 0.5 * (1 - _sstep(0.4, 1.6, seam)) * keep)[..., None]
    col = _mix(col, (0.4, 0.39, 0.38), _sstep(1.0, 1.8, seam) * (1 - _sstep(2.2, 3.6, seam)) * keep * 0.4)
    col = _mix(col, (0.38, 0.37, 0.36), _sstep(0.82, 0.97, _fbm(h, w, (9, 4), (0.6, 0.4), rng)) * 0.3)          # 零星磨亮的小点
    rust = _sstep(0.7, 0.93, _fbm(h, w, (60, 18, 6), (0.5, 0.3, 0.2), rng)) * 0.3
    col = col * (1 - rust[..., None]) + np.asarray((0.27, 0.16, 0.11), np.float32) * (0.7 + 0.6 * n)[..., None] * rust[..., None]
    _scratches(col, rng, 45, 0.05, 0.14); _scratches(col, rng, 25, -0.07, -0.03)
    col[rng.random((h, w)) > 0.995] *= 0.5; img[sl] = col
    # 磨亮的边：钢灰，带划痕和小黑点
    h, w, sl = block("edge"); n = _fbm(h, w, (30, 9, 3), (0.5, 0.3, 0.2), rng)
    col = np.asarray((0.47, 0.46, 0.455), np.float32)[None, None, :] * (0.84 + 0.42 * (n - 0.5))[..., None]
    col = _mix(col, (0.28, 0.2, 0.16), _sstep(0.76, 0.95, _fbm(h, w, (18, 6), (0.6, 0.4), rng)) * 0.4)
    _scratches(col, rng, 30, -0.2, -0.08, 8, 40); _scratches(col, rng, 20, 0.08, 0.18, 8, 40); img[sl] = col
    # 暗处：缝里、背面
    h, w, sl = block("dark"); n = _fbm(h, w, (30, 9, 3), (0.5, 0.3, 0.2), rng)
    col = np.asarray((0.088, 0.084, 0.092), np.float32)[None, None, :] * (0.75 + 0.7 * (n - 0.5))[..., None]
    _scratches(col, rng, 16, 0.03, 0.08, 8, 40); img[sl] = col
    # 铜铆钉：中间亮、四周暗（锥尖对着这一块的正中）
    h, w, sl = block("brass"); yy, xx = np.mgrid[0:h, 0:w]; d = np.hypot(xx - w / 2 + 6, yy - h / 2 - 6) / (w / 2)
    col = _mix(np.broadcast_to(np.asarray((0.74, 0.58, 0.4), np.float32), (h, w, 3)).copy(), (0.2, 0.135, 0.095), _sstep(0.08, 0.8, d))      # 设计图上是暗铜色，只有尖上一点亮
    col *= (0.85 + 0.3 * _fbm(h, w, (12, 4), (0.6, 0.4), rng))[..., None]; img[sl] = col
    # 烤热的铁：靠近炉火的内壁，发褐发红
    h, w, sl = block("warm"); n = _fbm(h, w, (30, 9, 3), (0.5, 0.3, 0.2), rng)
    col = _mix(np.broadcast_to(np.asarray((0.2, 0.12, 0.085), np.float32), (h, w, 3)).copy(), (0.5, 0.24, 0.08), _sstep(0.35, 0.9, n)); img[sl] = col
    # 皮缠带：一圈一圈斜着缠，每一圈压着上一圈（一侧亮一侧暗），圈和圈之间一道暗缝
    h, w, sl = block("leather"); yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); band = 53.0
    ph = ((xx - (yy - PAD) * band / (h - 2 * PAD)) % band) / band; n = _fbm(h, w, (20, 6, 2), (0.45, 0.35, 0.2), rng)
    col = np.asarray((0.19, 0.125, 0.1), np.float32)[None, None, :] * ((0.7 + 0.45 * ph) * (0.8 + 0.45 * (n - 0.5)))[..., None]
    col *= (0.4 + 0.6 * _sstep(0.0, 0.1, ph) * (1 - _sstep(0.93, 1.0, ph)))[..., None]
    col = _mix(col, (0.33, 0.22, 0.16), _sstep(0.78, 0.97, n) * 0.45); img[sl] = col
    return np.clip(img, 0, 1)


def _ember_tex(n=64):
    rng = np.random.default_rng(5); yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / (n - 1)
    col = _mix(np.broadcast_to(np.asarray((0.98, 0.66, 0.2), np.float32), (n, n, 3)).copy(), (0.94, 0.43, 0.09), _sstep(0.1, 0.55, yy))      # 下面亮黄，往上变橙、变红（颜色照设计图量的，稍微提亮）
    col = _mix(col, (0.6, 0.17, 0.04), _sstep(0.55, 1.0, yy))
    col = _mix(col, (1.0, 0.82, 0.38), (1 - _sstep(0.0, 0.45, np.hypot(xx - 0.5, yy - 0.36))) * 0.45)
    col *= (0.78 + 0.4 * _fbm(n, n, (10, 4), (0.6, 0.4), rng))[..., None]
    return np.clip(col, 0, 1)


def _image(name, arr):
    h, w = arr.shape[:2]; img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(np.concatenate([arr, np.ones((h, w, 1), np.float32)], axis=2).ravel()); img.file_format = "PNG"; img.pack(); return img


def materials():
    """两个材质，名字都以 weapon 开头（游戏靠这个认武器）。重复调用只建一次"""
    iron = bpy.data.materials.get("weapon"); ember = bpy.data.materials.get("weapon_ember")
    if iron and ember: return iron, ember
    iron = bpy.data.materials.new("weapon"); iron.use_nodes = True
    b = next(n for n in iron.node_tree.nodes if n.type == "BSDF_PRINCIPLED"); t = iron.node_tree.nodes.new("ShaderNodeTexImage"); t.image = _image("weapon_gorran", _atlas())
    iron.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.5; b.inputs["Metallic"].default_value = 0.85      # 和身体的铁甲差不多（身体贴图里金属度约 0.9、粗糙度约 0.6）；游戏里这两个数会被统一改掉
    ember = bpy.data.materials.new("weapon_ember"); ember.use_nodes = True
    b = next(n for n in ember.node_tree.nodes if n.type == "BSDF_PRINCIPLED"); t = ember.node_tree.nodes.new("ShaderNodeTexImage"); t.image = _image("weapon_gorran_ember", _ember_tex())
    ember.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.6; b.inputs["Metallic"].default_value = 0.0
    ems = b.inputs.get("Emission Color") or b.inputs.get("Emission"); ember.node_tree.links.new(t.outputs["Color"], ems)      # 炉火自己亮，不靠灯照
    if b.inputs.get("Emission Strength"): b.inputs["Emission Strength"].default_value = 0.5
    return iron, ember


# ============================== 建模用的小工具 ==============================
class Build:
    """一件武器的搭建过程。每个面记三样：贴图用哪一块（cat）、贴图坐标定了没有（done）、是不是平滑着色（sm）"""
    def __init__(self):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.verify()
        self.cat = self.bm.faces.layers.int.new("cat"); self.done = self.bm.faces.layers.int.new("done"); self.sm = self.bm.faces.layers.int.new("sm")
        self.rnd = random.Random(3)

    def face(self, verts, cat, toward=None, away=None, smooth=False):
        """建一个面。toward 是法线应该朝的方向，away 是面应该背对的点（给一个就行），用来把面的正反定对"""
        f = self.bm.faces.new(verts); f[self.cat] = cat; f[self.sm] = 1 if smooth else 0; f.normal_update()
        ref = Vector(toward) if toward is not None else (f.calc_center_median() - Vector(away) if away is not None else None)
        if ref is not None and f.normal.dot(ref) < 0: f.normal_flip(); f.normal_update()
        return f

    def set_uv(self, f, px):
        """直接给一个面定贴图坐标。px: {顶点: (像素 x, 像素 y)}"""
        for l in f.loops: l[self.uv].uv = (px[l.vert][0] / TEX, px[l.vert][1] / TEX)
        f[self.done] = 1

    def box(self, lo, hi, cat, bev=0.0, bcat=EDGE, taper=None, skip=()):
        """带倒角的盒子：六个面用 cat，倒角用 bcat（默认是磨亮的边）。
        taper=(轴, (低端两个方向的缩放), (高端两个方向的缩放))：把盒子沿一个轴收成棱台。skip：不要的面，写成 "+x" "-z" 这样（埋在别的零件里看不见的）"""
        lo = Vector(lo); hi = Vector(hi); c = (lo + hi) / 2; h = (hi - lo) / 2; V = {}; made = []
        def vert(ax, s):
            if (ax, s) not in V: V[(ax, s)] = self.bm.verts.new([c[i] + s[i] * (h[i] - (bev if i != ax else 0)) for i in range(3)])
            return V[(ax, s)]
        nm = lambda ax, s: ("-" if s < 0 else "+") + "xyz"[ax]
        for ax in range(3):
            a, b = [i for i in range(3) if i != ax]
            for s in (-1, 1):
                if nm(ax, s) in skip: continue
                q = []
                for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    t = [0, 0, 0]; t[ax] = s; t[a] = sa; t[b] = sb; q.append(vert(ax, tuple(t)))
                made.append((q, cat))
        if bev > 0:
            for a1 in range(3):
                for a2 in range(a1 + 1, 3):
                    a3 = 3 - a1 - a2
                    for s1 in (-1, 1):
                        for s2 in (-1, 1):
                            if nm(a1, s1) in skip or nm(a2, s2) in skip: continue
                            q = []
                            for ax, s3 in ((a1, -1), (a1, 1), (a2, 1), (a2, -1)):
                                t = [0, 0, 0]; t[a1] = s1; t[a2] = s2; t[a3] = s3; q.append(vert(ax, tuple(t)))
                            made.append((q, bcat))
            for sx in (-1, 1):
                for sy in (-1, 1):
                    for sz in (-1, 1):
                        s = (sx, sy, sz)
                        if any(nm(i, s[i]) in skip for i in range(3)): continue
                        made.append(([vert(0, s), vert(1, s), vert(2, s)], bcat))
        if taper:
            ax, k0, k1 = taper; a, b = [i for i in range(3) if i != ax]
            for v in V.values():
                t = (v.co[ax] - lo[ax]) / (hi[ax] - lo[ax]); v.co[a] = c[a] + (v.co[a] - c[a]) * (k0[0] + (k1[0] - k0[0]) * t); v.co[b] = c[b] + (v.co[b] - c[b]) * (k0[1] + (k1[1] - k0[1]) * t)
        return [self.face(q, ct, away=c) for q, ct in made]

    def lathe(self, pts, cats, seg=8, smooth=(), cyl_uv=()):
        """绕 Y 轴转一圈的旋转体（锤柄）。pts: [(y, 半径)] 从下往上；cats: 每一段用哪块贴图。每一段有自己的顶点，段和段之间是硬边。
        smooth: 哪几段平滑着色；cyl_uv: 哪几段把贴图绕着柄展开（皮缠带）"""
        ph = math.pi / seg; made = []
        ring = lambda y, r: [self.bm.verts.new((r * math.cos(ph + 2 * math.pi * i / seg), y, r * math.sin(ph + 2 * math.pi * i / seg))) for i in range(seg)]
        for k in range(len(pts) - 1):
            (y0, r0), (y1, r1) = pts[k], pts[k + 1]; dy = y1 - y0; dr = r1 - r0
            if r0 < 1e-6 and r1 < 1e-6: continue
            R0 = ring(y0, r0) if r0 > 1e-6 else [self.bm.verts.new((0, y0, 0))]; R1 = ring(y1, r1) if r1 > 1e-6 else [self.bm.verts.new((0, y1, 0))]
            for i in range(seg):
                j = (i + 1) % seg; vs = [R0[i % len(R0)], R0[j % len(R0)], R1[j % len(R1)], R1[i % len(R1)]]; vs = list(dict.fromkeys(vs))
                am = ph + 2 * math.pi * (i + 0.5) / seg; ref = Vector((math.cos(am) * dy, -dr, math.sin(am) * dy))        # 从下往上走，外面在右手边
                f = self.face(vs, cats[k], toward=ref, smooth=k in smooth); made.append(f)
                if k in cyl_uv:
                    x0, yb, x1, yt = REG[REG_OF[cats[k]]]; px = {}
                    for v, ii in ((R0[i % len(R0)], i), (R0[j % len(R0)], i + 1), (R1[j % len(R1)], i + 1), (R1[i % len(R1)], i)):
                        px[v] = (x0 + PAD + (v.co.y - y0) / dy * (x1 - x0 - 2 * PAD), yb + PAD + ii / seg * (yt - yb - 2 * PAD))
                    self.set_uv(f, px)
        return made

    def move(self, faces, M, unbend=0.0):
        """把刚建的一组面整体挪个位置（M 是 4×4 矩阵）。unbend：盾最后要整体弯一下，不想跟着弯的零件（握把、臂垫）先反着弯回来"""
        for v in {v for f in faces for v in f.verts}:
            v.co = M @ v.co; v.co.z += unbend * v.co.x * v.co.x

    def rivet(self, at, nrm, r=0.009, h=0.007, seg=6):
        """锥形的铜铆钉：尖顶对着铜那一块贴图的正中（亮），底边在四周（暗）"""
        n = Vector(nrm).normalized(); t = n.orthogonal().normalized(); b = n.cross(t); at = Vector(at) - n * 0.0012
        tip = self.bm.verts.new(at + n * h); ring = [self.bm.verts.new(at + (t * math.cos(2 * math.pi * i / seg) + b * math.sin(2 * math.pi * i / seg)) * r) for i in range(seg)]
        x0, y0, x1, y1 = REG["brass"]; cx, cy, rr = (x0 + x1) / 2 - 6, (y0 + y1) / 2 + 6, (x1 - x0) / 2 - PAD - 8
        for i in range(seg):
            j = (i + 1) % seg; f = self.face([ring[i], ring[j], tip], BRASS, away=at - n * h)
            self.set_uv(f, {tip: (cx, cy), ring[i]: (cx + rr * math.cos(2 * math.pi * i / seg), cy + rr * math.sin(2 * math.pi * i / seg)), ring[j]: (cx + rr * math.cos(2 * math.pi * j / seg), cy + rr * math.sin(2 * math.pi * j / seg))})

    def finish(self, name, bend=0.0):
        """收尾：没定贴图坐标的面按类别投到自己那一块上；盾再整体弯一下（绕竖轴，两边往后收）；变成网格"""
        bm = self.bm; bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bm.normal_update()
        co = [v.co for v in bm.verts]; mn = Vector([min(c[i] for c in co) for i in range(3)])
        for f in bm.faces:
            if f[self.done]: continue
            c = f[self.cat]; x0, y0, x1, y1 = REG[REG_OF[c]]; W = x1 - x0 - 2 * PAD; H = y1 - y0 - 2 * PAD
            if c == IRON:                                        # 大面：整件武器按面的朝向平着投上去，相邻的面花纹连得上
                ax = max(range(3), key=lambda i: abs(f.normal[i])); a, b = [i for i in range(3) if i != ax]
                for l in f.loops:
                    l[self.uv].uv = ((x0 + PAD + min(max((l.vert.co[a] - mn[a]) * S_TEX, 0), W)) / TEX, (y0 + PAD + min(max((l.vert.co[b] - mn[b]) * S_TEX, 0), H)) / TEX)
            else:                                                # 小面（倒角、缝、内壁）：各自摊平，随便落在那一块的某个位置
                e = max(f.edges, key=lambda e_: e_.calc_length()); eu = (e.verts[1].co - e.verts[0].co).normalized(); ev = f.normal.cross(eu)
                p = [(l.vert.co.dot(eu), l.vert.co.dot(ev)) for l in f.loops]; u0 = min(q[0] for q in p); v0 = min(q[1] for q in p)
                du = (max(q[0] for q in p) - u0) * S_TEX; dv = (max(q[1] for q in p) - v0) * S_TEX; k = min(1.0, W / max(du, 1e-6), H / max(dv, 1e-6))
                ox = self.rnd.random() * (W - du * k); oy = self.rnd.random() * (H - dv * k)
                for l, q in zip(f.loops, p): l[self.uv].uv = ((x0 + PAD + ox + (q[0] - u0) * S_TEX * k) / TEX, (y0 + PAD + oy + (q[1] - v0) * S_TEX * k) / TEX)
        if bend:
            for v in bm.verts: v.co.z -= bend * v.co.x * v.co.x
        iron, ember = materials()
        for f in bm.faces: f.smooth = bool(f[self.sm]); f.material_index = 1 if f[self.cat] == EMBER else 0
        for lay in (self.cat, self.done, self.sm): bm.faces.layers.int.remove(lay)
        me = bpy.data.meshes.new(name); me.materials.append(iron); me.materials.append(ember)
        bm.to_mesh(me); bm.free(); me.uv_layers[0].name = "UVMap"; me.update()          # 贴图坐标层和身体的同名，合并网格时才会并到同一层
        me.calc_loop_triangles(); print("GEAR", name, "tris", len(me.loop_triangles), "verts", len(me.vertices))
        return me


def _ember_px(u, v): return (u * 63.0 / 64 * TEX + TEX / 128, v * 63.0 / 64 * TEX + TEX / 128)      # 炉火贴图上的位置（0..1）换成 set_uv 用的“像素”


# ============================== 锻炉战锤 ==============================
def make_hammer():
    """长 0.55：柄尾在 Y=-0.22，锤头顶在 Y=+0.33，手握在皮缠带中间偏下。
    锤头沿 Z 排开：中间一个方块；-Z 一侧是张开的喇叭口大锤面，+Z 一侧是短的平头；两边和方块之间各留一道缝，缝里是炉火"""
    g = Build()
    # 柄：尾帽、八角配重、下段、箍、皮缠带、箍、插进锤头的颈
    pts = [(-0.222, 0.0), (-0.222, 0.017), (-0.213, 0.023), (-0.213, 0.031), (-0.205, 0.038), (-0.171, 0.038), (-0.161, 0.030), (-0.161, 0.0225), (-0.118, 0.0205),
           (-0.118, 0.0275), (-0.101, 0.0275), (-0.101, 0.0195), (0.115, 0.0195), (0.115, 0.0275), (0.131, 0.0275), (0.131, 0.023), (0.172, 0.026)]
    cats = [DARK, EDGE, DARK, EDGE, IRON, EDGE, DARK, IRON, DARK, EDGE, DARK, LEATHER, DARK, EDGE, DARK, IRON]
    g.lathe(pts, cats, seg=8, smooth=(11,), cyl_uv=(11,))
    for a in range(4):                                           # 配重上四颗小铆钉
        am = math.pi / 2 * a; n = Vector((math.cos(am), 0, math.sin(am))); g.rivet(n * 0.0351 + Vector((0, -0.188, 0)), n, r=0.007, h=0.006, seg=5)
    # 锤头
    g.box((-0.066, 0.169, -0.058), (0.066, 0.331, 0.058), IRON, bev=0.011)                                      # 中间的方块
    g.box((-0.022, 0.329, -0.022), (0.022, 0.341, 0.022), EDGE, bev=0.004, bcat=DARK, skip=("-y",))              # 顶上露出来的柄头
    g.box((-0.074, 0.165, -0.141), (0.074, 0.335, -0.0645), IRON, bev=0.009, taper=(2, (1.0, 1.0), (0.72, 0.74)))      # 喇叭口：越往外越大
    g.box((-0.058, 0.184, -0.148), (0.058, 0.316, -0.139), IRON, bev=0.005, skip=("+z",))                       # 喇叭口外端的锤面
    g.box((-0.062, 0.178, 0.067), (0.062, 0.322, 0.112), IRON, bev=0.013)                                       # 平头
    for z0, z1, hx, y0, y1 in ((-0.0655, -0.0575, 0.050, 0.196, 0.304), (0.0575, 0.0675, 0.048, 0.199, 0.301)):  # 两道缝里的炉火：四个面朝外的一圈
        c = Vector((0, (y0 + y1) / 2, (z0 + z1) / 2)); P = [(-hx, y0), (hx, y0), (hx, y1), (-hx, y1)]
        for i in range(4):
            (xa, ya), (xb, yb) = P[i], P[(i + 1) % 4]; vs = [g.bm.verts.new(p) for p in ((xa, ya, z0), (xb, yb, z0), (xb, yb, z1), (xa, ya, z1))]
            f = g.face(vs, EMBER, away=c); g.set_uv(f, {vs[0]: _ember_px(0.15, 0.2), vs[1]: _ember_px(0.85, 0.2), vs[2]: _ember_px(0.85, 0.62), vs[3]: _ember_px(0.15, 0.62)})
    for sx in (-1, 1):                                           # 方块两侧各两颗大铆钉
        for z in (-0.027, 0.027): g.rivet((sx * 0.066, 0.214, z), (sx, 0, 0), r=0.0115, h=0.0095)
    return g.finish("gorran_hammer")


# ============================== 炉门塔盾 ==============================
def make_shield():
    """高 0.62、宽 0.41：上圆下方的铁门。一圈凸起的边框、两侧各三段的加强条、底下一条底座、正中一个圆炉栅（五根竖栏，后面是炉火）、
    炉栅两边各一条铰链带、拱顶一块小牌。整面盾绕竖轴弯一点，两边往后收"""
    g = Build(); bm = g.bm; CY_ = 0.005                          # 炉栅的圆心高度
    W, SPR, RISE, FOOT, N = 0.163, 0.205, 0.105, -0.232, 16      # 主板半宽、拱从哪开始、拱高、底座的上沿、拱分几段
    WQ, RQ = W - 0.036, RISE - 0.034                             # 边框里面那一圈
    ZB, ZS, ZF = 0.0, 0.026, 0.036                               # 背面、边框外沿、边框顶面
    zp = lambda x: 0.016 + 0.007 * (1 - min(abs(x) / WQ, 1.0))   # 里面的门板：中线上有一道棱
    peak = lambda x, k: k * max(0.0, 1 - abs(x) / 0.034)         # 拱顶正中的小尖
    th = [math.pi * i / N for i in range(N + 1)]; PW = 0.96      # 拱接近椭圆，肩膀略方一点（指数小于 1）
    arc = lambda t, w, r, k: ((-1 if math.cos(t) > 0 else 1) * w * abs(math.cos(t)) ** PW, SPR + r * math.sin(t) ** PW + peak(w * abs(math.cos(t)) ** PW, k))
    P = [(-W, FOOT)] + [arc(t, W, RISE, 0.008) for t in th] + [(W, FOOT)]          # 外轮廓（从左下，绕过拱顶，到右下）
    Q = [(-WQ, FOOT)] + [arc(t, WQ, RQ, 0.005) for t in th] + [(WQ, FOOT)]         # 边框的内沿
    lerp = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    v3 = lambda p, z: bm.verts.new((p[0], p[1], z))
    for i in range(len(P) - 1):
        a0, a1, q0, q1 = P[i], P[i + 1], Q[i], Q[i + 1]; b0, b1 = lerp(a0, q0, 0.2), lerp(a1, q1, 0.2); c0, c1 = lerp(a0, q0, 0.8), lerp(a1, q1, 0.8); e0, e1 = lerp(a0, q0, 0.66), lerp(a1, q1, 0.66)
        mid = Vector(((a0[0] + a1[0] + q0[0] + q1[0]) / 4, (a0[1] + a1[1] + q0[1] + q1[1]) / 4, 0)); out = Vector(((a0[0] + a1[0] - q0[0] - q1[0]), (a0[1] + a1[1] - q0[1] - q1[1]), 0))
        g.face([v3(a0, ZB), v3(a1, ZB), v3(a1, ZS), v3(a0, ZS)], DARK, toward=out)                               # 盾的侧壁
        g.face([v3(a0, ZS), v3(a1, ZS), v3(b1, ZF), v3(b0, ZF)], EDGE, toward=out + Vector((0, 0, out.length)))     # 边框外沿的倒角（磨亮）
        g.face([v3(b0, ZF), v3(b1, ZF), v3(e1, ZF), v3(e0, ZF)], IRON, toward=(0, 0, 1))                         # 边框顶面
        g.face([v3(e0, ZF), v3(e1, ZF), v3(c1, ZF), v3(c0, ZF)], EDGE, toward=(0, 0, 1))                         # 顶面内缘一道磨亮的线
        g.face([v3(c0, ZF), v3(c1, ZF), v3(q1, zp(q1[0])), v3(q0, zp(q0[0]))], DARK, toward=-out + Vector((0, 0, out.length)))      # 边框内侧的斜壁（暗）
    for i in range(1, len(P) - 2):                               # 背面和里面的门板：一列一列的竖条，弯的时候才顺
        (xa, ya), (xb, yb) = P[i], P[i + 1]; g.face([v3((xa, FOOT), ZB), v3((xb, FOOT), ZB), v3((xb, yb), ZB), v3((xa, ya), ZB)], IRON, toward=(0, 0, -1))
        (xa, ya), (xb, yb) = Q[i], Q[i + 1]; g.face([v3((xa, FOOT), zp(xa)), v3((xb, FOOT), zp(xb)), v3((xb, yb), zp(xb)), v3((xa, ya), zp(xa))], IRON, toward=(0, 0, 1))
    for y0, y1 in ((CY_ + 0.112, 0.222), (-0.2, CY_ - 0.112)):   # 门板中线上的细棱（炉栅上面一段、下面一段）
        g.face([v3((-0.003, y0), zp(0) + 0.002), v3((0.003, y0), zp(0) + 0.002), v3((0.003, y1), zp(0) + 0.002), v3((-0.003, y1), zp(0) + 0.002)], EDGE, toward=(0, 0, 1))
    for t_deg in (20, 47, 133, 160):                             # 边框上的铆钉：拱上四颗，两条直边各两颗
        i = round(t_deg / 180 * N) + 1; m = lerp(P[i], Q[i], 0.52); g.rivet((m[0], m[1], ZF), (0, 0, 1), r=0.0085, h=0.007)
    for sx in (-1, 1):
        for y in (0.15, -0.16): g.rivet((sx * 0.143, y, ZF), (0, 0, 1), r=0.0075, h=0.006)
    # 拱顶的小牌：尖朝下，中间一颗铆钉
    tag = [(-0.043, 0.303), (0.043, 0.303), (0.043, 0.266), (0.0, 0.222), (-0.043, 0.266)]; tin = [(-0.034, 0.296), (0.034, 0.296), (0.034, 0.27), (0.0, 0.235), (-0.034, 0.27)]
    top = [v3(p, 0.048) for p in tin]; g.face(top, IRON, toward=(0, 0, 1))
    for i in range(5):
        j = (i + 1) % 5; o = Vector((tag[i][0] + tag[j][0], tag[i][1] + tag[j][1] - 0.54, 0.25))
        g.face([v3(tag[i], 0.018), v3(tag[j], 0.018), v3(tin[j], 0.048), v3(tin[i], 0.048)], EDGE, toward=o)
    g.rivet((0, 0.272, 0.048), (0, 0, 1), r=0.0105, h=0.009)
    # 两侧的加强条：上、中、下三段，中间那段收进去一点、薄一点
    for sx in (-1, 1):
        X = lambda a, b: (min(sx * a, sx * b), max(sx * a, sx * b))
        for (xa, xb), (y0, y1), (z0, z1), bv in ((X(0.150, 0.207), (0.088, 0.218), (-0.004, 0.047), 0.008), (X(0.155, 0.197), (-0.086, 0.086), (-0.002, 0.034), 0.006), (X(0.150, 0.207), (-0.236, -0.088), (-0.004, 0.047), 0.008)):
            g.box((xa, y0, z0), (xb, y1, z1), IRON, bev=bv)
        for x, y, z in ((0.180, 0.186, 0.047), (0.180, 0.118, 0.047), (0.177, 0.045, 0.034), (0.177, -0.045, 0.034), (0.180, -0.118, 0.047), (0.180, -0.196, 0.047)):
            g.rivet((sx * x, y, z), (0, 0, 1), r=0.0085, h=0.007)
    # 底座：横着一整条，上沿正中有个小尖，下沿略微下垂。分成几列，弯的时候才顺
    xs = [-0.207, -0.135, -0.062, 0.0, 0.062, 0.135, 0.207]
    ytop = lambda x: -0.224 + 0.024 * max(0.0, 1 - abs(x) / 0.062); ybot = lambda x: -0.299 - 0.008 * (1 - (x / 0.207) ** 2)
    sec = lambda x: [(ytop(x), -0.004), (ytop(x), 0.042), (ytop(x) - 0.009, 0.051), (ybot(x) + 0.009, 0.051), (ybot(x), 0.042), (ybot(x), -0.004)]
    cs = [IRON, EDGE, IRON, EDGE, DARK, DARK]; cen = lambda x: Vector((x, (ytop(x) + ybot(x)) / 2, 0.02))
    for k in range(len(xs) - 1):
        s0, s1 = sec(xs[k]), sec(xs[k + 1]); c = (cen(xs[k]) + cen(xs[k + 1])) / 2
        for m in range(6):
            n_ = (m + 1) % 6; g.face([bm.verts.new((xs[k], *s0[m])), bm.verts.new((xs[k + 1], *s1[m])), bm.verts.new((xs[k + 1], *s1[n_])), bm.verts.new((xs[k], *s0[n_]))], cs[m], away=c)
    for x, sgn in ((xs[0], -1), (xs[-1], 1)): g.face([bm.verts.new((x, *p)) for p in sec(x)], IRON, toward=(sgn, 0, 0))
    for x in (-0.168, -0.09, 0.0, 0.09, 0.168): g.rivet((x, -0.263 if x else -0.252, 0.051), (0, 0, 1), r=0.0095, h=0.008)
    # 炉栅：一个凸起的圆环（外沿磨亮、内壁被火烤热），里面是炉火，前面五根竖栏，环上一圈小铆钉
    CY, SEG = CY_, 24; ring = [(0.107, 0.019), (0.0995, 0.046), (0.081, 0.046), (0.073, 0.027)]; rc = [EDGE, IRON, WARM]
    circ = lambda r, i: (r * math.cos(2 * math.pi * i / SEG), CY + r * math.sin(2 * math.pi * i / SEG))
    for i in range(SEG):
        for m in range(3):
            (r0, z0), (r1, z1) = ring[m], ring[m + 1]; am = 2 * math.pi * (i + 0.5) / SEG; rad = Vector((math.cos(am), math.sin(am), 0))
            g.face([v3(circ(r0, i), z0), v3(circ(r0, i + 1), z0), v3(circ(r1, i + 1), z1), v3(circ(r1, i), z1)], rc[m], toward=rad * (z1 - z0) + Vector((0, 0, r0 - r1 + 1e-4)))
    ctr = v3((0, CY), 0.027); R = 0.0735
    for i in range(SEG):
        a, b = v3(circ(R, i), 0.027), v3(circ(R, i + 1), 0.027); f = g.face([ctr, a, b], EMBER, toward=(0, 0, 1))
        g.set_uv(f, {ctr: _ember_px(0.5, 0.42), a: _ember_px(0.5 + 0.46 * math.cos(2 * math.pi * i / SEG), 0.5 + 0.46 * math.sin(2 * math.pi * i / SEG)), b: _ember_px(0.5 + 0.46 * math.cos(2 * math.pi * (i + 1) / SEG), 0.5 + 0.46 * math.sin(2 * math.pi * (i + 1) / SEG))})
    for x in (-0.046, -0.023, 0.0, 0.023, 0.046):
        hy = math.sqrt(0.0755 ** 2 - x * x); hw = 0.006
        g.face([v3((x - hw, CY - hy), 0.041), v3((x + hw, CY - hy), 0.041), v3((x + hw, CY + hy), 0.041), v3((x - hw, CY + hy), 0.041)], IRON, toward=(0, 0, 1))
        for s in (-1, 1): g.face([v3((x + s * hw, CY - hy), 0.027), v3((x + s * hw, CY + hy), 0.027), v3((x + s * hw, CY + hy), 0.041), v3((x + s * hw, CY - hy), 0.041)], DARK, toward=(s, 0, 0))
    for i in range(12):
        am = 2 * math.pi * (i + 0.5) / 12; g.rivet((0.0903 * math.cos(am), CY + 0.0903 * math.sin(am), 0.046), (0, 0, 1), r=0.0058, h=0.005, seg=4)
    # 铰链带：炉栅左右各一条，搭到加强条上
    for sx in (-1, 1):
        g.box((min(sx * 0.099, sx * 0.158), CY - 0.019, 0.02), (max(sx * 0.099, sx * 0.158), CY + 0.019, 0.043), IRON, bev=0.005)
        for x in (0.117, 0.142): g.rivet((sx * x, CY, 0.043), (0, 0, 1), r=0.007, h=0.006)
    # 背面两道横筋
    for y in (0.218, -0.128): g.box((-0.15, y - 0.013, -0.009), (0.15, y + 0.013, 0.002), IRON, bev=0.003, skip=("+z",))
    # 背面的臂垫和握把：位置是按站姿算出来的（mount_solve.py 写在 build.json 的 _solve 里），前臂靠在两块垫上，手握着一根竖杆
    BEND = 0.85; so = _mount_info()
    if so.get("arm"):
        e, w = Vector(so["arm"][0]), Vector(so["arm"][1]); u = Vector((w.x - e.x, w.y - e.y, 0)).normalized(); ang = math.atan2(u.y, u.x); depth = max(0.012, -(e.z + w.z) / 2 - 0.046)
        for t in (0.2, 0.72):
            c = e.lerp(w, t); fs = g.box((-0.02, -0.046, -depth), (0.02, 0.046, 0.002), LEATHER, bev=0.006, bcat=DARK, skip=("+z",))
            g.move(fs, Matrix.Translation((c.x, c.y, 0)) @ Matrix.Rotation(ang, 4, "Z"), unbend=BEND)
    if so.get("grip"):
        gp, gd = Vector(so["grip"][0]), Vector(so["grip"][1]).normalized(); hl = 0.062
        if gd.y < 0: gd = -gd
        R = Vector((0, 1, 0)).rotation_difference(gd).to_matrix().to_4x4()
        fs = g.lathe([(-hl, 0.0), (-hl, 0.0135), (hl, 0.0135), (hl, 0.0)], [DARK, LEATHER, DARK], seg=6, smooth=(1,), cyl_uv=(1,)); g.move(fs, Matrix.Translation(gp) @ R, unbend=BEND)
        for sgn in (-1, 1):                                      # 握把两头的支脚，接到盾背上
            q = gp + gd * (hl - 0.008) * sgn; fs = g.box((q.x - 0.011, q.y - 0.011, q.z - 0.004), (q.x + 0.011, q.y + 0.011, 0.002), IRON, bev=0.003, skip=("+z",)); g.move(fs, Matrix.Identity(4), unbend=BEND)
    return g.finish("gorran_shield", bend=BEND)


def _mount_info():
    """build.json 里盾那一项的 _solve（没有就返回空，盾照样能建，只是背面没有臂垫和握把）"""
    try:
        cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "build.json"), encoding="utf-8"))
        return next(x for x in cfg["gear"] if x.get("mount") == "forearm").get("_solve", {})
    except Exception: return {}
