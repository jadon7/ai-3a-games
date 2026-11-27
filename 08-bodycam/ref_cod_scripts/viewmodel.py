"""Build the first-person viewmodel parented to a camera."""
import bpy, math, os
from mathutils import Vector, Matrix, Quaternion, Euler
from lib import coll, link
import fps_rig as fr

S = fr.RIFLE_SCALE
ARM_BONES = []
for side in ("Left", "Right"):
    ARM_BONES += [f"mixamorig:{side}ForeArm", f"mixamorig:{side}Hand"]
    for f in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        ARM_BONES += [f"mixamorig:{side}Hand{f}{j}" for j in (1, 2, 3, 4)]

# VM poses (camera space: x right, y up, -z forward)
def ads_loc(eye_relief=0.265):
    p = fr.P_SIGHT * S
    v = Euler((-math.pi / 2, 0, 0)).to_matrix() @ p
    return Vector((-v.x, -v.y, -v.z - eye_relief))

HIP = dict(loc=Vector((0.105, -0.19, -0.32)), rot=Euler((math.radians(2.0), math.radians(5.0), math.radians(-3.5))))
ADS = dict(loc=ads_loc(), rot=Euler((0, 0, 0)))


def build(cam, params=None):
    params = params or {}
    c = coll("Viewmodel")
    vm = bpy.data.objects.new("VM", None); c.objects.link(vm)
    vm.parent = cam
    vm.location = HIP["loc"]; vm.rotation_euler = HIP["rot"]
    rifle = fr.import_rifle("Rifle", c)
    rifle.parent = vm
    rifle.rotation_euler = (-math.pi / 2, 0, 0)
    rifle.location = (0, 0, 0)
    reticle = fr.make_reticle(rifle, c)
    # ---- arms
    src = params.get("arms_src", "enemy_a")
    arm, mesh, _ = fr.import_character(src, ["rig_model_url.glb"], c, height=1.8, name="PlayerArms")
    fr.keep_arms_only(mesh, ARM_BONES)
    if src == "player":
        sub = mesh.modifiers.new("subd", "SUBSURF"); sub.levels = 1; sub.render_levels = 1
    head = arm.data.bones["mixamorig:Head"].head_local
    eye_local = head + Vector((0, -0.05, 0.03))
    fwd, up, left = fr.char_basis(arm)
    eye_local = head + fwd * 0.05 + up * 0.03
    Ma = Matrix((fwd, up, left)).transposed()
    Mc = Matrix(((0, 0, -1), (0, 1, 0), (-1, 0, 0))).transposed()
    R = (Matrix.Rotation(math.radians(params.get("blade", -25.0)), 3, "Y") @ Mc @ Ma.inverted()).to_4x4()
    eye_off = Vector(params.get("eye_off", (0.0, -0.03, -0.14)))
    t = eye_off - (R.to_3x3() @ (eye_local * 1.8))
    arm.parent = cam
    arm.matrix_parent_inverse = Matrix.Identity(4)
    arm.matrix_basis = Matrix.Translation(t) @ R @ Matrix.Scale(1.8, 4)
    bpy.context.view_layer.update()
    # ---- IK targets on rifle
    Rr = rifle.matrix_world.to_3x3().normalized()
    def target(name, p_r, finger_r, palm_r, side):
        fd = (Rr @ Vector(finger_r)).normalized(); pd = (Rr @ Vector(palm_r)).normalized()
        wrist = rifle.matrix_world @ Vector(p_r) - pd * 0.045 - fd * 0.075
        e = bpy.data.objects.new(name, None); c.objects.link(e)
        e.empty_display_size = 0.03
        q = fr.hand_target_rotation(arm, f"mixamorig:{side}Hand", fd, pd)
        e.matrix_world = Matrix.Translation(wrist) @ q.to_matrix().to_4x4()
        mw = e.matrix_world.copy(); e.parent = rifle; e.matrix_world = mw
        return e
    tr = target("IK_R", fr.P_GRIP, params.get("r_fd", (-0.05, 0.9, 0.15)), params.get("r_pd", (-1.0, 0.0, -0.1)), "Right")
    tl = target("IK_L", fr.P_HANDGUARD, params.get("l_fd", (0.75, 0.6, 0.05)), params.get("l_pd", (0.0, -0.1, 1.0)), "Left")
    def pole(name, loc):
        e = bpy.data.objects.new(name, None); c.objects.link(e); e.parent = cam; e.location = loc; return e
    pr = pole("Pole_R", params.get("pole_r", (0.45, -0.85, 0.15)))
    pl = pole("Pole_L", params.get("pole_l", (-0.3, -0.95, -0.25)))
    ikr, _ = fr.add_arm_ik(arm, "Right", tr, pr)
    ikl, _ = fr.add_arm_ik(arm, "Left", tl, pl)
    ikr.pole_angle = math.radians(params.get("pole_angle", -90)); ikl.pole_angle = math.radians(params.get("pole_angle", -90))
    fr.curl_fingers(arm, "Right", {"Index": 0.35, "Middle": 1.05, "Ring": 1.1, "Pinky": 1.1}, thumb=0.5)
    fr.curl_fingers(arm, "Left", {"Index": 0.8, "Middle": 0.9, "Ring": 0.95, "Pinky": 1.0}, thumb=0.4)
    for o in (arm, mesh):
        o.visible_shadow = True
    return dict(vm=vm, rifle=rifle, arm=arm, mesh=mesh, reticle=reticle)
