"""粗查刀有没有穿进身体：每帧把刀身（刀镡→刀尖）取 12 个点，和躯干（胯→头）、两条小腿（膝→踝）、两条大腿（胯两侧→膝）这些线段比距离，
小于半径（躯干 0.07、腿 0.045，身高按 1）算“可能穿模”，按动作列出帧数和最深的一帧。用法: python clip_check.py <track.json>"""
import json, sys, numpy as np
D = json.load(open(sys.argv[1]))
def segd(p, a, b):
    ab = b - a; t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-9), 0, 1); return np.linalg.norm(p - (a + ab * t))
for a, R in D.items():
    bad = []
    for i, r in enumerate(R):
        P = {k: np.array(v) for k, v in r.items()}; hipL = P["HIP"] + (P["LK"] - P["HIP"]) * 0 + np.array([0.08, 0, 0]); hipR = P["HIP"] - np.array([0.08, 0, 0])
        segs = [(P["HIP"], P["HEAD"], 0.07, "躯干"), (P["LK"], P["LA"], 0.04, "左小腿"), (P["RK"], P["RA"], 0.04, "右小腿"), (hipL, P["LK"], 0.05, "左大腿"), (hipR, P["RK"], 0.05, "右大腿")]
        worst = (0, "")
        for t in np.linspace(0.15, 1, 12):
            p = P["WB"] + (P["W"] - P["WB"]) * t
            for s0, s1, rad, nm in segs:
                d = rad - segd(p, s0, s1)
                if d > worst[0]: worst = (d, nm)
        if worst[0] > 0.01: bad.append((i, worst))
    if bad:
        w = max(bad, key=lambda x: x[1][0]); print(f"{a}: {len(bad)}/{len(R)} 帧可能穿模，最深 {w[1][0]*100:.0f}cm（{w[1][1]}，第 {w[0]} 帧 {w[0]/30:.2f}s）")
    else: print(f"{a}: 没发现")
