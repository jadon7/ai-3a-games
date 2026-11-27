#!/usr/bin/env python3
"""把读出来的奔跑整理成一个干净的循环（给 motions.json 的 run 用）。

视频里它连着跑了六七步，每一步读出来都带着各自的噪声（腿快、有拖影），直接截一步出来，落地的爪子每帧往后走的距离忽大忽小，
游戏里身体是匀速走的，爪子就一下一下地蹭。这里按顺序做：
  1. 找出一步的准确周期（不一定是整数帧），把六七步按相位叠在一起，用傅里叶级数（前几个谐波）拟合每个自由度、整体朝向和位置：
     等于把几步平均成一步，噪声去掉了，首尾也天然接得上（不用再摊差别）。每只爪子在一步里的哪一段踩地，在这一步上定。
  2. 步幅整体收小（环境变量 RUN_SCALE，默认 0.75，见下面 SCALE 的注释）：每个通道“绕着平均值摆”的那部分乘这个系数，平均姿势不变。
  3. 调身体在一步里前后晃动的那一点量，让每只爪子踩地的那几帧尽量按同一个速度往后走（这个速度就是 runSpeed 的“原速”）；
     再调身体的高度，让踩地的爪子里最低的那只正好在地面上。
  4. 钉脚：踩地的那几帧，逐帧微调这条腿的几个关节（肩胛、肩、肘、腕、爪 / 髋、膝、飞节、爪），让爪尖严格按原速匀速后退、贴在地面上、
     爪子放平。踩地前后各留几帧过渡：水平先对上、高度后落（先抬）。
用法: V2R/.venv/bin/python fix_run.py [源=out/anim/wolf_run/motion_fix.npz] [输出=art/unit/wolf/retimed/run.npz]
输出是每秒 60 帧的一个周期（首尾两帧相同），motions.json 里用 "pick": [0, 末帧] 整段取。最后打印原速、每只爪子踩地时的速度偏差。"""
import math, sys, os
import numpy as np
from scipy.optimize import least_squares
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wolf_lib import skel, sk, V, load, rebuild, jk, dk, FEET, smoothstep  # noqa: E402

src = sys.argv[1] if len(sys.argv) > 1 else f"{V}/out/anim/wolf_run/motion_fix.npz"
dst = sys.argv[2] if len(sys.argv) > 2 else "/Users/jadon7/Documents/SynologyDrive/code/moba/art/unit/wolf/retimed/run.npz"
F0, F1, K, FPS_OUT = 20, 118, 5, 60
SCALE = float(os.environ.get("RUN_SCALE", "0.75"))      # 步幅收到几成。视频里是放开了跑的大步（原速折合游戏里 8 米/秒出头），游戏里它只跑 5.4，原样用就得放慢到六成多，像慢动作
FADE = 3                                               # 钉脚在踩地前后各留几帧过渡（每秒 60 帧）
theta, A, t, fps = load(src); T = len(theta)
NAMES = ["左前", "右前", "左后", "右后"]
LEG_DOFS = [["bone_4.fwd", "0_Left_Limb_0.fwd", "0_Left_Limb_1.pitch", "0_Left_Limb_2.pitch", "0_Left_Limb_3.pitch"],
            ["0_Right_Limb_0.fwd", "0_Right_Limb_1.fwd", "0_Right_Limb_2.pitch", "0_Right_Limb_3.pitch", "0_Right_Limb_4.pitch"],
            ["1_Left_Limb_0.fwd", "1_Left_Limb_1.pitch", "1_Left_Limb_2.pitch", "1_Left_Limb_3.pitch"],
            ["1_Right_Limb_0.fwd", "1_Right_Limb_1.pitch", "1_Right_Limb_2.pitch", "1_Right_Limb_3.pitch"]]
LEG_DOFS = [[dk(n) for n in leg] for leg in LEG_DOFS]
BASE = [jk(n) for n in ("LeftFFetlock", "RightFFetlock", "LeftHAnkle", "RightHAnkle")]          # 爪根：踩地时它也回到站着的高度，爪子就是平的


def rotvec(R):
    ang = math.acos(max(-1.0, min(1.0, (np.trace(R) - 1) / 2)))
    if ang < 1e-8: return np.zeros(3)
    return np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]]) / (2 * math.sin(ang)) * ang


# ---- 1) 几步叠成一步 ----
fr = np.arange(F0, F1 + 1)
Amean = A[fr].mean(0); U, _, Vt = np.linalg.svd(Amean); Amean = U @ Vt                      # 平均朝向（投回旋转矩阵）
rv = np.array([rotvec(Amean.T @ A[f]) for f in fr])
X = np.concatenate([theta[fr], rv, t[fr]], 1)                                                # 要拟合的所有通道
tt = (fr - fr.mean()) / (fr.max() - fr.min())


def design(P, frames):
    ph = 2 * np.pi * frames / P; cols = [np.ones_like(ph)]
    for k in range(1, K + 1): cols += [np.cos(k * ph), np.sin(k * ph)]
    return np.stack(cols, 1)


def fit(P):
    B = np.concatenate([design(P, fr.astype(float)), tt[:, None]], 1)                        # 多一列线性漂移（它在画面里慢慢挪位置），拟合完扔掉
    C, *_ = np.linalg.lstsq(B, X, rcond=None); return C, float(((B @ C - X) ** 2).sum())


cands = np.arange(12.0, 18.0, 0.01); errs = [fit(P)[1] for P in cands]; P = float(cands[int(np.argmin(errs))]); C, e = fit(P)
N = int(round(P / fps * FPS_OUT / 2)) * 2                                                    # 一个周期出多少帧（偶数：整理成每秒 30 帧时正好隔一帧取一帧）
dt = P / fps / N                                                                             # 输出相邻两帧隔多少秒
ph = np.arange(N + 1) / N * P; Y1 = design(P, ph) @ C[:-1]                                   # 不带漂移项


def unpack(Y):
    th = np.clip(Y[:, :skel.D], skel.dof_lo, skel.dof_hi); At = np.array([Amean @ sk.rotvec_to_mat(r) for r in Y[:, skel.D:skel.D + 3]]); tr = Y[:, skel.D + 3:].copy()
    tr[:, :2] -= tr[:-1, :2].mean(0); return th, At, tr


print("周期 %.2f 帧（%.3f 秒），拟合用第 %d 到 %d 帧（%.1f 步），残差均方根 %.4f；输出 %d 帧 @ %d；步幅收到 %.2f" % (P, P / fps, F0, F1, (F1 - F0) / P, math.sqrt(e / X.size), N + 1, FPS_OUT, SCALE))
# 每只爪子踩地的相位：在没收小的那一步上定（贴着地、而且在往后走的最长一段）
J1 = rebuild(*unpack(Y1))[2][:-1][:, FEET]; z1, y1 = J1[..., 2], J1[..., 1]; vy1 = (np.roll(y1, -1, 0) - np.roll(y1, 1, 0)) / (2 * dt)
on = np.zeros((N, 4), bool)
for c in range(4):
    raw = (z1[:, c] < z1[:, c].min() + 0.022) & (vy1[:, c] > 0.8); best, cur = [], []
    for i in list(range(N)) * 2 + [-1]:
        if i >= 0 and raw[i]: cur.append(i)
        else:
            if len(cur) > len(best): best = cur
            cur = []
    on[best[:N], c] = True
v1 = float(np.mean([vy1[on[:, c], c].mean() for c in range(4)]))

# ---- 2) 步幅收小 ----
th, At, tr = unpack(C[0][None] + SCALE * (Y1 - C[0][None]))

# ---- 3) 身体前后、高低 ----
J = rebuild(th, At, tr)[2]; y = J[:-1][:, FEET, 1]
rows, rhs = [], []                                                                           # 未知数：每帧身体前后的修正量 d[i]（周期的）和速度 v。每只爪子踩地的相邻两帧：(y[i+1]+d[i+1]) - (y[i]+d[i]) = v·dt
for c in range(4):
    for i in range(N):
        j = (i + 1) % N
        if on[i, c] and on[j, c]:
            r = np.zeros(N + 1); r[j] += 1; r[i] -= 1; r[N] = -dt; rows.append(r); rhs.append(-(y[j, c] - y[i, c]))
W_SMOOTH, W_SMALL = 0.5, 0.06
for i in range(N):                                                                            # 修正量要平滑、要小
    r = np.zeros(N + 1); r[i] = -2 * W_SMOOTH; r[(i + 1) % N] = W_SMOOTH; r[(i - 1) % N] = W_SMOOTH; rows.append(r); rhs.append(0.0)
    r = np.zeros(N + 1); r[i] = W_SMALL; rows.append(r); rhs.append(0.0)
sol, *_ = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None); d = sol[:N] - sol[:N].mean(); v = float(sol[N])
tr[:-1, 1] += d; tr[-1, 1] = tr[0, 1]
J = rebuild(th, At, tr)[2]; z = J[:-1][:, FEET, 2]; rest_z = skel.joint_rest[FEET, 2]
low = np.where(on, z - rest_z[None], 9.0).min(1); low_all = (z - rest_z[None]).min(1)
dz = np.where(on.any(1), -low, np.clip(-low_all, 0, None))                                    # 有爪子踩地：最低的那只正好在地面上；腾空：只保证不陷下去
ker = np.exp(-0.5 * (np.arange(-3, 4) / 1.2) ** 2); ker /= ker.sum(); dz = np.convolve(np.concatenate([dz[-3:], dz, dz[:3]]), ker, mode="valid")
tr[:-1, 2] += dz; tr[-1, 2] = tr[0, 2]

# ---- 4) 钉脚 ----
J = rebuild(th, At, tr)[2][:-1]; delta = np.zeros((N, skel.D)); worst = 0.0
for c in range(4):
    idx = np.where(on[:, c])[0]
    if (np.diff(idx) != 1).any():                                                            # 这一段跨过了周期的接缝：按时间顺序排好
        cut = np.where(np.diff(idx) != 1)[0][0] + 1; idx = np.r_[idx[cut:], idx[:cut]]
    mid = len(idx) // 2; toe, base, dofs = FEET[c], BASE[c], LEG_DOFS[c]
    y_mid, x_mid = J[idx[mid], toe, 1], float(np.mean(J[idx, toe, 0])); x0 = np.zeros(len(dofs)); sols = []
    for n_, i in enumerate(idx):
        target = np.array([x_mid, y_mid + v * (n_ - mid) * dt, skel.joint_rest[toe, 2]])

        def res(x, i=i, target=target):
            thi = th[i].copy(); thi[dofs] += x; Ji, _ = skel.pose_joints(thi, At[i], tr[i])
            return np.r_[10 * (Ji[toe] - target) * np.array([0.3, 1, 1]), 4 * (Ji[base, 2] - skel.joint_rest[base, 2]), 0.15 * x]
        s_ = least_squares(res, x0, bounds=(skel.dof_lo[dofs] - th[i][dofs] - 1e-6, skel.dof_hi[dofs] - th[i][dofs] + 1e-6), max_nfev=60); x0 = np.clip(s_.x, skel.dof_lo[dofs] - th[i][dofs], skel.dof_hi[dofs] - th[i][dofs]); sols.append(s_.x)
        delta[i, dofs] = s_.x; worst = max(worst, float(np.abs(np.degrees(s_.x)).max()))
    # 踩地前后各 FADE 帧的过渡：水平方向先对上（落地前一帧爪尖已经在按原速往后走的那条线上了，离地后一帧也还在线上），高度后落、先抬。
    # 原来是把修正的角度直接淡入淡出，落地前一两帧爪尖已经贴到地面了、水平速度却还没对上，每步要蹭三五厘米。
    WH, WZ = [1.0, 0.75, 0.35], [0.5, 0.2, 0.05]                                              # 第 1、2、3 帧：水平、高度各靠过去几成
    for sgn, edge, x_edge in ((-1, 0, sols[0]), (1, len(idx) - 1, sols[-1])):
        x0 = x_edge.copy()
        for k_ in range(1, FADE + 1):
            i = (idx[edge] + sgn * k_) % N; o = J[i, toe]; wh, wz = WH[k_ - 1], WZ[k_ - 1]
            line = np.array([x_mid, y_mid + v * (edge + sgn * k_ - mid) * dt, skel.joint_rest[toe, 2]])
            target = np.array([wh * line[0] + (1 - wh) * o[0], wh * line[1] + (1 - wh) * o[1], max(wz * line[2] + (1 - wz) * o[2], line[2] + 0.007 * k_)])

            def res2(x, i=i, target=target):
                thi = th[i].copy(); thi[dofs] += x; Ji, _ = skel.pose_joints(thi, At[i], tr[i])
                return np.r_[10 * (Ji[toe] - target) * np.array([0.3, 1, 1]), 0.15 * x]
            s_ = least_squares(res2, x0, bounds=(skel.dof_lo[dofs] - th[i][dofs] - 1e-6, skel.dof_hi[dofs] - th[i][dofs] + 1e-6), max_nfev=60); x0 = np.clip(s_.x, skel.dof_lo[dofs] - th[i][dofs], skel.dof_hi[dofs] - th[i][dofs])
            delta[i, dofs] = s_.x; worst = max(worst, float(np.abs(np.degrees(s_.x)).max()))
th[:-1] = np.clip(th[:-1] + delta, skel.dof_lo, skel.dof_hi); th[-1], At[-1], tr[-1] = th[0], At[0], tr[0]

quats, loc, J = rebuild(th, At, tr)
os.makedirs(os.path.dirname(dst), exist_ok=True)
np.savez(dst, quats=quats, loc=loc, fps=FPS_OUT, joints=J, theta=th, t=tr)
foot = J[:-1][:, FEET]; yv = (np.roll(foot[..., 1], -1, 0) - foot[..., 1]) / dt
vp = v * dt * FPS_OUT                                                                         # 输出按整 60 帧每秒播，一步的时长和视频里的差一点点，原速按播出来的算
print("原速 %.3f 身长/秒（按成品播放的速度算；折合游戏里 %.2f 米/秒，按总高 1.45 米、模型高 %.4f）" % (vp, vp * 1.45 / skel.joint_rest[:, 2].max() if False else vp * 1.45 / 0.5554, 0.5554))
print("  （视频时间里是 %.3f 身长/秒，步幅收小之前是 %.3f）；身体前后的修正量最大 %.3f 身长，高度修正最大 %.3f；钉脚时关节最多改了 %.1f 度" % (v, v1, np.abs(d).max(), np.abs(dz).max(), worst))
for c in range(4):
    idx = np.where(on[:, c] & np.roll(on[:, c], -1))[0]
    print("  %s爪: 踩地 %2d 帧（占 %2.0f%%），踩地时往后走的速度 %.2f ± %.2f（最慢 %.2f 最快 %.2f），和匀速相比最多差 %.4f 身长；踩地时高度 %.3f~%.3f，抬起最高 %.3f，前后摆幅 %.2f"
          % (NAMES[c], on[:, c].sum(), on[:, c].mean() * 100, yv[idx, c].mean(), yv[idx, c].std(), yv[idx, c].min(), yv[idx, c].max(), np.abs(np.cumsum((yv[idx, c] - v) * dt)).max(),
             foot[on[:, c], c, 2].min(), foot[on[:, c], c, 2].max(), foot[:, c, 2].max(), foot[:, c, 1].max() - foot[:, c, 1].min()))
print("  腾空（四只爪子都不着地）%d 帧；爪子最低 %.3f；根的高度 %.3f~%.3f；写好了 %s" % ((~on.any(1)).sum(), foot[..., 2].min(), J[:, jk("Root"), 2].min(), J[:, jk("Root"), 2].max(), dst))
