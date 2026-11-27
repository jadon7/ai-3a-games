"""量 game.glb 里每段动作：锤头、盾心、手、胯、脚每一帧在哪（用来定出手的时间点），以及隔几帧查一次武器有没有穿进身体、陷进地里。
用法: Blender -b --factory-startup -P art/hero/gorran/measure.py -- <game.glb> <输出.json> [动作名,动作名…（不写就是全部）] [穿模隔几帧查一次=4，0 是不查]
坐标是模型自己的（身高 1，面朝 -Y，所以“往前伸了多少”是 -y）。时间按每秒 30 帧。
"""
import bpy, sys, json, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]; only = [a for a in (argv[2].split(",") if len(argv) > 2 and argv[2] not in ("", "-") else []) if a]; every = int(argv[3]) if len(argv) > 3 else 4
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30      # 先定帧率再导入，导入器按这个把秒换成帧
bpy.ops.import_scene.gltf(filepath=src); sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and len(o.vertex_groups) == 0: bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in sc.objects if o.type == "MESH"); me = body.data; MX = "mixamorig:"; B = arm.data.bones; PB = arm.pose.bones
names = [s.material.name if s.material else "?" for s in body.material_slots]
wv = sorted({v for p in me.polygons if names[p.material_index].startswith("weapon") for v in p.vertices})
gi = {g.name: g.index for g in body.vertex_groups}
grp = lambda vi: max(me.vertices[vi].groups, key=lambda g: g.weight).group
ham = [v for v in wv if grp(v) == gi[MX + "RightHand"]]; shd = [v for v in wv if grp(v) == gi[MX + "LeftForeArm"]]
rest = np.array([me.vertices[v].co[:] for v in range(len(me.vertices))])
hb = B[MX + "RightHand"]; hd = np.linalg.norm(rest[ham] - np.array(hb.head_local), axis=1); head_c = rest[np.array(ham)[hd > hd.max() * 0.62]].mean(0)       # 锤头：离手最远的那一团顶点的中心
shield_c = rest[shd].mean(0)
loc = lambda bone, p: (B[MX + bone].matrix_local.inverted() @ Vector(p))
head_l = loc("RightHand", head_c); shield_l = loc("LeftForeArm", shield_c)
ham_l = np.array([loc("RightHand", rest[v])[:] for v in ham]); shd_l = np.array([loc("LeftForeArm", rest[v])[:] for v in shd])
acts = [a for a in bpy.data.actions if not only or a.name in only]
if not arm.animation_data: arm.animation_data_create()
for tr in list(arm.animation_data.nla_tracks): tr.mute = True
res = {}; dirs = [Vector(d).normalized() for d in ((1, 0.13, 0.07), (-1, 0.11, 0.09), (0.12, 1, 0.05), (0.07, -1, 0.11), (0.09, 0.13, 1), (0.1, 0.07, -1))]
def M(bone): return np.array(arm.matrix_world @ PB[MX + bone].matrix)
def apply(Mx, P): return P @ Mx[:3, :3].T + Mx[:3, 3]
for act in sorted(acts, key=lambda a: a.name):
    arm.animation_data.action = act
    try:
        if getattr(act, "slots", None) and len(act.slots): arm.animation_data.action_slot = act.slots[0]
    except Exception: pass
    f0, f1 = int(round(act.frame_range[0])), int(round(act.frame_range[1])); rows = []; clip = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f); bpy.context.view_layer.update(); Mh, Ms = M("RightHand"), M("LeftForeArm")
        hp = apply(Mh, np.array(head_l)[None])[0]; sp = apply(Ms, np.array(shield_l)[None])[0]; hw = apply(Mh, ham_l); sw = apply(Ms, shd_l)
        rows.append({"f": f - f0, "锤头": [round(float(v), 3) for v in hp], "盾心": [round(float(v), 3) for v in sp], "右手": [round(float(v), 3) for v in M("RightHand")[:3, 3]], "左手": [round(float(v), 3) for v in M("LeftHand")[:3, 3]],
                     "胯高": round(float(M("Hips")[2, 3]), 3), "脚最低": round(float(min(M("LeftFoot")[2, 3], M("RightFoot")[2, 3], M("LeftToeBase")[2, 3], M("RightToeBase")[2, 3])), 3),
                     "锤最低": round(float(hw[:, 2].min()), 3), "盾最低": round(float(sw[:, 2].min()), 3), "头": [round(float(v), 3) for v in M("Head")[:3, 3]]})
        if every and (f - f0) % every == 0:
            dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); em = ev.to_mesh(); em.calc_loop_triangles(); co = [body.matrix_world @ v.co for v in em.vertices]
            tree = BVHTree.FromPolygons(co, [tuple(t.vertices) for t in em.loop_triangles if not names[t.material_index].startswith("weapon")]); cnt = {"锤": 0, "盾": 0}
            for part, vs in (("锤", ham[::2]), ("盾", shd[::2])):
                for vi in vs:
                    p = co[vi]; votes = 0
                    for d in dirs:
                        n = 0; o = p.copy()
                        for _ in range(40):
                            hit = tree.ray_cast(o, d)
                            if hit[0] is None: break
                            n += 1; o = hit[0] + d * 1e-4
                        votes += n % 2
                    if votes >= 4: cnt[part] += 1
            clip.append({"f": f - f0, "锤在身体里": round(cnt["锤"] / len(ham[::2]), 3), "盾在身体里": round(cnt["盾"] / len(shd[::2]), 3)}); ev.to_mesh_clear()
    P = np.array([r["锤头"] for r in rows]); v = np.zeros(len(P)); v[1:-1] = np.linalg.norm(P[2:] - P[:-2], axis=1) * 15; S = np.array([r["盾心"] for r in rows]); vs_ = np.zeros(len(S)); vs_[1:-1] = np.linalg.norm(S[2:] - S[:-2], axis=1) * 15
    info = {"帧数": len(rows), "秒": round((len(rows) - 1) / 30, 2), "锤头最快": [int(v.argmax()), round(float(v.max()), 2)], "锤头最低": [int(P[:, 2].argmin()), round(float(P[:, 2].min()), 3)], "锤头最高": [int(P[:, 2].argmax()), round(float(P[:, 2].max()), 3)],
            "锤头最靠前": [int(P[:, 1].argmin()), round(float(-P[:, 1].min()), 3)], "盾心最快": [int(vs_.argmax()), round(float(vs_.max()), 2)], "盾心最靠前": [int(S[:, 1].argmin()), round(float(-S[:, 1].min()), 3)], "盾心最高": [int(S[:, 2].argmax()), round(float(S[:, 2].max()), 3)],
            "胯最低": [int(np.argmin([r["胯高"] for r in rows])), min(r["胯高"] for r in rows)], "胯最高": [int(np.argmax([r["胯高"] for r in rows])), max(r["胯高"] for r in rows)], "脚最低": min(r["脚最低"] for r in rows), "锤陷地最深": min(r["锤最低"] for r in rows), "盾陷地最深": min(r["盾最低"] for r in rows)}
    if clip: info["锤穿身最多"] = max((c["锤在身体里"], c["f"]) for c in clip); info["盾穿身最多"] = max((c["盾在身体里"], c["f"]) for c in clip)
    res[act.name] = {"汇总": info, "每帧": rows, "锤头速度": [round(float(x), 2) for x in v], "盾心速度": [round(float(x), 2) for x in vs_], "穿模": clip}
    print("ACT", act.name, json.dumps(info, ensure_ascii=False))
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False)
print("SAVED", out)
