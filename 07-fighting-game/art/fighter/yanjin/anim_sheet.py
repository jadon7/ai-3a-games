"""动作连拍：导入 GLB，每段动作均匀抽 n 帧，正面一行、侧面一行（侧面 = 游戏镜头，在角色右手一侧），EEVEE 小图。
图块写到 <输出目录>/<动作>_<机位>_<i>_f<帧>.png，再由 sheet.py 拼图加标注。
用法: Blender -b --factory-startup -P anim_sheet.py -- <glb> <输出目录> <动作,动作…|all> [每段帧数=10] [边长=240] [机位=front,side]
帧数写成 "f:3" 表示每隔 3 帧取一张（整段）。"""
import bpy, sys, math, os, json
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
src, outd, acts = argv[0], argv[1], argv[2]; nspec = argv[3] if len(argv) > 3 else "10"; res = int(argv[4]) if len(argv) > 4 else 240
cams = (argv[5] if len(argv) > 5 else "front,side").split(","); os.makedirs(outd, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in sc.objects:
    if o.type == "MESH" and o.name.startswith("Icosphere"): o.hide_render = True
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes["Background"].inputs[0].default_value = (0.45, 0.46, 0.48, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.8; sun.rotation_euler = (0.7, 0.2, -0.9)
bpy.ops.mesh.primitive_plane_add(size=6); fl = bpy.context.object; m = bpy.data.materials.new("fl"); m.use_nodes = True
next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.25, 0.26, 0.28, 1); fl.data.materials.append(m)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.6
ad = arm.animation_data; tracks = {t.name: t for t in ad.nla_tracks}
acts = [t for t in tracks] if acts == "all" else acts.split(",")
VIEW = {"front": (0, 4), "side": (270, 4), "q": (300, 15), "back": (180, 4)}
idx = []
for a in acts:
    if a not in tracks: print("SKIP", a); continue
    act = tracks[a].strips[0].action
    for t in ad.nla_tracks: t.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and len(getattr(act, "slots", [])): ad.action_slot = act.slots[0]
    f0, f1 = [int(round(x)) for x in act.frame_range]
    frames = list(range(f0, f1 + 1, int(nspec[2:]))) if nspec.startswith("f:") else sorted({round(f0 + (f1 - f0) * i / (int(nspec) - 1)) for i in range(int(nspec))})
    for cv in cams:
        az, el = [math.radians(x) for x in VIEW[cv]]
        d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))); c = Vector((0, -0.1 if cv == "side" else 0, 0.6))
        cam.location = c + d * 6; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        for i, f in enumerate(frames):
            sc.frame_set(f); p = os.path.join(outd, f"{a}_{cv}_{i:03d}_f{f}.png"); sc.render.filepath = p; bpy.ops.render.render(write_still=True); idx.append([a, cv, i, f, p])
json.dump(idx, open(os.path.join(outd, "index.json"), "w"))
print("TILES", len(idx))
