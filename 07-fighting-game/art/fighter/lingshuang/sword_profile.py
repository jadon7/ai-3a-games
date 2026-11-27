"""从武器设定图（weapon_concept.png，水平、刀尖朝右）量出刀的侧面轮廓：每一列的上沿、下沿（像素），存 work/sword_profile.npz，并出一张核对图。
背景有暗角，先用刀所在横带以外的像素拟合一个二次曲面当背景，再按色差分割。"""
import numpy as np
from PIL import Image
from scipy import ndimage
im = np.asarray(Image.open('weapon_concept.png').convert('RGB')).astype(np.float32); H, W = im.shape[:2]
g = im.mean(2); yy, xx = np.mgrid[0:H, 0:W]; sel = (yy < 560) | (yy > 900)
s = (slice(None, None, 7))
X = np.stack([np.ones_like(xx), xx / W, yy / H, (xx / W) ** 2, (yy / H) ** 2, xx * yy / W / H], -1).astype(np.float32)
A = X[sel][::37]; b = g[sel][::37]; coef = np.linalg.lstsq(A, b, rcond=None)[0]; bgv = X @ coef
d = np.abs(g - bgv) + np.abs(im[..., 2] - im[..., 0]) * 1.5          # 灰度差 + 偏蓝（柄绳、刃口）
m = d > 9
m = ndimage.binary_opening(m, iterations=1); m = ndimage.binary_closing(m, iterations=2)
lab, n = ndimage.label(m); sizes = ndimage.sum(m, lab, range(1, n + 1)); m = lab == (1 + int(np.argmax(sizes)))
m = ndimage.binary_fill_holes(m) | (lab == 0) & False
cols = np.nonzero(m.any(0))[0]; x0, x1 = cols.min(), cols.max()
top = np.full(W, -1.0); bot = np.full(W, -1.0)
for x in range(x0, x1 + 1):
    c = np.nonzero(m[:, x])[0]
    if len(c): top[x] = c.min(); bot[x] = c.max()
np.savez('work/sword_profile.npz', top=top, bot=bot, x0=x0, x1=x1, mask=m)
print('x range', x0, x1)
for x in range(x0, x1 + 1, 40): print(x, top[x], bot[x], bot[x] - top[x])
vis = im.copy(); vis[m] = vis[m] * 0.5 + np.array([255, 0, 0]) * 0.5
Image.fromarray(vis.astype(np.uint8)).crop((0, 500, W, 1000)).save('work/sword_mask.jpg')
