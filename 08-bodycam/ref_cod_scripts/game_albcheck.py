import bpy, os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gpu_setup import enable_gpu
enable_gpu()
sc = bpy.context.scene; vl = bpy.context.view_layer
sc.render.engine = "CYCLES"; sc.cycles.samples = 4
ob = bpy.data.objects["CH_arch"]; me = ob.data
R = 1024
img = bpy.data.images.new("alb", R, R, alpha=True, float_buffer=True)
for m in me.materials:
    n = m.node_tree.nodes.new("ShaderNodeTexImage"); n.image = img; m.node_tree.nodes.active = n
for o in vl.objects: o.select_set(False)
ob.select_set(True); vl.objects.active = ob
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, uv_layer="LM", margin=2, use_clear=True)
a = np.empty(R * R * 4, np.float32); img.pixels.foreach_get(a); a = a.reshape(R, R, 4)
lm = me.uv_layers["LM"].data
mats = [m.name for m in me.materials]
res = {}
for p in me.polygons:
    nm = mats[p.material_index]
    key = (nm, "down" if p.normal.z < -0.9 else "up" if p.normal.z > 0.9 else "side")
    if key in res or p.area < 1: continue
    uv = sum((lm[i].uv for i in p.loop_indices), start=lm[p.loop_indices[0]].uv * 0) / len(p.loop_indices)
    x, y = int(uv.x * R), int(uv.y * R)
    res[key] = a[max(0,y-3):y+3, max(0,x-3):x+3, :3].reshape(-1, 3).mean(0).round(3).tolist()
for k, v in sorted(res.items()): print("ALB", k, v)
