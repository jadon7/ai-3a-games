import bpy
o = bpy.data.objects["CH_arch"]; me = o.data
mats = [m.name for m in me.materials]
down = {}; up = {}
for p in me.polygons:
    c = p.center
    if abs(c.z - 4.35) < 0.02 and p.normal.z < -0.9: down[mats[p.material_index]] = down.get(mats[p.material_index], 0) + p.area
    if abs(c.z - 5.0) < 0.02: up[(mats[p.material_index], round(p.normal.z))] = up.get((mats[p.material_index], round(p.normal.z)), 0) + p.area
print("SOFFIT z=4.35 facing down:", down)
print("z=5.0 faces:", up)
