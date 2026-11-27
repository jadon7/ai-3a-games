import bpy
for cn in ('SKY', 'JDY'):
    col = bpy.data.collections.get(cn)
    if not col:
        print(cn, 'MISSING'); continue
    objs = list(col.all_objects)
    print(cn, 'objects:', len(objs))
    for o in objs[:60]:
        l = o.matrix_world.translation; d = o.dimensions
        print(f"   {o.name} [{o.type}] parent={o.parent.name if o.parent else None} loc=({l.x:.0f},{l.y:.0f},{l.z:.0f}) dim=({d.x:.1f},{d.y:.1f},{d.z:.1f}) mods={[m.type for m in o.modifiers][:3]}")
