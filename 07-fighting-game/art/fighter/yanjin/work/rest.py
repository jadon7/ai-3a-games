import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE"); M = arm.matrix_world
for b in arm.data.bones:
    if any(k in b.name for k in ("Index", "Middle", "Ring", "Pinky", "Thumb")) and not b.name.endswith("1"): continue
    print("B", b.name[10:], [round(v, 3) for v in M @ b.head_local], [round(v, 3) for v in M @ b.tail_local])
