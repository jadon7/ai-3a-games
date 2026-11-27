#!/usr/bin/env python3
"""在一段一次性动作的结尾接几帧，缓缓回到待机的姿势，这样游戏里接回待机时不跳。

视频里一个动作做完，角色停的姿势和待机不一定一样（出拳那段后面紧接着另一拳，砸地那段起身以后接的是咆哮），直接截断的话最后一帧是半路上的姿势。
这里不剪不改原来的帧，只在后面加：最后一帧 → 待机循环的第一帧，先快后慢。

用法: V2R/.venv/bin/python blend_tail.py <源 motion.npz> <输出 motion.npz> <待机的 motion.npz> <待机循环的起始帧> [加几帧=8]
输入输出都是管线的 motion.npz 格式（每秒 24 帧），后面照常交给 hero_motion.py。
"""
import os, sys
import numpy as np

src, dst, idle, f0 = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]); n = int(sys.argv[5]) if len(sys.argv) > 5 else 8
m = np.load(src, allow_pickle=True); q, t, J, th, fps = m["quats"].astype(float), m["t"].astype(float), m["joints"].astype(float), m["theta"].astype(float), int(m["fps"])
i = np.load(idle, allow_pickle=True); q1, t1, J1, th1 = i["quats"][f0].astype(float), i["t"][f0].astype(float), i["joints"][f0].astype(float), i["theta"][f0].astype(float)
t1 = np.array([t[0, 0], t[0, 1], t1[2]])                                       # 水平位置回到这段动作自己的起点，高度用待机的
J1 = J1 + (t1 - i["t"][f0].astype(float))


def slerp(a, b, w):
    d = np.sum(a * b, -1, keepdims=True); b = np.where(d < 0, -b, b); d = np.abs(d).clip(0, 1); thv = np.arccos(d); s = np.sin(thv)
    w1 = np.where(s < 1e-5, 1 - w, np.sin((1 - w) * thv) / np.maximum(s, 1e-9)); w2 = np.where(s < 1e-5, w, np.sin(w * thv) / np.maximum(s, 1e-9))
    o = a * w1 + b * w2; return o / np.linalg.norm(o, axis=-1, keepdims=True)


vq = q[-1] - q[-2] if len(q) > 1 else 0                                      # 末尾还带着一点速度的话，头两帧顺着它走，不急刹
w = np.array([(k / n) for k in range(1, n + 1)]); e = 1 - (1 - w) ** 2.2        # 先快后慢
qs = np.stack([slerp(q[-1], q1, ek) for ek in e]); ts = np.stack([t[-1] * (1 - ek) + t1 * ek for ek in e]); Js = np.stack([J[-1] * (1 - ek) + J1 * ek for ek in e]); ths = np.stack([th[-1] * (1 - ek) + th1 * ek for ek in e])
q2 = np.concatenate([q, qs]); t2 = np.concatenate([t, ts]); J2 = np.concatenate([J, Js]); th2 = np.concatenate([th, ths])
for k in range(1, len(q2)):
    flip = np.sum(q2[k] * q2[k - 1], -1) < 0; q2[k][flip] *= -1
R = np.linalg.lstsq(m["t"].astype(float), m["loc"].astype(float), rcond=None)[0]
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
np.savez(dst, quats=q2, loc=t2 @ R, fps=fps, joints=J2, theta=th2, t=t2)
print(f"接好了 {dst}：{len(q)} 帧 + {n} 帧回待机 = {len(q2)} 帧（{(len(q2) - 1) / fps:.2f} 秒）")
