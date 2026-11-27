"""两个机位大小不一致的视频：把侧面机位的读数按正面机位缩放对齐，再用管线的求解器重解。只用管线的零件，不改管线的文件。

毛病：即梦出的双机位视频有时两个半边里角色的大小不一样（乌戈的 run 侧面只有正面的 0.86 倍、w 0.85 倍）。
同一个关节在两个机位里的高度应该一样，大小不一样时求解器只能两头凑：脚飘、步子算错、回投偏差高。
做法：拿两个机位都看得清的关节，拟合“侧面高度 = a × 正面高度 + b”，把侧面机位的读数整体反算回去（竖直方向按 a、b，水平方向按 a 绕角色中线缩放），再重解。
原来的读数和结果留在 detections_raw.npz、motion_raw.npz（没有才存）。
用法: <V2R>/.venv/bin/python view_fix.py <动作> [动作 …] [--dry 只拟合不重解]
"""
import importlib.util, os, sys, json, shutil, contextlib, io
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk  # noqa: E402
tags = [a for a in sys.argv[1:] if not a.startswith("--")]; dry = "--dry" in sys.argv
skel = pl.load_skel("ugo")
for tag in tags:
    d = os.path.join(V, "out", "anim", f"ugo_{tag}"); raw_d = os.path.join(d, "detections_raw.npz"); raw_m = os.path.join(d, "motion_raw.npz")
    if not os.path.exists(raw_d): shutil.copy(os.path.join(d, "detections.npz"), raw_d); shutil.copy(os.path.join(d, "motion.npz"), raw_m)
    det = np.load(raw_d); obs = det["obs"].copy(); conf = det["conf"]; fps = float(det["fps"])
    w = (conf[:, 0] > 0.5) & (conf[:, 1] > 0.5)
    zf = obs[:, 0, :, 1][w]; zs = obs[:, 1, :, 1][w]
    a, b = np.polyfit(zf, zs, 1)
    for _ in range(2):                                            # 去掉离得远的点再拟合一次
        r = np.abs(zs - (a * zf + b)); keep = r < np.percentile(r, 85); a, b = np.polyfit(zf[keep], zs[keep], 1)
    cx = float(np.median(obs[:, 1, :, 0][w]))
    print(f"{tag}: 侧面 = {a:.3f} × 正面 {b:+.3f}（侧面中线 {cx:.3f}）", flush=True)
    if dry: continue
    obs[:, 1, :, 1] = (obs[:, 1, :, 1] - b) / a
    obs[:, 1, :, 0] = cx + (obs[:, 1, :, 0] - cx) / a
    with contextlib.redirect_stdout(io.StringIO()): res = pl.solve_stage(skel, obs, conf, ground=True)
    pl.save_motion(os.path.join(d, "motion.npz"), res, fps); np.savez(os.path.join(d, "detections.npz"), obs=obs, conf=conf, fps=fps)
    rr = np.linalg.norm((sk.project(res["joints"]).transpose(1, 0, 2, 3) - obs) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1)
    pct = float(np.average(rr, weights=np.clip(conf, 1e-3, 1)) / skel.size_ref * 100)
    dz, _ = __import__("v2r.video", fromlist=["x"]).view_consistency(obs, conf)
    old = json.load(open(os.path.join(d, "check.json"))); old.setdefault("reproj_pct_raw", old.get("reproj_pct")); old.setdefault("frames_inconsistent_raw", old.get("frames_inconsistent"))
    old["reproj_pct"] = pct; old["frames_inconsistent"] = int((dz > 0.06).sum()); old["side_view_scale"] = [float(a), float(b)]
    json.dump(old, open(os.path.join(d, "check.json"), "w"), ensure_ascii=False, indent=1)
    print(f"   重解：回投偏差 {old['reproj_pct_raw']:.2f}% → {pct:.2f}%，两机位对不上的帧 {old['frames_inconsistent_raw']} → {old['frames_inconsistent']}", flush=True)
