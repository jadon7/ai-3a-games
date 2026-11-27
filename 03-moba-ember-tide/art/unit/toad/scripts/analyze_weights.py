#!/usr/bin/env python3
"""巨蟾：按“我打算怎么分组”检查 Tripo 的权重有没有错绑（某个顶点带着不该管它的那组骨骼的权重）。
用法: V2R/.venv/bin/python scripts/analyze_weights.py weights.npz
坐标是 Tripo 原始坐标：头朝 +X，左侧 +Y。"""
import sys
import numpy as np

d = np.load(sys.argv[1], allow_pickle=True); V, W, names = d["V"], d["W"], [str(n).replace("tripo::", "") for n in d["names"]]
G = {
    "BODY": ["Root", "Head_0", "Spine_0", "Spine_1", "Spine_2", "Spine_3", "1_Right_Limb_0", "bone_38"],
    "HEAD": ["bone_36", "bone_37"],
    "LH": ["0_Right_Limb_%d" % i for i in range(7)] + ["bone_6", "bone_7", "bone_8", "bone_9"],
    "RH": ["0_Left_Limb_%d" % i for i in range(7)] + ["bone_17", "bone_18", "bone_19", "bone_20"],
    "LF": ["bone_%d" % i for i in range(29, 36)],
    "RF": ["bone_39"] + ["1_Left_Limb_%d" % i for i in range(5)],
}
assert sorted(sum(G.values(), [])) == sorted(names), set(names) ^ set(sum(G.values(), []))
gw = {g: W[:, [names.index(b) for b in bs]].sum(1) for g, bs in G.items()}
print("权重和不为 1 的顶点:", int((np.abs(W.sum(1) - 1) > 1e-3).sum()), " 完全没权重的:", int((W.sum(1) < 1e-6).sum()))
for g in G:
    m = gw[g] > 0.02; P = V[m]
    print(f"{g:5s} 顶点 {m.sum():5d}  x[{P[:,0].min():+.2f},{P[:,0].max():+.2f}] y[{P[:,1].min():+.2f},{P[:,1].max():+.2f}] z[{P[:,2].min():.2f},{P[:,2].max():.2f}]")
# 每根骨骼：带它权重的顶点的范围，以及离群的（离这根骨骼的权重质心很远的）
print("\n逐骨骼（w>0.02 的顶点）：")
for j, n in enumerate(names):
    m = W[:, j] > 0.02
    if not m.any(): print(f"  {n:18s} 无"); continue
    P = V[m]; c = (W[m, j:j + 1] * P).sum(0) / W[m, j].sum(); r = np.linalg.norm(P - c, axis=1)
    far = r > max(0.18, 3 * np.median(r))
    print(f"  {n:18s} n={m.sum():5d} wsum={W[:, j].sum():7.1f} 质心({c[0]:+.2f},{c[1]:+.2f},{c[2]:.2f}) 半径中位 {np.median(r):.3f} 最远 {r.max():.3f} 离群 {far.sum()}（权重和 {W[m, j][far].sum():.2f}）")
# 跨组：左右腿互串、腿和头互串
print("\n跨组（两组都 >0.02）的顶点数 / 较小那组的权重和：")
gs = list(G)
for a in range(len(gs)):
    for b in range(a + 1, len(gs)):
        m = (gw[gs[a]] > 0.02) & (gw[gs[b]] > 0.02)
        if m.any():
            P = V[m]; print(f"  {gs[a]}+{gs[b]}: {m.sum():5d}  小的一方权重和 {np.minimum(gw[gs[a]][m], gw[gs[b]][m]).sum():7.2f}  x[{P[:,0].min():+.2f},{P[:,0].max():+.2f}] y[{P[:,1].min():+.2f},{P[:,1].max():+.2f}] z[{P[:,2].min():.2f},{P[:,2].max():.2f}]")
# 位置上明显在某条腿下半截（z<0.10）却带 BODY/HEAD/别的腿权重的
print("\n脚附近（z<0.10）带“不是自己这条腿”的权重：")
quad = {"LH": (V[:, 0] < 0) & (V[:, 1] > 0), "RH": (V[:, 0] < 0) & (V[:, 1] < 0), "LF": (V[:, 0] > 0) & (V[:, 1] > 0), "RF": (V[:, 0] > 0) & (V[:, 1] < 0)}
for g, q in quad.items():
    low = q & (V[:, 2] < 0.10) & (np.abs(V[:, 1]) > 0.15)
    other = 1 - gw[g]
    bad = low & (other > 0.05)
    by = {h: float(gw[h][bad].sum()) for h in G if h != g and gw[h][bad].sum() > 0.01}
    print(f"  {g}: 脚附近顶点 {low.sum()}，其中 {bad.sum()} 个带别组权重 >0.05；别组权重和 {other[low].sum():.2f}；来源 {by}")
    for h in by:
        for b in G[h]:
            s = W[bad, names.index(b)].sum()
            if s > 0.01: print(f"       {h}/{b}: {s:.2f}")
