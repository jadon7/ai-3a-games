"""Export the baked mall chunks to game/assets/mall.glb + materials.json.
Run: Blender -b blend/game_baked.blend -P scripts/game_export.py"""
import bpy, os, json, shutil
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GA = os.path.join(ROOT, "game", "assets")
sc = bpy.context.scene
vl = bpy.context.view_layer
TILED = {"floor_marble", "plaster_white", "plaster_warm", "planter_stone", "pavement"}
VSCALE = 1.0 / 16.0  # vertex lightmap values are stored /16 so they survive any [0,1] clamping

chunks = [o for o in sc.objects if o.type == "MESH" and o.name.startswith("CH_")]
mats = {}
for o in chunks:
    for m in o.data.materials:
        if m:
            mats[m.name] = m


def is_ph(m):
    return m.name not in TILED and any(n.type == "TEX_IMAGE" and n.name != "LMBAKE" for n in m.node_tree.nodes)


info = {}
for name, m in mats.items():
    nt = m.node_tree
    d = {}
    em = next((n for n in nt.nodes if n.type == "EMISSION"), None)
    b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    tr = next((n for n in nt.nodes if n.type == "BSDF_TRANSPARENT"), None)
    if em:
        d = {"type": "emit", "color": list(em.inputs[0].default_value[:3]), "strength": em.inputs[1].default_value}
    elif tr:
        gl = next((n for n in nt.nodes if n.type == "BSDF_GLOSSY"), None)
        d = {"type": "glass", "tint": list(tr.inputs[0].default_value[:3]),
             "rough": gl.inputs["Roughness"].default_value if gl else 0.0}
    elif name in TILED:
        d = {"type": "tiled"}
    elif is_ph(m):
        d = {"type": "ph"}
    elif b:
        d = {"type": "principled", "color": list(b.inputs["Base Color"].default_value[:3]),
             "rough": b.inputs["Roughness"].default_value, "metal": b.inputs["Metallic"].default_value,
             "coat": b.inputs["Coat Weight"].default_value, "coat_rough": b.inputs["Coat Roughness"].default_value,
             "noise_rough": any(n.type == "TEX_NOISE" for n in nt.nodes)}
    info[name] = d
    # strip non-PH materials down to a bare principled so the exporter doesn't embed procedural textures
    if d.get("type") != "ph":
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bb = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(bb.outputs[0], out.inputs[0])
    else:
        n = nt.nodes.get("LMBAKE")
        if n:
            nt.nodes.remove(n)

# vertex lightmaps: scale down
for o in chunks:
    ca = o.data.color_attributes
    if "LMV" in ca:
        n = len(ca["LMV"].data)
        a = np.empty(n * 4, np.float32)
        ca["LMV"].data.foreach_get("color", a)
        print(o.name, "LMV max", a.reshape(-1, 4)[:, :3].max(), "sun max", a.reshape(-1, 4)[:, 3].max())
        ca["LMV"].data.foreach_set("color", a * VSCALE)
        ca.active_color = ca["LMV"]
        ca.render_color_index = list(ca).index(ca["LMV"])
    for uv in o.data.uv_layers:
        print(o.name, "uv", uv.name)

for o in vl.objects:
    o.select_set(o in chunks)
vl.objects.active = chunks[0]
path = os.path.join(GA, "mall.glb")
bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=False,
                          export_texcoords=True, export_normals=True, export_tangents=False,
                          export_materials="EXPORT", export_image_format="AUTO", export_yup=True,
                          export_vertex_color="ACTIVE", export_active_vertex_color_when_no_material=True,
                          export_all_vertex_colors=False, export_lights=False, export_cameras=False,
                          export_extras=False, export_animations=False, export_skins=False, export_morph=False)
print("GLB", path, os.path.getsize(path) / 1e6, "MB")
info["_vscale"] = VSCALE
sun = bpy.data.objects["Sun"]
from mathutils import Vector
d = sun.matrix_world.to_3x3() @ Vector((0, 0, -1))
info["_sun"] = {"dir_blender": list(d), "color": list(sun.data.color), "strength": sun.data.energy}
json.dump(info, open(os.path.join(GA, "materials.json"), "w"), indent=1, ensure_ascii=False)

# tiled textures
for t in ("marble_01", "white_plaster_02", "plaster_grey_04", "concrete_debris"):
    src = os.path.join(ROOT, "assets", "polyhaven", "tex", t)
    dst = os.path.join(GA, "tex", t)
    os.makedirs(dst, exist_ok=True)
    for f in ("Diffuse.jpg", "Rough.jpg", "nor_gl.jpg"):
        shutil.copy(os.path.join(src, f), os.path.join(dst, f))
shutil.copy(os.path.join(ROOT, "assets", "polyhaven", "hdri", "modern_buildings_2_2k.hdr"), os.path.join(GA, "sky.hdr"))
print("DONE")
