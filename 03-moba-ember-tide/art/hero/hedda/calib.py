"""量“管线读出来的手”和“真实的手”差多少。每段视频的第 0 帧就是参考图，参考图是用站姿（stance.npz）渲染的，所以第 0 帧的真实姿势是已知的。
对每段动作：把求解结果的第 0 到 2 帧和站姿各摆一遍，比较几根骨骼的朝向，换成这根骨骼自己坐标系里的一个固定旋转 C（解出来的朝向再转 C 就是真实朝向）。
各段动作的 C 要是差不多，说明这是系统性的偏差（握拳的手型和管线的手指模型不一样造成的），可以给整段动作统一补上。

用法: Blender -b --factory-startup -P art/hero/hedda/calib.py -- <rigged.glb> <stance.npz> <skeleton.json> <输出.json> <motion.npz> [<motion.npz> …]
"""
import bpy, sys, json, math, os
import numpy as np
from mathutils import Quaternion, Vector, Matrix
argv = sys.argv[sys.argv.index("--") + 1:]; src, stance, skel_p, out = argv[:4]; clips = argv[4:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE"); PB = arm.pose.bones; MX = "mixamorig:"
names = [b["name"] for b in json.load(open(skel_p, encoding="utf-8"))["bones"]]
BONES = ["RightHand", "LeftForeArm", "LeftHand", "RightForeArm"]
def pose(nm, quats, loc):
    for pb in PB: pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    for n, q in zip(nm, quats):
        pb = PB.get(str(n))
        if pb: pb.rotation_quaternion = Quaternion(q)
    PB[MX + "Hips"].location = Vector(loc); bpy.context.view_layer.update()
    return {b: (arm.matrix_world @ PB[MX + b].matrix).to_3x3().normalized() for b in BONES}
m = np.load(stance, allow_pickle=True); truth = pose(m["names"], m["quats"], m["loc"]); res = {}
for c in clips:
    tag = os.path.basename(os.path.dirname(c)); mo = np.load(c, allow_pickle=True); row = {}
    for b in BONES:
        qs = []
        for f in (0, 1, 2):
            W = pose(names, mo["quats"][f], mo["loc"][f])[b]; qs.append((W.inverted() @ truth[b]).to_quaternion())
        q = qs[0]
        for q2 in qs[1:]: q = q.slerp(q2 if q.dot(q2) >= 0 else -q2, 0.5)
        ax, ang = q.to_axis_angle(); row[b] = {"quat": [round(v, 5) for v in q], "度": round(math.degrees(ang), 1), "轴": [round(v, 2) for v in ax]}
    res[tag] = row; print("CAL", tag, " ".join(f"{b} {row[b]['度']}°{row[b]['轴']}" for b in BONES))
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1); print("SAVED", out)
