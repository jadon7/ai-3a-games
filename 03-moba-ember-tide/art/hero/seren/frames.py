"""用 Blender 把一个带动作的 GLB 的某段动作按帧渲出来（正面 + 侧面并排），拼成一张图。看读出来的动作不用开网页。
用法: Blender -b --factory-startup -P art/hero/seren/frames.py -- <模型.glb> <输出.jpg> <动作名> <帧号,帧号,… 或 起:止:步长> [视角=0:5,90:5] [每格边长=300]
"""
import bpy, sys, math, os
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
src, out, act_name, spec = argv[:4]; views = argv[4] if len(argv) > 4 else "0:5,90:5"; res = int(argv[5]) if len(argv) > 5 else 300
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=src)      # 成品是 30 帧每秒，先设好，导入的帧号才对得上
sc = bpy.context.scene
for o in sc.objects:
    if o.type == "MESH" and o.name.startswith("Icosphere"): o.hide_render = True
arm = next(o for o in sc.objects if o.type == "ARMATURE"); ad = arm.animation_data or arm.animation_data_create()
for tr in list(ad.nla_tracks): tr.mute = True
act = bpy.data.actions.get(act_name) or next(a for a in bpy.data.actions if a.name.startswith(act_name))
ad.action = act
if hasattr(ad, "action_slot") and len(getattr(act, "slots", [])): ad.action_slot = act.slots[0]
fr = act.frame_range
if ":" in spec: a, b, s = [int(v) for v in spec.split(":")]; frames = list(range(a, b + 1, s))
else: frames = [int(v) for v in spec.split(",")]
frames = [f for f in frames if f <= fr[1]]
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True
bg = next(n for n in wd.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = float(os.environ.get("FR_ORTHO", 1.9)); c = Vector([float(v) for v in os.environ.get("FR_C", "0,0,0.6").split(",")])      # 近看：FR_ORTHO 画面宽、FR_C 看哪一点
tmp = os.path.splitext(out)[0] + "_tmp"; os.makedirs(tmp, exist_ok=True); files = []
for f in frames:
    sc.frame_set(f)
    for j, v in enumerate(views.split(",")):
        az, el = [math.radians(float(x)) for x in v.split(":")]
        d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
        cam.location = c + d * 6; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
        p = f"{tmp}/{f:03d}_{j}.png"; sc.render.filepath = p; bpy.ops.render.render(write_still=True); files.append(p)
print("FRAMES", act.name, "range", tuple(fr), "rendered", frames)
print("FILES", ";".join(files))
