"""野猪几个小脚本共用的东西：读骨架、把成品动作（motions/<动作>.npz：names、quats、loc、fps）算回各跟踪点的位置。"""
import os, sys
import numpy as np
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V2R)
from v2r import skeleton as sk  # noqa: E402
skel = sk.Skeleton.load(f"{V2R}/assets/model/boar_skeleton.json"); JN = skel.joint_names; k = JN.index
MODEL_H = 0.725          # 摆正以后模型的总高（prep_rig.py 打印的 MESH_BBOX：身长 1.2、高 0.725）；游戏里的大小 = height ÷ 0.725


def quat_to_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def clip_joints(path):
    """成品动作 → (各跟踪点的位置 (T,K,3)，fps)。位置是摆正后的模型单位（身长 1.2）。"""
    m = np.load(path, allow_pickle=True); q = m["quats"]; loc = m["loc"]; J = np.zeros((len(q), skel.K, 3))
    for f in range(len(q)):
        Q = np.array([quat_to_mat(q[f, i] / np.linalg.norm(q[f, i])) for i in range(skel.n)]); P, G = skel.fk(Q, skel.R[skel.root] @ (loc[f] * skel.scale)); J[f] = skel.joint_positions(P, G)
    return J, float(m["fps"])
