#!/usr/bin/env python3
"""看 Tripo 绑骨有没有错绑：每根骨骼的头尾；每根骨骼管的顶点离它自己那根骨头有多远；指定骨骼的顶点按区域分布。
用法: python analyze_weights.py <weights.npz> [骨骼名 ...]"""
import sys
import numpy as np
d = np.load(sys.argv[1], allow_pickle=True)
V, W, names, H, T, P = d["V"], d["W"], [str(n) for n in d["names"]], d["heads"], d["tails"], d["parents"]
print("BBOX", V.min(0).round(3), V.max(0).round(3), "verts", len(V))
for i, n in enumerate(names):
    print("B %-22s parent=%-22s head=(%+.3f,%+.3f,%+.3f) tail=(%+.3f,%+.3f,%+.3f) len=%.3f" % (n, names[P[i]] if P[i] >= 0 else "-", *H[i], *T[i], np.linalg.norm(T[i] - H[i])))
dom = W.argmax(1)


def seg_dist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


print("\n每根骨骼：权重>0.3 的顶点离骨头线段的距离（中位数 / 95% / 最大），离得远的多半是错绑")
for i, n in enumerate(names):
    idx = np.where(W[:, i] > 0.3)[0]
    if not len(idx): continue
    dist = seg_dist(V[idx], H[i], T[i])
    print("D %-22s n=%5d  med=%.3f p95=%.3f max=%.3f" % (n, len(idx), np.median(dist), np.percentile(dist, 95), dist.max()))
for bn in sys.argv[2:]:
    i = names.index(bn); idx = np.where(W[:, i] > 0.05)[0]
    print("\n== %s  顶点(>0.05): %d，权重和 %.1f" % (bn, len(idx), W[:, i].sum()))
    # 粗分块：x 三档 × y 八档
    xs = [(-1, -0.06, "右"), (-0.06, 0.06, "中"), (0.06, 1, "左")]
    ys = np.linspace(V[:, 1].min(), V[:, 1].max() + 1e-6, 11)
    for xa, xb, tag in xs:
        for a, b in zip(ys[:-1], ys[1:]):
            sel = idx[(V[idx, 0] >= xa) & (V[idx, 0] < xb) & (V[idx, 1] >= a) & (V[idx, 1] < b)]
            if len(sel):
                # 这些顶点上别的骨骼里谁最大
                Wo = W[sel].copy(); Wo[:, i] = 0; oth = np.bincount(Wo.argmax(1), minlength=len(names)); o = np.argsort(-oth)[:3]
                print("   %s y[%+.2f,%+.2f] n=%4d z[%.2f,%.2f] w_mean=%.2f w_max=%.2f  其余最大: %s" % (tag, a, b, len(sel), V[sel, 2].min(), V[sel, 2].max(), W[sel, i].mean(), W[sel, i].max(), ", ".join(f"{names[k].replace('tripo::','')}:{oth[k]}" for k in o if oth[k])))
