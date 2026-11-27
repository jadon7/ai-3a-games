"""对着狼的骨架摆几个有针对性的极限姿势并渲染（共用的 prep_rig.py 里那几组姿势是按四足兽的骨骼名写死的，对狼只生效一部分）。
用法: Blender -b --factory-startup V2R/assets/model/wolf.blend -P pose_tests.py -- <name> <输出目录> [只跑哪几个 ...]
每个姿势出 <输出目录>/<name>_t_<tag>_{front,side}.png；另外把跟踪点的投影存成 <name>_t_restj.npy（draw_joints.py 用）。"""
import math, os, sys
import bpy, numpy as np
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, os.path.join(V2R, "scripts/blender"))
import bl_common as bc
from v2r import skeleton as sk
name, out = bc.script_args()[:2]; os.makedirs(out, exist_ok=True)
scene = bpy.context.scene; arm, mesh = bc.character()
skel = sk.Skeleton.load(os.path.join(V2R, "assets/model", f"{name}_skeleton.json"))
D = {n: k for k, n in enumerate(skel.dof_names)}
# 简写：前腿 LF/RF = [肩胛, 上臂, 前臂, 掌, 爪]，后腿 LH/RH = [大腿, 小腿, 跖, 爪]
LF = ["bone_4.fwd", "0_Left_Limb_0.fwd", "0_Left_Limb_1.pitch", "0_Left_Limb_2.pitch", "0_Left_Limb_3.pitch"]
RF = ["0_Right_Limb_0.fwd", "0_Right_Limb_1.fwd", "0_Right_Limb_2.pitch", "0_Right_Limb_3.pitch", "0_Right_Limb_4.pitch"]
LH = ["1_Left_Limb_0.fwd", "1_Left_Limb_1.pitch", "1_Left_Limb_2.pitch", "1_Left_Limb_3.pitch"]
RH = ["1_Right_Limb_0.fwd", "1_Right_Limb_1.pitch", "1_Right_Limb_2.pitch", "1_Right_Limb_3.pitch"]


def leg(names, vals):
    return {n: v for n, v in zip(names, vals) if v is not None}


def pose(tag, deg, ypr=(0, 0, 0), ground=True):
    p = {"theta": np.zeros(skel.D), "ypr": np.radians(ypr), "t": np.zeros(3)}
    for key, v in deg.items():
        assert key in D, key
        p["theta"][D[key]] = math.radians(v)
    if ground:
        j, _ = skel.pose_joints(p["theta"], sk.euler_root(*p["ypr"]), p["t"]); p["t"][2] = sk.ground_lift(skel, j)
    quats, loc, joints = bc.pose_from_params(skel, p); bc.set_pose(arm, skel, quats, loc)
    bc.render_views(scene, os.path.join(out, f"{name}_t_{tag}_{{view}}.png")); print("POSE", tag, "top z %.3f" % joints[:, 2].max(), flush=True)
    return joints


only = set(bc.script_args()[2:])
tests = {
 "L_front_up": ({**leg(LF, [10, 45, -60, 90, 40])}, (0, 0, 0)),                    # 只动左前腿：抬起、屈肘、屈腕
 "R_front_up": ({**leg(RF, [10, 45, -60, 90, 40])}, (0, 0, 0)),                    # 只动右前腿（核对左右）
 "R_hind_up": ({**leg(RH, [40, 60, -70, 40])}, (0, 0, 0)),                         # 只动右后腿：收腿
 "L_hind_back": ({**leg(LH, [-50, -20, 30, 30])}, (0, 0, 0)),                      # 只动左后腿：后蹬
 "head_down": ({"Spine_3.neck_pitch": 22, "Head_2.pitch": 30}, (0, 0, 0)),
 "head_up": ({"Spine_3.neck_pitch": -16, "Head_2.pitch": -30}, (0, 0, 0)),
 "head_yaw_roll": ({"Spine_3.neck_yaw": 20, "Head_2.yaw": 30, "Head_2.roll": 20}, (0, 0, 0)),          # 头向左转并歪头
 "neck_roll": ({"Spine_3.neck_roll": 8, "Head_2.roll": -30}, (0, 0, 0)),
 "lie": ({**leg(LF, [0, 0, -92, 0, 88]), **leg(RF, [0, 5, -95, 0, 88]), **leg(LH, [54, 99, -130, 88]), **leg(RH, [54, 99, -130, 88]),
          "Spine_3.neck_pitch": 8, "Head_2.pitch": 15, "bone_23.tailA_pitch": -15}, (0, -8, 0)),                   # 死亡的结尾：四条腿折起、胸口贴地、头垂下
 "kneel": ({**leg(LF, [0, 0, -92, 0, 88]), **leg(RF, [0, 5, -95, 0, 88]), **leg(LH, [20, 25, -15, 5]), **leg(RH, [20, 25, -15, 5]),
            "Spine_3.neck_pitch": 0, "Head_2.pitch": 0}, (0, 24, 0)),                                              # 前腿跪下、后腿还站着
 "bow": ({**leg(LF, [0, -30, -45, 5, -15]), **leg(RF, [0, -28, -48, 5, -15]), **leg(LH, [10, 25, -20, 0]), **leg(RH, [10, 25, -20, 0]),
          "Spine_3.neck_pitch": -6, "Head_2.pitch": -12, "Spine_0.spine_pitch": -5}, (0, 12, 0)),                   # 攻击前：前半身压低
 "gallop_ext": ({**leg(LF, [15, 60, -10, -10, -30]), **leg(RF, [12, 45, -5, -10, -30]), **leg(LH, [-55, -25, 35, 40]), **leg(RH, [-45, -15, 30, 40]),
                 "Spine_0.spine_pitch": -9, "Spine_3.neck_pitch": -6, "Head_2.pitch": -8, "bone_23.tailA_pitch": 55, "Tail_0.tailB_pitch": -4}, (0, -4, 0)),     # 奔跑：伸展
 "gallop_gather": ({**leg(LF, [-12, -45, -60, 70, 50]), **leg(RF, [-10, -35, -80, 90, 50]), **leg(LH, [55, 20, -40, -20]), **leg(RH, [60, 40, -60, -10]),
                    "Spine_0.spine_pitch": 12, "Spine_3.neck_pitch": 6, "bone_23.tailA_pitch": 45}, (0, 6, 0)),                                                   # 奔跑：收拢
 "spine_yaw": ({"Spine_0.spine_yaw": 10, "Spine_0.spine_twist": 6}, (0, 0, 0)),
 "tail_side": ({"bone_23.tailA_yaw": 35, "Tail_0.tailB_yaw": 12}, (0, 0, 0)),
 "tail_up": ({"bone_23.tailA_pitch": 75, "Tail_0.tailB_pitch": 14}, (0, 0, 0)),
 "legs_out": ({"0_Left_Limb_0.out": 30, "0_Right_Limb_1.out": 30, "1_Left_Limb_0.out": 30, "1_Right_Limb_0.out": 30,
               "0_Left_Limb_0.twist": 15, "1_Right_Limb_0.twist": 15}, (0, 0, 0)),
 "turned": ({"Spine_3.neck_yaw": -15, "Head_2.yaw": -25, **leg(LF, [0, 30, -30, 30, 0]), **leg(RH, [0, 30, 30, -30])}, (40, 0, 0)),   # 整体转 40°，看斜着的样子
}
for tag, (deg, ypr) in tests.items():
    if only and tag not in only: continue
    pose(tag, deg, ypr)
# 静止姿势 + 跟踪点
quats, loc, joints = bc.pose_from_params(skel, {"theta": np.zeros(skel.D), "ypr": np.zeros(3), "t": np.zeros(3)}); bc.set_pose(arm, skel, quats, loc)
paths = bc.render_views(scene, os.path.join(out, f"{name}_t_restj_{{view}}.png"))
np.save(os.path.join(out, f"{name}_t_restj.npy"), sk.project(bc.read_joints(arm, skel)))
print("DONE", flush=True)
