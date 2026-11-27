#!/usr/bin/env python3
"""看视频定锤的指向用：在每一帧上把读出来的右手位置标出来，画一个半径等于“握点到钟心”的圆和钟点刻度（0 朝上、3 朝右、6 朝下、9 朝左）。
这样只要读“钟在几点钟方向”就能把指向写进 prep_src.py 的 AIM 表。正面机位里右是角色的左手边(+x)，侧面机位里右是角色的前方(-y)。
用法: python vaim.py <动作> <视频> <输出前缀> <起帧> <止帧> <步长> [每张几帧=12]"""
import sys, cv2, numpy as np, math
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk
tag, video, out, a, b, st = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]); per = int(sys.argv[7]) if len(sys.argv) > 7 else 12
skel = sk.Skeleton.load(f"{V}/assets/model/torg_skeleton.json"); n = skel.joint_names
m = np.load(f"{V}/out/anim/torg_{tag}/motion.npz", allow_pickle=True); pr = sk.project(m["joints"]).transpose(1, 0, 2, 3)      # (帧, 机位, 关节, 2)，0..1
cap = cv2.VideoCapture(video); W = int(cap.get(3)); H = int(cap.get(4)); half = W // 2; R = int(0.52 / sk.ORTHO_H * H); frames = list(range(a, b + 1, st)); cells = []
for f in frames:
    cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, im = cap.read(); im = cv2.resize(im, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    for v in (0, 1):
        for jn, col in (("RightHand", (0, 0, 255)), ("LeftHand", (255, 120, 0))):
            x, y = pr[f, v, n.index(jn)]; cx = int((x * half + v * half) * 2); cy = int(y * H * 2); cv2.circle(im, (cx, cy), 5, col, -1)
            if jn == "RightHand":
                cv2.circle(im, (cx, cy), R * 2, (0, 0, 255), 1)
                for k in range(12):
                    an = math.radians(k * 30); p1 = (int(cx + math.sin(an) * R * 2), int(cy - math.cos(an) * R * 2)); cv2.putText(im, str(k), (p1[0] - 6, p1[1] + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
    cv2.putText(im, str(f), (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3); cells.append(im)
for s in range(0, len(cells), per):
    part = cells[s:s + per]; cols = 3; rows = (len(part) + cols - 1) // cols; h, w = part[0].shape[:2]; sh = np.full((rows * h, cols * w, 3), 60, np.uint8)
    for k, im in enumerate(part): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = im
    sh = cv2.resize(sh, None, fx=2000 / sh.shape[1], fy=2000 / sh.shape[1], interpolation=cv2.INTER_AREA); cv2.imwrite(f"{out}_{s // per}.jpg", sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(f"{out}_{s // per}.jpg", sh.shape, frames[s:s + per])
