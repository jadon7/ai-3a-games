#!/usr/bin/env python3
"""扫一遍解算结果，找“蹄子没抬就瞬移”的地方：相邻两帧蹄尖都贴着地（z<0.05），水平却挪了 0.1 以上。真蹄子做不到，一定是读数认错了。
用法: python scan_feet.py <文件名，如 motion_fix.npz> <tag> ..."""
import json, sys, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sk = json.load(open(f"{V}/assets/model/boar_skeleton.json")); jn = [j["name"] for j in sk["joints"]]
fn = sys.argv[1]
for tag in sys.argv[2:]:
    J = np.load(f"{V}/out/anim/boar_{tag}/{fn}", allow_pickle=True)["joints"]; out = []
    for n in ("LeftFToe", "RightFToe", "LeftHToeTip", "RightHToeTip"):
        p = J[:, jn.index(n)]; d = np.linalg.norm(np.diff(p[:, :2], axis=0), axis=1); low = (p[1:, 2] < 0.05) & (p[:-1, 2] < 0.05)
        bad = np.where((d > 0.10) & low)[0] + 1
        if len(bad): out.append(f"{n}: 第 {bad.tolist()} 帧")
    print(tag, "  ".join(out) if out else "没有")
