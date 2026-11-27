"""查错绑：每根骨骼权重 > 0.05 的顶点里，有没有离这根骨骼主体（权重 > 0.3 的那些顶点的包围盒）很远的。
用法: python3 weight_outliers.py <rigged.glb>"""
import json, struct, sys
import numpy as np
b = open(sys.argv[1], "rb").read()
jl, = struct.unpack("<I", b[12:16]); js = json.loads(b[20:20 + jl]); bin0 = 20 + jl + 8
acc, bvs = js["accessors"], js["bufferViews"]
CT = {5121: np.uint8, 5123: np.uint16, 5126: np.float32}
def view(ai, ncomp):
    a = acc[ai]; bv = bvs[a["bufferView"]]; dt = np.dtype(CT[a["componentType"]]).newbyteorder("<")
    off = bin0 + bv.get("byteOffset", 0) + a.get("byteOffset", 0); st = bv.get("byteStride", 0)
    if st and st != dt.itemsize * ncomp:
        raw = np.frombuffer(b, np.uint8, count=a["count"] * st, offset=off).reshape(a["count"], st)[:, :dt.itemsize * ncomp]
        return np.frombuffer(raw.tobytes(), dt).reshape(a["count"], ncomp)
    return np.frombuffer(b, dt, count=a["count"] * ncomp, offset=off).reshape(a["count"], ncomp)
names = [js["nodes"][j]["name"] for j in js["skins"][0]["joints"]]
for mi, m in enumerate(js["meshes"]):
    for pi, pr in enumerate(m["primitives"]):
        at = pr["attributes"]
        if "JOINTS_0" not in at: continue
        pos = view(at["POSITION"], 3).astype(float); J = view(at["JOINTS_0"], 4).astype(int); W = view(at["WEIGHTS_0"], 4).astype(float)
        P = np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], 1)          # glTF（Y 朝上）→ Blender 坐标
        print("mesh", mi, pi, "verts", len(P), "bbox", P.min(0).round(3), P.max(0).round(3), "最多几根骨骼/顶点", int((W > 0).sum(1).max()), "有没有 JOINTS_1:", "JOINTS_1" in at)
        for k, n in enumerate(names):
            wk = np.where(J == k, W, 0).sum(1); core = wk > 0.3; any_ = wk > 0.05
            if not core.any():
                if any_.any(): print("  %-22s 只有小权重 n=%d max=%.2f" % (n, any_.sum(), wk.max()))
                continue
            lo, hi = P[core].min(0) - 0.05, P[core].max(0) + 0.05
            far = any_ & ((P < lo) | (P > hi)).any(1)
            if far.any(): print("  %-22s 离群顶点 n=%d 权重最大 %.2f 位置范围 %s ~ %s  （主体 %s ~ %s）" % (n, far.sum(), wk[far].max(), P[far].min(0).round(2), P[far].max(0).round(2), (lo + 0.05).round(2), (hi - 0.05).round(2)))
print("查完")
