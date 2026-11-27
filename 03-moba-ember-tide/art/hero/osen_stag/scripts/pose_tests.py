"""对着鹿的骨架摆几个有针对性的极限姿势并渲染（共用的 prep_rig.py 里那几组姿势是按四足兽的骨骼名写死的，对鹿只生效一部分）。
用法: Blender -b --factory-startup V2R/assets/model/stag.blend -P pose_tests.py -- <name> <输出目录>
每个姿势出 <输出目录>/<name>_t_<tag>_{front,side}.png；另外把跟踪点画在静止姿势上（<name>_t_joints.jpg）。"""
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


def pose(tag, deg, ypr=(0, 0, 0), ground=True):
    p = {"theta": np.zeros(skel.D), "ypr": np.radians(ypr), "t": np.zeros(3)}
    for key, v in deg.items():
        hit = [k for n, k in D.items() if key in n]; assert hit, key
        for k in hit: p["theta"][k] = math.radians(v)
    if ground:
        j, _ = skel.pose_joints(p["theta"], sk.euler_root(*p["ypr"]), p["t"]); p["t"][2] = sk.ground_lift(skel, j)
    quats, loc, joints = bc.pose_from_params(skel, p); bc.set_pose(arm, skel, quats, loc)
    bc.render_views(scene, os.path.join(out, f"{name}_t_{tag}_{{view}}.png")); print("POSE", tag, "top z %.3f" % joints[:, 2].max(), flush=True)
    return joints


only = set(bc.script_args()[2:])
tests = {
 "L_front_up": ({"bone_5.fwd": 45, "0_Left_Limb_0.pitch": -50, "0_Left_Limb_1.pitch": 90, "0_Left_Limb_2.pitch": 40}, (0, 0, 0)),      # 只动左前腿：抬起、屈腕
 "R_hind_up": ({"bone_20.fwd": 35, "1_Right_Limb_0.pitch": 40, "1_Right_Limb_1.pitch": -60, "1_Right_Limb_2.pitch": 40}, (0, 0, 0)),     # 只动右后腿：收腿
 "graze": ({"Spine_3.pitch": 80, "Head_0.pitch": 30, "spine_pitch": 5}, (0, 6, 0)),                                                   # 低头到地
 "head_up": ({"Spine_3.pitch": -40, "Head_0.pitch": -30}, (0, 0, 0)),
 "head_yaw_roll": ({"Spine_3.yaw": 30, "Head_0.yaw": 30, "Head_0.roll": 20}, (0, 0, 0)),                                              # 头向左转并歪头
 "kneel": ({"bone_5.fwd": 20, "bone_10.fwd": 20, "0_Left_Limb_0.pitch": -45, "0_Right_Limb_0.pitch": -45, "0_Left_Limb_1.pitch": 110, "0_Right_Limb_1.pitch": 110,
            "Spine_3.pitch": 60, "Head_0.pitch": 20}, (0, 14, 0)),                                                                    # 前腿跪下、头垂下（死亡的结尾）
 "rear60": ({"bone_16.fwd": -60, "bone_20.fwd": -60, "bone_5.fwd": 50, "bone_10.fwd": 30, "0_Left_Limb_0.pitch": -60, "0_Right_Limb_0.pitch": -30,
             "0_Left_Limb_1.pitch": 80, "0_Right_Limb_1.pitch": 100, "Spine_3.pitch": -20, "Head_0.pitch": -15, "spine_pitch": -5}, (0, -60, 0)),   # 人立 60°
 "rear80": ({"bone_16.fwd": -80, "bone_20.fwd": -80, "bone_5.fwd": 40, "bone_10.fwd": 40, "0_Left_Limb_1.pitch": 90, "0_Right_Limb_1.pitch": 60,
             "Spine_3.pitch": 10}, (0, -80, 0)),
 "gallop": ({"bone_5.fwd": 55, "bone_10.fwd": 40, "0_Left_Limb_0.pitch": -20, "0_Right_Limb_0.pitch": -50, "0_Right_Limb_1.pitch": 70, "bone_16.fwd": -45, "bone_20.fwd": -30,
             "1_Left_Limb_0.pitch": -30, "1_Left_Limb_1.pitch": 30, "1_Right_Limb_1.pitch": -50, "Spine_3.pitch": 35, "Head_0.pitch": -25}, (0, 0, 0)),
 "spine_yaw": ({"spine_yaw": 9, "spine_twist": 6}, (0, 0, 0)),
}
for tag, (deg, ypr) in tests.items():
    if only and tag not in only: continue
    pose(tag, deg, ypr)
# 静止姿势 + 跟踪点
quats, loc, joints = bc.pose_from_params(skel, {"theta": np.zeros(skel.D), "ypr": np.zeros(3), "t": np.zeros(3)}); bc.set_pose(arm, skel, quats, loc)
paths = bc.render_views(scene, os.path.join(out, f"{name}_t_restj_{{view}}.png"))
np.save(os.path.join(out, f"{name}_t_restj.npy"), sk.project(bc.read_joints(arm, skel)))
print("DONE", flush=True)
