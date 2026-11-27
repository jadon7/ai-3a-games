"""每个顶点在贴图上的颜色和 ORM（遮蔽、粗糙度、金属度），存成 npz，用来把铁甲（金属度高）和毛分开。
顶点顺序和 dump_weights.py 一样（Blender 导入后的 mesh.data.vertices）。
用法: Blender -b --factory-startup -P vertex_tex.py -- <rigged.glb> <out.npz>"""
import sys
import bpy
import numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene
mesh = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
me = mesh.data
uv = np.zeros((len(me.loops), 2)); me.uv_layers.active.data.foreach_get("uv", uv.reshape(-1))
lv = np.zeros(len(me.loops), dtype=int); me.loops.foreach_get("vertex_index", lv)
vuv = np.zeros((len(me.vertices), 2)); cnt = np.zeros(len(me.vertices))
np.add.at(vuv, lv, uv); np.add.at(cnt, lv, 1); vuv /= np.maximum(cnt, 1)[:, None]
mat = mesh.material_slots[0].material
out = {"uv": vuv}
for n in mat.node_tree.nodes:
    if n.type == "TEX_IMAGE" and n.image:
        im = n.image; w, h = im.size; px = np.zeros(w * h * 4, dtype=np.float32); im.pixels.foreach_get(px); px = px.reshape(h, w, 4)
        x = np.clip((vuv[:, 0] % 1.0) * w, 0, w - 1).astype(int); y = np.clip((vuv[:, 1] % 1.0) * h, 0, h - 1).astype(int)
        key = "orm" if "ORM" in im.name else "normal" if "Normal" in im.name else "color"
        out[key] = px[y, x, :3]; print("TEX", im.name, key, w, h)
np.savez(argv[1], **out); print("SAVED", argv[1])
