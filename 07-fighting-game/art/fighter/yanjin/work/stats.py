import bpy, sys
import numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE"); body = next(o for o in sc.objects if o.type == "MESH" and o.vertex_groups)
me = body.data; B = arm.data.bones; MX = "mixamorig:"
co = np.array([body.matrix_world @ v.co for v in me.vertices])
img = next(n.image for n in me.materials[0].node_tree.nodes if n.type == "TEX_IMAGE" and n.outputs[0].links[0].to_socket.name == "Base Color")
W, H = img.size; px = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)[..., :3]
uv = np.zeros((len(me.vertices), 2)); uvl = me.uv_layers.active.data
for lp in me.loops: uv[lp.vertex_index] = uvl[lp.index].uv
col = px[np.clip((uv[:, 1] % 1) * H, 0, H - 1).astype(int), np.clip((uv[:, 0] % 1) * W, 0, W - 1).astype(int)]
s = col
val = s.max(1); sat = (s.max(1) - s.min(1)) / np.maximum(s.max(1), 1e-4)
a = np.array(B[MX + "RightArm"].head_local); b = np.array(B[MX + "RightArm"].tail_local); ab = b - a
t = np.clip(((co - a) @ ab) / (ab @ ab), 0, 1); d = np.linalg.norm(co - (a + t[:, None] * ab), axis=1)
reg = (co[:, 0] < -0.06) & (co[:, 2] > 0.64) & (t < 0.7)
print("N", reg.sum())
for lo, hi in [(0, .03), (.03, .045), (.045, .055), (.055, .065), (.065, .08), (.08, .2)]:
    m = reg & (d >= lo) & (d < hi)
    if m.sum(): print(f"d {lo}-{hi} n {m.sum()} val p10/50/90 {np.percentile(val[m],[10,50,90]).round(2)} sat {np.percentile(sat[m],[10,50,90]).round(2)}")
# 两类：低饱和 vs 高饱和
for nm, m in (("lowsat", reg & (sat < 0.35)), ("hisat", reg & (sat >= 0.35))):
    print(nm, m.sum(), "d p10/50/90", np.percentile(d[m], [10, 50, 90]).round(3), "t", np.percentile(t[m], [10, 50, 90]).round(2))
