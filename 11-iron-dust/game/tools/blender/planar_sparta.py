"""Numeric region-merge pass for the scanned Sparta mesh (the "average angle" approach).

Idea: merge neighbouring faces whose normals differ by less than N degrees, so a region
of similar orientation collapses into one flat panel. This is the numeric equivalent of
"take the average angle of an area" and it keeps the original surface, unlike a voxel
remesh (which averages everything away and looks soft).

Measured on Sparta_LOD0 (81,954 tris, 28 parts), weld 1.2 mm first:
    6 deg  -> 67.9 % of the source on one shin
    8 deg  -> 90.3 % whole mech
   10 deg  -> 53.1 % on one shin
   16 deg  -> 75.9 % whole mech (62,206 tris)  <- the shipped build

Why it cannot go much lower: the scan has no truly flat regions - neighbouring faces
differ by several degrees everywhere (that is also what made the game's ink pass draw
speckles on it). Past ~16 deg the merge starts flattening real curvature.

To reach 20-30k you need plane FITTING instead of merging: region-grow with a distance
tolerance to a least-squares plane, then project the region boundary onto that plane.
That is the next step if a真 low-poly is required.

Run inside Blender (e.g. through the blender MCP addon):
    execute_blender_code -> exec(open(...).read())
"""
import bpy, bmesh, math, time

SRC = os.environ.get("SPARTA_SOURCE", "path/to/Sparta_LOD0.blend")
OUT = os.environ.get("SPARTA_PLANAR_SOURCE", "path/to/Sparta_planar16.blend")
ANGLE_DEG = 16.0
WELD = 0.0012

bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene
parts = [o.name for o in sc.objects if o.type == 'MESH'
         and not o.name.endswith(('_fist', '_open'))]
src = sum(len(bpy.data.objects[n].data.polygons) for n in parts)

t0 = time.time()
for nm in parts:
    o = bpy.data.objects[nm]
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=WELD)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(ANGLE_DEG),
                             use_dissolve_boundaries=False,
                             verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.update()
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o],
                                   selected_editable_objects=[o], mode='OBJECT'):
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))

tot = sum(len(bpy.data.objects[n].data.polygons) for n in parts)
print(f"src {src} -> planar {tot} ({round(100 * tot / src, 1)}%) in {round(time.time() - t0, 1)}s")
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("saved", OUT)
