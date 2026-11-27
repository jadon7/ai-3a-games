#!/usr/bin/env python3
"""悟空专用：把管线骨架（A 字静止姿态、身高 1）上的动作，换算成游戏模型 wukong.glb 骨架节点的局部旋转，写成只有骨架 + 动画的 GLB。

  python scripts/wukong_retarget.py <dump.npz> <游戏 wukong.glb> <out.glb> <名字> [<名字> ...]

dump.npz 由 scripts/blender/wukong_dump_world.py 产出：stance（凉棚站姿下每根骨骼的世界矩阵）、clip_<名字>（逐帧世界矩阵）、fps_<名字>。
原理：骨骼是刚体。凉棚站姿下管线骨架和游戏骨架是同一个姿势，于是每根骨骼两边的坐标系差一个固定旋转 C_j
（再加两个世界空间之间的一个相似变换，用两边骨骼头部位置拟合出来）。每帧：游戏骨骼世界朝向 = S^T · 管线骨骼世界朝向 · C_j，
再除掉父节点得到局部旋转。和 Blender 的骨骼朝向约定、导入导出的轴向转换都无关。
"""
import json
import struct
import sys

import numpy as np


def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def mat_q(m):
    """3x3 -> (x,y,z,w)"""
    tr = np.trace(m)
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2
        w, x, y, z = 0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w, x, y, z = (m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w, x, y, z = (m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w, x, y, z = (m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s
    q = np.array([x, y, z, w])
    return q / np.linalg.norm(q)


def orth(m):
    u, _, vt = np.linalg.svd(m)
    r = u @ vt
    if np.linalg.det(r) < 0:
        u[:, -1] *= -1
        r = u @ vt
    return r


def load_glb(p):
    b = open(p, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    return json.loads(b[20:20 + n])


def node_worlds(g):
    N = len(g["nodes"])
    par = [-1] * N
    for i, nd in enumerate(g["nodes"]):
        for c in nd.get("children", []):
            par[c] = i
    W = [None] * N

    def get(i):
        if W[i] is None:
            nd = g["nodes"][i]
            M = np.eye(4)
            if "matrix" in nd:
                M = np.array(nd["matrix"]).reshape(4, 4).T
            else:
                M[:3, :3] = qmat(nd.get("rotation", [0, 0, 0, 1])) @ np.diag(nd.get("scale", [1, 1, 1]))
                M[:3, 3] = nd.get("translation", [0, 0, 0])
            W[i] = M if par[i] < 0 else get(par[i]) @ M
        return W[i]

    for i in range(N):
        get(i)
    return np.array(W), par


def umeyama(src, dst):
    """dst ≈ s·R·src + t"""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    a, b = src - mu_s, dst - mu_d
    U, D, Vt = np.linalg.svd(b.T @ a / len(src))
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1
    R = U @ S @ Vt
    s = np.trace(np.diag(D) @ S) / a.var(0).sum()
    return s, R, mu_d - s * R @ mu_s


def main():
    dump_p, game_p, out_p, tags = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
    d = np.load(dump_p, allow_pickle=True)
    vnames = [str(n) for n in d["names"]]
    g = load_glb(game_p)
    Wg, par = node_worlds(g)
    gname = {nd.get("name"): i for i, nd in enumerate(g["nodes"])}
    bones = [n for n in vnames if n in gname]
    assert len(bones) == len(vnames), set(vnames) - set(gname)
    vi = {n: i for i, n in enumerate(vnames)}
    gi = [gname[n] for n in bones]

    # 两个世界空间之间的相似变换：管线世界 = s·S·游戏世界 + t
    st = d["stance"]                                             # (n,4,4)
    pv = st[[vi[n] for n in bones], :3, 3]
    pg = Wg[gi, :3, 3]
    s, S, t = umeyama(pg, pv)
    resid = np.linalg.norm(s * pg @ S.T + t - pv, axis=1)
    print(f"FIT scale {s:.4f}  bone-head residual mean {resid.mean():.5f} max {resid.max():.5f} (管线世界单位，身高 1)")
    Rv_st = np.array([orth(st[vi[n], :3, :3]) for n in bones])
    Rg_rest = np.array([orth(Wg[i, :3, :3]) for i in gi])
    C = np.einsum("bji,jk,bkl->bil", Rv_st, S, Rg_rest)        # Rv^T · S · Rg

    # 输出的节点：游戏 glb 里的骨骼节点 + 骨架节点（去掉网格节点）
    keep = [i for i, nd in enumerate(g["nodes"]) if "mesh" not in nd]
    remap = {o: k for k, o in enumerate(keep)}
    nodes = []
    for o in keep:
        nd = {k: v for k, v in g["nodes"][o].items() if k not in ("mesh", "skin")}
        if "children" in nd:
            nd["children"] = [remap[c] for c in nd["children"] if c in remap]
            if not nd["children"]:
                del nd["children"]
        nodes.append(nd)
    roots = [remap[i] for i in g["scenes"][g.get("scene", 0)]["nodes"] if i in remap]

    blob = bytearray()
    accessors, views, anims = [], [], []

    def add(arr, typ, minmax=False):
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        while len(blob) % 4:
            blob.append(0)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": arr.nbytes})
        blob.extend(arr.tobytes())
        acc = {"bufferView": len(views) - 1, "componentType": 5126, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            acc["min"] = [float(arr.min())]
            acc["max"] = [float(arr.max())]
        accessors.append(acc)
        return len(accessors) - 1

    hips_v = vi["mixamorig:Hips"]
    hips_g = gname["mixamorig:Hips"]
    hips_parent_W = Wg[par[hips_g]]
    report = {}
    for tag in tags:
        F = d["clip_" + tag]                                     # (T,n,4,4)
        fps = int(d["fps_" + tag])
        T = len(F)
        Rv = np.array([[orth(F[f, vi[n], :3, :3]) for n in bones] for f in range(T)])
        Rg = np.einsum("ji,tbjk,bkl->tbil", S, Rv, C)            # S^T · Rv · C
        Rg_by_node = {gi[b]: Rg[:, b] for b in range(len(bones))}
        times = np.arange(T, dtype=np.float32) / fps
        tin = add(times, "SCALAR", minmax=True)
        chans, samplers = [], []
        worst = 0.0
        for b, n in enumerate(bones):
            j = gi[b]
            p = par[j]
            Rp = Rg_by_node[p] if p in Rg_by_node else np.repeat(orth(Wg[p, :3, :3])[None], T, 0)
            L = np.einsum("tji,tjk->tik", Rp, Rg[:, b])
            q = np.array([mat_q(m) for m in L])
            for f in range(1, T):
                if np.dot(q[f], q[f - 1]) < 0:
                    q[f] = -q[f]
            if j != hips_g:
                rest_q = np.array(g["nodes"][j].get("rotation", [0, 0, 0, 1]))
                worst = max(worst, float(np.degrees(2 * np.arccos(np.clip(np.abs(q @ rest_q), 0, 1))).max()))
            samplers.append({"input": tin, "output": add(q, "VEC4"), "interpolation": "LINEAR"})
            chans.append({"sampler": len(samplers) - 1, "target": {"node": remap[j], "path": "rotation"}})
        # 胯的位移（游戏里目前只用旋转轨，这条留给别的用途）：管线世界 → 游戏世界 → 胯的父节点空间
        ph = F[:, hips_v, :3, 3]
        pgw = (ph - t) @ S / s
        inv = np.linalg.inv(hips_parent_W)
        loc = (np.c_[pgw, np.ones(T)] @ inv.T)[:, :3]
        samplers.append({"input": tin, "output": add(loc, "VEC3"), "interpolation": "LINEAR"})
        chans.append({"sampler": len(samplers) - 1, "target": {"node": remap[hips_g], "path": "translation"}})
        anims.append({"name": tag, "channels": chans, "samplers": samplers})
        report[tag] = {"frames": T, "fps": fps, "duration": round((T - 1) / fps, 3), "max_dev_from_rest_deg": round(worst, 1)}
        print("CLIP", tag, json.dumps(report[tag]))

    # 自检：站姿那一帧换算回来应当正好是游戏骨架的静止姿态
    Rg0 = np.einsum("ji,bjk,bkl->bil", S, Rv_st, C)
    err0 = max(float(np.abs(Rg0[b] - Rg_rest[b]).max()) for b in range(len(bones)))
    print("SELFCHECK stance->rest max matrix err", err0)

    while len(blob) % 4:
        blob.append(0)
    gltf = {"asset": {"version": "2.0", "generator": "video2rig wukong_retarget.py"}, "scene": 0,
            "scenes": [{"name": "Scene", "nodes": roots}], "nodes": nodes,
            "buffers": [{"byteLength": len(blob)}], "bufferViews": views, "accessors": accessors, "animations": anims}
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(out_p, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    json.dump(report, open(out_p + ".report.json", "w"), indent=1)
    print("WROTE", out_p, total, "bytes")


if __name__ == "__main__":
    main()
