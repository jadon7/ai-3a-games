"""悟空专用：把整理好的动作（以及凉棚站姿）逐帧摆到管线骨架上，导出每根骨骼的世界矩阵，给 scripts/wukong_retarget.py 用。

用法: Blender -b --factory-startup assets/model/wukong.blend -P scripts/blender/wukong_dump_world.py -- \
      <out.npz> <stance.npz> <名字>=<动作.npz> ...
动作 npz 的格式同 moba/tools/hero_motion.py 的产出（names、quats、loc、fps）。
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_common as bc  # noqa: E402

args = bc.script_args()
out, stance = args[0], args[1]
pairs = [a.split("=", 1) for a in args[2:]]
arm, _ = bc.character()
names = [b.name for b in arm.data.bones]
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"


def put(nms, quats, loc):
    idx = {str(n): i for i, n in enumerate(nms)}
    for n in names:
        arm.pose.bones[n].rotation_quaternion = Quaternion(quats[idx[n]]) if n in idx else Quaternion()
    arm.pose.bones["mixamorig:Hips"].location = Vector(loc)
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    return np.array([np.array(mw @ arm.pose.bones[n].matrix) for n in names])


res = {"names": np.array(names)}
s = np.load(stance, allow_pickle=True)
res["stance"] = put(s["names"], s["quats"], s["loc"])
for tag, path in pairs:
    m = np.load(path, allow_pickle=True)
    res["clip_" + tag] = np.array([put(m["names"], m["quats"][f], m["loc"][f]) for f in range(len(m["quats"]))])
    res["fps_" + tag] = np.array(int(m["fps"]))
    print("DUMPED", tag, len(m["quats"]), flush=True)
np.savez(out, **res)
print("SAVED", out, flush=True)
