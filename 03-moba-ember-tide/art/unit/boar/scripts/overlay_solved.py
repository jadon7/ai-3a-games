#!/usr/bin/env python3
"""把解算出来的骨架（motion*.npz 里的 joints）回投到视频帧上画成线，抽若干帧拼成一张图；可以同时把网络读数画成小点。
用来对着视频检查：腿有没有解到另一条腿的位置上、头的方向对不对。左腿橙、右腿蓝、中线白。
用法: python overlay_solved.py <视频.mp4> <motion.npz> <输出.jpg> [帧: 0,10,20,… 或 起-止-步长] [列数=4] [detections.npz（可选，画读数）]"""
import sys
import cv2, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk
skel = sk.Skeleton.load(f"{V}/assets/model/boar_skeleton.json"); JN = skel.joint_names; k = JN.index
video, motion, out = sys.argv[1:4]; spec = sys.argv[4] if len(sys.argv) > 4 else "0-120-8"; cols = int(sys.argv[5]) if len(sys.argv) > 5 else 4
det = np.load(sys.argv[6]) if len(sys.argv) > 6 else None
J = np.load(motion, allow_pickle=True)["joints"]; P = sk.project(J).transpose(1, 0, 2, 3)          # (T,2,K,2)
if "-" in spec: a, b, s = map(int, spec.split("-")); frames = list(range(a, b + 1, s))
else: frames = [int(x) for x in spec.split(",")]
CH = [("M", ["TailBase", "Spine0", "Spine1", "Spine2", "Spine3", "Neck", "Head", "Nose"]), ("M", ["Spine3", "Withers"]), ("M", ["Head", "Crest"]), ("L", ["Head", "LeftTusk"]), ("R", ["Head", "RightTusk"])]
for s_, g in (("Left", "L"), ("Right", "R")):
    CH += [(g, [s_ + n for n in ("FShoulder", "FElbow", "FWrist", "FFetlock", "FToe")]), (g, [s_ + n for n in ("HHip", "HKnee", "HHock", "HAnkle", "HToeTip")])]
COL = {"L": (40, 160, 255), "R": (255, 150, 60), "M": (255, 255, 255)}
cap = cv2.VideoCapture(video); tiles = []
for f in frames:
    cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, im = cap.read()
    if not ok: break
    S = 2; im = cv2.resize(im, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC); h, w = im.shape[:2]; hw = w // 2; im = (im * 0.6).astype(np.uint8)
    for v in range(2):
        x0 = 0 if v == 0 else w - hw
        for g, ch in CH:
            pts = [(int(x0 + P[f, v, k(n), 0] * hw), int(P[f, v, k(n), 1] * h)) for n in ch]
            for p, q in zip(pts[:-1], pts[1:]): cv2.line(im, p, q, COL[g], 2, cv2.LINE_AA)
            for p in pts: cv2.circle(im, p, 3, COL[g], -1, cv2.LINE_AA)
        if det is not None:
            for j, g in enumerate(skel.joint_group):
                c = det["conf"][f, v, j]
                if c < 0.15: continue
                p = (int(x0 + det["obs"][f, v, j, 0] * hw), int(det["obs"][f, v, j, 1] * h)); cv2.circle(im, p, 5, (0, 255, 0) if c > 0.5 else (0, 0, 255), 1, cv2.LINE_AA)
    cv2.putText(im, str(f), (10, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2); tiles.append(im[int(h * 0.3):])          # 上面三成是空的，裁掉
h, w = tiles[0].shape[:2]; rows = (len(tiles) + cols - 1) // cols; sh = np.zeros((rows * h, cols * w, 3), np.uint8)
for i, t in enumerate(tiles): sh[(i // cols) * h:(i // cols + 1) * h, (i % cols) * w:(i % cols + 1) * w] = t
s = min(1.0, 2000 / sh.shape[1]); sh = cv2.resize(sh, None, fx=s, fy=s, interpolation=cv2.INTER_AREA); cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 86]); print(out, sh.shape)
