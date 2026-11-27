"""把一个姿势（npz：theta、ypr、t，lie_ik.py 解出来的趴卧姿势）渲染出来看。
用法: Blender -b --factory-startup V2R/assets/model/wolf.blend -P lie_pose.py -- <姿势.npz> <输出前缀>
产出: <输出前缀>_{front,side}.png"""
import os, sys
import bpy, numpy as np
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, os.path.join(V2R, "scripts/blender"))
import bl_common as bc
from v2r import skeleton as sk
src, out = bc.script_args()[:2]
scene = bpy.context.scene; arm, mesh = bc.character()
skel = sk.Skeleton.load(os.path.join(V2R, "assets/model", "wolf_skeleton.json"))
z = np.load(src); p = {"theta": z["theta"], "ypr": z["ypr"], "t": z["t"]}
quats, loc, joints = bc.pose_from_params(skel, p); bc.set_pose(arm, skel, quats, loc)
bc.render_views(scene, out + "_{view}.png")
dg = bpy.context.evaluated_depsgraph_get(); me = mesh.evaluated_get(dg)
V = np.array([(me.matrix_world @ v.co)[:] for v in me.data.vertices])
print("POSE 网格最低 %.3f 最高 %.3f；低于地面 1%% 身长的顶点 %d 个" % (V[:, 2].min(), V[:, 2].max(), int((V[:, 2] < -0.01).sum())), flush=True)
