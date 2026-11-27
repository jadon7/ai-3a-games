"""量一下模型底座的厚度：看靠外圈的顶点在高度上聚在哪里。
用法: Blender -b --factory-startup -P tools/blender/slab_probe.py -- a.glb b.glb ...
"""
import bpy, sys
import numpy as np
for src in sys.argv[sys.argv.index("--") + 1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    pts = []
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            m = o.matrix_world
            pts += [tuple(m @ v.co) for v in o.data.vertices]
    p = np.array(pts); p[:, 2] -= p[:, 2].min(); H = p[:, 2].max()
    cx, cy = (p[:, 0].min() + p[:, 0].max()) / 2, (p[:, 1].min() + p[:, 1].max()) / 2
    hx, hy = (p[:, 0].max() - p[:, 0].min()) / 2, (p[:, 1].max() - p[:, 1].min()) / 2
    edge = np.maximum(np.abs(p[:, 0] - cx) / hx, np.abs(p[:, 1] - cy) / hy)
    rim = p[edge > 0.9]
    hist, bins = np.histogram(rim[:, 2] / H, bins=20, range=(0, 0.4))
    print("PROBE", src.split("/")[-1], "H", round(H, 3), "footprint", round(hx * 2 / H, 3), round(hy * 2 / H, 3), "rim_max_y", round(float(rim[:, 2].max() / H), 3), "rim_hist", hist.tolist())
