"""把一个绑好骨的模型“读”成一份纯数据（骨架 + 蒙皮网格），给 retarget.py 和 measure.py 用。

为什么要单独读一遍：动作文件（motions/*.npz）里存的是每根骨骼相对它自己静止朝向的旋转，静止朝向只在模型里有；
不同的 Tripo 绑骨，骨骼的静止朝向（roll）各不相同，所以要换算就得先把两边的静止骨架都拿出来。
网格也一起存下来（每个顶点最多 4 根骨骼的权重），量脚底陷没陷地、武器尖在哪、手有没有插进身体，都直接用真的网格算，不靠估。

两种输入，和出品脚本读模型的方式一致（这样静止朝向和游戏里的那份完全一样）：
  人形：Tripo 绑骨装好武器的 GLB（V2R/assets/model/<id>_rigged.glb，hero_build.py game 一步读的就是它）
  四足：管线摆正好的 .blend（V2R/assets/model/<n>.blend，creature_build.py 读的是它，带着 v2r_root 的旋转和缩放）

用法: Blender -b --factory-startup [模型.blend] -P tools/retarget/dump_rig.py -- <模型.glb 或 -> <输出.npz>
      （给 .blend 时把它放在 -P 前面，第一个参数写 -）
产出 npz：
  names (B,) 骨骼名；parent (B,) 父骨骼下标；rest (B,4,4) 世界坐标里的静止矩阵（= 物体矩阵 @ bone.matrix_local）；
  head、tail (B,3)；verts (V,3) 静止网格（世界坐标）；widx、wval (V,4) 蒙皮；weapon (V,) 这个顶点是不是武器（材质名以 weapon 开头）；
  ground 静止时网格最低点的 z。
"""
import bpy, sys, os
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
if src != "-":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
skinned = [o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0]
body = next((o for o in skinned if any(m.type == "ARMATURE" for m in o.modifiers)), skinned[0])      # .blend 里可能还有别的带顶点组的网格，取挂着骨架修改器的那个
bpy.context.view_layer.update()
B = arm.data.bones; names = [b.name for b in B]; idx = {n: i for i, n in enumerate(names)}
mw = arm.matrix_world
rest = np.array([np.array(mw @ b.matrix_local) for b in B])
head = np.array([list(mw @ b.head_local) for b in B]); tail = np.array([list(mw @ b.tail_local) for b in B])
parent = np.array([idx[b.parent.name] if b.parent else -1 for b in B])

me = body.data; bw = body.matrix_world
V = len(me.vertices); verts = np.zeros((V, 3)); widx = np.zeros((V, 4), int); wval = np.zeros((V, 4))
gname = {g.index: g.name for g in body.vertex_groups}
for v in me.vertices:
    verts[v.index] = list(bw @ v.co)
    gs = sorted([(g.weight, idx[gname[g.group]]) for g in v.groups if gname.get(g.group) in idx and g.weight > 1e-4], reverse=True)[:4]
    s = sum(w for w, _ in gs) or 1.0
    for k, (w, bi) in enumerate(gs): widx[v.index, k] = bi; wval[v.index, k] = w / s
# 武器：材质名以 weapon 开头（游戏 hero.ts 也是这么认的）
mat_weapon = np.array([bool(s.material and s.material.name.startswith("weapon")) for s in body.material_slots] or [False])
poly_mat = np.zeros(len(me.polygons), int); me.polygons.foreach_get("material_index", poly_mat)
weapon = np.zeros(V, bool)
for p, mi in zip(me.polygons, poly_mat):
    if mat_weapon[mi]:
        for vi in p.vertices: weapon[vi] = True
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
np.savez(out, names=np.array(names), parent=parent, rest=rest, head=head, tail=tail, verts=verts, widx=widx, wval=wval, weapon=weapon, ground=float(verts[:, 2].min()))
print("DUMP", out, "bones", len(names), "verts", V, "weapon verts", int(weapon.sum()), "bbox", verts.min(0).round(3).tolist(), verts.max(0).round(3).tolist())
