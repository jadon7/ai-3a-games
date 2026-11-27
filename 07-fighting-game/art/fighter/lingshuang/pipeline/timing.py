"""量每段动作里火钳钳口尖的轨迹：每帧的速度、高度、离身体多远（往前），找出手的时刻。用法: Blender -b --factory-startup -P art/hero/lingshuang/timing.py -- art/hero/lingshuang/game.glb [动作,…]"""
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
MX = "mixamorig:"; hb = arm.data.bones[MX + "RightHand"]; Minv = (arm.matrix_world @ hb.matrix_local).inverted()
wi = [i for i, s in enumerate(body.material_slots) if s.material.name.startswith("weapon")]
vs = {v for p in body.data.polygons if p.material_index in wi for v in p.vertices}
pts = [Minv @ (body.matrix_world @ body.data.vertices[v].co) for v in vs]; tip = max(pts, key=lambda p: p.length)
print("TIP local", [round(x, 3) for x in tip], "len", round(tip.length, 3))
ad = arm.animation_data; tracks = {t.name: t for t in ad.nla_tracks}
acts = argv[1].split(",") if len(argv) > 1 else [t for t in tracks if t != "idle_pose"]
for a in acts:
    act = tracks[a].strips[0].action
    for t in ad.nla_tracks: t.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and len(getattr(act, "slots", [])): ad.action_slot = act.slots[0]
    f0, f1 = [int(x) for x in act.frame_range]; rows = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f); pb = arm.pose.bones[MX + "RightHand"]; W = arm.matrix_world @ pb.matrix
        T = W @ tip; hips = arm.matrix_world @ arm.pose.bones[MX + "Hips"].head; lh = arm.matrix_world @ arm.pose.bones[MX + "LeftHand"].head
        rows.append((f, T, hips, lh))
    print("ACT", a, f"{f1 - f0 + 1} 帧 {(f1 - f0) / 30:.2f} 秒")
    for i, (f, T, hp, lh) in enumerate(rows):
        v = (rows[min(i + 1, len(rows) - 1)][1] - rows[max(i - 1, 0)][1]).length / ((min(i + 1, len(rows) - 1) - max(i - 1, 0)) / 30 or 1)
        vl = (rows[min(i + 1, len(rows) - 1)][3] - rows[max(i - 1, 0)][3]).length / ((min(i + 1, len(rows) - 1) - max(i - 1, 0)) / 30 or 1)
        print(f"  {f:3d} {f/30:5.2f}s 尖 z {T.z:5.2f} 前 {-T.y:5.2f} 左右 {T.x:+.2f} 速 {v:5.2f}  左手 z {lh.z:4.2f} 前 {-lh.y:5.2f} 速 {vl:5.2f}")
