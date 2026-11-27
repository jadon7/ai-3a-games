"""权重检查：把绑好骨的模型摆几个极端姿势（举手过头、耸肩、低头、仰头、转头），渲染上半身，看大头、肩甲、钓竿有没有被扯歪。
用法: Blender -b --factory-startup -P pose_test.py -- <glb> <输出前缀> [坐标系: raw（面朝 +X）或 game（面朝 -Y）]
产出: <前缀>_<姿势>.png（每个姿势一张：正面、侧面并排）
"""
import bpy, sys, math
from mathutils import Vector, Matrix
a = sys.argv[sys.argv.index("--") + 1:]
src, prefix = a[0], a[1]; frame = a[2] if len(a) > 2 else "raw"
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in sc.objects:
    if o.type == "MESH" and o.name.startswith("Icosphere"): o.hide_render = True
PB = arm.pose.bones; MX = "mixamorig:"
upd = bpy.context.view_layer.update
FWD = Vector((1, 0, 0)) if frame == "raw" else Vector((0, -1, 0))
LEFT = Vector((0, 1, 0)) if frame == "raw" else Vector((1, 0, 0))
UP = Vector((0, 0, 1))


def rot(name, axis, deg):
    pb = PB[MX + name]; upd(); h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis)) @ Matrix.Translation(-h) @ pb.matrix; upd()


def reset():
    for pb in PB: pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    upd()


POSES = {
    "arms_up": lambda: [rot("LeftShoulder", FWD, 25), rot("RightShoulder", FWD, -25), rot("LeftArm", FWD, 100), rot("RightArm", FWD, -100)],
    "shrug_fwd": lambda: [rot("LeftShoulder", FWD, -20), rot("RightShoulder", FWD, 20), rot("LeftShoulder", UP, 25), rot("RightShoulder", UP, -25),
                          rot("LeftArm", LEFT, 70), rot("RightArm", LEFT, 70)],
    "head_down": lambda: [rot("Neck", LEFT, 25), rot("Head", LEFT, 30)],
    "head_back": lambda: [rot("Neck", LEFT, -20), rot("Head", LEFT, -35)],
    "head_turn": lambda: [rot("Neck", UP, 25), rot("Head", UP, 35), rot("Head", FWD, 15)],
    "bow": lambda: [rot("Spine", LEFT, 20), rot("Spine1", LEFT, 20), rot("Spine2", LEFT, 15), rot("Head", LEFT, 25), rot("LeftArm", FWD, -40), rot("RightArm", FWD, 40)],
}
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = 900; sc.render.resolution_y = 450; sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = 0.62
# 两个机位：正面、侧面，用相机平移拼成一张宽图太麻烦，直接各渲一张再并排
import os
for nm, fn in POSES.items():
    reset(); fn()
    files = []
    for k, d in enumerate((FWD, -LEFT)):
        c = Vector((0, 0, 0.78))
        cam.location = c + d * 5 + UP * 0.6; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
        sc.render.resolution_x = 450; f = f"{prefix}_{nm}_{k}.png"; sc.render.filepath = f; bpy.ops.render.render(write_still=True); files.append(f)
    print("POSE", nm, files)
