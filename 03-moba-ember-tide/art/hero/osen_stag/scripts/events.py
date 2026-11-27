#!/usr/bin/env python3
"""从整理好的成品动作（30 帧每秒）里量出手时刻，用来写时间表。打印每段里几个关键时刻（秒，按原速）。
用法: python events.py <motions 目录>"""
import os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk
skel = sk.Skeleton.load(f"{V}/assets/model/stag_skeleton.json"); JN = skel.joint_names; d = sys.argv[1]
def quat_to_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def joints(a):
    m = np.load(os.path.join(d, a + ".npz"), allow_pickle=True); q = m["quats"]; loc = m["loc"]; J = np.zeros((len(q), skel.K, 3))
    for f in range(len(q)):
        Q = np.array([quat_to_mat(q[f, i] / np.linalg.norm(q[f, i])) for i in range(skel.n)]); P, G = skel.fk(Q, skel.R[skel.root] @ (loc[f] * skel.scale)); J[f] = skel.joint_positions(P, G)
    return J, float(m["fps"])
k = JN.index; rest_nose = skel.joint_rest[k("Nose")]
def near_rest(J, fps, tol=0.06):                                          # 从后往前找：鼻子回到离站姿 tol 以内的最早时刻（之后一直在）
    dist = np.linalg.norm(J[:, k("Nose")] - J[:, k("Root")] - (rest_nose - skel.joint_rest[k("Root")]), axis=1); f = len(J) - 1
    while f > 0 and dist[f - 1] < tol: f -= 1
    return f / fps
J, fps = joints("attack1"); n = J[:, k("Nose")]; v = np.gradient(n[:, 1]) * fps
print("attack1: 头收到最后 %.2f 秒，向前顶得最快 %.2f 秒，顶到最前最低 %.2f 秒，回到站姿附近 %.2f 秒，全长 %.2f" % (n[:25, 1].argmax() / fps, v.argmin() / fps, (n[:, 2].argmin()) / fps, near_rest(J, fps), (len(J) - 1) / fps))
J, fps = joints("q"); n = J[:, k("Nose")]; v = np.gradient(n[:, 2]) * fps; toe = np.minimum(J[:, k("LeftFToe"), 2], J[:, k("RightFToe"), 2]); up = np.where(toe > 0.05)[0]
print("q: 头压到最低 %.2f 秒，向上挑得最快 %.2f 秒，前蹄离地 %.2f~%.2f 秒，回到站姿附近 %.2f 秒，全长 %.2f" % (n[:30, 2].argmin() / fps, v.argmax() / fps, up[0] / fps, up[-1] / fps, near_rest(J, fps), (len(J) - 1) / fps))
J, fps = joints("w"); z = J[:, k("RightFToe"), 2]; top = z.argmax(); land = top + np.where(z[top:] < 0.03)[0][0]
print("w: 右前蹄举到最高 %.2f 秒（高 %.2f），跺到地 %.2f 秒，回到站姿附近 %.2f 秒，全长 %.2f" % (top / fps, z[top], land / fps, near_rest(J, fps), (len(J) - 1) / fps))
J, fps = joints("e"); n = J[:, k("Nose")]; low = np.where(n[:, 2] < n[:, 2].min() + 0.04)[0]
print("e: 鼻子最低 %.2f（离地），到底 %.2f 秒，开始抬头 %.2f 秒，回到站姿附近 %.2f 秒，全长 %.2f" % (n[:, 2].min(), low[0] / fps, low[-1] / fps, near_rest(J, fps), (len(J) - 1) / fps))
J, fps = joints("r"); toe = np.minimum(J[:, k("LeftFToe"), 2], J[:, k("RightFToe"), 2]); up = np.where(toe > 0.05)[0]; n = J[:, k("Nose")]
print("r: 前蹄离地 %.2f 秒，立到最高 %.2f 秒，前蹄落地 %.2f 秒，回到站姿附近 %.2f 秒，全长 %.2f；人立时最高点 %.2f（站着 %.2f）" % (up[0] / fps, np.where(n[:, 2] > n[:, 2].max() - 0.05)[0][0] / fps, (up[-1] + 1) / fps, near_rest(J, fps), (len(J) - 1) / fps, J[..., 2].max(), skel.joint_rest[:, 2].max()))
J, fps = joints("death"); r = J[:, k("Root"), 2]; n = J[:, k("Nose"), 2]
print("death: 开始塌下去 %.2f 秒，身体着地 %.2f 秒，头垂到地 %.2f 秒，全长 %.2f" % (np.where(r < r[0] - 0.05)[0][0] / fps, np.where(r < r.min() + 0.03)[0][0] / fps, np.where(n < n.min() + 0.03)[0][0] / fps, (len(J) - 1) / fps))
