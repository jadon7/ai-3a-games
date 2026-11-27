#!/usr/bin/env python3
"""cmp_sheet.py 的放大版：只看下半截画面，每帧正面、侧面各放大 3 倍，骨架线加粗并标出左右。用法: cmp_zoom.py <视频> <motion.npz> <输出.jpg> 帧,帧,… [画面上沿从几成高度开始裁=0.35] [帧号偏移：motion 的第 0 帧对应视频第几帧=0]"""
import json, sys
import cv2
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk  # noqa: E402
video, motion, out = sys.argv[1:4]; frames = [int(x) for x in sys.argv[4].split(",")]; top = float(sys.argv[5]) if len(sys.argv) > 5 else 0.35; off = int(sys.argv[6]) if len(sys.argv) > 6 else 0
m = np.load(motion, allow_pickle=True); J = m["joints"]; jn = [j["name"] for j in json.load(open(V + "/assets/model/troll_skeleton.json"))["joints"]]; I = jn.index
E = [("Hips", "Spine1", "M"), ("Spine1", "Spine2", "M"), ("Spine2", "Neck", "M"), ("Neck", "Head", "M"), ("Head", "HeadTop_End", "M")]
for s, c in (("Left", "L"), ("Right", "R")):
    E += [("Spine2", s + "Arm", c), (s + "Arm", s + "ForeArm", c), (s + "ForeArm", s + "Hand", c), (s + "Hand", s + "HandMiddle1", c), (s + "HandMiddle1", s + "HandMiddle4", c),
          ("Hips", s + "UpLeg", c), (s + "UpLeg", s + "Leg", c), (s + "Leg", s + "Foot", c), (s + "Foot", s + "ToeBase", c), (s + "ToeBase", s + "Toe_End", c)]
COL = {"L": (40, 160, 255), "R": (255, 150, 60), "M": (255, 255, 255)}; P2 = sk.project(J).transpose(1, 0, 2, 3); cap = cv2.VideoCapture(video); rows = []; S = 3
for f in frames:
    cap.set(cv2.CAP_PROP_POS_FRAMES, f + off); ok, im = cap.read(); h, w = im.shape[:2]; hw = w // 2; tiles = []
    for v in range(2):
        x0 = 0 if v == 0 else w - hw; sub = cv2.resize(im[:, x0:x0 + hw], None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC); sub = (sub * 0.7).astype(np.uint8)
        pt = lambda k: (int(round(P2[f, v, k, 0] * hw * S)), int(round(P2[f, v, k, 1] * h * S)))  # noqa: E731
        for a, b, c in E: cv2.line(sub, pt(I(a)), pt(I(b)), COL[c], 3, cv2.LINE_AA)
        for k in range(len(jn)): cv2.circle(sub, pt(k), 4, (0, 0, 0), -1, cv2.LINE_AA)
        sub = sub[int(top * h * S):]; cv2.putText(sub, f"{f + off} {'front' if v == 0 else 'side'}", (8, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2); tiles.append(sub)
    rows.append(np.hstack(tiles))
n = len(rows); cols = 2 if n > 1 else 1; rows += [np.zeros_like(rows[0])] * ((-n) % cols)
sh = np.vstack([np.hstack(rows[i:i + cols]) for i in range(0, len(rows), cols)]); s = min(1.0, 2600 / sh.shape[1]); sh = cv2.resize(sh, None, fx=s, fy=s, interpolation=cv2.INTER_AREA); cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(out, sh.shape)
