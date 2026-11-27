"""非人形角色（四足等）的出品：打开动作管线摆正好的 <name>.blend，把整理好的动作加进去，导出给游戏用的 GLB。

人形角色走 hero_build.py（要摆站姿、装武器、握拳）。非人形的没有这些：模型原样用，待机也用视频读出来的动作，
所以这里只做三件事：材质改名和缩贴图、把 tools/hero_motion.py 整理好的动作一段段加进去、导出。

用法: Blender -b --factory-startup V2R/assets/model/<name>.blend -P tools/blender/creature_build.py -- <build.json>
build.json:
  {"name": "turtle",                                  管线里的名字（assets/model/<name>.blend、<name>_skeleton.json）
   "skeleton": "/…/video2rig/assets/model/turtle_skeleton.json",
   "out": "art/hero/torg_turtle/game.glb", "packed": "public/assets/hero/torg.glb", "tex": 2048,
   "motions": {"idle": "art/hero/torg_turtle/motions/idle.npz", "run": …}}
还没有动作的时候也能跑：导出来只有一段不动的 idle_pose，可以先在查看页和游戏里看模型。
"""
import bpy, json, os, sys
import numpy as np
from mathutils import Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
P = lambda p: p if os.path.isabs(p) else os.path.join(ROOT, p)
cfg = json.load(open(P(argv[0]), encoding="utf-8"))
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
root_obj = sc.objects.get("v2r_root")                          # 管线摆正用的根节点：带着它导出，角色才脚踩地面、面朝前
skel = json.load(open(P(cfg["skeleton"]), encoding="utf-8"))
root_bone = next(b["name"] for b in skel["bones"] if b.get("role") == "root")
bpy.context.view_layer.objects.active = arm
PB = arm.pose.bones
for pb in PB: pb.rotation_mode = "QUATERNION"
if not arm.animation_data: arm.animation_data_create()
for tr in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(tr)
arm.animation_data.action = None

# 材质：游戏里名字以 weapon 开头的当武器处理，其余当身体
for i, slot in enumerate(body.material_slots):
    if slot.material and not slot.material.name.startswith("weapon"): slot.material.name = "hero" if i == 0 else f"hero{i}"
size = cfg.get("tex", 2048)
for slot in body.material_slots:
    if not slot.material or not slot.material.use_nodes: continue
    for nd in slot.material.node_tree.nodes:
        if nd.type == "TEX_IMAGE" and nd.image and nd.image.size[0] > size: nd.image.scale(size, size)


def rest():
    for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)


def linear(act):
    fcs = []                                                   # 新版 Blender 的动作分层存曲线，老版直接挂在动作上
    if hasattr(act, "layers") and len(act.layers):
        for layer in act.layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []): fcs.extend(bag.fcurves)
    elif hasattr(act, "fcurves"): fcs = list(act.fcurves)
    for fc in fcs:
        for kp in fc.keyframe_points: kp.interpolation = "LINEAR"


def stash(act, name):
    """把一段动作放进自己的 NLA 轨道：导出时每条轨道是一段 glTF 动画"""
    act.name = name; tr = arm.animation_data.nla_tracks.new(); tr.name = name; tr.strips.new(name, int(act.frame_range[0]), act); arm.animation_data.action = None


fps = 30; sc.render.fps = fps; frames_max = 30
# 不动的一段：没有待机动作时游戏拿它垫着
arm.animation_data.action = bpy.data.actions.new("idle_pose"); rest()
for f in (0, 30):
    for pb in PB: pb.keyframe_insert("rotation_quaternion", frame=f)
    PB[root_bone].keyframe_insert("location", frame=f)
stash(arm.animation_data.action, "idle_pose")

for name, path in cfg.get("motions", {}).items():
    if not os.path.exists(P(path)): print("SKIP", name, "还没有动作数据"); continue
    m = np.load(P(path), allow_pickle=True); names = [str(x) for x in m["names"]]; q = m["quats"]; loc = m["loc"]; T = q.shape[0]
    arm.animation_data.action = bpy.data.actions.new(name); rest()
    for f in range(T):
        for i, nm in enumerate(names):
            pb = PB.get(nm)
            if pb is None: continue
            pb.rotation_quaternion = Quaternion(q[f, i]); pb.keyframe_insert("rotation_quaternion", frame=f)
        rb = PB[root_bone]; rb.location = Vector(loc[f]); rb.keyframe_insert("location", frame=f)
    linear(arm.animation_data.action)
    stash(arm.animation_data.action, name); frames_max = max(frames_max, T - 1); print("ACTION", name, T, "frames")
rest(); sc.frame_start = 0; sc.frame_end = frames_max; sc.frame_set(0); bpy.context.view_layer.update()

bpy.ops.object.select_all(action="DESELECT")
for o in (arm, body, root_obj):
    if o is not None: o.select_set(True)
bpy.context.view_layer.objects.active = arm
body.data.calc_loop_triangles(); print("MESH tris", len(body.data.loop_triangles), "materials", [s_.material.name for s_ in body.material_slots if s_.material], "bones", len(PB))
out = P(cfg["out"]); os.makedirs(os.path.dirname(out), exist_ok=True)
kw = dict(filepath=out, export_format="GLB", use_selection=True, export_animations=True, export_animation_mode="NLA_TRACKS", export_skins=True, export_yup=True, export_force_sampling=True, export_apply=False)
try: bpy.ops.export_scene.gltf(**kw, export_image_format="WEBP", export_image_quality=88)
except TypeError: bpy.ops.export_scene.gltf(**kw, export_image_format="JPEG", export_jpeg_quality=88)
print("SAVED", out, round(os.path.getsize(out) / 1e6, 2), "MB")
