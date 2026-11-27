#!/usr/bin/env python3
"""量成品跑步动作（motions/run.npz，30 帧每秒）按原速播时脚下的速度：踩在地上的那只脚相对身体往后蹬得多快（身高每秒）。
hero_motion.py 打印的“原速”取的是最低那只脚踝在整个着地阶段的平均，这里另外按“脚掌贴地的中段”再量一遍做对照。只读。
用法: python runspeed.py [游戏里的身高=3.6]"""
import json, sys, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; D = "/Users/jadon7/Documents/SynologyDrive/code/moba/art/hero/torg"; H = float(sys.argv[1]) if len(sys.argv) > 1 else 3.6
SK = json.load(open(f"{V}/assets/model/torg_skeleton.json")); BONES = SK["bones"]; NB = len(BONES); BI = {b["name"]: i for i, b in enumerate(BONES)}; PAR = [b["parent"] for b in BONES]
M0 = np.array([np.array(b["matrix"], float)[:3, :3] for b in BONES]); M0 /= np.linalg.norm(M0, axis=1, keepdims=True); H0 = np.array([b["head"] for b in BONES], float)
def q2m(q):
    w, x, y, z = np.moveaxis(q, -1, 0)
    return np.stack([np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], -1), np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], -1), np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1)], -2)
m = np.load(f"{D}/motions/run.npz", allow_pickle=True); q = m["quats"].astype(float); loc = m["loc"].astype(float); fps = float(m["fps"]); T = len(q); root = next(i for i in range(NB) if PAR[i] < 0)
R = q2m(q); W = np.zeros((T, NB, 3, 3)); P = np.zeros((T, NB, 3))
for b in range(NB):
    p = PAR[b]
    if p < 0: W[:, b] = M0[b] @ R[:, b]; P[:, b] = H0[b] + loc @ M0[b].T
    else: W[:, b] = W[:, p] @ (M0[p].T @ M0[b]) @ R[:, b]; P[:, b] = P[:, p] + W[:, p] @ (M0[p].T @ (H0[b] - H0[p]))
hips = P[:, root]; out = []
for side in ("Left", "Right"):
    a = P[:, BI["mixamorig:" + side + "Foot"]]; toe = P[:, BI["mixamorig:" + side + "ToeBase"]]; y = a[:, 1] - hips[:, 1]; vy = np.gradient(np.concatenate([y[:-1], y[:-1], y[:-1]]))[T - 1:2 * (T - 1)] * fps      # 循环动作，首尾相接着求速度
    low = np.minimum(a[:-1, 2], toe[:-1, 2] + 0.035); on = (toe[:-1, 2] < toe[:-1, 2].min() + 0.02) & (vy > 0)      # 脚尖贴着地而且在往后走
    print(f"{side}: 贴地 {int(on.sum())} 帧，往后的速度 平均 {vy[on].mean():.2f} 最大 {vy[on].max():.2f} 身高/秒；这只脚前后摆了 {y.max() - y.min():.2f} 身高"); out += list(vy[on])
v = float(np.mean(out)); print(f"一圈 {T - 1} 帧（{(T - 1) / fps:.2f} 秒，两步或四步）。贴地时脚往后 平均 {v:.2f} 身高/秒 → 游戏里 {v * H:.2f} 米/秒；上四分位 {np.percentile(out, 75) * H:.2f} 米/秒")
if len(sys.argv) > 2:      # 多给一个参数就打印逐帧：左右脚踝的高度、脚尖的高度、相对胯往后的速度
    for f in range(T - 1):
        row = []
        for side in ("Left", "Right"):
            a = P[:, BI["mixamorig:" + side + "Foot"]]; toe = P[:, BI["mixamorig:" + side + "ToeBase"]]; y = a[:, 1] - hips[:, 1]; vy = np.gradient(np.concatenate([y[:-1], y[:-1], y[:-1]]))[T - 1:2 * (T - 1)] * fps
            row.append(f"{side[0]} 踝z {a[f, 2]:.2f} 尖z {toe[f, 2]:.2f} y {y[f]:+.2f} v {vy[f]:+.1f}")
        print(f"{f:2d}  " + "   ".join(row) + f"   胯z {hips[f, 2]:.3f}")
