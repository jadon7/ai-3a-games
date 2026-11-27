"""把一段解坏了的帧用前后两帧插值替换（四元数球面插值、位移线性插值），写到 V2R/out/anim/ugo_<动作>_fix/motion.npz。

死亡：视频第 49~58 帧跪下去的那一下，求解把一条腿解成了向前伸直（脚在胯前 0.4 身高，像踢腿），第 54 帧左右腿还对调了一次。
第 48 帧（半蹲）和第 59 帧（双膝跪地、两只脚都在身后）都是对的，中间直接插过去，跪下的过程变成 0.4 秒的一下沉。
不用 hero_motion 的 segments 剪掉这段：它会把后半段整体平移去接前半段的胯高，跪地的部分会悬空。
用法: <V2R>/.venv/bin/python fill_gap.py <动作> <起帧（保留）> <止帧（保留）> [<起> <止> …]
"""
import sys, os
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
tag = sys.argv[1]; pairs = [int(x) for x in sys.argv[2:]]
src = f"{V}/out/anim/ugo_{tag}/motion.npz"; dst_d = f"{V}/out/anim/ugo_{tag}_fix"; os.makedirs(dst_d, exist_ok=True)
m = np.load(src, allow_pickle=True); d = {k: m[k].copy() for k in m.files}
q = d["quats"]


def slerp(a, b, t):
    dot = np.sum(a * b, -1, keepdims=True); b = np.where(dot < 0, -b, b); dot = np.abs(dot).clip(0, 1)
    th = np.arccos(dot); s = np.sin(th)
    w1 = np.where(s < 1e-5, 1 - t, np.sin((1 - t) * th) / np.maximum(s, 1e-9)); w2 = np.where(s < 1e-5, t, np.sin(t * th) / np.maximum(s, 1e-9))
    r = a * w1 + b * w2; return r / np.linalg.norm(r, axis=-1, keepdims=True)


for a, b in zip(pairs[::2], pairs[1::2]):
    for f in range(a + 1, b):
        t = (f - a) / (b - a); t = t * t * (3 - 2 * t)                # 两头缓
        q[f] = slerp(q[a], q[b], t)
        for k in ("t", "loc", "joints", "theta"):
            if k in d: d[k][f] = d[k][a] * (1 - t) + d[k][b] * t
    print(f"{tag}: 第 {a + 1} 到 {b - 1} 帧换成插值")
np.savez(f"{dst_d}/motion.npz", **d); print("写好了", f"{dst_d}/motion.npz")
