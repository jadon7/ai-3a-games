"""狼的动作后处理共用的几个函数：读管线的 motion.npz、按（各自由度角度、整体朝向、整体位置）重建四元数和跟踪点、存回管线的格式。
只依赖 numpy 和 v2r.skeleton。"""
import os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk  # noqa: E402
skel = sk.Skeleton.load(f"{V}/assets/model/wolf_skeleton.json"); JN = skel.joint_names; DN = skel.dof_names
jk = JN.index; dk = DN.index
FEET = [jk(n) for n in ("LeftFToe", "RightFToe", "LeftHToeTip", "RightHToeTip")]
ANIM = lambda tag: os.path.join(V, "out", "anim", f"wolf_{tag}")  # noqa: E731


def quat_to_mat(q):
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def load(path):
    """返回 theta (T,D)、A (T,3,3) 整体朝向、t (T,3)、fps。"""
    m = np.load(path, allow_pickle=True); R = skel.R[skel.root]
    A = np.array([R @ quat_to_mat(q) @ R.T for q in m["quats"][:, skel.root].astype(float)])
    return m["theta"].astype(float).copy(), A, m["t"].astype(float).copy(), float(m["fps"])


def rebuild(theta, A, t):
    """由 theta、A、t 重新算每根骨骼的四元数、根的位移、各跟踪点的位置。"""
    T = len(theta); quats = np.zeros((T, skel.n, 4)); J = np.zeros((T, skel.K, 3)); loc = np.zeros((T, 3))
    for f in range(T):
        Q = skel.local_rotations(theta[f], A[f]); P, G = skel.fk(Q, t[f]); J[f] = skel.joint_positions(P, G); quats[f], loc[f] = skel.blender_pose(Q, t[f])
    for f in range(1, T):
        flip = np.sum(quats[f] * quats[f - 1], -1) < 0; quats[f][flip] *= -1
    return quats, loc, J


def save(path, theta, A, t, fps):
    quats, loc, J = rebuild(theta, A, t); os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    np.savez(path, quats=quats, loc=loc, fps=int(round(fps)), joints=J, theta=theta, t=t)
    return J


def joints_of(theta, A, t):
    return rebuild(theta, A, t)[2]


def rot_slerp(A0, A1, w):
    """两个旋转矩阵之间按 w（0~1）插值。"""
    R = A0.T @ A1; ang = np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))
    if ang < 1e-6: return A0.copy()
    ax = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]]) / (2 * np.sin(ang))
    return A0 @ sk.rot_axis(ax, ang * w)


def smoothstep(x):
    x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)


def gauss(x, sigma):
    """沿第 0 维做高斯平滑（两头用边上的值垫）。"""
    r = int(np.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    pad = np.concatenate([np.repeat(x[:1], r, 0), x, np.repeat(x[-1:], r, 0)]); out = np.zeros_like(x, dtype=float)
    for i, w in enumerate(k): out += w * pad[i:i + len(x)]
    return out
