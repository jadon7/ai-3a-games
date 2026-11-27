import bpy, math
from mathutils import Vector
scn = bpy.context.scene
for f in (40, 200):
    scn.frame_set(f)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for n in ("WL_Hot", "WL_Mid", "WL_Spill"):
        lo = bpy.data.objects[n]
        mw = lo.matrix_world
        pos = mw.translation.copy(); d = -(mw.to_3x3() @ Vector((0, 0, 1))).normalized()
        sc = mw.to_scale()
        hit, loc, nor, idx, ob, mat = scn.ray_cast(dg, pos + d * 0.05, d, distance=60)
        k = 0
        while hit and ob is not None and not any(m and m.get("env_emission_node") for m in getattr(ob.data, "materials", [])) and k < 30:
            hit, loc, nor, idx, ob, mat = scn.ray_cast(dg, loc + d * 0.01, d, distance=60); k += 1
        dist = (loc - pos).length if hit else -1
        print("WL", f, n, "E", lo.data.energy, "size", round(math.degrees(lo.data.spot_size), 1), "blend", lo.data.spot_blend, "scale", [round(v, 3) for v in sc],
              "pos", [round(v, 2) for v in pos], "dir", [round(v, 2) for v in d], "hit", ob.name if hit else None, [round(v, 2) for v in loc] if hit else None,
              "dist", round(dist, 2), "cos", round(abs(nor.dot(d)), 2) if hit else None)
