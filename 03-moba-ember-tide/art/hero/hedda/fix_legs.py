"""赫达用（从 art/hero/gorran 拷过来改了名字）：纠正侧面机位里左右腿认反的帧，再用管线的求解器重解一遍。

毛病：侧面机位（从角色右边拍）里右腿被锤头挡着、正面机位里左腿被盾挡着，关节识别在侧面机位里常常把“靠前的那只脚”认成左脚。
跑步时两只脚轮流在前，于是每半个循环左右腿就对调一次：解出来左腿一个人迈两倍的步子，右腿一直拖在身后。
做法：两个机位是正交的，同一个关节在两边的高度应该一样。每一帧比较“不对调”和“对调”两种情况下，膝、踝、脚掌、脚尖在两个机位里的高度差，
取差得少的那种（用动态规划顺一下，免得一帧一帧来回跳），把侧面机位里这几个关节的左右换过来，然后重新求解。正面机位的不动（左右是按画面左右分的，一直是对的）。

用法: <V2R>/.venv/bin/python art/hero/hedda/fix_legs.py <动作名> [动作名 …] [--dry 只统计不重解] [--min 至少多少帧对调才重解=4]
原来的结果留一份 motion_raw.npz、detections_raw.npz（在 V2R/out/anim/hedda_<动作>/ 里）。
"""
import importlib.util, os, sys, json, contextlib, io, shutil
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk  # noqa: E402
args = [a for a in sys.argv[1:] if not a.startswith("--")]; dry = "--dry" in sys.argv; need = int(sys.argv[sys.argv.index("--min") + 1]) if "--min" in sys.argv else 4
args = [a for a in args if not a.isdigit()]
skel = pl.load_skel("hedda"); jn = skel.joint_names
PAIRS = [(jn.index("Left" + n), jn.index("Right" + n)) for n in ("Leg", "Foot", "ToeBase", "Toe_End")]
for tag in args:
    d = os.path.join(V, "out", "anim", f"hedda_{tag}"); raw_d = os.path.join(d, "detections_raw.npz"); raw_m = os.path.join(d, "motion_raw.npz")
    if not os.path.exists(raw_d): shutil.copy(os.path.join(d, "detections.npz"), raw_d); shutil.copy(os.path.join(d, "motion.npz"), raw_m)
    det = np.load(raw_d); obs = det["obs"].copy(); conf = det["conf"].copy(); fps = float(det["fps"]); T = len(obs)
    zf = obs[:, 0, :, 1] * sk.ORTHO_H; zs = obs[:, 1, :, 1] * sk.ORTHO_H                 # 两个机位里的高度（世界单位，方向无所谓，只比差）
    c0 = np.zeros(T); c1 = np.zeros(T)
    for l, r in PAIRS:
        w = np.sqrt(conf[:, 0, l] * conf[:, 0, r] * conf[:, 1, l] * conf[:, 1, r])
        c0 += w * (np.abs(zf[:, l] - zs[:, l]) + np.abs(zf[:, r] - zs[:, r])); c1 += w * (np.abs(zf[:, l] - zs[:, r]) + np.abs(zf[:, r] - zs[:, l]))
    weak = np.abs(c0 - c1) < 0.08; c0[weak] = 0; c1[weak] = 0.004      # 两只脚差不多高的帧（都踩在地上、或者正好交错）看不出来：不表态，跟着前后的帧走，略偏向“不对调”
    lam = 0.05; cost = np.stack([c0, c1], 1); best = np.zeros((T, 2)); back = np.zeros((T, 2), int); best[0] = cost[0]          # 动态规划：换一次状态要付一点代价
    for t in range(1, T):
        for s in (0, 1):
            opts = [best[t - 1, p] + (lam if p != s else 0) for p in (0, 1)]; back[t, s] = int(np.argmin(opts)); best[t, s] = min(opts) + cost[t, s]
    st = np.zeros(T, int); st[-1] = int(np.argmin(best[-1]))
    for t in range(T - 1, 0, -1): st[t - 1] = back[t, st[t]]
    sw = np.where(st == 1)[0]; runs = []
    for t in sw:
        if runs and t == runs[-1][1] + 1: runs[-1][1] = int(t)
        else: runs.append([int(t), int(t)])
    print(f"{tag}: 侧面机位左右腿认反的帧 {len(sw)}/{T}", "段落 " + " ".join(f"{a}-{b}" for a, b in runs) if runs else "", flush=True)
    if dry or len(sw) < need: continue
    for l, r in PAIRS:
        obs[sw, 1, l], obs[sw, 1, r] = obs[sw, 1, r].copy(), obs[sw, 1, l].copy(); conf[sw, 1, l], conf[sw, 1, r] = conf[sw, 1, r].copy(), conf[sw, 1, l].copy()
    with contextlib.redirect_stdout(io.StringIO()): res = pl.solve_stage(skel, obs, conf, ground=True)
    pl.save_motion(os.path.join(d, "motion.npz"), res, fps); np.savez(os.path.join(d, "detections.npz"), obs=obs, conf=conf, fps=fps)
    r = np.linalg.norm((sk.project(res["joints"]).transpose(1, 0, 2, 3) - obs) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1)
    pct = float(np.average(r, weights=np.clip(conf, 1e-3, 1)) / skel.size_ref * 100)
    old = json.load(open(os.path.join(d, "check.json"))); old.setdefault("reproj_pct_raw", old.get("reproj_pct")); old["reproj_pct"] = pct; old["legs_swapped_frames"] = int(len(sw))
    json.dump(old, open(os.path.join(d, "check.json"), "w"), ensure_ascii=False, indent=1)
    print(f"   重解：回投偏差 {old['reproj_pct_raw']:.2f}% → {pct:.2f}%", flush=True)
