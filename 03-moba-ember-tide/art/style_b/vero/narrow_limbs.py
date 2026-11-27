"""薇萝 B 风格连弩：把 Tripo 出的弩的两片弩臂往里收（只收横向，弩身不动）。
用法: Blender -b --factory-startup -P art/style_b/vero/narrow_limbs.py -- <in.glb> <out.glb> [k=0.5] [w0=0.045]
为什么：即梦的 B 风格弩图里弩臂张得很开，Tripo 照着出的弩横向宽 0.875（长 1.0）；旧弩只有 0.23。
旧动作是照窄弩做的（腰侧端弩、胸前横抱、跑步），宽成那样两片弩臂会插进身子和腿里；按真实的弩又太窄看不出是弩。
取中间：离中线 w0 以外的顶点横向距离乘 k（弩身半宽约 0.04，不动；弓弦跟着弩臂一起收）。
坐标照 glTF 导入 Blender 后：长轴 Y（弩口在 -Y），弩臂张开的方向 X，上 +Z（灯罐在 -Z）。
"""
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]; k = float(argv[2]) if len(argv) > 2 else 0.5; w0 = float(argv[3]) if len(argv) > 3 else 0.045
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
o = next(o for o in bpy.context.scene.objects if o.type == "MESH")
mw = o.matrix_world.copy(); mi = mw.inverted(); n = 0
for v in o.data.vertices:
    w = mw @ v.co
    if abs(w.x) > w0:
        w.x = (w0 + (abs(w.x) - w0) * k) * (1 if w.x > 0 else -1); v.co = mi @ w; n += 1
o.data.update()
# 木头压一点饱和、暗一点（w-vs 第二轮）：Tripo 的木头是很饱和的橙棕 (199,101,32)，游戏里薇萝的饱和度、提亮调高以后成了一根亮橙色的棍子，
# 比她身上的深红还抢眼，在红土上又和地面同色相。收成和她的靴子一路的暖棕，黄铜（色相 38° 以上）、矢尖和灯罐的火光（很亮很饱和）不动。
import numpy as np, colorsys
for im in bpy.data.images:
    if not im.name.startswith("Color"): continue
    W, H = im.size; px = np.array(im.pixels[:], dtype=np.float32).reshape(-1, 4); rgb = px[:, :3]
    mx, mn = rgb.max(1), rgb.min(1); s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0); d = np.maximum(mx - mn, 1e-6)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    hue = np.where(mx == r, (g - b) / d % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    wood = (hue > 10) & (hue < 34) & (s > 0.4) & (mx > 0.18) & ~((mx > 0.85) & (s > 0.8))
    lum = rgb @ np.array([0.3, 0.55, 0.15], dtype=np.float32)
    new = (lum[:, None] + (rgb - lum[:, None]) * 0.72) * 0.86
    rgb[wood] = new[wood]; px[:, :3] = rgb; im.pixels[:] = px.ravel(); im.update()
    print("WOOD recolored", int(wood.sum()), "of", len(px), "pixels in", im.name)
xs = [(mw @ v.co).x for v in o.data.vertices]
print("NARROW moved", n, "of", len(o.data.vertices), "x span now", round(max(xs) - min(xs), 3))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=False, export_animations=False)
print("SAVED", out)
