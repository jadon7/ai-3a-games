#!/usr/bin/env python3
"""把“读到的关节点”（圆点）和“解出来的骨架”（连线）画在视频帧上，快速看读得对不对、解得对不对。不用渲染。
用法: V2R/.venv/bin/python overlay.py <视频> <anim 目录，如 V2R/out/anim/mandrill_run> <输出.jpg> <起始帧> <结束帧> [步长=2] [每行几张=4] [放大=1.0] [motion 文件名=motion.npz]
颜色：左=橙，右=蓝，中线=白。圆点是网络读数（置信度低的画空心），线是求解结果回投。
"""
import json, os, sys
import cv2, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk  # noqa: E402

video, d, out, a, b = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
step = int(sys.argv[6]) if len(sys.argv) > 6 else 2; cols = int(sys.argv[7]) if len(sys.argv) > 7 else 4; zoom = float(sys.argv[8]) if len(sys.argv) > 8 else 1.0
mname = sys.argv[9] if len(sys.argv) > 9 else "motion.npz"
skel = sk.Skeleton.load(os.path.join(V, "assets/model/mandrill_skeleton.json")); jn = skel.joint_names
det = np.load(os.path.join(d, "detections.npz")); obs, conf = det["obs"], det["conf"]
mo = np.load(os.path.join(d, mname), allow_pickle=True) if os.path.exists(os.path.join(d, mname)) else None
proj = sk.project(mo["joints"]).transpose(1, 0, 2, 3) if mo is not None else None           # (T,2,K,2)
COL = {"L": (40, 160, 255), "R": (255, 150, 60), "M": (255, 255, 255)}
LINKS = [("Hips", "Spine1"), ("Spine1", "Spine2"), ("Spine2", "Neck"), ("Neck", "Head"), ("Head", "HeadTop_End")]
for s in ("Left", "Right"):
    LINKS += [("Spine2", s + "Arm"), (s + "Arm", s + "ForeArm"), (s + "ForeArm", s + "Hand"), (s + "Hand", s + "HandMiddle1"), (s + "HandMiddle1", s + "HandMiddle4"),
              ("Hips", s + "UpLeg"), (s + "UpLeg", s + "Leg"), (s + "Leg", s + "Foot"), (s + "Foot", s + "ToeBase"), (s + "ToeBase", s + "Toe_End")]
cap = cv2.VideoCapture(video); tiles = []
for i in range(a, b + 1, step):
    cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, f = cap.read()
    if not ok: break
    f = cv2.resize(f, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_CUBIC); f = (f * 0.6).astype(np.uint8); h, w = f.shape[:2]; hw = w // 2
    for v in range(2):
        x0 = 0 if v == 0 else w - hw
        P = lambda arr, k: (int(round(x0 + arr[i, v, k, 0] * hw)), int(round(arr[i, v, k, 1] * h)))  # noqa: E731
        if proj is not None:
            for n1, n2 in LINKS:
                k1, k2 = jn.index(n1), jn.index(n2); g = skel.joint_group[k2]
                cv2.line(f, P(proj, k1), P(proj, k2), COL[g], 1, cv2.LINE_AA)
        for k, g in enumerate(skel.joint_group):
            c = conf[i, v, k]
            cv2.circle(f, P(obs, k), 3, COL[g], -1 if c >= 0.3 else 1, cv2.LINE_AA)
    cv2.putText(f, str(i), (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2); tiles.append(f)
h, w = tiles[0].shape[:2]; rows = (len(tiles) + cols - 1) // cols; sh = np.full((rows * h, cols * w, 3), 30, np.uint8)
for k, f in enumerate(tiles): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(len(tiles), sh.shape)
