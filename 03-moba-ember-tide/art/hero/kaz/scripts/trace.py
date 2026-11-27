#!/usr/bin/env python3
"""看一段解算好的动作里几个关键量随帧的变化，用来定裁剪的起止帧和出手时刻（照狼的 trace.py 改，加了前爪的前后位置和整体转向）。
用法: python trace.py <motion.npz> [步长=3]
列: 帧 | 鼻子 y(-前) z 速度 | 左前爪 y z、右前爪 y z | 左后爪 z 右后爪 z | 根 y z | 身体转向(度) | 四爪最低离地"""
import json, math, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sk = json.load(open(f"{V}/assets/model/kaz_skeleton.json")); jn = [j["name"] for j in sk["joints"]]
m = np.load(sys.argv[1], allow_pickle=True); J = m["joints"]; fps = float(m["fps"]); step = int(sys.argv[2]) if len(sys.argv) > 2 else 3
i = jn.index
nose = J[:, i("Nose")]; v = np.zeros(len(J)); v[1:-1] = np.linalg.norm(nose[2:] - nose[:-2], axis=1) * fps / 2
hip = (J[:, i("LeftHHip")] + J[:, i("RightHHip")]) / 2; sh = (J[:, i("LeftFShoulder")] + J[:, i("RightFShoulder")]) / 2; d = sh - hip
yaw = np.degrees(np.arctan2(-d[:, 0], -d[:, 1])); pitch = np.degrees(np.arctan2(d[:, 2], np.linalg.norm(d[:, :2], axis=1)))
feet = [i(n) for n in ("LeftFToe", "RightFToe", "LeftHToeTip", "RightHToeTip")]
print(f"{len(J)} 帧 @ {fps:.0f}")
print(" 帧 | 鼻y    鼻z   鼻速 | 左前y  z   | 右前y  z   | 左后z 右后z | 根y    根z  | 转向  俯仰 | 爪最低")
for f in range(0, len(J), step):
    print("%3d | %+.2f %.2f %5.2f | %+.2f %.2f | %+.2f %.2f | %.2f  %.2f | %+.2f %.2f | %+4.0f %+4.0f | %.3f" % (f, nose[f, 1], nose[f, 2], v[f],
          J[f, i("LeftFToe"), 1], J[f, i("LeftFToe"), 2], J[f, i("RightFToe"), 1], J[f, i("RightFToe"), 2], J[f, i("LeftHToeTip"), 2], J[f, i("RightHToeTip"), 2],
          J[f, i("Root"), 1], J[f, i("Root"), 2], yaw[f], pitch[f], J[f, feet, 2].min()))
