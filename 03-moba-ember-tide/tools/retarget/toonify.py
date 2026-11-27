"""把一个绑好骨的模型改成卡通比例（头大、手/爪大、腿短），当成“同一个角色的新模型”来试套动作。不花积分。

第二批真正的新模型是 Tripo 照 B 风格设定图重出的，比例、网格、绑骨都会变；这里先用改比例的办法模拟“比例变了”这一件事，
看旧动作套上去以后脚、手、武器、穿模会出什么问题。

做法：在姿势模式里给骨骼加缩放（头、手整体放大；大腿、小腿只沿骨骼方向缩短，脚不跟着缩），用骨架修改器把网格变形过去，
再把这个姿势当成新的静止姿势（网格和骨架都改过去，蒙皮权重原样），最后整体下移让脚踩回地面。
武器不跟着手放大：武器的顶点按“手心握的那一点”整块平移过去，大小、朝向不变（第二批的武器是在 rig 一步按 build.json 的长度重新装的）。

用法:
  人形（Mixamo 骨骼名，装好武器的 rigged.glb）：
    Blender -b --factory-startup -P tools/retarget/toonify.py -- <输入.glb> <输出.glb> [头=1.35] [手=1.4] [腿=0.75] [脚=1.1] [躯干粗=1.0] [手臂=1.0]
  四足等（管线摆正好的 .blend，骨骼名各不相同，写一份 spec.json）：
    Blender -b --factory-startup <输入.blend> -P tools/retarget/toonify.py -- - <输出.blend> <spec.json>
    spec: {"scale": {"骨骼": 倍数, …}（整体放大，下面的骨骼跟着）, "shorten": {"骨骼": 倍数, …}（只沿骨骼方向缩，下面的骨骼不跟着缩）}
"""
import bpy, sys, os, json
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index("--") + 1:]
src, out = a[0], a[1]
MX = "mixamorig:"
if src != "-":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
sc = bpy.context.scene; upd = bpy.context.view_layer.update
arm = next(o for o in sc.objects if o.type == "ARMATURE")
skinned = [o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups)]
body = next((o for o in skinned if any(m.type == "ARMATURE" for m in o.modifiers)), skinned[0])
if src != "-":
    for o in list(sc.objects):
        if o not in (arm, body): bpy.data.objects.remove(o, do_unlink=True)
B = arm.data.bones; PB = arm.pose.bones

if len(a) > 2 and a[2].endswith(".json"):
    spec = json.load(open(a[2], encoding="utf-8")); hands = {}
else:
    HEAD, HAND, LEG, FOOT, BODY, ARM = [float(x) for x in (a[2:] + ["1.35", "1.4", "0.75", "1.1", "1.0", "1.0"][len(a) - 2:])][:6]
    spec = {"scale": {MX + "Head": HEAD, MX + "LeftHand": HAND, MX + "RightHand": HAND, MX + "LeftFoot": FOOT, MX + "RightFoot": FOOT},
            "shorten": {MX + s + n: LEG for s in ("Left", "Right") for n in ("UpLeg", "Leg")}, "fat": {MX + n: BODY for n in ("Spine", "Spine1", "Spine2")} if BODY != 1.0 else {}}
    if ARM != 1.0: spec["shorten"].update({MX + s + n: ARM for s in ("Left", "Right") for n in ("Arm", "ForeArm")})
    hands = {s: HAND for s in ("Left", "Right")}

# 武器顶点（材质名以 weapon 开头），和它们握在哪只手
wmat = {i for i, s in enumerate(body.material_slots) if s.material and s.material.name.startswith("weapon")}
gname = {g.index: g.name for g in body.vertex_groups}
weapon = {}
for p in body.data.polygons:
    if p.material_index in wmat:
        for vi in p.vertices:
            v = body.data.vertices[vi]; g = max(v.groups, key=lambda g: g.weight); weapon[vi] = gname[g.group]
def grip_point(side):
    """hero_build.py 的握把中心（不算掌心偏移）：手骨头 + (中指根 − 手骨头) × 0.7"""
    h = B[MX + side + "Hand"].head_local; mid = B[MX + side + "HandMiddle1"].head_local
    return h + (mid - h) * 0.7
grip0 = {s: (arm.matrix_world @ grip_point(s)) for s in hands}
hand0 = {s: (arm.matrix_world @ B[MX + s + "Hand"].head_local) for s in hands}
rest_w = {vi: body.matrix_world @ body.data.vertices[vi].co for vi in weapon}

# 姿势里加缩放。缩短的骨骼：它的子骨骼不继承缩放（只是头跟着挪到缩短后的尾巴上），这样脚、爪不会被压扁
for pb in PB: pb.rotation_mode = "QUATERNION"
fixed = []
for n, k in spec.get("shorten", {}).items():
    PB[n].scale = (1, k, 1)
    for c in B[n].children:
        if c.name not in spec.get("shorten", {}): fixed.append((c.name, c.inherit_scale)); c.inherit_scale = "NONE"
    if B[n].parent and B[n].parent.name in spec.get("shorten", {}): fixed.append((n, B[n].inherit_scale)); B[n].inherit_scale = "NONE"
for n, k in spec.get("scale", {}).items(): PB[n].scale = (k, k, k)
for n, k in spec.get("fat", {}).items(): PB[n].scale = (k, 1, k)
upd()

# 网格按这个姿势变形，定下来
dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = bpy.data.meshes.new_from_object(ev)
posed = [v.co.copy() for v in me.vertices]; bpy.data.meshes.remove(me)
hand1 = {s: (arm.matrix_world @ PB[MX + s + "Hand"].head) for s in hands}
for vi, co in enumerate(posed): body.data.vertices[vi].co = co
# 武器整块平移：握的那一点跟着放大的手走（手绕自己的头放大 HAND 倍），武器本身不缩放、不转
for vi, g in weapon.items():
    side = "Left" if "Left" in g else "Right"
    if side not in hands: continue
    p1 = hand1[side] + (grip0[side] - hand0[side]) * hands[side]
    body.data.vertices[vi].co = body.matrix_world.inverted() @ (rest_w[vi] + (p1 - grip0[side]))
body.data.update()

# 姿势当成新的静止姿势
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = arm; arm.select_set(True)
bpy.ops.object.mode_set(mode="POSE"); bpy.ops.pose.select_all(action="SELECT"); bpy.ops.pose.armature_apply(selected=False); bpy.ops.object.mode_set(mode="OBJECT")
for n, inh in fixed: B[n].inherit_scale = inh
upd()
# 脚踩回地面：整体下移（四足挂在 v2r_root 下面，挪它）
zmin = min((body.matrix_world @ v.co).z for v in body.data.vertices if v.index not in weapon)
top_obj = arm.parent if arm.parent is not None else None
if top_obj is not None: top_obj.location.z -= zmin
else:
    T = Matrix.Translation((0, 0, -zmin)); arm.data.transform(T); body.data.transform(T); body.data.update()
upd()
top = max((body.matrix_world @ v.co).z for v in body.data.vertices)
print("TOON", json.dumps({k: v for k, v in spec.items()}, ensure_ascii=False)[:300], "-> height", round(top, 3), "weapon verts", len(weapon))
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
if out.endswith(".blend"):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out), copy=True)
else:
    bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True); body.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(out), export_format="GLB", use_selection=True, export_animations=False, export_skins=True, export_yup=True, export_apply=False)
print("SAVED", out)
