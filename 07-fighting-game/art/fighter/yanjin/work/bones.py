import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
for o in bpy.context.scene.objects:
    print("OBJ", o.type, o.name, len(o.vertex_groups) if o.type=="MESH" else "")
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
print("BONES", len(arm.data.bones), [b.name for b in arm.data.bones])
for m in bpy.data.materials:
    if m.node_tree:
        for nd in m.node_tree.nodes:
            if nd.type == "TEX_IMAGE" and nd.image: print("TEX", m.name, nd.image.name, tuple(nd.image.size), [l.to_socket.name for l in nd.outputs[0].links])
