"""把身体网格按连通分成几块，列出在脑后/马尾一带的块（顶点数、范围），看马尾是不是独立的一块。"""
import bpy, sys, bmesh
import numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0]); sc = bpy.context.scene
body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups))
bm = bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table(); M = body.matrix_world
comp = [-1] * len(bm.verts); n = 0
for v in bm.verts:
    if comp[v.index] >= 0: continue
    st = [v]; comp[v.index] = n
    while st:
        a = st.pop()
        for e in a.link_edges:
            b = e.other_vert(a)
            if comp[b.index] < 0: comp[b.index] = n; st.append(b)
    n += 1
comp = np.array(comp); co = np.array([M @ v.co for v in bm.verts]); print("COMPONENTS", n)
for c in range(n):
    s = comp == c; mn = co[s].min(0); mx = co[s].max(0)
    if s.sum() > 30 and mx[2] > 0.7: print("COMP", c, s.sum(), mn.round(3), mx.round(3))
np.save(argv[1], comp)
