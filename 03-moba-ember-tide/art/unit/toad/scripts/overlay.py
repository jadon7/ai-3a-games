#!/usr/bin/env python3
"""把“网络读到的点”和“解出来的骨架”一起画在视频帧上，拼成一张图，看腿有没有解错。
用法: V2R/.venv/bin/python overlay.py <视频.mp4> <out/anim/toad_xxx 目录> <输出.jpg> [帧: 数量 或 a,b,c 或 a-b:步长] [motion 文件名=motion.npz] [每行几格=4]
  小圆点 = 网络读数（越小置信度越低，置信度 <0.15 的画成空心叉）；线 = 解出来的骨架投回两个机位（左侧的腿红、右侧蓝、身体和头黄）。
"""
import os, sys
import cv2
import numpy as np
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V2R)
from v2r import skeleton as sk

video, d, out = sys.argv[1:4]; spec = sys.argv[4] if len(sys.argv) > 4 else "12"; mfile = sys.argv[5] if len(sys.argv) > 5 else "motion.npz"; cols = int(sys.argv[6]) if len(sys.argv) > 6 else 4
skel = sk.Skeleton.load(os.path.join(V2R, "assets/model/toad_skeleton.json")); JN = skel.joint_names; J = {n: k for k, n in enumerate(JN)}
cap = cv2.VideoCapture(video); frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(f)
T = len(frames)
det = np.load(os.path.join(d, "detections.npz")); obs, conf = det["obs"], det["conf"]
mp = os.path.join(d, mfile); proj = sk.project(np.load(mp, allow_pickle=True)["joints"]).transpose(1, 0, 2, 3) if os.path.exists(mp) else None      # (T,2,K,2)
if "-" in spec: a, rest = spec.split("-"); b, st = (rest.split(":") + ["1"])[:2]; idx = list(range(int(a), min(int(b), T - 1) + 1, int(st)))
elif "," in spec: idx = [int(x) for x in spec.split(",")]
else: idx = [int(x) for x in np.linspace(0, T - 1, int(spec))]
CH = [("L", ["LeftFShoulder", "LeftFElbow", "LeftFWrist", "LeftFToe"]), ("L", ["LeftHHip", "LeftHKnee", "LeftHAnkle", "LeftHToe"]),
      ("R", ["RightFShoulder", "RightFElbow", "RightFWrist", "RightFToe"]), ("R", ["RightHHip", "RightHKnee", "RightHAnkle", "RightHToe"]),
      ("M", ["Rump", "BackTop", "Neck", "Head", "Nose"]), ("M", ["Neck", "Chin"]), ("M", ["EyeL", "EyeR"]), ("M", ["SideL", "Belly", "SideR"]), ("M", ["Rump", "Belly"])]
COL = {"L": (60, 60, 255), "R": (255, 140, 40), "M": (0, 230, 255)}
S = 2; tiles = []
for i in idx:
    f = cv2.resize(frames[i], None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC); h, w = f.shape[:2]; hw = w // 2
    for v in range(2):
        x0 = 0 if v == 0 else w - hw
        if proj is not None:
            for g, names in CH:
                pts = [(int(x0 + proj[i, v, J[n], 0] * hw), int(proj[i, v, J[n], 1] * h)) for n in names]
                for p, q in zip(pts[:-1], pts[1:]): cv2.line(f, p, q, COL[g], 2, cv2.LINE_AA)
        for k, g in enumerate(skel.joint_group):
            x, y = int(x0 + obs[i, v, k, 0] * hw), int(obs[i, v, k, 1] * h); c = float(conf[i, v, k])
            if c < 0.15: cv2.drawMarker(f, (x, y), COL[g], cv2.MARKER_TILTED_CROSS, 8, 1)
            else: cv2.circle(f, (x, y), 2 + int(4 * c), COL[g], -1, cv2.LINE_AA); cv2.circle(f, (x, y), 2 + int(4 * c), (0, 0, 0), 1, cv2.LINE_AA)
    f = f[int(h * float(os.environ.get("TOP", "0.42"))):int(h * float(os.environ.get("BOT", "0.98")))].copy()      # 默认只留画面中下部（跳起来的那段要看全：TOP=0.1）
    cv2.putText(f, str(i), (10, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2); tiles.append(f)
h, w = tiles[0].shape[:2]; rows = (len(tiles) + cols - 1) // cols; sh = np.zeros((rows * h, cols * w, 3), np.uint8)
for k, f in enumerate(tiles): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
s = min(1.0, 3400 / sh.shape[1]); sh = cv2.resize(sh, None, fx=s, fy=s, interpolation=cv2.INTER_AREA); cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 86]); print(T, "帧，画了", len(idx), "帧", sh.shape)
