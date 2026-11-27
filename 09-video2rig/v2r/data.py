"""训练数据：读渲染好的图和标签，做“像 Seedance 一样”的退化增强。"""
import glob
import os

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

from .model import IN_H, IN_W, MEAN, STD

cv2.setNumThreads(0)


def load_labels(root):
    files = sorted(glob.glob(os.path.join(root, "labels_*.npz")))
    assert files, f"{root} 里没有标签文件"
    parts = [np.load(f, allow_pickle=True) for f in files]
    return {
        "index": np.concatenate([p["index"] for p in parts]),
        "proj": np.concatenate([p["proj"] for p in parts]).astype(np.float32),     # (N,2,K,2)
        "speed": np.concatenate([p["speed"] for p in parts]),
        "joint_names": [str(s) for s in parts[0]["joint_names"]],
        "joint_group": [str(s) for s in parts[0]["joint_group"]],
    }


def to_tensor(img_bgr):
    x = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    x = (x - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
    return torch.from_numpy(np.ascontiguousarray(x.transpose(2, 0, 1)))


def prep_view(img_bgr):
    """推理用：把单个机位的画面缩放到网络输入尺寸并归一化。"""
    if img_bgr.shape[1] != IN_W or img_bgr.shape[0] != IN_H:
        interp = cv2.INTER_AREA if img_bgr.shape[0] > IN_H else cv2.INTER_CUBIC
        img_bgr = cv2.resize(img_bgr, (IN_W, IN_H), interpolation=interp)
    return to_tensor(img_bgr)


# ---- 增强 ------------------------------------------------------------------------
def _ground_fx(img, rng, feet_y):
    """Seedance 会自己加地面阴影、裂纹、扬尘、碎石——随机画一些类似的东西上去。"""
    h, w = img.shape[:2]
    out = img.astype(np.float32)
    gy = int(np.clip(feet_y, 0.35, 0.98) * h)
    n = rng.integers(0, 4)
    for _ in range(n):                                           # 柔和的阴影 / 尘土团
        layer = np.zeros((h, w), np.float32)
        cx, cy = int(rng.uniform(0.1, 0.9) * w), gy + int(rng.normal(0, 0.03) * h)
        ax, ay = int(rng.uniform(0.08, 0.45) * w), int(rng.uniform(0.01, 0.10) * h)
        cv2.ellipse(layer, (cx, cy), (max(ax, 2), max(ay, 2)), 0, 0, 360, 1.0, -1)
        layer = cv2.GaussianBlur(layer, (0, 0), rng.uniform(4, 22))
        alpha = layer[..., None] * rng.uniform(0.15, 0.6)
        if rng.random() < 0.5:
            color = np.array([rng.uniform(30, 90)] * 3, np.float32)                       # 阴影
        else:
            color = np.array([150, 170, 185], np.float32) + rng.normal(0, 12, 3)          # 尘土（BGR）
        out = out * (1 - alpha) + color * alpha
    if rng.random() < 0.3:                                       # 地面裂纹 / 地平线
        for _ in range(rng.integers(1, 6)):
            x0, x1 = sorted(rng.integers(0, w, 2))
            y = gy + int(rng.normal(0, 0.02) * h)
            cv2.line(out, (int(x0), y), (int(x1), y + int(rng.normal(0, 4))),
                     [float(rng.uniform(40, 120))] * 3, int(rng.integers(1, 3)), cv2.LINE_AA)
    if rng.random() < 0.25:                                      # 飞溅的碎石
        for _ in range(rng.integers(5, 40)):
            x, y = int(rng.uniform(0, w)), gy - int(abs(rng.normal(0, 0.08)) * h)
            cv2.circle(out, (x, y), int(rng.integers(1, 4)), [float(rng.uniform(40, 130))] * 3, -1, cv2.LINE_AA)
    return np.clip(out, 0, 255).astype(np.uint8)


def augment(img, coords, rng):
    """img: BGR uint8 (IN_H, IN_W)；coords: (K,2) 归一化坐标。返回增强后的图和坐标。"""
    h, w = img.shape[:2]
    # 1) 取景漂移：缩放 / 轻微旋转 / 平移（Seedance 的机位不会完全不动）
    s = rng.uniform(0.82, 1.2)
    ang = rng.normal(0, 2.0)
    tx, ty = rng.normal(0, 0.04) * w, rng.normal(0, 0.04) * h
    M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, s)
    M[:, 2] += (tx, ty)
    img = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    px = coords * np.array([w, h], np.float32)
    px = px @ M[:, :2].T.astype(np.float32) + M[:, 2].astype(np.float32)
    coords = px / np.array([w, h], np.float32)

    # 2) 地面特效
    img = _ground_fx(img, rng, float(coords[:, 1].max()) + 0.01)

    # 3) 光照和颜色
    x = img.astype(np.float32) / 255.0
    if rng.random() < 0.5:                                       # 背景上的明暗渐变
        gx, gy = np.meshgrid(np.linspace(-1, 1, w, dtype=np.float32), np.linspace(-1, 1, h, dtype=np.float32))
        a = rng.uniform(0, 2 * np.pi)
        x *= (1 + rng.uniform(0.03, 0.15) * (np.cos(a) * gx + np.sin(a) * gy))[..., None]
    x = x * rng.uniform(0.8, 1.25) + rng.uniform(-0.06, 0.12)    # 亮度（Seedance 的背景普遍更亮）
    mean = x.mean()
    x = (x - mean) * rng.uniform(0.75, 1.35) + mean              # 对比度
    grey = x.mean(axis=2, keepdims=True)
    x = grey + (x - grey) * rng.uniform(0.55, 1.35)              # 饱和度
    x = x * rng.uniform(0.94, 1.06, 3).astype(np.float32)        # 轻微偏色
    x = np.clip(x, 0, 1) ** rng.uniform(0.75, 1.35)              # gamma
    img = (np.clip(x, 0, 1) * 255).astype(np.uint8)

    # 4) 清晰度：480p 的软、压缩块、噪点
    if rng.random() < 0.75:
        f = rng.uniform(0.45, 0.95)
        small = cv2.resize(img, (max(8, int(w * f)), max(8, int(h * f))), interpolation=cv2.INTER_AREA)
        img = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC if rng.random() < 0.5 else cv2.INTER_LINEAR)
    if rng.random() < 0.35:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.4, 1.4))
    if rng.random() < 0.7:
        ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(25, 92))])
        img = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    if rng.random() < 0.4:
        img = np.clip(img.astype(np.float32) + rng.normal(0, rng.uniform(1, 5), img.shape), 0, 255).astype(np.uint8)

    # 5) 画面边缘的分隔线
    if rng.random() < 0.3:
        xe = 0 if rng.random() < 0.5 else w - int(rng.integers(1, 4))
        img[:, xe:xe + int(rng.integers(1, 4))] = int(rng.integers(0, 60))
    return img, coords.astype(np.float32)


class JointDataset(Dataset):
    """每个样本是单个机位的一张图。"""

    def __init__(self, root, indices, train=True, seed=0):
        self.root, self.train, self.seed = root, train, seed
        lab = load_labels(root)
        self.items = [(int(lab["index"][i]), v, lab["proj"][i, v]) for i in indices for v in (0, 1)]
        self.epoch = 0

    def __len__(self):
        return len(self.items)

    def __getitem__(self, n):
        idx, v, coords = self.items[n]
        img = cv2.imread(os.path.join(self.root, ("front", "side")[v], f"{idx:05d}.jpg"), cv2.IMREAD_COLOR)
        if img.shape[1] != IN_W or img.shape[0] != IN_H:
            img = cv2.resize(img, (IN_W, IN_H), interpolation=cv2.INTER_AREA)
        coords = coords.copy()
        if self.train:
            rng = np.random.default_rng((self.seed, self.epoch, n))
            img, coords = augment(img, coords, rng)
        return to_tensor(img), torch.from_numpy(coords), v
