"""动作的换算：把 Tripo 预设（任意一副同网格的骨架）搬到角色成品骨架上、差量叠到架势上、贴地、去水平位移。

一个“姿势序列”用 Pose 表示：dst 骨架每个节点的局部旋转 q (T,N,4) 和胯的局部平移 hips (T,3)，30 帧每秒。
所有世界量都在角色成品 GLB 的世界坐标（glTF：Y 向上，角色面朝 +Z，左手边 +X，身高约 1）。
"""
import numpy as np
from glbio import GLB, qmat, mat_q, qmul, qinv, qslerp, qcontinuous, umeyama, orth

MX = "mixamorig:"
FPS = 30


class Pose:
    def __init__(self, q, hips):
        self.q = np.array(q, float); self.hips = np.array(hips, float)

    def __len__(self): return len(self.q)

    def copy(self): return Pose(self.q.copy(), self.hips.copy())

    def slice(self, a, b): return Pose(self.q[a:b], self.hips[a:b])


class Rig:
    """角色成品骨架（dst）。mesh 用来算网格最低点。"""
    def __init__(self, path, ground_prims=None):
        self.G = GLB(path); G = self.G
        self.hips = G.idx[MX + "Hips"]
        self.bones = [i for i in range(len(G.nodes)) if G.name[i].startswith(MX)]
        self.rest_W = G.rest_worlds()
        self.sd = G.skin_data(max_verts=4000, prims=ground_prims)
        self.sd_all = G.skin_data(max_verts=4000)
        self.hips_parent_W = self.rest_W[G.parent[self.hips]] if G.parent[self.hips] >= 0 else np.eye(4)

    def rest_pose(self, T=1):
        return Pose(np.repeat(self.G.rest_q[None], T, 0), np.repeat(self.G.rest_t[self.hips][None], T, 0))

    def from_clip(self, name, t=None):
        """读成品里已有的动画（如 idle）成 Pose"""
        G = self.G; D = G.anim_duration(name)
        ts = np.arange(0, D + 1e-6, 1 / FPS) if t is None else np.atleast_1d(t)
        tt, qq, ss = G.sample(name, ts)
        return Pose(qq, tt[:, self.hips])

    def worlds(self, P):
        G = self.G; T = len(P)
        tt = np.repeat(G.rest_t[None], T, 0); tt[:, self.hips] = P.hips
        return G.worlds(tt, P.q, np.repeat(G.rest_s[None], T, 0))

    def verts(self, P, W=None):
        return self.G.skin(self.worlds(P) if W is None else W, self.sd)

    def pose_from_world_rot(self, R, hips_pos, mapped, base_q=None):
        """R: (T,N,3,3) 目标世界旋转（只对 mapped 里的节点有效）；其它节点保持 base_q（默认静止）的局部旋转。
        hips_pos: (T,3) 胯的世界位置。返回 Pose。"""
        G = self.G; T = R.shape[0]; N = len(G.nodes)
        q = np.repeat(G.rest_q[None], T, 0) if base_q is None else base_q.copy()
        Wr = np.zeros((T, N, 3, 3)); mset = set(mapped)
        for i in G.order:
            p = G.parent[i]; Rp = Wr[:, p] if p >= 0 else np.repeat(np.eye(3)[None], T, 0)
            if i in mset:
                L = np.einsum("tji,tjk->tik", Rp, R[:, i]); q[:, i] = qcontinuous(mat_q(L)); Wr[:, i] = R[:, i]
            else:
                Wr[:, i] = Rp @ qmat(q[:, i])
        inv = np.linalg.inv(self.hips_parent_W)
        hips = (np.c_[hips_pos, np.ones(T)] @ inv.T)[:, :3]
        return Pose(q, hips)


def similarity(ref: GLB, dst: GLB, names):
    """ref 世界 -> dst 世界 的相似变换 A（4x4，含缩放），用两边同名骨骼的静止位置拟合"""
    Wr = ref.rest_worlds(); Wd = dst.rest_worlds()
    pr = np.array([Wr[ref.idx[n], :3, 3] for n in names]); pd = np.array([Wd[dst.idx[n], :3, 3] for n in names])
    s, R, t = umeyama(pr, pd)
    A = np.eye(4); A[:3, :3] = s * R; A[:3, 3] = t
    res = np.linalg.norm(pr @ (s * R).T + t - pd, axis=1)
    return A, s, res


def retarget(src: GLB, clip, rig: Rig, A, t0=0.0, t1=None, speed=1.0):
    """把 src 的动画 clip（src 世界坐标）搬到 rig 上。A：src 世界 -> dst 世界的相似变换（同一网格在两边的摆放）。
    每根同名骨骼：dst 世界朝向 = A·Ws(t)·Ws_rest⁻¹·A⁻¹ · Wd_rest（骨骼相对静止姿势转多少，就在 dst 里转多少）。
    胯的位置：把 dst 的胯当成刚性挂在 src 胯上的一点。返回 Pose、每帧 src 胯的世界位置（dst 坐标，算位移用）。"""
    D = src.anim_duration(clip); t1 = D if t1 is None else min(t1, D)
    n = int(round((t1 - t0) / speed * FPS)) + 1
    ts = t0 + np.arange(n) / FPS * speed
    tt, qq, ss = src.sample(clip, ts); Ws = src.worlds(tt, qq, ss); Ws0 = src.rest_worlds()
    G = rig.G; Wd0 = rig.rest_W
    names = [nm for nm in G.name if nm.startswith(MX) and nm in src.idx]
    mapped = [G.idx[nm] for nm in names]
    Ai = np.linalg.inv(A)
    R = np.zeros((n, len(G.nodes), 3, 3))
    for nm, j in zip(names, mapped):
        si = src.idx[nm]
        M = A @ Ws[:, si] @ np.linalg.inv(Ws0[si]) @ Ai @ Wd0[j]           # (n,4,4)
        R[:, j] = np.array([orth(m[:3, :3]) for m in M])
        if j == rig.hips: hp = M[:, :3, 3]
    return rig.pose_from_world_rot(R, hp, mapped), mapped


# ---------------------------------------------------------------- 叠加、过渡
def world_rots(rig, P):
    return rig.worlds(P)[:, :, :3, :3]


def additive(rig, base: Pose, M: Pose, mapped, mode="world", gain=1.0):
    """结果 = 架势 ⊕ (动捕(t) ⊖ 动捕(0))。base 取第 0 帧。
    world：每根骨骼的世界旋转差量 D(t)=R(t)R(0)ᵀ 左乘到架势的世界旋转上（受击方向跟着角色的正前方，不跟着侧身的胸口）
    local：每根骨骼局部 q = q_base·q0⁻¹·q(t)"""
    T = len(M); b = base.slice(0, 1)
    if mode == "local":
        q = qmul(np.repeat(b.q, T, 0), qmul(qinv(np.repeat(M.q[:1], T, 0)), M.q))
        if gain != 1.0: q = qslerp(np.repeat(b.q, T, 0), q, gain)
        out = Pose(q, b.hips + (M.hips - M.hips[:1]) * gain)
        return out
    Rm = world_rots(rig, M); Rb = world_rots(rig, b)[0]
    Dl = np.einsum("tnij,nkj->tnik", Rm, Rm[0])                       # R(t)·R(0)ᵀ
    if gain != 1.0:
        dq = mat_q(Dl); I = np.tile([0, 0, 0, 1.0], dq.shape[:-1] + (1,)); Dl = qmat(qslerp(I, dq, gain))
    R = np.einsum("tnij,njk->tnik", Dl, Rb)
    Wb = rig.worlds(b)[0]; Wm = rig.worlds(M)
    hp = Wb[rig.hips, :3, 3] + (Wm[:, rig.hips, :3, 3] - Wm[0, rig.hips, :3, 3]) * gain
    return rig.pose_from_world_rot(R, hp, mapped, base_q=np.repeat(b.q, T, 0))


def blend(P1: Pose, P2: Pose, w):
    """逐帧混合：w=0 取 P1，w=1 取 P2（两段等长）"""
    w = np.asarray(w, float)
    q = qslerp(P1.q, P2.q, np.repeat(w[:, None], P1.q.shape[1], 1))
    return Pose(q, P1.hips + (P2.hips - P1.hips) * w[:, None])


def smoothstep(x):
    x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)


def hold(P: Pose, T):
    return Pose(np.repeat(P.q[:1], T, 0), np.repeat(P.hips[:1], T, 0))


def concat(*Ps):
    return Pose(np.concatenate([p.q for p in Ps]), np.concatenate([p.hips for p in Ps]))


def fade_ends(P: Pose, base: Pose, fin=0, fout=0):
    """开头 fin 帧从 base 过渡进来、结尾 fout 帧过渡回 base（base 取第 0 帧）"""
    T = len(P); w = np.ones(T)
    if fin: w[:fin] = smoothstep(np.arange(fin) / fin)
    if fout: w[T - fout:] = np.minimum(w[T - fout:], smoothstep(1 - (np.arange(1, fout + 1)) / fout))
    return blend(hold(base, T), P, w)


# ---------------------------------------------------------------- 位移、贴地
def travel(rig, P):
    """胯的水平位移曲线（世界 x,z），相对第 0 帧"""
    W = rig.worlds(P); h = W[:, rig.hips, :3, 3]
    return h[:, [0, 2]] - h[0, [0, 2]]


def remove_horizontal(rig, P, keep=0.0):
    """去掉胯的水平位移（世界），保留 keep 比例"""
    W = rig.worlds(P); h = W[:, rig.hips, :3, 3]; T = len(P)
    tgt = h.copy(); tgt[:, [0, 2]] = h[0, [0, 2]] + (h[:, [0, 2]] - h[0, [0, 2]]) * keep
    return set_hips_world(rig, P, tgt)


def set_hips_world(rig, P, pos):
    inv = np.linalg.inv(rig.hips_parent_W); T = len(P)
    Q = P.copy(); Q.hips = (np.c_[pos, np.ones(T)] @ inv.T)[:, :3]; return Q


def ground(rig, P, contact=None, smooth=2):
    """按网格最低点贴地：contact[t] 为真的帧，把最低点放到 y=0；其它帧只防穿地（最低点 < 0 时抬起来）。
    返回新的 Pose 和每帧修正量。contact 为 None 时全部当着地。"""
    W = rig.worlds(P); V = rig.G.skin(W, rig.sd); mn = V[..., 1].min(1); T = len(P)
    if contact is None: contact = np.ones(T, bool)
    off = np.where(contact, -mn, np.maximum(-mn, 0))
    if smooth:
        k = np.ones(2 * smooth + 1) / (2 * smooth + 1); pad = np.pad(off, smooth, mode="edge"); off_s = np.convolve(pad, k, "valid")
        off = np.maximum(off_s, np.where(contact, off, np.maximum(-mn, 0)) - 0.004)   # 平滑后仍保证不穿地（容差 4mm）
    h = W[:, rig.hips, :3, 3].copy(); h[:, 1] += off
    return set_hips_world(rig, P, h), off, mn


def foot_metrics(rig, P):
    """脚滑、穿地统计：每帧网格最低点、两只脚踝的水平速度（着地时）"""
    W = rig.worlds(P); V = rig.G.skin(W, rig.sd); mn = V[..., 1].min(1)
    out = {"min_y_min": float(mn.min()), "min_y_max": float(mn.max())}
    for s in ("Left", "Right"):
        f = W[:, rig.G.idx[MX + s + "Foot"], :3, 3]; low = f[:, 1] < (f[:, 1].min() + 0.02)
        sp = np.linalg.norm(np.diff(f[:, [0, 2]], axis=0), axis=1) * FPS
        out[s + "_slide_mps_when_low"] = float(sp[low[1:]].max()) if low[1:].any() else 0.0
    return out


# ---------------------------------------------------------------- 手摆姿势用
def axis_angle(axis, deg):
    a = np.asarray(axis, float); a = a / np.linalg.norm(a); h = np.radians(deg) / 2
    return np.r_[a * np.sin(h), np.cos(h)]


def rotate_bone(rig, P, name, axis, deg, space="world"):
    """把一根骨骼（连同子骨骼）绕世界轴 axis 转 deg 度（每帧同样转）。space='local' 时 axis 是骨骼自己的局部轴。返回新 Pose"""
    Q = P.copy(); i = rig.G.idx[name if name in rig.G.idx else MX + name]
    W = rig.worlds(Q); p = rig.G.parent[i]
    for t in range(len(Q)):
        Rw = W[t, i, :3, :3]; Rp = W[t, p, :3, :3] if p >= 0 else np.eye(3)
        ax = Rw @ np.asarray(axis, float) if space == "local" else np.asarray(axis, float)
        Rn = qmat(axis_angle(ax, deg)) @ Rw
        Q.q[t, i] = mat_q(Rp.T @ Rn)
    return Q


def rotate_whole(rig, P, axis, deg, pivot=None):
    """整个人绕世界轴转（转胯的世界朝向和位置）"""
    Q = P.copy(); W = rig.worlds(Q); R = qmat(axis_angle(axis, deg)); h = rig.hips
    Wh = W[:, h]; pv = Wh[:, :3, 3] if pivot is None else np.asarray(pivot)
    Rp = rig.hips_parent_W[:3, :3]
    for t in range(len(Q)):
        Rn = R @ Wh[t, :3, :3]; Q.q[t, h] = mat_q(Rp.T @ Rn)
    pos = (Wh[:, :3, 3] - pv) @ R.T + pv
    return set_hips_world(rig, Q, pos)


CHILD = {"Arm": "ForeArm", "ForeArm": "Hand", "UpLeg": "Leg", "Leg": "Foot", "Foot": "ToeBase", "Spine": "Spine1", "Spine1": "Spine2", "Spine2": "Neck", "Neck": "Head", "Shoulder": "Arm"}


def aim_bone(rig, P, side, part, target, frac=1.0):
    """让骨骼 side+part 的朝向（头 -> 子骨骼的头）转向世界方向 target（每帧）。frac<1 时只转一部分"""
    name = MX + side + part; child = MX + side + CHILD[part]
    Q = P.copy(); i = rig.G.idx[name]; c = rig.G.idx[child]; p = rig.G.parent[i]
    W = rig.worlds(Q); tg = np.asarray(target, float); tg = tg / np.linalg.norm(tg)
    for t in range(len(Q)):
        d = W[t, c, :3, 3] - W[t, i, :3, 3]; d /= np.linalg.norm(d)
        ax = np.cross(d, tg); s = np.linalg.norm(ax); ang = np.degrees(np.arctan2(s, np.dot(d, tg))) * frac
        if s < 1e-8: continue
        Rn = qmat(axis_angle(ax, ang)) @ W[t, i, :3, :3]; Rp = W[t, p, :3, :3]
        Q.q[t, i] = mat_q(Rp.T @ Rn)
    return Q


# ---------------------------------------------------------------- 手里的武器（凌霜的刀）
def load_weapon(rig_path):
    """从角色成品旁边的 <id>.json 读 weapon：{"bone", "base", "tip"}（骨骼局部坐标）。没有就返回 None"""
    import json, os
    js = os.path.splitext(rig_path)[0] + ".json"
    if not os.path.exists(js): return None
    w = json.load(open(js)).get("weapon")
    return w if w and "tip" in w else None


def blade_points(rig, W, wpn, n=12):
    """(T,n,3) 刀身上从刀镡到刀尖的 n 个点（世界）"""
    i = rig.G.idx[wpn["bone"]]; b = np.r_[wpn["base"], 1.0]; t = np.r_[wpn["tip"], 1.0]
    u = np.linspace(0, 1, n)[:, None]; pts = b[None] * (1 - u) + t[None] * u          # (n,4)
    return np.einsum("tij,nj->tni", W[:, i], pts)[..., :3]


def aim_blade(rig, P, wpn, target, weight=None):
    """转持刀的手（绕手腕），让刀身方向转向 target（(T,3) 或 (3,)，世界）。weight (T,) 控制转多少"""
    Q = P.copy(); i = rig.G.idx[wpn["bone"]]; p = rig.G.parent[i]; W = rig.worlds(Q); T = len(Q)
    tg = np.broadcast_to(np.asarray(target, float), (T, 3)); wt = np.ones(T) if weight is None else np.asarray(weight, float)
    v = np.asarray(wpn["tip"], float) - np.asarray(wpn["base"], float)
    for t in range(T):
        if wt[t] <= 1e-4: continue
        d = W[t, i, :3, :3] @ v; d /= np.linalg.norm(d); g = tg[t] / np.linalg.norm(tg[t])
        ax = np.cross(d, g); s = np.linalg.norm(ax)
        if s < 1e-8: continue
        ang = np.degrees(np.arctan2(s, np.dot(d, g))) * wt[t]
        Rn = qmat(axis_angle(ax, ang)) @ W[t, i, :3, :3]; Q.q[t, i] = mat_q(W[t, p, :3, :3].T @ Rn)
    return Q


def flatten_blade(rig, P, wpn, weight, lift=0.12):
    """躺倒时让刀平放：刀身方向压成水平（稍微翘起 lift），weight (T,) 为 0 的帧不动"""
    W = rig.worlds(P); pts = blade_points(rig, W, wpn, 2); d = pts[:, 1] - pts[:, 0]
    h = d.copy(); h[:, 1] = 0; n = np.linalg.norm(h, axis=1, keepdims=True)
    side = W[:, rig.hips, :3, 0]                                   # 胯的局部 x 轴，刀没有水平分量时的后备方向
    h = np.where(n > 1e-3, h / np.maximum(n, 1e-9), side); h[:, 1] = lift
    return aim_blade(rig, P, wpn, h, weight)


def blade_ground(rig, P, wpn, margin=0.01):
    """刀尖（刀身任一点）低于地面时，绕手腕把刀往上抬到地面以上"""
    Q = P.copy()
    for it in range(3):
        W = rig.worlds(Q); pts = blade_points(rig, W, wpn); low = pts[..., 1].min(1)
        bad = low < margin
        if not bad.any(): break
        d = pts[:, -1] - pts[:, 0]; L = np.linalg.norm(d, axis=1, keepdims=True); d = d / L
        base = pts[:, 0]
        # 让刀身最低点抬到 margin：目标方向的竖直分量 = (margin - 刀镡高度)/刀长
        ty = np.clip((margin + 0.005 - base[:, 1]) / L[:, 0], -1, 0.95)
        tg = d.copy(); hz = np.linalg.norm(tg[:, [0, 2]], axis=1, keepdims=True)
        tg[:, [0, 2]] = tg[:, [0, 2]] / np.maximum(hz, 1e-6) * np.sqrt(1 - ty[:, None] ** 2); tg[:, 1] = ty
        tg = np.where(bad[:, None], np.maximum(tg, tg) if False else tg, d)
        Q = aim_blade(rig, Q, wpn, tg, bad.astype(float))
    return Q


def blade_metrics(rig, P, wpn, sd_dense):
    """刀穿地、刀贴进身体的情况：刀身最低点、刀身离身体网格最近的距离（每帧）"""
    W = rig.worlds(P); pts = blade_points(rig, W, wpn, 16); V = rig.G.skin(W, sd_dense)
    dmin = np.array([np.sqrt(((pts[t, 2:, None, :] - V[t, None, :, :]) ** 2).sum(-1)).min() for t in range(len(P))])   # 刀镡附近两点不算（手握着）
    return {"blade_low_min": round(float(pts[..., 1].min()), 3), "blade_body_min_dist": round(float(dmin.min()), 3),
            "frames_blade_in_body(<1cm)": int((dmin < 0.01).sum()), "frames": len(P)}


# ---------------------------------------------------------------- 按“规格”手摆一个全身姿势、关键帧插值
def foot_flat(rig, P, side, heading=None):
    """脚掌放平：脚 -> 脚趾 的方向保持静止姿势里的俯仰，水平朝向取 heading（默认保持当前）"""
    G = rig.G; f = G.idx[MX + side + "Foot"]; tb = G.idx[MX + side + "ToeBase"]
    r = rig.rest_W[tb, :3, 3] - rig.rest_W[f, :3, 3]; r /= np.linalg.norm(r); ry = r[1]; rh = np.hypot(r[0], r[2])
    W = rig.worlds(P); d = W[0, tb, :3, 3] - W[0, f, :3, 3]
    h = np.array([d[0], 0, d[2]]) if heading is None else np.array([heading[0], 0, heading[2]], float)
    h /= max(np.linalg.norm(h), 1e-9)
    return aim_bone(rig, P, side, "Foot", h * rh + np.array([0, ry, 0]))


def pose_from_spec(rig, sp, base=None):
    """sp: {"pitch": 胯向后倒的角度(90=仰躺), "roll": 绕前后轴侧倾, "yaw": 绕竖直轴,
            "bend": [Spine, Spine1, Spine2, Neck, Head 向前弯的角度],
            "twist": [Spine, Spine1, Spine2 绕身体上下轴扭],
            "Left"/"Right": {"arm": 方向, "fore": 方向, "thigh": 方向, "shin": 方向, "flat": true/false}}
    方向都是世界方向（+X 角色左手边，+Y 上，+Z 正前方），长度无所谓。从静止姿势（或 base）出发，最后按网格最低点贴地。"""
    P = rig.rest_pose(1) if base is None else base.slice(0, 1).copy()
    if base is None:
        for s in ("Left", "Right"):
            P = aim_bone(rig, P, s, "Shoulder", np.r_[1 if s == "Left" else -1, 0.05, 0], 0.3)
    R = qmat(axis_angle((0, 1, 0), sp.get("yaw", 0))) @ qmat(axis_angle((0, 0, 1), sp.get("roll", 0))) @ qmat(axis_angle((1, 0, 0), -sp.get("pitch", 0)))
    W = rig.worlds(P); h = rig.hips; Rp = rig.hips_parent_W[:3, :3]
    P.q[0, h] = mat_q(Rp.T @ (R @ rig.rest_W[h, :3, :3]))
    lat = R @ np.array([1.0, 0, 0]); up = R @ np.array([0, 1.0, 0])
    for nm, d in zip(("Spine", "Spine1", "Spine2", "Neck", "Head"), sp.get("bend", [0] * 5)):
        if d: P = rotate_bone(rig, P, nm, lat, d)
    for nm, d in zip(("Spine", "Spine1", "Spine2"), sp.get("twist", [0] * 3)):
        if d: P = rotate_bone(rig, P, nm, up, d)
    for s in ("Left", "Right"):
        L = sp.get(s, {})
        for key, part in (("arm", "Arm"), ("fore", "ForeArm"), ("thigh", "UpLeg"), ("shin", "Leg")):
            if key in L: P = aim_bone(rig, P, s, part, L[key])
        if L.get("flat", True): P = foot_flat(rig, P, s, L.get("toe"))
    P, _, _ = ground(rig, P, smooth=0)
    return P


def keyframes(rig, keys, smooth=2.5, ease=0.6):
    """keys: [(帧号, Pose)]。分段 slerp（段内匀速），整体时间轻微缓入缓出（ease 0..1），再用高斯把关键帧处的折角磨圆。
    胯的平移同样插值。返回 Pose（帧数 = 最后一帧 + 1）。"""
    T = keys[-1][0] + 1; fr = np.array([k[0] for k in keys], float)
    t = np.arange(T, dtype=float); x = t / (T - 1)
    tau = (1 - ease) * t + ease * (T - 1) * (x * x * (3 - 2 * x))
    nb = keys[0][1].q.shape[1]; q = np.zeros((T, nb, 4)); hp = np.zeros((T, 3))
    for f in range(T):
        k = int(np.clip(np.searchsorted(fr, tau[f], side="right") - 1, 0, len(keys) - 2))
        u = np.clip((tau[f] - fr[k]) / (fr[k + 1] - fr[k]), 0, 1)
        a, b = keys[k][1], keys[k + 1][1]
        q[f] = qslerp(a.q[0], b.q[0], np.full(nb, u)); hp[f] = a.hips[0] + (b.hips[0] - a.hips[0]) * u
    if smooth:
        r = int(3 * smooth); kk = np.exp(-0.5 * (np.arange(-r, r + 1) / smooth) ** 2); kk /= kk.sum()
        qc = q.copy()
        for j in range(nb): qc[:, j] = qcontinuous(q[:, j])
        pad = np.pad(qc, ((r, r), (0, 0), (0, 0)), mode="edge"); q = np.zeros_like(qc)
        for i_, w_ in enumerate(kk): q += w_ * pad[i_:i_ + T]
        q /= np.linalg.norm(q, axis=-1, keepdims=True)
        padh = np.pad(hp, ((r, r), (0, 0)), mode="edge"); hp = sum(w_ * padh[i_:i_ + T] for i_, w_ in enumerate(kk))
        q[0] = keys[0][1].q[0]; q[-1] = keys[-1][1].q[0]; hp[0] = keys[0][1].hips[0]; hp[-1] = keys[-1][1].hips[0]
    return Pose(q, hp)


def lock_feet(rig, P, ref, sides=("Left", "Right"), weight=None):
    """脚钉在 ref（取第 0 帧）的位置和朝向上：两段骨骼解析 IK（膝盖朝当前膝盖的方向），脚掌朝向抄 ref。weight (T,) 0..1"""
    G = rig.G; T = len(P); Q = P.copy(); wt = np.ones(T) if weight is None else np.asarray(weight, float)
    Wr = rig.worlds(ref.slice(0, 1))[0]
    for t in range(T):
        if wt[t] <= 1e-4: continue
        F = Q.slice(t, t + 1)
        for s in sides:
            iu, il, iff = G.idx[MX + s + "UpLeg"], G.idx[MX + s + "Leg"], G.idx[MX + s + "Foot"]
            W = rig.worlds(F)[0]
            H = W[iu, :3, 3]; K = W[il, :3, 3]; A = W[iff, :3, 3]
            tgt = A + (Wr[iff, :3, 3] - A) * wt[t]
            l1 = np.linalg.norm(K - H); l2 = np.linalg.norm(A - K)
            d = tgt - H; dist = np.clip(np.linalg.norm(d), abs(l1 - l2) + 1e-4, (l1 + l2) * 0.999); dn = d / np.linalg.norm(d)
            a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist); h = np.sqrt(max(l1 * l1 - a * a, 0))
            pole = K - H; pole = pole - dn * np.dot(pole, dn)
            if np.linalg.norm(pole) < 1e-6: pole = W[rig.hips, :3, 2]
            pole /= np.linalg.norm(pole); Kn = H + dn * a + pole * h
            F = aim_bone(rig, F, s, "UpLeg", Kn - H)
            F = aim_bone(rig, F, s, "Leg", H + dn * dist - Kn)
            W = rig.worlds(F)[0]; Rp = W[il, :3, :3]
            Rf = qmat(qslerp(mat_q(W[iff, :3, :3]), mat_q(Wr[iff, :3, :3]), wt[t]))
            F.q[0, iff] = mat_q(Rp.T @ Rf)
        Q.q[t] = F.q[0]
    return Q


def planted_slide(rig, P, ref):
    """站着的动作里两只脚踝离架势位置的最大水平偏移（米，身高按 1）"""
    W = rig.worlds(P); Wr = rig.worlds(ref.slice(0, 1))[0]; out = {}
    for s in ("Left", "Right"):
        i = rig.G.idx[MX + s + "Foot"]; d = W[:, i, :3, 3] - Wr[i, :3, 3]
        out[s] = round(float(np.linalg.norm(d[:, [0, 2]], axis=1).max()), 4)
    return out


def blade_clear(rig, P, wpn, sd_dense, min_dist=0.015, max_deg=30, smooth=1.5):
    """刀身离身体网格太近（< min_dist）的帧：绕手腕找一个最小的转动把刀拉开，转动量在时间上做平滑再加回去"""
    i = rig.G.idx[wpn["bone"]]; p = rig.G.parent[i]; T = len(P)
    def dmin_of(Wt):
        pts = blade_points(rig, Wt[None], wpn, 16)[0][2:]; V = rig.G.skin(Wt[None], sd_dense)[0]
        return np.sqrt(((pts[:, None] - V[None]) ** 2).sum(-1)).min()
    W = rig.worlds(P); rv = np.zeros((T, 3)); cand = []
    for ax in np.eye(3):
        for sgn in (1, -1):
            for deg in range(5, max_deg + 1, 5): cand.append(ax * sgn * deg)
    cand.sort(key=lambda v: np.linalg.norm(v))
    for t in range(T):
        if dmin_of(W[t]) >= min_dist: continue
        for v in cand:
            Q = P.slice(t, t + 1).copy()
            Rn = qmat(axis_angle(v, np.linalg.norm(v))) @ W[t, i, :3, :3]
            Q.q[0, i] = mat_q(W[t, p, :3, :3].T @ Rn)
            if dmin_of(rig.worlds(Q)[0]) >= min_dist: rv[t] = v; break
    if not rv.any(): return P, 0
    r = int(3 * smooth); kk = np.exp(-0.5 * (np.arange(-r, r + 1) / smooth) ** 2)
    sm = np.array([[np.convolve(np.pad(rv[:, k], r, mode="edge"), kk / kk.sum(), "valid")[t] for k in range(3)] for t in range(T)])
    sm = np.where(np.linalg.norm(sm, axis=1, keepdims=True) < np.linalg.norm(rv, axis=1, keepdims=True), rv, sm)   # 平滑后不比需要的少
    Q = P.copy()
    for t in range(T):
        n = np.linalg.norm(sm[t])
        if n < 1e-6: continue
        Rn = qmat(axis_angle(sm[t], n)) @ W[t, i, :3, :3]; Q.q[t, i] = mat_q(W[t, p, :3, :3].T @ Rn)
    return Q, int((np.linalg.norm(rv, axis=1) > 0).sum())
