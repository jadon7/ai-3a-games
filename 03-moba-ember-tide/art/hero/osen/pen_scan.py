"""逐个动作扫一遍穿模：每隔几帧数一次“烛杖的顶点有多少陷在身体里”（握杖的手附近不算），以及杖的最低点低于地面多少。
用法: Blender -b --factory-startup -P art/hero/osen/pen_scan.py -- art/hero/osen/game.glb [每隔几帧=3]
打印每个动作里最严重的几帧：帧号、陷进去的顶点数、陷进去的位置（身体坐标：x 左为正、y 前为负、z 高）、杖最低点。"""
import bpy, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index("--") + 1:]; src = argv[0]; every = int(argv[1]) if len(argv) > 1 else 3
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and len(o.vertex_groups) == 0: bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in sc.objects if o.type == "MESH"); names = [s.material.name for s in body.material_slots]
dirs = [Vector(d).normalized() for d in ((1, 0.13, 0.07), (-1, 0.11, 0.09), (0.12, 1, 0.05), (0.07, -1, 0.11), (0.09, 0.13, 1), (0.1, 0.07, -1))]
for tr in arm.animation_data.nla_tracks: tr.mute = True
for act in sorted(bpy.data.actions, key=lambda a: a.name):
    if act.name == "idle_pose": continue
    arm.animation_data.action = act
    try:
        if getattr(act, "slots", None) and len(act.slots): arm.animation_data.action_slot = act.slots[0]
    except Exception: pass
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1]); rows = []
    for f in range(f0, f1 + 1, every):
        sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles()
        co = [body.matrix_world @ v.co for v in me.vertices]
        bt = [tuple(t.vertices) for t in me.loop_triangles if not names[t.material_index].startswith("weapon")]
        wv = sorted({v for t in me.loop_triangles if names[t.material_index].startswith("weapon") for v in t.vertices})
        tree = BVHTree.FromPolygons(co, bt); hand = arm.matrix_world @ arm.pose.bones["mixamorig:RightHand"].head; hips = arm.matrix_world @ arm.pose.bones["mixamorig:Hips"].head
        inside = []
        for vi in wv[::3]:                                       # 每 3 个顶点抽 1 个，够用了
            p = co[vi]
            if (p - hand).length < 0.11: continue                # 握杖的手：手指本来就包着杖
            votes = 0
            for d in dirs:
                n = 0; o = p.copy()
                for _ in range(30):
                    hit = tree.ray_cast(o, d)
                    if hit[0] is None: break
                    n += 1; o = hit[0] + d * 1e-4
                votes += n % 2
            if votes >= 4: inside.append(p)
        zmin = min(co[v].z for v in wv); c = sum(inside, Vector()) / len(inside) if inside else None
        rows.append((len(inside) * 3, f, zmin, (c - Vector((hips.x, hips.y, 0))) if c else None)); ev.to_mesh_clear()
    worst = sorted(rows, reverse=True)[:4]; low = min(rows, key=lambda r: r[2]); bad = [r for r in rows if r[0] >= 30]
    print(f"PEN {act.name}: {f1 - f0 + 1} 帧，扫了 {len(rows)} 帧；陷进身体 ≥30 个顶点的有 {len(bad)} 帧；杖最低点 {low[2]:+.3f}（第 {low[1]} 帧）")
    for n, f, z, c in worst:
        if n: print(f"PEN    第 {f:3d} 帧  约 {n:4d} 个顶点  位置 x{c.x:+.2f} y{c.y:+.2f} z{c.z:.2f}")
