#!/usr/bin/env python3
"""给一段读出来的动作变速（从 art/hero/torg_turtle/retime.py 复制，塞伦用）：有的段落快放（视频里蓄力、腾空、停顿都拖得很长），有的原速，中间不剪断。

为什么不用 motions.json 的 segments 直接剪：剪口两边胯的高度不一样时，hero_motion.py 会把剪口后面整段的位移平移过去接上，
落地的那几帧就跟着陷到地里（W 的后脚陷了 5%，R 陷了 2%）；剪口附近的旋转平滑还会把“砸下”那一下抹慢。变速没有剪口，不存在这两个问题。

用法: V2R/.venv/bin/python retime.py <源 motion.npz> <输出 motion.npz> "起-止:倍率,起-止:倍率,…" [zscale=腾空高度留几成]
  例: "2-22:5,22-36:1.6,36-68:9,68-120:1"   第 2 到 22 帧 5 倍速，22 到 36 帧 1.6 倍速……帧号是视频的帧号，各段首尾相接。
  zscale（可选，如 zscale=0.5）: 四只脚都离地的那些帧，胯超出起跳高度的部分只留这么多（游戏自己会再加一条抛物线，动作里跳太高会叠成两倍）。
输出仍是每秒 24 帧，字段和管线的 motion.npz 一样，后面照常交给 hero_motion.py（用整段，不用再写 range）。
"""
import os, sys
import numpy as np

src, dst, spec = sys.argv[1], sys.argv[2], sys.argv[3]
opt = dict(a.split("=") for a in sys.argv[4:])
m = np.load(src, allow_pickle=True); q, t, J, th, fps = m["quats"].astype(float), m["t"].astype(float), m["joints"].astype(float), m["theta"].astype(float), int(m["fps"])
segs = [(float(a), float(b), float(s)) for a, b, s in (((p.split(":")[0].split("-")) + [p.split(":")[1]]) for p in spec.split(","))]
assert all(abs(segs[i][1] - segs[i + 1][0]) < 1e-6 for i in range(len(segs) - 1)), "各段要首尾相接"
# 输出的每一帧对应源里的第几帧（可以是小数）
pos = [segs[0][0]]
for a, b, s in segs:
    x = pos[-1]
    while x + s <= b + 1e-9: x += s; pos.append(x)
    if b - x > 0.25 * s: pos.append(b)
    pos[-1] = b
pos = np.array(pos)
k = np.exp(-0.5 * (np.arange(-3, 4) / 1.2) ** 2); k /= k.sum()                # 把变速的拐点磨圆一点，免得速度突然变
sm = np.convolve(np.pad(pos, 3, mode="edge"), k, mode="valid"); sm[0], sm[-1] = pos[0], pos[-1]; pos = np.maximum.accumulate(sm)
i0 = np.clip(np.floor(pos).astype(int), 0, len(q) - 2); f = pos - i0


def slerp(a, b, w):
    d = np.sum(a * b, -1, keepdims=True); b = np.where(d < 0, -b, b); d = np.abs(d).clip(0, 1); thv = np.arccos(d); s = np.sin(thv)
    w1 = np.where(s < 1e-5, 1 - w, np.sin((1 - w) * thv) / np.maximum(s, 1e-9)); w2 = np.where(s < 1e-5, w, np.sin(w * thv) / np.maximum(s, 1e-9))
    o = a * w1 + b * w2; return o / np.linalg.norm(o, axis=-1, keepdims=True)


lerp = lambda A: A[i0] * (1 - f).reshape(-1, *[1] * (A.ndim - 1)) + A[i0 + 1] * f.reshape(-1, *[1] * (A.ndim - 1))  # noqa: E731
q2 = slerp(q[i0], q[i0 + 1], f[:, None, None]); t2, J2, th2 = lerp(t), lerp(J), lerp(th)
for i in range(1, len(q2)):
    flip = np.sum(q2[i] * q2[i - 1], -1) < 0; q2[i][flip] *= -1
note = ""
if "zscale" in opt:                                                           # 压低腾空高度
    import json
    V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sk = json.load(open(os.path.join(V2R, "assets/model/seren_skeleton.json"), encoding="utf-8"))
    jn = [j["name"] for j in sk["joints"]]; gi = [jn.index(n) for n in (sk.get("profile") or {}).get("ground_joints") or [n for n in jn if "Foot" in n or "Toe" in n]]      # 塞伦是两足（Mixamo 名字），骨架文件里没有 profile
    rest = np.array([np.array(next(b for b in sk["bones"] if b["name"] == j["bone"])["head"]) + np.array(j["offset"]) for j in sk["joints"]])[gi, 2]
    air = np.min(J2[:, gi, 2] - rest, axis=1)                                 # 最低的脚离“站着的高度”多远
    lift = np.clip(air, 0, None) * (1 - float(opt["zscale"]))
    t2[:, 2] -= lift; J2[:, :, 2] -= lift[:, None]; note = f"；腾空最高处压低了 {lift.max():.3f}"
root_loc = m["loc"].astype(float); R = np.linalg.lstsq(t, root_loc, rcond=None)[0]      # loc 和 t 之间是个固定的线性变换（根骨骼自己的坐标系）
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
np.savez(dst, quats=q2, loc=t2 @ R, fps=fps, joints=J2, theta=th2, t=t2)
print(f"变速好了 {dst}：{len(q)} 帧里的第 {segs[0][0]:.0f} 到 {segs[-1][1]:.0f} 帧 → {len(q2)} 帧（{(len(q2) - 1) / fps:.2f} 秒）{note}")
print("  源帧 → 输出时间（秒）:", "  ".join(f"{int(x)}→{np.interp(x, pos, np.arange(len(pos))) / fps:.2f}" for x in sorted({s_[0] for s_ in segs} | {segs[-1][1]} | {float(v) for v in opt.get("mark", "").split("/") if v})))
