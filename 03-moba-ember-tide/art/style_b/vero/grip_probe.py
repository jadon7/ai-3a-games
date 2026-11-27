"""量一件装好的武器在手里的朝向（换画风 B，w-vs 用来把新武器摆成和旧武器一样的握法）。
用法: Blender -b --factory-startup -P art/style_b/vero/grip_probe.py -- <rigged.glb> [Right]
读 hero_build.py rig 一步出的 rigged.glb（静止姿势，武器已经蒙在手上），把武器顶点换到“握持坐标”里
（和 hero_build.py 的 hand_frame 一样：+Y 是小指根→食指根，-Z 是顺着前臂往外，X = Y×Z），打印：
  长轴（主成分）指向哪、两头各伸出去多远（握点在原点）；离握点最远那一头的横向张开最宽的方向（弩臂、扳机护圈这类）；
  整件武器在三个轴上的范围。旧武器、新武器各量一遍，对着改 build.json 里 gear 的 long_axis / flip / roll / rot。
"""
import bpy, sys
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src = argv[0]; side = argv[1] if len(argv) > 1 else "Right"; MX = "mixamorig:"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE"); B = arm.data.bones
body = next(o for o in bpy.context.scene.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local; mid = B[MX + side + "HandMiddle1"].head_local
L = (idx - pky).normalized(); d = (h - fore).normalized(); E = (d - L * d.dot(L)).normalized()
p = h + (mid - h) * 0.7
X = L.cross(-E); Fm = np.array([list(X), list(L), list(-E)])          # 行是握持坐标的三个轴（世界坐标里）
mw = np.array(body.matrix_world)
wi = [i for i, s in enumerate(body.material_slots) if s.material and s.material.name.startswith("weapon")]
me = body.data; vs = []
for poly in me.polygons:
    if poly.material_index in wi: vs.extend(poly.vertices)
vs = sorted(set(vs))
co = np.array([list(me.vertices[i].co) for i in vs]); co = (mw[:3, :3] @ co.T).T + mw[:3, 3]
# 换到骨架的坐标（导入时骨架和网格都在同一个世界里，静止姿势）
am = np.array(arm.matrix_world); co = (np.linalg.inv(am[:3, :3]) @ (co - am[:3, 3]).T).T
g = (Fm @ (co - np.array(list(p))).T).T
c = g.mean(0); u, s, vt = np.linalg.svd(g - c, full_matrices=False); ax = vt[0]
t = (g - c) @ ax
if abs(t.max()) < abs(t.min()): ax = -ax; t = -t
far_end = g[t > t.max() - 0.2 * (t.max() - t.min())]; near_end = g[t < t.min() + 0.2 * (t.max() - t.min())]
def spread(pts):
    q = pts - pts.mean(0); q = q - np.outer(q @ ax, ax); uu, ss, vv = np.linalg.svd(q, full_matrices=False); return vv[0], ss[0] / np.sqrt(len(q)), np.ptp(q @ vv[0])
f = lambda v: "(" + ", ".join(f"{x:+.2f}" for x in v) + ")"
print("PROBE", src.split("/")[-1], side, "weapon verts", len(g))
print("PROBE 范围 X", f(g[:, 0].min() * np.ones(1)), "~", f(g[:, 0].max() * np.ones(1)), " Y", f(g[:, 1].min() * np.ones(1)), "~", f(g[:, 1].max() * np.ones(1)), " Z", f(g[:, 2].min() * np.ones(1)), "~", f(g[:, 2].max() * np.ones(1)))
print("PROBE 长轴（指向伸得远的一头）", f(ax), " 远端离握点", round(float(far_end.mean(0) @ ax), 3), " 近端", round(float(near_end.mean(0) @ ax), 3), " 质心", f(c))
for nm, pts in (("远端", far_end), ("近端", near_end)):
    v, sd, w = spread(pts); print("PROBE", nm, "横向最宽的方向", f(v), "宽", round(float(w), 3), " 这一头的中心", f(pts.mean(0)))
# 第三个方向（垂直于长轴和远端张开的方向）：两边各伸出去多远。弩下面挂的灯罐、铳下面的压力罐都在伸得远的那一边（“下”）
sp_far = spread(far_end)[0] if spread(far_end)[2] > spread(near_end)[2] else spread(near_end)[0]
n3 = np.cross(ax, sp_far); n3 /= np.linalg.norm(n3)
mid_ = g[(t > t.min() + 0.2 * (t.max() - t.min())) & (t < t.max() - 0.2 * (t.max() - t.min()))]
r3 = (mid_ - c) @ n3
print("PROBE 张开方向", f(sp_far), " 第三方向 n3", f(n3), " 中段沿 n3：+", round(float(r3.max()), 3), " -", round(float(-r3.min()), 3), "（伸得远的一边是挂件，算“下”）")
