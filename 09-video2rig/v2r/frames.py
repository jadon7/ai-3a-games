"""双机位画面的拼接与拆分。"""
import numpy as np
from PIL import Image

DIVIDER = 2  # 中间分隔线宽度（像素，按 1280 宽计）


def compose(front, side, divider=True):
    """把正面、侧面两张同尺寸的图左右拼成一张 16:9 的图。"""
    w, h = front.size
    out = Image.new("RGB", (w * 2, h))
    out.paste(front.convert("RGB"), (0, 0))
    out.paste(side.convert("RGB"), (w, 0))
    if divider:
        px = out.load()
        d = max(1, round(DIVIDER * (w * 2) / 1280))
        for x in range(w - d // 2 - (d % 2), w + d // 2):
            for y in range(h):
                px[x, y] = (20, 20, 20)
    return out


def split(frame):
    """把 16:9 的拼接画面（PIL 图或 HxWx3 数组）拆回 (front, side)。"""
    if isinstance(frame, Image.Image):
        w, h = frame.size
        return frame.crop((0, 0, w // 2, h)), frame.crop((w - w // 2, 0, w, h))
    w = frame.shape[1]
    return frame[:, : w // 2], frame[:, w - w // 2:]
