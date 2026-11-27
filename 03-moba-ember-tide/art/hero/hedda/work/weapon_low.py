import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
mats = [s.material.name for s in body.material_slots]; ad = arm.animation_data
for a in argv[1].split(","):
    act = next(t for t in ad.nla_tracks if t.name == a).strips[0].action
    for t in ad.nla_tracks: t.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and len(act.slots): ad.action_slot = act.slots[0]
    f0, f1 = [int(x) for x in act.frame_range]; lows = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get(); me = body.evaluated_get(dg).to_mesh(); W = body.matrix_world
        wv = set(v for p in me.polygons if mats[p.material_index].startswith("weapon") for v in p.vertices); bz = min((W @ me.vertices[i].co).z for i in range(len(me.vertices)) if i not in wv)
        lows.append((f, round(min((W @ me.vertices[i].co).z for i in wv), 3), round(bz, 3))); body.evaluated_get(dg).to_mesh_clear()
    print("LOW", a, "武器最低", min(l[1] for l in lows), "身体最低", min(l[2] for l in lows), lows[::3])
