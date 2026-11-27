# 量管线摆正后的模型有多大（Blender 里跑）。用法: BL -b --factory-startup V2R/assets/model/beast.blend -P measure_model.py
import bpy
from mathutils import Vector
dg = bpy.context.evaluated_depsgraph_get()
for o in bpy.context.scene.objects:
    print("OBJ", o.name, o.type, "parent", o.parent.name if o.parent else None, [round(x, 4) for x in o.matrix_world.to_scale()])
body = next(o for o in bpy.context.scene.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
ev = body.evaluated_get(dg); me = ev.to_mesh(); M = ev.matrix_world
vs = [M @ v.co for v in me.vertices]
lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))); hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
print("BBOX lo", [round(x, 4) for x in lo], "hi", [round(x, 4) for x in hi], "size", [round(x, 4) for x in (hi - lo)])
