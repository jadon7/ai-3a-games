"""量站姿（idle_pose 第 0 帧）：火钳最低点离地多高、左手的握点离火钳的杆有多远、手和武器有没有插进身体或炉子。
用法: Blender -b --factory-startup -P art/hero/hedda/check_stance.py -- art/hero/hedda/game.glb"""
import bpy, sys, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index("--") + 1])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
ad = arm.animation_data
if ad and ad.nla_tracks:
    for t in ad.nla_tracks: t.mute = t.name != "idle_pose"
sc.frame_set(0); dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
mats = [s.material.name for s in body.material_slots]
W = body.matrix_world; co = [W @ v.co for v in me.vertices]; kind = {}
for p in me.polygons:
    for vi in p.vertices: kind[vi] = mats[p.material_index]
wv = [co[i] for i in range(len(co)) if kind.get(i, "").startswith("weapon")]
bv = [co[i] for i in range(len(co)) if kind.get(i) == "hero"]
print("WEAPON min z", round(min(v.z for v in wv), 4), "max z", round(max(v.z for v in wv), 3), " BODY min z", round(min(v.z for v in bv), 4), "max z", round(max(v.z for v in bv), 3), " ALL max z", round(max(v.z for v in co), 3))
# 火钳的杆：取武器里 z 在 0.15..0.7 的顶点，按主方向拟合一条线
import numpy as np
sh = np.array([tuple(v) for v in wv if 0.12 < v.z < 0.75]); c = sh.mean(0); u, s, vt = np.linalg.svd(sh - c); d = vt[0]
def dist_line(p): p = np.array(p) - c; return float(np.linalg.norm(p - d * p.dot(d)))
PB = arm.pose.bones
for side in ("Left", "Right"):
    h = arm.matrix_world @ PB["mixamorig:" + side + "Hand"].head; m = arm.matrix_world @ PB["mixamorig:" + side + "HandMiddle1"].head
    g = h + (m - h) * 0.7
    print("HAND", side, "wrist", [round(x, 3) for x in h], "grip", [round(x, 3) for x in g], "dist to shaft", round(dist_line(g), 4))
# 武器顶点有多少插在身体里面（用身体网格的 BVH 做射线奇偶判断，粗查）
bm = bmesh.new(); bm.from_mesh(me); bm.transform(W)
bodyf = [f for f in bm.faces if mats[f.material_index] == "hero"]
bm2 = bmesh.new()
vm = {}
for f in bodyf:
    vs = []
    for v in f.verts:
        if v.index not in vm: vm[v.index] = bm2.verts.new(v.co)
        vs.append(vm[v.index])
    try: bm2.faces.new(vs)
    except ValueError: pass
tree = BVHTree.FromBMesh(bm2)
def inside(p):
    n = 0; o = Vector(p); dr = Vector((0.0, 0.0, 1.0))
    while True:
        hit = tree.ray_cast(o + dr * 1e-4, dr)
        if hit[0] is None: break
        n += 1; o = hit[0]
        if n > 50: break
    return n % 2 == 1
ins = sum(1 for v in wv if inside(v)); print("WEAPON verts inside body", ins, "/", len(wv))
