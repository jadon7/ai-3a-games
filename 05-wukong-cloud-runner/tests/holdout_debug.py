import bpy, sys, os
sys.argv = sys.argv[:sys.argv.index('--')] + ['--', 'E', 'none']
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'shots_real'))
import build_real as BR
import numpy as np
scene, S, cols = BR.assemble('E', with_char=False, with_clouds=False, spp=4, pct=25)
scene.render.film_transparent = True
scene.render.use_persistent_data = False
env = cols['ENV']
from collections import Counter
print('DBG types', Counter(o.type for o in env.all_objects))
print('DBG inst', Counter(o.instance_type for o in env.all_objects))
print('DBG children', [c.name for c in env.children_recursive][:20])
def amean(tag):
    fp = os.path.join(BR.ROOT, 'tests', 'hd_%s.png' % tag)
    BR.render_still(scene, fp, rgba=True, depth='8')
    im = bpy.data.images.load(fp)
    px = np.array(im.pixels[:]).reshape(-1, 4)
    print('DBG', tag, 'alpha mean %.3f' % px[:, 3].mean(), flush=True)
    bpy.data.images.remove(im)
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        ob.is_holdout = True
amean('all_mesh_holdout')
