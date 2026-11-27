import bpy, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import import_gltf, ASSETS
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
new, acts = import_gltf(os.path.join(ASSETS, "arms_g17", "scene.gltf"))
arm = next(o for o in new if o.type == "ARMATURE")
ob = {o.name: o for o in new}
print("NODES", [(o.name, o.type, o.parent.name if o.parent else None, o.parent_type, o.parent_bone) for o in new if o.type != "MESH"])
print("ACT", [(a.name, tuple(a.frame_range)) for a in acts], "fps", scn.render.fps)
slide = next(o for o in new if o.name.startswith("g17_slide") and o.type == "EMPTY")
base = next(o for o in new if o.name.startswith("g17_base") and o.type == "EMPTY")
mag = next(o for o in new if o.name.startswith("g17_magazine") and o.type == "EMPTY")
trig = next(o for o in new if o.name.startswith("g17_trigger") and o.type == "EMPTY")
lw = next(b for b in arm.pose.bones if b.name.startswith("L_wrist"))
rw = next(b for b in arm.pose.bones if b.name.startswith("R_wrist"))
rows = []
for f in range(1, 213):
    scn.frame_set(f)
    bi = base.matrix_world.inverted()
    s = (bi @ slide.matrix_world).translation
    m = (bi @ mag.matrix_world).translation
    t = (bi @ trig.matrix_world).to_euler()
    lh = (bi @ (arm.matrix_world @ lw.matrix)).translation
    bw = base.matrix_world.translation
    br = base.matrix_world.to_euler()
    rows.append((f, s.copy(), m.copy(), lh.copy(), bw.copy(), br.copy()))
s0 = rows[54][1]; m0 = rows[54][2]; l0 = rows[54][3]; b0 = rows[54][4]; r0 = rows[54][5]
for f, s, m, lh, bw, br in rows:
    ds = (s - s0).length; dm = (m - m0).length; dl = (lh - l0).length; db = (bw - b0).length
    dr = max(abs(br.x - r0.x), abs(br.y - r0.y), abs(br.z - r0.z))
    flag = ("S" if ds > 0.004 else ".") + ("M" if dm > 0.01 else ".") + ("L" if dl > 0.03 else ".") + ("B" if db > 0.02 or dr > 0.08 else ".")
    print(f"F{f:03d} {flag} slide {ds*1000:5.1f}mm mag {dm*100:5.1f}cm lhand {dl*100:5.1f}cm base {db*100:5.1f}cm rot {dr:4.2f}")
