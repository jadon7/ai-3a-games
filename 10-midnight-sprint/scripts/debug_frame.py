import bpy, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shotlib import setup_exr
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
out, f = argv[0], int(argv[1])
sc = bpy.context.scene
setup_exr(sc, "", samples=24, pct=40)
sc.frame_set(f)
cam = bpy.data.objects["cam_chase"]; sc.camera = cam
cp = cam.matrix_world.translation
print("@@ cam", [round(v, 2) for v in cp], "rot", [round(v, 3) for v in cam.rotation_euler])
hero = bpy.data.objects["hero_root"]
print("@@ hero", [round(v, 2) for v in hero.matrix_world.translation])
# 相机附近 12 米内有哪些物体
near = []
for o in sc.objects:
    if o.type in ("MESH",) and not o.hide_render:
        d = (o.matrix_world.translation - cp).length
        if d < 12 and o.name not in ("buildings",):
            near.append((round(d, 1), o.name, [round(v, 1) for v in o.dimensions], [round(v, 1) for v in o.matrix_world.translation]))
for n in sorted(near)[:25]:
    print("@@ near", n)
for tag, mb, hide in (("a_nomb", False, False), ("b_nosmoke", True, True)):
    sc.render.use_motion_blur = mb
    bpy.data.collections["SMOKE"].hide_render = hide
    sc.render.filepath = f"{out}_{tag}.exr"
    bpy.ops.render.render(write_still=True)
