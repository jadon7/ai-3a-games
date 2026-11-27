"""打印绑好骨的 GLB 的骨架信息。用法: Blender -b --factory-startup -P tools/blender/rig_info.py -- in.glb"""
import bpy, sys
from mathutils import Vector
src = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
for o in bpy.context.scene.objects:
    print("OBJ", o.type, o.name, "parent", o.parent.name if o.parent else None, "loc", [round(v, 3) for v in o.location], "rot", [round(v, 3) for v in o.rotation_euler], "scale", [round(v, 3) for v in o.scale])
    if o.type == "MESH":
        o.data.calc_loop_triangles(); bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        print("   tris", len(o.data.loop_triangles), "groups", len(o.vertex_groups), "min", [round(min(b[i] for b in bb), 3) for i in range(3)], "max", [round(max(b[i] for b in bb), 3) for i in range(3)])
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
for b in arm.data.bones:
    h = arm.matrix_world @ b.head_local; t = arm.matrix_world @ b.tail_local
    if "Hand" in b.name and b.name[-1].isdigit() and not b.name.endswith("1"): continue
    print(f"BONE {b.name:32s} parent {b.parent.name if b.parent else '-':28s} head {h.x:7.3f} {h.y:7.3f} {h.z:7.3f}  tail {t.x:7.3f} {t.y:7.3f} {t.z:7.3f}")
print("ACTIONS", [a.name for a in bpy.data.actions])
