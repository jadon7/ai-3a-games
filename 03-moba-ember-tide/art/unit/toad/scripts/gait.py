#!/usr/bin/env python3
"""把读出来的一段原地行走整理成“一个干净的步态周期”。

为什么要做：巨蟾又宽又扁，左边两条腿在侧面机位里被身体挡住，读数是网络猜的，一步一个样；走路又是每 16 帧左右重复一次的周期动作，
视频里五六个周期各有各的小毛病。做法：
  1. 从右腿（侧面机位看得清）和身体的起伏里量出周期 P（可以不是整数帧）。
  2. 把整段里所有周期按相位叠在一起取平均，得到一个周期的曲线（去掉每一步各自的抖动）。
  3. 左右对称：左腿 = 右腿差半个周期的镜像（mix=1 完全用右腿的镜像；mix=0.5 是左右各自的曲线对半掺；mix=0 不动左腿）。
     右腿也同样往“左腿的镜像”掺 (1-mix) 的一半……为了简单，mix<1 时只动左腿。
  4. 身体的左右摇摆（朝向、侧倾、横移）取“差半个周期正好反号”的那部分，前后俯仰和上下起伏取“差半个周期相同”的那部分：左右两步完全对称。
  5. 步幅（ampf / amph）：视频里是“跑步机上大步快跑”，腿甩得很开（大腿前后各四十多度、后腿蹬到身后半个身长），按原速对应每秒六七米；
     巨蟾在游戏里每秒 3.6 米，照原样放慢到六成会像慢动作。所以把每条腿各自由度“偏离周期平均值的部分”按比例缩小（前腿 ampf、后腿 amph，
     两个数分开是因为读出来后腿落地时蹬得比前腿快四成，缩得不一样多，前后脚才能对上同一个移速），平均姿势往静止站姿靠 rest 成。
     缩完以后每一帧都把整体高度调到“最低的那只脚正好着地”（不留腾空），再把这条高度曲线磨圆。
用法: V2R/.venv/bin/python gait.py <源 motion.npz> <输出.npz> [from=起始帧] [to=结束帧] [mix=1] [period=帧数（不给就自己量）] [sway=1 身体摇摆留几成] [ampf=1] [amph=1] [rest=0] [bob=1 身体上下起伏留几成]
输出: 一个周期（首尾相同），每秒 24 帧，字段和管线的 motion.npz 一样；motions.json 里用 "pick": [0, 末帧] 当循环。
"""
import math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from toadlib import skel, sk, J, D, leg_dofs, MIRROR_SIGN, PAIRS, quat_mat  # noqa: E402

src, dst = sys.argv[1:3]; opt = dict(a.split("=") for a in sys.argv[3:])
m = np.load(src, allow_pickle=True); th, t, q, fps = m["theta"].astype(float), m["t"].astype(float), m["quats"].astype(float), int(m["fps"])
T = len(th); a = int(opt.get("from", 8)); b = int(opt.get("to", T - 1)); mix = float(opt.get("mix", 1)); sway = float(opt.get("sway", 1))
Rr = skel.R[skel.root]; A = np.array([Rr @ quat_mat(q[f, skel.root]) @ Rr.T for f in range(T)])
ypr = np.stack([np.arctan2(-A[:, 0, 1], A[:, 1, 1]), np.arcsin(np.clip(A[:, 2, 1], -1, 1)), np.arctan2(-A[:, 2, 0], A[:, 2, 2])], 1)      # A = Rz(yaw)·Rx(pitch)·Ry(roll)
idx = np.arange(a, b + 1); n = len(idx)
# 1) 周期：右腿各自由度 + 根的高度，去均值后做自相关
sig = np.concatenate([th[idx][:, leg_dofs("RF") + leg_dofs("RH")], 20 * t[idx, 2:3]], 1); sig = sig - sig.mean(0)
if "period" in opt: P = float(opt["period"])
else:
    best = (-1, 0)
    for lag10 in range(80, 400):                                              # 8 到 40 帧，步长 0.1 帧
        lag = lag10 / 10; x = idx[idx + lag <= b]; y = x + lag; i0 = np.floor(y).astype(int); f = (y - i0)[:, None]
        s2 = th[np.minimum(i0, T - 1)][:, leg_dofs("RF") + leg_dofs("RH")] * (1 - f) + th[np.minimum(i0 + 1, T - 1)][:, leg_dofs("RF") + leg_dofs("RH")] * f
        s1 = th[x][:, leg_dofs("RF") + leg_dofs("RH")]; s1 = s1 - s1.mean(0); s2 = s2 - s2.mean(0)
        c = float((s1 * s2).sum() / (np.sqrt((s1 ** 2).sum() * (s2 ** 2).sum()) + 1e-9))
        if c > best[0] + 0.02 or (c > best[0] and lag < best[1] * 1.3): best = (c, lag)      # 取第一个高峰（不是两倍周期）
    P = best[1]; print(f"量出来的周期 {P:.1f} 帧（{P / fps:.2f} 秒），相关 {best[0]:.2f}")
M = int(round(P)); ph = ((idx - a) / P) % 1.0                                 # 每帧的相位
grid = np.arange(M) / M


def fold(x, sigma=0.5):
    """x (n,…) 按相位叠起来，在 M 个相位点上取加权平均（相位上的高斯核，宽 sigma 个格子）"""
    out = np.zeros((M,) + x.shape[1:])
    for k, g in enumerate(grid):
        d = np.abs(ph - g); d = np.minimum(d, 1 - d) * M; w = np.exp(-0.5 * (d / sigma) ** 2); out[k] = (w.reshape(-1, *[1] * (x.ndim - 1)) * x).sum(0) / w.sum()
    return out


def shift(x, frac=0.5):
    """周期曲线沿相位平移 frac 个周期（线性插值）"""
    s = (np.arange(M) - frac * M) % M; i0 = np.floor(s).astype(int); f = (s - i0).reshape(-1, *[1] * (x.ndim - 1)); return x[i0 % M] * (1 - f) + x[(i0 + 1) % M] * f


th_c = fold(th[idx]); ypr_c = fold(ypr[idx] - np.array([np.polyval(np.polyfit(idx, ypr[idx, 0], 1), idx), 0 * idx, 0 * idx]).T * np.array([1, 0, 0]))      # 朝向去掉慢慢转走的漂移
t_d = t[idx].copy()
for c in range(2): t_d[:, c] -= np.polyval(np.polyfit(idx, t_d[:, c], 1), idx)   # 水平位置去掉漂移
t_c = fold(t_d)
# 3) 左腿 = 右腿差半个周期的镜像
for la, lb in PAIRS:
    ia, ib = leg_dofs(la), leg_dofs(lb); mir = MIRROR_SIGN * shift(th_c[:, ib]); th_c[:, ia] = (1 - mix) * th_c[:, ia] + mix * mir
# 5) 步幅：每条腿偏离周期平均值的部分缩小，平均姿势往静止站姿靠
ampf, amph, rest_k = float(opt.get("ampf", 1)), float(opt.get("amph", 1)), float(opt.get("rest", 0))
for leg, amp in (("LF", ampf), ("RF", ampf), ("LH", amph), ("RH", amph)):
    ia = leg_dofs(leg); mean = th_c[:, ia].mean(0); th_c[:, ia] = mean * (1 - rest_k) + (th_c[:, ia] - mean) * amp
# 头：左右转取反对称的部分
for nm, sgn in (("bone_36.yaw", -1), ("bone_36.twist", -1), ("bone_36.pitch", 1)):
    k = D[nm]; th_c[:, k] = (th_c[:, k] + sgn * shift(th_c[:, k])) / 2
# 4) 身体：摇摆反对称，俯仰和起伏对称
anti = lambda x: (x - shift(x)) / 2; symm = lambda x: (x + shift(x)) / 2      # noqa: E731
ypr_c = np.stack([anti(ypr_c[:, 0]) * sway, symm(ypr_c[:, 1]), anti(ypr_c[:, 2]) * sway], 1)
bob = float(opt.get("bob", 1)); tz = symm(t_c[:, 2])
t_c = np.stack([anti(t_c[:, 0]) * sway, symm(t_c[:, 1]) - symm(t_c[:, 1]).mean(), tz.mean() + (tz - tz.mean()) * bob], 1)
# 每一帧都让最低的脚正好着地（缩了步幅以后原来的高度不再对得上），高度曲线沿周期磨圆
gi = [J[n_] for n_ in skel.ground_joints]
if ampf != 1 or amph != 1 or rest_k != 0:
    low = np.zeros(M)
    for f in range(M):
        Af = sk.euler_root(*ypr_c[f]); jf, _ = skel.pose_joints(np.clip(th_c[f], skel.dof_lo, skel.dof_hi), Af, t_c[f]); low[f] = np.min(jf[gi, 2] - skel.joint_rest[gi, 2])
    k = np.exp(-0.5 * (np.arange(-3, 4) / 1.2) ** 2); k /= k.sum(); low_s = sum(k[i + 3] * np.roll(low, -i) for i in range(-3, 4))
    t_c[:, 2] -= low_s
# 首尾相同
th_c, ypr_c, t_c = (np.concatenate([x, x[:1]]) for x in (th_c, ypr_c, t_c)); N = M + 1
quats = np.zeros((N, skel.n, 4)); joints = np.zeros((N, skel.K, 3))
for f in range(N):
    Af = sk.euler_root(*ypr_c[f]); Q = skel.local_rotations(np.clip(th_c[f], skel.dof_lo, skel.dof_hi), Af); Pp, G = skel.fk(Q, t_c[f]); joints[f] = skel.joint_positions(Pp, G)
    quats[f] = np.array([sk.mat_to_quat(Q[i]) for i in range(skel.n)])
for f in range(1, N):
    flip = np.sum(quats[f] * quats[f - 1], -1) < 0; quats[f][flip] *= -1
# 贴地：整个周期里最低的脚正好在站立高度（平均后的曲线可能整体高了或低了一点）
lift = float(np.min(joints[:, gi, 2] - skel.joint_rest[gi, 2])); t_c[:, 2] -= lift; joints[:, :, 2] -= lift
# 量一下：每只脚着地（离站立高度 <0.015）的那几帧里，脚尖相对身体往后蹬得多快（摆正后的单位每秒）——这就是不打滑时对应的移速
root_j = joints[:, J[skel.root_joint]]; rep = []
for nm in ("LeftFToe", "RightFToe", "LeftHToe", "RightHToe"):
    y = joints[:-1, J[nm], 1] - root_j[:-1, 1]; z = joints[:-1, J[nm], 2] - skel.joint_rest[J[nm], 2]; vy = (np.roll(y, -1) - np.roll(y, 1)) / 2 * fps; on = z < 0.015
    rep.append(f"{nm} 着地 {int(on.sum())}/{M} 帧 后蹬 {vy[on].mean() if on.any() else float('nan'):.2f} 摆幅 {y.max() - y.min():.2f} 抬脚 {z.max():.2f}")
print("  " + "；".join(rep)); print(f"  根高 {root_j[:, 2].min():.3f}~{root_j[:, 2].max():.3f}（静止 {skel.joint_rest[J[skel.root_joint], 2]:.3f}），左右晃 ±{np.abs(root_j[:, 0]).max():.3f}，每帧最低的脚离地 {np.min(joints[:-1][:, gi, 2] - skel.joint_rest[gi, 2], axis=1).max():.3f} 以内")
loc = (Rr.T @ t_c.T).T / skel.scale
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
np.savez(dst, quats=quats, loc=loc, fps=fps, joints=joints, theta=th_c, t=t_c)
print(f"写好了 {dst}：第 {a} 到 {b} 帧（{n / P:.1f} 个周期）叠成 1 个周期 {M} 帧（{M / fps:.2f} 秒），左腿用右腿镜像的比例 {mix}，整体高度修正 {-lift:+.3f}")
