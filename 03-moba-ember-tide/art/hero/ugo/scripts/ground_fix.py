"""陷地修正：动作里网格低于地面太多的帧，把整个人（胯的位移）往上抬，抬多少按“最低的顶点比 -TOL 还低多少”算，前后几帧平滑过渡。
只抬不压，不改骨骼旋转。读 hero_motion.py 的产物（motions/<动作>.npz），写到另一个目录（build.json 的 motions 指向那里）。
用法: Blender -b --factory-startup -P ground_fix.py -- <rigged.glb> <输入目录> <输出目录> <动作:容差,动作:容差,…>   没列的动作原样复制
手指按 build.json 的 grip（两只手都 0，手指就是静止姿势）不动，所以这里也不动手指。
"""
import bpy, sys, os, shutil
import numpy as np
from mathutils import Vector, Quaternion
a = sys.argv[sys.argv.index("--") + 1:]
src, din, dout, spec = a[0], a[1], a[2], a[3]
todo = {k: float(v) for k, v in (x.split(":") for x in spec.split(",") if x)}
os.makedirs(dout, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src); sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
PB = arm.pose.bones; MX = "mixamorig:"
for pb in PB: pb.rotation_mode = "QUATERNION"
hips = PB[MX + "Hips"]
Mup = (arm.matrix_world.to_3x3() @ hips.bone.matrix_local.to_3x3()).inverted()
dg = bpy.context.evaluated_depsgraph_get()
for f in sorted(os.listdir(din)):
    if not f.endswith(".npz"): continue
    name = f[:-4]
    if name not in todo: shutil.copy(os.path.join(din, f), os.path.join(dout, f)); continue
    tol = todo[name]
    m = np.load(os.path.join(din, f), allow_pickle=True); names = [str(x) for x in m["names"]]; q = m["quats"]; loc = m["loc"].copy()
    T = len(q); minz = np.zeros(T)
    for t in range(T):
        for i, nm in enumerate(names):
            pb = PB.get(nm)
            if pb is None or "Hand" in nm and any(k in nm for k in ("Index", "Middle", "Ring", "Pinky", "Thumb")): continue
            pb.rotation_quaternion = Quaternion(q[t, i])
        hips.location = Vector(loc[t]); bpy.context.view_layer.update()
        ev = body.evaluated_get(dg); me = ev.to_mesh(); co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        minz[t] = float((np.c_[co, np.ones(len(co))] @ np.array(body.matrix_world).T)[:, 2].min()); ev.to_mesh_clear()
    need = np.clip(-minz - tol, 0, None)
    k = 3; grown = np.array([need[max(0, t - k):t + k + 1].max() for t in range(T)])          # 先往两边各扩 3 帧，再平滑，保证该抬的帧抬够
    w = np.exp(-0.5 * (np.arange(-4, 5) / 1.6) ** 2); w /= w.sum()
    lift = np.convolve(np.pad(grown, 4, mode="edge"), w, mode="valid"); lift = np.maximum(lift, need)
    for t in range(T): loc[t] = np.array(loc[t]) + np.array(Mup @ Vector((0, 0, lift[t])))
    np.savez(os.path.join(dout, f), **{**{k_: m[k_] for k_ in m.files}, "loc": loc})
    print("FIX %-8s 帧 %3d  最低 %.3f（第 %d 帧）  最多抬 %.3f  抬过的帧 %d" % (name, T, minz.min(), int(minz.argmin()), lift.max(), int((lift > 1e-4).sum())))
