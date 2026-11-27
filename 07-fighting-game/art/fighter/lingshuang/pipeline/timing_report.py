"""读 track.py 出的轨迹，给每段动作量时间点（成品 30 帧每秒的秒数）：
  刀尖速度的几个峰值、刀尖最靠前的时刻、各肢体最靠前的时刻、胯最低的时刻、双脚离地/落地、回到架势（之后所有关键点离末帧都在 3 厘米内）。
用法: python timing_report.py <track.json> [动作 …]   （单位：身高 1；“前”是 -Y）"""
import json, sys
import numpy as np
D = json.load(open(sys.argv[1])); only = sys.argv[2:]
KEYS = ["W", "LH", "RH", "LF", "RF", "LK", "RK", "LE", "RE", "HIP", "HEAD"]
for a, rows in D.items():
    if only and a not in only: continue
    T = len(rows); P = {k: np.array([r[k] for r in rows]) for k in rows[0]}
    hip = P["HIP"]; fps = 30.0
    def spd(x): v = np.zeros(len(x)); v[1:-1] = np.linalg.norm(x[2:] - x[:-2], axis=1) * fps / 2; v[0] = v[1]; v[-1] = v[-2]; return v
    ws = spd(P["W"]); fwd = -(P["W"][:, 1]); ht = P["W"][:, 2]
    pk = [i for i in range(2, T - 2) if ws[i] == ws[max(0, i - 4):i + 5].max() and ws[i] > 0.6 * ws.max()]
    print(f"== {a}  {T} 帧 {(T - 1) / fps:.2f}s  刀尖速度峰值:", " ".join(f"{i / fps:.2f}s({ws[i]:.1f})" for i in pk))
    print(f"   刀尖最前 {np.argmax(fwd) / fps:.2f}s 前 {fwd.max():.2f} 高 {ht[np.argmax(fwd)]:.2f} | 刀尖最高 {np.argmax(ht) / fps:.2f}s {ht.max():.2f} | 最低 {np.argmin(ht) / fps:.2f}s {ht.min():.2f}")
    for k in ("LH", "RH", "LF", "RF", "LK", "RK"):
        f_ = -(P[k][:, 1] - hip[:, 1] * 0); print(f"   {k} 最前 {np.argmax(f_) / fps:.2f}s {f_.max():+.2f}  速度峰 {np.argmax(spd(P[k])) / fps:.2f}s", end="")
    print()
    fz = np.minimum(P["LA"][:, 2], P["RA"][:, 2]); base = np.percentile(fz, 10); air = fz > base + 0.03
    if air.any():
        idx = np.nonzero(air)[0]; print(f"   双脚离地 {idx[0] / fps:.2f}s → 落地 {(idx[-1] + 1) / fps:.2f}s，最高离地 {fz.max() - base:.2f}")
    print(f"   胯最低 {np.argmin(hip[:, 2]) / fps:.2f}s 高 {hip[:, 2].min():.2f}（开头 {hip[0, 2]:.2f}）")
    last = np.stack([P[k][-1] for k in KEYS]); dev = np.array([np.max(np.linalg.norm(np.stack([P[k][i] for k in KEYS]) - last, axis=1)) for i in range(T)])
    first = np.stack([P[k][0] for k in KEYS]); dev0 = np.array([np.max(np.linalg.norm(np.stack([P[k][i] for k in KEYS]) - first, axis=1)) for i in range(T)])
    rec = next((i for i in range(T) if dev[i:].max() < 0.03), T - 1); st = next((i for i in range(T) if dev0[i] > 0.03), 0)
    print(f"   开始动 {st / fps:.2f}s  回到末帧姿势(3cm) {rec / fps:.2f}s  首尾差 {np.max(np.linalg.norm(first - last, axis=1)):.3f}")
