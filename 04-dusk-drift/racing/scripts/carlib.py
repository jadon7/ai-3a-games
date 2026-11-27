# 车辆绑定工具：把导入的 Sketchfab 车模整理成统一骨架
#   <tag>_ROOT          位置 + 航向（世界）
#     <tag>_BODY        车身侧倾/俯仰/起伏（支点在侧倾中心）
#        <导入模型的车身部分>
#     <tag>_W_FL_STEER  前轮转向（绕 Z）
#        <tag>_W_FL_SPIN 车轮自转（绕 Y）
#           轮胎/轮辋/刹车盘
#        卡钳/轮毂（不自转）
# 约定：车头朝 +X，左侧 +Y，Z 向上，ROOT 位于轴距中点的地面。
import bpy, math
from mathutils import Vector, Matrix


def get_coll(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def move_to_coll(objs, coll):
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)


def descendants(o):
    out = []
    stack = list(o.children)
    while stack:
        c = stack.pop()
        out.append(c)
        stack.extend(c.children)
    return out


def world_bbox(objs):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            v = o.matrix_world @ Vector(c)
            mn.x, mn.y, mn.z = min(mn.x, v.x), min(mn.y, v.y), min(mn.z, v.z)
            mx.x, mx.y, mx.z = max(mx.x, v.x), max(mx.y, v.y), max(mx.z, v.z)
    return mn, mx


def new_empty(name, coll, loc=(0, 0, 0), parent=None, size=0.3):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = size
    e.empty_display_type = 'PLAIN_AXES'
    coll.objects.link(e)
    if parent:
        e.parent = parent
    e.location = loc
    return e


def reparent_keep_world(o, new_parent):
    mw = o.matrix_world.copy()
    o.parent = new_parent
    o.matrix_parent_inverse = Matrix.Identity(4)
    bpy.context.view_layer.update()
    o.matrix_world = mw


def build_rig(tag, src_top, wheels, front_dir_model, roll_center_z=0.30):
    """
    src_top: 导入模型的顶层物体（位于世界原点附近、轮胎着地）
    wheels: {'FL': {'spin': [obj...], 'fixed': [obj...]}, 'FR':..., 'RL':..., 'RR':...}
    front_dir_model: 模型里车头方向的世界向量（如 (0,-1,0)）
    """
    bpy.context.view_layer.update()
    coll = get_coll("Car_" + tag)
    allobjs = [src_top] + descendants(src_top)
    move_to_coll(allobjs, coll)

    # 车轮中心（世界）
    centers = {}
    radii = {}
    for k, w in wheels.items():
        mn, mx = world_bbox(w['spin'])
        centers[k] = (mn + mx) / 2
        radii[k] = (mx.z - mn.z) / 2
    mid = (centers['FL'] + centers['FR'] + centers['RL'] + centers['RR']) / 4
    ground_z = min(centers[k].z - radii[k] for k in centers)

    f = Vector(front_dir_model).normalized()
    yaw_fix = math.atan2(0.0, 1.0) - math.atan2(f.y, f.x)   # 把车头转到 +X

    root = new_empty(tag + "_ROOT", coll, size=1.0)
    body = new_empty(tag + "_BODY", coll, loc=(0, 0, roll_center_z), parent=root, size=0.5)
    bpy.context.view_layer.update()

    # 先把模型整体平移到轴距中点为原点、着地，再转到车头 +X
    T = Matrix.Rotation(yaw_fix, 4, 'Z') @ Matrix.Translation((-mid.x, -mid.y, -ground_z))
    src_top.matrix_world = T @ src_top.matrix_world
    bpy.context.view_layer.update()

    info = {'wheelbase': None, 'track': None, 'radius': {}, 'centers': {}}
    for k, w in wheels.items():
        mn, mx = world_bbox(w['spin'])
        c = (mn + mx) / 2
        r = (mx.z - mn.z) / 2
        info['radius'][k] = r
        info['centers'][k] = tuple(c)
        steer = new_empty(f"{tag}_W_{k}_STEER", coll, loc=c, parent=root, size=0.2)
        spin = new_empty(f"{tag}_W_{k}_SPIN", coll, loc=(0, 0, 0), parent=steer, size=0.15)
        spin.rotation_mode = 'XYZ'
        bpy.context.view_layer.update()
        for o in w['spin']:
            reparent_keep_world(o, spin)
        for o in w.get('fixed', []):
            reparent_keep_world(o, steer)
    info['wheelbase'] = info['centers']['FL'][0] - info['centers']['RL'][0]
    info['track'] = info['centers']['FL'][1] - info['centers']['FR'][1]

    reparent_keep_world(src_top, body)
    root["wheelbase"] = info['wheelbase']
    root["track_w"] = info['track']
    root["r_front"] = info['radius']['FL']
    root["r_rear"] = info['radius']['RL']
    # 车轮运动模糊步数
    for o in descendants(root):
        if o.type == 'MESH':
            try:
                o.cycles.use_motion_blur = True
            except Exception:
                pass
    for k in wheels:
        sp = bpy.data.objects[f"{tag}_W_{k}_SPIN"]
        for o in [sp] + descendants(sp):
            try:
                o.cycles.motion_steps = 5
            except Exception:
                pass
    return root, info


def duplicate_car(tag_src, tag_new):
    """复制整车层级（网格数据共享），返回新 ROOT。"""
    src_root = bpy.data.objects[tag_src + "_ROOT"]
    coll = get_coll("Car_" + tag_new)
    mapping = {}
    objs = [src_root] + descendants(src_root)
    for o in objs:
        n = o.copy()          # 共享 mesh data
        nm = o.name
        if nm.startswith(tag_src + "_"):
            n.name = tag_new + nm[len(tag_src):]
        else:
            n.name = tag_new + "__" + nm
        coll.objects.link(n)
        mapping[o] = n
    for o, n in mapping.items():
        if o.parent in mapping:
            n.parent = mapping[o.parent]
            n.matrix_parent_inverse = o.matrix_parent_inverse.copy()
    return mapping[src_root], mapping
