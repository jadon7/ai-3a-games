import bpy, sys
from mathutils import Vector
glb = sys.argv[sys.argv.index("--")+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
for o in bpy.context.scene.objects:
    if o.type == "ARMATURE":
        print("@@ ARM", o.name, "scale", tuple(round(v,3) for v in o.matrix_world.to_scale()), "bones", len(o.data.bones))
        for b in o.data.bones:
            h = o.matrix_world @ b.head_local
            print(f"@@  bone {b.name} parent={b.parent.name if b.parent else None} head={tuple(round(v,2) for v in h)}")
for o in sorted(bpy.context.scene.objects, key=lambda x: x.name):
    if o.type != "MESH": continue
    e = o.evaluated_get(dg); m = e.to_mesh()
    if not m.vertices: continue
    xs = [e.matrix_world @ v.co for v in m.vertices]
    mn = Vector((min(p.x for p in xs), min(p.y for p in xs), min(p.z for p in xs)))
    mx = Vector((max(p.x for p in xs), max(p.y for p in xs), max(p.z for p in xs)))
    c = (mn+mx)/2; s = mx-mn
    vg = [g.name for g in o.vertex_groups][:3]
    mods = [md.type for md in o.modifiers]
    print(f"@@ {o.name:12s} c=({c.x:5.2f},{c.y:5.2f},{c.z:5.2f}) s=({s.x:4.2f},{s.y:4.2f},{s.z:4.2f}) mat={[sl.material.name for sl in o.material_slots][:2]} vg={vg} par={o.parent.name if o.parent else None} ptype={o.parent_type} pb={o.parent_bone} mods={mods}")
    e.to_mesh_clear()
