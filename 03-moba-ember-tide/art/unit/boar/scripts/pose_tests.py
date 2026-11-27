"""对着野猪的骨架摆一组有针对性的姿势并渲染（共用的 prep_rig.py 里那几组极限姿势是按四足兽的骨骼名写死的，对野猪只生效一部分）。
用法: Blender -b --factory-startup V2R/assets/model/boar.blend -P pose_tests.py -- <输出目录> [只渲染这几个 ...]
每个姿势出 <输出目录>/boar_t_<tag>_{front,side}.png；另外把静止姿势下各跟踪点的画面坐标存成 boar_t_restj.npy（draw_joints.py 用）。"""
import math, os, sys
import bpy, numpy as np
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, os.path.join(V2R, "scripts/blender"))
import bl_common as bc
from v2r import skeleton as sk
args = bc.script_args(); out = args[0]; only = set(args[1:]); os.makedirs(out, exist_ok=True)
scene = bpy.context.scene; arm, mesh = bc.character()
skel = sk.Skeleton.load(os.path.join(V2R, "assets/model/boar_skeleton.json"))
D = {n: k for k, n in enumerate(skel.dof_names)}
LEG = {"LF": ("bone_10", "0_Left_Limb_0", "0_Left_Limb_1", "0_Left_Limb_2"), "RF": ("bone_5", "0_Right_Limb_0", "0_Right_Limb_1", "0_Right_Limb_2"),
       "LH": (None, "bone_34", "bone_35", "bone_36"), "RH": (None, "1_Right_Limb_0", "1_Right_Limb_1", "1_Right_Limb_2")}


def leg(which, u=0, m=0, e=0, sc=0, out_=0, tw=0):
    """一条腿：u 上段前后摆（正=朝前），m 中段 pitch，e 末段 pitch（正=末端向后），sc 肩胛，out_ 外展，tw 自转。"""
    s, a, b, c = LEG[which]; d = {a + ".fwd": u, b + ".pitch": m, c + ".pitch": e, a + ".out": out_, a + ".twist": tw}
    if s: d[s + ".fwd"] = sc
    return d


def head(np_=0, ny=0, nr=0, hp=0, hy=0, hr=0):
    return {"Spine_4.pitch": np_, "Spine_4.yaw": ny, "Spine_4.roll": nr, "Head_1.pitch": hp, "Head_1.yaw": hy, "Head_1.roll": hr}


def spine(p=0, y=0, t=0):
    return {"Spine_1.spine_pitch": p, "Spine_1.spine_yaw": y, "Spine_1.spine_twist": t}


def pose(tag, parts, ypr=(0, 0, 0), ground=True):
    deg = {}
    for p in parts: deg.update(p)
    p = {"theta": np.zeros(skel.D), "ypr": np.radians(ypr), "t": np.zeros(3)}
    for key, v in deg.items(): p["theta"][D[key]] = math.radians(v)
    over = [(n, round(math.degrees(p["theta"][k]))) for n, k in D.items() if p["theta"][k] < skel.dof_lo[k] - 1e-6 or p["theta"][k] > skel.dof_hi[k] + 1e-6]
    if ground:
        j, _ = skel.pose_joints(p["theta"], sk.euler_root(*p["ypr"]), p["t"]); p["t"][2] = sk.ground_lift(skel, j)
    quats, loc, joints = bc.pose_from_params(skel, p); bc.set_pose(arm, skel, quats, loc)
    bc.render_views(scene, os.path.join(out, f"boar_t_{tag}_{{view}}.png"))
    print("POSE %-14s 抬高 %+.3f 最高点 %.3f 鼻尖 z %.3f%s" % (tag, p["t"][2], joints[:, 2].max(), joints[skel.joint_names.index("Nose"), 2], ("  超出范围: %s" % over) if over else ""), flush=True)


tests = {
 # 每条腿单独动，看左右有没有写反、弯的方向对不对
 "LF_up": ([leg("LF", u=40, m=-60, e=80, sc=10)], (0, 0, 0)),
 "RF_paw": ([leg("RF", u=30, m=-40, e=60, sc=8)], (0, 0, 0)),                                   # 右前蹄抬起刨地
 "LH_up": ([leg("LH", u=35, m=40, e=-50)], (0, 0, 0)),
 "RH_back": ([leg("RH", u=-45, m=20, e=30)], (0, 0, 0)),                                         # 右后腿向后蹬
 "legs_out": ([leg(k, out_=30) for k in LEG], (0, 0, 0)),
 # 头
 "root": ([head(np_=50, hp=40), leg("LF", u=15, m=-30, e=20), leg("RF", u=15, m=-30, e=20)], (0, 8, 0)),          # 低头拱地
 "gore_up": ([head(np_=-35, hp=-45)], (0, -8, 0)),                                                # 獠牙上挑到头
 "head_left": ([head(ny=35, hy=40)], (0, 0, 0)),
 "head_right_roll": ([head(ny=-30, hy=-35, hr=-25, nr=-15)], (0, 0, 0)),                          # 头向右甩并歪
 "windup": ([head(np_=40, ny=-25, hp=20, hy=-30, hr=-15)], (0, 5, 0)),                           # 普攻前摇：头压低、摆向右后
 # 身体
 "spine_arch": ([spine(p=7)], (0, 0, 0)),
 "spine_yaw_tw": ([spine(y=9, t=6)], (0, 0, 0)),
 "sit_back": ([leg("LH", u=45, m=45, e=-50), leg("RH", u=30, m=45, e=-50), leg("LF", u=25, sc=10), leg("RF", u=25, sc=10), head(np_=30, hp=15)], (0, -6, 0)),   # 向后坐、蓄力
 "lunge": ([leg("LH", u=-45, m=10, e=25), leg("RH", u=-50, m=10, e=25), leg("LF", u=-35, sc=-12, m=10), leg("RF", u=-35, sc=-12, m=10), head(np_=-15, hp=-30), spine(p=-5)], (0, -10, 0)),   # 后腿蹬直、肩膀前顶
 "front_up": ([leg("LF", u=30, m=-50, e=70), leg("RF", u=20, m=-60, e=90), leg("LH", u=-20), leg("RH", u=-20), head(np_=-20, hp=-30)], (0, -30, 0)),            # 前半身抬起
 "trot_a": ([leg("LF", u=40, m=-35, e=40, sc=12), leg("RH", u=40, m=20, e=-30), leg("RF", u=-35, m=5, e=25, sc=-10), leg("LH", u=-40, m=15, e=25), head(np_=15, hp=10)], (0, 3, 0)),
 "trot_b": ([leg("RF", u=40, m=-35, e=40, sc=12), leg("LH", u=40, m=20, e=-30), leg("LF", u=-35, m=5, e=25, sc=-10), leg("RH", u=-40, m=15, e=25), head(np_=15, hp=10)], (0, 3, 0)),
 "kneel": ([leg("LF", u=-25, m=-80, e=110), leg("RF", u=-25, m=-80, e=110), head(np_=35, hp=20)], (0, 16, 0)),                                                 # 前腿跪下
 "lie": ([leg("LF", u=-25, m=-80, e=110), leg("RF", u=-25, m=-80, e=110), leg("LH", u=60, m=70, e=-70), leg("RH", u=45, m=70, e=-70), head(np_=45, hp=30)], (0, 4, 0)),   # 四条腿都趴下、头垂到地（死亡的结尾）
 "turn_roll": ([head(ny=15, hy=15), spine(y=5)], (50, 0, 12)),
}
for tag, (parts, ypr) in tests.items():
    if only and tag not in only: continue
    pose(tag, parts, ypr)
if not only or "restj" in only:
    quats, loc, joints = bc.pose_from_params(skel, {"theta": np.zeros(skel.D), "ypr": np.zeros(3), "t": np.zeros(3)}); bc.set_pose(arm, skel, quats, loc)
    bc.render_views(scene, os.path.join(out, "boar_t_restj_{view}.png"))
    np.save(os.path.join(out, "boar_t_restj.npy"), sk.project(bc.read_joints(arm, skel)))
print("DONE", flush=True)
