"""在动作管线的双机位棚里，把英雄摆成站姿渲染正面和侧面，用来拼出视频模型的参考图（第一帧）。

用法: Blender -b --factory-startup <video2rig>/assets/model/<name>.blend -P tools/blender/hero_ref.py -- <video2rig 根目录> <stance.npz> <输出前缀>
产出: <输出前缀>_front.png、<输出前缀>_side.png（各 640×720）。站姿来自 hero_build.py 的 pose_out。
"""
import bpy, sys, os
import numpy as np
from mathutils import Quaternion, Vector
root, pose_path, prefix = sys.argv[sys.argv.index("--") + 1:][:3]
sys.path.insert(0, os.path.join(root, "scripts/blender"))
import bl_common as bc  # noqa: E402
scene = bpy.context.scene
arm, mesh = bc.character()
m = np.load(pose_path, allow_pickle=True)
for nm, q in zip(m["names"], m["quats"]):
    pb = arm.pose.bones.get(str(nm))
    if pb: pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = Quaternion(q)
arm.pose.bones["mixamorig:Hips"].location = Vector(m["loc"])
bpy.context.view_layer.update()
bc.setup_render(scene)
print("RENDERED", bc.render_views(scene, prefix + "_{view}.png"))
