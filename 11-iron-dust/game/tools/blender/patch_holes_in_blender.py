"""Patch the scanned Sparta mesh's holes INSIDE the running Blender (GUI context).

Why this and not the bmesh fillers: in a live Blender the edit-mode operators
(`mesh.fill_holes`, `mesh.fill`, `mesh.select_non_manifold`) work far better than the
bmesh equivalents - they respect the selection state and cap complex rings. They need a
real window/screen/area override, because the MCP addon runs code without
`bpy.context.screen`:

    win = bpy.context.window_manager.windows[0]
    screen = win.screen
    area = next(a for a in screen.areas if a.type == 'VIEW_3D')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    with bpy.context.temp_override(window=win, screen=screen, area=area, region=region,
                                   object=o, active_object=o, selected_objects=[o],
                                   selected_editable_objects=[o]):
        bpy.ops.object.mode_set(mode='EDIT')
        ...

Measured on Sparta_planar16.blend (28 parts):
    raw boundary edges      19,248
    after the patch pass     1,604   (97.5% -> 92% closed)
    a second pass does not help: what is left are non-manifold vertices / T-junctions,
    which no loop based filler can consume.

Result: <local Sparta source>/Sparta_patched.blend
It is the source for build_sparta_frame.py (SRC = Sparta_patched.blend).

Run inside Blender (blender MCP execute_blender_code -> exec(open(...).read())).
"""
import bpy, bmesh

SRC = os.environ.get("SPARTA_PLANAR_SOURCE", "path/to/Sparta_planar16.blend")
OUT = os.environ.get("SPARTA_PATCHED_OUT", "path/to/Sparta_patched.blend")

bpy.ops.wm.open_mainfile(filepath=SRC)
win = bpy.context.window_manager.windows[0]
screen = win.screen
area = next(a for a in screen.areas if a.type == 'VIEW_3D')
region = next(r for r in area.regions if r.type == 'WINDOW')


def open_edges(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    n = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    bm.free()
    return n


parts = [o for o in bpy.context.scene.objects
         if o.type == 'MESH' and not o.name.endswith(('_fist', '_open'))]
print("before:", sum(open_edges(o) for o in parts))

for o in parts:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    with bpy.context.temp_override(window=win, screen=screen, area=area, region=region,
                                   object=o, active_object=o,
                                   selected_objects=[o], selected_editable_objects=[o]):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=0.0025)
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.mesh.select_non_manifold()
        bpy.ops.mesh.fill_holes(sides=0)
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.mesh.select_non_manifold()
        bpy.ops.mesh.fill()
        bpy.ops.mesh.delete_loose()
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')

print("after:", sum(open_edges(o) for o in parts))
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("saved", OUT)
