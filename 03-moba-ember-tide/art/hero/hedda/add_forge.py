"""把脚本建的熔炉和烟囱装到 Tripo 绑好骨的模型背上，导出成 hero_build.py 的输入（build.json 的 raw）。
用法: Blender -b --factory-startup -P art/hero/hedda/add_forge.py -- art/hero/hedda/tripo_rigged.glb art/hero/hedda/tripo_rigged_forge.glb

  - 炉子（gear.py 的 make_forge）摆在后背上：前面贴着后背，左右对准脊柱，炉底在胯上一点。整个炉子只蒙在 Spine2 上（硬的大件让一根骨骼管）。
  - Tripo 从背带猜出来一个扁平的背包（和后背焊在一起，分不开）：把它压扁成一块贴着后背的薄板，权重也全给 Spine2，
    这样它和炉子一起动，不会在动作里从炉子侧面戳出来。
  - 炉子的材质叫 forge / forge_fire，排在身体的材质后面（hero_build 认第一个材质是身体）。
"""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import gear

MX = "mixamorig:"
SCALE = 1.05            # 炉子整体放大（gear.py 里按半径 0.122、高 0.372 建；Tripo 的背包从胯上到肩下，炉子要盖得住）
GAP = 0.058             # 炉子前面（贴后背的那一面）离脊柱多远（后背的皮在 0.045 到 0.06）
Z0 = 0.522              # 炉底的高度（Tripo 的背包下沿 0.525）
PACK_X = 0.066          # 离脊柱比这远的、在背包高度范围里的顶点算背包，压扁到这里

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
for o in list(sc.objects):
    if o.type == "MESH" and o is not body: bpy.data.objects.remove(o, do_unlink=True)
B = arm.data.bones; AW = arm.matrix_world
toe = (AW @ B[MX + "LeftToeBase"].tail_local) - (AW @ B[MX + "LeftToeBase"].head_local); fwd = Vector((toe.x, toe.y, 0)).normalized()
fwd = Vector([round(c) for c in fwd]).normalized()                 # Tripo 出来的角色正对一个坐标轴
up = Vector((0, 0, 1)); left = up.cross(fwd); back = -fwd
sp = AW @ B[MX + "Spine2"].head_local
print("FRAME fwd", tuple(fwd), "left", tuple(left), "spine2", [round(c, 3) for c in sp])

# ---- 背包压扁成薄板、权重全给 Spine2 ----
MW = body.matrix_world; MWi = MW.inverted(); me = body.data
g_sp2 = body.vertex_groups[MX + "Spine2"]
n_pack = 0
for v in me.vertices:
    p = MW @ v.co; d = (p - sp).dot(back); lat = (p - sp).dot(left)
    if d > PACK_X and 0.5 < p.z < 0.84 and abs(lat) < 0.125:
        p = p - back * (d - PACK_X - (d - PACK_X) * 0.12); v.co = MWi @ p; n_pack += 1
        for g in list(v.groups): body.vertex_groups[g.group].remove([v.index])
        g_sp2.add([v.index], 1.0, "REPLACE")
me.update(); print("PACK flattened verts", n_pack)

# ---- 炉子 ----
fm = gear.make_forge()
R = Matrix((left, back, up)).transposed()                          # 炉子自己的 X、Y、Z 在世界里朝哪
base = Vector((sp.x, sp.y, 0)) + back * GAP + up * Z0
fm.transform(Matrix.Translation(base) @ R.to_4x4() @ Matrix.Scale(SCALE, 4))
fm.transform(MWi)                                                    # 合并前换到身体网格自己的坐标里
fo = bpy.data.objects.new("forge", fm); sc.collection.objects.link(fo); fo.matrix_world = MW
fo.vertex_groups.new(name=MX + "Spine2").add(list(range(len(fm.vertices))), 1.0, "REPLACE")
co = [MW @ v.co for v in me.vertices] + [MW @ v.co for v in fm.vertices]
print("FORGE top z", round(max(MW @ v.co for v in fm.vertices).z if False else max((MW @ v.co).z for v in fm.vertices), 3), "back-most", round(max((MW @ v.co - sp).dot(back) for v in fm.vertices), 3))
bpy.ops.object.select_all(action="DESELECT"); fo.select_set(True); body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join(); body.data.calc_loop_triangles()
print("JOINED tris", len(body.data.loop_triangles), "materials", [s.material.name for s in body.material_slots], "uv", [u.name for u in body.data.uv_layers])
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=False, export_skins=True, export_yup=True, export_apply=False)
print("SAVED", dst, round(os.path.getsize(dst) / 1e6, 2), "MB")
