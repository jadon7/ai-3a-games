"""Blender 端公共函数：搭棚、读写姿态、读关节位置。所有脚本都用无界面的 Blender 运行。"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from v2r import skeleton as sk  # noqa: E402

VIEW_W, VIEW_H = 640, 720        # 单机位参考图分辨率（8:9）
BG_GREY = 0.60


def script_args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def character():
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.context.scene.objects
                if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
    return arm, mesh


def build_studio(scene):
    """灰色无缝棚 + 正面/侧面两个正交机位。"""
    world = bpy.data.worlds.new("v2r_world")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (BG_GREY, BG_GREY, BG_GREY, 1.0)
    bg.inputs[1].default_value = 1.0
    scene.world = world

    def sun(name, energy, direction):
        ob = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
        ob.data.energy = energy
        ob.data.angle = math.radians(25)          # 软阴影
        # 太阳灯沿自身 -Z 照射：让 -Z 对准 direction
        ob.rotation_euler = Vector(direction).normalized().to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(ob)
        return ob

    sun("v2r_key", 2.6, (0.55, 0.75, -0.9))       # 从角色右前上方打下来，两个机位都能照到受光面
    sun("v2r_fill", 0.9, (-0.6, 0.5, -0.4))

    def cam(name, loc, rot):
        ob = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        ob.data.type = "ORTHO"
        ob.data.ortho_scale = sk.ORTHO_H           # 竖构图时 ortho_scale 对应画面高度
        ob.data.clip_start, ob.data.clip_end = 0.1, 50
        ob.location = loc
        ob.rotation_euler = rot
        scene.collection.objects.link(ob)
        return ob

    cam("cam_front", (0, -8, sk.Z_CENTER), (math.radians(90), 0, 0))
    cam("cam_side", (-8, 0, sk.Z_CENTER), (math.radians(90), 0, math.radians(-90)))
    setup_render(scene)


def setup_render(scene, w=VIEW_W, h=VIEW_H, samples=32, fmt="PNG", quality=92):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.eevee.taa_render_samples = samples
    scene.render.image_settings.file_format = fmt
    if fmt == "JPEG":
        scene.render.image_settings.quality = quality
    scene.render.image_settings.color_mode = "RGB"
    for vt in ("Standard",):
        try:
            scene.view_settings.view_transform = vt
        except TypeError:
            pass
    try:
        scene.view_settings.look = "None"
    except TypeError:
        pass


def cameras(scene):
    return {v: scene.objects[f"cam_{v}"] for v in sk.VIEWS}


def render_views(scene, out_pattern):
    """按 front / side 各渲染当前帧，out_pattern 里用 {view} 占位。"""
    paths = {}
    for v, cam in cameras(scene).items():
        scene.camera = cam
        scene.render.filepath = out_pattern.format(view=v)
        bpy.ops.render.render(write_still=True)
        paths[v] = scene.render.filepath
    return paths


def set_pose(arm, skel, quats, loc, frame=None):
    """把 skel.blender_pose() 的结果写到 pose bones 上；给了 frame 就顺便打关键帧。"""
    pbs = arm.pose.bones
    for i, name in enumerate(skel.names):
        if skel.roles[i] is None:
            continue
        pb = pbs[name]
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion(quats[i])
        if frame is not None:
            pb.keyframe_insert("rotation_quaternion", frame=frame)
    root = pbs[skel.names[skel.root]]
    root.location = Vector(loc)
    if frame is not None:
        root.keyframe_insert("location", frame=frame)


def pose_from_params(skel, params):
    """params: {'theta','ypr','t'} -> (quats, loc, joints_world)。"""
    A = sk.euler_root(*params["ypr"])
    joints, Q = skel.pose_joints(params["theta"], A, params["t"])
    quats, loc = skel.blender_pose(Q, params["t"])
    return quats, loc, joints


def read_joints(arm, skel):
    """从 Blender 里读回当前姿态下各跟踪关节的世界坐标（标签用这个，不用我自己算的 FK）。"""
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    out = np.empty((skel.K, 3))
    for k, (_, bi, _) in enumerate(skel.joints):
        pb = arm.pose.bones[skel.names[bi]]
        off = Vector(skel.joint_offset_local[k] / skel.scale)     # 标记点在骨骼自身坐标系里的偏移
        out[k] = mw @ (pb.matrix @ off)
    return out


def linear_fcurves(arm):
    """把骨架动画的插值全改成线性（数据集里相邻样本之间不需要缓动）。"""
    ad = arm.animation_data
    if not ad or not ad.action:
        return
    act = ad.action
    fcurves = []
    if hasattr(act, "layers") and len(act.layers):
        for layer in act.layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    fcurves.extend(bag.fcurves)
    elif hasattr(act, "fcurves"):
        fcurves = list(act.fcurves)
    for fc in fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    return len(fcurves)
