import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
print("ARM", arm.name, "mw", [[round(v,3) for v in r] for r in arm.matrix_world])
for o in sc.objects:
    if o.type != "MESH" or o.parent is not arm or o.parent_type != "OBJECT":
        print("NODE", o.type, o.name, "| parent:", o.parent.name if o.parent else None, o.parent_type, o.parent_bone, "| mods", [m.type for m in o.modifiers] if o.type=="MESH" else "")
# rest pose bone directions
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1,0,0,0); pb.location = (0,0,0); pb.scale = (1,1,1)
bpy.context.view_layer.update()
for n in ("Hips","Spine","LeftArm","LeftForeArm","RightArm","LeftUpLeg","LeftLeg","LeftFoot","Head","LeftShoulder"):
    b = next(b for b in arm.data.bones if n in b.name and b.name.split(":")[1].rsplit("_",1)[0] == n)
    h = arm.matrix_world @ b.head_local; t = arm.matrix_world @ b.tail_local
    print("REST", b.name, "head", [round(v,3) for v in h], "dir", [round(v,2) for v in (t-h).normalized()])
if len(argv) > 1:
    for o in list(sc.objects):
        if o.name.startswith("Icosphere"): bpy.data.objects.remove(o)
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.85, 0.9, 1)
    sc.render.engine = "BLENDER_EEVEE"; sc.render.resolution_x = 600; sc.render.resolution_y = 600
    sc.render.image_settings.file_format = "JPEG"; sc.view_settings.view_transform = "Standard"
    cd = bpy.data.cameras.new("C"); cd.lens = 35; cam = bpy.data.objects.new("C", cd); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0.5, -4.5, 1.2); cam.rotation_euler = (Vector((0, 0, 0.9)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = argv[1]; bpy.ops.render.render(write_still=True)
