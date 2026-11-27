"""在 Blender 里把 game.glb 的每段动作均匀抽几帧渲染出来（正面偏右 25 度、侧面两个机位），拼成一张联系表。不用经过网页、不用先出品。
用法: Blender -b --factory-startup -P art/hero/lingshuang/anim_render.py -- <game.glb> <输出.jpg> <动作,动作…> [每段帧数=8] [格子边长=260] [机位=front,side]"""
import bpy, sys, math, os
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
src, out, acts = argv[0], argv[1], argv[2].split(","); n = int(argv[3]) if len(argv) > 3 else 8; res = int(argv[4]) if len(argv) > 4 else 260
cams = (argv[5] if len(argv) > 5 else "front,side").split(",")
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in sc.objects:
    if o.type == "MESH" and o.name.startswith("Icosphere"): o.hide_render = True
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5; sun.rotation_euler = (0.7, 0.2, 0.6)
# 地面一条线：看脚有没有陷进去
bpy.ops.mesh.primitive_plane_add(size=4); fl = bpy.context.object; m = bpy.data.materials.new("fl"); m.use_nodes = True
next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.3, 0.31, 0.33, 1); fl.data.materials.append(m)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = float(os.environ.get("ORTHO", "1.35"))
ad = arm.animation_data; tracks = {t.name: t for t in ad.nla_tracks}
VIEW = {"front": (25, 6), "side": (95, 6), "rside": (-90, 4), "front0": (0, 4), "back": (205, 10), "top": (20, 50)}
tiles = []
for a in acts:
    if a not in tracks: print("SKIP", a); continue
    st = tracks[a].strips[0]; act = st.action
    for t in ad.nla_tracks: t.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and len(getattr(act, "slots", [])): ad.action_slot = act.slots[0]
    f0, f1 = act.frame_range
    for cv in cams:
        az, el = [math.radians(x) for x in VIEW[cv]]
        d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))); c = Vector((0, 0, 0.55))
        cam.location = c + d * 6; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        for i in range(n):
            f = f0 + (f1 - f0) * i / (n - 1); sc.frame_set(int(f), subframe=f - int(f))
            p = os.path.join(os.path.dirname(os.path.abspath(out)), f"_ar_{a}_{cv}_{i}.png"); sc.render.filepath = p; bpy.ops.render.render(write_still=True); tiles.append((a, cv, i, round(f), p))
import numpy as np
rows = {}
for a, cv, i, f, p in tiles: rows.setdefault((a, cv), []).append((f, p))
img_rows = []
for key, lst in rows.items():
    ims = []
    for f, p in lst:
        im = bpy.data.images.load(p); px = np.array(im.pixels[:]).reshape(res, res, 4)[::-1, :, :3]; bpy.data.images.remove(im); os.remove(p); ims.append(px)
    img_rows.append(np.concatenate(ims, 1))
sheet = np.concatenate(img_rows, 0); H, W = sheet.shape[:2]
img = bpy.data.images.new("sheet", W, H); img.pixels = np.concatenate([sheet[::-1], np.ones((H, W, 1))], 2).ravel(); img.filepath_raw = out; img.file_format = "JPEG"; img.save()
print("SHEET", out, [f"{k[0]}/{k[1]}" for k in rows])
