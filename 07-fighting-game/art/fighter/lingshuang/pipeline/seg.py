"""看一段解出来的动作离第 0 帧（架势）有多远，按帧打印，用来定裁剪的起止帧。用法: python seg.py 动作 …"""
import sys, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
for tag in sys.argv[1:]:
    m = np.load(f"{V}/out/anim/lingshuang_{tag}/motion.npz"); J = m["joints"]; T = len(J)
    Jr = J - J[:, :1] * np.array([1, 1, 0]); ref = Jr[:3].mean(0)
    d = np.sqrt(((Jr - ref) ** 2).sum(-1)).max(1) * 100; hz = J[:, 0, 2]
    print(tag, T, "离架势最远关节(厘米,身高100)：", " ".join(f"{i}:{d[i]:.0f}" for i in range(0, T, 3)))
    print("   胯高", " ".join(f"{i}:{hz[i]*100:.0f}" for i in range(0, T, 6)), " 胯水平位移", np.abs(J[:, 0, :2] - J[0, 0, :2]).max(0).round(3))
