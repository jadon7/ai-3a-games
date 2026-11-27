import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import mats
from mathutils import Vector
name, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
setup_cycles(sc, samples=32, res=(960, 540), pct=100)
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs[0].default_value = (0.5, 0.5, 0.55, 1); bg.inputs[1].default_value = 1.0
bpy.ops.mesh.primitive_plane_add(size=200); bpy.context.object.data.materials.append(mats.flat("g", (0.3, 0.3, 0.3), 0.8))
c = load_car(name)
bpy.ops.mesh.primitive_cube_add(size=0.3, location=(3.2, 0, 0.15)); bpy.context.object.data.materials.append(emission_mat("red", (1, 0, 0), 5))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 35
sc.render.image_settings.file_format = "JPEG"
for tag, pos in (("front", (7, 3.5, 2.2)), ("rear", (-7, 3.5, 2.2))):
    cam.location = pos
    cam.rotation_euler = (Vector((0, 0, 0.5)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{out}_{tag}.jpg"
    bpy.ops.render.render(write_still=True)
