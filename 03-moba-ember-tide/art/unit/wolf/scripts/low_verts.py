"""一段动作的最后一帧里，陷到地面以下 1% 身长的顶点各属于哪根骨骼（查死亡的趴卧姿势哪儿陷地用）。
用法: Blender -b --factory-startup V2R/assets/model/wolf.blend -P low_verts.py -- <动作.npz（管线格式）>"""
import os, sys
import bpy, numpy as np
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, os.path.join(V2R, "scripts/blender"))
import bl_common as bc
from v2r import skeleton as sk
src = bc.script_args()[0]
arm, mesh = bc.character(); skel = sk.Skeleton.load(os.path.join(V2R, "assets/model", "wolf_skeleton.json"))
m = np.load(src, allow_pickle=True); q, loc = m["quats"], m["loc"]; f = len(q) - 1
bc.set_pose(arm, skel, q[f], loc[f]); dg = bpy.context.evaluated_depsgraph_get(); dg.update(); me = mesh.evaluated_get(dg)
z = np.array([(me.matrix_world @ v.co).z for v in me.data.vertices]); gname = {g.index: g.name for g in mesh.vertex_groups}; cnt = {}
for v in mesh.data.vertices:
    if z[v.index] < -0.01:
        g = max(v.groups, key=lambda g: g.weight); n = gname[g.group]; c = cnt.setdefault(n, [0, 0.0]); c[0] += 1; c[1] = min(c[1], z[v.index])
for n, (c, lo) in sorted(cnt.items(), key=lambda kv: -kv[1][0]): print("LOW %-22s %4d 个顶点，最低 %.3f" % (n, c, lo))
J = bc.read_joints(arm, skel)
for n in ("Nose", "Head", "LeftFShoulder", "RightFShoulder", "LeftFElbow", "RightFElbow", "LeftHHip", "LeftHKnee", "RightHKnee", "Root", "TailTip"): print("JOINT %-14s z=%.3f" % (n, J[skel.joint_names.index(n), 2]))
