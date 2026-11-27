"""查一段动作里网格有没有陷到地面以下：逐帧（隔几帧）摆姿势，统计网格最低点和低于地面 1% 身长的顶点数。
用法: Blender -b --factory-startup V2R/assets/model/kaz.blend -P mesh_floor.py -- <动作.npz（管线格式：quats、loc）> [每隔几帧=4]"""
import os, sys
import bpy, numpy as np
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, os.path.join(V2R, "scripts/blender"))
import bl_common as bc
from v2r import skeleton as sk
a = bc.script_args(); src = a[0]; step = int(a[1]) if len(a) > 1 else 4
arm, mesh = bc.character(); skel = sk.Skeleton.load(os.path.join(V2R, "assets/model", "kaz_skeleton.json"))
m = np.load(src, allow_pickle=True); q, loc = m["quats"], m["loc"]; T = len(q); worst = (0.0, -1, 0)
from mathutils import Quaternion  # noqa: E402
_set = bc.set_pose
def set_all(arm, skel, quats, loc):                                                # 卡兹加的：bc.set_pose 只摆受控的骨骼，游戏里是所有骨骼都按 npz 摆（尾巴就是不受控的）
    _set(arm, skel, quats, loc)
    for i, name in enumerate(skel.names):
        pb = arm.pose.bones[name]; pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = Quaternion(quats[i])
bc.set_pose = set_all
for f in list(range(0, T, step)) + [T - 1]:
    bc.set_pose(arm, skel, q[f], loc[f]); dg = bpy.context.evaluated_depsgraph_get(); dg.update(); me = mesh.evaluated_get(dg)
    z = np.array([(me.matrix_world @ v.co).z for v in me.data.vertices]); n = int((z < -0.01).sum())
    if z.min() < worst[0]: worst = (float(z.min()), f, n)
    if f == T - 1: print("FLOOR 最后一帧（第 %d 帧）网格最低 %.3f，低于地面 1%% 身长的顶点 %d 个（共 %d）" % (f, z.min(), n, len(z)))
print("FLOOR 全程最低 %.3f 身长（第 %d 帧，当时低于地面 1%% 身长的顶点 %d 个）" % worst)
if worst[1] >= 0:                                                                  # 卡兹加的：陷下去的是哪块肉（按顶点权重最大的骨骼数）
    f = worst[1]; bc.set_pose(arm, skel, q[f], loc[f]); dg = bpy.context.evaluated_depsgraph_get(); dg.update(); me = mesh.evaluated_get(dg)
    z = np.array([(me.matrix_world @ v.co).z for v in me.data.vertices]); gname = {g.index: g.name for g in mesh.vertex_groups}; cnt = {}
    for vi in np.where(z < -0.01)[0]:
        gs = mesh.data.vertices[int(vi)].groups
        if len(gs): b = gname[max(gs, key=lambda g: g.weight).group]; cnt[b] = cnt.get(b, 0) + 1
    print("FLOOR 陷下去的顶点归哪根骨骼:", sorted(cnt.items(), key=lambda x: -x[1])[:6])
