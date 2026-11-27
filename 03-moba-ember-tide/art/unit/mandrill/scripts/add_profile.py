#!/usr/bin/env python3
"""给 prep_rig.py 出的 mandrill_skeleton.json 补一个 profile：只改各关节的活动范围和随机姿势的整体俯仰（骨骼、跟踪点都不动）。

为什么要有：管线里两足的活动范围（v2r/skeleton.py 的 ROLE_DOFS）是按“站直、A 字形”的人写的，角度都相对静止姿势。
山魈静止时就弓着背、大腿前伸 33 度外张 30 度、膝盖弯 61 度、上臂向后 27 度垂着，按人的范围：
  · 上臂前摆最多 150 度，从“向后垂着”举不到头顶正上方（要 180 度以上）；
  · 大腿后摆最多 35 度，跪下去、上身前倾时不够；外张的范围整体偏了 30 度；
  · 脖子和头的骨骼是朝前伸的（人是朝上的），“绕骨骼自身拧”（twist）在它身上变成了歪头，和 roll 是同一个方向，反而没有左右转头。
    所以脊柱、脖子、头的第三个自由度从 twist 换成 yaw（绕竖直轴），三个轴互相垂直。
骨架 JSON 里带 profile 时管线以它为准（Skeleton.__init__），所以写在这里，不用动共用代码。可以重复跑。
用法: python3 add_profile.py <mandrill_skeleton.json>
"""
import json, sys
p = sys.argv[1]; d = json.load(open(p, encoding="utf-8"))
d["profile"] = {
    "kind": "biped",
    "role_dofs": {
        "spine":    [["pitch", -22, 28], ["roll", -15, 15], ["yaw", -20, 20]],
        "neck":     [["pitch", -30, 25], ["roll", -15, 15], ["yaw", -25, 25]],
        "head":     [["pitch", -35, 30], ["roll", -20, 20], ["yaw", -35, 35]],
        "clavicle": [["fwd", -15, 15], ["up", -10, 25]],
        "upperarm": [["fwd", -45, 185], ["out", -30, 100], ["twist", -50, 50]],
        "forearm":  [["hinge", 0, 140], ["twist", -40, 40]],
        "hand":     [["fwd", -45, 45], ["out", -25, 25]],
        "thigh":    [["fwd", -80, 70], ["out", -30, 25], ["twist", -25, 25]],
        "shin":     [["hinge", 0, 145]],
        "foot":     [["pitch", -35, 40], ["yaw", -12, 12]],
        "toe":      [["pitch", -20, 35]],
    },
    "sampling": {"pitch": [4, 16, -45, 70], "t_z": [-0.16, 0.25]},
}
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False)
print("profile 已写入", p)
