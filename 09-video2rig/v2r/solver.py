"""把两个机位读到的关节位置，解成骨架上每根骨骼的旋转（可微 FK + 优化）。

思路：不先求 3D 点再“贴”到骨架上，而是直接以关节角为未知数，骨长固定，
让骨架在两个机位里的投影去对齐读到的关节位置；同时加上活动范围、时间平滑和静止姿态先验。
"""
import math

import numpy as np
import torch

from . import skeleton as sk


def _skew(axis):
    x, y, z = axis
    return torch.tensor([[0, -z, y], [z, 0, -x], [-y, x, 0]], dtype=torch.float32)


def exp_rotvec(r):
    """(T,3) 旋转向量 -> (T,3,3)。"""
    ang = r.norm(dim=-1, keepdim=True).clamp_min(1e-8)
    k = r / ang
    K = torch.zeros(r.shape[0], 3, 3, dtype=r.dtype)
    K[:, 0, 1], K[:, 0, 2] = -k[:, 2], k[:, 1]
    K[:, 1, 0], K[:, 1, 2] = k[:, 2], -k[:, 0]
    K[:, 2, 0], K[:, 2, 1] = -k[:, 1], k[:, 0]
    s, c = torch.sin(ang)[..., None], torch.cos(ang)[..., None]
    return torch.eye(3, dtype=r.dtype)[None] + s * K + (1 - c) * (K @ K)


class TorchSkeleton:
    def __init__(self, skel):
        self.skel = skel
        f = lambda a: torch.tensor(np.asarray(a), dtype=torch.float32)  # noqa: E731
        self.R, self.Rrel, self.offset, self.p = f(skel.R), f(skel.Rrel), f(skel.offset), f(skel.p)
        self.lo, self.hi = f(skel.dof_lo), f(skel.dof_hi)
        self.bone_dofs = {}                                               # 骨骼 -> [(自由度序号, K, K², 增益)]
        for k, targets in enumerate(skel.dof_targets):
            for b, axis, gain in targets:
                K1 = _skew(axis)
                self.bone_dofs.setdefault(int(b), []).append((k, K1, K1 @ K1, float(gain)))
        self.joint_bone = torch.tensor(skel.joint_bone)
        self.joint_off = f(skel.joint_offset_local)

    def joints(self, P, G):
        """(T,n,3)、(T,n,3,3) -> 各跟踪关节的世界位置 (T,K,3)，含标记点偏移。"""
        jb = self.joint_bone
        return P[:, jb] + (G[:, jb] @ self.joint_off[None, :, :, None])[..., 0]

    def fk(self, theta, A_root, t):
        """theta (T,D)，A_root (T,3,3)，t (T,3) -> 骨骼头部位置 P (T,n,3)、世界朝向 G (T,n,3,3)、局部旋转 Q (T,n,3,3)。"""
        T = theta.shape[0]
        s = self.skel
        eye = torch.eye(3)[None].expand(T, 3, 3)
        G, P, Q = [None] * s.n, [None] * s.n, [None] * s.n
        for i in range(s.n):
            pa = int(s.parent[i])
            if i == s.root:
                Q[i] = self.R[i].T @ A_root @ self.R[i]
            elif i in self.bone_dofs:
                A = eye
                for k, K1, K2, gain in self.bone_dofs[i]:
                    ang = gain * theta[:, k, None, None]
                    A = A @ (eye + torch.sin(ang) * K1 + (1 - torch.cos(ang)) * K2)
                Q[i] = self.R[i].T @ A @ self.R[i]
            else:
                Q[i] = eye
            if pa < 0:
                G[i] = self.R[i] @ Q[i]
                P[i] = self.p[i] + t
            else:
                G[i] = G[pa] @ self.Rrel[i] @ Q[i]
                P[i] = P[pa] + (G[pa] @ self.offset[i])
        return torch.stack(P, 1), torch.stack(G, 1), torch.stack(Q, 1)

    @staticmethod
    def project(P):
        """世界坐标 (...,3) -> 两个机位的归一化坐标 (...,2,2)（倒数第二维是机位）。"""
        b = 0.5 - (P[..., 2] - sk.Z_CENTER) / sk.ORTHO_H
        front = torch.stack([0.5 + P[..., 0] / sk.ORTHO_W, b], -1)
        side = torch.stack([0.5 - P[..., 1] / sk.ORTHO_W, b], -1)
        return torch.stack([front, side], -2)


def _kabsch(src, dst, w):
    """求把 src 点集转到 dst 点集的最优旋转（带权）。src (N,3)，dst (N,3)。"""
    w = w / w.sum()
    a = src - (w[:, None] * src).sum(0)
    b = dst - (w[:, None] * dst).sum(0)
    H = (a * w[:, None]).T @ b
    U, _, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    return Vt.T @ np.diag([1, 1, d]) @ U.T


def solve(skel, obs, conf, iters=700, lr=0.03, w_acc=2e-3, w_vel=1e-4, w_prior=2e-4, w_limit=2.0,
          huber=0.03, conf_floor=0.15, joint_weight=None, ground=False, w_ground=5.0, verbose=True):
    """obs (T,2,K,2) 两个机位读到的归一化坐标；conf (T,2,K) 置信度。

    ground=True 时加一条约束：脚上的关节（skel.ground_joints）不能踩到地面以下（真实视频用；“考试”里的随机运动不保证脚在地上，所以不开）。
    返回 dict：theta (T,D)、A_root (T,3,3)、t (T,3)、joints (T,K,3)、quats (T,n,4)、loc (T,3)。
    """
    T, _, K, _ = obs.shape
    ts = TorchSkeleton(skel)
    obs_t = torch.tensor(obs, dtype=torch.float32).permute(0, 2, 1, 3)        # (T,K,2,2)
    w = np.clip((conf - conf_floor) / (1 - conf_floor), 0, 1) ** 2            # 低置信度的读数权重趋近 0
    if joint_weight is not None:
        w = w * np.asarray(joint_weight)[None, None, :]
    w_t = torch.tensor(w, dtype=torch.float32).permute(0, 2, 1)               # (T,K,2)
    scale = torch.tensor([sk.ORTHO_W, sk.ORTHO_H], dtype=torch.float32)

    # ---- 初值：根骨骼位移取骨盆读数；整体朝向用躯干几个关节做 Kabsch ----------------
    P3 = sk.unproject(obs[:, 0], obs[:, 1])                                   # (T,K,3)
    wk = np.sqrt(w[:, 0] * w[:, 1]) + 1e-4                                    # (T,K)
    rest = skel.joint_rest
    names = skel.joint_names
    torso = [names.index(n) for n in skel.torso_joints if n in names]     # 躯干上几乎不变形的几个点
    hips = names.index(skel.root_joint)                                    # 根骨骼头部那个关节
    A0 = np.zeros((T, 3, 3))
    for i in range(T):
        A0[i] = _kabsch(rest[torso], P3[i, torso], wk[i, torso])
    t0 = P3[:, hips] - rest[hips]
    # 骨盆读数不可靠的帧，用前后帧插值
    good = wk[:, hips] > 0.3
    if good.sum() >= 2 and not good.all():
        idx = np.arange(T)
        for c in range(3):
            t0[:, c] = np.interp(idx, idx[good], t0[good, c])

    foot_idx = [names.index(n) for n in skel.ground_joints if n in names]
    z_floor = torch.tensor(rest[foot_idx, 2] - 0.012, dtype=torch.float32)

    theta = torch.zeros(T, skel.D, requires_grad=True)
    delta = torch.zeros(T, 3, requires_grad=True)                             # 在 Kabsch 初值上的小修正
    t = torch.tensor(t0, dtype=torch.float32, requires_grad=True)
    A0_t = torch.tensor(A0, dtype=torch.float32)
    opt = torch.optim.Adam([theta, delta, t], lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters, eta_min=lr * 0.05)

    def root_rot():
        return exp_rotvec(delta) @ A0_t

    for it in range(iters):
        A = root_rot()
        P, G, _ = ts.fk(theta, A, t)
        Pj = ts.joints(P, G)
        pred = ts.project(Pj)                                                 # (T,K,2,2)
        r = ((pred - obs_t) * scale).norm(dim=-1)                             # 世界单位的重投影误差
        hub = torch.where(r < huber, 0.5 * r ** 2, huber * (r - 0.5 * huber))
        l_data = (w_t * hub).sum() / w_t.sum().clamp_min(1e-6)
        l_limit = (torch.relu(theta - ts.hi) ** 2 + torch.relu(ts.lo - theta) ** 2).mean()
        l_prior = (theta ** 2).mean()
        if T > 2:
            acc = theta[2:] - 2 * theta[1:-1] + theta[:-2]
            accA = A[2:] - 2 * A[1:-1] + A[:-2]
            acct = t[2:] - 2 * t[1:-1] + t[:-2]
            l_acc = (acc ** 2).mean() + (accA ** 2).mean() + 4 * (acct ** 2).mean()
            l_vel = ((theta[1:] - theta[:-1]) ** 2).mean()
        else:
            l_acc = l_vel = torch.zeros(())
        loss = l_data + w_limit * l_limit + w_prior * l_prior + w_acc * l_acc + w_vel * l_vel
        if ground:
            zj = Pj[:, foot_idx, 2]
            loss = loss + w_ground * (torch.relu(z_floor - zj) ** 2).mean()
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if verbose and (it % 100 == 0 or it == iters - 1):
            print(f"  solve it {it:4d} loss {loss.item():.6f} data {l_data.item():.6f} "
                  f"rms_reproj {math.sqrt(((w_t * r ** 2).sum() / w_t.sum()).item()):.4f} acc {l_acc.item():.5f}", flush=True)

    with torch.no_grad():
        A = root_rot()
        th = torch.minimum(torch.maximum(theta, ts.lo), ts.hi)
        P, G, Q = ts.fk(th, A, t)
        Pj = ts.joints(P, G)
    Qn = Q.numpy().astype(np.float64)
    quats = np.zeros((T, skel.n, 4))
    for i in range(T):
        for b in range(skel.n):
            quats[i, b] = sk.mat_to_quat(Qn[i, b])
    quats = continuous_quats(quats)
    loc = (skel.R[skel.root].T @ t.detach().numpy().T).T / skel.scale
    return {
        "theta": th.numpy(), "A_root": A.numpy(), "t": t.detach().numpy(),
        "joints": Pj.numpy(), "bone_world": G.numpy(),
        "quats": quats, "loc": loc,
    }


def continuous_quats(quats):
    """让每根骨骼的四元数在相邻帧之间不翻号（q 和 -q 是同一个旋转，但插值会乱）。"""
    q = quats.copy()
    for i in range(1, q.shape[0]):
        flip = np.sum(q[i] * q[i - 1], axis=-1) < 0
        q[i, flip] *= -1
    return q


def motion_from_params(skel, theta, ypr, t):
    """已知每帧的关节角（“考试”用的标准答案）-> 和 solve() 同格式的结果。"""
    T = theta.shape[0]
    quats = np.zeros((T, skel.n, 4))
    joints = np.zeros((T, skel.K, 3))
    G_all = np.zeros((T, skel.n, 3, 3))
    for i in range(T):
        A = sk.euler_root(*ypr[i])
        Q = skel.local_rotations(theta[i], A)
        P, G = skel.fk(Q, t[i])
        joints[i], G_all[i] = skel.joint_positions(P, G), G
        quats[i], _ = skel.blender_pose(Q, t[i])
    loc = (skel.R[skel.root].T @ t.T).T / skel.scale
    return {"theta": theta, "ypr": ypr, "t": t, "joints": joints, "bone_world": G_all,
            "quats": continuous_quats(quats), "loc": loc}
