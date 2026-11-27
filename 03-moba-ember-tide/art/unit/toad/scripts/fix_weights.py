#!/usr/bin/env python3
"""巨蟾：修 Tripo 绑骨里几处小的错绑（只改 GLB 里 JOINTS_0 / WEIGHTS_0 两个数组，别的字节不动）。
  · 左后脚趾骨（0_Right_Limb_6）管着左前脚上 27 个顶点；左前脚骨（bone_32）管着左后脚上几个顶点；1_Left_Limb_4 串到左前脚 1 个。
  · 两根没用的骨骼（1_Right_Limb_0、Head_0，都跟着躯干不动）在两只前脚上有零星权重：腿一动这些点会被留在原地，脚上起刺。
做法：一个顶点上，“腿上的骨骼但顶点不在那条腿的象限里”或者“这两根没用的骨骼”的权重，改给这个顶点上权重最大的正当骨骼。
用法: python3 fix_weights.py <Tripo 原件.glb> <输出.glb>      坐标：Tripo 原始，头朝 +X、左侧 +Y（Blender 的 Z 朝上）。"""
import json, struct, sys
import numpy as np

src, dst = sys.argv[1:3]
b = bytearray(open(src, "rb").read())
jl, = struct.unpack("<I", b[12:16]); js = json.loads(bytes(b[20:20 + jl])); bin0 = 20 + jl + 8
acc, bvs = js["accessors"], js["bufferViews"]
skinned = [m for m in js["meshes"] if any("JOINTS_0" in p["attributes"] for p in m["primitives"])]
assert len(skinned) == 1 and len(skinned[0]["primitives"]) == 1, "预期只有一个带蒙皮的网格、一个图元"
prim = skinned[0]["primitives"][0]["attributes"]
CT = {5121: np.uint8, 5123: "<u2", 5126: "<f4"}


def view(ai, ncomp):
    a = acc[ai]; bv = bvs[a["bufferView"]]; assert "byteStride" not in bv or bv["byteStride"] in (0, np.dtype(CT[a["componentType"]]).itemsize * ncomp)
    off = bin0 + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(b, dtype=CT[a["componentType"]], count=a["count"] * ncomp, offset=off).reshape(a["count"], ncomp), off


pos, _ = view(prim["POSITION"], 3)
J, joff = view(prim["JOINTS_0"], 4); W, woff = view(prim["WEIGHTS_0"], 4)
jdt = J.dtype; J = J.copy(); W = W.astype(np.float64).copy()
names = [js["nodes"][j]["name"].replace("tripo::", "") for j in js["skins"][0]["joints"]]
x, y, z = pos[:, 0], -pos[:, 2], pos[:, 1]                      # glTF（Y 朝上）→ Blender（Z 朝上）
print("顶点", len(pos), "范围 x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]" % (x.min(), x.max(), y.min(), y.max(), z.min(), z.max()), "JOINTS 类型", jdt)
LEG = {
    "LH": (["0_Right_Limb_%d" % i for i in range(7)] + ["bone_6", "bone_7", "bone_8", "bone_9"], (x < 0.02) & (y > -0.02)),
    "RH": (["0_Left_Limb_%d" % i for i in range(7)] + ["bone_17", "bone_18", "bone_19", "bone_20"], (x < 0.02) & (y < 0.02)),
    "LF": (["bone_%d" % i for i in range(29, 36)], (x > -0.05) & (y > -0.02)),
    "RF": (["bone_39"] + ["1_Left_Limb_%d" % i for i in range(5)], (x > -0.05) & (y < 0.02)),
}
JUNK = ["1_Right_Limb_0", "Head_0", "bone_36", "bone_38"]      # 没有（或几乎没有）权重、我也不控制的骨骼；bone_36 是头的支点，不该直接带顶点
bad_of = {}                                                     # 骨骼序号 -> 这根骨骼“不该管”的顶点掩码
for g, (bs, ok) in LEG.items():
    for n in bs: bad_of[names.index(n)] = ~ok
for n in JUNK: bad_of[names.index(n)] = np.ones(len(pos), bool)
stat = {}
for v in range(len(pos)):
    badk = [k for k in range(4) if W[v, k] > 0 and int(J[v, k]) in bad_of and bad_of[int(J[v, k])][v]]
    if not badk: continue
    good = [(W[v, k], k) for k in range(4) if W[v, k] > 0 and k not in badk]
    assert good, f"顶点 {v} 没有正当的骨骼可以接手 {[(names[J[v, k]], W[v, k]) for k in badk]}"
    tk = max(good)[1]
    for k in badk:
        key = names[J[v, k]] + "→" + names[J[v, tk]]; s = stat.setdefault(key, [0, 0.0]); s[0] += 1; s[1] += W[v, k]
        W[v, tk] += W[v, k]; W[v, k] = 0.0; J[v, k] = 0
assert np.allclose(W.sum(1), 1.0, atol=1e-4)
b[joff:joff + J.nbytes] = J.astype(jdt).tobytes(); b[woff:woff + W.astype("<f4").nbytes] = W.astype("<f4").tobytes()
open(dst, "wb").write(b)
for k, (n, w) in sorted(stat.items(), key=lambda kv: -kv[1][1]): print("  %-36s %4d 个顶点，权重和 %.2f" % (k, n, w))
print("共改 %d 处，权重和 %.2f" % (sum(s[0] for s in stat.values()), sum(s[1] for s in stat.values())))
print("写好了", dst, len(b), "字节")
