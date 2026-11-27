import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
def ray(o, d, dist=50):
    hit, loc, nor, idx, ob, mat = sc.ray_cast(dg, Vector(o), Vector(d).normalized(), distance=dist)
    return (loc, nor) if hit else (None, None)
# 地面高度网格
print("FLOOR/CEIL grid (x from 17 to 25, y from 0.3 to 5.3)")
for y in [5.2, 4.4, 3.6, 2.8, 2.0, 1.2, 0.4]:
    row = []
    for x in [17, 18, 19, 20, 21, 22, 23, 24, 25]:
        l, n = ray((x, y, 2.2), (0, 0, -1)); c, n2 = ray((x, y, 2.2), (0, 0, 1))
        row.append(f"{l.z:.2f}/{c.z:.2f}" if l and c else (f"{l.z:.2f}/--" if l else "--/--"))
    print(f" y={y}: ", "  ".join(row))
# 四面墙沿线扫描：从房间中线向外打水平射线，报告命中距离（None = 开口）
def scan(axis, sign, zs=(0.5, 1.2, 2.0, 2.6)):
    print(f"WALL scan axis={axis} sign={sign}")
    rng = [16.8 + 0.25 * i for i in range(35)] if axis == "y" else [0.0 + 0.2 * i for i in range(29)]
    for z in zs:
        out = []
        for t in rng:
            o = (t, 2.7, z) if axis == "y" else (21.0, t, z)
            d = (0, sign, 0) if axis == "y" else (sign, 0, 0)
            l, n = ray(o, d)
            if l is None: out.append("  .  ")
            else: out.append(f"{(l.y if axis=='y' else l.x):5.2f}")
        print(f"  z={z}: " + " ".join(out))
    print("  t: " + " ".join(f"{t:5.2f}" for t in rng))
scan("y", 1); scan("y", -1); scan("x", -1); scan("x", 1)
