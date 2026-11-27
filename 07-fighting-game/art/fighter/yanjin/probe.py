"""看管线读出来的原始动作（V2R/out/anim/yanjin_<动作>/motion.npz，视频帧号）：每帧胯高、双脚最低、左右手/脚往前伸多远（相对第 0 帧的胯），帮着定裁剪的起止帧。
用法: <V2R>/.venv/bin/python probe.py <动作> [步长=2]"""
import sys, json, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
tag = sys.argv[1]; st = int(sys.argv[2]) if len(sys.argv) > 2 else 2
m = np.load(f"{V}/out/anim/yanjin_{tag}/motion.npz"); J = m["joints"]
jn = [j["name"] for j in json.load(open(f"{V}/assets/model/yanjin_skeleton.json"))["joints"]]
g = lambda n: J[:, jn.index(n)]
h = g("Hips"); h0 = h[0]
cols = {"LH": "LeftHand", "RH": "RightHand", "LE": "LeftForeArm", "RE": "RightForeArm", "LF": "LeftFoot", "RF": "RightFoot"}
feet = [k for k, n in enumerate(jn) if "Foot" in n or "Toe" in n]
ref = {k: -(g(n)[0, 1] - h0[1]) for k, n in cols.items()}
print(tag, "帧", len(J), "第0帧前伸", {k: round(float(v), 2) for k, v in ref.items()})
print("帧  胯z   脚低  胯前 |  LH前  LHz | RH前  RHz | LF前 RF前 RFz")
for f in range(0, len(J), st):
    r = {k: g(n)[f] for k, n in cols.items()}
    print(f"{f:3d} {h[f,2]:.3f} {J[f, feet, 2].min():.3f} {-(h[f,1]-h0[1]):+.2f} | {-(r['LH'][1]-h0[1]):+.2f} {r['LH'][2]:.2f} | {-(r['RH'][1]-h0[1]):+.2f} {r['RH'][2]:.2f} | {-(r['LF'][1]-h0[1]):+.2f} {-(r['RF'][1]-h0[1]):+.2f} {r['RF'][2]:.2f}")
