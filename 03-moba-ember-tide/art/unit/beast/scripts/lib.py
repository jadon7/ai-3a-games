"""巨兽修动作用的小工具：读管线的 motion.npz，在“关节角 + 根骨骼朝向 + 根骨骼位移”上改，再重新算出骨骼旋转和关节位置存回去。
管线的 motion.npz：theta (T,D) 各自由度角度、t (T,3) 根位移、quats (T,n,4) 每根骨骼的局部旋转（根骨骼那一格带着整体朝向）、joints (T,K,3)、loc、fps。
"""
import os, sys
import numpy as np
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, V2R)
from v2r import skeleton as sk  # noqa: E402

SKEL = sk.Skeleton.load(os.path.join(V2R, "assets/model/beast_skeleton.json"))
JN = SKEL.joint_names
DN = SKEL.dof_names
J = lambda n: JN.index(n)       # noqa: E731
D = lambda n: DN.index(n)       # noqa: E731
GROUND = SKEL.ground_idx
REST_Z = SKEL.joint_rest[:, 2]


def quat_to_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def load(path):
    m = np.load(path, allow_pickle=True)
    q = m["quats"].astype(float); R = SKEL.R[SKEL.root]
    A = np.stack([R @ quat_to_mat(q[f, SKEL.root] / np.linalg.norm(q[f, SKEL.root])) @ R.T for f in range(len(q))])
    return {"theta": m["theta"].astype(float).copy(), "A": A, "t": m["t"].astype(float).copy(), "fps": int(m["fps"])}


def fk(mo):
    """-> joints (T,K,3)、quats (T,n,4)"""
    T = len(mo["theta"]); joints = np.zeros((T, SKEL.K, 3)); quats = np.zeros((T, SKEL.n, 4))
    for f in range(T):
        Q = SKEL.local_rotations(mo["theta"][f], mo["A"][f]); P, G = SKEL.fk(Q, mo["t"][f])
        joints[f] = SKEL.joint_positions(P, G); quats[f], _ = SKEL.blender_pose(Q, mo["t"][f])
    for f in range(1, T):
        flip = np.sum(quats[f] * quats[f - 1], -1) < 0; quats[f][flip] *= -1
    return joints, quats


def save(path, mo):
    joints, quats = fk(mo); loc = (SKEL.R[SKEL.root].T @ mo["t"].T).T / SKEL.scale
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    np.savez(path, quats=quats, loc=loc, fps=mo["fps"], joints=joints.astype(np.float32), theta=mo["theta"].astype(np.float32), t=mo["t"].astype(np.float32))
    return joints


def rot_log(R):
    """旋转矩阵 -> 旋转向量"""
    c = np.clip((np.trace(R) - 1) / 2, -1, 1); a = np.arccos(c)
    if a < 1e-8: return np.zeros(3)
    v = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]]) / (2 * np.sin(a))
    return v * a


def rot_blend(Ra, Rb, w):
    """从 Ra 往 Rb 走 w（0..1）"""
    return sk.rotvec_to_mat(rot_log(Rb @ Ra.T) * w) @ Ra


def smoothstep(x):
    x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)


def gauss(x, sigma):
    """沿第 0 维高斯平滑（两头按边界值延长）"""
    r = int(np.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    pad = np.concatenate([np.repeat(x[:1], r, 0), x, np.repeat(x[-1:], r, 0)]); out = np.zeros_like(x, dtype=float)
    for i, w in enumerate(k): out += w * pad[i:i + len(x)]
    return out


def retime(mo, spec, ease_in=4):
    """变速不剪断。spec: [(起帧, 止帧, 倍率), …] 首尾相接。返回新的动作和“源帧 → 输出帧”的换算函数。"""
    pos = [float(spec[0][0])]
    for a, b, s in spec:
        x = pos[-1]
        while x + s <= b + 1e-9: x += s; pos.append(x)
        if b - x > 0.25 * s: pos.append(b)
        pos[-1] = b
    if ease_in and len(pos) > ease_in + 2:                         # 起步缓一点：开头 ease_in 步走过的那一段改成 ease_in+2 步、步子从小到大（不然动作从静止一帧就到全速，接在待机后面像被踢了一脚）。
        n = ease_in; L = pos[n] - pos[0]; wts = np.arange(1, n + 3, dtype=float); head = pos[0] + np.concatenate([[0.0], np.cumsum(wts / wts.sum() * L)])      # 后面的帧原样接上，只是整体晚 2 帧，变速的拐点还在原来的源帧上
        pos = list(head) + list(pos[n + 1:])
    pos = np.array(pos); k = np.exp(-0.5 * (np.arange(-3, 4) / 1.2) ** 2); k /= k.sum()
    sm = np.convolve(np.pad(pos, 3, mode="edge"), k, mode="valid"); sm[0], sm[-1] = pos[0], pos[-1]; pos = np.maximum.accumulate(sm)
    T = len(mo["theta"]); i0 = np.clip(np.floor(pos).astype(int), 0, T - 2); f = pos - i0
    lerp = lambda X: X[i0] * (1 - f).reshape(-1, *[1] * (X.ndim - 1)) + X[i0 + 1] * f.reshape(-1, *[1] * (X.ndim - 1))  # noqa: E731
    out = {"theta": lerp(mo["theta"]), "t": lerp(mo["t"]), "A": np.stack([rot_blend(mo["A"][a], mo["A"][a + 1], w) for a, w in zip(i0, f)]), "fps": mo["fps"]}
    return out, (lambda src: float(np.interp(src, pos, np.arange(len(pos)))))


def cut(mo, a, b):
    return {"theta": mo["theta"][a:b + 1].copy(), "A": mo["A"][a:b + 1].copy(), "t": mo["t"][a:b + 1].copy(), "fps": mo["fps"]}


def ease_to(mo, f0, f1, target, dofs=None, root=False):
    """第 f0 到 f1 帧之间，把选中的自由度（dofs=None 是全部）慢慢带到 target 这个姿势（{'theta','A','t'} 单帧），f1 以后就等于它。"""
    T = len(mo["theta"]); idx = range(SKEL.D) if dofs is None else dofs
    for f in range(f0, T):
        w = float(smoothstep((f - f0) / max(1, f1 - f0)))
        for k in idx: mo["theta"][f, k] += (target["theta"][k] - mo["theta"][f, k]) * w
        if root:
            mo["A"][f] = rot_blend(mo["A"][f], target["A"], w); mo["t"][f] += (target["t"] - mo["t"][f]) * w
    return mo


def frame(mo, f):
    return {"theta": mo["theta"][f].copy(), "A": mo["A"][f].copy(), "t": mo["t"][f].copy()}


TAIL = [k for k, r in enumerate(SKEL.dof_role) if r == "tail"]
if __name__ == "__main__":
    for k, n in enumerate(DN): print(k, n, SKEL.dof_role[k], round(float(np.degrees(SKEL.dof_lo[k])), 1), round(float(np.degrees(SKEL.dof_hi[k])), 1))
    print("rest z", {n: round(float(REST_Z[i]), 3) for i, n in enumerate(JN)})


def ease_from(mo, f0, f1, target, dofs=None, root=True):
    """第 f0 帧就是 target 这个姿势，到 f1 帧完全交还给原来的动作（开头从站姿起步用）。"""
    idx = range(SKEL.D) if dofs is None else dofs
    for f in range(0, f1 + 1):
        w = 1.0 - float(smoothstep((f - f0) / max(1, f1 - f0))) if f >= f0 else 1.0
        for k in idx: mo["theta"][f, k] += (target["theta"][k] - mo["theta"][f, k]) * w
        if root:
            mo["A"][f] = rot_blend(mo["A"][f], target["A"], w); mo["t"][f] += (target["t"] - mo["t"][f]) * w
    return mo


def foot_gap(joints):
    """每帧“最低的那只脚”比站着的时候高多少（正 = 飘着，负 = 陷进地里）。站着时各脚关节的高度取静止姿势的。"""
    return np.min(joints[:, GROUND, 2] - REST_Z[GROUND][None], axis=1)


def resolve(targets, fps, weight=None, ground=True, **kw):
    """给每帧每个跟踪点一个想要的三维位置（targets (T,K,3)），让管线的求解器在这副骨架上解出最接近的姿势。
    weight: 每个点的权重 (K,) 或 (T,K)，不给就全是 1。返回和 load() 一样的动作。
    （镜像、把脚钉在地上、把一条腿换成另一条腿的轨迹，都是先改目标位置再走这里，解出来的一定是骨架摆得出的姿势。）"""
    import contextlib, io
    from v2r import solver
    T = len(targets); obs = sk.project(targets).transpose(1, 0, 2, 3); conf = np.ones((T, 2, SKEL.K))
    jw = np.array([SKEL.joint_weight.get(n, 1.0) for n in JN])
    if weight is not None:
        weight = np.asarray(weight, dtype=float)
        if weight.ndim == 1: jw = jw * weight
        else: conf = conf * np.sqrt(np.clip(weight, 0, 1))[:, None, :] * 0.85 + 0.15      # 求解器里权重 = ((conf-0.15)/0.85)²
    with contextlib.redirect_stdout(io.StringIO()):
        res = solver.solve(SKEL, obs, conf, joint_weight=jw, ground=ground, **kw)
    err = np.linalg.norm(res["joints"] - targets, axis=-1)
    print(f"  重解: 和目标平均差 {err.mean() / SKEL.size_ref * 100:.2f}% 身长，最大 {err.max() / SKEL.size_ref * 100:.1f}%（{JN[int(np.unravel_index(err.argmax(), err.shape)[1])]} 第 {int(np.unravel_index(err.argmax(), err.shape)[0])} 帧）")
    return {"theta": res["theta"].astype(float), "A": res["A_root"].astype(float), "t": res["t"].astype(float), "fps": int(round(fps))}


def other(n):
    return "Right" + n[4:] if n.startswith("Left") else "Left" + n[5:] if n.startswith("Right") else n


FEET_F = ["LeftFToe", "RightFToe", "LeftFWrist", "RightFWrist"]      # 前脚没有趾骨，整个脚掌一起钉（腕也钉），脚掌才是平的
FEET_H = ["LeftHToe", "LeftHToeTip", "RightHToe", "RightHToeTip"]    # 后脚钉趾，脚跟（踝）可以抬


def pin_feet(mo, pins, ref=0, nudge=None, **kw):
    """把几只脚钉在第 ref 帧的位置上再解一遍（“脚留在原地”的动作里，读出来的脚会前后挪几厘米、上下抖；脚掌一倾斜爪尖还会戳进地里）。
    pins: [(跟踪点名字的列表, 帧段 [(起, 止), …] 或 None=全程, 权重), …]；帧段两头各用 3 帧过渡。重解时带“网格不许到地面以下”。"""
    Jt, _ = fk(mo); T = len(Jt); tgt = Jt.copy(); W = np.ones((T, SKEL.K))
    for names, spans, w in pins:
        k = np.zeros(T) if spans else np.ones(T)
        for a_, b_ in spans or []:
            k = np.maximum(k, smoothstep((np.arange(T) - (a_ - 3)) / 3) * smoothstep(((b_ + 3) - np.arange(T)) / 3))
        for n in names:
            tgt[:, J(n)] = Jt[:, J(n)] * (1 - k[:, None]) + Jt[ref, J(n)][None] * k[:, None]; W[:, J(n)] = 1 + (w - 1) * k
    for names, (a_, b_), dz in nudge or []:                       # 把几个点的目标高度从第 a_ 帧起慢慢挪 dz，到第 b_ 帧挪满（比如趴下以后让下巴再低一点贴到地上）
        for n in names: tgt[:, J(n), 2] += dz * smoothstep((np.arange(T) - a_) / max(1, b_ - a_))
    return resolve2(tgt, mo["fps"], weight=W, init=mo, **kw)


def ground_fix(mo, sigma=2.0):
    """整体上下挪一点，让最低的那只脚正好在站立高度（沿时间磨过，不会一帧一跳）。返回挪之前最陷、最飘各多少。"""
    Jt, _ = fk(mo); g = foot_gap(Jt); low = gauss(g, sigma) if sigma > 0 else g
    mo["t"][:, 2] -= low + np.minimum(g - low, 0)                # 磨过的那部分整体挪；剩下还陷进地里的帧（砸地那一下）单独抬起来，陷比飘难看
    return float(g.min()), float(g.max())


def mirror(mo):
    """左右镜像（在“相对静止姿势转了多少”上镜像：模型本身不对称——头天生偏左——所以不能直接镜像位置）。"""
    M = np.diag([-1.0, 1.0, 1.0]); th = mo["theta"].copy(); out = th.copy()
    swap = {}
    for k, n in enumerate(DN):
        b = SKEL.dof_bone[k]; role, kind, side = SKEL.dof_role[k], SKEL.dof_kind[k], SKEL.side[b]
        if side != 0:
            k2 = next(j for j in range(SKEL.D) if SKEL.dof_role[j] == role and SKEL.dof_kind[j] == kind and SKEL.side[SKEL.dof_bone[j]] == -side)
            out[:, k2] = th[:, k] * (-1 if kind == "twist" else 1)
        else:
            out[:, k] = th[:, k] * (-1 if kind.endswith(("yaw", "twist", "roll")) else 1)
    return {"theta": out, "A": np.stack([M @ a @ M for a in mo["A"]]), "t": mo["t"] * np.array([-1.0, 1.0, 1.0]), "fps": mo["fps"]}


# ---------------------------------------------------------------------------------------------------------
# 蒙皮以后的网格（scripts/export_skin.py 导出来的）：不开 Blender 也能知道某个姿势下脚掌、肚子、下巴有没有到地面以下
_SKIN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "skin.npz")
if os.path.exists(_SKIN):
    _s = np.load(_SKIN); V0, VN, VB, VW = _s["co"], _s["normal"], _s["bones"], _s["weights"]
    VOFF = np.einsum("nkji,nkj->nki", SKEL.R[VB], V0[:, None, :] - SKEL.p[VB])           # 每个顶点在每根管它的骨骼的静止坐标里的位置 R^T·(v − p)


def bones_fk(mo):
    """-> 每帧每根骨骼的头部位置 P (T,n,3)、世界朝向 G (T,n,3,3)"""
    T = len(mo["theta"]); P = np.zeros((T, SKEL.n, 3)); G = np.zeros((T, SKEL.n, 3, 3))
    for f in range(T):
        P[f], G[f] = SKEL.fk(SKEL.local_rotations(mo["theta"][f], mo["A"][f]), mo["t"][f])
    return P, G


def skin_z(mo, sel=None):
    """蒙皮以后每个顶点的高度 (T,N)。sel: 只算哪些顶点。"""
    P, G = bones_fk(mo); sel = np.arange(len(V0)) if sel is None else sel; b, w, off = VB[sel], VW[sel], VOFF[sel]
    return np.einsum("nk,tnk->tn", w, P[:, b, 2] + np.einsum("tnkj,nkj->tnk", G[:, b, 2, :], off))


def _fps_pick(pts, n, seed=0):
    """最远点采样：从一堆点里挑 n 个铺得开的"""
    idx = [int(np.argmin(pts[:, 2]))]; d = np.linalg.norm(pts - pts[idx[0]], axis=1)
    for _ in range(min(n, len(pts)) - 1):
        k = int(np.argmax(d)); idx.append(k); d = np.minimum(d, np.linalg.norm(pts - pts[k], axis=1))
    return np.array(idx)


def floor_markers(n_feet=420, n_rest=520):
    """求解时看着“不许到地面以下”的顶点：四只脚的全挑得密一点，其余的只挑朝下的面（肚皮、下巴、腿的后侧、尾巴下缘）。"""
    role = np.array([SKEL.roles[b] or "" for b in range(SKEL.n)], dtype=object)
    def anc_role(b):
        while b >= 0:
            if SKEL.roles[b]: return SKEL.roles[b]
            b = SKEL.parent[b]
        return ""
    r = np.array([anc_role(int(b)) for b in VB[:, 0]])
    feet = np.where(np.isin(r, ["paw_f", "foot_h", "toe_h"]))[0]; rest = np.where(~np.isin(r, ["paw_f", "foot_h", "toe_h"]) & (VN[:, 2] < -0.15))[0]
    return np.concatenate([feet[_fps_pick(V0[feet], n_feet)], rest[_fps_pick(V0[rest], n_rest)]])


def resolve2(targets, fps, weight=None, init=None, floor=True, iters=None, lr=None, w_floor=200.0, w_acc=2e-3, w_vel=1e-4, w_prior=2e-4, w_limit=2.0, huber=0.03, floor_eps=0.001, quiet=False):
    """和 lib.resolve() 一样是“给目标位置、解姿势”，目标函数照 v2r/solver.py 的 solve() 写的（共用的求解器不能改，所以抄了一份），多两件事：
      · floor: 蒙皮以后的网格（floor_markers() 挑的那些顶点）不许到地面以下——原版只管脚上的几个关节点，脚掌一倾斜爪尖就戳进地里；趴下时肚子、肘也会陷。
      · init: 从一个已有的解出发做小修正（不给就和原版一样从静止姿势起步）。
    weight: 每个点的权重 (K,) 或 (T,K)。"""
    import torch
    from v2r import solver as so
    T = len(targets); ts = so.TorchSkeleton(SKEL); obs = sk.project(targets).transpose(1, 0, 2, 3)
    jw = np.array([SKEL.joint_weight.get(n, 1.0) for n in JN]); w = np.ones((T, 2, SKEL.K)) * jw[None, None]
    if weight is not None:
        weight = np.asarray(weight, dtype=float); w = w * (weight[None, None, :] if weight.ndim == 1 else weight[:, None, :])
    obs_t = torch.tensor(obs, dtype=torch.float32).permute(0, 2, 1, 3); w_t = torch.tensor(w, dtype=torch.float32).permute(0, 2, 1); scale = torch.tensor([sk.ORTHO_W, sk.ORTHO_H], dtype=torch.float32)
    if init is None:
        rest = SKEL.joint_rest; torso = [J(n) for n in SKEL.torso_joints]
        A0 = np.stack([so._kabsch(rest[torso], targets[i, torso], np.ones(len(torso))) for i in range(T)]); t0 = targets[:, J(SKEL.root_joint)] - rest[J(SKEL.root_joint)]; th0 = np.zeros((T, SKEL.D))
        iters = iters or 700; lr = lr or 0.03
    else:
        A0, t0, th0 = init["A"], init["t"], init["theta"]; iters = iters or 400; lr = lr or 0.008
    theta = torch.tensor(th0, dtype=torch.float32, requires_grad=True); delta = torch.zeros(T, 3, requires_grad=True); t = torch.tensor(t0, dtype=torch.float32, requires_grad=True); A0_t = torch.tensor(A0, dtype=torch.float32)
    opt = torch.optim.Adam([theta, delta, t], lr=lr); sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters, eta_min=lr * 0.05)
    if floor:
        mk = floor_markers(); mb = torch.tensor(VB[mk]); mw = torch.tensor(VW[mk], dtype=torch.float32); moff = torch.tensor(VOFF[mk], dtype=torch.float32)

        def marker_z(P, G):
            return (mw[None] * (P[:, mb, 2] + (G[:, mb, 2, :] * moff[None]).sum(-1))).sum(-1)      # (T,M)
    for it in range(iters):
        A = so.exp_rotvec(delta) @ A0_t; P, G, _ = ts.fk(theta, A, t); Pj = ts.joints(P, G); pred = ts.project(Pj)
        r = ((pred - obs_t) * scale).norm(dim=-1); hub = torch.where(r < huber, 0.5 * r ** 2, huber * (r - 0.5 * huber))
        l_data = (w_t * hub).sum() / w_t.sum().clamp_min(1e-6)
        l_limit = (torch.relu(theta - ts.hi) ** 2 + torch.relu(ts.lo - theta) ** 2).mean(); l_prior = (theta ** 2).mean()
        acc = theta[2:] - 2 * theta[1:-1] + theta[:-2]; accA = A[2:] - 2 * A[1:-1] + A[:-2]; acct = t[2:] - 2 * t[1:-1] + t[:-2]
        l_acc = (acc ** 2).mean() + (accA ** 2).mean() + 4 * (acct ** 2).mean(); l_vel = ((theta[1:] - theta[:-1]) ** 2).mean()
        loss = l_data + w_limit * l_limit + w_prior * l_prior + w_acc * l_acc + w_vel * l_vel
        if floor: loss = loss + w_floor * (torch.relu(floor_eps - marker_z(P, G)) ** 2).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    with torch.no_grad():
        A = so.exp_rotvec(delta) @ A0_t; th = torch.minimum(torch.maximum(theta, ts.lo), ts.hi); P, G, _ = ts.fk(th, A, t); Pj = ts.joints(P, G)
    out = {"theta": th.numpy().astype(float), "A": A.numpy().astype(float), "t": t.detach().numpy().astype(float), "fps": int(round(fps))}
    if not quiet:
        err = np.linalg.norm(Pj.numpy() - targets, axis=-1); fi, ki = np.unravel_index(err.argmax(), err.shape); z = skin_z(out)
        print(f"  重解: 和目标平均差 {err.mean() / SKEL.size_ref * 100:.2f}% 身长，最大 {err.max() / SKEL.size_ref * 100:.1f}%（{JN[ki]} 第 {fi} 帧）；网格最低点 {z.min():+.4f}（第 {int(z.min(1).argmin())} 帧）")
    return out


def ground_fix_mesh(mo, sigma=2.0):
    """整体上下挪，让蒙皮以后的网格最低点正好在地面上（沿时间磨过；磨完还陷着的帧单独抬）。返回挪之前最陷、最飘各多少。"""
    g = skin_z(mo).min(1); low = gauss(g, sigma) if sigma > 0 else g
    mo["t"][:, 2] -= low + np.minimum(g - low, 0)
    return float(g.min()), float(g.max())


def vert_parts():
    """每个顶点算哪个部位（按管它最多的那根骨骼往上找角色）：前左脚、前右脚、后左脚、后右脚、腿、头颈、尾巴、躯干"""
    def part(b):
        while b >= 0:
            r, s = SKEL.roles[b], SKEL.side[b]
            if r == "paw_f": return "前左脚" if s > 0 else "前右脚"
            if r in ("foot_h", "toe_h"): return "后左脚" if s > 0 else "后右脚"
            if r == "tail": return "尾巴"
            if r in ("head", "neck"): return "头颈"
            if r in ("upper_f", "lower_f", "scapula"): return "前左腿" if s > 0 else "前右腿"
            if r in ("upper_h", "lower_h", "hock"): return "后左腿" if s > 0 else "后右腿"
            b = SKEL.parent[b]
        return "躯干"
    return np.array([part(int(b)) for b in VB[:, 0]])


def part_lows(mo):
    """-> {部位: 每帧最低点 (T,)}"""
    z = skin_z(mo); parts = vert_parts(); return {n: z[:, parts == n].min(1) for n in sorted(set(parts))}


FORELEGS = [k for k, r in enumerate(SKEL.dof_role) if r in ("scapula", "upper_f", "lower_f", "paw_f")]


def damp(mo, dofs, a, b, keep=0.5, sigma=1.5, edge=4):
    """第 a 到 b 帧之间，把几个自由度围着它们这一段的平均值的摆动压小（留 keep 成），再沿时间磨一下；两头各 edge 帧过渡。
    （人立起来以后前蹄在空中快速扑腾，快放以后像抽搐，压成“收在胸前微微动”。）"""
    T = len(mo["theta"]); f = np.arange(T); w = smoothstep((f - (a - edge)) / edge) * smoothstep(((b + edge) - f) / edge)
    for k in dofs:
        x = mo["theta"][:, k]; m = x[a:b + 1].mean(); y = gauss(m + (x - m) * keep, sigma); mo["theta"][:, k] = x * (1 - w) + y * w
    return mo
