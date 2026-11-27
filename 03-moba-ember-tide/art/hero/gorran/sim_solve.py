"""模拟第二步：把站姿的关节位置当成“两个机位读到的结果”，交给管线的求解器，看它解出来的骨骼旋转。
被盾挡住、网络多半读不准的关节可以把置信度设成 0（hide）。结果存成和 stance.npz 一样的格式。
用法: <V2R>/.venv/bin/python art/hero/gorran/sim_solve.py <joints.npy> <输出.npz> [不可见的关节名,逗号分隔]
"""
import sys, os, contextlib, io
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
from v2r import skeleton as sk, solver  # noqa: E402
J = np.load(sys.argv[1]); out = sys.argv[2]; hide = [h for h in (sys.argv[3].split(",") if len(sys.argv) > 3 else []) if h]
skel = sk.Skeleton.load(os.path.join(V, "assets/model/gorran_skeleton.json"))
obs = sk.project(J).transpose(0, 1, 2)[None]                   # (1, 2, K, 2)
conf = np.ones((1, 2, skel.K))
for h in hide: conf[:, :, skel.joint_names.index(h)] = 0.0
jw = np.array([skel.joint_weight.get(n, 1.0) for n in skel.joint_names])
with contextlib.redirect_stdout(io.StringIO()): res = solver.solve(skel, obs, conf, joint_weight=jw, ground=True)
err = np.linalg.norm(res["joints"][0] - J, axis=1)
print("解出来的关节和站姿的差（身高的百分比）：平均 %.2f 最大 %.2f（%s）" % (err.mean() * 100, err.max() * 100, skel.joint_names[int(err.argmax())]))
th = np.degrees(res["theta"][0])
for k, nm in enumerate(skel.dof_names):
    if any(s in nm for s in ("LeftArm", "LeftForeArm", "LeftHand.", "RightArm", "RightForeArm", "RightHand.")): print("  %-24s %6.1f" % (nm, th[k]))
np.savez(out, names=np.array(skel.names), quats=res["quats"][0], loc=res["loc"][0])
