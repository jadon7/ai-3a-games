#!/usr/bin/env python3
"""从整理好的成品动作（30 帧每秒）里量关键时刻，用来写时间表。时间都是秒、按原速。
用法: python events.py <motions 目录>"""
import os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk
skel = sk.Skeleton.load(f"{V}/assets/model/wolf_skeleton.json"); JN = skel.joint_names; d = sys.argv[1]
def quat_to_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def joints(a):
    m = np.load(os.path.join(d, a + ".npz"), allow_pickle=True); q = m["quats"]; loc = m["loc"]; J = np.zeros((len(q), skel.K, 3))
    for f in range(len(q)):
        Q = np.array([quat_to_mat(q[f, i] / np.linalg.norm(q[f, i])) for i in range(skel.n)]); P, G = skel.fk(Q, skel.R[skel.root] @ (loc[f] * skel.scale)); J[f] = skel.joint_positions(P, G)
    return J, float(m["fps"])
k = JN.index; rest = skel.joint_rest
def near_rest(J, fps, tol=0.06):                                          # 从后往前找：鼻子回到离站姿 tol 以内的最早时刻（之后一直在）
    dist = np.linalg.norm(J[:, k("Nose")] - rest[k("Nose")], axis=1); f = len(J) - 1
    while f > 0 and dist[f - 1] < tol: f -= 1
    return f / fps
if os.path.exists(os.path.join(d, "attack1.npz")):
    J, fps = joints("attack1"); n = J[:, k("Nose")]; v = np.gradient(n[:, 1]) * fps; front = int(n[:, 1].argmin()); back = int(n[:front + 1, 1].argmax()); fast = int(v[:front + 1].argmin())
    print("attack1: 身体缩到最后 %.2f 秒（鼻子比站着靠后 %.2f），向前探得最快 %.2f 秒（%.1f 身长/秒），探到最前 %.2f 秒（比站着靠前 %.2f、高度 %.2f），回到站姿附近 %.2f 秒，全长 %.2f 秒"
          % (back / fps, n[back, 1] - rest[k("Nose"), 1], fast / fps, -v[fast], front / fps, rest[k("Nose"), 1] - n[front, 1], n[front, 2], near_rest(J, fps), (len(J) - 1) / fps))
    feet = [k(x) for x in ("LeftFToe", "RightFToe", "LeftHToeTip", "RightHToeTip")]
    print("         四只爪子水平挪动最多 %s（身长），抬起最高 %s" % (np.round(np.linalg.norm(J[:, feet, :2] - J[:1, feet, :2], axis=-1).max(0), 3).tolist(), np.round(J[:, feet, 2].max(0), 3).tolist()))
if os.path.exists(os.path.join(d, "death.npz")):
    J, fps = joints("death"); r = J[:, k("Root"), 2]; n = J[:, k("Nose"), 2]; sh = J[:, [k("LeftFShoulder"), k("RightFShoulder")], 2].mean(1); hip = J[:, [k("LeftHHip"), k("RightHHip")], 2].mean(1)
    first = lambda cond: (np.where(cond)[0][0] / fps) if cond.any() else float("nan")
    print("death: 肩开始塌 %.2f 秒，肩到最低 %.2f 秒（高 %.2f），臀到最低 %.2f 秒（高 %.2f），头垂到最低 %.2f 秒（鼻子高 %.2f），全长 %.2f 秒；全程最低的点 z=%.3f"
          % (first(sh < sh[0] - 0.04), first(sh < sh.min() + 0.02), sh.min(), first(hip < hip.min() + 0.02), hip.min(), first(n < n.min() + 0.02), n.min(), (len(J) - 1) / fps, J[..., 2].min()))
for a in ("idle", "run"):
    if not os.path.exists(os.path.join(d, a + ".npz")): continue
    J, fps = joints(a); gap = np.linalg.norm(J[0] - J[-1], axis=-1).max(); v0 = (J[1] - J[0]) * fps; v1 = (J[-1] - J[-2]) * fps
    feet = [k(x) for x in ("LeftFToe", "RightFToe", "LeftHToeTip", "RightHToeTip")]
    print("%s: %d 帧（%.2f 秒），首尾各点最多差 %.4f，首尾速度最多差 %.2f 身长/秒；爪子最低 %.3f 最高 %s" % (a, len(J), (len(J) - 1) / fps, gap, np.linalg.norm(v0 - v1, axis=-1).max(), J[:, feet, 2].min(), np.round(J[:, feet, 2].max(0), 2).tolist()))
