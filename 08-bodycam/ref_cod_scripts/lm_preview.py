import os, sys
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2, numpy as np
src, dst = sys.argv[1], sys.argv[2]
crop = [int(v) for v in sys.argv[3].split(",")] if len(sys.argv) > 3 else None
im = cv2.imread(src, cv2.IMREAD_UNCHANGED).astype(np.float32)
print(src, im.shape, "rgb max", im[..., :3].max(), "mean", im[..., :3].mean(), "a max", im[..., 3].max())
if crop:
    x, y, w, h = crop; im = im[y:y + h, x:x + w]
rgb = im[..., :3] * 0.6
rgb = rgb / (1 + rgb)
a = np.clip(im[..., 3] / 8, 0, 1)
top = (np.clip(rgb, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)
bot = cv2.cvtColor((a ** (1 / 2.2) * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
out = np.concatenate([top, bot], axis=1)
s = min(1.0, 2400 / out.shape[1])
out = cv2.resize(out, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
cv2.imwrite(dst, out)
