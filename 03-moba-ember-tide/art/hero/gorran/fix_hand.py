"""葛隆专用：给管线读出来的右手补一个固定的旋转，把锤的朝向校回来。

依据：每段视频的第 0 帧就是参考图（站姿），真实姿势已知。calib.py 量出来，8 段视频里解出来的右手和真实的右手都差 30 度左右、
而且是同一个方向（在手自己的坐标系里看），是握拳的手型和管线的手指模型不一样造成的系统偏差。锤绑在右手上，于是每段动作里锤都歪 30 度
（举过头时锤头垂到背后、扎进后背）。这里取 8 段的平均值，乘到每一帧右手的旋转上。只动右手这一根骨骼；左前臂（盾）差得不一样多、原因也不同，没有动。

用法: <V2R>/.venv/bin/python art/hero/gorran/fix_hand.py <calib.json> <动作名> [动作名 …]
改的是 V2R/out/anim/gorran_<动作>/motion.npz 里的 quats，并记一个 hand_fixed 标记，重复跑不会补两次（重新求解过的文件没有标记，会再补）。
"""
import json, os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
def qmul(a, b):
    w1, x1, y1, z1 = np.moveaxis(a, -1, 0); w2, x2, y2, z2 = np.moveaxis(b, -1, 0)
    return np.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2], -1)
cal = json.load(open(sys.argv[1], encoding="utf-8")); BONE = "RightHand"
qs = np.array([c[BONE]["quat"] for c in cal.values()]); qs[np.sum(qs * qs[0], 1) < 0] *= -1; c = qs.mean(0); c /= np.linalg.norm(c)
print(f"右手的校正：{np.degrees(2 * np.arccos(min(1, abs(c[0])))):.1f} 度，8 段之间最多差 {np.degrees(2 * np.arccos(np.clip(np.abs(qs @ c), 0, 1))).max():.1f} 度")
names = [b["name"] for b in json.load(open(os.path.join(V, "assets/model/gorran_skeleton.json"), encoding="utf-8"))["bones"]]; bi = names.index("mixamorig:" + BONE)
for tag in sys.argv[2:]:
    p = os.path.join(V, "out", "anim", f"gorran_{tag}", "motion.npz"); m = dict(np.load(p, allow_pickle=True))
    if "hand_fixed" in m: print(tag, "已经补过了"); continue
    q = m["quats"].copy(); q[:, bi] = qmul(q[:, bi], c[None]); m["quats"] = q; m["hand_fixed"] = np.array(1); np.savez(p, **m); print(tag, "补好了")
