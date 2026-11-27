"""渲染动画的逐帧小图。
blender -b --factory-startup -P strip.py -- <gltf> <out_prefix> <start> <end> <step> <camx,camy,camz> <tx,ty,tz> <lens>
"""
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
s, e, st = int(argv[2]), int(argv[3]), int(argv[4])
cpos = Vector([float(v) for v in argv[5].split(",")])
tpos = Vector([float(v) for v in argv[6].split(",")])
lens = float(argv[7])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scn = bpy.context.scene
for o in list(scn.objects):
    if o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)

w = bpy.data.worlds.new("w"); scn.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.85, 0.9, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); scn.collection.objects.link(sun)
sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scn.render.engine = "BLENDER_EEVEE"
scn.render.resolution_x = 384; scn.render.resolution_y = 288
scn.render.image_settings.file_format = "JPEG"
scn.view_settings.view_transform = "Standard"
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scn.collection.objects.link(cam)
cd.lens = lens; cd.clip_start = 0.01
cam.location = cpos
cam.rotation_euler = (tpos - cpos).to_track_quat("-Z", "Y").to_euler()
scn.camera = cam
for f in range(s, e + 1, st):
    scn.frame_set(f)
    scn.render.filepath = f"{out}_{f:04d}.jpg"
    bpy.ops.render.render(write_still=True)
print("DONE")
