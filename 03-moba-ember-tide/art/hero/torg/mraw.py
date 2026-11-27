#!/usr/bin/env python3
"""看管线读出来的原始动作（24 帧每秒，帧号和视频一样）里几个关节怎么动，用来定 motions.json 的起止帧。只读。
用法: python mraw.py <动作> [起帧=0] [止帧=120] [步长=2]
每行: 帧  胯(x,y,z)  右手(x,y,z) 速度  左手(x,y,z) 速度  左右脚踝 z  头 z   （单位是身高；前方是 -y，左手边是 +x）"""
import sys, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk
skel = sk.Skeleton.load(f"{V}/assets/model/torg_skeleton.json"); n = skel.joint_names; ix = {k: n.index(k) for k in ("Hips", "RightHand", "LeftHand", "LeftFoot", "RightFoot", "Head", "RightHandMiddle1")}
tag = sys.argv[1]; a = int(sys.argv[2]) if len(sys.argv) > 2 else 0; b = int(sys.argv[3]) if len(sys.argv) > 3 else 120; st = int(sys.argv[4]) if len(sys.argv) > 4 else 2
m = np.load(f"{V}/out/anim/torg_{tag}/motion.npz", allow_pickle=True); J = m["joints"]; fps = float(m["fps"]); T = len(J)
sp = lambda k: np.concatenate([[0], np.linalg.norm(np.diff(J[:, ix[k]], axis=0), axis=1) * fps])
sr, sl = sp("RightHand"), sp("LeftHand")
print(f"{tag}: {T} 帧 @ {fps:.0f}")
for f in range(a, min(b, T - 1) + 1, st):
    h, r, l = J[f, ix["Hips"]], J[f, ix["RightHand"]], J[f, ix["LeftHand"]]
    print(f"{f:3d}  胯 {h[0]:+.2f} {h[1]:+.2f} {h[2]:.2f}  右手 {r[0]:+.2f} {r[1]:+.2f} {r[2]:.2f} v{sr[f]:4.1f}  左手 {l[0]:+.2f} {l[1]:+.2f} {l[2]:.2f} v{sl[f]:4.1f}  脚 {J[f, ix['LeftFoot'], 2]:.2f} {J[f, ix['RightFoot'], 2]:.2f}  头 {J[f, ix['Head'], 2]:.2f}")
