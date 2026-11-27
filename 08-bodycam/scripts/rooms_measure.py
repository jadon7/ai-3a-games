import bpy, os, math
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "assets", "env_tworooms", "scene.gltf"))
scn = bpy.context.scene
roots = [o for o in scn.objects if o.parent is None]
piv = bpy.data.objects.new("Piv", None); scn.collection.objects.link(piv)
for r in roots: r.parent = piv
piv.rotation_euler = (0, 0, math.radians(114.4703))
bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
def ray(o, d, dist=30):
    hit, loc, nor, idx, ob, mat = scn.ray_cast(dg, Vector(o), Vector(d).normalized(), distance=dist)
    return loc if hit else None
def med(v): v = sorted(v); return v[len(v)//2]
rooms = {"C": (0.65, 3.1), "B": (0.65, -1.1)}
for n, (cx, cy) in rooms.items():
    fl = med([ray((cx + dx, cy + dy, 1.5), (0, 0, -1)).z for dx in (-1, 0, 1, 1.8) for dy in (-1, 0, 1)])
    ce = med([ray((cx + dx, cy + dy, 1.5), (0, 0, 1)).z for dx in (-1, 0, 1, 1.8) for dy in (-1, 0, 1)])
    E = med([ray((cx, cy + dy, fl + z), (1, 0, 0)).x for dy in (-1.5, -0.7, 0, 0.7, 1.5) for z in (0.6, 1.4, 2.2)])
    W = med([ray((cx, cy + dy, fl + z), (-1, 0, 0)).x for dy in (-1.7, 1.7) for z in (0.6, 2.9)])
    N = med([ray((cx + dx, cy, fl + z), (0, 1, 0)).y for dx in (0.3, 1, 1.7, 2.2) for z in (0.6, 1.4, 2.2)])
    S = med([ray((cx + dx, cy, fl + z), (0, -1, 0)).y for dx in (0.3, 1, 1.7, 2.2) for z in (0.6, 1.4, 2.2)])
    print(f"ROOM {n}: floor {fl:.3f} ceil {ce:.3f} W {W:.3f} E {E:.3f} S {S:.3f} N {N:.3f}")
    rooms[n] = dict(fl=fl, ce=ce, W=W, E=E, S=S, N=N, cx=cx, cy=cy)
def sweep_open(o_fn, d, rng, thr):
    """返回射线穿过去（thr 内没打到）的参数区间"""
    out = []; cur = None
    for t in rng:
        l = ray(o_fn(t), d, thr)
        if l is None:
            if cur is None: cur = [t, t]
            cur[1] = t
        elif cur is not None: out.append(tuple(round(v, 3) for v in cur)); cur = None
    if cur is not None: out.append(tuple(round(v, 3) for v in cur))
    return out
fr = lambda a, b, s=0.01: [a + i * s for i in range(int((b - a) / s) + 1)]
C, B = rooms["C"], rooms["B"]
for z in (0.15, 0.4, 1.0, 1.8, 2.05):
    print(" C north wall openings x @z+%.2f" % z, sweep_open(lambda t: (t, C["N"] - 0.6, C["fl"] + z), (0, 1, 0), fr(C["W"] + 0.05, C["E"] - 0.05), 1.4))
print(" C north door vertical @x=-0.9", sweep_open(lambda t: (-0.9, C["N"] - 0.6, C["fl"] + t), (0, 1, 0), fr(0.02, 3.2), 1.4))
for z in (0.15, 0.4, 1.0, 1.8, 2.05):
    print(" C south wall (internal) openings x @z+%.2f" % z, sweep_open(lambda t: (t, C["S"] + 0.6, C["fl"] + z), (0, -1, 0), fr(C["W"] + 0.05, C["E"] - 0.05), 1.2))
print(" internal door vertical @x=-0.9", sweep_open(lambda t: (-0.9, C["S"] + 0.6, C["fl"] + t), (0, -1, 0), fr(0.02, 3.2), 1.2))
for z in (0.15, 0.6, 1.2, 1.8, 2.4):
    print(" C west wall openings y @z+%.2f" % z, sweep_open(lambda t: (C["W"] + 0.8, t, C["fl"] + z), (-1, 0, 0), fr(C["S"] + 0.05, C["N"] - 0.05), 1.6))
print(" C west window vertical @y=3.8", sweep_open(lambda t: (C["W"] + 0.8, 3.8, C["fl"] + t), (-1, 0, 0), fr(0.02, 3.2), 1.6))
for z in (0.15, 0.6, 1.2, 1.8, 2.4):
    print(" B west wall openings y @z+%.2f" % z, sweep_open(lambda t: (B["W"] + 0.8, t, B["fl"] + z), (-1, 0, 0), fr(B["S"] + 0.05, B["N"] - 0.05), 1.6))
print(" B west window vertical @y=-1.7", sweep_open(lambda t: (B["W"] + 0.8, -1.7, B["fl"] + t), (-1, 0, 0), fr(0.02, 3.2), 1.6))
for z in (0.15, 0.4, 1.0, 1.8, 2.4, 2.8):
    print(" B south wall openings x @z+%.2f" % z, sweep_open(lambda t: (t, B["S"] + 0.6, B["fl"] + z), (0, -1, 0), fr(B["W"] + 0.05, B["E"] - 0.05), 2.0))
print(" B south opening vertical @x=-0.9", sweep_open(lambda t: (-0.9, B["S"] + 0.6, B["fl"] + t), (0, -1, 0), fr(0.02, 3.2), 2.0))
# 内门门框厚度：从 C 侧和 B 侧看墙面位置
print(" internal wall faces: C side y", C["S"], " B side y", B["N"])
# 门洞侧壁位置
for z in (0.5, 1.2):
    a = ray((-0.9, (C["S"] + B["N"]) / 2, C["fl"] + z), (-1, 0, 0), 2); b = ray((-0.9, (C["S"] + B["N"]) / 2, C["fl"] + z), (1, 0, 0), 2)
    print(" internal door jambs x", a.x if a else None, b.x if b else None)
    a = ray((-0.9, C["N"] + 0.02, C["fl"] + z), (-1, 0, 0), 2); b = ray((-0.9, C["N"] + 0.02, C["fl"] + z), (1, 0, 0), 2)
    print(" north door jambs x (just outside wall plane)", a.x if a else None, b.x if b else None)
# 地面高度分布
import statistics
for n, r in rooms.items():
    hs = [ray((r["W"] + 0.3 + i * 0.3, r["S"] + 0.3 + j * 0.3, 2.0), (0, 0, -1)) for i in range(15) for j in range(12)]
    hs = [h.z for h in hs if h]
    print(f" {n} floor z: min {min(hs):.3f} med {statistics.median(hs):.3f} max {max(hs):.3f}")
# 门槛处地面
for y in (C["N"] - 0.3, C["N"] - 0.05, C["N"] + 0.03, C["S"] + 0.1, (C["S"] + B["N"]) / 2, B["N"] - 0.1):
    h = ray((-0.9, y, 1.2), (0, 0, -1)); print("  threshold floor at y=%.2f:" % y, round(h.z, 3) if h else None)
