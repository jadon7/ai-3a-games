"""从查看页探针的记录（scripts/probe_view.mjs 的输出）里读攻击、咆哮的关键时刻（成品动作、原速、秒）。用法: PY scripts/marks_view.py"""
import json, os
import numpy as np
D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
for c in ("attack1", "attack2", "roar"):
    d = json.load(open(f"{D}/probe_{c}.json")); R = d["rows"]; t = np.array([r["t"] for r in R]); P = {k: np.array([r[k] for r in R]) for k in R[0] if k != "t"}
    head = P["tripo::Head_1"][:, 1]; hv = np.gradient(head, t); fw = np.maximum(P["bone_11"][:, 1], P["bone_17"][:, 1]); tail = P["tripo::Tail_1"]; tv = np.abs(np.gradient(tail[:, 0], t))
    print(f"== {c}（{d['dur']} 秒）头: 站姿 {head[0]:.2f} 米，最低 {head.min():.2f} @{t[head.argmin()]:.2f}，最高 {head.max():.2f} @{t[head.argmax()]:.2f}，上升最快 {hv.max():.1f} 米/秒 @{t[hv.argmax()]:.2f}；尾尖左右最快 {tv.max():.1f} 米/秒 @{t[tv.argmax()]:.2f}，左右摆到 {tail[:, 0].min():+.2f} ~ {tail[:, 0].max():+.2f} 米")
    if c == "attack1":
        i0 = int(head.argmin()); up = np.where((np.arange(len(t)) > i0) & (hv > 2.0))[0]; cross = np.where((np.arange(len(t)) > i0) & (head >= head[0]))[0]
        print(f"   开始上挑（头升速超过 2 米/秒）@{t[up[0]]:.2f}；头回到站姿高度 @{t[cross[0]]:.2f}；头到最高点的九成 @{t[np.where((np.arange(len(t)) > i0) & (head >= head[0] + 0.9 * (head.max() - head[0])))[0][0]]:.2f}")
    if c == "attack2":
        up = np.where(fw > fw[0] + 0.3)[0]; j = up[-1]; land = np.where((np.arange(len(t)) > j - 2) & (fw <= fw[0] + 0.03))[0][0]; top = int(fw.argmax()); fall = np.where((np.arange(len(t)) > top) & (np.gradient(np.minimum(P['bone_11'][:, 1], P['bone_17'][:, 1]), t) < -3.0))[0]
        print(f"   前脚离地 @{t[up[0]]:.2f}，抬到最高 {fw.max():.2f} 米 @{t[top]:.2f}，开始往下砸（下落超过 3 米/秒）@{t[fall[0]]:.2f}，砸到地 @{t[land]:.2f}（前腕回到站立高度 +3 厘米以内）")
    if c == "roar":
        i0 = int(np.argmin(head[: len(t) // 2])); up = np.where((np.arange(len(t)) > i0) & (hv > 2.0))[0]; hi = np.where(head >= head[0] + 0.85 * (head.max() - head[0]))[0]
        print(f"   开始仰头 @{t[up[0]]:.2f}；头过站姿高度 @{t[np.where((np.arange(len(t)) > i0) & (head >= head[0]))[0][0]]:.2f}；仰到位（最高点的八成五）@{t[hi[0]]:.2f}，保持到 @{t[hi[-1]]:.2f}")
