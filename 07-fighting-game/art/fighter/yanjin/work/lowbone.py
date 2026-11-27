import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); ad = arm.animation_data; tr = {t.name: t for t in ad.nla_tracks}
for spec in argv[1:]:
    a, f = spec.split(":"); act = tr[a].strips[0].action
    for t in ad.nla_tracks: t.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and len(getattr(act, "slots", [])): ad.action_slot = act.slots[0]
    sc.frame_set(int(f)); M = arm.matrix_world
    low = sorted(((M @ pb.head).z, pb.name[10:]) for pb in arm.pose.bones if any(k in pb.name for k in ("Foot", "Toe", "Leg")))[:5]
    print(a, f, [(n, round(z, 3)) for z, n in low])
