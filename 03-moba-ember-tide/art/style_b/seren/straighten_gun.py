"""塞伦 B 风格螺壳长铳：把 Tripo 出的铳摆正（w-vs）。
用法: Blender -b --factory-startup -P art/style_b/seren/straighten_gun.py -- <in.glb> <out.glb>
为什么：即梦的武器图是斜着的三分之四视角，Tripo 照着出的铳在自己的坐标里也是斜的（包围盒 0.32 × 1.0 × 0.61），
hero_build.py 的 load_weapon 按包围盒最长的轴当铳管，斜着放进手里方向就错了。
做法：主成分的第一轴当铳管，转到 +Y（铳口朝 +Y：取铳管两头里 y+z 大的那头，看过渲染图，铳口在上、在前）；
世界 +Z 去掉铳管方向的分量当“上”（击锤在上，压力罐在下），转到 +Z。这样和旧铳 weapon_seren_raw.glb 的摆法一样（铳口 +Y、罐子 -Z），
build.json 里 gear 的 roll 180 可以照抄旧的。
"""
import bpy, sys
import numpy as np
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
o = next(o for o in bpy.context.scene.objects if o.type == "MESH")
mw = np.array(o.matrix_world); co = np.array([list(v.co) for v in o.data.vertices]); w = (mw[:3, :3] @ co.T).T + mw[:3, 3]
c = w.mean(0); u, s, vt = np.linalg.svd(w - c, full_matrices=False); a1 = vt[0]
t = (w - c) @ a1; hi = w[t > np.percentile(t, 97)].mean(0); lo = w[t < np.percentile(t, 3)].mean(0)
if (hi - lo) @ np.array([0, 1, 1]) < 0: a1 = -a1
up = np.array([0, 0, 1.0]) - a1[2] * a1; up /= np.linalg.norm(up); x = np.cross(a1, up)
R = np.array([x, a1, up])                                   # 行：新的 X、Y、Z 在旧坐标里的方向
M = np.eye(4); M[:3, :3] = R @ mw[:3, :3]; M[:3, 3] = R @ (mw[:3, 3] - c)
o.matrix_world = Matrix(M.tolist()); bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
w2 = np.array([list(o.matrix_world @ v.co) for v in o.data.vertices])
print("STRAIGHT a1", np.round(a1, 3), "size now", np.round(np.ptp(w2, 0), 3))
# 罐子在哪一边：铳管中段（离两头各 30%）沿 Z 往下伸得最远的点
yy = w2[:, 1]; y0, y1 = yy.min(), yy.max(); mid = w2[(yy > y0 + 0.3 * (y1 - y0)) & (yy < y1 - 0.3 * (y1 - y0))]
print("STRAIGHT mid z range", round(float(mid[:, 2].min()), 3), round(float(mid[:, 2].max()), 3), "（罐子在下，min 的绝对值应该更大）")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=False)
print("SAVED", out)
