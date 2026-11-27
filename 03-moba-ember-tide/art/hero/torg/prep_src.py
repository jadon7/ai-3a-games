#!/usr/bin/env python3
"""托尔格的动作在交给 tools/hero_motion.py 之前先自己整理一遍（只读管线的 out/anim/torg_*/motion.npz，写到 art/hero/torg/motions_src/）。
做三件事：

1. 把锤摆正。管线从视频里读的是关节的位置，手腕在哪读得准，但握成拳的手“朝哪边”读不准（拳头在 480p 里只有十几个像素）。
   锤是整个蒙在右手骨骼上的、有 1.15 个身高那么长，手腕的朝向差几十度，钟就甩到身体另一边去了（直接用的话，待机时锤横穿左肩）。
   “过两只手的连线”也试过，两只手只隔十几厘米，读出来的位置差三厘米方向就偏二十度，转身背对镜头时更不准，不能用。
   所以右手的朝向不用读出来的，改成按规则定（下面 AIM 里每段动作一张表，帧号是视频的帧号）：
     chest   锤相对胸口的指向和站姿里一样（扛在右肩上，跟着身体起伏）
     keys    看着视频一帧帧定的方向（用 art/hero/torg/vaim.py 在画面上标出右手和钟点刻度，读钟在几点钟方向），帧之间平滑地转过去
     butt    柄尾杵在地上不动（W）
     ground  钟搁在地上：钟的高度钉在地面，水平朝哪边看视频定（Q、R 砸地，死亡时锤掉在地上）
   两条规则之间的那几帧从前一个方向缓缓转到后一个方向。
2. 让左手握在杆身上。左手的位置是读出来的，锤的指向是上面定的，两者对不上手就悬在柄外面或者插进柄里。
   在“左手握着”的帧里，用两段骨骼的解析解把左臂重新摆一下，让左手掌心落在柄上（读出来的左手投到杆身上的那一点；够不着就往右手那边挪）。
3. 剪。hero_motion.py 的 segments 在接缝处把后面一截的位移连高度一起挪过去，接缝两边胯高差一点后面整段就浮起来或陷下去，
   所以在这里剪：接缝只接水平位置。keep 里可以插 {"blend": n}：从前一截的最后一个姿势用 n 帧过渡到后一截的第一个姿势
   （普攻横扫完以后视频里是转了一整圈再把锤举过头顶，剪掉，直接拉回站姿）。
   R 是“跃起砸下”，技能里人的高度是程序沿抛物线加的（src/map/game/heroes/torg.ts 的 leap），
   动作自己的腾空高度在这里去掉（每一帧减去脚离地的高度），不然会跳两倍高。读坏的几帧（R 的 24、25、48、49、56 到 63）直接剪掉。

用法: python art/hero/torg/prep_src.py [只做哪几段]      改了下面的表就重跑，再跑 zsh tools/hero_build.sh art/hero/torg
产出和管线的 motion.npz 同样的格式（quats、t、joints、fps），motions.json 里整段取。
"""
import json, os, sys, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; D = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(D, "motions_src")
MX = "mixamorig:"; GRIP, LEN, LEFT_S = 0.48, 1.145, 0.325      # 右手握在柄的哪（离铁环底）、锤的总长、左手握在哪。和 gear.py、build.json 一致
SK = json.load(open(f"{V}/assets/model/torg_skeleton.json", encoding="utf-8")); BONES = SK["bones"]; NB = len(BONES)
BI = {b["name"]: i for i, b in enumerate(BONES)}; PAR = [b["parent"] for b in BONES]
M0 = np.array([np.array(b["matrix"], float)[:3, :3] for b in BONES]); M0 /= np.linalg.norm(M0, axis=1, keepdims=True)      # 每根骨骼静止时的朝向（列是骨骼自己的 x、y、z，y 指向骨骼的尾）
H0 = np.array([b["head"] for b in BONES], float)
JN = [j["name"] for j in SK["joints"]]; JI = {n: i for i, n in enumerate(JN)}
cfg = json.load(open(os.path.join(D, "build.json"), encoding="utf-8"))

# 每段动作：src 用哪段视频读出来的；aim 是锤的指向规则 [起帧, 止帧, 规则, 参数]；left 是左手握着柄的帧段；keep 是留哪几截；flat 去掉腾空的高度
FWD = (0, -1, 0)
AIM = {
    "idle": {"src": "idle", "aim": [[0, 120, "chest"]], "left": [[0, 120]]},
    "run": {"src": "run", "aim": [[0, 120, "chest"]], "left": [[0, 120]]},
    # 普攻：第二遍横扫。身体右转把锤拉到身后（80 到 84）→ 从身后经右侧扫到正前（92）再到左侧（94）→ 拉回站姿。
    # 拉开以后停的四帧剪掉；扫完以后视频里又转了大半圈、把锤举过头顶（96 到 112），剪掉，用 8 帧直接拉回来
    "attack1": {"src": "attack1", "aim": [[0, 73, "chest"], [76, 96, "keys", {"k": {76: (0, 0.9, 0.4), 78: (0.59, 0.79, 0.15), 80: (0.77, 0.63, 0.14), 82: (0.72, 0.68, 0.12), 84: (0.68, 0.73, 0.09), 86: (-0.15, 0.98, 0.05),
                88: (-0.71, 0.71, -0.04), 90: (-0.93, 0.29, -0.2), 92: (0.32, -0.92, -0.23), 94: (0.89, -0.42, -0.19), 96: (0.61, 0.78, -0.17)}}], [113, 120, "chest"]],
                "left": [[0, 120]], "keep": [[72, 81], [86, 95], {"blend": 8, "via": (0.15, -0.25, 0.95)}, [114, 118]]},
    # Q：第二遍。锤滑到身后、钟垂到身后低处（86 到 92）→ 过顶抡到正前（94 到 97）→ 钟砸在面前的地上（98 到 104）→ 举起来扛回肩上
    "q": {"src": "q", "aim": [[0, 79, "chest"], [82, 97, "keys", {"k": {82: (-0.17, 0.91, 0.37), 84: (-0.1, 0.99, 0.0), 86: (0.15, 0.79, -0.59), 88: (0.15, 0.57, -0.81), 90: (0.15, 0.40, -0.90), 92: (0.09, 0.46, -0.88),
          94: (-0.2, 0.9, -0.3), 95: (0, 0.6, 0.8), 96: (0, -0.6, 0.8), 97: (0.3, -0.9, 0.3)}}], [98, 104, "ground", {"az": (0.55, -0.83)}],
          [106, 116, "keys", {"k": {106: (0.5, -0.86, 0.05), 108: (0.25, -0.7, 0.65), 110: (0.08, -0.6, 0.8), 112: (-0.05, -0.15, 0.99), 114: (-0.19, 0.28, 0.94), 116: (-0.26, 0.7, 0.66)}}], [118, 120, "chest"]],
          "left": [[0, 120]], "keep": [[79, 119]]},
    # W：举锤（竖直）→ 柄尾杵地 → 左臂拉开、出拳（左手离开柄）→ 收回扛上肩。中间三处摆着不动的剪掉
    "w": {"src": "w", "aim": [[0, 8, "chest"], [13, 26, "keys", {"k": {13: (0, -0.05, 1), 26: (0, -0.05, 1)}}], [28, 97, "butt"], [102, 104, "keys", {"k": {102: (-0.1, 0.1, 1), 104: (-0.1, 0.1, 1)}}], [113, 120, "chest"]],
          "left": [[0, 38], [94, 120]], "keep": [[10, 14], [24, 29], [46, 54], [67, 118]], "rshift": [[28, 97, (0, 0, -0.06)]]},
    # （下蹲和腾空时视频里锤在正后方；这里往右偏了一些，不然握在柄中段的右手和左手隔得太开，左手够不着柄）
    # R：举过头顶（钟在脑后上方）→ 下蹲时锤斜在脑后、钟朝后下 → 腾空时一样 → 72 到 75 帧过顶砸到面前，钟顶杵在地上跪压。
    # 蹲着不动的、悬在空中的、读坏的几帧剪掉
    "r": {"src": "r", "aim": [[0, 1, "chest"], [10, 74, "keys", {"k": {10: (-0.05, 0.9, 0.42), 18: (-0.05, 0.9, 0.42), 22: (-0.4, 0.83, -0.38), 47: (-0.4, 0.83, -0.38), 50: (-0.3, 0.7, -0.65), 70: (-0.3, 0.7, -0.65),
          72: (0, 0.87, -0.49), 73: (0, 0.3, 0.95), 74: (0, -0.75, 0.66)}}], [75, 120, "ground", {"az": FWD, "dist": LEN - GRIP, "h": 0.0}]],
          "left": [[0, 120]], "left_both": True, "keep": [[14, 23], [45, 47], [50, 52], [64, 120]], "flat": True},
    # 死亡：锤从肩上竖起来、往右前方倒下去（6 到 15），钟落在右前方的地上（右手还攥着柄），之后一直搁在地上；左手松开
    "death": {"src": "death", "aim": [[0, 2, "chest"], [6, 15, "keys", {"k": {6: (-0.45, 0.5, 0.74), 10: (-0.35, 0.1, 0.93), 13: (-0.7, -0.35, 0.6), 15: (-0.8, -0.55, -0.1)}}], [18, 56, "ground", {"az": (-0.55, -0.83)}], [62, 88, "ground", {"az": (-0.6, -0.8)}], [96, 120, "ground", {"az": (-0.8, -0.6)}]], "left": [[0, 4]], "rshift": [[14, 58, (-0.05, 0, 0)]]},
}


# ------------------------------------------------------------------ 小工具
def unit(v): return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)
def q2m(q):
    w, x, y, z = np.moveaxis(q, -1, 0)
    return np.stack([np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], -1), np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], -1), np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1)], -2)
def m2q(m):
    t = np.trace(m)
    if t > 0: s = np.sqrt(t + 1) * 2; q = [0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]: s = np.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; q = [(m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s]
    elif m[1, 1] > m[2, 2]: s = np.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; q = [(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s]
    else: s = np.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; q = [(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s]
    return unit(np.array(q))
def frame(a, b):
    """两根向量定一个朝向：第一列是 a，第二列是 b 里和 a 垂直的那部分"""
    a = unit(np.asarray(a, float)); b = np.asarray(b, float); b = unit(b - a * b.dot(a)); return np.stack([a, b, np.cross(a, b)], 1)
def rmin(a, b):
    """把单位向量 a 转到 b 的最小旋转"""
    a = unit(a); b = unit(b); v = np.cross(a, b); c = float(a.dot(b)); s = np.linalg.norm(v)
    if s < 1e-8: return np.eye(3) if c > 0 else -np.eye(3) + 2 * np.outer(unit(np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])), unit(np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])))
    k = v / s; K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]]); return np.eye(3) + s * K + (1 - c) * (K @ K)
def slerp_v(a, b, t):
    a = unit(a); b = unit(b); d = float(np.clip(a.dot(b), -1, 1)); th = np.arccos(d)
    if th < 1e-5: return a
    if th > np.pi - 1e-3: b = unit(b + 0.02 * np.array([0.3, 0.5, 0.8])); th = np.arccos(float(np.clip(a.dot(b), -1, 1)))
    return unit(a * np.sin((1 - t) * th) / np.sin(th) + b * np.sin(t * th) / np.sin(th))
def qslerp(a, b, t):
    if np.sum(a * b) < 0: b = -b
    d = float(np.clip(np.sum(a * b), -1, 1)); th = np.arccos(d)
    return unit(a * (1 - t) + b * t) if th < 1e-4 else unit(a * np.sin((1 - t) * th) / np.sin(th) + b * np.sin(t * th) / np.sin(th))
def continuous(q):
    q = q.copy()
    for f in range(1, len(q)):
        flip = np.sum(q[f] * q[f - 1], -1) < 0; q[f][flip] *= -1
    return q
def blur(x, lo, hi, sigma=1.3, norm=False):
    """把第 lo 到 hi 帧沿时间抹平（高斯），别的帧不动"""
    r = int(np.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    pad = np.concatenate([np.repeat(x[:1], r, 0), x, np.repeat(x[-1:], r, 0)]); out = np.zeros_like(x)
    for i, w in enumerate(k): out += w * pad[i:i + len(x)]
    if norm: out = unit(out)
    y = x.copy(); y[lo:hi] = out[lo:hi]; return y
def ease(k): k = float(np.clip(k, 0, 1)); return k * k * (3 - 2 * k)


def fk(q, root_pos):
    """每根骨骼在世界里的朝向 W (T,NB,3,3) 和头的位置 P (T,NB,3)。和 Blender 里摆姿势算出来的一样"""
    T = len(q); R = q2m(q); W = np.zeros((T, NB, 3, 3)); P = np.zeros((T, NB, 3))
    for b in range(NB):
        p = PAR[b]
        if p < 0: W[:, b] = M0[b] @ R[:, b]; P[:, b] = root_pos
        else: W[:, b] = W[:, p] @ (M0[p].T @ M0[b]) @ R[:, b]; P[:, b] = P[:, p] + W[:, p] @ (M0[p].T @ (H0[b] - H0[p]))
    return W, P
def local_q(W_parent, parent, b, W_b):
    """骨骼 b 在世界里要转成 W_b，它自己的姿势四元数是多少"""
    return m2q((W_parent @ (M0[parent].T @ M0[b])).T @ W_b)


def hand_rest(side):
    """静止姿势下一只手的握持坐标（和 hero_build.py 的 hand_frame 在 palm_by_hand 下一样）：L 拳眼方向、E 顺着前臂、掌心、手腕、掌心前的握点"""
    h = H0[BI[MX + side + "Hand"]]; fore = H0[BI[MX + side + "ForeArm"]]; idx = H0[BI[MX + side + "HandIndex1"]]; pky = H0[BI[MX + side + "HandPinky1"]]; mid = H0[BI[MX + side + "HandMiddle1"]]
    L = unit(idx - pky); d = unit(h - fore); E = unit(d - L * d.dot(L)); n = unit(np.cross(L, d)); palm = n if side == "Right" else -n
    return L, E, palm, h, mid
LR, ER, PR, HR, MR = hand_rest("Right"); off = np.array(cfg["gear"][0].get("offset", (0, 0, 0)), float)
G0 = HR + (MR - HR) * 0.7 + PR * cfg.get("weapon", {}).get("palm", 0.012) + np.stack([np.cross(LR, -ER), LR, -ER], 1) @ off      # 武器的握点（静止姿势）
LL, EL, PL, HL, ML = hand_rest("Left"); LP0 = HL + (ML - HL) * 0.7 + PL * 0.037                                                # 左手掌心前的握点
FR_R, FR_L = frame(LR, ER), frame(LL, EL)
B = {k: BI[MX + k] for k in ("Hips", "Spine2", "RightForeArm", "RightHand", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand")}
# 站姿里：锤相对胸口的指向
st = np.load(os.path.join(D, "stance.npz"), allow_pickle=True); stq = np.zeros((1, NB, 4)); stq[..., 0] = 1
for n_, q_ in zip(st["names"], st["quats"]):
    if str(n_) in BI: stq[0, BI[str(n_)]] = q_
Wst, _ = fk(stq, H0[B["Hips"]][None]); U_ST = Wst[0, B["RightHand"]] @ (M0[B["RightHand"]].T @ LR); U_CHEST = Wst[0, B["Spine2"]].T @ U_ST
print("站姿里锤的指向", U_ST.round(3))


def process(name, c):
    m = np.load(f"{V}/out/anim/torg_{c['src']}/motion.npz", allow_pickle=True)
    q, t, J, fps = continuous(m["quats"].astype(float)), m["t"].astype(float).copy(), m["joints"].astype(float).copy(), float(m["fps"]); T = len(q)
    W, P = fk(q, H0[B["Hips"]] + t)
    err = np.abs(P[:, B["RightHand"]] - J[:, JI["RightHand"]]).max(); assert err < 2e-3, f"我算的骨骼位置和管线的对不上（差 {err:.4f}），骨架或者姿势的约定变了"

    def hand_R(u, fore_f, e_prev):
        """右手握着指向 u 的锤时在世界里的朝向（相对静止姿势转了多少）：拳眼对 u，手背顺着前臂。前臂和杆身快平行时沿用上一帧"""
        e = fore_f - u * fore_f.dot(u)
        if np.linalg.norm(e) < 0.3 and e_prev is not None: e = e_prev - u * e_prev.dot(u)
        return frame(u, e) @ FR_R.T, unit(e)

    # ---- 1. 每一帧锤指向哪（在视频的帧号上定） ----
    wr = P[:, B["RightHand"]]; fore = unit(wr - P[:, B["RightForeArm"]])
    U = np.zeros((T, 3)); has = np.zeros(T, bool); u_prev = U_ST.copy(); e_prev = None; pin = {}
    for r_i, rule in enumerate(c["aim"]):
        f0, f1, kind = rule[:3]; par = rule[3] if len(rule) > 3 else {}
        for f in range(f0, min(f1, T - 1) + 1):
            if kind == "chest": u = W[f, B["Spine2"]] @ U_CHEST
            elif kind == "keys":
                ks = sorted(par["k"]); a_ = max([k for k in ks if k <= f], default=ks[0]); b_ = min([k for k in ks if k >= f], default=ks[-1])
                u = unit(np.array(par["k"][a_], float)) if a_ == b_ else slerp_v(np.array(par["k"][a_], float), np.array(par["k"][b_], float), (f - a_) / (b_ - a_))
            else:
                u = u_prev.copy()
                for _ in range(3):
                    R, _e = hand_R(u, fore[f], e_prev); g = wr[f] + R @ (G0 - HR)
                    if kind == "butt":                            # 柄尾钉在地上的一个点
                        if r_i not in pin: bp = g - u_prev * GRIP; bp[2] = 0.0; pin[r_i] = bp
                        u = unit(g - pin[r_i])
                    elif kind == "ground":                        # 钟搁在地上：离握点 dist 远的那一点高度是 h，水平朝 az
                        az = unit(np.array([par["az"][0], par["az"][1], 0.0])); s_ = float(np.clip((par.get("h", 0.11) - g[2]) / par.get("dist", 0.52), -0.98, 0.98))
                        u = unit(az * np.sqrt(1 - s_ * s_) + np.array([0, 0, s_]))
            U[f] = u; has[f] = True; u_prev = u; _, e_prev = hand_R(u, fore[f], e_prev)
    idx = np.where(has)[0]
    for f in range(T):                                            # 规则之间的空当：从前一条的最后一个方向缓缓转到后一条的第一个方向
        if has[f]: continue
        a_ = idx[idx < f]; b_ = idx[idx > f]
        U[f] = U[b_[0]] if not len(a_) else U[a_[-1]] if not len(b_) else slerp_v(U[a_[-1]], U[b_[0]], ease((f - a_[-1]) / (b_[0] - a_[-1])))
    lwt = np.zeros(T)                                             # 左手握着柄的权重（帧段两头各用四帧过渡）
    for a_, b_ in c.get("left", []):
        for f in range(T): lwt[f] = max(lwt[f], 1.0 if a_ <= f <= b_ else ease((f - a_ + 4) / 4) * ease((b_ + 4 - f) / 4) if a_ - 4 < f < b_ + 4 else 0.0)

    # ---- 2. 去掉腾空的高度、剪 ----
    if c.get("flat"):
        ank = [JI["LeftFoot"], JI["RightFoot"]]; toe = [JI[k] for k in ("LeftToeBase", "RightToeBase", "LeftToe_End", "RightToe_End")]
        up = np.clip(np.minimum(J[:, ank, 2].min(1) - 0.065, J[:, toe, 2].min(1) - 0.03), 0, None); t[:, 2] -= up; J[:, :, 2] -= up[:, None]
        print(f"  {name}: 腾空最高 {up.max():.2f}（第 {int(up.argmax())} 帧），已经从动作里去掉")
    keep = c.get("keep", [[0, T - 1]]); Q2, T2, J2, U2, L2, src, seams = [], [], [], [], [], [], []; shift = np.zeros(2); pend = 0; via = None
    for item in keep:
        if isinstance(item, dict): pend = item["blend"]; via = item.get("via"); continue
        a_, b_ = item[0], min(item[1], T - 1)
        if Q2:
            shift = T2[-1][:2] - t[a_, :2]                         # 接缝只接水平位置
            if pend:                                              # 用 pend 帧从上一截的最后一个姿势过渡到这一截的第一个姿势
                q0, t0, j0, u0, l0 = Q2[-1], T2[-1], J2[-1], U2[-1], L2[-1]; t1 = t[a_].copy(); t1[:2] += shift; j1 = J[a_].copy(); j1[:, :2] += shift; qa = q[a_].copy(); qa[np.sum(qa * q0, -1) < 0] *= -1
                for i in range(1, pend + 1):
                    k = ease(i / (pend + 1)); Q2.append(np.array([qslerp(q0[b], qa[b], k) for b in range(NB)])); T2.append(t0 * (1 - k) + t1 * k); J2.append(j0 * (1 - k) + j1 * k); U2.append(slerp_v(u0, U[a_], k) if via is None else slerp_v(slerp_v(u0, np.array(via, float), k), slerp_v(np.array(via, float), U[a_], k), k)); L2.append(l0 * (1 - k) + lwt[a_] * k); src.append(-1)
                pend = 0
            else: seams.append(len(Q2))
        for f in range(a_, b_ + 1):
            tt = t[f].copy(); tt[:2] += shift; jj = J[f].copy(); jj[:, :2] += shift; Q2.append(q[f]); T2.append(tt); J2.append(jj); U2.append(U[f]); L2.append(lwt[f]); src.append(f)
    q, t, J, U, lwt = continuous(np.array(Q2)), np.array(T2), np.array(J2), unit(np.array(U2)), np.array(L2); T = len(q)
    for s_ in seams:
        lo, hi = max(0, s_ - 3), min(T, s_ + 3); q = continuous(blur(q, lo, hi, norm=True)); t = blur(t, lo, hi); J = blur(J, lo, hi); U = blur(U, lo, hi, norm=True)
    U = unit(blur(U, 0, T, 0.6))                                  # 沿时间再轻轻抹一下

    # ---- 3. 右手按锤的指向重新定朝向；左手握着的帧里把左臂摆到柄上 ----
    W, P = fk(q, H0[B["Hips"]] + t)
    if c.get("rshift"):                                           # 先把右手腕整体挪一点（给的是视频帧号上的帧段和挪多少），右臂用两段骨骼的解析解跟过去
        sh = np.zeros((T, 3))
        for a_, b_, d_ in c["rshift"]:
            for f in range(T):
                sf = src[f] if src[f] >= 0 else -99; k = 1.0 if a_ <= sf <= b_ else ease((sf - a_ + 5) / 5) * ease((b_ + 5 - sf) / 5) if a_ - 5 < sf < b_ + 5 else 0.0; sh[f] += np.array(d_, float) * k
        ra1 = np.linalg.norm(H0[BI[MX + "RightForeArm"]] - H0[BI[MX + "RightArm"]]); ra2 = np.linalg.norm(H0[BI[MX + "RightHand"]] - H0[BI[MX + "RightForeArm"]]); bA, bF, bS = BI[MX + "RightArm"], BI[MX + "RightForeArm"], BI[MX + "RightShoulder"]
        for f in range(T):
            if not sh[f].any(): continue
            Hs = P[f, bA]; el0 = P[f, bF]; d = P[f, B["RightHand"]] + sh[f] - Hs; dist = min(np.linalg.norm(d), (ra1 + ra2) * 0.995); dn = unit(d); a_ = (ra1 * ra1 - ra2 * ra2 + dist * dist) / (2 * dist); hgt = np.sqrt(max(ra1 * ra1 - a_ * a_, 0))
            pv = unit((el0 - Hs) - dn * (el0 - Hs).dot(dn)); K = Hs + dn * a_ + pv * hgt; tw = Hs + dn * dist
            Wa = rmin(W[f, bA][:, 1], K - Hs) @ W[f, bA]; Wf0 = Wa @ (M0[bA].T @ M0[bF]) @ q2m(q[f, bF]); Wf = rmin(Wf0[:, 1], tw - K) @ Wf0
            q[f, bA] = local_q(W[f, bS], bS, bA, Wa); q[f, bF] = local_q(Wa, bA, bF, Wf)
        q = continuous(q); W, P = fk(q, H0[B["Hips"]] + t)
    wr = P[:, B["RightHand"]]; fore = unit(wr - P[:, B["RightForeArm"]]); lw = P[:, B["LeftHand"]]
    q2 = q.copy(); e_prev = None; gap = []; far = []; l1 = np.linalg.norm(H0[B["LeftForeArm"]] - H0[B["LeftArm"]]); l2 = np.linalg.norm(H0[B["LeftHand"]] - H0[B["LeftForeArm"]])
    grip_w = np.zeros((T, 3)); RH = [None] * T
    for f in range(T):
        RH[f], e_prev = hand_R(U[f], fore[f], e_prev); grip_w[f] = wr[f] + RH[f] @ (G0 - HR)
    # 左手握在柄的哪一段：读出来的左手投到杆身上的那一点。不能压着右手（0.41 到 0.56 之间不行），所以分铁环一侧（0.16~0.41）和钟一侧（0.56~0.74）；沿时间抹平，够不着就往右手那边挪
    fa_s = unit(lw - P[:, B["LeftForeArm"]]); sL = np.zeros(T)
    palm = lambda f, s_: grip_w[f] + U[f] * (s_ - GRIP) - (frame(U[f], fa_s[f]) @ FR_L.T) @ (LP0 - HL)      # 左手握在 s_ 处时手腕要在哪
    both = c.get("left_both", False)                              # 只有 R 允许左手握到钟那一侧（跪压时左手在右手下面）
    grid = np.concatenate([np.linspace(0.16, 0.41, 26), np.linspace(0.56, 0.74, 19)]) if both else np.linspace(0.16, 0.41, 26); side_prev = -1; reach = (l1 + l2) * 0.985
    for f in range(T):
        s0 = GRIP + ((lw[f] + (frame(U[f], fa_s[f]) @ FR_L.T) @ (LP0 - HL)) - grip_w[f]).dot(U[f]); s0 = np.clip(s0, 0.16, 0.41) if (s0 < GRIP + 0.02 or not both) else np.clip(s0, 0.56, 0.74)
        d = np.array([np.linalg.norm(palm(f, s_) - P[f, B["LeftArm"]]) for s_ in grid]); ok = d <= reach; side = np.where(grid < GRIP, -1, 1)
        if np.linalg.norm(palm(f, s0) - P[f, B["LeftArm"]]) <= reach and (side_prev == (-1 if s0 < GRIP else 1) or not (ok & (side == side_prev)).any()): sL[f] = s0      # 读出来的那一点够得着，而且不用换边
        elif (ok & (side == side_prev)).any(): c_ = np.where(ok & (side == side_prev))[0]; sL[f] = grid[c_[np.abs(grid[c_] - s0).argmin()]]                                    # 留在上一帧那一边
        elif ok.any(): c_ = np.where(ok)[0]; sL[f] = grid[c_[np.abs(grid[c_] - s0).argmin()]]
        else: sL[f] = grid[d.argmin()]                                                                                                                                      # 哪都够不着：取最近的
        side_prev = -1 if sL[f] < GRIP else 1
    sL = blur(sL[:, None], 0, T, 1.5)[:, 0]
    sL = blur(sL[:, None], 0, T, 1.2)[:, 0]
    for f in range(T):
        u = U[f]; R = RH[f]; q2[f, B["RightHand"]] = local_q(W[f, B["RightForeArm"]], B["RightForeArm"], B["RightHand"], R @ M0[B["RightHand"]]); g = grip_w[f]
        if lwt[f] <= 0: continue
        X = g + u * (sL[f] - GRIP); Hs = P[f, B["LeftArm"]]; el0 = P[f, B["LeftForeArm"]]; fa = unit(lw[f] - el0); K = el0.copy(); tw = lw[f].copy()
        for _ in range(4):
            RL = frame(u, fa) @ FR_L.T; tw = X - RL @ (LP0 - HL); d = tw - Hs; dist = min(np.linalg.norm(d), (l1 + l2) * 0.995); dn = unit(d)
            a_ = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist); hgt = np.sqrt(max(l1 * l1 - a_ * a_, 0)); pv = (el0 - Hs) - dn * (el0 - Hs).dot(dn)
            pv = unit(pv) if np.linalg.norm(pv) > 1e-4 else unit(np.cross(dn, [0, 0, 1])); K = Hs + dn * a_ + pv * hgt; tw = Hs + dn * dist; fa = unit(tw - K)
        Wa = rmin(W[f, B["LeftArm"]][:, 1], K - Hs) @ W[f, B["LeftArm"]]
        Wf0 = Wa @ (M0[B["LeftArm"]].T @ M0[B["LeftForeArm"]]) @ q2m(q[f, B["LeftForeArm"]]); Wf = rmin(Wf0[:, 1], tw - K) @ Wf0
        Wh = (frame(u, fa) @ FR_L.T) @ M0[B["LeftHand"]]
        new = {"LeftArm": local_q(W[f, B["LeftShoulder"]], B["LeftShoulder"], B["LeftArm"], Wa), "LeftForeArm": local_q(Wa, B["LeftArm"], B["LeftForeArm"], Wf), "LeftHand": local_q(Wf, B["LeftForeArm"], B["LeftHand"], Wh)}
        for k, v in new.items(): q2[f, B[k]] = qslerp(q[f, B[k]], v, lwt[f])
        if lwt[f] >= 0.999: gap.append(np.linalg.norm(tw - (X - (frame(u, fa) @ FR_L.T) @ (LP0 - HL)))); far.append((f, gap[-1]))
    q = continuous(q2); W2, P2 = fk(q, H0[B["Hips"]] + t)
    for k in ("LeftForeArm", "LeftHand"): J[:, JI[k]] = P2[:, B[k]]
    top = grip_w + U * (LEN - GRIP); on = lwt > 0.999
    np.savez(os.path.join(OUT, name + ".npz"), quats=q, t=t, joints=J, fps=int(round(fps)), keep=np.array(src), aim=U)
    print(f"{name}: {T} 帧（{(T - 1) / fps:.2f} 秒）。钟顶最低 {top[:, 2].min():.2f}（新的第 {int(top[:, 2].argmin())} 帧）；左手握着的 {int(on.sum())} 帧里够不着柄的有 {int(np.sum(np.array(gap) > 0.01))} 帧（最远差 {max(gap) if gap else 0:.3f}）"
          + (f"，握在柄的 {sL[on].min():.2f}~{sL[on].max():.2f}" if on.any() else "") + f"；接缝在新的第 {seams} 帧")
    if any(g_ > 0.03 for _, g_ in far): print("   左手差 3 厘米以上够不着的帧（新帧号:差多少）: " + " ".join(f"{f}:{g_:.2f}" for f, g_ in far if g_ > 0.03))
    print("   新帧号:视频帧号 " + " ".join(f"{i}:{src[i] if src[i] >= 0 else '过渡'}" for i in range(0, T, 4)))


os.makedirs(OUT, exist_ok=True)
for name, c in AIM.items():
    if len(sys.argv) > 1 and name not in sys.argv[1:]: continue
    process(name, c)
