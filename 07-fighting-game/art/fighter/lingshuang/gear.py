"""凌霜的长刀「霜刃」，用代码建（hero_build.py 的 gear 里 type 是 script，func 是 make_sword）。

做法：侧面轮廓直接从设定图（weapon_concept.png）里量（sword_profile.py → work/sword_profile.npz），
每一列给刀身的上沿（刀背）和下沿（刃口），按真刀的截面拉出厚度：刀背平、刀背下面一道血槽、镐线以下逐渐收薄到刃口。
贴图是设定图本身裁出来的（sword_tex.py → work/sword_base.png、sword_mr.png），UV 就是设定图上的像素位置，侧面看和设定图一模一样。
柄、柄头、环首是按轮廓做的椭圆截面旋转体；刀镡是一块椭圆的厚片；环首是一个圆环。

握持坐标（hero_build.py 的约定）：原点是右手握的位置（拳心，离刀镡约 0.03），+Y 是刀尖方向（从拳眼伸出去），
-Z 是刃口方向（顺着前臂往外），X 是刀身厚度方向。单位：身高是 1；整把刀长 0.62（刀身约 0.45、柄连环首约 0.16）。
材质名 weapon（游戏靠这个前缀认武器）。
"""
import bpy, bmesh, math, os, json
import numpy as np
from mathutils import Vector

D = os.path.dirname(os.path.abspath(__file__))
TOTAL = 0.62


def _smooth(a, k):
    out = a.copy()
    for i in range(len(a)):
        lo, hi = max(0, i - k), min(len(a), i + k + 1); out[i] = np.median(a[lo:hi])
    return out


def make_sword():
    p = np.load(os.path.join(D, "work/sword_profile.npz")); top = p["top"].astype(float); bot = p["bot"].astype(float); x0 = int(p["x0"]); x1 = int(p["x1"])
    cr = json.load(open(os.path.join(D, "work/sword_crop.json")))
    s = TOTAL / (x1 - x0)                                        # 每个像素多长
    GX, GY = 655.0, 772.0                                        # 握点在设定图上的像素位置
    P = lambda x, y, th=0.0: Vector((th, (x - GX) * s, -(y - GY) * s))
    UV = lambda x, y: ((x - cr["x0"]) / (cr["x1"] - cr["x0"]), 1 - (y - cr["y0"]) / (cr["y1"] - cr["y0"]))
    topS = _smooth(top, 8); botS = _smooth(bot, 8)
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new("UVMap")

    def face(vs, uvs):
        try: f = bm.faces.new(vs)
        except ValueError: return None
        for lp, uv in zip(f.loops, uvs): lp[uvl].uv = uv
        return f

    # ---------------- 刀身 ----------------
    BX0, BX1 = 822, x1                                           # 刀身从刀镡后面一点开始，到刀尖
    cols = list(range(BX0, BX1 - 2, 6)) + [BX1 - 1]
    # 截面：w 是从刀背(0)到刃口(1)的比例，h 是半厚（身高 1 的单位）
    W_ = [0.0, 0.10, 0.17, 0.24, 0.32, 0.90, 1.0]
    rows = []
    for x in cols:
        t = top[x]; b = bot[x]                                    # 刀身的轮廓在 sword_profile.npz 里已经拟合平滑过
        if b - t < 2: b = t + 2
        k = (x - BX0) / (BX1 - BX0)
        thick = 0.0019 * (1 - 0.45 * k)                          # 刀背半厚：根部约 6.6 毫米全厚（按 1.74 米身高），往刀尖收到一半
        fl = 0.0
        if 905 < x < 2430: fl = min(1, (x - 905) / 60, (2430 - x) / 90) * 0.0011      # 血槽的深度（半厚里挖掉多少）
        H = [thick * 0.92, thick, thick - fl, thick, thick * 0.98, thick * 0.22, 0.00012]
        if x > 2470:                                              # 刀尖段（切先）：整体收薄，镐线并到刀背
            kk = (x - 2470) / (BX1 - 2470); H = [h * (1 - 0.6 * kk) for h in H]
        ring = []
        for w, h in zip(W_, H):
            y = t + (b - t) * w; ring.append((x, y, h))
        rows.append(ring)
    NV = len(W_)
    vL = [[bm.verts.new(P(x, y, h)) for (x, y, h) in r] for r in rows]
    vR = [[bm.verts.new(P(x, y, -h)) for (x, y, h) in r] for r in rows]
    for i in range(len(rows) - 1):
        a, b_ = rows[i], rows[i + 1]
        for j in range(NV - 1):
            uv = [UV(a[j][0], a[j][1]), UV(b_[j][0], b_[j][1]), UV(b_[j + 1][0], b_[j + 1][1]), UV(a[j + 1][0], a[j + 1][1])]
            face([vL[i][j], vL[i + 1][j], vL[i + 1][j + 1], vL[i][j + 1]], uv)
            face([vR[i][j + 1], vR[i + 1][j + 1], vR[i + 1][j], vR[i][j]], [uv[3], uv[2], uv[1], uv[0]])
        # 刃口：两边在刃线上合拢
        uvE = [UV(a[-1][0], a[-1][1]), UV(b_[-1][0], b_[-1][1])]
        face([vL[i][-1], vL[i + 1][-1], vR[i + 1][-1], vR[i][-1]], [uvE[0], uvE[1], uvE[1], uvE[0]])
        # 刀背：平的一条
        uvS = [UV(a[0][0], a[0][1]), UV(b_[0][0], b_[0][1])]
        face([vR[i][0], vR[i + 1][0], vL[i + 1][0], vL[i][0]], [uvS[0], uvS[1], uvS[1], uvS[0]])
    # 两头封口
    for i, flip in ((0, False), (len(rows) - 1, True)):
        vs = vL[i] + vR[i][::-1]; uvs = [UV(x, y) for (x, y, h) in rows[i]] + [UV(x, y) for (x, y, h) in rows[i][::-1]]
        if flip: vs = vs[::-1]; uvs = uvs[::-1]
        face(vs, uvs)

    # ---------------- 柄（环首到刀镡后的柄头）：椭圆截面的旋转体 ----------------
    def lathe(xa, xb, step, depth, segs=20, ycen=None):
        cs = list(range(xa, xb, step)) + [xb]; rings = []; ruv = []
        for x in cs:
            t = topS[x]; b = botS[x]; c = (t + b) / 2 if ycen is None else ycen; hy = (b - t) / 2
            rr = []; uu = []
            for k in range(segs):
                a = 2 * math.pi * k / segs; yy = c - math.cos(a) * hy; th = math.sin(a) * hy * depth * s
                rr.append(bm.verts.new(P(x, yy, th))); uu.append(UV(x, yy))
            rings.append(rr); ruv.append(uu)
        for i in range(len(cs) - 1):
            for k in range(segs):
                k2 = (k + 1) % segs
                face([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], [ruv[i][k], ruv[i][k2], ruv[i + 1][k2], ruv[i + 1][k]])
        for i, flip in ((0, True), (len(cs) - 1, False)):
            vs = rings[i][:]; uu = ruv[i][:]
            if flip: vs = vs[::-1]; uu = uu[::-1]
            face(vs, uu)
    lathe(252, 280, 4, 0.85)                                     # 柄头（环首下面的金属箍）
    lathe(278, 738, 6, 0.78)                                     # 缠绳的柄
    lathe(736, 790, 4, 0.82)                                     # 刀镡前的箍（鎺）

    # ---------------- 刀镡：椭圆厚片 ----------------
    cy = (top[800] + bot[800]) / 2; hz = (bot[800] - top[800]) / 2; hx = hz * 0.72; ga, gb = 786, 806; seg = 40
    f0 = []; f1 = []; u0 = []
    for k in range(seg):
        a = 2 * math.pi * k / seg; yy = cy - math.cos(a) * hz; th = math.sin(a) * hx * s
        f0.append(bm.verts.new(P(ga, yy, th))); f1.append(bm.verts.new(P(gb, yy, th)))
        u0.append(UV(780 + 40 * (0.5 + 0.5 * math.sin(a)), yy))
    for k in range(seg):
        k2 = (k + 1) % seg; ue = UV(796, top[800] + 6)            # 刀镡的外缘：取设定图上刀镡边缘那一小块银色
        face([f0[k], f0[k2], f1[k2], f1[k]], [ue, ue, ue, ue])
    face(f0[::-1], u0[::-1]); face(f1, u0)

    # ---------------- 环首：圆环，在刀身所在的平面里 ----------------
    rc = Vector((197.0, 771.0)); R1 = 45.0; R2 = 12.5; NA, NB = 32, 12; tor = []
    for i in range(NA):
        a = 2 * math.pi * i / NA; ring = []
        for j in range(NB):
            b = 2 * math.pi * j / NB; rr = R1 + R2 * math.cos(b)
            x = rc.x + rr * math.cos(a); y = rc.y + rr * math.sin(a); th = R2 * math.sin(b) * s
            ring.append((bm.verts.new(P(x, y, th)), UV(x, y)))
        tor.append(ring)
    for i in range(NA):
        for j in range(NB):
            i2 = (i + 1) % NA; j2 = (j + 1) % NB; q = [tor[i][j], tor[i2][j], tor[i2][j2], tor[i][j2]]
            face([v for v, _ in q], [u for _, u in q])

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("weapon"); bm.to_mesh(me); bm.free()
    for poly in me.polygons: poly.use_smooth = True
    try: me.set_sharp_from_angle(angle=math.radians(35))
    except Exception: pass
    me.materials.append(_material())
    tip = max((v.co for v in me.vertices), key=lambda c: c.y)
    print("SWORD verts", len(me.vertices), "tip", [round(c, 4) for c in tip], "pommel y", round(min(v.co.y for v in me.vertices), 4))
    return me


def _material():
    m = bpy.data.materials.new("weapon"); m.use_nodes = True; nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tb = nt.nodes.new("ShaderNodeTexImage"); tb.image = bpy.data.images.load(os.path.join(D, "work/sword_base.png")); tb.image.pack()
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
    tm = nt.nodes.new("ShaderNodeTexImage"); tm.image = bpy.data.images.load(os.path.join(D, "work/sword_mr.png")); tm.image.colorspace_settings.name = "Non-Color"; tm.image.pack()
    sp = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(tm.outputs["Color"], sp.inputs["Color"])
    nt.links.new(sp.outputs["Green"], bsdf.inputs["Roughness"]); nt.links.new(sp.outputs["Blue"], bsdf.inputs["Metallic"])
    return m
