"""摩珂自己用的检查渲染和量数（tools/blender/views.py 会把导入器生成的骨骼形状 Icosphere 算进包围盒，角色只占画面一小块，看不清）。
用法: Blender -b --factory-startup -P art/hero/moko/check.py -- in.glb out前缀 [每格边长=640] [角度列表 "0:8,-35:18,..."] [动作名=idle_pose，写 - 是静止姿势] [帧=0] [中心 x,y,z] [画面高度]
角度写成 “水平角:俯角”，水平角 0 是从 -Y 往 +Y 看（角色面朝 -Y，也就是正面）；-90 是从她右手边看。每个角度存一张 <out前缀>_<i>.png。
打印：摆好姿势后的包围盒、灯杖的两头和倾角、杖尾离地多高、灯杖顶点陷进身体哪些部位、灯杖离斗笠最近多远。
"""
import bpy, sys, math, os
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
res = int(argv[2]) if len(argv) > 2 else 640
views = argv[3] if len(argv) > 3 and argv[3] not in ("", "-") else "0:8,-35:18,-90:8,180:8,90:8,0:56"
act_name = argv[4] if len(argv) > 4 else "idle_pose"
frame = int(argv[5]) if len(argv) > 5 else 0
ctr = [float(v) for v in argv[6].split(",")] if len(argv) > 6 and argv[6] not in ("", "-") else [-0.06, 0.0, 0.62]
span = float(argv[7]) if len(argv) > 7 else 1.42
MX = "mixamorig:"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and len(o.vertex_groups) == 0: bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in sc.objects if o.type == "MESH")
if not arm.animation_data: arm.animation_data_create()
for tr in list(arm.animation_data.nla_tracks): tr.mute = True
if act_name not in ("", "-"):
    act = bpy.data.actions.get(act_name) or next((a for a in bpy.data.actions if a.name.startswith(act_name)), None)
    assert act, ("没有这个动作", [a.name for a in bpy.data.actions])
    arm.animation_data.action = act
    try:
        if getattr(act, "slots", None) and len(act.slots): arm.animation_data.action_slot = act.slots[0]
    except Exception as e: print("SLOT", e)
    sc.frame_set(frame)
else:
    arm.animation_data.action = None
    for pb in arm.pose.bones: pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
bpy.context.view_layer.update()

# ---- 量数 ----
dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles()
mw = body.matrix_world; co = [mw @ v.co for v in me.vertices]
names = [s.material.name if s.material else "?" for s in body.material_slots]
gname = {g.index: g.name for g in body.vertex_groups}
def dom(vi):
    gs = body.data.vertices[vi].groups
    return gname[max(gs, key=lambda g: g.weight).group].replace(MX, "") if len(gs) else "?"
wtri = [t for t in me.loop_triangles if names[t.material_index].startswith("weapon")]
btri = [t for t in me.loop_triangles if not names[t.material_index].startswith("weapon")]
wv = sorted({v for t in wtri for v in t.vertices}); bv = sorted({v for t in btri for v in t.vertices})
bmn = [round(min(co[v][i] for v in bv), 3) for i in range(3)]; bmx = [round(max(co[v][i] for v in bv), 3) for i in range(3)]
print("BODY bbox", bmn, bmx)
for part, keys in (("RightFootMesh", ("RightFoot", "RightToeBase", "RightToe_End")), ("LeftFootMesh", ("LeftFoot", "LeftToeBase", "LeftToe_End")), ("RightHandMesh", ("RightHand",))):
    vs = [co[v] for v in bv if dom(v).startswith(keys)]
    if vs: print("PART %-14s min %s max %s" % (part, [round(min(c[i] for c in vs), 3) for i in range(3)], [round(max(c[i] for c in vs), 3) for i in range(3)]))
PB = arm.pose.bones
for nm in ("Hips", "Head", "LeftHand", "RightHand", "RightForeArm", "RightArm", "LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"):
    print("JOINT %-13s %s" % (nm, [round(v, 3) for v in (arm.matrix_world @ PB[MX + nm].head)]))
if wv:
    # 灯杖的轴：顶点做主成分，取最长的方向
    import numpy as np
    W = np.array([list(co[v]) for v in wv]); c = W.mean(0); u, s_, vt = np.linalg.svd(W - c, full_matrices=False); ax = vt[0]
    if ax[2] < 0: ax = -ax
    t = (W - c) @ ax; lo = W[t < t.min() + 0.03 * (t.max() - t.min())].mean(0); hi = W[t > t.max() - 0.03 * (t.max() - t.min())].mean(0)
    print("STAFF bottom", [round(float(v), 3) for v in lo], "top", [round(float(v), 3) for v in hi], "minz", round(float(W[:, 2].min()), 3), "maxz", round(float(W[:, 2].max()), 3),
          "len", round(float(t.max() - t.min()), 3), "tilt_deg", round(math.degrees(math.acos(min(1, abs(ax[2])))), 1), "axis", [round(float(v), 3) for v in ax])
    wmn = W.min(0); wmx = W.max(0); print("STAFF bbox", [round(float(v), 3) for v in wmn], [round(float(v), 3) for v in wmx])
    # 穿模：灯杖的顶点在不在身体里面（往六个方向打射线，数穿过身体表面的次数，奇数算在里面，多数票）
    tree = BVHTree.FromPolygons(co, [tuple(t.vertices) for t in btri])
    dirs = [Vector(d).normalized() for d in ((1, 0.13, 0.07), (-1, 0.11, 0.09), (0.12, 1, 0.05), (0.07, -1, 0.11), (0.09, 0.13, 1), (0.1, 0.07, -1))]
    tri_dom = {}
    inside = {}
    for vi in wv:
        p = co[vi]; votes = 0
        for d in dirs:
            n = 0; o = p.copy()
            for _ in range(60):
                hit = tree.ray_cast(o, d)
                if hit[0] is None: break
                n += 1; o = hit[0] + d * 1e-5
            votes += n % 2
        if votes >= 4:
            loc, nor, idx, dist = tree.find_nearest(p)
            b = dom(btri[idx].vertices[0]); inside.setdefault(b, []).append(dist)
    tot = sum(len(v) for v in inside.values())
    print("INSIDE weapon verts in body: %d / %d" % (tot, len(wv)))
    for b, ds in sorted(inside.items(), key=lambda kv: -len(kv[1])): print("  INSIDE %-18s n=%4d  最深 %.3f" % (b, len(ds), max(ds)))
    # 离斗笠（跟着头骨的顶点）最近多远；离身体其余部分（不含右手、右前臂）最近多远
    headv = [v for v in bv if dom(v) in ("Head", "HeadTop_End", "Neck")]
    hk = BVHTree.FromPolygons(co, [tuple(t.vertices) for t in btri if dom(t.vertices[0]) in ("Head", "HeadTop_End", "Neck")])
    ok = BVHTree.FromPolygons(co, [tuple(t.vertices) for t in btri if not dom(t.vertices[0]).startswith("Right") or dom(t.vertices[0]) in ("RightUpLeg", "RightLeg", "RightFoot", "RightToeBase")])
    dh = min(((hk.find_nearest(co[v])[3], v) for v in wv), key=lambda x: x[0]); db = min(((ok.find_nearest(co[v])[3], v) for v in wv), key=lambda x: x[0])
    print("NEAR hat %.3f at %s ; body(不含右臂右手) %.3f at %s" % (dh[0], [round(x, 3) for x in co[dh[1]]], db[0], [round(x, 3) for x in co[db[1]]]))
ev.to_mesh_clear()

# ---- 渲染 ----
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = span; center = Vector(ctr)
# 地面：一块浅色的板，看脚和杖尾有没有踩在地上
bpy.ops.mesh.primitive_plane_add(size=3, location=(0, 0, 0)); g = bpy.context.active_object
gm = bpy.data.materials.new("ground"); gm.use_nodes = True
next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.36, 0.37, 0.39, 1); g.data.materials.append(gm)
files = []
for i, v in enumerate(views.split(",")):
    az, el = (v.split(":") + ["8"])[:2]; az = math.radians(float(az)); el = math.radians(float(el))
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.location = center + d * 6; cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
    f = f"{out}_{i}.png"; sc.render.filepath = f; bpy.ops.render.render(write_still=True); files.append(f)
print("FILES", " ".join(files))
