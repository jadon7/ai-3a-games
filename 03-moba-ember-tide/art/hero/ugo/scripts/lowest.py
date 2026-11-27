"""某段动作的某几帧里，哪块肉最低（陷进地里的是哪根骨骼管的顶点）。
用法: Blender -b --factory-startup -P lowest.py -- <game.glb> <动作> <帧,帧,…>
打印每帧：最低点 z、它归哪根骨骼，以及每根骨骼各自最低的几个（只列低于 0.01 的）。
"""
import bpy, sys
import numpy as np
a = sys.argv[sys.argv.index("--") + 1:]
src, act, frames = a[0], a[1], [int(x) for x in a[2].split(",")]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=src); sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and len(o.vertex_groups) == 0: bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in sc.objects if o.type == "MESH"); me = body.data
gname = {g.index: g.name.replace("mixamorig:", "") for g in body.vertex_groups}
dom = np.array([gname[max(v.groups, key=lambda g: g.weight).group] if len(v.groups) else "-" for v in me.vertices])
for tr in arm.animation_data.nla_tracks: tr.mute = tr.name != act
arm.animation_data.action = None
st = next(t for t in arm.animation_data.nla_tracks if t.name == act).strips[0]
dg = bpy.context.evaluated_depsgraph_get()
for f in frames:
    sc.frame_set(int(st.frame_start) + f)
    ev = body.evaluated_get(dg); m = ev.to_mesh(); co = np.empty(len(m.vertices) * 3); m.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    z = (np.c_[co, np.ones(len(co))] @ np.array(body.matrix_world).T)[:, 2]; ev.to_mesh_clear()
    low = {}
    for b in np.unique(dom[z < 0.01]): low[b] = round(float(z[dom == b].min()), 3)
    print("F", f, "minz %.3f" % z.min(), "by", dom[z.argmin()], "below 0.01:", dict(sorted(low.items(), key=lambda kv: kv[1])[:8]))
