"""四足（换画风 B · w-quad 写的）：在摆正好的 <name>.blend 里加一根不带权重的“记号”骨骼，存回原文件。

为什么：时间表的 points（技能从哪出、胸口在哪）认骨骼名。旧模型有的那根骨骼，新绑骨里不一定有——旧钟龟的钟里有两根骨骼（Spine_0、Spine_1，
技能的出手点 hand 就是 Spine_1），新钟龟的钟整块绑在 Root 上，没有骨骼。加一根同名的、挂在 Root 下、没有权重的骨骼，
网格一点不变，套动作时它跟旧的那根一样跟着 Root 走，时间表和英雄代码都不用改。
坐标是 .blend 里的世界坐标（摆正以后，和 dump_rig.py 读出来的一样）。

用法: Blender -b --factory-startup V2R/assets/model/<name>.blend -P tools/retarget/quad_add_marker.py -- <骨骼名> <父骨骼名> <头 x,y,z> <尾 x,y,z>
"""
import bpy, sys
from mathutils import Vector

name, parent, head, tail = sys.argv[sys.argv.index("--") + 1:][:4]
head = Vector([float(v) for v in head.split(",")]); tail = Vector([float(v) for v in tail.split(",")])
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
inv = arm.matrix_world.inverted()
bpy.context.view_layer.objects.active = arm
for o in bpy.context.scene.objects: o.select_set(o is arm)
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones
if name in eb: eb.remove(eb[name])
b = eb.new(name); b.head = inv @ head; b.tail = inv @ tail; b.parent = eb[parent]; b.use_connect = False; b.use_deform = False
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.wm.save_mainfile()
print("MARKER", name, "->", parent, list(head), "SAVED", bpy.data.filepath)
