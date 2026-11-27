"""待机：视频里只来得及向左看了一次（5 秒不够它左右各看一遍），呼吸也浅。整理成一个 8 秒多的循环：
  向左看、回正（视频原样）→ 向右看、回正（同一段的左右镜像）；两段的接缝摊平；
  四只脚钉在站姿的位置上（读出来的脚有一两厘米的漂）；再叠一层慢而深的呼吸：身体每 4 秒多沉下去再起来一次，腿跟着屈伸。
用法: PY scripts/prep_idle.py      产出 art/unit/beast/src/idle.npz（首尾同一帧，motions.json 里用 pick 取整段）
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import load, save, fk, resolve2, J, JN, cut, mirror, smoothstep, skin_z, gauss, SKEL, GROUND, TAIL

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A0, A1 = 2, 106                      # 用视频的哪一段（头从正前方出发、回到正前方）
BREATH = 0.013                       # 呼吸时身体沉下去多少（摆正后的模型单位；游戏里约 8 厘米）
mo = load(f"{lib.V2R}/out/anim/beast_idle/motion.npz"); stand, _ = fk(cut(mo, 0, 0)); stand = stand[0]
seg = cut(mo, A0, A1); Ja, _ = fk(seg); Jb, _ = fk(mirror(seg)); N = len(Ja) - 1
S = np.concatenate([Ja[:-1], Jb[:-1]]); T = len(S); W = 14                       # 循环：T 帧，第 T 帧就是第 0 帧
for seam in (N, 0):                                                             # 两个接缝：把跳的那一下摊到两边各 W 帧
    d = S[seam % T] - S[seam - 1] - (S[(seam + 1) % T] - S[seam % T] + S[seam - 1] - S[seam - 2]) / 2      # 跳变 = 实际差 − 正常一帧该走的量
    for i in range(W):
        w = 0.5 * (1 - float(smoothstep(i / W)))
        S[(seam + i) % T] -= d * w; S[(seam - 1 - i) % T] += d * w
# 呼吸：站姿是最高点，呼气时身体往下沉。离地越高的点跟着沉得越多（脚不动）
ph = 2 * np.pi * np.arange(T) / (T / 2); b = -BREATH * 0.5 * (1 - np.cos(ph)); k = np.clip(SKEL.joint_rest[:, 2] / SKEL.joint_rest[J("LeftFShoulder"), 2], 0, 1)
S[:, :, 2] += b[:, None] * k[None]
pins = ["LeftFToe", "RightFToe", "LeftHToe", "LeftHToeTip", "RightHToe", "RightHToeTip", "LeftFWrist", "RightFWrist", "LeftHAnkle", "RightHAnkle"]
for n in pins: S[:, J(n)] = stand[J(n)]
wt = np.ones(SKEL.K); wt[[J(n) for n in pins]] = 4.0; wt[[J(n) for n in ("LeftFWrist", "RightFWrist", "LeftHAnkle", "RightHAnkle")]] = 1.5
ext = np.concatenate([S[-12:], S, S[:13]])                                        # 两头多解一圈的边，求解器的时间平滑才是按循环算的
out = resolve2(ext, mo["fps"], weight=wt)
out = {"theta": out["theta"][12:12 + T + 1], "A": out["A"][12:12 + T + 1], "t": out["t"][12:12 + T + 1], "fps": mo["fps"]}
Jo = save(f"{HERE}/src/idle.npz", out); g = skin_z(out).min(1)
feet = [J(n) for n in pins[:6]]; drift = np.linalg.norm(Jo[:, feet] - stand[feet][None], axis=-1)
print(f"待机循环 {T} 帧（{T / mo['fps']:.2f} 秒），首尾差 {np.abs(Jo[0] - Jo[-1]).max():.4f}；脚离站姿位置最多 {drift.max():.4f}；网格最低点 {g.min():+.4f} ~ {g.max():+.4f}")
print(f"  鼻尖左右 {Jo[:, J('Nose'), 0].min():+.3f} ~ {Jo[:, J('Nose'), 0].max():+.3f}（站姿 {stand[J('Nose'), 0]:+.3f}）；尾尖左右 {Jo[:, J('TailTip'), 0].min():+.3f} ~ {Jo[:, J('TailTip'), 0].max():+.3f}；背（Spine1）高度 {Jo[:, J('Spine1'), 2].min():.3f} ~ {Jo[:, J('Spine1'), 2].max():.3f}")
