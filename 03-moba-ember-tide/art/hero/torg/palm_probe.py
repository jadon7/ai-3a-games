"""只读检查：hero_build.py 的 hand_frame 假设“静止时掌心朝前”，量一下某个模型是不是这样。
用法: Blender -b --factory-startup -P art/hero/torg/palm_probe.py -- a.glb [b.glb …]
对每只手打印：L×d（右手的解剖学掌心方向是 L×d，左手是 d×L）、拇指根相对手腕落在哪一侧、hand_frame 最后取的 n 是掌心还是手背。
"""
import bpy, sys, math
from mathutils import Vector, Matrix
MX = "mixamorig:"; FWD = Vector((0, -1, 0))
for src in sys.argv[sys.argv.index("--") + 1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE"); B = arm.data.bones
    toe = B[MX + "LeftToeBase"].head_local - B[MX + "LeftFoot"].head_local
    yaw = -math.pi / 2 - math.atan2(toe.y, toe.x); R = Matrix.Rotation(round(yaw / (math.pi / 2)) * (math.pi / 2), 3, "Z")
    print("MODEL", src, "yaw", round(math.degrees(yaw)))
    for side in ("Left", "Right"):
        g = lambda n: R @ B[MX + side + n].head_local
        h = g("Hand"); fore = g("ForeArm"); idx = g("HandIndex1"); pky = g("HandPinky1"); th = g("HandThumb1")
        L = (idx - pky).normalized(); d = (h - fore).normalized(); n = L.cross(d).normalized()
        palm = n.copy() if side == "Right" else -n
        if n.dot(FWD) < 0: n = -n
        print("  %-5s 解剖学掌心 %s  拇指根在掌心一侧 %+.3f  hand_frame 的 n %s  → n 是%s" % (side, [round(v, 2) for v in palm], (th - h).dot(palm), [round(v, 2) for v in n], "掌心" if n.dot(palm) > 0 else "手背"))
