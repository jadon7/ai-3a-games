"""扩建关卡：大厅（原厂房扫描）+ 走廊（用小房间扫描里的墙/地/顶/门框"克隆"拼出来）+ 两间小房间（另一套扫描）。
  blender -b --factory-startup -P scripts/level_build.py -- [build|bake|export|preview ...]
坐标沿用影片/游戏的 Blender 世界坐标（Z 向上），大厅原地不动。
"""
import bpy, bmesh, sys, os, math, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
from common import ROOT, ASSETS, enable_gpu

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["build"]
BLEND = os.path.join(ROOT, "blend", "level.blend")
OUT = os.path.join(ROOT, "game", "assets", "level")

# ---------------------------------------------------------------- 尺寸
ROT = math.radians(114.4703); T_ROOMS = Vector((22.6, -7.70, 0.334))
M_ROOMS = Matrix.Translation(T_ROOMS) @ Matrix.Rotation(ROT, 4, "Z")
# 小房间（摆好之后的世界坐标）
C = dict(xw=20.850, xe=25.632, ys=-6.566, yn=-2.598, zf=0.420, zc=3.721)
B = dict(xw=20.876, xe=25.657, ys=-10.804, yn=-6.758, zf=0.531, zc=3.668)
CDOOR = dict(x0=21.310, x1=22.100, top=2.340)            # C 北墙的门（通走廊）
IDOOR = dict(x0=21.330, x1=22.110, top=2.520, sill=0.583)   # C/B 之间的门
# 大厅南墙的门洞（原来关着的门板拿掉）
HDOOR = dict(x0=17.740, x1=19.250, top=2.530, back=-0.155)
# 走廊内表面
X0, X1, YS, YN, ZF, ZC = 17.0, 25.9, -2.30, -0.45, 0.42, 3.72
WDOOR_Y = None   # 走廊西端外门的 y 范围（搭建时算出来，写进 level.json）


def log(*a):
    print("[level]", *a, flush=True)


# ---------------------------------------------------------------- 导入
def import_scan(folder, prefix, M=None):
    before = set(bpy.data.objects); mb = set(bpy.data.materials)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, folder, "scene.gltf"))
    new = [o for o in bpy.data.objects if o not in before]
    for m in bpy.data.materials:
        if m not in mb:
            m.name = prefix + m.name.split(".")[0]
    bpy.context.view_layer.update()
    meshes = []
    for o in new:
        if o.type == "MESH":
            mw = o.matrix_world.copy()
            if M is not None:
                mw = M @ mw
            o.data.transform(mw)
            if mw.determinant() < 0:
                o.data.flip_normals()
            meshes.append(o)
    for o in meshes:
        o.parent = None; o.matrix_world = Matrix.Identity(4)
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    for i, o in enumerate(meshes):
        o.name = f"{prefix}{i}"
        a = o.data.attributes.get("custom_normal")
        if a is not None:
            o.data.attributes.remove(a)
    return meshes


# ---------------------------------------------------------------- 取一块
def chunk(src, lo, hi, name):
    """把 src 里落在盒子 [lo,hi] 内的面切下来复制成新物体（沿盒子表面切齐）。"""
    lo = Vector(lo); hi = Vector(hi)
    parts = []
    for o in src:
        me = o.data
        n = len(me.vertices)
        co = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        inside = np.all((co > np.array(lo) - 0.25) & (co < np.array(hi) + 0.25), axis=1)
        if not inside.any():
            continue
        bm = bmesh.new(); bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        far = [f for f in bm.faces if not any(inside[v.index] for v in f.verts)]
        bmesh.ops.delete(bm, geom=far, context="FACES")
        for ax in range(3):
            for sgn, val in ((-1, lo[ax]), (1, hi[ax])):
                if not bm.faces:
                    break
                no = Vector((0, 0, 0)); no[ax] = sgn
                pc = Vector((0, 0, 0)); pc[ax] = val
                bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=pc, plane_no=no, clear_outer=True, clear_inner=False)
        if bm.faces:
            m2 = bpy.data.meshes.new(name)
            bm.to_mesh(m2)
            for mat in me.materials:
                m2.materials.append(mat)
            ob = bpy.data.objects.new(name, m2); bpy.context.scene.collection.objects.link(ob)
            parts.append(ob)
        bm.free()
    if not parts:
        raise RuntimeError("empty chunk " + name)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    # 去掉没用到的材质槽
    bpy.ops.object.material_slot_remove_unused()
    return ob


def affine(src_o, src_t, src_n, dst_o, dst_t, dst_n, st=1.0, sn=1.0, sz=1.0):
    """把源坐标架（原点、切向、法向、竖直 Z）映射到目标坐标架；st/sn/sz 是切向/法向/竖直方向的缩放。"""
    S = Matrix((Vector(src_t).to_3d(), Vector(src_n).to_3d(), Vector((0, 0, 1)))).transposed()
    D = Matrix((Vector(dst_t).to_3d() * st, Vector(dst_n).to_3d() * sn, Vector((0, 0, sz)))).transposed()
    R = D @ S.inverted()
    M = Matrix.Translation(Vector(dst_o)) @ R.to_4x4() @ Matrix.Translation(-Vector(src_o))
    return M


def place(ob, M):
    ob.data.transform(M)
    if M.determinant() < 0:
        ob.data.flip_normals()
    ob.data.update()
    return ob


def orient(ob, target_fn):
    """让面法线朝向 target_fn(面中心) 给出的点（烘焙只算正面）。"""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    flip = [f for f in bm.faces if f.normal.dot(target_fn(f.calc_center_median()) - f.calc_center_median()) < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()


def fill_small_holes(ob, max_diag=0.9):
    """把网格上的小破洞补上（扫描墙面上常有没扫到的小块；当外立面用时背后会露黑）。新面的 UV 取洞边顶点原有的 UV。"""
    bm = bmesh.new(); bm.from_mesh(ob.data); uvl = bm.loops.layers.uv.active
    bedges = [e for e in bm.edges if len(e.link_faces) == 1]
    seen = set(); filled = 0
    for e0 in bedges:
        if e0 in seen:
            continue
        comp = []; stack = [e0]; seen.add(e0)
        while stack:
            e = stack.pop(); comp.append(e)
            for v in e.verts:
                for e2 in v.link_edges:
                    if e2 not in seen and len(e2.link_faces) == 1:
                        seen.add(e2); stack.append(e2)
        cos = [v.co for e in comp for v in e.verts]
        mn = Vector([min(c[i] for c in cos) for i in range(3)]); mx = Vector([max(c[i] for c in cos) for i in range(3)])
        if (mx - mn).length > max_diag or len(comp) < 3:
            continue
        vuv = {}
        if uvl is not None:
            for e in comp:
                for v in e.verts:
                    if v not in vuv and v.link_loops:
                        l = v.link_loops[0]; vuv[v] = (l[uvl].uv.copy(), l.face.material_index)
        res = bmesh.ops.edgeloop_fill(bm, edges=comp)
        for f in res.get("faces", []):
            mi = None
            for l in f.loops:
                if l.vert in vuv:
                    l[uvl].uv = vuv[l.vert][0]; mi = vuv[l.vert][1] if mi is None else mi
            if mi is not None:
                f.material_index = mi
            filled += 1
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    log("holes filled", ob.name, filled)


def axis_target(p):          # 走廊中轴线上离 p 最近的点
    return Vector((min(max(p.x, X0 + 0.3), X1 - 0.3), (YS + YN) / 2, (ZF + ZC) / 2))


def quad_obj(name, quads, mat):
    """quads: [(p0,p1,p2,p3), ...]"""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    for q in quads:
        vs = [bm.verts.new(p) for p in q]; bm.faces.new(vs)
    bm.to_mesh(me); bm.free(); me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob


def rect_with_holes(o, u, v, w, h, holes, nu=1, nv=1):
    """平面矩形（原点 o，边向量 u*w、v*h）挖掉若干矩形洞 (u0,u1,v0,v1)，返回四边形列表。"""
    us = sorted({0.0, w} | {c for hl in holes for c in hl[:2]})
    vs = sorted({0.0, h} | {c for hl in holes for c in hl[2:]})
    out = []
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            cu, cv = (us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2
            if any(hl[0] < cu < hl[1] and hl[2] < cv < hl[3] for hl in holes):
                continue
            p = lambda a, b: Vector(o) + Vector(u) * a + Vector(v) * b
            out.append((p(us[i], vs[j]), p(us[i + 1], vs[j]), p(us[i + 1], vs[j + 1]), p(us[i], vs[j + 1])))
    return out


# ================================================================ 多层：楼梯间 + 二楼 + 地下室
FH = 3.65                                   # 层高（楼面到楼面）
SX0, SX1 = X1, X1 + 5.1                     # 楼梯间：接在走廊东端
SY0, SY1 = YS - 0.25, YN + 0.25             # 宽 2.35
FL0, FL1 = SX0 + 1.1, SX0 + 3.9             # 梯段范围（每跑 10 个踏面 × 0.28）
RISE = FH / 22.0                            # 每级高 0.166
YM0, YM1 = (SY0 + SY1) / 2 - 0.075, (SY0 + SY1) / 2 + 0.075      # 两跑之间的隔墙


def copy_ob(ob, name):
    o = ob.copy(); o.data = ob.data.copy(); o.name = name; bpy.context.scene.collection.objects.link(o)
    return o


def cut_box(ob, lo, hi):
    """把物体裁到盒子 [lo,hi] 内（原地）。"""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    for ax in range(3):
        for sgn, val in ((-1, lo[ax]), (1, hi[ax])):
            if not bm.faces:
                break
            no = Vector((0, 0, 0)); no[ax] = sgn; pc = Vector((0, 0, 0)); pc[ax] = val
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=pc, plane_no=no, clear_outer=True)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    return ob


def frame(so, sx, sy, sz, do, dx, dy, dz):
    """把源坐标架（原点 so，轴 sx/sy/sz）映射到目标坐标架。"""
    S = Matrix((Vector(sx), Vector(sy), Vector(sz))).transposed(); D = Matrix((Vector(dx), Vector(dy), Vector(dz))).transposed()
    return Matrix.Translation(Vector(do)) @ (D @ S.inverted()).to_4x4() @ Matrix.Translation(-Vector(so))


def build_multi(E):
    rooms, add, pieces = E["rooms"], E["add"], E["pieces"]
    yE0, yE1, zw0, zw1, W_ = E["yE0"], E["yE1"], E["zw0"], E["zw1"], E["W_"]
    LW, HW = yE1 - yE0, zw1 - zw0
    bmat = bpy.data.materials.new("Backer")
    # ---------- 母件：一整面墙、一整块地、一整块顶，后面的零件都从它们上裁
    mwall = chunk(rooms, (C["xe"] - 0.035, yE0, zw0), (C["xe"] + 0.12, yE1, zw1), "M_wall")
    mfloor = chunk(rooms, (20.90, -6.45, C["zf"] - 0.12), (25.58, -2.70, C["zf"] + 0.30), "M_floor")
    mceil = chunk(rooms, (20.90, -6.45, C["zc"] - 0.42), (25.58, -2.70, C["zc"] + 0.08), "M_ceil")
    FLX, FLY = 4.68, 3.75
    cnt = [0]

    def wallp(name, o, t, n, length, z0, height, off=0.0, zoff=0.0, probe="Ceast"):
        """一段墙：原点 o（墙脚起点），沿 t 方向长 length，朝向 n，底高 z0，高 height。"""
        seg = min(length, LW); hseg = min(height, HW)
        off = min(off, LW - seg); zoff = min(zoff, HW - hseg)
        ob = copy_ob(mwall, name)
        cut_box(ob, (C["xe"] - 1, yE0 + off, zw0 + zoff), (C["xe"] + 1, yE0 + off + seg, zw0 + zoff + hseg))
        M = frame((C["xe"], yE0 + off, zw0 + zoff), (0, 1, 0), (-1, 0, 0), (0, 0, 1),
                  (o[0], o[1], z0), Vector(t).to_3d() * (length / seg), Vector(n).to_3d(), Vector((0, 0, height / hseg)))
        place(ob, M); nn = Vector(n).to_3d()
        orient(ob, lambda p: p + nn); add(ob, probe); return ob

    def slab(name, master, x0, y0, lx, ly, z, up=True, probe="Cfloor", srcz=None):
        """一块水平面（地面或顶面）：左下角 (x0,y0)，尺寸 lx×ly，高度 z。"""
        cnt[0] += 1
        sx_, sy_ = min(lx, FLX), min(ly, FLY)
        ox = 20.90 + ((cnt[0] * 0.37) % max(1e-3, FLX - sx_)) if FLX > sx_ else 20.90
        oy = -6.45 + ((cnt[0] * 0.53) % max(1e-3, FLY - sy_)) if FLY > sy_ else -6.45
        ob = copy_ob(master, name)
        cut_box(ob, (ox, oy, -99), (ox + sx_, oy + sy_, 99))
        zref = C["zf"] if master is mfloor else C["zc"]
        place(ob, Matrix.Translation((x0, y0, z)) @ Matrix.Diagonal((lx / sx_, ly / sy_, 1, 1)) @ Matrix.Translation((-ox, -oy, -zref)))
        d = Vector((0, 0, 1 if up else -1)); orient(ob, lambda p: p + d); add(ob, probe); return ob

    # ---------- 楼梯
    tread_m = [cut_box(copy_ob(mfloor, f"M_tread{i}"), (21.2 + i * 0.9, -6.2, -99), (21.2 + i * 0.9 + 0.31, -5.1, 99)) for i in range(3)]
    for s_ in (-1, 0):
        for nm, y0, y1, xb, dirx, zb in ((f"A{s_}", SY0, YM0, FL0, 1, ZF + s_ * FH), (f"B{s_}", YM1, SY1, FL1, -1, ZF + s_ * FH + FH / 2)):
            wy = y1 - y0
            for i in range(11):
                xr = xb + dirx * i * 0.28
                # 踢面：把一条地面竖起来
                tm = tread_m[i % 3]; ox = 21.2 + (i % 3) * 0.9
                r = copy_ob(tm, f"St_{nm}_r{i}"); cut_box(r, (ox, -6.2, -99), (ox + RISE + 0.004, -5.1, 99))
                place(r, frame((ox, -6.2, C["zf"]), (1, 0, 0), (0, 1, 0), (0, 0, 1), (xr, y0, zb + i * RISE), (0, 0, 1), (0, wy / 1.1, 0), (-dirx, 0, 0)))
                d = Vector((-dirx, 0, 0)); orient(r, lambda p: p + d); add(r, "Cfloor")
                if i < 10:        # 踏面
                    t = copy_ob(tm, f"St_{nm}_t{i}")
                    x_lo = xr - 0.015 if dirx > 0 else xr - 0.28
                    place(t, Matrix.Translation((x_lo, y0, zb + (i + 1) * RISE)) @ Matrix.Diagonal((0.295 / 0.31, wy / 1.1, 1, 1)) @ Matrix.Translation((-ox, 6.2, -C["zf"])))
                    orient(t, lambda p: p + Vector((0, 0, 1))); add(t, "Cfloor")
            if s_ == 0:           # 梯段底面（从下一层楼梯往上看得到）
                ang = math.atan2(FH / 2, 3.08)
                dx_ = Vector((dirx * math.cos(ang), 0, math.sin(ang)))
                so = copy_ob(mwall, f"Sof_{nm}"); L_ = math.hypot(3.08, FH / 2) + 0.1
                cut_box(so, (C["xe"] - 1, yE0, zw0 + 0.6), (C["xe"] + 1, yE0 + min(L_, LW), zw0 + 0.6 + 1.1))
                place(so, frame((C["xe"], yE0, zw0 + 0.6), (0, 1, 0), (0, 0, 1), (-1, 0, 0), (xb - dirx * 0.05, y0, zb - 0.2), dx_ * (L_ / min(L_, LW)), (0, wy / 1.1, 0), dx_.cross(Vector((0, 1, 0))) * (1 if dirx > 0 else -1)))
                orient(so, lambda p: p + Vector((0, 0, -1))); add(so, "Ceast")
    # ---------- 平台：各层楼面平台（西）和半层平台（东），以及它们的底面
    for s_ in (-1, 0, 1):
        slab(f"LandW{s_}", mfloor, SX0 - 0.03, SY0 - 0.03, FL0 - SX0 + 0.05, SY1 - SY0 + 0.06, ZF + s_ * FH)
        if s_ >= 0:
            slab(f"LandWc{s_}", mceil, SX0 - 0.03, SY0 - 0.03, FL0 - SX0 + 0.05, SY1 - SY0 + 0.06, ZF + s_ * FH - 0.2, up=False, probe="Cceil")
    for s_ in (-1, 0):
        slab(f"LandE{s_}", mfloor, FL1 - 0.02, SY0 - 0.03, SX1 - FL1 + 0.05, SY1 - SY0 + 0.06, ZF + s_ * FH + FH / 2)
        if s_ == 0:
            slab(f"LandEc{s_}", mceil, FL1 - 0.02, SY0 - 0.03, SX1 - FL1 + 0.05, SY1 - SY0 + 0.06, ZF + s_ * FH + FH / 2 - 0.2, up=False, probe="Cceil")
    for k, x0 in enumerate((SX0 - 0.03, SX0 + 2.55)):          # 顶棚
        slab(f"StTop{k}", mceil, x0, SY0 - 0.03, 2.6, SY1 - SY0 + 0.06, ZC + FH, up=False, probe="Cceil")
    # ---------- 墙：外墙三层、中间隔墙、东墙（半层平台处有窗）、西侧门垛和楼板边
    zB, zT = ZF - FH, ZC + FH + 0.04
    for s_ in (-1, 0, 1):
        z0 = ZF + s_ * FH; h = FH if s_ < 1 else zT - z0
        wallp(f"StS{s_}", (SX0 - 0.03, SY0), (1, 0), (0, 1), SX1 - SX0 + 0.06, z0, h, off=0.0)
        wallp(f"StN{s_}", (SX1 + 0.03, SY1), (-1, 0), (0, -1), SX1 - SX0 + 0.06, z0, h, off=0.0)
        for nm, y0 in (("a", SY0 - 0.02), ("b", YN)):          # 西侧门垛（走廊洞口两边各 0.25）
            wallp(f"StW{nm}{s_}", (SX0, y0 + (0.27 if nm == "a" else 0.27)), (0, -1), (1, 0), 0.27, z0, h, off=0.3 + 0.4 * (s_ + 1))
        if s_ < 1:                                             # 走廊洞口上方的楼板边
            wallp(f"StWs{s_}", (SX0, YN + 0.01), (0, -1), (1, 0), YN - YS + 0.02, ZC + s_ * FH, ZF + FH - ZC, off=1.0, zoff=2.2)
    zs0 = ZF - FH; zs1 = ZF + FH + 1.0; hs = (zs1 - zs0) / 3
    for k in range(3):
        wallp(f"SpS{k}", (FL1 + 0.02, YM0), (-1, 0), (0, -1), FL1 - FL0 + 0.04, zs0 + k * hs, hs, off=0.4)
        wallp(f"SpN{k}", (FL0 - 0.02, YM1), (1, 0), (0, 1), FL1 - FL0 + 0.04, zs0 + k * hs, hs, off=0.9)
        wallp(f"SpW{k}", (FL0 - 0.02, YM1 + 0.005), (0, -1), (-1, 0), YM1 - YM0 + 0.01, zs0 + k * hs, hs, off=2.0 + 0.3 * k)
        wallp(f"SpE{k}", (FL1 + 0.02, YM0 - 0.005), (0, 1), (1, 0), YM1 - YM0 + 0.01, zs0 + k * hs, hs, off=2.6 + 0.3 * k)
    slab("SpTop", mfloor, FL0 - 0.02, YM0, FL1 - FL0 + 0.04, YM1 - YM0, zs1)
    # 二楼：南半边是楼梯井，平台边上砌一道矮墙；地下室：北半边梯段底下封死
    wallp("ParF2a", (FL0, YM0), (0, -1), (-1, 0), YM0 - SY0, ZF + FH, 1.0, off=1.2, zoff=0.2)
    wallp("ParF2b", (FL0 + 0.1, SY0), (0, 1), (1, 0), YM0 - SY0, ZF + FH - 0.6, 1.6, off=1.2, zoff=0.2)
    slab("ParF2t", mfloor, FL0, SY0, 0.1, YM0 - SY0, ZF + FH + 1.0)
    wallp("CloB1", (FL0, SY1), (0, -1), (-1, 0), SY1 - YM1, ZF - FH, 3.5, off=0.5)
    # 东墙：带窗的那块（原来走廊东端的窗墙）挪到半层平台的高度，上下用实墙补齐
    ee = E["EndE"]; yc = (YS + YN) / 2
    ee.data.transform(Matrix.Translation((SX1 - X1, yc, FH / 2)) @ Matrix.Diagonal((1, (SY1 - SY0 + 0.06) / (W_ + 0.06), 1, 1)) @ Matrix.Translation((0, -yc, 0)))
    ee.name = "StE_win"
    hlow = ZF + FH / 2 - zB
    for k in range(2):
        wallp(f"StE_lo{k}", (SX1, SY0 - 0.03), (0, 1), (-1, 0), SY1 - SY0 + 0.06, zB + k * hlow / 2, hlow / 2, off=0.7 * k)
    wallp("StE_hi", (SX1, SY0 - 0.03), (0, 1), (-1, 0), SY1 - SY0 + 0.06, ZC + FH / 2, zT - (ZC + FH / 2), off=1.2, zoff=1.0)
    swin = dict(y0=yc + (E["ewin"]["y0"] - yc) * (SY1 - SY0 + 0.06) / (W_ + 0.06), y1=yc + (E["ewin"]["y1"] - yc) * (SY1 - SY0 + 0.06) / (W_ + 0.06), z0=E["ewin"]["z0"] + FH / 2, z1=E["ewin"]["z1"] + FH / 2)

    # ---------- 二楼和地下室的走廊：一楼走廊的零件原样搬上去/搬下来，再把不一样的地方换掉
    base = {o.name: o for o in pieces}
    for dz, tag in ((FH, "2"), (-FH, "0")):
        for nm in ("FloorA", "FloorB", "CeilA", "CeilB", "WallS_W", "WallS_E", "WallN_W", "WallN_E1", "WallN_E2", "OverS", "LinC_L", "LinC_R", "LinC_T", "LinC_F"):
            o = copy_ob(base[nm], f"{nm}_{tag}"); o.data.transform(Matrix.Translation((0, 0, dz))); o["probe"] = base[nm]["probe"]; pieces.append(o)
        # 北墙：一楼通大厅的门洞在别的楼层是实墙
        wallp(f"NFill_{tag}", (HDOOR["x1"] + 0.01, YN), (-1, 0), (0, -1), HDOOR["x1"] - HDOOR["x0"] + 0.02, ZF + dz, ZC - ZF, off=1.6)
        if tag == "2":            # 西端：二楼是窗（把窗墙镜像过去），地下室是实墙
            o = copy_ob(ee, "EndW_2")
            place(o, Matrix.Translation((X0, 0, FH / 2)) @ Matrix.Diagonal((-1, (W_ + 0.06) / (SY1 - SY0 + 0.06), 1, 1)) @ Matrix.Translation((-SX1, 0, 0)))
            o.data.transform(Matrix.Translation((0, yc - yc * (W_ + 0.06) / (SY1 - SY0 + 0.06), 0)))
            orient(o, lambda p: p + Vector((1, 0, 0))); add(o, "Cwest")
        else:
            wallp("EndW_0", (X0, YN + 0.03), (0, -1), (1, 0), W_ + 0.06, ZF + dz, ZC - ZF, off=1.9)
    # 二楼走廊南墙的外立面（从二楼 C 屋西窗看得到）
    o = copy_ob(base["ExtS"], "ExtS_2"); o.data.transform(Matrix.Translation((0, 0, FH))); o["probe"] = "Ceast"; pieces.append(o)
    # 地下室：两间小房间的窗在地面以下，用墙封死（封板放在窗洞外沿，后面再垫黑板防漏光）
    qs = []
    for nm, o_, t_, n_, L_, z0, h in (("SealC", (C["xw"] - 0.47, -4.95), (0, 1), (1, 0), 1.95, C["zf"] + 0.8, 1.7),
                                      ("SealB", (B["xw"] - 0.47, -10.40), (0, 1), (1, 0), 1.95, B["zf"] + 0.65, 1.9),
                                      ("SealBS", (22.25, B["ys"] - 0.53), (-1, 0), (0, 1), 1.05, B["zf"] + 0.5, 2.4)):
        wallp(nm, o_, t_, n_, L_, z0 - FH, h, off=0.8, zoff=0.5)
        a = Vector(o_).to_3d() - Vector(n_).to_3d() * 0.06 - Vector(t_).to_3d() * 0.4; a.z = z0 - FH - 0.4
        qs += rect_with_holes(a, Vector(t_).to_3d(), (0, 0, 1), L_ + 0.8, h + 0.8, [])

    # ---------- 背板：每层走廊一圈 + 楼梯间一圈（门窗处留洞）
    g = 0.07; wd, wtop, ewin = E["wd"], E["wtop"], E["ewin"]
    for dz, tag in ((0.0, "1"), (FH, "2"), (-FH, "0")):
        z0 = ZF + dz - g; hh = ZC - ZF + 2 * g
        qs += rect_with_holes((X0 - g, YS - g, z0), (1, 0, 0), (0, 0, 1), X1 - X0 + g, hh, [(CDOOR["x0"] - 0.02 - X0 + g, CDOOR["x1"] + 0.02 - X0 + g, 0, CDOOR["top"] + 0.02 - ZF + g)])
        qs += rect_with_holes((X0 - g, YN + g, z0), (1, 0, 0), (0, 0, 1), X1 - X0 + g, hh, [(HDOOR["x0"] - 0.02 - X0 + g, HDOOR["x1"] + 0.02 - X0 + g, 0, HDOOR["top"] + 0.03 - ZF + g)] if tag == "1" else [])
        wh = [(wd[0] - 0.03 - YS + g, wd[1] + 0.03 - YS + g, 0, wtop + 0.03 - ZF + g)] if tag == "1" else ([(ewin["y0"] - 0.08 - YS + g, ewin["y1"] + 0.08 - YS + g, ewin["z0"] - 0.1 - ZF + g, ewin["z1"] + 0.12 - ZF + g)] if tag == "2" else [])
        qs += rect_with_holes((X0 - g - (0.42 if tag == "2" else 0), YS - g, z0), (0, 1, 0), (0, 0, 1), W_ + 2 * g, hh, wh)
        qs += rect_with_holes((X0 - g - 0.42, YS - g, z0), (1, 0, 0), (0, 1, 0), X1 - X0 + g + 0.42, W_ + 2 * g, [])
        qs += rect_with_holes((X0 - g - 0.42, YS - g, z0 + hh + 0.1), (1, 0, 0), (0, 1, 0), X1 - X0 + g + 0.42, W_ + 2 * g, [])
        if tag == "2":
            for yy in (YS - g, YN + g):
                qs += rect_with_holes((X0 - g - 0.42, yy, z0), (1, 0, 0), (0, 0, 1), 0.42, hh, [])
    bz0, bh = zB - g, zT - zB + 2 * g + 0.1
    qs += rect_with_holes((SX0 - g, SY0 - g, bz0), (1, 0, 0), (0, 0, 1), SX1 - SX0 + 2 * g + 0.42, bh, [])
    qs += rect_with_holes((SX0 - g, SY1 + g, bz0), (1, 0, 0), (0, 0, 1), SX1 - SX0 + 2 * g + 0.42, bh, [])
    qs += rect_with_holes((SX1 + g + 0.42, SY0 - g, bz0), (0, 1, 0), (0, 0, 1), SY1 - SY0 + 2 * g, bh, [(swin["y0"] - 0.1 - SY0 + g, swin["y1"] + 0.1 - SY0 + g, swin["z0"] - 0.12 - bz0, swin["z1"] + 0.14 - bz0)])
    qs += rect_with_holes((SX0 - g, SY0 - g, bz0), (0, 1, 0), (0, 0, 1), SY1 - SY0 + 2 * g, bh, [(YS - SY0 + g, YN - SY0 + g, ZF + s_ * FH - bz0, ZC + s_ * FH - bz0) for s_ in (-1, 0, 1)])
    qs += rect_with_holes((SX0 - g, SY0 - g, bz0), (1, 0, 0), (0, 1, 0), SX1 - SX0 + 2 * g + 0.42, SY1 - SY0 + 2 * g, [])
    qs += rect_with_holes((SX0 - g, SY0 - g, bz0 + bh), (1, 0, 0), (0, 1, 0), SX1 - SX0 + 2 * g + 0.42, SY1 - SY0 + 2 * g, [])
    quad_obj("Backer", qs, bmat)
    for m in (mwall, mfloor, mceil, *tread_m):
        bpy.data.objects.remove(m)
    # 烘焙时二楼的小房间也要在（它们的日光会从门洞漏进二楼走廊）；地下室的不放（那里是黑的）
    for o in rooms:
        d = o.copy(); d.name = "RD_" + o.name; bpy.context.scene.collection.objects.link(d); d.location.z += FH
    return dict(fh=FH, sx0=SX0, sx1=SX1, sy0=SY0, sy1=SY1, fl0=FL0, fl1=FL1, ym0=YM0, ym1=YM1, rise=RISE, swin=swin)



# ================================================================ build
def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    hall = import_scan("env_manufactory", "H_")
    rooms = import_scan("env_tworooms", "R_", M_ROOMS)
    log("hall", len(hall), "rooms", len(rooms))
    # 大厅南门：拿掉门板
    removed = 0
    for o in hall:
        bm = bmesh.new(); bm.from_mesh(o.data)
        kill = []
        for f in bm.faces:
            c = f.calc_center_median()
            if HDOOR["x0"] + 0.004 < c.x < HDOOR["x1"] - 0.004 and c.y < -0.12 and 0.43 < c.z < HDOOR["top"] + 0.01 and abs(f.normal.y) > 0.5:
                kill.append(f)
        removed += len(kill)
        if kill:
            bmesh.ops.delete(bm, geom=kill, context="FACES"); bm.to_mesh(o.data)
        bm.free()
    log("hall door panel faces removed", removed)

    pieces = []       # (物体, 参考探针名)
    probes = {}       # 名 -> 探针物体（在原地量"这块墙原本受多少光"）
    pmat = bpy.data.materials.new("ProbeMat")

    def probe(name, o, u, v, w, h):
        qs = []
        nu, nv = max(2, int(w / 0.25)), max(2, int(h / 0.25))
        for i in range(nu):
            for j in range(nv):
                p = lambda a, b: Vector(o) + Vector(u) * (w * a / nu) + Vector(v) * (h * b / nv)
                qs.append((p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1)))
        ob = quad_obj("Probe_" + name, qs, pmat)
        probes[name] = ob
        return ob

    def add(ob, pr):
        ob["probe"] = pr; pieces.append(ob); return ob

    # ---------------- 参考探针（离原墙面 3cm）
    yE0, yE1 = C["ys"] + 0.046, C["yn"] - 0.052           # C 东墙可用的一段（-6.52 .. -2.65）
    probe("Ceast", (C["xe"] - 0.03, yE0, C["zf"] + 0.05), (0, 1, 0), (0, 0, 1), yE1 - yE0, 3.2)        # 法线 -x
    probe("Cnorth", (22.20, C["yn"] - 0.03, C["zf"] + 0.05), (1, 0, 0), (0, 0, 1), 3.40, 3.2)          # 法线 -y
    probe("Cnorthdoor", (C["xw"] + 0.03, C["yn"] - 0.03, C["zf"] + 0.05), (1, 0, 0), (0, 0, 1), 1.82, 3.2)
    probe("Cwest", (C["xw"] + 0.03, -4.896, C["zf"] + 0.05), (0, 1, 0), (0, 0, 1), 1.85, 3.2)          # 法线 +x
    fy0, fy1 = -5.60, -3.65
    probe("Cfloor", (20.90, fy0, C["zf"] + 0.03), (1, 0, 0), (0, 1, 0), 4.68, fy1 - fy0)
    probe("Cceil", (20.90, fy0, C["zc"] - 0.38), (1, 0, 0), (0, 1, 0), 4.68, fy1 - fy0)
    probe("Idoor", (IDOOR["x0"] + 0.03, (C["ys"] + B["yn"]) / 2 - 0.08, 0.7), (0, 1, 0), (0, 0, 1), 0.16, 1.7)   # 内门侧壁，法线 +x
    probe("Hrecess", (HDOOR["x0"] + 0.03, -0.12, 0.6), (0, 1, 0), (0, 0, 1), 0.25, 1.8)                # 大厅门洞侧壁，法线 +x

    # ---------------- 地面 / 天花：C 屋中间一条，一正一镜像接成整条走廊
    W_ = YN - YS
    for nm, z0, z1 in (("Floor", C["zf"] - 0.12, C["zf"] + 0.30), ("Ceil", C["zc"] - 0.42, C["zc"] + 0.08)):
        srcA = chunk(rooms, (20.90, fy0, z0), (25.58, fy1, z1), nm + "A")
        srcB = chunk(rooms, (20.90, fy0, z0), (25.58, fy1, z1), nm + "B")
        sy = (W_ + 0.10) / (fy1 - fy0)
        # A：源 x=20.90 -> 走廊 X0-0.05；B：关于接缝镜像
        seam = X0 - 0.05 + 4.68
        place(srcA, affine((20.90, fy0, 0), (1, 0, 0), (0, 1, 0), (X0 - 0.05, YS - 0.05, ZF - C["zf"]), (1, 0, 0), (0, 1, 0), 1.0, sy))
        place(srcB, affine((25.58, fy0, 0), (1, 0, 0), (0, 1, 0), (seam, YS - 0.05, ZF - C["zf"]), (-1, 0, 0), (0, 1, 0), 1.0, sy))
        # 镜像那块超出东端的部分切掉
        for ob in (srcA, srcB):
            bm = bmesh.new(); bm.from_mesh(ob.data)
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=(X1 + 0.06, 0, 0), plane_no=(1, 0, 0), clear_outer=True)
            bm.to_mesh(ob.data); bm.free()
            orient(ob, axis_target); add(ob, "C" + nm.lower())

    # ---------------- 墙
    zw0, zw1 = C["zf"] + 0.012, C["zc"] - 0.008
    sz = (ZC - ZF) / (C["zc"] - C["zf"])

    def wall_from_east(name, y_a, y_b, dst_xa, dst_xb, dst_y, dst_n):
        """取 C 东墙 y∈[y_a,y_b] 一段（法线 -x），贴到走廊 y=dst_y 的墙上，源 y_a 对到 dst_xa、y_b 对到 dst_xb。"""
        lo, hi = min(y_a, y_b), max(y_a, y_b)
        ob = chunk(rooms, (C["xe"] - 0.035, lo, zw0), (C["xe"] + 0.12, hi, zw1), name)
        st = abs(dst_xb - dst_xa) / (hi - lo)
        t = (1, 0, 0) if (dst_xb - dst_xa) * (y_b - y_a) > 0 else (-1, 0, 0)
        place(ob, affine((C["xe"], y_a, C["zf"]), (0, 1, 0), (-1, 0, 0), (dst_xa, dst_y, ZF), t, dst_n, st, 1.0, sz))
        orient(ob, axis_target); return add(ob, "Ceast")

    # 南墙（法线 +y）：西段 17.0–21.31、东段 22.10–25.9
    wall_from_east("WallS_W", yE0, yE1, X0 - 0.03, CDOOR["x0"], YS, (0, 1, 0))
    wall_from_east("WallS_E", yE1, yE0, CDOOR["x1"], X1 + 0.03, YS, (0, 1, 0))
    # 北墙（法线 -y）：大厅门西侧一小段
    wall_from_east("WallN_W", yE0, yE0 + 0.80, X0 - 0.03, HDOOR["x0"], YN, (0, -1, 0))
    # 北墙东段 19.25–25.9：C 北墙门东侧那段，镜像一份 + 原样一份（接缝处是同一条边，连续）
    nx0, nx1 = 22.20, 25.60
    mid = (HDOOR["x1"] + X1 + 0.03) / 2
    for nm, xa, xb in (("WallN_E1", mid, HDOOR["x1"]), ("WallN_E2", mid, X1 + 0.03)):
        ob = chunk(rooms, (nx0, C["yn"] - 0.035, zw0), (nx1, C["yn"] + 0.12, zw1), nm)
        st = abs(xb - xa) / (nx1 - nx0)
        t = (1, 0, 0) if xb > xa else (-1, 0, 0)
        place(ob, affine((nx0, C["yn"], C["zf"]), (1, 0, 0), (0, -1, 0), (xa, YN, ZF), t, (0, -1, 0), st, 1.0, sz))
        orient(ob, axis_target); add(ob, "Cnorth")
    # 门上方的墙：南墙 C 门上方、北墙大厅门上方（取 C 东墙上半截）
    for nm, xa, xb, top, y, n in (("OverS", CDOOR["x0"], CDOOR["x1"], CDOOR["top"], YS, (0, 1, 0)), ("OverN", HDOOR["x0"], HDOOR["x1"], HDOOR["top"], YN, (0, -1, 0))):
        w = xb - xa
        zs0 = C["zf"] + (top - ZF) / sz
        ob = chunk(rooms, (C["xe"] - 0.035, -5.4, zs0), (C["xe"] + 0.12, -5.4 + min(w, 1.6), zw1), nm)
        st = w / min(w, 1.6)
        t = (1, 0, 0)
        place(ob, affine((C["xe"], -5.4, C["zf"]), (0, 1, 0), (-1, 0, 0), (xa, y, ZF), t, n, st, 1.0, sz))
        orient(ob, axis_target); add(ob, "Ceast")

    # ---------------- 西端：带门的墙（克隆 C 北墙带门那一段，法线 -y -> +x）
    sx0, sx1 = C["xw"] + 0.03, C["xw"] + 0.03 + 1.82
    ob = chunk(rooms, (sx0, C["yn"] - 0.035, zw0), (sx1, C["yn"] + 0.30, zw1), "EndW")
    st = (W_ + 0.06) / (sx1 - sx0)
    place(ob, affine((sx0, C["yn"], C["zf"]), (1, 0, 0), (0, -1, 0), (X0, YN + 0.03, ZF), (0, -1, 0), (1, 0, 0), st, 1.0, sz))
    orient(ob, axis_target); add(ob, "Cnorthdoor")
    wd = [YN + 0.03 - (CDOOR["x1"] - sx0) * st, YN + 0.03 - (CDOOR["x0"] - sx0) * st]
    wtop = ZF + (CDOOR["top"] - C["zf"]) * sz
    log("west exterior door y", [round(v, 3) for v in wd], "top", round(wtop, 3))
    # ---------------- 东端：带窗的墙（克隆 C 西墙带窗那一段，法线 +x -> -x）
    sy0, sy1 = -4.896, -3.046
    ob = chunk(rooms, (C["xw"] - 0.45, sy0, zw0), (C["xw"] + 0.035, sy1, zw1), "EndE")
    st = (W_ + 0.06) / (sy1 - sy0)
    place(ob, affine((C["xw"], sy0, C["zf"]), (0, 1, 0), (1, 0, 0), (X1, YS - 0.03, ZF), (0, 1, 0), (-1, 0, 0), st, 1.0, sz))
    orient(ob, axis_target); add(ob, "Cwest"); EndE = ob        # 这块带窗的墙后面会挪到楼梯间的东墙上
    ewin = dict(y0=YS - 0.03 + (-4.746 - sy0) * st, y1=YS - 0.03 + (-3.196 - sy0) * st, z0=ZF + 1.01 * sz, z1=ZF + 2.20 * sz)

    # ---------------- 走廊南墙的外立面（从 C 屋西窗往外看得到这一段）：再克隆一段 C 东墙，朝南摆在墙外侧，竖直方向拉高盖住后面大厅的外壳
    ob = chunk(rooms, (C["xe"] - 0.035, yE0, zw0), (C["xe"] + 0.12, yE1, zw1), "ExtS")
    place(ob, affine((C["xe"], yE0, C["zf"]), (0, 1, 0), (-1, 0, 0), (20.84, YS - 0.10, 0.36), (-1, 0, 0), (0, -1, 0), (20.84 - 16.45) / (yE1 - yE0), 1.0, (5.3 - 0.36) / (C["zc"] - C["zf"])))
    fill_small_holes(ob)
    orient(ob, lambda p: p + Vector((0, -1, 0))); add(ob, "Ceast")

    # ---------------- 门洞内衬
    # C 北门：把 C/B 内门的侧壁、门楣克隆过来（厚 0.19 -> 0.30）
    iy0, iy1 = B["yn"] + 0.004, C["ys"] - 0.004
    for nm, xa, xb, dx in (("LinC_L", IDOOR["x0"] - 0.06, IDOOR["x0"] + 0.03, CDOOR["x0"] - IDOOR["x0"]), ("LinC_R", IDOOR["x1"] - 0.03, IDOOR["x1"] + 0.06, CDOOR["x1"] - IDOOR["x1"])):
        ob = chunk(rooms, (xa, iy0, IDOOR["sill"] + 0.02), (xb, iy1, IDOOR["top"] - 0.03), nm)
        szj = (CDOOR["top"] - ZF) / (IDOOR["top"] - 0.03 - IDOOR["sill"] - 0.02)
        sn = (YS - C["yn"] + 0.02) / (iy1 - iy0)
        xj = IDOOR["x0"] if "L" in nm else IDOOR["x1"]
        place(ob, affine((xj, iy0, IDOOR["sill"] + 0.02), (1, 0, 0), (0, 1, 0), (xj + dx, C["yn"] - 0.01, ZF), (1, 0, 0), (0, 1, 0), 1.0, sn, szj))
        cx = (CDOOR["x0"] + CDOOR["x1"]) / 2
        orient(ob, lambda p: Vector((cx, p.y, p.z))); add(ob, "Idoor")
    ob = chunk(rooms, (IDOOR["x0"] - 0.02, iy0, IDOOR["top"] - 0.04), (IDOOR["x1"] + 0.02, iy1, IDOOR["top"] + 0.05), "LinC_T")
    sn = (YS - C["yn"] + 0.02) / (iy1 - iy0)
    place(ob, affine((IDOOR["x0"], iy0, IDOOR["top"]), (1, 0, 0), (0, 1, 0), (CDOOR["x0"], C["yn"] - 0.01, CDOOR["top"]), (1, 0, 0), (0, 1, 0), (CDOOR["x1"] - CDOOR["x0"]) / (IDOOR["x1"] - IDOOR["x0"]), sn, 1.0))
    orient(ob, lambda p: Vector((p.x, p.y, 1.4))); add(ob, "Idoor")
    # 大厅南门：把大厅门洞自己的侧壁/门楣/地面往走廊方向再复制一截
    ob = chunk(hall, (HDOOR["x0"] - 0.03, -0.150, 0.38), (HDOOR["x1"] + 0.03, 0.150, HDOOR["top"] + 0.04), "LinH")
    place(ob, Matrix.Translation((0, -0.30, 0)))
    hc = Vector(((HDOOR["x0"] + HDOOR["x1"]) / 2, 0, 1.5))
    orient(ob, lambda p: Vector((hc.x, p.y, hc.z))); add(ob, "Hrecess")
    # C 北门门槛处的地面（走廊地面往门洞里延伸）
    ob = chunk(rooms, (21.2, -5.2, C["zf"] - 0.1), (22.2, -4.8, C["zf"] + 0.2), "LinC_F")
    place(ob, affine((21.2, -5.2, 0), (1, 0, 0), (0, 1, 0), (21.2, C["yn"] - 0.03, 0), (1, 0, 0), (0, 1, 0), 1.0, (YS - C["yn"] + 0.08) / 0.4))
    orient(ob, lambda p: p + Vector((0, 0, 1))); add(ob, "Cfloor")

    # ---------------- 多层：楼梯间、二楼、地下室，以及各处的背板
    stairs = build_multi(dict(rooms=rooms, add=add, pieces=pieces, yE0=yE0, yE1=yE1, zw0=zw0, zw1=zw1, W_=W_, ewin=ewin, wd=wd, wtop=wtop, EndE=EndE))

    meta = dict(corridor=dict(x0=X0, x1=X1, ys=YS, yn=YN, zf=ZF, zc=ZC), C=C, B=B, cdoor=CDOOR, idoor=IDOOR, hdoor=HDOOR,
                wdoor=dict(y0=wd[0], y1=wd[1], top=wtop), ewin=ewin,
                cwin=dict(y0=-4.746, y1=-3.196, z0=C["zf"] + 1.01, z1=C["zf"] + 2.20), bwin=dict(y0=-10.184, y1=-8.654, z0=B["zf"] + 0.88, z1=B["zf"] + 2.29),
                bswin=dict(x0=21.376, x1=22.066, z0=B["zf"] + 0.69, z1=B["zf"] + 2.62), stairs=stairs)
    scn["level_meta"] = json.dumps(meta)
    scn["pieces"] = json.dumps([o.name for o in pieces])
    tris0 = sum(len(o.data.polygons) for o in pieces)
    # 减面：扫描网格很密（约 3cm 一个点），墙和地面基本是平的，减到三成看不出差别
    ratio = float(os.environ.get("LV_DECIM", "0.3"))
    for o in pieces:
        if len(o.data.polygons) < 500:
            continue
        # 扫描网格在贴图分块的边界上顶点是断开的，直接减面会沿边界裂出缝；先按位置把顶点焊上（每个面角上的 UV 不受影响）
        bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=2e-4); bm.to_mesh(o.data); bm.free(); o.data.update()
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True); bpy.context.view_layer.objects.active = o
        m = o.modifiers.new("Dec", "DECIMATE"); m.ratio = ratio; m.use_collapse_triangulate = True
        try:
            bpy.ops.object.modifier_apply(modifier="Dec")
        except Exception as e:
            log("decimate failed", o.name, e); o.modifiers.remove(m)
    tris = sum(len(o.data.polygons) for o in pieces)
    log("pieces", len(pieces), "faces", tris0, "->", tris)
    os.makedirs(os.path.dirname(BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    log("saved", BLEND)


# ================================================================ preview
def preview(tag="build", lit=False):
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_WORKBENCH"; sh = scn.display.shading; sh.light = "FLAT"; sh.color_type = "VERTEX" if lit else "TEXTURE"; sh.show_backface_culling = False
    scn.display.render_aa = "8"; scn.view_settings.view_transform = "Standard"
    scn.render.resolution_x = 1280; scn.render.resolution_y = 720; scn.render.image_settings.file_format = "JPEG"
    w = scn.world or bpy.data.worlds.new("w"); scn.world = w; w.use_nodes = False; w.color = (1, 0, 1)
    for o in scn.objects:
        if o.name.startswith("Probe_"):
            o.hide_render = True
    cd = bpy.data.cameras.new("pc"); cd.lens = 13; cd.clip_start = 0.03; cam = bpy.data.objects.new("pc", cd); scn.collection.objects.link(cam); scn.camera = cam
    out = os.path.join(ROOT, "renders", "level"); os.makedirs(out, exist_ok=True)
    views = {
        "corr_E": ((18.0, -1.35, 1.6), 270), "corr_W": ((25.0, -1.35, 1.6), 90), "corr_mid_N": ((21.7, -2.0, 1.6), 0), "corr_mid_S": ((20.5, -0.8, 1.6), 200),
        "st_F1": ((26.2, -1.9, 2.0), 270), "st_mid2": ((30.5, -1.4, 3.9), 90), "st_F2": ((26.2, -0.8, 5.7), 270), "st_B1": ((26.2, -1.9, -1.6), 270),
        "st_mid0": ((30.5, -1.4, 0.3), 90), "corr2_E": ((18.0, -1.35, 5.7), 270), "corr2_W": ((25.0, -1.35, 5.7), 90), "corr0_E": ((18.0, -1.35, -1.6), 270),
        "hall_S": ((19.5, 2.6, 1.6), 165), "roomC_N": ((23.0, -5.5, 1.6), 20), "corr_door_from_hall": ((18.5, 0.9, 1.6), 180), "corr_W_from_C": ((21.7, -3.4, 1.6), 0),
    }
    for nm, (p, ang) in views.items():
        cam.location = p; cam.rotation_euler = (math.radians(86), 0, math.radians(ang))
        scn.render.filepath = os.path.join(out, f"{tag}_{nm}.jpg"); bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    log("preview done", tag)


# ================================================================ bake
def bake():
    scn = bpy.context.scene
    enable_gpu(scn)
    scn.cycles.samples = int(os.environ.get("LV_SPP", "768")); scn.cycles.use_denoising = False
    scn.cycles.use_adaptive_sampling = False; scn.cycles.sample_clamp_indirect = 6.0
    scn.cycles.max_bounces = 6; scn.cycles.diffuse_bounces = 4
    pieces = [bpy.data.objects[n] for n in json.loads(scn["pieces"])]
    probes = [o for o in scn.objects if o.name.startswith("Probe_")]
    # 世界：门外全景（照明强度）
    w = bpy.data.worlds.new("World"); scn.world = w; w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    env = nt.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(os.path.join(ASSETS, "hdri", "abandoned_slipway_4k.hdr"))
    bg = nt.nodes.new("ShaderNodeBackground"); bg.inputs["Strength"].default_value = 1.6
    out = nt.nodes.new("ShaderNodeOutputWorld"); nt.links.new(env.outputs["Color"], bg.inputs["Color"]); nt.links.new(bg.outputs[0], out.inputs["Surface"])
    # 门外地面（接天光后反弹）
    gm = bpy.data.materials.new("GroundBake"); gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.22, 0.21, 0.2, 1)
    holes = [(16.6, -0.45, 25.8, 5.7), (16.9, -2.65, 31.5, -0.15), (20.6, -11.1, 25.95, -2.3)]      # 大厅、走廊+楼梯间、小房间
    xs = sorted({-40.0, 60.0} | {h[0] for h in holes} | {h[2] for h in holes}); ys = sorted({-60.0, 50.0} | {h[1] for h in holes} | {h[3] for h in holes})
    gq = []
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if not any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in holes):
                gq.append(((xs[i], ys[j], 0.40), (xs[i + 1], ys[j], 0.40), (xs[i + 1], ys[j + 1], 0.40), (xs[i], ys[j + 1], 0.40)))
    g = quad_obj("GroundBake", gq, gm)
    # 扫描面：贴图当发光（大厅的过曝窗户另外提亮），同时也是漫反射面
    for m in bpy.data.materials:
        if not (m.name.startswith("H_") or m.name.startswith("R_")) or not m.use_nodes:
            continue
        nt = m.node_tree
        img = next((n.image for n in nt.nodes if n.type == "TEX_IMAGE" and n.image), None)
        if img is None:
            continue
        nt.nodes.clear(); N = nt.nodes.new; Lk = nt.links.new
        tex = N("ShaderNodeTexImage"); tex.image = img
        em = N("ShaderNodeEmission"); Lk(tex.outputs["Color"], em.inputs["Color"])
        if m.name.startswith("H_"):
            bw = N("ShaderNodeRGBToBW"); Lk(tex.outputs["Color"], bw.inputs[0])
            mr = N("ShaderNodeMapRange"); mr.interpolation_type = "SMOOTHSTEP"; mr.inputs["From Min"].default_value = 0.86; mr.inputs["From Max"].default_value = 0.985
            mr.inputs["To Min"].default_value = 1.0; mr.inputs["To Max"].default_value = 11.0
            Lk(bw.outputs[0], mr.inputs["Value"]); Lk(mr.outputs[0], em.inputs["Strength"])
        df = N("ShaderNodeBsdfDiffuse"); Lk(tex.outputs["Color"], df.inputs["Color"])
        add = N("ShaderNodeAddShader"); Lk(em.outputs[0], add.inputs[0]); Lk(df.outputs[0], add.inputs[1])
        o_ = N("ShaderNodeOutputMaterial"); Lk(add.outputs[0], o_.inputs["Surface"])
        m["emit_node"] = em.name
    # 走廊的克隆件：不发光（它们的亮度正是要求的量），只做漫反射。做法：给克隆件换一套同贴图的纯漫反射材质
    dmats = {}
    for ob in pieces:
        for i, m in enumerate(ob.data.materials):
            if m.name not in dmats:
                d = m.copy(); d.name = "K_" + m.name
                nt = d.node_tree; em = nt.nodes.get(m.get("emit_node", ""))
                if em is not None:
                    em.inputs["Strength"].default_value = 0.0
                    for l in list(em.inputs["Strength"].links):
                        nt.links.remove(l)
                dmats[m.name] = d
            ob.data.materials[i] = dmats[m.name]
    pm = bpy.data.materials["ProbeMat"]; pm.use_nodes = True
    bk = bpy.data.materials["Backer"]; bk.use_nodes = True
    bk.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1)
    # 探针不挡光
    for p in probes:
        p.visible_shadow = False; p.visible_diffuse = False; p.visible_glossy = False; p.visible_camera = False
    scn.render.bake.use_pass_direct = True; scn.render.bake.use_pass_indirect = True; scn.render.bake.use_pass_color = False
    scn.render.bake.target = "VERTEX_COLORS"
    res = {}
    for ob in probes + pieces:
        me = ob.data
        ca = me.color_attributes.get("E") or me.color_attributes.new("E", "FLOAT_COLOR", "POINT")
        me.color_attributes.active_color = ca
        try:
            me.color_attributes.render_color_index = list(me.color_attributes).index(ca)
        except Exception:
            pass
        bpy.ops.object.select_all(action="DESELECT")
        ob.hide_set(False); ob.select_set(True); bpy.context.view_layer.objects.active = ob
        try:
            bpy.ops.object.bake(type="DIFFUSE")
        except Exception as e:
            log("BAKE_ERR", ob.name, e); continue
        col = np.empty(len(me.vertices) * 4, np.float32); ca.data.foreach_get("color", col); col = col.reshape(-1, 4)[:, :3]
        res[ob.name] = col
        log("baked", ob.name, len(me.vertices), "mean E", np.round(col.mean(0), 4))
    scn["probe_E"] = json.dumps({k[6:]: [float(x) for x in v.mean(0)] for k, v in res.items() if k.startswith("Probe_")})
    bpy.data.objects.remove(g)
    for o in [o for o in scn.objects if o.name.startswith("RD_")]:
        bpy.data.objects.remove(o)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    log("bake saved")


# ================================================================ relight：原始顶点受光 -> 平滑后的相对亮度（存进 Col）
def blur3(a, sig):
    r = max(1, int(sig * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sig) ** 2).astype(np.float32); k /= k.sum()
    for ax in range(3):
        if a.shape[ax] < 2:
            continue
        pad = [(0, 0)] * 3; pad[ax] = (r, r)
        ap = np.pad(a, pad, mode="edge")
        out = np.zeros_like(a)
        for i, w in enumerate(k):
            sl = [slice(None)] * 3; sl[ax] = slice(i, i + a.shape[ax])
            out += w * ap[tuple(sl)]
        a = out
    return a


def relight():
    scn = bpy.context.scene
    pieces = [bpy.data.objects[n] for n in json.loads(scn["pieces"])]
    pE = json.loads(scn["probe_E"])
    lumw = np.array([0.2126, 0.7152, 0.0722], np.float32)
    cell = float(os.environ.get("LV_CELL", "0.06")); sig = float(os.environ.get("LV_SIGMA", "0.16")) / cell
    for ob in pieces:
        me = ob.data
        ea = me.color_attributes.get("E")
        if ea is None:
            log("no E on", ob.name); continue
        n = len(me.vertices)
        E = np.empty(n * 4, np.float32); ea.data.foreach_get("color", E); E = E.reshape(-1, 4)[:, :3].copy()
        co = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        r = float(np.array(pE[ob["probe"]], np.float32) @ lumw)
        lum = E @ lumw
        ok = lum > 0
        cap = np.percentile(lum[ok], 99.0) if ok.any() else 1.0
        sc = np.minimum(1.0, cap / np.maximum(lum, 1e-9)); E = E * sc[:, None]           # 压掉萤火虫
        mn = co.min(0) - cell; idx = np.floor((co - mn) / cell).astype(np.int32); shp = idx.max(0) + 2
        acc = np.zeros((*shp, 3), np.float32); cnt = np.zeros(shp, np.float32)
        np.add.at(acc, (idx[ok, 0], idx[ok, 1], idx[ok, 2]), E[ok]); np.add.at(cnt, (idx[ok, 0], idx[ok, 1], idx[ok, 2]), 1.0)
        cb = blur3(cnt, sig)
        sm = np.stack([blur3(acc[..., c], sig) for c in range(3)], -1) / np.maximum(cb[..., None], 1e-6)
        rel = sm[idx[:, 0], idx[:, 1], idx[:, 2]] / max(r, 1e-4)
        if float(co[:, 2].mean()) > 0.3 and not ob.name.endswith("_0"):      # 地面以上：离窗远的地方也留一点环境光（纯黑不像白天的楼道）；地下室保持全黑
            rel = np.maximum(rel, float(os.environ.get("LV_AMB", "0.05")))
        ca = me.color_attributes.get("Col") or me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        out = np.ones((n, 4), np.float32); out[:, :3] = np.clip(rel * 0.5, 0, 1)        # 存 rel/2，着色器里再乘 2
        ca.data.foreach_set("color", out.ravel())
        me.color_attributes.active_color = ca
        try:
            me.color_attributes.render_color_index = list(me.color_attributes).index(ca)
        except Exception:
            pass
        log("rel", ob.name, "ref", round(r, 4), "mean", np.round(rel.mean(0), 3), "p5", round(float(np.percentile(rel @ lumw, 5)), 3), "p95", round(float(np.percentile(rel @ lumw, 95)), 3), "grid", tuple(int(x) for x in shp))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    log("relight saved")


# ================================================================ export
def export():
    scn = bpy.context.scene
    os.makedirs(OUT, exist_ok=True)
    pieces = [bpy.data.objects[n] for n in json.loads(scn["pieces"])]
    # 克隆件换回原名材质（JS 里按材质名找贴图）
    for ob in pieces:
        for i, m in enumerate(ob.data.materials):
            if m.name.startswith("K_"):
                ob.data.materials[i] = bpy.data.materials[m.name[2:]]
        me = ob.data
        ca = me.color_attributes.get("Col")
        if ca is not None:
            me.color_attributes.active_color = ca
            try:
                me.color_attributes.render_color_index = list(me.color_attributes).index(ca)
            except Exception:
                pass
            e = me.color_attributes.get("E")
            if e is not None:
                me.color_attributes.remove(e)

    def exp(objs, name, vc):
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.hide_set(False); o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        kw = dict(filepath=os.path.join(OUT, name + ".gltf"), export_format="GLTF_SEPARATE", use_selection=True, export_materials="EXPORT", export_image_format="NONE",
                  export_yup=True, export_apply=False, export_animations=False, export_normals=True, export_texcoords=True)
        if vc:
            kw.update(export_vertex_color="ACTIVE", export_active_vertex_color_when_no_material=True, export_all_vertex_colors=False)
        else:
            kw.update(export_vertex_color="NONE")
        bpy.ops.export_scene.gltf(**kw)
        log("exported", name, len(objs), os.path.getsize(os.path.join(OUT, name + ".bin")) // 1024, "KB")

    exp(pieces + [bpy.data.objects["Backer"]], "corridor", True)
    exp([o for o in scn.objects if o.name.startswith("R_") and o.type == "MESH"], "rooms", False)
    json.dump(json.loads(scn["level_meta"]), open(os.path.join(OUT, "level.json"), "w"), indent=1)
    log("export done")


for cmd in argv:
    if cmd == "build":
        build()
    else:
        if bpy.data.filepath != BLEND:
            bpy.ops.wm.open_mainfile(filepath=BLEND)
        if cmd == "preview":
            preview("build")
        elif cmd == "previewlit":
            preview("lit", True)
        elif cmd == "bake":
            bake()
        elif cmd == "relight":
            relight()
        elif cmd == "export":
            export()
