import bpy, collections, sys
# count tris by material in props chunk
for name in ("CH_props0", "CH_props1", "CH_plants"):
    o = bpy.data.objects[name]; me = o.data
    c = collections.Counter()
    for p in me.polygons:
        c[me.materials[p.material_index].name] += len(p.vertices) - 2
    print(name, len(me.vertices), c.most_common(30))
