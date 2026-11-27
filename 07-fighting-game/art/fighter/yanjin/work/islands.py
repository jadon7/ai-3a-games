import bpy, bmesh, sys
import numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
body = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o.vertex_groups)
me = body.data; M = body.matrix_world
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
seen = np.full(len(bm.verts), -1); isl = []
for v in bm.verts:
    if seen[v.index] >= 0: continue
    st = [v]; seen[v.index] = len(isl); cur = []
    while st:
        u = st.pop(); cur.append(u.index)
        for e in u.link_edges:
            w = e.other_vert(u)
            if seen[w.index] < 0: seen[w.index] = len(isl); st.append(w)
    isl.append(cur)
gn = {g.index: g.name[10:] for g in body.vertex_groups}
co = np.array([M @ v.co for v in me.vertices])
print("ISLANDS", len(isl))
for k, idx in sorted(enumerate(isl), key=lambda x: -len(x[1]))[:40]:
    c = co[idx]; acc = {}
    for i in idx:
        for g in me.vertices[i].groups: acc[gn[g.group]] = acc.get(gn[g.group], 0) + g.weight
    top = sorted(acc.items(), key=lambda x: -x[1])[:4]
    print("I", k, len(idx), "min", c.min(0).round(3).tolist(), "max", c.max(0).round(3).tolist(), [(n, round(w / len(idx), 2)) for n, w in top])
