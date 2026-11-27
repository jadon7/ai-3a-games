# 暖色太阳灯 + 车手（头盔/上身）+ 近景三维草丛
import bpy, bmesh, math, os, sys, importlib, random
from mathutils import Vector, Matrix

ROOT = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import track_def as T
importlib.reload(T)
sc = bpy.context.scene
D = bpy.data.objects


def coll(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        sc.collection.children.link(c)
    return c


# ----------------------------------------------------------------------------- 太阳
SUN_AZ = sc.get("sun_az", 190.0)
SUN_EL = 15.0
lc = coll("Lights")
sun = D.get("Sun_Key")
if sun is None:
    sd = bpy.data.lights.new("Sun_Key", 'SUN')
    sun = bpy.data.objects.new("Sun_Key", sd)
    lc.objects.link(sun)
sd = sun.data
sd.energy = 3.4
sd.color = (1.0, 0.66, 0.38)
sd.angle = math.radians(2.2)
az, el = math.radians(SUN_AZ), math.radians(SUN_EL)
to_sun = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
sun.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()
sun.location = (0, 0, 50)
print("sun dir to_sun:", tuple(round(v, 3) for v in to_sun))

# ----------------------------------------------------------------------------- 车手
def mat_simple(name, color, rough=0.4, metallic=0.0, coat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Coat Weight"].default_value = coat
    return m


def make_driver(tag, seat_xyz, helmet_color, suit_color):
    """在 <tag>_BODY 下放一个简化车手：头盔+面罩+肩背+手臂。seat_xyz：头部中心（ROOT 局部系）。"""
    body = D[tag + "_BODY"]
    cname = "Car_" + tag
    c = bpy.data.collections[cname]
    for o in [o for o in c.objects if o.name.startswith(tag + "_DRV")]:
        bpy.data.objects.remove(o, do_unlink=True)
    hx, hy, hz = seat_xyz
    bm = bmesh.new()
    # 头盔：略拉长的球
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=0.135,
                              matrix=Matrix.Translation((hx, hy, hz)) @ Matrix.Diagonal((1.12, 0.98, 1.0, 1.0)))
    me_h = bpy.data.meshes.new(tag + "_DRV_helmet")
    bm.to_mesh(me_h); bm.free()
    for p in me_h.polygons:
        p.use_smooth = True
    oh = bpy.data.objects.new(tag + "_DRV_helmet", me_h)
    me_h.materials.append(mat_simple(f"M_Helmet_{tag}", helmet_color, 0.18, 0.0, 1.0))
    # 面罩：贴在头盔前方的深色带
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.137,
                              matrix=Matrix.Translation((hx + 0.012, hy, hz + 0.012)) @ Matrix.Diagonal((1.12, 0.94, 0.42, 1.0)))
    dele = [v for v in bm.verts if v.co.x < hx + 0.03]
    bmesh.ops.delete(bm, geom=dele, context='VERTS')
    me_v = bpy.data.meshes.new(tag + "_DRV_visor")
    bm.to_mesh(me_v); bm.free()
    for p in me_v.polygons:
        p.use_smooth = True
    ov = bpy.data.objects.new(tag + "_DRV_visor", me_v)
    me_v.materials.append(mat_simple("M_Visor", (0.01, 0.01, 0.012), 0.08, 0.0, 1.0))
    # 躯干 + 肩 + 手臂（椭球/胶囊近似）
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.2,
                              matrix=Matrix.Translation((hx - 0.06, hy, hz - 0.36)) @ Matrix.Diagonal((0.75, 1.05, 1.25, 1.0)))
    for side in (-1, 1):
        # 上臂伸向方向盘
        a = Vector((hx - 0.02, hy + side * 0.19, hz - 0.22))
        bpt = Vector((hx + 0.30, hy + side * 0.15, hz - 0.30))
        mid = (a + bpt) / 2
        d = (bpt - a)
        rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.055, radius2=0.045, depth=d.length,
                              matrix=Matrix.Translation(mid) @ rot)
    me_t = bpy.data.meshes.new(tag + "_DRV_torso")
    bm.to_mesh(me_t); bm.free()
    for p in me_t.polygons:
        p.use_smooth = True
    ot = bpy.data.objects.new(tag + "_DRV_torso", me_t)
    me_t.materials.append(mat_simple(f"M_Suit_{tag}", suit_color, 0.75))
    for o in (oh, ov, ot):
        c.objects.link(o)
        o.parent = body
        # BODY 支点在 z=0.30，子物体坐标是相对 BODY 的
        o.location = (0, 0, -body.location.z if False else -0.30)
    return oh


def seat_guess(tag, lhd=True):
    """根据方向盘网格估计头部位置（ROOT 局部系）。"""
    root = D[tag + "_ROOT"]
    inv = root.matrix_world.inverted()
    best = None
    cands = []
    for o in bpy.data.collections["Car_" + tag].objects:
        nm = o.name.lower()
        if any(k in nm for k in ("geo_steer", "steeringwheel", "volante")) and "_w_" not in nm:
            stack = [o]
            while stack:
                q = stack.pop()
                if q.type == 'MESH':
                    cands.append(q)
                stack.extend(q.children)
    for o in cands:
        if True:
            for cnr in o.bound_box:
                p = inv @ (o.matrix_world @ Vector(cnr))
                if best is None:
                    best = [p.copy(), p.copy()]
                else:
                    for i in range(3):
                        best[0][i] = min(best[0][i], p[i]); best[1][i] = max(best[1][i], p[i])
    if best:
        ctr = (best[0] + best[1]) / 2
        return ctr
    return None


cur = sc.frame_current
sc.frame_set(1)
bpy.context.view_layer.update()
for tag, hc, scol in (("E30", (0.85, 0.85, 0.82), (0.75, 0.75, 0.72)), ("E30B", (0.75, 0.08, 0.05), (0.08, 0.08, 0.09)),
                      ("CAPRI", (0.9, 0.55, 0.05), (0.1, 0.12, 0.3)), ("STRATOS", (0.85, 0.85, 0.85), (0.6, 0.08, 0.06))):
    if tag + "_ROOT" not in D:
        continue
    sw = seat_guess(tag)
    print(tag, "steering wheel centre (root local):", None if sw is None else tuple(round(v, 3) for v in sw))
    if sw is None:
        if tag == "STRATOS":
            make_driver(tag, (-0.12, 0.33, 0.86), hc, scol)
        continue
    head = (sw.x - 0.46, sw.y, sw.z + 0.20)
    make_driver(tag, head, hc, scol)
sc.frame_set(cur)
print("LIGHT_DRIVER_OK")
