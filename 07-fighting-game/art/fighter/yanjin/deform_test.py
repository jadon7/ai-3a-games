"""绑骨压力测试：低头含胸（佛珠）、右臂举过头（单肩甲）、前臂拧腕（铁箍）、高抬腿（腰带头）。
用法: Blender -b --factory-startup -P deform_test.py -- <rigged.glb> <输出前缀>"""
import bpy, sys, math
from mathutils import Vector, Quaternion, Matrix
argv = sys.argv[sys.argv.index("--") + 1:]; src, pre = argv
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); PB = arm.pose.bones; MX = "mixamorig:"
for pb in PB: pb.rotation_mode = "QUATERNION"
upd = bpy.context.view_layer.update
def reset():
    for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    upd()
def rot(name, axis, deg):
    """绕世界坐标轴转（骨架空间），对着骨骼的头"""
    pb = PB[MX + name]; upd(); h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis)) @ Matrix.Translation(-h) @ pb.matrix; upd()
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = 640; sc.render.resolution_y = 640; sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.52, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 3.0
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"
def shot(name, ctr, az, el, size):
    az, el = math.radians(az), math.radians(el); d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    ctr = Vector(ctr); cam.data.ortho_scale = size; cam.location = ctr + d * 4; cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
    sc.render.filepath = f"{pre}_{name}.png"; bpy.ops.render.render(write_still=True)
# 1 低头含胸
reset(); rot("Spine1", (1, 0, 0), 12); rot("Spine2", (1, 0, 0), 15); rot("Neck", (1, 0, 0), 15); rot("Head", (1, 0, 0), 30)
shot("chin_side", (0, 0, 0.8), 90, 0, 0.4); shot("chin_front", (0, 0, 0.8), 0, 10, 0.4)
# 2 右臂举过头（上勾拳收尾）+ 右臂前平举（直拳）
reset(); rot("RightArm", (0, 1, 0), 140)
shot("raise_front", (-0.05, 0, 0.8), 0, 5, 0.6); shot("raise_back", (-0.05, 0, 0.8), 200, 5, 0.6)
reset(); rot("RightArm", (0, 1, 0), 55); rot("RightArm", (0, 0, 1), -75)
shot("punch_side", (-0.05, -0.1, 0.75), 270, 5, 0.6); shot("punch_top", (-0.05, -0.1, 0.75), 300, 50, 0.6)
# 3 前臂拧腕：左右手腕各拧 80 度
reset()
for s, sx in (("Left", 1), ("Right", -1)):
    pb = PB[MX + s + "Hand"]; upd(); ax = (pb.tail - pb.head).normalized(); rot(s + "Hand", ax, 80)
    pb = PB[MX + s + "ForeArm"]; upd(); ax = (pb.tail - pb.head).normalized(); rot(s + "ForeArm", ax, 40)
shot("twist", (0, 0, 0.55), 0, 5, 0.7)
# 4 高抬左腿（飞踢、跳）
reset(); rot("LeftUpLeg", (1, 0, 0), 95); rot("LeftLeg", (1, 0, 0), -90); rot("RightUpLeg", (1, 0, 0), -30)
shot("leg_side", (0, 0, 0.5), 270, 0, 0.8); shot("leg_front", (0, 0, 0.5), 20, 5, 0.8)
print("DONE")
