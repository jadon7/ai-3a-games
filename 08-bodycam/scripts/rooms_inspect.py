"""两间小房间转正后，从每间屋子中心朝四面各渲染一张（平光贴图），外加俯视。
blender -b --factory-startup -P scripts/rooms_inspect.py"""
import bpy, os, math
from mathutils import Vector, Matrix
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "assets", "env_tworooms", "scene.gltf"))
scn = bpy.context.scene
roots = [o for o in scn.objects if o.parent is None]
piv = bpy.data.objects.new("Piv", None); scn.collection.objects.link(piv)
for r in roots: r.parent = piv
piv.rotation_euler = (0, 0, math.radians(114.4703))
bpy.context.view_layer.update()
scn.render.engine = "BLENDER_WORKBENCH"; sh = scn.display.shading; sh.light = "FLAT"; sh.color_type = "TEXTURE"; sh.show_backface_culling = False
scn.display.render_aa = "8"
scn.view_settings.view_transform = "Standard"
scn.render.resolution_x = 960; scn.render.resolution_y = 720; scn.render.image_settings.file_format = "JPEG"
w = bpy.data.worlds.new("w"); scn.world = w; w.color = (1, 0, 1)
cd = bpy.data.cameras.new("c"); cd.lens = 13; cd.clip_start = 0.05; cam = bpy.data.objects.new("c", cd); scn.collection.objects.link(cam); scn.camera = cam
out = os.path.join(ROOT, "renders", "plan")
for name, c in (("C", (0.65, 3.1, 1.6)), ("B", (0.65, -1.1, 1.6))):
    for d, ang in (("N", 0), ("W", 90), ("S", 180), ("E", 270)):
        cam.location = c; cam.rotation_euler = (math.radians(88), 0, math.radians(ang))
        scn.render.filepath = os.path.join(out, f"room{name}_{d}.jpg"); bpy.ops.render.render(write_still=True)
print("DONE")
