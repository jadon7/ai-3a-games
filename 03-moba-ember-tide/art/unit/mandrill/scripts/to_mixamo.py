"""把 Tripo 按人形绑出来的山魈（骨骼是 Tripo 自己的命名：Hip / Waist / L_Thigh …，不是 Mixamo 的）改成管线认得的 Mixamo 命名。

只改名字和骨架的整理，不重新绑骨，权重原样带过去：
  · 改名：Hip→Hips，Waist/Spine01/Spine02→Spine/Spine1/Spine2，NeckTwist01→Neck，L_Thigh→LeftUpLeg …（见 MID、SIDE 两张表），加 mixamorig: 前缀。
  · 删掉没有权重的辅助骨骼（BoneRoot、各种 Twist、ShareBone、眼睛、NeckTwist02）；Pelvis 的权重并进 Hips。
  · 补上管线要跟踪、Tripo 没给的末端骨骼：脚尖 Toe_End、中指尖 HandMiddle4、拇指尖 HandThumb4（位置从网格上量）；FacialBone（两眼之间、面具上）当 HeadTop_End。
  · 每根骨骼的尾巴对到下一节的头上（管线用“头→尾”的方向定关节轴）。
  · 整体缩到 SCALE 倍：山魈手臂特别长（垂下来快到地），举过头顶时按身高 1.0 会顶出画面上沿。游戏里按包围盒重新缩放，不受影响。
  · weights.json（可选）里写的权重修补（见 fix_weights）。

用法: Blender -b --factory-startup -P to_mixamo.py -- <tripo_rigged.glb> <输出 mandrill_rigged.glb> [缩放=0.82] [权重修补 json]
"""
import bpy, json, os, sys
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]; SCALE = float(argv[2]) if len(argv) > 2 else 0.82; fix_path = argv[3] if len(argv) > 3 else None
MID = {"Hip": "Hips", "Waist": "Spine", "Spine01": "Spine1", "Spine02": "Spine2", "NeckTwist01": "Neck", "Head": "Head", "FacialBone": "HeadTop_End"}
SIDE = {"Clavicle": "Shoulder", "Upperarm": "Arm", "Forearm": "ForeArm", "Hand": "Hand", "Thigh": "UpLeg", "Calf": "Leg", "Foot": "Foot", "ToeBase": "ToeBase"}
for f_src, f_dst in (("Index", "HandIndex"), ("Mid", "HandMiddle"), ("Ring", "HandRing"), ("Pinky", "HandPinky"), ("Thumb", "HandThumb")):
    for k in "123": SIDE[f_src + k] = f_dst + k
PRE = "mixamorig:"


def new_name(n):
    if n in MID: return PRE + MID[n]
    for p, full in (("L_", "Left"), ("R_", "Right")):
        if n.startswith(p) and n[2:] in SIDE: return PRE + full + SIDE[n[2:]]
    return None


bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
mesh = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
for o in list(sc.objects):
    if o.type == "MESH" and o is not mesh: bpy.data.objects.remove(o, do_unlink=True)
assert all(abs(v - 1) < 1e-6 for o in (arm, mesh) for v in o.scale) and arm.parent is None

# ---- 网格上的权重（按原来的骨骼名）----
V = np.array([(mesh.matrix_world @ v.co)[:] for v in mesh.data.vertices]); gname = {g.index: g.name for g in mesh.vertex_groups}
W = {}
for v in mesh.data.vertices:
    for g in v.groups: W.setdefault(gname[g.group], {})[v.index] = g.weight
total = {n: sum(d.values()) for n, d in W.items()}


def tip(bone, direction, frac=0.12):
    """这根骨骼管的顶点里，沿 direction 最远的那一小撮的平均位置（指尖、脚尖）"""
    idx = np.array([i for i, w in W[bone].items() if w > 0.5]); d = np.asarray(direction, float); d /= np.linalg.norm(d)
    s = V[idx] @ d; pick = idx[np.argsort(-s)[:max(3, int(len(idx) * frac))]]; return V[pick].mean(0)


heads = {b.name: np.array(arm.matrix_world @ b.head_local) for b in arm.data.bones}
tips = {}
for p in ("L_", "R_"):
    tips[p + "Mid"] = tip(p + "Mid3", heads[p + "Mid3"] - heads[p + "Mid2"]); tips[p + "Thumb"] = tip(p + "Thumb3", heads[p + "Thumb3"] - heads[p + "Thumb2"])
    for f in ("Index", "Ring", "Pinky"): tips[p + f] = tip(p + f + "3", heads[p + f + "3"] - heads[p + f + "2"])
    t = tip(p + "ToeBase", (1, 0, 0), 0.06); tips[p + "Toe"] = np.array([t[0] - 0.008, heads[p + "ToeBase"][1] + (t[1] - heads[p + "ToeBase"][1]) * 0.5, max(t[2], 0.012)])
for k, v in tips.items(): print("TIP %-8s (%+.3f,%+.3f,%+.3f)" % (k, *v))

# ---- 骨架：删、改名、补末端、对尾巴 ----
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode="EDIT"); eb = arm.data.edit_bones
for b in eb: b.use_connect = False
keep = {b.name for b in eb if new_name(b.name)}
for b in list(eb):
    if b.name in keep: continue
    assert total.get(b.name, 0.0) < 1e-3 or b.name == "Pelvis", (b.name, total.get(b.name))
    for c in b.children: c.parent = b.parent                      # 孩子接到上一级
    print("DELETE", b.name); eb.remove(b)
for b in list(eb): b.name = new_name(b.name)
E = lambda n: eb[PRE + n]
assert E("Hips").parent is None and E("LeftUpLeg").parent == E("Hips") and E("Head").parent == E("Neck"), "层级不对"


def add(name, parent, head, direction, length):
    b = eb.new(PRE + name); b.parent = E(parent); b.use_connect = False; b.head = Vector(head); d = Vector(direction).normalized(); b.tail = b.head + d * length; return b


for p, full in (("L_", "Left"), ("R_", "Right")):
    for f, mf in (("Mid", "HandMiddle"), ("Thumb", "HandThumb")):
        add(full + mf + "4", full + mf + "3", tips[p + f], Vector(tips[p + f]) - E(full + mf + "3").head, 0.02)
    add(full + "Toe_End", full + "ToeBase", tips[p + "Toe"], (1, 0, 0), 0.03)
chain = [("Hips", "Spine"), ("Spine", "Spine1"), ("Spine1", "Spine2"), ("Spine2", "Neck"), ("Neck", "Head"), ("Head", "HeadTop_End")]
for full in ("Left", "Right"):
    chain += [(full + a, full + b) for a, b in (("Shoulder", "Arm"), ("Arm", "ForeArm"), ("ForeArm", "Hand"), ("Hand", "HandMiddle1"), ("UpLeg", "Leg"), ("Leg", "Foot"), ("Foot", "ToeBase"), ("ToeBase", "Toe_End"))]
    for f in ("HandIndex", "HandMiddle", "HandRing", "HandPinky", "HandThumb"): chain += [(full + f + "1", full + f + "2"), (full + f + "2", full + f + "3")]
    chain += [(full + "HandMiddle3", full + "HandMiddle4"), (full + "HandThumb3", full + "HandThumb4")]
for a, b in chain: E(a).tail = E(b).head.copy()
for p, full in (("L_", "Left"), ("R_", "Right")):
    for f, mf in (("Index", "HandIndex"), ("Ring", "HandRing"), ("Pinky", "HandPinky")): E(full + mf + "3").tail = Vector(tips[p + f])
hb = E("HeadTop_End"); hb.tail = hb.head + (hb.head - E("Head").head).normalized() * 0.03
for b in eb: assert b.length > 1e-4, b.name
bpy.ops.object.mode_set(mode="OBJECT")

# ---- 顶点组跟着改名；Pelvis 并进 Hips；没用的删掉 ----
vg = mesh.vertex_groups
for g in list(vg):
    if g.name.startswith(PRE): continue                           # 改骨骼名时 Blender 已经顺手改好的
    nn = new_name(g.name)
    if nn and nn not in vg: g.name = nn
hips = vg.get(PRE + "Hips") or vg.new(name=PRE + "Hips")
if "Pelvis" in vg:
    for i, w in W["Pelvis"].items(): hips.add([i], w, "ADD")
    vg.remove(vg["Pelvis"])
for g in list(vg):
    if g.name not in arm.data.bones: print("DROP group", g.name, round(total.get(g.name, 0.0), 4)); vg.remove(g)

# ---- 权重修补（可选）----
if fix_path and os.path.exists(fix_path):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import fix_weights
    fix_weights.apply(mesh, arm, json.load(open(fix_path, encoding="utf-8")), PRE)

# ---- 整体缩放（骨架和网格的数据一起缩，物体本身保持 1 倍）----
S = Matrix.Scale(SCALE, 4); arm.data.transform(S); mesh.data.transform(S); mesh.data.update(); bpy.context.view_layer.update()
Vn = np.array([(mesh.matrix_world @ v.co)[:] for v in mesh.data.vertices]); print("BBOX", Vn.min(0).round(3), Vn.max(0).round(3), "bones", len(arm.data.bones))
bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True); mesh.select_set(True); bpy.context.view_layer.objects.active = arm
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_skins=True, export_animations=False, export_yup=True, export_apply=False)
print("SAVED", dst, round(os.path.getsize(dst) / 1e6, 2), "MB")
