"""看一段读出来的动作每一帧的大概样子（挑起止帧、找出手时刻用）：胯高、两只手腕的位置和速度、两腕距离、两脚高度。
用法: PY art/hero/hedda/vstat.py <动作> [步长=1]"""
import sys, json, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
tag = sys.argv[1]; st = int(sys.argv[2]) if len(sys.argv) > 2 else 1
m = np.load(f"{V}/out/anim/hedda_{tag}/motion.npz", allow_pickle=True); J = m["joints"]; fps = float(m["fps"])
jn = [j["name"] for j in json.load(open(f"{V}/assets/model/hedda_skeleton.json"))["joints"]]; ix = jn.index
H, RH, LH, RM, LF, RF, HD = ix("Hips"), ix("RightHand"), ix("LeftHand"), ix("RightHandMiddle1"), ix("LeftFoot"), ix("RightFoot"), ix("Head")
v = np.gradient(J, axis=0) * fps; ck = json.load(open(f"{V}/out/anim/hedda_{tag}/check.json"))
print(tag, "帧数", len(J), "fps", round(fps, 2), "回投", round(ck["reproj_pct"], 2), "对不上", ck["frames_inconsistent"])
print("帧  胯z   头z   右腕(x,y,z)          |v右|  左腕(x,y,z)          |v左|  两腕距 左脚z 右脚z")
for f in range(0, len(J), st):
    r = J[f, RH] - J[f, H] * [1, 1, 0]; l = J[f, LH] - J[f, H] * [1, 1, 0]
    print(f"{f:3d} {J[f,H,2]:.3f} {J[f,HD,2]:.3f} ({r[0]:+.2f},{r[1]:+.2f},{r[2]:.2f}) {np.linalg.norm(v[f,RH]):5.2f} ({l[0]:+.2f},{l[1]:+.2f},{l[2]:.2f}) {np.linalg.norm(v[f,LH]):5.2f} {np.linalg.norm(J[f,RH]-J[f,LH]):.2f} {J[f,LF,2]:.3f} {J[f,RF,2]:.3f}")
