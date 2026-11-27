#!/usr/bin/env python3
"""解出趴卧姿势（死亡的结尾）的各个自由度：给几个关节定目标位置（前腿向前伸直平放、后腿折在身下、胸口肚子贴地、
头搁在两条前腿之间、尾巴平放在地上），在活动范围内做最小二乘。比一个角度一个角度地试快，也不会左右腿摆得不一样
（静止姿势是走姿，左右腿的起点角度不同，手写同一组角度出来两条腿是歪的）。卡兹版：照狼的改，高度按卡兹的体型，尾巴不跟踪所以去掉了尾巴的目标、加了下巴。
用法: V2R/.venv/bin/python lie_ik.py <输出.npz> [从这个 npz 的 theta 起步]
产出 npz: theta、ypr、t（整体位置，x、y 为 0）。渲染检查用 lie_pose.py。"""
import math, sys
import numpy as np
from scipy.optimize import least_squares
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk
skel = sk.Skeleton.load(f"{V}/assets/model/kaz_skeleton.json"); JN = skel.joint_names; k = JN.index; D = skel.D
lo, hi = skel.dof_lo.copy(), skel.dof_hi.copy()
free = np.ones(D, bool)
for i, nm in enumerate(skel.dof_names):
    if "spine_" in nm or "neck_yaw" in nm or "neck_roll" in nm or "tailA_yaw" in nm or "tailB_yaw" in nm or nm.endswith(".twist") or nm in ("Head_1.yaw", "Head_1.roll"): free[i] = False       # 脊柱不动，头尾不歪，腿不拧
idx = np.where(free)[0]


def unpack(x):
    th = np.zeros(D); th[idx] = x[:len(idx)]; return th, x[len(idx)], x[len(idx) + 1]          # theta、整体俯仰、整体高度


def resid(x):
    th, pitch, tz = unpack(x); J, _ = skel.pose_joints(th, sk.euler_root(0.0, pitch, 0.0), np.array([0.0, 0.0, tz])); r = []
    z = lambda n, v, w=1.0: r.append(w * (J[k(n), 2] - v))
    for s, sx in (("Left", 1.0), ("Right", -1.0)):
        sh, hp = J[k(s + "FShoulder")], J[k(s + "HHip")]
        z(s + "FShoulder", 0.14, 3); z(s + "HHip", 0.13, 3)
        z(s + "FElbow", 0.050, 2); z(s + "FWrist", 0.040, 2); z(s + "FFetlock", 0.045, 2); z(s + "FToe", 0.017, 2)
        r.append(1.5 * (J[k(s + "FWrist"), 1] - (sh[1] - 0.19)))                     # 前腿向前伸
        r.append(1.0 * (J[k(s + "FToe"), 0] - sh[0]))                                # 爪在肩的正前方
        z(s + "HKnee", 0.060, 2); z(s + "HHock", 0.045, 2); z(s + "HAnkle", 0.036, 2); z(s + "HToeTip", 0.023, 2)
        r.append(1.5 * (J[k(s + "HKnee"), 1] - (hp[1] - 0.11)))                      # 膝在髋的前面
        r.append(1.0 * (J[k(s + "HToeTip"), 0] - (hp[0] + sx * 0.05)))               # 后爪略朝外
        r.append(1.5 * (J[k(s + "HToeTip"), 1] - (hp[1] - 0.15)))                    # 后爪在身下靠前的位置（跖骨是向前折的，不是向后伸）
    z("Nose", 0.06, 2); z("Head", 0.15, 1); z("Chin", 0.03, 1.5)
    r += list(0.03 * th[idx])                                                        # 能少转就少转
    return np.array(r)


x0 = np.zeros(len(idx) + 2)
if len(sys.argv) > 2: x0[:len(idx)] = np.load(sys.argv[2])["theta"][idx]
x0[:len(idx)] = np.clip(x0[:len(idx)], lo[idx] + 1e-3, hi[idx] - 1e-3); x0[-1] = -0.22
best = None
for trial in range(6):                                                                  # 换几个起点，取最好的
    rng = np.random.default_rng(trial); xs = x0.copy()
    if trial: xs[:len(idx)] = np.clip(xs[:len(idx)] + rng.normal(0, 0.5, len(idx)), lo[idx] + 1e-3, hi[idx] - 1e-3)
    res = least_squares(resid, xs, bounds=(np.r_[lo[idx], -0.35, -0.4], np.r_[hi[idx], 0.2, 0.1]), max_nfev=400)
    if best is None or res.cost < best.cost: best = res
th, pitch, tz = unpack(best.x); J, _ = skel.pose_joints(th, sk.euler_root(0.0, pitch, 0.0), np.array([0.0, 0.0, tz]))
np.savez(sys.argv[1], theta=th, ypr=np.array([0.0, pitch, 0.0]), t=np.array([0.0, 0.0, tz]))
print("残差 %.4f  整体俯仰 %.1f°  整体高度 %+.3f" % (best.cost, math.degrees(pitch), tz))
for i in idx:
    if abs(th[i]) > math.radians(3): print("  %-24s %+6.1f°  （范围 %+.0f ~ %+.0f）" % (skel.dof_names[i], math.degrees(th[i]), math.degrees(lo[i]), math.degrees(hi[i])))
for n in ("LeftFShoulder", "LeftFElbow", "LeftFWrist", "LeftFToe", "RightFElbow", "RightFWrist", "RightFToe", "LeftHHip", "LeftHKnee", "LeftHHock", "LeftHAnkle", "LeftHToeTip", "RightHKnee", "RightHHock", "RightHToeTip", "Head", "Nose", "Chin"):
    print("  %-14s (%+.3f, %+.3f, %.3f)" % (n, *J[k(n)]))
