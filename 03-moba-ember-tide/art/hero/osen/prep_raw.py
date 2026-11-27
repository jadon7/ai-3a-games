"""奥森专用的预处理：把 Tripo 模型静止姿势里的两只手各绕手掌长轴拧一点（掌心略朝前），另存一份给 hero_build.py 用。

为什么要做：tools/blender/hero_build.py 的 hand_frame 假设“静止姿势掌心朝前”，用 n·FWD 的正负来定掌心朝哪边。
奥森的静止姿势掌心朝内朝下，这个点积只有 +0.04（左手）和 -0.02（右手），正负号正好都落在错的一边，
结果两只手的“掌心”都被当成了手背：武器被放到手背一侧、手指往手背方向卷（握拳是反的）。
共用脚本不能改，所以在自己的输入上做文章：把手在静止姿势里拧十来度，让点积离 0 足够远、符号是对的。
做法是“摆姿势 → 把网格按这个姿势定形 → 把这个姿势设成新的静止姿势”，骨骼和网格一起变，蒙皮权重不动。

用法: Blender -b --factory-startup -P art/hero/osen/prep_raw.py -- <tripo_rigged.glb> <输出.glb> [角度=12]
"""
import bpy, sys, math
from mathutils import Quaternion, Vector
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]; deg = float(argv[2]) if len(argv) > 2 else 12.0
MX = "mixamorig:"
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
for o in list(sc.objects):
    if o not in (arm, body): bpy.data.objects.remove(o, do_unlink=True)


def palm_dots(tag):
    """和 hand_frame 同样的算法：L×d 在“角色正前方”上的分量。右手要 >0、左手要 <0 才算对。正前方用脚尖方向定（原始模型还没摆正）。"""
    B = arm.data.bones; toe = B[MX + "LeftToeBase"].head_local - B[MX + "LeftFoot"].head_local
    ang = round(math.atan2(toe.y, toe.x) / (math.pi / 2)) * (math.pi / 2); fwd = Vector((math.cos(ang), math.sin(ang), 0))
    for side in ("Left", "Right"):
        h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
        L = (B[MX + side + "HandIndex1"].head_local - B[MX + side + "HandPinky1"].head_local).normalized(); d = (h - fore).normalized()
        print("PALM", tag, side, "fwd", [round(v, 2) for v in fwd], "LxD·fwd = %.4f" % L.cross(d).normalized().dot(fwd))


palm_dots("before")
# 右手绕手掌长轴正转、左手反转（左右镜像），掌心就都往前偏
bpy.context.view_layer.objects.active = arm
for side, sgn in (("Left", -1), ("Right", 1)):
    pb = arm.pose.bones[MX + side + "Hand"]; pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = Quaternion((0, 1, 0), math.radians(deg * sgn))
bpy.context.view_layer.update()

# 网格按现在的姿势定形
bpy.ops.object.select_all(action="DESELECT"); body.select_set(True); bpy.context.view_layer.objects.active = body
mods = [m for m in body.modifiers if m.type == "ARMATURE"]; assert len(mods) == 1, [m.type for m in body.modifiers]
bpy.ops.object.modifier_apply(modifier=mods[0].name)
# 现在的姿势设成静止姿势
bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE"); bpy.ops.pose.armature_apply(selected=False); bpy.ops.object.mode_set(mode="OBJECT")
m = body.modifiers.new("Armature", "ARMATURE"); m.object = arm
bpy.context.view_layer.update()
palm_dots("after")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=False, export_skins=True, export_yup=True, export_apply=False)
print("SAVED", out)
