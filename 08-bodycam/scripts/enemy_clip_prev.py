"""导入导出的敌人 glTF，把每个片段渲染成拼图检查。 blender -b --factory-startup -P scripts/enemy_clip_prev.py -- <gltf> <outdir>"""
import bpy, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
scn = bpy.context.scene; scn.render.fps = 30
arm = next(o for o in scn.objects if o.type == "ARMATURE")
scn.render.engine = "BLENDER_WORKBENCH"; scn.display.shading.light = "STUDIO"; scn.display.shading.color_type = "TEXTURE"
scn.render.resolution_x = 300; scn.render.resolution_y = 400; scn.render.image_settings.file_format = "JPEG"
w = bpy.data.worlds.new("w"); scn.world = w; w.color = (0.25, 0.25, 0.27)
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.ortho_scale = 2.6; cam = bpy.data.objects.new("c", cd); scn.collection.objects.link(cam); scn.camera = cam
acts = {a.name.split(".")[0]: a for a in bpy.data.actions}
print("ACTS", {k: tuple(v.frame_range) for k, v in acts.items()})
if arm.animation_data:
    for t in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(t)
for name in argv[2].split(","):
    a = acts[name]; arm.animation_data.action = a
    try: arm.animation_data.action_slot = a.slots[0]
    except Exception: pass
    f0, f1 = int(a.frame_range[0]), int(a.frame_range[1]); n = 8
    for i in range(n):
        scn.frame_set(f0 + round((f1 - f0) * i / (n - 1)))
        for vn, pos in (("side", (4, 0.0, 0.95)), ("front", (0.0, -4, 0.95))):
            cam.location = pos; cam.rotation_euler = (Vector((0, 0, 0.95)) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
            scn.render.filepath = os.path.join(argv[1], f"clip_{name}_{vn}_{i}.jpg"); bpy.ops.render.render(write_still=True)
print("DONE")
