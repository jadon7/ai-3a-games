#!/usr/bin/env python3
"""巨蟾专用的“读数 → 求解”。在共用的 tools/solve_only.py 基础上多做四件事（共用的求解器不能改，所以照着 v2r/solver.py 和鹿的 solve_stag.py 写了一份）：

  1. 读数先清一遍：时间上的野点（某一帧突然跳走、前后帧自己很稳）作废；两个机位给同一个点的高度差得远时，置信度明显低的那边作废。
  2. 稳健损失的门槛从宽收到窄（鹿的办法）：腿一开始离读数很远时也有力气被拉回来，不会卡在“前后摆反了”的坑里。
  3. 肚皮、下巴不许低于地面（floor）：巨蟾蓄力、砸地、死亡都是肚皮贴地，共用的求解器只管脚，身体会被解到地面以下。
  4. 左右对称的先验（sym）：巨蟾又宽又扁，左边两条腿在侧面机位里被身体挡住、左后腿在正面机位里也被前腿挡住，读数是网络猜的。
     普攻、重击、死亡本来就是左右对称的动作，所以让“看不清的那条腿”向“看得清的那条腿”的镜像靠拢；读数清楚的地方数据项自己会压过它。
     走路不对称（左右腿差半拍），run 不开这一项，改成 lag：左腿向“右腿半个周期以前的镜像”靠拢（周期从右腿的读数里量）。

  5. 侧面机位里左腿（远侧）肘、膝以下的读数，置信度不到 0.55 的一律不用：站着不动的时候它们整条被身体挡住，网络给的是“随机姿势里的平均位置”，
     偏高一两成身长、还会前后漂（待机里左边两只脚因此在原地前后滑 4% 身长）。走路时这几个点露出来，置信度 0.8 以上，照常用。
  6. 脚踩实的先验（plant）：踩在地上的脚（脚尖、腕、踝的高度接近站立高度）相邻两帧在地面上不该挪动。原地的动作开，走路（跑步机）不开。

用法: cd video2rig && .venv/bin/python <本脚本> <tag>[=视频] [sym=权重] [plant=权重] [lag=帧数] [floor=0|1] [out=motion_fix.npz] ...
  已经读过的（有 out/anim/toad_<tag>/detections.npz）不用再给视频。选项跟在某个 tag 后面，只对它前面最近的那个 tag 生效。
产出: out/anim/toad_<tag>/motion_fix.npz、check_fix.json（回投偏差对着网络原始读数算，和 solve_only 的数字可比）
"""
import contextlib, importlib.util, io, json, os, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk  # noqa: E402
from toadlib import skel, JN, J, leg_dofs, MIRROR_SIGN, PAIRS, LEG_JOINTS  # noqa: E402
NAME = "toad"; WORLD = np.array([sk.ORTHO_W, sk.ORTHO_H])
FLOOR = {"Belly": 0.0, "Chin": 0.0, "Rump": 0.01, "SideL": 0.02, "SideR": 0.02, "Nose": 0.02,
         "LeftFElbow": 0.03, "RightFElbow": 0.03, "LeftHKnee": 0.03, "RightHKnee": 0.03}      # 这些点不许低于这个高度（摆正后的单位）


def tidy(obs, conf):
    obs, conf = obs.copy(), conf.copy(); T = len(obs); stat = {}
    pad = np.concatenate([np.repeat(obs[:1], 2, 0), obs, np.repeat(obs[-1:], 2, 0)])
    win = np.stack([pad[i:i + T] for i in range(5)]); med = np.median(win, 0); dev = np.linalg.norm((obs - med) * WORLD, axis=-1)
    spread = np.median(np.linalg.norm((win - med[None]) * WORLD, axis=-1), 0)
    spike = (dev > 0.07) & (spread < 0.025); conf[spike] = 0.0; stat["野点"] = int(spike.sum())
    zf = sk.Z_CENTER - (obs[:, 0, :, 1] - 0.5) * sk.ORTHO_H; zs = sk.Z_CENTER - (obs[:, 1, :, 1] - 0.5) * sk.ORTHO_H
    clash = (np.abs(zf - zs) > 0.07) & (conf[:, 0] > 0.15) & (conf[:, 1] > 0.15); lower = np.argmin(conf, axis=1); clear = np.abs(conf[:, 0] - conf[:, 1]) > 0.2
    for v in range(2):
        conf[:, v][clash & clear & (lower == v)] = 0.0
        conf[:, v][clash & ~clear] *= 0.5
    stat["两机位高度对不上"] = int(clash.sum())
    far = [J[n] for leg in ("LF", "LH") for n in LEG_JOINTS[leg][1:]]; c = conf[:, 1, far]; g = np.clip((c - 0.55) / 0.25, 0, 1)
    stat["侧面左腿读数作废（帧·点）"] = int((g < 0.5).sum()); conf[:, 1, far] = c * g
    return obs, conf, stat


def solve(skel, obs, conf, joint_weight, iters=900, lr=0.03, w_acc=2e-3, w_vel=1e-4, w_prior=2e-4, w_limit=2.0, huber0=0.25, huber1=0.03, conf_floor=0.15, w_ground=5.0,
          floor=True, w_floor=8.0, sym=0.0, lag=0, w_lag=0.0, plant=0.0, theta0=None):
    import torch
    from v2r import solver as so
    T = obs.shape[0]; ts = so.TorchSkeleton(skel)
    obs_t = torch.tensor(obs, dtype=torch.float32).permute(0, 2, 1, 3)
    w = np.clip((conf - conf_floor) / (1 - conf_floor), 0, 1) ** 2 * np.asarray(joint_weight)[None, None, :]
    w_t = torch.tensor(w, dtype=torch.float32).permute(0, 2, 1); scale = torch.tensor(WORLD, dtype=torch.float32)
    P3 = sk.unproject(obs[:, 0], obs[:, 1]); wk = np.sqrt(w[:, 0] * w[:, 1]) + 1e-4; rest = skel.joint_rest
    torso = [J[n] for n in skel.torso_joints]; hips = J[skel.root_joint]
    A0 = np.stack([so._kabsch(rest[torso], P3[i, torso], wk[i, torso]) for i in range(T)]); t0 = P3[:, hips] - rest[hips]
    good = wk[:, hips] > 0.3
    if good.sum() >= 2 and not good.all():
        idx = np.arange(T)
        for c in range(3): t0[:, c] = np.interp(idx, idx[good], t0[good, c])
    foot_idx = [J[n] for n in skel.ground_joints]; z_floor = torch.tensor(rest[foot_idx, 2] - 0.012, dtype=torch.float32)
    fl_idx = [J[n] for n in FLOOR]; fl_z = torch.tensor([FLOOR[n] for n in FLOOR], dtype=torch.float32)
    theta = torch.tensor(theta0 if theta0 is not None else np.zeros((T, skel.D)), dtype=torch.float32, requires_grad=True)
    delta = torch.zeros(T, 3, requires_grad=True); t = torch.tensor(t0, dtype=torch.float32, requires_grad=True); A0_t = torch.tensor(A0, dtype=torch.float32)
    opt = torch.optim.Adam([theta, delta, t], lr=lr); sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters, eta_min=lr * 0.05)
    pair_idx = [(torch.tensor(leg_dofs(a)), torch.tensor(leg_dofs(b))) for a, b in PAIRS]; sgn = torch.tensor(MIRROR_SIGN, dtype=torch.float32)
    # 每条腿“看得清的程度”：这条腿肘（膝）以下三个点在两个机位里的平均权重。对称先验只拉看不清的那条腿
    vis = {leg: torch.tensor(w[:, :, [J[n] for n in LEG_JOINTS[leg][1:]]].mean((1, 2)), dtype=torch.float32) for leg in LEG_JOINTS}
    for it in range(iters):
        huber = huber1 + (huber0 - huber1) * max(0.0, 1 - it / (0.4 * iters))
        A = so.exp_rotvec(delta) @ A0_t; P, G, _ = ts.fk(theta, A, t); Pj = ts.joints(P, G); pred = ts.project(Pj)
        r = ((pred - obs_t) * scale).norm(dim=-1); hub = torch.where(r < huber, 0.5 * r ** 2, huber * (r - 0.5 * huber)) * (huber1 / huber)
        l_data = (w_t * hub).sum() / w_t.sum().clamp_min(1e-6) * (huber / huber1)
        l_limit = (torch.relu(theta - ts.hi) ** 2 + torch.relu(ts.lo - theta) ** 2).mean(); l_prior = (theta ** 2).mean()
        acc = theta[2:] - 2 * theta[1:-1] + theta[:-2]; accA = A[2:] - 2 * A[1:-1] + A[:-2]; acct = t[2:] - 2 * t[1:-1] + t[:-2]
        l_acc = (acc ** 2).mean() + (accA ** 2).mean() + 4 * (acct ** 2).mean(); l_vel = ((theta[1:] - theta[:-1]) ** 2).mean()
        loss = l_data + w_limit * l_limit + w_prior * l_prior + w_acc * l_acc + w_vel * l_vel + w_ground * (torch.relu(z_floor - Pj[:, foot_idx, 2]) ** 2).mean()
        if floor: loss = loss + w_floor * (torch.relu(fl_z - Pj[:, fl_idx, 2]) ** 2).mean()
        if plant > 0:
            pf = Pj[:, foot_idx]; up = torch.relu(pf[..., 2] - (z_floor + 0.012)).detach(); on = torch.exp(-(up / 0.02) ** 2); g = on[1:] * on[:-1]      # 相邻两帧都贴着地才算踩实
            loss = loss + plant * (g * ((pf[1:, :, :2] - pf[:-1, :, :2]) ** 2).sum(-1)).mean()
            upg = torch.relu(pf[..., 2] - (z_floor + 0.012)); loss = loss + 0.02 * plant * (upg ** 2 * torch.exp(-(upg / 0.04) ** 2).detach()).mean()      # 没有读数撑着的时候脚不要自己抬起来一点点（不然抬一下脚就躲过了上面那一项）；真的抬高了（跳起来）不管
        if sym > 0:
            for (la, lb), (ia, ib) in zip(PAIRS, pair_idx):
                d = theta[:, ia] - sgn * theta[:, ib]; va, vb = vis[la], vis[lb]; wa = (vb / (va + vb + 1e-4))[:, None]      # 左腿看不清（va 小）→ wa 大 → 主要是左腿去就右腿
                loss = loss + sym * ((wa * (theta[:, ia] - (sgn * theta[:, ib]).detach())) ** 2 + ((1 - wa) * (theta[:, ib] - (sgn * theta[:, ia]).detach())) ** 2).mean()
        if w_lag > 0 and lag > 0:
            for (la, lb), (ia, ib) in zip(PAIRS, pair_idx):      # 左腿（看不清）≈ 右腿 lag 帧以前的镜像；两头用循环以外的帧就近凑
                src = (sgn * theta[:, ib]).detach(); idx = torch.arange(T); prev = src[(idx - lag).clamp(min=0)]; nxt = src[(idx + lag).clamp(max=T - 1)]
                ref = torch.where((idx >= lag)[:, None], prev, nxt)
                loss = loss + w_lag * ((theta[:, ia] - ref) ** 2).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    with torch.no_grad():
        A = so.exp_rotvec(delta) @ A0_t; th = torch.minimum(torch.maximum(theta, ts.lo), ts.hi); P, G, Q = ts.fk(th, A, t); Pj = ts.joints(P, G)
    Qn = Q.numpy().astype(np.float64); quats = np.zeros((T, skel.n, 4))
    for i in range(T):
        for b in range(skel.n): quats[i, b] = sk.mat_to_quat(Qn[i, b])
    return {"theta": th.numpy(), "A_root": A.numpy(), "t": t.detach().numpy(), "joints": Pj.numpy(), "bone_world": G.numpy(), "quats": so.continuous_quats(quats),
            "loc": (skel.R[skel.root].T @ t.detach().numpy().T).T / skel.scale}


if __name__ == "__main__":
    jobs = []
    for a in sys.argv[1:]:
        k, _, v = a.partition("=")
        if k in ("sym", "lag", "floor", "out", "wlag", "iters", "plant"): jobs[-1][2][k] = v
        else: jobs.append([k, v, {}])
    for tag, video, o in jobs:
        d = os.path.join(V, "out", "anim", f"{NAME}_{tag}"); os.makedirs(d, exist_ok=True); t0 = time.time(); det = os.path.join(d, "detections.npz")
        if video or not os.path.exists(det):
            frames, fps, obs, conf, check = pl.read_stage(NAME, video, d, skel)
            json.dump(check, open(os.path.join(d, "check.json"), "w"), ensure_ascii=False, indent=1)
        else:
            z = np.load(det); obs, conf, fps = z["obs"], z["conf"], float(z["fps"]); check = json.load(open(os.path.join(d, "check.json")))
        obs2, conf2, stat = tidy(obs, conf)
        res = solve(skel, obs2, conf2, np.array([skel.joint_weight.get(n, 1.0) for n in JN]), iters=int(o.get("iters", 900)), floor=o.get("floor", "1") != "0",
                    sym=float(o.get("sym", 0)), lag=int(o.get("lag", 0)), w_lag=float(o.get("wlag", 0)), plant=float(o.get("plant", 0)))
        out = o.get("out", "motion_fix.npz"); pl.save_motion(os.path.join(d, out), res, fps)
        r = np.linalg.norm((sk.project(res["joints"]).transpose(1, 0, 2, 3) - obs) * WORLD, axis=-1)
        check = {**check, "reproj_pct_fix": float(np.average(r, weights=np.clip(conf, 1e-3, 1)) / skel.size_ref * 100), "tidy": stat, "opts": o}
        json.dump(check, open(os.path.join(d, "check_fix.json" if out == "motion_fix.npz" else out.replace(".npz", "_check.json")), "w"), ensure_ascii=False, indent=1)
        print(tag, f"置信度 {check['mean_conf']:.2f} 低置信 {check['low_conf_ratio'] * 100:.1f}% 两机位对不上的帧 {check['frames_inconsistent']} 回投偏差 {check.get('reproj_pct', float('nan')):.2f}% → {check['reproj_pct_fix']:.2f}%  整理: {json.dumps(stat, ensure_ascii=False)} 选项: {o}  用时 {time.time() - t0:.0f}s", flush=True)
