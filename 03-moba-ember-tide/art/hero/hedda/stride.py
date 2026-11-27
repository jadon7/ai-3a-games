"""量跑步动作里落地脚往后蹬多快（不经过网页）：逐帧取两只脚的脚掌（ToeBase）和脚踝的位置，脚贴地（离最低点 2 厘米以内）的那些帧里，
相对胯往后退的速度就是“原速”。换成游戏里的米/秒：乘以 游戏身高 ÷ 模型静止时的总高（连烟囱）。
用法: Blender -b --factory-startup -P art/hero/hedda/stride.py -- art/hero/hedda/game.glb [游戏身高=3.2]"""
import bpy, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]; H = float(argv[1]) if len(argv) > 1 else 3.2
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]; tall = max(zs) - min(zs); k = H / tall
ad = arm.animation_data; act = next(t for t in ad.nla_tracks if t.name == "run").strips[0].action
for t in ad.nla_tracks: t.mute = True
ad.action = act
if hasattr(ad, "action_slot") and len(act.slots): ad.action_slot = act.slots[0]
f0, f1 = [int(x) for x in act.frame_range]; P = {}
for f in range(f0, f1 + 1):
    sc.frame_set(f); W = arm.matrix_world
    for s in ("Left", "Right"):
        for b in ("ToeBase", "Foot"): P.setdefault((s, b), []).append(W @ arm.pose.bones["mixamorig:" + s + b].head)
    P.setdefault("hips", []).append(W @ arm.pose.bones["mixamorig:Hips"].head)
print("模型静止总高", round(tall, 3), "游戏里 1 单位 =", round(k, 3), "米")
allv = []
for s in ("Left", "Right"):
    for b in ("ToeBase", "Foot"):
        p = P[(s, b)]; lo = min(v.z for v in p); vs = []
        for i in range(1, len(p)):
            if p[i].z < lo + 0.02 and p[i - 1].z < lo + 0.02:
                rel = (p[i] - P["hips"][i]) - (p[i - 1] - P["hips"][i - 1]); vs.append(rel.y * 30)      # 面朝 -Y，往后是 +Y
        if vs:
            vs.sort(); med = vs[len(vs) // 2]; allv += vs
            print(s, b, "贴地帧", len(vs), "往后蹬（身高/秒）中位", round(med, 3), "→ 游戏里", round(med * k, 2), "米/秒")
allv.sort(); print("两只脚合起来的中位", round(allv[len(allv) // 2] * k, 2), "米/秒")
