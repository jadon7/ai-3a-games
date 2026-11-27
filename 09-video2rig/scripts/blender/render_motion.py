"""把一段运动（每帧每根骨骼的四元数 + 根骨骼位移）放到骨架上，可渲染双机位画面、存 .blend、导出 GLB。

用法:
  Blender -b --factory-startup assets/model/<name>.blend -P scripts/blender/render_motion.py -- \
      <name> <motion.npz> [--frames <输出目录>] [--blend <out.blend>] [--glb <out.glb>] \
      [--size W H] [--shutter 0.5] [--action 名字]
motion.npz 需要有 quats (T,n_bones,4)、loc (T,3)，可选 fps。
"""
import argparse
import os
import sys
import time

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_common as bc  # noqa: E402
from v2r import skeleton as sk  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("name")
ap.add_argument("motion")
ap.add_argument("--frames")
ap.add_argument("--blend")
ap.add_argument("--glb")
ap.add_argument("--size", type=int, nargs=2, default=[640, 720])
ap.add_argument("--shutter", type=float, default=0.5)
ap.add_argument("--action", default="v2r_motion")
ap.add_argument("--samples", type=int, default=24)
a = ap.parse_args(bc.script_args())

scene = bpy.context.scene
arm, mesh = bc.character()
skel = sk.Skeleton.load(os.path.join(bc.ROOT, "assets/model", f"{a.name}_skeleton.json"))
m = np.load(a.motion, allow_pickle=True)
quats, loc = m["quats"], m["loc"]
fps = int(m["fps"]) if "fps" in m.files else 24
T = quats.shape[0]

scene.render.fps = fps
scene.frame_start, scene.frame_end = 1, T
if arm.animation_data and arm.animation_data.action:
    arm.animation_data.action = None
t0 = time.time()
for f in range(T):
    bc.set_pose(arm, skel, quats[f], loc[f], frame=f + 1)
if arm.animation_data and arm.animation_data.action:
    arm.animation_data.action.name = a.action
bc.linear_fcurves(arm)
print(f"KEYED {T} frames in {time.time() - t0:.1f}s", flush=True)

if a.frames:
    bc.setup_render(scene, a.size[0], a.size[1], samples=a.samples, fmt="JPEG", quality=93)
    scene.render.use_motion_blur = a.shutter > 0
    scene.render.motion_blur_shutter = max(a.shutter, 0.01)
    scene.render.motion_blur_position = "CENTER"
    scene.eevee.motion_blur_steps = 4
    for v in sk.VIEWS:
        os.makedirs(os.path.join(a.frames, v), exist_ok=True)
    t0 = time.time()
    for f in range(T):
        scene.frame_set(f + 1)
        bc.render_views(scene, os.path.join(a.frames, "{view}", f"{f:04d}.jpg"))
    print(f"RENDERED {T} frames in {time.time() - t0:.1f}s -> {a.frames}", flush=True)

scene.frame_set(1)
if a.blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.blend))
    print("SAVED", a.blend, flush=True)
if a.glb:
    bpy.ops.object.select_all(action="DESELECT")
    for o in (arm, mesh):
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.glb), export_format="GLB", use_selection=True,
                              export_animations=True, export_frame_range=True)
    print("EXPORTED", a.glb, flush=True)
