"""看 / 修模型底色贴图里“会被游戏当成发光青纹”的像素。
游戏的角色材质（src/map/hero/hero.ts 的 tune）把 min(g,b) - 1.2*r 超过 0.10 的像素当成青色纹路让它自己发光（英雄身上的潮纹）。
山魈腋下、肋侧、上臂内侧这些静止时被挡住的地方，Tripo 补出来的贴图偏青灰，举起手臂时会亮成一片浅蓝。
用法: Blender -b --factory-startup <mandrill.blend> -P tex_glow.py -- stat <输出预览.jpg>          只统计、出预览（发光的像素涂红）
      Blender -b --factory-startup <mandrill.blend> -P tex_glow.py -- fix  <输出预览.jpg>          把这些像素的青色压回灰褐色，存回 .blend
"""
import bpy, sys
import numpy as np
mode, out = sys.argv[sys.argv.index("--") + 1:][:2]
img = next(i for i in bpy.data.images if i.name.startswith("Color_")); w, h = img.size
px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
lin = px[..., :3]
srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 1e-9, None) ** (1 / 2.4) - 0.055)      # 游戏着色器里 diffuseColor 是线性的，两种都统计
for name, c in (("线性", lin), ("sRGB", srgb)):
    ex = np.minimum(c[..., 1], c[..., 2]) - 1.2 * c[..., 0]
    print(f"GLOW {name}: 超过 0.10 的像素 {float((ex > 0.10).mean()) * 100:.2f}%，超过 0.05 的 {float((ex > 0.05).mean()) * 100:.2f}%，超过 0 的 {float((ex > 0).mean()) * 100:.2f}%，最大 {float(ex.max()):.3f}", flush=True)
ex = np.minimum(lin[..., 1], lin[..., 2]) - 1.2 * lin[..., 0]
if mode == "fix":
    # 目标：ex <= 0.03（离 0.10 的门槛留余量）。只降 g、b，往 r 靠，亮度基本不变
    over = ex > 0.03; m = np.minimum(lin[..., 1], lin[..., 2]); target = 1.2 * lin[..., 0] + 0.03
    k = np.where(over, target / np.maximum(m, 1e-6), 1.0)[..., None]                    # g、b 一起乘 k（<1）
    new = lin.copy(); new[..., 1:3] = lin[..., 1:3] * k
    lum0 = lin @ np.array([0.3, 0.55, 0.15], dtype=np.float32); lum1 = new @ np.array([0.3, 0.55, 0.15], dtype=np.float32)
    new *= np.where(over, lum0 / np.maximum(lum1, 1e-6), 1.0)[..., None]               # 亮度补回来
    ex2 = np.minimum(new[..., 1], new[..., 2]) - 1.2 * new[..., 0]
    print(f"FIXED 改了 {float(over.mean()) * 100:.2f}% 的像素；改完以后超过 0.10 的 {float((ex2 > 0.10).mean()) * 100:.3f}%，最大 {float(ex2.max()):.3f}", flush=True)
    px[..., :3] = np.clip(new, 0, 1); img.pixels.foreach_set(px.ravel()); img.update(); img.pack(); lin = px[..., :3]
    bpy.ops.wm.save_mainfile(); print("SAVED", bpy.data.filepath, flush=True)
# 预览：缩到 1024，发光的像素涂红
s = 4; small = lin[::s, ::s]; e = ex[::s, ::s]; prev = np.where(small <= 0.0031308, small * 12.92, 1.055 * np.clip(small, 1e-9, None) ** (1 / 2.4) - 0.055)
if mode == "stat": prev[e > 0.10] = (1, 0, 0); prev[(e > 0.03) & (e <= 0.10)] = (1, 0.6, 0)
o = bpy.data.images.new("prev", prev.shape[1], prev.shape[0]); o.pixels.foreach_set(np.concatenate([prev, np.ones(prev.shape[:2] + (1,), np.float32)], -1).ravel().astype(np.float32))
o.filepath_raw = out; o.file_format = "JPEG"; o.save(); print("PREVIEW", out)
