"""摩珂自己用：一次渲染成品模型里若干“动作:帧”的大图（帧号是导入后 24 帧每秒的帧，时间 = 帧/24）。
用法: Blender -b --factory-startup -P art/hero/moko/shots.py -- in.glb out前缀 "q:16,e:24,…" [角度 "-30:15,-90:5"] [边长=420] [中心 x,y,z] [画面高度]
每张存成 <out前缀>_<序号>_<视角序号>.png，再用 sheet2.py 拼。
"""
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
src, out, items = argv[0], argv[1], [s.split(":") for s in argv[2].split(",")]
views = argv[3] if len(argv) > 3 and argv[3] not in ("", "-") else "-30:15,-90:5"
res = int(argv[4]) if len(argv) > 4 else 420
ctr = [float(v) for v in argv[5].split(",")] if len(argv) > 5 and argv[5] not in ("", "-") else [0, 0, 0.6]
span = float(argv[6]) if len(argv) > 6 else 1.9
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and len(o.vertex_groups) == 0: bpy.data.objects.remove(o, do_unlink=True)
if not arm.animation_data: arm.animation_data_create()
for tr in list(arm.animation_data.nla_tracks): tr.mute = True
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = span; center = Vector(ctr)
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0)); g = bpy.context.active_object
gm = bpy.data.materials.new("ground"); gm.use_nodes = True
next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.36, 0.37, 0.39, 1); g.data.materials.append(gm)
for k, (an, fr) in enumerate(items):
    act = bpy.data.actions.get(an); assert act, ("没有这个动作", an, [a.name for a in bpy.data.actions])
    arm.animation_data.action = act
    try:
        if getattr(act, "slots", None) and len(act.slots): arm.animation_data.action_slot = act.slots[0]
    except Exception as e: print("SLOT", e)
    sc.frame_set(int(fr)); bpy.context.view_layer.update()
    for i, v in enumerate(views.split(",")):
        az, el = (v.split(":") + ["8"])[:2]; az = math.radians(float(az)); el = math.radians(float(el))
        d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
        cam.location = center + d * 6; cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
        sc.render.filepath = f"{out}_{k:02d}_{i}.png"; bpy.ops.render.render(write_still=True)
print("SHOTS", len(items), "x", len(views.split(",")))
