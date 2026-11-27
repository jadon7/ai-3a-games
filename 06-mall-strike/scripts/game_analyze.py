import bpy, collections, bmesh
sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()
stats = collections.defaultdict(lambda: [0, 0, 0.0])  # count, tris, area
types = collections.Counter()
mats = collections.Counter()
for ob in sc.objects:
    types[ob.type] += 1
    if ob.type in ("MESH", "FONT"):
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.transform(ob.matrix_world)
        area = sum(p.area for p in me.polygons)
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        cname = ob.users_collection[0].name
        st = stats[cname]; st[0] += 1; st[1] += tris; st[2] += area
        for m in ob.data.materials if ob.type == "MESH" else ob.data.materials:
            if m: mats[m.name] += 1
        ev.to_mesh_clear()
    elif ob.type == "EMPTY" and ob.instance_collection:
        c = ob.instance_collection
        tris = 0; area = 0.0
        for o in c.all_objects:
            if o.type == "MESH":
                me = o.data
                tris += sum(len(p.vertices) - 2 for p in me.polygons)
                s = ob.scale[0]
                area += sum(p.area for p in me.polygons) * s * s
        st = stats["INST:" + c.name]; st[0] += 1; st[1] += tris; st[2] += area
print("TYPES", dict(types))
for k, v in sorted(stats.items(), key=lambda kv: -kv[1][1]):
    print(f"{k:40s} n={v[0]:5d} tris={v[1]:9d} area={v[2]:10.1f}")
print("MATS", len(mats), sorted(mats.items(), key=lambda kv: -kv[1])[:80])
lights = [o for o in sc.objects if o.type == "LIGHT"]
print("LIGHTS", len(lights), collections.Counter(o.data.type for o in lights))
