"""bone_24（尾巴骨）到底管了哪些顶点：按空间聚类统计，并打印每团的另一半权重在谁身上。"""
import sys, bpy, numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene
mesh = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
V = np.array([(mesh.matrix_world @ v.co)[:] for v in mesh.data.vertices])
gname = {g.index: g.name for g in mesh.vertex_groups}; names = list(gname.values())
W = np.zeros((len(V), len(names)))
for v in mesh.data.vertices:
    for g in v.groups: W[v.index, names.index(gname[g.group])] = g.weight
for bn in argv[1:]:
    bi = names.index(bn); idx = np.where(W[:, bi] > 0.05)[0]
    print("==", bn, "verts>0.05:", len(idx))
    # 单链接聚类：距离 < 0.03 的连成一团
    P = V[idx]; lab = -np.ones(len(idx), int); c = 0
    for i in range(len(idx)):
        if lab[i] >= 0: continue
        stack = [i]; lab[i] = c
        while stack:
            j = stack.pop(); near = np.where((np.linalg.norm(P - P[j], axis=1) < 0.03) & (lab < 0))[0]
            lab[near] = c; stack.extend(near.tolist())
        c += 1
    for k in range(c):
        m = idx[lab == k]
        if len(m) < 4: continue
        other = W[m].sum(0); other[bi] = 0; order = np.argsort(-other)[:4]
        print("  团 n=%5d x[%+.2f,%+.2f] y[%+.2f,%+.2f] z[%.2f,%.2f] w均值 %.2f 最大 %.2f | 其余: %s" % (
            len(m), V[m, 0].min(), V[m, 0].max(), V[m, 1].min(), V[m, 1].max(), V[m, 2].min(), V[m, 2].max(), W[m, bi].mean(), W[m, bi].max(),
            ", ".join(f"{names[i].replace('tripo::','')}:{other[i] / len(m):.2f}" for i in order if other[i] > 0)))
