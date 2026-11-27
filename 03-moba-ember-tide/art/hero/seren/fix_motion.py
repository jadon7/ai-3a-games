"""塞伦专用：把管线读出来的动作里“长铳怎么拿”修正过来，再给 hero_build.py 的 game 一步用（照薇萝的 art/hero/vero/fix_motion.py 改的）。

为什么：管线只读得出关节的位置，手腕绕前臂怎么拧是定不下来的。长铳 0.85 个身高长、只跟着右手的骨骼走，
手腕差一点枪口就甩出去几十度。塞伦的长铳有三种拿法，每帧按配置里的时间段决定用哪种（段和段之间按 blend 帧过渡）：
  shoulder  扛在右肩上：枪管从右手的握点指向“右肩甲顶上的那个搭点”（站姿里量出来，跟着右锁骨走），
            枪的顶面朝向照站姿（相对胸口），所以压力罐一直朝外。
  two       双手端着：枪身的方向由“右手腕到左手腕”这条线决定（左手托在枪身下面，偏移见 left），枪的顶面朝上；
            左手的手腕放到枪身下面（沿枪身的远近照读出来的，限制在 left.min 到 left.max 之间）。
  free      单手垂着（阵亡、滚珍珠时）：枪口指向配置里给的方向（yaw、pitch，相对胯的朝向）。
另外：aim 在出手的那一刻把整个人绕竖直轴转一点，让枪口水平对准正前方；陷进地里的整个人往上提。

用法: Blender -b --factory-startup -P art/hero/seren/fix_motion.py -- art/hero/seren/fix.json [动作名,…|all] [diag]
读 <src_dir>/<动作>.npz（tools/hero_motion.py 的产出），写 <dst_dir>/<动作>.npz（同样的格式）。build.json 的 motions 指向 dst_dir。
配置 fix.json：
  rigged、stance、src_dir、dst_dir
  rest      {"d": 0.27}  站姿里从握点沿枪身多远是搭在肩上的那一点
  left      {"up": -0.035, "side": 0.0, "min": 0.10, "max": 0.24}  双手端时左手腕相对枪身的位置（往上、往枪的左边，身高是 1）和沿枪身的远近范围
  clips.<动作>:
    default   不在任何段里的帧用哪种拿法（shoulder / two / free）
    modes     [{"from":4,"to":30,"mode":"two","blend":5}, {"from":40,"to":80,"mode":"free","yaw":10,"pitch":-60}]  （成品的帧号，30 帧每秒）
    aim       [{"t":[进,满,退,出],"yaw":0,"pitch":0}]：yaw 转整个人让枪口水平方向对上；pitch 只转枪（左手跟着）
    loop、lift（false 不往上提）、left（false 不摆左手）
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


# ---- 长铳在右手骨骼上的位置（静止姿势里量）：a0 枪口方向、u0 枪的顶面（压力罐的反方向）、g0 握点（手腕在枪轴上的投影） ----
to_arm = arm.matrix_world.inverted() @ body.matrix_world
wi = [i for i, s in enumerate(body.material_slots) if s.material.name.startswith("weapon")]
wv = sorted(set(v for p in body.data.polygons if p.material_index in wi for v in p.vertices))
A = np.array([list(to_arm @ body.data.vertices[v].co) for v in wv]); c0 = A.mean(0); _, _, vt = np.linalg.svd(A - c0, full_matrices=False)
a0 = np.array(vt[0]); hR = REST[MX + "RightHand"]; wrist0 = np.array(hR.translation)
pr = (A - c0) @ a0
if np.linalg.norm(A[pr.argmax()] - wrist0) < np.linalg.norm(A[pr.argmin()] - wrist0): a0 = -a0; pr = -pr      # 离手腕远的那一头是枪口
L_ = pr.max() - pr.min(); s_ = (pr - pr.min()) / L_                                                           # 0 枪托底、1 枪口
tank = A[(s_ > 0.33) & (s_ < 0.47)]; axis_pt = lambda X: c0 + np.outer((X - c0) @ a0, a0)
off = (tank - axis_pt(tank)).mean(0); off -= a0 * (off @ a0); t0 = off / np.linalg.norm(off)                  # 压力罐那一侧
a0 = Vector(a0); u0 = -Vector(t0); l0 = u0.cross(a0).normalized(); u0 = a0.cross(l0).normalized()
F0 = Matrix((a0, l0, u0)).transposed()                                                                         # 三列：枪口、枪的左边、顶面
g0 = Vector(axis_pt(wrist0[None])[0])                                                                          # 握点（静止姿势）
tip_along = float(pr.max() - (np.array(g0) - c0) @ np.array(a0))                                               # 枪口在握点前面多远
print("WEAPON len %.3f  tip ahead of grip %.3f  grip-wrist %.3f" % (L_, tip_along, (g0 - Vector(wrist0)).length))


def gun_frame(W, U):
    W = Vector(W).normalized(); U = Vector(U) - W * Vector(U).dot(W)
    if U.length < 1e-4: U = Z - W * W.z
    U.normalize(); Lf = U.cross(W).normalized(); return Matrix((W, Lf, U)).transposed()
def grip_world():
    """当前姿势下握点的世界位置"""
    return head("RightHand") + rot("RightHand") @ hR.to_3x3().inverted() @ (g0 - hR.translation)
def hand_rot_for(F):
    """右手的世界旋转，让长铳的三个轴对上 F 的三列"""
    return F @ F0.transposed() @ hR.to_3x3()


# ---- 站姿：量搭在肩上的那一点（放在右锁骨的坐标里）、扛着时枪的顶面朝向（放在胸口的坐标里） ----
st = np.load(P(cfg["stance"]), allow_pickle=True); st_names = [str(x) for x in st["names"]]
set_pose(st_names, st["quats"], st["loc"])
Ms = rot("RightHand") @ hR.to_3x3().inverted(); Ws = (Ms @ a0).normalized(); Us = (Ms @ u0).normalized(); gS = grip_world()
REST_D = cfg.get("rest", {}).get("d", 0.27); Pr_s = gS + Ws * REST_D
Msh = PB[MX + "RightShoulder"].matrix.copy(); Pr_local = Msh.inverted() @ Pr_s
Rsp = rot("Spine2"); U_local = Rsp.transposed() @ Us; W_local = Rsp.transposed() @ Ws          # 扛着时枪身相对胸口的方向（右手读错、举得比搭点还高时拿它兜底）
print("STANCE gun yaw %.1f pitch %.1f  rest point %s  top %s" % (math.degrees(math.atan2(Ws.x, -Ws.y)), math.degrees(math.asin(Ws.z)), [round(v, 3) for v in Pr_s], [round(v, 2) for v in Us]))
LEFT = cfg.get("left", {}); L_UP = LEFT.get("up", -0.035); L_SIDE = LEFT.get("side", 0.0); L_MIN0 = LEFT.get("min", 0.10); L_MAX = LEFT.get("max", 0.24)


def dir_of(yaw, pitch):
    y, p = math.radians(yaw), math.radians(pitch); return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
def yaw_of(W): return math.degrees(math.atan2(W.x, -W.y))
def pitch_of(W): return math.degrees(math.asin(max(-1, min(1, W.z))))
def gauss(x, sigma, wrap=False):
    x = np.asarray(x, dtype=float); r = int(math.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    if wrap:
        y = x[:-1]; pad = np.concatenate([y[-r:], y, y[:r]]); o = sum(w * pad[i:i + len(y)] for i, w in enumerate(k)); return np.concatenate([o, o[:1]])
    pad = np.concatenate([np.repeat(x[:1], r, 0), x, np.repeat(x[-1:], r, 0)]); return sum(w * pad[i:i + len(x)] for i, w in enumerate(k))
def ramp(f, t):
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
MODES = ("shoulder", "two", "free", "stock")

os.makedirs(P(cfg["dst_dir"]), exist_ok=True); report = {}
for name, cc in cfg["clips"].items():
    if only and name not in only: continue
    src = os.path.join(P(cfg["src_dir"]), name + ".npz")
    if not os.path.exists(src): print("SKIP", name, "没有", src); continue
    m = np.load(src, allow_pickle=True); names = [str(x) for x in m["names"]]; q = m["quats"].astype(float).copy(); loc = m["loc"].astype(float).copy(); T = len(q)
    idx = {n: i for i, n in enumerate(names)}; lp = bool(cc.get("loop")); L_MIN = cc.get("left_min", L_MIN0)      # 塞伦手短：枪托抵肩瞄准时左手够不到机匣前面，只能托在扳机护圈附近
    # ---- 每帧三种拿法的权重 ----
    wts = np.zeros((T, 4)); free_dir = [None] * T; stock_seg = [None] * T
    dflt = MODES.index(cc.get("default", "shoulder"))
    for f in range(T):
        best = np.zeros(4)
        for seg in cc.get("modes", []):
            b = seg.get("blend", 5); k = ramp(f, [seg["from"] - b, seg["from"], seg["to"], seg["to"] + b])
            mi = MODES.index(seg["mode"])
            if k > best[mi]: best[mi] = k
            if seg["mode"] == "free" and k > 0: free_dir[f] = seg
            if seg["mode"] == "stock" and k > 0: stock_seg[f] = seg
        s = best.sum()
        if s > 1: best /= s
        best[dflt] += max(0.0, 1 - best.sum()); wts[f] = best
    # ---- 第一遍：每帧三种拿法各自的枪身方向和顶面，合起来 ----
    Ft = []; info = []; prevU = None
    for f in range(T):
        set_pose(names, q[f], loc[f]); pw = grip_world(); lh = head("LeftHand"); hips_fw = rot("Hips") @ REST[MX + "Hips"].to_3x3().inverted() @ Vector((0, -1, 0))
        cands = []
        if wts[f, 0] > 0:                                          # 扛肩
            Pr = PB[MX + "RightShoulder"].matrix @ Pr_local; W = (Pr - pw).normalized(); U = rot("Spine2") @ U_local
            if W.z < 0.35:                                         # 手比搭点还高（读错了），枪口会朝下：往“站姿里相对胸口的方向”拉回去
                Wb = (rot("Spine2") @ W_local).normalized(); W = W.slerp(Wb, min(1.0, (0.35 - W.z) / 0.35)).normalized()
            cands.append((wts[f, 0], gun_frame(W, U)))
        if wts[f, 1] > 0:                                          # 双手端：右手腕到左手腕的线，减掉左手相对枪身的偏移
            d = lh - head("RightHand"); W = d.normalized()
            for _ in range(6):
                F = gun_frame(W, Z if prevU is None or abs(W.z) < 0.8 else prevU); W = (d - F.col[2] * L_UP - F.col[1] * L_SIDE).normalized()
            F = gun_frame(W, Z if abs(W.z) < 0.8 or prevU is None else prevU); cands.append((wts[f, 1], F))
        if wts[f, 3] > 0:                                          # 枪托抵肩（或夹在肋下）：枪身从“枪托顶住的那一点”指向右手的握点。两只手靠得太近时（瞄准时左手托在机匣下）手腕连线定不了方向，用这个
            seg = stock_seg[f] or {}; Rrel = rot("Spine2") @ REST[MX + "Spine2"].to_3x3().inverted()
            anchor = head("RightArm") + Rrel @ Vector(seg.get("anchor", (0.0, -0.05, -0.03)))
            W = (pw - anchor); W = W.normalized() if W.length > 0.04 else Rrel @ Vector((0, -1, 0))
            cands.append((wts[f, 3], gun_frame(W, Z if abs(W.z) < 0.8 or prevU is None else prevU)))
        if wts[f, 2] > 0:                                          # 单手垂着
            seg = free_dir[f] or {}; hy = math.degrees(math.atan2(hips_fw.x, -hips_fw.y))
            W = dir_of(hy + seg.get("yaw", 0), seg.get("pitch", -60))
            Uf = Matrix.Rotation(math.radians(hy), 3, "Z") @ Vector(seg["top"]) if "top" in seg else (Z if abs(W.z) < 0.9 else hips_fw)      # top：枪顶面朝哪（相对胯的朝向，x 左 -y 前 z 上）；竖起来的时候要给，不然插值会绕远路
            cands.append((wts[f, 2], gun_frame(W, Uf)))
        qa = None; wsum = 0
        for w_, F in cands:                                        # 按权重依次插值（四元数）
            qf = F.to_quaternion()
            if qa is None: qa = qf; wsum = w_
            else:
                if qa.dot(qf) < 0: qf = -qf
                wsum += w_; qa = qa.slerp(qf, w_ / wsum)
        F = qa.to_matrix(); prevU = F.col[2].copy(); Ft.append(F)
        Wraw = rot("RightHand") @ hR.to_3x3().inverted() @ a0          # 读出来的右手原样带着的枪方向（不修）
        info.append((yaw_of(F.col[0]), pitch_of(F.col[0]), (lh - head("RightHand")).length, tuple(round(float(x), 2) for x in wts[f]), yaw_of(Wraw), pitch_of(Wraw)))
    # 时间上平滑（四元数）
    Q = np.array([list(F.to_quaternion()) for F in Ft])
    for f in range(1, T):
        if np.dot(Q[f], Q[f - 1]) < 0: Q[f] = -Q[f]
    Q = gauss(Q, cc.get("smooth", 1.2), lp); Q /= np.linalg.norm(Q, axis=1, keepdims=True)
    Ft = [Quaternion(x).to_matrix() for x in Q]
    for a in cc.get("aim", []):                                    # 俯仰：只转枪
        if "pitch" not in a: continue
        for f in range(T):
            w = 1.0 if a.get("t") is None else ramp(f, a["t"])
            if w <= 0: continue
            W = Ft[f].col[0]; y_ = yaw_of(W); p_ = pitch_of(W); W2 = dir_of(y_, p_ + (a["pitch"] - p_) * w if a.get("add") is None else max(-80, min(80, p_ + a["add"] * w)))      # add：在原来的俯仰上再加多少度（腰射那一震，读出来的枪方向不可靠，手写）
            Ft[f] = gun_frame(W2, Ft[f].col[2])
    yaw0 = np.array([yaw_of(F.col[0]) for F in Ft])
    delta = np.zeros(T)                                            # 转整个人让枪口对准
    for a in cc.get("aim", []):
        w = np.array([1.0 if a.get("t") is None else ramp(f, a["t"]) for f in range(T)])
        if "turn" in a: delta += a["turn"] * w
        if "yaw" in a: delta += (a["yaw"] - yaw0) * w * a.get("k", 1.0)
    delta = (delta + 180) % 360 - 180; delta = np.clip(delta, -cc.get("max_turn", 40), cc.get("max_turn", 40))      # 转身最多 40 度：读出来的枪方向错得离谱时，别把整个人拧过去
    delta = gauss(delta, 1.0, lp)
    if diag:
        print(f"DIAG {name} T {T}")
        for f in range(0, T, 3): print(f"  f{f:3d} 原 {info[f][4]:+6.1f}/{info[f][5]:+5.1f} 枪 yaw {info[f][0]:+6.1f} pitch {info[f][1]:+6.1f} 手距 {info[f][2]:.3f} 权重(肩/双/垂/托) {info[f][3]} 转身 {delta[f]:+5.1f}")
    # ---- 第二遍：转身、摆右手和左手、抬回地面 ----
    out_q = q.copy(); out_loc = loc.copy(); stats = dict(tip_min=9.0, along=[], lreach=0); track = []
    lift = np.zeros(T); RD = [Matrix.Rotation(math.radians(delta[f]), 3, "Z") for f in range(T)]
    for f in range(T):
        set_pose(names, q[f], loc[f]); hips = PB[MX + "Hips"]
        if abs(delta[f]) > 1e-4: hips.matrix = Matrix.Rotation(math.radians(delta[f]), 4, "Z") @ hips.matrix; upd()
        F = RD[f] @ Ft[f]
        set_rot("RightHand", hand_rot_for(F))
        for _ in range(3):                                         # 枪口不许扎进地里：把枪口往上抬到离地 3 厘米
            tipz = (grip_world() + F.col[0] * tip_along).z
            if tipz >= 0.03: break
            W = F.col[0]; h = Vector((W.x, W.y, 0)); hl = max(h.length, 1e-4); s_ = max(-0.98, min(0.98, W.z + (0.03 - tipz) / tip_along))
            F = gun_frame(Vector((h.x / hl * math.sqrt(1 - s_ * s_), h.y / hl * math.sqrt(1 - s_ * s_), s_)), F.col[2]); set_rot("RightHand", hand_rot_for(F))
        k2 = min(1.0, wts[f, 1] + wts[f, 3])
        if k2 > 0.01 and cc.get("left", True):
            pw = grip_world(); lh = head("LeftHand"); along = max(L_MIN, min(L_MAX, (lh - pw).dot(F.col[0])))
            S = head("LeftArm"); l1 = B[MX + "LeftArm"].length; l2 = B[MX + "LeftForeArm"].length
            while True:
                tgt = pw + F.col[0] * along + F.col[2] * L_UP + F.col[1] * L_SIDE
                if (tgt - S).length <= (l1 + l2) * 0.985 or along <= L_MIN: break
                along = max(L_MIN, along - 0.01)
            stats["along"].append(along); tgt = lh.lerp(tgt, k2); d = tgt - S; dist = min(d.length, (l1 + l2) * 0.998)
            if d.length > (l1 + l2) * 0.998: stats["lreach"] += 1
            dn = d.normalized(); a_ = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist); hgt = math.sqrt(max(l1 * l1 - a_ * a_, 0))
            pole = head("LeftForeArm") - S; pole = pole - dn * pole.dot(dn)
            if pole.length < 1e-4: pole = Vector((1, 0, -0.3)) - dn * Vector((1, 0, -0.3)).dot(dn)
            K = S + dn * a_ + pole.normalized() * hgt
            aim_bone("LeftArm", K - S); aim_bone("LeftForeArm", S + dn * dist - K)
        upd(); tip = grip_world() + F.col[0] * tip_along; stats["tip_min"] = min(stats["tip_min"], tip.z)
        track.append(dict(tip=[round(v, 4) for v in tip], yaw=round(yaw_of(F.col[0]), 1), pitch=round(pitch_of(F.col[0]), 1), rh=[round(v, 4) for v in head("RightHand")], lh=[round(v, 4) for v in head("LeftHand")], hips=round(head("Hips").z, 4)))
        if cc.get("lift", True): lift[f] = max(0.0, max(lim - head(n).z for n, lim in GROUND))
        for nm in ("Hips", "RightHand", "LeftArm", "LeftForeArm", "LeftHand"):
            out_q[f, idx[MX + nm]] = list(PB[MX + nm].rotation_quaternion)
        out_loc[f] = list(hips.location)
    if cc.get("lift", True):                                       # 陷地：整个人往上提（平滑一下，不跳）
        lift = np.maximum(lift, gauss(lift, 2.0, lp))
        for f in range(T):
            if lift[f] > 1e-5:
                set_pose(names, out_q[f], out_loc[f]); hips = PB[MX + "Hips"]; hips.matrix = Matrix.Translation((0, 0, lift[f])) @ hips.matrix; upd()
                out_loc[f] = list(hips.location)
    for f in range(1, T):
        flip = np.sum(out_q[f] * out_q[f - 1], -1) < 0; out_q[f][flip] *= -1
    if lp: out_q[-1] = out_q[0]; out_loc[-1] = out_loc[0]
    eb = cc.get("end_blend")                                       # 结尾没回到扛肩的（端平、跪着）：最后 n 帧慢慢过渡到待机的第一帧，接待机时不跳
    if eb:
        idl = np.load(os.path.join(P(cfg["dst_dir"]), eb.get("to", "idle") + ".npz"), allow_pickle=True); iq = idl["quats"][0]; il = idl["loc"][0]
        n_ = min(eb.get("n", 10), T - 1); ex = eb.get("extend", 0)
        if ex:                                                     # 先在结尾补几帧（复制最后一帧），过渡在补出来的这几帧里做，原来的动作不动
            out_q = np.concatenate([out_q, np.repeat(out_q[-1:], ex, 0)]); out_loc = np.concatenate([out_loc, np.repeat(out_loc[-1:], ex, 0)]); T = len(out_q)
            track += [dict(track[-1]) for _ in range(ex)]; lift = np.concatenate([lift, np.repeat(lift[-1:], ex)])
        for k in range(n_):
            f = T - n_ + k; w = (k + 1) / n_; w = w * w * (3 - 2 * w)
            for i in range(len(names)):
                a = Quaternion(out_q[f, i]); b = Quaternion(iq[i])
                if a.dot(b) < 0: b = -b
                out_q[f, i] = list(a.slerp(b, w))
            out_loc[f] = out_loc[f] * (1 - w) + il * w
        for f in range(1, T):
            flip = np.sum(out_q[f] * out_q[f - 1], -1) < 0; out_q[f][flip] *= -1
    np.savez(os.path.join(P(cfg["dst_dir"]), name + ".npz"), names=np.array(names), quats=out_q, loc=out_loc, fps=m["fps"])
    for f in range(T): track[f]["lift"] = round(float(lift[f]), 4)
    json.dump(track, open(os.path.join(P(cfg["dst_dir"]), name + "_track.json"), "w"))      # 每帧枪口的位置、枪的朝向、两只手、胯的高度：量出手时间用（measure.py）
    yawf = yaw0 + delta
    report[name] = dict(frames=T, yaw=[round(float(yawf.min()), 1), round(float(yawf.max()), 1)], turn=[round(float(delta.min()), 1), round(float(delta.max()), 1)],
                        lift_max=round(float(lift.max()), 3), tip_min=round(stats["tip_min"], 3), left_unreachable=stats["lreach"])
    if stats["along"]: report[name]["left_along"] = [round(min(stats["along"]), 3), round(max(stats["along"]), 3)]
    print("FIX", name, json.dumps(report[name], ensure_ascii=False))
json.dump(report, open(os.path.join(P(cfg["dst_dir"]), "fix_report.json"), "w"), ensure_ascii=False, indent=1)
