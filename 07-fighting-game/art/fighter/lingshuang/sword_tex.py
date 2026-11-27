"""霜刃的贴图：从武器设定图裁出整把刀（work/sword_profile.npz 的遮罩），刀外面的背景用最近的刀上像素填满（免得边上一圈灰），
存 work/sword_base.png（基础色，2048×256）和 work/sword_mr.png（glTF 的金属度/粗糙度：G 粗糙度、B 金属度），
以及 work/sword_crop.json（裁剪范围，gear.py 换算 UV 用）。用 V2R 的 Python 跑。"""
import json, numpy as np
from PIL import Image
from scipy import ndimage
p = np.load('work/sword_profile.npz'); m = p['mask']
im = np.asarray(Image.open('weapon_concept.png').convert('RGB')).astype(np.float32)
X0, X1, Y0, Y1 = 135, 2616, 648, 892
crop = im[Y0:Y1, X0:X1]; mk = m[Y0:Y1, X0:X1]
mk_in = ndimage.binary_erosion(mk, iterations=2)
_, (iy, ix) = ndimage.distance_transform_edt(~mk_in, return_indices=True)
fill = crop[iy, ix]
TW, TH = 2048, 256
base = Image.fromarray(fill.astype(np.uint8)).resize((TW, TH), Image.LANCZOS); base.save('work/sword_base.png')
# 金属度 / 粗糙度：柄绳（偏蓝、暗）是布，其余是金属；刃口那一侧（偏亮的雾面）粗糙度略高
r, g, b = fill[..., 0], fill[..., 1], fill[..., 2]; lum = fill.mean(2)
cord = ((b - r) > 14) & (lum < 110)
cord = ndimage.binary_opening(cord, iterations=1)
xs = np.arange(X0, X1)[None, :].repeat(Y1 - Y0, 0)
cord &= (xs > 270) & (xs < 740)
metal = np.where(cord, 0.0, 1.0)
rough = np.where(cord, 0.82, 0.26 + 0.12 * np.clip((lum - 150) / 80, 0, 1))
rough = np.where((~cord) & (xs < 775), 0.38, rough)                     # 刀镡、环首、柄头：旧银，粗一点
mr = np.stack([np.ones_like(lum) * 255, rough * 255, metal * 255], -1).astype(np.uint8)
Image.fromarray(mr).resize((TW, TH), Image.BILINEAR).save('work/sword_mr.png')
json.dump({"x0": X0, "x1": X1, "y0": Y0, "y1": Y1, "W": 2752, "H": 1536}, open('work/sword_crop.json', 'w'))
print('ok', base.size, 'cord px', int(cord.sum()))
