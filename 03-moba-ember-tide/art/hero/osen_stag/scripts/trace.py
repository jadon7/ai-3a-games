#!/usr/bin/env python3
"""看一段解算好的动作里几个关键量随帧的变化，用来定裁剪的起止帧和出手时刻。
用法: python trace.py <motion.npz> [步长=3]
列: 帧 | 鼻子前伸 y(-前) 高度 z 速度 | 左角尖高度 | 左前蹄 z 右前蹄 z 左后蹄 z 右后蹄 z | 根 z | 与静止姿势的平均偏离"""
import json, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sk = json.load(open(f"{V}/assets/model/stag_skeleton.json")); jn = [j["name"] for j in sk["joints"]]
m = np.load(sys.argv[1], allow_pickle=True); J = m["joints"]; fps = float(m["fps"]); step = int(sys.argv[2]) if len(sys.argv) > 2 else 3
i = jn.index
rest = np.array([np.array(next(b for b in sk["bones"] if b["name"] == j["bone"])["head"]) + np.array(j["offset"]) for j in sk["joints"]])
nose = J[:, i("Nose")]; v = np.zeros(len(J)); v[1:-1] = np.linalg.norm(nose[2:] - nose[:-2], axis=1) * fps / 2
Jr = J - J[:, i("Root"):i("Root") + 1] * np.array([1, 1, 0.0]); dev = np.linalg.norm(Jr - (rest - rest[i("Root")] * np.array([1, 1, 0.0])), axis=-1).mean(1)
print(f"{len(J)} 帧 @ {fps:.0f}")
print(" 帧 | 鼻y    鼻z   鼻速 | 角z  | 左前  右前  左后  右后 | 根y    根z  | 偏离")
for f in range(0, len(J), step):
    print("%3d | %+.2f %.2f %5.2f | %.2f | %.2f  %.2f  %.2f  %.2f | %+.2f %.2f | %.3f" % (f, nose[f, 1], nose[f, 2], v[f], J[f, i("LeftHorn"), 2],
          J[f, i("LeftFToe"), 2], J[f, i("RightFToe"), 2], J[f, i("LeftHToeTip"), 2], J[f, i("RightHToeTip"), 2], J[f, i("Root"), 1], J[f, i("Root"), 2], dev[f]))
