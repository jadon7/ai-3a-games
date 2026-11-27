import bpy, math, os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gpu_setup import enable_gpu
enable_gpu()
sc = bpy.context.scene
cd = bpy.data.cameras.new("C"); cam = bpy.data.objects.new("C", cd); sc.collection.objects.link(cam); sc.camera = cam
cd.sensor_width = 36; cd.lens = 18
x, y, yaw, pitch = -3.549, 0.674, math.radians(78.28), math.radians(1.21)
cam.location = (x, y, 1.66)
from mathutils import Vector
f = Vector((math.cos(pitch)*math.cos(yaw), math.cos(pitch)*math.sin(yaw), math.sin(pitch)))
cam.rotation_euler = f.to_track_quat('-Z', 'Y').to_euler()
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 480, 270, 100
sc.cycles.samples = 64
vl = sc.view_layers[0]
vl.use_pass_diffuse_color = True; vl.use_pass_diffuse_direct = True; vl.use_pass_diffuse_indirect = True
sc.render.image_settings.file_format = "OPEN_EXR_MULTILAYER"
out = os.path.abspath("logs/passcheck.exr"); sc.render.filepath = out
bpy.ops.render.render(write_still=True)
im = bpy.data.images.load(out)
print("LAYERS", [l for l in im.render_slots] if hasattr(im, 'render_slots') else '')
