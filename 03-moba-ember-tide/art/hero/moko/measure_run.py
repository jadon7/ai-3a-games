"""摩珂自己用：量成品跑步动作里落地脚往后蹬的速度（身高每秒）。用法: Blender -b -P measure_run.py -- game.glb"""
import bpy, sys, numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); MX = "mixamorig:"; PB = arm.pose.bones
for tr in list(arm.animation_data.nla_tracks): tr.mute = True
act = bpy.data.actions.get("run"); arm.animation_data.action = act
try: arm.animation_data.action_slot = act.slots[0]
except Exception as e: print(e)
f0, f1 = act.frame_range; fps = sc.render.fps; dur = (f1 - f0) / fps; N = int(round(dur * 120)); rows = []
for i in range(N):
    t = i / 120; fr = f0 + t * fps; sc.frame_set(int(fr), subframe=fr - int(fr)); bpy.context.view_layer.update()
    rows.append([PB[MX + s + b].head.copy() for s in ("Left", "Right") for b in ("Foot", "ToeBase")] + [PB[MX + "Hips"].head.copy()])
A = np.array([[list(v) for v in r] for r in rows])              # (N, 5, 3)
z = np.minimum(A[:, 0, 2] - 0.05, A[:, 1, 2]), np.minimum(A[:, 2, 2] - 0.05, A[:, 3, 2])      # 每只脚离地多高（脚踝比脚掌高 0.05）
vy = [np.gradient(np.concatenate([A[-1:, k, 1], A[:, k, 1], A[:1, k, 1]]))[1:-1] * 120 for k in (1, 3)]      # 前脚掌前后方向的速度，+Y 是往后
out = []
for s in (0, 1):
    on = z[s] < np.percentile(np.concatenate(z), 30)
    if on.any(): out.append((float(vy[s][on].mean()), float(np.percentile(vy[s][on], 50)), int(on.sum())))
    print("RUN", ("左脚", "右脚")[s], "着地取样", int(on.sum()), "后蹬速度 平均 %.2f 中位 %.2f 最大 %.2f 身高/秒" % (vy[s][on].mean(), np.percentile(vy[s][on], 50), vy[s][on].max()), "| 这只脚前后摆幅 %.2f" % (A[:, (1, 3)[s], 1].max() - A[:, (1, 3)[s], 1].min()))
# 一个循环里每只脚落地几次（脚掌高度的极小值个数）
for s in (0, 1):
    zz = np.concatenate([z[s][-1:], z[s], z[s][:1]]); mins = int(((zz[1:-1] < zz[:-2]) & (zz[1:-1] <= zz[2:]) & (zz[1:-1] < np.percentile(z[s], 40))).sum()); print("RUN", ("左脚", "右脚")[s], "一个循环里落地", mins, "次；循环", round(dur, 2), "秒")
print("RUN 平均后蹬 %.2f 身高/秒 → 乘身高 2.6 = %.2f" % (np.mean([o[0] for o in out]), np.mean([o[0] for o in out]) * 2.6))
print("RUN  t    左脚掌 高   前后(+后)   右脚掌 高   前后")
for i in range(0, N, 3): print("RUN %.3f   %.3f  %+.3f      %.3f  %+.3f" % (i / 120, A[i, 1, 2], A[i, 1, 1], A[i, 3, 2], A[i, 3, 1]))
