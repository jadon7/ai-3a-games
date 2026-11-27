"""量一下烛杖沿长轴每一小段的截面：中心在哪、有多粗，用来挑一段干净的杆身给手握。
用法: Blender -b --factory-startup -P art/hero/osen/weapon_probe.py -- art/models_src/weapon_osen_raw.glb"""
import bpy, sys
from mathutils import Vector
src = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
o = next(o for o in bpy.context.scene.objects if o.type == "MESH"); mw = o.matrix_world
co = [mw @ v.co for v in o.data.vertices]
mn = Vector([min(c[i] for c in co) for i in range(3)]); mx = Vector([max(c[i] for c in co) for i in range(3)])
print("PROBE bbox", [round(v, 3) for v in mn], [round(v, 3) for v in mx])
N = 50
for k in range(N):
    z0 = mn.z + (mx.z - mn.z) * k / N; z1 = mn.z + (mx.z - mn.z) * (k + 1) / N
    seg = [c for c in co if z0 <= c.z < z1]
    if not seg: print("PROBE", k / N, "empty"); continue
    xs = [c.x for c in seg]; ys = [c.y for c in seg]
    print("PROBE t=%.2f n=%4d  x[%.3f,%.3f] y[%.3f,%.3f]  w=%.3f d=%.3f" % (k / N, len(seg), min(xs), max(xs), min(ys), max(ys), max(xs) - min(xs), max(ys) - min(ys)))
