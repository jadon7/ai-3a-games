#!/usr/bin/env python3
"""把一段动作里某几帧的“身体幅度”按比例收小（头和脖子不动）。
为什么要有：即梦出的普攻，獠牙上挑那一下前半身几乎人立起来（前蹄离地 0.19 个模型单位，游戏里七十厘米，鼻尖到四米高），
brief 写的是“前半身跟着抬起一点”，而且普攻一秒多打一下，回回人立太夸张，也和重击（attack2 才该是最大的一下）拉不开层次。
做法：选一帧站姿当参考；指定帧段里，根骨骼的朝向、脊柱、四条腿的每根骨骼，都从参考姿势只走到原来的 s 成（四元数插值）；
脖子和头保持原来的角度，所以“挑”的动作还在。收小以后把整体平移一下，让两只后蹄尖的平均位置和原来一样（人立时后蹄是踩着地的）。
帧段两头各有几帧过渡。输入输出都是管线的 motion.npz 格式（每秒 24 帧，帧号是视频的帧号）。
用法: python soften.py <源 motion.npz> <输出.npz> <起帧> <止帧> <比例，如 0.55> [参考帧=0] [过渡帧数=4]"""
import os, sys
import numpy as np
from boarlib import skel, JN, k, quat_to_mat
src, dst, a, b, s = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]); ref = int(sys.argv[6]) if len(sys.argv) > 6 else 0; ramp = int(sys.argv[7]) if len(sys.argv) > 7 else 4
m = dict(np.load(src, allow_pickle=True)); q = m["quats"].astype(float).copy(); t = m["t"].astype(float).copy(); J0 = m["joints"].astype(float); T = len(q)
for f in range(1, T):
    flip = np.sum(q[f] * q[f - 1], -1) < 0; q[f][flip] *= -1


def slerp(x, y, w):
    d = np.sum(x * y, -1, keepdims=True); y = np.where(d < 0, -y, y); d = np.abs(d).clip(0, 1); th = np.arccos(d); sn = np.sin(th)
    w1 = np.where(sn < 1e-5, 1 - w, np.sin((1 - w) * th) / np.maximum(sn, 1e-9)); w2 = np.where(sn < 1e-5, w, np.sin(w * th) / np.maximum(sn, 1e-9)); r = x * w1 + y * w2
    return r / np.linalg.norm(r, axis=-1, keepdims=True)


def joints_of(qf, tf):
    Q = np.array([quat_to_mat(qf[i] / np.linalg.norm(qf[i])) for i in range(skel.n)]); P, G = skel.fk(Q, tf); return skel.joint_positions(P, G)


keep = {i for i, r in enumerate(skel.roles) if r in ("neck", "head")}                       # 脖子、头不收
body = [i for i, r in enumerate(skel.roles) if r is not None and i not in keep]
hind = [k("LeftHToeTip"), k("RightHToeTip")]; J = J0.copy(); top0 = top1 = 0.0
for f in range(T):
    u = min(np.clip((f - (a - ramp)) / ramp, 0, 1), np.clip(((b + ramp) - f) / ramp, 0, 1)); w = u * u * (3 - 2 * u)
    if w <= 0: continue
    sf = 1 - w * (1 - s)
    q[f, body] = slerp(q[ref, body], q[f, body], sf)
    new = joints_of(q[f], t[f]); t[f] += (J0[f, hind] - new[hind]).mean(0); J[f] = joints_of(q[f], t[f])
    top0 = max(top0, J0[f, k("Nose"), 2]); top1 = max(top1, J[f, k("Nose"), 2])
m["quats"] = q; m["t"] = t; m["joints"] = J; m["loc"] = (skel.R[skel.root].T @ t.T).T / skel.scale
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True); np.savez(dst, **m)
ft = lambda X: np.minimum(X[a:b + 1, k("LeftFToe"), 2], X[a:b + 1, k("RightFToe"), 2]).max()
print("收小好了 %s：第 %d 到 %d 帧收到 %.0f%%。鼻尖最高 %.2f → %.2f，前蹄离地最高 %.2f → %.2f，后蹄最低 %.3f → %.3f（模型单位）" % (dst, a, b, s * 100, top0, top1, ft(J0), ft(J), J0[a:b + 1, hind, 2].min(), J[a:b + 1, hind, 2].min()))
