"""Retopo recipe for the scanned Sparta model (run inside Blender, e.g. via blender MCP).

Why this pipeline: the scan is a single-layer, thousands-of-islands surface. Voxel
remeshing it directly gives a 1-voxel-thin sheet that falls apart when decimated, and
QuadriFlow rejects it ("needs to be manifold / consistent normals") even after the
manifold checks pass. Solidifying first gives every part real thickness, so the voxel
remesh produces a proper closed volume per part and decimation is stable.

Result: models/sparta.glb, ~140k tris, watertight per part (no see-through when the
game rotates a joint).

Input : <local Sparta source>/Sparta_LOD0.blend  (28 parts, Blender units)
Output: <local Sparta source>/Sparta_solid.blend
Then  : sparta_to_game.py (SRC = Sparta_solid.blend, RETOPO/QUAD/LOWPOLY = False)
        rebuilds the game GLB with the joint hierarchy, mounts, sleeves and cores.

Tuning knobs
  solidify thickness 0.0035  (blender units ~= 6 cm at the 18 m game scale)
  voxel size         0.005   (~8.5 cm at game scale; smaller = more detail, more tris)
  decimate ratio     0.6     (below ~0.4 the thin shells start to crumple)
"""
import bpy, time

SRC = os.environ.get("SPARTA_SOURCE", "path/to/Sparta_LOD0.blend")
OUT = os.environ.get("SPARTA_SOLID_OUT", "path/to/Sparta_solid.blend")

bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene
parts = [o.name for o in sc.objects if o.type == 'MESH'
         and not o.name.endswith(('_fist', '_open'))]

t0 = time.time()
total = 0
for nm in parts:
    o = bpy.data.objects[nm]
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    ctx = dict(object=o, active_object=o, selected_objects=[o],
               selected_editable_objects=[o], mode='OBJECT')

    sol = o.modifiers.new("sol", 'SOLIDIFY')
    sol.thickness = 0.0035
    sol.offset = 0.0
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.modifier_apply(modifier=sol.name)

    o.data.remesh_voxel_size = 0.005
    o.data.remesh_voxel_adaptivity = 0.0
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.voxel_remesh()
        dec = o.modifiers.new("d", 'DECIMATE')
        dec.decimate_type = 'COLLAPSE'
        dec.ratio = 0.6
        bpy.ops.object.modifier_apply(modifier=dec.name)

    total += len(o.data.polygons)

print("parts", len(parts), "polys", total, round(time.time() - t0, 1), "s")
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("saved", OUT)
