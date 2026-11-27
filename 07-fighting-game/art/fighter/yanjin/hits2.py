"""从 timing.py 的 json 量时间点（成品动作，30 帧每秒）。
  peaks(a, limb, axis)：肢体沿 axis（fw 往前 / z 高 / -z 低 / fwz 前上方）的局部最大值（比起点多出 thr 以上、两边各 4 帧内最大），
  每个峰取“第一次到达峰值 95%”的时刻当 hit。
  air(a)：双脚都离地（最低的脚高于 0.06）的起止 = takeoff / land。
  recover(a, after)：after 之后手脚末端都回到离第一帧 3.5% 身高以内的第一刻。
用法: python hits2.py <timing.json>"""
import json, sys
import numpy as np
T = json.load(open(sys.argv[1]))
def series(a, limb, axis):
    rows = T[a]; P = np.array([r[limb] for r in rows])
    return {"fw": P[:, 1], "z": P[:, 2], "-z": -P[:, 2], "fwz": P[:, 1] + P[:, 2]}[axis]
def peaks(a, limb, axis="fw", thr=0.12, w=(0, 99)):
    s = series(a, limb, axis); n = len(s); base = s[0]; out = []
    for i in range(n):
        t = i / 30
        if not (w[0] <= t <= w[1]): continue
        lo, hi = max(0, i - 4), min(n, i + 5)
        if s[i] - base >= thr and s[i] == s[lo:hi].max() and (not out or i - out[-1][2] > 4):
            j = i
            while j > 0 and s[j - 1] >= base + 0.95 * (s[i] - base): j -= 1
            out.append((round(j / 30, 2), round(float(s[i] - base), 2), i))
    return out
def air(a):
    fz = np.array([min(r["footz"]) for r in T[a]]); up = np.nonzero(fz > 0.06)[0]
    return (round(up[0] / 30, 2), round((up[-1] + 1) / 30, 2)) if len(up) else None
def recover(a, after):
    rows = T[a]; ends = ["LH", "RH", "LF", "RF", "LE", "RE"]; P0 = np.array([rows[0][k] for k in ends])
    for i, r in enumerate(rows):
        if i / 30 > after and np.linalg.norm(np.array([r[k] for k in ends]) - P0, axis=1).max() < 0.035: return round(i / 30, 2)
    return None
def dur(a): return round((len(T[a]) - 1) / 30, 2)
if __name__ == "__main__":
    for a in T:
        print(a, "dur", dur(a), "air", air(a))
        for limb in ("LH", "RH", "LE", "RE", "LF", "RF"):
            for ax in ("fw", "z"):
                p = peaks(a, limb, ax)
                if p: print("   ", limb, ax, p)
