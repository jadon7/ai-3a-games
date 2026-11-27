#!/usr/bin/env python3
"""把 gait.py 叠出来的那个步态周期（视频里是“跑步机上大步快跑”）改成游戏里用的沉重快走：脚踩实、不打滑、移速正好对上。

视频里的步子太大（后脚蹬到身后半个身长，按原速对应每秒六七米），巨蟾在游戏里每秒 3.6 米；直接放慢像慢动作，在关节角度上按比例缩又会把
“脚贴着地往后蹬”的那一段缩成一条弧线、只点一下地。所以改在“脚的位置”上做：
  1. 四只脚各自的轨迹（脚尖的标记点，世界坐标）从视频的周期里取：哪几帧着地（最低的那一段，占周期的 duty）、迈步时前后怎么走、抬多高。
  2. 着地的那一段改成严格匀速往后（速度 v = 游戏移速 ÷ 放大倍数），脚的高度就是站立高度，左右不动；迈步的那一段沿用视频里的曲线形状
     （前后按着地段的首尾对齐，抬脚高度乘 lift）。脚的落点以静止站姿的脚位为中心。
  3. 用正向运动学反解腿的角度（每条腿 5 个自由度）去够这些脚位，同时尽量贴近视频里的腿型（按 style 缩小后的角度），周期首尾相接、相邻帧平滑、
     不超活动范围、腕和踝不入地。身体的高度一起解（腿够不着就自己降一点）。
  4. 身体的左右摇摆、朝向、侧倾、俯仰和头的动作沿用 gait.py 叠出来的（sway、pitch 可以再乘个系数）。
用法: V2R/.venv/bin/python gait_walk.py <gait.py 的输出.npz> <输出.npz> [v=0.917] [duty=0.5] [lift=0.45] [cycle=秒，默认不变] [style=0.6] [sway=1] [pitch=0.6] [hindy=0 后脚落点整体后移多少]
输出: 一个周期（首尾相同），每秒 24 帧，字段和管线的 motion.npz 一样。
"""
import math, os, sys
import numpy as np
import torch
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from toadlib import skel, sk, J, D, leg_dofs, LEG_JOINTS, quat_mat  # noqa: E402
from v2r import solver as so  # noqa: E402

src, dst = sys.argv[1:3]; opt = dict(a.split("=") for a in sys.argv[3:])
v = float(opt.get("v", 0.917)); duty = float(opt.get("duty", 0.5)); lift = float(opt.get("lift", 0.45)); style = float(opt.get("style", 0.6)); sway = float(opt.get("sway", 1)); kp = float(opt.get("pitch", 0.6)); hindy = float(opt.get("hindy", 0))
m = np.load(src, allow_pickle=True); th0, t0, q0, fps = m["theta"][:-1].astype(float), m["t"][:-1].astype(float), m["quats"][:-1].astype(float), int(m["fps"]); M0 = len(th0)
Rr = skel.R[skel.root]; A0 = np.array([Rr @ quat_mat(q0[f, skel.root]) @ Rr.T for f in range(M0)])
ypr0 = np.stack([np.arctan2(-A0[:, 0, 1], A0[:, 1, 1]), np.arcsin(np.clip(A0[:, 2, 1], -1, 1)), np.arctan2(-A0[:, 2, 0], A0[:, 2, 2])], 1)
M = int(round(float(opt["cycle"]) * fps)) if "cycle" in opt else M0


def resamp(x):
    s = np.arange(M) * M0 / M; i0 = np.floor(s).astype(int); f = (s - i0).reshape(-1, *[1] * (x.ndim - 1)); return x[i0 % M0] * (1 - f) + x[(i0 + 1) % M0] * f


def csmooth(x, sigma=0.8):
    r = 3; k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum(); return sum(k[i + r] * np.roll(x, -i, axis=0) for i in range(-r, r + 1))


th_v, t_v, ypr_v = resamp(th0), resamp(t0), resamp(ypr0)
Jv = np.zeros((M, skel.K, 3))
for f in range(M): Jv[f], _ = skel.pose_joints(th_v[f], sk.euler_root(*ypr_v[f]), t_v[f])
rest = skel.joint_rest; dt = 1.0 / fps
toe_t = {}; end_t = {}; stance = {}; info = []
for leg, names in LEG_JOINTS.items():
    je, jt = J[names[2]], J[names[3]]; p = Jv[:, jt]; zrel = p[:, 2] - p[:, 2].min(); ns = int(round(duty * M))
    s0 = int(np.argmin([sum(zrel[(s + k) % M] for k in range(ns)) for s in range(M)])); st = np.array([(s0 + k) % M for k in range(ns)]); sw = np.array([(s0 + ns + k) % M for k in range(M - ns)])
    mask = np.zeros(M, bool); mask[st] = True; stance[leg] = mask
    yc = rest[jt, 1] + (hindy if leg in ("LH", "RH") else 0.0); half = v * (ns - 1) * dt / 2
    y = np.zeros(M); y[st] = yc + v * (np.arange(ns) - (ns - 1) / 2) * dt                    # 着地：匀速往后（+Y 是身后）
    ya, yb = p[st[-1], 1], p[st[0], 1]                                                       # 视频里着地段结束 / 开始时脚的前后位置
    u = (p[sw, 1] - ya) / (yb - ya) if abs(yb - ya) > 1e-4 else np.linspace(0, 1, len(sw))   # 迈步：视频里的曲线形状，首尾对齐到着地段的两头
    lin = (np.arange(1, len(sw) + 1)) / (len(sw) + 1); u = 0.5 * u + 0.5 * lin              # 掺一半匀速，免得视频里脚在空中停顿或者回摆过头
    y[sw] = (yc + half) + u * (-2 * half - v * dt)                                           # 从着地段的最后一帧走回第一帧的前一步
    z = np.full(M, rest[jt, 2]); base = zrel[st].max(); zs = np.clip(zrel[sw] - base, 0, None)
    bump = np.sin(np.pi * lin) ** 0.8 * max(zs.max(), 0.05)                                  # 视频里抬脚不明显的话也保证有个拱形
    z[sw] += lift * (0.5 * zs + 0.5 * bump)
    x = np.full(M, rest[jt, 0]); xm = p[st, 0].mean(); x[sw] += 0.5 * (p[sw, 0] - xm) * np.sin(np.pi * lin)      # 迈步时脚往外甩一点（留一半）
    tt = np.stack([x, y, z], 1); ys = csmooth(tt, 0.6); tt[sw] = ys[sw]; toe_t[leg] = tt     # 只磨圆迈步的那段，着地段保持严格匀速
    end_t[leg] = tt + (rest[je] - rest[jt])
    info.append(f"{leg} 着地 {ns}/{M} 帧（第 {st[0]} 帧起）步长 {2 * half + v * dt:.2f} 抬脚 {tt[:, 2].max() - rest[jt, 2]:.2f}")
print("  " + "；".join(info))
# 身体：摇摆沿用视频，俯仰乘 kp；高度让求解自己定
ypr = ypr_v * np.array([sway, kp, sway]); tx = t_v[:, 0] * sway
ts = so.TorchSkeleton(skel); f32 = lambda a: torch.tensor(np.asarray(a), dtype=torch.float32)  # noqa: E731
A_t = f32(np.array([sk.euler_root(*ypr[f]) for f in range(M)]))
legs_idx = sum((leg_dofs(l) for l in LEG_JOINTS), []); other = [k for k in range(skel.D) if k not in legs_idx]
th_reg = th_v.copy(); th_reg[:, legs_idx] *= style
theta = f32(th_reg).clone().requires_grad_(True); tz = torch.zeros(M, requires_grad=True)
toe_idx = [J[LEG_JOINTS[l][3]] for l in LEG_JOINTS]; end_idx = [J[LEG_JOINTS[l][2]] for l in LEG_JOINTS]
toe_T = f32(np.stack([toe_t[l] for l in LEG_JOINTS], 1)); end_T = f32(np.stack([end_t[l] for l in LEG_JOINTS], 1)); st_T = f32(np.stack([stance[l] for l in LEG_JOINTS], 1).astype(float))
gi = [J[n] for n in skel.ground_joints]; zfl = f32(rest[gi, 2] - 0.004); reg_T = f32(th_reg); fixed = torch.zeros(skel.D, dtype=torch.bool); fixed[other] = True
opt_ = torch.optim.Adam([theta, tz], lr=0.02); iters = 1500
for it in range(iters):
    th = torch.where(fixed[None], reg_T, theta); t = torch.stack([f32(tx), torch.zeros(M), tz], 1)
    P, G, _ = ts.fk(th, A_t, t); Pj = ts.joints(P, G)
    l_toe = ((Pj[:, toe_idx] - toe_T) ** 2).sum(-1); l_end = ((Pj[:, end_idx] - end_T) ** 2).sum(-1) * st_T
    l_fit = (l_toe * (1 + 3 * st_T)).mean() + l_end.mean()                                   # 着地的那几帧压得更紧
    d2 = torch.roll(th, -1, 0) - 2 * th + torch.roll(th, 1, 0); dz = torch.roll(tz, -1, 0) - 2 * tz + torch.roll(tz, 1, 0)
    loss = l_fit + 2e-4 * ((th - reg_T) ** 2).mean() + 3e-3 * (d2 ** 2).mean() + 0.5 * (dz ** 2).mean() + 1e-3 * (tz ** 2).mean() \
        + 2.0 * (torch.relu(th - ts.hi) ** 2 + torch.relu(ts.lo - th) ** 2).mean() + 5.0 * (torch.relu(zfl - Pj[:, gi, 2]) ** 2).mean()
    opt_.zero_grad(); loss.backward(); opt_.step()
    if it == iters // 2:
        for g in opt_.param_groups: g["lr"] = 0.006
with torch.no_grad():
    th = torch.minimum(torch.maximum(torch.where(fixed[None], reg_T, theta), ts.lo), ts.hi); t = torch.stack([f32(tx), torch.zeros(M), tz], 1); P, G, Q = ts.fk(th, A_t, t); Pj = ts.joints(P, G)
th_c, t_c, Jc, Qn = th.numpy().astype(float), t.numpy().astype(float), Pj.numpy().astype(float), Q.numpy().astype(float)
err = np.linalg.norm(Jc[:, toe_idx] - toe_T.numpy(), axis=-1); stm = st_T.numpy() > 0.5
print(f"  脚位偏差：着地帧平均 {err[stm].mean():.4f} 最大 {err[stm].max():.4f}；迈步帧平均 {err[~stm].mean():.4f} 最大 {err[~stm].max():.4f}；根高 {Jc[:, J['Root'], 2].min():.3f}~{Jc[:, J['Root'], 2].max():.3f}（静止 {rest[J['Root'], 2]:.3f}）肚皮最低 {Jc[:, J['Belly'], 2].min():.3f}")
# 着地帧里脚尖在世界里实际走得多快（应该就是 v）
rep = []
for k, l in enumerate(LEG_JOINTS):
    y = Jc[:, toe_idx[k], 1]; vy = (np.roll(y, -1) - y) * fps; inner = stm[:, k] & np.roll(stm[:, k], -1); rep.append(f"{l} {vy[inner].mean():.3f}±{vy[inner].std():.3f}")
print("  着地脚往后蹬的速度（应为 %.3f）: " % v + "  ".join(rep))
quats = np.array([[sk.mat_to_quat(Qn[f, i]) for i in range(skel.n)] for f in range(M)])
quats, th_c, t_c, Jc = (np.concatenate([x, x[:1]]) for x in (quats, th_c, t_c, Jc))
for f in range(1, M + 1):
    flip = np.sum(quats[f] * quats[f - 1], -1) < 0; quats[f][flip] *= -1
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
np.savez(dst, quats=quats, loc=(Rr.T @ t_c.T).T / skel.scale, fps=fps, joints=Jc, theta=th_c, t=t_c)
print(f"写好了 {dst}：一个周期 {M} 帧（{M / fps:.2f} 秒），着地速度 {v} 单位/秒（游戏里身高 2.3 时是 {v * 2.3 / 0.586:.2f} 米/秒）")
