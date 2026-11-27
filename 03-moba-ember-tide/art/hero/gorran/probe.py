"""量一个摆正后的 rigged GLB：两只手的握持坐标（和 hero_build.py 的 hand_frame 同一套算法），并用拇指的位置核对掌心方向。
用法: Blender -b --factory-startup -P art/hero/gorran/probe.py -- in.glb
"""
import bpy, sys
from mathutils import Vector
src = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE"); B = arm.data.bones; MX = "mixamorig:"; FWD = Vector((0, -1, 0))
r = lambda v: [round(x, 3) for x in v]
toe = B[MX + "LeftToeBase"].head_local - B[MX + "LeftFoot"].head_local
print("TOE dir", r(toe), "left hand x", round(B[MX + "LeftHand"].head_local.x, 3))
for side in ("Left", "Right"):
    h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
    idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local; mid = B[MX + side + "HandMiddle1"].head_local
    th = B[MX + side + "HandThumb1"].head_local
    L = (idx - pky).normalized(); d = (h - fore).normalized(); E = (d - L * d.dot(L)).normalized()
    n0 = L.cross(d).normalized(); n = n0 if n0.dot(FWD) >= 0 else -n0
    palm_side = (th - (h + (mid - h) * 0.5)).dot(n)       # 拇指根在掌心一侧：这个数应该是正的
    print(side, "L", r(L), "d", r(d), "E", r(E)); print("   n(脚本用的)", r(n), "n·前", round(n.dot(FWD), 3), "拇指在 n 这一侧", round(palm_side, 4), "=> n 是", "掌心" if palm_side > 0 else "手背（反了）")
    print("   hand", r(h), "mid1", r(mid), "idx1", r(idx), "pky1", r(pky), "thumb1", r(th), "forearm", r(fore), "len", round((h - fore).length, 3))
