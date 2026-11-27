"""赫达 · 缚钳的两件硬东西，都用代码建（形状简单，图转 3D 反而不稳）：

  make_tongs  长柄火钳。给 tools/blender/hero_build.py 的 rig 一步用（build.json 的 gear 里 type 是 script）。
              握持坐标：原点是右手握的位置，+Y 是钳口那一端，X 是钳口张开的方向，Z 是厚度。总长 1.25（身高是 1），
              握点在离柄尾 0.37 的地方（柄尾在 Y=-0.4625，钳口尖在 Y=+0.7875）。brief 写约 0.3，0.3 的话拄地时手要垂到大腿中部、只能深蹲，取 0.37。
              设计图（concepts/heroes/h8-hedda-weapon.png）里两根柄是分开的，这里并拢成一束、下段用皮条缠在一起，一只手握得住。
              材质：weapon（铁和皮，共用一张贴图）、weapon_hot（钳口前端烧成暗红，带一点自发光）。名字都以 weapon 开头，游戏靠它认武器。
  make_forge  背上的熔炉和烟囱。给 art/hero/hedda/add_forge.py 用（它把炉子摆到背上、合进身体的网格、只蒙在 Spine2 上）。
              炉子自己的坐标：Z 朝上（炉底在 Z=0），+Y 朝背后（Y=0 是贴着后背的那一面），+X 是角色的左手边。单位是身高 1。
              圆筒炉身（上面一圈略宽的炉箍）、四道铁箍和铆钉、背面三条竖铁条、右后腰一扇透橙光的小炉门（两列三排的炉栅）、
              左上方斜伸出去的一根方烟囱（顶比发髻高约半个头）。
              材质：forge（铁和皮，和火钳同一张贴图）、forge_fire（炉门里的火，带自发光）。名字不以 weapon 开头：游戏会把 weapon 材质当武器找刀尖。
贴图都是这里用代码画的（numpy），颜色照设计图：黑铁 #2E2A28、焦褐皮 #5A3A26、炉心金 #FFC864。
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
def _scratch(col, rng, n, lo, hi, lmin=10, lmax=60):
    h, w = col.shape[:2]
    for _ in range(n):
        x, y = rng.random() * w, rng.random() * h; a = rng.random() * math.pi; L = int(lmin + rng.random() * (lmax - lmin)); d = lo + rng.random() * (hi - lo)
        t = np.arange(L); xi = np.clip((x + math.cos(a) * t).astype(int), 0, w - 1); yi = np.clip((y + math.sin(a) * t).astype(int), 0, h - 1)
        col[yi, xi] = np.clip(col[yi, xi] + d * np.sin(np.pi * t / L)[:, None], 0, 1)


def _atlas():
    rng = np.random.default_rng(8); img = np.zeros((TEX, TEX, 3), np.float32)
    def blk(nm): x0, y0, x1, y1 = REG[nm]; return y1 - y0, x1 - x0, (slice(y0, y1), slice(x0, x1))
    # 黑铁：一块块竖着拼的铁板（u 方向每 1/8 一道接缝，缝两边一排铆钉），大块的明暗、煤灰、锈、磨亮的划痕
    h, w, sl = blk("iron"); n = _fbm(h, w, (120, 40, 12), (0.5, 0.3, 0.2), rng, 1.7); fine = _fbm(h, w, (5, 2), (0.6, 0.4), rng, 1.4)
    col = np.asarray((0.25, 0.245, 0.255), np.float32)[None, None] * (0.8 + 0.55 * (n - 0.5) + 0.16 * (fine - 0.5))[..., None]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); pw = w / 8.0; du = (xx % pw); dseam = np.minimum(du, pw - du)
    panel = (xx // pw).astype(int); col *= (1 + (rng.random(8).astype(np.float32)[panel] - 0.5) * 0.18)[..., None]
    col *= (1 - 0.55 * _ss(3.5, 0.0, dseam))[..., None]                                   # 接缝：暗线
    col = _mix(col, (0.46, 0.45, 0.45), (_ss(3.0, 4.5, dseam) * _ss(8.0, 5.0, dseam)) * 0.5)   # 缝边磨亮一线
    for sx in (11.0, pw - 11.0):                                                          # 缝两边的铆钉
        for k in range(int(h / 42) + 1):
            cx_ = (np.arange(8) * pw + sx)[:, None, None]; cy_ = 21 + k * 42
            d = np.min(np.hypot(xx[None] - cx_, yy[None] - cy_), axis=0) / 5.5
            col = _mix(col, (0.5, 0.49, 0.48), np.clip(1 - d, 0, 1) * 0.8); col *= (1 - 0.35 * np.clip(1 - np.abs(d - 1.15) * 3, 0, 1))[..., None]
    soot = _ss(0.55, 0.85, _fbm(h, w, (90, 30), (0.6, 0.4), rng)); col *= (1 - 0.35 * soot)[..., None]
    rust = _ss(0.7, 0.92, _fbm(h, w, (70, 20, 6), (0.5, 0.3, 0.2), rng)) * 0.5
    col = col * (1 - rust[..., None]) + np.asarray((0.34, 0.18, 0.1), np.float32) * (0.7 + 0.6 * n)[..., None] * rust[..., None]
    _scratch(col, rng, 90, 0.06, 0.16); _scratch(col, rng, 30, -0.06, -0.03); img[sl] = col
    # 磨亮的边（箍的外沿、钳子的棱）：钢灰带划痕
    h, w, sl = blk("edge"); n = _fbm(h, w, (30, 9, 3), (0.5, 0.3, 0.2), rng)
    col = np.asarray((0.56, 0.55, 0.54), np.float32)[None, None] * (0.82 + 0.4 * (n - 0.5))[..., None]
    col = _mix(col, (0.26, 0.18, 0.14), _ss(0.75, 0.95, _fbm(h, w, (18, 6), (0.6, 0.4), rng)) * 0.45)
    _scratch(col, rng, 40, -0.18, -0.07, 8, 40); _scratch(col, rng, 25, 0.06, 0.16, 8, 40); img[sl] = col
    # 暗处（缝、内壁、炉盖里面）
    h, w, sl = blk("dark"); n = _fbm(h, w, (30, 9, 3), (0.5, 0.3, 0.2), rng)
    col = np.asarray((0.11, 0.105, 0.105), np.float32)[None, None] * (0.75 + 0.7 * (n - 0.5))[..., None]; img[sl] = col
    # 铆钉：中间亮四周暗（锥尖对着这一块的正中）
    h, w, sl = blk("rivet"); yy, xx = np.mgrid[0:h, 0:w]; d = np.hypot(xx - w / 2 + 8, yy - h / 2 - 8) / (min(w, h) / 2)
    col = _mix(np.broadcast_to(np.asarray((0.5, 0.48, 0.46), np.float32), (h, w, 3)).copy(), (0.11, 0.1, 0.1), _ss(0.05, 0.85, d))
    col *= (0.85 + 0.3 * _fbm(h, w, (12, 4), (0.6, 0.4), rng))[..., None]; img[sl] = col
    # 皮缠带：一圈圈斜着缠，每圈压着上一圈（一侧亮一侧暗），圈和圈之间一道暗缝。贴图坐标 u 绕柄一圈、v 顺着柄
    h, w, sl = blk("wrap"); yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); band = 34.0
    ph = ((yy + xx * 0.45) % band) / band; n = _fbm(h, w, (20, 6, 2), (0.45, 0.35, 0.2), rng)
    col = np.asarray((0.36, 0.22, 0.14), np.float32)[None, None] * ((0.62 + 0.5 * ph) * (0.8 + 0.45 * (n - 0.5)))[..., None]
    col *= (0.35 + 0.65 * _ss(0.0, 0.12, ph) * (1 - _ss(0.92, 1.0, ph)))[..., None]
    col = _mix(col, (0.5, 0.36, 0.26), _ss(0.8, 0.97, n) * 0.35); img[sl] = col
    # 皮带：焦褐，两边各一道缝线，中间磨得发亮
    h, w, sl = blk("strap"); yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); n = _fbm(h, w, (40, 12, 3), (0.5, 0.3, 0.2), rng)
    col = np.asarray((0.33, 0.21, 0.135), np.float32)[None, None] * (0.75 + 0.5 * (n - 0.5))[..., None]
    v = yy / h; col *= (0.7 + 0.3 * np.sin(np.pi * v))[..., None]
    stitch = ((np.abs(v - 0.12) < 0.012) | (np.abs(v - 0.88) < 0.012)) & ((xx % 14) < 8); col[stitch] = col[stitch] * 0.5 + 0.12
    img[sl] = col
    h, w, sl = blk("spare"); img[sl] = 0.15
    return np.clip(img, 0, 1)


def _hot_tex(n=64):
    """钳口：从根部的黑铁慢慢过渡到前端的暗红（v 从 0 到 1）"""
    rng = np.random.default_rng(3); yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / (n - 1)
    col = _mix(np.broadcast_to(np.asarray((0.2, 0.17, 0.16), np.float32), (n, n, 3)).copy(), (0.32, 0.085, 0.06), _ss(0.1, 0.7, yy))
    col = _mix(col, (0.5, 0.12, 0.06), _ss(0.7, 1.0, yy) * 0.7)
    col *= (0.82 + 0.35 * _fbm(n, n, (10, 4), (0.6, 0.4), rng))[..., None]
    return np.clip(col, 0, 1)


def _fire_tex(n=64):
    """炉门里的火：下面亮金，往上变橙、变红（炉心金 #FFC864）"""
    rng = np.random.default_rng(5); yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / (n - 1)
    col = _mix(np.broadcast_to(np.asarray((1.0, 0.78, 0.39), np.float32), (n, n, 3)).copy(), (0.95, 0.45, 0.1), _ss(0.15, 0.6, yy))
    col = _mix(col, (0.55, 0.15, 0.04), _ss(0.6, 1.0, yy))
    col *= (0.75 + 0.45 * _fbm(n, n, (10, 4), (0.6, 0.4), rng))[..., None]
    return np.clip(col, 0, 1)


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
    atlas = _image("hedda_iron", _atlas())
    if kind == "tongs": return [_mat("weapon", atlas, 0.55, 0.8), _mat("weapon_hot", _image("hedda_hot", _hot_tex()), 0.6, 0.3, 0.2)]
    return [_mat("forge", atlas, 0.6, 0.8), _mat("forge_fire", _image("hedda_fire", _fire_tex()), 0.7, 0.0, 1.0)]


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
    # 烟囱：方的，从炉盖的左后方斜着伸出去（往左、往后歪），顶上一圈略宽的帽檐，口里是黑的
    B = Vector((0.07, R + 0.012, 0.30)); T = Vector((0.142, R + 0.05, 0.488)); d = (T - B).normalized()
    a = Vector((1, 0, 0)); a = (a - d * a.dot(d)).normalized(); b = d.cross(a)
    P = lambda t: B + (T - B) * t
    cs = [(0.0, 0.025), (0.86, 0.025)]
    g.tube([_ring_rect(P(t), a, b, w, w, 0.003) for t, w in cs], IRON, centers=[P(t) for t, _ in cs])
    z_lid = 0.372; t_lid = (z_lid - B.z) / (T.z - B.z)
    g.tube([_ring_rect(P(t_lid - 0.02), a, b, 0.033, 0.033, 0.004), _ring_rect(P(t_lid + 0.06), a, b, 0.031, 0.031, 0.004)], EDGE, centers=[P(t_lid - 0.02), P(t_lid + 0.06)], cap1=DARK)      # 根上的套箍
    g.tube([_ring_rect(P(0.84), a, b, 0.031, 0.031, 0.004), _ring_rect(P(0.86), a, b, 0.034, 0.034, 0.004), _ring_rect(P(1.0), a, b, 0.034, 0.034, 0.004)], [EDGE, IRON], centers=[P(0.84), P(0.86), P(1.0)])      # 帽檐
    g.tube([_ring_rect(P(1.0), a, b, 0.034, 0.034, 0.004), _ring_rect(P(1.0), a, b, 0.022, 0.022, 0.003), _ring_rect(P(0.93), a, b, 0.022, 0.022, 0.003)], [EDGE, DARK], centers=[P(1.0), P(0.999), P(0.93)], cap1=DARK)      # 口
    for t in (0.35, 0.62):                                       # 烟囱上两道细箍
        g.tube([_ring_rect(P(t), a, b, 0.0275, 0.0275, 0.003), _ring_rect(P(t + 0.04), a, b, 0.0275, 0.0275, 0.003)], EDGE, centers=[P(t), P(t + 0.04)])
    return g.finish("hedda_forge", "forge")
