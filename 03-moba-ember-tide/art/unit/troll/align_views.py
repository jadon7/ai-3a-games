#!/usr/bin/env python3
"""巨魔专用：视频里正面机位和侧面机位的步子差了小半拍（两个画面各走各的），把正面机位的读数在时间上挪一下对齐侧面机位，再用管线的求解器重解。

毛病（troll_run_01）：侧面机位里双脚分得最开的时刻，正面机位里已经是一只脚抬到半路；同一个关节在两个画面里的高度曲线形状一样，但正面的早了约 10 帧。
直接解的话，高度是两边凑出来的：脚该踩着的时候被正面机位“抬”起来一截，左右晃和摆臂也和迈腿对不上。
做法：只用读数就能量出差多少帧——试一串时间差，看哪个让“同一关节在两个机位里的高度”最一致；左右腿对调的情况也一起比，取最一致的那种。
然后正面机位的读数按这个时间差重新取样（侧面的不动，步子、前后位置都以侧面为准），丢掉开头对不齐的那几帧，重新求解。只用管线的零件，不改管线的文件。

用法: <V2R>/.venv/bin/python art/unit/troll/align_views.py <源动作名，如 run> <新动作名，如 runal> [--lag 帧数，不给就自己找] [--from 侧面机位从第几帧开始用=30] [--dry 只量不解]
读 V2R/out/anim/troll_<源>/detections.npz，写 V2R/out/anim/troll_<新>/{detections.npz, motion.npz, check.json}。帧号变了：新的第 0 帧 = 侧面机位的第 --from 帧。
"""
import importlib.util, os, sys, json, contextlib, io
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk  # noqa: E402
argv = sys.argv[1:]; opts = {}; pos = []; i = 0
while i < len(argv):
    if argv[i] in ("--lag", "--from"): opts[argv[i]] = argv[i + 1]; i += 2
    elif argv[i].startswith("--"): opts[argv[i]] = True; i += 1
    else: pos.append(argv[i]); i += 1
src, dst = pos; t0 = int(opts.get("--from", 30))
skel = pl.load_skel("troll"); jn = skel.joint_names
d = os.path.join(V, "out", "anim", f"troll_{src}"); det = np.load(os.path.join(d, "detections.npz")); obs, conf, fps = det["obs"], det["conf"], float(det["fps"]); T = len(obs)
LR = [(k, jn.index("Right" + n[4:])) for k, n in enumerate(jn) if n.startswith("Left")]


def shift(a, lag):
    """a (T,...) 按时间挪：返回的第 t 帧 = 原来的第 t - lag 帧（线性插值，超出范围的钳在两头）"""
    x = np.clip(np.arange(T) - lag, 0, T - 1); i0 = np.clip(np.floor(x).astype(int), 0, T - 2); f = (x - i0).reshape(-1, *[1] * (a.ndim - 1))
    return a[i0] * (1 - f) + a[i0 + 1] * f


def swap_lr(o, c):
    o, c = o.copy(), c.copy()
    for l, r in LR: o[:, [l, r]] = o[:, [r, l]]; c[:, [l, r]] = c[:, [r, l]]
    return o, c


def cost(lag, swap):
    of, cf = shift(obs[:, 0], lag), shift(conf[:, 0], lag); os_, cs = (swap_lr(obs[:, 1], conf[:, 1]) if swap else (obs[:, 1], conf[:, 1]))
    lo = int(max(t0, np.ceil(abs(lag)) + 12)); w = np.sqrt(cf * cs)[lo:]; dz = np.abs(of[lo:, :, 1] - os_[lo:, :, 1]) * sk.ORTHO_H
    return float((w * dz).sum() / w.sum())


print(f"不挪：两个机位里同一关节的高度平均差 {cost(0, False) * 100:.2f}% 身高")
table = sorted((cost(l, s), l, s) for l in np.arange(-20, 20.25, 0.5) for s in (False, True))
for c, l, s in table[:6]: print(f"  正面机位晚取 {l:+.1f} 帧{'、侧面左右对调' if s else ''}: {c * 100:.2f}%")
best = table[0]; lag = float(opts["--lag"]) if "--lag" in opts else best[1]; swap = best[2] if "--lag" not in opts else False
print(f"用: 正面机位的读数往后挪 {lag:+.1f} 帧（正面比侧面{'早' if lag > 0 else '晚'} {abs(lag):.1f} 帧）{'，侧面左右对调' if swap else ''}；高度差 {cost(lag, swap) * 100:.2f}%")
if "--dry" in opts: sys.exit()
of, cf = shift(obs[:, 0], lag), shift(conf[:, 0], lag); os_, cs = (swap_lr(obs[:, 1], conf[:, 1]) if swap else (obs[:, 1], conf[:, 1]))
obs2 = np.stack([of, os_], 1)[t0:].astype(np.float32); conf2 = np.stack([cf, cs], 1)[t0:].astype(np.float32)
out = os.path.join(V, "out", "anim", f"troll_{dst}"); os.makedirs(out, exist_ok=True)
with contextlib.redirect_stdout(io.StringIO()): res = pl.solve_stage(skel, obs2, conf2, ground=True)
pl.save_motion(os.path.join(out, "motion.npz"), res, fps); np.savez(os.path.join(out, "detections.npz"), obs=obs2, conf=conf2, fps=fps)
r = np.linalg.norm((sk.project(res["joints"]).transpose(1, 0, 2, 3) - obs2) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1); pct = float(np.average(r, weights=np.clip(conf2, 1e-3, 1)) / skel.size_ref * 100)
old = json.load(open(os.path.join(d, "check.json"))); dz, _ = pl.video.view_consistency(obs2, conf2)
ck = {"frames": int(len(obs2)), "fps": fps, "from_tag": src, "side_from_frame": t0, "front_lag_frames": lag, "side_lr_swapped": bool(swap), "mean_conf": float(conf2.mean()),
      "view_height_diff_mean": float(np.nanmean(dz)), "frames_inconsistent": int((dz > 0.06).sum()), "reproj_pct": pct, "reproj_pct_raw": old.get("reproj_pct"), "view_height_diff_mean_raw": old.get("view_height_diff_mean")}
json.dump(ck, open(os.path.join(out, "check.json"), "w"), ensure_ascii=False, indent=1)
print(f"重解好了 {out}：{len(obs2)} 帧，回投偏差 {old.get('reproj_pct', float('nan')):.2f}% → {pct:.2f}%，两机位对不上的帧 {old.get('frames_inconsistent')} → {ck['frames_inconsistent']}")
