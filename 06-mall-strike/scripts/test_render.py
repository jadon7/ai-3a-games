import bpy, sys, os, math, time
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
out, cx, cy, cz, tx, ty, tz, lens, res, spp = argv[0], *map(float, argv[1:7]), float(argv[7]), float(argv[8]), int(argv[9])
sc = bpy.context.scene
cam_d = bpy.data.cameras.new("TestCam"); cam_d.lens = lens; cam_d.clip_start = 0.02
cam = bpy.data.objects.new("TestCam", cam_d); sc.collection.objects.link(cam)
cam.location = (cx, cy, cz)
cam.rotation_euler = (Vector((tx, ty, tz)) - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.camera = cam
sc.render.resolution_percentage = int(res)
sc.cycles.samples = spp
sc.render.filepath = out
sc.render.image_settings.file_format = "PNG"
t = time.time()
bpy.ops.render.render(write_still=True)
print("RENDER_TIME", round(time.time() - t, 1))
