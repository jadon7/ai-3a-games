"""看一段解出来的动作（V2R/out/anim/ugo_<动作>/motion.npz）每隔几帧的关键点，用来挑裁剪的帧。
用法: V2R/.venv/bin/python peek.py <动作> [隔几帧=2]
列：帧号、胯高、头顶（前后 y、高 z）、右手中指尖（y、z）、左手中指尖（y、z）、两脚踝高、右手和左手的速度（身高/秒）。坐标：面朝 -Y，“往前”是 y 变小。
"""
import sys, json
import numpy as np
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
tag = sys.argv[1]; step = int(sys.argv[2]) if len(sys.argv) > 2 else 2
m = np.load(f"{V2R}/out/anim/ugo_{tag}/motion.npz", allow_pickle=True); J = m["joints"]; fps = float(m["fps"])
jn = [j["name"] for j in json.load(open(f"{V2R}/assets/model/ugo_skeleton.json"))["joints"]]
g = lambda n: J[:, jn.index(n)]
H, HT, RH, LH, LF, RF = g("Hips"), g("HeadTop_End"), g("RightHandMiddle4"), g("LeftHandMiddle4"), g("LeftFoot"), g("RightFoot")
rel = lambda P: P - H * np.array([1, 1, 0])                          # 去掉胯的水平位移
vr = np.r_[0, np.linalg.norm(np.diff(RH, axis=0), axis=1) * fps]; vl = np.r_[0, np.linalg.norm(np.diff(LH, axis=0), axis=1) * fps]
print(f"{tag}: {len(J)} 帧 @ {fps:.0f}")
print(" f   hipz  head(y,z)     RH(y,z)       LH(y,z)      LFz   RFz   vR   vL  vHead")
vh = np.r_[0, np.linalg.norm(np.diff(HT, axis=0), axis=1) * fps]
for f in range(0, len(J), step):
    if max(vr[f], vl[f], vh[f]) < 0.4 and f % 10: continue
    h = rel(HT)[f]; r = rel(RH)[f]; l = rel(LH)[f]
    print(f"{f:3d} {H[f,2]:.3f} ({h[1]:+.2f},{h[2]:.2f}) ({r[1]:+.2f},{r[2]:.2f}) ({l[1]:+.2f},{l[2]:.2f}) {LF[f,2]:.3f} {RF[f,2]:.3f} {vr[f]:4.1f} {vl[f]:4.1f} {vh[f]:4.1f}")
