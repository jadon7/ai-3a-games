"""只做“读关节 + 求解”，不渲染回放。用法: python solve_only.py <name> <tag>=<video> ..."""
import importlib.util, os, sys, json, time
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
sys.path.insert(0, V); sys.argv = sys.argv[:1] + sys.argv[1:]
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
name = sys.argv[1]; skel = pl.load_skel(name)
for pair in sys.argv[2:]:
    tag, video = pair.split("=", 1); d = os.path.join(V, "out", "anim", f"{name}_{tag}"); os.makedirs(d, exist_ok=True); t0 = time.time()
    frames, fps, obs, conf, check = pl.read_stage(name, video, d, skel)
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()): res = pl.solve_stage(skel, obs, conf, ground=True)
    pl.save_motion(os.path.join(d, "motion.npz"), res, fps)
    import numpy as np
    from v2r import skeleton as sk
    r = np.linalg.norm((sk.project(res["joints"]).transpose(1, 0, 2, 3) - obs) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1)
    check["reproj_pct"] = float(np.average(r, weights=np.clip(conf, 1e-3, 1)) / skel.size_ref * 100)
    json.dump(check, open(os.path.join(d, "check.json"), "w"), ensure_ascii=False, indent=1)
    print(tag, f"置信度 {check['mean_conf']:.2f} 低置信 {check['low_conf_ratio']*100:.1f}% 两机位对不上的帧 {check['frames_inconsistent']} 回投偏差 {check['reproj_pct']:.2f}% 用时 {time.time()-t0:.0f}s", flush=True)
