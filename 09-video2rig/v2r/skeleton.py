"""骨架、关节自由度、正向运动学（FK）、双机位投影、随机姿势/随机运动。

只依赖 numpy，Blender 自带的 Python 和项目 venv 都能 import。

坐标约定（prep_rig.py 归一化之后的世界坐标）：
  角色脚踩 z=0，骨盆在 x=y=0 上方，面朝 -Y，角色的左手边是 +X，Z 向上。
FK 约定（与 Blender 的 pose bone 一致）：
  G_i = G_parent · (R_parent^T · R_i) · Q_i        （世界朝向）
  P_i = P_parent + G_parent · R_parent^T · (p_i - p_parent)
  根骨骼：G = R_root · Q_root，P = p_root + t_world
  其中 R_i / p_i 是骨骼静止姿态的世界朝向 / 头部位置，Q_i 是 pose bone 的局部旋转。
"""
import json
import math
import re

import numpy as np

FWD = np.array([0.0, -1.0, 0.0])
UP = np.array([0.0, 0.0, 1.0])
LEFT = np.array([1.0, 0.0, 0.0])

# ---- 双机位（正交）取景：每个机位画幅 8:9，两个拼起来是 16:9 -----------------
ORTHO_H = 1.8                    # 画面高度对应的世界尺寸
ORTHO_W = ORTHO_H * 8.0 / 9.0    # 画面宽度对应的世界尺寸
Z_CENTER = 0.76                  # 画面中心的世界高度（画面覆盖 z∈[-0.14, 1.66]）
VIEWS = ("front", "side")

# ---- 各类骨骼的自由度：(轴类型, 最小角度, 最大角度)，单位度 --------------------
# 轴类型见 Skeleton._axis()。列表里靠后的先作用（twist 放最后 = 先绕自身轴拧）。
ROLE_DOFS = {
    "spine":    [("pitch", -15, 30), ("roll", -15, 15), ("twist", -20, 20)],
    "neck":     [("pitch", -20, 25), ("roll", -15, 15), ("twist", -25, 25)],
    "head":     [("pitch", -25, 30), ("roll", -15, 15), ("twist", -35, 35)],
    "clavicle": [("fwd", -12, 12), ("up", -8, 20)],
    "upperarm": [("fwd", -50, 150), ("out", -15, 110), ("twist", -50, 50)],
    "forearm":  [("hinge", 0, 135), ("twist", -40, 40)],
    "hand":     [("fwd", -40, 40), ("out", -20, 20)],
    "thigh":    [("fwd", -35, 100), ("out", -10, 50), ("twist", -25, 25)],
    "shin":     [("hinge", 0, 130)],
    "foot":     [("pitch", -25, 30), ("yaw", -12, 12)],
    "toe":      [("pitch", -15, 25)],
}
# hinge 的退路方向：静止姿态里关节是直的时候，用这个方向决定弯曲平面
HINGE_FALLBACK = {"forearm": FWD, "shin": -FWD}

# 每帧角速度的标准差（度/帧），用于生成运动模糊样本
ROLE_SPEED = {
    "spine": 5, "neck": 6, "head": 8, "clavicle": 4, "upperarm": 22, "forearm": 24,
    "hand": 14, "thigh": 16, "shin": 20, "foot": 10, "toe": 6, "finger": 12,
}

# 手指：每只手两个联动自由度——四指一起握（curl）、拇指（thumb）。角度是“每个指节”转多少。
FINGER_CURL = (-15, 70)
THUMB_CURL = (-10, 45)

# 以下几项是“双足 Mixamo 骨架”的默认值；骨架 JSON 里带 profile 字段时以它为准（见 v2r/profiles.py）
BIPED_TORSO = ["Hips", "Spine1", "Spine2", "Neck", "LeftUpLeg", "RightUpLeg", "LeftArm", "RightArm"]
BIPED_JOINT_WEIGHT = {"HeadTop_End": 0.5,          # 头顶那个点悬在脸前面的空气里，读数没那么准
                      "LeftHandMiddle4": 0.7, "RightHandMiddle4": 0.7, "LeftHandThumb4": 0.5, "RightHandThumb4": 0.5}
# 随机姿势 / 随机运动里“整体怎么动”的参数（角度单位度，距离单位是世界单位）
BIPED_SAMPLING = {
    "yaw_uniform": 0.35, "yaw_sigma": 30,          # 35% 的样本朝向任意，其余在正面附近
    "pitch": [0, 14, -55, 55],                     # 俯仰：均值、标准差、下限、上限（正 = 向前栽）
    "roll": [9, 35],                               # 侧倾：标准差、上限
    "t_xy": [0.10, 0.3],                           # 水平位移：标准差、上限
    "t_z": [-0.12, 0.35], "t_z_prob": 0.6,         # 60% 的样本整体上下挪动（蹲下 / 跳起）
    "motion_ypr": [45, 12, 8], "motion_pitch_bias": 0,
    "motion_t": [0.08, 0.08, 0.06], "motion_t_z0": 0.05,
}

MIXAMO_ROLES = {
    "Hips": "root", "Spine": "spine", "Spine1": "spine", "Spine2": "spine",
    "Neck": "neck", "Head": "head",
    "Shoulder": "clavicle", "Arm": "upperarm", "ForeArm": "forearm", "Hand": "hand",
    "UpLeg": "thigh", "Leg": "shin", "Foot": "foot", "ToeBase": "toe",
}
MIXAMO_JOINTS_MID = ["Hips", "Spine1", "Spine2", "Neck", "Head", "HeadTop_End"]
MIXAMO_JOINTS_SIDE = ["Arm", "ForeArm", "Hand", "HandMiddle1", "HandMiddle4", "HandThumb4",
                      "UpLeg", "Leg", "Foot", "ToeBase", "Toe_End"]
_FINGER_RE = re.compile(r"Hand(Index|Middle|Ring|Pinky|Thumb)([1-3])$")


def mixamo_role(bone_name):
    """返回 (role, side)。side: +1 左，-1 右，0 中线。不受控的骨骼 role 为 None。"""
    short = bone_name.split(":")[-1]
    side = 0
    for prefix, s in (("Left", 1), ("Right", -1)):
        if short.startswith(prefix):
            side, short = s, short[len(prefix):]
    if _FINGER_RE.match(short):
        return "finger", side
    return MIXAMO_ROLES.get(short), side


def mixamo_is_thumb(bone_name):
    return "HandThumb" in bone_name


def mixamo_joints(bone_names, heads, tails):
    """返回要跟踪的关节 [{name, bone, group, offset}]。

    大多数关节就是骨骼头部（offset 为 0）。头部两侧另加两个“标记点”：它们固定在头骨上、
    位置在太阳穴附近，有了它们，头的左右转动才看得出来（头骨中线上的点转头时不动）。
    heads / tails: {骨骼名: 世界坐标}，用来按头骨的尺寸定标记点的偏移量。
    """
    by_short = {n.split(":")[-1]: n for n in bone_names}
    out = []
    zero = [0.0, 0.0, 0.0]
    for j in MIXAMO_JOINTS_MID:
        if j in by_short:
            out.append({"name": j, "bone": by_short[j], "group": "M", "offset": zero})
    if "Head" in by_short:
        hb = by_short["Head"]
        along = np.asarray(tails[hb], dtype=float) - np.asarray(heads[hb], dtype=float)
        length = float(np.linalg.norm(along))
        for nm, grp, s in (("LeftHeadSide", "L", 1.0), ("RightHeadSide", "R", -1.0)):
            off = 0.35 * along + s * 0.33 * length * LEFT
            out.append({"name": nm, "bone": hb, "group": grp, "offset": [float(v) for v in off]})
    for prefix, grp in (("Left", "L"), ("Right", "R")):
        for j in MIXAMO_JOINTS_SIDE:
            if prefix + j in by_short:
                out.append({"name": prefix + j, "bone": by_short[prefix + j], "group": grp, "offset": zero})
    return out


# ---- 旋转工具 ------------------------------------------------------------------
def _unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v * 0.0


def rot_axis(axis, ang):
    """绕单位轴 axis 转 ang 弧度的 3x3 旋转矩阵。"""
    x, y, z = axis
    c, s = math.cos(ang), math.sin(ang)
    t = 1.0 - c
    return np.array([
        [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ])


def rotvec_to_mat(r):
    ang = float(np.linalg.norm(r))
    if ang < 1e-9:
        return np.eye(3)
    return rot_axis(np.asarray(r) / ang, ang)


def mat_to_quat(m):
    """3x3 旋转矩阵 -> (w, x, y, z)。"""
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        w, x, y, z = 0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w, x, y, z = (m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w, x, y, z = (m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w, x, y, z = (m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s
    q = np.array([w, x, y, z])
    return q / np.linalg.norm(q)


def euler_root(yaw, pitch, roll):
    """根骨骼整体朝向：先侧倾、再俯仰、最后转身（世界轴）。"""
    return rot_axis(UP, yaw) @ rot_axis(LEFT, pitch) @ rot_axis(-FWD, roll)


# ---- 骨架 ----------------------------------------------------------------------
class Skeleton:
    def __init__(self, data):
        self.data = data
        bones = data["bones"]
        self.names = [b["name"] for b in bones]
        self.index = {n: i for i, n in enumerate(self.names)}
        self.parent = np.array([b["parent"] for b in bones], dtype=int)
        L = np.array([b["matrix"] for b in bones], dtype=float)          # (n,4,4) 世界静止矩阵
        self.scale = float(np.linalg.norm(L[0, :3, 0]))
        self.R = L[:, :3, :3] / self.scale                               # (n,3,3)
        self.p = L[:, :3, 3].copy()                                      # (n,3) 头部
        self.tail = np.array([b["tail"] for b in bones], dtype=float)
        self.roles = [b.get("role") for b in bones]
        self.side = np.array([b.get("side", 0) for b in bones], dtype=int)
        self.n = len(bones)
        self.root = self.roles.index("root")
        assert all(self.parent[i] < i for i in range(self.n)), "骨骼必须按父在前的顺序排列"
        # 静止姿态下相对父骨骼的偏移（父骨骼静止坐标系里）和相对朝向
        self.offset = np.zeros((self.n, 3))
        self.Rrel = np.zeros((self.n, 3, 3))
        for i in range(self.n):
            pa = self.parent[i]
            if pa < 0:
                self.Rrel[i] = self.R[i]
            else:
                self.offset[i] = self.R[pa].T @ (self.p[i] - self.p[pa])
                self.Rrel[i] = self.R[pa].T @ self.R[i]
        self.thumb = [bool(b.get("thumb", False)) for b in bones]
        self.joints = [(j["name"], self.index[j["bone"]], j["group"]) for j in data["joints"]]
        self.joint_bone = np.array([j[1] for j in self.joints], dtype=int)
        offs = np.array([j.get("offset", [0.0, 0.0, 0.0]) for j in data["joints"]], dtype=float)
        self.joint_rest = self.p[self.joint_bone] + offs                    # 静止姿态下的世界位置
        self.joint_offset_local = np.einsum("kji,kj->ki", self.R[self.joint_bone], offs)   # R^T · offset
        self.joint_names = [j[0] for j in self.joints]
        self.joint_group = [j[2] for j in self.joints]
        self.K = len(self.joints)
        prof = data.get("profile") or {}
        self.kind = prof.get("kind", "biped")
        self.role_dofs = prof.get("role_dofs", ROLE_DOFS)
        self.hinge_fallback = {k: np.asarray(v, dtype=float) for k, v in prof.get("hinge_fallback", HINGE_FALLBACK).items()}
        self.role_speed = prof.get("role_speed", ROLE_SPEED)
        self.chains = prof.get("chains", [])                    # 联动的骨骼链（尾巴等）
        self.torso_joints = prof.get("torso_joints", BIPED_TORSO)
        self.root_joint = prof.get("root_joint", "Hips")
        self.ground_joints = prof.get("ground_joints", [n for n in self.joint_names if "Foot" in n or "Toe" in n])
        self.joint_weight = prof.get("joint_weight", BIPED_JOINT_WEIGHT)
        self.sampling = {**BIPED_SAMPLING, **prof.get("sampling", {})}
        self.size_ref = float(prof.get("size_ref", 1.0))        # 报误差时用来归一化的体型尺寸（双足是身高）
        self.size_name = prof.get("size_name", "身高")
        self.ground_idx = [self.joint_names.index(n) for n in self.ground_joints if n in self.joint_names]
        self._build_dofs()

    @classmethod
    def load(cls, path):
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f))

    def _dir(self, i):
        return _unit(self.tail[i] - self.p[i])

    def _axis(self, i, kind):
        """把轴类型解析成世界坐标（静止姿态）下的单位轴，以及静止时已有的弯曲角。"""
        d = self._dir(i)
        s = float(self.side[i]) or 1.0
        if kind == "pitch":
            return LEFT.copy(), 0.0
        if kind == "roll":
            return -FWD.copy(), 0.0
        if kind == "yaw":
            return UP.copy(), 0.0
        if kind == "twist":
            return d, 0.0
        if kind == "fwd":       # 让骨骼末端朝前摆
            return _unit(np.cross(d, FWD)), 0.0
        if kind == "out":       # 让骨骼末端朝身体外侧摆
            return _unit(np.cross(d, s * LEFT)), 0.0
        if kind == "up":        # 让骨骼末端朝上摆
            return _unit(np.cross(d, UP)), 0.0
        if kind == "hinge":     # 肘 / 膝：只在父骨骼和自己构成的平面里弯
            pa = self.parent[i]
            dp = self._dir(pa)
            n = np.cross(dp, d)
            bend = math.asin(min(1.0, float(np.linalg.norm(n))))
            if bend > math.radians(8):
                return _unit(n), bend
            return _unit(np.cross(d, self.hinge_fallback[self.roles[i]])), 0.0
        raise ValueError(kind)

    def _finger_chains(self, hand):
        """返回这只手的手指链 [(骨骼索引列表, 是否拇指)]。"""
        chains = []
        for c in range(self.n):
            if self.parent[c] == hand and self.roles[c] == "finger":
                chain = [c]
                while True:
                    kids = [k for k in range(self.n) if self.parent[k] == chain[-1] and self.roles[k] == "finger"]
                    if not kids:
                        break
                    chain.append(kids[0])
                chains.append((chain, self.thumb[c]))
        return chains

    def _finger_dofs(self, hand):
        """握拳：每根手指绕“它本来就在弯的那个方向”继续弯。轴取自首末两个指节的夹角。"""
        chains = self._finger_chains(hand)
        axes = []
        for chain, _ in chains:
            n = np.cross(self._dir(chain[0]), self._dir(chain[-1]))
            axes.append(_unit(n) if np.linalg.norm(n) > math.sin(math.radians(4)) else None)
        good = [a for a, (_, th) in zip(axes, chains) if a is not None and not th]
        out = []
        for kind, want_thumb, (lo, hi) in (("curl", False, FINGER_CURL), ("thumb", True, THUMB_CURL)):
            targets = []
            for (chain, th), ax in zip(chains, axes):
                if th != want_thumb:
                    continue
                if ax is None:
                    if not good:
                        raise ValueError("手指在静止姿态里是直的，定不出握拳方向")
                    ax = _unit(np.mean(good, axis=0))
                targets += [(b, ax, 1.0) for b in chain]
            if targets:
                out.append((targets, math.radians(lo), math.radians(hi), kind))
        return out

    def _build_dofs(self):
        self.dofs = []          # (主骨骼, [(骨骼, 轴, 增益)], lo, hi, role, kind)
        for i, role in enumerate(self.roles):
            for kind, lo, hi in self.role_dofs.get(role, []):
                axis, bend = self._axis(i, kind)
                lo_r, hi_r = math.radians(lo) - bend, math.radians(hi) - bend
                self.dofs.append((i, [(i, axis, 1.0)], lo_r, hi_r, role, kind))
            if role == "hand":
                for targets, lo_r, hi_r, kind in self._finger_dofs(i):
                    self.dofs.append((i, targets, lo_r, hi_r, "finger", kind))
        # 骨骼链：一条链上的几根骨骼共用一个角度（每根各转这么多），比如尾巴的“整体上翘 / 左右甩”
        for ch in self.chains:
            idx = [self.index[b] for b in ch["bones"]]
            for kind, lo, hi in ch["dofs"]:
                targets = [(b, self._axis(b, kind)[0], 1.0) for b in idx]
                self.dofs.append((idx[0], targets, math.radians(lo), math.radians(hi), ch["role"], f"{ch['name']}_{kind}"))
        self.D = len(self.dofs)
        self.dof_bone = np.array([d[0] for d in self.dofs], dtype=int)
        self.dof_targets = [d[1] for d in self.dofs]
        self.dof_axis = np.array([d[1][0][1] for d in self.dofs])
        self.dof_lo = np.array([d[2] for d in self.dofs])
        self.dof_hi = np.array([d[3] for d in self.dofs])
        self.dof_speed = np.radians([self.role_speed[d[4]] for d in self.dofs])
        self.dof_names = [f"{self.names[d[0]].split(':')[-1]}.{d[5]}" for d in self.dofs]
        self.dof_role = [d[4] for d in self.dofs]
        self.dof_kind = [d[5] for d in self.dofs]

    # ---- 姿态 -> 局部旋转 -> FK ------------------------------------------------
    def local_rotations(self, theta, A_root):
        """theta (D,) 各自由度角度；A_root 3x3 根骨骼的世界轴旋转。返回 (n,3,3) pose bone 局部旋转。"""
        A = np.repeat(np.eye(3)[None], self.n, axis=0)
        # 同一根骨骼的多个自由度按列表顺序左乘在前：A = R0 · R1 · R2
        for k in range(self.D - 1, -1, -1):
            for b, axis, gain in self.dof_targets[k]:
                A[b] = rot_axis(axis, gain * float(theta[k])) @ A[b]
        A[self.root] = A_root
        Q = np.empty_like(A)
        for i in range(self.n):
            Q[i] = self.R[i].T @ A[i] @ self.R[i]
        return Q

    def fk(self, Q, t_world):
        """Q (n,3,3) 局部旋转，t_world (3,) 根骨骼世界位移。返回各骨骼头部世界位置 (n,3) 和世界朝向 (n,3,3)。"""
        G = np.empty((self.n, 3, 3))
        P = np.empty((self.n, 3))
        for i in range(self.n):
            pa = self.parent[i]
            if pa < 0:
                G[i] = self.R[i] @ Q[i]
                P[i] = self.p[i] + np.asarray(t_world)
            else:
                G[i] = G[pa] @ self.Rrel[i] @ Q[i]
                P[i] = P[pa] + G[pa] @ self.offset[i]
        return P, G

    def pose_joints(self, theta, A_root, t_world):
        Q = self.local_rotations(theta, A_root)
        P, G = self.fk(Q, t_world)
        return self.joint_positions(P, G), Q

    def joint_positions(self, P, G):
        """骨骼头部位置 + 标记点偏移（跟着骨骼一起转）。"""
        jb = self.joint_bone
        return P[jb] + np.einsum("kij,kj->ki", G[jb], self.joint_offset_local)

    def blender_pose(self, Q, t_world):
        """转成 Blender 用的数据：每根骨骼的四元数 (w,x,y,z) 和根骨骼的 pose location。"""
        quats = np.array([mat_to_quat(Q[i]) for i in range(self.n)])
        loc = self.R[self.root].T @ np.asarray(t_world) / self.scale
        return quats, loc


# ---- 投影 ----------------------------------------------------------------------
def project(P):
    """世界坐标 (...,3) -> 两个机位的归一化画面坐标 (2,...,2)，原点左上，a 向右，b 向下。"""
    P = np.asarray(P)
    b = 0.5 - (P[..., 2] - Z_CENTER) / ORTHO_H
    front = np.stack([0.5 + P[..., 0] / ORTHO_W, b], axis=-1)
    side = np.stack([0.5 - P[..., 1] / ORTHO_W, b], axis=-1)
    return np.stack([front, side], axis=0)


def unproject(front, side):
    """两个机位的归一化坐标 (...,2) -> 世界坐标 (...,3)。两条视线求交：正交相机下就是直接读数。"""
    x = (front[..., 0] - 0.5) * ORTHO_W
    y = -(side[..., 0] - 0.5) * ORTHO_W
    z = Z_CENTER - ((front[..., 1] + side[..., 1]) / 2 - 0.5) * ORTHO_H
    return np.stack([x, y, z], axis=-1)


# ---- 随机姿势 / 随机运动 --------------------------------------------------------
def ground_lift(skel, joints):
    """这个姿势要整体抬高（负数 = 降低）多少，才能让最低的那只脚正好在站立高度、其它点不到地面以下。"""
    lift = -1e9
    if skel.ground_idx:
        gi = skel.ground_idx
        lift = float(np.max(skel.joint_rest[gi, 2] - joints[gi, 2]))
    other = [k for k in range(skel.K) if k not in skel.ground_idx]
    return max(lift, float(np.max(0.01 - joints[other, 2])))


def sample_pose(skel, rng):
    """随机摆一个姿势：每个关节在活动范围内随机，整体随机转向和位移。"""
    lo, hi = skel.dof_lo, skel.dof_hi
    if rng.random() < 0.12:                       # 一部分样本贴近静止姿态（视频第一帧就是它）
        theta = rng.normal(0, math.radians(6), skel.D)
    else:
        uni = rng.uniform(lo, hi)
        nor = rng.normal(0, (hi - lo) / 5)
        theta = np.where(rng.random(skel.D) < 0.5, uni, nor)
    theta = np.clip(theta, lo, hi)
    sp = skel.sampling
    yaw = rng.uniform(-math.pi, math.pi) if rng.random() < sp["yaw_uniform"] else rng.normal(0, math.radians(sp["yaw_sigma"]))
    pm, ps, plo, phi = sp["pitch"]
    pitch = float(np.clip(rng.normal(math.radians(pm), math.radians(ps)), math.radians(plo), math.radians(phi)))
    rs, rlim = sp["roll"]
    roll = float(np.clip(rng.normal(0, math.radians(rs)), -math.radians(rlim), math.radians(rlim)))
    if "pitch_uniform" in sp and rng.random() < sp["pitch_uniform"][0]:
        pitch = math.radians(rng.uniform(sp["pitch_uniform"][1], sp["pitch_uniform"][2]))
        pf = sp.get("pitch_follow")
        for k in range(skel.D if pf else 0):
            if skel.dof_role[k] in pf["roles"] and skel.dof_kind[k] == pf["kind"] and rng.random() < pf["prob"]:
                theta[k] = np.clip(pf["gain"] * pitch + rng.normal(0, math.radians(pf["sigma"])), lo[k], hi[k])
    ts, tlim = sp["t_xy"]
    t = np.array([
        np.clip(rng.normal(0, ts), -tlim, tlim),
        np.clip(rng.normal(0, ts), -tlim, tlim),
        rng.uniform(*sp["t_z"]) if rng.random() < sp["t_z_prob"] else rng.normal(0, 0.02),
    ])
    if sp.get("ground_clamp"):                    # 四足：先让脚落地，再叠加腾空高度
        hop = max(float(t[2]), 0.0)
        t[2] = 0.0
        joints, _ = skel.pose_joints(theta, euler_root(yaw, pitch, roll), t)
        t[2] = ground_lift(skel, joints) + hop
    return {"theta": theta, "ypr": np.array([yaw, pitch, roll]), "t": t}


def sample_velocity(skel, rng):
    """随机的每帧速度；一半样本是快速运动（会产生明显的运动模糊）。"""
    speed = rng.uniform(0.5, 1.6) if rng.random() < 0.5 else 0.0
    return {
        "theta": rng.normal(0, 1, skel.D) * skel.dof_speed * speed,
        "ypr": rng.normal(0, 1, 3) * np.radians([7, 4, 3]) * speed,
        "t": rng.normal(0, 1, 3) * np.array([0.03, 0.03, 0.04]) * speed,
        "speed": speed,
    }


def offset_pose(skel, pose, vel, k):
    """pose + k·vel，并夹回活动范围。"""
    return {
        "theta": np.clip(pose["theta"] + k * vel["theta"], skel.dof_lo, skel.dof_hi),
        "ypr": pose["ypr"] + k * vel["ypr"],
        "t": pose["t"] + k * vel["t"],
    }


def sample_motion(skel, rng, n_frames, fps=24.0, ease_in=0.5, energy=1.0, rear=0.0):
    """编一段平滑的随机运动（“考试”用）：每个自由度是几条正弦的叠加，从静止姿态缓入。

    rear > 0（四足用）：中间一段让前半身抬起 rear 度、后腿大腿跟着保持竖直，也就是“人立”。
    """
    tt = np.arange(n_frames) / fps
    env = np.clip(tt / ease_in, 0, 1)
    env = env * env * (3 - 2 * env)                                   # smoothstep 缓入

    def wave(amp, n=3, fmin=0.25, fmax=1.3):
        y = np.zeros(n_frames)
        for _ in range(n):
            f = rng.uniform(fmin, fmax)
            y += rng.uniform(0.3, 1.0) * np.sin(2 * math.pi * f * tt + rng.uniform(0, 2 * math.pi))
        return amp * y / n * 1.6

    lo, hi = skel.dof_lo, skel.dof_hi
    theta = np.zeros((n_frames, skel.D))
    for k in range(skel.D):
        center = rng.uniform(0.25, 0.6) * (hi[k] + lo[k]) / 2
        amp = rng.uniform(0.25, 0.5) * (hi[k] - lo[k]) / 2 * energy
        theta[:, k] = np.clip((center + wave(amp)) * env, lo[k], hi[k])
    sp = skel.sampling
    my, mp, mr = sp["motion_ypr"]
    ypr = np.stack([
        wave(math.radians(my) * energy, fmax=0.6),
        wave(math.radians(mp) * energy) + math.radians(sp["motion_pitch_bias"]),
        wave(math.radians(mr) * energy),
    ], axis=1) * env[:, None]
    if rear:
        pf = sp["pitch_follow"]
        u = np.clip((tt - 1.0) / 1.0, 0, 1) * np.clip((tt[-1] - 0.8 - tt) / 1.0, 0, 1)      # 1 秒抬起，保持，最后 1 秒落下
        bump = u * u * (3 - 2 * u)
        ypr[:, 1] = ypr[:, 1] * (1 - 0.7 * bump) - math.radians(rear) * bump
        for k in range(skel.D):
            if skel.dof_role[k] in pf["roles"] and skel.dof_kind[k] == pf["kind"]:
                theta[:, k] = np.clip(theta[:, k] * (1 - 0.6 * bump) - pf["gain"] * math.radians(rear) * bump, lo[k], hi[k])
    tx, ty, tz = sp["motion_t"]
    t = np.stack([wave(tx, fmax=0.7), wave(ty, fmax=0.7), wave(tz) + sp["motion_t_z0"]], axis=1) * env[:, None]
    if sp.get("ground_clamp"):
        hop = np.clip(t[:, 2], 0, None)
        lift = np.zeros(n_frames)
        for i in range(n_frames):
            ti = np.array([t[i, 0], t[i, 1], 0.0])
            joints, _ = skel.pose_joints(theta[i], euler_root(*ypr[i]), ti)
            lift[i] = ground_lift(skel, joints)
        k = np.exp(-0.5 * (np.arange(-6, 7) / 2.0) ** 2)
        lift = np.convolve(np.pad(lift, 6, mode="edge"), k / k.sum(), mode="valid")     # 抹平，免得整体高度一抖一抖
        t[:, 2] = lift + hop
    return {"theta": theta, "ypr": ypr, "t": t}
