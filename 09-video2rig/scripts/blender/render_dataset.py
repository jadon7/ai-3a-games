"""渲染随机姿势训练集：每个样本从正面、侧面各渲染一张，并记录每个关节的精确位置。

约一半样本带速度（前后各偏移一帧的姿势），靠 EEVEE 的运动模糊渲染出快速运动的拖影。

用法:
  Blender -b --factory-startup assets/model/<name>.blend -P scripts/blender/render_dataset.py -- \
      <name> <out_dir> <样本数> <随机种子> [起始编号] [rear]
最后加 rear：这一批以“人立”为主（四足用，补训练集里陡峭站姿的覆盖）。
产出: <out_dir>/{front,side}/00000.jpg ... 和 <out_dir>/labels_<起始编号>.npz
"""
import os
import shutil
import sys
import time

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_common as bc  # noqa: E402
from v2r import skeleton as sk  # noqa: E402

args = bc.script_args()
name, out_dir, n, seed = args[0], os.path.abspath(args[1]), int(args[2]), int(args[3])      # 绝对路径：Windows 上 Blender 会把相对的输出路径当成盘符根目录下的
start = int(args[4]) if len(args) > 4 else 0
mode = args[5] if len(args) > 5 else ""
W, H = 448, 504                                   # 8:9，正好是 14 的整数倍（DINOv2 的 patch 大小）
MIN_FREE_GB = 1.5                                 # 磁盘可用空间低于这个值就停，避免把系统盘写满

scene = bpy.context.scene
arm, mesh = bc.character()
skel = sk.Skeleton.load(os.path.join(bc.ROOT, "assets/model", f"{name}_skeleton.json"))
if mode == "rear":
    skel.sampling = {**skel.sampling, "pitch_uniform": [0.85, -88, -35]}
bc.setup_render(scene, W, H, samples=20, fmt="JPEG", quality=95)
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 1.0            # 快门跨满一帧：模糊量完全由速度决定
scene.render.motion_blur_position = "CENTER"
scene.eevee.motion_blur_steps = 5
for v in sk.VIEWS:
    os.makedirs(os.path.join(out_dir, v), exist_ok=True)

rng = np.random.default_rng(seed)
poses, speeds = [], []
t0 = time.time()
for i in range(n):
    pose = sk.sample_pose(skel, rng)
    vel = sk.sample_velocity(skel, rng)
    center_q = None
    for off in (0, -1, 1):                         # 先算中间帧，前后两帧的四元数符号向它对齐
        quats, loc, _ = bc.pose_from_params(skel, sk.offset_pose(skel, pose, vel, off))
        if off == 0:
            center_q = quats
        else:
            flip = np.sum(quats * center_q, axis=1) < 0
            quats[flip] *= -1
        bc.set_pose(arm, skel, quats, loc, frame=3 * i + 2 + off)
    poses.append(pose)
    speeds.append(vel["speed"])
nf = bc.linear_fcurves(arm)
print(f"KEYED {n} samples in {time.time() - t0:.1f}s, fcurves set linear: {nf}", flush=True)

joints_all = np.zeros((n, skel.K, 3))
proj_all = np.zeros((n, 2, skel.K, 2))
label_path = os.path.join(out_dir, f"labels_{start:05d}.npz")


def save_labels(count):
    np.savez(
        label_path,
        index=np.arange(start, start + count),
        joints=joints_all[:count],
        proj=proj_all[:count],
        theta=np.array([p["theta"] for p in poses[:count]]),
        ypr=np.array([p["ypr"] for p in poses[:count]]),
        t=np.array([p["t"] for p in poses[:count]]),
        speed=np.array(speeds[:count]),
        joint_names=np.array(skel.joint_names),
        joint_group=np.array(skel.joint_group),
    )


t0 = time.time()
done = 0
for i in range(n):
    if i % 25 == 0 and shutil.disk_usage(out_dir).free < MIN_FREE_GB * 1e9:
        print(f"STOP 磁盘可用空间低于 {MIN_FREE_GB}GB，已渲染 {i} 个样本后停止", flush=True)
        break
    scene.frame_set(3 * i + 2)
    joints = bc.read_joints(arm, skel)
    joints_all[i] = joints
    proj_all[i] = sk.project(joints)
    bc.render_views(scene, os.path.join(out_dir, "{view}", f"{start + i:05d}.jpg"))
    done = i + 1
    if done % 50 == 0 or done == n:
        save_labels(done)                          # 边渲边存标签，中途停掉也不白渲
        dt = time.time() - t0
        print(f"RENDERED {done}/{n}  {dt / done:.2f}s/sample  eta {(n - done) * dt / done / 60:.1f}min", flush=True)

if done:
    save_labels(done)
print("DONE", out_dir, done, flush=True)
