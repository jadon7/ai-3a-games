import bpy, sys
from mathutils import Vector
sc = bpy.context.scene
f = int(sys.argv[-1])
sc.frame_set(f)
bpy.context.view_layer.update()
bad = 0; total = 0
for col in bpy.data.collections:
    if not col.name.startswith("CAR_"):
        continue
    root = next((o for o in col.objects if o.name.split(".")[0].endswith("_root")), None)
    if root is None:
        continue
    rp = root.matrix_world.translation
    if rp.z < -100:
        continue
    for o in col.objects:
        if o.type != "MESH":
            continue
        p = o.parent
        chain = []
        while p:
            chain.append(p.name.split(".")[0]); p = p.parent
        if not any("_spin_" in c for c in chain):
            continue
        total += 1
        c = sum((o.matrix_world @ Vector(b) for b in o.bound_box), Vector()) / 8
        d = (c - rp)
        if d.xy.length > 2.05 or abs(d.z) > 0.6:
            bad += 1
            if bad <= 12:
                print(f"@@ BAD {col.name} {o.name} rel=({d.x:.2f},{d.y:.2f},{d.z:.2f}) root=({rp.x:.1f},{rp.y:.1f},{rp.z:.1f}) chain={chain[:3]} rootrot={[round(v,2) for v in root.rotation_euler]}")
print(f"@@ wheels total {total} bad {bad}")
