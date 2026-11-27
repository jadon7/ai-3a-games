#!/usr/bin/env python3
"""原地的动作（待机、普攻）把四只爪子钉在地上。

读出来的动作里，本该踩着不动的爪子会跟着读数的噪声慢慢蹭（待机里右后爪前后蹭了 7 厘米，普攻里左后爪蹭了 10 厘米，按游戏里的大小算）。
这里把每只爪子的落点定成它在整段里位置的中位数、高度定成站着时的高度，逐帧微调这条腿的几个关节把爪尖拉回去，爪根也回到站着的高度（爪子放平）。
只动腿，身体、头、尾巴不动。
循环的动作（待机）加 loop=起帧,止帧：先把这一段截出来、把首尾的差别摊到整段里接成循环，再钉脚（先钉后接的话，接的时候又会把爪子带歪一点）。
输出就是这一段（首尾两帧相同），motions.json 里用 "pick": [0, 末帧] 整段取。
用法: V2R/.venv/bin/python pin_feet.py <源 motion.npz> <输出.npz> [loop=起帧,止帧] [legs=2,3]
卡兹版多一个 legs=：只钉这几条腿（0 左前、1 右前、2 左后、3 右后），默认四条都钉。普攻、技能里抬起来扑抓的前爪不能钉。
还多一个 win=起-止,起-止：只在这几段帧里钉（扑跃腾空的那段不钉），段外 3 帧渐变到不钉。"""
import sys, os
import numpy as np
from scipy.optimize import least_squares
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kaz_lib import skel, load, rebuild, save, jk, dk, FEET, rot_slerp  # noqa: E402

src, dst = sys.argv[1:3]
theta, A, t, fps = load(src)
opt = dict(a.split("=") for a in sys.argv[3:])
if "loop" in opt:
    a, b = [int(v) for v in opt["loop"].split(",")]; N = b - a; w = np.arange(N + 1) / N
    dth, dt_, Rfix = theta[a] - theta[b], t[a] - t[b], A[b].T @ A[a]
    theta = theta[a:b + 1] + w[:, None] * dth[None]; t = t[a:b + 1] + w[:, None] * dt_[None]; A = np.array([A[a + i] @ rot_slerp(np.eye(3), Rfix, w[i]) for i in range(N + 1)])
    print("  接成循环：第 %d 到 %d 帧，首尾各自由度最多差 %.1f 度、位置差 %.3f 身长，摊到了整段里" % (a, b, np.degrees(np.abs(dth).max()), np.linalg.norm(dt_)))
T = len(theta)
LEG_DOFS = [["0_Left_Limb_0.fwd", "0_Left_Limb_1.fwd", "0_Left_Limb_1.out", "0_Left_Limb_2.pitch", "0_Left_Limb_3.pitch", "0_Left_Limb_4.pitch"],      # 卡兹的骨骼名（照狼的改）
            ["0_Right_Limb_0.fwd", "0_Right_Limb_1.fwd", "0_Right_Limb_1.out", "0_Right_Limb_2.pitch", "0_Right_Limb_3.pitch", "0_Right_Limb_4.pitch"],
            ["1_Left_Limb_0.pitch", "1_Left_Limb_0.roll", "1_Left_Limb_1.pitch", "1_Left_Limb_2.pitch", "1_Left_Limb_4.pitch"],
            ["1_Right_Limb_0.pitch", "1_Right_Limb_0.roll", "1_Right_Limb_1.pitch", "1_Right_Limb_2.pitch", "1_Right_Limb_4.pitch"]]
LEG_DOFS = [[dk(n) for n in leg] for leg in LEG_DOFS]
BASE = [jk(n) for n in ("LeftFFetlock", "RightFFetlock", "LeftHAnkle", "RightHAnkle")]
NAMES = ["左前", "右前", "左后", "右后"]
J0 = rebuild(theta, A, t)[2]; delta = np.zeros((T, skel.D))
PIN = [int(v) for v in opt["legs"].split(",")] if "legs" in opt else [0, 1, 2, 3]      # 卡兹加的：只钉哪几条腿（0 左前 1 右前 2 左后 3 右后），抬爪扑抓的那条不钉
# 卡兹加的：win= 只在这几段帧里钉（跳起来的那段不钉），段外 3 帧渐变；每一段各自定落点（落地的地方可以和起跳的地方不一样）
SEGS = [[int(v) for v in seg.split("-")] for seg in opt["win"].split(",")] if "win" in opt else [[0, T - 1]]
idx = np.arange(T); seg_w = [np.clip(1 - np.maximum(a_ - idx, idx - b_) / 3.0, 0, 1) for a_, b_ in SEGS]
wgt = np.max(seg_w, axis=0); owner = np.argmax(seg_w, axis=0)
for c in PIN:
    toe, base, dofs = FEET[c], BASE[c], LEG_DOFS[c]
    targets = [np.r_[np.median(J0[a_:b_ + 1, toe, :2], 0), skel.joint_rest[toe, 2]] for a_, b_ in SEGS]; x0 = np.zeros(len(dofs))
    for f in range(T):
        if wgt[f] <= 0: x0 = np.zeros(len(dofs)); continue
        target = targets[owner[f]]
        def res(x, f=f, target=target):
            th = theta[f].copy(); th[dofs] += x; Jf, _ = skel.pose_joints(th, A[f], t[f])
            return np.r_[10 * (Jf[toe] - target), 4 * (Jf[base, 2] - skel.joint_rest[base, 2]), 0.15 * x]
        lo, hi = skel.dof_lo[dofs] - theta[f][dofs] - 1e-6, skel.dof_hi[dofs] - theta[f][dofs] + 1e-6
        s = least_squares(res, np.clip(x0, lo, hi), bounds=(lo, hi), max_nfev=80); x0 = s.x; delta[f, dofs] = s.x * wgt[f]
# （试过把修正量沿时间抹平：尖刺那几帧就钉不住了。目标是固定的、每帧又从上一帧的解起步，修正量本身是连续的，不用再抹）
theta2 = np.clip(theta + delta, skel.dof_lo, skel.dof_hi)
if "loop" in opt: theta2[-1] = theta2[0]
J1 = save(dst, theta2, A, t, fps)
for c in range(4):
    a, b = J0[:, FEET[c]], J1[:, FEET[c]]
    print("  %s爪: 水平活动范围 %.3f → %.3f 身长，相邻帧最多挪 %.4f → %.4f，高度 %.3f~%.3f → %.3f~%.3f；关节最多改 %.1f 度"
          % (NAMES[c], np.linalg.norm(a[:, :2].max(0) - a[:, :2].min(0)), np.linalg.norm(b[:, :2].max(0) - b[:, :2].min(0)), np.linalg.norm(np.diff(a[:, :2], axis=0), axis=1).max(),
             np.linalg.norm(np.diff(b[:, :2], axis=0), axis=1).max(), a[:, 2].min(), a[:, 2].max(), b[:, 2].min(), b[:, 2].max(), np.degrees(np.abs(delta[:, LEG_DOFS[c]]).max())))
print("钉好了", dst)
