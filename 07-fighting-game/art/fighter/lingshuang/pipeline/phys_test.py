"""马尾骨骼链弯起来看蒙皮：静止、向后甩起、向一侧甩、S 形，每种从侧面和背后各渲一张，拼成一张图。
用法: Blender -b --factory-startup -P phys_test.py -- <game_phys.glb> <输出.jpg>"""
import bpy, sys, math, os
import numpy as np
from mathutils import Vector, Quaternion, Matrix
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0]); sc = bpy.context.scene
for o in sc.objects:
    if o.type == "MESH" and o.name.startswith("Icosphere"): o.hide_render = True
arm = next(o for o in sc.objects if o.type == "ARMATURE"); ad = arm.animation_data
tr = {t.name: t for t in ad.nla_tracks}
for t in ad.nla_tracks: t.mute = True
ad.action = tr["idle_pose"].strips[0].action
if hasattr(ad, "action_slot") and len(ad.action.slots): ad.action_slot = ad.action.slots[0]
sc.frame_set(0)
PH = [arm.pose.bones["phys_ponytail_%02d" % i] for i in range(1, 5)]
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.view_settings.view_transform = "Standard"; sc.render.resolution_x = 520; sc.render.resolution_y = 520
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.52, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.4; sun.rotation_euler = (0.8, 0.2, 2.6)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 0.5
head = arm.matrix_world @ arm.pose.bones["mixamorig:Head"].head
c = head + Vector((0, 0.08, -0.02))
POSES = {"rest": (0, 0), "back_up": (-28, 0), "side": (0, 30), "s_curve": (18, -25)}
VIEWS = {"side": Vector((-1, 0.15, 0.1)), "back": Vector((0.25, 1, 0.15))}
tiles = []
for pn, (pitch, yaw) in POSES.items():
    for i, pb in enumerate(PH):
        pb.rotation_mode = "XYZ"; sgn = -1 if (pn == "s_curve" and i >= 2) else 1
        pb.rotation_euler = (math.radians(pitch), 0, math.radians(yaw * sgn))
    bpy.context.view_layer.update()
    for vn, d in VIEWS.items():
        cam.location = c + d.normalized() * 3; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        p = os.path.join(os.path.dirname(argv[1]), f"_ph_{pn}_{vn}.png"); sc.render.filepath = p; bpy.ops.render.render(write_still=True); tiles.append(p)
ims = []
for p in tiles:
    im = bpy.data.images.load(p); ims.append(np.array(im.pixels[:]).reshape(520, 520, 4)[::-1, :, :3]); bpy.data.images.remove(im); os.remove(p)
rows = [np.concatenate(ims[i:i + 4], 1) for i in range(0, len(ims), 4)]; sh = np.concatenate(rows, 0); H, W = sh.shape[:2]
img = bpy.data.images.new("s", W, H); img.pixels = np.concatenate([sh[::-1], np.ones((H, W, 1))], 2).ravel(); img.filepath_raw = argv[1]; img.file_format = "JPEG"; img.save(); print("SHEET", argv[1])
