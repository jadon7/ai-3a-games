import bpy, numpy as np
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_plane_add(size=1)
ob = bpy.context.object
def mk(name, length, normal, extra=None):
    md = ob.modifiers.new(name, 'PARTICLE_SYSTEM'); ps = md.particle_system; st = ps.settings
    st.type = 'HAIR'; st.count = 200
    print('PROP hair_length range', st.bl_rna.properties['hair_length'].hard_min, st.bl_rna.properties['hair_length'].hard_max, 'default', st.bl_rna.properties['hair_length'].default)
    st.hair_length = length
    print('  after set', st.hair_length)
    st.normal_factor = normal
    if extra:
        for k, v in extra.items():
            setattr(st, k, v)
    return ps.name
def measure(tag):
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg)
    for ps in ev.particle_systems:
        L = [sum((p.hair_keys[i + 1].co - p.hair_keys[i].co).length for i in range(len(p.hair_keys) - 1)) for p in ps.particles]
        print('MEAS', tag, ps.name, 'hair_length', round(ps.settings.hair_length, 4), 'normal', round(ps.settings.normal_factor, 4), 'mean', round(float(np.mean(L)), 4), 'settings', ps.settings.name)
mk('A', 0.03, 0.022)
mk('B', 0.03, 1.0)
mk('C', 0.03, 0.022, dict(length_random=0.35, roughness_1=0.014, roughness_1_size=0.08, roughness_endpoint=0.011, roughness_2=0.008, roughness_2_size=0.02))
measure('x')
