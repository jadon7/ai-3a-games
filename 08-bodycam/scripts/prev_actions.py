import bpy, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
glb, outdir, tag, n = argv[0], argv[1], argv[2], int(argv[3])
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.fps = 30
bpy.ops.import_scene.gltf(filepath=glb)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.name.startswith("Icosphere"): bpy.data.objects.remove(o)
arm.scale = (1.8, 1.8, 1.8)
print("BONES", [b.name for b in arm.data.bones])
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.85, 0.9, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun)
sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = 240
sc.render.image_settings.file_format = "JPEG"
sc.view_settings.view_transform = "Standard"
cam_d = bpy.data.cameras.new("C"); cam_d.lens = 32
cam = bpy.data.objects.new("C", cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (4.6, -4.6, 1.5); cam.rotation_euler = (Vector((0, 0, 0.9)) - cam.location).to_track_quat("-Z", "Y").to_euler()
ad = arm.animation_data or arm.animation_data_create()
for a in bpy.data.actions:
    ad.action = a
    try: ad.action_slot = a.slots[0]
    except Exception: pass
    f0, f1 = a.frame_range
    for i in range(n):
        f = int(f0 + (f1 - f0) * i / (n - 1))
        sc.frame_set(f)
        sc.render.filepath = os.path.join(outdir, f"{tag}_{a.name}_{i:02d}.jpg")
        bpy.ops.render.render(write_still=True)
    print("ACT", a.name, f0, f1)
