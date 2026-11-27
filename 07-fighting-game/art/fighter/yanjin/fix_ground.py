"""脚不入地：读 motions/*.npz（hero_motion.py 的产物），逐帧摆到模型上，脚踝、脚掌、脚尖骨骼的最低点要是低于它们在站姿里的高度（约 0.025），
就把整个人（胯的位移）往上抬到刚好不低于这个高度。只往上抬，不往下压（跳起来的帧不动）。改的是 npz 本身（每次 build.sh 跑完 hero_motion 以后接着跑）。
用法: Blender -b --factory-startup -P fix_ground.py -- <rigged.glb> <motions 目录> [动作 …]"""
import bpy, sys, os
import numpy as np
from mathutils import Quaternion, Vector
argv = sys.argv[sys.argv.index("--") + 1:]; src, d = argv[0], argv[1]; only = set(argv[2:])
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE"); PB = arm.pose.bones; MX = "mixamorig:"; M = arm.matrix_world
for pb in PB: pb.rotation_mode = "QUATERNION"
FEET = [MX + s + n for s in ("Left", "Right") for n in ("Foot", "ToeBase", "Toe_End")]
hips = PB[MX + "Hips"]; R = (M.to_3x3() @ hips.bone.matrix_local.to_3x3())      # 胯的局部位移 → 世界
Rinv = R.inverted(); upd = bpy.context.view_layer.update
FLOOR = 0.024
for fn in sorted(os.listdir(d)):
    if not fn.endswith(".npz"): continue
    name = fn[:-4]
    if only and name not in only: continue
    m = dict(np.load(os.path.join(d, fn), allow_pickle=True)); names = [str(x) for x in m["names"]]; q = m["quats"]; loc = m["loc"].copy()
    idx = [(PB.get(n), i) for i, n in enumerate(names)]; dz = np.zeros(len(q))
    for f in range(len(q)):
        for pb, i in idx:
            if pb is not None: pb.rotation_quaternion = Quaternion(q[f, i])
        hips.location = Vector(loc[f]); upd()
        mz = min((M @ PB[b].head).z for b in FEET); dz[f] = max(0.0, FLOOR - mz)
    nfix = int((dz > 0).sum()); worst = float(dz.max())
    if nfix:                                                   # 前后各一帧平滑（只会抬得更多，不会少），免得一跳一跳
        sm = np.maximum(dz, np.convolve(dz, [0.25, 0.5, 0.25], "same"))
        up = np.array(Rinv @ Vector((0, 0, 1)))
        m["loc"] = loc + sm[:, None] * up[None]; np.savez(os.path.join(d, fn), **m)
    print("GROUND", name, "抬了", nfix, "帧，最多", round(worst, 3))
