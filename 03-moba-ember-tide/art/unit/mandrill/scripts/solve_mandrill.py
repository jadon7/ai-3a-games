#!/usr/bin/env python3
"""山魈自己用的求解：读数先清一遍，再交给管线的求解器（目标函数不变，只是可以给初值、多迭代几步）。不改 video2rig 的代码。

为什么要有：侧面机位从角色右边拍，山魈身子厚、手臂长，左臂左腿经常整条被身体挡住，网络只能猜，猜出来的高度和正面机位差一大截
（普攻举臂那一段，左手正面读 1.05、侧面读 0.55）。管线的求解器两边都信一点，左臂就被扯到身后去了。
清理的办法（按顺序）：
  1. --legs a-b[,…] / --arms a-b[,…]   这些帧里侧面机位的左右腿 / 左右臂如果认反了就换回来（动态规划，照 art/hero/osen/resolve.py 的做法）。
     跑步时侧面看过去左右是对称的（差半个步子），网络会整段整段地把左右认成反的。
  2. 两机位高度对不上的读数（差超过 --tol，默认 0.07，模型高 0.82）：置信度低的那一边作废；差不多的话，左侧肢体作废侧面的（它是被挡的那一边）。
  3. --mirror-arms a-b[,…]   双臂一起动的帧段（普攻）：左臂在侧面机位的前后位置借右臂的，高度用正面机位自己的。
  4. --mirror-legs a-b[,…]   同上，对腿（双脚并排站着不动的段落）。
  5. --kneel a-b[,…]   跪、深蹲的帧段：膝和髋从屈着开始解（求解器从静止姿势起步，深跪时会卡在“腿伸直往后蹬”）。

用法: V2R/.venv/bin/python solve_mandrill.py <标签> [--out 输出标签=<标签>_fix] [--legs …] [--arms …] [--mirror-arms …] [--mirror-legs …] [--kneel …] [--tol 0.07] [--iters 900]
读 V2R/out/anim/mandrill_<标签>/detections.npz（管线读的原始读数，不改它），写 V2R/out/anim/mandrill_<输出标签>/{detections.npz（清过的）, motion.npz, check.json}。
"""
import importlib.util, json, math, os, sys
import numpy as np
import torch
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk, solver as S  # noqa: E402

argv = sys.argv[1:]; tag = argv[0]; opt = {}; i = 1
while i < len(argv): opt[argv[i]] = argv[i + 1]; i += 2
out_tag = opt.get("--out", tag + "_fix"); tol = float(opt.get("--tol", 0.07)); iters = int(opt.get("--iters", 900))
spans = lambda key: [tuple(int(v) for v in s.split("-")) for s in opt[key].split(",")] if key in opt else []  # noqa: E731
skel = pl.load_skel("mandrill"); jn = list(skel.joint_names); src = os.path.join(V, "out/anim", "mandrill_" + tag); dst = os.path.join(V, "out/anim", "mandrill_" + out_tag); os.makedirs(dst, exist_ok=True)
det = np.load(os.path.join(src, "detections.npz")); obs = det["obs"].copy(); conf = det["conf"].copy(); fps = float(det["fps"]); T = len(obs)
obs_raw, conf_raw = obs.copy(), conf.copy(); log = {}
LEG = ("UpLeg", "Leg", "Foot", "ToeBase", "Toe_End"); ARM = ("ForeArm", "Hand", "HandMiddle1", "HandMiddle4", "HandThumb4")
WH = np.array([sk.ORTHO_W, sk.ORTHO_H])

# 1. 侧面机位左右肢对调（腿、手臂各自判断）
ARM_ALL = ("Arm", "ForeArm", "Hand", "HandMiddle1", "HandMiddle4", "HandThumb4")
for key, KEY, ALL, name in (("--legs", ("Leg", "Foot", "Toe_End"), LEG, "腿"), ("--arms", ("ForeArm", "Hand", "HandMiddle1"), ARM_ALL, "臂")):
    for a_, b_ in spans(key):
        li = [jn.index("Left" + k) for k in KEY]; ri = [jn.index("Right" + k) for k in KEY]; b_ = min(b_, T - 1); n = b_ - a_ + 1
        def side(f, st):
            L_, R_ = obs[f, 1, li] * WH, obs[f, 1, ri] * WH; return (R_, L_) if st else (L_, R_)
        def unary(f, st):
            L_, R_ = side(f, st); hl, hr = obs[f, 0, li, 1] * sk.ORTHO_H, obs[f, 0, ri, 1] * sk.ORTHO_H; return float(np.abs(L_[:, 1] - hl).sum() + np.abs(R_[:, 1] - hr).sum())
        def pair(f, s0, s1):
            L0, R0 = side(f - 1, s0); L1, R1 = side(f, s1); return float(np.linalg.norm(L1 - L0, axis=1).sum() + np.linalg.norm(R1 - R0, axis=1).sum())
        cost = np.zeros((n, 2)); back = np.zeros((n, 2), dtype=int); cost[0] = [unary(a_, 0), unary(a_, 1)]
        for k in range(1, n):
            for s1 in (0, 1):
                c = [cost[k - 1, s0] + 0.6 * pair(a_ + k, s0, s1) for s0 in (0, 1)]; back[k, s1] = int(np.argmin(c)); cost[k, s1] = min(c) + unary(a_ + k, s1)
        st = np.zeros(n, dtype=int); st[-1] = int(np.argmin(cost[-1]))
        for k in range(n - 1, 0, -1): st[k - 1] = back[k, st[k]]
        for k in np.where(st == 1)[0]:
            f = a_ + int(k)
            for suf in ALL:
                l_, r_ = jn.index("Left" + suf), jn.index("Right" + suf); obs[f, 1, [l_, r_]] = obs[f, 1, [r_, l_]]; conf[f, 1, [l_, r_]] = conf[f, 1, [r_, l_]]
        log[key[2:] + "_swapped"] = int(st.sum()); print(f"侧面机位左右{name}对调: 第 {a_} 到 {b_} 帧里有 {int(st.sum())} 帧 -> " + "".join(str(v) for v in st))

# 2. 两机位高度对不上的读数：作废不可信的那一边
dz = np.abs(obs[:, 0, :, 1] - obs[:, 1, :, 1]) * sk.ORTHO_H; bad = (dz > tol) & (conf[:, 0] > 0.15) & (conf[:, 1] > 0.15); nf = ns = 0
for f, k in zip(*np.where(bad)):
    cf, cs = conf[f, 0, k], conf[f, 1, k]
    if cs < cf - 0.08 or (abs(cs - cf) <= 0.08 and jn[k].startswith("Left")): conf[f, 1, k] = 0.0; ns += 1
    elif cf < cs - 0.08: conf[f, 0, k] = 0.0; nf += 1
    else: conf[f, 0, k] *= 0.3; conf[f, 1, k] *= 0.3
log["dropped_side"], log["dropped_front"] = ns, nf
per = {jn[k]: int((bad[:, k]).sum()) for k in range(len(jn)) if bad[:, k].sum() > T * 0.08}
print(f"两机位高度差超过 {tol} 的读数 {int(bad.sum())} 个（共 {T * len(jn)}）：作废侧面的 {ns} 个、正面的 {nf} 个。多的关节: {per}")

# 3 / 4. 左边的肢体借右边的前后位置
for key, parts in (("--mirror-arms", ARM), ("--mirror-legs", LEG[1:])):
    for a_, b_ in spans(key):
        b_ = min(b_, T - 1)
        for suf in parts:
            l_, r_ = jn.index("Left" + suf), jn.index("Right" + suf)
            obs[a_:b_ + 1, 1, l_, 0] = obs_raw[a_:b_ + 1, 1, r_, 0]; obs[a_:b_ + 1, 1, l_, 1] = obs_raw[a_:b_ + 1, 0, l_, 1]
            conf[a_:b_ + 1, 1, l_] = np.minimum(0.7, np.minimum(conf_raw[a_:b_ + 1, 0, l_], conf_raw[a_:b_ + 1, 1, r_]))
        print(f"{key}: 第 {a_} 到 {b_} 帧")

# 5. 求解（和 v2r.solver.solve(ground=True) 同一个目标函数；多了初值）
kneel = spans("--kneel"); hip_deg, knee_deg = float(opt.get("--hip", 40)), float(opt.get("--knee", 60))
jw = np.array([skel.joint_weight.get(n, 1.0) for n in jn])


def solve_init(obs, conf, lr=0.03, w_acc=2e-3, w_vel=1e-4, w_prior=2e-4, w_limit=2.0, huber=0.03, conf_floor=0.15, w_ground=5.0):
    ts = S.TorchSkeleton(skel); obs_t = torch.tensor(obs, dtype=torch.float32).permute(0, 2, 1, 3)
    w = np.clip((conf - conf_floor) / (1 - conf_floor), 0, 1) ** 2 * jw[None, None, :]
    w_t = torch.tensor(w, dtype=torch.float32).permute(0, 2, 1); scale = torch.tensor(WH, dtype=torch.float32)
    # 整体朝向的初值：两个机位都可信的点才参与（作废了一边的点 unproject 出来是错的）
    P3 = sk.unproject(obs[:, 0], obs[:, 1]); wk = np.sqrt(w[:, 0] * w[:, 1]) + 1e-4; rest = skel.joint_rest
    torso = [jn.index(n) for n in skel.torso_joints if n in jn]; hips = jn.index(skel.root_joint)
    A0 = np.stack([S._kabsch(rest[torso], P3[f, torso], wk[f, torso]) for f in range(T)]); t0 = P3[:, hips] - rest[hips]
    good = wk[:, hips] > 0.3
    if good.sum() >= 2 and not good.all():
        for c in range(3): t0[:, c] = np.interp(np.arange(T), np.arange(T)[good], t0[good, c])
    dn = [str(n) for n in skel.dof_names]; th0 = np.zeros((T, skel.D), dtype=np.float32)
    for a_, b_ in kneel:
        b_ = min(b_, T - 1)
        for f in range(a_, b_ + 1):
            k = min(1.0, (f - a_ + 1) / 4, (b_ - f + 1) / 4)
            for d_i, n in enumerate(dn):
                if n.endswith("UpLeg.fwd"): th0[f, d_i] = -math.radians(hip_deg) * k        # 跪：大腿相对骨盆向后（静止时大腿是前伸 33 度的）
                elif n.endswith("Leg.hinge"): th0[f, d_i] = math.radians(knee_deg) * k
    foot_idx = [jn.index(n) for n in skel.ground_joints if n in jn]; z_floor = torch.tensor(rest[foot_idx, 2] - 0.012, dtype=torch.float32)
    theta = torch.tensor(th0, requires_grad=True); delta = torch.zeros(T, 3, requires_grad=True); t = torch.tensor(t0, dtype=torch.float32, requires_grad=True); A0_t = torch.tensor(A0, dtype=torch.float32)
    o = torch.optim.Adam([theta, delta, t], lr=lr); sched = torch.optim.lr_scheduler.CosineAnnealingLR(o, iters, eta_min=lr * 0.05)
    for it in range(iters):
        A = S.exp_rotvec(delta) @ A0_t; P, G, _ = ts.fk(theta, A, t); Pj = ts.joints(P, G); r = ((ts.project(Pj) - obs_t) * scale).norm(dim=-1)
        hub = torch.where(r < huber, 0.5 * r ** 2, huber * (r - 0.5 * huber)); l_data = (w_t * hub).sum() / w_t.sum().clamp_min(1e-6)
        l_limit = (torch.relu(theta - ts.hi) ** 2 + torch.relu(ts.lo - theta) ** 2).mean(); l_prior = (theta ** 2).mean()
        acc = theta[2:] - 2 * theta[1:-1] + theta[:-2]; accA = A[2:] - 2 * A[1:-1] + A[:-2]; acct = t[2:] - 2 * t[1:-1] + t[:-2]
        loss = l_data + w_limit * l_limit + w_prior * l_prior + w_acc * ((acc ** 2).mean() + (accA ** 2).mean() + 4 * (acct ** 2).mean()) + w_vel * ((theta[1:] - theta[:-1]) ** 2).mean()
        loss = loss + w_ground * (torch.relu(z_floor - Pj[:, foot_idx, 2]) ** 2).mean()
        o.zero_grad(); loss.backward(); o.step(); sched.step()
    with torch.no_grad():
        A = S.exp_rotvec(delta) @ A0_t; th = torch.minimum(torch.maximum(theta, ts.lo), ts.hi); P, G, Q = ts.fk(th, A, t); Pj = ts.joints(P, G)
    Qn = Q.numpy().astype(np.float64); quats = S.continuous_quats(np.array([[sk.mat_to_quat(Qn[f, b]) for b in range(skel.n)] for f in range(T)]))
    return {"theta": th.numpy(), "A_root": A.numpy(), "t": t.detach().numpy(), "joints": Pj.numpy(), "bone_world": G.numpy(), "quats": quats, "loc": (skel.R[skel.root].T @ t.detach().numpy().T).T / skel.scale}


def reproj(J, o_, c_):
    r = np.linalg.norm((sk.project(J).transpose(1, 0, 2, 3) - o_) * WH, axis=-1); w = np.clip(c_, 1e-3, 1); return float(np.average(r, weights=w) / skel.size_ref * 100)


res = solve_init(obs, conf)
pl.save_motion(os.path.join(dst, "motion.npz"), res, fps); np.savez(os.path.join(dst, "detections.npz"), obs=obs, conf=conf, fps=fps)
chk = json.load(open(os.path.join(src, "check.json"))) if os.path.exists(os.path.join(src, "check.json")) else {}
old = np.load(os.path.join(src, "motion.npz"), allow_pickle=True)["joints"] if os.path.exists(os.path.join(src, "motion.npz")) else None
chk.update({"reproj_pct_pipeline": chk.get("reproj_pct"), "reproj_pct": reproj(res["joints"], obs, conf), "reproj_pct_vs_raw": reproj(res["joints"], obs_raw, conf_raw), "clean": log, "kneel": [list(x) for x in kneel]})
json.dump(chk, open(os.path.join(dst, "check.json"), "w"), ensure_ascii=False, indent=1)
dn = [str(n) for n in skel.dof_names]; knee = np.degrees(res["theta"][:, [dn.index("LeftLeg.hinge"), dn.index("RightLeg.hinge")]])
print(f"{tag} -> {out_tag}: 回投偏差（对清过的读数）{chk['reproj_pct']:.2f}%，对原始读数 {chk['reproj_pct_vs_raw']:.2f}%（管线原来 {chk.get('reproj_pct_pipeline') or float('nan'):.2f}%）；膝盖相对静止最多再弯 {knee.max():.0f} 度；到活动范围边上的自由度: "
      + ", ".join(f"{n}({np.degrees(res['theta'][:, k]).min():.0f}~{np.degrees(res['theta'][:, k]).max():.0f})" for k, n in enumerate(dn) if (res["theta"][:, k] >= skel.dof_hi[k] - 1e-3).mean() > 0.1 or (res["theta"][:, k] <= skel.dof_lo[k] + 1e-3).mean() > 0.1))
