"""打印一段 motion.npz 里几个关键点随帧的变化，定起止帧、找毛病用。用法: PY trace.py <motion.npz> [步长=3]"""
import sys, json, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sk = json.load(open(V + "/assets/model/beast_skeleton.json")); jn = [j["name"] for j in sk["joints"]]
m = np.load(sys.argv[1], allow_pickle=True); J = m["joints"].astype(float); step = int(sys.argv[2]) if len(sys.argv) > 2 else 3
ix = lambda n: jn.index(n)
print("帧  根z   根y   鼻z   鼻y   鼻x   | 左前腕z 右前腕z 左后踝z 右后踝z | 左前趾y 右前趾y 左后趾y 右后趾y | 尾尖x  尾尖z | 最低脚")
G = [ix(n) for n in sk["profile"]["ground_joints"]]
for f in range(0, len(J), step):
    r = J[f]
    print(f"{f:3d} {r[ix('Root'),2]:.3f} {r[ix('Root'),1]:+.3f} {r[ix('Nose'),2]:.3f} {r[ix('Nose'),1]:+.3f} {r[ix('Nose'),0]:+.3f} |  {r[ix('LeftFWrist'),2]:.3f}  {r[ix('RightFWrist'),2]:.3f}  {r[ix('LeftHAnkle'),2]:.3f}  {r[ix('RightHAnkle'),2]:.3f} | {r[ix('LeftFToe'),1]:+.3f} {r[ix('RightFToe'),1]:+.3f} {r[ix('LeftHToeTip'),1]:+.3f} {r[ix('RightHToeTip'),1]:+.3f} | {r[ix('TailTip'),0]:+.3f} {r[ix('TailTip'),2]:.3f} | {r[G,2].min():+.3f}")
R = sk["joints"]; rest = np.array([j.get("rest", j.get("pos", [0,0,0])) for j in R]) if "rest" in R[0] or "pos" in R[0] else None
print("关节字段", list(R[0].keys()))
