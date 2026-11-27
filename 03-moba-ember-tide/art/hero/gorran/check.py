"""葛隆自己用的检查渲染（tools/blender/views.py 会把导入器生成的骨骼形状 Icosphere 算进包围盒，角色只占画面一小块，看不清）。
用法: Blender -b --factory-startup -P art/hero/gorran/check.py -- in.glb out.png [每格边长=640] [角度列表 "0:8,35:18,..."] [动作名=无(静止姿势)] [帧=0] [中心 x,y,z] [画面高度]
角度写成 “水平角:俯角”，水平角 0 是从 -Y 往 +Y 看（角色面朝 -Y，也就是正面）。拼成一张图（每行 3 格）。
同时打印：各材质的三角形数、武器顶点有多少陷在身体里（粗查穿模）。
"""
import bpy, sys, math, os
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
res = int(argv[2]) if len(argv) > 2 else 640
views = argv[3] if len(argv) > 3 else "0:8,35:18,90:8,180:8,-90:8,0:56"
act_name = argv[4] if len(argv) > 4 and argv[4] not in ("", "-") else None
frame = int(argv[5]) if len(argv) > 5 else 0
ctr = [float(v) for v in argv[6].split(",")] if len(argv) > 6 and argv[6] not in ("", "-") else None
span = float(argv[7]) if len(argv) > 7 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and len(o.vertex_groups) == 0: bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in sc.objects if o.type == "MESH")
if act_name:
    act = bpy.data.actions.get(act_name) or next((a for a in bpy.data.actions if a.name.startswith(act_name)), None)
    assert act, ("没有这个动作", [a.name for a in bpy.data.actions])
    if not arm.animation_data: arm.animation_data_create()
    for tr in list(arm.animation_data.nla_tracks): tr.mute = True
    arm.animation_data.action = act
    try:
        if getattr(act, "slots", None) and len(act.slots): arm.animation_data.action_slot = act.slots[0]
    except Exception as e: print("SLOT", e)
    sc.frame_set(frame)
else:
    if arm.animation_data:
        arm.animation_data.action = None
        for tr in list(arm.animation_data.nla_tracks): tr.mute = True
    for pb in arm.pose.bones: pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
bpy.context.view_layer.update()

# ---- 量一下：摆好姿势以后的包围盒、各材质三角形数、武器顶点陷进身体的比例 ----
dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles()
mw = body.matrix_world; co = [mw @ v.co for v in me.vertices]
mn = Vector([min(c[i] for c in co) for i in range(3)]); mx = Vector([max(c[i] for c in co) for i in range(3)])
names = [s.material.name if s.material else "?" for s in body.material_slots]; cnt = {n: 0 for n in names}
for t in me.loop_triangles: cnt[names[t.material_index]] += 1
print("TRIS", cnt, "total", len(me.loop_triangles)); print("BBOX", [round(v, 3) for v in mn], [round(v, 3) for v in mx])
bt = [t for t in me.loop_triangles if not names[t.material_index].startswith("weapon")]
wv = sorted({v for t in me.loop_triangles if names[t.material_index].startswith("weapon") for v in t.vertices})
if bt and wv:
    tree = BVHTree.FromPolygons(co, [tuple(t.vertices) for t in bt])
    dirs = [Vector(d).normalized() for d in ((1, 0.13, 0.07), (-1, 0.11, 0.09), (0.12, 1, 0.05), (0.07, -1, 0.11), (0.09, 0.13, 1), (0.1, 0.07, -1))]
    inside = []
    for vi in wv:
        p = co[vi]; votes = 0
        for d in dirs:
            n = 0; o = p.copy()
            for _ in range(40):
                hit = tree.ray_cast(o, d)
                if hit[0] is None: break
                n += 1; o = hit[0] + d * 1e-4
            votes += n % 2
        if votes >= 4: inside.append(p)
    print("WEAPON verts", len(wv), "inside body", len(inside))
    if inside:
        imn = Vector([min(c[i] for c in inside) for i in range(3)]); imx = Vector([max(c[i] for c in inside) for i in range(3)])
        print("  inside bbox", [round(v, 3) for v in imn], [round(v, 3) for v in imx])
    for bn in ("LeftHand", "RightHand", "LeftForeArm", "RightForeArm"):
        pb = arm.pose.bones.get("mixamorig:" + bn)
        if pb: print("  ", bn, [round(v, 3) for v in (arm.matrix_world @ pb.head)], "->", [round(v, 3) for v in (arm.matrix_world @ pb.tail)])
ev.to_mesh_clear()

for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs[0].default_value = (0.42, 0.43, 0.45, 1); bg.inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
size = mx - mn; center = Vector(ctr) if ctr else (mn + mx) / 2
cam.data.type = "ORTHO"; cam.data.ortho_scale = span if span else max(size) * 1.1
files = []
for i, v in enumerate(views.split(",")):
    az, el = (v.split(":") + ["8"])[:2]; az = math.radians(float(az)); el = math.radians(float(el))
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.location = center + d * 8
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
    f = f"{os.path.splitext(out)[0]}_{i}.png"; sc.render.filepath = f; bpy.ops.render.render(write_still=True); files.append(f)
# 拼成一张
cols = min(3, len(files)); rows = (len(files) + cols - 1) // cols
sheet = bpy.data.images.new("sheet", res * cols, res * rows, alpha=False)
import numpy as np
buf = np.zeros((res * rows, res * cols, 4), np.float32); buf[..., 3] = 1
for k, f in enumerate(files):
    im = bpy.data.images.load(f); a = np.empty(res * res * 4, np.float32); im.pixels.foreach_get(a); a = a.reshape(res, res, 4)
    r, c = k // cols, k % cols; buf[(rows - 1 - r) * res:(rows - r) * res, c * res:(c + 1) * res] = a
    bpy.data.images.remove(im); os.remove(f)
sheet.pixels.foreach_set(buf.ravel()); sheet.filepath_raw = out; sheet.file_format = "PNG"; sheet.save()
print("SHEET", out)
