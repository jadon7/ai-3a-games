"""列出模型里的 UV 岛（glTF 导入时按接缝拆开的连通块），给出每块的位置、大小和主要权重，用来认出肩甲、盔的那几块。
用法: Blender -b --factory-startup -P art/hero/seren/weights/islands.py -- <glb> <out.json>"""
import bpy, bmesh, sys, json, numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
o = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
to_arm = arm.matrix_world.inverted() @ o.matrix_world
V = np.array([list(to_arm @ v.co) for v in o.data.vertices]); names = [g.name.replace("mixamorig:", "") for g in o.vertex_groups]
W = np.zeros((len(V), len(names)))
for v in o.data.vertices:
    for g in v.groups: W[v.index, g.group] = g.weight
mat = np.zeros(len(V), int)
for p in o.data.polygons:
    for vi in p.vertices: mat[vi] = p.material_index
bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
# 位置相同的顶点（接缝两边）算同一个点，这样整块网格是连起来的；这里只按边连，拿到的就是 UV 岛
seen = set(); comps = []
for v in bm.verts:
    if v.index in seen: continue
    st = [v]; seen.add(v.index); c = []
    while st:
        x = st.pop(); c.append(x.index)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y.index not in seen: seen.add(y.index); st.append(y)
    comps.append(c)
out = []
for k, c in enumerate(comps):
    c = np.array(c); P = V[c]; s = W[c].sum(0); top = np.argsort(-s)[:3]
    out.append(dict(id=k, n=len(c), mat=int(np.bincount(mat[c]).argmax()), lo=P.min(0).round(3).tolist(), hi=P.max(0).round(3).tolist(), c=P.mean(0).round(3).tolist(),
                    w={names[i]: round(float(s[i] / len(c)), 2) for i in top if s[i] > 0}, verts=c.tolist()))
json.dump(out, open(argv[1], "w"))
for r in sorted(out, key=lambda r: -r["n"]):
    if r["n"] >= 30: print("ISL %3d n=%5d mat=%d c=%s lo=%s hi=%s w=%s" % (r["id"], r["n"], r["mat"], r["c"], r["lo"], r["hi"], r["w"]))
