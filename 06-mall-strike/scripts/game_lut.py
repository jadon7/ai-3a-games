"""Bake Blender's exact view transform (AgX + Medium High Contrast, exposure -0.3) into a 3D LUT PNG.
Input shaper: x = (log2(c) + 12) / 19 per channel. Layout: W = N*N (r + N*b), H = N (g, row 0 = top = g=0)."""
import bpy, os, numpy as np, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N = 48
sc = bpy.context.scene
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"
sc.view_settings.exposure = -0.3
sc.view_settings.gamma = 1.0
sc.display_settings.display_device = "sRGB"
xs = np.linspace(0, 1, N)
lin = 2.0 ** (xs * 19 - 12)
img = np.zeros((N, N * N, 4), np.float32)
R, G, B = np.meshgrid(np.arange(N), np.arange(N), np.arange(N), indexing="ij")  # r,g,b
img[G, R + N * B, 0] = lin[R]
img[G, R + N * B, 1] = lin[G]
img[G, R + N * B, 2] = lin[B]
img[..., 3] = 1
im = bpy.data.images.new("lut", N * N, N, alpha=True, float_buffer=True)
im.pixels.foreach_set(img[::-1].ravel())  # blender rows bottom-up
st = sc.render.image_settings
st.file_format = "PNG"; st.color_mode = "RGB"; st.color_depth = "8"; st.compression = 0
out = os.path.join(ROOT, "game", "assets", "lut_agx_mhc.png")
im.save_render(out, scene=sc)
json.dump({"N": N, "lo": -12, "range": 19, "view": "AgX", "look": "AgX - Medium High Contrast", "exposure": -0.3},
          open(out.replace(".png", ".json"), "w"))
print("LUT", out, sc.view_settings.look)
