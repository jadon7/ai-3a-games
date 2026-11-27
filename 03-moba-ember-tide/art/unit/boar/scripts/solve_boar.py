#!/usr/bin/env python3
"""野猪用的（照鹿的 art/hero/osen_stag/scripts/solve_stag.py 改的，只换了名字）“读数 → 求解”：在共用的 tools/solve_only.py 基础上，求解之前先把读数整理两遍。

为什么要另写：侧面机位里，远侧（左边）的腿常常整条被近侧的腿挡住，网络给的位置是瞎猜的、置信度很低，
求解器基本不理它，这条腿前后摆到哪就没人管了——解出来左前腿会突然甩到后腿那儿去（R 的下蹲、E 的低头都中招）。
还有个别帧网络把左右腿认反，腿抽一下。

三遍整理：
  1. 时间上的野点：某个点某一帧离前后几帧的中位数很远、而前后几帧自己很稳，这一帧的读数作废（置信度清零，交给前后帧）。
  2. 两个机位给同一个点的高度差得远（正交相机下高度应该一样）：置信度明显低的那一边作废。
  3. 侧面机位里被挡住的腿：远侧关节置信度低、近侧同名关节置信度高时，认为“它就藏在近侧那条腿后面”——
     前后位置借近侧那条腿的，高度用它自己在正面机位里的读数。置信度在 0.4~0.55 之间时两者按比例混，避免一帧一跳。
用法: cd video2rig && .venv/bin/python <本脚本> <tag>[=视频] ...   已经读过的（有 out/anim/boar_<tag>/detections.npz）不用再给视频
产出: out/anim/boar_<tag>/motion_fix.npz、check_fix.json（回投偏差仍然对着网络原始读数算，和 solve_only 的数字可比）"""
import contextlib, importlib.util, io, json, os, sys, time
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk
NAME = "boar"; skel = pl.load_skel(NAME); JN = skel.joint_names; K = skel.K
WORLD = np.array([sk.ORTHO_W, sk.ORTHO_H])
PAIRS = [(JN.index("Left" + j), JN.index("Right" + j)) for j in ("FElbow", "FWrist", "FFetlock", "FToe", "HKnee", "HHock", "HAnkle", "HToeTip")]


def tidy(obs, conf):
    obs, conf = obs.copy(), conf.copy(); T = len(obs); stat = {"野点": 0, "借近侧腿（帧·关节）": 0.0}
    # 1) 时间上的野点
    pad = np.concatenate([np.repeat(obs[:1], 2, 0), obs, np.repeat(obs[-1:], 2, 0)])
    win = np.stack([pad[i:i + T] for i in range(5)])                         # (5,T,2,K,2)
    med = np.median(win, 0); dev = np.linalg.norm((obs - med) * WORLD, axis=-1)
    spread = np.median(np.linalg.norm((win - med[None]) * WORLD, axis=-1), 0)
    spike = (dev > 0.07) & (spread < 0.025)
    conf[spike] = 0.0; stat["野点"] = int(spike.sum())
    # 2) 两个机位对同一个点给出的高度差得远：至少有一边认错了，置信度明显低的那边作废（差不多就两边都减半）
    zf = sk.Z_CENTER - (obs[:, 0, :, 1] - 0.5) * sk.ORTHO_H; zs = sk.Z_CENTER - (obs[:, 1, :, 1] - 0.5) * sk.ORTHO_H
    clash = (np.abs(zf - zs) > 0.07) & (conf[:, 0] > 0.15) & (conf[:, 1] > 0.15); lower = np.argmin(conf, axis=1)      # (T,K) 哪个机位置信度低
    clear = np.abs(conf[:, 0] - conf[:, 1]) > 0.2
    for v in range(2):
        conf[:, v][clash & clear & (lower == v)] = 0.0
        conf[:, v][clash & ~clear] *= 0.5
    stat["两机位高度对不上"] = int(clash.sum())
    # 3) 侧面机位里被挡住的腿。蹄尖或者球节被挡住时，这条腿肘以下多半整段都在近侧那条腿后面，腕也一起借
    o0, c0 = obs.copy(), conf.copy()
    hide = lambda far, near: np.clip((0.55 - c0[:, 1, far]) / 0.15, 0, 1) * np.clip((c0[:, 1, near] - 0.5) / 0.2, 0, 1)
    LEGS = [[JN.index(s + j) for j in js] for s in ("Left", "Right") for js in (("FToe", "FFetlock", "FWrist", "FElbow"), ("HToeTip", "HAnkle", "HHock", "HKnee"))]
    mirror = {JN.index(a + j): JN.index(b + j) for a, b in (("Left", "Right"), ("Right", "Left")) for j in ("FToe", "FFetlock", "FWrist", "FElbow", "HToeTip", "HAnkle", "HHock", "HKnee")}
    for leg in LEGS:
        w_each = [hide(far, mirror[far]) for far in leg]; w_distal = np.maximum(w_each[0], w_each[1])
        for n_, far in enumerate(leg):
            near = mirror[far]; w = np.maximum(w_each[n_], w_distal * np.clip((c0[:, 1, near] - 0.5) / 0.2, 0, 1)) if n_ < 3 else w_each[n_]
            h_own = np.where(c0[:, 0, far] > 0.5, o0[:, 0, far, 1], o0[:, 1, near, 1])      # 高度：自己在正面机位里的读数；正面也看不清就连高度一起借
            sub = np.stack([o0[:, 1, near, 0], h_own], -1)
            obs[:, 1, far] = (1 - w[:, None]) * o0[:, 1, far] + w[:, None] * sub
            conf[:, 1, far] = np.maximum(c0[:, 1, far] * (1 - w), w * 0.6)
            stat["借近侧腿（帧·关节）"] += float(w.sum())
    stat["借近侧腿（帧·关节）"] = round(stat["借近侧腿（帧·关节）"], 1)
    return obs, conf, stat


def solve_anneal(skel, obs, conf, joint_weight, iters=900, lr=0.03, w_acc=2e-3, w_vel=1e-4, w_prior=2e-4, w_limit=2.0, huber0=0.25, huber1=0.03, conf_floor=0.15, w_ground=5.0):
    """和 v2r/solver.py 的 solve() 是同一个目标函数、同一套权重，只多一件事：稳健损失的门槛（huber）从宽到窄慢慢收。
    原版从头到尾用 0.03：离读数很远的解受到的拉力很小，一条腿一旦掉进“前后摆反了、但正面看高度都对”的坑里就爬不出来
    （R 下蹲那几帧左前腿就是这样）。开头把门槛放宽到 0.25，远处的读数也有力气把腿拉回来；前四成迭代里收回 0.03，后面和原版一样精修。
    共用的求解器不能改，所以在这里照着写了一份。"""
    import torch
    from v2r import solver as so
    T = obs.shape[0]; ts = so.TorchSkeleton(skel)
    obs_t = torch.tensor(obs, dtype=torch.float32).permute(0, 2, 1, 3)
    w = np.clip((conf - conf_floor) / (1 - conf_floor), 0, 1) ** 2 * np.asarray(joint_weight)[None, None, :]
    w_t = torch.tensor(w, dtype=torch.float32).permute(0, 2, 1); scale = torch.tensor([sk.ORTHO_W, sk.ORTHO_H], dtype=torch.float32)
    P3 = sk.unproject(obs[:, 0], obs[:, 1]); wk = np.sqrt(w[:, 0] * w[:, 1]) + 1e-4; rest = skel.joint_rest; names = skel.joint_names
    torso = [names.index(n) for n in skel.torso_joints if n in names]; hips = names.index(skel.root_joint)
    A0 = np.stack([so._kabsch(rest[torso], P3[i, torso], wk[i, torso]) for i in range(T)]); t0 = P3[:, hips] - rest[hips]
    good = wk[:, hips] > 0.3
    if good.sum() >= 2 and not good.all():
        idx = np.arange(T)
        for c in range(3): t0[:, c] = np.interp(idx, idx[good], t0[good, c])
    foot_idx = [names.index(n) for n in skel.ground_joints if n in names]; z_floor = torch.tensor(rest[foot_idx, 2] - 0.012, dtype=torch.float32)
    theta = torch.zeros(T, skel.D, requires_grad=True); delta = torch.zeros(T, 3, requires_grad=True); t = torch.tensor(t0, dtype=torch.float32, requires_grad=True); A0_t = torch.tensor(A0, dtype=torch.float32)
    opt = torch.optim.Adam([theta, delta, t], lr=lr); sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters, eta_min=lr * 0.05)
    for it in range(iters):
        huber = huber1 + (huber0 - huber1) * max(0.0, 1 - it / (0.4 * iters))
        A = so.exp_rotvec(delta) @ A0_t; P, G, _ = ts.fk(theta, A, t); Pj = ts.joints(P, G); pred = ts.project(Pj)
        r = ((pred - obs_t) * scale).norm(dim=-1); hub = torch.where(r < huber, 0.5 * r ** 2, huber * (r - 0.5 * huber)) * (huber1 / huber)      # 乘上这个比例：门槛放宽时小残差的权重不跟着变大
        l_data = (w_t * hub).sum() / w_t.sum().clamp_min(1e-6) * (huber / huber1)
        l_limit = (torch.relu(theta - ts.hi) ** 2 + torch.relu(ts.lo - theta) ** 2).mean(); l_prior = (theta ** 2).mean()
        acc = theta[2:] - 2 * theta[1:-1] + theta[:-2]; accA = A[2:] - 2 * A[1:-1] + A[:-2]; acct = t[2:] - 2 * t[1:-1] + t[:-2]
        l_acc = (acc ** 2).mean() + (accA ** 2).mean() + 4 * (acct ** 2).mean(); l_vel = ((theta[1:] - theta[:-1]) ** 2).mean()
        loss = l_data + w_limit * l_limit + w_prior * l_prior + w_acc * l_acc + w_vel * l_vel + w_ground * (torch.relu(z_floor - Pj[:, foot_idx, 2]) ** 2).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    with torch.no_grad():
        A = so.exp_rotvec(delta) @ A0_t; th = torch.minimum(torch.maximum(theta, ts.lo), ts.hi); P, G, Q = ts.fk(th, A, t); Pj = ts.joints(P, G)
    Qn = Q.numpy().astype(np.float64); quats = np.zeros((T, skel.n, 4))
    for i in range(T):
        for b in range(skel.n): quats[i, b] = sk.mat_to_quat(Qn[i, b])
    return {"theta": th.numpy(), "A_root": A.numpy(), "t": t.detach().numpy(), "joints": Pj.numpy(), "bone_world": G.numpy(), "quats": so.continuous_quats(quats),
            "loc": (skel.R[skel.root].T @ t.detach().numpy().T).T / skel.scale}


for pair in sys.argv[1:]:
    tag, _, video = pair.partition("="); d = os.path.join(V, "out", "anim", f"{NAME}_{tag}"); os.makedirs(d, exist_ok=True); t0 = time.time()
    det = os.path.join(d, "detections.npz")
    if video or not os.path.exists(det):
        frames, fps, obs, conf, check = pl.read_stage(NAME, video, d, skel)
    else:
        z = np.load(det); obs, conf, fps = z["obs"], z["conf"], float(z["fps"]); check = json.load(open(os.path.join(d, "check.json")))
    obs2, conf2, stat = tidy(obs, conf)
    res = solve_anneal(skel, obs2, conf2, np.array([skel.joint_weight.get(n, 1.0) for n in skel.joint_names]))
    pl.save_motion(os.path.join(d, "motion_fix.npz"), res, fps)
    r = np.linalg.norm((sk.project(res["joints"]).transpose(1, 0, 2, 3) - obs) * WORLD, axis=-1)
    check = {**check, "reproj_pct_fix": float(np.average(r, weights=np.clip(conf, 1e-3, 1)) / skel.size_ref * 100), "tidy": stat}
    json.dump(check, open(os.path.join(d, "check_fix.json"), "w"), ensure_ascii=False, indent=1)
    print(tag, f"回投偏差 {check.get('reproj_pct', float('nan')):.2f}% → {check['reproj_pct_fix']:.2f}%  整理: {json.dumps(stat, ensure_ascii=False)}  用时 {time.time() - t0:.0f}s", flush=True)
