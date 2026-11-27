"""摩珂自己用的动作后处理：读 tools/hero_motion.py 整理好的动作（art/hero/moko/motions/*.npz），修掉求解留下的几类问题，写到 art/hero/moko/motions_fx/。
build.json 的 motions 指向 motions_fx。共用脚本没有动。

用法: Blender -b --factory-startup -P art/hero/moko/fix_motions.py -- art/hero/moko/build.json art/hero/moko/fix.json [只处理的动作名…]

fix.json 里每段动作可以写的修法（帧号都是成品动作的帧，每秒 30 帧）：
  plant    右手连杖钉在站姿的位置（手腕的位置和杖的指向用 build.json 站姿里右臂那几项），身体怎么晃杖尾都拄在地上。{"from":0,"to":-1,"ease":0}
  aim      只改右手腕的朝向，让杖指向给定的方向。[{"from":24,"to":35,"ease":3,"blade":[0,0.1,1]}]；ease 是两头渐入渐出的帧数，也可以分开写 ease_in、ease_out
  push     把一只手的手腕挪开一点（重新解手臂，手的朝向不变）。offset 是胯自己的前后左右（x 左、y 后、z 上）。[{"side":"Left","from":7,"to":22,"ease":3,"offset":[0,-0.15,0]}]
  hold     在某一帧停住几帧。[{"at":26,"n":9}]
  tail     死亡用：从最后一帧过渡到摆出来的仰面躺平姿势，再停几帧。{"blend":8,"hold":8}
  ground   贴地：每一帧身体（不算灯杖）的最低点对到地面。true 是逐帧（平滑过）；写一个 0 到 100 的数是整段只挪一个固定的量，取各帧最低点的这个百分位（跑步有腾空，不能逐帧贴）。
  floor    默认开着：灯杖哪一帧戳到地面以下，就把它往水平方向放平一点（只改右手腕）。写 false 关掉。
顺序：hold → tail → ground → plant / aim / push → floor。
"""
import bpy, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
ROOT = "/Users/jadon7/Documents/SynologyDrive/code/moba"
P = lambda p: p if os.path.isabs(p) else os.path.join(ROOT, p)
cfg = json.load(open(P(argv[0]), encoding="utf-8")); fx = json.load(open(P(argv[1]), encoding="utf-8")); only = set(argv[2:])
MX = "mixamorig:"; FWD = Vector((0, -1, 0))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=P(cfg["rigged"]))
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
for o in list(sc.objects):
    if o not in (arm, body): bpy.data.objects.remove(o, do_unlink=True)
B = arm.data.bones; PB = arm.pose.bones; upd = bpy.context.view_layer.update
bpy.context.view_layer.objects.active = arm
for pb in PB: pb.rotation_mode = "QUATERNION"
REST = {b.name: b.matrix_local.copy() for b in B}
assert B[MX + "Hips"].parent is None
assert (arm.matrix_world.to_3x3() - Matrix.Identity(3)).median_scale < 1e-4 or True
HM = (arm.matrix_world @ B[MX + "Hips"].matrix_local).to_3x3()   # 胯的位移：骨骼自己的坐标 → 世界
names_mat = [s.material.name if s.material else "?" for s in body.material_slots]
body.data.calc_loop_triangles()
is_w = np.zeros(len(body.data.vertices), bool)
for t in body.data.loop_triangles:
    if names_mat[t.material_index].startswith("weapon"): is_w[list(t.vertices)] = True


# ---- 和 hero_build.py 里站姿用的同一套小工具（那边是共用脚本，不能引用它的内部函数，这里照着写一份） ----
def rot_about(pb, R3):
    upd(); h = pb.head.copy(); pb.matrix = Matrix.Translation(h) @ R3.to_4x4() @ Matrix.Translation(-h) @ pb.matrix; upd()
def aim(name, target):
    pb = PB[MX + name]; upd(); cur = (pb.tail - pb.head).normalized()
    rot_about(pb, cur.rotation_difference(Vector(target).normalized()).to_matrix())
def turn(name, axis, deg): rot_about(PB[MX + name], Matrix.Rotation(math.radians(deg), 3, Vector(axis)))
def ik(upper, lower, target, pole):
    pu = PB[MX + upper]; pl = PB[MX + lower]; upd()
    H = pu.head.copy(); l1 = pu.bone.length; l2 = pl.bone.length
    d = Vector(target) - H; dist = min(d.length, (l1 + l2) * 0.998); dn = d.normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist); hgt = math.sqrt(max(l1 * l1 - a * a, 0))
    pv = Vector(pole); pv = (pv - dn * pv.dot(dn)).normalized()
    K = H + dn * a + pv * hgt
    aim(upper, K - H); aim(lower, H + dn * dist - K)
def cur_rot(name): upd(); return PB[MX + name].matrix.to_3x3() @ REST[MX + name].to_3x3().inverted()
def frame(a, b):
    a = Vector(a).normalized(); b = Vector(b); b = (b - a * b.dot(a)).normalized()
    return Matrix((a, b, a.cross(b))).transposed()
def hand_LE(side):
    h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
    idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local
    L = (idx - pky).normalized(); d = (h - fore).normalized(); E = (d - L * d.dot(L)).normalized(); return L, E
def orient_hand(side, blade, edge=None):
    """让这只手里的杖（L 方向）指向 blade；edge 不给就顺着前臂（手腕不折）"""
    L, E = hand_LE(side); Rc = cur_rot(side + "Hand")
    fore = (PB[MX + side + "Hand"].head - PB[MX + side + "ForeArm"].head).normalized()
    rot_about(PB[MX + side + "Hand"], frame(blade, edge if edge is not None else fore) @ frame(Rc @ L, Rc @ E).inverted())


def set_pose(names, q, loc):
    for i, nm in enumerate(names):
        pb = PB.get(nm)
        if pb is not None: pb.rotation_quaternion = Quaternion(q[i]); pb.location = (0, 0, 0)
    PB[MX + "Hips"].location = Vector(loc); upd()
def get_q(nm): return np.array(PB[nm].rotation_quaternion)
def body_min_z():
    dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); ev.to_mesh_clear(); co = co.reshape(-1, 3)
    return float(co[~is_w, 2].min()), float(co[is_w, 2].min())
def qslerp(a, b, t):
    a = np.asarray(a, float); b = np.asarray(b, float); d = float(np.dot(a, b))
    if d < 0: b = -b; d = -d
    if d > 0.9995: r = a + (b - a) * t
    else:
        th = math.acos(d); r = (math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th)
    return r / np.linalg.norm(r)
def ramp(f, a, b, ein, eout):
    """这一帧的修法用几成：a 到 b 之间是 1，两头各用 ein、eout 帧渐入渐出（0 就是直接到位）"""
    if f < a or f > b: return 0.0
    k = min((f - a + 1) / (ein + 1) if ein > 0 else 1.0, (b - f + 1) / (eout + 1) if eout > 0 else 1.0, 1.0); return k * k * (3 - 2 * k)
def gsmooth(x, sigma):
    r = int(math.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    pad = np.concatenate([np.repeat(x[:1], r), x, np.repeat(x[-1:], r)]); return np.convolve(pad, k, mode="valid")


S = cfg["stance"]
def lie_pose(names, hips_xy):
    """仰面躺平的姿势：照着视频最后的样子摆（背着地、两腿伸开、左手摊在身侧、右手压着横在身边的灯杖）。返回每根骨骼的旋转和胯的位移"""
    for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    upd(); hips = PB[MX + "Hips"]; h0 = REST[MX + "Hips"]
    Rh = Matrix.Rotation(math.radians(-87), 3, "X") @ Matrix.Rotation(math.radians(3), 3, "Y")
    hips.matrix = Matrix.Translation(Vector((hips_xy[0], hips_xy[1], 0.2))) @ (Rh @ h0.to_3x3()).to_4x4(); upd()
    for nm in ("Spine", "Spine1", "Spine2"): turn(nm, cur_rot(nm) @ Vector((1, 0, 0)), 2)      # 背微微弓着，不是一块板
    turn("Neck", cur_rot("Neck") @ Vector((1, 0, 0)), 5); turn("Head", cur_rot("Head") @ Vector((0, 0, 1)), 14); turn("Head", cur_rot("Head") @ Vector((1, 0, 0)), 6)      # 头歪向一边
    upd(); bz, wz = body_min_z(); hips.location = hips.location + HM.inverted() @ Vector((0, 0, -bz)); upd()      # 先让背和斗笠贴到地上，再摆手脚（手脚的高度是按地面写的）
    upd(); hp = hips.head.copy()
    for side, sx in (("Left", 1), ("Right", -1)):
        up = PB[MX + side + "UpLeg"].head.copy(); L1 = B[MX + side + "UpLeg"].length + B[MX + side + "Leg"].length
        ank = Vector((up.x + sx * (0.075 if side == "Left" else 0.05), up.y - L1 * (0.985 if side == "Left" else 0.97), 0.06))
        ik(side + "UpLeg", side + "Leg", ank, (sx * 0.5, 0, 1))                                  # 膝盖略微朝上朝外
        ft = PB[MX + side + "Foot"]; upd()
        Rf = Matrix.Rotation(math.radians(sx * 32), 3, "Y") @ Matrix.Rotation(math.radians(-72), 3, "X")      # 脚尖朝上，往外倒
        ft.matrix = Matrix.Translation(ft.head.copy()) @ (Rf @ REST[MX + side + "Foot"].to_3x3()).to_4x4(); upd()
    # 左臂：摊在身侧，掌心朝上
    sh = PB[MX + "LeftArm"].head.copy(); d = Vector((0.62, -0.78, 0)).normalized(); La = B[MX + "LeftArm"].length + B[MX + "LeftForeArm"].length
    ik("LeftArm", "LeftForeArm", Vector((sh.x + d.x * La * 0.93, sh.y + d.y * La * 0.93, 0.062)), (1, 0.2, 0.25))
    orient_hand("Left", (0.77, 0.64, 0.12))
    # 右臂：横着伸出去，手掌朝下压在灯杖上；杖顺着身体躺在右边，螺号那头朝脚
    sh = PB[MX + "RightArm"].head.copy(); Ra = B[MX + "RightArm"].length + B[MX + "RightForeArm"].length
    ik("RightArm", "RightForeArm", Vector((sh.x - Ra * 0.94, sh.y + Ra * 0.22, 0.118)), (-0.2, 0.3, 1))
    orient_hand("Right", (-0.24, -0.97, 0.0), (-0.97, 0.24, -0.05))
    upd()
    return np.array([get_q(n) if PB.get(n) is not None else (1, 0, 0, 0) for n in names]), np.array(hips.location), body_min_z()
def lowest_part():
    dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); ev.to_mesh_clear(); co = co.reshape(-1, 3); z = np.where(is_w, 9, co[:, 2]); i = int(z.argmin())
    gs = body.data.vertices[i].groups; gn = {g.index: g.name for g in body.vertex_groups}
    return gn[max(gs, key=lambda g: g.weight).group].replace(MX, "") if len(gs) else "?"
def staff_dir():
    L, E = hand_LE("Right"); Rc = cur_rot("RightHand"); return (Rc @ L).normalized(), (Rc @ E).normalized()


src_dir = P(fx["src_dir"]); out_dir = P(fx["out_dir"]); os.makedirs(out_dir, exist_ok=True)
RARM = [MX + "RightArm", MX + "RightForeArm", MX + "RightHand"]
A_HEAD = cfg["gear"][0]["length"] * (1 - cfg["gear"][0]["grip"]); A_TAIL = cfg["gear"][0]["length"] * cfg["gear"][0]["grip"]      # 握点到杖头、到杖尾各多长
for name, f in fx["clips"].items():
    if only and name not in only: continue
    m = np.load(os.path.join(src_dir, f.get("src", name) + ".npz"), allow_pickle=True)
    names = [str(x) for x in m["names"]]; q = m["quats"].astype(float).copy(); loc = m["loc"].astype(float).copy(); fps = int(m["fps"]); ix = {n: i for i, n in enumerate(names)}
    note = []
    for h in f.get("hold", []):                                  # 先处理停帧，后面的帧号按停过以后的算
        k = h["at"]; q = np.concatenate([q[:k + 1], np.repeat(q[k:k + 1], h["n"], 0), q[k + 1:]]); loc = np.concatenate([loc[:k + 1], np.repeat(loc[k:k + 1], h["n"], 0), loc[k + 1:]]); note.append(f"第 {k} 帧停 {h['n']} 帧")
    if "tail" in f:
        t = f["tail"]; set_pose(names, q[-1], loc[-1]); upd(); hp = PB[MX + "Hips"].head.copy(); b0, e0 = staff_dir()
        lq, lloc, (bz, wz) = lie_pose(names, (hp.x, hp.y + t.get("back", 0.03))); low = lowest_part(); b1, e1 = staff_dir()
        az0 = math.degrees(math.atan2(b0.y, b0.x)) % 360; az1 = math.degrees(math.atan2(b1.y, b1.x)) % 360      # 杖头在水平面里从哪转到哪：从身后绕过右手外侧转到脚那边，不从地底下穿
        nb = t["blend"]; add_q = []; add_l = []; hi = names.index(MX + "RightHand")
        for i in range(1, nb + 1):
            k = i / nb; k = 1 - (1 - k) ** 2                     # 先快后慢：倒下去，落稳
            qq = np.array([qslerp(q[-1][j], lq[j], k) for j in range(len(names))]); ll = loc[-1] + (lloc - loc[-1]) * k
            set_pose(names, qq, ll); az = math.radians(az0 + (az1 - az0) * k); z = b0.z + (b1.z - b0.z) * k; hz = math.sqrt(max(0.0, 1 - z * z))
            orient_hand("Right", (math.cos(az) * hz, math.sin(az) * hz, z), (e0 + (e1 - e0) * k).normalized()); qq[hi] = get_q(MX + "RightHand")
            add_q.append(qq); add_l.append(ll)
        add_q += [lq] * t.get("hold", 6); add_l += [lloc] * t.get("hold", 6)
        q = np.concatenate([q, np.array(add_q)]); loc = np.concatenate([loc, np.array(add_l)]); note.append(f"接仰面躺平：过渡 {nb} 帧，停 {t.get('hold', 6)} 帧；躺平时身体最低 {bz:+.3f}（{low}）、杖最低 {wz:+.3f}；杖头水平转 {az0:.0f}°→{az1:.0f}°")
    T = len(q)
    g = f.get("ground", True)
    if g is not False:
        bz = np.zeros(T)
        for fr in range(T): set_pose(names, q[fr], loc[fr]); bz[fr] = body_min_z()[0]
        dz = -gsmooth(bz, f.get("ground_sigma", 1.2)) if g is True else np.full(T, -float(np.percentile(bz, float(g))))
        if "tail" in f: dz[-f["tail"].get("hold", 6):] = -bz[-1]
        loc = loc + np.array([list(HM.inverted() @ Vector((0, 0, d))) for d in dz])
        note.append(f"贴地：原来身体最低 {bz.min():+.3f}…{bz.max():+.3f}，挪了 {dz.min():+.3f}…{dz.max():+.3f}")
    ops = []
    E_ = lambda o, k, d: o.get(k, o.get("ease", d))
    if "plant" in f: p = f["plant"]; ops.append(("plant", p.get("from", 0), (p.get("to", -1) % T), (E_(p, "ease_in", 0), E_(p, "ease_out", 0)), p))
    for a in f.get("aim", []): ops.append(("aim", a["from"], a["to"], (E_(a, "ease_in", 3), E_(a, "ease_out", 3)), a))
    for a in f.get("push", []): ops.append(("push", a["from"], a["to"], (E_(a, "ease_in", 3), E_(a, "ease_out", 3)), a))
    if ops:
        for fr in range(T):
            act = [(k, ramp(fr, a, min(b, T - 1), e[0], e[1]), o) for k, a, b, e, o in ops]; act = [x for x in act if x[1] > 0]
            for kind, w, o in act:
                set_pose(names, q[fr], loc[fr])
                if kind == "plant":
                    a = S["arms"]["Right"]; ik("RightArm", "RightForeArm", Vector(a["wrist"]), a["pole"]); orient_hand("Right", a["blade"]); bones = RARM
                elif kind == "aim":
                    bl = Vector(o["blade"])
                    if o.get("space") == "hips":                 # 方向跟着身体转（转身的动作用）
                        hr = PB[MX + "Hips"].matrix.to_3x3(); fw = hr @ (REST[MX + "Hips"].to_3x3().inverted() @ Vector((0, 1, 0))); bl = Matrix.Rotation(-math.atan2(fw.x, fw.y), 3, "Z") @ bl
                    orient_hand("Right", bl); bones = [MX + "RightHand"]
                else:
                    side = o["side"]; hand = PB[MX + side + "Hand"]; upd(); Rw = hand.matrix.to_3x3().copy(); wr = hand.head.copy()
                    hr = PB[MX + "Hips"].matrix.to_3x3(); fw = hr @ (REST[MX + "Hips"].to_3x3().inverted() @ Vector((0, 1, 0))); yaw = math.atan2(fw.x, fw.y)      # 胯现在朝哪（绕竖直轴）
                    off = Matrix.Rotation(-yaw, 3, "Z") @ Vector(o["offset"]); el = PB[MX + side + "ForeArm"].head.copy(); sh = PB[MX + side + "Arm"].head.copy()
                    pole = el - sh; ik(side + "Arm", side + "ForeArm", wr + off, pole if pole.length > 1e-4 else (0, 1, 0)); upd()
                    hand.matrix = Matrix.Translation(hand.head.copy()) @ Rw.to_4x4(); upd(); bones = [MX + side + "Arm", MX + side + "ForeArm", MX + side + "Hand"]
                for bn in bones: q[fr][ix[bn]] = qslerp(q[fr][ix[bn]], get_q(bn), w)
        note.append("、".join(f"{k} {a}-{min(b, T - 1)}" for k, a, b, e, o in ops))
    if f.get("floor", True):                                     # 灯杖不许戳到地面以下：戳下去多少，就把杖放平多少（握点不动，只转手腕）
        fixed = 0; worst = 0.0; hi = MX + "RightHand"
        for fr in range(T):
            set_pose(names, q[fr], loc[fr]); wz = body_min_z()[1]; worst = min(worst, wz)
            for _ in range(3):
                if wz >= -0.004: break
                b, e = staff_dir(); ell = A_TAIL if b.z > 0 else A_HEAD; nz = max(0.0, abs(b.z) - (-wz + 0.006) / ell) * (1 if b.z > 0 else -1)
                hxy = Vector((b.x, b.y, 0)); hxy = hxy.normalized() if hxy.length > 1e-4 else Vector((0, -1, 0)); nb_ = (hxy * math.sqrt(max(0.0, 1 - nz * nz)) + Vector((0, 0, nz))).normalized()
                orient_hand("Right", nb_, e); wz = body_min_z()[1]; fixed += 1
            q[fr][ix[hi]] = get_q(hi)
        if fixed:                                                # 改过的帧前后各抹平一点，不然手腕会跳
            qi = q[:, ix[hi]].copy()
            for k in range(1, T):
                if np.dot(qi[k], qi[k - 1]) < 0: qi[k] *= -1
            sm = np.stack([gsmooth(qi[:, c], 1.0) for c in range(4)], 1); q[:, ix[hi]] = sm / np.linalg.norm(sm, axis=1, keepdims=True)
        wz2 = []
        for fr in range(T): set_pose(names, q[fr], loc[fr]); wz2.append(body_min_z()[1])
        note.append(f"杖最低 {worst:+.3f} → {min(wz2):+.3f}" + (f"（放平了 {fixed} 次）" if fixed else ""))
    if f.get("loop"): q[-1] = q[0]; loc[-1] = loc[0]
    np.savez(os.path.join(out_dir, name + ".npz"), names=np.array(names), quats=q, loc=loc, fps=fps)
    print("FIX", name, T, "帧", "；".join(note))
