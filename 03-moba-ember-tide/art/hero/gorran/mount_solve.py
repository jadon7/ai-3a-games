"""算盾在 build.json 里该填的 rot 和 offset：让盾在站姿下竖直、盾面水平朝外、前臂贴在盾的背面（前臂落在盾的平面里，不从盾面穿出去）。

hero_build.py 是在静止姿势下把盾装到前臂上的（装在哪、朝哪由静止姿势里的手背方向定），站姿下前臂怎么拧是解出来的，
所以直接填角度只能靠猜。这里反过来算：先看站姿下前臂在哪、朝哪，定出盾要在的位置和朝向，再换回静止姿势下的 rot、offset。

用法: Blender -b --factory-startup -P art/hero/gorran/mount_solve.py -- <rigged.glb> <stance.npz> <build.json> [另一份姿势.npz]
“另一份姿势”是模拟出来的“管线会把这个站姿读成什么样”（sim_solve.py 的产出）。同一个站姿，管线解出来的前臂和 hero_build 摆出来的前臂
位置一样，但绕自己的轴差着几度（葛隆是 8 度），盾就会跟着歪。给了这份姿势，就按两者的中间值装盾：站姿里和管线读出来的动作里各歪一半。
读 build.json 里 mount 是 forearm 的那一项的 "_solve"：gap 盾背面离前臂骨头多远；along 盾心沿前臂往手那边挪多少（0 是前臂中点）；
drop 盾心比前臂低多少；yaw 盾面在“垂直于前臂”的基础上再朝外转几度（正 = 往角色左边转）；tilt 盾顶往后仰几度。
算完把 rot、offset 写回 build.json。
"""
import bpy, sys, math, json
import numpy as np
from mathutils import Vector, Matrix, Quaternion
src, pose_path, cfg_path = sys.argv[sys.argv.index("--") + 1:][:3]; other = (sys.argv[sys.argv.index("--") + 1:] + [None])[3]
MX = "mixamorig:"; FWD = Vector((0, -1, 0)); UP = Vector((0, 0, 1))
cfg = json.load(open(cfg_path, encoding="utf-8")); g = next(x for x in cfg["gear"] if x.get("mount") == "forearm"); so = g.get("_solve", {}); side = g["side"]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE"); B = arm.data.bones; PB = arm.pose.bones
# 静止姿势下装盾用的坐标（和 hero_build.py 一样的算法）
h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local; mid1 = B[MX + side + "HandMiddle1"].head_local
L = (idx - pky).normalized(); d0 = (h - fore).normalized(); n = L.cross(d0).normalized()
if n.dot(FWD) < 0: n = -n
fa = B[MX + side + "ForeArm"]; mid = (fa.head_local + fa.tail_local) / 2; d = (fa.tail_local - fa.head_local).normalized(); out = -n; out = (out - d * out.dot(d)).normalized()
M3 = Matrix((d.cross(out), d, out)).transposed()
def apply(path):
    m = np.load(path, allow_pickle=True)
    for pb in PB: pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    for nm, q in zip(m["names"], m["quats"]):
        pb = PB.get(str(nm))
        if pb: pb.rotation_quaternion = Quaternion(q)
    PB[MX + "Hips"].location = Vector(m["loc"]); bpy.context.view_layer.update()
    return PB[MX + side + "ForeArm"].matrix @ fa.matrix_local.inverted(), PB[MX + side + "Hand"].matrix @ B[MX + side + "Hand"].matrix_local.inverted()
A2 = apply(other)[0] if other else None
A_st, AH = apply(pose_path)                                    # 最后停在站姿上
A = A_st.copy()
if A2 is not None:                                             # 前臂的朝向取两份姿势的中间值，位置用站姿的
    w = so.get("blend", 0.5); q = A_st.to_quaternion().slerp(A2.to_quaternion(), w); A = Matrix.Translation(A_st @ mid) @ q.to_matrix().to_4x4() @ Matrix.Translation(-mid)
    print("BLEND 两份姿势的前臂朝向差", round(math.degrees(A_st.to_quaternion().rotation_difference(A2.to_quaternion()).angle), 1), "度，取", w)
RA = A.to_3x3()
dw = (RA @ d).normalized(); midw = A @ mid
zt = dw.cross(UP); zt.z = 0; zt.normalize()
if zt.dot(FWD) < 0: zt = -zt                                   # 盾面朝前的那一边
zt = Matrix.Rotation(math.radians(so.get("yaw", 0)), 3, "Z") @ zt
xt = UP.cross(zt).normalized(); Rt = Matrix((xt, UP, zt)).transposed()
Rt = Matrix.Rotation(math.radians(-so.get("tilt", 0)), 3, xt) @ Rt
xt, yt, zt = [Rt.col[i].copy() for i in range(3)]
alongw = (dw - zt * dw.dot(zt)).normalized()
Ot = midw + zt * so.get("gap", 0.06) + alongw * so.get("along", 0.0) - yt * so.get("drop", 0.0)
Radj = (RA @ M3).inverted() @ Rt; e = Radj.to_euler("XYZ")
off = M3.inverted() @ (A.inverted() @ Ot - mid - out * 0.045)
g["rot"] = [round(math.degrees(a), 2) for a in e]; g["offset"] = [round(v, 4) for v in off]
# 前臂和手心在盾自己坐标里的位置（按真正的站姿算），gear.py 按它在盾背面建臂垫和握把
S = Matrix.Translation(mid + out * 0.045) @ M3.to_4x4() @ Matrix.Translation(off) @ Radj.to_4x4(); Si = S.inverted()      # 盾自己的坐标 → 静止姿势
palm = h + (mid1 - h) * 0.7 + n * 0.012; rr = lambda v: [round(x, 4) for x in v]
so["arm"] = [rr(Si @ fa.head_local), rr(Si @ fa.tail_local)]
so["grip"] = [rr(Si @ (A_st.inverted() @ (AH @ palm))), rr(Si.to_3x3() @ (A_st.to_3x3().inverted() @ (AH.to_3x3() @ L)))]; g["_solve"] = so
r = lambda v: [round(x, 3) for x in v]
print("FOREARM 站姿下 中点", r(midw), "方向", r(dw), " 静止时手背方向转到了", r(RA @ out))
print("SHIELD 盾面朝", r(zt), "（偏角色左边", round(math.degrees(math.atan2(zt.x, -zt.y)), 1), "度） 盾心", r(Ot), " 盾面和“手背那一侧”差", round(math.degrees(zt.angle(RA @ out)), 1), "度")
print("SOLVED rot", g["rot"], "offset", g["offset"], "arm", so["arm"], "grip", so["grip"])
json.dump(cfg, open(cfg_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
