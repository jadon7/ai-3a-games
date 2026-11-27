#!/usr/bin/env python3
"""把解出来的骨架（火柴人）画回视频帧上，拼成一张图，看解得对不对（左右腿有没有认反、膝盖弯没弯、手在哪）。

用法: V2R/.venv/bin/python cmp_sheet.py <视频.mp4> <motion.npz> <输出.jpg> [帧号,帧号,… 或 起:止:步长] [每行几张=6] [detections.npz：顺手把读数画成小点]
左腿左臂橙色、右腿右臂蓝色、躯干白色（和管线的叠加图一个配色）。
"""
import json, sys
import cv2
import numpy as np

V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, V)
from v2r import skeleton as sk  # noqa: E402

video, motion, out = sys.argv[1:4]
m = np.load(motion, allow_pickle=True); J = m["joints"]; T = len(J)
spec = sys.argv[4] if len(sys.argv) > 4 else "0:%d:5" % T
frames = list(range(*[int(x) for x in spec.split(":")])) if ":" in spec else [int(x) for x in spec.split(",")]
cols = int(sys.argv[5]) if len(sys.argv) > 5 else 6
det = np.load(sys.argv[6]) if len(sys.argv) > 6 else None
jn = [j["name"] for j in json.load(open(V + "/assets/model/troll_skeleton.json"))["joints"]]
I = jn.index
E = [("Hips", "Spine1", "M"), ("Spine1", "Spine2", "M"), ("Spine2", "Neck", "M"), ("Neck", "Head", "M"), ("Head", "HeadTop_End", "M")]
for s, c in (("Left", "L"), ("Right", "R")):
    E += [("Spine2", s + "Arm", c), (s + "Arm", s + "ForeArm", c), (s + "ForeArm", s + "Hand", c), (s + "Hand", s + "HandMiddle1", c), (s + "HandMiddle1", s + "HandMiddle4", c),
          ("Hips", s + "UpLeg", c), (s + "UpLeg", s + "Leg", c), (s + "Leg", s + "Foot", c), (s + "Foot", s + "ToeBase", c), (s + "ToeBase", s + "Toe_End", c)]
COL = {"L": (40, 160, 255), "R": (255, 150, 60), "M": (255, 255, 255)}
P2 = sk.project(J).transpose(1, 0, 2, 3)                       # (T,2,K,2)
cap = cv2.VideoCapture(video); tiles = []
for f in frames:
    cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, im = cap.read()
    if not ok: continue
    h, w = im.shape[:2]; hw = w // 2; S = 2; im = cv2.resize(im, (w * S, h * S), interpolation=cv2.INTER_CUBIC); im = (im * 0.75).astype(np.uint8)
    for v in range(2):
        x0 = 0 if v == 0 else (w - hw)
        pt = lambda k: (int(round((x0 + P2[f, v, k, 0] * hw) * S)), int(round(P2[f, v, k, 1] * h * S)))  # noqa: E731
        for a, b, c in E: cv2.line(im, pt(I(a)), pt(I(b)), COL[c], 2, cv2.LINE_AA)
        if det is not None:
            for k in range(len(jn)):
                if det["conf"][f, v, k] < 0.15: continue
                g = "L" if jn[k].startswith("Left") else "R" if jn[k].startswith("Right") else "M"
                cv2.circle(im, (int(round((x0 + det["obs"][f, v, k, 0] * hw) * S)), int(round(det["obs"][f, v, k, 1] * h * S))), 3, COL[g], -1, cv2.LINE_AA)
                cv2.circle(im, (int(round((x0 + det["obs"][f, v, k, 0] * hw) * S)), int(round(det["obs"][f, v, k, 1] * h * S))), 4, (0, 0, 0), 1, cv2.LINE_AA)
    cv2.putText(im, str(f), (10, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2); tiles.append(im)
h, w = tiles[0].shape[:2]; rows = (len(tiles) + cols - 1) // cols; sh = np.zeros((rows * h, cols * w, 3), np.uint8)
for k, t in enumerate(tiles): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = t
s = min(1.0, 2000 / sh.shape[1]); sh = cv2.resize(sh, None, fx=s, fy=s, interpolation=cv2.INTER_AREA); cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(out, sh.shape)
