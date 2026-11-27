"""跑步的左腿用右腿镜像、错开半个周期重建（只动左腿四节：UpLeg、Leg、Foot、ToeBase）。

毛病：侧面机位从角色右边拍，左腿一直被右腿挡着，读出来的左腿整个周期都没踩到地（最低 0.10，右脚是 0.05），
落地的那一下又往后蹬得特别快，游戏里量出来左脚“反推原速”17.9、右脚 10.3，左脚打滑得厉害。右腿看得清，解得是对的。
做法：在骨架空间里取右腿各节在 t + 半周期 的朝向，左右镜像（x 取反），再补上左右骨骼静止时绕骨骼轴的滚转差，
按“只给朝向、关节位置跟着父骨骼”写回左腿的局部旋转。胯、躯干、手臂不动。
用法: Blender -b --factory-startup -P mirror_legs.py -- <rigged.glb> <输入 run.npz> <输出 run.npz>
输入是 hero_motion.py 出的循环（最后一帧等于第一帧）。
"""
import bpy, sys
import numpy as np
from mathutils import Matrix, Quaternion, Vector
a = sys.argv[sys.argv.index("--") + 1:]
src, fin, fout = a[0], a[1], a[2]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src); sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE"); PB = arm.pose.bones; B = arm.data.bones; MX = "mixamorig:"
for pb in PB: pb.rotation_mode = "QUATERNION"
upd = bpy.context.view_layer.update
m = np.load(fin, allow_pickle=True); names = [str(x) for x in m["names"]]; q = m["quats"].copy(); loc = m["loc"]
T = len(q); P = T - 1                                             # 最后一帧是第一帧的重复
CH = ["UpLeg", "Leg", "Foot", "ToeBase"]
S = Matrix.Diagonal((-1, 1, 1))
C = {n: (B[MX + "Left" + n].matrix_local.to_3x3().transposed() @ (S @ B[MX + "Right" + n].matrix_local.to_3x3() @ S)).transposed() for n in CH}


def pose(t):
    for i, nm in enumerate(names):
        pb = PB.get(nm)
        if pb is not None: pb.rotation_quaternion = Quaternion(q[t, i])
    PB[MX + "Hips"].location = Vector(loc[t]); upd()


R = {n: [] for n in CH}
for t in range(P):
    pose(t)
    for n in CH: R[n].append(PB[MX + "Right" + n].matrix.to_3x3().to_quaternion())
out = q.copy()
for t in range(P):
    pose(t); s = (t + P / 2) % P; f0 = int(np.floor(s)); f1 = (f0 + 1) % P; fr = s - f0
    for n in CH:
        rq = R[n][f0].slerp(R[n][f1], fr) if R[n][f0].dot(R[n][f1]) >= 0 else R[n][f0].slerp(-R[n][f1], fr)
        Rm = S @ rq.to_matrix() @ S @ C[n]
        pb = PB[MX + "Left" + n]; h = pb.head.copy(); pb.matrix = Matrix.Translation(h) @ Rm.to_4x4(); upd()
        out[t, names.index(MX + "Left" + n)] = list(pb.rotation_quaternion)
out[P] = out[0]
np.savez(fout, **{**{k: m[k] for k in m.files}, "quats": out})
print("MIRROR", fin, "->", fout, "frames", T, "period", P)
