"""第一人称手臂 + 格洛克：冻结在持枪瞄准姿态，挂到一个 VM 空物体下。
VM 局部坐标：+Y 枪口方向，+Z 上，+X 右。
"""
import bpy, os, math
from mathutils import Vector, Matrix
from common import ASSETS, coll, import_gltf, empty, bsdf_of, move_to

AIM_FRAME = 55


def build_viewmodel(c, parent=None):
    scn = bpy.context.scene
    new, acts = import_gltf(os.path.join(ASSETS, "arms_g17", "scene.gltf"), c)
    scn.frame_set(AIM_FRAME)
    bpy.context.view_layer.update()
    arm = next(o for o in new if o.type == "ARMATURE")
    # 记录冻结姿态
    mw = {o.name: o.matrix_world.copy() for o in new}
    pose = {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy(), pb.rotation_euler.copy(), pb.scale.copy(), pb.rotation_mode) for pb in arm.pose.bones}
    for o in new:
        if o.animation_data:
            o.animation_data_clear()
    for pb in arm.pose.bones:
        loc, rq, re, sc, mode = pose[pb.name]
        pb.rotation_mode = mode
        pb.location = loc; pb.rotation_quaternion = rq; pb.rotation_euler = re; pb.scale = sc
    vm = empty("VM", c, parent)
    # 所有顶层节点改挂 VM，保持世界矩阵
    names = {o.name for o in new}
    tops = [o for o in new if o.parent is None or o.parent.name not in names]
    for o in new:
        o.matrix_world = mw[o.name]
    bpy.context.view_layer.update()
    for o in tops:
        o.parent = vm
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.matrix_world = mw[o.name]
    bpy.context.view_layer.update()

    parts = {}
    for o in new:
        if o.type == "MESH":
            parts[o.name] = o
    # 袖子/手套贴图太黑，提亮一些让布料细节可见
    for m in {m for o in new if o.type == "MESH" for m in o.data.materials if m and m.name.startswith("arms")}:
        b = bsdf_of(m)
        lk = next((l for l in m.node_tree.links if l.to_node == b and l.to_socket.name == "Base Color"), None)
        if lk:
            src = lk.from_socket
            mul = m.node_tree.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"
            mul.inputs["Factor"].default_value = 1.0; mul.inputs["B"].default_value = (2.6, 2.6, 2.6, 1)
            m.node_tree.links.new(src, mul.inputs["A"]); m.node_tree.links.new(mul.outputs["Result"], b.inputs["Base Color"])
    slide_node = next((o for o in new if o.name.startswith("g17_slide") and o.type == "EMPTY"), None)
    trigger_node = next((o for o in new if o.name.startswith("g17_trigger") and o.type == "EMPTY"), None)

    def wbbox(objs):
        mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
        for o in objs:
            for corner in o.bound_box:
                w = o.matrix_world @ Vector(corner)
                mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
        return mn, mx

    slide_meshes = [o for o in new if o.type == "MESH" and "slide_07" in o.name]
    barrel = [o for o in new if o.type == "MESH" and "Barrel" in o.name]
    frame = [o for o in new if o.type == "MESH" and "Frame" in o.name]
    smn, smx = wbbox(slide_meshes); bmn, bmx = wbbox(barrel); fmn, fmx = wbbox(frame)
    info = {
        "muzzle": Vector(((bmn.x + bmx.x) / 2, smx.y, (bmn.z + bmx.z) / 2)),
        "slide_min": smn, "slide_max": smx, "frame_min": fmn, "frame_max": fmx,
        "eject": Vector((smx.x, (smn.y + smx.y) / 2 + 0.01, smx.z - 0.006)),
    }
    print("VM muzzle", [round(v, 4) for v in info["muzzle"]], "slide", [round(v, 3) for v in smn], [round(v, 3) for v in smx],
          "frame", [round(v, 3) for v in fmn], [round(v, 3) for v in fmx])

    # 枪灯：导轨下的小灯体
    rail_z = fmx.z - 0.036
    ly = info["muzzle"].y - 0.035
    lx = info["muzzle"].x
    bpy.ops.mesh.primitive_cube_add(size=1)
    body = bpy.context.active_object; body.name = "WeaponLightBody"; move_to(body, c)
    body.parent = vm; body.scale = (0.028, 0.062, 0.03); body.location = (lx, ly - 0.012, rail_z - 0.012)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0145, depth=0.03, vertices=24)
    head = bpy.context.active_object; head.name = "WeaponLightHead"; move_to(head, c)
    head.parent = vm; head.rotation_euler = (math.radians(90), 0, 0); head.location = (lx, ly + 0.03, rail_z - 0.012)
    bm = bpy.data.materials.new("LightBody"); bm.use_nodes = True
    b = bsdf_of(bm); b.inputs["Base Color"].default_value = (0.012, 0.012, 0.013, 1); b.inputs["Roughness"].default_value = 0.45; b.inputs["Metallic"].default_value = 0.6
    body.data.materials.append(bm); head.data.materials.append(bm)
    for o in (body, head):
        bev = o.modifiers.new("bev", "BEVEL"); bev.width = 0.002; bev.segments = 2
    info["light_pos"] = Vector((lx, ly + 0.05, rail_z - 0.012))
    info["slide_node"] = slide_node
    info["trigger_node"] = trigger_node
    info["arm"] = arm
    info["vm"] = vm
    info["objects"] = new + [body, head]
    return vm, info


def add_weapon_light(vm, info, c, hot=8000.0, spill=450.0):
    lights = []
    for name, energy, size, blend, col in (
        ("WL_Hot", hot * 0.6, 9, 1.0, (1.0, 0.97, 0.92)),
        ("WL_Mid", hot * 0.22, 22, 1.0, (1.0, 0.97, 0.92)),
        ("WL_Spill", spill, 62, 0.55, (1.0, 0.97, 0.93)),
    ):
        ld = bpy.data.lights.new(name, "SPOT"); lo = bpy.data.objects.new(name, ld); c.objects.link(lo)
        ld.energy = energy; ld.spot_size = math.radians(size); ld.spot_blend = blend
        ld.shadow_soft_size = 0.008; ld.color = col
        lo.parent = vm; lo.location = info["light_pos"]; lo.rotation_euler = (math.radians(90), 0, 0)
        lights.append(lo)
    return lights


def add_sleeve_caps(vm, info, c):
    """把上臂袖口的空洞用深色椭球封住，避免低头时穿帮。"""
    arm_mesh = next(o for o in info["objects"] if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
    dg = bpy.context.evaluated_depsgraph_get()
    ev = arm_mesh.evaluated_get(dg); me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    vmi = vm.matrix_world.inverted()
    pts = [vmi @ p for p in pts]
    ymin = min(p.y for p in pts)
    mat = bpy.data.materials.new("SleeveCap"); mat.use_nodes = True
    b = bsdf_of(mat); b.inputs["Base Color"].default_value = (0.010, 0.010, 0.011, 1); b.inputs["Roughness"].default_value = 0.92
    for side in (-1, 1):
        ring = [p for p in pts if p.y < ymin + 0.06 and (p.x - 0.0) * side > 0]
        if not ring:
            continue
        cen = sum(ring, Vector()) / len(ring)
        rad = max((Vector((p.x, 0, p.z)) - Vector((cen.x, 0, cen.z))).length for p in ring)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=24, ring_count=12)
        s_ = bpy.context.active_object; s_.name = "SleeveCap"; move_to(s_, c)
        s_.parent = vm
        s_.scale = (rad * 1.12, 0.20, rad * 1.12)
        s_.location = (cen.x + side * 0.02, cen.y - 0.085, cen.z - 0.03)
        s_.data.materials.append(mat)
        for poly in s_.data.polygons:
            poly.use_smooth = True
        print("CAP", side, [round(v, 3) for v in cen], round(rad, 3))
