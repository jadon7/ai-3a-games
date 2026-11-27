"""乌戈：Tripo 绑好骨的模型 → hero_build.py 的输入（build.json 的 raw）。两件事，骨架不动：

1. 大头整个跟 Head 走。Tripo 把头下半圈（z 0.72~0.83）的权重分了 10%~27% 给两边肩膀和脖子，抬手、耸肩时大头的下沿会被扯歪。
   头部（z > 0.69）的 Head 权重按 f(w) 重新映射：w ≥ HI 记成 1，w ≤ LO 不变，中间线性拉高；别的骨骼按比例分剩下的。
   这样过渡只留在喉咙下面那一圈（原来 Head 只有三四成的地方），头、钓竿、灯球都是纯 Head。
2. 灯球单独一个材质 weapon_lamp（游戏靠 weapon 开头认它；自己发蓝紫的光，不用贴图，免得和身体共用一张图被压小）。
   灯球的面：按贴图颜色挑出又亮又偏蓝紫的面，拟合一个球，球面附近的面都算。

用法: Blender -b --factory-startup -P fix_model.py -- <tripo_rigged.glb> <输出.glb> [LO=0.3] [HI=0.6]
"""
import bpy, sys, os
import numpy as np
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = a[0], a[1]; LO = float(a[2]) if len(a) > 2 else 0.3; HI = float(a[3]) if len(a) > 3 else 0.6
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
mesh = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
for o in list(sc.objects):
    if o.type == "MESH" and o is not mesh: bpy.data.objects.remove(o, do_unlink=True)
me = mesh.data
V = np.array([(mesh.matrix_world @ v.co)[:] for v in me.vertices])

# ---- 1. 头的权重 ----
gname = {g.index: g.name for g in mesh.vertex_groups}; head = mesh.vertex_groups["mixamorig:Head"]
changed = 0
for v in me.vertices:
    if V[v.index, 2] < 0.69: continue
    ws = {gname[g.group]: g.weight for g in v.groups if g.weight > 0}
    tot = sum(ws.values())
    if tot <= 0: continue
    ws = {k: w / tot for k, w in ws.items()}
    hw = ws.get("mixamorig:Head", 0.0)
    if hw <= LO or hw >= 0.999: continue
    nh = 1.0 if hw >= HI else LO + (hw - LO) * (1 - LO) / (HI - LO)
    k = (1 - nh) / (1 - hw) if hw < 1 else 0
    for n_, w in ws.items():
        g = mesh.vertex_groups[n_]
        if n_ == "mixamorig:Head": g.add([v.index], nh, "REPLACE")
        elif w * k < 1e-4: g.remove([v.index])
        else: g.add([v.index], w * k, "REPLACE")
    changed += 1
print("HEAD weights remapped", changed, "verts (LO %.2f HI %.2f)" % (LO, HI))

# ---- 2. 灯球 ----
mat = me.materials[0]
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
img = bsdf.inputs["Base Color"].links[0].from_node.image
W, H = img.size; px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
uv = me.uv_layers.active.data
fc = np.array([V[list(p.vertices)].mean(0) for p in me.polygons])
cols = []
for p in me.polygons:
    u = np.mean([uv[li].uv[:] for li in p.loop_indices], axis=0)
    cols.append(px[min(H - 1, max(0, int(u[1] * H))), min(W - 1, max(0, int(u[0] * W))), :3])
cols = np.array(cols); lum = cols.mean(1); blue = cols[:, 2] - cols[:, 0]
cand = (lum > 0.42) & (blue > 0.12) & (fc[:, 2] > 0.80)
c = np.median(fc[cand], axis=0)
near = cand & (np.linalg.norm(fc - c, axis=1) < 0.06)
P = fc[near]                                                     # 最小二乘拟合球：|p|² = 2 c·p + (r² - |c|²)
A = np.c_[2 * P, np.ones(len(P))]; sol = np.linalg.lstsq(A, (P ** 2).sum(1), rcond=None)[0]
c = sol[:3]; r = float(np.sqrt(sol[3] + c @ c))
d = np.linalg.norm(fc - c, axis=1)
lamp = d < r * 1.12
print("LAMP center", c.round(3), "radius %.3f" % r, "faces", int(lamp.sum()), "of which bright", int((lamp & cand).sum()))
lm = bpy.data.materials.new("weapon_lamp"); lm.use_nodes = True
b = next(n for n in lm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
b.inputs["Base Color"].default_value = (0.30, 0.35, 0.95, 1)          # #7C8CFF 一路的蓝紫（线性值）
b.inputs["Roughness"].default_value = 0.25; b.inputs["Metallic"].default_value = 0.0
for k in ("Emission Color", "Emission"):
    if k in b.inputs: b.inputs[k].default_value = (0.30, 0.36, 0.95, 1); break
b.inputs["Emission Strength"].default_value = 1.0
me.materials.append(lm); li = len(me.materials) - 1
for p, f in zip(me.polygons, lamp):
    if f: p.material_index = li
me.update()

np.save(os.path.splitext(dst)[0] + "_lamp.npy", np.r_[c, r])
bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True); mesh.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_skins=True, export_animations=False, export_yup=True, export_apply=False)
print("SAVED", dst, round(os.path.getsize(dst) / 1e6, 2), "MB", "materials", [m.name for m in me.materials])
