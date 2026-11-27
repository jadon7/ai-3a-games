"""后期：边缘径向速度模糊 + 泛光 + 轻微色散 + 暗角 + 轻度手绘感平滑。
用法：python post.py <输入帧目录> <输出帧目录> <速度感 0~1> [workers]
"""
import sys, os, glob
import numpy as np
import cv2
from multiprocessing import Pool

_cache = {}


def masks(h, w):
    key = (h, w)
    if key not in _cache:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        cx, cy = w * 0.5, h * 0.52
        r = np.sqrt(((xx - cx) / (w * 0.5)) ** 2 + ((yy - cy) / (h * 0.5) * (h / w) * 1.25) ** 2)
        t = np.clip((r - 0.30) / (1.0 - 0.30), 0, 1)
        zoom_m = (t * t * (3 - 2 * t))[..., None]
        vig = (1.0 - 0.16 * np.clip((r - 0.45) / 0.75, 0, 1) ** 2)[..., None]
        _cache[key] = (zoom_m, vig, cx, cy)
    return _cache[key]


def process(img, speed):
    h, w = img.shape[:2]
    f = img.astype(np.float32) / 255.0
    zoom_m, vig, cx, cy = masks(h, w)
    # 轻度保边平滑：压掉实时渲染的细碎噪点，色块更干净（手绘感）
    k = h / 1080.0
    f = cv2.bilateralFilter(f, d=int(round(5 * k)) | 1, sigmaColor=0.040, sigmaSpace=3 * k)
    # 径向速度模糊
    if speed > 0.02:
        amt = 0.050 * speed
        n = 9
        acc = np.zeros_like(f)
        for i in range(n):
            s = 1.0 + amt * i / (n - 1)
            M = np.array([[s, 0, (1 - s) * cx], [0, s, (1 - s) * cy]], dtype=np.float32)
            acc += cv2.warpAffine(f, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        acc /= n
        f = f * (1 - zoom_m) + acc * zoom_m
    # 色散（边缘）
    ca = 0.0012 + 0.0010 * speed
    b, g, r = cv2.split(f)
    Mr = np.array([[1 + ca, 0, -ca * cx], [0, 1 + ca, -ca * cy]], dtype=np.float32)
    Mb = np.array([[1 - ca, 0, ca * cx], [0, 1 - ca, ca * cy]], dtype=np.float32)
    r = cv2.warpAffine(r, Mr, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    b = cv2.warpAffine(b, Mb, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    f = cv2.merge([b, g, r])
    # 泛光
    luma = f[..., 0] * 0.114 + f[..., 1] * 0.587 + f[..., 2] * 0.299
    bright = f * np.clip((luma - 0.80) / 0.20, 0, 1)[..., None]
    small = cv2.resize(bright, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    g1 = cv2.GaussianBlur(small, (0, 0), 5 * k)
    g2 = cv2.GaussianBlur(small, (0, 0), 16 * k)
    glow = cv2.resize(g1 * 0.55 + g2 * 0.45, (w, h), interpolation=cv2.INTER_LINEAR)
    f = 1.0 - (1.0 - f) * (1.0 - np.clip(glow * 0.42, 0, 1))      # 滤色叠加
    # 饱和度微调 + 暗角
    gray = (f[..., 0] * 0.114 + f[..., 1] * 0.587 + f[..., 2] * 0.299)[..., None]
    f = gray + (f - gray) * 1.06
    f = f * vig
    return (np.clip(f, 0, 1) * 255.0 + 0.5).astype(np.uint8)


def work(args):
    src, dst, speed = args
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        return src
    out = process(img, speed)
    cv2.imwrite(dst, out, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    return None


if __name__ == '__main__':
    src_dir, dst_dir, speed = sys.argv[1], sys.argv[2], float(sys.argv[3])
    workers = int(sys.argv[4]) if len(sys.argv) > 4 else 8
    os.makedirs(dst_dir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(src_dir, '*.png')))
    jobs = [(f, os.path.join(dst_dir, os.path.basename(f)), speed) for f in files]
    with Pool(workers) as p:
        bad = [b for b in p.imap_unordered(work, jobs, chunksize=4) if b]
    print('POST', len(jobs), 'frames ->', dst_dir, 'failed:', len(bad))
