"""指定动作的指定时刻渲近景（右侧机位和斜前方），拼成一张。用法: Blender -b -P frame_shots.py -- <glb> <输出.jpg> 动作:秒,动作:秒,…"""
import bpy, sys, math, os
import numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=argv[0]); sc = bpy.context.scene
for o in sc.objects:
    if o.type == "MESH" and o.name.startswith("Icosphere"): o.hide_render = True
arm = next(o for o in sc.objects if o.type == "ARMATURE"); ad = arm.animation_data; tr = {t.name: t for t in ad.nla_tracks}
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
R = 460; sc.render.resolution_x = R; sc.render.resolution_y = R; sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes["Background"].inputs[0].default_value = (0.45, 0.46, 0.48, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.6; sun.rotation_euler = (0.7, 0.2, -1.2)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.3
ims = []
for item in argv[2].split(","):
    a, t = item.split(":"); act = tr[a].strips[0].action
    for x in ad.nla_tracks: x.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and len(act.slots): ad.action_slot = act.slots[0]
    f = float(t) * 30; sc.frame_set(int(f), subframe=f - int(f))
    hp = arm.matrix_world @ arm.pose.bones["mixamorig:Hips"].head; c = Vector((0, -0.15, max(0.45, hp.z)))
    for az in (-90, -35):
        d = Vector((math.sin(math.radians(az)), -math.cos(math.radians(az)), 0.12)); cam.location = c + d * 5; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        p = os.path.join(os.path.dirname(argv[1]), "_fs.png"); sc.render.filepath = p; bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(p); ims.append(np.array(im.pixels[:]).reshape(R, R, 4)[::-1, :, :3]); bpy.data.images.remove(im); os.remove(p)
cols = 4; rows = [np.concatenate(ims[i:i + cols] + [np.ones_like(ims[0])] * (cols - len(ims[i:i + cols])), 1) for i in range(0, len(ims), cols)]
sh = np.concatenate(rows, 0); H, W = sh.shape[:2]; img = bpy.data.images.new("s", W, H); img.pixels = np.concatenate([sh[::-1], np.ones((H, W, 1))], 2).ravel(); img.filepath_raw = argv[1]; img.file_format = "JPEG"; img.save(); print("SHEET", argv[1])
