"""骨架和动作的数学：读 dump_rig.py 的产出、正向运动学（FK）、蒙皮、四元数。retarget.py 和 measure.py 共用。

约定和出品脚本一致：
  · 动作文件（hero_motion.py 的产出）里 quats (T,B,4) 是 Blender 姿势骨骼的 rotation_quaternion（w,x,y,z，相对骨骼自己的静止朝向），
    loc (T,3) 是根骨骼（人形 Hips、四足 role=root 的那根）的 location（骨骼自己的坐标系）。
  · Blender 的姿势矩阵：子骨骼 = 父骨骼姿势 @ (父静止⁻¹ @ 子静止) @ 基础变换（平移 loc、旋转 q）。dump 出来的 rest 已经乘了物体矩阵，
    物体矩阵在相对量里约掉，所以直接在世界坐标里算。
"""
import numpy as np


# ---------- 四元数（w,x,y,z），都支持任意前置维度 ----------
def q2m(q):
    q = q / np.linalg.norm(q, axis=-1, keepdims=True); w, x, y, z = np.moveaxis(q, -1, 0)
    return np.stack([np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], -1),
                     np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], -1),
                     np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1)], -2)


def m2q(m):
    """旋转矩阵 -> 四元数（数值稳的分支写法）"""
    m = np.asarray(m, float); sh = m.shape[:-2]; m = m.reshape(-1, 3, 3); out = np.zeros((len(m), 4))
    for i, r in enumerate(m):
        t = np.trace(r)
        if t > 0:
            s = np.sqrt(t + 1) * 2; out[i] = [0.25 * s, (r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s]
        elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
            s = np.sqrt(1 + r[0, 0] - r[1, 1] - r[2, 2]) * 2; out[i] = [(r[2, 1] - r[1, 2]) / s, 0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s]
        elif r[1, 1] > r[2, 2]:
            s = np.sqrt(1 + r[1, 1] - r[0, 0] - r[2, 2]) * 2; out[i] = [(r[0, 2] - r[2, 0]) / s, (r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s]
        else:
            s = np.sqrt(1 + r[2, 2] - r[0, 0] - r[1, 1]) * 2; out[i] = [(r[1, 0] - r[0, 1]) / s, (r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s]
    out /= np.linalg.norm(out, axis=-1, keepdims=True)
    return out.reshape(*sh, 4)


def continuous(q):
    """相邻两帧取同号，插值不绕远路。q (T,B,4)"""
    q = q.copy()
    for f in range(1, len(q)):
        flip = np.sum(q[f] * q[f - 1], -1) < 0; q[f][flip] *= -1
    return q


def rot_between(a, b):
    """把单位向量 a 转到 b 的最小旋转（3x3）。a、b (...,3)"""
    a = a / np.linalg.norm(a, axis=-1, keepdims=True); b = b / np.linalg.norm(b, axis=-1, keepdims=True)
    v = np.cross(a, b); c = np.sum(a * b, -1); s = np.linalg.norm(v, axis=-1)
    K = np.zeros(a.shape[:-1] + (3, 3)); K[..., 0, 1] = -v[..., 2]; K[..., 0, 2] = v[..., 1]; K[..., 1, 0] = v[..., 2]; K[..., 1, 2] = -v[..., 0]; K[..., 2, 0] = -v[..., 1]; K[..., 2, 1] = v[..., 0]
    I = np.broadcast_to(np.eye(3), K.shape)
    with np.errstate(divide="ignore", invalid="ignore"):
        f = np.where(s > 1e-9, (1 - c) / np.maximum(s * s, 1e-18), 0.5)[..., None, None]
    R = I + K + K @ K * f
    # 正好反向时：绕任意一根垂直轴转 180 度
    anti = c < -0.999999
    if np.any(anti):
        for i in zip(*np.nonzero(anti)) if anti.ndim else [()]:
            ax = np.cross(a[i], [1, 0, 0]);
            if np.linalg.norm(ax) < 1e-6: ax = np.cross(a[i], [0, 1, 0])
            ax /= np.linalg.norm(ax); R[i] = 2 * np.outer(ax, ax) - np.eye(3)
    return R


def axis_angle(axis, ang):
    axis = np.asarray(axis, float); axis = axis / np.linalg.norm(axis); K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * K @ K


def frame(primary, secondary):
    """正交标架：第一列是 primary，第二列是 secondary 去掉 primary 分量后的方向，第三列叉乘。(...,3,3)"""
    a = primary / np.linalg.norm(primary, axis=-1, keepdims=True); b = secondary - a * np.sum(a * secondary, -1, keepdims=True)
    b = b / np.linalg.norm(b, axis=-1, keepdims=True); return np.stack([a, b, np.cross(a, b)], -1)


# ---------- 骨架 ----------
class Rig:
    def __init__(self, path):
        d = np.load(path, allow_pickle=True)
        self.path = path; self.names = [str(x) for x in d["names"]]; self.idx = {n: i for i, n in enumerate(self.names)}
        self.parent = d["parent"].astype(int); self.rest = d["rest"].astype(float); self.head = d["head"].astype(float); self.tail = d["tail"].astype(float)
        self.verts = d["verts"].astype(float); self.widx = d["widx"].astype(int); self.wval = d["wval"].astype(float); self.weapon = d["weapon"].astype(bool); self.ground = float(d["ground"])
        self.B = len(self.names); self.order = self._order()
        self.rest_inv = np.linalg.inv(self.rest)
        self.rel = np.array([self.rest_inv[p] @ self.rest[b] if p >= 0 else self.rest[b] for b, p in enumerate(self.parent)])      # 父静止⁻¹ @ 子静止
        self.Rrest = self.rest[:, :3, :3] / np.linalg.norm(self.rest[:, :3, 0], axis=-1)[:, None, None]      # 去掉缩放的静止朝向
        self.scale = float(np.linalg.norm(self.rest[0, :3, 0]))                  # 四足的 .blend 带整体缩放（v2r_root），人形是 1
        self.height = float(self.verts[:, 2].max() - self.ground)               # 游戏按包围盒的高度把模型放大到 kit.height
        self.children = [[c for c in range(self.B) if self.parent[c] == b] for b in range(self.B)]

    def _order(self):
        done, out = set(), []
        while len(out) < len(self.names):
            for b, p in enumerate(self.parent):
                if b not in done and (p < 0 or p in done): done.add(b); out.append(b)
        return out

    def find(self, *cands):
        """按名字找骨骼（不管 mixamorig: 前缀），找不到返回 None"""
        for c in cands:
            for n in (c, "mixamorig:" + c):
                if n in self.idx: return self.idx[n]
        return None

    def fk(self, quats, loc, root):
        """quats (T,B,4)（按本骨架的骨骼顺序）、loc (T,3) 根骨骼的 location -> 世界矩阵 (T,B,4,4)"""
        T = len(quats); W = np.zeros((T, self.B, 4, 4)); basis = np.zeros((T, self.B, 4, 4)); basis[:, :, :3, :3] = q2m(quats); basis[:, :, 3, 3] = 1
        basis[:, root, :3, 3] = loc
        for b in self.order:
            p = self.parent[b]
            W[:, b] = (W[:, p] if p >= 0 else np.eye(4)) @ self.rel[b] @ basis[:, b]
        return W

    def skin(self, W, mask=None):
        """线性混合蒙皮：W (T,B,4,4) -> 顶点 (T,V,3)。mask 只算一部分顶点"""
        v = self.verts if mask is None else self.verts[mask]; wi = self.widx if mask is None else self.widx[mask]; wv = self.wval if mask is None else self.wval[mask]
        S = W @ self.rest_inv                                                    # 每根骨骼：静止 -> 姿势
        vh = np.concatenate([v, np.ones((len(v), 1))], 1); out = np.zeros((len(W), len(v), 3))
        for k in range(4):
            M = S[:, wi[:, k]]                                                   # (T,V,4,4)
            out += wv[None, :, k, None] * np.einsum("tvij,vj->tvi", M, vh)[..., :3]
        return out

    def dominant(self):
        """每个顶点权重最大的那根骨骼"""
        return self.widx[np.arange(len(self.widx)), self.wval.argmax(1)]

    def subtree(self, b):
        out, st = [], [b]
        while st:
            x = st.pop(); out.append(x); st.extend(self.children[x])
        return out


def load_motion(path):
    m = np.load(path, allow_pickle=True)
    return [str(x) for x in m["names"]], m["quats"].astype(float), m["loc"].astype(float), float(m["fps"])


def to_rig_order(rig, names, quats):
    """动作文件的骨骼顺序 -> 骨架的顺序；动作里没有的骨骼保持静止"""
    T = len(quats); q = np.zeros((T, rig.B, 4)); q[..., 0] = 1
    for i, n in enumerate(names):
        if n in rig.idx: q[:, rig.idx[n]] = quats[:, i]
    return q
