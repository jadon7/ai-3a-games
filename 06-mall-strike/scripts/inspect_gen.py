import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
for p in argv:
    before = set(bpy.data.objects); imgs_before = set(bpy.data.images)
    bpy.ops.import_scene.gltf(filepath=p)
    new = [o for o in bpy.data.objects if o not in before]
    print("FILE", p.split("/")[-3], p.split("/")[-1])
    for o in new:
        if o.type == "MESH":
            print("  MESH", o.name, "verts", len(o.data.vertices), "dims", tuple(round(v, 3) for v in o.dimensions), "rot", tuple(round(v,2) for v in o.rotation_euler), "parent", o.parent.name if o.parent else None)
    for im in bpy.data.images:
        if im not in imgs_before: print("  IMG", im.name, im.size[:])
