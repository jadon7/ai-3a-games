#!/usr/bin/env python3
"""量成品动作（motions/<动作>.npz，30 帧每秒）里的时间点：头伸得最远、身体转得最快、前脚落地、起跳和落地。
用法: V2R/.venv/bin/python measure.py <动作名> [动作名…]      在 art/hero/torg_turtle 里跑
每段打印一张逐帧的表（时间、头的前伸量、头的高度、头速、身体朝向、身体俯仰、胯的高度、前脚最低点、四脚最低点），再打印几个极值的时刻。
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, V2R)
from v2r import skeleton as sk  # noqa: E402

skel = sk.Skeleton.load(os.path.join(V2R, "assets/model/turtle_skeleton.json"))
J = {n: k for k, n in enumerate(skel.joint_names)}


def quat_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def joints_of(path):
    m = np.load(path, allow_pickle=True); q, loc, fps = m["quats"], m["loc"], float(m["fps"]); T = len(q)
    out = np.zeros((T, skel.K, 3)); G0 = np.zeros((T, 3, 3))
    for f in range(T):
        Q = np.array([quat_mat(q[f, i]) for i in range(skel.n)]); t = skel.R[skel.root] @ (loc[f] * skel.scale)
        P, G = skel.fk(Q, t); out[f] = skel.joint_positions(P, G); G0[f] = G[skel.root] @ skel.R[skel.root].T      # 根骨骼相对静止姿态的世界旋转
    return out, G0, fps


for name in sys.argv[1:]:
    Jt, A, fps = joints_of(os.path.join(HERE, "motions", name + ".npz")); T = len(Jt); tt = np.arange(T) / fps
    nose = Jt[:, J["Nose"]]; root = Jt[:, J["Root"]]
    fwd = -(nose[:, 1] - root[:, 1])                                        # 头相对胯向前伸了多少（面朝 -Y）
    reach = -nose[:, 1]                                                     # 头在世界里向前到哪
    v = np.linalg.norm(np.gradient(nose, axis=0), axis=1) * fps
    yaw = np.degrees(np.arctan2(-(A[:, 0, 1]), A[:, 1, 1]))                 # 身体绕竖直轴转了多少度（正 = 向左）
    pitch = np.degrees(np.arcsin(np.clip(-A[:, 2, 1] * -1, -1, 1)))         # 前半身抬起为负
    ff = np.minimum.reduce([Jt[:, J[n], 2] for n in ("LeftFWrist", "RightFWrist", "LeftFToe", "RightFToe")])
    af = np.minimum.reduce([Jt[:, J[n], 2] for n in skel.ground_joints])
    side = nose[:, 0]
    print(f"== {name}: {T} 帧 @ {fps:.0f}（{(T - 1) / fps:.2f} 秒）")
    print("   t   头前伸 头世界前 头侧向 头高  头速  身朝向 身俯仰 胯高  前脚低 四脚低")
    for f in range(0, T, 2):
        print(f"  {tt[f]:4.2f} {fwd[f]:6.3f} {reach[f]:6.3f} {side[f]:6.3f} {nose[f, 2]:5.3f} {v[f]:5.2f} {yaw[f]:6.1f} {pitch[f]:6.1f} {root[f, 2]:5.3f} {ff[f]:6.3f} {af[f]:6.3f}")
    yr = np.gradient(yaw) * fps
    print(f"  头伸得最远 t={tt[reach.argmax()]:.2f}；头速最大 t={tt[v.argmax()]:.2f}（{v.max():.2f}/秒）；身体转得最快 t={tt[np.abs(yr).argmax()]:.2f}（{yr[np.abs(yr).argmax()]:.0f}°/秒）；"
          f"前脚最高 t={tt[ff.argmax()]:.2f}（{ff.max():.3f}）；四脚都最高 t={tt[af.argmax()]:.2f}（{af.max():.3f}）；胯最高 t={tt[root[:, 2].argmax()]:.2f}；胯最低 t={tt[root[:, 2].argmin()]:.2f}（{root[:, 2].min():.3f}，静止 {skel.joint_rest[J['Root'], 2]:.3f}）")
