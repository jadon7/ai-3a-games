# 潮听者（Tide Listener）— 用 Blender 的 Python 接口程序化建模
# 运行：blender --background --python listener.py -- <输出.obj> <输出.blend> <预览图前缀> [姿态]
# 姿态：base（原始造型，默认）/ drift（漂游：垂着）/ sus（警觉：歪头侧听，一只手半举）/ hunt（猎杀：前倾张臂）
#
# 造型：没有眼睛也没有脸。头部是一只朝前的褶边"听盘"，两侧各一只小耳扇；
#       胸腔是敞开的肋骨笼；手臂末端是三根细长的指叉；下半身是一簇垂下的触须。
# 坐标：Blender 里 Z 朝上、-Y 朝前。导出 OBJ 时转成 Y 朝上、-Z 朝前（Godot 的习惯）。
# 想改造型：直接改下面的数值重新运行，或打开生成的 .blend 手工雕，再导出覆盖同名 OBJ。

import bpy
import bmesh
import math
import sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_OBJ = argv[0] if len(argv) > 0 else "listener.obj"
OUT_BLEND = argv[1] if len(argv) > 1 else "listener.blend"
OUT_PNG = argv[2] if len(argv) > 2 else ""
POSE = argv[3] if len(argv) > 3 else "base"

# 姿态参数：
#   lean   胸腔以上整体前倾的弧度（分摊在 4 节脊椎上）
#   neck   头颈相对肩部再低头（正）或抬头（负）的弧度
#   head_x 头向一侧歪出去的距离
#   dish   听盘的朝向
#   sweep  触须向后拖的幅度
POSES = {
    "base":  dict(lean=0.0, neck=0.0, head_x=0.0, dish=(0, -.94, -.34), sweep=0.0),
    "drift": dict(lean=.30, neck=.60, head_x=0.0, dish=(0, -.35, -.94), sweep=0.0),
    "sus":   dict(lean=-.04, neck=-.22, head_x=.09, dish=(.42, -.88, .2), sweep=.1),
    "hunt":  dict(lean=.50, neck=-.45, head_x=0.0, dish=(0, -1, -.06), sweep=.5),
}
PP = POSES[POSE]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
src = bpy.data.collections.new("source_parts")
scene.collection.children.link(src)
parts = []

# ---------------- 骨架 → Skin 修改器 → 细分 ----------------
V = []      # 顶点
E = []      # 边
R = []      # 每个顶点的截面半径


def node(p, r, parent=None):
    V.append(Vector(p))
    R.append(r)
    i = len(V) - 1
    if parent is not None:
        E.append((parent, i))
    return i


def chain(points, radii, parent):
    i = parent
    for p, r in zip(points, radii):
        i = node(p, r, i)
    return i


# 脊柱：骨盆 → 胸 → 肩 → 颈 → 头，整体前倾
spine_def = [
    ((0, .06, .78), .17), ((0, .10, .92), .15), ((0, .11, 1.06), .13), ((0, .08, 1.20), .12),
    ((0, .02, 1.34), .12), ((0, -.07, 1.48), .12), ((0, -.18, 1.62), .11),
    ((0, -.33, 1.74), .075), ((0, -.46, 1.80), .11),
]
SB = [p for p, r in spine_def]          # 原始造型下的脊柱节点，姿态变形以它们为轴


def rot_x(p, piv, a):
    dy = p[1] - piv[1]
    dz = p[2] - piv[2]
    return (p[0], piv[1] + dy * math.cos(a) - dz * math.sin(a), piv[2] + dy * math.sin(a) + dz * math.cos(a))


def xf(p, lvl):
    """把原始造型里的一个点摆进当前姿态。lvl = 它挂在第几节脊椎上（0 骨盆 … 8 头）。"""
    p = tuple(p)
    if lvl >= 7:
        p = rot_x(p, SB[6], PP["neck"])
        p = (p[0] + PP["head_x"] * (.45 if lvl == 7 else 1.0), p[1], p[2])
    for j in range(min(lvl, 4), 0, -1):
        p = rot_x(p, SB[j - 1], PP["lean"] / 4)
    return p


spine = []
prev = None
for i, (p, r) in enumerate(spine_def):
    prev = node(xf(p, i), r, prev)
    spine.append(prev)

# 肋骨：从脊柱向两侧再向前合拢，胸前留一道缺口（敞开的笼子）
rib_w = {1: .22, 2: .31, 3: .38, 4: .42, 5: .40, 6: .33}
for si, w in rib_w.items():
    base = Vector(SB[si])
    for sgn in (-1, 1):
        pts, rad = [], []
        for k in range(1, 7):
            a = k / 6.0
            phi = a * 2.55
            pts.append(xf((sgn * w * math.sin(phi), base.y - w * .95 * (1 - math.cos(phi)), base.z - .2 * a), si))
            rad.append(.036 * (1 - a) + .013)
        chain(pts, rad, spine[si])

# 背棘
for si in (2, 3, 4, 5, 6):
    base = Vector(SB[si])
    ln = .2 + .05 * (si - 2)
    chain([xf(q, si) for q in ((0, base.y + .1, base.z + .04), (0, base.y + .1 + ln * .6, base.z + .1 + ln * .3), (0, base.y + .1 + ln, base.z + .12 + ln * .8))],
          [.04, .02, .006], spine[si])

# 手臂：肩 → 肘 → 腕 → 三根细长指叉
def arm(sgn, elbow, wrist_p, F, S, D, L, spread, curl):
    """肩固定；给出肘、腕，以及指叉的伸出方向 F、张开方向 S、弯钩方向 D。坐标都是原始造型空间。"""
    wi = chain([xf(q, 6) for q in ((sgn * .27, -.16, 1.60), elbow, wrist_p)], [.085, .055, .04], spine[6])
    F = Vector(F).normalized()
    S = Vector(S).normalized()
    D = Vector(D)
    for k in range(3):
        pts = []
        for t in (.34, .68, 1.0):
            q = Vector(wrist_p) + F * L * t + S * spread * (k - 1) * t + D * curl * t * t
            pts.append(xf(q, 6))
        chain(pts, [.022, .014, .006], wi)


for sgn in (-1, 1):
    if POSE == "base":
        wrist = chain([(sgn * .27, -.16, 1.60), (sgn * .53, -.10, 1.22), (sgn * .49, -.42, .98)], [.085, .055, .04], spine[6])
        for k in range(3):
            chain([(sgn * (.43 + .06 * k), -.62, .90 - .05 * k), (sgn * (.38 + .08 * k), -.84, .80 - .08 * k), (sgn * (.36 + .09 * k), -1.0, .74 - .1 * k)],
                  [.022, .014, .006], wrist)
    elif POSE == "drift":
        # 两臂垂着，指叉朝下耷拉
        arm(sgn, (sgn * .36, -.06, 1.22), (sgn * .33, -.10, .90), (0, -.1, -1), (sgn, 0, 0), (0, -1, 0), .5, .1, .06)
    elif POSE == "sus":
        if sgn > 0:
            # 右手半举，指叉张开停在半空
            arm(sgn, (.55, -.22, 1.40), (.47, -.56, 1.50), (-.1, -.95, .25), (.8, 0, .6), (0, 0, -1), .5, .28, .05)
        else:
            arm(sgn, (-.53, -.10, 1.22), (-.49, -.42, .98), (.13, -.9, -.42), (-1, 0, -.3), (0, 0, -1), .62, .12, 0.0)
    else:
        # 猎杀：两臂向前向外张开，指叉上下撑开、指尖向内钩
        arm(sgn, (sgn * .70, -.25, 1.62), (sgn * .88, -.68, 1.72), (-sgn * .15, -.95, -.2), (0, 0, 1), (-sgn, 0, 0), .66, .34, .16)

# 触须：从骨盆垂下，向外散开并带一点摆动
for k in range(9):
    th = k * math.tau / 9 + .35
    pts, rad = [], []
    for j in range(1, 7):
        s = j / 6.0
        rr = .1 + .3 * s ** .8 + .05 * math.sin(3 * math.pi * s + k * 1.7)
        ang = th + .55 * s * math.sin(k * 2.3)
        pts.append((math.cos(ang) * rr, .06 + math.sin(ang) * rr + PP["sweep"] * .9 * s ** 1.6,
                    .74 - .66 * s + .03 * math.sin(k + 5 * s) + PP["sweep"] * .15 * s))
        rad.append(.07 * (1 - s) + .011)
    chain(pts, rad, spine[0])

me = bpy.data.meshes.new("skeleton")
me.from_pydata([tuple(v) for v in V], E, [])
me.update()
body = bpy.data.objects.new("body_skeleton", me)
src.objects.link(body)
body.modifiers.new("Skin", 'SKIN')
sv = me.skin_vertices[0].data
for i, r in enumerate(R):
    sv[i].radius = (r, r)
    sv[i].use_root = (i == 0)
sub = body.modifiers.new("Subdivision", 'SUBSURF')
sub.levels = 2
sub.render_levels = 2
parts.append(body)


# ---------------- 听盘：带同心波纹和褶边的漏斗 ----------------
def dish(name, center, axis, radius, depth, lobes, rings=14, segs=54):
    axis = Vector(axis).normalized()
    up = Vector((0, 0, 1))
    side = axis.cross(up)
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    up2 = side.cross(axis).normalized()
    verts, faces = [], []
    for j in range(rings + 1):
        u = j / rings
        for i in range(segs):
            th = i * math.tau / segs
            rr = radius * (.06 + .94 * u ** .8) * (1 + .11 * math.cos(lobes * th) * u * u)
            off = -depth * .25 + depth * u ** 1.6 + .012 * math.sin(j * 1.9) * u
            verts.append(tuple(Vector(center) + axis * off + (side * math.cos(th) + up2 * math.sin(th)) * rr))
    for j in range(rings):
        for i in range(segs):
            a = j * segs + i
            b = j * segs + (i + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    faces.append(tuple(range(segs - 1, -1, -1)))          # 封住盘底
    m = bpy.data.meshes.new(name)
    m.from_pydata(verts, [], faces)
    m.update()
    ob = bpy.data.objects.new(name, m)
    src.objects.link(ob)
    so = ob.modifiers.new("Solidify", 'SOLIDIFY')
    so.thickness = .014
    sb = ob.modifiers.new("Subdivision", 'SUBSURF')
    sb.levels = 1
    sb.render_levels = 1
    parts.append(ob)


head = V[spine[8]]
if POSE == "base":
    dish("ear_main", head + Vector((0, -.07, .0)), (0, -.94, -.34), .37, .2, 9)
else:
    dish("ear_main", head + Vector(PP["dish"]).normalized() * .07, PP["dish"], .37, .2, 9)
for sgn in (-1, 1):
    dish("ear_side", xf((sgn * .2, -.36, 1.94), 8), (sgn * .78, -.42, .46), .17, .1, 7, rings=9, segs=36)

# ---------------- 合并成一个网格 ----------------
dg = bpy.context.evaluated_depsgraph_get()
bm = bmesh.new()
for ob in parts:
    ev = ob.evaluated_get(dg)
    tmp = bpy.data.meshes.new_from_object(ev)
    tmp.transform(ob.matrix_world)
    bm.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((0, .2, 0)))     # 让胸腔中心落在原点上方
bmesh.ops.triangulate(bm, faces=bm.faces)
final = bpy.data.meshes.new("Listener")
bm.to_mesh(final)
bm.free()
for poly in final.polygons:
    poly.use_smooth = True
listener = bpy.data.objects.new("Listener", final)
scene.collection.objects.link(listener)
src.hide_viewport = True
src.hide_render = True

zs = [v.co.z for v in final.vertices]
ys = [v.co.y for v in final.vertices]
xs = [v.co.x for v in final.vertices]
print("LISTENER verts=%d tris=%d  x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]" % (
    len(final.vertices), len(final.polygons), min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))

# ---------------- 保存与导出 ----------------
if OUT_BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
for ob in bpy.data.objects:
    ob.select_set(False)
listener.select_set(True)
bpy.context.view_layer.objects.active = listener
bpy.ops.wm.obj_export(filepath=OUT_OBJ, export_selected_objects=True, forward_axis='NEGATIVE_Z', up_axis='Y',
                      export_materials=False, export_uv=False, export_normals=True, export_triangulated_mesh=True)
print("EXPORTED", OUT_OBJ)

# ---------------- 预览图（失败不影响导出） ----------------
if OUT_PNG:
    try:
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.render.resolution_x = 640
        scene.render.resolution_y = 800
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'SINGLE'
        scene.display.shading.single_color = (.75, .78, .8)
        scene.display.shading.show_cavity = True
        scene.display.shading.show_shadows = True
        cam_data = bpy.data.cameras.new("cam")
        cam_data.lens = 50
        cam = bpy.data.objects.new("cam", cam_data)
        scene.collection.objects.link(cam)
        scene.camera = cam
        target = Vector((0, 0, 1.05))
        for tag, pos in (("front", (1.9, -3.6, 1.5)), ("side", (4.0, .2, 1.3)), ("back", (-2.2, 3.4, 1.9))):
            cam.location = pos
            d = target - Vector(pos)
            cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = OUT_PNG + "_" + tag + ".png"
            bpy.ops.render.render(write_still=True)
            print("RENDERED", scene.render.filepath)
    except Exception as ex:      # noqa
        print("PREVIEW FAILED:", ex)
