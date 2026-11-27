# EXR 8k -> Radiance HDR 4k： Blender -b -P convert_hdri.py -- in.exr out.hdr 4096 2048
# 用 Blender 读 EXR，自己写 RGBE（Blender 自带的 HDR 保存会做色彩转换并把太阳亮度压到 56，不能用）
import bpy, sys
import numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
src, dst, w, h = a[0], a[1], int(a[2]), int(a[3])
img = bpy.data.images.load(src)
img.colorspace_settings.name = 'Non-Color'          # 原样读取线性数值
sw, sh = img.size
px = np.empty(sw * sh * 4, np.float32); img.pixels.foreach_get(px)
px = px.reshape(sh, sw, 4)[..., :3]
fy, fx = sh // h, sw // w
assert sh == h * fy and sw == w * fx
small = px.reshape(h, fy, w, fx, 3).astype(np.float64).mean(axis=(1, 3))   # 面积平均，保持能量
print('max', float(px.max()), '->', float(small.max()), 'mean', float(px.mean()), float(small.mean()))
top = small[::-1]                                                           # Blender 像素自下而上，HDR 自上而下
m = top.max(axis=2)
mant, e = np.frexp(np.maximum(m, 1e-38))
scale = np.where(m > 1e-32, 256.0 / np.ldexp(1.0, e), 0.0)
rgbe = np.zeros((h, w, 4), np.uint8)
rgbe[..., :3] = np.clip(np.floor(top * scale[..., None]), 0, 255).astype(np.uint8)
rgbe[..., 3] = np.where(m > 1e-32, e + 128, 0).astype(np.uint8)
# 新式 RLE 容器，全部用"非重复段"（每段最多 128 字节），任何读取器都能正确识别
assert w % 128 == 0 and 8 <= w < 32768
ch = np.transpose(rgbe, (0, 2, 1)).reshape(h, 4, w // 128, 128)
body = np.concatenate([np.full((h, 4, w // 128, 1), 128, np.uint8), ch], axis=3).reshape(h, -1)
head = np.tile(np.array([2, 2, w >> 8, w & 255], np.uint8), (h, 1))
with open(dst, 'wb') as f:
    f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + f'-Y {h} +X {w}\n'.encode())
    f.write(np.concatenate([head, body], axis=1).tobytes())
print('saved', dst)
