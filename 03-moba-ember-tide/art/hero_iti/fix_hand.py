"""伊缇用（照 art/hero/hedda/fix_hand.py 改，那份只补右手）：给管线读出来的两只手各补一个固定的旋转，把刀的朝向校回来。

依据（HERO_PIPELINE.md 最后一节）：每段视频的第 0 帧就是参考图（站姿），真实姿势已知。calib.py 量出解出来的手和真实的手差多少，
各段都是差不多的方向、差不多的角度，是握拳的手型和管线的手指模型不一样造成的系统偏差。伊缇两只手都握刀，所以两只手都补。
取各段的平均（跳过偏得离谱的段：和平均差 25 度以上的不算进平均），乘到每一帧这只手的旋转上。

用法: <V2R>/.venv/bin/python art/hero_iti/fix_hand.py <calib.json> <动作名> [动作名 …]
改的是 V2R/out/anim/iti_<动作>/motion.npz 里的 quats，并记一个 hand_fixed 标记，重复跑不会补两次（重新求解过的文件没有标记，会再补）。
"""
import json, os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
def qmul(a, b):
    w1, x1, y1, z1 = np.moveaxis(a, -1, 0); w2, x2, y2, z2 = np.moveaxis(b, -1, 0)
    return np.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2], -1)
cal = json.load(open(sys.argv[1], encoding="utf-8"))
names = [b["name"] for b in json.load(open(os.path.join(V, "assets/model/iti_skeleton.json"), encoding="utf-8"))["bones"]]
corr = {}
for BONE in ("RightHand", "LeftHand"):
    qs = np.array([c[BONE]["quat"] for c in cal.values()]); qs[np.sum(qs * qs[0], 1) < 0] *= -1; c = qs.mean(0); c /= np.linalg.norm(c)
    dev = np.degrees(2 * np.arccos(np.clip(np.abs(qs @ c), 0, 1))); ok = dev < 25
    if ok.sum() >= 2: c = qs[ok].mean(0); c /= np.linalg.norm(c); dev = np.degrees(2 * np.arccos(np.clip(np.abs(qs @ c), 0, 1)))
    corr[names.index("mixamorig:" + BONE)] = c
    print(f"{BONE} 的校正：{np.degrees(2 * np.arccos(min(1, abs(c[0])))):.1f} 度，{len(qs)} 段里和它差 25 度以内的 {int((dev < 25).sum())} 段，最多差 {dev.max():.1f} 度")
for tag in sys.argv[2:]:
    p = os.path.join(V, "out", "anim", f"iti_{tag}", "motion.npz"); m = dict(np.load(p, allow_pickle=True))
    if "hand_fixed" in m: print(tag, "已经补过了"); continue
    q = m["quats"].copy()
    for bi, c in corr.items(): q[:, bi] = qmul(q[:, bi], c[None])
    m["quats"] = q; m["hand_fixed"] = np.array(1); np.savez(p, **m); print(tag, "补好了")
