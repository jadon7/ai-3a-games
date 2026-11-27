#!/usr/bin/env python3
"""逐帧看管线读出来的动作和视频里认出的关节差多少（只读 out/anim/torg_<动作>/）。整段的平均数会被几帧烂的拉高，这里看烂在哪几帧。
用法: python reproj.py <动作> [动作 …]      每 6 帧打印一个平均值（%身高），并列出最差的关节"""
import sys, os, json, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk
skel = sk.Skeleton.load(f"{V}/assets/model/torg_skeleton.json"); names = skel.joint_names
for tag in sys.argv[1:]:
    d = f"{V}/out/anim/torg_{tag}"; m = np.load(f"{d}/motion.npz", allow_pickle=True); det = np.load(f"{d}/detections.npz", allow_pickle=True)
    obs, conf = det["obs"], det["conf"]
    r = np.linalg.norm((sk.project(m["joints"]).transpose(1, 0, 2, 3) - obs) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1) / skel.size_ref * 100      # (帧, 机位, 关节)
    w = np.clip(conf, 1e-3, 1); per = (r * w).sum((1, 2)) / w.sum((1, 2)); T = len(per)
    print(f"== {tag}: 整段 {np.average(r, weights=w):.2f}%  正面 {np.average(r[:, 0], weights=w[:, 0]):.2f}% 侧面 {np.average(r[:, 1], weights=w[:, 1]):.2f}%  置信度最低的帧 {int(conf.mean((1, 2)).argmin())}（{conf.mean((1, 2)).min():.2f}）")
    print("   逐帧(每 6 帧平均): " + " ".join(f"{i}:{per[i:i + 6].mean():.1f}" for i in range(0, T, 6)))
    pj = (r * w).sum((0, 1)) / w.sum((0, 1)); top = np.argsort(-pj)[:5]; print("   最差的关节: " + "  ".join(f"{names[k]} {pj[k]:.1f}%" for k in top))
