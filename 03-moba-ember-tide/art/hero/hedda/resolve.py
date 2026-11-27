"""赫达用（从 art/hero/gorran 拷过来改了名字）：把一段动作重新求解一遍，蹲得低的那些帧从“屈膝”开始解，而不是从站直开始解。只用管线的零件，不改管线的文件。

毛病：跪、深蹲的帧里，上身弓在盾后面，求解器先把整个躯干判成前倾五六十度，腿（还是站直的）就跟着甩到了身后；
之后一步步优化时，腿一直卡在“伸直、往后蹬”这个样子里出不来（膝盖几乎没弯），跪姿解成了斜撑。检测到的膝盖和脚其实是对的。
做法：照 v2r/solver.py 的 solve 一样的目标（两个机位的投影对齐、活动范围、时间平滑、脚不入地），只是给一个初值：
胯比站着低的帧，按胯的高度算出大腿该抬多少、膝盖该弯多少，从那里开始优化。解完和原来的结果比回投偏差，好了才换。
另外把大腿前抬的上限从 100 度放到 --fwd（默认 140）：骨盆前倾时大腿相对骨盆要抬得更多。

用法: <V2R>/.venv/bin/python art/hero/hedda/resolve.py <动作名> [动作名 …] [--fwd 140] [--frames 起-止 只给这一段帧初值] [--keep 只比较不覆盖]
读的是 detections.npz（fix_legs.py 纠正过的话就是纠正后的）。最早的结果留在 motion_raw.npz（没有才存）。
"""
import importlib.util, os, sys, json, shutil, math
import numpy as np
import torch
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk, solver  # noqa: E402
argv = sys.argv[1:]; opts = {}; tags = []; i = 0
while i < len(argv):
    if argv[i] in ("--fwd", "--frames", "--iters"): opts[argv[i]] = argv[i + 1]; i += 2
    elif argv[i].startswith("--"): opts[argv[i]] = True; i += 1
    else: tags.append(argv[i]); i += 1
fwd = float(opts.get("--fwd", 140)); iters = int(opts.get("--iters", 900)); keep = "--keep" in opts
skel = pl.load_skel("hedda"); jn = skel.joint_names; dn = skel.dof_names
for k, nm in enumerate(dn):
    if nm.endswith("UpLeg.fwd"): skel.dof_hi[k] = math.radians(fwd)
jw = np.array([skel.joint_weight.get(n, 1.0) for n in jn]); legs = [k for k, n in enumerate(jn) if any(s in n for s in ("Leg", "Foot", "Toe"))]
D_FWD = [dn.index(s + "UpLeg.fwd") for s in ("Left", "Right")]; D_KNEE = [dn.index(s + "Leg.hinge") for s in ("Left", "Right")]


def solve_from(obs, conf, theta0, lr=0.03, w_acc=2e-3, w_vel=1e-4, w_prior=2e-4, w_limit=2.0, huber=0.03, conf_floor=0.15, w_ground=5.0):
    """和 solver.solve 同一个目标函数，多了一个初值 theta0 (T,D)"""
    T = obs.shape[0]; ts = solver.TorchSkeleton(skel); obs_t = torch.tensor(obs, dtype=torch.float32).permute(0, 2, 1, 3)
    w = np.clip((conf - conf_floor) / (1 - conf_floor), 0, 1) ** 2 * jw[None, None, :]; w_t = torch.tensor(w, dtype=torch.float32).permute(0, 2, 1)
    scale = torch.tensor([sk.ORTHO_W, sk.ORTHO_H], dtype=torch.float32)
    P3 = sk.unproject(obs[:, 0], obs[:, 1]); wk = np.sqrt(w[:, 0] * w[:, 1]) + 1e-4; rest = skel.joint_rest
    torso = [jn.index(n) for n in skel.torso_joints if n in jn]; hips = jn.index(skel.root_joint)
    A0 = np.stack([solver._kabsch(rest[torso], P3[i, torso], wk[i, torso]) for i in range(T)]); t0 = P3[:, hips] - rest[hips]
    good = wk[:, hips] > 0.3
    if good.sum() >= 2 and not good.all():
        for c in range(3): t0[:, c] = np.interp(np.arange(T), np.arange(T)[good], t0[good, c])
    foot_idx = [jn.index(n) for n in skel.ground_joints if n in jn]; z_floor = torch.tensor(rest[foot_idx, 2] - 0.012, dtype=torch.float32)
    theta = torch.tensor(theta0(A0, t0), dtype=torch.float32, requires_grad=True); delta = torch.zeros(T, 3, requires_grad=True); t = torch.tensor(t0, dtype=torch.float32, requires_grad=True)
    A0_t = torch.tensor(A0, dtype=torch.float32); opt = torch.optim.Adam([theta, delta, t], lr=lr); sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters, eta_min=lr * 0.05)
    for _ in range(iters):
        A = solver.exp_rotvec(delta) @ A0_t; P, G, _q = ts.fk(theta, A, t); Pj = ts.joints(P, G); r = ((ts.project(Pj) - obs_t) * scale).norm(dim=-1)
        hub = torch.where(r < huber, 0.5 * r ** 2, huber * (r - 0.5 * huber)); l_data = (w_t * hub).sum() / w_t.sum().clamp_min(1e-6)
        l_limit = (torch.relu(theta - ts.hi) ** 2 + torch.relu(ts.lo - theta) ** 2).mean(); l_prior = (theta ** 2).mean()
        acc = theta[2:] - 2 * theta[1:-1] + theta[:-2]; accA = A[2:] - 2 * A[1:-1] + A[:-2]; acct = t[2:] - 2 * t[1:-1] + t[:-2]
        loss = l_data + w_limit * l_limit + w_prior * l_prior + w_acc * ((acc ** 2).mean() + (accA ** 2).mean() + 4 * (acct ** 2).mean()) + w_vel * ((theta[1:] - theta[:-1]) ** 2).mean()
        loss = loss + w_ground * (torch.relu(z_floor - Pj[:, foot_idx, 2]) ** 2).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    with torch.no_grad():
        A = solver.exp_rotvec(delta) @ A0_t; th = torch.minimum(torch.maximum(theta, ts.hi * 0 + ts.lo), ts.hi); P, G, Q = ts.fk(th, A, t); Pj = ts.joints(P, G)
    Qn = Q.numpy().astype(np.float64); quats = solver.continuous_quats(np.array([[sk.mat_to_quat(Qn[i, b]) for b in range(skel.n)] for i in range(T)]))
    return {"theta": th.numpy(), "A_root": A.numpy(), "t": t.detach().numpy(), "joints": Pj.numpy(), "bone_world": G.numpy(), "quats": quats, "loc": (skel.R[skel.root].T @ t.detach().numpy().T).T / skel.scale}


def err(J, obs, conf):
    r = np.linalg.norm((sk.project(J).transpose(1, 0, 2, 3) - obs) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1); w = np.clip(conf, 1e-3, 1)
    return float(np.average(r, weights=w) / skel.size_ref * 100), float(np.average(r[:, :, legs], weights=w[:, :, legs]) / skel.size_ref * 100), (r * w).sum((1, 2)) / w.sum((1, 2)) * 100


for tag in tags:
    d = os.path.join(V, "out", "anim", f"hedda_{tag}"); det = np.load(os.path.join(d, "detections.npz")); obs, conf, fps = det["obs"], det["conf"], float(det["fps"]); T = len(obs)
    f0, f1 = [int(x) for x in opts["--frames"].split("-")] if "--frames" in opts else (0, T - 1)
    hip_rest = float(skel.joint_rest[jn.index("Hips"), 2]); leg_len = hip_rest - 0.02 - 0.061          # 髋关节到脚踝
    def theta0(A0, t0):
        th = np.zeros((T, skel.D), np.float32)
        for i in range(max(0, f0), min(T - 1, f1) + 1):
            h = hip_rest + t0[i, 2] - 0.02 - 0.061
            if h > leg_len * 0.9: continue                       # 胯没怎么降，腿基本是直的，不用给初值
            phi = math.acos(max(0.15, min(1.0, h / leg_len))); up = A0[i] @ np.array([0, 0, 1.0]); pitch = math.atan2(-up[1], up[2])      # 躯干前倾了多少（面朝 -Y）
            for k in D_FWD: th[i, k] = min(max(phi + max(pitch, 0), 0), skel.dof_hi[k])
            for k in D_KNEE: th[i, k] = min(2 * phi, skel.dof_hi[k])
        return th
    old = np.load(os.path.join(d, "motion.npz")); e0 = err(old["joints"], obs, conf); res = solve_from(obs, conf, theta0); e1 = err(res["joints"], obs, conf); h = jn.index("Hips")
    knee = lambda J: float(np.degrees(np.abs(J)).max())
    print(f"{tag}: 回投偏差 {e0[0]:.2f}% → {e1[0]:.2f}%，腿上的关节 {e0[1]:.2f}% → {e1[1]:.2f}%；膝盖最多弯 {knee(old['theta'][:, D_KNEE]):.0f} → {knee(res['theta'][:, D_KNEE]):.0f} 度", flush=True)
    print("   每 10 帧（旧/新）:", " ".join(f"{i}:{e0[2][i]:.1f}/{e1[2][i]:.1f}" for i in range(0, T, 10)), flush=True)
    if keep or e1[0] > e0[0] - 0.05: print("   没换" + ("" if keep else "（没有变好）"), flush=True); continue
    if not os.path.exists(os.path.join(d, "motion_raw.npz")): shutil.copy(os.path.join(d, "motion.npz"), os.path.join(d, "motion_raw.npz"))
    pl.save_motion(os.path.join(d, "motion.npz"), res, fps)
    ck = json.load(open(os.path.join(d, "check.json"))); ck.setdefault("reproj_pct_raw", ck.get("reproj_pct")); ck["reproj_pct"] = e1[0]; ck["resolved_from_bent_knees"] = True; ck["thigh_fwd_limit"] = fwd
    json.dump(ck, open(os.path.join(d, "check.json"), "w"), ensure_ascii=False, indent=1); print("   已换成新的结果", flush=True)
