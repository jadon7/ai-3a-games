"""量 game.glb 里每段动作每一帧的关键点：两只手（中指根）、灯球中心、胯、两只脚踝、最低的网格点（看陷地），用来定出手的时间点。
用法: Blender -b --factory-startup -P measure.py -- <game.glb> <输出.json> [动作名,…] [查最低点隔几帧=2，0 不查]
坐标是模型自己的（身高约 1，面朝 -Y，“往前”是 -y）。时间按每秒 30 帧。打印每段：两手、灯球的最大速度时刻和最靠前时刻。
"""
import bpy, sys, json
import numpy as np
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]
src, out = a[0], a[1]; only = [x for x in (a[2].split(",") if len(a) > 2 and a[2] not in ("", "-") else []) if x]; every = int(a[3]) if len(a) > 3 else 2
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=src); sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and len(o.vertex_groups) == 0: bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in sc.objects if o.type == "MESH"); me = body.data; MX = "mixamorig:"; B = arm.data.bones; PB = arm.pose.bones
names = [s.material.name if s.material else "?" for s in body.material_slots]
lv = sorted({v for p in me.polygons if names[p.material_index].startswith("weapon") for v in p.vertices})
lamp_rest = np.array([me.vertices[v].co[:] for v in lv]).mean(0)
lamp_l = B[MX + "Head"].matrix_local.inverted() @ Vector(lamp_rest)
print("LAMP rest", lamp_rest.round(3), "head bone", [round(x, 3) for x in B[MX + "Head"].head_local])
if not arm.animation_data: arm.animation_data_create()
tracks = list(arm.animation_data.nla_tracks)
for tr in tracks: tr.mute = True
acts = [t for t in tracks if not only or t.name in only]
res = {}
dg = bpy.context.evaluated_depsgraph_get()
for tr in acts:
    st = tr.strips[0]; act = st.action; tr.mute = False; arm.animation_data.action = None
    f0, f1 = int(st.frame_start), int(st.frame_end)
    rows = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        P = lambda n: list(arm.matrix_world @ PB[MX + n].head)
        hm = arm.matrix_world @ PB[MX + "Head"].matrix
        r = {"f": f - f0, "RH": P("RightHandMiddle1"), "LH": P("LeftHandMiddle1"), "lamp": list(hm @ lamp_l), "hips": P("Hips"),
             "LF": P("LeftFoot"), "RF": P("RightFoot"), "LT": P("LeftToeBase"), "RT": P("RightToeBase"), "head": P("Head")}
        if every and (f - f0) % every == 0:
            ev = body.evaluated_get(dg); m = ev.to_mesh(); co = np.empty(len(m.vertices) * 3); m.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
            r["minz"] = float((np.c_[co, np.ones(len(co))] @ np.array(body.matrix_world).T)[:, 2].min()); ev.to_mesh_clear()
        rows.append(r)
    tr.mute = True; res[tr.name] = rows
    def stat(k):
        p = np.array([r[k] for r in rows]); v = np.linalg.norm(np.diff(p, axis=0), axis=1) * 30
        return int(v.argmax()) + 1, float(v.max()), int(p[:, 1].argmin()), float(p[:, 1].min())
    s = " ".join("%s:vmax@%d(%.2f/s) front@%d(y%.2f)" % ((k,) + stat(k)) for k in ("RH", "LH", "lamp"))
    mz = [r["minz"] for r in rows if "minz" in r]
    print("ACT %-8s frames %3d (%.2fs) %s minz %.3f" % (tr.name, len(rows), (len(rows) - 1) / 30, s, min(mz) if mz else 0))
json.dump(res, open(out, "w"))
print("SAVED", out)
