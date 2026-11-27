"""找灯球：按贴图颜色挑出又亮又偏蓝紫的面，再按位置聚成一团；顺便看头部那一块的权重是不是都归 Head。
用法: Blender -b --factory-startup -P probe_lamp.py -- <tripo_rigged.glb>
"""
import bpy, sys
import numpy as np
from mathutils import Vector
src = sys.argv[sys.argv.index("--") + 1:][0]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
mesh = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
me = mesh.data
mat = me.materials[0]
img = next(n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and "base" in (n.label + n.name + n.image.name).lower()) if any(n.type == "TEX_IMAGE" for n in mat.node_tree.nodes) else None
imgs = [(n.name, n.image.name, n.image.size[:]) for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
print("IMAGES", imgs)
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
lk = bsdf.inputs["Base Color"].links
img = lk[0].from_node.image if lk else None
print("BASE IMG", img.name if img else None)
W, H = img.size; px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
uv = me.uv_layers.active.data
V = np.array([(mesh.matrix_world @ v.co)[:] for v in me.vertices])
fc = []; cols = []
for p in me.polygons:
    u = np.mean([uv[li].uv[:] for li in p.loop_indices], axis=0)
    x = min(W - 1, max(0, int(u[0] * W))); y = min(H - 1, max(0, int(u[1] * H)))
    cols.append(px[y, x, :3]); fc.append(V[list(p.vertices)].mean(0))
cols = np.array(cols); fc = np.array(fc)
lum = cols.mean(1); blue = cols[:, 2] - cols[:, 0]
cand = (lum > 0.42) & (blue > 0.12) & (fc[:, 2] > 0.80)
print("CAND", cand.sum())
c0 = fc[cand].mean(0); print("CAND CENTER", c0.round(3))
d = np.linalg.norm(fc[cand] - c0, axis=1); print("CAND dist pct", np.percentile(d, [10, 50, 90, 99]).round(3))
c1 = np.median(fc[cand], axis=0); print("CAND MEDIAN", c1.round(3))
for r in (0.02, 0.03, 0.04, 0.05, 0.06):
    inr = np.linalg.norm(fc - c1, axis=1) < r
    print("r", r, "faces", inr.sum(), "cand among them", (inr & cand).sum(), "mean lum", cols[inr].mean(0).round(2))
# 头部的权重
gname = {g.index: g.name for g in mesh.vertex_groups}
hw = np.zeros(len(V)); other = np.zeros(len(V)); oname = [""] * len(V)
for v in me.vertices:
    for g in v.groups:
        if gname[g.group] == "mixamorig:Head": hw[v.index] = g.weight
        elif g.weight > other[v.index]: other[v.index] = g.weight; oname[v.index] = gname[g.group]
for z in (0.68, 0.70, 0.72, 0.74, 0.76, 0.80):
    sel = V[:, 2] > z
    print("z>%.2f verts %d  Head<0.99: %d  Head<0.5: %d" % (z, sel.sum(), (sel & (hw < 0.99)).sum(), (sel & (hw < 0.5)).sum()))
sel = (V[:, 2] > 0.70) & (hw < 0.99)
from collections import Counter
print("OTHER BONES above 0.70", Counter(oname[i] for i in np.where(sel)[0]).most_common(8))
print("HEAD bbox", V[hw > 0.5].min(0).round(3), V[hw > 0.5].max(0).round(3))
lo = V[hw > 0.5]; print("head lowest z", lo[:, 2].min().round(3))
for z in (0.72, 0.74, 0.76, 0.80):
    sel = (V[:, 2] > z) & (hw < 0.99)
    print("Z%.2f hw pct" % z, np.percentile(hw[sel], [0, 5, 25, 50, 75]).round(3) if sel.any() else "-", "hw<0.9:", (sel & (hw < 0.9)).sum(), "hw<0.7:", (sel & (hw < 0.7)).sum())
    s2 = (V[:, 2] > z) & (hw < 0.9)
    if s2.any(): print("   pos of hw<0.9: x", np.percentile(V[s2, 0], [5, 50, 95]).round(3), "y", np.percentile(np.abs(V[s2, 1]), [5, 50, 95]).round(3), "z", np.percentile(V[s2, 2], [5, 50, 95]).round(3))
for a, b in ((0.1, 0.3), (0.3, 0.45), (0.45, 0.6), (0.6, 0.75)):
    s = (hw >= a) & (hw < b)
    if s.any(): print("BAND %.2f-%.2f n %d" % (a, b, s.sum()), "x", np.percentile(V[s, 0], [5, 50, 95]).round(3), "|y|", np.percentile(np.abs(V[s, 1]), [5, 50, 95]).round(3), "z", np.percentile(V[s, 2], [5, 50, 95]).round(3), Counter(oname[i] for i in np.where(s)[0]).most_common(3))
s = (hw >= 0.3) & (np.abs(V[:, 1]) > 0.11) & (V[:, 2] < 0.74)
print("PAULDRON-ish with hw>=0.3:", s.sum(), np.percentile(V[s, 2], [5, 50, 95]).round(3) if s.any() else "")
