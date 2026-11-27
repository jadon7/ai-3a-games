#!/usr/bin/env python3
"""量成品动作（motions/<动作>.npz，30 帧每秒）里的时间点：头伸得最远、起跳、砸地、脚离地多高。
用法: V2R/.venv/bin/python scripts/measure.py <动作名或 npz 路径> [...]      在 art/unit/toad 里跑
每段打印逐帧的表（时间、鼻尖向前到哪、鼻尖高度、鼻尖速度、根高、肚皮高、身体俯仰、四脚最低点离站立高度多少），再打印几个极值的时刻。
"""
import os, sys
import numpy as np
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(HERE, "scripts"))
from toadlib import skel, J, GROUND, fk_motion  # noqa: E402

for name in sys.argv[1:]:
    path = name if name.endswith(".npz") else os.path.join(HERE, "motions", name + ".npz")
    Jt, A, fps = fk_motion(path); T = len(Jt); tt = np.arange(T) / fps
    nose, root, belly = Jt[:, J["Nose"]], Jt[:, J["Root"]], Jt[:, J["Belly"]]
    reach = -nose[:, 1]; v = np.linalg.norm(np.gradient(nose, axis=0), axis=1) * fps
    pitch = np.degrees(np.arcsin(np.clip(A[:, 2, 1], -1, 1)))                 # 身体俯仰：负 = 前半身抬起（鼻尖朝上）
    yaw = np.degrees(np.arctan2(-A[:, 0, 1], A[:, 1, 1]))
    air = np.min(Jt[:, GROUND, 2] - skel.joint_rest[GROUND, 2], axis=1)       # 最低的脚离“站着的高度”多远：>0 就是四脚都离地
    low = Jt[:, :, 2].min(1)
    print(f"== {name}: {T} 帧 @ {fps:.0f}（{(T - 1) / fps:.2f} 秒）  静止时：根高 {skel.joint_rest[J['Root'], 2]:.3f} 肚皮 {skel.joint_rest[J['Belly'], 2]:.3f} 鼻尖前 {-skel.joint_rest[J['Nose'], 1]:.3f} 高 {skel.joint_rest[J['Nose'], 2]:.3f}")
    print("    t  鼻尖前  鼻尖高 鼻速   根高  根前后 肚皮高  俯仰  朝向  脚离地 全身最低")
    for f in range(0, T, 2 if T < 80 else 3):
        print(f"  {tt[f]:4.2f} {reach[f]:6.3f} {nose[f, 2]:6.3f} {v[f]:5.2f} {root[f, 2]:6.3f} {-root[f, 1]:6.3f} {belly[f, 2]:6.3f} {pitch[f]:5.1f} {yaw[f]:5.1f} {air[f]:6.3f} {low[f]:6.3f}")
    print(f"  鼻尖伸得最远 t={tt[reach.argmax()]:.2f}（{reach.max():.3f}）；鼻尖最快 t={tt[v.argmax()]:.2f}（{v.max():.2f}/秒）；根最高 t={tt[root[:, 2].argmax()]:.2f}（{root[:, 2].max():.3f}）；根最低 t={tt[root[:, 2].argmin()]:.2f}（{root[:, 2].min():.3f}）；"
          f"四脚离地最高 t={tt[air.argmax()]:.2f}（{air.max():.3f}）；肚皮最低 {belly[:, 2].min():.3f}；全身跟踪点最低 {low.min():.3f}")
    up = np.where(air > 0.01)[0]
    if len(up): print(f"  四脚都离地：t={tt[up[0]]:.2f} 到 {tt[up[-1]]:.2f}（{len(up)} 帧）")
