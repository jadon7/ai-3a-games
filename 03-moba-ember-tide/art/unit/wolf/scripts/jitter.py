#!/usr/bin/env python3
"""找抖动：整理好的动作（30 帧每秒）里，各跟踪点的“来回抖”量——相邻三帧的二阶差分里，方向反复翻转的那部分。
用法: python jitter.py <motions 目录> [动作 ...]   打印每段里抖得最厉害的几个点（单位：占身长的百分比）"""
import json, sys, os
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk
skel = sk.Skeleton.load(f"{V}/assets/model/wolf_skeleton.json")
d = sys.argv[1]; acts = sys.argv[2:] or [f[:-4] for f in sorted(os.listdir(d)) if f.endswith(".npz")]
def quat_to_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
for a in acts:
    m = np.load(os.path.join(d, a + ".npz"), allow_pickle=True); q = m["quats"]; loc = m["loc"]; T = len(q)
    J = np.zeros((T, skel.K, 3))
    for f in range(T):
        Q = np.array([quat_to_mat(q[f, i] / np.linalg.norm(q[f, i])) for i in range(skel.n)]); t = skel.R[skel.root] @ (loc[f] * skel.scale)
        P, G = skel.fk(Q, t); J[f] = skel.joint_positions(P, G)
    acc = J[2:] - 2 * J[1:-1] + J[:-2]                                   # (T-2,K,3)
    flip = (acc[1:] * acc[:-1]).sum(-1) < 0                              # 相邻两帧加速度反向 = 来回抖
    mag = np.minimum(np.linalg.norm(acc[1:], axis=-1), np.linalg.norm(acc[:-1], axis=-1)) * flip
    worst = np.argsort(-mag.max(0))[:4]
    print("%-8s %3d 帧  " % (a, T) + "  ".join("%s 最大 %.1f%%（第 %d 帧）均 %.2f%%" % (skel.joint_names[k], mag[:, k].max() * 100, int(mag[:, k].argmax()) + 2, mag[:, k].mean() * 100) for k in worst))
