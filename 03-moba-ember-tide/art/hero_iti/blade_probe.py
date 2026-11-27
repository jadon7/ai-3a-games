"""量站姿里两把刀的指向：Blender -b --factory-startup -P art/hero_iti/blade_probe.py -- <game.glb> [动作名] [帧]
打印每只手：手腕、手肘的位置，刀尖（离手最远的武器顶点）相对手的方向，和“手→手肘”方向的夹角（反握贴着小臂时夹角小）。坐标：管线约定（面朝 -Y，左手 +X，Z 向上）。"""
import bpy, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a[0])
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
if len(a) > 1 and arm.animation_data:
    act = bpy.data.actions.get(a[1]) or next((x for x in bpy.data.actions if x.name.startswith(a[1])), None)
    if act: arm.animation_data.action = act
bpy.context.scene.frame_set(int(a[2]) if len(a) > 2 else 0)
dg = bpy.context.evaluated_depsgraph_get()
me_o = next(o for o in bpy.context.scene.objects if o.type == "MESH")
ev = me_o.evaluated_get(dg); me = ev.to_mesh()
wi = [i for i, m in enumerate(me_o.data.materials) if m.name.startswith("weapon")]
vs = set()
for p in me.polygons:
    if p.material_index in wi: vs.update(p.vertices)
mw = me_o.matrix_world
P = {}
for side in ("Left", "Right"):
    pb = arm.pose.bones.get("mixamorig:" + side + "Hand") or next(b for b in arm.pose.bones if b.name.endswith(side + "Hand"))
    fa = arm.pose.bones.get("mixamorig:" + side + "ForeArm") or next(b for b in arm.pose.bones if b.name.endswith(side + "ForeArm"))
    h = arm.matrix_world @ pb.head; e = arm.matrix_world @ fa.head
    pts = [mw @ me.vertices[i].co for i in vs]
    near = [p for p in pts if (p - h).length < 0.5]
    tip = max(near, key=lambda p: (p - h).length if (p.x - 0) * (1 if side == "Left" else -1) > -9 else 0)
    # 每只手只算离这只手近的那把刀
    mine = [p for p in pts if (p - h).length < min((p - (arm.matrix_world @ arm.pose.bones[pb.name.replace(side, "Right" if side == "Left" else "Left")].head)).length, 9)]
    tip = max(mine, key=lambda p: (p - h).length); d = (tip - h).normalized(); toel = (e - h).normalized()
    ang = math.degrees(d.angle(toel))
    print(f"BLADE {side}: hand {tuple(round(x,3) for x in h)} elbow {tuple(round(x,3) for x in e)} tip {tuple(round(x,3) for x in tip)} dir {tuple(round(x,2) for x in d)} angle_to_elbow {ang:.0f}")
