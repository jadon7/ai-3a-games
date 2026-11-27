"""给腋下、肋侧那些“静止时藏着、举臂时才露出来”的顶点重定法线，存回 mandrill.blend（只改法线，不动形状、骨骼、权重）。

毛病：游戏里（three.js）法线跟着骨骼线性混合。山魈静止时手臂垂着、上臂和身子长在一起，举过头顶时上臂转了 170 度左右，
腋下那一圈顶点一半跟躯干、一半跟上臂，混出来的法线朝着侧面甚至朝里；这几个顶点又是肋侧那几片被拉长的大三角形的角，
于是整片肋侧的法线都是歪的，游戏的边缘光把它打成两大片浅蓝色（Blender 渲染时法线按变形后的网格重算，看不出来）。
办法：这些顶点的法线不按“静止时的表面”定，而是反过来求——选一个静止法线 n，让它在几个举臂的参考姿势下混合出来的结果尽量等于
那个姿势下真实的表面法线：最小化 a·|n - n0|² + Σ_p |M_p·n - t_p|²（M_p 是这个顶点在姿势 p 下各骨骼旋转按权重的混合，t_p 是真实法线，
a 按“静止时这个顶点露在外面多少”定：露在外面的基本不动，藏在缝里的放开改）。只替换改动超过 12 度的顶点。

用法: Blender -b --factory-startup <mandrill.blend> -P fix_normals.py -- <motion.npz（管线格式，按骨架顺序）> <帧,帧,…> [dry]
"""
import bpy, sys, os
import numpy as np
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, os.path.join(V2R, "scripts/blender"))
import bl_common as bc  # noqa: E402
from v2r import skeleton as sk  # noqa: E402
argv = sys.argv[sys.argv.index("--") + 1:]; npz = argv[0]; frames = [int(v) for v in argv[1].split(",")]; dry = len(argv) > 2 and argv[2] == "dry"
sc = bpy.context.scene; arm, mesh = bc.character(); PB = arm.pose.bones; me = mesh.data; n = len(me.vertices)
skel = sk.Skeleton.load(os.path.join(V2R, "assets/model/mandrill_skeleton.json")); m = np.load(npz, allow_pickle=True); root = skel.names[skel.root]


def set_pose(f):
    for pb in PB: pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    if f is not None:
        for i, nm in enumerate(skel.names): PB[nm].rotation_quaternion = Quaternion(m["quats"][f, i])
        PB[root].location = Vector(m["loc"][f])
    bpy.context.view_layer.update()


def true_normals():
    dg = bpy.context.evaluated_depsgraph_get(); ev = mesh.evaluated_get(dg); em = ev.to_mesh()
    out = np.array([v.normal[:] for v in em.vertices]); co = np.array([v.co[:] for v in em.vertices]); ev.to_mesh_clear(); return out, co


# 现在用的法线（Tripo 给的自定义法线，逐顶点取平均）
set_pose(None)
n0 = np.zeros((n, 3)); cn = me.corner_normals
for li, loop in enumerate(me.loops): n0[loop.vertex_index] += np.array(cn[li].vector[:])
n0 /= np.maximum(np.linalg.norm(n0, axis=1), 1e-9)[:, None]
t_rest, co_rest = true_normals()
# 静止时露在外面多少：沿法线周围打几条射线，0.15 以内没撞上自己就算露着
me.calc_loop_triangles(); tree = BVHTree.FromPolygons([Vector(c) for c in co_rest], [tuple(t.vertices) for t in me.loop_triangles])
rng = np.random.default_rng(0); vis = np.zeros(n)
for i in range(n):
    nn = t_rest[i]; a = np.cross(nn, [0.3, 0.5, 0.8]); a /= np.linalg.norm(a) + 1e-9; b = np.cross(nn, a); free = 0
    for k in range(7):
        d = nn if k == 0 else nn * 0.75 + 0.66 * (np.cos(k * 1.047) * a + np.sin(k * 1.047) * b)
        d = d / np.linalg.norm(d); hit = tree.ray_cast(Vector(co_rest[i] + nn * 2e-3), Vector(d), 0.15)
        free += hit[0] is None
    vis[i] = free / 7
alpha = 0.1 + float(os.environ.get('NFIX_K', 8.0)) * vis ** 2      # 露着的顶点和 8 个参考姿势大致各占一半，两头都不要差太多；藏着的放开改
gname = {g.index: g.name for g in mesh.vertex_groups}; bone_i = {b.name: k for k, b in enumerate(arm.data.bones)}; nb = len(bone_i)
W = np.zeros((n, nb))
for v in me.vertices:
    for g in v.groups:
        if gname[g.group] in bone_i: W[v.index, bone_i[gname[g.group]]] = g.weight
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
A = alpha[:, None, None] * np.eye(3)[None]; B = alpha[:, None] * n0; before = []; refs = []
for f in frames:
    set_pose(f); t_p, _ = true_normals()
    R = np.zeros((nb, 3, 3))
    for pb in PB: R[bone_i[pb.name]] = (np.array(pb.matrix) @ np.linalg.inv(np.array(pb.bone.matrix_local)))[:3, :3]
    M = np.einsum("vb,bij->vij", W, R)                                                   # (n,3,3)
    A += np.einsum("vki,vkj->vij", M, M); B += np.einsum("vki,vk->vi", M, t_p); refs.append((M, t_p))
    s = np.einsum("vij,vj->vi", M, n0); s /= np.maximum(np.linalg.norm(s, axis=1), 1e-9)[:, None]; before.append(np.sum(s * t_p, 1))
new = np.linalg.solve(A, B[..., None])[..., 0]; new /= np.maximum(np.linalg.norm(new, axis=1), 1e-9)[:, None]
change = np.degrees(np.arccos(np.clip(np.sum(new * n0, 1), -1, 1))); pick = change > 12.0
out = n0.copy(); out[pick] = new[pick]
after = []
for M, t_p in refs:
    s = np.einsum("vij,vj->vi", M, out); s /= np.maximum(np.linalg.norm(s, axis=1), 1e-9)[:, None]; after.append(np.sum(s * t_p, 1))
bef, aft = np.min(before, 0), np.min(after, 0)
print(f"NORMFIX 参考帧 {frames}：改了 {int(pick.sum())}/{n} 个顶点（其中静止时基本藏着的 {int((pick & (vis < 0.3)).sum())} 个，露着一半以上的 {int((pick & (vis > 0.5)).sum())} 个）")
print(f"NORMFIX 参考姿势下法线差超过 90 度的顶点: {int((bef < 0).sum())} -> {int((aft < 0).sum())}；超过 60 度的: {int((bef < 0.5).sum())} -> {int((aft < 0.5).sum())}")
ang_rest = np.degrees(np.arccos(np.clip(np.sum(out * t_rest, 1), -1, 1)))
print(f"NORMFIX 静止姿势下露着一半以上的顶点里，和真实法线差超过 40 度的 {int(((ang_rest > 40) & (vis > 0.5)).sum())} 个、超过 60 度的 {int(((ang_rest > 60) & (vis > 0.5)).sum())} 个（原来 {int(((np.degrees(np.arccos(np.clip(np.sum(n0 * t_rest, 1), -1, 1))) > 40) & (vis > 0.5)).sum())} / {int(((np.degrees(np.arccos(np.clip(np.sum(n0 * t_rest, 1), -1, 1))) > 60) & (vis > 0.5)).sum())}）")
print(f"NORMFIX 静止姿势下，改过的顶点和真实法线的夹角: 平均 {np.degrees(np.arccos(np.clip(np.sum(out[pick] * t_rest[pick], 1), -1, 1))).mean():.0f} 度（原来 {np.degrees(np.arccos(np.clip(np.sum(n0[pick] * t_rest[pick], 1), -1, 1))).mean():.0f} 度）")
set_pose(None)
if not dry:
    me.normals_split_custom_set_from_vertices([tuple(v) for v in out]); me.update()
    bpy.ops.wm.save_mainfile(); print("SAVED", bpy.data.filepath)
