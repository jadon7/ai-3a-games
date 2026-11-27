"""纯 numpy 的 GLB 读写：节点层级、动画采样、蒙皮（算网格最低点用）、写“只有骨架 + 动画”的 GLB。

读：支持 KHR_mesh_quantization（整数归一化）和 EXT_meshopt_compression（借 Blender 自带的解码库 libbf_intern_meshopt_bridge.dylib，用 ctypes 调）。
四元数一律 (x, y, z, w)，和 glTF 一致。矩阵是 4x4，列向量。
"""
import ctypes
import json
import os
import struct

import numpy as np

MESHOPT_LIB = "/Applications/Blender.app/Contents/Resources/5.2/scripts/addons_core/io_scene_gltf2/libbf_intern_meshopt_bridge.dylib"
_lib = None


def _meshopt():
    global _lib
    if _lib is None:
        ctypes.CDLL("/Applications/Blender.app/Contents/Resources/lib/libmeshoptimizer.dylib", mode=ctypes.RTLD_GLOBAL)
        _lib = ctypes.CDLL(MESHOPT_LIB)
        for fn in (_lib.decodeVertexBuffer, _lib.decodeIndexBuffer, _lib.decodeIndexSequence):
            fn.restype = ctypes.c_int
            fn.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.POINTER(ctypes.c_ubyte), ctypes.c_size_t]
        for fn in (_lib.decodeFilterOct, _lib.decodeFilterQuat, _lib.decodeFilterExp):
            fn.restype = None
            fn.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t]
    return _lib


# ---------------------------------------------------------------- 数学
def qmat(q):
    q = np.asarray(q, dtype=np.float64)
    x, y, z, w = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    m = np.empty(q.shape[:-1] + (3, 3))
    m[..., 0, 0] = 1 - 2 * (y * y + z * z); m[..., 0, 1] = 2 * (x * y - z * w); m[..., 0, 2] = 2 * (x * z + y * w)
    m[..., 1, 0] = 2 * (x * y + z * w); m[..., 1, 1] = 1 - 2 * (x * x + z * z); m[..., 1, 2] = 2 * (y * z - x * w)
    m[..., 2, 0] = 2 * (x * z - y * w); m[..., 2, 1] = 2 * (y * z + x * w); m[..., 2, 2] = 1 - 2 * (x * x + y * y)
    return m


def mat_q(m):
    """(...,3,3) -> (...,4) xyzw"""
    m = np.asarray(m, dtype=np.float64)
    sh = m.shape[:-2]; m = m.reshape(-1, 3, 3); out = np.empty((len(m), 4))
    for i, a in enumerate(m):
        tr = a[0, 0] + a[1, 1] + a[2, 2]
        if tr > 0:
            s = np.sqrt(tr + 1.0) * 2; out[i] = [(a[2, 1] - a[1, 2]) / s, (a[0, 2] - a[2, 0]) / s, (a[1, 0] - a[0, 1]) / s, 0.25 * s]
        elif a[0, 0] > a[1, 1] and a[0, 0] > a[2, 2]:
            s = np.sqrt(1.0 + a[0, 0] - a[1, 1] - a[2, 2]) * 2; out[i] = [0.25 * s, (a[0, 1] + a[1, 0]) / s, (a[0, 2] + a[2, 0]) / s, (a[2, 1] - a[1, 2]) / s]
        elif a[1, 1] > a[2, 2]:
            s = np.sqrt(1.0 + a[1, 1] - a[0, 0] - a[2, 2]) * 2; out[i] = [(a[0, 1] + a[1, 0]) / s, 0.25 * s, (a[1, 2] + a[2, 1]) / s, (a[0, 2] - a[2, 0]) / s]
        else:
            s = np.sqrt(1.0 + a[2, 2] - a[0, 0] - a[1, 1]) * 2; out[i] = [(a[0, 2] + a[2, 0]) / s, (a[1, 2] + a[2, 1]) / s, 0.25 * s, (a[1, 0] - a[0, 1]) / s]
    out /= np.linalg.norm(out, axis=1, keepdims=True)
    return out.reshape(sh + (4,))


def qmul(a, b):
    ax, ay, az, aw = np.moveaxis(np.asarray(a, float), -1, 0); bx, by, bz, bw = np.moveaxis(np.asarray(b, float), -1, 0)
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], -1)


def qinv(q):
    q = np.array(q, float); q[..., :3] *= -1; return q


def qslerp(a, b, t):
    a = np.asarray(a, float); b = np.asarray(b, float).copy()
    d = np.sum(a * b, -1, keepdims=True); b = np.where(d < 0, -b, b); d = np.abs(d)
    t = np.asarray(t, float)[..., None] if np.ndim(t) else t
    om = np.arccos(np.clip(d, -1, 1)); so = np.sin(om)
    small = so < 1e-6
    w0 = np.where(small, 1 - t, np.sin((1 - t) * om) / np.where(small, 1, so)); w1 = np.where(small, t, np.sin(t * om) / np.where(small, 1, so))
    r = w0 * a + w1 * b
    return r / np.linalg.norm(r, axis=-1, keepdims=True)


def qcontinuous(q):
    q = np.array(q, float)
    for f in range(1, len(q)):
        if np.dot(q[f], q[f - 1]) < 0: q[f] = -q[f]
    return q


def trs(t, q, s):
    M = np.zeros(np.shape(t)[:-1] + (4, 4)); M[..., :3, :3] = qmat(q) * np.asarray(s)[..., None, :]
    M[..., :3, 3] = t; M[..., 3, 3] = 1; return M


def orth(m):
    u, _, vt = np.linalg.svd(m); r = u @ vt
    if np.linalg.det(r) < 0: u[:, -1] *= -1; r = u @ vt
    return r


def umeyama(src, dst):
    """dst ≈ s·R·src + t"""
    mu_s, mu_d = src.mean(0), dst.mean(0); a, b = src - mu_s, dst - mu_d
    U, D, Vt = np.linalg.svd(b.T @ a / len(src)); S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0: S[2, 2] = -1
    R = U @ S @ Vt; s = np.trace(np.diag(D) @ S) / a.var(0).sum()
    return s, R, mu_d - s * R @ mu_s


# ---------------------------------------------------------------- 读
_CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class GLB:
    def __init__(self, path):
        self.path = path
        b = open(path, "rb").read()
        assert b[:4] == b"glTF", path
        n = struct.unpack("<I", b[12:16])[0]
        self.g = json.loads(b[20:20 + n])
        off = 20 + n
        self.bin = b[off + 8:off + 8 + struct.unpack("<I", b[off:off + 4])[0]] if off < len(b) else b""
        self._bv = {}
        g = self.g
        self.nodes = g["nodes"]; N = len(self.nodes)
        self.parent = np.full(N, -1)
        for i, nd in enumerate(self.nodes):
            for c in nd.get("children", []): self.parent[c] = i
        self.name = [nd.get("name", f"node{i}") for i, nd in enumerate(self.nodes)]
        self.idx = {nm: i for i, nm in enumerate(self.name)}
        self.rest_t = np.zeros((N, 3)); self.rest_q = np.tile([0, 0, 0, 1.0], (N, 1)); self.rest_s = np.ones((N, 3))
        for i, nd in enumerate(self.nodes):
            if "matrix" in nd:
                M = np.array(nd["matrix"]).reshape(4, 4).T; sc = np.linalg.norm(M[:3, :3], axis=0)
                self.rest_t[i] = M[:3, 3]; self.rest_s[i] = sc; self.rest_q[i] = mat_q(M[:3, :3] / sc)
            else:
                self.rest_t[i] = nd.get("translation", [0, 0, 0]); self.rest_q[i] = nd.get("rotation", [0, 0, 0, 1]); self.rest_s[i] = nd.get("scale", [1, 1, 1])
        self.order = []                                         # 父在子前
        seen = set()
        def visit(i):
            if i in seen: return
            if self.parent[i] >= 0: visit(self.parent[i])
            seen.add(i); self.order.append(i)
        for i in range(N): visit(i)
        self.anims = {a.get("name", f"anim{k}"): a for k, a in enumerate(g.get("animations", []))}

    def bufferview(self, i):
        if i in self._bv: return self._bv[i]
        bv = self.g["bufferViews"][i]; ext = (bv.get("extensions") or {})
        mo = ext.get("EXT_meshopt_compression") or ext.get("KHR_meshopt_compression")
        if mo:
            assert mo["buffer"] == 0 or len(self.g["buffers"]) > mo["buffer"]
            src = self.bin[mo.get("byteOffset", 0):mo.get("byteOffset", 0) + mo["byteLength"]]
            lib = _meshopt(); out = bytearray(mo["count"] * mo["byteStride"])
            dst = (ctypes.c_ubyte * len(out)).from_buffer(out); sp = (ctypes.c_ubyte * len(src)).from_buffer_copy(src)
            fn = {"ATTRIBUTES": lib.decodeVertexBuffer, "TRIANGLES": lib.decodeIndexBuffer, "INDICES": lib.decodeIndexSequence}[mo["mode"]]
            assert fn(dst, mo["count"], mo["byteStride"], sp, len(src)) == 0, "meshopt decode failed"
            flt = mo.get("filter")
            if mo["mode"] == "ATTRIBUTES" and flt and flt != "NONE":
                {"OCTAHEDRAL": lib.decodeFilterOct, "QUATERNION": lib.decodeFilterQuat, "EXPONENTIAL": lib.decodeFilterExp, "COLOR": lib.decodeFilterExp}[flt](dst, mo["count"], mo["byteStride"])
            data = bytes(out)
        else:
            assert bv.get("buffer", 0) == 0
            o = bv.get("byteOffset", 0); data = self.bin[o:o + bv["byteLength"]]
        self._bv[i] = data
        return data

    def accessor(self, i):
        a = self.g["accessors"][i]; dt = np.dtype(_CT[a["componentType"]]); nc = _NC[a["type"]]; cnt = a["count"]
        if "bufferView" in a:
            bv = self.g["bufferViews"][a["bufferView"]]; data = self.bufferview(a["bufferView"])
            mo = (bv.get("extensions") or {}).get("EXT_meshopt_compression") or (bv.get("extensions") or {}).get("KHR_meshopt_compression")
            stride = (mo["byteStride"] if mo else bv.get("byteStride")) or dt.itemsize * nc
            off = a.get("byteOffset", 0)
            assert stride % dt.itemsize == 0
            flat = np.frombuffer(data, dtype=dt, offset=off, count=(stride * (cnt - 1)) // dt.itemsize + nc)
            arr = np.lib.stride_tricks.as_strided(flat, shape=(cnt, nc), strides=(stride, dt.itemsize)).copy()
        else:
            arr = np.zeros((cnt, nc), dt)
        assert "sparse" not in a, "sparse accessor 不支持"
        arr = arr.astype(np.float64)
        if a.get("normalized"):
            arr = {np.int8: lambda x: np.maximum(x / 127, -1), np.uint8: lambda x: x / 255, np.int16: lambda x: np.maximum(x / 32767, -1), np.uint16: lambda x: x / 65535}[dt.type](arr)
        return arr if nc > 1 else arr[:, 0]

    # -------- 动画
    def anim_duration(self, name):
        a = self.anims[name]; return max(float(self.accessor(s["input"]).max()) for s in a["samplers"])

    def sample(self, name, times):
        """返回 (T,N,3) 平移、(T,N,4) 旋转、(T,N,3) 缩放；没有曲线的节点用静止值"""
        times = np.asarray(times, float); T = len(times); N = len(self.nodes)
        tt = np.repeat(self.rest_t[None], T, 0); qq = np.repeat(self.rest_q[None], T, 0); ss = np.repeat(self.rest_s[None], T, 0)
        a = self.anims[name]
        for ch in a["channels"]:
            tg = ch["target"]; nd = tg.get("node"); path = tg["path"]
            if nd is None or path == "weights": continue
            smp = a["samplers"][ch["sampler"]]; x = self.accessor(smp["input"]); y = self.accessor(smp["output"])
            interp = smp.get("interpolation", "LINEAR")
            if interp == "CUBICSPLINE": y = y.reshape(len(x), 3, -1)[:, 1]
            k = np.clip(np.searchsorted(x, times, side="right") - 1, 0, len(x) - 1); k1 = np.minimum(k + 1, len(x) - 1)
            den = np.where(x[k1] > x[k], x[k1] - x[k], 1); u = np.clip((times - x[k]) / den, 0, 1)
            if interp == "STEP": u = u * 0
            if path == "rotation":
                yq = y / np.linalg.norm(y, axis=1, keepdims=True); qq[:, nd] = qslerp(yq[k], yq[k1], u)
            elif path == "translation": tt[:, nd] = y[k] + (y[k1] - y[k]) * u[:, None]
            elif path == "scale": ss[:, nd] = y[k] + (y[k1] - y[k]) * u[:, None]
        return tt, qq, ss

    def worlds(self, tt, qq, ss):
        """(T,N,…) 局部 -> (T,N,4,4) 世界"""
        L = trs(tt, qq, ss); W = np.empty_like(L)
        for i in self.order:
            p = self.parent[i]; W[:, i] = L[:, i] if p < 0 else W[:, p] @ L[:, i]
        return W

    def rest_worlds(self):
        return self.worlds(self.rest_t[None], self.rest_q[None], self.rest_s[None])[0]

    # -------- 蒙皮
    def skin_data(self, max_verts=6000, seed=0, prims=None):
        """所有带蒙皮网格的顶点（抽样），返回 joints 节点号、逆绑定矩阵、顶点、骨骼索引、权重"""
        sk = self.g["skins"][0]; joints = np.array(sk["joints"])
        ibm = self.accessor(sk["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1) if "inverseBindMatrices" in sk else np.tile(np.eye(4), (len(joints), 1, 1))
        P, J, Wt = [], [], []; k_ = -1
        for nd in self.nodes:
            if "mesh" not in nd or "skin" not in nd: continue
            for pr in self.g["meshes"][nd["mesh"]]["primitives"]:
                at = pr["attributes"]
                if "JOINTS_0" not in at: continue
                k_ += 1
                if prims is not None and k_ not in prims: continue
                P.append(self.accessor(at["POSITION"])); J.append(self.accessor(at["JOINTS_0"]).astype(int)); Wt.append(self.accessor(at["WEIGHTS_0"]))
        P = np.concatenate(P); J = np.concatenate(J); Wt = np.concatenate(Wt)
        # 量化网格的节点可能带缩放/平移（KHR_mesh_quantization 把解量化放在网格节点上）；蒙皮时网格节点变换被忽略，
        # 但解量化矩阵会被 gltfpack 预乘进 inverseBindMatrices，所以这里直接用即可。
        Wt = Wt / np.maximum(Wt.sum(1, keepdims=True), 1e-9)
        if len(P) > max_verts:
            sel = np.random.default_rng(seed).choice(len(P), max_verts, replace=False)
            # 再把各方向的极值点补进来，最低点不会因为抽样漏掉
            ext = np.unique(np.concatenate([np.argsort(P[:, k])[:200] for k in range(3)] + [np.argsort(-P[:, k])[:200] for k in range(3)]))
            sel = np.unique(np.concatenate([sel, ext])); P, J, Wt = P[sel], J[sel], Wt[sel]
        return joints, ibm, P, J, Wt

    def skin(self, W, sd):
        """W (T,N,4,4) 世界矩阵 -> (T,V,3) 蒙皮后的顶点"""
        joints, ibm, P, J, Wt = sd
        Mj = W[:, joints] @ ibm[None]                              # (T,Jn,4,4)
        Ph = np.c_[P, np.ones(len(P))]
        out = np.zeros((W.shape[0], len(P), 3))
        for k in range(J.shape[1]):
            M = Mj[:, J[:, k]]                                     # (T,V,4,4)
            out += Wt[None, :, k, None] * np.einsum("tvij,vj->tvi", M, Ph)[..., :3]
        return out


# ---------------------------------------------------------------- 写
def write_skeleton_glb(src: GLB, out_path, clips, generator="fighting-game tools/generic", keep_skin=True):
    """clips: {名字: {"fps":30, "rot": {节点号: (T,4)}, "trans": {节点号: (T,3)}}}。
    节点（去掉网格）和 src 完全相同（名字、层级、静止 TRS 原样拷贝）。keep_skin 时保留 skin（joints + 逆绑定矩阵），不带网格。"""
    g = src.g
    keep = [i for i, nd in enumerate(g["nodes"]) if "mesh" not in nd and "camera" not in nd]
    remap = {o: k for k, o in enumerate(keep)}
    nodes = []
    for o in keep:
        nd = {k: v for k, v in g["nodes"][o].items() if k not in ("mesh", "skin", "weights", "extras", "extensions")}
        if "children" in nd:
            nd["children"] = [remap[c] for c in nd["children"] if c in remap]
            if not nd["children"]: del nd["children"]
        nodes.append(nd)
    roots = [remap[i] for i in g["scenes"][g.get("scene", 0)]["nodes"] if i in remap]
    blob = bytearray(); accessors, views = [], []

    def add(arr, typ, minmax=False):
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        while len(blob) % 4: blob.append(0)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": arr.nbytes}); blob.extend(arr.tobytes())
        acc = {"bufferView": len(views) - 1, "componentType": 5126, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            acc["min"] = np.atleast_1d(arr.min(0)).astype(float).tolist(); acc["max"] = np.atleast_1d(arr.max(0)).astype(float).tolist()
        accessors.append(acc); return len(accessors) - 1

    skins = []
    if keep_skin and g.get("skins"):
        sk = g["skins"][0]; joints = [remap[j] for j in sk["joints"]]
        ibm = src.accessor(sk["inverseBindMatrices"]).reshape(-1, 16) if "inverseBindMatrices" in sk else np.tile(np.eye(4).T.reshape(16), (len(joints), 1))
        skins = [{"name": sk.get("name", "skin"), "joints": joints, "inverseBindMatrices": add(ibm, "MAT4")}]
    anims = []
    for name, c in clips.items():
        T = max([len(v) for v in c["rot"].values()] + [len(v) for v in c.get("trans", {}).values()])
        tin = add(np.arange(T) / c.get("fps", 30), "SCALAR", minmax=True)
        chans, samplers = [], []
        for path, dct, typ in (("rotation", c["rot"], "VEC4"), ("translation", c.get("trans", {}), "VEC3")):
            for nd, arr in sorted(dct.items()):
                if nd not in remap: continue
                arr = np.asarray(arr, float)
                if path == "rotation": arr = qcontinuous(arr / np.linalg.norm(arr, axis=1, keepdims=True))
                samplers.append({"input": tin, "output": add(arr, typ), "interpolation": "LINEAR"})
                chans.append({"sampler": len(samplers) - 1, "target": {"node": remap[nd], "path": path}})
        anims.append({"name": name, "channels": chans, "samplers": samplers})
    while len(blob) % 4: blob.append(0)
    gl = {"asset": {"version": "2.0", "generator": generator}, "scene": 0, "scenes": [{"name": "Scene", "nodes": roots}],
          "nodes": nodes, "buffers": [{"byteLength": len(blob)}], "bufferViews": views, "accessors": accessors, "animations": anims}
    if skins: gl["skins"] = skins
    js = json.dumps(gl, separators=(",", ":")).encode(); js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total)); f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    os.replace(tmp, out_path)
    return total
