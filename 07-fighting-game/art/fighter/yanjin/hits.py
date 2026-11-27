"""从 timing.py 的 json 算时间点：hit = 出手肢体第一次到最远伸展的 95%（往前）；recover = 出手以后全身几个末端都回到离第一帧 0.035 以内（身高 1）的第一帧。
用法: python hits.py <timing.json> 动作:肢体[,肢体][@起秒-止秒] …   例: light1:LH heavy:RH ult_combo:LH@0-0.8"""
import json, sys
import numpy as np
T = json.load(open(sys.argv[1]))
for spec in sys.argv[2:]:
    a, rest = spec.split(":"); win = None
    if "@" in rest: rest, w = rest.split("@"); win = [float(x) for x in w.split("-")]
    rows = T[a]; n = len(rows); ts = np.array([r["f"] / 30 for r in rows])
    out = []
    for limb in rest.split(","):
        fw = np.array([r[limb][1] for r in rows]); m = np.ones(n, bool) if not win else (ts >= win[0]) & (ts <= win[1])
        i_max = int(np.argmax(np.where(m, fw, -9))); base = fw[0]; thr = base + 0.95 * (fw[i_max] - base)
        i_hit = next(i for i in range(n) if m[i] and fw[i] >= thr)
        out.append((limb, ts[i_hit], fw[i_max], ts[i_max]))
    ends = ["LH", "RH", "LF", "RF", "LE", "RE"]; P0 = np.array([rows[0][k] for k in ends])
    last = max(o[3] for o in out); rec = None
    for i in range(n):
        if ts[i] <= last: continue
        if np.linalg.norm(np.array([rows[i][k] for k in ends]) - P0, axis=1).max() < 0.035: rec = ts[i]; break
    print(a, " ".join(f"{l} hit {t:.2f}s（最远 {v:.2f} @ {tm:.2f}s）" for l, t, v, tm in out), "recover", rec, "dur", round(ts[-1], 2))
