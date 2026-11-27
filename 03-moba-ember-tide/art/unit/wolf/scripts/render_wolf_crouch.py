"""狼的补充训练图：趴下、前腿跪下、后腿坐下这几类“贴地”的姿势（死亡动作要用）。

共用的 render_dataset.py 每个关节各自随机，四条腿同时深折、身体贴地的样本几乎抽不到，网络没见过趴着的狼。
这里照着 render_dataset.py 写了一份（渲染设置、标签格式完全一样，训练时和那 1600 组一起读），只把“怎么摆姿势”换掉：
  底子还是 sk.sample_pose 的随机姿势（头、尾、脊柱、整体朝向、水平位移都用它的），再把四条腿和整体俯仰改成
  趴下 / 前跪 / 后坐 三类之一，折叠程度在 35%~100% 之间随机（也就覆盖了从站着到趴下的中间过程）。
用法（在 video2rig 目录里）:
  Blender -b --factory-startup assets/model/wolf.blend -P <本脚本> -- wolf <out_dir> <样本数> <随机种子> <起始编号>
环境变量 V2R 可以指定 video2rig 的位置（本机试跑用）；不给就认为本脚本放在 video2rig/wolf_extra/ 下面。
"""
import math
import os
import shutil
import sys
import time

import bpy
import numpy as np

V2R = os.environ.get("V2R") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(V2R, "scripts", "blender"))
import bl_common as bc  # noqa: E402
from v2r import skeleton as sk  # noqa: E402

args = bc.script_args()
name, out_dir, n, seed, start = args[0], os.path.abspath(args[1]), int(args[2]), int(args[3]), int(args[4])
W, H = 448, 504
MIN_FREE_GB = 1.5

scene = bpy.context.scene
arm, mesh = bc.character()
skel = sk.Skeleton.load(os.path.join(bc.ROOT, "assets/model", f"{name}_skeleton.json"))
bc.setup_render(scene, W, H, samples=20, fmt="JPEG", quality=95)
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 1.0
scene.render.motion_blur_position = "CENTER"
scene.eevee.motion_blur_steps = 5
for v in sk.VIEWS:
    os.makedirs(os.path.join(out_dir, v), exist_ok=True)

D = {nm: k for k, nm in enumerate(skel.dof_names)}
JN = skel.joint_names
# 每条腿的自由度名：前腿 [肩胛, 上臂 fwd, 上臂 out, 上臂 twist, 前臂, 掌, 爪]，后腿 [大腿 fwd, out, twist, 小腿, 跖, 爪]
FRONT = {"L": ["bone_4.fwd", "0_Left_Limb_0.fwd", "0_Left_Limb_0.out", "0_Left_Limb_0.twist", "0_Left_Limb_1.pitch", "0_Left_Limb_2.pitch", "0_Left_Limb_3.pitch"],
         "R": ["0_Right_Limb_0.fwd", "0_Right_Limb_1.fwd", "0_Right_Limb_1.out", "0_Right_Limb_1.twist", "0_Right_Limb_2.pitch", "0_Right_Limb_3.pitch", "0_Right_Limb_4.pitch"]}
HIND = {"L": ["1_Left_Limb_0.fwd", "1_Left_Limb_0.out", "1_Left_Limb_0.twist", "1_Left_Limb_1.pitch", "1_Left_Limb_2.pitch", "1_Left_Limb_3.pitch"],
        "R": ["1_Right_Limb_0.fwd", "1_Right_Limb_0.out", "1_Right_Limb_0.twist", "1_Right_Limb_1.pitch", "1_Right_Limb_2.pitch", "1_Right_Limb_3.pitch"]}
FRONT_FOLD = [(-8, 8), (-25, 25), (-5, 20), (-10, 10), (-112, -65), (-15, 35), (40, 95)]        # 前臂平放在地上：屈肘 90° 上下，爪跟着翻回水平
FRONT_PROP = [(-8, 8), (-20, 30), (-5, 15), (-8, 8), (-40, 0), (-10, 20), (-15, 15)]           # 前腿撑着
HIND_FOLD = [(35, 65), (-5, 25), (-10, 10), (65, 105), (-135, -85), (45, 95)]                 # 后腿折在身下
HIND_STAND = [(0, 30), (-5, 15), (-8, 8), (0, 40), (-40, 10), (-10, 20)]                     # 后腿还站着
LOW = [JN.index(s + j) for s in ("Left", "Right") for j in ("FElbow", "FWrist", "FFetlock", "HKnee", "HHock", "HAnkle")]
SHO = [JN.index(s + "FShoulder") for s in ("Left", "Right")]
HIP = [JN.index(s + "HHip") for s in ("Left", "Right")]
ROOTJ = JN.index("Root")


def crouch_pose(rng):
    p = sk.sample_pose(skel, rng)
    th = p["theta"]
    kind = rng.choice(["lie", "kneel", "sit"], p=[0.5, 0.3, 0.2])
    a = rng.uniform(0.35, 1.0)

    def put(names, ranges):
        for nm, (lo, hi) in zip(names, ranges):
            th[D[nm]] = math.radians(rng.uniform(lo, hi)) * a + rng.normal(0, math.radians(3))

    for s in ("L", "R"):
        put(FRONT[s], FRONT_PROP if kind == "sit" else FRONT_FOLD)
        put(HIND[s], HIND_STAND if kind == "kneel" else HIND_FOLD)
    pitch = {"lie": rng.uniform(-14, 8), "kneel": rng.uniform(10, 32), "sit": rng.uniform(-35, -10)}[kind] * a
    if rng.random() < 0.5:                                    # 一半样本头垂着（死亡的结尾）
        th[D["Spine_3.neck_pitch"]] = math.radians(rng.uniform(0, 22))
        th[D["Head_2.pitch"]] = math.radians(rng.uniform(0, 45))
    th[:] = np.clip(th, skel.dof_lo, skel.dof_hi)
    yaw = p["ypr"][0] if rng.random() < 0.3 else rng.normal(0, math.radians(12))      # 视频里它基本正对着镜头
    roll = float(np.clip(rng.normal(0, math.radians(5)), -math.radians(15), math.radians(15)))
    p["ypr"] = np.array([yaw, math.radians(pitch), roll])
    p["t"][2] = 0.0
    j, _ = skel.pose_joints(th, sk.euler_root(*p["ypr"]), p["t"])
    gi = skel.ground_idx
    lift = float(np.max(skel.joint_rest[gi, 2] - j[gi, 2]))                             # 爪子不低于站着时的高度
    lift = max(lift, float(np.max(0.02 - j[LOW, 2])),                                   # 肘、腕、膝、飞节不到地面以下
               float(np.max(0.12 - j[SHO, 2])), float(np.max(0.10 - j[HIP, 2])), 0.09 - float(j[ROOTJ, 2]))      # 胸口、臀、肚子贴地为止（尾巴不管，落在地上）
    p["t"][2] = lift
    return p


rng = np.random.default_rng(seed)
poses, speeds = [], []
t0 = time.time()
for i in range(n):
    pose = crouch_pose(rng)
    vel = sk.sample_velocity(skel, rng)
    vel = {k: (v * 0.5 if k != "speed" else v) for k, v in vel.items()}       # 倒下、趴着的时候动得慢，模糊减半
    center_q = None
    for off in (0, -1, 1):
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
        save_labels(done)
        dt = time.time() - t0
        print(f"RENDERED {done}/{n}  {dt / done:.2f}s/sample  eta {(n - done) * dt / done / 60:.1f}min", flush=True)

if done:
    save_labels(done)
print("DONE", out_dir, done, flush=True)
