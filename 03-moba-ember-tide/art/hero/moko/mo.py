#!/usr/bin/env python3
"""摩珂自己用：把求解出来的动作（motion.npz 的 joints）按帧打印成表，用来定起止帧和出手时刻。
用法: python art/hero/moko/mo.py <动作 tag，如 attack1> [起=0] [止=120] [步长=2]
角色面朝 -Y，左手边 +X，身高约 1。fwd 是往前伸了多少（-y），spd 是关节速度（身高每秒）。
"""
import sys, json
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
tag = sys.argv[1]; a = int(sys.argv[2]) if len(sys.argv) > 2 else 0; b = int(sys.argv[3]) if len(sys.argv) > 3 else 120; st = int(sys.argv[4]) if len(sys.argv) > 4 else 2
m = np.load(f"{V}/out/anim/moko_{tag}/motion.npz", allow_pickle=True); J = m["joints"].astype(float); fps = float(m["fps"]); T = len(J)
jn = [j["name"] for j in json.load(open(f"{V}/assets/model/moko_skeleton.json"))["joints"]]; ix = jn.index
def spd(k):
    v = np.zeros(T); v[1:-1] = np.linalg.norm(J[2:, k] - J[:-2, k], axis=1) / 2 * fps; return v
RH, LH, HP, HT = ix("RightHand"), ix("LeftHand"), ix("Hips"), ix("HeadTop_End")
sr, sl = spd(RH), spd(LH)
# 身体朝向：左右大腿根的连线转了多少度（0 是面朝 -Y）
d = J[:, ix("LeftUpLeg")] - J[:, ix("RightUpLeg")]; yaw = np.degrees(np.arctan2(d[:, 1], d[:, 0]))
# 上身前倾：胯到脖子的连线和竖直的夹角，往前为正
sp = J[:, ix("Neck")] - J[:, HP]; lean = np.degrees(np.arctan2(-sp[:, 1], sp[:, 2]))
print(f"{tag}: {T} 帧 @ {fps:.0f}")
print(" 帧 | 胯高  前倾 朝向 | 右手 x     前    高   速度 | 左手 x     前    高   速度 | 头顶高 脚最低")
for f in range(a, min(b, T - 1) + 1, st):
    feet = min(J[f, ix(n), 2] for n in ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"))
    print(f"{f:3d} | {J[f,HP,2]:.2f} {lean[f]:5.0f} {yaw[f]:5.0f} | {J[f,RH,0]:+.2f} {-J[f,RH,1]:+.2f} {J[f,RH,2]:.2f} {sr[f]:5.2f} | {J[f,LH,0]:+.2f} {-J[f,LH,1]:+.2f} {J[f,LH,2]:.2f} {sl[f]:5.2f} | {J[f,HT,2]:.2f} {feet:+.2f}")
