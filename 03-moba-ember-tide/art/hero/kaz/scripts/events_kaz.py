#!/usr/bin/env python3
"""从整理好的成品动作（motions/*.npz，30 帧每秒）里量卡兹各段的关键时刻，用来写时间表 public/assets/hero/kaz.json。时间都是秒、按原速（未乘 speed）。
用法: python events_kaz.py <motions 目录>
  attack1（右爪扑抓）: swing = 右前爪抬到最高、开始往下抓；hit = 右前爪落回地面（离地 < 5 厘米身长）
  attack2（咬）: swing = 鼻子开始往前探（前探速度过 0.5 身长/秒）；hit = 鼻子探到最低最前（向前下方速度最大之后第一个停下的时刻）
  q / r（扑）: release = 起跳（四只爪子全离地的第一帧）；land = 前爪落地；腾空多久
  w（裂爪）: release = 右前爪横扫最快；second = 左前爪横扫最快
  e（炉吼）: release = 仰头之后鼻子向前下方冲得最快的时刻
  所有段: end = 鼻子回到离站姿 0.06 身长以内、之后一直在的最早时刻"""
import os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk
skel = sk.Skeleton.load(f"{V}/assets/model/kaz_skeleton.json"); JN = skel.joint_names; k = JN.index; rest = skel.joint_rest; d = sys.argv[1]


def quat_to_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def joints(a):
    m = np.load(os.path.join(d, a + ".npz"), allow_pickle=True); q = m["quats"]; loc = m["loc"]; J = np.zeros((len(q), skel.K, 3))
    for f in range(len(q)):
        Q = np.array([quat_to_mat(q[f, i] / np.linalg.norm(q[f, i])) for i in range(skel.n)]); P, G = skel.fk(Q, skel.R[skel.root] @ (loc[f] * skel.scale)); J[f] = skel.joint_positions(P, G)
    return J, float(m["fps"])


def end_t(J, fps, tol=0.06):
    dist = np.linalg.norm(J[:, k("Nose")] - rest[k("Nose")], axis=1); f = len(J) - 1
    while f > 0 and dist[f - 1] < tol: f -= 1
    return f / fps


FEET = [k(n) for n in ("LeftFToe", "RightFToe", "LeftHToeTip", "RightHToeTip")]
have = lambda a: os.path.exists(os.path.join(d, a + ".npz"))  # noqa: E731
if have("attack1"):
    J, fps = joints("attack1"); p = J[:, k("RightFToe")]; top = int(p[:, 2].argmax()); hit = top + int(np.argmax(p[top:, 2] < rest[k("RightFToe"), 2] + 0.05))
    print("attack1: 右爪抬到最高 %.2f 秒（高 %.2f 身长），落地 %.2f 秒（往前伸了 %.2f），end %.2f，全长 %.2f" % (top / fps, p[top, 2], hit / fps, rest[k("RightFToe"), 1] - p[hit, 1], end_t(J, fps), (len(J) - 1) / fps))
if have("attack2"):
    J, fps = joints("attack2"); n = J[:, k("Nose")]; v = np.gradient(n, axis=0) * fps; fwd = -v[:, 1] - v[:, 2]
    s = int(np.argmax(fwd > 0.5)); pk = int(fwd.argmax()); hit = pk + int(np.argmax(fwd[pk:] < 0.3))
    print("attack2: 开始前探 %.2f 秒，探得最快 %.2f 秒，咬到（停下）%.2f 秒（鼻子比站着靠前 %.2f、低 %.2f），end %.2f，全长 %.2f" % (s / fps, pk / fps, hit / fps, rest[k("Nose"), 1] - n[hit, 1], rest[k("Nose"), 2] - n[hit, 2], end_t(J, fps), (len(J) - 1) / fps))
for a in ("q", "r"):
    if not have(a): continue
    J, fps = joints(a); air = (J[:, FEET, 2] - rest[FEET, 2]).min(1) > 0.03; up = int(np.argmax(air)); land = up + int(np.argmax(~air[up:]))
    fl = J[:, [k("LeftFToe"), k("RightFToe")], 2].min(1); fland = up + int(np.argmax(fl[up:] < rest[k("LeftFToe"), 2] + 0.03))
    print("%s: 起跳 %.2f 秒，前爪落地 %.2f 秒，四爪着地 %.2f 秒（腾空 %.2f 秒，根最高抬了 %.2f 身长），end %.2f，全长 %.2f" % (a, up / fps, fland / fps, land / fps, (land - up) / fps, J[:, k("Root"), 2].max() - rest[k("Root"), 2], end_t(J, fps), (len(J) - 1) / fps))
if have("w"):
    J, fps = joints("w"); sp = lambda n: np.linalg.norm(np.gradient(J[:, k(n), :2], axis=0), axis=1) * fps  # noqa: E731
    r_, l_ = sp("RightFToe"), sp("LeftFToe"); r1 = int(r_.argmax()); l1 = int(l_.argmax())
    print("w: 右爪横扫最快 %.2f 秒（%.1f 身长/秒），左爪横扫最快 %.2f 秒（%.1f），end %.2f，全长 %.2f" % (r1 / fps, r_[r1], l1 / fps, l_[l1], end_t(J, fps), (len(J) - 1) / fps))
if have("e"):
    J, fps = joints("e"); n = J[:, k("Nose")]; top = int(n[:len(n) // 2, 2].argmax()); v = np.gradient(n, axis=0) * fps; fwd = -v[:, 1] - v[:, 2]; pk = top + int(fwd[top:].argmax())
    print("e: 仰头最高 %.2f 秒（鼻子高 %.2f），向前冲最快 %.2f 秒，end %.2f，全长 %.2f" % (top / fps, n[top, 2], pk / fps, end_t(J, fps), (len(J) - 1) / fps))
if have("death"):
    J, fps = joints("death"); sh = J[:, [k("LeftFShoulder"), k("RightFShoulder")], 2].mean(1); hip = J[:, [k("LeftHHip"), k("RightHHip")], 2].mean(1); n = J[:, k("Nose"), 2]
    first = lambda c: (np.where(c)[0][0] / fps) if c.any() else float("nan")  # noqa: E731
    print("death: 臀到最低 %.2f 秒（%.2f），肩到最低 %.2f 秒（%.2f），头垂到最低 %.2f 秒（鼻子 %.2f），全长 %.2f；全程最低的点 %.3f" % (first(hip < hip.min() + 0.02), hip.min(), first(sh < sh.min() + 0.02), sh.min(), first(n < n.min() + 0.02), n.min(), (len(J) - 1) / fps, J[..., 2].min()))
for a in ("idle", "run"):
    if not have(a): continue
    J, fps = joints(a); gap = np.linalg.norm(J[0] - J[-1], axis=-1).max()
    print("%s: %d 帧（%.2f 秒），首尾各点最多差 %.4f；爪子最低 %.3f" % (a, len(J), (len(J) - 1) / fps, gap, J[:, FEET, 2].min()))
