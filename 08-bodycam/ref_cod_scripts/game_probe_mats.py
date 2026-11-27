import bpy
for m in bpy.data.materials:
    if not m.use_nodes: continue
    b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    imgs = [n.image.name for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    alpha = b and b.inputs["Alpha"].is_linked
    if imgs:
        print("MAT", m.name, "alpha" if alpha else "", m.surface_render_method, imgs[:4])
