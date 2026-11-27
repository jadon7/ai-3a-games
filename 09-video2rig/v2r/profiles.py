"""骨架类型配置：一种绑骨规范（骨骼怎么命名、哪根骨骼是什么角色、跟踪哪些点、各关节能怎么动）写一份。

prep_rig.py 用它把 Tripo 绑好的骨架翻译成统一的骨架 JSON；之后的渲染、训练、求解都只读那份 JSON，
不再关心骨架原来是什么规范。要支持新的骨架规范（比如带翅膀的），在这里加一个 profile 即可。

两种来源：
  1. 命名规范固定的骨架（目前是 Mixamo 双足）：MixamoBiped 按骨骼名直接查表。
  2. 没有命名规范的骨架（Tripo 的四足等）：每只怪物写一份 assets/model/<name>_rigmap.json，
     说明哪根骨骼是什么角色、跟踪哪些点；这一类骨架共用的自由度表放在 KINDS 里。
"""
import re

import numpy as np

from . import skeleton as sk

ZERO = [0.0, 0.0, 0.0]


def _horizontal(v):
    v = np.array([v[0], v[1], 0.0])
    return v / (np.linalg.norm(v) + 1e-9)


# ============================== 双足：Mixamo 命名 ==================================
class MixamoBiped:
    name = "mixamo_biped"
    target_size = None
    center = "root"

    @staticmethod
    def match(names):
        short = {n.split(":")[-1] for n in names}
        return {"Hips", "LeftUpLeg", "RightUpLeg", "LeftArm", "RightArm"} <= short

    @staticmethod
    def roles(names):
        return {n: sk.mixamo_role(n) for n in names}

    @staticmethod
    def is_thumb(name):
        return sk.mixamo_is_thumb(name)

    @staticmethod
    def forward(head_of, names):
        by = {n.split(":")[-1]: n for n in names}
        v = np.zeros(3)
        for side in ("Left", "Right"):                      # 脚尖方向
            v += np.asarray(head_of(by[side + "ToeBase"])) - np.asarray(head_of(by[side + "Foot"]))
        return _horizontal(v)

    @staticmethod
    def left_probe(names):
        return next(n for n in names if n.split(":")[-1] == "LeftArm")

    @staticmethod
    def joints(names, heads, tails):
        return sk.mixamo_joints(names, heads, tails)

    @staticmethod
    def profile(names, joints):
        return None                                         # 双足用 skeleton.py 里的默认值，JSON 里不写 profile


# ============================== 四足（按每只怪物的映射文件） ==========================
# Tripo 的四足绑骨没有固定命名，所以哪根骨骼是什么角色写在 assets/model/<name>_rigmap.json 里；
# 这里只放“四足”这一类共用的东西：各角色能怎么动、随机姿势参数。角度都相对静止姿态，单位度。
# 轴的含义见 Skeleton._axis()。摆正之后角色面朝 -Y，所以绕 LEFT 轴的 pitch：
#   对朝下的骨骼（腿），正 = 末端向后摆，负 = 末端向前摆；对朝前的骨骼（脖子、头），正 = 末端向下。
QUAD_ROLE_DOFS = {
    "neck":    [("pitch", -28, 28), ("yaw", -30, 30), ("twist", -15, 15)],
    "head":    [("pitch", -30, 30), ("yaw", -32, 32), ("twist", -25, 25)],
    # 前腿：肩胛 → 上臂（肩关节，球窝）→ 前臂（肘，往前折）→ 掌（腕，往后折）
    "scapula": [("fwd", -14, 14)],
    "upper_f": [("fwd", -45, 60), ("out", -10, 30), ("twist", -15, 15)],
    "lower_f": [("pitch", -70, 30)],
    "paw_f":   [("pitch", -25, 85)],
    # 后腿：大腿（髋，球窝）→ 小腿（膝，往后折）→ 跖（飞节，往前折）→ 脚 → 趾
    "upper_h": [("fwd", -90, 60), ("out", -10, 30), ("twist", -15, 15)],     # 向后要够到 -90：人立时大腿相对骨盆几乎折到身后
    "lower_h": [("pitch", -45, 55)],
    "hock":    [("pitch", -50, 50)],
    "foot_h":  [("pitch", -35, 40)],
    "toe_h":   [("pitch", -25, 25)],
}
QUAD_ROLE_SPEED = {
    "spine": 3, "neck": 7, "head": 9, "scapula": 4, "tail": 9,
    "upper_f": 16, "lower_f": 20, "paw_f": 18,
    "upper_h": 16, "lower_h": 20, "hock": 18, "foot_h": 12, "toe_h": 8,
}
QUAD_SAMPLING = {
    "yaw_uniform": 0.35, "yaw_sigma": 30,
    "pitch": [-4, 12, -65, 28],                    # 负 = 前半身抬起；正 = 低头前倾
    "pitch_uniform": [0.25, -85, -18],             # 另有 25% 的样本是明显的人立（前半身抬起 18°~85°）
    # 人立的样本里，后腿大腿大多保持接近竖直（相对骨盆向后摆的角度 ≈ 身体抬起的角度），这才是“用后腿站着”
    "pitch_follow": {"roles": ["upper_h"], "kind": "fwd", "gain": 1.0, "sigma": 18, "prob": 0.8},
    "roll": [8, 30],
    "t_xy": [0.07, 0.2],
    "t_z": [0.0, 0.3], "t_z_prob": 0.35,           # 一部分样本整体腾空（扑、跳）
    "ground_clamp": True,                          # 姿势摆完之后把整体抬到“最低的脚不低于站立高度”
    "motion_ypr": [40, 20, 8], "motion_pitch_bias": -8,
    "motion_t": [0.06, 0.06, 0.04], "motion_t_z0": 0.03,
}
KINDS = {
    "quadruped": {"role_dofs": QUAD_ROLE_DOFS, "role_speed": QUAD_ROLE_SPEED, "sampling": QUAD_SAMPLING,
                  "size_name": "身长"},
}


def profile_from_rigmap(rigmap, size_ref):
    """把映射文件 + 这一类骨架的共用表，合成写进骨架 JSON 的 profile 字段。"""
    kind = KINDS[rigmap["kind"]]
    return {
        "kind": rigmap["kind"],
        "role_dofs": {k: [list(d) for d in v] for k, v in {**kind["role_dofs"], **rigmap.get("role_dofs", {})}.items()},
        "hinge_fallback": {},
        "role_speed": {**kind["role_speed"], **rigmap.get("role_speed", {})},
        "chains": rigmap.get("chains", []),
        "torso_joints": rigmap["torso_joints"],
        "root_joint": rigmap["root_joint"],
        "ground_joints": rigmap["ground_joints"],
        "joint_weight": rigmap.get("joint_weight", {}),
        "sampling": {**kind["sampling"], **rigmap.get("sampling", {})},
        "size_ref": size_ref, "size_name": kind["size_name"],
    }
