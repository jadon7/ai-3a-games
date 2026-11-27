#!/usr/bin/env python3
"""走路循环：让踩在地上的那只脚匀速往后走（游戏里身体匀速前进，脚掌在地上的速度不匀就是打滑）。

视频是“原地走”，两只脚贴地时往后的速度并不一样（左脚 3.6、右脚 3.9 米/秒，按 6 米身高算），一步之内也忽快忽慢，偏离匀速最多 8 厘米。
这里不动腿的姿势，只把整个身体前后挪一点：脚掌贴地的那些帧，身体挪的速度正好补上“脚的速度和匀速之间的差”；
换脚的那几帧（一只脚尖还没离地、另一只脚跟刚着地）在两头之间线性过渡。匀速的那个速度取成一圈下来身体不前不后（循环接得上）的值，它就是 runSpeed。

用法: V2R/.venv/bin/python footlock.py <源 motion.npz> <输出 motion.npz> <循环起始帧> <循环结束帧> [游戏里的身高=6]
只改循环这一段帧的前后位置（胯和所有关节一起挪），别的不动。之后 motions.json 里 run 用 "pick": [起, 止] 钉住同一段。
"""
import json, os, sys
import numpy as np

src, dst, s, e = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]); H = float(sys.argv[5]) if len(sys.argv) > 5 else 6.0
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; jn = [j["name"] for j in json.load(open(V + "/assets/model/troll_skeleton.json"))["joints"]]
m = np.load(src, allow_pickle=True); q, t, J, th, fps = m["quats"].astype(float), m["t"].astype(float).copy(), m["joints"].astype(float).copy(), m["theta"].astype(float), int(m["fps"])
N = e - s; fr = np.arange(s, e)                                                # 循环里不重复的帧（第 e 帧和第 s 帧是同一个姿势）
k = np.exp(-0.5 * (np.arange(-4, 5) / 1.2) ** 2); k /= k.sum()


def csmooth(a): return np.convolve(np.concatenate([a[-4:], a, a[:4]]), k, mode="valid")      # 绕着循环平滑


# 先把这一圈在时间上磨一下（绕着循环）：即梦的视频是“两帧一顿”的（相邻两帧一帧动得多、一帧几乎不动），读出来脚掌逐帧的位移忽大忽小，落地脚看着发颤。
# 标准差 0.8 帧的高斯正好把这种两帧一个来回的抖动抹掉，对动作本身的快慢几乎没影响。
k2 = np.exp(-0.5 * (np.arange(-3, 4) / 0.8) ** 2); k2 /= k2.sum()
def cs2(a): return sum(w * np.roll(a, 3 - i, axis=0) for i, w in enumerate(k2))
qq = q[fr].copy()
for i in range(1, N): flip = np.sum(qq[i] * qq[i - 1], -1) < 0; qq[i][flip] *= -1
wrap = np.sum(qq[0] * qq[-1], -1) < 0                                          # 绕回来的地方符号可能相反：这些骨骼不能直接绕着平均，改成两头垫上再平均
qs = cs2(qq); pad = np.concatenate([np.repeat(qq[:1], 3, 0), qq, np.repeat(qq[-1:], 3, 0)]); qs_pad = sum(w * pad[i:i + N] for i, w in enumerate(k2)); qs[:, wrap] = qs_pad[:, wrap]
q[fr] = qs / np.linalg.norm(qs, axis=-1, keepdims=True); q[e] = q[s] if not wrap.any() else q[e]
t[fr] = cs2(t[fr]); J[fr] = cs2(J[fr]); t[e] = t[s]; J[e] = J[s]
a = np.full(N, np.nan); info = []
for n in ("LeftToeBase", "RightToeBase"):
    i = jn.index(n); z = J[fr, i, 2]; f = -J[fr, i, 1]                                                                  # 脚掌的前后位置，往前为正
    fs = csmooth(f); u = (np.roll(fs, -1) - np.roll(fs, 1)) * fps / 2                                                    # 脚掌往前的速度（平滑过的，绕循环）
    on = z < z.min() + 0.008; a[on] = -u[on]; info.append((n, on, f))
idx = np.where(~np.isnan(a))[0]; assert len(idx) > 6, "没找到脚掌贴地的帧"
ext = np.concatenate([idx - N, idx, idx + N]); a_i = np.interp(np.arange(N), ext, np.tile(a[idx], 3))                         # 换脚的那几帧线性过渡（绕循环）
v = float(a_i.mean()); c = (a_i - v) / fps                                                                                   # 每帧身体往前多挪多少：一圈加起来是 0
d = np.concatenate([[0], np.cumsum(c)]); d -= d[:-1].mean()                                                                # 第 s..e 帧各挪多少（首尾相等）
for n, on, f in info:
    f2 = f + d[:-1]; tt = np.where(on)[0]; runs = np.split(tt, np.where(np.diff(tt) > 1)[0] + 1)
    if len(runs) > 1 and runs[0][0] == 0 and runs[-1][-1] == N - 1: runs = [np.concatenate([runs[-1] - N, runs[0]])] + runs[1:-1]
    for r in runs:
        if len(r) < 4: continue
        g = lambda arr: np.array([arr[i % N] for i in r])  # noqa: E731
        res0 = g(f) - np.polyval(np.polyfit(r / fps, g(f), 1), r / fps); res1 = g(f2) + v * (r / fps); res1 -= res1.mean()
        print(f"  {n} 贴地 帧 {r[0] + s}~{r[-1] + s}：原来往后 {-np.polyfit(r / fps, g(f), 1)[0] * H:.2f} 米/秒、偏离匀速最多 {np.abs(res0).max() * H * 100:.1f} 厘米 → 按 {v * H:.2f} 米/秒算偏离最多 {np.abs(res1).max() * H * 100:.1f} 厘米")
t[s:e + 1, 1] -= d; J[s:e + 1, :, 1] -= d[:, None]
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
R = np.linalg.lstsq(m["t"].astype(float), m["loc"].astype(float), rcond=None)[0]
np.savez(dst, quats=q, loc=t @ R, fps=fps, joints=J, theta=th, t=t)
print(f"钉脚好了 {dst}：第 {s} 到 {e} 帧，身体前后最多挪了 {np.abs(d).max() * H * 100:.1f} 厘米；落地脚匀速 {v:.3f} 身高/秒 = {v * H:.2f} 米/秒（runSpeed 填这个）")
