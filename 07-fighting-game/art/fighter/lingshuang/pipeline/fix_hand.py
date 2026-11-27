"""凌霜用（从 MOBA/art/hero/hedda/fix_hand.py 改，原来只补右手）：给管线读出来的几根手臂骨骼各补一个固定的旋转。
依据：每段视频第 0 帧就是参考图（站姿），calib.py 量出解出来的骨骼和真实骨骼差多少（在骨骼自己的坐标系里）。
凌霜 7 段量下来很一致：右前臂绕自身长轴拧了约 46 度、左前臂约 24 度、右手约 18 度、左手约 42 度，各段之间差不到 3 度，是系统偏差。
做法：先补两只前臂（它们一变手也跟着变），重新 calib，再补两只手。取各段的平均值，乘到每一帧这根骨骼的旋转上（右乘，骨骼自己的坐标系）。
用法: python fix_hand.py <calib.json> <骨骼,骨骼> <动作名> [动作名 …]   例: fix_hand.py calib.json RightForeArm,LeftForeArm idle heavy
改 V2R/out/anim/lingshuang_<动作>/motion.npz 的 quats，并记 fixed_<骨骼> 标记，重复跑不会补两次（重新求解过的文件没有标记，会再补）。"""
import json, os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
def qmul(a, b):
    w1, x1, y1, z1 = np.moveaxis(a, -1, 0); w2, x2, y2, z2 = np.moveaxis(b, -1, 0)
    return np.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2], -1)
cal = json.load(open(sys.argv[1], encoding="utf-8")); bones = sys.argv[2].split(",")
names = [b["name"] for b in json.load(open(os.path.join(V, "assets/model/lingshuang_skeleton.json"), encoding="utf-8"))["bones"]]
C = {}
for BONE in bones:
    qs = np.array([c[BONE]["quat"] for c in cal.values()]); qs[np.sum(qs * qs[0], 1) < 0] *= -1; c = qs.mean(0); c /= np.linalg.norm(c); C[BONE] = c
    print(f"{BONE} 的校正：{np.degrees(2 * np.arccos(min(1, abs(c[0])))):.1f} 度，{len(qs)} 段之间最多差 {np.degrees(2 * np.arccos(np.clip(np.abs(qs @ c), 0, 1))).max():.1f} 度")
for tag in sys.argv[3:]:
    p = os.path.join(V, "out", "anim", f"lingshuang_{tag}", "motion.npz"); m = dict(np.load(p, allow_pickle=True)); q = m["quats"].copy(); done = []
    for BONE, c in C.items():
        if "fixed_" + BONE in m: continue
        bi = names.index("mixamorig:" + BONE); q[:, bi] = qmul(q[:, bi], c[None]); m["fixed_" + BONE] = np.array(1); done.append(BONE)
    m["quats"] = q; np.savez(p, **m); print(tag, "补了", done or "（都补过了）")
