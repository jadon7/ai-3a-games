#!/usr/bin/env python3
"""卡兹的短尾巴不跟踪（brief 要求），它跟着骨盆硬动；坐下（E）、趴下（死亡）、伏低蓄力（Q、R）时尾巴会插进地里。
这里逐帧算尾巴四节（bone_6~9）的头尾离地多高，低于 MIN_Z 就把尾根（bone_6）绕身体的左右轴往上抬，抬到刚好不入地；抬的角度沿时间抹平。
只改 npz 里尾巴那几根骨骼的四元数（游戏读的就是它），别的不动。
用法: V2R/.venv/bin/python tail_lift.py <输入 npz（管线格式）> [输出=覆盖输入] [MIN_Z=0.03]"""
import os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk
skel = sk.Skeleton.load(f"{V}/assets/model/kaz_skeleton.json")
src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else src; MIN_Z = float(sys.argv[3]) if len(sys.argv) > 3 else 0.03
TAIL = [skel.index[n] for n in ("bone_6", "bone_7", "bone_8", "bone_9")]; root6 = TAIL[0]


def qmat(q):
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


m = dict(np.load(src, allow_pickle=True)); q = m["quats"].astype(float).copy(); loc = m["loc"].astype(float); T = len(q)
tw = skel.R[skel.root] @ (loc.T * skel.scale)                                  # 根骨骼的世界位移（和 blender_pose 的换算相反）
tw = tw.T
seg = [(i, skel.R[i].T @ (skel.tail[i] - skel.p[i])) for i in TAIL]


def tail_low(Q, t):
    P, G = skel.fk(Q, t); pts = [P[i] for i in TAIL] + [P[i] + G[i] @ off for i, off in seg]
    return min(p[2] for p in pts)


ang = np.zeros(T)
for f in range(T):
    Q = np.array([qmat(q[f, i]) for i in range(skel.n)]); base = Q[root6].copy()
    if tail_low(Q, tw[f]) >= MIN_Z: continue
    for a in np.radians(np.arange(2, 92, 2)):
        Q[root6] = skel.R[root6].T @ sk.rot_axis(sk.LEFT, a) @ skel.R[root6] @ base
        if tail_low(Q, tw[f]) >= MIN_Z: break
    ang[f] = a
k = np.exp(-0.5 * (np.arange(-4, 5) / 1.6) ** 2); k /= k.sum()
sm = np.convolve(np.pad(ang, 4, mode="edge"), k, mode="valid"); sm = np.maximum(sm, ang * 0.85)          # 抹平，但不让抹平把需要的角度抹掉太多
for f in range(T):
    if sm[f] <= 0: continue
    R = skel.R[root6].T @ sk.rot_axis(sk.LEFT, sm[f]) @ skel.R[root6] @ qmat(q[f, root6])
    q[f, root6] = sk.mat_to_quat(R)
for f in range(1, T):
    if np.dot(q[f, root6], q[f - 1, root6]) < 0: q[f, root6] *= -1
m["quats"] = q; np.savez(dst, **m)
print("尾巴: %d 帧（共 %d）抬了尾根，最多 %.0f 度；写好了 %s" % (int((sm > 0).sum()), T, np.degrees(sm.max()), dst))
