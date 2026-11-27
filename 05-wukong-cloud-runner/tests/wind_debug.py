import bpy, sys, os, math
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'assets', 'char'))
import char_lib as cl

def run(label, tweak):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    cape = cl.make_cape((-0.02, 0.2, 1.25), (-0.02, -0.2, 1.25), nx=16, ny=24)
    scene.collection.objects.link(cape)
    wind, turb = cl.add_cloth(cape, collider=None, wind_strength=900, turb_strength=0, frames=(1, 60))
    md = cape.modifiers['Cloth']
    tweak(scene, cape, md, wind, turb)
    bpy.context.view_layer.update()
    for f in range(1, 61):
        scene.frame_set(f)
    ev = cape.evaluated_get(bpy.context.evaluated_depsgraph_get())
    co = np.array([v.co[:] for v in ev.data.vertices])
    ew = md.settings.effector_weights
    print('RES', label, 'bbox', co.min(0).round(2), co.max(0).round(2), '| ew.all', ew.all, 'ew.wind', ew.wind, 'coll', ew.collection, 'shape', wind.field.shape, 'cache', md.point_cache.is_baked, md.point_cache.frame_start, md.point_cache.frame_end)

run('base', lambda *a: None)
def t_plane(scene, cape, md, wind, turb): wind.field.shape = 'PLANE'
run('plane', t_plane)
def t_nosub(scene, cape, md, wind, turb):
    cape.modifiers.remove(cape.modifiers['Subdiv'])
run('nosubdiv', t_nosub)
def t_noself(scene, cape, md, wind, turb):
    md.collision_settings.use_self_collision = False; md.collision_settings.use_collision = False
run('nocollision', t_noself)
def t_nopin(scene, cape, md, wind, turb):
    md.settings.air_damping = 0.0
run('noairdamp', t_nopin)
