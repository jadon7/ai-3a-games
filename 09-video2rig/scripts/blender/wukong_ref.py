"""悟空专用：在管线的双机位棚里把角色摆成原来的凉棚站姿，渲染正面 / 侧面，拼成视频参考图（第一帧）。
（照 moba 工程 tools/blender/hero_ref.py 的做法，另加拼图。）

用法: Blender -b --factory-startup assets/model/wukong.blend -P scripts/blender/wukong_ref.py -- <stance.npz> <输出 png>
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_common as bc  # noqa: E402

pose_path, out_png = bc.script_args()[:2]
scene = bpy.context.scene
arm, mesh = bc.character()
m = np.load(pose_path, allow_pickle=True)
for nm, q in zip(m["names"], m["quats"]):
    pb = arm.pose.bones.get(str(nm))
    if pb:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion(q)
arm.pose.bones["mixamorig:Hips"].location = Vector(m["loc"])
bpy.context.view_layer.update()
bc.setup_render(scene, samples=64)
prefix = os.path.splitext(out_png)[0]
paths = bc.render_views(scene, prefix + "_{view}.png")
imgs = [bpy.data.images.load(paths[v]) for v in ("front", "side")]
w, h = imgs[0].size
sep = 4
canvas = np.zeros((h, 2 * w, 4), dtype=np.float32)
canvas[..., 3] = 1
for k, im in enumerate(imgs):
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    canvas[:, k * w:(k + 1) * w] = px
canvas[:, w - sep // 2:w + sep // 2, :3] = 0          # 中间的黑色分隔线
out = bpy.data.images.new("ref", 2 * w, h)
out.pixels = canvas.ravel()
out.filepath_raw = out_png
out.file_format = "PNG"
out.save()
print("RENDERED", out_png, flush=True)
