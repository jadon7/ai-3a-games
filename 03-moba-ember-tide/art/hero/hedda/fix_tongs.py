"""赫达专用：把管线读出来的动作里“火钳怎么拿”修正过来，再给 hero_build.py 的 game 一步用。

为什么要有这一步：管线只读得出关节的位置，拳头绕前臂怎么拧是定不下来的；火钳很长、只跟着右手走，拳头差一点钳口就甩到身后
（没修之前：直戳、钳钩里火钳整根反过来，钳口朝后；待机里火钳歪三十度）。做法（照 art/hero/vero/fix_motion.py 的思路）：
  two    双手都握在杆上的时候：杆的方向由“右手握点到左手握点”这条线定（左手总是握在更靠钳口的一侧），左手的拳头也转到握着杆的样子。
         两只手挨得太近（小于 0.07）时这条线不准，沿用前面最后一个可靠的方向。
  dir    单手拿的时候：杆按给定的方向，[偏航, 俯仰]（度）是相对胯的朝向：偏航 0 朝前、正的往角色左边转；俯仰 90 竖直朝上。
  stance 待机：两条胳膊照站姿摆（火钳竖着拄地），身体照读出来的动作起伏。
  arm    直戳：杆顺着右肩到右手腕的方向（两手并在一起、连线不准的时候用）；给了 pitch 就只取水平朝向、俯仰按 pitch。
  two 里的 pitch：[最低, 最高] 把杆的俯仰夹住（单膝跪地横挡时连线斜向地面）。
  two 里的 lead：哪只手更靠钳口。站姿和直戳是左手在前（left，默认）；从右上往左下抡砸像右打者挥棒，右手在前（right）。
  不在任何一段里的帧：保持读出来的样子（已经补过系统偏差，见 fix_hand.py）。
手腕绕杆怎么转：让拳头的“刃口方向”顺着前臂（手腕不弯），和 hero_build.py 摆站姿的规则一样。
另外 floor：每帧把整个人上下挪一点，让最低的那只脚贴着地（视频读出来有几段整个人飘起来三厘米）；钳口尖和柄尾不许低于地面（限制杆的俯仰）。

用法: Blender -b --factory-startup -P art/hero/hedda/fix_tongs.py -- art/hero/hedda/fix.json [动作,动作…]
读 <src_dir>/<动作>.npz（tools/hero_motion.py 的产出），写 <dst_dir>/<动作>.npz。build.json 的 motions 指向 dst_dir。
"""
import bpy, sys, json, math, os
import numpy as np
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
P = lambda p: p if os.path.isabs(p) else os.path.join(ROOT, p)
cfg = json.load(open(P(argv[0]), encoding="utf-8"))
only = set(argv[1].split(",")) if len(argv) > 1 and argv[1] not in ("", "all") else None
MX = "mixamorig:"; UP = Vector((0, 0, 1))

bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=P(cfg["rigged"]))
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
B = arm.data.bones; PB = arm.pose.bones; upd = bpy.context.view_layer.update
for pb in PB: pb.rotation_mode = "QUATERNION"
REST = {b.name: b.matrix_local.copy() for b in B}
FEET = [MX + s + n for s in ("Left", "Right") for n in ("Foot", "ToeBase", "Toe_End")]


def hand_axes(side):
    """静止姿势下拳头的两根轴（骨架空间）：L 杆身方向（小指指向食指），E 刃口方向（顺着前臂往外）；握点相对手骨头部的偏移"""
    h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
    idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local; mid = B[MX + side + "HandMiddle1"].head_local
    L = (idx - pky).normalized(); d = (h - fore).normalized(); E = (d - L * d.dot(L)).normalized()
    return L, E, (mid - h) * 0.7
AX = {s: hand_axes(s) for s in ("Left", "Right")}
TIP, TAIL = 0.79, 0.47                                            # 握点到钳口尖、到柄尾的长度（身高是 1）


def set_pose(names, q, loc):
    for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    for i, nm in enumerate(names):
        pb = PB.get(nm)
        if pb is not None: pb.rotation_quaternion = Quaternion(q[i])
    PB[MX + "Hips"].location = Vector(loc); upd()


def cur(side):
    """拳头现在的 L、E（骨架空间）和握点"""
    pb = PB[MX + side + "Hand"]; R = pb.matrix.to_3x3() @ REST[MX + side + "Hand"].to_3x3().inverted()
    L, E, off = AX[side]; return (R @ L).normalized(), (R @ E).normalized(), pb.head + R @ off


def frame(a, b):
    a = Vector(a).normalized(); b = Vector(b); b = (b - a * b.dot(a)); b = b.normalized() if b.length > 1e-6 else a.orthogonal().normalized()
    return Matrix((a, b, a.cross(b))).transposed()


def aim_hand(side, W, w=1.0):
    """把一只拳头转到杆朝 W、刃口顺着前臂；w 是只转多少（0..1）"""
    pb = PB[MX + side + "Hand"]; upd(); L, E, _ = cur(side)
    fore = (pb.head - PB[MX + side + "ForeArm"].head).normalized()
    Rd = frame(W, fore) @ frame(L, E).inverted()
    if w < 1.0: Rd = Quaternion().slerp(Rd.to_quaternion(), w).to_matrix()
    h = pb.head.copy(); pb.matrix = Matrix.Translation(h) @ Rd.to_4x4() @ Matrix.Translation(-h) @ pb.matrix; upd()


def body_dir(yaw, pitch, world=False):
    """胯的朝向下的一个方向：偏航 0 朝前、正的往左；俯仰 90 朝上。world 为真时偏航相对角色原本的正前方（-Y），不跟着胯扭"""
    R = PB[MX + "Hips"].matrix.to_3x3() @ REST[MX + "Hips"].to_3x3().inverted()
    f = Vector((0, -1, 0)) if world else R @ Vector((0, -1, 0)); f.z = 0; f.normalize(); l = UP.cross(f)
    y, p = math.radians(yaw), math.radians(pitch)
    return (math.cos(p) * (math.cos(y) * f + math.sin(y) * l) + math.sin(p) * UP).normalized()


st = np.load(P(cfg["stance"]), allow_pickle=True); st_names = [str(x) for x in st["names"]]
set_pose(st_names, st["quats"], st["loc"])
FLOOR = min(PB[n].head.z for n in FEET)                          # 站姿里最低的脚的关节离地多高
ST_ARM = {nm: Quaternion(st["quats"][i]) for i, nm in enumerate(st_names) if nm.endswith(("Shoulder", "Arm", "ForeArm", "Hand"))}      # 两条胳膊（不含手指）
print("STANCE floor", round(FLOOR, 4), "arm bones", len(ST_ARM))


def weights(segs, T):
    """每一帧落在哪几段里、各占多少（段的两头按 ramp 帧数渐入渐出；碰到动作的头尾就不渐）"""
    out = [[] for _ in range(T)]
    for k, s in enumerate(segs):
        a, b = s["from"], min(s["to"], T - 1); r = s.get("ramp", 4)
        for f in range(max(0, a - r), min(T - 1, b + r) + 1):
            if f < a: w = 0.0 if a == 0 else 1 - (a - f) / (r + 1)
            elif f > b: w = 0.0 if b == T - 1 else 1 - (f - b) / (r + 1)
            else: w = 1.0
            if a == 0 and f < a: w = 0
            if w > 0: out[f].append((k, w))
    return out


def smooth_dirs(D, sigma=1.5):
    if sigma <= 0: return D
    r = int(math.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); A = np.array([list(d) for d in D]); out = np.zeros_like(A)
    for i in range(len(A)):
        acc = np.zeros(3); ws = 0
        for j, kw in zip(range(i - r, i + r + 1), k):
            if 0 <= j < len(A): acc += kw * A[j]; ws += kw
        out[i] = acc / ws
    return [Vector(v).normalized() for v in out]


os.makedirs(P(cfg["dst_dir"]), exist_ok=True)
for name in cfg["clips"].keys() | set(n[:-4] for n in os.listdir(P(cfg["src_dir"])) if n.endswith(".npz")):
    if only and name not in only: continue
    src = os.path.join(P(cfg["src_dir"]), name + ".npz")
    if not os.path.exists(src): continue
    c = cfg["clips"].get(name, {}); m = np.load(src, allow_pickle=True); names = [str(x) for x in m["names"]]; Q = m["quats"].copy(); LOC = m["loc"].copy(); T = len(Q)
    segs = c.get("segs", []); W8 = weights(segs, T)
    # 第一遍：算出每帧“双手”模式的杆方向（握点连线），不可靠的帧沿用前一帧
    two = [None] * T; last = None
    for f in range(T):
        set_pose(names, Q[f], LOC[f]); _, _, pR = cur("Right"); _, _, pL = cur("Left"); d = pL - pR
        if d.length >= c.get("min_gap", 0.07): last = d.normalized()
        two[f] = last
    first = next((d for d in two if d is not None), Vector((0, 0, 1))); two = [d if d is not None else first for d in two]
    two = smooth_dirs(two, c.get("sigma", 1.5))
    hi = {nm: i for i, nm in enumerate(names)}; log = []
    for f in range(T):
        set_pose(names, Q[f], LOC[f])
        ws = W8[f]; tot = sum(w for _, w in ws)
        stance_w = sum(w for k, w in ws if segs[k]["mode"] == "stance")
        if stance_w > 0:                                           # 待机：胳膊照站姿
            for nm, q in ST_ARM.items():
                pb = PB.get(nm)
                if pb is not None: pb.rotation_quaternion = Quaternion(pb.rotation_quaternion).slerp(q, stance_w)
            upd()
        dirs = []
        for k, w in ws:
            s = segs[k]
            if s["mode"] == "two":
                d_ = two[f] * (-1 if s.get("lead", "left") == "right" else 1)
                if "pitch" in s:                                   # 给了 [最低, 最高]（度）就把杆的俯仰夹在这个范围里
                    el = math.degrees(math.asin(max(-1, min(1, d_.z)))); el2 = max(s["pitch"][0], min(s["pitch"][1], el))
                    if el2 != el: hz = Vector((d_.x, d_.y, 0)).normalized(); d_ = (hz * math.cos(math.radians(el2)) + UP * math.sin(math.radians(el2))).normalized()
                dirs.append((d_, w, True))
            elif s["mode"] == "arm":
                a_ = (PB[MX + "RightHand"].head - PB[MX + "RightArm"].head).normalized()
                if "pitch" in s:                                   # 只要手臂的水平朝向，俯仰按给定的
                    hz = Vector((a_.x, a_.y, 0)).normalized(); pr = math.radians(s["pitch"]); a_ = (hz * math.cos(pr) + UP * math.sin(pr)).normalized()
                dirs.append((a_, w, False))
            elif s["mode"] == "dir": dirs.append((body_dir(*s["dir"], world=s.get("world", False)), w, False))
        if dirs:
            Wt = sum((d * w for d, w, _ in dirs), Vector()); wsum = sum(w for _, w, _ in dirs); Wt.normalize()
            _, _, pR = cur("Right"); lo_ = (0.02 - pR.z) / TIP; hi_ = pR.z / TAIL      # 钳口尖、柄尾都不许插进地里：限制杆的俯仰
            if Wt.z < lo_ or Wt.z > hi_:
                zc = max(min(Wt.z, hi_, 1.0), lo_, -1.0); hz = Vector((Wt.x, Wt.y, 0)); hz = hz.normalized() if hz.length > 1e-6 else Vector((0, -1, 0))
                Wt = (hz * math.sqrt(max(0.0, 1 - zc * zc)) + UP * zc).normalized()
            for _ in range(2):                                     # 转右手会把握点挪一点，转两遍让杆正好穿过左手
                aim_hand("Right", Wt, min(1.0, wsum))
                if any(t for _, _, t in dirs) and all(t for _, _, t in dirs):
                    _, _, pR = cur("Right"); _, _, pL = cur("Left"); d = pL - pR
                    sg = -1 if all(segs[k].get("lead", "left") == "right" for k, _ in ws if segs[k]["mode"] == "two") else 1
                    if d.length > c.get("min_gap", 0.07): Wt = (Wt * 0.5 + d.normalized() * sg * 0.5).normalized()
            tw = sum(w for _, w, t in dirs if t)
            if tw > 0: aim_hand("Left", Wt, min(1.0, tw))           # 左拳也转成握着杆的样子
        if c.get("floor", True):                                   # 最低的脚贴地
            low = min(PB[n].head.z for n in FEET); dz = FLOOR - low
            hp = PB[MX + "Hips"]; Rr = REST[MX + "Hips"].to_3x3()
            hp.location = Vector(hp.location) + Rr.inverted() @ Vector((0, 0, dz)); upd()
        for nm, i in hi.items():
            pb = PB.get(nm)
            if pb is not None: Q[f, i] = list(pb.rotation_quaternion)
        LOC[f] = list(PB[MX + "Hips"].location)
        L, _, pR = cur("Right"); log.append((f, L, pR))
    np.savez(os.path.join(P(cfg["dst_dir"]), name + ".npz"), names=m["names"], quats=Q, loc=LOC, fps=m["fps"])
    tips = [(f, round(math.degrees(math.asin(max(-1, min(1, L.z)))))) for f, L, _ in log[:: max(1, T // 8)]]
    print("FIX", name, T, "frames; 杆的仰角（每隔几帧）", tips)
