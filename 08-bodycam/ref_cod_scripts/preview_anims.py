import bpy, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
glb, outdir, tag = argv[0], argv[1], argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.fps = 30
bpy.ops.import_scene.gltf(filepath=glb)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in bpy.data.objects:
    if o.name.startswith("Icosphere"): o.hide_render = True
arm.scale = (1.8, 1.8, 1.8)
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"; sc.display.shading.color_type = "TEXTURE"
sc.render.resolution_x = sc.render.resolution_y = 220
cam_d = bpy.data.cameras.new("C"); cam_d.lens = 35
cam = bpy.data.objects.new("C", cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (4.2, -4.2, 1.3); cam.rotation_euler = (Vector((0, 0, 0.9)) - cam.location).to_track_quat("-Z", "Y").to_euler()
ad = arm.animation_data or arm.animation_data_create()
for a in bpy.data.actions:
    ad.action = a
    try:
        ad.action_slot = a.slots[0]
    except Exception: pass
    f0, f1 = a.frame_range
    for i in range(6):
        f = int(f0 + (f1 - f0) * i / 5)
        sc.frame_set(f)
        sc.render.filepath = os.path.join(outdir, f"{tag}_{a.name}_{i}.png")
        bpy.ops.render.render(write_still=True)
    print("ACT", a.name, f0, f1)
