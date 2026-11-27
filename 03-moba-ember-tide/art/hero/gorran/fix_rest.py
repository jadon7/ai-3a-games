"""葛隆专用的预处理：把静止姿势里两只手绕前臂轴拧一点，让掌心朝前的分量变成正的，烘焙成新的静止姿势。

为什么要做：tools/blender/hero_build.py 的 hand_frame 假设“静止时掌心朝前”（n·前 < 0 就把 n 反过来）。
Tripo 给葛隆绑的静止姿势里，手垂在身侧、掌心朝里偏后约 20 度，于是脚本把手背当成了掌心：
手指往手背一侧卷（反关节）、盾装到前臂内侧。共用脚本不能改，所以改输入：只拧手，拧到掌心朝里偏前几度为止。

用法: Blender -b --factory-startup -P art/hero/gorran/fix_rest.py -- <tripo_rigged.glb> <输出.glb> [掌心朝前分量的目标值=0.12]
"""
import bpy, sys, math
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]; goal = float(argv[2]) if len(argv) > 2 else 0.12
MX = "mixamorig:"
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
for o in list(bpy.data.objects):
    if o not in (arm, body): bpy.data.objects.remove(o, do_unlink=True)
B = arm.data.bones; PB = arm.pose.bones; upd = bpy.context.view_layer.update

# 这个模型朝哪边：和 hero_build.py 的摆正同一套算法（脚尖方向取整到 90 度）
toe = B[MX + "LeftToeBase"].head_local - B[MX + "LeftFoot"].head_local
yaw = round((-math.pi / 2 - math.atan2(toe.y, toe.x)) / (math.pi / 2)) * (math.pi / 2)
fwd = Matrix.Rotation(-yaw, 3, "Z") @ Vector((0, -1, 0))
print("FWD(原始坐标)", [round(v, 3) for v in fwd])

for side in ("Left", "Right"):
    h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
    idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local; mid = B[MX + side + "HandMiddle1"].head_local
    th = B[MX + side + "HandThumb1"].head_local
    L = (idx - pky).normalized(); d = (h - fore).normalized(); palm = L.cross(d).normalized()
    if (th - (h + (mid - h) * 0.5)).dot(palm) < 0: palm = -palm           # 拇指根在掌心一侧
    best = None
    for k in range(0, 181):                                               # 两个方向都试，取拧得最少的
        for sg in (1, -1):
            a = math.radians(k * 0.5) * sg
            if (Matrix.Rotation(a, 3, d) @ palm).dot(fwd) >= goal: best = a; break
        if best is not None: break
    assert best is not None
    print(side, "掌心·前 原来", round(palm.dot(fwd), 3), "拧", round(math.degrees(best), 1), "度 → ", round((Matrix.Rotation(best, 3, d) @ palm).dot(fwd), 3))
    pb = PB[MX + side + "Hand"]; upd(); hh = pb.head.copy()
    pb.matrix = Matrix.Translation(hh) @ Matrix.Rotation(best, 4, d) @ Matrix.Translation(-hh) @ pb.matrix; upd()

# 烘焙：先把网格按现在的姿势定下来，再把现在的姿势设成静止姿势，重新挂上骨架
bpy.ops.object.select_all(action="DESELECT"); body.select_set(True); bpy.context.view_layer.objects.active = body
mod = next(m for m in body.modifiers if m.type == "ARMATURE"); bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE"); bpy.ops.pose.armature_apply(selected=False); bpy.ops.object.mode_set(mode="OBJECT")
m = body.modifiers.new("Armature", "ARMATURE"); m.object = arm; upd()
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=False, export_skins=True, export_yup=True, export_apply=False)
print("SAVED", dst)
