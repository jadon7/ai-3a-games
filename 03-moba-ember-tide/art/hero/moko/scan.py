"""摩珂自己用：把成品模型里每段动作隔几帧扫一遍，量穿模和陷地。
用法: Blender -b --factory-startup -P art/hero/moko/scan.py -- in.glb [动作,动作…=全部] [步长=4]
每行：动作 帧 | 身体最低点 灯杖最低点 | 灯杖顶点陷进身体的个数，按部位分（斗笠和头、躯干、腿、左臂；右手右前臂不算）| 左手陷进身体的顶点数
"""
import bpy, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index("--") + 1:]
src = argv[0]; only = argv[1].split(",") if len(argv) > 1 and argv[1] not in ("", "-") else None; step = int(argv[2]) if len(argv) > 2 else 4
MX = "mixamorig:"
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and len(o.vertex_groups) == 0: bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in sc.objects if o.type == "MESH")
if not arm.animation_data: arm.animation_data_create()
for tr in list(arm.animation_data.nla_tracks): tr.mute = True
names = [s.material.name if s.material else "?" for s in body.material_slots]; gname = {g.index: g.name.replace(MX, "") for g in body.vertex_groups}
def dom(v):
    gs = v.groups; return gname[max(gs, key=lambda g: g.weight).group] if len(gs) else "?"
DOM = [dom(v) for v in body.data.vertices]
def region(b):
    if b in ("Head", "HeadTop_End", "Neck"): return "头笠"
    if b.startswith("Spine") or b == "Hips" or b.endswith("Shoulder"): return "躯干"
    if "Leg" in b or "Foot" in b or "Toe" in b: return "腿"
    if b.startswith("Left"): return "左臂"
    if b in ("RightArm",): return "右上臂"
    return None                                                # 右前臂、右手、右手指：握着杖，不算
body.data.calc_loop_triangles()
tris = [(tuple(t.vertices), names[t.material_index].startswith("weapon")) for t in body.data.loop_triangles]
btri = [t for t, w in tris if not w]; wv = sorted({v for t, w in tris if w for v in t}); wv = wv[::3]      # 灯杖顶点抽三分之一，够用
treg = [region(DOM[t[0]]) for t in btri]
lhv = [i for i, b in enumerate(DOM) if b.startswith("LeftHand")][::2]
core = [i for i, t in enumerate(btri) if treg[i] in ("躯干", "腿", "头笠")]
dirs = [Vector(d).normalized() for d in ((1, 0.13, 0.07), (-1, 0.11, 0.09), (0.12, 1, 0.05), (0.07, -1, 0.11), (0.09, 0.13, 1), (0.1, 0.07, -1))]
def inside(tree, p):
    votes = 0
    for d in dirs:
        n = 0; o = p.copy()
        for _ in range(60):
            hit = tree.ray_cast(o, d)
            if hit[0] is None: break
            n += 1; o = hit[0] + d * 1e-5
        votes += n % 2
    return votes >= 4
acts = [a for a in bpy.data.actions if (only is None or a.name in only)]
print("SCAN 动作 帧 | 身体最低 杖最低 杖最高 | 杖陷进: 头笠 躯干 腿 左臂 右上臂 | 左手陷进躯干腿头")
for act in sorted(acts, key=lambda a: a.name):
    arm.animation_data.action = act
    try:
        if getattr(act, "slots", None) and len(act.slots): arm.animation_data.action_slot = act.slots[0]
    except Exception as e: print("SLOT", e)
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    for f in sorted(set(list(range(f0, f1 + 1, step)) + [f1])):
        sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
        co = [body.matrix_world @ v.co for v in me.vertices]; ev.to_mesh_clear()
        tree = BVHTree.FromPolygons(co, btri); cnt = {"头笠": 0, "躯干": 0, "腿": 0, "左臂": 0, "右上臂": 0}
        for vi in wv:
            p = co[vi]
            if inside(tree, p):
                r = treg[tree.find_nearest(p)[2]]
                if r: cnt[r] += 1
        ctree = BVHTree.FromPolygons(co, [btri[i] for i in core]); lh = sum(1 for vi in lhv if inside(ctree, co[vi]))
        bz = min(co[v].z for t in btri for v in t[:1]); wz = [co[v].z for v in wv]
        print("SCAN %-8s %3d | %+.3f %+.3f %.2f | %3d %3d %3d %3d %3d | %3d" % (act.name, f, bz, min(wz), max(wz), cnt["头笠"], cnt["躯干"], cnt["腿"], cnt["左臂"], cnt["右上臂"], lh))
