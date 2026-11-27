#!/usr/bin/env python3
"""把一段读出来的动作左右镜像（视频里它先向左拧、再向右扫；技能特效是从右扫到左，所以要反过来）。

做法：把读出来的每个关节的三维位置左右镜像（x 取反，左右同名的关节对调），当成“两个机位的读数”再交给管线的求解器解一遍。
这样解出来的是这副骨架自己能摆出的姿势，脚还是踩在地上（直接对调左右腿的角度不行：左右腿的骨骼静止姿势不对称，脚会飘起来五六厘米）。
模型本身不镜像：钟还是歪向它自己的左边。躯干上的点（背甲、钟、肩、髋，它们跟着根骨骼整块走）不用镜像的读数，
而是把根骨骼的朝向和位置直接镜像以后按这副骨架自己的尺寸算出来；否则左右不对称的标记点会让整个身体多转四五度。

用法: V2R/.venv/bin/python mirror_motion.py <源 motion.npz> <输出 motion.npz>
"""
import contextlib, io, os, sys
import numpy as np

V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, V2R)
from v2r import skeleton as sk  # noqa: E402
from v2r import solver  # noqa: E402

src, dst = sys.argv[1], sys.argv[2]
skel = sk.Skeleton.load(os.path.join(V2R, "assets/model/turtle_skeleton.json"))
m = np.load(src, allow_pickle=True); A, fps = m["joints"].astype(float), int(m["fps"]); T = len(A)
J = {n: k for k, n in enumerate(skel.joint_names)}
SKIP = {"BellTop", "BellMouth", "TailTip"}
SWAP = {"ShellL": "ShellR", "ShellR": "ShellL", "HelmetL": "HelmetR", "HelmetR": "HelmetL"}


def other(n):
    if n.startswith("Left"): return "Right" + n[4:]
    if n.startswith("Right"): return "Left" + n[5:]
    return SWAP.get(n, n)


def quat_mat(qq):
    w, x, y, z = qq
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


M = np.diag([-1.0, 1.0, 1.0]); R0 = skel.R[skel.root]; q0 = m["quats"].astype(float)[:, skel.root]; t0 = m["t"].astype(float)
rigid = [k for k in range(skel.K) if skel.joint_bone[k] == skel.root or (skel.parent[skel.joint_bone[k]] == skel.root and not np.any(skel.joint_offset_local[k]) and skel.roles[skel.joint_bone[k]] in ("upper_f", "upper_h"))]
tgt = np.zeros_like(A); conf = np.ones((T, 2, skel.K))
for n, k in J.items():
    tgt[:, J[other(n)]] = A[:, k] * np.array([-1.0, 1.0, 1.0])
for f in range(T):                                                          # 躯干上的点：根骨骼的朝向、位置直接镜像，再按骨架自己的尺寸摆
    Am = M @ (R0 @ quat_mat(q0[f]) @ R0.T) @ M
    j, _ = skel.pose_joints(np.zeros(skel.D), Am, M @ t0[f]); tgt[f, rigid] = j[rigid]
SKIP = set()
print("躯干上的点:", [skel.joint_names[k] for k in rigid])
obs = sk.project(tgt).transpose(1, 0, 2, 3)                                # (T,2,K,2)
jw = np.array([skel.joint_weight.get(n, 1.0) for n in skel.joint_names])
with contextlib.redirect_stdout(io.StringIO()):
    res = solver.solve(skel, obs, conf, joint_weight=jw, ground=True)
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
np.savez(dst, quats=res["quats"], loc=res["loc"], fps=fps, joints=res["joints"], theta=res["theta"], t=res["t"])
use = [k for n, k in J.items() if n not in SKIP]
err = np.linalg.norm(res["joints"][:, use] - tgt[:, use], axis=-1)
gi = skel.ground_idx
print(f"镜像好了 {dst}：{T} 帧；解出来的关节和镜像目标平均差 {err.mean() / skel.size_ref * 100:.2f}% 身长，最大 {err.max() / skel.size_ref * 100:.1f}%；"
      f"脚最低 {res['joints'][:, gi, 2].min():+.3f}（原来 {A[:, gi, 2].min():+.3f}）")
