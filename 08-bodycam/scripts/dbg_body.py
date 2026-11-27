import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import enable_gpu, look_at_euler
from mathutils import Vector
scn = bpy.context.scene; enable_gpu(scn)
scn.frame_set(345)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE" and "GLTF_created" in o.name)
hips = next(b for b in arm.pose.bones if "Hips" in b.name)
hp = (arm.matrix_world @ hips.matrix).translation
print("HIPS", [round(v, 3) for v in hp], "GROUND", bpy.data.objects["ExtGround"].location.z)
dg = bpy.context.evaluated_depsgraph_get()
zmin = 1e9
for o in bpy.data.collections["Enemy"].all_objects:
    if o.type == "MESH":
        ev = o.evaluated_get(dg); me = ev.to_mesh()
        n = len(me.vertices); st = max(1, n // 400)
        for i in range(0, n, st):
            z = (ev.matrix_world @ me.vertices[i].co).z
            zmin = min(zmin, z)
        ev.to_mesh_clear()
print("ENEMY ZMIN", round(zmin, 3))
cd = bpy.data.cameras.new("dbg"); cam = bpy.data.objects.new("dbg", cd); scn.collection.objects.link(cam)
cd.lens = 28
cam.location = (17.6, 0.6, 1.5); cam.rotation_euler = look_at_euler(cam.location, (hp.x, hp.y, 0.5))
scn.camera = cam
scn.cycles.samples = 64; scn.render.resolution_percentage = 50; scn.render.use_motion_blur = False
scn.render.image_settings.file_format = "JPEG"; scn.view_settings.view_transform = "Standard"; scn.view_settings.exposure = -2.2
scn.render.filepath = sys.argv[sys.argv.index("--") + 1]
bpy.ops.render.render(write_still=True)
