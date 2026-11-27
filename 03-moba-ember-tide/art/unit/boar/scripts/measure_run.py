#!/usr/bin/env python3
"""量成品跑步动作（motions/run.npz，循环）里每只蹄子踩地时向后蹬的速度，换算成游戏里的 runSpeed。
tools/hero_motion.py 的“原速”对四足小跑不准（它每帧只看最低的那只脚，小跑时蹄子抬得很低，回摆的蹄子也被算进去，正负抵消，得过负数）。
这里的量法：每只蹄子相对胯的前后位置是一条来回摆的曲线，向后走的那半程就是踩地蹬地；取每个向后半程中间六成的平均速度。
用法: python measure_run.py <run.npz> [游戏里的身高=2.7]"""
import sys
import numpy as np
from boarlib import clip_joints, k, MODEL_H
J, fps = clip_joints(sys.argv[1]); H = float(sys.argv[2]) if len(sys.argv) > 2 else 2.7; J = J[:-1]; T = len(J)      # 末帧 = 首帧，去掉
root = J[:, k("Root")]; out = []
for n in ("LeftFToe", "RightFToe", "LeftHToeTip", "RightHToeTip"):
    y = J[:, k(n), 1] - root[:, 1]; z = J[:, k(n), 2]
    v = (np.roll(y, -1) - np.roll(y, 1)) / 2 * fps                      # 循环差分
    back = v > 0; sp = []; i0 = int(np.argmin(back)) if not back.all() else 0      # 从一个“不在向后”的帧开始数连续段
    f = 0
    while f < T:
        i = (i0 + f) % T
        if back[i]:
            seg = []
            while f < T and back[(i0 + f) % T]: seg.append((i0 + f) % T); f += 1
            if len(seg) >= 4:
                a, b = int(len(seg) * 0.2), max(int(len(seg) * 0.8), int(len(seg) * 0.2) + 2); mid = seg[a:b]; sp.append((float(np.mean(v[mid])), len(seg), float(z[seg].mean())))
        else: f += 1
    s = float(np.mean([x[0] for x in sp])) if sp else 0.0
    out.append(s); print("%-13s 向后半程 %d 段，各段速度 %s，占一圈的 %.0f%%，前后摆幅 %.3f，抬蹄最高 %.3f（踩地时平均高 %.3f）" % (n, len(sp), "/".join("%.2f" % x[0] for x in sp), 100 * back.mean(), y.max() - y.min(), z.max(), np.mean([x[2] for x in sp]) if sp else 0))
m = float(np.mean(out)); print("一圈 %d 帧 @ %.0f（%.2f 秒）。四只蹄子平均 %.3f 模型单位/秒（前蹄 %.3f，后蹄 %.3f）" % (T, fps, T / fps, m, np.mean(out[:2]), np.mean(out[2:])))
print("换算成游戏里（身高 %.2f ÷ 模型高 %.3f = ×%.3f）：runSpeed ≈ %.2f 米/秒（前蹄 %.2f，后蹄 %.2f）" % (H, MODEL_H, H / MODEL_H, m * H / MODEL_H, np.mean(out[:2]) * H / MODEL_H, np.mean(out[2:]) * H / MODEL_H))
