import bpy, sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(bpy.data.filepath), '..', 'scripts'))
from gpu_setup import enable_gpu
enable_gpu()
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
haze, spp, pct = argv[0] == "1", int(argv[1]), int(argv[2])
sc = bpy.context.scene
bpy.data.objects["Haze"].hide_render = not haze
cam_d = bpy.data.cameras.new("C"); cam_d.lens = 22
cam = bpy.data.objects.new("C", cam_d); sc.collection.objects.link(cam)
cam.location = (-5.5, -6, 1.65)
cam.rotation_euler = (Vector((1, 20, 1.4)) - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.keyframe_insert("location", frame=1); cam.location.y += 0.1; cam.keyframe_insert("location", frame=3)
sc.camera = cam; sc.cycles.samples = spp; sc.render.resolution_percentage = pct
sc.render.use_persistent_data = True
sc.frame_start, sc.frame_end = 1, 3
sc.render.filepath = "/tmp/claude-501/perf_"
sc.render.image_settings.file_format = "JPEG"
for f in (1, 2, 3):
    sc.frame_set(f); t = time.time(); bpy.ops.render.render(write_still=False); print("FRAME", f, round(time.time() - t, 1))
