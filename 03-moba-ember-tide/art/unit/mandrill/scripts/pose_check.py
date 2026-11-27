"""山魈专用的极限姿势检查（prep_rig.py 对两足只测握拳和三个随机姿势）。
用法: Blender -b --factory-startup V2R/assets/model/mandrill.blend -P pose_check.py -- <输出目录> [只渲染这几个,逗号分隔]
每个姿势渲染正面、侧面各一张: <输出目录>/p_<名字>_{front,side}.png，并打印最高点、最前点（看举手、前探会不会出画面）。
"""
import math, os, sys
import bpy
import numpy as np
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, os.path.join(V2R, "scripts/blender"))
import bl_common as bc  # noqa: E402
from v2r import skeleton as sk  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]; only = argv[1].split(",") if len(argv) > 1 else None
scene = bpy.context.scene; arm, mesh = bc.character()
skel = sk.Skeleton.load(os.path.join(V2R, "assets/model/mandrill_skeleton.json"))
os.makedirs(out, exist_ok=True); bc.setup_render(scene)
D = {n: k for k, n in enumerate(skel.dof_names)}


def pose(picks, ypr=(0, 0, 0), t=(0, 0, 0), ground=True):
    """picks: {自由度名里含的字符串: 'lo' | 'hi' | 度数}；名字以 ^ 开头表示从头匹配（^Arm 不会匹配到 ForeArm）"""
    th = np.zeros(skel.D)
    for key, which in picks.items():
        hit = [k for n, k in D.items() if (n.replace("Left", "").replace("Right", "").startswith(key[1:]) if key.startswith("^") else key in n)]
        assert hit, key
        for k in hit: th[k] = skel.dof_lo[k] if which == "lo" else skel.dof_hi[k] if which == "hi" else math.radians(which)
    th = np.clip(th, skel.dof_lo, skel.dof_hi)
    p = {"theta": th, "ypr": np.radians(ypr), "t": np.array(t, dtype=float)}
    if ground:
        j, _ = skel.pose_joints(th, sk.euler_root(*p["ypr"]), p["t"]); p["t"][2] += sk.ground_lift(skel, j)
    return p


tests = {
    "rest": pose({}),
    "arms_up": pose({"^Arm.fwd": 175, "ForeArm.hinge": -30, "Spine.pitch": -15, "Spine1.pitch": -15, "Spine2.pitch": -15, "Head.pitch": -20, "Neck.pitch": -15}, ypr=(0, -12, 0)),      # 双臂举过头顶、上身后仰（普攻蓄力）
    "arms_up_max": pose({"^Arm.fwd": "hi", "ForeArm.hinge": "lo", "Shoulder.up": "hi"}),
    "arms_fwd": pose({"^Arm.fwd": 95, "ForeArm.hinge": -35}),                                                    # 双臂前平举
    "arms_out": pose({"^Arm.out": 80, "ForeArm.hinge": -35}),                                                    # 双臂侧平举
    "arms_back": pose({"^Arm.fwd": "lo", "ForeArm.hinge": 40}),
    "slam": pose({"^Arm.fwd": 70, "ForeArm.hinge": -25, "Spine.pitch": 20, "Spine1.pitch": 20, "Spine2.pitch": 20, "UpLeg.fwd": 35, "Leg.hinge": 25, "Head.pitch": -15}, ypr=(0, 38, 0)),   # 弯腰砸地
    "bow_max": pose({"Spine.pitch": "hi", "Spine1.pitch": "hi", "Spine2.pitch": "hi", "Neck.pitch": "hi", "Head.pitch": "hi"}),
    "arch_max": pose({"Spine.pitch": "lo", "Spine1.pitch": "lo", "Spine2.pitch": "lo", "Neck.pitch": "lo", "Head.pitch": "lo"}),
    "leg_up": pose({"LeftUpLeg.fwd": 60, "LeftLeg.hinge": 50, "RightUpLeg.fwd": -25}, ground=True),                # 抬左腿
    "leg_back": pose({"LeftUpLeg.fwd": "lo", "LeftLeg.hinge": "hi", "RightUpLeg.fwd": 30}),
    "legs_out": pose({"UpLeg.out": "hi"}), "legs_in": pose({"UpLeg.out": "lo"}),
    "run_a": pose({"LeftUpLeg.fwd": 45, "LeftLeg.hinge": 30, "RightUpLeg.fwd": -45, "RightLeg.hinge": 20, "RightArm.fwd": 75, "LeftArm.fwd": -35, "RightForeArm.hinge": 20, "UpLeg.out": -20}, ypr=(0, 12, 0)),
    "kneel": pose({"UpLeg.fwd": -45, "Leg.hinge": 55, "Foot.pitch": 30, "^Arm.fwd": 55, "ForeArm.hinge": -30, "Spine1.pitch": 15, "Spine2.pitch": 15, "Head.pitch": 25, "Neck.pitch": 15, "UpLeg.out": -15}, ypr=(0, 30, 0)),   # 跪地撑手垂头（死亡结尾）
    "head_turn": pose({"Head.yaw": "hi", "Neck.yaw": "hi"}), "head_roll": pose({"Head.roll": "hi", "Neck.roll": "hi"}),
    "twist": pose({"Spine.yaw": "hi", "Spine1.yaw": "hi", "Spine2.yaw": "hi", "Spine1.roll": "hi"}),
    "fist": pose({".curl": "hi", ".thumb": "hi"}), "open": pose({".curl": "lo", ".thumb": "lo"}),
    "arm_twist": pose({"^Arm.twist": "hi", "ForeArm.twist": "hi", "Hand.fwd": "hi"}),
    "scratch": pose({"RightArm.fwd": 60, "RightForeArm.hinge": 80, "RightArm.out": -20}),                         # 右手抓胸口（待机）
    "shrug": pose({"Shoulder.up": "hi", "Shoulder.fwd": "hi"}),
    "foot": pose({"LeftFoot.pitch": "hi", "RightFoot.pitch": "lo", "LeftToeBase.pitch": "hi", "RightToeBase.pitch": "lo"}, ground=False),
}
for tag, p in tests.items():
    if only and tag not in only: continue
    quats, loc, joints = bc.pose_from_params(skel, p)
    bc.set_pose(arm, skel, quats, loc)
    bc.render_views(scene, os.path.join(out, f"p_{tag}_{{view}}.png"))
    print("POSE %-12s t=%s 最高点 z=%.2f（画面上沿 1.66） 最前 y=%.2f 最后 y=%.2f 左右 |x|=%.2f（画面边 0.80）" % (tag, np.round(p["t"], 3), joints[:, 2].max(), joints[:, 1].min(), joints[:, 1].max(), np.abs(joints[:, 0]).max()), flush=True)
