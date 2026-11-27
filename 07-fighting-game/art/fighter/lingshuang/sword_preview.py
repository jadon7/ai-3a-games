"""渲几张刀的近景（侧面、3/4、刀背俯视、刀尖特写、刀镡特写），拼成一张图。
用法: Blender -b --factory-startup -P sword_preview.py -- <输出.jpg> [glb 文件（不给就用 gear.py 现建）]"""
import bpy, sys, os, math
import numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]; out = argv[0]
D = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else "."
sys.path.insert(0, "/Users/jadon7/Documents/SynologyDrive/code/fighting-game/art/fighter/lingshuang")
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
if len(argv) > 1:
    bpy.ops.import_scene.gltf(filepath=argv[1]); obs = [o for o in sc.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.data.transform(o.matrix_world); o.matrix_world = o.matrix_world.Identity(4)
    co = np.array([v.co for v in o.data.vertices]); mn, mx = co.min(0), co.max(0); la = int(np.argmax(mx - mn))
    from mathutils import Matrix
    R = Matrix.Identity(4)
    if la == 0: R = Matrix.Rotation(math.radians(90), 4, "Z")
    elif la == 2: R = Matrix.Rotation(math.radians(-90), 4, "X")
    o.data.transform(Matrix.Translation(-Vector((mn + mx) / 2))); o.data.transform(R)
    co = np.array([v.co for v in o.data.vertices]); L = co[:, 1].max() - co[:, 1].min(); o.data.transform(Matrix.Scale(0.62 / L, 4))
else:
    import gear; me = gear.make_sword(); o = bpy.data.objects.new("weapon", me); sc.collection.objects.link(o)
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; nt = wd.node_tree
bg = nt.nodes["Background"]; grad = nt.nodes.new("ShaderNodeTexGradient"); tc = nt.nodes.new("ShaderNodeTexCoord"); ramp = nt.nodes.new("ShaderNodeValToRGB")
mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Rotation"].default_value = (0, -math.pi / 2, 0)
nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], grad.inputs["Vector"]); nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"]); nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
ramp.color_ramp.elements[0].color = (0.08, 0.085, 0.09, 1); ramp.color_ramp.elements[1].color = (0.85, 0.87, 0.9, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 3; sun.rotation_euler = (0.6, 0.3, 0.8)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
co = np.array([v.co for v in o.data.vertices]); ymin, ymax = co[:, 1].min(), co[:, 1].max(); yc = (ymin + ymax) / 2
VIEWS = [("side", Vector((0.8, yc, 0)), Vector((0, yc, 0)), 0.68, 1600, 260),
         ("q34", Vector((0.5, yc - 0.3, 0.35)), Vector((0, yc, 0)), 0.7, 1600, 400),
         ("spine", Vector((0.0, yc, 0.8)), Vector((0, yc, 0)), 0.68, 1600, 200),
         ("tip", Vector((0.12, ymax - 0.02, 0.05)), Vector((0, ymax - 0.06, 0)), 0.16, 800, 500),
         ("guard", Vector((0.12, 0.0, 0.08)), Vector((0, 0.02, 0)), 0.2, 800, 500),
         ("edge_on", Vector((0.02, ymax + 0.25, 0.0)), Vector((0, ymax - 0.2, 0)), 0.1, 800, 500)]
ims = []
for nm, loc, tgt, osz, rx, ry in VIEWS:
    cam.location = loc; cam.rotation_euler = (tgt - loc).to_track_quat("-Z", "Z" if nm != "spine" else "X").to_euler()
    cam.data.type = "ORTHO"; cam.data.ortho_scale = osz; sc.render.resolution_x = rx; sc.render.resolution_y = ry
    p = out + f"_{nm}.png"; sc.render.filepath = p; bpy.ops.render.render(write_still=True); ims.append(p)
print("FILES", " ".join(ims))
