"""龟专用的极限姿势检查（prep_rig.py 里那几组是按四足兽的骨骼名写死的，对龟只测到一部分）。
用法: Blender -b --factory-startup V2R/assets/model/turtle.blend -P pose_check.py -- <V2R 绝对路径> <输出目录> [只渲染这几个,逗号分隔]
每个姿势渲染正面、侧面各一张: <输出目录>/turtle_<名字>_{front,side}.png
"""
import math, os, sys
import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
V2R, out = argv[0], argv[1]; only = argv[2].split(",") if len(argv) > 2 else None
sys.path.insert(0, os.path.join(V2R, "scripts/blender"))
import bl_common as bc  # noqa: E402
from v2r import skeleton as sk  # noqa: E402

scene = bpy.context.scene
arm, mesh = bc.character()
skel = sk.Skeleton.load(os.path.join(V2R, "assets/model/turtle_skeleton.json"))
os.makedirs(out, exist_ok=True)
bc.setup_render(scene)
D = {n: k for k, n in enumerate(skel.dof_names)}


def pose(picks, ypr=(0, 0, 0), t=(0, 0, 0), ground=True):
    """picks: [(自由度名里含的字符串, 'lo' | 'hi' | 度数)]"""
    th = np.zeros(skel.D)
    for key, which in picks:
        hit = [k for n, k in D.items() if key in n]
        assert hit, key
        for k in hit: th[k] = skel.dof_lo[k] if which == "lo" else skel.dof_hi[k] if which == "hi" else math.radians(which)
    p = {"theta": th, "ypr": np.radians(ypr), "t": np.array(t, dtype=float)}
    if ground:
        j, _ = skel.pose_joints(th, sk.euler_root(*p["ypr"]), p["t"]); p["t"][2] += sk.ground_lift(skel, j)
    return p


N = ["bone_13", "bone_14", "Head_0"]
tests = {
    "neck_down": pose([(b + ".pitch", "hi") for b in N] + [("Head_1.pitch", "hi")]),
    "neck_up": pose([(b + ".pitch", "lo") for b in N] + [("Head_1.pitch", "lo")]),
    "neck_left": pose([(b + ".yaw", "hi") for b in N] + [("Head_1.yaw", "hi")]),
    "neck_right": pose([(b + ".yaw", "lo") for b in N] + [("Head_1.yaw", "lo")]),
    "neck_s": pose([("bone_13.pitch", "lo"), ("bone_14.pitch", "lo"), ("Head_0.pitch", "hi"), ("Head_1.pitch", "hi")]),      # 缩脖子：根部抬、上段压
    "neck_thrust": pose([("bone_13.pitch", "hi"), ("bone_14.pitch", "hi"), ("Head_0.pitch", "lo"), ("Head_1.pitch", "lo")]),  # 伸脖子撞
    "head_twist": pose([("Head_1.twist", "hi"), ("Head_1.yaw", "lo")]),
    "base_only": pose([("bone_13.pitch", "lo"), ("bone_13.yaw", "hi")]),
    "fold_back": pose([("Limb_1.pitch", "hi"), ("0_Right_Limb_2.pitch", "lo"), ("0_Left_Limb_2.pitch", "lo"), ("1_Right_Limb_2.pitch", "lo"), ("1_Left_Limb_2.pitch", "lo")]),
    "fold_fwd": pose([("Limb_1.pitch", "lo"), ("Limb_2.pitch", "hi")]),
    "legs_out": pose([(".out", "hi")]),
    "legs_twist": pose([(".twist", "hi")]),
    "left_only": pose([("0_Left_Limb_0.fwd", "hi"), ("1_Left_Limb_0.fwd", "lo"), ("0_Left_Limb_1.pitch", 30), ("1_Left_Limb_1.pitch", 30)], ground=False),      # 只动左边两条腿：左前向前、左后向后
    "step": pose([("0_Left_Limb_0.fwd", 35), ("0_Left_Limb_1.pitch", 25), ("0_Right_Limb_0.fwd", -30), ("1_Right_Limb_0.fwd", 35), ("1_Left_Limb_0.fwd", -35), ("1_Left_Limb_1.pitch", 30)]),
    "crouch": pose([("0_Right_Limb_0.fwd", 40), ("0_Left_Limb_0.fwd", 40), ("0_Right_Limb_1.pitch", 65), ("0_Left_Limb_1.pitch", 65), ("0_Right_Limb_2.pitch", -25), ("0_Left_Limb_2.pitch", -25),
                     ("1_Right_Limb_0.out", 30), ("1_Left_Limb_0.out", 30), ("1_Right_Limb_1.pitch", 60), ("1_Left_Limb_1.pitch", 60), ("1_Right_Limb_2.pitch", -30), ("1_Left_Limb_2.pitch", -30)]),
    "rear": pose([("1_Right_Limb_0.fwd", -35), ("1_Left_Limb_0.fwd", -35), ("0_Right_Limb_0.fwd", 30), ("0_Left_Limb_0.fwd", 30), ("0_Right_Limb_1.pitch", 40), ("0_Left_Limb_1.pitch", 40)], ypr=(0, -35, 0)),
    "kneel": pose([("0_Right_Limb_0.fwd", 45), ("0_Left_Limb_0.fwd", 45), ("0_Right_Limb_1.pitch", 70), ("0_Left_Limb_1.pitch", 70), ("bone_13.pitch", "hi"), ("bone_14.pitch", "hi"), ("Head_0.pitch", "hi"), ("Head_1.pitch", 20)], ypr=(0, 14, 0)),
    "turn": pose([("bone_14.yaw", 15), ("Head_1.yaw", 20)], ypr=(50, 0, 10)),
}
for tag, p in tests.items():
    if only and tag not in only: continue
    quats, loc, _ = bc.pose_from_params(skel, p)
    bc.set_pose(arm, skel, quats, loc)
    bc.render_views(scene, os.path.join(out, f"turtle_{tag}_{{view}}.png"))
    print("POSE", tag, "t", np.round(p["t"], 3))
