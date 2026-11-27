"""看一眼 Tripo 绑骨结果的物体层级、骨骼头尾、材质贴图。用法: Blender -b --factory-startup -P peek.py -- <glb>"""
import bpy, sys
src = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
for o in bpy.context.scene.objects:
    print("OBJ", o.type, repr(o.name), "parent", o.parent.name if o.parent else None, "loc", tuple(round(v, 3) for v in o.location), "rot", tuple(round(v, 3) for v in o.rotation_euler), "scale", tuple(round(v, 3) for v in o.scale),
          "mods", [(m.type, getattr(m, "object", None) and m.object.name) for m in getattr(o, "modifiers", [])], "verts", len(o.data.vertices) if o.type == "MESH" else "")
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
for b in arm.data.bones:
    if any(s in b.name for s in ("Twist", "Share", "Index", "Ring", "Pinky")): continue
    print("BONE %-14s parent=%-12s head=(%+.3f,%+.3f,%+.3f) tail=(%+.3f,%+.3f,%+.3f) len=%.3f kids=%s" % (b.name, b.parent.name if b.parent else "-", *b.head_local, *b.tail_local, b.length, [c.name for c in b.children]))
for m in bpy.data.materials:
    print("MAT", m.name, [(n.type, n.image.name, tuple(n.image.size), n.image.file_format) for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image] if m.use_nodes else "")
mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
mesh.data.calc_loop_triangles(); print("TRIS", len(mesh.data.loop_triangles), "vgroups", len(mesh.vertex_groups))
import collections
cnt = collections.Counter(len([g for g in v.groups if g.weight > 1e-4]) for v in mesh.data.vertices); print("INFLUENCES", dict(cnt))
