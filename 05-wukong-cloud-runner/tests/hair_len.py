import bpy, os, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, '..', 'assets', 'char', 'wukong_real.blend'))
body = bpy.data.objects['WK_Body']
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
for ps in ev.particle_systems:
    L = []
    for p in list(ps.particles)[:400]:
        ks = p.hair_keys
        if len(ks) >= 2:
            L.append(sum((ks[i + 1].co - ks[i].co).length for i in range(len(ks) - 1)))
    st = ps.settings
    print('HAIR', ps.name, 'n', len(ps.particles), 'mean len %.4f max %.4f' % (np.mean(L), np.max(L)), '| hair_length', st.hair_length, 'normal', st.normal_factor, 'align', tuple(st.object_align_factor), 'radius_scale', st.radius_scale, 'root', st.root_radius)
print('BODY scale', tuple(body.matrix_world.to_scale()))
