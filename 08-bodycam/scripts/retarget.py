"""骨骼动作重定向（同为 mixamo 命名的两套骨架，静止姿态和朝向可以不同）。
全部用矩阵运算，不依赖逐骨骼的 depsgraph 更新。
"""
import bpy, re
from mathutils import Vector, Matrix, Quaternion

BODY = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
        "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
        "RightShoulder", "RightArm", "RightForeArm", "RightHand",
        "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
        "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]
# 用来确定肢体方向的子关节
CHILD = {"Hips": "Spine", "Spine": "Spine1", "Spine1": "Spine2", "Spine2": "Neck", "Neck": "Head",
         "LeftShoulder": "LeftArm", "LeftArm": "LeftForeArm", "LeftForeArm": "LeftHand",
         "RightShoulder": "RightArm", "RightArm": "RightForeArm", "RightForeArm": "RightHand",
         "LeftUpLeg": "LeftLeg", "LeftLeg": "LeftFoot", "LeftFoot": "LeftToeBase",
         "RightUpLeg": "RightLeg", "RightLeg": "RightFoot", "RightFoot": "RightToeBase"}


def short(name):
    n = name.split(":")[-1]
    return re.sub(r"_\d+$", "", n)


def bone_map(arm):
    m = {}
    for b in arm.data.bones:
        s = short(b.name)
        if s in BODY and s not in m:
            m[s] = b.name
    return m


def rot_of(m):
    return m.to_3x3().normalized()


def rest_world(arm, bname):
    return arm.matrix_world @ arm.data.bones[bname].matrix_local


def body_frame(arm, bm):
    """由静止姿态的关节位置求身体坐标系（列：右、前、上）。"""
    P = lambda n: (arm.matrix_world @ arm.data.bones[bm[n]].head_local)
    up = (P("Head") - P("Hips")).normalized()
    right = (P("RightArm") - P("LeftArm"))
    right = (right - up * right.dot(up)).normalized()
    fwd = up.cross(right).normalized()
    M = Matrix((right, fwd, up)).transposed()
    return M, P("Hips")


def facing_sign(arm, bm):
    """用脚尖方向判断 fwd 的正负：脚尖朝前。"""
    P = lambda n: (arm.matrix_world @ arm.data.bones[bm[n]].head_local)
    F, _ = body_frame(arm, bm)
    fwd = F.col[1]
    toe = (P("LeftToeBase") - P("LeftFoot"))
    return 1.0 if toe.dot(fwd) > 0 else -1.0


class Retargeter:
    def __init__(self, src, tgt):
        self.src, self.tgt = src, tgt
        self.sm, self.tm = bone_map(src), bone_map(tgt)
        self.names = [n for n in BODY if n in self.sm and n in self.tm]
        Fs, self.hips_s = body_frame(src, self.sm)
        Ft, self.hips_t = body_frame(tgt, self.tm)
        ss, st = facing_sign(src, self.sm), facing_sign(tgt, self.tm)
        # 让两者"前"一致（脚尖方向）
        if ss < 0:
            Fs = Fs @ Matrix(((-1, 0, 0), (0, -1, 0), (0, 0, 1)))
        if st < 0:
            Ft = Ft @ Matrix(((-1, 0, 0), (0, -1, 0), (0, 0, 1)))
        self.Fs, self.Ft = Fs, Ft
        self.G = Fs @ Ft.inverted()          # 把目标静止姿态转到源静止姿态的朝向
        self.src_fwd = Fs.col[1].copy()
        self.src_up = Fs.col[2].copy()
        # 目标骨架矩阵
        self.MW = tgt.matrix_world.copy()
        self.MWr = rot_of(self.MW)
        self.scale_t = self.MW.to_scale().x
        # 源/目标静止世界旋转
        self.Rs_rest = {n: rot_of(rest_world(src, self.sm[n])) for n in self.names}
        self.Rt_rest = {n: rot_of(rest_world(tgt, self.tm[n])) for n in self.names}
        # 肢体方向校正
        self.C = {}
        for n in self.names:
            c = CHILD.get(n)
            if c and c in self.sm and c in self.tm:
                ds = (src.matrix_world @ src.data.bones[self.sm[c]].head_local) - (src.matrix_world @ src.data.bones[self.sm[n]].head_local)
                dt = (tgt.matrix_world @ tgt.data.bones[self.tm[c]].head_local) - (tgt.matrix_world @ tgt.data.bones[self.tm[n]].head_local)
                dt = self.G @ dt
                if ds.length > 1e-6 and dt.length > 1e-6:
                    self.C[n] = dt.normalized().rotation_difference(ds.normalized()).to_matrix()
                    continue
            self.C[n] = Matrix.Identity(3)
        # 手、脚尖、头沿用父级的校正更自然
        for n, p in (("LeftHand", "LeftForeArm"), ("RightHand", "RightForeArm"), ("Head", "Neck"),
                     ("LeftToeBase", "LeftFoot"), ("RightToeBase", "RightFoot")):
            if n in self.C and p in self.C and CHILD.get(n) is None:
                self.C[n] = self.C[p]
        # 目标骨骼层级（按父子顺序）
        self.order = []
        def walk(b):
            self.order.append(b.name)
            for ch in b.children:
                walk(ch)
        for b in tgt.data.bones:
            if b.parent is None:
                walk(b)
        self.t_rest = {b.name: b.matrix_local.copy() for b in tgt.data.bones}
        self.t_parent = {b.name: (b.parent.name if b.parent else None) for b in tgt.data.bones}
        self.rev = {v: k for k, v in self.tm.items()}
        # 髋部高度比例
        gs = self.src_up
        self.h_s = None

    def set_heights(self, h_src, h_tgt):
        self.h_s, self.h_t = h_src, h_tgt

    def read_source(self):
        """读取源骨架当前帧：各骨骼世界旋转 + 髋部世界位置。"""
        mw = self.src.matrix_world
        R = {n: rot_of(mw @ self.src.pose.bones[self.sm[n]].matrix) for n in self.names}
        hips = (mw @ self.src.pose.bones[self.sm["Hips"]].matrix).translation.copy()
        return R, hips

    def solve(self, Rs_pose, hips_world_tgt, base_basis=None):
        """返回 {目标骨骼名: (loc or None, quat)} 的 basis。
        hips_world_tgt：目标髋部应在的世界位置（Vector）。
        base_basis：未映射骨骼的 basis（{name: Matrix4}），默认单位阵。
        """
        out = {}
        pose_arm = {}
        MWi = self.MW.inverted()
        for bn in self.order:
            p = self.t_parent[bn]
            if p is None:
                M = self.t_rest[bn].copy()
            else:
                M = pose_arm[p] @ (self.t_rest[p].inverted() @ self.t_rest[bn])
            n = self.rev.get(bn)
            if n in self.names:
                D = Rs_pose[n] @ self.Rs_rest[n].inverted()
                Rw = D @ self.C[n] @ self.G @ self.Rt_rest[n]
                Ra = self.MWr.inverted() @ Rw
                Mr = M.to_3x3().normalized()
                basis_r = (Mr.inverted() @ Ra)
                q = basis_r.to_quaternion()
                if n == "Hips":
                    pa = MWi @ hips_world_tgt
                    loc = Mr.inverted() @ (pa - M.translation)
                    basis = Matrix.Translation(loc) @ basis_r.to_4x4()
                    out[bn] = (loc, q)
                else:
                    basis = basis_r.to_4x4()
                    out[bn] = (None, q)
                pose_arm[bn] = M @ basis
            else:
                b = base_basis.get(bn) if base_basis else None
                pose_arm[bn] = M @ b if b is not None else M
        self.last_pose_arm = pose_arm
        return out

    def hips_target(self, hips_world_src):
        """把源髋部世界位置换算成目标髋部世界位置（以源骨架原点为地面参考）。"""
        o = self.src.matrix_world.translation
        d = hips_world_src - o
        s = self.h_t / self.h_s
        return Vector((d.x * s, d.y * s, d.z * s))
