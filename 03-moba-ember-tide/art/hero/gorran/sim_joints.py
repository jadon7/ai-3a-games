"""模拟“管线会把这个站姿读成什么样”用的第一步：在管线的工程文件里摆成站姿，把管线跟踪的那些关节的位置存出来。
也可以反过来用：给两份姿势（npz），比一比某根骨骼在两份姿势里差多少（绕骨骼自己的轴拧了几度、歪了几度）。
用法: Blender -b --factory-startup <V2R>/assets/model/gorran.blend -P art/hero/gorran/sim_joints.py -- <V2R> <姿势.npz> <输出 joints.npy> [另一份姿势.npz]
"""
import bpy, sys, os, math
import numpy as np
from mathutils import Quaternion, Vector
root, pose_path, out = sys.argv[sys.argv.index("--") + 1:][:3]; other = (sys.argv[sys.argv.index("--") + 1:] + [None])[3]
sys.path.insert(0, os.path.join(root, "scripts/blender"))
import bl_common as bc  # noqa: E402
from v2r import skeleton as sk  # noqa: E402
arm, mesh = bc.character(); skel = sk.Skeleton.load(os.path.join(root, "assets/model/gorran_skeleton.json"))
def apply(path):
    m = np.load(path, allow_pickle=True)
    for pb in arm.pose.bones: pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    for nm, q in zip(m["names"], m["quats"]):
        pb = arm.pose.bones.get(str(nm))
        if pb: pb.rotation_quaternion = Quaternion(q)
    arm.pose.bones["mixamorig:Hips"].location = Vector(m["loc"]); bpy.context.view_layer.update()
    return {pb.name: (arm.matrix_world @ pb.matrix).to_3x3().normalized() for pb in arm.pose.bones}, {pb.name: (arm.matrix_world @ pb.head.to_4d()).to_3d() for pb in arm.pose.bones}
Ra, Ha = apply(pose_path); J = bc.read_joints(arm, skel); np.save(out, J); print("JOINTS", J.shape, "saved", out)
if other:
    Rb, Hb = apply(other)
    for nm in ("LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand", "Spine2", "Hips"):
        k = "mixamorig:" + nm; D = Rb[k] @ Ra[k].inverted(); q = D.to_quaternion(); ax = Ra[k].col[1].normalized()      # 骨骼自己的轴是 Y
        ang = math.degrees(q.angle); twist = math.degrees(2 * math.atan2(Vector(q[1:]).dot(ax), q[0])); twist = (twist + 180) % 360 - 180
        print(f"DIFF {nm:14s} 总共差 {ang:6.1f} 度，其中绕骨骼自己的轴拧了 {twist:6.1f} 度，关节位置差 {(Hb[k] - Ha[k]).length:.3f}")
