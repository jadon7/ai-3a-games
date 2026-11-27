"""不经过 Blender，直接从 glTF 里把第一人称手臂动画逐帧算出来，打印各个零件相对枪身的位移，
用来给一整条动画分段（待机 / 开枪 / 换弹 / 掏枪）以及找"跳帧"的位置。
  .venv/bin/python scripts/vm_clip_probe.py <scene.gltf> <枪身节点> <零件1,零件2,...> [起始秒 结束秒]
"""
import sys, json, os
import numpy as np


def load(path):
    g = json.load(open(path))
    buf = open(os.path.join(os.path.dirname(path), g["buffers"][0]["uri"]), "rb").read()
    CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
    NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def acc(i):
        a = g["accessors"][i]; bv = g["bufferViews"][a["bufferView"]]
        n = NC[a["type"]]; dt = CT[a["componentType"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0); st = bv.get("byteStride", 0)
        if st and st != n * np.dtype(dt).itemsize:
            arr = np.array([np.frombuffer(buf, dt, n, off + k * st) for k in range(a["count"])])
        else:
            arr = np.frombuffer(buf, dt, a["count"] * n, off).reshape(a["count"], n)
        return arr.astype(np.float64)
    return g, acc


def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


class Clip:
    def __init__(self, path):
        self.g, acc = load(path)
        g = self.g
        self.names = [n.get("name", f"n{i}") for i, n in enumerate(g["nodes"])]
        self.parent = [-1] * len(g["nodes"])
        for i, n in enumerate(g["nodes"]):
            for c in n.get("children", []):
                self.parent[c] = i
        self.rest = []
        for n in g["nodes"]:
            if "matrix" in n:
                m = np.array(n["matrix"]).reshape(4, 4).T
                self.rest.append(("M", m))
            else:
                self.rest.append(("TRS", np.array(n.get("translation", [0, 0, 0.0])), np.array(n.get("rotation", [0, 0, 0, 1.0])), np.array(n.get("scale", [1, 1, 1.0]))))
        a = g["animations"][0]
        self.ch = {}
        self.dur = 0
        for c in a["channels"]:
            s = a["samplers"][c["sampler"]]
            t = acc(s["input"])[:, 0]; v = acc(s["output"])
            self.ch[(c["target"]["node"], c["target"]["path"])] = (t, v)
            self.dur = max(self.dur, t[-1])

    def _sample(self, key, tt):
        t, v = self.ch[key]
        if tt <= t[0]: return v[0]
        if tt >= t[-1]: return v[-1]
        i = np.searchsorted(t, tt) - 1; a = (tt - t[i]) / (t[i + 1] - t[i])
        if key[1] == "rotation":
            q0, q1 = v[i], v[i + 1]
            if np.dot(q0, q1) < 0: q1 = -q1
            q = q0 * (1 - a) + q1 * a
            return q / np.linalg.norm(q)
        return v[i] * (1 - a) + v[i + 1] * a

    def local(self, i, tt):
        r = self.rest[i]
        if r[0] == "M" and not any((i, p) in self.ch for p in ("translation", "rotation", "scale")):
            return r[1]
        if r[0] == "M":
            m = r[1]; T = m[:3, 3].copy(); S = np.linalg.norm(m[:3, :3], axis=0); R = m[:3, :3] / S
            # 很少走到这里：带矩阵的节点又有动画
            Q = None
        else:
            T, Q, S = r[1], r[2], r[3]
        if (i, "translation") in self.ch: T = self._sample((i, "translation"), tt)
        if (i, "rotation") in self.ch: Q = self._sample((i, "rotation"), tt)
        if (i, "scale") in self.ch: S = self._sample((i, "scale"), tt)
        m = np.eye(4)
        m[:3, :3] = (qmat(Q) if Q is not None else R) * S
        m[:3, 3] = T
        return m

    def world(self, i, tt, cache=None):
        if cache is not None and i in cache: return cache[i]
        m = self.local(i, tt)
        if self.parent[i] >= 0: m = self.world(self.parent[i], tt, cache) @ m
        if cache is not None: cache[i] = m
        return m

    def idx(self, prefix):
        for i, n in enumerate(self.names):
            if n == prefix: return i
        for i, n in enumerate(self.names):
            if n.startswith(prefix): return i
        raise KeyError(prefix)


if __name__ == "__main__":
    path, base, parts = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
    c = Clip(path)
    t0 = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    t1 = float(sys.argv[5]) if len(sys.argv) > 5 else c.dur
    bi = c.idx(base); pi = [c.idx(p) for p in parts]; lw = c.idx("L_wrist"); rw = c.idx("R_wrist")
    print("dur", c.dur, "base", c.names[bi], "parts", [c.names[i] for i in pi])
    ref = None; prev = None
    n = int(round((t1 - t0) * 30))
    for k in range(n + 1):
        tt = t0 + k / 30
        cache = {}
        B = c.world(bi, tt, cache); Bi = np.linalg.inv(B)
        rel = [(Bi @ c.world(i, tt, cache)) for i in pi]
        L = (Bi @ c.world(lw, tt, cache))[:3, 3]; R = (Bi @ c.world(rw, tt, cache))[:3, 3]
        cur = dict(B=B, rel=rel, L=L, R=R)
        if ref is None: ref = cur
        if prev is None: prev = cur
        sc = np.linalg.norm(B[:3, 0])
        ang = lambda M0, M1: np.degrees(np.arccos(np.clip((np.trace(M0[:3, :3].T @ M1[:3, :3]) / sc / sc - 1) / 2, -1, 1)))
        s = f"t={tt:5.2f} f30={int(round(tt*30)):3d} | base d={np.linalg.norm(B[:3,3]-ref['B'][:3,3])*100:6.1f}cm rot={ang(ref['B'], B):5.1f} v={np.linalg.norm(B[:3,3]-prev['B'][:3,3])*100:5.1f} w={ang(prev['B'], B):5.1f}"
        for nm, r0, r1, rp in zip(parts, ref["rel"], rel, prev["rel"]):
            s += f" | {nm[:6]} {np.linalg.norm(r1[:3,3]-r0[:3,3])/sc*100:5.1f}"
        s += f" | LH {np.linalg.norm(L-ref['L'])/sc*100:5.1f} v={np.linalg.norm(L-prev['L'])/sc*100:5.1f} | RH {np.linalg.norm(R-ref['R'])/sc*100:5.1f} v={np.linalg.norm(R-prev['R'])/sc*100:4.1f}"
        print(s)
        prev = cur
