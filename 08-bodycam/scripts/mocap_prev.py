"""预览 Tripo 动捕源片段：每个片段渲染若干帧（线框骨架用 Workbench），输出到 renders/mocap/<clip>_<i>.jpg，并打印髋部轨迹。
blender -b --factory-startup -P scripts/mocap_prev.py"""
import bpy, os, sys, math
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
acts = {}
arm = None
for g in ("anim_react_model_url.glb", "anim_loop_model_url.glb"):
    before = set(bpy.data.objects); ab = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "assets", "cod_enemy_b", g))
    new = [o for o in bpy.data.objects if o not in before]
    for a in bpy.data.actions:
        if a not in ab: acts[a.name.split(".")[0]] = a
    arms = [o for o in new if o.type == "ARMATURE"]
    if arm is None:
        arm = arms[0]
    else:
        for nm in [o.name for o in new]:
            o = bpy.data.objects.get(nm)
            if o is not None: bpy.data.objects.remove(o)
print("ACTS", {k: tuple(v.frame_range) for k, v in acts.items()})
scn.render.engine = "BLENDER_WORKBENCH"; scn.display.shading.light = "STUDIO"; scn.display.shading.color_type = "MATERIAL"
scn.render.resolution_x = 320; scn.render.resolution_y = 320; scn.render.image_settings.file_format = "JPEG"
scn.render.fps = 30
cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.ortho_scale = 3.6; cam = bpy.data.objects.new("c", cd); scn.collection.objects.link(cam); scn.camera = cam
w = bpy.data.worlds.new("w"); scn.world = w
hips = next(pb for pb in arm.pose.bones if pb.name.endswith("Hips"))
out = os.path.join(ROOT, "renders", "mocap")
for name, a in acts.items():
    arm.animation_data.action = a
    try: arm.animation_data.action_slot = a.slots[0]
    except Exception as e: pass
    f0, f1 = int(a.frame_range[0]), int(a.frame_range[1])
    n = 16 if (f1 - f0) < 150 else 32
    tr = []
    for i in range(n):
        f = f0 + round((f1 - f0) * i / (n - 1)); scn.frame_set(f)
        hp = arm.matrix_world @ hips.matrix.translation; tr.append((f, round(hp.x, 2), round(hp.y, 2), round(hp.z, 2)))
        cam.location = (hp.x + 4 * 0.7, hp.y - 4 * 0.7, 1.2); cam.rotation_euler = (math.radians(84), 0, math.radians(45))
        scn.render.filepath = os.path.join(out, f"{name}_{i:02d}.jpg"); bpy.ops.render.render(write_still=True)
    print("TRACK", name, tr)
