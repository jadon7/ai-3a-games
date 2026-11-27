"""First-person viewmodel (rifle + IK arms) and character import helpers."""
import bpy, math, os
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from lib import ROOT, TRIPO, coll, link

RIFLE_SCALE = 0.855  # normalized 0.983 long -> 0.84 m
# rifle-local points (normalized mesh units, muzzle +Y, up +Z, right +X)
P_SIGHT = Vector((-0.005, -0.107, 0.1885))
LENS_BOX = (-0.0275, 0.0175, -0.140, -0.025, 0.1655, 0.2115)  # x0,x1,y0,y1,z0,z1
P_GRIP = Vector((0.0, -0.215, -0.07))
P_HANDGUARD = Vector((-0.005, 0.145, 0.035))
P_MUZZLE = Vector((0.0, 0.50, 0.123))
P_EJECT = Vector((0.06, -0.02, 0.10))
P_MAG = Vector((0.0, 0.02, -0.2))


def import_glb(path, c):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, files=[{"name": os.path.basename(path)}], directory=os.path.dirname(path))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        link(o, c)
    return new


def import_rifle(name="Rifle", c=None, mesh_data=None):
    c = c or coll("Weapons")
    if mesh_data is None:
        new = import_glb(os.path.join(TRIPO, "rifle", "gen_model_url.glb"), c)
        ob = next(o for o in new if o.type == "MESH")
        for o in new:
            if o is not ob:
                bpy.data.objects.remove(o)
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.data.transform(mw)
        ob.matrix_world = Matrix.Identity(4)
        _cut_lens(ob)
        # bake to identity transform
        ob.name = name
        # tame the glossiness a bit: real rifles are matte anodized / polymer
        for m in ob.data.materials:
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if b and not b.inputs["Roughness"].is_linked:
                b.inputs["Roughness"].default_value = 0.5
    else:
        ob = bpy.data.objects.new(name, mesh_data)
        c.objects.link(ob)
    ob.rotation_mode = "XYZ"
    ob.scale = (RIFLE_SCALE,) * 3
    return ob


def rifle_world(rifle, p):
    return rifle.matrix_world @ p


# ------------------------------------------------------------------ characters
def import_character(tag, glbs, c, height=1.8, name=None):
    """Import rigged/animated Tripo GLBs; return (armature, mesh, {action_name: action})."""
    actions = {}
    arm = mesh = None
    for i, g in enumerate(glbs):
        acts_before = set(bpy.data.actions)
        new = import_glb(os.path.join(TRIPO, tag, g), c)
        for a in bpy.data.actions:
            if a not in acts_before:
                a.use_fake_user = True
                actions[a.name.split(".")[0]] = a
        if i == 0:
            arm = next(o for o in new if o.type == "ARMATURE")
            mesh = next(o for o in new if o.type == "MESH" and o.parent == arm)
            for o in new:
                if o not in (arm, mesh):
                    bpy.data.objects.remove(o)
        else:
            for o in new:
                if o.type == "MESH" and o.data.users == 1:
                    me = o.data
                    bpy.data.objects.remove(o)
                else:
                    bpy.data.objects.remove(o)
    arm.name = name or (tag + "_rig")
    mesh.name = (name or tag) + "_mesh"
    arm.scale = (height,) * 3
    if arm.animation_data:
        arm.animation_data.action = None
    return arm, mesh, actions


def pose_bone_world_head(arm, bname):
    return arm.matrix_world @ arm.pose.bones[bname].head


def keep_arms_only(mesh, side_bones):
    """Delete vertices not dominated by arm/hand bones (for first-person arms)."""
    vg = {g.index: g.name for g in mesh.vertex_groups}
    keep_names = set(side_bones)
    me = mesh.data
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    deform = bm.verts.layers.deform.active
    kill = []
    for v in bm.verts:
        w_keep = w_all = 0.0
        for gi, w in v[deform].items():
            w_all += w
            if vg.get(gi) in keep_names:
                w_keep += w
        if w_all == 0 or w_keep / w_all < 0.5:
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(me)
    bm.free()


def _palm_axis(arm, bname):
    """Local axis of a bone that points to world -Z in rest pose (palms down T-pose)."""
    b = arm.data.bones[bname]
    R = b.matrix_local.to_3x3().normalized()  # armature space (T-pose, palms down = -Z)
    down = R.inverted() @ Vector((0, 0, -1))
    return down.normalized()


def hand_target_rotation(arm, bname, finger_dir, palm_dir):
    """World rotation for hand bone so that its Y axis = finger_dir and palm normal = palm_dir."""
    a = _palm_axis(arm, bname)
    # build local frame: Y (finger) and a (palm); third = cross
    y_l = Vector((0, 1, 0))
    a_l = (a - a.project(y_l)).normalized()
    t_l = y_l.cross(a_l)
    L = Matrix((y_l, a_l, t_l)).transposed()  # columns
    y_w = finger_dir.normalized()
    a_w = (palm_dir - palm_dir.project(y_w)).normalized()
    t_w = y_w.cross(a_w)
    W = Matrix((y_w, a_w, t_w)).transposed()
    return (W @ L.inverted()).to_quaternion()


def curl_fingers(arm, side, amounts, thumb=0.35):
    """Bend finger bones toward the palm (pose-space quaternion)."""
    pb = arm.pose.bones
    for finger, amt in amounts.items():
        for j in (1, 2, 3):
            n = f"mixamorig:{side}Hand{finger}{j}"
            if n not in pb:
                continue
            b = arm.data.bones[n]
            a = _palm_axis(arm, n)
            axis = Vector((0, 1, 0)).cross(a).normalized()
            ang = amt * (1.0 if j == 1 else 1.15)
            if finger == "Thumb":
                ang = thumb * (0.6 if j == 1 else 0.9)
            p = pb[n]
            p.rotation_mode = "QUATERNION"
            p.rotation_quaternion = Quaternion(axis, ang)


def add_arm_ik(arm, side, hand_target, pole_target, chain=2):
    pb = arm.pose.bones
    fa = pb[f"mixamorig:{side}ForeArm"]
    ik = fa.constraints.new("IK")
    ik.target = hand_target
    ik.pole_target = pole_target
    ik.chain_count = chain
    ik.pole_angle = math.radians(-90)
    ik.use_stretch = True
    for bn in (f"mixamorig:{side}ForeArm", f"mixamorig:{side}Arm"):
        pb[bn].ik_stretch = 0.12
    hand = pb[f"mixamorig:{side}Hand"]
    cr = hand.constraints.new("COPY_ROTATION")
    cr.target = hand_target
    return ik, cr


def char_basis(arm):
    """Armature-space (forward, up, left) unit vectors from shoulder positions."""
    b = arm.data.bones
    left = (b["mixamorig:LeftArm"].head_local - b["mixamorig:RightArm"].head_local)
    left.z = 0
    left.normalize()
    up = Vector((0, 0, 1))
    fwd = left.cross(up).normalized()
    return fwd, up, left


def yaw_to_face(arm, world_dir):
    """Z rotation (radians) for the armature object so the character faces world_dir (xy)."""
    fwd, _, _ = char_basis(arm)
    a0 = math.atan2(fwd.y, fwd.x)
    a1 = math.atan2(world_dir[1], world_dir[0])
    return a1 - a0


def make_lens_transparent(rifle):
    """Turn the holo-sight lens (orange, saturated texels inside the sight box) into thin glass."""
    for m in rifle.data.materials:
        nt = m.node_tree
        b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if not b or not out or not b.inputs["Base Color"].is_linked:
            continue
        col_sock = b.inputs["Base Color"].links[0].from_socket
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Object"], sep.inputs[0])
        def rng(sock, lo, hi):
            a = nt.nodes.new("ShaderNodeMath"); a.operation = "GREATER_THAN"; a.inputs[1].default_value = lo
            c = nt.nodes.new("ShaderNodeMath"); c.operation = "LESS_THAN"; c.inputs[1].default_value = hi
            nt.links.new(sock, a.inputs[0]); nt.links.new(sock, c.inputs[0])
            m_ = nt.nodes.new("ShaderNodeMath"); m_.operation = "MULTIPLY"
            nt.links.new(a.outputs[0], m_.inputs[0]); nt.links.new(c.outputs[0], m_.inputs[1])
            return m_.outputs[0]
        mx = rng(sep.outputs[0], -0.042, 0.042)
        my = rng(sep.outputs[1], -0.165, -0.035)
        mz = rng(sep.outputs[2], 0.142, 0.214)
        hsv = nt.nodes.new("ShaderNodeSeparateColor"); hsv.mode = "HSV"
        nt.links.new(col_sock, hsv.inputs[0])
        sat = nt.nodes.new("ShaderNodeMapRange"); sat.inputs[1].default_value = 0.22; sat.inputs[2].default_value = 0.4
        nt.links.new(hsv.outputs[1], sat.inputs[0])
        m1 = nt.nodes.new("ShaderNodeMath"); m1.operation = "MULTIPLY"; nt.links.new(mx, m1.inputs[0]); nt.links.new(my, m1.inputs[1])
        m2 = nt.nodes.new("ShaderNodeMath"); m2.operation = "MULTIPLY"; nt.links.new(m1.outputs[0], m2.inputs[0]); nt.links.new(mz, m2.inputs[1])
        m3 = nt.nodes.new("ShaderNodeMath"); m3.operation = "MULTIPLY"; nt.links.new(m2.outputs[0], m3.inputs[0]); nt.links.new(sat.outputs[0], m3.inputs[1])
        tr = nt.nodes.new("ShaderNodeBsdfTransparent"); tr.inputs[0].default_value = (0.93, 0.97, 1.0, 1)
        gl = nt.nodes.new("ShaderNodeBsdfGlossy"); gl.inputs["Roughness"].default_value = 0.03
        gl.inputs[0].default_value = (0.6, 0.75, 1.0, 1)
        fr_ = nt.nodes.new("ShaderNodeFresnel"); fr_.inputs[0].default_value = 1.6
        gm = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(fr_.outputs[0], gm.inputs[0]); nt.links.new(tr.outputs[0], gm.inputs[1]); nt.links.new(gl.outputs[0], gm.inputs[2])
        final = nt.nodes.new("ShaderNodeMixShader")
        surf_from = out.inputs["Surface"].links[0].from_socket
        nt.links.new(m3.outputs[0], final.inputs[0]); nt.links.new(surf_from, final.inputs[1]); nt.links.new(gm.outputs[0], final.inputs[2])
        nt.links.new(final.outputs[0], out.inputs["Surface"])


def make_reticle(rifle, c):
    """EOTech-style circle-dot reticle on a small plane at the sight lens, facing the shooter."""
    import bpy
    m = bpy.data.materials.new("reticle")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    sub = nt.nodes.new("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"; sub.inputs[1].default_value = (0.5, 0.5, 0)
    nt.links.new(tc.outputs["UV"], sub.inputs[0]); nt.links.new(sub.outputs[0], ln.inputs[0])
    # ring at r=0.40 (width 0.035) + dot r<0.06
    ring = nt.nodes.new("ShaderNodeMapRange"); ring.inputs[1].default_value = 0.0; ring.inputs[2].default_value = 0.035
    d = nt.nodes.new("ShaderNodeMath"); d.operation = "SUBTRACT"; d.inputs[1].default_value = 0.40
    ab = nt.nodes.new("ShaderNodeMath"); ab.operation = "ABSOLUTE"
    nt.links.new(ln.outputs[1], d.inputs[0]); nt.links.new(d.outputs[0], ab.inputs[0]); nt.links.new(ab.outputs[0], ring.inputs[0])
    inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
    nt.links.new(ring.outputs[0], inv.inputs[1])
    dot = nt.nodes.new("ShaderNodeMath"); dot.operation = "LESS_THAN"; dot.inputs[1].default_value = 0.06
    nt.links.new(ln.outputs[1], dot.inputs[0])
    mx = nt.nodes.new("ShaderNodeMath"); mx.operation = "MAXIMUM"
    nt.links.new(inv.outputs[0], mx.inputs[0]); nt.links.new(dot.outputs[0], mx.inputs[1])
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs[0].default_value = (1.0, 0.05, 0.03, 1); em.inputs[1].default_value = 40
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    sh = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(mx.outputs[0], sh.inputs[0]); nt.links.new(tr.outputs[0], sh.inputs[1]); nt.links.new(em.outputs[0], sh.inputs[2])
    nt.links.new(sh.outputs[0], out.inputs["Surface"])
    bpy.ops.mesh.primitive_plane_add(size=1)
    p = bpy.context.active_object
    for uc in list(p.users_collection): uc.objects.unlink(p)
    c.objects.link(p)
    p.name = "Reticle"
    p.data.materials.append(m)
    p.parent = rifle
    # plane faces +Z by default; rifle-local shooter is at -Y: rotate so normal = -Y
    p.rotation_euler = (math.pi / 2, 0, 0)
    p.location = P_SIGHT + Vector((0, 0.004, 0))
    p.scale = (0.0088, 0.0088, 0.0088)  # 1 unit plane -> ring radius ~0.0042 normalized
    p.visible_shadow = False
    p.visible_diffuse = p.visible_glossy = p.visible_transmission = False
    return p


def _cut_lens(ob):
    """Delete the opaque lens faces of the holo sight and put a clean thin-glass pane there."""
    import bmesh
    from lib import thin_glass
    me = ob.data
    n = len(me.polygons)
    cen = np.empty(n * 3, dtype=np.float32); me.polygons.foreach_get("center", cen); cen = cen.reshape(-1, 3)
    nor = np.empty(n * 3, dtype=np.float32); me.polygons.foreach_get("normal", nor); nor = nor.reshape(-1, 3)
    x0, x1, y0, y1, z0, z1 = LENS_BOX
    m = ((cen[:, 0] > x0) & (cen[:, 0] < x1) & (cen[:, 1] > y0) & (cen[:, 1] < y1) & (cen[:, 2] > z0) & (cen[:, 2] < z1)
         & (np.abs(nor[:, 1]) > 0.5))
    idx = set(np.where(m)[0].tolist())
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    # also fold away the front sight post (it would sit on top of the reticle)
    post = (cen[:, 1] > 0.275) & (cen[:, 1] < 0.365) & (cen[:, 2] > 0.168)
    idx |= set(np.where(post)[0].tolist())
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in idx], context="FACES_ONLY")
    bm.to_mesh(me); bm.free()
    print("lens faces removed", len(idx))
    import bpy
    g = bpy.data.meshes.new("LensGlass")
    yy = P_SIGHT.y
    g.from_pydata([(x0, yy, z0), (x1, yy, z0), (x1, yy, z1), (x0, yy, z1)], [], [(0, 1, 2, 3)])
    g.materials.append(thin_glass("lens_glass", (0.93, 0.98, 1.0), 0.0))
    go = bpy.data.objects.new("LensGlass", g)
    for c in ob.users_collection: c.objects.link(go)
    go.parent = ob
    go.visible_shadow = False
