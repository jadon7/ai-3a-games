import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
for p in argv:
    before = set(bpy.data.objects); acts_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=p)
    new = [o for o in bpy.data.objects if o not in before]
    print("FILE", p.split("/")[-1])
    for o in new:
        dims = tuple(round(v, 2) for v in o.dimensions)
        print("  OBJ", o.name, o.type, "dims", dims, "loc", tuple(round(v,2) for v in o.location), "rot", tuple(round(v,2) for v in o.rotation_euler), "scale", tuple(round(v,3) for v in o.scale), "parent", o.parent.name if o.parent else None)
        if o.type == "ARMATURE":
            print("  BONES", len(o.data.bones), [b.name for b in o.data.bones][:70])
        if o.type == "MESH":
            print("  MATS", [m.name for m in o.data.materials], "verts", len(o.data.vertices))
    for a in bpy.data.actions:
        if a in acts_before: continue
        print("  ACTION", a.name, "range", tuple(a.frame_range))
