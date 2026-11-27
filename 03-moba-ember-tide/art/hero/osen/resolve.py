"""奥森自己用的“带初值的重新求解”：只换求解的初值，关节读数（detections.npz）还是管线读出来的那一份。

为什么要有：管线的求解器（video2rig/v2r/solver.py 的 solve）每一帧都从“全身伸直”开始优化，整体朝向的初值取躯干的朝向。
深蹲、跪地这类姿势里躯干前倾得厉害，初值就成了“整个人像一块板一样往前倒”，优化掉进这个坑里出不来：
腿是直的、脚落在身后老远（脚的回投偏差 18% 身高），而不是屈髋屈膝蹲下去。
这里把同一个目标函数照抄了一遍（没有改 video2rig 的代码），只在指定的帧段上换初值：骨盆保持这一段开始前的朝向，髋和膝先屈起来，脊柱先前弯。

用法: python art/hero/osen/resolve.py <标签，如 w> <输出标签，如 w_fix> <帧段 a-b[,a-b…]> [髋屈角=75] [膝屈角=100] [脊柱每节前弯=15] [左手跟右手的帧段 a-b[,…]] [侧面机位左右腿认反时对调的帧段 a-b[,…]]
读 video2rig/out/anim/osen_<标签>/detections.npz，写 video2rig/out/anim/osen_<输出标签>/motion.npz（格式和管线的一样）和 check.json。
"""
import importlib.util, json, math, os, sys
import numpy as np
import torch
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk, solver as S

# 帧段写成 a-b 是“蹲/跪”（两条腿都先屈起来，骨盆保持原来的朝向，脊柱先前弯）；写成 a-b:L 或 a-b:R 是“弓步”（只把这一侧的腿先屈起来，别的初值不动）
tag, out_tag = sys.argv[1], sys.argv[2]
spans = [(int(s.split(":")[0].split("-")[0]), int(s.split(":")[0].split("-")[1]), (s.split(":")[1] if ":" in s else "")) for s in sys.argv[3].split(",")]
hip_deg = float(sys.argv[4]) if len(sys.argv) > 4 else 75.0; knee_deg = float(sys.argv[5]) if len(sys.argv) > 5 else 100.0; spine_deg = float(sys.argv[6]) if len(sys.argv) > 6 else 15.0
skel = pl.load_skel("osen"); src = os.path.join(V, "out/anim", "osen_" + tag); dst = os.path.join(V, "out/anim", "osen_" + out_tag); os.makedirs(dst, exist_ok=True)
det = np.load(os.path.join(src, "detections.npz")); obs = det["obs"]; conf = det["conf"]; fps = float(det["fps"])
jw = np.array([skel.joint_weight.get(n, 1.0) for n in skel.joint_names])
# 第 7 个参数（可选）：左手“跟着右手”的帧段。双手握杖时左手在侧面机位里被身体和杖挡住，读出来的位置落在肚子上、置信度也低，
# 解出来左手就背到了身后。这些帧里把左手几个点在侧面机位的前后位置改成右手对应点的读数（高度用正面机位自己的），置信度给 0.7。
obs = obs.copy(); conf = conf.copy(); jn_ = list(skel.joint_names)
for a_, b_ in ([tuple(int(v) for v in s.split("-")) for s in sys.argv[7].split(",")] if len(sys.argv) > 7 and sys.argv[7] != "-" else []):
    for suf in ("Hand", "HandMiddle1", "HandMiddle4", "HandThumb4"):
        l_, r_ = jn_.index("Left" + suf), jn_.index("Right" + suf)
        obs[a_:b_ + 1, 1, l_, 0] = obs[a_:b_ + 1, 1, r_, 0]; obs[a_:b_ + 1, 1, l_, 1] = obs[a_:b_ + 1, 0, l_, 1]; conf[a_:b_ + 1, 1, l_] = 0.7
    print(f"左手跟右手: 第 {a_} 到 {b_} 帧")

# 第 8 个参数（可选）：“两条腿在侧面机位里认反了就换回来”的帧段。跑步时侧面机位分不清左右腿，读出来总是“在后面抬着的那只是左脚”，
# 正面机位是分得清的（左脚在画面右边）。做法：每一帧只有“侧面的左右腿对调 / 不对调”两种可能，整段一起挑一条代价最小的路（动态规划）：
#   · 这一帧里，同一只脚在两个机位读到的高度应该一样（膝、踝、脚尖三个点）；
#   · 相邻两帧之间，同一只脚在侧面机位里不该瞬移。
if len(sys.argv) > 8 and sys.argv[8] != "-":
    LEG = ("UpLeg", "Leg", "Foot", "ToeBase", "Toe_End"); KEY = ("Leg", "Foot", "Toe_End")
    li = [jn_.index("Left" + k) for k in KEY]; ri = [jn_.index("Right" + k) for k in KEY]
    for a_, b_ in [tuple(int(v) for v in s.split("-")) for s in sys.argv[8].split(",")]:
        b_ = min(b_, len(obs) - 1); n = b_ - a_ + 1
        def side(f, st):                                           # 这一帧侧面机位里（左腿三个点，右腿三个点），st=1 表示对调
            L_, R_ = obs[f, 1, li] * [sk.ORTHO_W, sk.ORTHO_H], obs[f, 1, ri] * [sk.ORTHO_W, sk.ORTHO_H]; return (R_, L_) if st else (L_, R_)
        def unary(f, st):
            L_, R_ = side(f, st); hl, hr = obs[f, 0, li, 1] * sk.ORTHO_H, obs[f, 0, ri, 1] * sk.ORTHO_H
            return float(np.abs(L_[:, 1] - hl).sum() + np.abs(R_[:, 1] - hr).sum())
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
            for suf in LEG:
                l_, r_ = jn_.index("Left" + suf), jn_.index("Right" + suf); obs[f, 1, [l_, r_]] = obs[f, 1, [r_, l_]]; conf[f, 1, [l_, r_]] = conf[f, 1, [r_, l_]]
        print(f"侧面机位左右腿对调: 第 {a_} 到 {b_} 帧里有 {int(st.sum())} 帧 -> " + "".join(str(v) for v in st))


def solve_init(skel, obs, conf, spans, iters=900, lr=0.03, w_acc=2e-3, w_vel=1e-4, w_prior=2e-4, w_limit=2.0, huber=0.03, conf_floor=0.15, joint_weight=None, w_ground=5.0):
    """和 v2r.solver.solve(ground=True) 同一个目标函数；区别只有 theta 和整体朝向的初值（见文件开头）。"""
    T, _, K, _ = obs.shape; ts = S.TorchSkeleton(skel)
    obs_t = torch.tensor(obs, dtype=torch.float32).permute(0, 2, 1, 3)
    w = np.clip((conf - conf_floor) / (1 - conf_floor), 0, 1) ** 2
    if joint_weight is not None: w = w * np.asarray(joint_weight)[None, None, :]
    w_t = torch.tensor(w, dtype=torch.float32).permute(0, 2, 1); scale = torch.tensor([sk.ORTHO_W, sk.ORTHO_H], dtype=torch.float32)
    P3 = sk.unproject(obs[:, 0], obs[:, 1]); wk = np.sqrt(w[:, 0] * w[:, 1]) + 1e-4; rest = skel.joint_rest; names = skel.joint_names
    torso = [names.index(n) for n in skel.torso_joints if n in names]; hips = names.index(skel.root_joint)
    A0 = np.stack([S._kabsch(rest[torso], P3[i, torso], wk[i, torso]) for i in range(T)]); t0 = P3[:, hips] - rest[hips]
    good = wk[:, hips] > 0.3
    if good.sum() >= 2 and not good.all():
        idx = np.arange(T)
        for c in range(3): t0[:, c] = np.interp(idx, idx[good], t0[good, c])
    # ---- 换初值的地方 ----
    dn = [str(n) for n in skel.dof_names]; th0 = np.zeros((T, skel.D), dtype=np.float32)
    for a, b, side in spans:
        ref = max(a - 2, 0); b = min(b, T - 1); pre = {"L": "Left", "R": "Right"}.get(side, "")
        for f in range(a, b + 1):
            k = min(1.0, (f - a + 1) / 3, (b - f + 1) / 3)        # 段的两头各用 3 帧过渡
            if not side: A0[f] = A0[ref]                          # 蹲/跪：骨盆先保持蹲下去之前的朝向，让脊柱和腿去弯
            for i, n in enumerate(dn):
                if n.endswith("UpLeg.fwd") and n.startswith(pre): th0[f, i] = math.radians(hip_deg) * k
                elif n.endswith("Leg.hinge") and n.startswith(pre): th0[f, i] = math.radians(knee_deg) * k
                elif not side and n.startswith("Spine") and n.endswith(".pitch"): th0[f, i] = math.radians(spine_deg) * k
    foot_idx = [names.index(n) for n in skel.ground_joints if n in names]; z_floor = torch.tensor(rest[foot_idx, 2] - 0.012, dtype=torch.float32)
    theta = torch.tensor(th0, requires_grad=True); delta = torch.zeros(T, 3, requires_grad=True); t = torch.tensor(t0, dtype=torch.float32, requires_grad=True); A0_t = torch.tensor(A0, dtype=torch.float32)
    opt = torch.optim.Adam([theta, delta, t], lr=lr); sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters, eta_min=lr * 0.05)
    for it in range(iters):
        A = S.exp_rotvec(delta) @ A0_t; P, G, _ = ts.fk(theta, A, t); Pj = ts.joints(P, G); pred = ts.project(Pj)
        r = ((pred - obs_t) * scale).norm(dim=-1); hub = torch.where(r < huber, 0.5 * r ** 2, huber * (r - 0.5 * huber))
        l_data = (w_t * hub).sum() / w_t.sum().clamp_min(1e-6)
        l_limit = (torch.relu(theta - ts.hi) ** 2 + torch.relu(ts.lo - theta) ** 2).mean(); l_prior = (theta ** 2).mean()
        acc = theta[2:] - 2 * theta[1:-1] + theta[:-2]; accA = A[2:] - 2 * A[1:-1] + A[:-2]; acct = t[2:] - 2 * t[1:-1] + t[:-2]
        l_acc = (acc ** 2).mean() + (accA ** 2).mean() + 4 * (acct ** 2).mean(); l_vel = ((theta[1:] - theta[:-1]) ** 2).mean()
        loss = l_data + w_limit * l_limit + w_prior * l_prior + w_acc * l_acc + w_vel * l_vel + w_ground * (torch.relu(z_floor - Pj[:, foot_idx, 2]) ** 2).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if it % 150 == 0 or it == iters - 1: print(f"  it {it:4d} loss {loss.item():.6f} rms_reproj {math.sqrt(((w_t * r ** 2).sum() / w_t.sum()).item()):.4f}", flush=True)
    with torch.no_grad():
        A = S.exp_rotvec(delta) @ A0_t; th = torch.minimum(torch.maximum(theta, ts.lo), ts.hi); P, G, Q = ts.fk(th, A, t); Pj = ts.joints(P, G)
    Qn = Q.numpy().astype(np.float64); quats = np.zeros((T, skel.n, 4))
    for i in range(T):
        for b in range(skel.n): quats[i, b] = sk.mat_to_quat(Qn[i, b])
    quats = S.continuous_quats(quats); loc = (skel.R[skel.root].T @ t.detach().numpy().T).T / skel.scale
    return {"theta": th.numpy(), "t": t.detach().numpy(), "joints": Pj.numpy(), "quats": quats, "loc": loc}


def reproj(J):
    r = np.linalg.norm((sk.project(J).transpose(1, 0, 2, 3) - obs) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1) / skel.size_ref * 100
    ww = np.clip(conf, 1e-3, 1); return (r * ww).sum((1, 2)) / ww.sum((1, 2)), float(np.average(r, weights=ww))


old = np.load(os.path.join(src, "motion.npz"), allow_pickle=True); per0, all0 = reproj(old["joints"])
res = solve_init(skel, obs, conf, spans, joint_weight=jw); per1, all1 = reproj(res["joints"])
np.savez(os.path.join(dst, "motion.npz"), quats=res["quats"], loc=res["loc"], fps=int(round(fps)), joints=res["joints"], theta=res["theta"], t=res["t"])
np.savez(os.path.join(dst, "detections.npz"), obs=obs, conf=conf, fps=fps)
chk = json.load(open(os.path.join(src, "check.json"))); chk["reproj_pct"] = all1; chk["reinit_spans"] = [list(x) for x in spans]; chk["reproj_pct_before"] = all0
json.dump(chk, open(os.path.join(dst, "check.json"), "w"), ensure_ascii=False, indent=1)
print(f"{tag} -> {out_tag}: 整段回投 {all0:.2f}% -> {all1:.2f}%")
for a, b, _s in spans: print(f"  第 {a} 到 {b} 帧: {per0[a:b + 1].mean():.2f}% -> {per1[a:b + 1].mean():.2f}%（最大 {per0[a:b + 1].max():.2f}% -> {per1[a:b + 1].max():.2f}%）")
out = [i for i in range(len(per0)) if not any(a <= i <= b for a, b, _s in spans)]
print(f"  其余帧: {per0[out].mean():.2f}% -> {per1[out].mean():.2f}%")
