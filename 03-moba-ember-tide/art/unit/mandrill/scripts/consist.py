#!/usr/bin/env python3
"""看一段视频的读数里，两个机位对同一个关节的高度是不是一致（正交相机下应该一样），以及“侧面机位把左右肢认反了”的迹象。
用法: V2R/.venv/bin/python consist.py <anim 目录> [起始帧] [结束帧]
每帧打印：手臂、腿各关节两机位高度差（世界单位，模型高 0.82），以及“不对调 / 对调侧面左右”两种情况下的代价。
"""
import os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk  # noqa: E402
d = sys.argv[1]; det = np.load(os.path.join(d, "detections.npz")); obs, conf = det["obs"], det["conf"]; T = len(obs)
a = int(sys.argv[2]) if len(sys.argv) > 2 else 0; b = int(sys.argv[3]) if len(sys.argv) > 3 else T - 1
skel = sk.Skeleton.load(os.path.join(V, "assets/model/mandrill_skeleton.json")); jn = skel.joint_names
zf, zs = obs[:, 0, :, 1] * sk.ORTHO_H, obs[:, 1, :, 1] * sk.ORTHO_H
ARM = ("ForeArm", "Hand", "HandMiddle1"); LEG = ("Leg", "Foot", "Toe_End")


def costs(parts):
    L = [jn.index("Left" + p) for p in parts]; R = [jn.index("Right" + p) for p in parts]
    c0 = np.abs(zf[:, L] - zs[:, L]).sum(1) + np.abs(zf[:, R] - zs[:, R]).sum(1); c1 = np.abs(zf[:, L] - zs[:, R]).sum(1) + np.abs(zf[:, R] - zs[:, L]).sum(1)
    return c0, c1


a0, a1 = costs(ARM); l0, l1 = costs(LEG)
print("帧   臂:不换/对调   腿:不换/对调   左手高(正/侧) 右手高(正/侧)  左踝高(正/侧) 右踝高(正/侧)  侧面置信度 左手/右手/左踝/右踝")
H = lambda f, n, v: sk.Z_CENTER - ((zf if v == 0 else zs)[f, jn.index(n)] / sk.ORTHO_H - 0.5) * sk.ORTHO_H  # noqa: E731
for f in range(a, b + 1):
    print(f"{f:3d}  {a0[f]:.2f}/{a1[f]:.2f}{' *' if a1[f] < a0[f] - 0.05 else '  '}  {l0[f]:.2f}/{l1[f]:.2f}{' *' if l1[f] < l0[f] - 0.05 else '  '}   "
          f"{H(f, 'LeftHand', 0):.2f}/{H(f, 'LeftHand', 1):.2f}  {H(f, 'RightHand', 0):.2f}/{H(f, 'RightHand', 1):.2f}   {H(f, 'LeftFoot', 0):.2f}/{H(f, 'LeftFoot', 1):.2f}  {H(f, 'RightFoot', 0):.2f}/{H(f, 'RightFoot', 1):.2f}   "
          f"{conf[f, 1, jn.index('LeftHand')]:.2f}/{conf[f, 1, jn.index('RightHand')]:.2f}/{conf[f, 1, jn.index('LeftFoot')]:.2f}/{conf[f, 1, jn.index('RightFoot')]:.2f}")
print(f"臂对调更好的帧 {int((a1 < a0 - 0.05).sum())}/{T}，腿对调更好的帧 {int((l1 < l0 - 0.05).sum())}/{T}")
