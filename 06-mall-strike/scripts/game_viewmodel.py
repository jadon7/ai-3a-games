"""Bake the first-person viewmodel (IK arms on the rifle + reload) and export game/assets/viewmodel.glb.
Camera sits at the origin looking +Y (Blender) so camera-local space == three.js camera space after export.
Run: Blender -b -P scripts/game_viewmodel.py"""
import bpy, os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Euler, Matrix
from lib import ROOT, coll
import fps_rig as fr
import viewmodel as vmod

GA = os.path.join(ROOT, "game", "assets")
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30
cd = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cd)
sc.collection.objects.link(cam)
cam.rotation_euler = (math.pi / 2, 0, 0)
bpy.context.view_layer.update()

d = vmod.build(cam)
vm, rifle, arm, mesh, ret = d["vm"], d["rifle"], d["arm"], d["mesh"], d["reticle"]
c = vm.users_collection[0]

# decimate the hero rifle
n0 = len(rifle.data.polygons)
md = rifle.modifiers.new("dec", "DECIMATE"); md.ratio = 300000 / n0; md.use_collapse_triangulate = True
bpy.context.view_layer.objects.active = rifle
bpy.ops.object.modifier_apply(modifier="dec")
print("rifle faces", n0, "->", len(rifle.data.polygons))
for im in bpy.data.images:
    if im.size[0] > 2048:
        im.scale(2048, 2048)

# reload pivot between VM and rifle
rl = bpy.data.objects.new("RL", None); c.objects.link(rl)
rl.parent = vm
bpy.context.view_layer.update()
mw = rifle.matrix_world.copy(); rifle.parent = rl; rifle.matrix_world = mw

ik_l = bpy.data.objects["IK_L"]
rest = ik_l.location.copy()


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


F0, F1 = 1, 58
mag = Vector(fr.P_MAG) + Vector((-0.03, 0.0, -0.05))
below = mag + Vector((-0.05, -0.05, -0.35))
for f in range(F0, F1 + 1):
    t = (f - F0) / (F1 - F0)
    w = smooth(t / 0.2) * (1 - smooth((t - 0.8) / 0.2))
    rl.location = Vector((-0.03, -0.04, 0.04)) * w
    rl.rotation_euler = Euler(Vector((math.radians(-8), math.radians(-25), math.radians(12))) * w)
    if t < 0.25:
        hp = rest.lerp(mag, smooth(t / 0.25))
    elif t < 0.45:
        hp = mag.lerp(below, smooth((t - 0.25) / 0.2))
    elif t < 0.65:
        hp = below.lerp(mag, smooth((t - 0.45) / 0.2))
    else:
        hp = mag.lerp(rest, smooth((t - 0.65) / 0.35))
    ik_l.location = hp
    for o, p in ((rl, "location"), (rl, "rotation_euler"), (ik_l, "location")):
        o.keyframe_insert(p, frame=f)

sc.frame_start, sc.frame_end = F0, F1
for o in bpy.context.view_layer.objects:
    o.select_set(o is arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.select_all(action="SELECT")
bpy.ops.nla.bake(frame_start=F0, frame_end=F1, only_selected=False, visual_keying=True, clear_constraints=True,
                 use_current_action=False, bake_types={"POSE"})
bpy.ops.object.mode_set(mode="OBJECT")
arm.animation_data.action.name = "reload_arms"
rl.animation_data.action.name = "reload_rifle"

# reparent: armature -> VM (keep), VM -> root (keep); drop camera, poles, IK empties
bpy.context.view_layer.update()
for o in (arm, vm):
    mw = o.matrix_world.copy()
    o.parent = vm if o is arm else None
    o.matrix_world = mw
for o in list(bpy.data.objects):
    if o.name.startswith(("IK_", "Pole_")) or o is cam:
        bpy.data.objects.remove(o)
bpy.context.view_layer.update()
keep = [vm, rl, arm] + [o for o in bpy.data.objects if o.parent in (rifle, rl, arm, vm) or o is rifle]
keep = list(dict.fromkeys(keep + [o for o in bpy.data.objects if o.parent is rifle]))
print("EXPORT", [o.name for o in keep])
for o in bpy.context.view_layer.objects:
    o.select_set(o in keep)
sc.frame_set(F0)
out = os.path.join(GA, "viewmodel.glb")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_animations=True,
                          export_animation_mode="ACTIVE_ACTIONS", export_frame_range=True, export_force_sampling=True,
                          export_skins=True, export_image_format="JPEG", export_jpeg_quality=90, export_yup=True,
                          export_apply=False)
print("WROTE", out, os.path.getsize(out) / 1e6)
# rifle-local helper points for the game (in VM/RL space units after the rifle's own transform)
pts = {k: list(rifle.matrix_world @ getattr(fr, k)) for k in ("P_SIGHT", "P_MUZZLE", "P_EJECT", "P_MAG", "P_GRIP", "P_HANDGUARD")}
vm_inv = vm.matrix_world.inverted()
pts_vm = {k: list(vm_inv @ Vector(v)) for k, v in pts.items()}
json.dump({"points_vm_blender": pts_vm, "hip_loc": list(vmod.HIP["loc"]), "hip_rot": list(vmod.HIP["rot"]),
           "ads_loc": list(vmod.ADS["loc"]), "frames": [F0, F1], "fps": 30}, open(os.path.join(GA, "viewmodel.json"), "w"), indent=1)
print("DONE")
