"""Edge-aware denoise for baked lightmap atlases (joint bilateral guided by the low-noise sun-direct alpha
channel and log-luminance, so sun/shadow edges and island borders survive).
Run: Blender -b --factory-startup -P scripts/game_denoise.py -- in.exr out.exr [radius] [sigma_r]"""
import bpy, sys, os, time
import numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
R = int(argv[2]) if len(argv) > 2 else 4
SR = float(argv[3]) if len(argv) > 3 else 0.18
t0 = time.time()
im = bpy.data.images.load(src)
W, H = im.size
a = np.empty(W * H * 4, np.float32); im.pixels.foreach_get(a); a = a.reshape(H, W, 4)
rgb, sun = a[..., :3], a[..., 3]
L = np.log2(np.maximum(rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32), 1e-4))
valid = (rgb.max(-1) > 1e-5).astype(np.float32)
acc = np.zeros_like(rgb); wsum = np.zeros((H, W), np.float32)
ss = R * 0.6
for dy in range(-R, R + 1):
    for dx in range(-R, R + 1):
        d2 = dx * dx + dy * dy
        if d2 > R * R:
            continue
        sh = lambda x: np.roll(np.roll(x, dy, 0), dx, 1)
        w = np.exp(-d2 / (2 * ss * ss)) * sh(valid)
        w = w * np.exp(-((sh(L) - L) ** 2) / (2 * SR * SR))
        w = w * np.exp(-((sh(sun) - sun) ** 2) / (2 * 0.08 ** 2 + 1e-6))
        acc += sh(rgb) * w[..., None]
        wsum += w
out = a.copy()
m = wsum > 1e-6
out[..., :3][m] = acc[m] / wsum[m][..., None]
o = bpy.data.images.new("dn", W, H, alpha=True, float_buffer=True)
o.pixels.foreach_set(out.ravel())
sc = bpy.context.scene
st = sc.render.image_settings
st.file_format = "OPEN_EXR"; st.color_mode = "RGBA"; st.color_depth = "16"; st.exr_codec = "ZIP"
o.save_render(dst, scene=sc)
print("DENOISED", dst, W, H, f"{time.time() - t0:.1f}s", "noise before/after (std of laplacian):",
      float(np.std(L[1:-1, 1:-1] * 4 - L[:-2, 1:-1] - L[2:, 1:-1] - L[1:-1, :-2] - L[1:-1, 2:])))
