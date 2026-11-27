"""巨蟾专用的补充训练图：共用的随机姿势是每条腿各摆各的，“四条腿一起弯、身体压低／四肢摊开肚皮贴地／腾空／整只前探”这类
成套的姿势很少出现，而重击（蓄力 → 跳起 → 砸地）和死亡正好全是这种。这里只换掉“怎么随机摆姿势”，渲染、标签、文件格式都用共用的
render_dataset.py（原样执行），所以出来的图和标签可以和它渲的放在同一个目录里一起训练。

用法（和 render_dataset.py 一样）:
  Blender -b --factory-startup assets/model/toad.blend -P scripts/blender/render_dataset_toad.py -- toad <out_dir> <样本数> <随机种子> [起始编号]
"""
import math
import os
import runpy
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bl_common as bc  # noqa: E402,F401
from v2r import skeleton as sk  # noqa: E402

BONE = {"LF": ("bone_29", "bone_30", "bone_31"), "RF": ("bone_39", "1_Left_Limb_0", "1_Left_Limb_1"),
        "LH": ("0_Right_Limb_0", "0_Right_Limb_1", "0_Right_Limb_2"), "RH": ("0_Left_Limb_0", "0_Left_Limb_1", "0_Left_Limb_2")}
# 每种成套姿势：前腿 / 后腿各自由度的范围（度），身体俯仰的范围，腾空高度的范围，身体前后挪的范围
SETS = {
    "crouch": dict(p=0.30, F={"0.fwd": (0, 40), "0.out": (10, 50), "0.twist": (-10, 10), "1.pitch": (10, 55), "2.pitch": (-40, 0)},
                   H={"0.fwd": (-20, 20), "0.out": (10, 40), "0.twist": (-12, 12), "1.pitch": (0, 40), "2.pitch": (-35, 0)}, pitch=(-6, 12), hop=(0, 0), ty=(-0.08, 0.08)),
    "splat": dict(p=0.30, F={"0.fwd": (-20, 40), "0.out": (40, 70), "0.twist": (-15, 15), "1.pitch": (-20, 50), "2.pitch": (-30, 20)},
                  H={"0.fwd": (-40, 20), "0.out": (20, 40), "0.twist": (-20, 20), "1.pitch": (-10, 40), "2.pitch": (-30, 10)}, pitch=(-6, 10), hop=(0, 0), ty=(-0.08, 0.08)),
    "air": dict(p=0.25, F={"0.fwd": (-40, 30), "0.out": (-10, 40), "0.twist": (-15, 15), "1.pitch": (-20, 40), "2.pitch": (0, 50)},
                H={"0.fwd": (-45, 10), "0.out": (-30, 15), "0.twist": (-25, 15), "1.pitch": (-45, 10), "2.pitch": (0, 45)}, pitch=(-35, 10), hop=(0.05, 0.5), ty=(-0.08, 0.08)),
    "lunge": dict(p=0.15, F={"0.fwd": (-50, -15), "0.out": (-10, 25), "0.twist": (-15, 15), "1.pitch": (-10, 40), "2.pitch": (-10, 40)},
                  H={"0.fwd": (-50, -10), "0.out": (-25, 15), "0.twist": (-35, 0), "1.pitch": (-40, 5), "2.pitch": (-10, 35)}, pitch=(-6, 16), hop=(0, 0), ty=(-0.2, 0.02)),
}
_orig = sk.sample_pose


def sample_pose(skel, rng):
    p = _orig(skel, rng)                                   # 头、整体朝向和侧倾沿用共用的随机
    D = {n: k for k, n in enumerate(skel.dof_names)}
    names = list(SETS); s = SETS[names[int(rng.choice(len(names), p=[SETS[n]["p"] for n in names]))]]
    th = p["theta"]
    for grp, legs in (("F", ("LF", "RF")), ("H", ("LH", "RH"))):
        for key, (a, b) in s[grp].items():
            part, kind = key.split("."); base = rng.uniform(a, b)                  # 左右两条腿用同一个基准，再各加一点偏差
            for leg in legs:
                k = D[f"{BONE[leg][int(part)]}.{kind}"]
                th[k] = np.clip(math.radians(base + rng.normal(0, 7)), skel.dof_lo[k], skel.dof_hi[k])
    yaw, _, roll = p["ypr"]
    pitch = math.radians(rng.uniform(*s["pitch"])); roll = float(np.clip(roll, -math.radians(12), math.radians(12)))
    t = np.array([p["t"][0], rng.uniform(*s["ty"]), 0.0])
    joints, _ = skel.pose_joints(th, sk.euler_root(yaw, pitch, roll), t)
    t[2] = sk.ground_lift(skel, joints) + rng.uniform(*s["hop"])
    return {"theta": th, "ypr": np.array([yaw, pitch, roll]), "t": t}


sk.sample_pose = sample_pose
runpy.run_path(os.path.join(HERE, "render_dataset.py"), run_name="__main__")
