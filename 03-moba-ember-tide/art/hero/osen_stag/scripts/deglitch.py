#!/usr/bin/env python3
"""去掉解算结果里“只跳一两帧”的毛刺。
读关节的网络偶尔会在某一帧把左右腿认反（正面机位里两条后腿挨得近），求解出来就是某根骨头突然甩出去一帧又回来，
游戏里看是腿抽一下。这里逐根骨头找这种尖刺（前一帧到这一帧、这一帧到后一帧都转了很多，但前后两帧之间几乎没变），
用前后帧的插值换掉；根的位移同样处理；最后按修好的旋转重新算一遍各跟踪点的位置。
只修“单独一帧”的尖刺（默认）。连着两帧的也能修（第 4 个参数给 2），但快动作里真实的动作峰值也就两帧宽（奔跑时收腿、人立时刨蹄），会被一起抹平，所以默认不开。
用法: python deglitch.py <motion.npz> [输出=同目录 motion_dg.npz] [角度阈值=8 度] [最宽几帧=1]"""
import os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk

src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(src), "motion_dg.npz"); thr = np.radians(float(sys.argv[3]) if len(sys.argv) > 3 else 8.0)
skel = sk.Skeleton.load(f"{V}/assets/model/stag_skeleton.json")
m = dict(np.load(src, allow_pickle=True)); q = m["quats"].astype(float).copy(); t = m["t"].astype(float).copy(); T = len(q)
for f in range(1, T):                                                      # 相邻帧取同号
    flip = np.sum(q[f] * q[f - 1], -1) < 0; q[f][flip] *= -1
ang = lambda a, b: 2 * np.arccos(np.clip(np.abs(np.sum(a * b, -1)), 0, 1))
def slerp(a, b, w):
    d = np.sum(a * b, -1, keepdims=True); b = np.where(d < 0, -b, b); d = np.abs(d).clip(0, 1); th = np.arccos(d); s = np.sin(th)
    w1 = np.where(s < 1e-5, 1 - w, np.sin((1 - w) * th) / np.maximum(s, 1e-9)); w2 = np.where(s < 1e-5, w, np.sin(w * th) / np.maximum(s, 1e-9)); r = a * w1 + b * w2
    return r / np.linalg.norm(r, axis=-1, keepdims=True)
def quat_to_mat(x):
    w, a, b, c = x
    return np.array([[1 - 2 * (b * b + c * c), 2 * (a * b - c * w), 2 * (a * c + b * w)], [2 * (a * b + c * w), 1 - 2 * (a * a + c * c), 2 * (b * c - a * w)], [2 * (a * c - b * w), 2 * (b * c + a * w), 1 - 2 * (a * a + b * b)]])
def joints_of(q, t):
    J = np.zeros((len(q), skel.K, 3))
    for f in range(len(q)):
        Q = np.array([quat_to_mat(q[f, i] / np.linalg.norm(q[f, i])) for i in range(skel.n)]); P, G = skel.fk(Q, t[f]); J[f] = skel.joint_positions(P, G)
    return J
check = np.abs(joints_of(q[:3], t[:3]) - m["joints"][:3]).max(); assert check < 2e-3, f"重算的关节位置和原来的对不上：{check}"
fixed = []
for width in range(1, (int(sys.argv[4]) if len(sys.argv) > 4 else 1) + 1):       # 先修一帧的尖刺，再修连着两帧的（要开才修）
    for i in range(skel.n):
        if skel.roles[i] is None: continue
        f = 1
        while f + width < T:
            a, b = q[f - 1, i], q[f + width, i]; inner = q[f:f + width, i]
            d_in, d_out, d_skip = ang(a, inner[0]), ang(inner[-1], b), ang(a, b)
            lim = np.radians(2.0) if i == skel.root else thr                    # 整体朝向抖一下，脚就跟着滑一下：根骨骼的门槛放低
            if d_in > lim and d_out > lim and d_skip < (0.75 if i == skel.root else 0.5) * min(d_in, d_out):
                for k in range(width): q[f + k, i] = slerp(a, b, (k + 1) / (width + 1))
                fixed.append((f, width, skel.names[i].split(":")[-1], round(float(np.degrees(max(d_in, d_out))), 0))); f += width
            f += 1
    f = 1
    while f + width < T:                                                   # 根的位移
        a, b = t[f - 1], t[f + width]; d_in, d_out, d_skip = np.linalg.norm(t[f] - a), np.linalg.norm(b - t[f + width - 1]), np.linalg.norm(b - a)
        if d_in > 0.015 and d_out > 0.015 and d_skip < 0.5 * min(d_in, d_out):
            for k in range(width): t[f + k] = a + (b - a) * (k + 1) / (width + 1)
            fixed.append((f, width, "根位移", round(float(max(d_in, d_out)), 3))); f += width
        f += 1
m["quats"] = q; m["t"] = t; m["loc"] = (skel.R[skel.root].T @ t.T).T / skel.scale; m["joints"] = joints_of(q, t)
np.savez(dst, **m)
frames = sorted({f for f, *_ in fixed})
print(os.path.basename(os.path.dirname(src)), f"修了 {len(fixed)} 处，涉及第 {frames} 帧" if fixed else "没有毛刺")
for x in fixed[:30]: print("   第 %d 帧（连着 %d 帧） %s 跳了 %s" % x)
