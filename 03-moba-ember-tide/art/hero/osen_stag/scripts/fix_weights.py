#!/usr/bin/env python3
"""修 Tripo 绑骨里的一处错绑：尾巴那根骨骼（bone_24）除了尾巴，还管着吊炉（约一半权重）、左后腿飞节一圈、右前腿前臂一圈。
不修的话：腿一摆，这两圈皮被留在原地，腿上会凹进去；吊炉一半跟着屁股走。
做法（只改 GLB 里的 JOINTS_0 / WEIGHTS_0 两个数组，别的字节不动）：
  · 尾巴上的顶点：不动。
  · 吊炉上的顶点：bone_24 的权重改给胸口那根脊柱骨（Spine_2），吊炉跟着胸口走。
  · 其余顶点：bone_24 的权重改给这个顶点上权重最大的另一根骨骼（腿上的就还给腿）。
用法: python3 fix_weights.py <Tripo 原件.glb> <输出.glb>"""
import json, struct, sys
import numpy as np

src, dst = sys.argv[1:3]
b = bytearray(open(src, "rb").read())
jl, = struct.unpack("<I", b[12:16]); js = json.loads(bytes(b[20:20 + jl])); bin0 = 20 + jl + 8
acc, bvs = js["accessors"], js["bufferViews"]
prim = js["meshes"][0]["primitives"][0]["attributes"]


def view(ai, dtype, ncomp):
    a = acc[ai]; bv = bvs[a["bufferView"]]; assert "byteStride" not in bv
    off = bin0 + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(b, dtype=dtype, count=a["count"] * ncomp, offset=off).reshape(a["count"], ncomp), off


pos, _ = view(prim["POSITION"], "<f4", 3)
J, joff = view(prim["JOINTS_0"], np.uint8, 4)
W, woff = view(prim["WEIGHTS_0"], "<f4", 4)
J = J.copy(); W = W.copy()
names = [js["nodes"][j]["name"] for j in js["skins"][0]["joints"]]
T, S2 = names.index("bone_24"), names.index("tripo::Spine_2")
x, y, z = pos[:, 0], -pos[:, 2], pos[:, 1]                      # glTF（Y 朝上）→ Blender 坐标（Z 朝上，鹿面朝 -Y）
tail = (y > 0.30) & (np.abs(x) < 0.06) & (z > 0.36)
censer = (y < -0.20) & (z < 0.42) & (np.abs(x) < 0.07)
stat = {"尾巴(不动)": 0, "吊炉→Spine_2": 0}
for v in np.where(((J == T) & (W > 0)).any(1))[0]:
    s = int(np.where((J[v] == T) & (W[v] > 0))[0][0]); w = float(W[v, s])
    if tail[v]: stat["尾巴(不动)"] += 1; continue
    if censer[v]: tgt = S2; key = "吊炉→Spine_2"
    else:
        others = [(float(W[v, k]), int(J[v, k])) for k in range(4) if k != s and W[v, k] > 0]
        assert others, f"顶点 {v} 只有 bone_24 一根骨骼"
        tgt = max(others)[1]; key = "→" + names[tgt].replace("tripo::", "")
    stat[key] = stat.get(key, 0) + 1
    hit = [k for k in range(4) if k != s and J[v, k] == tgt and W[v, k] > 0]
    if hit: W[v, hit[0]] += w; W[v, s] = 0.0; J[v, s] = 0
    else: J[v, s] = tgt
assert np.allclose(W.sum(1), 1.0, atol=1e-4)
b[joff:joff + J.nbytes] = J.tobytes(); b[woff:woff + W.nbytes] = W.astype("<f4").tobytes()
open(dst, "wb").write(b)
left = ((J == T) & (W > 0)).any(1)
print("改动统计:", json.dumps(stat, ensure_ascii=False))
print("改完后 bone_24 还管 %d 个顶点，范围 x[%+.2f,%+.2f] y[%+.2f,%+.2f] z[%.2f,%.2f]" % (left.sum(), x[left].min(), x[left].max(), y[left].min(), y[left].max(), z[left].min(), z[left].max()))
print("写好了", dst, len(b), "字节")
