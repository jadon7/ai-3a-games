"""摩珂自己用：从成品模型里量每段动作的时间点。逐帧（每秒 60 次取样）打印右手、杖头、左手的位置和速度。
用法: Blender -b --factory-startup -P art/hero/moko/measure.py -- game.glb 动作,动作 [每几个取样打印一行=3]
fwd 是往前（-Y）多少，单位是身高；时间是成品动作原速的秒数。"""
import bpy, sys, numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]; step = int(argv[2]) if len(argv) > 2 else 3
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); MX = "mixamorig:"; PB = arm.pose.bones
body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
for tr in list(arm.animation_data.nla_tracks): tr.mute = True
names = [s.material.name for s in body.material_slots]; body.data.calc_loop_triangles(); isw = np.zeros(len(body.data.vertices), bool)
for t in body.data.loop_triangles:
    if names[t.material_index].startswith("weapon"): isw[list(t.vertices)] = True
rest = np.array([list(v.co) for v in body.data.vertices]); W = rest[isw]; c = W.mean(0); ax = np.linalg.svd(W - c, full_matrices=False)[2][0]; tt = (W - c) @ ax
if tt[np.argmax(np.linalg.norm(W - c - np.outer(tt, ax), axis=1))] < 0: ax = -ax; tt = -tt      # 月牙伸出去的那一头是杖头
wi = np.where(isw)[0]; head_idx = wi[tt > tt.max() - 0.12 * (tt.max() - tt.min())]
fps = sc.render.fps
for an in argv[1].split(","):
    act = bpy.data.actions.get(an); arm.animation_data.action = act
    try: arm.animation_data.action_slot = act.slots[0]
    except Exception as e: print(e)
    f0, f1 = act.frame_range; dur = (f1 - f0) / fps; N = int(round(dur * 60)); rows = []
    for i in range(N + 1):
        t = i / 60; fr = f0 + t * fps; sc.frame_set(int(fr), subframe=fr - int(fr)); dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); ev.to_mesh_clear(); co = co.reshape(-1, 3)
        rows.append((t, np.array(PB[MX + "RightHand"].head), co[head_idx].mean(0), np.array(PB[MX + "LeftHand"].head), PB[MX + "Hips"].head.z))
    R = np.array([r[1] for r in rows]); H = np.array([r[2] for r in rows]); L = np.array([r[3] for r in rows])
    sp = lambda X: np.concatenate([[0], np.linalg.norm(X[2:] - X[:-2], axis=1) * 30, [0]])
    sr, sh, sl = sp(R), sp(H), sp(L)
    print(f"MEAS {an} 时长 {dur:.2f}s | 杖头最快 t={rows[int(sh.argmax())][0]:.2f} ({sh.max():.1f}/s)，杖头最靠前 t={rows[int((-H[:,1]).argmax())][0]:.2f} (fwd {(-H[:,1]).max():.2f})，杖头最低 t={rows[int(H[:,2].argmin())][0]:.2f} (z {H[:,2].min():.2f})，杖头最高 t={rows[int(H[:,2].argmax())][0]:.2f} | 左手最快 t={rows[int(sl.argmax())][0]:.2f}，左手最高 t={rows[int(L[:,2].argmax())][0]:.2f} (z {L[:,2].max():.2f})，左手最靠前 t={rows[int((-L[:,1]).argmax())][0]:.2f} | 胯最低 t={rows[int(np.argmin([r[4] for r in rows]))][0]:.2f}")
    for i in range(0, N + 1, step):
        t, r, h, l, hz = rows[i]
        print("MEAS  %-7s t=%.2f | 右手 x%+.2f fwd%+.2f z%.2f v%4.1f | 杖头 x%+.2f fwd%+.2f z%.2f v%4.1f | 左手 x%+.2f fwd%+.2f z%.2f v%4.1f | 胯高 %.2f" % (an, t, r[0], -r[1], r[2], sr[i], h[0], -h[1], h[2], sh[i], l[0], -l[1], l[2], sl[i], hz))
