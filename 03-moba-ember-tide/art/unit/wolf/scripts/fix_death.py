#!/usr/bin/env python3
"""死亡：趴到地上以后，不让身体陷进地里。

求解只管“跟踪点不到地面以下”，可跟踪点在骨头上，肉在骨头外面：头垂到鼻尖贴地时，张着的下巴整个在地面以下（陷 4% 身长，按游戏里的大小十厘米）；
左前腿的肘、胸口也陷了一两厘米。这里给每个跟踪点定一个“离地至少多高”（大致是那个地方肉的厚度），逐帧微调：整体的高度、脖子和头的俯仰、
四条腿的几个关节，够不着下限的抬上来，已经够的不动；爪尖的水平位置尽量不变。站着的那些帧本来就满足，不会被改。
用法: V2R/.venv/bin/python fix_death.py <源 motion.npz> <输出.npz>      改完用 mesh_floor.py 查网格"""
import sys, os
import numpy as np
from scipy.optimize import least_squares
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wolf_lib import skel, load, rebuild, save, jk, dk, FEET  # noqa: E402

src, dst = sys.argv[1:3]
theta, A, t, fps = load(src); T = len(theta); rest = skel.joint_rest
FLOOR = {"Nose": 0.062, "Head": 0.10, "NeckMid": 0.11, "Neck": 0.15, "Spine2": 0.17, "Spine0": 0.15, "Root": 0.105, "TailBase": 0.06}
for s in ("Left", "Right"):
    FLOOR.update({s + "FShoulder": 0.125, s + "FElbow": 0.045, s + "FWrist": 0.034, s + "FFetlock": 0.028, s + "FToe": rest[jk(s + "FToe"), 2] - 0.005,
                  s + "HHip": 0.105, s + "HKnee": 0.045, s + "HHock": 0.034, s + "HAnkle": 0.03, s + "HToeTip": rest[jk(s + "HToeTip"), 2] - 0.005})      # 爪尖放宽半厘米：站着的帧爪尖本来就在这个高度上下浮动，别为这个去动它
FK = np.array([jk(n) for n in FLOOR]); FV = np.array(list(FLOOR.values()))
DOFS = [dk(n) for n in ["Spine_3.neck_pitch", "Head_2.pitch",
                        "0_Left_Limb_0.fwd", "0_Left_Limb_0.out", "0_Left_Limb_1.pitch", "0_Left_Limb_2.pitch", "0_Left_Limb_3.pitch",
                        "0_Right_Limb_1.fwd", "0_Right_Limb_1.out", "0_Right_Limb_2.pitch", "0_Right_Limb_3.pitch", "0_Right_Limb_4.pitch",
                        "1_Left_Limb_0.fwd", "1_Left_Limb_0.out", "1_Left_Limb_1.pitch", "1_Left_Limb_2.pitch", "1_Left_Limb_3.pitch",
                        "1_Right_Limb_0.fwd", "1_Right_Limb_0.out", "1_Right_Limb_1.pitch", "1_Right_Limb_2.pitch", "1_Right_Limb_3.pitch"]]
J0 = rebuild(theta, A, t)[2]; theta2, t2 = theta.copy(), t.copy(); x0 = np.zeros(len(DOFS) + 1); changed = 0
for f in range(T):
    need = FV - J0[f, FK, 2]
    if need.max() <= 0: x0[:] = 0; continue                                     # 这一帧哪儿都没陷：不动
    toes0 = J0[f, FEET, :2]

    def res(x, f=f, toes0=toes0):
        th = theta[f].copy(); th[DOFS] += x[:-1]; tt = t[f] + np.array([0, 0, x[-1]]); Jf, _ = skel.pose_joints(th, A[f], tt)
        return np.r_[25 * np.clip(FV - Jf[FK, 2], 0, None), 4 * (Jf[FEET, :2] - toes0).ravel(), 0.25 * x[:-1], 2.0 * x[-1]]
    lo = np.r_[skel.dof_lo[DOFS] - theta[f][DOFS] - 1e-6, -1e-6]; hi = np.r_[skel.dof_hi[DOFS] - theta[f][DOFS] + 1e-6, 0.08]
    s = least_squares(res, np.clip(x0, lo, hi), bounds=(lo, hi), max_nfev=120); x0 = s.x
    theta2[f][DOFS] += s.x[:-1]; t2[f, 2] += s.x[-1]; changed += 1
# 修正量沿时间抹平一点（倒下去的过程里下限是一帧一帧开始起作用的，免得一顿一顿）
d_th, d_t = theta2 - theta, t2 - t
k = np.exp(-0.5 * (np.arange(-3, 4) / 1.2) ** 2); k /= k.sum()
sm = lambda x: np.stack([np.convolve(np.pad(x[:, c], 3, mode="edge"), k, mode="valid") for c in range(x.shape[1])], 1)      # noqa: E731
theta2 = np.clip(theta + np.maximum(np.abs(sm(d_th)), 0) * np.sign(sm(d_th)), skel.dof_lo, skel.dof_hi); t2 = t + sm(d_t)
J1 = save(dst, theta2, A, t2, fps)
low0, low1 = (FV - J0[:, FK, 2]).max(1), (FV - J1[:, FK, 2]).max(1)
print("改了 %d 帧（共 %d）；跟踪点离下限最多差 %.3f → %.3f 身长；整体最多抬高 %.3f，关节最多改 %.1f 度；最后一帧鼻子高 %.3f → %.3f，左肘 %.3f → %.3f"
      % (changed, T, low0.max(), low1.max(), (t2 - t)[:, 2].max(), np.degrees(np.abs(theta2 - theta).max()), J0[-1, jk("Nose"), 2], J1[-1, jk("Nose"), 2], J0[-1, jk("LeftFElbow"), 2], J1[-1, jk("LeftFElbow"), 2]))
print("写好了", dst)
