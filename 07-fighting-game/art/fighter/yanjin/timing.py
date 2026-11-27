"""量每段动作的时间点：各肢体末端（拳=中指根、肘、脚尖、膝）每帧往前伸多远（-Y，减去胯的起始位置）、高度、速度；两只脚离地高度。
打印紧凑的表，另存 json（给写时间表用）。
用法: Blender -b --factory-startup -P timing.py -- <game.glb> <输出.json> [动作,…]"""
import bpy, sys, json
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); MX = "mixamorig:"; PB = arm.pose.bones; Mw = arm.matrix_world
ad = arm.animation_data; tracks = {t.name: t for t in ad.nla_tracks}
acts = argv[2].split(",") if len(argv) > 2 else [t for t in tracks if t != "idle_pose"]
LIMB = {"LH": ("LeftHandMiddle1", "head"), "RH": ("RightHandMiddle1", "head"), "LE": ("LeftForeArm", "head"), "RE": ("RightForeArm", "head"),
        "LF": ("LeftToe_End", "head"), "RF": ("RightToe_End", "head"), "LK": ("LeftLeg", "head"), "RK": ("RightLeg", "head")}
def P(bn, which="head"): pb = PB[MX + bn]; return Mw @ (pb.head if which == "head" else pb.tail)
res = {}
for a in acts:
    if a not in tracks: continue
    act = tracks[a].strips[0].action
    for t in ad.nla_tracks: t.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and len(getattr(act, "slots", [])): ad.action_slot = act.slots[0]
    f0, f1 = [int(round(x)) for x in act.frame_range]; rows = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f); r = {"f": f}
        hp = P("Hips"); r["hips"] = [round(hp.x, 3), round(-hp.y, 3), round(hp.z, 3)]
        for k, (bn, w) in LIMB.items(): v = P(bn, w); r[k] = [round(v.x, 3), round(-v.y, 3), round(v.z, 3)]
        r["footz"] = [round(min(P("LeftFoot").z, P("LeftToeBase").z, P("LeftToe_End").z), 3), round(min(P("RightFoot").z, P("RightToeBase").z, P("RightToe_End").z), 3)]
        rows.append(r)
    for i, r in enumerate(rows):
        a_, b_ = rows[max(i - 1, 0)], rows[min(i + 1, len(rows) - 1)]; dt = (b_["f"] - a_["f"]) / 30 or 1
        r["v"] = {k: round((Vector(b_[k]) - Vector(a_[k])).length / dt, 2) for k in LIMB}
    res[a] = rows
    print("ACT", a, f"{len(rows)} 帧 {(len(rows) - 1) / 30:.2f} 秒")
    for k in LIMB:
        fw = [r[k][1] for r in rows]; vv = [r["v"][k] for r in rows]; i1 = max(range(len(rows)), key=lambda i: fw[i]); i2 = max(range(len(rows)), key=lambda i: vv[i])
        print(f"  {k}: 最前 {fw[i1]:.2f} @ {rows[i1]['f']/30:.2f}s（起始 {fw[0]:.2f}）  最快 {vv[i2]:.1f}/s @ {rows[i2]['f']/30:.2f}s  最高 z {max(r[k][2] for r in rows):.2f}")
    fz = [min(r["footz"]) for r in rows]; hz = [r["hips"][2] for r in rows]
    print(f"  双脚最低点 min {min(fz):.3f} max {max(fz):.3f}  胯高 {min(hz):.3f}..{max(hz):.3f}（起始 {hz[0]:.3f}）")
    print("  逐帧[f 胯z 双脚最低 LH前 RH前 LF前 RF前 RF高]:", " | ".join(f"{r['f']} {r['hips'][2]:.2f} {min(r['footz']):.2f} {r['LH'][1]:.2f} {r['RH'][1]:.2f} {r['LF'][1]:.2f} {r['RF'][1]:.2f} {r['RF'][2]:.2f}" for r in rows[::2]))
json.dump(res, open(argv[1], "w"))
