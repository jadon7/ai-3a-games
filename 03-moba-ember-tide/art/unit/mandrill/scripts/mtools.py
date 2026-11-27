#!/usr/bin/env python3
"""量整理好的动作（motions/<名>.npz，每秒 30 帧）：手、脚、胯每一帧在哪。用来定普攻的时间点、看脚有没有陷进地里、估跑步的原速。
用法: V2R/.venv/bin/python mtools.py <motions 目录> <动作名> [每隔几帧打印一行=2]
坐标是管线摆正后的（脚踩 z=0，面朝 -Y，所以“往前”是 -y）。模型在管线里的高度是 0.82，不是 1。
"""
import json, os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk  # noqa: E402

SKEL = os.path.join(V, "assets/model/mandrill_skeleton.json")


def quat_to_mat(q):
    w, x, y, z = np.moveaxis(q, -1, 0)
    return np.stack([np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], -1),
                     np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], -1),
                     np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1)], -2)


def joints_of(npz_path, skel=None):
    """game 用的动作文件（names、quats、loc）-> 各跟踪点的世界坐标 (T,K,3)"""
    skel = skel or sk.Skeleton.load(SKEL); m = np.load(npz_path, allow_pickle=True); names = [str(x) for x in m["names"]]
    assert names == skel.names; Q = quat_to_mat(m["quats"].astype(float)); loc = m["loc"].astype(float)
    t = (skel.R[skel.root] @ (loc * skel.scale).T).T; out = np.zeros((len(Q), skel.K, 3))
    for f in range(len(Q)):
        P, G = skel.fk(Q[f], t[f]); out[f] = skel.joint_positions(P, G)
    return out, skel, float(m["fps"])


if __name__ == "__main__":
    d, name = sys.argv[1], sys.argv[2]; every = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    J, skel, fps = joints_of(os.path.join(d, name + ".npz")); jn = skel.joint_names; ix = jn.index
    hand = (J[:, ix("LeftHandMiddle1")] + J[:, ix("RightHandMiddle1")]) / 2; hv = np.linalg.norm(np.gradient(hand, axis=0), axis=1) * fps
    feet = [ix(n) for n in jn if "Foot" in n or "Toe" in n]
    print(f"{name}: {len(J)} 帧 @ {fps:.0f}，共 {(len(J) - 1) / fps:.2f} 秒；脚最低 {J[:, feet, 2].min():.3f}（静止时最低 {skel.joint_rest[feet, 2].min():.3f}）；胯高 {J[:, ix('Hips'), 2].min():.3f}~{J[:, ix('Hips'), 2].max():.3f}（静止 {skel.joint_rest[ix('Hips'), 2]:.3f}）")
    print("  帧   秒    双拳高  双拳前伸  拳速   胯高   头高   左踝(y,z)      右踝(y,z)")
    for f in range(0, len(J), every):
        la, ra = J[f, ix("LeftFoot")], J[f, ix("RightFoot")]
        print(f"  {f:3d} {f / fps:5.2f}  {hand[f, 2]:6.3f}  {-hand[f, 1]:6.3f}  {hv[f]:5.2f}  {J[f, ix('Hips'), 2]:5.3f}  {J[f, ix('Head'), 2]:5.3f}  ({la[1]:+.3f},{la[2]:.3f})  ({ra[1]:+.3f},{ra[2]:.3f})")
    top = int(hand[:, 2].argmax()); low = top + int(hand[top:, 2].argmin()); fast = top + int(hv[top:low + 1].argmax()) if low > top else top
    print(f"  双拳最高: 第 {top} 帧（{top / fps:.2f} 秒，高 {hand[top, 2]:.3f}）；之后砸得最快: 第 {fast} 帧（{fast / fps:.2f} 秒）；砸到最低: 第 {low} 帧（{low / fps:.2f} 秒，高 {hand[low, 2]:.3f}）")


def jitter(d, name, scale=2.3 / 0.82):
    """每个跟踪点的抖动（相邻三帧的二阶差分，换成游戏里的厘米）和活动范围，用来找抖得厉害的骨骼、看站着时脚有没有挪。"""
    J, skel, fps = joints_of(os.path.join(d, name + ".npz")); J = J * scale * 100
    acc = np.linalg.norm(J[2:] - 2 * J[1:-1] + J[:-2], axis=-1); rng = J.max(0) - J.min(0)
    print(f"{name}: 抖动（二阶差分的平均 / 最大，厘米）和活动范围（厘米，x 左右 / y 前后 / z 上下）")
    for k, n in enumerate(skel.joint_names):
        if n.startswith("Right") and n not in ("RightHand", "RightFoot", "RightToe_End", "RightHandMiddle4"): continue
        print(f"  {n:18s} {acc[:, k].mean():5.2f} / {acc[:, k].max():5.2f}    {rng[k, 0]:5.1f} {rng[k, 1]:5.1f} {rng[k, 2]:5.1f}")
