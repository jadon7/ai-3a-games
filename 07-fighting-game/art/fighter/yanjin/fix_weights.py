"""阎烬的绑骨修正（brief.json 的 body_notes）。读 hero_build rig 一步出来的模型（面朝 -Y、脚踩 z=0、身高约 1），
按“贴图颜色 + 位置”挑出几块配件，改它们的蒙皮权重，导出 tripo_rigged_fix.glb（build.json 的 raw 指它）：
  · 右肩单肩甲（暗铁、低饱和）：原来 RightArm 占一半，举臂过头时甲片被上臂拧着翻。改成 RightShoulder 0.55、RightArm 0.30、Spine2 0.15，整片一起动。
  · 佛珠（脖子一圈的深褐木珠）：只跟 Spine2 和 Neck 走（Spine2 0.7、Neck 0.3），低头时不被头拧、不扎进下巴。
  · 腰带垂下的皮带头：只跟 Hips 走。
  · 前臂铁箍：前臂为主（ForeArm 至少 0.85，剩下给 Hand），转腕不拧麻花。
用法: Blender -b --factory-startup -P fix_weights.py -- <输入.glb> <输出.glb> [调试图前缀]
"""
import bpy, sys, math
import numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]; src, dst = argv[0], argv[1]; dbg = argv[2] if len(argv) > 2 else None
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE"); body = next(o for o in sc.objects if o.type == "MESH" and o.vertex_groups)
for o in list(sc.objects):
    if o not in (arm, body): bpy.data.objects.remove(o, do_unlink=True)
me = body.data; MX = "mixamorig:"; B = arm.data.bones
co = np.array([body.matrix_world @ v.co for v in me.vertices])
# 邻接表、同位置顶点（UV 缝上拆开的重复顶点）
nbr = [[] for _ in me.vertices]
for e in me.edges: a_, b_ = e.vertices; nbr[a_].append(b_); nbr[b_].append(a_)
key = {}
for i, c in enumerate(np.round(co, 4)): key.setdefault(tuple(c), []).append(i)
dups = [g for g in key.values() if len(g) > 1]
def clean(sel, it=2):
    """邻居投票去掉零星的点、补上小洞；同位置的重复顶点取并集，免得缝上撕开"""
    for _ in range(it):
        fr = np.array([np.mean(sel[n]) if n else 0 for n in nbr]); sel = np.where(sel, fr >= 0.3, fr > 0.6)
    for g in dups:
        if sel[g].any(): sel[g] = True
    return sel
# 每个顶点的基础色（取它第一个 loop 的 UV 采样）
mat = me.materials[0]; img = next(n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.outputs[0].links and n.outputs[0].links[0].to_socket.name == "Base Color")
W, H = img.size; px = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)[..., :3]
uv = np.zeros((len(me.vertices), 2)); uvl = me.uv_layers.active.data
for lp in me.loops: uv[lp.vertex_index] = uvl[lp.index].uv
xi = np.clip((uv[:, 0] % 1) * W, 0, W - 1).astype(int); yi = np.clip((uv[:, 1] % 1) * H, 0, H - 1).astype(int)
col = px[yi, xi]                                                # 线性空间
srgb = col                                                      # 8 位贴图的 pixels 本来就是 sRGB 值
mx_, mn_ = srgb.max(1), srgb.min(1); val = mx_; sat = (mx_ - mn_) / np.maximum(mx_, 1e-4)
x, y, z = co[:, 0], co[:, 1], co[:, 2]
def head(n): return np.array(B[MX + n].head_local)
def tail(n): return np.array(B[MX + n].tail_local)
def seg_dist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(p - (a + t[:, None] * ab), axis=1), t
gidx = {g.name: g.index for g in body.vertex_groups}
def setw(sel, wmap):
    ids = np.nonzero(sel)[0].tolist()
    for g in body.vertex_groups: g.remove(ids)
    for n, w in wmap.items():
        nm = MX + n
        if nm not in gidx: gidx[nm] = body.vertex_groups.new(name=nm).index
        body.vertex_groups[nm].add(ids, w, "REPLACE")
    return len(ids)
# ---- 单肩甲：右肩一带、低饱和的暗铁（皮肤是高饱和的棕橙色），离上臂轴线 0.045 以外（贴着骨头的是皮肉）----
dA, tA = seg_dist(co, head("RightArm"), tail("RightArm")); nk0 = head("Neck")
pauldron = (x < -0.065) & (z > 0.64) & (z < 0.87) & (tA < 0.62) & (dA > 0.045) & (sat < 0.30) & (val < 0.45) & (np.hypot(x - nk0[0], y - nk0[1]) > 0.10)
pauldron = clean(pauldron)
beads = np.zeros(len(co), bool)                                 # 佛珠：低头含胸测过，原来的权重就行，不改
# ---- 皮带头：身前正中略偏左、腰带下面垂着的一截，棕色皮革 ----
hp = head("Hips")
tail_ = clean((x > -0.025) & (x < 0.075) & (y < -0.03) & (z > 0.43) & (z < 0.545) & (val > 0.12) & (sat > 0.25))
# ---- 前臂铁箍：前臂骨骼附近、离轴线较远（箍在缠布外面），暗 ----
rings = np.zeros(len(co), bool)
for s in ("Left", "Right"):
    d, t = seg_dist(co, head(s + "ForeArm"), tail(s + "ForeArm"))
    rings |= (t > 0.05) & (t < 0.8) & (d < 0.065)
print("SEL pauldron", int(pauldron.sum()), "beads", int(beads.sum()), "belt_tail", int(tail_.sum()), "forearm", int(rings.sum()))
for nm, s in (("pauldron", pauldron), ("beads", beads), ("belt_tail", tail_)):
    if s.any(): print("BOX", nm, co[s].min(0).round(3).tolist(), co[s].max(0).round(3).tolist())
# 甲片主要吃右肩和上胸；下面几层甲片带一点上臂（最多 0.25），抬臂时不至于整片被手臂穿过去
for i in np.nonzero(pauldron)[0]:
    wa = 0.25 * float(np.clip((tA[i] - 0.15) / 0.35, 0, 1)); sel_ = np.zeros(len(co), bool); sel_[i] = True
    setw(sel_, {"RightShoulder": (1 - wa) * 0.75, "Spine2": (1 - wa) * 0.25, "RightArm": wa})
setw(tail_, {"Hips": 1.0})
# 前臂：不整块改，只把前臂外圈的 Hand 权重压到 15% 以下（多出来的给 ForeArm）
for i in np.nonzero(rings)[0]:
    v = me.vertices[int(i)]; gs = {body.vertex_groups[g.group].name: g.weight for g in v.groups}; tot = sum(gs.values()) or 1
    for s in ("Left", "Right"):
        h, f = MX + s + "Hand", MX + s + "ForeArm"
        if h in gs and f in gs and gs[h] / tot > 0.15:
            ex = gs[h] - 0.15 * tot; body.vertex_groups[h].add([v.index], gs[h] - ex, "REPLACE"); body.vertex_groups[f].add([v.index], gs[f] + ex, "REPLACE")
if dbg:
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try: sc.render.engine = eng; break
        except TypeError: pass
    sc.render.resolution_x = 560; sc.render.resolution_y = 560; sc.view_settings.view_transform = "Standard"
    dup = body.copy(); dup.data = me.copy(); sc.collection.objects.link(dup); dup.modifiers.clear(); dup.parent = None; dup.matrix_world = body.matrix_world
    cols = {"pauldron": (1, 0, 0, 1), "beads": (0, 1, 0, 1), "belt_tail": (0, 0.4, 1, 1)}
    for k, c in cols.items():
        m = bpy.data.materials.new(k); m.use_nodes = True; bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"); bsdf.inputs["Base Color"].default_value = c; dup.data.materials.append(m)
    sel = {"pauldron": pauldron, "beads": beads, "belt_tail": tail_}
    for p in dup.data.polygons:
        for j, k in enumerate(cols):
            if all(sel[k][vi] for vi in p.vertices): p.material_index = 1 + j
    body.hide_render = True
    wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.52, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 3
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 0.6
    for nm, az in (("f", 0), ("b", 180), ("r", 270)):
        a = math.radians(az); d = Vector((math.sin(a), -math.cos(a), 0.1)); c = Vector((0, 0, 0.7))
        cam.location = c + d * 4; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler(); sun.rotation_euler = (d + Vector((0, 0, 1))).to_track_quat("Z", "Y").to_euler()
        sc.render.filepath = f"{dbg}_{nm}.png"; bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(dup, do_unlink=True); body.hide_render = False
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=False, export_skins=True, export_yup=True, export_apply=False)
print("SAVED", dst)
