import bpy
scn = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE" and "GLTF_created" in o.name)
def pb(n): return next(b for b in arm.pose.bones if b.name.split(":")[-1].rsplit("_", 1)[0] == n)
names = ["Head", "Spine2", "Hips", "LeftLeg", "RightLeg", "LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase", "LeftHand", "RightHand"]
for f in (100, 110, 116, 120, 124, 128, 132, 136, 142, 150, 160, 172, 345):
    scn.frame_set(f)
    out = []
    for n in names:
        p = (arm.matrix_world @ pb(n).matrix).translation
        out.append(f"{n[:9]}=({p.x:.2f},{p.y:.2f},{p.z:.2f})")
    print("F", f, " ".join(out))
