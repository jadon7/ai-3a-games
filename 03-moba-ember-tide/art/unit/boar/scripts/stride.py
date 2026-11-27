#!/usr/bin/env python3
"""原地跑的动作里，每只蹄子踩地时往后蹬得多快（模型单位/秒）。和 hero_motion.py 的“原速”互相印证。
用法: python stride.py <motion.npz> <起帧> <止帧>"""
import json, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sk = json.load(open(f"{V}/assets/model/boar_skeleton.json")); jn = [j["name"] for j in sk["joints"]]
m = np.load(sys.argv[1], allow_pickle=True); a, b = int(sys.argv[2]), int(sys.argv[3]); J = m["joints"][a:b + 1]; fps = float(m["fps"])
root = J[:, jn.index("Root")]
for n in ("LeftFToe", "RightFToe", "LeftHToeTip", "RightHToeTip"):
    p = J[:, jn.index(n)]; y = p[:, 1] - root[:, 1]; z = p[:, 2]; vy = np.gradient(y) * fps
    on = z < z.min() + 0.02                                          # 踩地：离最低点 2% 身长以内
    print("%-13s 踩地帧占 %.0f%%  踩地时向后的速度 中位数 %.2f 平均 %.2f  前后摆幅 %.2f  抬脚最高 %.2f" % (n, on.mean() * 100, np.median(vy[on]), vy[on].mean(), y.max() - y.min(), z.max()))
