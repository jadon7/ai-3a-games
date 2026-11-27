import bpy, sys
from collections import Counter
col = bpy.data.collections.get('ENV')
objs = list(col.all_objects)
print('ENV objects:', len(objs))
c = Counter(o.name.split('.')[0].rstrip('0123456789_') for o in objs)
print('NAME GROUPS:', dict(c.most_common(40)))
def show(o):
    l = o.matrix_world.translation; d = o.dimensions
    return f"{o.name}: loc=({l.x:.0f},{l.y:.0f},{l.z:.0f}) dim=({d.x:.0f},{d.y:.0f},{d.z:.0f}) mods={[m.type for m in o.modifiers][:3]}"
big = [o for o in objs if o.type == 'MESH' and max(o.dimensions) > 25]
print('BIG MESHES:', len(big))
for o in sorted(big, key=lambda o: o.matrix_world.translation.x)[:80]:
    print('  ', show(o))
