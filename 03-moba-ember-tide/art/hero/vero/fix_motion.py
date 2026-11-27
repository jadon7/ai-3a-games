"""薇萝专用：把管线读出来的动作里“弩怎么拿”这件事修正过来，再给 hero_build.py 的 game 一步用。

为什么要有这一步：管线只读得出关节的位置，手腕绕前臂怎么拧是定不下来的。薇萝的弩很长，只跟着右手的骨骼走，
手腕差一点弩口就甩出去几十度（没修之前：站姿里弩偏左 37 到 44 度，普攻瞄准时偏到 85 度，朝着身体左边）。
做法：双手端弩的时候，弩身的方向由“右手腕到左手腕”这条线决定（两只手和弩的相对位置照站姿里的来），弩臂保持水平；
左手离开弩的时候（抛罐子、阵亡），弩按配置里给的方向垂着；再按配置在出手的那一刻把整个人转一点，让弩口对准正前方。
另外顺手把陷进地里的脚抬回地面（整个人往上提）。

用法: Blender -b --factory-startup -P art/hero/vero/fix_motion.py -- art/hero/vero/fix.json [只处理的动作名,…] [diag]
读 <src_dir>/<动作>.npz（tools/hero_motion.py 的产出），写 <dst_dir>/<动作>.npz（同样的格式）。build.json 的 motions 指向 dst_dir。
配置 fix.json：
  rigged  管线的输入模型（video2rig/assets/model/vero_rigged.glb）    stance  站姿（art/hero/vero/stance.npz）
  grip    算弩身方向时左手腕相对右手腕的位置（沿弩臂向左、向上，身高是 1）。视频是按“左手握拳托在机匣下”的参考图出的，所以用那时候的值
  clips.<动作>:
    one   左手不在弩上的帧段（成品的帧号，30 帧每秒）：[{"from":4,"to":70,"yaw":5,"pitch":-30}]，pitch 写 "ground" 是弩口垂到地上
    aim   把整个人绕竖直轴转，让弩口的水平方向对到 yaw：[{"t":[进,满,退,出],"yaw":0}]；t 不写是整段
    lift  false 时不做“抬回地面”
"""
import bpy, sys, json, math, os
import numpy as np
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
P = lambda p: p if os.path.isabs(p) else os.path.join(ROOT, p)
cfg = json.load(open(P(argv[0]), encoding="utf-8"))
only = set(argv[1].split(",")) if len(argv) > 1 and argv[1] not in ("", "all") else None
diag = "diag" in argv
MX = "mixamorig:"; Z = Vector((0, 0, 1))

bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=P(cfg["rigged"]))
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE"); body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
B = arm.data.bones; PB = arm.pose.bones; upd = bpy.context.view_layer.update
for pb in PB: pb.rotation_mode = "QUATERNION"
REST = {b.name: b.matrix_local.copy() for b in B}


def set_pose(names, q, loc):
    for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    for i, nm in enumerate(names):
        pb = PB.get(nm)
        if pb is not None: pb.rotation_quaternion = Quaternion(q[i])
    PB[MX + "Hips"].location = Vector(loc); upd()
head = lambda n: PB[MX + n].head.copy()
rot = lambda n: PB[MX + n].matrix.to_3x3()


def wframe(W, prevL=None):
    """弩的坐标（世界）：W 弩口方向，L 弩臂（水平，指向弩的左边），U 向上。弩身接近竖直时水平方向定不住，就沿用上一帧的"""
    W = Vector(W).normalized(); L = Z.cross(W)
    if L.length < 0.25 and prevL is not None: L = Vector(prevL) - W * Vector(prevL).dot(W)
    if L.length < 1e-4: L = Vector((1, 0, 0)) - W * W.x
    L.normalize(); U = W.cross(L).normalized()
    return Matrix((W, L, U)).transposed()                      # 三列是 W、L、U


# ---- 弩在右手骨骼上的位置（静止姿势里量） ----
to_arm = arm.matrix_world.inverted() @ body.matrix_world
wi = [i for i, s in enumerate(body.material_slots) if s.material.name.startswith("weapon")]
wv = sorted(set(v for p in body.data.polygons if p.material_index in wi for v in p.vertices))
A = np.array([list(to_arm @ body.data.vertices[v].co) for v in wv]); c0 = A.mean(0); _, _, vt = np.linalg.svd(A - c0, full_matrices=False)
a0 = Vector(vt[0]); l0 = Vector(vt[1]); hR = REST[MX + "RightHand"]
pr = (A - c0) @ np.array(a0)
if abs(pr.min()) > abs(pr.max()) and False: pass
wrist0 = np.array(hR.translation)
if np.linalg.norm(A[pr.argmax()] - wrist0) < np.linalg.norm(A[pr.argmin()] - wrist0): a0 = -a0; pr = -pr      # 离手腕远的那一头是弩口
tip0 = Vector(A[pr > pr.max() - 0.02 * (pr.max() - pr.min())].mean(0)); WLEN = float(pr.max() - pr.min())
tip_along = float((np.array(tip0) - wrist0) @ np.array(a0))     # 弩口在手腕前面多远（沿弩身）

# ---- 站姿：定弩臂的正反、两只手和弩的相对位置 ----
st = np.load(P(cfg["stance"]), allow_pickle=True); st_names = [str(x) for x in st["names"]]
set_pose(st_names, st["quats"], st["loc"])
Ms = rot("RightHand") @ hR.to_3x3().inverted()                  # 站姿里右手相对静止姿势转了多少
Ws = (Ms @ a0).normalized(); Fs = wframe(Ws)
if (Ms @ l0).dot(Fs.col[1]) < 0: l0 = -l0
u0 = a0.cross(l0).normalized(); l0 = u0.cross(a0).normalized(); F0 = Matrix((a0, l0, u0)).transposed()
Fs_true = Ms @ F0
ds = head("LeftHand") - head("RightHand"); rel_s = Fs.transposed() @ ds
QL = Fs.transposed() @ rot("LeftHand")                          # 站姿里左手相对弩的朝向
tipS = head("RightHand") + Ms @ (tip0 - hR.translation)
print("STANCE weapon yaw %.1f pitch %.1f  limb tilt %.1f deg  left wrist rel (along %.3f, left %.3f, up %.3f)  tip %s len %.3f" % (
    math.degrees(math.atan2(Ws.x, -Ws.y)), math.degrees(math.asin(Ws.z)), math.degrees(math.asin(max(-1, min(1, Fs_true.col[1].z)))), rel_s[0], rel_s[1], rel_s[2], [round(v, 3) for v in tipS], WLEN))
print("STANCE wrist bend %.0f deg" % math.degrees((head("RightHand") - head("RightForeArm")).angle(head("RightHandMiddle1") - head("RightHand"))))
G = cfg.get("grip", {}); dL = G.get("left", rel_s[1]); dU = G.get("up", rel_s[2])      # 算方向用的偏移
pL = G.get("place_left", rel_s[1]); pU = G.get("place_up", rel_s[2])                   # 左手实际放的位置（站姿里的）
wrist_tip = Fs.transposed() @ (tipS - head("RightHand"))        # 弩口相对右手腕（弩的坐标里）


def two_hand(pw, lh, prevL):
    d = lh - pw; W = d.normalized()
    for _ in range(6):
        F = wframe(W, prevL); W = (d - F.col[1] * dL - F.col[2] * dU).normalized()
    return W
def dir_of(yaw, pitch):
    y, p = math.radians(yaw), math.radians(pitch); return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
def yaw_of(W): return math.degrees(math.atan2(W.x, -W.y))
def pitch_of(W): return math.degrees(math.asin(max(-1, min(1, W.z))))
def gauss(x, sigma, wrap=False):
    """沿时间做高斯平滑。wrap：循环动作（最后一帧等于第一帧），首尾接起来平滑"""
    x = np.asarray(x, dtype=float); r = int(math.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    if wrap:
        y = x[:-1]; pad = np.concatenate([y[-r:], y, y[:r]]); o = sum(w * pad[i:i + len(y)] for i, w in enumerate(k)); return np.concatenate([o, o[:1]])
    pad = np.concatenate([np.repeat(x[:1], r, 0), x, np.repeat(x[-1:], r, 0)]); return sum(w * pad[i:i + len(x)] for i, w in enumerate(k))
def ramp(f, t):
    """t = [进, 满, 退, 出]：进到满从 0 升到 1，退到出从 1 降到 0"""
    a, b, c, d = t; s = lambda x: x * x * (3 - 2 * x)
    if f < a or f > d: return 0.0
    if f < b: return s((f - a) / (b - a)) if b > a else 1.0
    if f > c: return s((d - f) / (d - c)) if d > c else 1.0
    return 1.0
def aim_bone(name, target):
    pb = PB[MX + name]; upd(); cur = (pb.tail - pb.head).normalized(); h = pb.head.copy()
    R = cur.rotation_difference(Vector(target).normalized()).to_matrix().to_4x4()
    pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.matrix; upd()
def set_rot(name, R3):
    pb = PB[MX + name]; upd(); pb.matrix = Matrix.Translation(pb.head.copy()) @ R3.to_4x4(); pb.location = (0, 0, 0); pb.scale = (1, 1, 1); upd()


GROUND = (("LeftToeBase", 0.012), ("RightToeBase", 0.012), ("LeftToe_End", 0.010), ("RightToe_End", 0.010), ("LeftFoot", 0.045), ("RightFoot", 0.045), ("LeftLeg", 0.040), ("RightLeg", 0.040),
          ("Hips", 0.085), ("LeftHand", 0.02), ("RightHand", 0.02), ("LeftForeArm", 0.03), ("RightForeArm", 0.03), ("Head", 0.08))


def rot_about(name, R3):
    pb = PB[MX + name]; upd(); h = pb.head.copy(); pb.matrix = Matrix.Translation(h) @ R3.to_4x4() @ Matrix.Translation(-h) @ pb.matrix; upd()
def ik2(upper, lower, target, pole):
    """两段骨骼的解析解：upper 的头不动，让 lower 的尾到 target，关节朝 pole 那一侧（和 hero_build.py 里摆站姿用的一样）"""
    pu = PB[MX + upper]; upd(); H = pu.head.copy(); l1 = B[MX + upper].length; l2 = B[MX + lower].length
    d = Vector(target) - H; dist = min(d.length, (l1 + l2) * 0.998); dn = d.normalized()
    a_ = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist); hgt = math.sqrt(max(l1 * l1 - a_ * a_, 0)); pv = Vector(pole); pv = (pv - dn * pv.dot(dn)).normalized()
    K = H + dn * a_ + pv * hgt; aim_bone(upper, K - H); aim_bone(lower, H + dn * dist - K)
def kneel_pose(yaw, o):
    """手摆的“跪倒”姿势（管线读不准跪姿）：双膝着地、脚背贴地、坐向脚跟，上身前倾，头垂下，两臂垂着。yaw 是胯的朝向（度），o 里是前倾的程度"""
    for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    upd(); hips = PB[MX + "Hips"]; h0 = REST[MX + "Hips"]; Rz = Matrix.Rotation(math.radians(yaw), 3, "Z")
    fw = Rz @ Vector((0, -1, 0)); lf = Rz @ Vector((1, 0, 0)); dn = Vector((0, 0, -1))
    hips.matrix = Matrix.Translation((o.get("x", 0.0), o.get("y", 0.03), o.get("z", 0.27))) @ (Rz @ Matrix.Rotation(math.radians(o.get("lean", 12)), 3, "X") @ Matrix.Rotation(math.radians(o.get("roll", 0)), 3, "Y") @ h0.to_3x3()).to_4x4(); upd()
    for nm in ("Spine", "Spine1", "Spine2"): rot_about(nm, Matrix.Rotation(math.radians(o.get("spine", 8)), 3, PB[MX + nm].matrix.to_3x3() @ REST[MX + nm].to_3x3().inverted() @ Vector((1, 0, 0))))
    for nm, k in (("Neck", 0.4), ("Head", 0.6)): rot_about(nm, Matrix.Rotation(math.radians(o.get("head", 20) * k), 3, PB[MX + nm].matrix.to_3x3() @ REST[MX + nm].to_3x3().inverted() @ Vector((1, 0, 0))))
    for side, sx in (("Left", 1), ("Right", -1)):
        hj = PB[MX + side + "UpLeg"].head.copy(); spread = o.get("knees", 0.05)
        ank = Vector((hj.x, hj.y, 0.05)) - fw * o.get("feet_back", 0.215) + lf * sx * 0.01
        ik2(side + "UpLeg", side + "Leg", ank, fw + dn * 0.2 + lf * sx * spread * 6)
        aim_bone(side + "Foot", -fw + dn * 0.32); aim_bone(side + "ToeBase", -fw + dn * 0.1)
        a = o.get("arms", {}).get(side, {})
        aim_bone(side + "Arm", lf * sx * a.get("out", 0.22) + fw * a.get("fwd", 0.15) + dn)
        aim_bone(side + "ForeArm", lf * sx * a.get("out2", 0.02) + fw * a.get("fwd2", 0.4) + dn)
    upd()
    return np.array([list(PB[n].rotation_quaternion) if PB.get(n) is not None else [1, 0, 0, 0] for n in names]), np.array(list(hips.location))
def qslerp_all(a, b, t):
    out = np.zeros_like(a)
    for i in range(len(a)): out[i] = list(Quaternion(a[i]).slerp(Quaternion(b[i]), t))
    return out


os.makedirs(P(cfg["dst_dir"]), exist_ok=True); report = {}
for name, cc in cfg["clips"].items():
    if only and name not in only: continue
    src = os.path.join(P(cfg["src_dir"]), name + ".npz")
    if not os.path.exists(src): print("SKIP", name, "没有", src); continue
    m = np.load(src, allow_pickle=True); names = [str(x) for x in m["names"]]; q = m["quats"].astype(float).copy(); loc = m["loc"].astype(float).copy(); T = len(q)
    idx = {n: i for i, n in enumerate(names)}
    fin = cc.get("finish")
    if fin:                                                      # 从第 at 帧起不用读出来的动作：先双膝落地（加速），再上身垮下去（减速），最后停住
        at = min(fin["at"], T - 1); set_pose(names, q[at], loc[at]); f3 = PB[MX + "Hips"].matrix.to_3x3() @ REST[MX + "Hips"].to_3x3().inverted() @ Vector((0, -1, 0)); yaw_h = math.degrees(math.atan2(f3.x, -f3.y)) + fin.get("yaw_add", 0)
        qA, lA = kneel_pose(yaw_h, fin["a"]); qB, lB = kneel_pose(yaw_h, fin["b"]); n1, n2, n3 = fin.get("drop", 16), fin.get("slump", 14), fin.get("hold", 24)
        q0, l0 = q[at].copy(), loc[at].copy(); nq = [q[f] for f in range(at + 1)]; nl = [loc[f] for f in range(at + 1)]
        for i in range(1, n1 + 1): k = (i / n1) ** fin.get("pow", 1.9); nq.append(qslerp_all(q0, qA, k)); nl.append(l0 + (lA - l0) * k)
        for i in range(1, n2 + 1): k = 1 - (1 - i / n2) ** 2.2; nq.append(qslerp_all(qA, qB, k)); nl.append(lA + (lB - lA) * k)
        for i in range(n3): nq.append(qB.copy()); nl.append(lB.copy())
        q = np.array(nq); loc = np.array(nl); T = len(q)
        for f in range(1, T):
            flip = np.sum(q[f] * q[f - 1], -1) < 0; q[f][flip] *= -1
    # ---- 第一遍：每帧算弩身该指的方向 ----
    W2s = []; ok = []; pws = []; prevL = Fs.col[1].copy(); orig = []; dist = []
    for f in range(T):
        set_pose(names, q[f], loc[f]); pw = head("RightHand"); lh = head("LeftHand")
        W2 = two_hand(pw, lh, prevL); W2s.append(np.array(W2)); pws.append(pw.copy()); dist.append((lh - pw).length); ok.append(0.17 <= (lh - pw).length <= cc.get("max_dist", 0.30))
        prevL = wframe(W2, prevL).col[1].copy(); orig.append(yaw_of(Vector(rot("RightHand") @ hR.to_3x3().inverted() @ a0)))
    W2s = np.array(W2s); ok = np.array(ok)
    for f in range(T):                                           # 跳变：和前后几帧的平均方向差得太多，这一帧不算数
        nb = [g for g in range(max(0, f - 3), min(T, f + 4)) if g != f and ok[g]]
        if nb and ok[f]:
            mean = W2s[nb].mean(0); mean /= max(np.linalg.norm(mean), 1e-9)
            if math.degrees(math.acos(max(-1, min(1, float(mean @ W2s[f]))))) > cc.get("spike", 35): ok[f] = False
    one_w = np.zeros(T); one_dir = [None] * T
    for o in cc.get("one", []):
        for f in range(T):
            k = ramp(f, [o["from"] - o.get("blend", 6), o["from"], o["to"], o["to"] + o.get("blend", 6)])
            if k <= one_w[f]: continue
            if o.get("pitch") == "ground":                      # 弩口搁在地上：按手的高度算俯角，最多垂到 max_pitch
                s_ = min(math.sin(math.radians(o.get("max_pitch", 72))), max(0.0, (pws[f].z - 0.05) / max(0.2, wrist_tip[0]))); pit = -math.degrees(math.asin(s_))
            else: pit = o.get("pitch", -30)
            one_w[f] = k; one_dir[f] = dir_of(o.get("yaw", 5), pit)
    good = [f for f in range(T) if ok[f] and one_w[f] < 0.999]
    two = W2s.copy()
    for f in range(T):                                           # 不算数的帧：用前后算数的帧补
        if ok[f] and one_w[f] < 0.999: continue
        a_ = max([g for g in good if g < f], default=None); b_ = min([g for g in good if g > f], default=None)
        if a_ is None and b_ is None: two[f] = np.array(Ws)
        elif a_ is None: two[f] = W2s[b_]
        elif b_ is None: two[f] = W2s[a_]
        else: two[f] = np.array(Vector(W2s[a_]).slerp(Vector(W2s[b_]), (f - a_) / (b_ - a_)))
    if cc.get("wmean") is not None:                              # 只转弩不转人：把整段的平均水平方向挪到 wmean（左手跟着弩走）
        sel = [f for f in range(T) if one_w[f] < 0.5]; my = float(np.mean([yaw_of(Vector(two[f])) for f in sel])) if sel else 0.0; Rb = Matrix.Rotation(math.radians(cc["wmean"] - my), 3, "Z")
        two = np.array([np.array(Rb @ Vector(w)) for w in two])
    if "max_yaw" in cc or "min_yaw" in cc:                      # 水平方向限幅（只转弩）：免得转得太靠里，弩身插进身体
        for f in range(T):
            y_ = yaw_of(Vector(two[f])); y2 = max(cc.get("min_yaw", -180), min(cc.get("max_yaw", 180), y_))
            if y2 != y_: two[f] = np.array(dir_of(y2, pitch_of(Vector(two[f]))))
    Wt = []; info = []
    for f in range(T):
        W = Vector(two[f]).normalized()
        if one_dir[f] is not None and one_w[f] > 0: W = W.slerp(one_dir[f], float(one_w[f]))
        W.normalize(); Wt.append(np.array(W)); info.append((yaw_of(Vector(W2s[f])), pitch_of(Vector(W2s[f])), dist[f], one_w[f], orig[f], bool(ok[f])))
    lp = bool(cc.get("loop"))
    Wt = np.array(Wt); Wt = gauss(Wt, cc.get("smooth", 1.2), lp); Wt /= np.linalg.norm(Wt, axis=1, keepdims=True); W1w = np.array([i[3] for i in info])
    for a in cc.get("aim", []):                                 # 俯仰：只转弩
        if "pitch" not in a: continue
        t = a.get("t")
        for f in range(T):
            w = 1.0 if t is None else ramp(f, t)
            if w <= 0: continue
            y_ = yaw_of(Vector(Wt[f])); p_ = pitch_of(Vector(Wt[f])); Wt[f] = np.array(dir_of(y_, p_ + (a["pitch"] - p_) * w))
    yaw0 = np.degrees(np.arctan2(Wt[:, 0], -Wt[:, 1]))
    # ---- 把整个人转一点，让弩口对准 ----
    delta = np.zeros(T)
    for a in cc.get("aim", []):
        t = a.get("t"); w = np.array([1.0 if t is None else ramp(f, t) for f in range(T)])
        if "turn" in a: delta += a["turn"] * w
        if "yaw" not in a: continue
        if a.get("mean"): delta += (a.get("yaw", 0) - float(np.average(yaw0, weights=np.maximum(w, 1e-6)))) * w * a.get("k", 1.0)      # 整段转同一个角度：只把平均方向对过去，身体自己的晃动留着
        else: delta += (a.get("yaw", 0) - yaw0) * w * a.get("k", 1.0)
    delta = gauss(delta, 1.0, lp)
    kick = np.zeros(T); kk = cc.get("kick")
    if kk:
        fps_ = float(m["fps"]); ts = [kk["t0"]]
        for i in range(kk["n"] - 1): ts.append(ts[-1] + kk["gap_from"] * (kk["gap_to"] / kk["gap_from"]) ** (i / max(1, kk["n"] - 2)))
        for f in range(T):
            t_ = f / fps_; kick[f] = min(1.4, sum(math.exp(-(t_ - x) / kk.get("decay", 0.045)) for x in ts if t_ >= x - 1e-6))
    if diag:
        print(f"DIAG {name} T {T}")
        for f in range(0, T, 3): print(f"  f{f:3d} 原 yaw {info[f][4]:+6.1f} | 双手 yaw {info[f][0]:+6.1f} pitch {info[f][1]:+6.1f} 手距 {info[f][2]:.3f} {'' if info[f][5] else '不算'} 单手 {info[f][3]:.1f} | 用 yaw {yaw0[f]:+6.1f} pitch {math.degrees(math.asin(Wt[f][2])):+6.1f} 转身 {delta[f]:+5.1f} 合计 {yaw0[f] + delta[f]:+6.1f}")
    # ---- 第二遍：转身、抬回地面、摆两只手 ----
    lift = np.zeros(T)
    if cc.get("lift", True):
        pen = np.zeros(T)
        for f in range(T):
            set_pose(names, q[f], loc[f]); pen[f] = max(0.0, max(lim - head(n).z for n, lim in GROUND))
        lift = np.maximum(pen, gauss(pen, 2.0, lp))
        if fin:                                                  # 手摆的那一段是两个姿势之间直接过渡的，脚会悬空：这一段两头都贴回地面
            for f in range(min(fin["at"], T - 1) + 1, T):
                set_pose(names, q[f], loc[f]); lift[f] = max(lim - head(n).z for n, lim in GROUND)
            a0 = min(fin["at"], T - 1); lift[a0 + 1:] = gauss(lift[a0 + 1:], 1.5)
            for i in range(1, 5):                                # 接缝前几帧过渡一下
                if a0 + i < T: lift[a0 + i] = lift[a0] + (lift[a0 + i] - lift[a0]) * (i / 5)
    out_q = q.copy(); out_loc = loc.copy(); prevL = Fs.col[1].copy(); stats = dict(tip_min=9.0, wrist_bend=0.0, lreach=0, along=[], bends=[])
    for f in range(T):
        set_pose(names, q[f], loc[f]); hips = PB[MX + "Hips"]
        if abs(delta[f]) > 1e-4 or lift[f] > 1e-5:
            hips.matrix = Matrix.Translation((0, 0, lift[f])) @ Matrix.Rotation(math.radians(delta[f]), 4, "Z") @ hips.matrix; upd()
        W = Matrix.Rotation(math.radians(delta[f]), 3, "Z") @ Vector(Wt[f])
        if kick[f] > 1e-3:                                       # 上身绕弩臂的方向往后仰一点，弩口往上跳一点
            Lk = wframe(W, prevL).col[1].copy(); sp = PB[MX + "Spine1"]; h_ = sp.head.copy()
            sp.matrix = Matrix.Translation(h_) @ Matrix.Rotation(-math.radians(kk.get("spine", 1.6) * kick[f]), 4, Lk) @ Matrix.Translation(-h_) @ sp.matrix; upd()
            W = Matrix.Rotation(-math.radians(kk.get("pitch", 3.0) * kick[f]), 3, Lk) @ W
        pw = head("RightHand")
        tipz = pw.z + (wframe(W, prevL) @ wrist_tip).z            # 弩口不许扎进地里
        if tipz < 0.03:
            h = Vector((W.x, W.y, 0)); hl = max(h.length, 1e-4); s_ = max(-0.98, min(0.98, W.z + (0.03 - tipz) / max(0.2, wrist_tip[0]))); W = Vector((h.x / hl * math.sqrt(1 - s_ * s_), h.y / hl * math.sqrt(1 - s_ * s_), s_))
        F = wframe(W, prevL); prevL = F.col[1].copy()
        fore = (head("RightHand") - head("RightForeArm")).normalized()
        set_rot("RightHand", F @ F0.transposed() @ hR.to_3x3())
        hand_dir = (PB[MX + "RightHandMiddle1"].head - PB[MX + "RightHand"].head).normalized(); stats["wrist_bend"] = max(stats["wrist_bend"], math.degrees(fore.angle(hand_dir))); stats["bends"].append(round(math.degrees(fore.angle(hand_dir))))
        k2 = 1.0 - W1w[f]                                        # 双手端弩的程度
        if k2 > 0.01 and cc.get("left", True):
            # 左手：手腕放回站姿里相对弩的位置（沿弩身的远近照读出来的），手掌的朝向也照站姿
            pw = head("RightHand"); lh = head("LeftHand"); along = max(0.13, min(cc.get("max_along", 0.30), (lh - pw).dot(F.col[0])))
            S = head("LeftArm"); l1 = B[MX + "LeftArm"].length; l2 = B[MX + "LeftForeArm"].length
            while True:
                tgt = pw + F.col[0] * along + F.col[1] * pL + F.col[2] * pU
                if (tgt - S).length <= (l1 + l2) * 0.985 or along <= 0.13: break
                along = max(0.13, along - 0.01)
            stats["along"].append(along)
            tgt = lh.lerp(tgt, k2)
            d = tgt - S; dist = min(d.length, (l1 + l2) * 0.998)
            if d.length > (l1 + l2) * 0.998: stats["lreach"] += 1
            dn = d.normalized(); a_ = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist); hgt = math.sqrt(max(l1 * l1 - a_ * a_, 0))
            pole = head("LeftForeArm") - S; pole = pole - dn * pole.dot(dn)
            if pole.length < 1e-4: pole = Vector((1, 0, -0.3)) - dn * Vector((1, 0, -0.3)).dot(dn)
            K = S + dn * a_ + pole.normalized() * hgt
            aim_bone("LeftArm", K - S); aim_bone("LeftForeArm", S + dn * dist - K)
            Rl = rot("LeftHand"); Rt = F @ QL
            set_rot("LeftHand", Rl.to_quaternion().slerp(Rt.to_quaternion(), k2).to_matrix())
        upd(); stats["tip_min"] = min(stats["tip_min"], (head("RightHand") + F @ wrist_tip).z)
        for nm in ("Hips", "RightHand", "LeftArm", "LeftForeArm", "LeftHand"):
            out_q[f, idx[MX + nm]] = list(PB[MX + nm].rotation_quaternion)
        out_loc[f] = list(hips.location)
    # 四元数相邻帧取同号
    for f in range(1, T):
        flip = np.sum(out_q[f] * out_q[f - 1], -1) < 0; out_q[f][flip] *= -1
    if cc.get("loop"): out_q[-1] = out_q[0]; out_loc[-1] = out_loc[0]
    np.savez(os.path.join(P(cfg["dst_dir"]), name + ".npz"), names=np.array(names), quats=out_q, loc=out_loc, fps=m["fps"])
    yawf = yaw0 + delta
    report[name] = dict(frames=T, yaw=[round(float(yawf.min()), 1), round(float(yawf.max()), 1)], yaw_first=round(float(yawf[0]), 1), pitch=[round(float(np.degrees(np.arcsin(Wt[:, 2])).min()), 1), round(float(np.degrees(np.arcsin(Wt[:, 2])).max()), 1)],
                        turn=[round(float(delta.min()), 1), round(float(delta.max()), 1)], lift_max=round(float(lift.max()), 3), tip_min=round(stats["tip_min"], 3), wrist_bend_max=round(stats["wrist_bend"], 0), left_unreachable=stats["lreach"])
    if stats["along"]: report[name]["left_along"] = [round(min(stats["along"]), 3), round(max(stats["along"]), 3)]
    print("FIX", name, json.dumps(report[name], ensure_ascii=False))
    if diag: print("  腕弯（每 3 帧）", stats["bends"][::3])
json.dump(report, open(os.path.join(P(cfg["dst_dir"]), "fix_report.json"), "w"), ensure_ascii=False, indent=1)
