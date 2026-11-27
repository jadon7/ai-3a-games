import bpy, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import enable_gpu
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene; enable_gpu(scn)
scn.cycles.samples = 64; scn.cycles.use_denoising = False
scn.render.resolution_x = scn.render.resolution_y = 16
scn.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); scn.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[1].default_value = 0.0
bpy.ops.mesh.primitive_plane_add(size=4); pl = bpy.context.active_object
m = bpy.data.materials.new("d"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
d = nt.nodes.new("ShaderNodeBsdfDiffuse"); d.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1)
o = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(d.outputs[0], o.inputs["Surface"]); pl.data.materials.append(m)
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scn.collection.objects.link(cam); scn.camera = cam
cd.lens = 4000; cam.location = (0, 0, 5)
def measure(kind, energy, **kw):
    ld = bpy.data.lights.new("l", kind); lo = bpy.data.objects.new("l", ld); scn.collection.objects.link(lo)
    ld.energy = energy; lo.location = (0, 0, 2.0)
    for k, v in kw.items(): setattr(ld, k, v)
    scn.render.filepath = "/tmp/_calib"; bpy.ops.render.render()
    img = bpy.data.images["Render Result"]
    scn.render.image_settings.file_format = "OPEN_EXR"
    p = os.path.join(bpy.app.tempdir, "c.exr"); img.save_render(p)
    im = bpy.data.images.load(p); px = list(im.pixels); bpy.data.images.remove(im)
    val = sum(px[0::4]) / (len(px) / 4)
    bpy.data.objects.remove(lo)
    return val
L_spot = measure("SPOT", 1000.0, spot_size=math.radians(120), spot_blend=0.0, shadow_soft_size=0.008)
L_point = measure("POINT", 1000.0, shadow_soft_size=0.04)
L_sun = measure("SUN", 1.0)
for size, blend in ((9, 1.0), (9, 0.0), (22, 1.0), (62, 0.55), (120, 0.0)):
    v = measure("SPOT", 1000.0, spot_size=math.radians(size), spot_blend=blend, shadow_soft_size=0.008)
    print("CALIB spot size", size, "blend", blend, "-> L center =", round(v, 4), " k =", round(v * 4 / 500, 5))
print("CALIB spot 1000W d=2 alb=0.5 -> L =", L_spot, " => k = L*d^2/(alb*P) =", L_spot * 4 / (0.5 * 1000))
print("CALIB point 1000W -> L =", L_point, " k =", L_point * 4 / (0.5 * 1000))
print("CALIB sun 1.0 -> L =", L_sun, " (alb/pi =", 0.5 / math.pi, ")")
print("ref 1/(4pi^2) =", 1 / (4 * math.pi ** 2), " 1/(16 pi) =", 1 / (16 * math.pi), " 1/(4 pi^2 * pi)=", 1 / (4 * math.pi ** 3))
