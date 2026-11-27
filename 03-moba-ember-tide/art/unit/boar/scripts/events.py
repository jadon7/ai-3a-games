#!/usr/bin/env python3
"""从整理好的成品动作（30 帧每秒）里量出时间表要的时间点（秒，按原速）。用法: python events.py <motions 目录>"""
import os, sys
import numpy as np
from boarlib import clip_joints, skel, k
d = sys.argv[1]; rest = skel.joint_rest


def near_rest(J, fps, tol=0.06):          # 从后往前找：鼻子（相对胯）回到离站姿 tol 以内的最早时刻（之后一直在）
    dist = np.linalg.norm(J[:, k("Nose")] - J[:, k("Root")] - (rest[k("Nose")] - rest[k("Root")]), axis=1); f = len(J) - 1
    while f > 0 and dist[f - 1] < tol: f -= 1
    return f / fps


J, fps = clip_joints(os.path.join(d, "attack1.npz")); n = J[:, k("Nose")]; vz = np.gradient(n[:, 2]) * fps; ft = np.minimum(J[:, k("LeftFToe"), 2], J[:, k("RightFToe"), 2]); up = np.where(ft > 0.04)[0]
pk = int(vz.argmax()); st = pk
while st > 0 and vz[st - 1] > 0.25 * vz[pk]: st -= 1
print("attack1: 头压到最低 %.2f 秒，开始上挑 %.2f，挑得最快 %.2f（鼻尖 %.1f 模型单位/秒），挑到最高 %.2f（鼻尖高 %.2f），前蹄离地 %.2f~%.2f（最高 %.2f），回到站姿附近 %.2f，全长 %.2f" % (
    n[:pk, 2].argmin() / fps, st / fps, pk / fps, vz[pk], n[:, 2].argmax() / fps, n[:, 2].max(), (up[0] / fps if len(up) else -1), (up[-1] / fps if len(up) else -1), ft.max(), near_rest(J, fps), (len(J) - 1) / fps))
J, fps = clip_joints(os.path.join(d, "attack2.npz")); n = J[:, k("Nose")]; r = J[:, k("Root")]; vz = np.gradient(n[:, 2]) * fps; vy = -np.gradient(n[:, 1]) * fps; lf = J[:, k("LeftFToe"), 2]; rf = J[:, k("RightFToe"), 2]
ft = np.minimum(lf, rf); up = np.where(ft > 0.05)[0]; pk = int(vz.argmax()); paw = lf if lf[:pk].max() > rf[:pk].max() else rf
scr = [f for f in range(2, pk - 6) if paw[f] > 0.02 and paw[f] >= paw[f - 1] and paw[f] > paw[f + 1]]
sit = int(np.where(r[:pk, 2] < r[:pk, 2].min() + 0.01)[0][0]); thrust = int(vy[max(0, pk - 8):pk + 1].argmax()) + max(0, pk - 8)
land = up[-1] + 1 if len(up) else -1
print("attack2: 刨地抬蹄 %s 秒，坐到底 %.2f，向前顶得最快 %.2f，向上甩得最快 %.2f，前蹄离地 %.2f~%.2f（最高 %.2f），前蹄跺地 %.2f，回到站姿附近 %.2f，全长 %.2f；身体前后挪动 %.2f~%.2f 模型单位" % (
    "/".join("%.2f" % (f / fps) for f in scr), sit / fps, thrust / fps, pk / fps, (up[0] / fps if len(up) else -1), (up[-1] / fps if len(up) else -1), ft.max(), land / fps, near_rest(J, fps), (len(J) - 1) / fps, -(r[:, 1] - r[0, 1]).max(), -(r[:, 1] - r[0, 1]).min()))
J, fps = clip_joints(os.path.join(d, "death.npz")); r = J[:, k("Root"), 2]; n = J[:, k("Nose"), 2]; s3 = J[:, k("Spine3"), 2]; s0 = J[:, k("Spine0"), 2]
print("death: 前身开始塌 %.2f 秒，胸口着地 %.2f，屁股着地 %.2f，头垂到地 %.2f，全长 %.2f；最后胯高 %.2f（站着 %.2f）" % (np.where(s3 < s3[0] - 0.04)[0][0] / fps, np.where(s3 < s3.min() + 0.02)[0][0] / fps, np.where(s0 < s0.min() + 0.02)[0][0] / fps, np.where(n < n[-1] + 0.02)[0][0] / fps, (len(J) - 1) / fps, r[-1], rest[k("Root"), 2]))
for a in ("idle", "run"):
    J, fps = clip_joints(os.path.join(d, a + ".npz")); print("%s: 一圈 %.2f 秒；蹄尖最低 %.3f，胯高 %.2f~%.2f" % (a, (len(J) - 1) / fps, J[:, skel.ground_idx, 2].min(), J[:, k("Root"), 2].min(), J[:, k("Root"), 2].max()))
