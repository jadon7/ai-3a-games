import bpy, sys, os, math, json
sys.path.insert(0, os.path.join(os.path.dirname(bpy.data.filepath), "..", "scripts"))
from mathutils import Vector
from gpu_setup import enable_gpu
import viewmodel as V
argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]; params = json.loads(argv[1]) if len(argv) > 1 else {}
enable_gpu()
sc = bpy.context.scene
cam_d = bpy.data.cameras.new("PlayerCam"); cam_d.lens = 18; cam_d.clip_start = 0.01
cam = bpy.data.objects.new("PlayerCam", cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (-5.0, -4.0, 1.65)
cam.rotation_euler = (Vector((0.5, 20, 1.5)) - cam.location).to_track_quat("-Z", "Y").to_euler()
r = V.build(cam, params)
sc.render.resolution_percentage = 50; sc.cycles.samples = 24
sc.render.image_settings.file_format = "PNG"
for mode in ("hip", "ads"):
    if mode == "ads":
        r["vm"].location = V.ADS["loc"]; r["vm"].rotation_euler = V.ADS["rot"]; cam_d.lens = 26
    bpy.context.view_layer.update()
    sc.render.filepath = out + f"_{mode}.png"
    bpy.ops.render.render(write_still=True)
print("DONE")
