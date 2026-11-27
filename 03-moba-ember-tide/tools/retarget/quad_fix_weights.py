"""四足（换画风 B · w-quad 写的）：修 Tripo 四足绑骨的错绑——把某根骨骼在一个方盒子里的那些顶点的权重挪给另一根骨骼。只改 GLB 的 JOINTS_0 / WEIGHTS_0，别的字节不动。

Tripo 的四足绑骨常有这类错：右后脚趾的骨骼管着左后脚内侧的一块、尾巴尖的骨骼管着耳朵上的簇毛（卡兹 B 两处都有）。
不修的话，腿一分开、尾巴一甩，那块皮就被扯成长条。先用 inspect_weights.py 的 box 或者自己按骨骼列顶点分布找出来。

用法: <V2R 的 python> tools/retarget/quad_fix_weights.py <in.glb> <rules.json> <out.glb>
rules.json: [{"from": "骨骼名", "to": "骨骼名", "box": [[xmin,ymin,zmin],[xmax,ymax,zmax]], "note": "为什么"}, …]
  坐标是 Blender 导入后的（Z 朝上，和 inspect_weights.py 打印的一样）；GLB 里是 Y 朝上，这里自己换算（Blender (x,y,z) = GLB (x,-z,y)）。
  只挪 from 的那一份权重（加到 to 上，to 不在这个顶点的四个槽里就占掉 from 的槽），别的骨骼的权重不动。
"""
import json, struct, sys
import numpy as np

src, rules_path, dst = sys.argv[1:4]
rules = json.load(open(rules_path, encoding="utf-8"))
b = bytearray(open(src, "rb").read())
jl, = struct.unpack("<I", b[12:16]); js = json.loads(bytes(b[20:20 + jl])); bin0 = 20 + jl + 8
acc, bvs = js["accessors"], js["bufferViews"]
mesh_nodes = [n for n in js["nodes"] if "mesh" in n]; assert len(mesh_nodes) == 1 and not any(k in mesh_nodes[0] for k in ("matrix", "translation", "rotation", "scale")), "网格节点带变换，坐标换算没写"
prim = js["meshes"][mesh_nodes[0]["mesh"]]["primitives"][0]; skin = js["skins"][mesh_nodes[0]["skin"]]
bone_of = {js["nodes"][j].get("name"): k for k, j in enumerate(skin["joints"])}
DT = {5121: np.uint8, 5123: np.uint16, 5126: np.float32}


def view(ai, ncomp):
    a = acc[ai]; bv = bvs[a["bufferView"]]; assert "byteStride" not in bv or bv["byteStride"] == ncomp * np.dtype(DT[a["componentType"]]).itemsize
    off = bin0 + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(b, dtype=DT[a["componentType"]], count=a["count"] * ncomp, offset=off).reshape(a["count"], ncomp).copy(), off, a


pos, _, _ = view(prim["attributes"]["POSITION"], 3)
J, joff, ja = view(prim["attributes"]["JOINTS_0"], 4)
W, woff, wa = view(prim["attributes"]["WEIGHTS_0"], 4)
assert wa["componentType"] == 5126, "权重不是 float，没写"
P = np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], 1)          # 换成 Blender 的坐标
print("BBOX", P.min(0).round(3).tolist(), P.max(0).round(3).tolist())
for r in rules:
    f, t = bone_of[r["from"]], bone_of[r["to"]]; lo, hi = np.array(r["box"][0]), np.array(r["box"][1])
    inb = np.all((P >= lo) & (P <= hi), 1); moved = 0; wsum = 0.0
    for v in np.where(inb)[0]:
        sf = np.where((J[v] == f) & (W[v] > 0))[0]
        if not len(sf): continue
        s = sf[0]; w = float(W[v, s]); st = np.where((J[v] == t) & (W[v] > 0))[0]
        if len(st): W[v, st[0]] += w; W[v, s] = 0.0
        else: J[v, s] = t
        moved += 1; wsum += w
    print(f"MOVE {r['from']} -> {r['to']}：盒子里 {int(inb.sum())} 个顶点，挪了 {moved} 个（权重合计 {wsum:.1f}）  {r.get('note', '')}")
W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
b[joff:joff + J.nbytes] = J.astype(DT[ja["componentType"]]).tobytes(); b[woff:woff + W.nbytes] = W.astype(np.float32).tobytes()
open(dst, "wb").write(bytes(b)); print("SAVED", dst)
