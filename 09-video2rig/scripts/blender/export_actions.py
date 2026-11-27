"""把多段运动做成同一个骨架上的多个动作，导出成一个 GLB（每个动作是一段 glTF 动画），给网页查看器用。

用法:
  Blender -b --factory-startup assets/model/<name>.blend -P scripts/blender/export_actions.py -- \
      <name> <out.glb> <动作名>=<motion.npz> [<动作名>=<motion.npz> ...] [--blend out.blend]
"""
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_common as bc  # noqa: E402
from v2r import skeleton as sk  # noqa: E402

args = bc.script_args()
name, out_glb = args[0], args[1]
blend_out = None
pairs = []
i = 2
while i < len(args):
    if args[i] == "--blend":
        blend_out = args[i + 1]
        i += 2
    else:
        tag, path = args[i].split("=", 1)
        pairs.append((tag, path))
        i += 1

scene = bpy.context.scene
arm, mesh = bc.character()
skel = sk.Skeleton.load(os.path.join(bc.ROOT, "assets/model", f"{name}_skeleton.json"))
if not arm.animation_data:
    arm.animation_data_create()

max_frames = 1
for tag, path in pairs:
    m = np.load(path, allow_pickle=True)
    quats, loc = m["quats"], m["loc"]
    scene.render.fps = int(m["fps"]) if "fps" in m.files else 24
    T = quats.shape[0]
    max_frames = max(max_frames, T)
    arm.animation_data.action = bpy.data.actions.new(tag)
    for f in range(T):
        bc.set_pose(arm, skel, quats[f], loc[f], frame=f + 1)
    bc.linear_fcurves(arm)
    act = arm.animation_data.action
    act.name = tag
    track = arm.animation_data.nla_tracks.new()
    track.name = tag
    track.strips.new(tag, 1, act)
    arm.animation_data.action = None
    print(f"ACTION {tag}: {T} frames", flush=True)

scene.frame_start, scene.frame_end = 1, max_frames
scene.frame_set(1)
# 回到静止姿态再导出，避免最后一帧的姿态被当成默认姿态
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)

if blend_out:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend_out))
    print("SAVED", blend_out, flush=True)

bpy.ops.object.select_all(action="DESELECT")
root = scene.objects.get("v2r_root")               # 带上摆正用的根节点：导出后角色脚踩地面、面朝 glTF 的 +Z
for o in (arm, mesh, root):
    if o is not None:
        o.select_set(True)
bpy.context.view_layer.objects.active = arm
os.makedirs(os.path.dirname(os.path.abspath(out_glb)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(out_glb), export_format="GLB", use_selection=True,
                          export_animations=True, export_animation_mode="NLA_TRACKS")
print("EXPORTED", out_glb, flush=True)
