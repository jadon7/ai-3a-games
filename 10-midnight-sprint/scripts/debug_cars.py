"""所有车排成一排，车头（+X）前方放一个红色小方块，从斜上方看，检查朝向和车轮。"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import mats
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
setup_cycles(sc, samples=24, res=(1920, 1080), pct=100)
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs[0].default_value = (0.5, 0.5, 0.55, 1); bg.inputs[1].default_value = 1.0
names = sorted(f[:-6] for f in os.listdir(os.path.join(ROOT, "blend", "cars")) if f.endswith(".blend"))
red = emission_mat("red", (1, 0, 0), 5)
bpy.ops.mesh.primitive_plane_add(size=200); bpy.context.object.data.materials.append(mats.flat("g", (0.3, 0.3, 0.3), 0.8))
for i, n in enumerate(names):
    c = load_car(n)
    row, colm = divmod(i, 7)
    c["root"].location = (row * 9.0, colm * 3.6, 0)
    bpy.ops.mesh.primitive_cube_add(size=0.3, location=(row * 9.0 + 3.2, colm * 3.6, 0.15))
    bpy.context.object.data.materials.append(red)
    print("@@", i, n, "objs", len(c["col"].objects), "wheels", {q: len(o.children) for q, o in c["spin"].items()})
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (22, 10.8, 30); cam.rotation_euler = (math.radians(25), 0, math.radians(90)); cam.data.lens = 30
from mathutils import Vector
cam.rotation_euler = (Vector((5, 10.8, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.render.filepath = sys.argv[-1]; sc.render.image_settings.file_format = "JPEG"
bpy.ops.render.render(write_still=True)
