#!/usr/bin/env python3
"""巨魔专用：把一段动作的读数筛一遍再重新求解。只用管线的零件，不改管线的文件。照 art/hero/gorran/resolve.py 的思路改的。

共用脚本（tools/solve_only.py）在“跪下、双手撑地、双拳砸地”这类贴地姿势上的毛病，和这里的对策：
  1. 关节识别会把撑在地上的手指认成脚尖（两个机位都这么认，置信度 0.9 以上），把被身体挡住的脚认到膝盖、大腿上，甩臂甩糊了的那几帧把手认到背后。
     求解器照单全收，腿就被拽到手那边去，拧成麻花。
     → 按骨头长度筛（总是做）：从肩、髋往下一节一节看，画面上两个关节的距离比这节骨头还长一截的，下面那个关节的读数不用（正交机位下投影只会比骨头短）。
     → 两机位高度对不上的筛掉一边（总是做）：同一个关节在两个机位里高度差 8% 身高以上，必有一边认错，留置信度高的那边。
     → --front-feet-off 起-止：这些帧里正面机位的脚踝、脚掌、脚尖不用（跪着时被身体挡住，认到膝盖上，骨长筛不掉）。
  2. 求解从“全身站直”起步，深蹲、跪姿卡在“腿伸直往后蹬”里出不来。→ 胯比站着低的帧从屈膝的姿势开始解（总是做）。
  3. 活动范围是按站着的动作定的。→ 膝盖多放 20 度（到 150），大腿前抬放到 140，脚背放到正负 70，上臂前抬放到 170（总是做）；--wrist 度数：手腕前后折的范围（默认 40）。
  4. 只有脚上三个关节不许入地，而且只管关节不管肉。
     → 膝盖、手腕、指根、指尖、拇指尖也加上“不许低于贴地时的高度”（总是做）。--hand-floor 腕,指根,指尖,拇指：改手上这四个高度；
       --kneel-floor 踝,掌,尖：--front-feet-off 那些帧里脚背朝下贴地，脚上三个关节的高度另给。
     → --sole：脚掌、脚趾、脚后跟上取一百多个网格顶点（art/unit/troll/mesh_rest.npz，dump_mesh.py 倒出来的），都不许入地。走路时脚跟先着地、脚尖蹬地，光管关节的话肉会戳进地里。
     → --plant 起-止：这些帧里两只脚钉在原地（高度钉在站着时的高度，水平位置钉在这些帧的平均位置）。深蹲时腿被挡住、读数筛掉以后，脚会悬空、在地上滑。
  5. 被挡住的那一侧只剩一个机位甚至没有读数。→ --sym-legs 起-止：这些帧里加一条很弱的“左右腿差不多、大腿别往外撇”；
     --arm-follow 起-止：这些帧里左臂（侧面机位里在身体背面）的前后位置跟右臂走，左右和高低仍然听正面机位的。只动左臂自己的角度，而且后半程迭代才加（原因写在代码旁边）。
     --open-hands 起-止：这些帧里手指摊开（掌心撑地）。握拳程度只靠一个指尖点估，贴地时常被解成攥着拳、指节戳进地里。

用法: <V2R>/.venv/bin/python art/unit/troll/resolve.py <源动作名> <新动作名> [上面那些选项] [--iters 1200] [--keep 只比较不存]
读 V2R/out/anim/troll_<源>/detections.npz 和 motion.npz（只拿来比较），写 V2R/out/anim/troll_<新>/{motion.npz, detections.npz, check.json}。原来的不动。
这只巨魔每段动作实际用的选项在 art/unit/troll/rebuild.sh 里。check.json 的 reproj_pct 是“只算留下的读数”的回投偏差，reproj_pct_raw 是共用脚本的。
"""
import importlib.util, os, sys, json, math
import numpy as np
import torch
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk, solver  # noqa: E402
argv = sys.argv[1:]; opts = {}; pos = []; i = 0
while i < len(argv):
    if argv[i] in ("--front-feet-off", "--sym-legs", "--arm-follow", "--iters", "--hand-floor", "--kneel-floor", "--wrist", "--open-hands", "--plant"): opts[argv[i]] = argv[i + 1]; i += 2
    elif argv[i].startswith("--"): opts[argv[i]] = True; i += 1
    else: pos.append(argv[i]); i += 1
src, dst = pos; iters = int(opts.get("--iters", 1200))
skel = pl.load_skel("troll"); jn = skel.joint_names; dn = skel.dof_names; J = jn.index; rest = skel.joint_rest
d = os.path.join(V, "out", "anim", f"troll_{src}"); det = np.load(os.path.join(d, "detections.npz")); obs, conf, fps = det["obs"].copy(), det["conf"].copy(), float(det["fps"]); T = len(obs)
conf_raw = conf.copy()


def span(key):
    m = np.zeros(T, bool)
    if key in opts: a, b = [int(x) for x in opts[key].split("-")]; m[a:b + 1] = True
    return m


# 3. 放宽活动范围
for k, nm in enumerate(dn):
    if nm.endswith("UpLeg.fwd"): skel.dof_hi[k] = math.radians(140)
    if nm.endswith("Leg.hinge") and "UpLeg" not in nm: skel.dof_hi[k] += math.radians(20)
    if nm.endswith("Foot.pitch"): skel.dof_lo[k] = math.radians(-70); skel.dof_hi[k] = math.radians(70)
    if nm.endswith("Arm.fwd") and "Fore" not in nm: skel.dof_hi[k] = math.radians(170)
    if "--wrist" in opts and nm.endswith("Hand.fwd"): skel.dof_lo[k] = -math.radians(float(opts["--wrist"])); skel.dof_hi[k] = math.radians(float(opts["--wrist"]))      # 手掌平撑在地上时手腕要折七八十度，默认只许 40 度：折不过去，求解器就让手指蜷起来凑，蜷着的手指陷进地里
# 1. 筛读数
FEET = [J(s + n) for s in ("Left", "Right") for n in ("Foot", "ToeBase", "Toe_End")]
ffo = span("--front-feet-off"); conf[np.ix_(ffo, [0], FEET)] = 0.0
W2 = np.array([sk.ORTHO_W, sk.ORTHO_H]); n_bone = 0
CHAINS = [[s + n for n in c] for s in ("Left", "Right") for c in (("Arm", "ForeArm", "Hand", "HandMiddle1", "HandMiddle4"), ("Hand", "HandThumb4"), ("UpLeg", "Leg", "Foot", "ToeBase", "Toe_End"))]
for ch in CHAINS:
    idx = [J(n) for n in ch]; seg = [float(np.linalg.norm(rest[idx[k + 1]] - rest[idx[k]])) for k in range(len(idx) - 1)]
    for v in (0, 1):
        for f in range(T):
            a = 0; acc = 0.0                                    # a：链上最近一个可信的关节；acc：从它到当前关节的骨头总长
            for k in range(1, len(idx)):
                acc += seg[k - 1]
                if conf[f, v, idx[k]] <= 0.15: continue
                if conf[f, v, idx[a]] > 0.15 and np.linalg.norm((obs[f, v, idx[k]] - obs[f, v, idx[a]]) * W2) > 1.25 * acc + 0.03: conf[f, v, idx[k]] = 0.0; n_bone += 1; continue
                a = k; acc = 0.0
zf, zs = obs[:, 0, :, 1] * sk.ORTHO_H, obs[:, 1, :, 1] * sk.ORTHO_H; clash = (np.abs(zf - zs) > 0.08) & (conf[:, 0] > 0.15) & (conf[:, 1] > 0.15)
lose_f = clash & (conf[:, 0] < conf[:, 1]); lose_s = clash & ~lose_f; conf[:, 0][lose_f] = 0.0; conf[:, 1][lose_s] = 0.0
print(f"筛掉的读数: 比骨头还长的 {n_bone} 个；两机位高度打架的 正面 {int(lose_f.sum())} 个、侧面 {int(lose_s.sum())} 个；指定不用的正面脚 {int(ffo.sum()) * 6} 个（共 {conf.size} 个读数）", flush=True)
drop = (conf_raw > 0.15) & (conf <= 0.15); bad_f = np.where(drop.sum((1, 2)) >= 3)[0]
if len(bad_f): print("   筛得多的帧:", " ".join(f"{f}({int(drop[f].sum())})" for f in bad_f[:: max(1, len(bad_f) // 30)]), flush=True)
jw = np.array([skel.joint_weight.get(n, 1.0) for n in jn])
D_FWD = [dn.index(s + "UpLeg.fwd") for s in ("Left", "Right")]; D_KNEE = [dn.index(s + "Leg.hinge") for s in ("Left", "Right")]
SYM = [(dn.index("Left" + n), dn.index("Right" + n)) for n in ("UpLeg.fwd", "UpLeg.out", "Leg.hinge", "Foot.pitch", "ToeBase.pitch")]
ZERO = [dn.index(s + n) for s in ("Left", "Right") for n in ("UpLeg.twist", "Foot.yaw")]
OUT = [dn.index(s + "UpLeg.out") for s in ("Left", "Right")]
ARM_N = ("ForeArm", "Hand", "HandMiddle1", "HandMiddle4", "HandThumb4"); ARM_L = [J("Left" + n) for n in ARM_N]; ARM_R = [J("Right" + n) for n in ARM_N]
SYM_ARM = [(dn.index("Left" + n), dn.index("Right" + n)) for n in ("Shoulder.fwd", "Shoulder.up", "Arm.fwd", "Arm.out", "ForeArm.hinge", "Hand.fwd", "Hand.curl")]
# 4. 不许入地的点和各自贴地时的高度（关节在肉里面，贴地时离地面还有半个肢体的厚度；膝盖 0.04 是从死亡视频跪地的读数里量的，手上的是照模型估的）
GROUND = {n: rest[J(n), 2] - 0.012 for n in skel.ground_joints}
for s in ("Left", "Right"): GROUND.update({s + "Leg": 0.048, s + "Hand": 0.05, s + "HandMiddle1": 0.035, s + "HandMiddle4": 0.025, s + "HandThumb4": 0.025})
if "--hand-floor" in opts:                                      # 手腕、指根、指尖、拇指尖贴地时关节离地多高。默认值是照骨架估的；实际网格更厚（在查看页里量过：按默认值撑地，手陷进地里 3% 身高）
    hf = [float(x) for x in opts["--hand-floor"].split(",")]
    for s in ("Left", "Right"): GROUND.update({s + "Hand": hf[0], s + "HandMiddle1": hf[1], s + "HandMiddle4": hf[2], s + "HandThumb4": hf[3]})
g_idx = [J(n) for n in GROUND]; g_z = torch.tensor([GROUND[n] for n in GROUND], dtype=torch.float32)[None].repeat(T, 1)      # (T, 点数)：每帧可以不一样
if "--kneel-floor" in opts:                                     # 跪着的那些帧（--front-feet-off 的范围）脚背朝下贴地，脚踝、脚掌、脚尖离地比站着时高：给 踝,掌,尖 三个数
    kf = [float(x) for x in opts["--kneel-floor"].split(",")]; names = list(GROUND)
    for s in ("Left", "Right"):
        for nm, z in ((s + "Foot", kf[0]), (s + "ToeBase", kf[1]), (s + "Toe_End", kf[2])): g_z[torch.tensor(ffo), names.index(nm)] = z
W_SYMARM = float(os.environ.get("W_SYMARM", 0.02)); W_FOLLOW = float(os.environ.get("W_FOLLOW", 2.0))      # 调试用：左右臂角度差不多的权重、左臂前后位置跟右臂的权重
plant_w = torch.tensor(span("--plant"), dtype=torch.float32); PLANT = [J(s + n) for s in ("Left", "Right") for n in ("ToeBase", "Toe_End", "Foot")]; plant_z = torch.tensor(rest[PLANT, 2], dtype=torch.float32); plant_k = torch.tensor([1.0, 1.0, 0.3] * 2)      # --plant 起-止：这些帧里两只脚踩在地上不许飘（脚掌、脚尖钉在站着时的高度，脚踝松一点，脚跟可以抬）。深蹲时腿被身体和手臂挡住，读数筛掉以后脚的高度没人管，会悬空
sole_b = sole_off = None
if "--sole" in opts:                                           # 脚底的点也不许入地。只管脚踝、脚掌、脚尖三个关节的话，脚一翘（脚跟先着地、脚尖蹬地）肉就戳进地里：走路那段量出来最深陷 2.7% 身高
    mr = np.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mesh_rest.npz")); MV, MB = mr["verts"], np.array([str(x) for x in mr["bone"]]); sb, so = [], []
    for s in ("Left", "Right"):
        for bn, zmax, cnt in ((s + "Foot", 0.06, 30), (s + "ToeBase", 0.05, 20), (s + "Leg", 0.10, 24)):      # 脚掌、脚趾、脚后跟上方（小腿骨管的那一圈）靠近地面的顶点里，各挑一些摊得最开的（最远点采样），按静止姿势记在骨头自己的坐标系里。不只取脚底那一层：脚翘起来以后着地的是脚跟后面、脚趾前面的肉
            bi = skel.index["mixamorig:" + bn]; pts = MV[(MB == "mixamorig:" + bn) & (MV[:, 2] < zmax)]
            if not len(pts): continue
            pick = [int(np.argmin(pts[:, 2]))]
            for _ in range(min(cnt, len(pts)) - 1): pick.append(int(np.argmax(np.min(np.linalg.norm(pts[:, None] - pts[pick][None], axis=-1), axis=1))))
            for k in pick: sb.append(bi); so.append(skel.R[bi].T @ (pts[k] - skel.p[bi]))
    sole_b = torch.tensor(sb); sole_off = torch.tensor(np.array(so), dtype=torch.float32); print(f"脚底取了 {len(sb)} 个不许入地的点", flush=True)
open_w = torch.tensor(span("--open-hands"), dtype=torch.float32); D_CURL = [dn.index(s + "Hand.curl") for s in ("Left", "Right")]      # --open-hands 起-止：这些帧里手指摊开（掌心撑地）。握拳程度只靠一个指尖点估，贴地时常被解成攥着拳、指节戳进地里
sym_w = torch.tensor(span("--sym-legs"), dtype=torch.float32); arm_w = torch.tensor(span("--arm-follow"), dtype=torch.float32)


def solve_from(lr=0.03, w_acc=2e-3, w_vel=1e-4, w_prior=2e-4, w_limit=2.0, huber=0.03, conf_floor=0.15, w_ground=5.0, w_sym=0.02, w_out=0.05):
    ts = solver.TorchSkeleton(skel); obs_t = torch.tensor(obs, dtype=torch.float32).permute(0, 2, 1, 3)
    w = np.clip((conf - conf_floor) / (1 - conf_floor), 0, 1) ** 2 * jw[None, None, :]; w_t = torch.tensor(w, dtype=torch.float32).permute(0, 2, 1)
    scale = torch.tensor([sk.ORTHO_W, sk.ORTHO_H], dtype=torch.float32)
    P3 = sk.unproject(obs[:, 0], obs[:, 1]); wk = np.sqrt(w[:, 0] * w[:, 1]) + 1e-4
    torso = [J(n) for n in skel.torso_joints if n in jn]; hips = J(skel.root_joint)
    A0 = np.stack([solver._kabsch(rest[torso], P3[i, torso], wk[i, torso]) for i in range(T)]); t0 = P3[:, hips] - rest[hips]
    good = wk[:, hips] > 0.3
    if good.sum() >= 2 and not good.all():
        for c in range(3): t0[:, c] = np.interp(np.arange(T), np.arange(T)[good], t0[good, c])
    # 2. 屈膝的初值
    leg_len = float(rest[J("LeftUpLeg"), 2] - rest[J("LeftFoot"), 2]); th0 = np.zeros((T, skel.D), np.float32)
    for i in range(T):
        h = leg_len + t0[i, 2]
        if h > leg_len * 0.9: continue
        phi = math.acos(max(0.15, min(1.0, h / leg_len))); up = A0[i] @ np.array([0, 0, 1.0]); pitch = math.atan2(-up[1], up[2])
        for k in D_FWD: th0[i, k] = min(max(phi * 0.5 + max(pitch, 0), 0), skel.dof_hi[k])
        for k in D_KNEE: th0[i, k] = min(2 * phi, skel.dof_hi[k])
    m_larm = torch.tensor([1.0 if nm.split('.')[0] in ('LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand') else 0.0 for nm in dn]); follow_on = bool(arm_w.sum() > 0)
    theta = torch.tensor(th0, requires_grad=True); delta = torch.zeros(T, 3, requires_grad=True); t = torch.tensor(t0, dtype=torch.float32, requires_grad=True)
    A0_t = torch.tensor(A0, dtype=torch.float32); opt = torch.optim.Adam([theta, delta, t], lr=lr); sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters, eta_min=lr * 0.05)
    for it in range(iters):
        A = solver.exp_rotvec(delta) @ A0_t; P, G, _q = ts.fk(theta, A, t); Pj = ts.joints(P, G); r = ((ts.project(Pj) - obs_t) * scale).norm(dim=-1)
        hub = torch.where(r < huber, 0.5 * r ** 2, huber * (r - 0.5 * huber)); l_data = (w_t * hub).sum() / w_t.sum().clamp_min(1e-6)
        l_limit = (torch.relu(theta - ts.hi) ** 2 + torch.relu(ts.lo - theta) ** 2).mean(); l_prior = (theta ** 2).mean()
        acc = theta[2:] - 2 * theta[1:-1] + theta[:-2]; accA = A[2:] - 2 * A[1:-1] + A[:-2]; acct = t[2:] - 2 * t[1:-1] + t[:-2]
        loss = l_data + w_limit * l_limit + w_prior * l_prior + w_acc * ((acc ** 2).mean() + (accA ** 2).mean() + 4 * (acct ** 2).mean()) + w_vel * ((theta[1:] - theta[:-1]) ** 2).mean()
        loss = loss + w_ground * (torch.relu(g_z - Pj[:, g_idx, 2]) ** 2).mean()
        if sole_b is not None: loss = loss + w_ground * (torch.relu(-(P[:, sole_b] + (G[:, sole_b] @ sole_off[None, :, :, None])[..., 0])[..., 2]) ** 2).sum(-1).mean()      # 对点求和、对帧求平均：点取得多，每一刻真正碰地的只有两三个，全求平均的话这一条轻得不起作用
        loss = loss + 1.0 * ((((Pj[:, PLANT, 2] - plant_z) ** 2) * plant_k).sum(-1) * plant_w).mean()
        if plant_w.sum() > 0:                                # 也不许在地上滑：脚掌、脚尖的水平位置钉在这些帧的平均位置上（看得清的帧占多数，平均值就是它本来站的地方）
            pxy = Pj[:, PLANT[:2] + PLANT[3:5], :2]; anchor = ((pxy * plant_w[:, None, None]).sum(0) / plant_w.sum()).detach()
            loss = loss + 1.0 * (((pxy - anchor) ** 2).sum(-1).sum(-1) * plant_w).mean()
        l_sym = sum(((theta[:, a] - theta[:, b]) ** 2 * sym_w).mean() for a, b in SYM) + sum((theta[:, k] ** 2 * sym_w).mean() for k in ZERO)
        loss = loss + w_sym * l_sym + w_out * sum((torch.relu(theta[:, k] - 0.25) ** 2 * sym_w).mean() for k in OUT)
        loss = loss + 0.5 * sum((theta[:, k] ** 2 * open_w).mean() for k in D_CURL)
        loss = loss + W_SYMARM * sum(((theta[:, a] - theta[:, b]) ** 2 * arm_w).mean() for a, b in SYM_ARM)
        if follow_on and it >= iters // 2:                                      # 这一条只许动左臂自己的角度：让它连躯干一起动的话，躯干会拧着去凑，右臂（目标）跟着跑，越凑越远。
                                                             # 前一半迭代先不加：一开始就加的话，手臂从垂着抬到头顶要先往前摆，这一条不让它摆，就卡在垂着不动了
            th_f = theta.detach() + m_larm * (theta - theta.detach()); Pf, Gf, _q2 = ts.fk(th_f, A.detach(), t.detach()); Pjf = ts.joints(Pf, Gf)
            loss = loss + W_FOLLOW * (((Pjf[:, ARM_L, 1] - Pj[:, ARM_R, 1].detach()) ** 2).mean(-1) * arm_w).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    with torch.no_grad():
        A = solver.exp_rotvec(delta) @ A0_t; th = torch.minimum(torch.maximum(theta, ts.lo), ts.hi); P, G, Q = ts.fk(th, A, t); Pj = ts.joints(P, G)
    Qn = Q.numpy().astype(np.float64); quats = solver.continuous_quats(np.array([[sk.mat_to_quat(Qn[i, b]) for b in range(skel.n)] for i in range(T)]))
    return {"theta": th.numpy(), "A_root": A.numpy(), "t": t.detach().numpy(), "joints": Pj.numpy(), "bone_world": G.numpy(), "quats": quats, "loc": (skel.R[skel.root].T @ t.detach().numpy().T).T / skel.scale}


def err(Jp, c):
    r = np.linalg.norm((sk.project(Jp).transpose(1, 0, 2, 3) - obs) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1); w = np.clip(c, 1e-3, 1)
    return float(np.average(r, weights=w) / skel.size_ref * 100), (r * w).sum((1, 2)) / w.sum((1, 2)) * 100


old = np.load(os.path.join(d, "motion.npz")); res = solve_from()
e0, e1 = err(old["joints"], conf), err(res["joints"], conf); e0r = err(old["joints"], conf_raw)
knee = lambda th: float(np.degrees(th[:, D_KNEE]).max())  # noqa: E731
print(f"{src} → {dst}: 回投偏差（只算留下的读数）{e0[0]:.2f}% → {e1[0]:.2f}%；共用脚本的结果按全部读数算是 {e0r[0]:.2f}%。膝盖最多弯（相对静止姿势）{knee(old['theta']):.0f} → {knee(res['theta']):.0f} 度", flush=True)
print("   每 10 帧（旧/新）:", " ".join(f"{i}:{e0[1][i]:.1f}/{e1[1][i]:.1f}" for i in range(0, T, 10)), flush=True)
Jn = res["joints"]; print("   最低点（新解）: 脚 %.3f 膝 %.3f 手腕 %.3f 指根 %.3f 指尖 %.3f" % (Jn[:, FEET, 2].min(), Jn[:, [J("LeftLeg"), J("RightLeg")], 2].min(), Jn[:, [J("LeftHand"), J("RightHand")], 2].min(), Jn[:, [J("LeftHandMiddle1"), J("RightHandMiddle1")], 2].min(), Jn[:, [J("LeftHandMiddle4"), J("RightHandMiddle4")], 2].min()))
if "--keep" not in opts:
    out = os.path.join(V, "out", "anim", f"troll_{dst}"); os.makedirs(out, exist_ok=True)
    pl.save_motion(os.path.join(out, "motion.npz"), res, fps); np.savez(os.path.join(out, "detections.npz"), obs=obs, conf=conf, fps=fps)
    ck = json.load(open(os.path.join(d, "check.json"))); ck["reproj_pct_raw"] = ck.get("reproj_pct", e0r[0]); ck["reproj_pct"] = e1[0]; ck["resolve_opts"] = {k: v for k, v in opts.items()}; ck["readings_dropped"] = int(drop.sum())
    json.dump(ck, open(os.path.join(out, "check.json"), "w"), ensure_ascii=False, indent=1); print("   存到", out, flush=True)
