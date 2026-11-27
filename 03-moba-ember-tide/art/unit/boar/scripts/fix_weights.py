#!/usr/bin/env python3
"""修 Tripo 四足绑骨里的两处错绑（只改 GLB 里 JOINTS_0 / WEIGHTS_0 两个数组，别的字节不动）：
  1. bone_21（头上、下巴底下的一根小骨头）还管着左前蹄蹄底一圈（约 110 个顶点，权重 0.3~0.44）：头一动左前蹄底会被拽走。
     → 蹄底这些顶点上 bone_21 的权重改给这个顶点上权重最大的另一根骨骼（就是左前蹄 0_Left_Limb_3）。
  2. tripo::1_Left_Limb_0（名字像腿，其实是尾巴尖）还管着右獠牙上半截和吻部两侧（约 120 个顶点，最大权重 0.92）：
     尾巴不受控，头一甩右獠牙尖会留在屁股那边的运动上，撕开。
     → 头上这些顶点上它的权重改给吻部那根骨骼（bone_24，獠牙的父骨骼）。尾巴尖上的顶点不动。
用法: python3 fix_weights.py <Tripo 原件.glb> <输出.glb>"""
import json, struct, sys
import numpy as np

src, dst = sys.argv[1:3]
b = bytearray(open(src, "rb").read())
jl, = struct.unpack("<I", b[12:16]); js = json.loads(bytes(b[20:20 + jl])); bin0 = 20 + jl + 8
acc, bvs = js["accessors"], js["bufferViews"]
mesh_node = next(n for n in js["nodes"] if "mesh" in n and "skin" in n)
assert len(js["meshes"][mesh_node["mesh"]]["primitives"]) == 1
prim = js["meshes"][mesh_node["mesh"]]["primitives"][0]["attributes"]
assert "JOINTS_1" not in prim
CT = {5121: np.uint8, 5123: np.dtype("<u2"), 5126: np.dtype("<f4")}


def view(ai, ncomp):
    a = acc[ai]; bv = bvs[a["bufferView"]]; assert "byteStride" not in bv or bv["byteStride"] == np.dtype(CT[a["componentType"]]).itemsize * ncomp
    off = bin0 + bv.get("byteOffset", 0) + a.get("byteOffset", 0); dt = CT[a["componentType"]]
    return np.frombuffer(b, dtype=dt, count=a["count"] * ncomp, offset=off).reshape(a["count"], ncomp).copy(), off, dt, a.get("normalized", False)


pos, _, _, _ = view(prim["POSITION"], 3)
J, joff, jdt, _ = view(prim["JOINTS_0"], 4)
W, woff, wdt, wnorm = view(prim["WEIGHTS_0"], 4)
assert wdt == np.dtype("<f4"), wdt
names = [js["nodes"][j]["name"] for j in js["skins"][0]["joints"]]
x, y, z = pos[:, 0], -pos[:, 2], pos[:, 1]                      # glTF（Y 朝上）→ Blender 坐标（Z 朝上，野猪面朝 -Y）
print("POS bbox(Blender 坐标)", np.round([x.min(), y.min(), z.min()], 3), np.round([x.max(), y.max(), z.max()], 3), "verts", len(pos), "joints dtype", jdt)
B21, TAILTIP, SNOUT = names.index("bone_21"), names.index("tripo::1_Left_Limb_0"), names.index("bone_24")
stat = {}


def move(v, s, tgt, key):
    """顶点 v 的第 s 个槽位的权重，改给骨骼 tgt。"""
    w = float(W[v, s]); stat[key] = stat.get(key, 0) + 1
    hit = [k for k in range(4) if k != s and J[v, k] == tgt and W[v, k] > 0]
    if hit: W[v, hit[0]] += w; W[v, s] = 0.0; J[v, s] = 0
    else: J[v, s] = tgt


for v in np.where(((J == B21) & (W > 0)).any(1))[0]:
    if not (y[v] > -0.25 and z[v] < 0.06): stat["bone_21 下巴(不动)"] = stat.get("bone_21 下巴(不动)", 0) + 1; continue
    s = int(np.where((J[v] == B21) & (W[v] > 0))[0][0])
    others = [(float(W[v, k]), int(J[v, k])) for k in range(4) if k != s and W[v, k] > 0]
    assert others, f"顶点 {v} 只有 bone_21 一根骨骼"
    tgt = max(others)[1]; move(v, s, tgt, "bone_21 蹄底→" + names[tgt].replace("tripo::", ""))
for v in np.where(((J == TAILTIP) & (W > 0)).any(1))[0]:
    if y[v] > 0.3: stat["尾巴尖(不动)"] = stat.get("尾巴尖(不动)", 0) + 1; continue
    s = int(np.where((J[v] == TAILTIP) & (W[v] > 0))[0][0])
    if y[v] < -0.3: move(v, s, SNOUT, "尾巴尖骨 头上的→bone_24"); continue
    others = [(float(W[v, k]), int(J[v, k])) for k in range(4) if k != s and W[v, k] > 0]      # 身上零星几个（背上的鬃毛）：还给这个顶点上权重最大的另一根骨骼
    assert others, f"顶点 {v} 只有尾巴尖一根骨骼 {(x[v], y[v], z[v])}"
    tgt = max(others)[1]; move(v, s, tgt, "尾巴尖骨 身上的→" + names[tgt].replace("tripo::", ""))
assert np.allclose(W.sum(1), 1.0, atol=1e-3), np.abs(W.sum(1) - 1).max()
b[joff:joff + J.nbytes] = J.astype(jdt).tobytes(); b[woff:woff + W.nbytes] = W.astype("<f4").tobytes()
open(dst, "wb").write(b)
for T, nm in ((B21, "bone_21"), (TAILTIP, "1_Left_Limb_0")):
    left = ((J == T) & (W > 0)).any(1)
    print("改完后 %s 还管 %d 个顶点，范围 x[%+.2f,%+.2f] y[%+.2f,%+.2f] z[%.2f,%.2f]" % (nm, left.sum(), x[left].min(), x[left].max(), y[left].min(), y[left].max(), z[left].min(), z[left].max()))
print("改动统计:", json.dumps(stat, ensure_ascii=False))
print("写好了", dst, len(b), "字节")
