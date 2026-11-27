"""巨蟾专用的极限姿势检查（prep_rig.py 里那几组是按四足兽的骨骼名写死的）。
用法: Blender -b --factory-startup V2R/assets/model/toad.blend -P pose_check.py -- <输出目录> [只渲染这几个,逗号分隔]
每个姿势渲染正面、侧面各一张: <输出目录>/toad_<名字>_{front,side}.png；另存静止姿势下跟踪点的投影 toad_restj.npy。
自由度的写法："<腿>.<节>.<轴>"，腿 = LF/RF/LH/RH，或 F（两条前腿）、H（两条后腿）、A（四条）；节 = up/lo/end；head.<轴>。值是度数，或 'lo'/'hi'。
"""
import math, os, sys
import bpy
import numpy as np

V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]; only = argv[1].split(",") if len(argv) > 1 else None
sys.path.insert(0, os.path.join(V2R, "scripts/blender"))
import bl_common as bc  # noqa: E402
from v2r import skeleton as sk  # noqa: E402

scene = bpy.context.scene
arm, mesh = bc.character()
skel = sk.Skeleton.load(os.path.join(V2R, "assets/model/toad_skeleton.json"))
os.makedirs(out, exist_ok=True)
bc.setup_render(scene)
D = {n: k for k, n in enumerate(skel.dof_names)}
BONE = {"LF": ("bone_29", "bone_30", "bone_31"), "RF": ("bone_39", "1_Left_Limb_0", "1_Left_Limb_1"),
        "LH": ("0_Right_Limb_0", "0_Right_Limb_1", "0_Right_Limb_2"), "RH": ("0_Left_Limb_0", "0_Left_Limb_1", "0_Left_Limb_2")}
GROUP = {"F": ("LF", "RF"), "H": ("LH", "RH"), "A": ("LF", "RF", "LH", "RH"), "L": ("LF", "LH"), "R": ("RF", "RH")}
PART = {"up": 0, "lo": 1, "end": 2}


def dofs(key):
    a = key.split(".")
    if a[0] == "head": return [D["bone_36." + a[1]]]
    return [D[f"{BONE[leg][PART[a[1]]]}.{a[2]}"] for leg in GROUP.get(a[0], (a[0],))]


def pose(picks, ypr=(0, 0, 0), t=(0, 0, 0), ground=True, hop=0.0):
    th = np.zeros(skel.D)
    for key, which in picks.items():
        for k in dofs(key): th[k] = skel.dof_lo[k] if which == "lo" else skel.dof_hi[k] if which == "hi" else math.radians(which)
    p = {"theta": th, "ypr": np.radians(ypr), "t": np.array(t, dtype=float)}
    if ground:
        j, _ = skel.pose_joints(th, sk.euler_root(*p["ypr"]), p["t"]); p["t"][2] += sk.ground_lift(skel, j) + hop
    return p


tests = {
    "rest": pose({}),
    "head_up": pose({"head.pitch": "lo"}), "head_down": pose({"head.pitch": "hi"}),
    "head_left": pose({"head.yaw": "hi"}), "head_right": pose({"head.yaw": "lo"}), "head_twist": pose({"head.twist": "hi", "head.pitch": 10}),
    "f_fwd": pose({"F.up.fwd": "hi"}), "f_back": pose({"F.up.fwd": "lo"}), "f_out": pose({"F.up.out": "hi"}), "f_twist": pose({"LF.up.twist": "hi", "RF.up.twist": "lo"}),
    "f_elbow_lo": pose({"F.lo.pitch": "lo"}), "f_elbow_hi": pose({"F.lo.pitch": "hi"}), "f_paw_lo": pose({"F.end.pitch": "lo"}), "f_paw_hi": pose({"F.end.pitch": "hi"}),
    "h_fwd": pose({"H.up.fwd": "hi"}), "h_back": pose({"H.up.fwd": "lo"}), "h_out_hi": pose({"H.up.out": "hi"}), "h_out_lo": pose({"H.up.out": "lo"}),
    "h_twist_hi": pose({"H.up.twist": "hi"}), "h_twist_lo": pose({"H.up.twist": "lo"}),
    "h_knee_lo": pose({"H.lo.pitch": "lo"}), "h_knee_hi": pose({"H.lo.pitch": "hi"}), "h_foot_lo": pose({"H.end.pitch": "lo"}), "h_foot_hi": pose({"H.end.pitch": "hi"}),
    # 只动左边：左前腿向前抬、左后腿向后蹬（验左右没写反）
    "left_only": pose({"LF.up.fwd": 45, "LF.lo.pitch": -40, "LH.up.fwd": -35, "LH.up.twist": -25}, ground=False),
    # 走一步：左前 + 右后在前，右前 + 左后在后
    "step": pose({"LF.up.fwd": 30, "LF.lo.pitch": -15, "RF.up.fwd": -28, "RF.lo.pitch": 12, "RH.up.fwd": 28, "RH.up.twist": 20, "LH.up.fwd": -28, "LH.up.twist": -20}, ypr=(6, 0, 3)),
    # 蓄力：四肢弯曲、身体压低
    "crouch": pose({"F.up.fwd": 28, "F.up.out": 30, "F.lo.pitch": 45, "F.end.pitch": -25, "H.up.out": 30, "H.lo.pitch": 25, "H.end.pitch": -20, "head.pitch": 8}, ypr=(0, 5, 0)),
    # 砸地：四肢摊开、肚皮贴地
    "splat": pose({"F.up.out": 62, "F.up.fwd": 20, "F.lo.pitch": 30, "F.end.pitch": -20, "H.up.out": 35, "H.up.fwd": -20, "H.lo.pitch": 20, "H.end.pitch": -15, "head.pitch": -8}),
    # 跳起：身体抬头、四肢伸直下垂
    "jump": pose({"F.up.fwd": -25, "F.lo.pitch": 20, "F.end.pitch": 35, "H.up.out": -40, "H.up.fwd": -25, "H.lo.pitch": -35, "H.end.pitch": 35, "head.pitch": -10}, ypr=(0, -18, 0), hop=0.35),
    # 前探：身体向前压出去，前腿向后撑、后腿蹬直
    "lunge": pose({"F.up.fwd": -40, "F.lo.pitch": 25, "F.end.pitch": 15, "H.up.fwd": -35, "H.up.twist": -30, "H.lo.pitch": -25, "head.pitch": -12}, ypr=(0, 6, 0)),
    # 死亡：前腿跪下摊开、下巴贴地
    "death": pose({"F.up.out": 55, "F.up.fwd": 30, "F.lo.pitch": 45, "F.end.pitch": -30, "H.up.out": 30, "H.lo.pitch": 20, "H.end.pitch": -15, "head.pitch": 18}, ypr=(0, 9, 4)),
    "turn": pose({"head.yaw": 15}, ypr=(50, 0, 6)),
}
for tag, p in tests.items():
    if only and tag not in only: continue
    quats, loc, joints = bc.pose_from_params(skel, p)
    bc.set_pose(arm, skel, quats, loc)
    bc.render_views(scene, os.path.join(out, f"toad_{tag}_{{view}}.png"))
    if tag == "rest": np.save(os.path.join(out, "toad_restj.npy"), sk.project(bc.read_joints(arm, skel)))
    print("POSE", tag, "t", np.round(p["t"], 3), "根高", round(float(joints[0, 2]), 3), flush=True)
