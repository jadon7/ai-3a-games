"""查 hero_build.py 的 hand_frame 在这个模型上把掌心朝向算对了没有。
它假设静止姿势掌心朝前（n·FWD>0），奥森静止时掌心朝内朝下，这个点积接近 0，符号可能是随机的。
这里用手指自然弯曲的方向（指尖相对指根往哪边勾）当作真正的掌心方向来对照。
用法: Blender -b --factory-startup -P art/hero/osen/hand_probe.py -- <rigged.glb>"""
import bpy, sys
from mathutils import Vector
src = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE"); B = arm.data.bones; MX = "mixamorig:"; FWD = Vector((0, -1, 0))
toe = B[MX + "LeftToeBase"].head_local - B[MX + "LeftFoot"].head_local
print("HANDPROBE toe dir", [round(v, 3) for v in toe], "(面朝 -Y 时 y 应为负)")
for side in ("Left", "Right"):
    h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
    idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local
    L = (idx - pky).normalized(); d = (h - fore).normalized(); n0 = L.cross(d).normalized()
    n = -n0 if n0.dot(FWD) < 0 else n0
    bends = []
    for f in ("Index", "Middle", "Ring", "Pinky"):
        a = B[MX + side + "Hand" + f + "1"]; c = B[MX + side + "Hand" + f + "3"]
        v1 = (a.tail_local - a.head_local).normalized(); v3 = (c.tail_local - c.head_local).normalized()
        bends.append(v3 - v1 * v3.dot(v1))
    bend = sum(bends, Vector())
    print("HANDPROBE", side, "L", [round(v, 3) for v in L], "d", [round(v, 3) for v in d], "LxD", [round(v, 3) for v in n0], "LxD·FWD %.4f" % n0.dot(FWD),
          "| code n", [round(v, 3) for v in n], "| 手指弯向", [round(v, 3) for v in bend.normalized()], "len %.3f" % bend.length, "| n·弯向 %.3f" % n.dot(bend.normalized()))
