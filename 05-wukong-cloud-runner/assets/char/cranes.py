"""仙鹤群（二次元风，程序化建模 + 关键帧扇翅）。
add_cranes(BC, scene, start, direction, speed, f0, f1, fps, count=7, seed=0)
- BC：build_chibi 模块（复用它的卡通材质和建模函数）
- start：领头鹤在 f0 帧的位置；direction：飞行方向；speed：m/s
"""
import bpy, bmesh, math, random
import numpy as np
from mathutils import Vector, Matrix


def _wing(BC, name, mat_w, mat_b, parent, side):
    """一侧翅膀：沿 side*Y 伸出 1.05 m，外侧 35% 是黑色飞羽。"""
    bm = bmesh.new()
    n = 7
    rows = []
    for i in range(n + 1):
        t = i / n
        y = side * 1.05 * t
        chord = 0.30 * (1 - 0.55 * t ** 1.5)
        sweep = -0.10 * t * t
        z = 0.03 * math.sin(t * math.pi)
        rows.append((bm.verts.new((0.10 * (1 - t * 0.4) + sweep, y, z)), bm.verts.new((0.10 - chord + sweep - 0.06 * t, y, z))))
    for i in range(n):
        a, b = rows[i], rows[i + 1]
        f = bm.faces.new((a[0], b[0], b[1], a[1]) if side > 0 else (a[0], a[1], b[1], b[0]))
        f.material_index = 1 if i >= n - 3 else 0
        f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat_w); me.materials.append(mat_b)
    ob = BC.new_obj(name, me, parent)
    sd = ob.modifiers.new('Thick', 'SOLIDIFY'); sd.thickness = 0.012; sd.offset = 0
    return ob


def make_crane(BC, name, parent):
    white = BC.toon_mat('CR_White', '#FFFFFF', '#C6D4F2', rim=0.15)
    black = BC.toon_mat('CR_Black', '#30303C', '#1C1C26', rim=0.1)
    red = BC.flat_mat('CR_Red', '#E8322E')
    beak = BC.toon_mat('CR_Beak', '#E8C46A', '#B8914A', rim=0.1)
    root = BC.empty(name, parent)
    BC.ellipsoid(name + '_Body', (0.42, 0.15, 0.15), white, root, (0, 0, 0), segs=20, rings=10)
    BC.ellipsoid(name + '_Tail', (0.20, 0.11, 0.07), black, root, (-0.38, 0, 0.02), segs=14, rings=8)
    pts = [(0.30 + 0.62 * t, 0, 0.03 + 0.10 * math.sin(t * math.pi * 0.9)) for t in [i / 10 for i in range(11)]]
    BC.tube(name + '_Neck', pts, [0.060 - 0.028 * (i / 10) for i in range(11)], white, root, segs=8)
    BC.ellipsoid(name + '_Head', (0.075, 0.050, 0.050), white, root, (0.95, 0, 0.06), segs=12, rings=8)
    BC.ellipsoid(name + '_Cap', (0.045, 0.036, 0.022), red, root, (0.95, 0, 0.10), segs=10, rings=6)
    BC.cone(name + '_Beak', 0.022, 0.24, beak, root, (1.01, 0, 0.05), rot=(0, math.radians(92), 0), segs=8)
    for s in (1, -1):
        BC.tube(name + f'_Leg{s}', [(-0.30, s * 0.04, -0.06), (-0.75, s * 0.04, -0.07), (-1.10, s * 0.04, -0.05)], [0.014, 0.012, 0.010], black, root, segs=6)
    wings = []
    for s in (1, -1):
        sh = BC.empty(name + f'_Sh{s}', root, (0.08, s * 0.10, 0.07))
        _wing(BC, name + f'_Wing{s}', white, black, sh, s)
        wings.append((sh, s))
    return root, wings


def add_cranes(BC, scene, start, direction, speed, f0, f1, fps, count=7, seed=0, spacing=2.6, scale=1.25):
    rnd = random.Random(seed)
    old_col = BC.COL
    col = bpy.data.collections.get('CRANES') or bpy.data.collections.new('CRANES')
    if col.name not in [c.name for c in scene.collection.children]:
        scene.collection.children.link(col)
    BC.COL = col
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1))).normalized()
    yaw = math.atan2(d.y, d.x)
    pitch = math.asin(max(-1, min(1, d.z)))
    out = []
    for i in range(count):
        rank = (i + 1) // 2
        sgn = 1 if i % 2 else -1
        off = -d * (rank * spacing * 1.1) + side * (sgn * rank * spacing) + Vector((0, 0, rnd.uniform(-0.5, 0.5)))
        off += Vector((rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), 0))
        root, wings = make_crane(BC, f'CR_{seed}_{i}', None)
        root.scale = (scale, scale, scale)
        root.rotation_euler = (0, -pitch, yaw)
        ph = rnd.uniform(0, 6.28)
        freq = rnd.uniform(2.3, 2.9)               # 扇翅频率 Hz
        bob_ph = rnd.uniform(0, 6.28)
        p0 = Vector(start) + off
        for f in range(f0 - 6, f1 + 7, 2):
            t = (f - f0) / fps
            w = math.sin(2 * math.pi * freq * t + ph)
            root.location = p0 + d * (speed * t) + Vector((0, 0, 0.18 * math.sin(2 * math.pi * freq * t + ph + 1.2) + 0.3 * math.sin(0.9 * t + bob_ph)))
            root.keyframe_insert('location', frame=f)
            for sh, s in wings:
                sh.rotation_euler = (s * (math.radians(8) + math.radians(34) * w), 0, 0)
                sh.keyframe_insert('rotation_euler', frame=f, index=0)
        out.append(root)
    BC.COL = old_col
    return out
