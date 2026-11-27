"""把 game.glb 里每段动作逐帧的关键点轨迹存成 json（刀尖、刀镡、两手、两肘、两膝、两脚、胯、头），给 timing_report.py 定时间点用。
刀是单独的网格对象 weapon（蒙在右手上）：刀尖 = 刀上离右手最远的顶点，刀镡 = 刀尖和柄尾连线 27% 处。
用法: Blender -b --factory-startup -P track.py -- <game.glb> <输出.json> [动作,…]"""
import bpy, sys, json
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); wpn = sc.objects["weapon"]
MX = "mixamorig:"; hb = arm.data.bones[MX + "RightHand"]; Minv = (arm.matrix_world @ hb.matrix_local).inverted()
pts = [Minv @ (wpn.matrix_world @ v.co) for v in wpn.data.vertices]
tip = max(pts, key=lambda p: p.length); pom = max(pts, key=lambda p: (p - tip).length); base = pom + (tip - pom) * 0.27
J = {"LH": "LeftHand", "RH": "RightHand", "LE": "LeftForeArm", "RE": "RightForeArm", "LK": "LeftLeg", "RK": "RightLeg", "LF": "LeftToeBase", "RF": "RightToeBase",
     "LA": "LeftFoot", "RA": "RightFoot", "HIP": "Hips", "HEAD": "Head", "LS": "LeftArm", "RS": "RightArm"}
ad = arm.animation_data; tracks = {t.name: t for t in ad.nla_tracks}
acts = argv[2].split(",") if len(argv) > 2 else [t for t in tracks if t != "idle_pose"]
out = {}
for a in acts:
    if a not in tracks: continue
    act = tracks[a].strips[0].action
    for t in ad.nla_tracks: t.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and len(getattr(act, "slots", [])): ad.action_slot = act.slots[0]
    f0, f1 = [int(x) for x in act.frame_range]; rows = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f); W = arm.matrix_world; r = {}
        Wh = W @ arm.pose.bones[MX + "RightHand"].matrix
        r["W"] = list(Wh @ tip); r["WB"] = list(Wh @ base)
        for k, b in J.items(): r[k] = list(W @ arm.pose.bones[MX + b].head)
        rows.append(r)
    out[a] = rows; print("TRACK", a, len(rows))
json.dump(out, open(argv[1], "w"))
