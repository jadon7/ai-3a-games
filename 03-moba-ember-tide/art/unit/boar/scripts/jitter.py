#!/usr/bin/env python3
"""找抖动和穿地：整理好的成品动作（30 帧每秒）里，
  · 各跟踪点“来回抖”的量——相邻两帧的加速度方向相反的那部分（单位：占身长的百分比；游戏里身长约 4.5 米，1% ≈ 4.5 厘米）；
  · 蹄尖最低到哪（负数 = 踩进地里）、胯最低到哪。
用法: python jitter.py <motions 目录> [动作 ...]"""
import os, sys
import numpy as np
from boarlib import clip_joints, skel, k
d = sys.argv[1]; acts = sys.argv[2:] or [f[:-4] for f in sorted(os.listdir(d)) if f.endswith(".npz")]
for a in acts:
    J, fps = clip_joints(os.path.join(d, a + ".npz")); T = len(J)
    acc = J[2:] - 2 * J[1:-1] + J[:-2]; flip = (acc[1:] * acc[:-1]).sum(-1) < 0
    mag = np.minimum(np.linalg.norm(acc[1:], axis=-1), np.linalg.norm(acc[:-1], axis=-1)) * flip / 1.2
    worst = np.argsort(-mag.max(0))[:4]; g = J[:, skel.ground_idx, 2]
    print("%-8s %3d 帧  抖动: " % (a, T) + "  ".join("%s 最大 %.1f%%（第 %d 帧）均 %.2f%%" % (skel.joint_names[i], mag[:, i].max() * 100, int(mag[:, i].argmax()) + 2, mag[:, i].mean() * 100) for i in worst)
          + "  | 蹄尖最低 %.3f（第 %d 帧），胯最低 %.2f，鼻尖最低 %.3f" % (g.min(), int(g.min(1).argmin()), J[:, k("Root"), 2].min(), J[:, k("Nose"), 2].min()))
