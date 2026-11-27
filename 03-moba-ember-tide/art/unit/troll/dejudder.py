#!/usr/bin/env python3
"""把一段读出来的动作在时间上轻轻磨一下，去掉“两帧一顿”。

即梦这几段新视频（待机、行走、死亡最明显）相邻两帧一帧动得多、一帧几乎不动，读出来的动作逐帧位移忽大忽小，慢动作里看着发颤。
用标准差 0.8 帧的高斯沿时间平均（旋转、胯的位移一起磨），两帧一个来回的抖动基本抹掉，动作本身的快慢几乎不变；出拳、砸地这种要脆的不用它。
行走是循环，要绕着循环磨，放在 footlock.py 里做了；这个脚本给不循环的（或者先磨整段、再让 hero_motion.py 找循环的）用。

用法: V2R/.venv/bin/python dejudder.py <源 motion.npz> <输出 motion.npz> [标准差=0.8]
"""
import os, sys
import numpy as np
src, dst = sys.argv[1], sys.argv[2]; sig = float(sys.argv[3]) if len(sys.argv) > 3 else 0.8
m = np.load(src, allow_pickle=True); q, t, J, th, fps = m["quats"].astype(float), m["t"].astype(float), m["joints"].astype(float), m["theta"].astype(float), int(m["fps"])
r = int(np.ceil(sig * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sig) ** 2); k /= k.sum()
def sm(a): pad = np.concatenate([np.repeat(a[:1], r, 0), a, np.repeat(a[-1:], r, 0)]); return sum(w * pad[i:i + len(a)] for i, w in enumerate(k))
for i in range(1, len(q)): flip = np.sum(q[i] * q[i - 1], -1) < 0; q[i][flip] *= -1
q2 = sm(q); q2 /= np.linalg.norm(q2, axis=-1, keepdims=True); t2, J2, th2 = sm(t), sm(J), sm(th)
v0 = np.abs(np.diff(J, 2, axis=0)).mean(); v1 = np.abs(np.diff(J2, 2, axis=0)).mean()
R = np.linalg.lstsq(m["t"].astype(float), m["loc"].astype(float), rcond=None)[0]
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True); np.savez(dst, quats=q2, loc=t2 @ R, fps=fps, joints=J2, theta=th2, t=t2)
print(f"磨好了 {dst}：关节逐帧加速度的平均大小 {v0 * 1000:.2f} → {v1 * 1000:.2f}（千分之一身高/帧²），关节位置最多挪了 {np.abs(J2 - J).max() * 100:.1f}% 身高")
