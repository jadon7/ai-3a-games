"""量每段动作里两把刀刀尖的轨迹，找出手的时刻（照 art/hero/hedda/timing.py 改成双刀）。
用法: Blender -b --factory-startup -P art/hero_iti/timing.py -- <game.glb> [动作,…] [--table]
每段打印：时长；左右刀尖速度最大的三个时刻（秒、米/秒按身高 1 算）；胯的最高、最低（腾空、蹲多低）；--table 再打印逐帧表。
时间都是成品动作（30 帧每秒）里的秒数，和 public/assets/hero/iti.json 的 swing / hit / release / end 同一个尺子。"""
import bpy, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]; table = "--table" in argv; argv = [a for a in argv if a != "--table"]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
MX = "mixamorig:"
wi = [i for i, s in enumerate(body.material_slots) if s.material.name.startswith("weapon")]
vs = {v for p in body.data.polygons if p.material_index in wi for v in p.vertices}
TIP = {}
for side in ("Right", "Left"):
    hb = arm.data.bones[MX + side + "Hand"]; Minv = (arm.matrix_world @ hb.matrix_local).inverted(); h = arm.matrix_world @ hb.head_local
    mine = [body.matrix_world @ body.data.vertices[v].co for v in vs]; mine = [p for p in mine if (p - h).length < 0.45 and (p.x > 0) == (h.x > 0)]
    TIP[side] = Minv @ max(mine, key=lambda p: (p - h).length)
ad = arm.animation_data; tracks = {t.name: t for t in ad.nla_tracks}
acts = argv[1].split(",") if len(argv) > 1 else [t for t in tracks if t != "idle_pose"]
for a in acts:
    if a not in tracks: print("ACT", a, "没有这段"); continue
    act = tracks[a].strips[0].action
    for t in ad.nla_tracks: t.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and len(getattr(act, "slots", [])): ad.action_slot = act.slots[0]
    f0, f1 = [int(x) for x in act.frame_range]; rows = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f); r = {"f": f}
        for side in ("Right", "Left"): r[side] = arm.matrix_world @ arm.pose.bones[MX + side + "Hand"].matrix @ TIP[side]
        r["hips"] = arm.matrix_world @ arm.pose.bones[MX + "Hips"].head; rows.append(r)
    n = len(rows)
    def speed(i, side):
        a_, b_ = max(i - 1, 0), min(i + 1, n - 1); return (rows[b_][side] - rows[a_][side]).length / max((b_ - a_) / 30, 1e-6)
    print("ACT", a, f"{n} 帧 {(n - 1) / 30:.2f} 秒", "胯高 最低 %.2f 最高 %.2f（站姿约 0.5）" % (min(r["hips"].z for r in rows), max(r["hips"].z for r in rows)),
          "胯前移 %.2f" % (-(rows[-1]["hips"].y - rows[0]["hips"].y)))
    for side in ("Right", "Left"):
        sp = sorted(((speed(i, side), i) for i in range(n)), reverse=True); top = []
        for v, i in sp:
            if all(abs(i - j) > 4 for _, j in top): top.append((v, i))
            if len(top) == 3: break
        print(f"   {side:5s} 刀尖最快:", "  ".join(f"{i / 30:.2f}s({v:.1f})" for v, i in sorted(top, key=lambda x: x[1])))
    if table:
        for i, r in enumerate(rows):
            if i % 2: continue
            print(f"     {i / 30:5.2f}s 右尖 z {r['Right'].z:5.2f} 前 {-r['Right'].y:5.2f} 速 {speed(i, 'Right'):5.1f} | 左尖 z {r['Left'].z:5.2f} 前 {-r['Left'].y:5.2f} 速 {speed(i, 'Left'):5.1f} | 胯 z {r['hips'].z:4.2f} 前 {-r['hips'].y:5.2f}")
