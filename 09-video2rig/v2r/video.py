"""视频读写、读关节、画叠加图。"""
import os
import subprocess

import cv2
import numpy as np
import torch

from . import skeleton as sk
from .data import prep_view
from .model import decode

COLORS_BGR = {"L": (40, 160, 255), "R": (255, 150, 60), "M": (255, 255, 255)}   # 左=橙，右=蓝，中=白


def read_frames(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    return frames, fps


def split_views(frame):
    w = frame.shape[1]
    return frame[:, : w // 2], frame[:, w - w // 2:]


def frames_to_clip(front_dir, side_dir, out_path, size=(854, 480), fps=24, crf=23):
    """把正面 / 侧面两组帧左右拼起来，压成和 Seedance 样片同规格的 mp4。"""
    names = sorted(os.listdir(front_dir))
    hw, h = size[0] // 2, size[1]
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{hw * 2}x{h}", "-r", str(fps),
           "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(crf), out_path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for n in names:
        f = cv2.resize(cv2.imread(os.path.join(front_dir, n)), (hw, h), interpolation=cv2.INTER_AREA)
        s = cv2.resize(cv2.imread(os.path.join(side_dir, n)), (hw, h), interpolation=cv2.INTER_AREA)
        frame = np.hstack([f, s])
        frame[:, hw - 1:hw + 1] = 20
        p.stdin.write(frame.tobytes())
    p.stdin.close()
    p.wait()
    return len(names)


def write_clip(frames, out_path, fps=24, crf=20):
    h, w = frames[0].shape[:2]
    w2, h2 = w - w % 2, h - h % 2
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w2}x{h2}", "-r", str(fps),
           "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(crf), out_path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for f in frames:
        p.stdin.write(np.ascontiguousarray(f[:h2, :w2]).tobytes())
    p.stdin.close()
    p.wait()


@torch.no_grad()
def read_joints(net, frames, device, batch=16):
    """逐帧读两个机位里每个关节的位置。返回 obs (T,2,K,2) 归一化坐标、conf (T,2,K)。"""
    T = len(frames)
    obs, conf = [], []
    for s in range(0, T, batch):
        xs = []
        for f in frames[s:s + batch]:
            a, b = split_views(f)
            xs += [prep_view(a), prep_view(b)]
        c, p = decode(net(torch.stack(xs).to(device)))
        obs.append(c.reshape(-1, 2, c.shape[1], 2).numpy())
        conf.append(p.reshape(-1, 2, p.shape[1]).numpy())
    return np.concatenate(obs), np.concatenate(conf)


def draw_joints(frame, coords, conf, groups, glow=True, radius=5):
    """在拼接画面上把两个机位的关节点画出来（发光小圆点，颜色区分左 / 右 / 中线）。"""
    h, w = frame.shape[:2]
    hw = w // 2
    base = (frame.astype(np.float32) * 0.45) if glow else frame.astype(np.float32)
    layer = np.zeros_like(base)
    for v in range(2):
        x0 = 0 if v == 0 else w - hw
        for k, g in enumerate(groups):
            if conf is not None and conf[v, k] < 0.15:
                continue
            x, y = x0 + coords[v, k, 0] * hw, coords[v, k, 1] * h
            a = 1.0 if conf is None else float(np.clip(conf[v, k], 0.3, 1))
            cv2.circle(layer, (int(round(x)), int(round(y))), radius, [c * a for c in COLORS_BGR[g]], -1, cv2.LINE_AA)
    if glow:
        layer = layer + 1.6 * cv2.GaussianBlur(layer, (0, 0), radius * 1.6)
    return np.clip(base + layer, 0, 255).astype(np.uint8)


def view_consistency(obs, conf, thr=0.3):
    """两个机位是不是同一个动作：同一关节在左右画面里的高度应该一致。返回每帧的平均高度差（世界单位）。"""
    both = (conf[:, 0] > thr) & (conf[:, 1] > thr)
    dz = np.abs(obs[:, 0, :, 1] - obs[:, 1, :, 1]) * sk.ORTHO_H
    per_frame = np.array([dz[i][both[i]].mean() if both[i].any() else np.nan for i in range(len(obs))])
    return per_frame, both.mean(axis=1)
