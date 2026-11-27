import bpy, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import import_gltf, ASSETS
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
new, acts = import_gltf(os.path.join(ASSETS, "arms_g17", "scene.gltf"))
arm = next(o for o in new if o.type == "ARMATURE")
base = next(o for o in new if o.name.startswith("g17_base") and o.type == "EMPTY")
rw = next(b for b in arm.pose.bones if b.name.startswith("R_wrist"))
lw = next(b for b in arm.pose.bones if b.name.startswith("L_wrist"))
a = acts[0]
print("ACTION", a.name, tuple(a.frame_range), "fps", scn.render.fps, scn.render.fps_base)
for f in (0.8, 1, 16, 40, 55, 100, 212):
    scn.frame_set(int(f), subframe=f - int(f))
    b = base.matrix_world.translation; r = (arm.matrix_world @ rw.matrix).translation; l = (arm.matrix_world @ lw.matrix).translation
    print(f"POSE f={f} base=({b.x:.4f},{b.y:.4f},{b.z:.4f}) rwrist=({r.x:.4f},{r.y:.4f},{r.z:.4f}) lwrist=({l.x:.4f},{l.y:.4f},{l.z:.4f})")

from mathutils import Vector
def wb(o):
    dg = bpy.context.evaluated_depsgraph_get(); ev = o.evaluated_get(dg); me = ev.to_mesh()
    xs = [ev.matrix_world @ v.co for v in me.vertices]; ev.to_mesh_clear()
    return [round(min(p[i] for p in xs), 3) for i in range(3)], [round(max(p[i] for p in xs), 3) for i in range(3)]
scn.frame_set(55)
for o in new:
    if o.type == "MESH" and ("slide_07" in o.name or "Barrel" in o.name or "Frame" in o.name or o.name == "Object_86"):
        print("BBOX55", o.name, wb(o), "parent", o.parent.name, o.parent_type)
