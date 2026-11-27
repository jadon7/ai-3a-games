import bpy, numpy as np, os
bpy.ops.wm.read_factory_settings(use_empty=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "assets/tripo/rifle/gen_model_url.glb"))
o = next(o for o in bpy.data.objects if o.type == "MESH")
n = len(o.data.vertices); co = np.empty(n * 3); o.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
M = np.array(o.matrix_world); co = co @ M[:3, :3].T + M[:3, 3]
print("bbox min", co.min(0).round(3), "max", co.max(0).round(3))
ys = np.linspace(co[:, 1].min(), co[:, 1].max(), 21)
for a, b in zip(ys[:-1], ys[1:]):
    s = co[(co[:, 1] >= a) & (co[:, 1] < b)]
    if len(s): print(f"y {a:+.3f}..{b:+.3f}  n={len(s):6d}  z {s[:,2].min():+.3f}..{s[:,2].max():+.3f}  x {s[:,0].min():+.3f}..{s[:,0].max():+.3f}")
