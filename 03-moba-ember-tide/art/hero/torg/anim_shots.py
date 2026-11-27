"""把 game.glb 里的每段动作均匀抽帧渲染出来细看（预览页的机位拉远以后人太小）。每段动作一张图：上排右前方斜看，下排从角色右侧看。
用法: Blender -b --factory-startup -P art/hero/torg/anim_shots.py -- <game.glb> <输出目录> [每段几帧=10] [只看哪几段，逗号分隔] [格子边长=380]
"""
import bpy, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]; glb, out = argv[0], argv[1]; n = int(argv[2]) if len(argv) > 2 else 10; only = set(argv[3].split(",")) if len(argv) > 3 and argv[3] else None; res = int(argv[4]) if len(argv) > 4 else 380
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(sc.objects):
    if o.type == "MESH" and not len(o.vertex_groups): bpy.data.objects.remove(o, do_unlink=True)
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.view_settings.view_transform = "Standard"; sc.render.resolution_x = res; sc.render.resolution_y = res
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 2.3
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, -0.002)); pl = bpy.context.object; m = bpy.data.materials.new("floor"); m.use_nodes = True
next(nd for nd in m.node_tree.nodes if nd.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.3, 0.31, 0.3, 1); pl.data.materials.append(m)
arm.animation_data_create()
for tr in list(arm.animation_data.nla_tracks): tr.mute = True
order = ["idle", "run", "attack1", "q", "w", "r", "death"]
for name in order:
    act = bpy.data.actions.get(name)
    if not act or (only and name not in only): continue
    arm.animation_data.action = act
    try: arm.animation_data.action_slot = act.slots[0]
    except Exception: pass
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1]); files = []
    for vi, (az, el) in enumerate(((-35, 16), (-90, 6))):
        for i in range(n):
            f = round(f0 + (f1 - f0) * i / (n - 1)); sc.frame_set(f); c = Vector((0, -0.1, 0.62)); a = math.radians(az); e = math.radians(el)
            d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))); cam.location = c + d * 8; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
            sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
            sc.render.filepath = os.path.join(out, f"shot_{name}_{vi}_{i:02d}.png"); bpy.ops.render.render(write_still=True); files.append((vi, i, f))
    print("SHOTS", name, [f for vi, i, f in files if vi == 0])
