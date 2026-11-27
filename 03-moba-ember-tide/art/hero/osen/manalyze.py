"""看一段解算结果逐帧的质量和关键时刻。
用法: python art/hero/osen/manalyze.py <标签，如 q> [模式=win|frames] [起帧] [止帧]
  win    每 6 帧一组：回投偏差（% 身高）、平均置信度、最差的关节
  frames 逐帧：回投偏差、右手（腕）的位置和速度、左手位置、胯高、头高。坐标：x 左为正，y 前方为负，z 高度，单位是身高。
"""
import importlib.util, os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk
tag = sys.argv[1]; mode = sys.argv[2] if len(sys.argv) > 2 else "win"
skel = pl.load_skel("osen"); jn = list(skel.joint_names)
d = os.path.join(V, "out/anim", "osen_" + tag); m = np.load(os.path.join(d, "motion.npz"), allow_pickle=True); det = np.load(os.path.join(d, "detections.npz"))
J = m["joints"]; obs = det["obs"]; conf = det["conf"]; T = len(J); fps = float(m["fps"])
r = np.linalg.norm((sk.project(J).transpose(1, 0, 2, 3) - obs) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1) / skel.size_ref * 100      # (T,2,K)
w = np.clip(conf, 1e-3, 1); per = (r * w).sum((1, 2)) / w.sum((1, 2)); cf = conf.mean((1, 2))
a = int(sys.argv[3]) if len(sys.argv) > 3 else 0; b = int(sys.argv[4]) if len(sys.argv) > 4 else T - 1
if mode == "win":
    print(f"{tag}: {T} 帧 @ {fps:.0f}，整段回投 {np.average(r, weights=w):.2f}%，置信度 {conf.mean():.2f}")
    for s in range(0, T, 6):
        e = min(s + 6, T); rr = r[s:e]; ww = w[s:e]; jm = (rr * ww).sum((0, 1)) / ww.sum((0, 1)); worst = np.argsort(-jm)[:3]; lowc = [jn[k] for k in np.argsort(conf[s:e].mean((0, 1)))[:2] if conf[s:e].mean((0, 1))[k] < 0.5]
        print(f"  帧 {s:3d}-{e - 1:3d}  回投 {per[s:e].mean():5.2f}%  置信 {cf[s:e].mean():.2f}  最差: " + " ".join(f"{jn[k]}({jm[k]:.1f})" for k in worst) + ("  低置信: " + ",".join(lowc) if lowc else ""))
else:
    rh = J[:, jn.index("RightHand")]; lh = J[:, jn.index("LeftHand")]; hp = J[:, jn.index("Hips")]; hd = J[:, jn.index("Head")]
    v = np.zeros(T); v[1:-1] = np.linalg.norm(rh[2:] - rh[:-2], axis=-1) / 2 * fps; vl = np.zeros(T); vl[1:-1] = np.linalg.norm(lh[2:] - lh[:-2], axis=-1) / 2 * fps
    print("帧   回投%  右手 x     前(-y)   高     速度 | 左手 x    前      高    速度 | 胯高   胯前    头高")
    for f in range(a, b + 1):
        print(f"{f:3d}  {per[f]:5.2f}  {rh[f,0]:6.2f}  {-rh[f,1]:6.2f}  {rh[f,2]:5.2f}  {v[f]:5.2f} | {lh[f,0]:6.2f}  {-lh[f,1]:6.2f}  {lh[f,2]:5.2f}  {vl[f]:5.2f} | {hp[f,2]:5.2f}  {-hp[f,1]:6.2f}  {hd[f,2]:5.2f}")
