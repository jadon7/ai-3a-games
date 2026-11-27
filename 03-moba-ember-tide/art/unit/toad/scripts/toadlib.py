"""巨蟾这几个小脚本共用的东西：骨架、关节名、正向运动学、左右腿的自由度对应。只读 V2R 的骨架文件，不改共用代码。"""
import os, sys
import numpy as np

V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, V2R)
from v2r import skeleton as sk  # noqa: E402

skel = sk.Skeleton.load(os.path.join(V2R, "assets/model/toad_skeleton.json"))
JN = skel.joint_names; J = {n: k for k, n in enumerate(JN)}; D = {n: k for k, n in enumerate(skel.dof_names)}
GROUND = [J[n] for n in skel.ground_joints]
BONE = {"LF": ("bone_29", "bone_30", "bone_31"), "RF": ("bone_39", "1_Left_Limb_0", "1_Left_Limb_1"),
        "LH": ("0_Right_Limb_0", "0_Right_Limb_1", "0_Right_Limb_2"), "RH": ("0_Left_Limb_0", "0_Left_Limb_1", "0_Left_Limb_2")}
LEG_JOINTS = {"LF": ["LeftFShoulder", "LeftFElbow", "LeftFWrist", "LeftFToe"], "RF": ["RightFShoulder", "RightFElbow", "RightFWrist", "RightFToe"],
              "LH": ["LeftHHip", "LeftHKnee", "LeftHAnkle", "LeftHToe"], "RH": ["RightHHip", "RightHKnee", "RightHAnkle", "RightHToe"]}
KINDS = (("0", "fwd"), ("0", "out"), ("0", "twist"), ("1", "pitch"), ("2", "pitch"))


def leg_dofs(leg):
    """这条腿的 5 个自由度的序号，顺序固定：大腿 fwd / out / twist、中段 pitch、末段 pitch"""
    return [D[f"{BONE[leg][int(p)]}.{k}"] for p, k in KINDS]


MIRROR_SIGN = np.array([1, 1, -1, 1, 1.0])          # 左右对称的姿势：twist 反号，其余同号
PAIRS = [("LF", "RF"), ("LH", "RH")]


def quat_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def fk_motion(path_or_dict):
    """成品动作（names、quats、loc、fps；hero_motion.py 的输出）或管线的 motion.npz → 每帧各跟踪点的位置 (T,K,3)、根骨骼相对静止的世界旋转 (T,3,3)、fps"""
    m = np.load(path_or_dict, allow_pickle=True) if isinstance(path_or_dict, str) else path_or_dict
    q, loc, fps = m["quats"], m["loc"], float(m["fps"]); T = len(q)
    out = np.zeros((T, skel.K, 3)); A = np.zeros((T, 3, 3))
    for f in range(T):
        Q = np.array([quat_mat(q[f, i]) for i in range(skel.n)]); t = skel.R[skel.root] @ (loc[f] * skel.scale)
        P, G = skel.fk(Q, t); out[f] = skel.joint_positions(P, G); A[f] = G[skel.root] @ skel.R[skel.root].T
    return out, A, fps
