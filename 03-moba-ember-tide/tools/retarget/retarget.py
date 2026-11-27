"""把一个角色的动作（hero_motion.py 出的 motions/*.npz）套到另一个骨架上（同一个角色的新模型、比例不同）。

做法（都在世界坐标里算，见 rig.py 的约定）：
 1. 源动作做一遍 FK，得到每根骨骼“相对静止姿势转了多少”（世界坐标里的旋转 D）。
 2. 旋转搬过去，两种方式（每根骨骼可以单独定）：
    dir    让目标骨骼在世界里指向和源骨骼一样的方向（连同绕自己的扭转）：D_t = D_s · F_s · F_t⁻¹，F 是静止时按骨骼方向和一根参考轴搭的标架。
           两边的静止姿势不一样（A 字站姿手臂张开的角度、肩宽）也不影响：动作的“样子”原样保住。同一个角色换模型用它。
           手的标架按“小指根到食指根”和前臂方向搭（hero_build.py 装武器用的就是这两个方向），所以武器在世界里的朝向和原来一模一样。
    delta  把“相对静止姿势转了多少”原样搬过去：D_t = D_s。两边的静止姿势本来就是各自的自然站姿时用（跨物种，比如鹿的动作给猞猁）。
 3. 根骨骼的位移按胯高的比例 k 缩放（腿短了，蹲下、前冲的幅度跟着变小，姿势不变）。
 4. 脚（IK 锁地）：每条腿是两段骨骼加一个末端（人形 大腿/小腿/脚，四足 上臂/前臂/掌…）。
    · 哪几帧脚踩着地：看源动作里这只脚的网格最低点（离地 2% 身高以内）。
    · 踩着地的帧：脚底贴地的那些顶点在地面上不许动（跑步是原地跑，改成按同一个速度往后走，这个速度就是新的 runSpeed），
      脚底最低点正好落在地面上（不陷、不飘）；抬脚的帧只管不穿到地下。脚的朝向保持旋转搬过来的结果，只动大腿和小腿（两段骨骼的解析解，
      膝盖朝向照旋转搬过来的那一侧）。
    · 放开锁的时候在空中几帧里慢慢还回去，看不出跳变。
 5. 双手武器（可选）：副手跟着主手走，保持源动作里“副手相对主手”的位置，用手臂的两段骨骼解出来。
 6. 换回每根骨骼自己的局部旋转，存成和 hero_motion.py 一样的 npz（names/quats/loc/fps），直接填进目标的 build.json 给出品脚本用。

用法: python tools/retarget/retarget.py <case.json>    （case 的写法见 tools/retarget/README.md）
"""
import json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig as R

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAIN = "/Users/jadon7/Documents/SynologyDrive/code/moba"                     # 不进 git 的素材（动作 npz、模型）只在主目录有
def P(p, base=ROOT):
    if os.path.isabs(p): return p
    for b in (base, ROOT, MAIN):
        if os.path.exists(os.path.join(b, p)): return os.path.join(b, p)
    return os.path.join(base, p)


# ---------------------------------------------------------------- 骨骼对应和标架
MIX_LEGS = [("LeftUpLeg", "LeftLeg", "LeftFoot"), ("RightUpLeg", "RightLeg", "RightFoot")]
MIX_ARMS = {"Left": ("LeftArm", "LeftForeArm", "LeftHand"), "Right": ("RightArm", "RightForeArm", "RightHand")}


def short(n): return n.replace("mixamorig:", "")


def mixamo_secondary(rig, b, rest_hand):
    """人形每根骨骼搭标架用的参考轴（世界坐标，静止姿势）。骨骼方向是主轴，参考轴去掉主轴分量后是第二根轴。
    两边同名的骨骼用同一条规则，搭出来的标架才“对得上”。"""
    n = short(rig.names[b])
    if any(k in n for k in ("Foot", "Toe")): return np.array([1.0, 0, 0])                       # 脚、脚趾：朝前，参考轴取左右
    if "Hand" in n and n not in ("LeftHand", "RightHand"):                                     # 手指：参考掌心法线
        side = "Left" if n.startswith("Left") else "Right"; L, d = rest_hand[side]; return np.cross(L, d)
    return np.array([0, -1.0, 0])                                                              # 其余（脊柱、头、腿、肩、手臂）：参考朝前


def hand_vectors(rig, side):
    """hero_build.py 的 hand_frame：L = 小指根→食指根，d = 前臂方向（前臂头→手头）"""
    g = lambda k: rig.head[rig.find(side + k)]
    L = g("HandIndex1") - g("HandPinky1"); d = g("Hand") - g("ForeArm"); L = L / np.linalg.norm(L); d = d / np.linalg.norm(d)
    return L, d


def rest_frames(rig, kind):
    """每根骨骼静止时的标架 F (B,3,3)"""
    F = np.zeros((rig.B, 3, 3)); dirs = rig.tail - rig.head
    if kind == "mixamo":
        hands = {s: hand_vectors(rig, s) for s in ("Left", "Right") if rig.find(s + "HandIndex1") is not None}
        for b in range(rig.B):
            n = short(rig.names[b])
            if n in ("LeftHand", "RightHand") and n[:-4] in hands:
                L, d = hands[n[:-4]]; F[b] = R.frame(L, d); continue                             # 手：和装武器的握持坐标同一套
            F[b] = R.frame(dirs[b], mixamo_secondary(rig, b, hands))
    else:                                                                                      # 四足等：参考轴取左右（骨骼大多在矢状面里），太接近骨骼方向时换朝前、朝上
        for b in range(rig.B):
            d = dirs[b] / np.linalg.norm(dirs[b])
            for ref in ([1.0, 0, 0], [0, -1.0, 0], [0, 0, 1.0]):
                if abs(np.dot(d, ref)) < 0.75: F[b] = R.frame(d, np.array(ref)); break
    return F


def mixamo_map(src, tgt):
    return {b: src.idx[n] for b, n in enumerate(tgt.names) if n in src.idx}


# ---------------------------------------------------------------- 姿势：D（世界里相对静止的旋转）+ 根的位置 -> 各骨骼头的位置、蒙皮矩阵
def positions(rig, D, Proot):
    """D (T,B,3,3)、Proot (T,3)（根骨骼头在世界里的位置）-> 每根骨骼头的世界位置 (T,B,3)"""
    T = len(D); Pp = np.zeros((T, rig.B, 3))
    for b in rig.order:
        p = rig.parent[b]
        Pp[:, b] = Proot if p < 0 else Pp[:, p] + np.einsum("tij,j->ti", D[:, p], rig.head[b] - rig.head[p])
    return Pp


def skin_mats(rig, D, Pp):
    """静止 -> 姿势的变换：x ↦ D (x - h) + P"""
    T = len(D); S = np.zeros((T, rig.B, 4, 4)); S[..., :3, :3] = D; S[..., :3, 3] = Pp - np.einsum("tbij,bj->tbi", D, rig.head); S[..., 3, 3] = 1
    return S


def skin(rig, S, mask):
    v = rig.verts[mask]; wi = rig.widx[mask]; wv = rig.wval[mask]; out = np.zeros((len(S), len(v), 3))
    for k in range(4):
        M = S[:, wi[:, k]]; out += wv[None, :, k, None] * (np.einsum("tvij,vj->tvi", M[..., :3, :3], v) + M[..., :3, 3])
    return out


def from_motion(rig, quats, loc, root):
    """动作文件 -> (D, Proot)"""
    W = rig.fk(quats, loc, root); Rw = W[:, :, :3, :3] / rig.scale
    D = Rw @ np.swapaxes(rig.Rrest, -1, -2)[None]
    return D, W[:, root, :3, 3]


def to_motion(rig, D, Proot, root):
    """(D, Proot) -> 动作文件的 quats (T,B,4)、loc (T,3)"""
    T = len(D); Rr = rig.Rrest; L = np.zeros((T, rig.B, 3, 3))
    for b in range(rig.B):
        p = rig.parent[b]; Dp = D[:, p] if p >= 0 else np.eye(3)[None]
        L[:, b] = Rr[b].T @ np.swapaxes(Dp, -1, -2) @ D[:, b] @ Rr[b]
    q = R.continuous(R.m2q(L))
    loc = np.einsum("ij,tj->ti", np.linalg.inv(rig.rest[root, :3, :3]), Proot - rig.rest[root, :3, 3])
    return q, loc


# ---------------------------------------------------------------- 两段骨骼的 IK
def two_bone(D, Pp, rig, u, l, e, goal, pole_rest=None):
    """改 D 里 u（上段）、l（下段）的旋转，让 e 的头到 goal (T,3)；e 和它下面的骨骼保持世界里的朝向。
    膝盖（手肘）朝向：当前姿势里膝盖偏向的那一侧；腿伸得太直、看不出偏向时用 pole_rest（静止姿势里的弯曲方向）随上段一起转。"""
    H = Pp[:, u]; K = Pp[:, l]; A = Pp[:, e]
    l1 = np.linalg.norm(rig.head[l] - rig.head[u]); l2 = np.linalg.norm(rig.head[e] - rig.head[l])
    d = goal - H; dist = np.linalg.norm(d, axis=-1); dn = d / np.maximum(dist, 1e-9)[:, None]
    reach = np.clip(dist, abs(l1 - l2) + 1e-4, (l1 + l2) * 0.9995)
    # 弯曲方向
    cur = (K - H); axis = (A - H) / np.maximum(np.linalg.norm(A - H, axis=-1), 1e-9)[:, None]
    bend = cur - axis * np.sum(cur * axis, -1, keepdims=True); bl = np.linalg.norm(bend, axis=-1)
    if pole_rest is not None:
        alt = np.einsum("tij,j->ti", D[:, u], pole_rest)
        w = np.clip(bl / (0.08 * l1), 0, 1)[:, None]; bend = bend * w + alt * (1 - w) * l1 * 0.08
    pv = bend - dn * np.sum(bend * dn, -1, keepdims=True); pv = pv / np.maximum(np.linalg.norm(pv, axis=-1), 1e-9)[:, None]
    a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach); h = np.sqrt(np.maximum(l1 * l1 - a * a, 0))
    Kn = H + dn * a[:, None] + pv * h[:, None]; An = H + dn * reach[:, None]
    R1 = R.rot_between(K - H, Kn - H); Du = R1 @ D[:, u]
    lower_now = np.einsum("tij,tj->ti", R1, A - K); R2 = R.rot_between(lower_now, An - Kn); Dl = R2 @ R1 @ D[:, l]
    D = D.copy(); D[:, u] = Du; D[:, l] = Dl
    return D, dist - reach                                                          # 第二个返回值：够不着的距离（> 0 说明腿伸直了也够不到）


# ---------------------------------------------------------------- 接地
def segments(flag, cyclic=False):
    """布尔序列 -> [(起, 止)]（含止）"""
    out, s = [], None
    for i, f in enumerate(flag):
        if f and s is None: s = i
        if not f and s is not None: out.append((s, i - 1)); s = None
    if s is not None: out.append((s, len(flag) - 1))
    return out


def clean_flag(flag, min_len=3, gap=1):
    f = flag.copy()
    for s, e in segments(~f):                                                        # 补上 1 帧的空
        if e - s + 1 <= gap and s > 0 and e < len(f) - 1: f[s:e + 1] = True
    for s, e in segments(f):
        if e - s + 1 < min_len: f[s:e + 1] = False
    return f


def foot_verts(rig, end):
    """末端骨骼（脚、蹄、爪）和它下面的骨骼管着的顶点：脚底就在这些里面"""
    sub = set(rig.subtree(end)); dom = rig.dominant()
    return np.array([i for i in range(len(dom)) if dom[i] in sub and not rig.weapon[i]])


def smooth1(x, sigma, cyclic=False):
    if sigma <= 0: return x
    r = int(np.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    if cyclic: pad = np.concatenate([x[-r - 1:-1], x, x[1:r + 1]])
    else: pad = np.concatenate([np.repeat(x[:1], r, 0), x, np.repeat(x[-1:], r, 0)])
    out = np.zeros_like(x)
    for i, w in enumerate(k): out = out + w * pad[i:i + len(x)]
    return out


def ease(n):
    t = (np.arange(1, n + 1) / (n + 1)); return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- 主流程：一段动作
def retarget_clip(src, tgt, ctx, quats, loc, fps, name, opt):
    T = len(quats); loop = opt["loop"]; run = opt.get("run", False)
    Ds, Ps_root = from_motion(src, quats, loc, ctx["src_root"]); Ps = positions(src, Ds, Ps_root)
    # 2. 旋转
    Dt = np.repeat(np.eye(3)[None, None], T, 0).repeat(tgt.B, 1)
    for b in tgt.order:
        m = ctx["map"].get(b); mode = ctx["mode"](b)
        if m is None:                                                                # 源里没有对应：跟着父骨骼一起转（局部不动）
            p = tgt.parent[b]; Dt[:, b] = Dt[:, p] if p >= 0 else np.eye(3)
        elif isinstance(m, tuple):                                                   # 链：按在链上的位置在源的几节之间插值
            i0, i1, w = m
            if mode == "delta" and "ref" in ctx: Dt[:, b] = interp_rot(Ds[:, i0] @ ctx["ref"][0][i0].T, Ds[:, i1] @ ctx["ref"][0][i1].T, w) @ ctx["ref"][1][b]
            elif mode == "delta": Dt[:, b] = interp_rot(Ds[:, i0], Ds[:, i1], w)
            else: Dt[:, b] = interp_rot(Ds[:, i0] @ ctx["Fs"][i0], Ds[:, i1] @ ctx["Fs"][i1], w) @ ctx["Ft"][b].T
        elif mode == "dir": Dt[:, b] = Ds[:, m] @ ctx["Fs"][m] @ ctx["Ft"][b].T
        elif "ref" in ctx: Dt[:, b] = Ds[:, m] @ ctx["ref"][0][m].T @ ctx["ref"][1][b]      # 以两边各自的“站好”的姿势为准：源从它的站姿转了多少，目标就从它自己的站姿转多少
        else: Dt[:, b] = Ds[:, m]
    # 3. 根
    k = ctx["k"]; Pt_root = tgt.head[ctx["tgt_root"]] + k * (Ps_root - src.head[ctx["src_root"]])
    Pt = positions(tgt, Dt, Pt_root)
    rep = {"k": round(k, 3)}
    if not opt.get("ik", True): return Dt, Pt_root, rep
    # 4. 脚
    g_s, g_t = src.ground, tgt.ground; Hs, Ht = src.height, tgt.height
    legs = ctx["legs"]; lift_total = np.zeros(T); Ss = skin_mats(src, Ds, Ps)
    cth = opt.get("contact", 0.035 if run else 0.02); touch = opt.get("touch", 0.012); clean = opt.get("clean", 0.1); cap = opt.get("cap", 0.05)
    for it in range(2):                                                              # 第二遍：腿伸直了也够不着的帧把胯放低一点再解
        goals, flags = [], []
        St = skin_mats(tgt, Dt, Pt)
        for lg in legs:
            Vs = skin(src, Ss, lg["src_feet"]); zs = Vs[..., 2].min(1) - g_s
            flag = clean_flag(zs < cth * Hs, min_len=2 if run else 3)
            Vt = skin(tgt, St, lg["tgt_feet"]); zt = Vt[..., 2].min(1) - g_t
            # 竖直：脚底最低点的离地高度照源的（按 k 缩放），不穿到地下。
            # snap（跑步以外默认开）：贴着地面那一截（源里离地 cth 以内，源自己的陷地和飘都在这里面）压成正好贴地，
            #   往上平滑地接回原来的高度：s(z) = z − c·exp(−(z−c)/c)（z = c 时是 0，z 大了就是 z），随时间是连续的，不会一落地就跳一下。
            #   跑步不压：源的跑步本来就踩得浅，判定线放到 3.5%，压了以后整段摆腿都贴着地。
            c_ = cth * Hs; zz = np.maximum(zs, 0.0)
            want_z = k * (np.where(zz > c_, zz - c_ * np.exp(-(zz - c_) / c_), 0.0) if opt.get("snap", not run) else zz)
            dz = want_z - zt
            # 水平：贴地的那些脚底顶点，照源动作里贴地顶点的走法走（按 k 缩放）；源里小于 clean（身高/秒）的那点滑动当成抖动去掉。
            # 跑步：改成一个匀速往后走（这个速度就是新的 runSpeed）。攒下的偏移不超过 cap（身高的比例），超过说明源动作本来就在拖着脚走（比如结尾回原点），照它的走。
            dxy = np.zeros((T, 2))
            if opt.get("lock", True):
                us = contact_motion(Vs, flag, touch * Hs, loop, centroid=run) * k     # 源里贴地顶点每帧走了多少（缩放到目标）
                if run:
                    u = np.zeros((T, 2)); sel = flag & np.roll(flag, 1)
                    if sel.any(): u[:, 1] = np.median(us[sel, 1])
                    lg["u"] = u[0] * fps
                else:
                    mag = np.linalg.norm(us, axis=1, keepdims=True); u = us * np.maximum(0, 1 - clean * Ht / fps / np.maximum(mag, 1e-12))
                dxy = lock_xy(Vt, flag, touch * Ht, g_t, dz, u, loop, cap * Ht, centroid=run)
            goal = Pt[:, lg["end"]] + np.concatenate([dxy, dz[:, None]], 1)
            goals.append(goal); flags.append(flag)
        reach_short = np.zeros(T)
        for lg, goal in zip(legs, goals):
            Dt, short_ = two_bone(Dt, Pt, tgt, lg["upper"], lg["lower"], lg["end"], goal, lg.get("pole"))
            reach_short = np.maximum(reach_short, short_)
            Pt = positions(tgt, Dt, Pt_root)
        if it == 0 and reach_short.max() > 0.002 * Ht:                               # 够不着：胯放低（平滑过的），再来一遍
            drop = smooth1(np.maximum(reach_short, 0), 2.0, loop) * 1.05; Pt_root = Pt_root.copy(); Pt_root[:, 2] -= drop; lift_total -= drop
            Dt, Pt_root = rot_only_reset(Dt, ctx, tgt, Ds, k, src), Pt_root
            Pt = positions(tgt, Dt, Pt_root); continue
        break
    rep["胯放低最多"] = round(float(-lift_total.min()) / Ht, 4)
    rep["接地帧"] = [int(f.sum()) for f in flags]
    if run: rep["跑步贴地速度"] = [round(float(-lg.get("u", np.zeros(2))[1]), 4) for lg in legs]
    # 4a. 手撑地（死亡、俯身）：源里手离地很近（10% 身高以内）的帧，手的最低点照源的离地高度放（贴地那一截压成贴地），手离地远的帧只管不穿到地下。
    #     比例变了最容易出事的就是这个：腿短了胯就低，手臂长度没变，源里“手撑着地”的姿势到新模型上手会插进地里（武器跟着没进去）
    for ar in ctx.get("arms_ground", []) if opt.get("arms", True) else []:
        Vs = skin(src, Ss, ar["src_verts"]); zs = Vs[..., 2].min(1) - g_s
        Vt = skin(tgt, skin_mats(tgt, Dt, Pt), ar["tgt_verts"]); zt = Vt[..., 2].min(1) - g_t
        c_ = 0.02 * Hs; zz = np.maximum(zs, 0.0); want = k * np.where(zz > c_, zz - c_ * np.exp(-(zz - c_) / c_), 0.0)
        w = smooth1(np.clip((0.10 * Hs - zs) / (0.05 * Hs), 0, 1), 1.5, loop)
        dz = w * (want - zt) + (1 - w) * np.maximum(-zt, 0)
        if np.abs(dz).max() < 1e-4: continue
        goal = Pt[:, ar["end"]] + np.concatenate([np.zeros((T, 2)), dz[:, None]], 1)
        Dt, _ = two_bone(Dt, Pt, tgt, ar["upper"], ar["lower"], ar["end"], goal, ar.get("pole")); Pt = positions(tgt, Dt, Pt_root)
        rep[f"{ar['name']}抬起最多(身高%)"] = round(float(dz.max()) / Ht * 100, 2)
    # 4b. 头（或别的部位）穿到地下：把一条链（比如脖子）从根部往上抬，抬到最低点刚好在地面上。跨物种时最常见：鹿低头吃草的角度给猞猁，猞猁的头会插进地里
    for gc in ctx.get("ground_chains", []):
        lifted = np.zeros(T); cap_ = np.radians(gc.get("max_deg", 35))
        # 源自己就插进地里的那几帧（原版的死亡常这样），目标插得一样深（按 k 缩放）就算了，不去和源较劲；最多抬 max_deg 度，再多样子就变了，剩下的报出来手修
        floor = np.minimum(0.0, k * (skin(src, Ss, gc["src_verts"])[..., 2].min(1) - g_s)) if len(gc["src_verts"]) else np.zeros(T)
        for it in range(3):
            V = skin(tgt, skin_mats(tgt, Dt, Pt), gc["verts"]); z = V[..., 2] - g_t; need = np.maximum(floor + gc.get("margin", 0.005) * Ht - z.min(1), 0)
            need = np.where(lifted >= cap_ - 1e-6, 0, need)
            if need.max() < 1e-4: break
            p_ = V[np.arange(T), z.argmin(1)]; base = Pt[:, gc["base"]]; v = p_ - base; r = np.maximum(np.linalg.norm(v, axis=1), 1e-6)
            phi = np.arcsin(np.clip(v[:, 2] / r, -1, 1)); th = np.where(need > 0, np.arcsin(np.clip(np.sin(phi) + need / r, -1, 1)) - phi, 0.0)
            th = smooth1(np.array([th[max(0, i - 2):i + 3].max() for i in range(T)]), 1.5, loop)      # 先取前后两帧的最大再平滑：峰值不被抹低，也不跳
            th = np.minimum(th, np.maximum(cap_ - lifted, 0))
            ax = np.cross(v, np.array([0, 0, 1.0])); ax /= np.maximum(np.linalg.norm(ax, axis=1, keepdims=True), 1e-9)
            Rl = np.array([R.axis_angle(ax[f], th[f]) if th[f] > 1e-5 else np.eye(3) for f in range(T)])
            for b in tgt.subtree(gc["base"]): Dt[:, b] = Rl @ Dt[:, b]
            Pt = positions(tgt, Dt, Pt_root); lifted += th
        rep[f"抬{gc['name']}最多(度)"] = round(float(np.degrees(lifted.max())), 1)
        V = skin(tgt, skin_mats(tgt, Dt, Pt), gc["verts"]); left = np.maximum(floor - (V[..., 2].min(1) - g_t), 0)
        if left.max() > 0.005 * Ht: rep[f"{gc['name']}还插在地下(身高%)"] = round(float(left.max()) / Ht * 100, 1)
    # 5. 双手武器：副手跟主手
    hd = ctx.get("hands") if opt.get("hands", True) else None
    if hd:
        lead, fol = hd["lead"], hd["follow"]; a_s = ctx["arm_s"][fol]; a_t = ctx["arm_t"][fol]; hl_s = ctx["arm_s"][lead][2]; hl_t = ctx["arm_t"][lead][2]
        rel = np.einsum("tji,tj->ti", Ds[:, hl_s] @ ctx["Fs"][hl_s], Ps[:, a_s[2]] - Ps[:, hl_s])          # 副手的手腕在主手标架里的位置
        goal = Pt[:, hl_t] + np.einsum("tij,tj->ti", Dt[:, hl_t] @ ctx["Ft"][hl_t], rel * hd.get("scale", 1.0))
        # 只在源里两只手确实一起握着武器的帧上锁（两手距离不超过“握着时的距离”的 1.25 倍；1.6 倍以上完全放开，比如一只手松开去甩技能）
        ds = np.linalg.norm(Ps[:, a_s[2]] - Ps[:, hl_s], axis=-1) / Hs; hold = hd.get("hold", float(np.percentile(ds, 10)))
        w = smooth1(np.clip((1.6 * hold - ds) / (0.35 * hold), 0, 1), 1.5, loop)[:, None]
        before = np.linalg.norm(Pt[:, a_t[2]] - goal, axis=-1); goal = Pt[:, a_t[2]] * (1 - w) + goal * w
        Dt, _ = two_bone(Dt, Pt, tgt, a_t[0], a_t[1], a_t[2], goal); Pt = positions(tgt, Dt, Pt_root); rep["副手锁住的帧"] = int((w[:, 0] > 0.5).sum())
        rep["副手离握点(改前,身高%)"] = round(float(np.median(before[w[:, 0] > 0.5] if (w > 0.5).any() else before)) / Ht * 100, 2); rep["副手离握点(改后,身高%)"] = round(float(np.median(np.linalg.norm(Pt[:, a_t[2]] - goal, axis=-1)[w[:, 0] > 0.5] if (w > 0.5).any() else [0])) / Ht * 100, 2)
    return Dt, Pt_root, rep


def rot_only_reset(Dt, ctx, tgt, Ds, k, src):
    """第二遍 IK 前，把腿的旋转恢复成旋转搬过来的结果（其余不动）"""
    Dt = Dt.copy()
    for lg in ctx["legs"]:
        for b in (lg["upper"], lg["lower"]):
            m = ctx["map"].get(b)
            if isinstance(m, int): Dt[:, b] = Ds[:, m] @ ctx["Fs"][m] @ ctx["Ft"][b].T if ctx["mode"](b) == "dir" else Ds[:, m]
    return Dt


def interp_rot(A, B, w):
    qa = R.m2q(A); qb = R.m2q(B); d = np.sum(qa * qb, -1, keepdims=True); qb = np.where(d < 0, -qb, qb)
    q = qa * (1 - w) + qb * w; return R.q2m(q / np.linalg.norm(q, axis=-1, keepdims=True))


def contact_motion(V, flag, touch, loop, centroid=False):
    """源动作里这只脚贴地的那块每帧在地面上走了多少 (T,2)：第 i 帧是从上一帧到这一帧。不踩地的帧是 0。
    原地的动作看“两帧都贴地的那些顶点”（脚跟滚到脚尖不算动）；跑步看“这一帧最低那一片”的中心（原地跑的脚一直在往后扫，没有真正踩实的顶点）"""
    T = len(V); u = np.zeros((T, 2)); z = V[..., 2]
    for i in range(T):
        p = i - 1 if i > 0 else (T - 2 if loop else None)
        if p is None or not (flag[i] and flag[p]): continue
        a = z[p] < z[p].min() + touch; b = z[i] < z[i].min() + touch
        if centroid: u[i] = V[i, b, :2].mean(0) - V[p, a, :2].mean(0); continue
        on = a & b
        if on.sum() >= 3: u[i] = np.median(V[i, on, :2] - V[p, on, :2], 0)
    return u


def lock_xy(V, flag, touch, g, dz, u, loop, cap, centroid=False):
    """V (T,N,3) 目标的脚上顶点（锁之前）。踩地的帧：上一帧、这一帧都贴地的顶点，水平位置照 u[i]（这一帧该走多少）走；
    不踩地的帧：攒下来的偏移在空中几帧里平滑地还回 0。偏移的长度不超过 cap。返回每帧要加到脚上的水平偏移 (T,2)。"""
    T = len(V); off = np.zeros((T, 2)); n = T - 1 if loop else T
    order = list(range(T))
    if loop:                                                                         # 循环动作：从一个抬脚的帧开始算，绕一圈（最后一帧和第一帧是同一帧）
        free = [i for i in range(n) if not flag[i]]
        order = list(range(free[0], n)) + list(range(0, free[0])) if free else list(range(n))
    prev = None
    for i in order:
        if flag[i] and prev is not None and flag[prev]:
            z0 = V[prev, :, 2] + dz[prev]; z1 = V[i, :, 2] + dz[i]; a = z0 < z0.min() + touch; b = z1 < z1.min() + touch; on = a & b
            if centroid: c = V[prev, a, :2].mean(0) + off[prev] + u[i] - V[i, b, :2].mean(0)
            else: c = np.median((V[prev, on, :2] + off[prev] + u[i]) - V[i, on, :2], 0) if on.sum() >= 3 else off[prev]
            L = np.linalg.norm(c); off[i] = c if L <= cap else c * cap / L
        prev = i
    # 放开锁：抬脚的那几帧从攒下的偏移平滑地回到下一次落地时的偏移（落地那帧是 0）
    out = off.copy(); fl = flag[:n]
    for s, e in segments(~fl):
        L = e - s + 1
        before = off[(s - 1) % n] if (s > 0 or loop) else None; after = off[(e + 1) % n] if (e < n - 1 or loop) else None
        if before is None: before = after if after is not None else np.zeros(2)
        if after is None: after = before                                               # 一次性动作最后抬着脚：保持
        w = ease(L)[:, None]; out[s:e + 1] = before * (1 - w) + after * w
    if loop: out[-1] = out[0]
    return out


# ---------------------------------------------------------------- 读 case、组装上下文
def build_ctx(src, tgt, case):
    kind = case.get("kind", "mixamo")
    ctx = {"Fs": rest_frames(src, kind), "Ft": rest_frames(tgt, kind)}
    if kind == "mixamo":
        ctx["map"] = mixamo_map(src, tgt); ctx["src_root"] = src.find("Hips"); ctx["tgt_root"] = tgt.find("Hips")
        legs = []
        for u, l, e in MIX_LEGS:
            legs.append({"upper": tgt.find(u), "lower": tgt.find(l), "end": tgt.find(e), "pole": np.array([0, -1.0, 0]),
                         "src_feet": foot_verts(src, src.find(e)), "tgt_feet": foot_verts(tgt, tgt.find(e)), "name": short(e)})
        ctx["arm_s"] = {s: tuple(src.find(x) for x in v) for s, v in MIX_ARMS.items()}; ctx["arm_t"] = {s: tuple(tgt.find(x) for x in v) for s, v in MIX_ARMS.items()}
        wpn = not case.get("hide_weapon_tgt", False)                                 # 同一个角色：武器插进地里也算；拿别的英雄试比例时武器不是同一件，两边都不算
        def hand_verts(rg, h):
            sub = set(rg.subtree(h)); dom = rg.dominant(); return np.array([i for i in range(len(dom)) if dom[i] in sub and (wpn or not rg.weapon[i])])
        ctx["arms_ground"] = [{"name": s + "Hand", "upper": tgt.find(v[0]), "lower": tgt.find(v[1]), "end": tgt.find(v[2]), "pole": np.array([0, 1.0, 0]),
                               "src_verts": hand_verts(src, src.find(v[2])), "tgt_verts": hand_verts(tgt, tgt.find(v[2]))} for s, v in MIX_ARMS.items()] if case.get("arms_ground", True) else []
    else:
        mp = {b: src.idx[n] for b, n in enumerate(tgt.names) if n in src.idx} if case.get("map") == "same" else {}      # "same"：同一个角色换模型，骨骼名一样
        for tn, sn in (case["map"].items() if isinstance(case.get("map"), dict) else []):
            if isinstance(sn, str): mp[tgt.idx[tn]] = src.idx[sn]
        for ch in case.get("chains", []):                                            # 链：目标第 i 节对应源链上同样比例的位置
            ts, ss = ch["tgt"], ch["src"]
            for i, tn in enumerate(ts):
                x = (i + 0.5) / len(ts) * len(ss) - 0.5; x = min(max(x, 0), len(ss) - 1); i0 = int(np.floor(x)); i1 = min(i0 + 1, len(ss) - 1)
                mp[tgt.idx[tn]] = (src.idx[ss[i0]], src.idx[ss[i1]], x - i0) if i1 != i0 and x - i0 > 1e-6 else src.idx[ss[i0]]
        ctx["map"] = mp; ctx["src_root"] = src.idx[case["src_root"]]; ctx["tgt_root"] = tgt.idx[case["tgt_root"]]
        legs = []
        for lg in case["legs"]:
            u, l, e = [tgt.idx[x] for x in lg["tgt"]]; se = src.idx[lg["src_end"]]
            rest_bend = (tgt.head[l] - tgt.head[u]) - (tgt.head[e] - tgt.head[u]) * np.dot(tgt.head[l] - tgt.head[u], tgt.head[e] - tgt.head[u]) / np.dot(tgt.head[e] - tgt.head[u], tgt.head[e] - tgt.head[u])
            pole = None if np.linalg.norm(rest_bend) < 1e-6 else rest_bend / np.linalg.norm(rest_bend)
            legs.append({"upper": u, "lower": l, "end": e, "pole": pole, "src_feet": foot_verts(src, se), "tgt_feet": foot_verts(tgt, tgt.idx[lg.get("tgt_end", lg["tgt"][2])]), "name": lg["tgt"][2]})
        ctx["arm_s"] = ctx["arm_t"] = {}
    ctx["legs"] = legs
    ctx["ground_chains"] = []
    for gc in case.get("ground_chains", []):                                         # {"name": "头", "base": 链的第一根骨骼, "verts_of": 量哪根骨骼（连同下面的）管的顶点}
        sub = set(tgt.subtree(tgt.idx[gc["verts_of"]])); dom = tgt.dominant()
        sb_ = ctx["map"].get(tgt.idx[gc["verts_of"]]); sb_ = sb_[0] if isinstance(sb_, tuple) else sb_
        ssub = set(src.subtree(sb_)) if sb_ is not None else set(); sdom = src.dominant()
        ctx["ground_chains"].append({"name": gc["name"], "base": tgt.idx[gc["base"]], "verts": np.array([i for i in range(len(dom)) if dom[i] in sub and not tgt.weapon[i]]), "margin": gc.get("margin", 0.005),
                                     "max_deg": gc.get("max_deg", 35), "src_verts": np.array([i for i in range(len(sdom)) if sdom[i] in ssub], int)})
    mode = case.get("mode", "dir" if kind == "mixamo" else "delta"); per = case.get("mode_bones", {})
    ctx["mode"] = lambda b: next((v for k_, v in per.items() if k_ in tgt.names[b]), mode)
    hs = src.head[ctx["src_root"], 2] - src.ground; ht = tgt.head[ctx["tgt_root"], 2] - tgt.ground
    ctx["k"] = float(case.get("k", ht / hs)); ctx["hands"] = case.get("hands")
    if case.get("ref_pose"):                                                         # {"src": [动作 npz, 第几帧], "tgt": [动作 npz, 第几帧]}：两边各自站好的那一帧（一般是 idle 的第 0 帧）
        refs = []
        for rg, key, root in ((src, "src", ctx["src_root"]), (tgt, "tgt", ctx["tgt_root"])):
            path, f = case["ref_pose"][key]; names, q, loc, fps = R.load_motion(P(path)); Q = R.to_rig_order(rg, names, q[f:f + 1]); D, _ = from_motion(rg, Q, loc[f:f + 1], root); refs.append(D[0])
        ctx["ref"] = refs
    return ctx


def main():
    case_path = os.path.abspath(sys.argv[1]); case = json.load(open(case_path, encoding="utf-8")); base = os.path.dirname(case_path)
    src = R.Rig(P(case["src_rig"], base)); tgt = R.Rig(P(case["tgt_rig"], base)); ctx = build_ctx(src, tgt, case)
    out_dir = P(case.get("out_dir", "motions"), base); os.makedirs(out_dir, exist_ok=True)
    sb = json.load(open(P(case["src_build"]), encoding="utf-8")); clips = case.get("clips") or list(sb["motions"].keys())
    loops = set(case.get("loops", ["idle", "run", "gallop"])); runs = set(case.get("runs", ["run", "gallop"]))
    variants = case.get("variants", {"ik": {"ik": True}})
    report = {"k": ctx["k"], "源身高": src.height, "目标身高": tgt.height, "clips": {}}
    only = set(sys.argv[2:])
    for name in clips:
        if only and name not in only: continue
        names, q, loc, fps = R.load_motion(P(sb["motions"][name]))
        Q = R.to_rig_order(src, names, q)
        for vname, vopt in variants.items():
            opt = {"loop": name in loops, "run": name in runs, **case.get("ik", {}), **vopt}
            Dt, Proot, rep = retarget_clip(src, tgt, ctx, Q, loc, fps, name, opt)
            qt, lt = to_motion(tgt, Dt, Proot, ctx["tgt_root"])
            if opt["loop"]: qt[-1] = qt[0]; lt[-1] = lt[0]
            d = os.path.join(out_dir, vname); os.makedirs(d, exist_ok=True)
            np.savez(os.path.join(d, name + ".npz"), names=np.array(tgt.names), quats=qt, loc=lt, fps=fps)
            report["clips"].setdefault(name, {})[vname] = rep
            print(name, vname, json.dumps(rep, ensure_ascii=False))
    json.dump(report, open(os.path.join(out_dir, "retarget_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
