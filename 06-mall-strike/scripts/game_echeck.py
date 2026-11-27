import bpy, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gpu_setup import enable_gpu
from mathutils import Vector
enable_gpu()
sc = bpy.context.scene
if "Haze" in bpy.data.objects: bpy.data.objects.remove(bpy.data.objects["Haze"])
m = bpy.data.materials["plaster_white"]
nt = m.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
out = nt.nodes.new("ShaderNodeOutputMaterial"); d = nt.nodes.new("ShaderNodeBsdfDiffuse")
d.inputs[0].default_value = (1, 1, 1, 1); nt.links.new(d.outputs[0], out.inputs[0])
cd = bpy.data.cameras.new("C"); cam = bpy.data.objects.new("C", cd); sc.collection.objects.link(cam); sc.camera = cam
cd.sensor_width = 36; cd.lens = 18
x, y, yaw, pitch = -3.549, 0.674, math.radians(78.28), math.radians(1.21)
cam.location = (x, y, 1.66)
f = Vector((math.cos(pitch)*math.cos(yaw), math.cos(pitch)*math.sin(yaw), math.sin(pitch)))
cam.rotation_euler = f.to_track_quat('-Z', 'Y').to_euler()
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 960, 540, 100
sc.cycles.samples = 64
sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"; sc.view_settings.exposure = -0.3
sc.render.image_settings.file_format = "PNG"
sc.render.filepath = os.path.abspath("logs/echeck_white.png")
bpy.ops.render.render(write_still=True)
print("DONE")
