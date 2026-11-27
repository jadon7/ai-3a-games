"""对着卡兹的骨架摆几个有针对性的极限姿势并渲染（共用 prep_rig.py 里那几组是按四足兽的骨骼名写死的）。照狼的 art/unit/wolf/scripts/pose_tests.py 改。
用法: Blender -b --factory-startup V2R/assets/model/kaz.blend -P pose_tests.py -- kaz <输出目录> [只跑哪几个 ...]
每个姿势出 <输出目录>/kaz_t_<tag>_{front,side}.png；另外存一份跟踪点投影 kaz_t_restj.npy。
注意符号：大腿用的是世界轴 pitch（正 = 腿往后摆），和狼的 fwd（正 = 往前）相反；其余腿关节 pitch 正 = 末端往后。"""
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
# 前腿 LF/RF = [肩胛, 上臂, 前臂(肘), 掌(腕), 爪]，后腿 LH/RH = [大腿(pitch 正=后摆), 小腿(膝), 跖(飞节), 爪]
LF = ["0_Left_Limb_0.fwd", "0_Left_Limb_1.fwd", "0_Left_Limb_2.pitch", "0_Left_Limb_3.pitch", "0_Left_Limb_4.pitch"]
RF = ["0_Right_Limb_0.fwd", "0_Right_Limb_1.fwd", "0_Right_Limb_2.pitch", "0_Right_Limb_3.pitch", "0_Right_Limb_4.pitch"]
LH = ["1_Left_Limb_0.pitch", "1_Left_Limb_1.pitch", "1_Left_Limb_2.pitch", "1_Left_Limb_4.pitch"]
RH = ["1_Right_Limb_0.pitch", "1_Right_Limb_1.pitch", "1_Right_Limb_2.pitch", "1_Right_Limb_4.pitch"]


def leg(names, vals):
    return {n: v for n, v in zip(names, vals) if v is not None}


def pose(tag, deg, ypr=(0, 0, 0), lift=0.0):
    p = {"theta": np.zeros(skel.D), "ypr": np.radians(ypr), "t": np.zeros(3)}
    for key, v in deg.items():
        assert key in D, key
        p["theta"][D[key]] = math.radians(v)
    j, _ = skel.pose_joints(p["theta"], sk.euler_root(*p["ypr"]), p["t"]); p["t"][2] = sk.ground_lift(skel, j) + lift
    quats, loc, joints = bc.pose_from_params(skel, p); bc.set_pose(arm, skel, quats, loc)
    bc.render_views(scene, os.path.join(out, f"{name}_t_{tag}_{{view}}.png")); print("POSE", tag, "top z %.3f" % joints[:, 2].max(), flush=True)
    return joints


only = set(bc.script_args()[2:])
tests = {
 "L_front_up": ({**leg(LF, [10, 70, -90, 60, 30])}, (0, 0, 0), 0),                  # 只动左前腿：高高抬起（普攻扑抓的起手）
 "R_front_up": ({**leg(RF, [10, 70, -90, 60, 30])}, (0, 0, 0), 0),                  # 只动右前腿（核对左右）
 "R_front_reach": ({**leg(RF, [15, 90, -20, -10, -20])}, (0, 0, 0), 0),             # 右前爪向前伸直（扑落）
 "R_hind_up": ({**leg(RH, [-50, 70, -80, 40])}, (0, 0, 0), 0),                      # 只动右后腿：收腿
 "L_hind_back": ({**leg(LH, [60, -20, 40, 30])}, (0, 0, 0), 0),                     # 只动左后腿：后蹬
 "head_down": ({"bone_32.neck_pitch": 20, "Head_1.pitch": 35}, (0, 0, 0), 0),
 "head_up": ({"bone_32.neck_pitch": -18, "Head_1.pitch": -40}, (0, 0, 0), 0),       # 炉吼前的仰头
 "head_yaw_roll": ({"bone_32.neck_yaw": 20, "Head_1.yaw": 35, "Head_1.roll": 20}, (0, 0, 0), 0),   # 头向左转并歪头
 "crouch": ({**leg(LF, [0, -30, -70, 40, 20]), **leg(RF, [0, -30, -70, 40, 20]), **leg(LH, [-55, 100, -120, 60]), **leg(RH, [-55, 100, -120, 60]),
             "bone_32.neck_pitch": 5, "Head_1.pitch": -10}, (0, 5, 0), 0),                                # 扑之前伏低蓄力
 "leap": ({**leg(LF, [15, 90, -10, -10, -20]), **leg(RF, [15, 85, -10, -10, -20]), **leg(LH, [70, -30, 40, 40]), **leg(RH, [70, -30, 40, 40]),
           "Spine_0.spine_pitch": -8, "bone_32.neck_pitch": -5}, (0, -15, 0), 0.25),                       # 腾空：四肢完全伸展
 "lie": ({**leg(LF, [0, 0, -100, 0, 90]), **leg(RF, [0, 5, -100, 0, 90]), **leg(LH, [-54, 105, -135, 88]), **leg(RH, [-54, 105, -135, 88]),
          "bone_32.neck_pitch": 15, "Head_1.pitch": 25}, (0, -6, 0), 0),                                   # 死亡的结尾：四条腿折起、胸口贴地、头垂下
 "gallop_ext": ({**leg(LF, [15, 75, -10, -10, -30]), **leg(RF, [12, 60, -5, -10, -30]), **leg(LH, [65, -25, 40, 40]), **leg(RH, [55, -15, 30, 40]),
                 "Spine_0.spine_pitch": -8, "bone_32.neck_pitch": -6, "Head_1.pitch": -8}, (0, -4, 0), 0),
 "gallop_gather": ({**leg(LF, [-12, -50, -70, 80, 50]), **leg(RF, [-10, -40, -90, 95, 50]), **leg(LH, [-65, 30, -50, -20]), **leg(RH, [-70, 50, -70, -10]),
                    "Spine_0.spine_pitch": 9, "bone_32.neck_pitch": 6}, (0, 6, 0), 0),
 "swipe": ({"0_Right_Limb_1.fwd": 60, "0_Right_Limb_1.out": -30, "0_Right_Limb_1.twist": 20, "0_Right_Limb_2.pitch": -50,
            "Spine_0.spine_yaw": -8, "Spine_0.spine_roll": 5, "bone_32.neck_yaw": -15}, (0, 0, 0), 0),              # 裂爪：右爪横扫过身前
 "legs_out": ({"0_Left_Limb_1.out": 45, "0_Right_Limb_1.out": 45, "1_Left_Limb_0.roll": -30, "1_Right_Limb_0.roll": 30}, (0, 0, 0), 0),
 "look_left": ({"bone_32.neck_yaw": 8, "Head_1.yaw": 25}, (0, 0, 0), 0),                      # 待机里的扫视（中等幅度）
 "look_right": ({"bone_32.neck_yaw": -8, "Head_1.yaw": -25, "Head_1.roll": -8}, (0, 0, 0), 0),
 "roar": ({"bone_32.neck_pitch": 6, "Head_1.pitch": -30, **leg(LF, [0, 20, -20, 0, 0]), **leg(RF, [0, 20, -20, 0, 0])}, (0, 8, 0), 0),     # 炉吼：脖子前伸压低、仰脸张嘴
 "turned": ({"bone_32.neck_yaw": -15, "Head_1.yaw": -25, **leg(LF, [0, 30, -30, 30, 0]), **leg(RH, [0, 30, 30, -30])}, (40, 0, 0), 0),
}
for tag, (deg, ypr, lift) in tests.items():
    if only and tag not in only: continue
    pose(tag, deg, ypr, lift)
quats, loc, joints = bc.pose_from_params(skel, {"theta": np.zeros(skel.D), "ypr": np.zeros(3), "t": np.zeros(3)}); bc.set_pose(arm, skel, quats, loc)
bc.render_views(scene, os.path.join(out, f"{name}_t_restj_{{view}}.png"))
np.save(os.path.join(out, f"{name}_t_restj.npy"), sk.project(bc.read_joints(arm, skel)))
print("DONE", flush=True)
