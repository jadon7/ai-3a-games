"""量一下托尔格的身体：摆正以后（面朝 -Y、左手 +X）各个高度的宽度和厚度，头盔、肩甲、手的大小。只读不写模型。
用法: Blender -b --factory-startup -P art/hero/torg/probe.py -- art/hero/torg/tripo_rigged.glb [输出图前缀]
"""
import bpy, sys, math, os
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE"); body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
for o in list(sc.objects):
    if o not in (arm, body): bpy.data.objects.remove(o, do_unlink=True)
B = arm.data.bones; MX = "mixamorig:"
toe = B[MX + "LeftToeBase"].head_local - B[MX + "LeftFoot"].head_local
yaw = -math.pi / 2 - math.atan2(toe.y, toe.x); R = Matrix.Rotation(round(yaw / (math.pi / 2)) * (math.pi / 2), 4, "Z")
arm.data.transform(R); body.data.transform(R); body.data.update(); bpy.context.view_layer.update()
hp = B[MX + "Hips"].head_local; T = Matrix.Translation((-hp.x, -hp.y, 0)); arm.data.transform(T); body.data.transform(T); body.data.update(); bpy.context.view_layer.update()
gname = {g.index: g.name.replace(MX, "") for g in body.vertex_groups}
vs = []
for v in body.data.vertices:
    top = max(v.groups, key=lambda g: g.weight) if v.groups else None
    vs.append((v.co.copy(), gname[top.group] if top else "-"))
print("VERTS", len(vs))
print("== 每个高度的范围（全部顶点）: z  x[min,max]  y[min,max]")
for i in range(0, 21):
    z0 = i * 0.05; sl = [c for c, _ in vs if z0 <= c.z < z0 + 0.05]
    if sl: print("  z %.2f  x[%+.3f, %+.3f]  y[%+.3f, %+.3f]  n=%d" % (z0, min(c.x for c in sl), max(c.x for c in sl), min(c.y for c in sl), max(c.y for c in sl), len(sl)))
print("== 按骨骼分的包围盒")
for nm in ("Head", "Neck", "Spine2", "Spine1", "Spine", "Hips", "RightShoulder", "RightArm", "RightForeArm", "RightHand", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightUpLeg", "RightLeg", "LeftUpLeg"):
    sl = [c for c, g in vs if g == nm]
    if sl: print("  %-14s n=%5d  x[%+.3f, %+.3f]  y[%+.3f, %+.3f]  z[%+.3f, %+.3f]" % (nm, len(sl), min(c.x for c in sl), max(c.x for c in sl), min(c.y for c in sl), max(c.y for c in sl), min(c.z for c in sl), max(c.z for c in sl)))
print("== 躯干中线附近（|x|<0.05）前后: z  y[min,max]；右肩上方（-0.26<x<-0.12）: z 最高")
for i in range(8, 20):
    z0 = i * 0.05; sl = [c for c, _ in vs if z0 <= c.z < z0 + 0.05 and abs(c.x) < 0.05]
    if sl: print("  z %.2f  y[%+.3f, %+.3f]" % (z0, min(c.y for c in sl), max(c.y for c in sl)))
for x0 in (-0.30, -0.26, -0.22, -0.18, -0.14, -0.10, 0.10, 0.14, 0.18, 0.22, 0.26, 0.30):
    sl = [c for c, _ in vs if x0 <= c.x < x0 + 0.04 and c.z > 0.6]
    if sl: print("  x %+.2f  顶 z=%.3f  y[%+.3f, %+.3f]" % (x0, max(c.z for c in sl), min(c.y for c in sl), max(c.y for c in sl)))
for side in ("Left", "Right"):
    h = B[MX + side + "Hand"].head_local; idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local; mid = B[MX + side + "HandMiddle1"].head_local
    print(side, "hand", [round(v, 3) for v in h], "index1", [round(v, 3) for v in idx], "pinky1", [round(v, 3) for v in pky], "mid1", [round(v, 3) for v in mid], "手掌宽", round((idx - pky).length, 3))
    for f in ("Index", "Middle"):
        ln = sum(B[MX + side + "Hand" + f + str(j)].length for j in (1, 2, 3)); print("   ", f, "三节指长", round(ln, 3))
    print("    上臂", round(B[MX + side + "Arm"].length, 3), "前臂", round(B[MX + side + "ForeArm"].length, 3), "肩头", [round(v, 3) for v in B[MX + side + "Arm"].head_local])
if len(argv) > 1:
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try: sc.render.engine = eng; break
        except TypeError: pass
    res = 640; sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.15; c = Vector((0, 0, 0.5))
    for i, (az, el) in enumerate(((0, 8), (35, 18), (90, 8), (180, 8), (270, 8), (0, 70))):
        az = math.radians(az); el = math.radians(el); d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
        cam.location = c + d * 6; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler(); sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
        sc.render.filepath = f"{argv[1]}_{i}.png"; bpy.ops.render.render(write_still=True)
