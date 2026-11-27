"""认出扇贝肩甲的顶点（左右各一片），画成彩色检查图，并把顶点编号存下来给 fix_weights.py 用。
判定：主体材质、在肩膀外侧（|x|>0.072）、高度 0.6~0.86、离上臂骨骼的轴线 >0.04（比手臂的皮肤远），再按 UV 岛投票：一个岛里超过一半的顶点是候选，整个岛都算肩甲。
用法: Blender -b --factory-startup -P art/hero/seren/weights/pad_select.py -- <摆正后的 glb> <输出前缀>"""
import bpy, bmesh, sys, json, math, numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0]); out = argv[1]
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
o = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
for x in list(sc.objects):
    if x.type == "MESH" and x is not o: bpy.data.objects.remove(x, do_unlink=True)
B = arm.data.bones; to_arm = arm.matrix_world.inverted() @ o.matrix_world
V = np.array([list(to_arm @ v.co) for v in o.data.vertices])
mat = np.zeros(len(V), int)
for p in o.data.polygons:
    for vi in p.vertices: mat[vi] = p.material_index
bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
isl = -np.ones(len(V), int); k = 0
for v in bm.verts:
    if isl[v.index] >= 0: continue
    st = [v]; isl[v.index] = k
    while st:
        x = st.pop()
        for e in x.link_edges:
            y = e.other_vert(x)
            if isl[y.index] < 0: isl[y.index] = k; st.append(y)
    k += 1
def seg_dist(P, a, b):
    a = np.array(a); b = np.array(b); d = b - a; t = np.clip(((P - a) @ d) / (d @ d), 0, 1); return np.linalg.norm(P - (a + t[:, None] * d), axis=1)
TH = float(argv[2]) if len(argv) > 2 else 0.04
sel = {}
for side, sx in (("Left", 1), ("Right", -1)):
    ua = B["mixamorig:" + side + "Arm"]
    d = seg_dist(V, ua.head_local, ua.tail_local)
    cand = (mat == 0) & (V[:, 0] * sx > 0.072) & (V[:, 2] > 0.6) & (V[:, 2] < 0.86) & (d > TH)      # 判定和 fix_weights.py 一致（TH 默认 0.04）
    pad = np.zeros(len(V), bool)
    for i in np.unique(isl[cand]):
        m = isl == i
        if cand[m].mean() > 0.5 and V[m, 2].mean() < 0.82: pad |= m & (V[:, 0] * sx > 0.062) & (V[:, 2] < 0.84)
    # 补洞：离已选的点很近（1.2 厘米内）、也在肩外侧、离上臂轴线不太近的点也算上
    from mathutils.kdtree import KDTree
    kd = KDTree(int(pad.sum())); [kd.insert(V[i], i) for i in np.where(pad)[0]]; kd.balance()
    for _ in range(3):                                           # 和 fix_weights.py 一样的补洞条件
        add = [i for i in np.where((~pad) & (mat == 0) & (V[:, 0] * sx > 0.08) & (V[:, 2] > 0.62) & (V[:, 2] < 0.83) & (d > 0.034))[0] if kd.find(V[i])[2] < 0.008]
        pad[add] = True
        kd = KDTree(int(pad.sum())); [kd.insert(V[i], int(i)) for i in np.where(pad)[0]]; kd.balance()
    sel[side] = np.where(pad)[0].tolist(); print("PAD", side, len(sel[side]), "lo", V[pad].min(0).round(3), "hi", V[pad].max(0).round(3))
json.dump(sel, open(out + ".json", "w"))
# 检查图：肩甲涂红、别的灰
col = o.data.color_attributes.new("chk", "FLOAT_COLOR", "POINT")
padall = set(sel["Left"]) | set(sel["Right"])
for i in range(len(V)): col.data[i].color = (0.9, 0.15, 0.1, 1) if i in padall else (0.6, 0.6, 0.6, 1)
sc.render.engine = "BLENDER_WORKBENCH"; sh = sc.display.shading; sh.color_type = "VERTEX"; sh.light = "STUDIO"
sc.render.resolution_x = sc.render.resolution_y = 480
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 0.62
c = Vector((0, 0, 0.72))
for j, (az, el) in enumerate(((0, 5), (90, 5), (180, 5), (0, 80))):
    a, e = math.radians(az), math.radians(el); dvec = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = c + dvec * 3; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{out}_{j}.png"; bpy.ops.render.render(write_still=True)
